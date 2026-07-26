---
name: game-modes
description: Details about PokyPlane's game modes implemented in src/modes.js
metadata:
  type: project
---

# PokyPlane Game Modes

The game modes are implemented in `src/modes.js` and include:

## Ring Race (Time Trial)
- Players fly through numbered rings in sequence against the clock
- Features:
  - Spiral path of rings starting near the runway
  - Time bonuses for passing through rings (+5 seconds)
  - Score based on rings passed + remaining time
  - Visual feedback: active ring is yellow/gold, completed rings turn gray
  - 60-second timer that extends with each ring passed
  - Failure when time runs out
  - Completion when all rings are passed

## Sky Combat (AI Dogfights)
- Wave-based dogfights against AI enemy fighters
- Features:
  - Waves increase in enemy count (wave number + 2 enemies)
  - Enemies spawn in a circle around the player at distance (320 + wave*45 units)
  - Enemy planes have different skins/types from a predefined list
  - Enemy AI pursues player with simple steering behaviors
  - Enemy firing mechanics with bullet pooling
  - Enemy flare countermeasures against homing missiles
  - Player can shoot enemies and earn points per kill
  - Wave starts automatically when player becomes airborne

## Shared Systems
Both modes use:
- Bullet pooling system for efficiency
- Flare/decoy system for missile countermeasures
- HUD updates for score/time
- Cleanup mechanisms to prevent memory leaks

The modes are designed to be modular and extensible for additional game types.