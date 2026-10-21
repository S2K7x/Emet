import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { BodyView, ChatLine, ItemView, Look, MeetingKind, Phase, PlayerView, Role, ServerMsg, Status, Winner, YouView } from "../../shared/protocol.ts";
import config from "../../data/game.json" with { type: "json" };
import quickchat from "../../data/quickchat.json" with { type: "json" };
import mapData from "../../data/map.json" with { type: "json" };
import skins from "../../data/skins.json" with { type: "json" };
import minigames from "../../data/minigames.json" with { type: "json" };
import { MapGeometry, type MapData } from "../../shared/map.ts";
import { Meeting } from "./meeting.ts";
import { assignment, handlers, pool, roleDefs, type PowerWorld } from "./powers.ts";

const map = new MapGeometry(mapData as MapData);

interface Player {
  id: string;
  name: string;
  color: string;
  look: Look;
  x: number;
  y: number;
  input: { dx: number; dy: number };
  socket: WebSocket;
  token: string;
  awayUntil?: number; // disconnected: removed from the game after this timestamp
  role: Role;
  roleId?: string; // special role (data/powers.json)
  alive: boolean;
  ejected: boolean; // voted out: can never be revived
  nextKillAt: number; // timestamp ms
  nextChatAt: number;
  nextPowerAt: number;
  uses: number; // -1 = unlimited
  // Power effects (timestamps ms)
  danceUntil: number;
  djUntil: number;
  shieldUntil: number;
  slipUntil: number;
  slipDir: { dx: number; dy: number };
  disguise?: { name: string; color: string; look: Look; until: number };
  eaten: number;
  // Game loop
  offer?: string[]; // roles to pick from at game start
  tasks: { station: string; done: boolean }[];
  working?: { station: string; seconds: number };
  ghostTasks: number; // tasks done as a ghost: weights revival
  emergencies: number;
}

type Body = BodyView & { fake?: boolean };
type Item = ItemView & { owner: string; armedAt: number };

export class Room {
  readonly players = new Map<string, Player>();
  private bodies: Body[] = [];
  private items: Item[] = [];
  private timers: { at: number; fn: () => void }[] = [];
  private lightsOutUntil = 0;
  private vision = 0;
  private revives = 0;
  private playMs = 0; // play time elapsed (paused during meetings)
  private roundStartMs = 0;
  private choiceUntil = 0;
  private taskDone = 0;
  private taskTotal = 0;
  private nextId = 0;
  private phase: Phase = "lobby";
  private host = "";
  private winner?: Winner;
  private meeting?: Meeting;
  private timer: NodeJS.Timeout;
  private lastTick = Date.now();

  constructor(readonly code: string, private onEmpty: () => void) {
    this.timer = setInterval(() => this.tick(), 1000 / config.tickRate);
  }

  get canJoin(): string | undefined {
    if (this.phase === "playing" || this.phase === "meeting") return "Game already in progress";
    if (this.players.size >= config.maxPlayers) return "Room is full";
  }

  add(id: string, name: string, look: unknown, socket: WebSocket) {
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = config.colors.find((c) => !used.has(c)) ?? config.colors[0];
    const spot = map.spawnPoint(this.players.size, config.maxPlayers);
    this.players.set(id, {
      id,
      name: name.slice(0, 16) || "Player",
      color,
      look: cleanLook(look),
      x: spot.x,
      y: spot.y,
      input: { dx: 0, dy: 0 },
      socket,
      token: randomUUID(),
      role: "innocent",
      alive: true,
      ejected: false,
      nextKillAt: 0,
      nextChatAt: 0,
      nextPowerAt: 0,
      uses: 0,
      danceUntil: 0,
      djUntil: 0,
      shieldUntil: 0,
      slipUntil: 0,
      slipDir: { dx: 0, dy: 0 },
      eaten: 0,
      tasks: [],
      ghostTasks: 0,
      emergencies: 0,
    });
    if (!this.host) this.host = id;
    this.sendJoined(this.players.get(id)!);
  }

