import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getState,
  claimDaily,
  spinWheel,
  buyMarketItem,
} from '../models/economy.js';

const router = Router();

function handle(e, res, next) {
  if (e.status) return res.status(e.status).json({ error: e.code || 'error', message: e.message });
  next(e);
}

router.get('/state', authMiddleware, async (req, res, next) => {
  try {
    res.json({ state: await getState(req.auth.userId) });
  } catch (e) {
    handle(e, res, next);
  }
});

router.post('/daily/claim', authMiddleware, async (req, res, next) => {
  try {
    const { reward } = await claimDaily(req.auth.userId);
    res.json({ reward, state: await getState(req.auth.userId) });
  } catch (e) {
    handle(e, res, next);
  }
});

router.post('/wheel/spin', authMiddleware, async (req, res, next) => {
  try {
    const result = await spinWheel(req.auth.userId);
    res.json({ ...result, state: await getState(req.auth.userId) });
  } catch (e) {
    handle(e, res, next);
  }
});

router.post('/market/buy', authMiddleware, async (req, res, next) => {
  try {
    const { itemId } = req.body || {};
    const { item } = await buyMarketItem(req.auth.userId, String(itemId || ''));
    res.json({ item, state: await getState(req.auth.userId) });
  } catch (e) {
    handle(e, res, next);
  }
});

export default router;
