import type { ClientMsg, ServerMsg } from "../../shared/protocol.ts";

// In dev, Vite (5173) and the server (2567) are separate; in prod, everything is served from the same origin.
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV ? `ws://${location.hostname}:2567` : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

const SESSION_KEY = "emet.session";
// Retry delay: 1 s, 2 s, 4 s, then 5 s max.
const RETRY_MAX_MS = 5000;
// How long a lobby action (create, join) waits for the server before giving up.
// Long enough for a sleeping free-tier server to wake up.
const SEND_TIMEOUT_MS = 60000;
// In a room the server sends ~20 snapshots/s. Silence this long = dead connection, even if the socket says "open"
// (a hosting proxy like Render's may never forward the server's close).
const STALE_MS = 5000;

export interface Session {
  code: string;
  token: string;
}

export class Net {
  private socket!: WebSocket;
  private opened!: Promise<void>; // resolves on the next open connection
  private markOpen!: () => void;
  private attempts = 0;
  private wasConnected = false;
  private inRoom = false;
  private lastMessageAt = 0;
  private drop = () => {}; // abandons the current socket and reconnects
  onMessage: (msg: ServerMsg) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};
  onExpired: () => void = () => {};

  constructor() {
    this.resetOpened();
    this.connect();
    setInterval(() => {
      if (this.inRoom && this.socket.readyState === WebSocket.OPEN && Date.now() - this.lastMessageAt > STALE_MS) this.drop();
    }, 1000);
  }

  private resetOpened() {
    this.opened = new Promise((resolve) => (this.markOpen = resolve));
  }

  static savedSession(): Session | undefined {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") ?? undefined;
    } catch {
      return undefined;
    }
  }

  async send(msg: ClientMsg) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      // In game, an intent (move, kill) sent during an outage would be stale: drop it.
      // Reconnection sends "rejoin" on its own.
      if (this.wasConnected && Net.savedSession()) return;
      let timer!: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("Server unreachable")), SEND_TIMEOUT_MS)));
      await Promise.race([this.opened, timeout]).finally(() => clearTimeout(timer));
    }
    this.socket.send(JSON.stringify(msg));
  }

  private connect() {
    const socket = new WebSocket(SERVER_URL);
    this.socket = socket;
    let didOpen = false;
    let lost = false;

    // Connection lost (locked screen, mobile network, server restart): retry forever, backing off.
    // In game, reconnection resends the token (see "open").
    const onLost = () => {
      if (lost) return;
      lost = true;
      if (didOpen) this.resetOpened();
      this.onStatus(false);
      const delay = Math.min(1000 * 2 ** this.attempts++, RETRY_MAX_MS);
      setTimeout(() => this.connect(), delay);
    };

    socket.addEventListener("open", () => {
      this.lastMessageAt = Date.now();
      didOpen = true;
      this.attempts = 0;
      const session = Net.savedSession();
      if (this.wasConnected && session) socket.send(JSON.stringify({ t: "rejoin", ...session }));
      this.wasConnected = true;
      this.markOpen();
      this.onStatus(true);
    });

    socket.addEventListener("message", (e) => {
      if (lost) return; // dropped by the watchdog: a newer socket takes over
      this.lastMessageAt = Date.now();
      const msg: ServerMsg = JSON.parse(e.data);
      if (msg.t === "joined") {
        this.inRoom = true;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: msg.code, token: msg.token }));
      }
      if (msg.t === "error" && msg.message === "Session expired") {
        sessionStorage.removeItem(SESSION_KEY);
        this.inRoom = false;
        this.onExpired();
      }
      this.onMessage(msg);
    });

    socket.addEventListener("close", onLost);
    // Behind a proxy, "close" may never fire: don't wait for it.
    this.drop = () => (socket.close(), onLost());
  }

  // Page reload: resume this tab's session.
  async resume(session: Session) {
    await this.send({ t: "rejoin", ...session });
  }
}
