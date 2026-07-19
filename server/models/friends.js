import { query } from '../db.js';
import { config } from '../config.js';
import { createInboxMessage, markFriendRequestInbox } from './inbox.js';

function formatRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    status: row.status,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
    fromUsername: row.from_username || null,
    fromDisplayName: row.from_display_name || null,
    toUsername: row.to_username || null,
    toDisplayName: row.to_display_name || null,
    fromProfileAvatar: row.from_profile_avatar || null,
    toProfileAvatar: row.to_profile_avatar || null,
  };
}

function formatFriend(row) {
  const ttl = config.presence.onlineTtlSec;
  const online =
    row.presence_status &&
    row.presence_status !== 'offline' &&
    row.presence_updated_at &&
    Date.now() - new Date(row.presence_updated_at).getTime() < ttl * 1000;
  return {
    id: row.friend_id,
    username: row.username,
    displayName: row.display_name,
    profileAvatar: row.profile_avatar,
    countryCode: row.country_code,
    online: !!online,
    presenceStatus: online ? row.presence_status : 'offline',
    friendsSince: row.created_at,
  };
}

export async function areFriends(userId, otherId) {
  const { rows } = await query(
    `SELECT 1 FROM friendships WHERE user_id = $1 AND friend_id = $2 LIMIT 1`,
    [userId, otherId]
  );
  return rows.length > 0;
}

export async function listFriends(userId) {
  const { rows } = await query(
    `SELECT f.friend_id, f.created_at,
            u.username, u.display_name, u.profile_avatar, u.country_code,
            p.status AS presence_status, p.updated_at AS presence_updated_at
     FROM friendships f
     JOIN users u ON u.id = f.friend_id
     LEFT JOIN user_presence p ON p.user_id = f.friend_id
     WHERE f.user_id = $1 AND u.is_banned = FALSE
     ORDER BY COALESCE(u.display_name, u.username) ASC`,
    [userId]
  );
  return rows.map(formatFriend);
}

export async function listRequests(userId) {
  const incoming = await query(
    `SELECT r.*,
            fu.username AS from_username, fu.display_name AS from_display_name,
            fu.profile_avatar AS from_profile_avatar,
            tu.username AS to_username, tu.display_name AS to_display_name,
            tu.profile_avatar AS to_profile_avatar
     FROM friend_requests r
     JOIN users fu ON fu.id = r.from_user_id
     JOIN users tu ON tu.id = r.to_user_id
     WHERE r.to_user_id = $1 AND r.status = 'pending'
     ORDER BY r.created_at DESC`,
    [userId]
  );
  const outgoing = await query(
    `SELECT r.*,
            fu.username AS from_username, fu.display_name AS from_display_name,
            fu.profile_avatar AS from_profile_avatar,
            tu.username AS to_username, tu.display_name AS to_display_name,
            tu.profile_avatar AS to_profile_avatar
     FROM friend_requests r
     JOIN users fu ON fu.id = r.from_user_id
     JOIN users tu ON tu.id = r.to_user_id
     WHERE r.from_user_id = $1 AND r.status = 'pending'
     ORDER BY r.created_at DESC`,
    [userId]
  );
  return {
    incoming: incoming.rows.map(formatRequest),
    outgoing: outgoing.rows.map(formatRequest),
  };
}

export async function lookupUsers(q, excludeUserId, limit = 20) {
  const term = String(q || '').trim().toLowerCase();
  if (term.length < 2) return [];
  const lim = Math.min(40, Math.max(5, Number(limit) || 20));
  const { rows } = await query(
    `SELECT id, username, display_name, profile_avatar, country_code
     FROM users
     WHERE is_banned = FALSE
       AND id <> $1
       AND (LOWER(username) LIKE $2 OR LOWER(COALESCE(display_name, '')) LIKE $2)
     ORDER BY username ASC
     LIMIT $3`,
    [excludeUserId, `${term}%`, lim]
  );
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    profileAvatar: r.profile_avatar,
    countryCode: r.country_code,
  }));
}

