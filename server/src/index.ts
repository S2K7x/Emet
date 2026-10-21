import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer } from "ws";
import type { ClientMsg } from "../../shared/protocol.ts";
import { Room, send } from "./room.ts";

const PORT = Number(process.env.PORT ?? 2567);
const rooms = new Map<string, Room>();
// Sites allowed to open a WebSocket, comma-separated, "*" wildcard (e.g. "https://emet.vercel.app,https://emet-*.vercel.app").
// Unset = any origin (local dev, LAN phones). No Origin header (bots, test scripts) is always allowed:
// this only stops other websites from using the server, it is not authentication.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean)
  .map((o) => new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]*")}$`));
// Mobile networks drop connections without closing them: ping, and drop sockets that don't answer.
const HEARTBEAT_MS = 25000;

function newCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O to avoid confusion
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  } while (rooms.has(code));
  return code;
}

// In production, the same port serves the built client (client/dist) and the WebSocket.
const STATIC_DIR = resolve(import.meta.dirname, "../../client/dist");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const http = createServer((req, res) => {
  // Health check for the host (Render) and to wake a sleeping server.
  if (req.url === "/health") return res.writeHead(200, { "Access-Control-Allow-Origin": "*" }).end(`ok ${rooms.size}`);
  const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
  let file = join(STATIC_DIR, path);
  if (!file.startsWith(STATIC_DIR)) return res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, "index.html");
  if (!existsSync(file)) return res.writeHead(404).end("Client not built: npm run build");
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({
  server: http,
  maxPayload: 4096,
  verifyClient: ({ origin }: { origin?: string }) => !origin || !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.some((re) => re.test(origin)),
});

const alive = new WeakSet<object>();
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    // No pong since the last ping: dead connection. "close" fires and the reconnection grace starts.
    if (!alive.has(socket)) socket.terminate();
    alive.delete(socket);
    socket.ping();
  }
}, HEARTBEAT_MS);

wss.on("connection", (socket) => {
  let id: string = randomUUID();
  let room: Room | undefined;
  alive.add(socket);
  socket.on("pong", () => alive.add(socket));

  socket.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.t === "create" && !room) {
      const code = newCode();
      room = new Room(code, () => rooms.delete(code));
      rooms.set(code, room);
      room.add(id, String(msg.name ?? ""), msg.look, socket);
    } else if (msg.t === "join" && !room) {
      const target = rooms.get(String(msg.code ?? "").toUpperCase());
      if (!target) return send(socket, { t: "error", message: "Room not found" });
      const refusal = target.canJoin;
      if (refusal) return send(socket, { t: "error", message: refusal });
      room = target;
      room.add(id, String(msg.name ?? ""), msg.look, socket);
    } else if (msg.t === "rejoin" && !room) {
      const target = rooms.get(String(msg.code ?? "").toUpperCase());
      const rejoined = target?.rejoin(String(msg.token ?? ""), socket);
      if (!target || !rejoined) return send(socket, { t: "error", message: "Session expired" });
      room = target;
      id = rejoined;
    } else if (msg.t === "input" && room) {
      room.setInput(id, msg.dx, msg.dy);
    } else if (msg.t === "start" && room) {
      room.start(id);
    } else if (msg.t === "power" && room) {
      room.power(id);
    } else if (msg.t === "task" && room) {
      room.task(id);
    } else if (msg.t === "emergency" && room) {
      room.emergency(id);
    } else if (msg.t === "pick" && room) {
      room.pick(id, String(msg.role));
    } else if (msg.t === "kill" && room) {
      room.kill(id);
    } else if (msg.t === "report" && room) {
      room.report(id);
    } else if (msg.t === "chat" && room) {
      room.chat(id, Number(msg.phrase), msg.target === undefined ? undefined : String(msg.target));
    } else if (msg.t === "vote" && room) {
      room.vote(id, msg.target);
    }
  });

  socket.on("close", () => room?.disconnect(id, socket));
});

http.listen(PORT, () => console.log(`Emet server on http://localhost:${PORT} (WebSocket on the same port)`));

// Redeploy or shutdown (the host sends SIGTERM): rooms live in memory and are lost.
process.on("SIGTERM", () => {
  clearInterval(heartbeat);
  for (const socket of wss.clients) socket.close(1012, "Server restarting");
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
});
