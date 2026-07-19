import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  listInbox,
  countUnread,
  markInboxRead,
  deleteInboxMessages,
  consumeLobbyInvite,
  consumeLobbyInvitesForRoom,
} from '../models/inbox.js';

const router = Router();
router.use(authMiddleware);

router.get('/', async (req, res, next) => {
  try {
    const unreadOnly = String(req.query.unreadOnly || '') === '1' || req.query.unreadOnly === 'true';
    const messages = await listInbox(req.auth.userId, {
      limit: req.query.limit,
      unreadOnly,
    });
    const unreadCount = await countUnread(req.auth.userId);
    res.json({ messages, unreadCount });
  } catch (e) {
    next(e);
  }
});

router.get('/unread-count', async (req, res, next) => {
  try {
    const unreadCount = await countUnread(req.auth.userId);
    res.json({ unreadCount });
  } catch (e) {
    next(e);
  }
});

router.post('/read', async (req, res, next) => {
  try {
    const ids = req.body?.ids || [];
    const updated = await markInboxRead(req.auth.userId, ids, true);
    const unreadCount = await countUnread(req.auth.userId);
    res.json({ updated, unreadCount });
  } catch (e) {
    next(e);
  }
});

router.post('/unread', async (req, res, next) => {
  try {
    const ids = req.body?.ids || [];
    const updated = await markInboxRead(req.auth.userId, ids, false);
    const unreadCount = await countUnread(req.auth.userId);
    res.json({ updated, unreadCount });
  } catch (e) {
    next(e);
  }
});

router.post('/delete', async (req, res, next) => {
  try {
    const ids = req.body?.ids || [];
    const result = await deleteInboxMessages(req.auth.userId, ids);
    const unreadCount = await countUnread(req.auth.userId);
    res.json({ ...result, unreadCount });
  } catch (e) {
    next(e);
  }
});

/** After joining a lobby from inbox: remove that invite (and any dupes for the room). */
router.post('/consume-lobby-invite', async (req, res, next) => {
  try {
    const { id, roomId } = req.body || {};
    let deleted = 0;
    if (id) {
      deleted += (await consumeLobbyInvite(req.auth.userId, id)).deleted;
    }
    if (roomId) {
      deleted += (await consumeLobbyInvitesForRoom(req.auth.userId, roomId)).deleted;
    }
    const unreadCount = await countUnread(req.auth.userId);
    res.json({ deleted, unreadCount });
  } catch (e) {
    next(e);
  }
});

export default router;
