import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  listFriends,
  listRequests,
  lookupUsers,
  sendFriendRequest,
  acceptFriendRequest,
  denyFriendRequest,
  removeFriend,
  sendLobbyInvite,
} from '../models/friends.js';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req, res, next) => {
  try {
    const friends = await listFriends(req.auth.userId);
    res.json({ friends });
  } catch (e) {
    next(e);
  }
});

router.get('/requests', async (req, res, next) => {
  try {
    const data = await listRequests(req.auth.userId);
    res.json(data);
  } catch (e) {
    next(e);
  }
});

router.get('/lookup', async (req, res, next) => {
  try {
    const users = await lookupUsers(req.query.q, req.auth.userId, req.query.limit);
    res.json({ users });
  } catch (e) {
    next(e);
  }
});

router.post('/request', async (req, res, next) => {
  try {
    const request = await sendFriendRequest(req.auth.userId, req.body || {});
    res.status(201).json({ request });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.code || 'error', message: e.message });
    next(e);
  }
});

router.post('/requests/:id/accept', async (req, res, next) => {
  try {
    const result = await acceptFriendRequest(req.auth.userId, req.params.id);
    res.json(result);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.code || 'error', message: e.message });
    next(e);
  }
});

router.post('/requests/:id/deny', async (req, res, next) => {
  try {
    const result = await denyFriendRequest(req.auth.userId, req.params.id);
    res.json(result);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.code || 'error', message: e.message });
    next(e);
  }
});

router.delete('/:friendId', async (req, res, next) => {
  try {
    const result = await removeFriend(req.auth.userId, req.params.friendId);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post('/:friendId/lobby-invite', async (req, res, next) => {
  try {
    const { roomId, inviteUrl } = req.body || {};
    const message = await sendLobbyInvite(req.auth.userId, req.params.friendId, {
      roomId,
      inviteUrl,
    });
    res.status(201).json({ message });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.code || 'error', message: e.message });
    next(e);
  }
});

export default router;
