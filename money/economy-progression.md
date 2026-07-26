---
name: economy-progression
description: PokyPlane's economy, progression, and reward systems including coins, ammo, daily rewards, and marketplace
metadata:
  type: project
---

# PokyPlane Economy & Progression Systems

PokyPlane features a rich offline economy and progression system centered around in-game coins and ammunition management.

## Core Economy

### In-Game Coins
- **Earned** after each flight via score submission
- Based on performance metrics (score, game mode, flight time)
- **No real money transactions** - purely in-game currency
- Used for marketplace purchases

### Ammo Inventory
- **Persisted per account** (server-side storage)
- **Weapon Types**:
  - Machine Gun (MG): **Infinite ammo** - no limitations
  - Cannon: Limited ammo, high damage
  - Rockets: Limited ammo, high explosive damage
  - Missiles: Limited ammo, homing capability
- Tracked separately for each limited weapon type

## Reward Systems

### Daily Reward
- **Available** once per UTC day
- **Rewards**: Coins + ammo pack
- Encourages daily engagement
- Server-tracked to prevent abuse

### Wheel of Luck
- **Free spin**: 1 per day
- **Additional Spins**: 
  - Purchased from marketplace
  - Granted by admins
- **Weighted Prize Wheel**:
  - Coin rewards
  - Ammo packs
  - Bonus spins
  - Various other prizes

### Marketplace
- **Purchases** made with in-game coins:
  - Ammo packs for limited weapons
  - Extra Wheel of Luck spins
- **Admin Grants**:
  - Administrators can grant coins, ammo, or spins
  - To individual users, multiple users, or everyone
  - Used for events, rewards, or compensation

### Armory Panel
- 3D weapon preview interface
- Shows weapon statistics:
  - Damage
  - Speed
  - Fire rate
  - Range
  - Homing capability (for missiles)
- Displays currently owned ammunition
- Helps inform purchase decisions

### Match Reconciliation
- Ammunition spent during matches is tracked
- Synced to server upon score submission
- Prevents ammo duplication or loss
- Maintains economy integrity

## Progression & Unlock Systems

### Smoke Trail Colors
- Unlockable cosmetic item
- Stored in localStorage (`pokyplane_unlocks`)
- Default: "white" trail
- Additional colors obtainable through gameplay/rewards
- Persistent across sessions

### Score-Based Unlocks
- Implied progression through high scores
- Best times/scores stored per game mode
- LocalStorage keys: `pokyplane_best_{mode}`

## Technical Implementation
- **Backend**: 
  - Economy models in `server/models/economy.js`
  - User data persisted in PostgreSQL database
  - JWT authentication for secure transactions
- **Frontend**:
  - LocalStorage for client-side preferences/unlocks
  - API service in `src/api.js` for server communication
  - UI components scattered throughout src/ directory

The economy system provides meaningful progression without pay-to-win elements, focusing on skill-based earning and cosmetic/customization rewards.