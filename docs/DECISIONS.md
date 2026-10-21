# Decisions and open questions — Emet

## Decisions made
- Online multiplayer, 5 to 10 players, mobile + PC.
- Funny, chaotic tone, multiverse setting (several styles in the same game).
- Live kills on the map, real time, simple quests + discussion.
- Games of 5 to 10 minutes, rounds proportional in length (e.g. 2 rounds of 2 min 30 for 5 min).
- Number of killers scaled to the player count, configurable.
- Random killers, who know each other by default (configurable).
- Zones with different rules on the map, affecting both look AND gameplay.
- Every role has a power, including neutral roles.
- Ejection vote: an innocent wrongly ejected stays ejected.
- Dead players = ghosts, who only talk among themselves.
- Cop: ties 2 players together, no special effect if one of them is a killer.
- Gambler: random kill and revival, once per game, visible wheel.
- Engine: **web**. Phaser client (TypeScript, Vite), Node.js server + custom `ws` (not Colyseus: simpler per-player filtering, snapshot built per client).

## Decisions made by default (to be confirmed)
- Each innocent is offered 2 roles and keeps 1 (instead of first come, first served).
- Innocents win: quests **or** killers eliminated.
- Killers win: parity or time runs out.
- Revival: only **killed** players, never those ejected by vote, cap of 2.
- Ghost quests that count toward the bar and increase the chance of revival.

