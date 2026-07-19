import { Router } from 'express';
import { query } from '../db.js';
import { authMiddleware, adminMiddleware, getClientIp } from '../middleware/auth.js';
import {
  findUserById,
  publicUser,
  logSecurityEvent,
} from '../models/user.js';
import {
  revokeAllUserSessions,
} from '../services/sessionManager.js';
import { config } from '../config.js';
import { COUNTRIES, PROFILE_AVATARS } from '../config.js';
import { getAnnouncement, upsertAnnouncement } from '../models/announcement.js';
import {
  createInboxMessage,
  broadcastAdminMessage,
  listRecentAdminSends,
  forceDeleteInboxByIds,
  forceDeleteAdminBatch,
} from '../models/inbox.js';
import {
  sendPushNotification,
  countSubscriptions,
  isPushConfigured,
  ensurePushConfigured,
} from '../models/push.js';

const router = Router();

router.use(authMiddleware, adminMiddleware);

router.get('/stats', async (_req, res, next) => {
  try {
    const ttl = config.presence.onlineTtlSec;
    const [users, online, banned, scores, events] = await Promise.all([
      query(`SELECT COUNT(*)::int AS c FROM users`),
      query(
        `SELECT COUNT(*)::int AS c FROM user_presence
         WHERE status != 'offline' AND updated_at > NOW() - ($1 || ' seconds')::interval`,
        [ttl]
      ),
      query(`SELECT COUNT(*)::int AS c FROM users WHERE is_banned = TRUE`),
      query(`SELECT COUNT(*)::int AS c FROM scores`),
      query(`SELECT COUNT(*)::int AS c FROM security_events WHERE created_at > NOW() - interval '24 hours'`),
    ]);
    res.json({
      totalUsers: users.rows[0].c,
      onlinePlayers: online.rows[0].c,
      bannedUsers: banned.rows[0].c,
      totalScores: scores.rows[0].c,
      securityEvents24h: events.rows[0].c,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/online', async (_req, res, next) => {
  try {
    const ttl = config.presence.onlineTtlSec;
    const { rows } = await query(
      `SELECT p.*, u.username, u.display_name, u.profile_avatar, u.country_code, u.role,
              s.ip_address AS session_ip, s.user_agent AS session_ua, s.device_fingerprint, s.last_seen_at
       FROM user_presence p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN sessions s ON s.id = p.session_id AND s.is_active = TRUE
       WHERE p.status != 'offline' AND p.updated_at > NOW() - ($1 || ' seconds')::interval
       ORDER BY p.updated_at DESC`,
      [ttl]
    );
    res.json({
      players: rows.map((r) => ({
        userId: r.user_id,
        username: r.username,
        displayName: r.display_name,
        profileAvatar: r.profile_avatar,
        countryCode: r.country_code,
        role: r.role,
        status: r.status,
        gameMode: r.game_mode,
        mapId: r.map_id,
        ip: r.ip_address || r.session_ip,
        userAgent: r.user_agent || r.session_ua,
        deviceFingerprint: r.device_fingerprint,
        lastSeen: r.updated_at,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/users', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(200, Math.max(20, Number(req.query.limit) || 100));
    let sql = `SELECT id, email, username, role, is_banned, ban_reason, display_name, profile_avatar,
                      country_code, gender, created_at, last_login_at
               FROM users`;
    const params = [];
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      sql += ` WHERE LOWER(username) LIKE $1 OR LOWER(email) LIKE $1`;
    }
    params.push(limit);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    const { rows } = await query(sql, params);
    res.json({ users: rows.map(publicUser) });
  } catch (e) {
    next(e);
  }
});

router.post('/users/:id/ban', async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    const targetId = req.params.id;
    if (targetId === req.auth.userId) {
      return res.status(400).json({ error: 'validation', message: 'Cannot ban yourself.' });
    }
    await query(
      `UPDATE users SET is_banned = TRUE, ban_reason = $2, banned_at = NOW(), banned_by = $3, updated_at = NOW()
       WHERE id = $1`,
      [targetId, reason || 'Banned by admin', req.auth.userId]
    );
    await revokeAllUserSessions(targetId, 'banned');
    await logSecurityEvent('admin_ban_user', {
      userId: req.auth.userId,
      targetUserId: targetId,
      ip: getClientIp(req),
      details: { reason },
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/users/:id/unban', async (req, res, next) => {
  try {
    const targetId = req.params.id;
    await query(
      `UPDATE users SET is_banned = FALSE, ban_reason = NULL, banned_at = NULL, banned_by = NULL, updated_at = NOW()
       WHERE id = $1`,
      [targetId]
    );
    await logSecurityEvent('admin_unban_user', {
      userId: req.auth.userId,
      targetUserId: targetId,
      ip: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/users/:id/kick', async (req, res, next) => {
  try {
    const targetId = req.params.id;
    await revokeAllUserSessions(targetId, 'admin_kick');
    await query(
      `UPDATE user_presence SET status = 'offline', updated_at = NOW() WHERE user_id = $1`,
      [targetId]
    );
    await logSecurityEvent('admin_kick', {
      userId: req.auth.userId,
      targetUserId: targetId,
      ip: getClientIp(req),
    });
    res.json({ ok: true, message: 'User session revoked.' });
  } catch (e) {
    next(e);
  }
});

router.post('/ip-ban', async (req, res, next) => {
  try {
    const { ip, reason, expiresInHours } = req.body || {};
    if (!ip) return res.status(400).json({ error: 'validation', message: 'IP required.' });

    const expiresAt = expiresInHours
      ? new Date(Date.now() + Number(expiresInHours) * 3600000)
      : null;

    await query(
      `INSERT INTO ip_bans (ip_address, reason, banned_by, expires_at) VALUES ($1::inet, $2, $3, $4)`,
      [ip, reason || 'Banned by admin', req.auth.userId, expiresAt]
    );
    await logSecurityEvent('admin_ip_ban', {
      userId: req.auth.userId,
      ip: getClientIp(req),
      details: { bannedIp: ip, reason, expiresAt },
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.delete('/ip-ban/:ip', async (req, res, next) => {
  try {
    await query(`DELETE FROM ip_bans WHERE ip_address = $1::inet`, [req.params.ip]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/ip-bans', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, ip_address, reason, expires_at, created_at FROM ip_bans
       WHERE expires_at IS NULL OR expires_at > NOW()
       ORDER BY created_at DESC LIMIT 200`
    );
    res.json({ bans: rows });
  } catch (e) {
    next(e);
  }
});

router.get('/security-events', async (req, res, next) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 100);
    const { rows } = await query(
      `SELECT * FROM security_events ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ events: rows });
  } catch (e) {
    next(e);
  }
});

router.get('/announcement', async (_req, res, next) => {
  try {
    const announcement = await getAnnouncement();
    res.json({ announcement: announcement || { enabled: false, en: '', fa: '' } });
  } catch (e) {
    next(e);
  }
});

router.put('/announcement', saveAnnouncement);
router.post('/announcement', saveAnnouncement);

async function saveAnnouncement(req, res, next) {
  try {
    const { enabled, en, fa } = req.body || {};
    const announcement = await upsertAnnouncement({
      enabled,
      en,
      fa,
      updatedBy: req.auth.userId,
    });
    await logSecurityEvent('admin_announcement_update', {
      userId: req.auth.userId,
      ip: getClientIp(req),
      details: { enabled: announcement.enabled },
    });
    res.json({ ok: true, announcement });
  } catch (e) {
    next(e);
  }
}

router.get('/sessions', async (req, res, next) => {
  try {
    const userId = req.query.userId;
    let sql = `SELECT id, user_id, device_fingerprint, ip_address, user_agent, is_active,
                      created_at, last_seen_at, expires_at, revoked_at, revoke_reason
               FROM sessions`;
    const params = [];
    if (userId) {
      params.push(userId);
      sql += ` WHERE user_id = $1`;
    }
    sql += ` ORDER BY created_at DESC LIMIT 100`;
    const { rows } = await query(sql, params);
    res.json({ sessions: rows });
  } catch (e) {
    next(e);
  }
});

router.post('/inbox', async (req, res, next) => {
  try {
    const { userId, broadcast, title, body, allowDelete } = req.body || {};
    const t = String(title || '').trim();
    if (!t) {
      return res.status(400).json({ error: 'validation', message: 'Title required.' });
    }
    const allow = allowDelete !== false && allowDelete !== 'false';

    if (broadcast) {
      const sent = await broadcastAdminMessage({
        title: t,
        body: body || '',
        allowDelete: allow,
        fromUserId: req.auth.userId,
      });
      await logSecurityEvent('admin_inbox_broadcast', {
        userId: req.auth.userId,
        ip: getClientIp(req),
        details: { title: t, sent, allowDelete: allow },
      });
      return res.json({ ok: true, sent });
    }

    if (!userId) {
      return res.status(400).json({
        error: 'validation',
        message: 'userId required (or set broadcast: true).',
      });
    }
    const target = await findUserById(userId);
    if (!target) {
      return res.status(404).json({ error: 'not_found', message: 'User not found.' });
    }
    const message = await createInboxMessage({
      userId,
      kind: 'admin',
      title: t,
      body: body || '',
      fromUserId: req.auth.userId,
      fromLabel: 'Admin',
      allowDelete: allow,
      payload: { broadcast: false },
    });
    await logSecurityEvent('admin_inbox_send', {
      userId: req.auth.userId,
      targetUserId: userId,
      ip: getClientIp(req),
      details: { title: t, allowDelete: allow },
    });
    res.json({ ok: true, sent: 1, message });
  } catch (e) {
    next(e);
  }
});

router.get('/inbox/recent', async (req, res, next) => {
  try {
    const recent = await listRecentAdminSends(req.query.limit);
    res.json({ recent });
  } catch (e) {
    next(e);
  }
});

router.post('/inbox/force-delete', async (req, res, next) => {
  try {
    const { ids, title, body, createdAt, allowDelete } = req.body || {};
    let result;
    if (Array.isArray(ids) && ids.length) {
      result = await forceDeleteInboxByIds(ids);
    } else {
      result = await forceDeleteAdminBatch({ title, body, createdAt, allowDelete });
    }
    await logSecurityEvent('admin_inbox_force_delete', {
      userId: req.auth.userId,
      ip: getClientIp(req),
      details: {
        deleted: result.deleted,
        byIds: Array.isArray(ids) && ids.length > 0,
        title: title ? String(title).slice(0, 120) : null,
      },
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.code || 'error', message: e.message });
    next(e);
  }
});

router.get('/push/stats', async (_req, res, next) => {
  try {
    ensurePushConfigured();
    const subscriptions = await countSubscriptions();
    res.json({ configured: isPushConfigured(), subscriptions });
  } catch (e) {
    next(e);
  }
});

router.post('/push', async (req, res, next) => {
  try {
    const { userId, broadcast, title, body, url } = req.body || {};
    const result = await sendPushNotification({
      title,
      body: body || '',
      url: url || '/',
      userId: broadcast ? null : userId,
      broadcast: !!broadcast,
    });
    await logSecurityEvent('admin_push_send', {
      userId: req.auth.userId,
      ip: getClientIp(req),
      details: {
        title: String(title || '').slice(0, 120),
        broadcast: !!broadcast,
        targetUserId: userId || null,
        ...result,
      },
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.code || 'error', message: e.message });
    next(e);
  }
});

export default router;
