// End-to-end killer test with 4 bots. Requires the server: npm run dev:server
// Takes ~35 s (real cooldowns from data/game.json).
import WebSocket from "ws";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, label) => {
  console.log(`${cond ? "OK  " : "FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
};
setTimeout(() => (console.log("FAIL timeout"), process.exit(1)), 90_000);

function bot(name) {
  const ws = new WebSocket(process.env.SERVER_URL ?? "ws://localhost:2567");
  const b = { name, ws, snap: null, id: null, code: null, send: (m) => ws.send(JSON.stringify(m)) };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.t === "joined") Object.assign(b, { id: m.you, code: m.code });
    if (m.t === "snapshot") b.snap = m;
    if (m.t === "error") b.error = m.message;
  });
  b.open = new Promise((r) => ws.on("open", r));
  return b;
}

const bots = ["A", "B", "C", "D"].map(bot);
await Promise.all(bots.map((b) => b.open));
bots[0].send({ t: "create", name: "A" });
await sleep(200);
for (const b of bots.slice(1)) b.send({ t: "join", code: bots[0].code, name: b.name });
await sleep(300);

bots[1].send({ t: "start" });
await sleep(200);
check(bots[0].snap.phase === "lobby", "only the host can start");
bots[0].send({ t: "start" });
await sleep(300);
check(bots[0].snap.phase === "playing", "game started");

const late = bot("E");
await late.open;
late.send({ t: "join", code: bots[0].code, name: "E" });
await sleep(200);
check(late.error === "Game already in progress", "no joining mid-game");
late.ws.close();

const killers = bots.filter((b) => b.snap.you.role === "killer");
check(killers.length === 1, "1 killer for 4 players");
for (const b of bots) {
  const others = b.snap.players.filter((p) => p.id !== b.id);
  check(others.every((p) => p.role === undefined), `${b.name} (${b.snap.you.role}) sees no one else's role`);
}
const innocentSnap = JSON.stringify(bots.find((b) => b.snap.you.role === "innocent").snap);
check(!innocentSnap.includes("killer"), "\"killer\" absent from an innocent's snapshot");

const k = killers[0];
// The Canadian's body reports itself (meeting): never kill them here (at most one per game).
const canadianLast = (b) => (b.snap.you.power?.id === "canadian" ? 1 : 0);
const innocents = bots.filter((b) => b !== k).sort((a, b) => canadianLast(a) - canadianLast(b));

async function goTo(victim) {
  for (let i = 0; i < 100; i++) {
    const me = k.snap.players.find((p) => p.id === k.id);
    const v = k.snap.players.find((p) => p.id === victim.id);
    const dx = v.x - me.x;
    const dy = v.y - me.y;
    if (Math.hypot(dx, dy) < 40) break;
    k.send({ t: "input", dx, dy });
    await sleep(50);
  }
  k.send({ t: "input", dx: 0, dy: 0 });
  await sleep(100);
}

await goTo(innocents[0]);
k.send({ t: "kill" });
await sleep(200);
check(innocents[0].snap.you.alive, "kill refused during the initial cooldown");

console.log(`... waiting for initial cooldown ${k.snap.you.killCooldown}s`);
await sleep(k.snap.you.killCooldown * 1000 + 300);
await goTo(innocents[0]);
k.send({ t: "kill" });
await sleep(200);
check(!innocents[0].snap.you.alive, "kill in range after cooldown");
check(k.snap.you.killCooldown >= 19, `cooldown restarted (${k.snap.you.killCooldown}s)`);
check(innocents[1].snap.bodies.length === 1, "the body is visible to the living");
check(!innocents[1].snap.players.some((p) => p.id === innocents[0].id), "the ghost is invisible to the living");
check(innocents[0].snap.players.length === 4, "the ghost sees everyone");
check(innocents[0].snap.players.every((p) => p.id === innocents[0].id || p.role === undefined), "the ghost doesn't see roles");

innocents[0].send({ t: "kill" });
innocents[1].send({ t: "kill" });
await sleep(150);
check(innocents[1].snap.you.alive && innocents[2].snap.you.alive, "an innocent or a ghost can't kill");

console.log(`... waiting for cooldown ${k.snap.you.killCooldown}s`);
await sleep(k.snap.you.killCooldown * 1000 + 300);
await goTo(innocents[1]);
k.send({ t: "kill" });
await sleep(200);
check(bots[0].snap.phase === "ended" && bots[0].snap.winner === "killer", "parity → killers win");
check(innocents[2].snap.players.find((p) => p.id === k.id).role === "killer", "roles revealed at game end");
process.exit();
