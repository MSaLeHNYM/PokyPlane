import { Router } from 'express';

const router = Router();

/** In-memory host presence (helps guests know a lobby is still open). */
const rooms = new Map();

/** No heartbeat for this long → room is dead. */
const HEARTBEAT_STALE_MS = 12_000;
/** Host alone in lobby (no guest) for this long → room is destroyed. */
const LOBBY_EMPTY_MS = 30_000;

function normalizeRoomId(raw) {
  const roomId = String(raw || '')
    .trim()
    .toLowerCase();
  if (!roomId || roomId.length > 64 || !/^[a-z0-9_-]+$/i.test(roomId)) return null;
  return roomId;
}

function isRoomAlive(room, now = Date.now()) {
  if (!room) return false;
  if (now - room.lastBeat > HEARTBEAT_STALE_MS) return false;
  if (!room.guestConnected && room.emptySince != null && now - room.emptySince >= LOBBY_EMPTY_MS) {
    return false;
  }
  return true;
}

function purge(now = Date.now()) {
  for (const [id, room] of rooms) {
    if (!isRoomAlive(room, now)) rooms.delete(id);
  }
}

function upsertRoom(roomId, guestConnected, now = Date.now()) {
  const hasGuest = !!guestConnected;
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      lastBeat: now,
      guestConnected: hasGuest,
      emptySince: hasGuest ? null : now,
    };
  } else {
    room.lastBeat = now;
    if (hasGuest) {
      room.guestConnected = true;
      room.emptySince = null;
    } else {
      room.guestConnected = false;
      if (room.emptySince == null) room.emptySince = now;
    }
  }
  rooms.set(roomId, room);
  return room;
}

setInterval(() => purge(), 5000);

router.post('/heartbeat', (req, res) => {
  const roomId = normalizeRoomId(req.body?.roomId);
  if (!roomId) return res.status(400).json({ error: 'invalid_room' });

  const guestConnected = !!req.body?.guestConnected;
  const room = upsertRoom(roomId, guestConnected);
  purge();

  res.json({
    ok: true,
    alive: isRoomAlive(room),
    emptyForMs: room.emptySince ? Date.now() - room.emptySince : 0,
  });
});

router.post('/leave', (req, res) => {
  const roomId = normalizeRoomId(req.body?.roomId);
  if (!roomId) return res.status(400).json({ error: 'invalid_room' });
  rooms.delete(roomId);
  res.json({ ok: true });
});

router.get('/room/:id', (req, res) => {
  purge();
  const roomId = normalizeRoomId(req.params.id);
  if (!roomId) return res.status(400).json({ error: 'invalid_room' });
  const room = rooms.get(roomId);
  const alive = isRoomAlive(room);
  if (!alive) rooms.delete(roomId);
  res.json({
    alive,
    roomId,
    guestConnected: !!room?.guestConnected,
    emptyForMs: room?.emptySince ? Date.now() - room.emptySince : null,
  });
});

export default router;
