import {
  isLoggedIn,
  onAuthChanged,
  listInbox,
  inboxUnreadCount,
  inboxMarkRead,
  inboxMarkUnread,
  inboxDelete,
  acceptFriend,
  denyFriend,
  listFriends,
  listFriendRequests,
  lookupFriends,
  requestFriend,
  removeFriend,
  sendLobbyInvite,
  consumeLobbyInvite,
} from './api.js';
import { t } from './i18n.js';

let inboxFilter = 'all';
/** @type {Set<string>} */
const selectedIds = new Set();
let pollTimer = null;
let messagesCache = [];
/** @type {null | ((roomId: string, meta?: { inboxId?: string }) => void)} */
let joinLobbyHandler = null;

const INVITE_COOLDOWN_MS = 20_000;
/** @type {Map<string, number>} friendId -> cooldownUntil ms */
const inviteCooldownUntilByFriend = new Map();
let inviteCooldownTimer = null;

export function setInboxJoinLobbyHandler(fn) {
  joinLobbyHandler = typeof fn === 'function' ? fn : null;
}

export function setupInboxUI() {
  bindInboxChrome();
  onAuthChanged((user) => {
    updateInboxBadge();
    if (user) startUnreadPoll();
    else stopUnreadPoll();
  });
  if (isLoggedIn()) startUnreadPoll();
  updateInboxBadge();
}

function startUnreadPoll() {
  stopUnreadPoll();
  pollTimer = setInterval(() => {
    if (isLoggedIn()) updateInboxBadge();
  }, 30000);
}

function stopUnreadPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function updateInboxBadge() {
  const badge = document.getElementById('inbox-badge');
  const btn = document.getElementById('btn-inbox');
  if (!badge || !btn) return;
  if (!isLoggedIn()) {
    badge.classList.add('hidden');
    badge.textContent = '0';
    return;
  }
  try {
    const { unreadCount } = await inboxUnreadCount();
    const n = Number(unreadCount) || 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('hidden', n <= 0);
  } catch {
    /* ignore */
  }
}

function bindInboxChrome() {
  document.querySelectorAll('[data-inbox-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      inboxFilter = btn.dataset.inboxFilter || 'all';
      document.querySelectorAll('[data-inbox-filter]').forEach((b) => {
        b.classList.toggle('active', b.dataset.inboxFilter === inboxFilter);
      });
      renderInboxList();
    });
  });

  document.getElementById('inbox-select-all')?.addEventListener('change', (e) => {
    const on = !!e.target.checked;
    selectedIds.clear();
    if (on) {
      for (const m of filteredMessages()) {
        if (m.allowDelete !== false) selectedIds.add(m.id);
      }
    }
    renderInboxList();
  });

  document.getElementById('inbox-bulk-read')?.addEventListener('click', async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    await inboxMarkRead(ids);
    selectedIds.clear();
    await refreshInbox();
  });
  document.getElementById('inbox-bulk-unread')?.addEventListener('click', async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    await inboxMarkUnread(ids);
    selectedIds.clear();
    await refreshInbox();
  });
  document.getElementById('inbox-bulk-delete')?.addEventListener('click', async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    await inboxDelete(ids);
    selectedIds.clear();
    await refreshInbox();
  });

  document.getElementById('inbox-list')?.addEventListener('click', onInboxListClick);
  document.getElementById('inbox-list')?.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-inbox-check]');
    if (!cb) return;
    const id = cb.dataset.inboxCheck;
    if (cb.checked) selectedIds.add(id);
    else selectedIds.delete(id);
    syncBulkBar();
  });

  document.getElementById('friends-search-btn')?.addEventListener('click', () => runFriendSearch());
  document.getElementById('friends-search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runFriendSearch();
    }
  });
  document.getElementById('friends-list')?.addEventListener('click', onFriendsListClick);
  document.getElementById('friends-search-results')?.addEventListener('click', onSearchResultsClick);

  document.getElementById('mp-invite-friend')?.addEventListener('click', () => openInviteFriendModal());
  document.getElementById('mp-invite-friend-close')?.addEventListener('click', () => {
    document.getElementById('mp-invite-friend-modal')?.classList.add('hidden');
  });
  document.getElementById('mp-invite-friend-list')?.addEventListener('click', onInviteFriendClick);
}

export async function openInboxScreen() {
  if (!isLoggedIn()) return;
  document.getElementById('inbox')?.classList.remove('hidden');
  selectedIds.clear();
  await refreshInbox();
  await refreshFriendsPanel();
}

export function closeInboxScreen() {
  document.getElementById('inbox')?.classList.add('hidden');
}

