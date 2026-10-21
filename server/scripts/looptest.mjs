// Game loop test: role choice, clock, tasks + quest bar, emergency button. Requires the server: npm run dev:server
// Takes ~20 s. Tasks are random, so it retries in a new room until an innocent has the "fish" station.
import WebSocket from "ws";
import mapData from "../../data/map.json" with { type: "json" };
import config from "../../data/game.json" with { type: "json" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, label) => {
  console.log(`${cond ? "OK  " : "FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
};
setTimeout(() => (console.log("FAIL timeout"), process.exit(1)), 120_000);

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
const me = (b) => b.snap.players.find((p) => p.id === b.id);

async function walk(b, x, y, close = 12) {
  for (let i = 0; i < 120; i++) {
    const p = me(b);
    const dx = x - p.x;
    const dy = y - p.y;
    if (Math.hypot(dx, dy) < close) break;
    b.send({ t: "input", dx, dy });
    await sleep(50);
  }
  b.send({ t: "input", dx: 0, dy: 0 });
  await sleep(150);
}

async function newGame() {
  const bots = ["A", "B", "C", "D"].map(bot);
  await Promise.all(bots.map((b) => b.open));
  bots[0].send({ t: "create", name: "A" });
  await sleep(200);
  for (const b of bots.slice(1)) b.send({ t: "join", code: bots[0].code, name: b.name });
  await sleep(300);
  bots[0].send({ t: "start" });
  await sleep(300);
  return bots;
}

let bots;
let worker;
for (let tries = 0; tries < 8 && !worker; tries++) {
  bots?.forEach((b) => b.ws.close());
  bots = await newGame();
  worker = bots.find((b) => b.snap.you.role === "innocent" && b.snap.you.tasks.some((t) => t.station === "fish"));
}
check(!!worker, "found an innocent with the fish task");
const s = bots[0].snap;

// Role choice
const chooser = bots.find((b) => b.snap.you.offer?.length === 2);
check(bots.every((b) => b.snap.you.role === "neutral" || b.snap.you.offer?.length === 2), "innocents and killers are offered 2 roles");
check(chooser.snap.you.power.id === chooser.snap.you.offer[0], "default role = first offer");
const second = chooser.snap.you.offer[1];
chooser.send({ t: "pick", role: second });
await sleep(150);
check(chooser.snap.you.power.id === second, `picked the second role (${second})`);
chooser.send({ t: "pick", role: "dj" });
await sleep(150);
check(chooser.snap.you.power.id === second && !chooser.snap.you.offer, "only one pick, then the choice closes");

// Clock and tasks
check(s.clock.round <= config.time.round && s.clock.round >= config.time.round - 2, `round clock running (${s.clock.round}s)`);
check(s.clock.total >= config.time.total - 2, `game clock running (${s.clock.total}s)`);
check(s.taskBar === 0, "quest bar starts empty");
check(bots.every((b) => b.snap.you.tasks.length === config.tasks.perPlayer), `${config.tasks.perPlayer} tasks each`);

const fish = mapData.stations.find((st) => st.id === "fish");
worker.send({ t: "task" });
await sleep(150);
check(!worker.snap.you.working, "task refused far from the station");

// Through the hub's top-right door, then to the fishing hole.
await walk(worker, 1120, 640);
await walk(worker, 1120, 470);
await walk(worker, fish.x, fish.y);
worker.send({ t: "task" });
await sleep(1200);
check(worker.snap.you.working?.progress > 0.1, `working (${Math.round((worker.snap.you.working?.progress ?? 0) * 100)}%)`);
worker.send({ t: "input", dx: 1, dy: 0 });
await sleep(150);
worker.send({ t: "input", dx: 0, dy: 0 });
await sleep(100);
check(!worker.snap.you.working, "moving cancels the task");
await walk(worker, fish.x, fish.y);
worker.send({ t: "task" });
await sleep(config.tasks.duration * 1000 + 400);
check(worker.snap.you.tasks.find((t) => t.station === "fish").done, "task done after holding still");
const innocents = bots.filter((b) => b.snap.you.role === "innocent").length;
const expected = 1 / (innocents * config.tasks.perPlayer);
check(Math.abs(bots[0].snap.taskBar - expected) < 0.001, `quest bar moved for everyone (${bots[0].snap.taskBar.toFixed(3)})`);

// Emergency button
const caller = bots.find((b) => b !== worker && b.snap.you.alive);
await walk(caller, mapData.emergency.x, mapData.emergency.y, 90);
caller.send({ t: "emergency" });
await sleep(200);
check(bots[0].snap.phase === "meeting" && bots[0].snap.meeting.kind === "emergency", "red button calls an emergency meeting");
check(caller.snap.you.emergencies === config.emergency.perPlayer - 1, "one press used");
const frozen = bots[0].snap.clock.round;
await sleep(1500);
check(bots[0].snap.clock.round === frozen, "clock paused during the meeting");

bots.forEach((b) => b.ws.close());
process.exit();
