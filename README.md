# Emet

A funny, chaotic real-time multiplayer social deduction game set in a multiverse.
See `CLAUDE.md` and the `docs/` folder.

## Run the prototype
```bash
npm install
npm run dev
```
- Client: http://localhost:5173 (on a phone on the same Wi-Fi: `http://<mac-ip>:5173`)
- WebSocket server: port 2567
- After creating a room, the page link (`?code=XXXX`) is the invite link.
- Settings (speed, tick rate, map size, colors): `data/game.json`.

## Test solo
```bash
node server/scripts/bots.mjs CODE 4
```
Fills room `CODE` with 4 bots (the killer hunts, innocents report, random votes).

End-to-end server tests (server running): `npm run test:kill`, `npm run test:meeting`.

## Deploy (permanent link)
Client on **Vercel**, game server on **Render** (Vercel can't keep one room on one in-memory server, see `docs/DECISIONS.md`).

1. Push the repo to GitHub.
2. **Render** → New → Blueprint → pick the repo (`render.yaml`). Set `ALLOWED_ORIGINS` to your Vercel URL(s), e.g. `https://emet.vercel.app,https://emet-*.vercel.app`. Note the server URL (`https://emet-server.onrender.com`).
3. **Vercel** → import the repo (`vercel.json` is already set). Env var `VITE_SERVER_URL=wss://emet-server.onrender.com`. Deploy.
4. Share the Vercel link. The free Render plan sleeps after 15 min idle: the first visitor waits ~30 s ("Waking up the server…").

Bots against the deployed server: `SERVER_URL=wss://emet-server.onrender.com node server/scripts/bots.mjs CODE 4`.
Railway / Fly: use the `Dockerfile` (server only) instead of Render.

## Online playtest (from this Mac)
```bash
npm run build
PORT=8080 npm start
cloudflared tunnel --url http://localhost:8080
```
The `https://….trycloudflare.com` link printed by cloudflared is public: send it to the players. The Mac must stay on and awake; the link changes every time the tunnel restarts.