async function refreshInbox() {
  if (!isLoggedIn()) return;
  try {
    const data = await listInbox({ limit: 80 });
    messagesCache = data.messages || [];
    renderInboxList();
    updateInboxBadge();
  } catch (e) {
    console.warn('[inbox]', e.message);
  }
}

function filteredMessages() {
  let rows = messagesCache;
  if (inboxFilter === 'unread') rows = messagesCache.filter((m) => !m.isRead);
  else if (inboxFilter === 'requests') rows = messagesCache.filter((m) => m.kind === 'friend_request');
  else if (inboxFilter === 'invites') rows = messagesCache.filter((m) => m.kind === 'lobby_invite');
  else if (inboxFilter === 'admin') rows = messagesCache.filter((m) => m.kind === 'admin');
  // Locked (pinned) first, then newest
  return [...rows].sort((a, b) => {
    const la = a.allowDelete === false ? 0 : 1;
    const lb = b.allowDelete === false ? 0 : 1;
    if (la !== lb) return la - lb;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function kindLabel(kind) {
  if (kind === 'friend_request') return t('inboxKindRequest');
  if (kind === 'lobby_invite') return t('inboxKindInvite');
  if (kind === 'admin') return t('inboxKindAdmin');
  return kind;
}

function renderInboxList() {
  const list = document.getElementById('inbox-list');
  if (!list) return;
  const rows = filteredMessages();
  if (!rows.length) {
    list.innerHTML = `<p class="panel-desc">${t('inboxEmpty')}</p>`;
    syncBulkBar();
    return;
  }
  list.innerHTML = rows
    .map((m) => {
      const checked = selectedIds.has(m.id) ? 'checked' : '';
      const unread = m.isRead ? '' : 'inbox-row-unread';
      const locked = m.allowDelete === false;
      const status = m.payload?.status;
      let actions = '';
      if (m.kind === 'friend_request' && (!status || status === 'pending')) {
        const rid = m.payload?.requestId;
        if (rid) {
          actions = `<div class="inbox-row-actions">
            <button type="button" class="menu-btn menu-btn-sm primary" data-accept-req="${rid}">${t('accept')}</button>
            <button type="button" class="menu-btn menu-btn-sm" data-deny-req="${rid}">${t('deny')}</button>
          </div>`;
        }
      } else if (m.kind === 'lobby_invite' && m.payload?.roomId) {
        actions = `<div class="inbox-row-actions">
          <button type="button" class="menu-btn menu-btn-sm primary" data-join-room="${escapeAttr(m.payload.roomId)}" data-join-url="${escapeAttr(m.payload.inviteUrl || '')}" data-inbox-id="${escapeAttr(m.id)}">${t('joinLobby')}</button>
        </div>`;
      }
      return `<article class="inbox-row ${unread}${locked ? ' inbox-row-pinned' : ''}" data-id="${m.id}">
        <label class="inbox-check">
          <input type="checkbox" data-inbox-check="${m.id}" ${checked}${
            locked ? ` disabled title="${escapeAttr(t('inboxLocked'))}"` : ''
          } />
        </label>
        <div class="inbox-row-body">
          <div class="inbox-row-meta">
            <span class="inbox-kind">${kindLabel(m.kind)}</span>
            ${locked ? `<span class="inbox-locked" title="${escapeAttr(t('inboxLocked'))}">🔒 ${escapeHtml(t('inboxPinned'))}</span>` : ''}
            <time>${formatTime(m.createdAt)}</time>
          </div>
          <h3 class="inbox-title">${escapeHtml(m.title)}</h3>
          ${m.body ? `<p class="inbox-body">${escapeHtml(m.body)}</p>` : ''}
          ${actions}
        </div>
      </article>`;
    })
    .join('');
  syncBulkBar();
}

function syncBulkBar() {
  const bar = document.getElementById('inbox-bulk-bar');
  const n = selectedIds.size;
  if (bar) bar.classList.toggle('hidden', n === 0);
  const count = document.getElementById('inbox-selected-count');
  if (count) count.textContent = String(n);
}

async function onInboxListClick(e) {
  const accept = e.target.closest('[data-accept-req]');
  const deny = e.target.closest('[data-deny-req]');
  const join = e.target.closest('[data-join-room]');
  if (accept) {
    await acceptFriend(accept.dataset.acceptReq);
    await refreshInbox();
    await refreshFriendsPanel();
    return;
  }
  if (deny) {
    await denyFriend(deny.dataset.denyReq);
    await refreshInbox();
    return;
  }
  if (join) {
    const roomId = join.dataset.joinRoom;
    const url = join.dataset.joinUrl;
    const inboxId = join.dataset.inboxId;
    let room = roomId;
    if (url) {
      try {
        const u = new URL(url, window.location.origin);
        const r = u.searchParams.get('room');
        if (r) room = r;
      } catch {
        /* fall through */
      }
    }
    if (!room) return;
    room = String(room).trim().toLowerCase();
    join.disabled = true;
    // Remove invite immediately so it doesn't linger if user returns to inbox.
    try {
      await consumeLobbyInvite({ id: inboxId || undefined, roomId: room });
      messagesCache = messagesCache.filter(
        (m) =>
          m.id !== inboxId &&
          !(m.kind === 'lobby_invite' && String(m.payload?.roomId || '').toLowerCase() === room)
      );
      renderInboxList();
      updateInboxBadge();
    } catch (err) {
      console.warn('[inbox] consume invite failed', err.message || err);
    }
    joinLobbyHandler?.(room, { inboxId });
  }
}

async function refreshFriendsPanel() {
  const list = document.getElementById('friends-list');
  if (!list || !isLoggedIn()) return;
  try {
    const [{ friends }, reqs] = await Promise.all([listFriends(), listFriendRequests()]);
    const incoming = reqs.incoming || [];
    list.innerHTML = '';
    if (incoming.length) {
      list.innerHTML += `<p class="setting-note">${t('pendingRequests')}</p>`;
      for (const r of incoming) {
        list.innerHTML += `<div class="friends-row">
          <span>${escapeHtml(r.fromDisplayName || r.fromUsername)}</span>
          <button type="button" class="menu-btn menu-btn-sm primary" data-accept-req="${r.id}">${t('accept')}</button>
          <button type="button" class="menu-btn menu-btn-sm" data-deny-req="${r.id}">${t('deny')}</button>
        </div>`;
      }
    }
    list.innerHTML += `<p class="setting-note">${t('friendsList')}</p>`;
    if (!(friends || []).length) {
      list.innerHTML += `<p class="panel-desc">${t('noFriends')}</p>`;
    } else {
      for (const f of friends) {
        const online = f.online ? `<span class="friend-online">${t('online')}</span>` : '';
        list.innerHTML += `<div class="friends-row">
          <span>${escapeHtml(f.displayName || f.username)} ${online}</span>
          <button type="button" class="menu-btn menu-btn-sm danger" data-unfriend="${f.id}">${t('unfriend')}</button>
        </div>`;
      }
    }
  } catch (e) {
    console.warn('[friends]', e.message);
  }
}

async function runFriendSearch() {
  const input = document.getElementById('friends-search-input');
  const box = document.getElementById('friends-search-results');
  if (!input || !box) return;
  const q = input.value.trim();
  if (q.length < 2) {
    box.innerHTML = `<p class="panel-desc">${t('searchMinChars')}</p>`;
    return;
  }
  try {
    const { users } = await lookupFriends(q);
    if (!(users || []).length) {
      box.innerHTML = `<p class="panel-desc">${t('noUsersFound')}</p>`;
      return;
    }
    box.innerHTML = users
      .map(
        (u) => `<div class="friends-row">
          <span>@${escapeHtml(u.username)}${u.displayName ? ` · ${escapeHtml(u.displayName)}` : ''}</span>
          <button type="button" class="menu-btn menu-btn-sm primary" data-add-friend="${escapeAttr(u.username)}">${t('addFriend')}</button>
        </div>`
      )
      .join('');
  } catch (e) {
    box.innerHTML = `<p class="auth-error">${escapeHtml(e.message)}</p>`;
  }
}

async function onSearchResultsClick(e) {
  const add = e.target.closest('[data-add-friend]');
  if (!add) return;
  try {
    await requestFriend({ username: add.dataset.addFriend });
    add.textContent = t('requestSent');
    add.disabled = true;
  } catch (err) {
    alert(err.message || t('requestFailed'));
  }
}

async function onFriendsListClick(e) {
  const accept = e.target.closest('[data-accept-req]');
  const deny = e.target.closest('[data-deny-req]');
  const unfriend = e.target.closest('[data-unfriend]');
  if (accept) {
    await acceptFriend(accept.dataset.acceptReq);
    await refreshFriendsPanel();
    await refreshInbox();
  }
  if (deny) {
    await denyFriend(deny.dataset.denyReq);
    await refreshFriendsPanel();
    await refreshInbox();
  }
  if (unfriend) {
    if (!confirm(t('confirmUnfriend'))) return;
    await removeFriend(unfriend.dataset.unfriend);
    await refreshFriendsPanel();
  }
}

let inviteRoomCtx = null;

export function setInviteRoomContext(ctx) {
  const roomId = ctx?.roomId;
  const inviteUrl = ctx?.inviteUrl;
  const prevRoom = inviteRoomCtx?.roomId;
  inviteRoomCtx = roomId && inviteUrl ? { roomId, inviteUrl } : null;
  if (!inviteRoomCtx || prevRoom !== inviteRoomCtx?.roomId) {
    inviteCooldownUntilByFriend.clear();
    if (inviteCooldownTimer) {
      clearInterval(inviteCooldownTimer);
      inviteCooldownTimer = null;
    }
  }
  const openBtn = document.getElementById('mp-invite-friend');
  openBtn?.classList.toggle('hidden', !inviteRoomCtx);
  if (openBtn) {
    openBtn.disabled = false;
    openBtn.textContent = t('inviteFriend');
  }
}

function friendInviteCooldownLeftSec(friendId) {
  const until = inviteCooldownUntilByFriend.get(friendId) || 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

function anyInviteCooldownActive() {
  const now = Date.now();
  for (const until of inviteCooldownUntilByFriend.values()) {
    if (until > now) return true;
  }
  return false;
}

function pruneInviteCooldowns() {
  const now = Date.now();
  for (const [fid, until] of inviteCooldownUntilByFriend) {
    if (until <= now) inviteCooldownUntilByFriend.delete(fid);
  }
}

function startInviteCooldownUi() {
  if (inviteCooldownTimer) clearInterval(inviteCooldownTimer);
  inviteCooldownTimer = setInterval(() => {
    pruneInviteCooldowns();
    const modal = document.getElementById('mp-invite-friend-modal');
    if (modal && !modal.classList.contains('hidden')) {
      applyInviteButtonStates();
    }
    if (!anyInviteCooldownActive()) {
      clearInterval(inviteCooldownTimer);
      inviteCooldownTimer = null;
      applyInviteButtonStates();
    }
  }, 250);
}

function applyInviteButtonStates() {
  const list = document.getElementById('mp-invite-friend-list');
  if (!list) return;
  pruneInviteCooldowns();
  list.querySelectorAll('[data-invite-friend]').forEach((btn) => {
    const fid = btn.dataset.inviteFriend;
    const left = friendInviteCooldownLeftSec(fid);
    if (left > 0) {
      btn.disabled = true;
      btn.textContent = t('inviteCooldown').replace('{n}', String(left));
    } else {
      btn.disabled = false;
      btn.textContent = t('invite');
    }
  });
}

async function openInviteFriendModal() {
  if (!inviteRoomCtx || !isLoggedIn()) return;
  const modal = document.getElementById('mp-invite-friend-modal');
  const list = document.getElementById('mp-invite-friend-list');
  if (!modal || !list) return;
  modal.classList.remove('hidden');
  list.innerHTML = `<p class="panel-desc">${t('loading')}</p>`;
  try {
    const { friends } = await listFriends();
    const sorted = [...(friends || [])].sort((a, b) => Number(b.online) - Number(a.online));
    if (!sorted.length) {
      list.innerHTML = `<p class="panel-desc">${t('noFriends')}</p>`;
      return;
    }
    list.innerHTML = sorted
      .map(
        (f) => `<div class="friends-row">
          <span>${escapeHtml(f.displayName || f.username)} ${f.online ? `<em class="friend-online">${t('online')}</em>` : ''}</span>
          <button type="button" class="menu-btn menu-btn-sm primary" data-invite-friend="${f.id}">${t('invite')}</button>
        </div>`
      )
      .join('');
    applyInviteButtonStates();
    if (anyInviteCooldownActive()) startInviteCooldownUi();
  } catch (e) {
    list.innerHTML = `<p class="auth-error">${escapeHtml(e.message)}</p>`;
  }
}

async function onInviteFriendClick(e) {
  const btn = e.target.closest('[data-invite-friend]');
  if (!btn || !inviteRoomCtx) return;
  const friendId = btn.dataset.inviteFriend;
  if (friendInviteCooldownLeftSec(friendId) > 0) return;
  btn.disabled = true;
  try {
    await sendLobbyInvite(friendId, inviteRoomCtx);
    inviteCooldownUntilByFriend.set(friendId, Date.now() + INVITE_COOLDOWN_MS);
    applyInviteButtonStates();
    startInviteCooldownUi();
  } catch (err) {
    const retry = Number(err.retryAfterSec);
    if (err.code === 'cooldown' || err.status === 429) {
      inviteCooldownUntilByFriend.set(
        friendId,
        Date.now() + (retry > 0 ? retry * 1000 : INVITE_COOLDOWN_MS)
      );
      applyInviteButtonStates();
      startInviteCooldownUi();
    } else {
      btn.disabled = false;
      btn.textContent = t('invite');
    }
    alert(err.message || t('inviteFailed'));
  }
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return '';
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