- Prototype: the host (room creator) starts the game, minimum `minPlayers`.
- Kill: the client only sends "kill"; the server picks the closest living non-killer target in range.
- Default number of killers: 1 killer (4-6 players), 2 (7-9), 3 (10). Configurable in `data/game.json`.
- Ghosts are invisible to the living (filtered server-side), visible to each other. Bodies are visible to everyone.
- Meeting: triggered by reporting a body (range `report.range`). No emergency button yet.
- Meeting: 15 s discussion, 45 s vote, 5 s result. Ends early once every living player has voted.
- Quick chat only (phrases and emojis from `data/quickchat.json`, some targeting a player), 1 s anti-spam.
- Single, final vote, anonymous (only totals are shown). Tie or "skip" majority = no one is ejected.
- Ejected player's role not revealed by default (`meeting.revealRoleOnEject`).
- After a meeting: bodies removed, everyone brought back to the center, kill cooldown restarted.
- Ghosts: chat among themselves during meetings and, since 2026-10-21, during the round too (same quick chat, 💬 button, bubbles over ghosts + short log). Only ghosts receive it (filtered server-side); the living never get the message.
- Reconnection: secret token per player, 30 s grace (`reconnectGrace`) before being removed. Player shown as "offline" in the meantime.
- Server unreachable: the client retries forever (1 s, 2 s, 4 s, then every 5 s). Create/Join waits up to 10 s, then shows the error. In game, actions sent during an outage are dropped.
- You can join a room in the lobby or after a game ends (not during).
- Game language: **English** (all player-facing text: UI, roles, quick chat, zone names, server errors). Design docs are in English too.
- Playtests: server on Shai's Mac + temporary Cloudflare tunnel. Permanent hosting later.
- Hosting: **client on Vercel** (static, CDN, invite link = Vercel URL), **game server on Render** (one long-lived Node process, `render.yaml`; Dockerfile for Railway/Fly). Not the server on Vercel: Vercel WebSockets can land on different instances and are cut at the function max duration, which breaks in-memory rooms and the 20 Hz tick.
- Server only accepts WebSockets from `ALLOWED_ORIGINS` (unset = any, for dev). Ping every 25 s, dead sockets dropped (triggers the reconnection grace).
- Client watchdog: in a room, 5 s without a message = dead connection, reconnect (Render's proxy doesn't forward the server's close, so a tab would otherwise freeze after a redeploy).
- Phaser is loaded lazily: the lobby shows without waiting for the game engine.

- Visual direction (ref. "gnome cards" video): full-page bright color fills, bold geometric font (Outfit), chibi helmet characters that spill out of the frame, rounded white pills, big numbers, curved black "Let's go ›››" bar at the bottom. Role colors and text in `data/roles.json`.
- "Nexus" map (`data/map.json`): central hub + 4 zones (Moon, Ice, Neon, Candy), walls and obstacles with server-side collision. Kill and report require line of sight (not through a wall). Zone rules pushed to Phase 4.
- Skins (`data/skins.json`): 6 characters (Helmet, Astro, Parka, Glitch, Gummy, Gnome), chosen in the lobby, **cosmetic only** and open to everyone. The server-assigned color is drawn on every skin and stays the main way to recognize a player; two players can share a skin. **Every character carries a sword**, whatever their role, so it gives nothing away (an optional sword would have read as "killer").
- Minimap (top right, tap = enlarged, M key on PC): shows the map, your own position and the camera view. Other players are **not** shown by default (otherwise you'd know who is alone with whom): setting `minimap.showPlayers` in `data/game.json`.

- Special roles (2026-10-21): 7 innocent, 2 neutral, 4 killer powers in `data/powers.json` (see `docs/ROLES.md`). Dealt at random for now (no "pick 1 of 2" screen yet), no duplicates while the pool lasts. One power button (E key), server checks cooldown/uses/range.
- Neutral roles (Jester, Vulture) win alone; at most one per game, 50% chance from 5 players.
- Power effects are visible to everyone (banner or emoji on the map), the user isn't named.

- Game clock (2026-10-21): 6 min of play time (paused during meetings), cut into 2 min rounds. End of a round = automatic meeting. Clock runs out = killers win. Any meeting restarts the round timer. Settings `time.total` / `time.round` in `data/game.json`.
- Quests v1 (2026-10-21): 8 stations on the map (2 per zone, `stations` in `data/map.json`), 3 assigned per player. Stand still in range and hold "Task" for 4 s (server-timed, moving cancels). Shared bar visible to everyone; full bar = innocents win. Only innocents' tasks count (killers and neutrals get fake ones as cover). Ghosts keep doing tasks and they count. Real mini-games come later.
- Mini-games (2026-10-21): each station has its own 5-10 s mini-game (`game` in `data/map.json`, settings in `data/minigames.json`), played in an HTML overlay. The server stays authoritative on what it can check: start in range, don't move (moving cancels), and at least `minSeconds` between start and "done". The skill part itself is client-side (a cheater can skip the game, not the time or the place). You can still be killed while playing. Replaces the 4 s hold.
- Revival weighting: a ghost with more tasks done is more likely to be picked by the Gambler.
- Emergency button (2026-10-21): the big red button on the hub table, 1 per player per game, within 130 px of its center.
- Role choice (2026-10-21): innocents and killers are offered 2 roles, pick 1 within 10 s (default: the first). Neutrals get no choice.

## Open questions
1. ~~Engine~~ → web (2026-10-19).
2. Can a player tied by the Cop be killed? (proposal: yes, and the tied player becomes a witness)
3. Final name of the game (Emet is the folder name).
4. Monetization (free, cosmetics)?
5. Voice chat: built in from v1 or later?
6. Handling players who leave mid-game (bot, or role lost)?
7. Target audience (age)? Visual tone → colorful cartoon (2026-10-20).

## Log
- 2026-10-19: design folder created from discussions and research on Among Us, Goose Goose Duck, Blood on the Clocktower.
- 2026-10-19: engine chosen = web (Phaser + authoritative Node `ws` server). Phase 1 started.
- 2026-10-19: killer added (server draw, kill in range + cooldown, roles filtered per player, killers win at parity).
- 2026-10-19: reporting, meeting with quick chat, ejection vote, innocents win by ejecting the killers.
- 2026-10-19: mobile playtest prep (single HTTP+WS server, reconnection, public tunnel).
- 2026-10-20: new visual direction (colored cards, helmet characters, "Let's go" bar). Role reveal screen.
- 2026-10-20: Nexus map (hub + 4 zones), collisions and line of sight for kill/report, `test:map` test.
- 2026-10-20: minimap (own position only, other players optional).
- 2026-10-20: game translated to English (UI, `data/*.json`, server messages, README).
- 2026-10-20: design docs (`docs/`), `CLAUDE.md`, code comments and test messages translated to English.
- 2026-10-21: deployment split: client on Vercel, server on Render (origin allowlist, heartbeat, health check, lazy Phaser).
- 2026-10-21: skins (6 characters), chosen in the lobby, cosmetic only. Everyone carries a sword.
- 2026-10-21: map visual pass (drop shadows, zone-tinted walls, portal doors, decor landmarks, ambient motion, space backdrop). No collision change.
- 2026-10-21: special roles and powers (DJ, Teleporter, Medic, Prankster, Gambler, Sacrifice, Canadian, Jester, Vulture, Blackout, Shapeshifter, Swapper, Prop Master). `test:powers` test.
- 2026-10-21: game loop: rounds + game clock, quests and shared bar, emergency button, pick 1 of 2 roles, ghost tasks weight revival. `test:loop` test.
- 2026-10-21: task mini-games (8: tune, rocks, fish, defrost, servers, whack, lollipop, cake).
- 2026-10-21: in-game ghost chat.
