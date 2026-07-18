import { Router } from 'express';

const router = Router();

/** In-memory host presence (best-effort; helps guests wait for a live host). */
const rooms = new Map();
const TTL_MS = 15000;

function purge() {
  const now = Date.now();
  for (const [id, ts] of rooms) {
    if (now - ts > TTL_MS) rooms.delete(id);
  }
}

router.post('/heartbeat', (req, res) => {
  const roomId = String(req.body?.roomId || '')
    .trim()
    .toLowerCase();
  if (!roomId || roomId.length > 64 || !/^[a-z0-9_-]+$/i.test(roomId)) {
    return res.status(400).json({ error: 'invalid_room' });
  }
  rooms.set(roomId, Date.now());
  if (rooms.size > 500) purge();
  res.json({ ok: true });
});

router.get('/room/:id', (req, res) => {
  purge();
  const roomId = String(req.params.id || '')
    .trim()
    .toLowerCase();
  const ts = rooms.get(roomId);
  const alive = !!(ts && Date.now() - ts < TTL_MS);
  res.json({ alive, roomId });
});

export default router;
