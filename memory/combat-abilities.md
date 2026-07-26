---
name: combat-abilities
description: PokyPlane's combat abilities system including flares, dodge roll, and quick reverse maneuvers
metadata:
  type: project
---

# PokyPlane Combat Abilities System

PokyPlane features three special combat abilities that give players tactical advantages in dogfights and evasion maneuvers.

## Available Abilities

### 1. Flares (Default Key: `G`)
- **Cooldown**: ~2 seconds
- **Function**: Deploy decoys that spoof incoming homing missiles
- **Mechanism**: 
  - Creates heat signature targets that divert missile locks
  - Effective against missile weapons only
  - Limited effectiveness based on missile proximity and aspect angle
- **Tactical Use**: 
  - Emergency evasion when missile lock is detected
  - Can break enemy missile lock to create counter-attack opportunity
  - Strategic use prevents wasting flares when no threat exists

### 2. Dodge Roll (Default Key: `R`)
- **Cooldown**: ~4 seconds
- **Function**: Fast barrel roll with brief invulnerability frames
- **Mechanism**:
  - Quick 360-degree roll maneuver
  - Provides temporary invulnerability during animation
  - High energy maneuver that affects aircraft energy state
- **Tactical Use**:
  - Evade gunfire (cannon, machine gun) and unguided rockets
  - Break enemy gun tracking
  - Create angle reversal for counter-attack
  - Can be chained with other maneuvers for complex evasion

### 3. Quick Reverse (Default Key: `V`)
- **Cooldown**: 10 seconds
- **Function**: Scripted Immelmann-style 180° turn to reverse direction rapidly
- **Mechanism**:
  - Half-loop followed by half-roll to invert direction
  - Preserves more energy than a flat 180° turn
  - Results in immediate altitude gain and direction reversal
  - Longer cooldown reflects significant energy cost
- **Tactical Use**:
  - Reverse engagement direction quickly
  - Escape from pursuers by changing to head-on pass
  - Set up high-side guns shots after reversal
  - Energy management trade-off: altitude gain for rapid repositioning

## Implementation Details

### Input System
- Keyboard defaults configurable in Settings → Gameplay
- Touch screen equivalents available on mobile devices
- Layout editor allows repositioning of touch buttons
- Gamepad support for primary flight controls (buttons may be mappable)

### Visual & Audio Feedback
- Distinct visual effects for each ability activation
- Audio cues for activation and cooldown completion
- HUD indicators showing ability readiness
- Mobile touch buttons show cooldown overlays

### Tactical Considerations
- **Energy Management**: All abilities affect aircraft energy state differently
  - Flares: Minimal energy cost
  - Dodge Roll: Moderate energy cost, temporary speed loss
  - Quick Reverse: Significant energy trade (speed for altitude)
- **Cooldown Management**: Strategic ability usage prevents predictability
- **Ability Combination**: Skilled players chain abilities for complex maneuvers
  - Example: Dodge to break lock → Flare to confirm safety → Quick Reverse to re-engage

### Balance Considerations
- Different cooldowns prevent ability spam
- Each ability counters specific threats:
  - Flares → Missiles
  - Dodge → Guns/rockets
  - Reverse → Positional disadvantage
- Encourages skill development and situational awareness
- Available to all aircraft equally (no ability-locking to specific planes)

These abilities create a skill ceiling beyond basic flying, rewarding players who master the timing and combination of these tactical options in conjunction with proper flight fundamentals.