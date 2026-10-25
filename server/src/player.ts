import type { WebSocket } from "ws";
import type { BodyView, ItemView, Look, Role, ServerMsg } from "../../shared/protocol.ts";
import config from "../../data/game.json" with { type: "json" };
import skins from "../../data/skins.json" with { type: "json" };

export interface Player {
  id: string;
  name: string;
  color: string;
  look: Look;
  x: number;
  y: number;
  input: { dx: number; dy: number };
  vel: { x: number; y: number }; // px/s, for zones with inertia (Moon, Ice)
  socket: WebSocket;
  token: string;
  awayUntil?: number; // disconnected: removed from the game after this timestamp
  role: Role;
  roleId?: string; // special role (data/powers.json)
  alive: boolean;
  ejected: boolean; // voted out: can never be revived
  nextKillAt: number; // timestamp ms
  nextChatAt: number;
  nextPowerAt: number;
  uses: number; // -1 = unlimited
  // Power effects (timestamps ms)
  danceUntil: number;
  djUntil: number;
  shieldUntil: number;
  slipUntil: number;
  slipDir: { dx: number; dy: number };
  disguise?: { name: string; color: string; look: Look; until: number };
  eaten: number;
  // Game loop
  offer?: string[]; // roles to pick from at game start
  tasks: { station: string; done: boolean }[];
  working?: { station: string; seconds: number };
  ghostTasks: number; // tasks done as a ghost: weights revival
  emergencies: number;
  warp?: { portal: string; seconds: number }; // standing still on a portal
  nextWarpAt: number; // timestamp ms
}

export type Body = BodyView & { fake?: boolean };
export type Item = ItemView & { owner: string; armedAt: number };

export function send(socket: WebSocket, msg: ServerMsg) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

export function killersFor(count: number) {
  const table = config.killers.byPlayers as Record<string, number>;
  return table[String(count)] ?? Math.max(1, Math.floor(count / 4));
}

export function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// The client's choice is untrusted: an unknown id falls back to the default skin.
export function cleanLook(raw: unknown): Look {
  const l = (raw ?? {}) as Partial<Record<keyof Look, unknown>>;
  const skin = skins.skins.some((s) => s.id === l.skin) ? String(l.skin) : skins.default;
  return { skin };
}
