// Reconnection: a player drops their connection mid-game and comes back with their token.
// Requires the server: npm run dev:server.
import WebSocket from "ws";

const URL = process.env.SERVER_URL ?? "ws://localhost:2567";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, label) => {
  console.log(`${cond ? "OK  " : "FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
};
setTimeout(() => (console.log("FAIL timeout"), process.exit(1)), 30_000);

function connect(b) {
  const ws = new WebSocket(URL);
  b.ws = ws;
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.t === "joined") Object.assign(b, { id: m.you, code: m.code, token: m.token, joinedCount: (b.joinedCount ?? 0) + 1 });
    if (m.t === "snapshot") b.snap = m;
    if (m.t === "error") b.error = m.message;
  });
  return new Promise((r) => ws.on("open", r));
}
const send = (b, m) => b.ws.send(JSON.stringify(m));

const bots = ["A", "B", "C", "D"].map((name) => ({ name }));
for (const b of bots) await connect(b);
send(bots[0], { t: "create", name: "A" });
await sleep(200);
for (const b of bots.slice(1)) send(b, { t: "join", code: bots[0].code, name: b.name });
await sleep(300);
send(bots[0], { t: "start" });
await sleep(300);

const c = bots[2];
const { id, token, code } = c;
const role = c.snap.you.role;
check(!JSON.stringify(bots[1].snap).includes(token), "the token is never sent to others");

c.ws.terminate();
await sleep(300);
check(bots[1].snap.players.find((p) => p.id === id)?.away === true, "dropped player shown as \"offline\", still in the game");

await connect(c);
send(c, { t: "rejoin", code, token: "wrong" });
await sleep(200);
check(c.error === "Session expired", "wrong token refused");

send(c, { t: "rejoin", code, token });
await sleep(300);
check(c.id === id && c.snap?.you.role === role, "reconnected: same player, same role");
check(!bots[1].snap.players.find((p) => p.id === id).away, "no longer \"offline\" after reconnecting");

// Another client stealing the session kicks the old socket, not the player.
const thief = {};
await connect(thief);
send(thief, { t: "rejoin", code, token });
await sleep(300);
check(c.ws.readyState !== WebSocket.OPEN && thief.id === id, "only one active socket per player");
check(!bots[1].snap.players.find((p) => p.id === id).away, "closing the old socket doesn't mark the player \"offline\"");
process.exit();