  // Reconnection after an outage (locked screen, mobile network): same player, new socket.
  rejoin(token: string, socket: WebSocket): string | undefined {
    const p = [...this.players.values()].find((q) => q.token === token);
    if (!p) return undefined;
    if (p.socket !== socket) p.socket.close();
    p.socket = socket;
    p.awayUntil = undefined;
    this.sendJoined(p);
    return p.id;
  }

  disconnect(id: string, socket: WebSocket) {
    const p = this.players.get(id);
    if (!p || p.socket !== socket) return; // already reconnected on another socket
    p.awayUntil = Date.now() + config.reconnectGrace * 1000;
    p.input = { dx: 0, dy: 0 };
  }

  private sendJoined(p: Player) {
    send(p.socket, {
      t: "joined",
      code: this.code,
      you: p.id,
      token: p.token,
      map: { width: map.data.width, height: map.data.height },
      radius: config.player.radius,
      killRange: config.kill.range,
      reportRange: config.report.range,
      minPlayers: config.minPlayers,
    });
  }

  remove(id: string) {
    const gone = this.players.get(id);
    this.players.delete(id);
    if (this.players.size === 0) {
      clearInterval(this.timer);
      this.onEmpty();
      return;
    }
    if (this.host === id) this.host = this.players.keys().next().value!;
    this.meeting?.forget(id);
    // Their unfinished tasks no longer block the bar.
    if (gone?.role === "innocent") this.taskTotal -= gone.tasks.filter((t) => !t.done).length;
    this.checkTaskBar();
    this.checkVictory();
  }

