// What each player is allowed to see: vision radius, ghosts, roles, disguises.
// Snapshots are built per player from here, so nothing a client must not know ever leaves the server.
import config from "../../data/game.json" with { type: "json" };
import minigames from "../../data/minigames.json" with { type: "json" };
import type { Phase, PlayerView, Role, Status, YouView } from "../../shared/protocol.ts";
import { map } from "./movement.ts";
import type { Player } from "./player.ts";
import { roleDefs } from "./powers.ts";

export interface Sight {
  phase: Phase;
  players: Map<string, Player>;
  lightsOutUntil: number;
  vision: number;
  choiceUntil: number;
}

// Lights out, or standing in a dark zone: innocents and neutrals only see what's close to them.
export function visionOf(s: Sight, viewer: Player, now: number): number | undefined {
  if (s.phase !== "playing" || !viewer.alive || viewer.role === "killer") return undefined;
  const radii = [now < s.lightsOutUntil ? s.vision : Infinity, map.ruleAt(viewer.x, viewer.y)?.vision ?? Infinity];
  const r = Math.min(...radii);
  return r === Infinity ? undefined : r;
}

export function canSee(s: Sight, viewer: Player, at: { x: number; y: number }, now: number) {
  const r = visionOf(s, viewer, now);
  return r === undefined || Math.hypot(at.x - viewer.x, at.y - viewer.y) <= r;
}

export function youFor(s: Sight, p: Player, now: number): YouView {
  if (s.phase === "lobby") return { alive: true };
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
    blind: visionOf(s, p, now),
    tasks: p.tasks,
    working: p.working && { station: p.working.station, ready: p.working.seconds >= minigames.minSeconds },
    emergencies: p.emergencies,
    offer: p.offer && now < s.choiceUntil ? p.offer : undefined,
    offerLeft: p.offer && now < s.choiceUntil ? Math.ceil((s.choiceUntil - now) / 1000) : undefined,
  };
}

function statusOf(p: Player, now: number): Status[] | undefined {
  if (!p.alive) return undefined;
  const s: Status[] = [];
  if (now < p.danceUntil) s.push("dance");
  if (now < p.djUntil) s.push("dj");
  if (now < p.shieldUntil) s.push("shield");
  if (now < p.slipUntil) s.push("slip");
  if (p.warp) s.push("warp");
  return s.length ? s : undefined;
}

// Snapshot built per player: it only contains what they're allowed to know.
export function viewFor(s: Sight, viewer: Player, now: number): PlayerView[] {
  const views: PlayerView[] = [];
  for (const p of s.players.values()) {
    // Ghosts are only visible to other ghosts (and to everyone at game end).
    if (!p.alive && viewer.alive && (s.phase === "playing" || s.phase === "meeting")) continue;
    if (p !== viewer && !canSee(s, viewer, p, now)) continue;
    // Shapeshifter: everyone sees the borrowed look, except the killer team.
    const d = p.disguise && p !== viewer && roleVisibleTo(s, viewer, p) !== "killer" ? p.disguise : p;
    views.push({
      id: p.id,
      name: d.name,
      color: d.color,
      look: d.look,
      x: Math.round(p.x),
      y: Math.round(p.y),
      alive: p.alive,
      away: p.awayUntil ? true : undefined,
      role: roleVisibleTo(s, viewer, p),
      status: statusOf(p, now),
      roleId: s.phase === "ended" || p === viewer ? p.roleId : undefined,
    });
  }
  return views;
}

export function roleVisibleTo(s: Sight, viewer: Player, p: Player): Role | undefined {
  if (s.phase === "lobby") return undefined;
  if (s.phase === "ended" || viewer.id === p.id) return p.role;
  if (config.killers.knowEachOther && viewer.role === "killer" && p.role === "killer") return "killer";
  return undefined;
}
