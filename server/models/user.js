import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, query } from '../db.js';
import { config } from '../config.js';
import { ensureAnnouncementRow } from './announcement.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function migrate() {
  const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  await seedAdmin();
  await ensureAnnouncementRow();
  console.log('[migrate] schema applied');
}

async function seedAdmin() {
  const { rows } = await query(`SELECT id FROM users WHERE email = $1`, [config.admin.email]);
  if (rows.length) return;

  const hash = await bcrypt.hash(config.admin.password, 12);
  await query(
    `INSERT INTO users (email, username, password_hash, role, display_name, profile_avatar, country_code)
     VALUES ($1, $2, $3, 'admin', $4, 'pilot_1', 'US')`,
    [config.admin.email, config.admin.username, hash, 'Admin']
  );
  console.log(`[migrate] admin user created: ${config.admin.email}`);
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: row.role,
    displayName: row.display_name,
    profileAvatar: row.profile_avatar,
    countryCode: row.country_code,
    gender: row.gender,
    bio: row.bio,
    settings: row.settings || {},
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    isBanned: row.is_banned,
  };
}

export async function findUserByEmail(email) {
  const { rows } = await query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
  return rows[0] || null;
}

export async function findUserByUsername(username) {
  const { rows } = await query(`SELECT * FROM users WHERE username = $1`, [username.toLowerCase()]);
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function createUser({ email, username, password, displayName }) {
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await query(
    `INSERT INTO users (email, username, password_hash, display_name)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [email.toLowerCase(), username.toLowerCase(), hash, displayName || username]
  );
  return rows[0];
}

export async function logSecurityEvent(type, { userId, targetUserId, ip, details = {} }) {
  await query(
    `INSERT INTO security_events (event_type, user_id, target_user_id, ip_address, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [type, userId || null, targetUserId || null, ip || null, JSON.stringify(details)]
  );
}

export async function isIpBanned(ip) {
  if (!ip) return false;
  const { rows } = await query(
    `SELECT 1 FROM ip_bans WHERE ip_address = $1::inet
     AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
    [ip]
  );
  return rows.length > 0;
}

export async function upsertPresence(userId, sessionId, { status, gameMode, mapId, ip, userAgent }) {
  await query(
    `INSERT INTO user_presence (user_id, status, game_mode, map_id, ip_address, user_agent, session_id, updated_at)
     VALUES ($1, $2, $3, $4, $5::inet, $6, $7, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       status = EXCLUDED.status,
       game_mode = EXCLUDED.game_mode,
       map_id = EXCLUDED.map_id,
       ip_address = EXCLUDED.ip_address,
       user_agent = EXCLUDED.user_agent,
       session_id = EXCLUDED.session_id,
       updated_at = NOW()`,
    [userId, status, gameMode || null, mapId || null, ip || null, userAgent || null, sessionId]
  );
}

export async function setPresenceOffline(userId) {
  await query(
    `UPDATE user_presence SET status = 'offline', game_mode = NULL, map_id = NULL, updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
}
