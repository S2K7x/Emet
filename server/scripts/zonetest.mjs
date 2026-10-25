// Zone rules test: sugar rush speed, ice/moon inertia, dark zone vision. Requires the server: npm run dev:server
// Takes ~50 s.
import WebSocket from "ws";
import mapData from "../../data/map.json" with { type: "json" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, label) => {
  console.log(`${cond ? "OK  " : "FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
};
setTimeout(() => (console.log("FAIL timeout"), process.exit(1)), 90_000);
const rule = (id) => mapData.zones.find((z) => z.id === id).rule;

function bot(name) {
  const ws = new WebSocket(process.env.SERVER_URL ?? "ws://localhost:2567");
  const b = { name, ws, snap: null, id: null, code: null, send: (m) => ws.send(JSON.stringify(m)) };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.t === "joined") Object.assign(b, { id: m.you, code: m.code });
    if (m.t === "snapshot") b.snap = m;
  });
  b.open = new Promise((r) => ws.on("open", r));
  return b;
}
const until = async (cond) => {
  for (let i = 0; i < 100 && !cond(); i++) await sleep(100);
};
const me = (b) => b.snap.players.find((p) => p.id === b.id);

// Steer toward the target and brake against the slide (Ice, Moon keep you sliding), or we'd orbit it.
async function walk(b, x, y) {
  let last = { ...me(b) };
  let lastAt = Date.now();
  for (let i = 0; i < 150; i++) {
    const p = me(b);
    const now = Date.now();
    const dt = Math.max(0.001, (now - lastAt) / 1000);
    const vx = (p.x - last.x) / dt;
    const vy = (p.y - last.y) / dt;
    last = { ...p };
    lastAt = now;
    const dx = x - p.x;
    const dy = y - p.y;
    if (Math.hypot(dx, dy) < 10) break;
    b.send({ t: "input", dx: dx / 40 - vx / 250, dy: dy / 40 - vy / 250 });
    await sleep(50);
  }
  b.send({ t: "input", dx: 0, dy: 0 });
  await sleep(700); // let any inertia settle
}
async function path(b, points) {
  for (const [x, y] of points) await walk(b, x, y);
}
// Speed while holding a direction (px/s), measured over the middle of the run.
async function speedEast(b) {
  b.send({ t: "input", dx: 1, dy: 0 });
  await sleep(500);
  const a = { x: me(b).x, t: b.snap.time };
  await sleep(600);
  const c = { x: me(b).x, t: b.snap.time };
  b.send({ t: "input", dx: 0, dy: 0 });
  return ((c.x - a.x) / (c.t - a.t)) * 1000;
}
// Distance travelled after releasing the input.
async function slideAfterRelease(b) {
  b.send({ t: "input", dx: 1, dy: 0 });
  await sleep(1200);
  b.send({ t: "input", dx: 0, dy: 0 });
  await sleep(60); // the release reaches the server
  const x0 = me(b).x;
  await sleep(600);
  return me(b).x - x0;
}

const bots = ["A", "B", "C", "D"].map(bot);
await Promise.all(bots.map((b) => b.open));
bots[0].send({ t: "create", name: "A" });
await until(() => bots[0].code);
for (const b of bots.slice(1)) b.send({ t: "join", code: bots[0].code, name: b.name });
await until(() => bots[0].snap?.players.length === 4);
bots[0].send({ t: "start" });
await until(() => bots.every((b) => b.snap?.phase === "playing"));
const [a, c] = bots.filter((b) => b.snap.you.role !== "killer");
const killer = bots.find((b) => b.snap.you.role === "killer");

// Baseline in the hub (no rule), along the top of the hub.
await walk(a, 860, 600);
const base = await speedEast(a);
check(base > 180 && base < 260, `hub speed ≈ normal (${Math.round(base)} px/s)`);
const baseSlide = await slideAfterRelease(a);
check(baseSlide < 15, `hub: stops on release (${Math.round(baseSlide)} px)`);

// Candy: sugar rush. Bottom-right hub door, then east below the hub.
await path(a, [[1120, 800], [1120, 920], [1270, 900]]);
const candy = await speedEast(a);
check(Math.abs(candy / base - rule("candy").speed) < 0.12, `candy: x${(candy / base).toFixed(2)} speed (rule x${rule("candy").speed})`);

// Ice: keep sliding. Top-right hub door.
await path(a, [[1120, 920], [1120, 840], [1120, 600], [1120, 470]]);
const iceSlide = await slideAfterRelease(a);
check(iceSlide > 40, `ice: keeps sliding after release (${Math.round(iceSlide)} px)`);

// Moon: floaty. Top-left hub door.
await path(c, [[880, 600], [880, 480], [700, 600], [250, 600]]);
const moonSlide = await slideAfterRelease(c);
check(moonSlide > 10 && moonSlide < iceSlide, `moon: floaty, less than ice (${Math.round(moonSlide)} px)`);

// Neon: dark zone for innocents, not for killers. Bottom-left hub door.
await path(c, [[700, 600], [880, 480], [880, 800], [880, 960]]);
await sleep(200);
check(c.snap.you.blind === rule("neon").vision, `neon: innocent vision limited to ${c.snap.you.blind} px`);
const far = c.snap.players.filter((p) => p.id !== c.id);
const mePos = me(c);
check(far.every((p) => Math.hypot(p.x - mePos.x, p.y - mePos.y) <= rule("neon").vision), "neon: players out of range are not sent");
await path(killer, [[880, 800], [880, 960]]);
await sleep(200);
check(killer.snap.you.blind === undefined, "neon: killers see normally");
await walk(c, 880, 800);
await sleep(200);
check(c.snap.you.blind === undefined, "back in the hub: normal vision");

bots.forEach((b) => b.ws.close());
process.exit();
