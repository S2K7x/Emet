// Movement physics: zone rules (speed, inertia on Moon/Ice), banana slips, wall collision.
import config from "../../data/game.json" with { type: "json" };
import mapData from "../../data/map.json" with { type: "json" };
import { MapGeometry, type MapData } from "../../shared/map.ts";
import type { Player } from "./player.ts";
import { roleDefs } from "./powers.ts";

export const map = new MapGeometry(mapData as MapData);

const slipping = (p: Player, now: number) => p.alive && now < p.slipUntil;
const direction = (p: Player, now: number) => (slipping(p, now) ? p.slipDir : p.input);

// Moving (or sliding) this tick: interrupts tasks.
export function isMoving(p: Player, now: number) {
  const dir = direction(p, now);
  return slipping(p, now) || Math.hypot(dir.dx, dir.dy) > 0.05;
}

export function move(p: Player, dt: number, now: number) {
  const slip = slipping(p, now);
  const dir = direction(p, now);
  // Zone rule: speed multiplier, and inertia (velocity eases toward the input) on Moon/Ice.
  const rule = map.ruleAt(p.x, p.y);
  const v = config.player.speed * (rule?.speed ?? 1) * (slip ? (roleDefs.get("prankster")?.params.slipSpeed ?? 1.8) : 1);
  const target = { x: dir.dx * v, y: dir.dy * v };
  if (slip || !rule?.friction) p.vel = target;
  else {
    const k = Math.min(1, rule.friction * dt);
    p.vel = { x: p.vel.x + (target.x - p.vel.x) * k, y: p.vel.y + (target.y - p.vel.y) * k };
  }
  const before = { x: p.x, y: p.y };
  ({ x: p.x, y: p.y } = map.collide(p.x + p.vel.x * dt, p.y + p.vel.y * dt, config.player.radius));
  // Walls absorb the momentum (no sliding forever into a wall).
  if (dt > 0) p.vel = { x: (p.x - before.x) / dt, y: (p.y - before.y) / dt };
}
