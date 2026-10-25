// Unit tests: game rules with fake sockets, no server needed. Run: npm test
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { WebSocket } from "ws";
import { SKIP, type ServerMsg } from "../../shared/protocol.ts";
import { Meeting } from "../src/meeting.ts";
import { Room } from "../src/room.ts";
import config from "../../data/game.json" with { type: "json" };
import mapData from "../../data/map.json" with { type: "json" };

type FakeSocket = { readyState: number; OPEN: number; sent: ServerMsg[]; send(s: string): void; close(): void };
const fakeSocket = (): FakeSocket => ({ readyState: 1, OPEN: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); }, close() {} });

const rooms: Room[] = [];
afterEach(() => {
  for (const room of rooms.splice(0)) for (const id of [...room.players.keys()]) room.remove(id); // stops the tick timer
});

// A started room with n players; internals exposed for setup.
function startedRoom(n = 5) {
  const room = new Room("TEST", () => {});
  rooms.push(room);
  const sockets = new Map<string, FakeSocket>();
  for (let i = 0; i < n; i++) {
    const s = fakeSocket();
    sockets.set(`p${i}`, s);
    room.add(`p${i}`, `P${i}`, undefined, s as unknown as WebSocket);
  }
  room.start("p0");
  const r = room as any;
  const all = [...room.players.values()] as any[];
  const killer = all.find((p) => p.role === "killer");
  const innocents = all.filter((p) => p.role !== "killer");
  for (const s of sockets.values()) s.sent = [];
  return { room, r, sockets, killer, innocents, all };
}

describe("Meeting vote count", () => {
  const alive = new Set(["a", "b", "c", "d"]);
  const voteAll = (votes: Record<string, string>) => {
    const m = new Meeting("a", "", 0);
    m.update(1e9, alive); // discussion -> vote
    for (const [voter, target] of Object.entries(votes)) m.vote(voter, target, alive);
    m.update(2e9, alive); // vote -> result
    return m.result!;
  };

  it("ejects on a strict plurality", () => assert.equal(voteAll({ a: "b", c: "b", d: "a" }).ejected, "b"));
  it("ejects no one on a tie", () => assert.equal(voteAll({ a: "b", b: "a" }).ejected, undefined));
  it("ejects no one when skip is on top", () => assert.equal(voteAll({ a: SKIP, b: SKIP, c: "d" }).ejected, undefined));
  it("ignores votes during discussion, double votes and dead voters", () => {
    const m = new Meeting("a", "", 0);
    m.vote("a", "b", alive);
    m.update(1e9, alive);
    m.vote("a", "c", alive);
    m.vote("a", "d", alive);
    m.vote("ghost", "c", alive);
    assert.equal(m.viewFor("a", 0, () => undefined).voted.length, 1);
    assert.equal(m.viewFor("a", 0, () => undefined).myVote, "c");
  });
});

describe("Room", () => {
  it("only the host can start, and only with enough players", () => {
    const room = new Room("T", () => {});
    rooms.push(room);
    for (let i = 0; i < 3; i++) room.add(`p${i}`, "", undefined, fakeSocket() as unknown as WebSocket);
    room.start("p0");
    assert.equal((room as any).phase, "lobby");
    room.add("p3", "", undefined, fakeSocket() as unknown as WebSocket);
    room.start("p1");
    assert.equal((room as any).phase, "lobby");
    room.start("p0");
    assert.equal((room as any).phase, "playing");
  });

  it("never tells an innocent who the killers are", () => {
    const { r, sockets, innocents } = startedRoom(7);
    r.tick();
    for (const p of innocents) {
      const snap = sockets.get(p.id)!.sent.find((m) => m.t === "snapshot") as Extract<ServerMsg, { t: "snapshot" }>;
      for (const view of snap.players) if (view.id !== p.id) assert.equal(view.role, undefined, `${p.id} learns ${view.id}'s role`);
    }
  });

  it("killers win at parity", () => {
    const { room, r, killer, innocents } = startedRoom(4);
    for (const p of innocents.slice(0, 2)) r.killPlayer(p);
    r.checkVictory();
    assert.equal(r.phase, "ended");
    assert.equal(r.winner, "killer");
    void room;
  });

  it("a kill needs range and cooldown", () => {
    const { r, killer, innocents } = startedRoom(5);
    const [target] = innocents;
    Object.assign(killer, { x: 1000, y: 620 });
    Object.assign(target, { x: 1040, y: 620 });
    for (const p of innocents.slice(1)) Object.assign(p, { x: 1500, y: 1200 });
    r.kill(killer.id);
    assert.equal(target.alive, true, "initial cooldown not respected");
    killer.nextKillAt = 0;
    r.kill(killer.id);
    assert.equal(target.alive, false);
  });
});

