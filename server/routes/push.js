import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getVapidPublicKey,
  isPushConfigured,
  upsertSubscription,
  removeSubscription,
} from '../models/push.js';

const router = Router();

router.get('/vapid-public-key', (_req, res) => {
  if (!isPushConfigured()) {
    return res.status(503).json({
      error: 'push_unconfigured',
      message: 'Push notifications are not configured.',
    });
  }
  res.json({ publicKey: getVapidPublicKey() });
});

router.post('/subscribe', authMiddleware, async (req, res, next) => {
  try {
    const row = await upsertSubscription(
      req.auth.userId,
      req.body?.subscription || req.body,
      req.get('user-agent') || null
    );
    res.status(201).json({ ok: true, id: row.id });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.code || 'error', message: e.message });
    next(e);
  }
});

router.delete('/subscribe', authMiddleware, async (req, res, next) => {
  try {
    const endpoint = req.body?.endpoint;
    const result = await removeSubscription(endpoint, req.auth.userId);
    res.json({ ok: true, ...result });
  } catch (e) {
    next(e);
  }
});

export default router;
