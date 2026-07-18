import { Router } from 'express';
import { query } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { upsertPresence, setPresenceOffline } from '../models/user.js';

const router = Router();

router.post('/heartbeat', authMiddleware, async (req, res, next) => {
  try {
    const { status = 'online', gameMode, mapId } = req.body || {};
    await upsertPresence(req.auth.userId, req.sessionId, {
      status,
      gameMode,
      mapId,
      ip: req.clientIp,
      userAgent: req.headers['user-agent'],
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/offline', authMiddleware, async (req, res, next) => {
  try {
    await setPresenceOffline(req.auth.userId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