describe("Leaving mid-game", () => {
  const leave = (room: Room, r: any, p: any) => {
    room.disconnect(p.id, p.socket);
    p.awayUntil = Date.now() - 1; // grace over
    r.tick();
  };
  const banners = (s: FakeSocket) => s.sent.filter((m) => m.t === "fx" && m.kind === "banner").map((m: any) => m.text as string);

  it("the last killer leaving hands the innocents the win, without revealing the role", () => {
    const { room, r, sockets, killer, innocents } = startedRoom(5);
    leave(room, r, killer);
    assert.equal(room.players.has(killer.id), false);
    assert.equal(r.winner, "innocent");
    assert.equal(r.bodies.length, 0, "a leaver leaves no body");
    const seen = banners(sockets.get(innocents[0].id)!);
    assert.deepEqual(seen, [`👋 ${killer.name} left the game`]);
  });

  it("an innocent leaving can give the killers parity", () => {
    const { room, r, innocents } = startedRoom(4);
    r.killPlayer(innocents[0]);
    leave(room, r, innocents[1]);
    assert.equal(r.winner, "killer");
  });

  it("leaving during a meeting is settled when the meeting ends", () => {
    const { room, r, killer } = startedRoom(5);
    r.startMeeting(killer.id, "", "emergency");
    leave(room, r, killer);
    assert.equal(r.phase, "meeting");
    for (let i = 1; r.meeting && i < 10; i++) r.updateMeeting(Date.now() + i * 1e6); // fast-forward stage by stage
    assert.equal(r.winner, "innocent");
  });

  it("no banner for leaving the lobby", () => {
    const room = new Room("T", () => {});
    rooms.push(room);
    const sockets = [0, 1].map((i) => {
      const s = fakeSocket();
      room.add(`p${i}`, `P${i}`, undefined, s as unknown as WebSocket);
      return s;
    });
    room.remove("p1");
    assert.equal(banners(sockets[0]).length, 0);
  });
});

describe("Portals", () => {
  const portal = (id: string) => mapData.portals.find((p) => p.id === id)!;
  const standOn = (r: any, p: any, at: { x: number; y: number }, seconds: number) => {
    Object.assign(p, { x: at.x, y: at.y, input: { dx: 0, dy: 0 }, vel: { x: 0, y: 0 } });
    for (let t = 0; t < seconds; t += 0.05) r.updateWarp(p, 0.05, Date.now(), false);
  };

  it("standing still on a portal for the channel time warps to its pair, then cooldown", () => {
    const { r, innocents } = startedRoom(5);
    const [p] = innocents;
    const moon = portal("moon");
    const candy = portal(moon.pair);
    standOn(r, p, moon, config.portal.channel * 0.5);
    assert.equal(p.x, moon.x, "warped before the channel time");
    standOn(r, p, moon, config.portal.channel * 0.6);
    assert.deepEqual({ x: p.x, y: p.y }, { x: candy.x, y: candy.y });
    standOn(r, p, candy, config.portal.channel * 2);
    assert.equal(p.x, candy.x, "warped back during the cooldown");
  });

  it("moving cancels the channel", () => {
    const { r, innocents } = startedRoom(5);
    const [p] = innocents;
    const moon = portal("moon");
    standOn(r, p, moon, config.portal.channel * 0.8);
    r.updateWarp(p, 0.05, Date.now(), true);
    assert.equal(p.warp, undefined);
    standOn(r, p, moon, config.portal.channel * 0.5);
    assert.equal(p.x, moon.x, "progress kept after moving");
  });
});

describe("Meeting seats", () => {
  it("the living sit around the table and leave from there", () => {
    const { r, all, innocents } = startedRoom(6);
    for (const p of all) Object.assign(p, { x: 150, y: 150 });
    r.killPlayer(innocents[0]);
    r.startMeeting("", "", "emergency");
    const seats = all.map((p: any) => ({ x: p.x, y: p.y }));
    assert.deepEqual({ x: innocents[0].x, y: innocents[0].y }, { x: 150, y: 150 }, "the dead don't take a seat");
    for (const p of all) if (p.alive) assert.ok(Math.hypot(p.x - mapData.spawn.x, p.y - mapData.spawn.y) < 200, `${p.id} not at the table`);
    for (let i = 1; r.meeting && i < 10; i++) r.updateMeeting(Date.now() + i * 1e6);
    assert.deepEqual(all.map((p: any) => ({ x: p.x, y: p.y })), seats, "moved after the meeting");
  });
});

describe("fx visibility (no leak)", () => {
  const fxOf = (s: FakeSocket) => s.sent.filter((m) => m.t === "fx");

  it("a positional effect only reaches players near it", () => {
    const { r, sockets, killer, innocents } = startedRoom(5);
    const [near, far] = innocents;
    Object.assign(killer, { x: 1000, y: 620 });
    Object.assign(near, { x: 1100, y: 620 });
    Object.assign(far, { x: 1000 + 2000, y: 620 });
    r.fx("whiff", killer);
    assert.equal(fxOf(sockets.get(near.id)!).length, 1);
    assert.equal(fxOf(sockets.get(far.id)!).length, 0, "far player learns a killer slipped");
  });

  it("lights out hides effects outside the vision radius from innocents, not from killers", () => {
    const { r, sockets, killer, innocents } = startedRoom(5);
    const [blind] = innocents;
    Object.assign(blind, { x: 1000, y: 620 });
    Object.assign(killer, { x: 1000 + 400, y: 620 });
    r.lightsOutUntil = Date.now() + 10_000;
    r.vision = 150;
    r.fx("pop", { x: 1000 + 300, y: 620 });
    assert.equal(fxOf(sockets.get(blind.id)!).length, 0);
    assert.equal(fxOf(sockets.get(killer.id)!).length, 1);
  });

  it("banners still reach everyone", () => {
    const { r, sockets } = startedRoom(5);
    r.fx("banner", undefined, "hello");
    for (const s of sockets.values()) assert.equal(fxOf(s).length, 1);
  });
});
