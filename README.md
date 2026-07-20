<p align="center">
  <img src="public/logo.png" alt="PokyPlane logo" width="220" />
</p>

<h1 align="center">PokyPlane</h1>

<p align="center">
  <strong>A cozy, low-poly browser flight simulator</strong><br />
  Arcade skies · dogfights · procedural worlds · multiplayer · economy
</p>

<p align="center">
  <a href="https://pokyplane.liara.run"><img src="https://img.shields.io/badge/▶%20Play%20now-pokyplane.liara.run-1a4a7a?style=for-the-badge" alt="Play PokyPlane" /></a>
</p>

<p align="center">
  <a href="https://pokyplane.liara.run"><strong>https://pokyplane.liara.run</strong></a>
</p>

<p align="center">
  <em>Fly 8 planes across 5 procedural maps — dogfight AI or friends, unlock ammo & coins, spin the wheel of luck, and customize your loadout. EN/FA · PWA on mobile.</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Proprietary-red.svg" alt="Proprietary — All Rights Reserved" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white" alt="Node.js >=18" />
  <img src="https://img.shields.io/badge/Three.js-0.170-black?logo=three.js&logoColor=white" alt="Three.js" />
  <img src="https://img.shields.io/badge/PostgreSQL-database-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Express-API-000000?logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Vite-build-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/WebRTC-multiplayer-FF6B00?logo=webrtc&logoColor=white" alt="WebRTC" />
  <img src="https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white" alt="PWA" />
  <img src="https://img.shields.io/badge/Web%20Push-Android-3DDC84?logo=android&logoColor=white" alt="Web Push" />
  <img src="https://img.shields.io/badge/i18n-EN%20%7C%20FA-green" alt="English and Farsi" />
</p>

<p align="center">
  <img src="public/icon-512.png" alt="PokyPlane app icon" width="96" />
</p>

> Every mesh, texture, and sound is generated **procedurally** — no GLB/GLTF models, no MP3s, no CDN asset packs.

> **License:** Proprietary — personal local use only. [Contact the author](mailto:saleh.ue4@gmail.com) before deploying or using commercially.

---

## Table of contents

