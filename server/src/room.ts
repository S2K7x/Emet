import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { BodyView, ChatLine, Look, Phase, PlayerView, Role, ServerMsg, YouView } from "../../shared/protocol.ts";
import config from "../../data/game.json" with { type: "json" };
import quickchat from "../../data/quickchat.json" with { type: "json" };
import mapData from "../../data/map.json" with { type: "json" };
import skins from "../../data/skins.json" with { type: "json" };
import { MapGeometry, type MapData } from "../../shared/map.ts";
import { Meeting } from "./meeting.ts";

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
  alive: boolean;
  nextKillAt: number; // timestamp ms
  nextChatAt: number;
}

export class Room {
  readonly players = new Map<string, Player>();
  private bodies: BodyView[] = [];
  private phase: Phase = "lobby";
  private host = "";
  private winner?: Role;
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
      nextKillAt: 0,
      nextChatAt: 0,
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
    this.players.delete(id);
    if (this.players.size === 0) {
      clearInterval(this.timer);
      this.onEmpty();
      return;
    }
    if (this.host === id) this.host = this.players.keys().next().value!;
    this.meeting?.forget(id);
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
      p.nextKillAt = now + config.kill.initialCooldown * 1000;
    });
    this.bodies = [];
    this.winner = undefined;
    this.meeting = undefined;
    this.phase = "playing";
  }

  report(id: string) {
    const p = this.players.get(id);
    if (this.phase !== "playing" || !p?.alive) return;
    const body = this.bodies.find((b) => map.reachable(p.x, p.y, b.x, b.y, config.report.range));
    if (!body) return;
    this.phase = "meeting";
    this.meeting = new Meeting(id, body.id, Date.now());
    for (const q of this.players.values()) q.input = { dx: 0, dy: 0 };
  }

  chat(id: string, phrase: number, target?: string) {
    const p = this.players.get(id);
    const now = Date.now();
    if (this.phase !== "meeting" || !p || now < p.nextChatAt) return;
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
    }
    if (!done) return;

    // Back to the game: bodies removed, everyone to the center, cooldowns restarted.
    this.meeting = undefined;
    this.bodies = [];
    this.phase = "playing";
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

    target.alive = false;
    this.bodies.push({ id: target.id, color: target.color, look: target.look, x: Math.round(target.x), y: Math.round(target.y) });
    killer.nextKillAt = now + config.kill.cooldown * 1000;
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

  private end(winner: Role) {
    this.phase = "ended";
    this.winner = winner;
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

    for (const p of this.players.values()) {
      if (this.phase === "meeting") break; // nobody moves during a meeting
      ({ x: p.x, y: p.y } = map.collide(p.x + p.input.dx * speed * dt, p.y + p.input.dy * speed * dt, radius));
    }

    for (const viewer of this.players.values()) {
      send(viewer.socket, {
        t: "snapshot",
        time: now,
        phase: this.phase,
        host: this.host,
        you: this.youFor(viewer, now),
        players: this.viewFor(viewer),
        bodies: this.phase === "lobby" ? [] : this.bodies,
        meeting: this.meeting?.viewFor(viewer.id, now, (id) => this.players.get(id)?.role),
        winner: this.winner,
      });
    }
  }

  private youFor(p: Player, now: number): YouView {
    if (this.phase === "lobby") return { alive: true };
    return {
      role: p.role,
      alive: p.alive,
      killCooldown: p.role === "killer" ? Math.max(0, Math.ceil((p.nextKillAt - now) / 1000)) : undefined,
    };
  }

  // Snapshot built per player: it only contains what they're allowed to know.
  private viewFor(viewer: Player): PlayerView[] {
    const views: PlayerView[] = [];
    for (const p of this.players.values()) {
      // Ghosts are only visible to other ghosts (and to everyone at game end).
      if (!p.alive && viewer.alive && (this.phase === "playing" || this.phase === "meeting")) continue;
      views.push({
        id: p.id,
        name: p.name,
        color: p.color,
        look: p.look,
        x: Math.round(p.x),
        y: Math.round(p.y),
        alive: p.alive,
        away: p.awayUntil ? true : undefined,
        role: this.roleVisibleTo(viewer, p),
      });
    }
    return views;
  }

  private roleVisibleTo(viewer: Player, p: Player): Role | undefined {
    if (this.phase === "lobby") return undefined;
    if (this.phase === "ended" || viewer.id === p.id) return p.role;
    if (config.killers.knowEachOther && viewer.role === "killer" && p.role === "killer") return "killer";
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
