import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { ChatLine, MeetingKind, Phase, ServerMsg, Winner } from "../../shared/protocol.ts";
import quickchat from "../../data/quickchat.json" with { type: "json" };
import minigames from "../../data/minigames.json" with { type: "json" };
import { Meeting } from "./meeting.ts";
import { cleanSetting, configWith, defaultSettings, type Settings } from "../../shared/settings.ts";
import { isMoving, map, move } from "./movement.ts";
import { cleanLook, killersFor, send, shuffle, type Body, type Item, type Player } from "./player.ts";
import { canSee, youFor, viewFor, type Sight } from "./visibility.ts";
import { assignment, handlers, pool, roleDefs, type PowerWorld } from "./powers.ts";


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
  private settings: Settings = defaultSettings();
  private cfg = configWith(this.settings); // this room's config: game.json + the host's settings
  private host = "";
  private winner?: Winner;
  private meeting?: Meeting;
  private timer: NodeJS.Timeout;
  private lastTick = Date.now();

  constructor(readonly code: string, private onEmpty: () => void) {
    this.timer = setInterval(() => this.tick(), 1000 / this.cfg.tickRate);
  }

  get canJoin(): string | undefined {
    if (this.phase === "playing" || this.phase === "meeting") return "Game already in progress";
    if (this.players.size >= this.cfg.maxPlayers) return "Room is full";
  }

  add(id: string, name: string, look: unknown, socket: WebSocket) {
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = this.cfg.colors.find((c) => !used.has(c)) ?? this.cfg.colors[0];
    const spot = map.spawnPoint(this.players.size, this.cfg.maxPlayers);
    this.players.set(id, {
      id,
      name: name.slice(0, 16) || "Player",
      color,
      look: cleanLook(look),
      x: spot.x,
      y: spot.y,
      input: { dx: 0, dy: 0 },
      vel: { x: 0, y: 0 },
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
      nextWarpAt: 0,
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
    p.awayUntil = Date.now() + this.cfg.reconnectGrace * 1000;
    p.input = { dx: 0, dy: 0 };
  }

  private sendJoined(p: Player) {
    send(p.socket, {
      t: "joined",
      code: this.code,
      you: p.id,
      token: p.token,
      map: { width: map.data.width, height: map.data.height },
      radius: this.cfg.player.radius,
      killRange: this.cfg.kill.range,
      reportRange: this.cfg.report.range,
      minPlayers: this.cfg.minPlayers,
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
    // Left mid-game: no body, no bot, just a banner (role hidden unless `leave.revealRole`).
    if (gone && this.phase !== "lobby" && this.phase !== "ended") {
      this.fx("banner", undefined, `👋 ${gone.name} left the game${this.cfg.leave.revealRole ? ` (${gone.role})` : ""}`);
    }
    // Their unfinished tasks no longer block the bar.
    if (gone?.role === "innocent") this.taskTotal -= gone.tasks.filter((t) => !t.done).length;
    this.checkTaskBar();
    this.checkVictory();
  }

  // Host only, between games. The value is untrusted: cleaned against hostSettings.
  setting(id: string, key: string, value: unknown) {
    if (id !== this.host || (this.phase !== "lobby" && this.phase !== "ended")) return;
    const v = cleanSetting(key, value);
    if (v === undefined) return;
    this.settings = { ...this.settings, [key]: v };
    this.cfg = configWith(this.settings);
  }

  setInput(id: string, dx: number, dy: number) {
    const p = this.players.get(id);
    if (!p || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    // The client sends a direction; the server normalizes it (no speed hack possible).
    const len = Math.hypot(dx, dy);
    p.input = len > 1 ? { dx: dx / len, dy: dy / len } : { dx, dy };
  }

  start(id: string) {
    if (id !== this.host || (this.phase !== "lobby" && this.phase !== "ended") || this.players.size < this.cfg.minPlayers) return;

    // Roles are drawn server-side only.
    const all = shuffle([...this.players.values()]);
    const killerCount = killersFor(all.length, this.cfg);
    const now = Date.now();
    all.forEach((p, i) => {
      p.role = i < killerCount ? "killer" : "innocent";
      p.alive = true;
      p.ejected = false;
      p.nextKillAt = now + this.cfg.kill.initialCooldown * 1000;
      p.emergencies = this.cfg.emergency.perPlayer;
      p.working = undefined;
      p.warp = undefined;
      p.nextWarpAt = 0;
      p.tether = undefined;
      p.ghostTasks = 0;
      // Everyone gets tasks (killers and neutrals: fake ones, as cover).
      p.tasks = shuffle(map.data.stations.map((st) => st.id)).slice(0, this.cfg.tasks.perPlayer).map((station) => ({ station, done: false }));
    });
    this.dealRoles(all.slice(killerCount), all.slice(0, killerCount), now);
    this.taskDone = 0;
    this.taskTotal = all.filter((p) => p.role === "innocent").length * this.cfg.tasks.perPlayer;
    this.playMs = this.roundStartMs = 0;
    this.choiceUntil = now + this.cfg.roles.choiceTime * 1000;
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
    const body = this.bodies.find((b) => map.reachable(p.x, p.y, b.x, b.y, this.cfg.report.range));
    if (!body) return;
    this.startMeeting(id, body.victim);
  }

  // The big red button on the hub table.
  emergency(id: string) {
    const p = this.players.get(id);
    const at = map.data.emergency;
    if (this.phase !== "playing" || !p?.alive || p.emergencies <= 0 || Math.hypot(p.x - at.x, p.y - at.y) > this.cfg.emergency.range) return; // the table itself blocks sight: distance only
    p.emergencies--;
    this.fx("banner", undefined, "🚨 Emergency meeting!");
    this.startMeeting(id, "", "emergency");
  }

  // Starts the mini-game at an assigned, unfinished station in range. Moving cancels it.
  task(id: string) {
    const p = this.players.get(id);
    if (this.phase !== "playing" || !p || p.working) return;
    const st = map.data.stations.find(
      (s) => p.tasks.some((t) => t.station === s.id && !t.done) && map.reachable(p.x, p.y, s.x, s.y, this.cfg.tasks.range),
    );
    if (st) p.working = { station: st.id, seconds: 0 };
  }

  private updateWork(p: Player, dt: number, moved: boolean) {
    if (!p.working) return;
    const st = map.data.stations.find((s) => s.id === p.working!.station)!;
    if (moved || !map.reachable(p.x, p.y, st.x, st.y, this.cfg.tasks.range)) {
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
    this.meeting = new Meeting(reporter, body, Date.now(), kind, this.cfg.meeting);
    this.lightsOutUntil = 0;
    for (const q of this.players.values()) {
      q.input = { dx: 0, dy: 0 };
      q.vel = { x: 0, y: 0 };
      q.working = undefined;
      q.offer = undefined;
      q.danceUntil = q.djUntil = q.slipUntil = 0;
      q.disguise = undefined;
      q.warp = undefined;
      q.tether = undefined;
    }
    // Meeting place: the living sit around the Nexus table, one fixed seat each (the dead leave an empty seat).
    const all = [...this.players.values()];
    all.forEach((q, i) => {
      if (q.alive) ({ x: q.x, y: q.y } = map.spawnPoint(i, all.length));
    });
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
        for (const id of shuffle(ids.filter((id) => id !== offer[0])).slice(0, this.cfg.roles.choices - 1)) offer.push(id);
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
    this.untie(p);
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

  // Banners go to everyone; an effect at a position only reaches those who could see that spot
  // (vision rules + roughly one screen away), so it never leaks a killer's whereabouts or role.
  private fx(kind: string, at?: { x: number; y: number }, text?: string) {
    const msg: ServerMsg = { t: "fx", kind, text, x: at && Math.round(at.x), y: at && Math.round(at.y) };
    const now = Date.now();
    for (const q of this.players.values()) {
      if (at && (Math.hypot(at.x - q.x, at.y - q.y) > this.cfg.fx.range || !this.canSee(q, at, now))) continue;
      send(q.socket, msg);
    }
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
      tie: (a, b, rope, until) => {
        this.untie(a as Player);
        this.untie(b as Player);
        (a as Player).tether = { with: b.id, rope, until };
        (b as Player).tether = { with: a.id, rope, until };
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
    p.nextChatAt = now + this.cfg.chat.minInterval * 1000;

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

    // Back to the game from the seats: bodies removed, cooldowns restarted.
    this.meeting = undefined;
    this.bodies = [];
    this.items = [];
    this.phase = "playing";
    this.roundStartMs = this.playMs; // every meeting starts a new round
    // Jester: getting voted out was the plan all along.
    if (ejected && ejected.roleId === "jester") return this.end("jester");
    for (const p of this.players.values()) {
      p.input = { dx: 0, dy: 0 };
      p.nextKillAt = now + this.cfg.kill.cooldown * 1000;
    }
    this.checkVictory();
  }

  kill(id: string) {
    const killer = this.players.get(id);
    const now = Date.now();
    if (this.phase !== "playing" || !killer || !killer.alive || killer.role !== "killer" || now < killer.nextKillAt) return;

    // The server picks the target: alive, not a killer, closest within range.
    // Zone rule: someone floating on the Moon is harder to grab (shorter range).
    let target: Player | undefined;
    let best = Infinity;
    for (const p of this.players.values()) {
      if (!p.alive || p.role === "killer") continue;
      const d = Math.hypot(p.x - killer.x, p.y - killer.y);
      const range = this.cfg.kill.range * (map.ruleAt(p.x, p.y)?.killRange ?? 1);
      if (d <= range && d < best && !map.blocked(killer.x, killer.y, p.x, p.y)) {
        best = d;
        target = p;
      }
    }
    if (!target) return;

    // Zone rule: a killer on ice can slip and miss.
    if (Math.random() < (map.ruleAt(killer.x, killer.y)?.killMiss ?? 0)) {
      killer.nextKillAt = now + this.cfg.kill.missCooldown * 1000;
      this.fx("whiff", killer);
      return;
    }

    killer.nextKillAt = now + this.cfg.kill.cooldown * 1000;
    if (target.shieldUntil > now) {
      // Medic bubble: the kill is wasted, everyone nearby sees it pop.
      target.shieldUntil = 0;
      this.fx("pop", target);
      return;
    }
    // Cop rope: the other tied player saw it (the killer's current look, so a Shapeshifter frames someone).
    const witness = target.tether && this.players.get(target.tether.with);
    this.killPlayer(target);
    if (witness && witness.alive && witness !== killer) {
      send(witness.socket, { t: "fx", kind: "witness", text: `👁️ You saw ${killer.disguise?.name ?? killer.name} kill ${target.name}!` });
    }
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
        p.vel = { x: 0, y: 0 };
        this.updateWork(p, dt, false); // DJ: dancing on the spot (tasks still progress)
        continue;
      }
      const moving = isMoving(p, now);
      this.updateWork(p, dt, moving);
      move(p, dt, now);
      if (this.phase === "playing") this.updateWarp(p, dt, now, moving || Math.hypot(p.vel.x, p.vel.y) > 20);
      if (p.alive && now >= p.slipUntil && this.phase === "playing") this.checkBanana(p, now);
    }
    if (this.phase === "playing") this.updateTethers(now);

    const sight = this.sight;
    for (const viewer of this.players.values()) {
      send(viewer.socket, {
        t: "snapshot",
        time: now,
        phase: this.phase,
        host: this.host,
        you: youFor(sight, viewer, now),
        players: viewFor(sight, viewer, now),
        bodies: this.phase === "lobby" ? [] : this.bodies.filter((b) => canSee(sight, viewer, b, now)).map(({ fake: _, ...b }) => b),
        items: this.items.filter((it) => canSee(sight, viewer, it, now)).map(({ owner: _o, armedAt: _a, ...it }) => it),
        meeting: this.meeting?.viewFor(viewer.id, now, (id) => this.players.get(id)?.role),
        clock: this.phase === "playing" || this.phase === "meeting" ? this.clock() : undefined,
        taskBar: this.phase === "lobby" || this.taskTotal <= 0 ? undefined : Math.min(1, this.taskDone / this.taskTotal),
        winner: this.winner,
        settings: this.phase === "lobby" || this.phase === "ended" ? this.settings : undefined,
      });
    }
  }

  // Portals: stand still on one for `portal.channel` s to warp to its pair (still sliding on ice = moving).
  private updateWarp(p: Player, dt: number, now: number, moving: boolean) {
    const portal = !moving && !p.tether && now >= p.nextWarpAt ? map.portalAt(p.x, p.y, this.cfg.portal.radius) : undefined;
    if (!portal) return void (p.warp = undefined);
    if (p.warp?.portal !== portal.id) p.warp = { portal: portal.id, seconds: 0 };
    p.warp.seconds += dt;
    if (p.warp.seconds < this.cfg.portal.channel) return;
    p.warp = undefined;
    const exit = map.data.portals?.find((q) => q.id === portal.pair);
    if (!exit) return;
    p.nextWarpAt = now + this.cfg.portal.cooldown * 1000;
    p.working = undefined;
    if (p.alive) this.fx("warp", p); // ghosts warp silently
    ({ x: p.x, y: p.y } = exit);
    p.vel = { x: 0, y: 0 };
    if (p.alive) this.fx("warp", p);
  }

  // Cop rope: tied players can't get more than `rope` apart, each pulls the other.
  private updateTethers(now: number) {
    for (const p of this.players.values()) {
      const q = p.tether && this.players.get(p.tether.with);
      if (!p.tether) continue;
      if (!q || !p.alive || !q.alive || now >= p.tether.until) {
        this.untie(p);
        continue;
      }
      if (p.id > q.id) continue; // once per pair
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      // Teleported or swapped far apart: the rope snaps.
      if (d > p.tether.rope * 3) {
        this.untie(p);
        continue;
      }
      if (d <= p.tether.rope) continue;
      const pull = (d - p.tether.rope) / 2 / d;
      const dx = (q.x - p.x) * pull;
      const dy = (q.y - p.y) * pull;
      ({ x: p.x, y: p.y } = map.collide(p.x + dx, p.y + dy, this.cfg.player.radius));
      ({ x: q.x, y: q.y } = map.collide(q.x - dx, q.y - dy, this.cfg.player.radius));
    }
  }

  private untie(p: Player) {
    const q = p.tether && this.players.get(p.tether.with);
    if (q?.tether?.with === p.id) q.tether = undefined;
    p.tether = undefined;
  }

  // Game clock: a round ends in a meeting, the clock running out = killers win.
  private updateClock(dt: number) {
    this.playMs += dt * 1000;
    if (this.playMs >= this.cfg.time.total * 1000) {
      this.fx("banner", undefined, "⏰ Time's up!");
      return this.end("killer");
    }
    if (this.playMs - this.roundStartMs >= this.cfg.time.round * 1000) {
      this.fx("banner", undefined, "⏰ Round over: time to vote!");
      this.startMeeting("", "", "round");
    }
  }

  private clock() {
    const total = this.cfg.time.total * 1000 - this.playMs;
    const round = Math.min(total, this.cfg.time.round * 1000 - (this.playMs - this.roundStartMs));
    return { round: Math.max(0, Math.ceil(round / 1000)), total: Math.max(0, Math.ceil(total / 1000)) };
  }

  private checkBanana(p: Player, now: number) {
    const hit = this.items.find((it) => it.kind === "banana" && now >= it.armedAt && Math.hypot(it.x - p.x, it.y - p.y) < this.cfg.player.radius + 12);
    if (!hit) return;
    this.items = this.items.filter((it) => it !== hit);
    const moving = Math.hypot(p.input.dx, p.input.dy) > 0.1;
    const a = Math.random() * Math.PI * 2;
    p.slipDir = moving ? { ...p.input } : { dx: Math.cos(a), dy: Math.sin(a) };
    p.slipUntil = now + (roleDefs.get("prankster")?.params.slipDuration ?? 1.2) * 1000;
    this.fx("slip", p);
  }

  // What the visibility rules need (visibility.ts).
  private get sight(): Sight {
    return { phase: this.phase, players: this.players, lightsOutUntil: this.lightsOutUntil, vision: this.vision, choiceUntil: this.choiceUntil };
  }

  private canSee(viewer: Player, at: { x: number; y: number }, now: number) {
    return canSee(this.sight, viewer, at, now);
  }
}