export async function sendFriendRequest(fromUserId, { userId, username }) {
  let targetId = userId;
  if (!targetId && username) {
    const { rows } = await query(
      `SELECT id, is_banned FROM users WHERE LOWER(username) = LOWER($1)`,
      [String(username).trim()]
    );
    if (!rows.length) {
      const err = new Error('User not found.');
      err.code = 'not_found';
      err.status = 404;
      throw err;
    }
    if (rows[0].is_banned) {
      const err = new Error('User unavailable.');
      err.code = 'unavailable';
      err.status = 400;
      throw err;
    }
    targetId = rows[0].id;
  }
  if (!targetId) {
    const err = new Error('username or userId required.');
    err.code = 'validation';
    err.status = 400;
    throw err;
  }
  if (userId) {
    const { rows } = await query(`SELECT is_banned FROM users WHERE id = $1`, [targetId]);
    if (!rows.length) {
      const err = new Error('User not found.');
      err.code = 'not_found';
      err.status = 404;
      throw err;
    }
    if (rows[0].is_banned) {
      const err = new Error('User unavailable.');
      err.code = 'unavailable';
      err.status = 400;
      throw err;
    }
  }
  if (targetId === fromUserId) {
    const err = new Error('Cannot friend yourself.');
    err.code = 'validation';
    err.status = 400;
    throw err;
  }

  if (await areFriends(fromUserId, targetId)) {
    const err = new Error('Already friends.');
    err.code = 'already_friends';
    err.status = 409;
    throw err;
  }

  // Reverse pending → auto-accept
  const { rows: reverse } = await query(
    `SELECT id FROM friend_requests
     WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'`,
    [targetId, fromUserId]
  );
  if (reverse.length) {
    return acceptFriendRequest(fromUserId, reverse[0].id);
  }

  const { rows: existing } = await query(
    `SELECT id, status FROM friend_requests
     WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'`,
    [fromUserId, targetId]
  );
  if (existing.length) {
    const err = new Error('Request already pending.');
    err.code = 'pending';
    err.status = 409;
    throw err;
  }

  const { rows } = await query(
    `INSERT INTO friend_requests (from_user_id, to_user_id, status)
     VALUES ($1, $2, 'pending')
     RETURNING *`,
    [fromUserId, targetId]
  );
  const reqRow = rows[0];

  const { rows: fromUsers } = await query(
    `SELECT username, display_name FROM users WHERE id = $1`,
    [fromUserId]
  );
  const from = fromUsers[0];
  const label = from?.display_name || from?.username || 'Pilot';

  await createInboxMessage({
    userId: targetId,
    kind: 'friend_request',
    title: `${label} sent you a friend request`,
    body: `@${from?.username || 'pilot'} wants to be friends.`,
    fromUserId,
    fromLabel: label,
    payload: { requestId: reqRow.id, fromUserId },
    allowDelete: true,
  });

  return formatRequest(reqRow);
}

export async function acceptFriendRequest(userId, requestId) {
  const { rows } = await query(
    `SELECT * FROM friend_requests WHERE id = $1`,
    [requestId]
  );
  const req = rows[0];
  if (!req || req.status !== 'pending') {
    const err = new Error('Request not found.');
    err.code = 'not_found';
    err.status = 404;
    throw err;
  }
  if (req.to_user_id !== userId) {
    const err = new Error('Only the recipient can accept.');
    err.code = 'forbidden';
    err.status = 403;
    throw err;
  }
  const a = req.from_user_id;
  const b = req.to_user_id;

  await query(
    `UPDATE friend_requests SET status = 'accepted', responded_at = NOW() WHERE id = $1`,
    [requestId]
  );
  await query(
    `INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($2, $1)
     ON CONFLICT DO NOTHING`,
    [a, b]
  );
  await markFriendRequestInbox(b, requestId, 'accepted');
  // Also mark if acceptor was somehow the sender (reverse auto)
  await markFriendRequestInbox(a, requestId, 'accepted');

  return { ok: true, friendIds: [a, b] };
}

export async function denyFriendRequest(userId, requestId) {
  const { rows } = await query(`SELECT * FROM friend_requests WHERE id = $1`, [requestId]);
  const req = rows[0];
  if (!req || req.status !== 'pending') {
    const err = new Error('Request not found.');
    err.code = 'not_found';
    err.status = 404;
    throw err;
  }
  if (req.to_user_id !== userId) {
    const err = new Error('Only the recipient can deny.');
    err.code = 'forbidden';
    err.status = 403;
    throw err;
  }
  await query(
    `UPDATE friend_requests SET status = 'denied', responded_at = NOW() WHERE id = $1`,
    [requestId]
  );
  await markFriendRequestInbox(userId, requestId, 'denied');
  return { ok: true };
}

export async function removeFriend(userId, friendId) {
  await query(
    `DELETE FROM friendships
     WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [userId, friendId]
  );
  return { ok: true };
}

export async function sendLobbyInvite(fromUserId, friendId, { roomId, inviteUrl }) {
  if (!(await areFriends(fromUserId, friendId))) {
    const err = new Error('Not friends.');
    err.code = 'not_friends';
    err.status = 403;
    throw err;
  }
  const room = String(roomId || '')
    .trim()
    .toLowerCase();
  const url = String(inviteUrl || '').trim();
  if (!room || !url) {
    const err = new Error('roomId and inviteUrl required.');
    err.code = 'validation';
    err.status = 400;
    throw err;
  }

  const { rows: fromUsers } = await query(
    `SELECT username, display_name FROM users WHERE id = $1`,
    [fromUserId]
  );
  const from = fromUsers[0];
  const label = from?.display_name || from?.username || 'Host';

  const msg = await createInboxMessage({
    userId: friendId,
    kind: 'lobby_invite',
    title: `${label} invited you to a lobby`,
    body: `Join room ${room}`,
    fromUserId,
    fromLabel: label,
    payload: { roomId: room, inviteUrl: url, fromUserId },
    allowDelete: true,
  });
  return msg;
}
