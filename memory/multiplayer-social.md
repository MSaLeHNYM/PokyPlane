---
name: multiplayer-social
description: PokyPlane's multiplayer and social systems including WebRTC, lobbies, and friend system
metadata:
  type: project
---

# PokyPlane Multiplayer & Social Systems

PokyPlane features robust multiplayer and social systems built around WebRTC technology.

## Multiplayer System (WebRTC/PeerJS)

### Core Technology
- **PeerJS** wrapper for WebRTC connections
- Peer-to-peer connections between players
- Host/client architecture for match hosting

### Lobby System
- **Host Controls**: 
  - Weapon toggle (enable/disable each weapon type)
  - Fuel limit mode (on/off)
  - Difficulty settings
  - Map selection
  - Weather control
  - Day/night cycle setting
- **Lobby Chat**: Text communication before and during match setup
- **Friend Invites**: 
  - Send lobby invites directly from friends list
  - 20-second cooldown per friend to prevent spam
- **Match Controls**:
  - Host can kick players
  - Host starts match when ready
  - Territory boundary with soft push-back at map edges

### In-Game Multiplayer
- 1v1 WebRTC dogfights (current implementation)
- Real-time position and state synchronization
- Hit detection and damage application
- Score synchronization at match end

## Social Features

### Friends System
- Add/remove friends
- Online status indicators
- Friend requests management
- Inbox for friend requests and messages

### Inbox System
- **Message Types**:
  - Friend requests
  - Lobby invitations
  - Admin broadcasts (can be locked/pinned)
- **Features**:
  - Filtering capabilities
  - Bulk actions (delete/resend)
  - Message pinning/locking for important communications
  - Persistent storage across sessions

### Global Features
- **Global Scoreboard**: Leaderboard with login-required score submission
- **Pilot Profiles**:
  - 10 avatar options
  - Country flag display
  - Gender selection
  - Custom bio/description
- **Push Notifications** (Android PWA):
  - Admin-sent notifications
  - Custom or Persian sample messages
  - Requires VAPID key configuration

### Technical Implementation
- Located in server routes:
  - `server/routes/friends.js`
  - `server/routes/inbox.js`
  - `server/routes/presence.js`
  - `server/routes/mp.js` (multiplayer)
- Corresponding client-side APIs in:
  - Likely `api.js` for communication
  - UI components in various modules

These systems create a persistent social layer that enhances the core flight gameplay with community and competitive elements.