- [Features](#features)
- [Game modes](#game-modes)
- [Planes & weapons](#planes--weapons)
- [Economy & rewards](#economy--rewards)
- [Combat abilities](#combat-abilities)
- [Multiplayer & social](#multiplayer--social)
- [Controls](#controls)
- [Maps & world](#maps--world)
- [Settings & accessibility](#settings--accessibility)
- [Admin panel](#admin-panel)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Full stack setup](#full-stack-setup)
- [Deploy on Liara](#deploy-on-liara)
- [License](#license)

---

## Features

### Flight & gameplay

- **Ace Combat–style flight model** — pitch, turn, roll, throttle, boost, stall, spin recovery
- **8 unique low-poly planes** — each with distinct stats, silhouettes, and visible weapon hardpoints
- **4 weapon types** — machine gun (infinite), cannon, rockets, and homing missiles
- **Missile-only lock-on** — per-weapon crosshairs; animated lock diamond and range ring for missiles only
- **Procedural 3D worlds** — terrain, trees/rocks, water, day/night cycle, weather (rain/snow)
- **5 maps** — meadows, desert, arctic, islands, volcanic (each with wind, props, and territory size)
- **Airports & fuel drops** — optional fuel limit mode with aerial fuel cans
- **Radar minimap** — heading-up display with enemy/peer blips, airports, territory ring, and compass
- **HUD** — speed, altitude, heading, throttle, HP, fuel, weapon ammo, abilities, threat indicators
- **Touch controls** — dual sticks, fire, boost, weapon cycle, flare/dodge/reverse buttons (layout editor)
- **Gamepad support** — first connected controller for pitch/turn/throttle
- **Keyboard remapping** — full rebind support in Settings → Gameplay

### Economy & progression

- **In-game coins** — earned from playing (score, mode, flight time); no real money
- **Ammo inventory** — cannon, rocket, and missile counts persisted per account (MG stays infinite)
- **Daily reward** — claim coins + ammo once per UTC day
- **Wheel of Luck** — 1 free spin per day; extra spins from marketplace or admin grants
- **Marketplace** — buy ammo packs and wheel spins with coins
- **Armory panel** — 3D weapon preview with damage, speed, fire rate, range, homing, and owned ammo
- **Match reconciliation** — ammo spent in a match is synced to the server on score submit

### Multiplayer & social

- **WebRTC dogfights** — host/join via invite link (`?room=…`) using PeerJS
- **Lobby system** — host settings (weapons, fuel, difficulty, map, weather), chat, kick, start match
- **Friend invites** — send lobby invites from the friends list (20 s cooldown per friend)
- **Inbox** — friend requests, admin messages, lobby invites; filters, bulk actions, pinned locked messages
- **Friends list** — add/remove friends, online status
- **Global scoreboard** — leaderboard with login-required score submission
- **Pilot profiles** — 10 avatars, country flag, gender, bio

### Accounts & security

- **JWT access tokens** + **httpOnly refresh cookie**
- **Single active session** per user — logging in elsewhere signs out the previous session
- **Guest play** — no account required; economy and score sync need login

### PWA & mobile

- **Installable PWA** — landscape-only on phones/tablets
- **Service worker** — offline shell caching
- **Android Web Push** — admin can send notifications with custom or Persian sample messages

### Internationalization

- **English / Farsi (فارسی)** — menu toggle, RTL layout, Vazirmatn font
- **Bilingual admin** — announcement banner and push notification templates in EN + FA

---

## Game modes

| Mode | Description |
|------|-------------|
| **Free Roam** | Open procedural terrain — explore, fly, and practice combat |
| **Ring Race** | Fly numbered gate rings against the clock; best scores saved locally |
| **Sky Combat** | Wave-based dogfights vs AI enemies |
| **Multiplayer** | 1v1 WebRTC dogfight — host configures weapons, fuel, map, and difficulty |

---

## Planes & weapons

### Planes (8)

| Plane | Style |
|-------|-------|
| Poky | Starter all-rounder |
| Whale | Heavy, wide wingspan |
| Banana | Agile, quirky silhouette |
| Falcon | Fast interceptor |
| Moth | Light, nimble |
| Fortress | Tanky gunship |
| Loopy | Aerobatic stunt plane |
| Neon | Futuristic trim |

All planes can carry and fire all four weapons. Each plane shows visible hardpoints (MG pods, cannon, rocket pods, missiles) on the 3D model.

### Weapons (4)

| Weapon | Ammo | Notes |
|--------|------|-------|
| Machine Gun | ∞ | High fire rate, no lock-on |
| Cannon | Limited | Heavy hit, no lock-on |
| Rockets | Limited | Unguided, high damage |
| Missiles | Limited | Homing with lock-on reticle |

---

## Economy & rewards

| Feature | Details |
|---------|---------|
| **Coins** | Earned after each flight via score submit |
| **Daily reward** | Free coins + ammo pack once per UTC day |
| **Wheel of Luck** | Weighted prizes — coins, ammo, bonus spins |
| **Marketplace** | Buy ammo packs and extra wheel spins |
| **Armory** | Inspect weapons in 3D and view stats + owned ammo |
| **Admin grants** | Admins can grant coins, ammo, or spins to one user, many users, or everyone |

---

## Combat abilities

| Ability | Default key | Cooldown | Effect |
|---------|-------------|----------|--------|
| **Flares** | `G` | ~2 s | Deploy decoys that spoof incoming homing missiles |
| **Dodge** | `R` | ~4 s | Fast barrel roll with brief i-frames |
| **Quick reverse** | `V` | 10 s | Scripted Immelmann-style 180° turn — flip heading fast |

Touch buttons for all three abilities are available on mobile and can be repositioned in the touch layout editor.

---

## Multiplayer & social

- **Host a match** → share invite link or invite a friend directly to their inbox
- **Lobby chat** — text chat before and during match setup
- **Host controls** — enable/disable each weapon, fuel limit, difficulty, map seed, weather, day/night
- **Territory boundary** — soft push-back at map edge in MP
- **Inbox types** — friend requests, lobby invites, admin broadcasts (lock/pin support)
- **Push notifications** — Android PWA alerts for admin messages (when VAPID keys are configured)

---

## Controls

### Keyboard (defaults)

| Input | Action |
|-------|--------|
| `A` / `←` | Nose left (turn) |
| `D` / `→` | Nose right (turn) |
| `W` / `↑` | Nose down (dive) |
| `S` / `↓` | Nose up (climb) |
| `Q` / `E` | Roll wings |
| `Shift` | Throttle up |
| `X` / `Z` | Throttle down / brake |
| `Space` | Boost |
| `1`–`4` | Select weapon (MG / Cannon / Rockets / Missiles) |
| `F` | Fire |
| `T` | Target lock (missiles) |
| `G` | Deploy flares |
| `R` | Dodge roll |
| `V` | Quick reverse |
| `C` | Cycle camera |
| `P` / `Esc` | Pause |

Touch sticks appear automatically on mobile. Gamepad (first connected) is supported for pitch, turn, and throttle.

---

## Maps & world

| Map | Theme |
|-----|-------|
| Green Meadows | Rolling hills, forests |
| Sunscar Desert | Sand dunes, cactus |
| Frostbite Peaks | Snow, pine forests |
| Coral Archipelago | Tropical islands, palms |
| Ember Crater | Volcanic lava, rocky terrain |

Each map has unique wind, water level, props, territory radius, and procedural terrain profile. World seed can be shared for identical multiplayer worlds.

---

## Settings & accessibility

**Simple** — language, quality, master volume, difficulty, smoke trail, FPS overlay

**Advanced tabs:**

- **Graphics** — FPS cap, pixel ratio, shadows, anti-aliasing, particles, fog
- **Sound** — master / engine / wind / SFX / music buses
- **Gameplay** — difficulty, camera, mouse look & sensitivity, invert pitch, camera shake, stall assist, weather, day/night, keyboard remapping
- **Language** — locale + local announcement banner fallback (EN/FA)
- **Touch layout** — drag-resize all on-screen buttons including ability buttons

---

## Admin panel

Available at `/admin/` when the API server is running.

| Tab | Purpose |
|-----|---------|
| **Online** | Live connected players, kick |
| **Users** | Search, ban, role management |
| **Announcement** | Global EN/FA banner on the main menu |
| **Messages** | Send inbox messages (single user or broadcast), lock/pin, bulk delete/resend |
| **Android Push** | Web Push notifications with Persian sample templates |
| **Rewards** | Grant coins, ammo, or wheel spins (single / multi / all users) |
| **IP Bans** | Block abusive IPs |
| **Security Log** | Audit trail |

Default admin (change in `.env` before production):

| Field | Value |
|-------|-------|
| Email | `admin@pokyplane.local` |
| Password | `Admin123!` |

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Renderer | Three.js (procedural meshes) |
| Build | Vite 6 |
| Server | Express + PostgreSQL |
| Auth | JWT + httpOnly refresh cookies |
| Multiplayer | PeerJS / WebRTC |
| Push | web-push (VAPID) |
| PWA | Service worker + Web App Manifest |
| Deploy | Liara (Node.js) |

---

## Quick start

**Live game:** [https://pokyplane.liara.run](https://pokyplane.liara.run)  
**Admin panel (production):** [https://pokyplane.liara.run/admin/](https://pokyplane.liara.run/admin/)

Game only (local dev, no accounts or leaderboard):

```bash
npm install
npm run dev
```

Open **http://localhost** (port 80) or **http://localhost:8080** (automatic fallback).

Production build:

```bash
npm run build
```

---

## Full stack setup

1. Copy env and start the database:

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

| URL | Service |
|-----|---------|
| http://localhost (or :8080) | Game |
| http://localhost:7777/admin/ | Admin panel |

Generate VAPID keys for Android push:

```bash
npm run vapid:generate
```

Add the output to `.env` as `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.

Production:

```bash
npm run build
NODE_ENV=production PORT=3000 DATABASE_URL=... npm start
```

---

## Deploy on Liara

1. Create a **PostgreSQL** database in Liara and copy its connection URI.
2. Set environment variables:

| Variable | Example |
|----------|---------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db` |
| `NODE_ENV` | `production` |
| `CLIENT_ORIGIN` | `https://pokyplane.liara.run` |
| `JWT_ACCESS_SECRET` | long random string |
| `JWT_REFRESH_SECRET` | long random string |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | your admin login |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | for Android push (optional) |

3. Deploy:

```bash
liara deploy
```

`npm start` serves the Vite build from Express on the app port (default **3000**). Do not use `dev` / Vite on Liara.

---

## Tags

`flight-simulator` `threejs` `webgl` `browser-game` `pwa` `multiplayer` `webrtc` `dogfight` `procedural-generation` `low-poly` `arcade` `postgresql` `express` `vite` `game` `javascript` `farsi` `i18n` `economy` `web-push`

---

## License

**Proprietary — All Rights Reserved.** This project is **not** open source.

You may view the code and run it **locally for personal, non-commercial use** only.

**You may not** deploy it publicly, host it for others, redistribute it, or make money from it **without written permission**.

To request a license (deployment, commercial use, etc.):

| | |
|---|---|
| **Email** | [saleh.ue4@gmail.com](mailto:saleh.ue4@gmail.com) |
| **GitHub** | [@MSaLeHNYM](https://github.com/MSaLeHNYM) |

See [LICENSE](LICENSE) for full terms.
