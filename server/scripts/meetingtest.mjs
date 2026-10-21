// End-to-end test: kill -> report -> meeting (chat, vote) -> killer ejected -> innocents win.
// Requires the server: npm run dev:server. Takes ~40 s (real durations from data/game.json).
import WebSocket from "ws";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, label) => {
  console.log(`${cond ? "OK  " : "FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
};
setTimeout(() => (console.log("FAIL timeout"), process.exit(1)), 120_000);

function bot(name) {
  const ws = new WebSocket(process.env.SERVER_URL ?? "ws://localhost:2567");
  const b = { name, ws, snap: null, id: null, code: null, chats: [], send: (m) => ws.send(JSON.stringify(m)) };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.t === "joined") Object.assign(b, { id: m.you, code: m.code });
    if (m.t === "snapshot") b.snap = m;
    if (m.t === "chat") b.chats.push(m);
  });
  b.open = new Promise((r) => ws.on("open", r));
  return b;
}
const me = (b) => b.snap.players.find((p) => p.id === b.id);

async function walk(b, x, y) {
  for (let i = 0; i < 120; i++) {
    const p = me(b);
    if (Math.hypot(x - p.x, y - p.y) < 30) break;
    b.send({ t: "input", dx: x - p.x, dy: y - p.y });
    await sleep(50);
  }
  b.send({ t: "input", dx: 0, dy: 0 });
  await sleep(100);
}

const bots = ["A", "B", "C", "D"].map(bot);
await Promise.all(bots.map((b) => b.open));
bots[0].send({ t: "create", name: "A" });
await sleep(200);
for (const b of bots.slice(1)) b.send({ t: "join", code: bots[0].code, name: b.name });
await sleep(300);
bots[0].send({ t: "start" });
await sleep(300);

const k = bots.find((b) => b.snap.you.role === "killer");
const [victim, reporter, other] = bots.filter((b) => b !== k);

console.log(`... waiting for initial cooldown ${k.snap.you.killCooldown}s`);
await sleep(k.snap.you.killCooldown * 1000 + 300);
const v = me(victim);
await walk(k, v.x, v.y);
k.send({ t: "kill" });
await sleep(200);
check(!victim.snap.you.alive, "victim killed");

const body = reporter.snap.bodies[0];
await walk(reporter, body.x > 800 ? body.x - 400 : body.x + 400, body.y);
reporter.send({ t: "report" });
await sleep(150);
check(reporter.snap.phase === "playing", "report refused out of range");
await walk(reporter, body.x, body.y);
victim.send({ t: "report" });
await sleep(150);
check(reporter.snap.phase === "playing", "a ghost can't report");
reporter.send({ t: "report" });
await sleep(200);
check(other.snap.phase === "meeting" && other.snap.meeting.stage === "discussion", "meeting started for everyone");
check(other.snap.meeting.reporter === reporter.id && other.snap.meeting.body === victim.id, "reporter and reported body known");

const before = me(k);
k.send({ t: "input", dx: 1, dy: 0 });
await sleep(300);
check(me(k).x === before.x, "nobody moves during a meeting");
check(!other.snap.players.some((p) => p.id === victim.id), "ghost still invisible to the living during the meeting");

other.send({ t: "vote", target: k.id });
await sleep(100);
check(other.snap.meeting.voted.length === 0, "vote refused during discussion");

// Chat: phrase 0 = "I suspect {player}" (target required), phrase 4 = "I didn't see anything"
reporter.send({ t: "chat", phrase: 0 });
reporter.send({ t: "chat", phrase: 99 });
await sleep(150);
check(other.chats.length === 0, "phrase missing its required target, or unknown, refused");
reporter.send({ t: "chat", phrase: 0, target: k.id });
reporter.send({ t: "chat", phrase: 4 });
await sleep(150);
check(other.chats.length === 1 && other.chats[0].target === k.id, "chat received, 1 s anti-spam active");
check(victim.chats.length === 1, "the ghost hears the living");
victim.send({ t: "chat", phrase: 9 });
await sleep(150);
check(victim.chats.at(-1)?.ghost === true && other.chats.length === 1 && k.chats.length === 1, "ghost chat invisible to the living");

console.log(`... waiting for discussion to end ${other.snap.meeting.secondsLeft}s`);
await sleep(other.snap.meeting.secondsLeft * 1000 + 300);
check(other.snap.meeting.stage === "vote", "vote stage");

victim.send({ t: "vote", target: k.id });
reporter.send({ t: "vote", target: "nobody" });
await sleep(150);
check(other.snap.meeting.voted.length === 0, "vote from a ghost or for an invalid target refused");

reporter.send({ t: "vote", target: k.id });
await sleep(100);
reporter.send({ t: "vote", target: "skip" });
other.send({ t: "vote", target: k.id });
await sleep(150);
check(other.snap.meeting.myVote === k.id && other.snap.meeting.voted.length === 2, "votes recorded, secret (only my own vote is visible)");
check(k.snap.meeting.myVote === undefined, "the killer doesn't see other players' votes");
k.send({ t: "vote", target: "skip" });
await sleep(200);
const r = other.snap.meeting;
check(r.stage === "result", "ends early once every living player has voted");
check(r.result.ejected === k.id && r.result.tally[k.id] === 2 && r.result.tally.skip === 1, "killer ejected 2 to 1, first vote is final");
check(r.result.ejectedRole === undefined, "ejected player's role not revealed (default setting)");
check(!k.snap.you.alive, "the ejected player becomes a ghost");

await sleep(r.secondsLeft * 1000 + 400);
check(other.snap.phase === "ended" && other.snap.winner === "innocent", "no killers left → innocents win");
check(other.snap.bodies.length === 0, "bodies removed after the meeting");
process.exit();
