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

/** Host → friend lobby invite cooldown (ms), per friend. */
const LOBBY_INVITE_COOLDOWN_MS = 20_000;
/** @type {Map<string, number>} key = `${fromUserId}:${friendId}` */
const lobbyInviteCooldownUntil = new Map();

function lobbyInviteCooldownKey(userId, friendId) {
  return `${userId}:${friendId}`;
}

function assertLobbyInviteCooldown(userId, friendId) {
  const until = lobbyInviteCooldownUntil.get(lobbyInviteCooldownKey(userId, friendId)) || 0;
  const now = Date.now();
  if (until > now) {
    const err = new Error(
      `Please wait ${Math.ceil((until - now) / 1000)}s before inviting this friend again.`
    );
    err.code = 'cooldown';
    err.status = 429;
    err.retryAfterSec = Math.ceil((until - now) / 1000);
    throw err;
  }
}

function markLobbyInviteCooldown(userId, friendId) {
  lobbyInviteCooldownUntil.set(
    lobbyInviteCooldownKey(userId, friendId),
    Date.now() + LOBBY_INVITE_COOLDOWN_MS
  );
}

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
    assertLobbyInviteCooldown(req.auth.userId, req.params.friendId);
    const { roomId, inviteUrl } = req.body || {};
    const message = await sendLobbyInvite(req.auth.userId, req.params.friendId, {
      roomId,
      inviteUrl,
    });
    markLobbyInviteCooldown(req.auth.userId, req.params.friendId);
    res.status(201).json({
      message,
      cooldownSec: LOBBY_INVITE_COOLDOWN_MS / 1000,
    });
  } catch (e) {
    if (e.status) {
      return res.status(e.status).json({
        error: e.code || 'error',
        message: e.message,
        retryAfterSec: e.retryAfterSec,
      });
    }
    next(e);
  }
});

export default router;
