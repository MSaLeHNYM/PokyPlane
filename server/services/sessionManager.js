import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';

const REFRESH_COOKIE = 'poky_refresh';

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function signAccessToken(user, sessionId) {
  return jwt.sign(
    { sub: user.id, sid: sessionId, role: user.role, username: user.username },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessTtl }
  );
}

export function signRefreshToken(userId, sessionId) {
  return jwt.sign({ sub: userId, sid: sessionId, typ: 'refresh' }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshTtl,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}

function refreshExpiresAt() {
  const ms = parseDuration(config.jwt.refreshTtl);
  return new Date(Date.now() + ms);
}

function parseDuration(str) {
  const m = /^(\d+)([smhd])$/.exec(str);
  if (!m) return 7 * 24 * 3600 * 1000;
  const n = Number(m[1]);
  const u = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]];
  return n * u;
}

/**
 * Single-device session: revoke all other sessions, create one active session.
 */
export async function createSession({
  userId,
  deviceFingerprint,
  userAgent,
  ipAddress,
  reason = 'login',
}) {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE sessions SET is_active = FALSE, revoked_at = NOW(), revoke_reason = $2
       WHERE user_id = $1 AND is_active = TRUE`,
      [userId, reason === 'login' ? 'new_login' : reason]
    );

    const sessionId = crypto.randomUUID();
    const refreshToken = signRefreshToken(userId, sessionId);
    const refreshHash = hashToken(refreshToken);

    await client.query(
      `INSERT INTO sessions (id, user_id, refresh_token_hash, device_fingerprint, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        sessionId,
        userId,
        refreshHash,
        deviceFingerprint,
        userAgent || null,
        ipAddress || null,
        refreshExpiresAt(),
      ]
    );

    await client.query(`UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [
      userId,
    ]);

    return { sessionId, refreshToken };
  });
}

export async function getActiveSession(sessionId, userId) {
  const { rows } = await query(
    `SELECT * FROM sessions WHERE id = $1 AND user_id = $2 AND is_active = TRUE AND expires_at > NOW()`,
    [sessionId, userId]
  );
  return rows[0] || null;
}

export async function touchSession(sessionId) {
  await query(`UPDATE sessions SET last_seen_at = NOW() WHERE id = $1 AND is_active = TRUE`, [
    sessionId,
  ]);
}

export async function validateRefreshSession(refreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return null;
  }
  if (payload.typ !== 'refresh') return null;

  const hash = hashToken(refreshToken);
  const { rows } = await query(
    `SELECT s.*, u.email, u.username, u.role, u.is_banned
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.user_id = $2 AND s.refresh_token_hash = $3
       AND s.is_active = TRUE AND s.expires_at > NOW()`,
    [payload.sid, payload.sub, hash]
  );
  const row = rows[0];
  if (!row || row.is_banned) return null;
  return row;
}

export async function revokeSession(sessionId, reason = 'logout') {
  await query(
    `UPDATE sessions SET is_active = FALSE, revoked_at = NOW(), revoke_reason = $2 WHERE id = $1`,
    [sessionId, reason]
  );
  await query(`UPDATE user_presence SET status = 'offline', updated_at = NOW() WHERE session_id = $1`, [
    sessionId,
  ]);
}

export async function revokeAllUserSessions(userId, reason = 'admin_kick') {
  await query(
    `UPDATE sessions SET is_active = FALSE, revoked_at = NOW(), revoke_reason = $2
     WHERE user_id = $1 AND is_active = TRUE`,
    [userId, reason]
  );
  await query(`UPDATE user_presence SET status = 'offline', updated_at = NOW() WHERE user_id = $1`, [
    userId,
  ]);
}

export function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: parseDuration(config.jwt.refreshTtl),
    path: '/api/auth',
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

export function getRefreshFromCookie(req) {
  return req.cookies?.[REFRESH_COOKIE] || null;
}

export { REFRESH_COOKIE };
