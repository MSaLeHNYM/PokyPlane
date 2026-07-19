import { query } from '../db.js';

export function formatInboxMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    title: row.title || '',
    body: row.body || '',
    payload: row.payload || {},
    fromUserId: row.from_user_id,
    fromLabel: row.from_label || null,
    fromUsername: row.from_username || null,
    fromDisplayName: row.from_display_name || null,
    isRead: !!row.is_read,
    allowDelete: row.allow_delete !== false,
    createdAt: row.created_at,
  };
}

export async function createInboxMessage({
  userId,
  kind,
  title,
  body = '',
  payload = {},
  fromUserId = null,
  fromLabel = null,
  allowDelete = true,
}) {
  const { rows } = await query(
    `INSERT INTO inbox_messages
       (user_id, kind, title, body, payload, from_user_id, from_label, allow_delete)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
     RETURNING *`,
    [
      userId,
      kind,
      String(title || '').slice(0, 200),
      String(body || '').slice(0, 4000),
      JSON.stringify(payload || {}),
      fromUserId,
      fromLabel ? String(fromLabel).slice(0, 80) : null,
      allowDelete !== false,
    ]
  );
  return formatInboxMessage(rows[0]);
}

export async function listInbox(userId, { limit = 50, unreadOnly = false } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 50));
  const params = [userId];
  let where = 'm.user_id = $1';
  if (unreadOnly) {
    where += ' AND m.is_read = FALSE';
  }
  params.push(lim);
  const { rows } = await query(
    `SELECT m.*, u.username AS from_username, u.display_name AS from_display_name
     FROM inbox_messages m
     LEFT JOIN users u ON u.id = m.from_user_id
     WHERE ${where}
     ORDER BY m.allow_delete ASC, m.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.map(formatInboxMessage);
}

export async function countUnread(userId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS c FROM inbox_messages WHERE user_id = $1 AND is_read = FALSE`,
    [userId]
  );
  return rows[0]?.c || 0;
}

export async function markInboxRead(userId, ids, isRead = true) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) return 0;
  const { rowCount } = await query(
    `UPDATE inbox_messages SET is_read = $3
     WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, list, !!isRead]
  );
  return rowCount || 0;
}

export async function deleteInboxMessages(userId, ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) return { deleted: 0, skipped: 0 };
  const { rows: locked } = await query(
    `SELECT id FROM inbox_messages
     WHERE user_id = $1 AND id = ANY($2::uuid[]) AND allow_delete = FALSE`,
    [userId, list]
  );
  const skipped = locked.length;
  const { rowCount } = await query(
    `DELETE FROM inbox_messages
     WHERE user_id = $1 AND id = ANY($2::uuid[]) AND allow_delete = TRUE`,
    [userId, list]
  );
  return { deleted: rowCount || 0, skipped };
}

/** Delete a lobby invite after the recipient joins (always allowed for that row). */
export async function consumeLobbyInvite(userId, messageId) {
  if (!messageId) return { deleted: 0 };
  const { rowCount } = await query(
    `DELETE FROM inbox_messages
     WHERE id = $1 AND user_id = $2 AND kind = 'lobby_invite'`,
    [messageId, userId]
  );
  return { deleted: rowCount || 0 };
}

/** Remove all invites for a room for this user (e.g. after successful join). */
export async function consumeLobbyInvitesForRoom(userId, roomId) {
  const room = String(roomId || '').trim();
  if (!room) return { deleted: 0 };
  const { rowCount } = await query(
    `DELETE FROM inbox_messages
     WHERE user_id = $1
       AND kind = 'lobby_invite'
       AND (payload->>'roomId') = $2`,
    [userId, room]
  );
  return { deleted: rowCount || 0 };
}

/** Admin: delete by ids regardless of allow_delete. */
export async function forceDeleteInboxByIds(ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) return { deleted: 0 };
  const { rowCount } = await query(
    `DELETE FROM inbox_messages WHERE id = ANY($1::uuid[])`,
    [list]
  );
  return { deleted: rowCount || 0 };
}

/**
 * Admin: remove a whole admin send batch (including locked).
 * Matches title + body + created_at + allow_delete like listRecentAdminSends groups.
 */
export async function forceDeleteAdminBatch({ title, body = '', createdAt, allowDelete }) {
  if (!title || !createdAt) {
    const err = new Error('title and createdAt required.');
    err.status = 400;
    err.code = 'validation';
    throw err;
  }
  const allow = allowDelete !== false && allowDelete !== 'false';
  const { rowCount } = await query(
    `DELETE FROM inbox_messages
     WHERE kind = 'admin'
       AND title = $1
       AND COALESCE(body, '') = $2
       AND allow_delete = $3
       AND created_at = $4::timestamptz`,
    [String(title), String(body || ''), allow, createdAt]
  );
  return { deleted: rowCount || 0 };
}

/** Mark friend-request inbox rows for this request as read (and optionally annotate payload). */
export async function markFriendRequestInbox(userId, requestId, status) {
  await query(
    `UPDATE inbox_messages
     SET is_read = TRUE,
         payload = payload || jsonb_build_object('status', $3::text)
     WHERE user_id = $1
       AND kind = 'friend_request'
       AND (payload->>'requestId') = $2::text`,
    [userId, requestId, status]
  );
}

export async function broadcastAdminMessage({ title, body, allowDelete, fromUserId }) {
  const { rows: users } = await query(
    `SELECT id FROM users WHERE is_banned = FALSE`
  );
  let sent = 0;
  for (const u of users) {
    await createInboxMessage({
      userId: u.id,
      kind: 'admin',
      title,
      body,
      fromUserId,
      fromLabel: 'Admin',
      allowDelete: allowDelete !== false,
      payload: { broadcast: true },
    });
    sent += 1;
  }
  return sent;
}

export async function listRecentAdminSends(limit = 30) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  const { rows } = await query(
    `SELECT kind, title, body, allow_delete, from_label, created_at,
            COUNT(*)::int AS recipients
     FROM inbox_messages
     WHERE kind = 'admin'
     GROUP BY kind, title, body, allow_delete, from_label, created_at
     ORDER BY created_at DESC
     LIMIT $1`,
    [lim]
  );
  return rows.map((r) => ({
    kind: r.kind,
    title: r.title,
    body: r.body,
    allowDelete: r.allow_delete !== false,
    fromLabel: r.from_label,
    createdAt: r.created_at,
    recipients: r.recipients,
  }));
}
