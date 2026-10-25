// Portal test: warp to the pair after standing still, cooldown, no fx leak to far players. Requires the server: npm run dev:server
import WebSocket from "ws";
import config from "../../data/game.json" with { type: "json" };
import mapData from "../../data/map.json" with { type: "json" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, label) => {
  console.log(`${cond ? "OK  " : "FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
};
setTimeout(() => (console.log("FAIL timeout"), process.exit(1)), 90_000);

function bot(name) {
  const ws = new WebSocket(process.env.SERVER_URL ?? "ws://localhost:2567");
  const b = { name, ws, snap: null, id: null, code: null, fx: [], send: (m) => ws.send(JSON.stringify(m)) };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.t === "joined") Object.assign(b, { id: m.you, code: m.code });
    if (m.t === "snapshot") b.snap = m;
    if (m.t === "fx") b.fx.push(m);
  });
  b.open = new Promise((r) => ws.on("open", r));
  return b;
}
const until = async (cond) => {
  for (let i = 0; i < 100 && !cond(); i++) await sleep(100);
};
const me = (b) => b.snap.players.find((p) => p.id === b.id);

// Steer like a player would: slow down near the target and brake against the slide (Ice keeps you sliding).
async function walk(b, x, y, close = 12) {
  let last = { ...me(b) };
  let lastAt = Date.now();
  for (let i = 0; i < 300; i++) {
    await sleep(50);
    const p = me(b);
    const now = Date.now();
    const dt = Math.max(0.001, (now - lastAt) / 1000);
    const vx = (p.x - last.x) / dt;
    const vy = (p.y - last.y) / dt;
    last = { ...p };
    lastAt = now;
    const dx = x - p.x;
    const dy = y - p.y;
    if (Math.hypot(dx, dy) < close && Math.hypot(vx, vy) < 20) break;
    b.send({ t: "input", dx: dx / 120 - vx / 300, dy: dy / 120 - vy / 300 });
  }
  b.send({ t: "input", dx: 0, dy: 0 });
}

const bots = ["A", "B", "C", "D"].map(bot);
await Promise.all(bots.map((b) => b.open));
bots[0].send({ t: "create", name: "A" });
await until(() => bots[0].code);
for (const b of bots.slice(1)) b.send({ t: "join", code: bots[0].code, name: b.name });
await until(() => bots[0].snap?.players.length === bots.length);
bots[0].send({ t: "start" });
await until(() => bots.every((b) => b.snap?.phase === "playing"));

const ice = mapData.portals.find((p) => p.id === "ice");
const exit = mapData.portals.find((p) => p.id === ice.pair);
const [traveller, observer] = bots;

// The observer goes far from both portals (beyond fx.range), into the Moon zone.
for (const [x, y] of [[880, 640], [880, 470], [550, 300]]) await walk(observer, x, y, 30);
const far = (p) => Math.hypot(me(observer).x - p.x, me(observer).y - p.y) > config.fx.range;
check(far(ice) && far(exit), "observer out of fx range of both portals");
observer.fx = [];

// Through the hub's top-right door, then across the Ice zone to the portal.
for (const [x, y] of [[1120, 640], [1120, 470], [1450, 300], [ice.x, ice.y]]) await walk(traveller, x, y, x === ice.x ? 12 : 30);
const there = me(traveller);
if (Math.hypot(there.x - ice.x, there.y - ice.y) > config.portal.radius) console.log("  ended at", there.x, there.y);
await until(() => Math.hypot(me(traveller).x - exit.x, me(traveller).y - exit.y) < 5);
check(Math.hypot(me(traveller).x - exit.x, me(traveller).y - exit.y) < 5, `warped from ${ice.id} to ${exit.id}`);
check(traveller.fx.filter((f) => f.kind === "warp").length >= 1, "the traveller sees the warp effect");
check(!observer.fx.some((f) => f.kind === "warp"), "a far player doesn't get the warp effect (no leak)");
await sleep(config.portal.channel * 2000);
check(Math.hypot(me(traveller).x - exit.x, me(traveller).y - exit.y) < 5, "no warp back during the cooldown");

bots.forEach((b) => b.ws.close());
process.exit();
