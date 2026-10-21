# Technical architecture — Emet

> Status: **proposal**, engine not decided. See `DECISIONS.md`.

## Constraints
- Mobile + PC, real time, 5 to 10 players per game.
- Limit cheating: the server decides everything (kills, roles, votes, quests).
- Hidden information: a client must never receive other players' roles.
- Voice chat in meetings.

## Engine options
| Option | Pros | Cons |
|---|---|---|
| Godot 4 | Lightweight, exports to mobile + PC + web, already used on another project | Networking and voice to assemble yourself |
| Unity | Ready-made multiplayer and voice ecosystem | Heavier, licensing |
| Web (Phaser/Three + WebSocket) | No download, share by link, very fast to test | More limited mobile performance |

Starting recommendation: **prototype in Godot 4** (or web if the goal is to test the fun very quickly). Decision to make before coding.

## Network architecture (proposed)
- **Authoritative** dedicated server (one process per room, e.g. Node.js/Colyseus or headless Godot server).
- Clients send **intents** (move, use power, vote); the server validates and broadcasts the state.
- Server tick ~20 Hz, client-side interpolation.
- Per-player information filtering (role, quests, ghosts).
- Matchmaking: private rooms by code first, public ones later.

## Server modules
1. Lobby / rooms / game settings
2. Role assignment (server-side draw only)
3. Simulation (positions, kills, quests, powers)
4. Game state machine: `LOBBY -> ROLE_REVEAL -> ROUND -> MEETING -> VOTE -> ... -> END`
5. Meetings and votes
6. Ghosts and revivals
7. Event log (useful for debugging and replays)

## Data
- Roles, powers, zones, quests: versioned data files (`data/`).
- Game settings: a single configuration object sent at game start.

## Voice
- Beyond the prototype: third-party service (e.g. WebRTC) enabled during meetings only.
- Prototype: emoji wheel and quick phrases, no voice.

## Security
- No win logic on the client.
- Rate-limit actions (power anti-spam).
- Validate range and cooldowns on the server.
