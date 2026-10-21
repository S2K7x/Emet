// Fills a room with bots to test solo: node scripts/bots.mjs CODE [count]
// Killer: hunts the closest target. Innocent: wanders, reports bodies. In meetings: random chat and votes.
import WebSocket from "ws";

const [code, count = "3"] = process.argv.slice(2);
if (!code) {
  console.log("Usage: node scripts/bots.mjs CODE [count]");
  process.exit(1);
}

const PHRASES_WITHOUT_TARGET = [4, 5, 6, 7, 8, 9, 10];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

for (let i = 1; i <= Number(count); i++) {
  const ws = new WebSocket(process.env.SERVER_URL ?? "ws://localhost:2567");
  const send = (m) => ws.send(JSON.stringify(m));
  let id;
  let wander = { dx: 0, dy: 0 };
  let chatted = 0;

  ws.on("open", () => send({ t: "join", code, name: `Bot${i}` }));
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.t === "joined") id = m.you;
    if (m.t === "error") console.log(`Bot${i}: ${m.message}`);
    if (m.t !== "snapshot") return;

    const me = m.players.find((p) => p.id === id);
    if (!me) return;

    if (m.phase === "meeting" && m.meeting) {
      if (me.alive && Math.random() < 0.01 && chatted < 2) {
        chatted++;
        send({ t: "chat", phrase: pick(PHRASES_WITHOUT_TARGET) });
      }
      if (m.meeting.stage === "vote" && me.alive && !m.meeting.myVote && Math.random() < 0.05) {
        const others = m.players.filter((p) => p.alive && p.id !== id);
        send({ t: "vote", target: Math.random() < 0.4 ? "skip" : pick(others).id });
      }
      return;
    }
    chatted = 0;
    if (m.phase !== "playing" || !me.alive) return;

    const body = m.bodies[0];
    if (body && m.you.role !== "killer") {
      if (Math.hypot(body.x - me.x, body.y - me.y) < 80) return send({ t: "report" });
      return send({ t: "input", dx: body.x - me.x, dy: body.y - me.y });
    }

    if (m.you.role === "killer" && m.you.killCooldown === 0) {
      const prey = m.players
        .filter((p) => p.alive && p.role !== "killer" && p.id !== id)
        .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
      if (prey) {
        send({ t: "input", dx: prey.x - me.x, dy: prey.y - me.y });
        return send({ t: "kill" });
      }
    }

    if (Math.random() < 0.03) {
      const a = Math.random() * Math.PI * 2;
      wander = Math.random() < 0.3 ? { dx: 0, dy: 0 } : { dx: Math.cos(a), dy: Math.sin(a) };
      send({ t: "input", ...wander });
    }
  });
  ws.on("close", () => console.log(`Bot${i} disconnected`));
}