  setInput(id: string, dx: number, dy: number) {
    const p = this.players.get(id);
    if (!p || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    // The client sends a direction; the server normalizes it (no speed hack possible).
    const len = Math.hypot(dx, dy);
    p.input = len > 1 ? { dx: dx / len, dy: dy / len } : { dx, dy };
  }

  start(id: string) {
    if (id !== this.host || (this.phase !== "lobby" && this.phase !== "ended") || this.players.size < config.minPlayers) return;

    // Roles are drawn server-side only.
    const all = shuffle([...this.players.values()]);
    const killerCount = killersFor(all.length);
    const now = Date.now();
    all.forEach((p, i) => {
      p.role = i < killerCount ? "killer" : "innocent";
      p.alive = true;
      p.ejected = false;
      p.nextKillAt = now + config.kill.initialCooldown * 1000;
      p.emergencies = config.emergency.perPlayer;
      p.working = undefined;
      p.ghostTasks = 0;
      // Everyone gets tasks (killers and neutrals: fake ones, as cover).
      p.tasks = shuffle(map.data.stations.map((st) => st.id)).slice(0, config.tasks.perPlayer).map((station) => ({ station, done: false }));
    });
    this.dealRoles(all.slice(killerCount), all.slice(0, killerCount), now);
    this.taskDone = 0;
    this.taskTotal = all.filter((p) => p.role === "innocent").length * config.tasks.perPlayer;
    this.playMs = this.roundStartMs = 0;
    this.choiceUntil = now + config.roles.choiceTime * 1000;
    this.bodies = [];
    this.items = [];
    this.timers = [];
    this.lightsOutUntil = 0;
    this.revives = 0;
    this.winner = undefined;
    this.meeting = undefined;
    this.phase = "playing";
  }

  report(id: string) {
    const p = this.players.get(id);
    if (this.phase !== "playing" || !p?.alive) return;
    const body = this.bodies.find((b) => map.reachable(p.x, p.y, b.x, b.y, config.report.range));
    if (!body) return;
    this.startMeeting(id, body.victim);
  }

  // The big red button on the hub table.
  emergency(id: string) {
    const p = this.players.get(id);
    const at = map.data.emergency;
    if (this.phase !== "playing" || !p?.alive || p.emergencies <= 0 || Math.hypot(p.x - at.x, p.y - at.y) > config.emergency.range) return; // the table itself blocks sight: distance only
    p.emergencies--;
    this.fx("banner", undefined, "🚨 Emergency meeting!");
    this.startMeeting(id, "", "emergency");
  }

  // Starts the mini-game at an assigned, unfinished station in range. Moving cancels it.
  task(id: string) {
    const p = this.players.get(id);
    if (this.phase !== "playing" || !p || p.working) return;
    const st = map.data.stations.find(
      (s) => p.tasks.some((t) => t.station === s.id && !t.done) && map.reachable(p.x, p.y, s.x, s.y, config.tasks.range),
    );
    if (st) p.working = { station: st.id, seconds: 0 };
  }

  private updateWork(p: Player, dt: number, moved: boolean) {
    if (!p.working) return;
    const st = map.data.stations.find((s) => s.id === p.working!.station)!;
    if (moved || !map.reachable(p.x, p.y, st.x, st.y, config.tasks.range)) {
      p.working = undefined;
      return;
    }
    p.working.seconds += dt;
  }

  // The mini-game itself runs on the client; the server checks place, stillness and minimum time.
  finishTask(id: string) {
    const p = this.players.get(id);
    if (this.phase !== "playing" || !p?.working || p.working.seconds < minigames.minSeconds) return;
    const station = p.working.station;
    p.tasks.find((t) => t.station === station)!.done = true;
    p.working = undefined;
    if (!p.alive) p.ghostTasks++;
    if (p.role === "innocent") {
      this.taskDone++;
      this.checkTaskBar();
    }
  }

  taskCancel(id: string) {
    const p = this.players.get(id);
    if (p) p.working = undefined;
  }

  private checkTaskBar() {
    if (this.phase === "playing" && this.taskTotal > 0 && this.taskDone >= this.taskTotal) this.end("innocent");
  }

  // The innocent/killer role choice closes after a few seconds (default: the first offer).
  pick(id: string, role: string) {
    const p = this.players.get(id);
    if (this.phase !== "playing" || !p?.offer?.includes(role) || Date.now() > this.choiceUntil) return;
    const nextPowerAt = p.nextPowerAt;
    this.giveRole(p, role, Date.now());
    p.nextPowerAt = nextPowerAt;
    p.offer = undefined;
  }

  // body = "" for an emergency or end-of-round meeting.
  private startMeeting(reporter: string, body: string, kind: MeetingKind = "report") {
    this.phase = "meeting";
    this.meeting = new Meeting(reporter, body, Date.now(), kind);
    this.lightsOutUntil = 0;
    for (const q of this.players.values()) {
      q.input = { dx: 0, dy: 0 };
      q.working = undefined;
      q.offer = undefined;
      q.danceUntil = q.djUntil = q.slipUntil = 0;
      q.disguise = undefined;
    }
  }

  // Innocents and killers are offered a few roles (all different while the pool lasts); maybe one innocent becomes a neutral.
  private dealRoles(innocents: Player[], killers: Player[], now: number) {
    const neutrals = pool("neutral");
    if (innocents.length > 1 && neutrals.length && this.players.size >= assignment.neutralMinPlayers && Math.random() < assignment.neutralChance) {
      const p = innocents.pop()!;
      p.role = "neutral";
      p.offer = undefined;
      this.giveRole(p, shuffle(neutrals)[0].id, now);
    }
    for (const [players, team] of [[innocents, "innocent"], [killers, "killer"]] as const) {
      const ids = pool(team).map((r) => r.id);
      const deck = shuffle([...ids]); // first offers (the defaults) are all different while the pool lasts
      players.forEach((p, i) => {
        const offer = deck.length ? [deck[i % deck.length]] : [];
        for (const id of shuffle(ids.filter((id) => id !== offer[0])).slice(0, config.roles.choices - 1)) offer.push(id);
        p.offer = offer.length > 1 ? offer : undefined;
        this.giveRole(p, offer[0], now);
      });
    }
  }

  private giveRole(p: Player, roleId: string | undefined, now: number) {
    const def = roleId ? roleDefs.get(roleId) : undefined;
    p.roleId = def?.id;
    p.uses = def?.uses ?? 0;
    p.nextPowerAt = now + (def?.initialCooldown ?? 5) * 1000;
    p.danceUntil = p.djUntil = p.shieldUntil = p.slipUntil = 0;
    p.disguise = undefined;
    p.eaten = 0;
  }

  power(id: string) {
    const p = this.players.get(id);
    const now = Date.now();
    const def = p?.roleId ? roleDefs.get(p.roleId) : undefined;
    if (this.phase !== "playing" || !p?.alive || !def || p.uses === 0 || now < p.nextPowerAt) return;
    if (!handlers[def.id]?.(this.world(now), p, def.params)) return;
    if (p.uses > 0) p.uses--;
    p.nextPowerAt = now + Math.max(1, def.cooldown) * 1000;
  }

  private killPlayer(p: Player) {
    if (!p.alive) return;
    p.alive = false;
    p.shieldUntil = 0;
    const body: Body = { id: p.id, victim: p.id, color: p.color, look: p.look, x: Math.round(p.x), y: Math.round(p.y) };
    this.bodies.push(body);
    // Canadian: the body reports itself (if nobody touched it in the meantime).
    const def = p.roleId ? roleDefs.get(p.roleId) : undefined;
    if (def?.id === "canadian") {
      this.later(def.params.delay, () => {
        if (this.phase === "playing" && this.bodies.includes(body)) {
          this.fx("banner", undefined, "🍁 Sorry! A body reported itself");
          this.startMeeting(p.id, p.id);
        }
      });
    }
  }

  private canRevive(id: string) {
    const p = this.players.get(id);
    return !!p && !p.alive && !p.ejected && this.revives < assignment.reviveCap && this.bodies.some((b) => !b.fake && b.victim === id);
  }

  private revive(id: string) {
    if (!this.canRevive(id)) return false;
    const p = this.players.get(id)!;
    const i = this.bodies.findIndex((b) => !b.fake && b.victim === id);
    ({ x: p.x, y: p.y } = this.bodies[i]);
    this.bodies.splice(i, 1);
    p.alive = true;
    this.revives++;
    this.fx("revive", p);
    return true;
  }

  private later(seconds: number, fn: () => void) {
    this.timers.push({ at: Date.now() + seconds * 1000, fn });
  }

  private fx(kind: string, at?: { x: number; y: number }, text?: string) {
    const msg: ServerMsg = { t: "fx", kind, text, x: at && Math.round(at.x), y: at && Math.round(at.y) };
    for (const q of this.players.values()) send(q.socket, msg);
  }

  // Services exposed to power handlers (powers.ts).
  private world(now: number): PowerWorld {
    const room = this;
    const alive = () => [...this.players.values()].filter((q) => q.alive);
    return {
      now,
      alive,
      player: (id) => this.players.get(id),
      closest(p, range, filter) {
        let best: Player | undefined;
        let bestD = range;
        for (const q of alive()) {
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (filter(q) && d <= bestD && !map.blocked(p.x, p.y, q.x, q.y)) [best, bestD] = [q, d];
        }
        return best;
      },
      bodyNear: (p, range) => this.bodies.find((b) => map.reachable(p.x, p.y, b.x, b.y, range)),
      removeBody: (id) => (this.bodies = this.bodies.filter((b) => b.id !== id)),
      addDecoy: (p, of) => {
        this.bodies.push({ id: `decoy-${this.nextId++}`, victim: of.id, color: of.color, look: of.look, x: Math.round(p.x), y: Math.round(p.y), fake: true });
      },
      dropBanana: (p, max, armDelay) => {
        const mine = this.items.filter((it) => it.owner === p.id);
        if (mine.length >= max) this.items = this.items.filter((it) => it !== mine[0]);
        this.items.push({ id: `item-${this.nextId++}`, kind: "banana", x: Math.round(p.x), y: Math.round(p.y), owner: p.id, armedAt: now + armDelay * 1000 });
      },
      killPlayer: (p) => {
        room.killPlayer(p as Player);
        room.checkVictory();
      },
      revive: (id) => room.revive(id),
      canRevive: (id) => room.canRevive(id),
      reviveRandom: () => {
        // Weighted: each task done as a ghost is one more ticket.
        const tickets = [...this.players.values()].filter((q) => room.canRevive(q.id)).flatMap((q) => Array(1 + q.ghostTasks).fill(q));
        const p: Player | undefined = tickets[Math.floor(Math.random() * tickets.length)];
        if (!p || !room.revive(p.id)) return undefined;
        room.checkVictory();
        return p;
      },
      emergency: (caller) => {
        this.fx("banner", undefined, "📞 Emergency meeting!");
        this.startMeeting(caller.id, "", "emergency");
      },
      lightsOut: (until, vision) => {
        this.lightsOutUntil = until;
        this.vision = vision;
      },
      later: (s, fn) => this.later(s, fn),
      fx: (kind, at, text) => this.fx(kind, at, text),
      win: (winner) => this.end(winner),
    };
  }

  chat(id: string, phrase: number, target?: string) {
    const p = this.players.get(id);
    const now = Date.now();
    if (!p || now < p.nextChatAt) return;
    // Meetings: everyone. During the round: ghosts only (to each other).
    if (this.phase !== "meeting" && !(this.phase === "playing" && !p.alive)) return;
    const text = quickchat.phrases[phrase];
    if (typeof text !== "string") return;
    const needsTarget = text.includes("{player}");
    if (needsTarget && !(target && this.players.has(target))) return;
    p.nextChatAt = now + config.chat.minInterval * 1000;

    // The living are heard by everyone; ghosts only by each other.
    const line: ChatLine = { from: id, phrase, target: needsTarget ? target : undefined, ghost: !p.alive };
    for (const q of this.players.values()) {
      if (p.alive || !q.alive) send(q.socket, { t: "chat", ...line });
    }
  }

  vote(id: string, target: string) {
    if (this.phase !== "meeting" || !this.meeting) return;
    this.meeting.vote(id, String(target), this.aliveIds());
  }

  private aliveIds() {
    return new Set([...this.players.values()].filter((p) => p.alive).map((p) => p.id));
  }

  private updateMeeting(now: number) {
    const meeting = this.meeting!;
    const before = meeting.stage;
    const done = meeting.update(now, this.aliveIds());

    const ejected = meeting.result?.ejected && this.players.get(meeting.result.ejected);
    if (before === "vote" && ejected) {
      // Ejected = ghost, no body, permanently (can never be revived).
      ejected.alive = false;
      ejected.ejected = true;
    }
    if (!done) return;

    // Back to the game: bodies removed, everyone to the center, cooldowns restarted.
    this.meeting = undefined;
    this.bodies = [];
    this.items = [];
    this.phase = "playing";
    this.roundStartMs = this.playMs; // every meeting starts a new round
    // Jester: getting voted out was the plan all along.
    if (ejected && ejected.roleId === "jester") return this.end("jester");
    const all = [...this.players.values()];
    all.forEach((p, i) => {
      ({ x: p.x, y: p.y } = map.spawnPoint(i, all.length));
      p.input = { dx: 0, dy: 0 };
      p.nextKillAt = now + config.kill.cooldown * 1000;
    });
    this.checkVictory();
  }

  kill(id: string) {
    const killer = this.players.get(id);
    const now = Date.now();
    if (this.phase !== "playing" || !killer || !killer.alive || killer.role !== "killer" || now < killer.nextKillAt) return;

    // The server picks the target: alive, not a killer, closest within range.
    let target: Player | undefined;
    let best = config.kill.range;
    for (const p of this.players.values()) {
      if (!p.alive || p.role === "killer") continue;
      const d = Math.hypot(p.x - killer.x, p.y - killer.y);
      if (d <= best && !map.blocked(killer.x, killer.y, p.x, p.y)) {
        best = d;
        target = p;
      }
    }
    if (!target) return;

    killer.nextKillAt = now + config.kill.cooldown * 1000;
    if (target.shieldUntil > now) {
      // Medic bubble: the kill is wasted, everyone nearby sees it pop.
      target.shieldUntil = 0;
      this.fx("pop", target);
      return;
    }
    this.killPlayer(target);
    this.checkVictory();
  }

  private checkVictory() {
    if (this.phase !== "playing") return;
    const alive = [...this.players.values()].filter((p) => p.alive);
    const killers = alive.filter((p) => p.role === "killer").length;
    const innocents = alive.length - killers;
    if (killers === 0) this.end("innocent");
    else if (killers >= innocents) this.end("killer");
  }

  private end(winner: Winner) {
    this.phase = "ended";
    this.winner = winner;
    this.timers = [];
  }

  private tick() {
    const now = Date.now();
    for (const p of [...this.players.values()]) {
      if (p.awayUntil && now > p.awayUntil) this.remove(p.id);
    }
    if (this.players.size === 0) return;
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    const { speed, radius } = config.player;

    if (this.phase === "meeting") this.updateMeeting(now);
    if (this.phase === "playing") this.updateClock(dt);
    for (const t of this.timers.filter((t) => now >= t.at)) {
      this.timers.splice(this.timers.indexOf(t), 1);
      t.fn();
    }

    for (const p of this.players.values()) {
      if (this.phase === "meeting") break; // nobody moves during a meeting
      if (p.disguise && now > p.disguise.until) p.disguise = undefined;
      if (p.alive && now < p.danceUntil) {
        this.updateWork(p, dt, false); // DJ: dancing on the spot (tasks still progress)
        continue;
      }
      const slipping = p.alive && now < p.slipUntil;
      const dir = slipping ? p.slipDir : p.input;
      this.updateWork(p, dt, slipping || Math.hypot(dir.dx, dir.dy) > 0.05);
      const v = speed * (slipping ? (roleDefs.get("prankster")?.params.slipSpeed ?? 1.8) : 1);
      ({ x: p.x, y: p.y } = map.collide(p.x + dir.dx * v * dt, p.y + dir.dy * v * dt, radius));
      if (p.alive && !slipping && this.phase === "playing") this.checkBanana(p, now);
    }

    for (const viewer of this.players.values()) {
      send(viewer.socket, {
        t: "snapshot",
        time: now,
        phase: this.phase,
        host: this.host,
        you: this.youFor(viewer, now),
        players: this.viewFor(viewer, now),
        bodies: this.phase === "lobby" ? [] : this.bodies.filter((b) => this.canSee(viewer, b, now)).map(({ fake: _, ...b }) => b),
        items: this.items.filter((it) => this.canSee(viewer, it, now)).map(({ owner: _o, armedAt: _a, ...it }) => it),
        meeting: this.meeting?.viewFor(viewer.id, now, (id) => this.players.get(id)?.role),
        clock: this.phase === "playing" || this.phase === "meeting" ? this.clock() : undefined,
        taskBar: this.phase === "lobby" || this.taskTotal <= 0 ? undefined : Math.min(1, this.taskDone / this.taskTotal),
        winner: this.winner,
      });
    }
  }

  // Game clock: a round ends in a meeting, the clock running out = killers win.
  private updateClock(dt: number) {
    this.playMs += dt * 1000;
    if (this.playMs >= config.time.total * 1000) {
      this.fx("banner", undefined, "⏰ Time's up!");
      return this.end("killer");
    }
    if (this.playMs - this.roundStartMs >= config.time.round * 1000) {
      this.fx("banner", undefined, "⏰ Round over: time to vote!");
      this.startMeeting("", "", "round");
    }
  }

  private clock() {
    const total = config.time.total * 1000 - this.playMs;
    const round = Math.min(total, config.time.round * 1000 - (this.playMs - this.roundStartMs));
    return { round: Math.max(0, Math.ceil(round / 1000)), total: Math.max(0, Math.ceil(total / 1000)) };
  }

  private checkBanana(p: Player, now: number) {
    const hit = this.items.find((it) => it.kind === "banana" && now >= it.armedAt && Math.hypot(it.x - p.x, it.y - p.y) < config.player.radius + 12);
    if (!hit) return;
    this.items = this.items.filter((it) => it !== hit);
    const moving = Math.hypot(p.input.dx, p.input.dy) > 0.1;
    const a = Math.random() * Math.PI * 2;
    p.slipDir = moving ? { ...p.input } : { dx: Math.cos(a), dy: Math.sin(a) };
    p.slipUntil = now + (roleDefs.get("prankster")?.params.slipDuration ?? 1.2) * 1000;
    this.fx("slip", p);
  }

  // Lights out: innocents and neutrals only see what's close to them.
  private blind(viewer: Player, now: number) {
    return this.phase === "playing" && now < this.lightsOutUntil && viewer.alive && viewer.role !== "killer";
  }

  private canSee(viewer: Player, at: { x: number; y: number }, now: number) {
    return !this.blind(viewer, now) || Math.hypot(at.x - viewer.x, at.y - viewer.y) <= this.vision;
  }

  private youFor(p: Player, now: number): YouView {
    if (this.phase === "lobby") return { alive: true };
    const def = p.roleId ? roleDefs.get(p.roleId) : undefined;
    return {
      role: p.role,
      alive: p.alive,
      killCooldown: p.role === "killer" ? Math.max(0, Math.ceil((p.nextKillAt - now) / 1000)) : undefined,
      power: def && {
        id: def.id,
        cooldown: Math.max(0, Math.ceil((p.nextPowerAt - now) / 1000)),
        uses: p.uses >= 0 ? p.uses : undefined,
        progress: def.id === "vulture" ? `${p.eaten}/${def.params.goal}` : undefined,
      },
      blind: this.blind(p, now) ? this.vision : undefined,
      tasks: p.tasks,
      working: p.working && { station: p.working.station, ready: p.working.seconds >= minigames.minSeconds },
      emergencies: p.emergencies,
      offer: p.offer && now < this.choiceUntil ? p.offer : undefined,
      offerLeft: p.offer && now < this.choiceUntil ? Math.ceil((this.choiceUntil - now) / 1000) : undefined,
    };
  }

  private statusOf(p: Player, now: number): Status[] | undefined {
    if (!p.alive) return undefined;
    const s: Status[] = [];
    if (now < p.danceUntil) s.push("dance");
    if (now < p.djUntil) s.push("dj");
    if (now < p.shieldUntil) s.push("shield");
    if (now < p.slipUntil) s.push("slip");
    return s.length ? s : undefined;
  }

  // Snapshot built per player: it only contains what they're allowed to know.
  private viewFor(viewer: Player, now: number): PlayerView[] {
    const views: PlayerView[] = [];
    for (const p of this.players.values()) {
      // Ghosts are only visible to other ghosts (and to everyone at game end).
      if (!p.alive && viewer.alive && (this.phase === "playing" || this.phase === "meeting")) continue;
      if (p !== viewer && !this.canSee(viewer, p, now)) continue;
      // Shapeshifter: everyone sees the borrowed look, except the killer team.
      const d = p.disguise && p !== viewer && this.roleVisibleTo(viewer, p) !== "killer" ? p.disguise : p;
      views.push({
        id: p.id,
        name: d.name,
        color: d.color,
        look: d.look,
        x: Math.round(p.x),
        y: Math.round(p.y),
        alive: p.alive,
        away: p.awayUntil ? true : undefined,
        role: this.roleVisibleTo(viewer, p),
        status: this.statusOf(p, now),
        roleId: this.phase === "ended" || p === viewer ? p.roleId : undefined,
      });
    }
    return views;
  }

  private roleVisibleTo(viewer: Player, p: Player): Role | undefined {
    if (this.phase === "lobby") return undefined;
    if (this.phase === "ended" || viewer.id === p.id) return p.role;
    if (config.killers.knowEachOther && viewer.role === "killer" && p.role === "killer") return "killer";
    return undefined;
    return undefined;
  }
}

export function send(socket: WebSocket, msg: ServerMsg) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

function killersFor(count: number) {
  const table = config.killers.byPlayers as Record<string, number>;
  return table[String(count)] ?? Math.max(1, Math.floor(count / 4));
}

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// The client's choice is untrusted: an unknown id falls back to the default skin.
function cleanLook(raw: unknown): Look {
  const l = (raw ?? {}) as Partial<Record<keyof Look, unknown>>;
  const skin = skins.skins.some((s) => s.id === l.skin) ? String(l.skin) : skins.default;
  return { skin };
}
