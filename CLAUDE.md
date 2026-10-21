# Emet — project context for Claude Code

Real-time multiplayer social deduction game (Among Us / Werewolf style), funny and chaotic, with a **multiverse** theme. Mobile + PC, 5 to 10 players, 5 to 10 minute games.

## Reference documents (read before coding)
- `docs/GDD.md`: full game design (game loop, win conditions, pacing)
- `docs/ROLES.md`: innocent roles, killers, powers, balancing rules
- `docs/MAPS.md`: multiverse maps and zones with special rules
- `docs/ARCHITECTURE.md`: technical choices and network architecture
- `docs/ROADMAP.md`: development stages
- `docs/DECISIONS.md`: decision log and open questions

## Stack and layout
- `client/`: Phaser 3 + TypeScript + Vite. Phaser is loaded lazily (dynamic import) so the lobby shows first.
- `server/`: Node + `ws`, run with `tsx`. One `Room` per game, in memory, 20 Hz tick, snapshot built per player.
- `shared/`: protocol and map geometry used by both. `data/`: game settings, roles, map, quick chat (JSON).
- Commands: `npm run dev` (client 5173 + server 2567), `npm run typecheck`, `npm run build`.
- Server tests (server must be running): `npm run test:kill | test:meeting | test:reconnect | test:map`. Against a remote server: `SERVER_URL=wss://… WAIT=10 npm run test:reconnect`.
- Bots: `node server/scripts/bots.mjs CODE 4`.

## Deployment
- **Client on Vercel**: project `emet` (team `s2k7xs-projects`), **Root Directory = `client`**, config in `client/vercel.json`. Env `VITE_SERVER_URL=wss://emet-server.onrender.com` (baked in at build time). Public URL (share this one): https://emet-iota.vercel.app. The `*-s2k7xs-projects.vercel.app` URLs are behind Vercel Authentication (`ssoProtection: all_except_custom_domains`) and redirect players to a Vercel login.
- **Server on Render**: service `emet-server` (free plan, Frankfurt), `render.yaml`. Env `ALLOWED_ORIGINS=https://emet*.vercel.app`. Health check: `/health`.
- Both auto-deploy on push to `main` of https://github.com/S2K7x/Emet.
- Never move the game server to Vercel Functions: connections can land on different instances and are cut at max duration (rooms are in memory).
- A Render redeploy wipes games in progress. Render's proxy doesn't forward server-side closes: the client watchdog (5 s silence in a room = reconnect, `client/src/net.ts`) handles it, keep it.
- Free Render sleeps after 15 min idle (~30 s wake-up): keep the 60 s lobby timeout and the "Waking up the server" message.
- The Vercel MCP connector can read and update project settings (`get_project`, `update_project`, incl. deployment protection).

## Working rules
- The server is **authoritative**: the client only sends intents, never a result.
- Roles, powers, durations and numbers are **data** (JSON/Resource), not hardcoded. Everything must be changeable in the game settings.
- A design decision changes? Update `docs/DECISIONS.md` before coding.
- Never send the client information it must not know (other players' roles, who the killers are).
- Start small: a playable prototype with 4 players and 3 roles before adding content.

## Collaboration style (Shai)
- Short answers, code before explanation, concrete example before theory.
- Suggest alternatives and flag risks without waiting to be asked.
