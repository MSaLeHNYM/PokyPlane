# PokyPlane

A cozy, low-poly **browser flight simulator** built with Three.js. Every mesh, texture, and sound is generated procedurally — no GLB/GLTF models, no MP3s, no CDN asset packs.

## Run

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

Production build:

```bash
npm run build
npm run preview
```

## Controls (Ace Combat–style Standard)

| Input | Action |
|-------|--------|
| `A` / `←` | Nose LEFT (turn) |
| `D` / `→` | Nose RIGHT (turn) |
| `W` / `↑` | Nose DOWN (dive) |
| `S` / `↓` | Nose UP (climb / takeoff rotate) |
| `Q` / `E` | Roll wings |
| `Shift` | Speed up (throttle) |
| `Ctrl` / `Z` | Slow down |
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
- **Gameplay** — difficulty, camera, mouse look/sensitivity, invert pitch, shake, stall assist, weather, day/night
- **Language** — locale + editable **announcement banner** text (EN/FA)

## Announcement banner

Orange bar on the title screen. Edit copy under Settings → Advanced → Language. Players can dismiss it for the session.

## License

MIT — have fun in the poky skies.
