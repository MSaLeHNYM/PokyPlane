# PokyPlane

A cozy, low-poly **browser flight simulator** built with Three.js. Every mesh, texture, and sound is generated procedurally — no GLB/GLTF models, no MP3s, no CDN asset packs.

## Run (game only)

```bash
npm install
npm run dev
```

## Full stack (PostgreSQL + API + auth)

1. Copy env and start database:

```bash
cp .env.example .env
npm run db:up
npm run db:migrate
```

2. Run game + API together:

```bash
npm run dev:all
```

Port **80** needs root on Linux. `npm run dev` tries 80 first, then **8080** automatically.

For true port 80:

```bash
sudo env VITE_GAME_PORT=80 npm run dev
# or full stack:
sudo env VITE_GAME_PORT=80 npm run dev:all
```

- Game: http://localhost (port 80) or http://localhost:8080 (fallback)
- Admin: http://localhost:7777/admin/

Default admin (change in `.env` before production):

| Field | Value |
|-------|-------|
| Email | `admin@pokyplane.local` |
| Password | `Admin123!` |

Production build:

```bash
npm run build
npm run preview
```

## Accounts & security

- **JWT access tokens** (short-lived) + **httpOnly refresh cookie**
- **Server-side session manager** in PostgreSQL — only **one active session per user** (one browser/device). Logging in elsewhere signs out the previous session.
- **Profiles**: 10 pilot avatars, country flag, gender, bio
- **Scoreboard**: global leaderboard (login to submit scores after flights)
- **Admin panel**: online players, all users, kick, ban user, ban IP, security audit log

Game works without login; scores and profile sync require an account.

## Controls (Ace Combat–style Standard)

| Input | Action |
|-------|--------|
| `A` / `←` | Nose LEFT (turn) |
| `D` / `→` | Nose RIGHT (turn) |
| `W` / `↑` | Nose DOWN (dive) |
| `S` / `↓` | Nose UP (climb / takeoff rotate) |
| `Q` / `E` | Roll wings |
| `Shift` | Speed up (throttle) |
| `X` / `Z` | Slow down / brake |
| `Space` | Boost |
| `1` / `2` / `3` / `4` | Select weapon (MG / Cannon / Rockets / Missiles) |
| `F` / Click | Fire |
| `C` | Cycle camera presets |
| `P` / `Esc` | Pause |

In multiplayer, the **host** can enable or disable each of the four weapons and optional **fuel limit** before hosting. When fuel limit is on, amber fuel cans spawn in the air (more / easier on Easy, scarcer on Hard).

Touch sticks appear automatically on mobile. Gamepad (first connected) is also supported for pitch/turn/throttle.

## Modes

- **Free Roam** — Open procedural terrain, day/night cycle, optional weather.
- **Ring Race** — Fly numbered gates. Best scores in `localStorage`.
- **Sky Combat** — Wave dogfights vs AI.
- **Multiplayer** — Host a match, copy the invite link (`?room=…`), friend opens it and you dogfight over WebRTC (PeerJS). Needs internet for signaling/STUN.

## Language

EN / FA toggle on the main menu (or Settings). Farsi uses **Vazirmatn** (Vazir) and RTL layout.

## Settings

**Simple** — language, quality, master volume, difficulty, smoke, FPS overlay.

**Advanced** tabs:
- **Graphics** — FPS cap, pixel ratio, shadows, AA, particles, fog
- **Sound** — master / engine / wind / SFX / music buses
- **Gameplay** — difficulty, camera, mouse look/sensitivity, invert pitch, shake, stall assist, weather, day/night, **keyboard remapping**
- **Language** — locale + editable **announcement banner** text (EN/FA)

## Announcement banner

Orange bar on the title screen. **Admins** edit the live banner at **http://localhost:7777/admin/** → **Announcement** (English + Farsi, enable/disable). All players see it on the main menu.

Settings → Advanced → Language still has a **local fallback** when the API is offline.

## License

MIT — have fun in the poky skies.
