import type { Look, Role } from "../../shared/protocol.ts";
import powers from "../../data/powers.json" with { type: "json" };

// Special roles (data/powers.json). Numbers live in the JSON; each role's behavior is one handler here.
export interface RoleDef {
  id: string;
  team: Role;
  name: string;
  icon: string;
  power: string;
  button: string;
  uses: number; // -1 = unlimited, 0 = passive
  cooldown: number;
  initialCooldown?: number;
  enabled: boolean;
  params: Record<string, number>;
}

export const roleDefs = new Map((powers.roles as unknown as RoleDef[]).map((r) => [r.id, r]));
export const assignment = powers.assignment;

export function pool(team: Role) {
  return [...roleDefs.values()].filter((r) => r.enabled && r.team === team);
}

// What a handler can see and do to a player.
export interface PowerPlayer {
  id: string;
  name: string;
  color: string;
  look: Look;
  x: number;
  y: number;
  role: Role;
  roleId?: string;
  alive: boolean;
  danceUntil: number;
  djUntil: number;
  shieldUntil: number;
  disguise?: { name: string; color: string; look: Look; until: number };
  eaten: number;
}

export interface PowerBody {
  id: string;
  victim: string;
  x: number;
  y: number;
  fake?: boolean;
}

// The room services a power needs. Implemented by Room.
export interface PowerWorld {
  now: number;
  alive(): PowerPlayer[];
  player(id: string): PowerPlayer | undefined;
  closest(p: PowerPlayer, range: number, filter: (q: PowerPlayer) => boolean): PowerPlayer | undefined;
  bodyNear(p: PowerPlayer, range: number): PowerBody | undefined;
  removeBody(id: string): void;
  addDecoy(p: PowerPlayer, of: PowerPlayer): void;
  dropBanana(p: PowerPlayer, max: number, armDelay: number): void;
  killPlayer(p: PowerPlayer): void;
  revive(victimId: string): boolean;
  reviveRandom(): PowerPlayer | undefined;
  canRevive(victimId: string): boolean;
  emergency(caller: PowerPlayer): void;
  lightsOut(until: number, vision: number): void;
  tie(a: PowerPlayer, b: PowerPlayer, rope: number, until: number): void;
  later(seconds: number, fn: () => void): void;
  fx(kind: string, at?: { x: number; y: number }, text?: string): void;
  win(winner: string): void;
}

type Handler = (w: PowerWorld, p: PowerPlayer, params: Record<string, number>) => boolean;

const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

function swapPositions(w: PowerWorld, a: PowerPlayer, b: PowerPlayer) {
  [a.x, b.x] = [b.x, a.x];
  [a.y, b.y] = [b.y, a.y];
  w.fx("poof", a);
  w.fx("poof", b);
}

// Returns true if the power fired (a use and the cooldown are spent).
export const handlers: Record<string, Handler> = {
  dj(w, p, { duration }) {
    const until = w.now + duration * 1000;
    for (const q of w.alive()) if (q !== p) q.danceUntil = until;
    p.djUntil = until;
    w.fx("banner", undefined, "🎶 DANCE BREAK! 🎶");
    return true;
  },

  teleporter(w) {
    const alive = w.alive();
    if (alive.length < 2) return false;
    const a = pick(alive);
    const b = pick(alive.filter((q) => q !== a));
    swapPositions(w, a, b);
    return true;
  },

  medic(w, p, { range, duration }) {
    const target = w.closest(p, range, (q) => q !== p);
    if (!target) return false;
    target.shieldUntil = w.now + duration * 1000;
    w.fx("shield", target);
    return true;
  },

  cop(w, p, { range, rope, duration }) {
    const a = w.closest(p, range, (q) => q !== p);
    const b = a && w.closest(p, range, (q) => q !== p && q !== a);
    if (!a || !b) return false;
    w.tie(a, b, rope, w.now + duration * 1000);
    w.fx("cuff", a);
    w.fx("cuff", b);
    return true;
  },

  prankster(w, p, { maxActive, armDelay }) {
    w.dropBanana(p, maxActive, armDelay);
    return true;
  },

  gambler(w, _p, { spinDelay }) {
    w.fx("banner", undefined, "🎰 The wheel is spinning…");
    w.later(spinDelay, () => {
      const alive = w.alive();
      if (alive.length === 0) return;
      const victim = pick(alive);
      w.killPlayer(victim);
      w.fx("zap", victim);
      // Could bring back the one it just zapped. That's the gamble.
      w.later(1, () => {
        const back = w.reviveRandom();
        if (back) w.fx("revive", back);
      });
    });
    return true;
  },

  sacrifice(w, p, { range }) {
    const body = w.bodyNear(p, range);
    if (!body) return false;
    if (body.fake) {
      // It was a balloon. You still die, for nothing.
      w.removeBody(body.id);
      w.killPlayer(p);
      w.fx("pop", body);
      return true;
    }
    if (!w.canRevive(body.victim)) return false;
    w.revive(body.victim); // before dying, so the swap never counts as a parity win
    w.killPlayer(p);
    return true;
  },

  canadian: () => false, // passive, see Room.killPlayer

  jester(w, p) {
    w.emergency(p);
    return true;
  },

  vulture(w, p, { range, goal }) {
    const body = w.bodyNear(p, range);
    if (!body) return false;
    w.removeBody(body.id);
    if (body.fake) {
      w.fx("pop", body);
      return true;
    }
    p.eaten++;
    w.fx("chomp", body);
    if (p.eaten >= goal) w.win(p.roleId!);
    return true;
  },

  lightsout(w, _p, { duration, vision }) {
    w.lightsOut(w.now + duration * 1000, vision);
    w.fx("banner", undefined, "🌑 Lights out!");
    return true;
  },

  disguise(w, p, { duration }) {
    const others = w.alive().filter((q) => q !== p);
    if (others.length === 0) return false;
    const as = pick(others);
    p.disguise = { name: as.name, color: as.color, look: as.look, until: w.now + duration * 1000 };
    w.fx("poof", p);
    return true;
  },

  swap(w, p) {
    const targets = w.alive().filter((q) => q.role !== "killer");
    if (targets.length === 0) return false;
    swapPositions(w, p, pick(targets));
    return true;
  },

  decoy(w, p) {
    const others = w.alive().filter((q) => q !== p);
    if (others.length === 0) return false;
    w.addDecoy(p, pick(others));
    return true;
  },
};
