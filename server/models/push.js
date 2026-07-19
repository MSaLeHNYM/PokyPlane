import webpush from 'web-push';
import { query } from '../db.js';
import { config } from '../config.js';

let configured = false;

export function isPushConfigured() {
  return !!(config.vapid.publicKey && config.vapid.privateKey);
}

export function ensurePushConfigured() {
  if (configured) return isPushConfigured();
  if (!isPushConfigured()) {
    console.warn(
      '[push] VAPID keys missing — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (npm run vapid:generate)'
    );
    return false;
  }
  webpush.setVapidDetails(
    config.vapid.subject,
    config.vapid.publicKey,
    config.vapid.privateKey
  );
  configured = true;
  return true;
}

export function getVapidPublicKey() {
  return config.vapid.publicKey || null;
}

export async function upsertSubscription(userId, subscription, userAgent = null) {
  const endpoint = subscription?.endpoint;
  const keys = subscription?.keys || {};
  if (!endpoint || !keys.p256dh || !keys.auth) {
    const err = new Error('Invalid subscription.');
    err.status = 400;
    err.code = 'validation';
    throw err;
  }
  const { rows } = await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = COALESCE(EXCLUDED.user_agent, push_subscriptions.user_agent),
       updated_at = NOW()
     RETURNING id`,
    [userId, endpoint, keys.p256dh, keys.auth, userAgent]
  );
  return rows[0];
}

export async function removeSubscription(endpoint, userId = null) {
  if (!endpoint) return { removed: 0 };
  if (userId) {
    const { rowCount } = await query(
      `DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`,
      [endpoint, userId]
    );
    return { removed: rowCount || 0 };
  }
  const { rowCount } = await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [
    endpoint,
  ]);
  return { removed: rowCount || 0 };
}

export async function countSubscriptions() {
  const { rows } = await query(`SELECT COUNT(*)::int AS c FROM push_subscriptions`);
  return rows[0]?.c || 0;
}

async function loadTargets({ userId = null, broadcast = false } = {}) {
  if (broadcast) {
    const { rows } = await query(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth, s.user_id
       FROM push_subscriptions s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE u.id IS NULL OR u.is_banned = FALSE`
    );
    return rows;
  }
  if (!userId) return [];
  const { rows } = await query(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth, s.user_id
     FROM push_subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE s.user_id = $1 AND u.is_banned = FALSE`,
    [userId]
  );
  return rows;
}

/**
 * Send a web-push notification.
 * @returns {{ sent: number, failed: number, removed: number }}
 */
export async function sendPushNotification({
  title,
  body = '',
  url = '/',
  userId = null,
  broadcast = false,
}) {
  if (!ensurePushConfigured()) {
    const err = new Error('Push notifications are not configured on the server.');
    err.status = 503;
    err.code = 'push_unconfigured';
    throw err;
  }
  const t = String(title || '').trim();
  if (!t) {
    const err = new Error('Title required.');
    err.status = 400;
    err.code = 'validation';
    throw err;
  }
  if (!broadcast && !userId) {
    const err = new Error('userId required (or set broadcast: true).');
    err.status = 400;
    err.code = 'validation';
    throw err;
  }

  const targets = await loadTargets({ userId, broadcast });
  const payload = JSON.stringify({
    title: t.slice(0, 120),
    body: String(body || '').slice(0, 400),
    icon: '/icon-192.png',
    badge: '/favicon.png',
    image: '/logo.png',
    url: url || '/',
    tag: 'pokyplane-admin',
  });

  let sent = 0;
  let failed = 0;
  let removed = 0;

  await Promise.all(
    targets.map(async (row) => {
      const sub = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      try {
        await webpush.sendNotification(sub, payload, {
          TTL: 60 * 60 * 12,
          urgency: 'normal',
        });
        sent += 1;
      } catch (e) {
        failed += 1;
        const status = e.statusCode || e.status;
        if (status === 404 || status === 410) {
          await query(`DELETE FROM push_subscriptions WHERE id = $1`, [row.id]);
          removed += 1;
        } else {
          console.warn('[push] send failed', status, e.message);
        }
      }
    })
  );

  return { sent, failed, removed, targeted: targets.length };
}
