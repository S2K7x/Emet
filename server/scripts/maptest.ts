// Checks the data/map.json map without a server: free spawns, all zones reachable, walls that block.
import mapData from "../../data/map.json" with { type: "json" };
import config from "../../data/game.json" with { type: "json" };
import { MapGeometry, type MapData } from "../../shared/map.ts";

const check = (cond: boolean, label: string) => {
  console.log(`${cond ? "OK  " : "FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
};

const map = new MapGeometry(mapData as MapData);
const r = config.player.radius;
const free = (x: number, y: number) => {
  const p = map.collide(x, y, r);
  return p.x === x && p.y === y;
};

// Spawns: free and spread out enough for the max player count.
const spots = Array.from({ length: config.maxPlayers }, (_, i) => map.spawnPoint(i, config.maxPlayers));
check(spots.every((s) => free(s.x, s.y)), `${spots.length} spawn points clear of obstacles`);
check(spots.every((a, i) => spots.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) >= r * 2)), "spawn points don't overlap");

// Reachability: flood fill from the spawn on a 10 px grid.
const STEP = 10;
const cols = Math.floor(map.data.width / STEP);
const rows = Math.floor(map.data.height / STEP);
const seen = new Uint8Array(cols * rows);
const queue: number[] = [];
const start = map.spawnPoint(0, 1);
const startCell = Math.round(start.y / STEP) * cols + Math.round(start.x / STEP);
seen[startCell] = 1;
queue.push(startCell);
while (queue.length) {
  const c = queue.pop()!;
  const cx = c % cols;
  const cy = Math.floor(c / cols);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const n = ny * cols + nx;
    if (!seen[n] && free(nx * STEP, ny * STEP)) {
      seen[n] = 1;
      queue.push(n);
    }
  }
}
for (const z of map.data.zones) {
  let reach = 0;
  let total = 0;
  for (let y = z.y; y < z.y + z.h; y += STEP)
    for (let x = z.x; x < z.x + z.w; x += STEP) {
      const c = Math.floor(y / STEP) * cols + Math.floor(x / STEP);
      if (free(x, y)) total++;
      if (seen[c]) reach++;
    }
  check(reach / total > 0.9, `zone ${z.label} reachable from the spawn (${Math.round((reach / total) * 100)} %)`);
}

// Portals: each one free, reachable, paired both ways, and away from task stations.
for (const p of map.data.portals ?? []) {
  const pair = map.data.portals!.find((q) => q.id === p.pair);
  check(!!pair && pair.pair === p.id, `portal ${p.id} paired both ways`);
  check(free(p.x, p.y) && !!seen[Math.round(p.y / STEP) * cols + Math.round(p.x / STEP)], `portal ${p.id} clear and reachable`);
  check(map.data.stations.every((st) => Math.hypot(st.x - p.x, st.y - p.y) > 150), `portal ${p.id} away from task stations`);
}

// A player running into a wall stops against it.
let p = { x: 900, y: 700 };
for (let i = 0; i < 60; i++) p = map.collide(p.x - 11, p.y, r);
check(p.x >= 800 + r - 0.01, "can't go through the Nexus left wall");

// Line of sight: blocked by a wall, clear in an empty room.
check(!map.blocked(880, 450, 880, 620), "clear view through the Moon → Nexus door");
check(map.blocked(960, 100, 1040, 100), "Moon/Ice wall blocks the view (no killing through it)");
check(!map.blocked(300, 450, 400, 450), "clear view in an empty room");
check(map.reachable(960, 260, 1040, 260, 90), "Moon/Ice door lets the view through");
