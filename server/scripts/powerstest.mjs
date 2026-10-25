// Special roles test with 7 bots over several games. Requires the server: npm run dev:server
// Roles are random, so each game checks whatever was dealt. Takes ~40 s.
import WebSocket from "ws";
import powers from "../../data/powers.json" with { type: "json" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, label) => {
  console.log(`${cond ? "OK  " : "FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
};
setTimeout(() => (console.log("FAIL timeout"), process.exit(1)), 120_000);
const def = (id) => powers.roles.find((r) => r.id === id);

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

const seen = new Set();
// One fresh room per game (a game can only restart once it has ended).
for (let game = 1; game <= 3; game++) {
  const bots = ["A", "B", "C", "D", "E", "F", "G"].map(bot);
  await Promise.all(bots.map((b) => b.open));
  bots[0].send({ t: "create", name: "A" });
  await sleep(200);
  for (const b of bots.slice(1)) b.send({ t: "join", code: bots[0].code, name: b.name });
  await sleep(300);
  bots[0].send({ t: "start" });
  await sleep(300);
  check(bots[0].snap.phase === "playing", `game ${game} started`);

  for (const b of bots) {
    const pw = b.snap.you.power;
    const d = def(pw?.id);
    seen.add(pw?.id);
    check(!!d && d.team === b.snap.you.role, `${b.name} is ${d?.name} (${b.snap.you.role})`);
    check(b.snap.players.every((p) => p.id === b.id || p.roleId === undefined), `${b.name} sees no one else's special role`);
  }
  const innocentIds = bots.filter((b) => b.snap.you.role !== "killer").map((b) => b.snap.you.power.id);
  check(new Set(innocentIds).size === innocentIds.length, "no duplicate innocent/neutral roles");
  const killerIds = bots.filter((b) => b.snap.you.role === "killer").map((b) => `"${b.snap.you.power.id}"`);
  const innocentSnap = JSON.stringify(bots.find((b) => b.snap.you.role === "innocent").snap);
  check(!killerIds.some((id) => innocentSnap.includes(id)), "killer powers absent from an innocent's snapshot");

  // Powers are refused during their initial cooldown.
  const dj = bots.find((b) => b.snap.you.power.id === "dj");
  if (dj) {
    dj.send({ t: "power" });
    await sleep(150);
    check(!bots.some((b) => b.snap.players.some((p) => p.status?.includes("dance"))), "DJ refused during initial cooldown");
    await sleep(dj.snap.you.power.cooldown * 1000 + 200);
    dj.send({ t: "power" });
    await sleep(150);
    const other = bots.find((b) => b !== dj);
    check(other.snap.players.find((p) => p.id === other.id).status?.includes("dance"), "DJ: others dance");
    check(!dj.snap.players.find((p) => p.id === dj.id).status?.includes("dance"), "DJ: the DJ doesn't dance");
    check(dj.snap.you.power.cooldown >= def("dj").cooldown - 1, "DJ: cooldown restarted");
  }

  const prank = bots.find((b) => b.snap.you.power.id === "prankster");
  if (prank) {
    await sleep(prank.snap.you.power.cooldown * 1000 + 200);
    prank.send({ t: "power" });
    await sleep(150);
    check(bots.every((b) => b.snap.items.length === 1 && b.snap.items[0].kind === "banana"), "Prankster: banana visible to all");
  }

  // Cop: everyone starts around the table, so the 2 closest get tied; the rope shows to all.
  const cop = bots.find((b) => b.snap.you.power.id === "cop");
  if (cop) {
    await sleep(cop.snap.you.power.cooldown * 1000 + 200);
    cop.send({ t: "power" });
    await sleep(150);
    const tied = bots[0].snap.players.filter((p) => p.tether);
    check(tied.length === 2 && tied[0].tether === tied[1].id && tied[1].tether === tied[0].id, "Cop: 2 players tied to each other");
    check(!tied.some((p) => p.id === cop.id), "Cop: the cop isn't tied");
    check(tied.every((p) => p.status?.includes("tied")), "Cop: tied badge");
  }

  // Chaos: everyone spams their power for a few seconds. The server must survive whatever happens.
  await sleep(6000);
  for (let i = 0; i < 20; i++) {
    for (const b of bots) b.send({ t: "power" });
    await sleep(100);
  }
  await sleep(4000);
  check(bots.every((b) => b.snap && Date.now() - b.snap.time < 1000), "server still ticking after the chaos");
  const ended = bots[0].snap.phase === "ended";
  if (ended) check(bots[0].snap.players.every((p) => p.roleId), `game ended (${bots[0].snap.winner}): every role revealed`);
  console.log(`... game ${game}: ${bots[0].snap.phase}, fx seen: ${[...new Set(bots[0].fx.map((f) => f.kind))].join(", ")}`);
  for (const b of bots) b.ws.close();
}
console.log(`roles seen: ${[...seen].join(", ")}`);
process.exit();
