---
name: project-overview
description: Overview of the PokyPlane project structure and features
metadata:
  type: project
---

# PokyPlane Project Overview

PokyPlane is a browser-based flight simulator game built with Three.js, featuring procedural generation, multiplayer capabilities, and an in-game economy.

## Key Features

- **Procedural Generation**: All meshes, textures, and sounds are generated procedurally - no external asset packs
- **Game Modes**: Free Roam, Ring Race (time trial), Sky Combat (AI dogfights), Multiplayer (WebRTC dogfights)
- **Aircraft**: 8 unique low-poly planes with visible weapon hardpoints
- **Weapons**: 4 weapon types (machine gun infinite ammo, cannon, rockets, homing missiles)
- **Economy System**: In-game coins, ammo inventory, daily rewards, Wheel of Luck, Marketplace
- **Multiplayer**: WebRTC-based dogfights via PeerJS with lobby system, chat, and friend invites
- **Admin Panel**: User management, announcements, push notifications, reward distribution
- **PWA Support**: Installable Progressive Web App with offline capabilities and Android push notifications
- **Internationalization**: English/Farsi support with RTL layout

## Technical Stack

- **Renderer**: Three.js (procedural meshes)
- **Build**: Vite 6
- **Server**: Express + PostgreSQL
- **Authentication**: JWT + httpOnly refresh cookies
- **Multiplayer**: PeerJS / WebRTC
- **Push Notifications**: web-push (VAPID)
- **PWA**: Service worker + Web App Manifest
- **Deployment**: Liara (Node.js)

## Project Structure

- `src/`: Client-side game logic (planes, weapons, terrain, HUD, game modes, etc.)
- `server/`: Server-side code (API routes, models, middleware, database)
- `shared/`: Shared resources (currently just ui-theme.css)
- `public/`: Static assets
- `dist/`: Built production files

Key client modules include: plane.js, weapons.js, terrain.js, physics.js, controls.js, hud.js, modes.js (game modes), maps.js, fuel.js, airports.js, avatars.js, sound.js, particles.js, noise.js, settings.js, i18n.js, matchmaking.js, api.js, main.js

The game emphasizes accessibility with keyboard remapping, gamepad support, touch controls with layout editor, and various accessibility options in settings.