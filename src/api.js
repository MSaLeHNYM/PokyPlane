const API_BASE = import.meta.env.VITE_API_URL || '/api';

const ACCESS_KEY = 'poky_access_token';
const DEVICE_KEY = 'poky_device_fp';

let accessToken = localStorage.getItem(ACCESS_KEY) || '';
let currentUser = null;
/** @type {Set<(user: object|null) => void>} */
const authListeners = new Set();

export function getDeviceFingerprint() {
  let fp = localStorage.getItem(DEVICE_KEY);
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, fp);
  }
  return fp;
}

export function getAccessToken() {
  return accessToken;
}

export function getUser() {
  return currentUser;
}

export function isLoggedIn() {
  return !!accessToken && !!currentUser;
}

export function onAuthChanged(cb) {
  if (typeof cb !== 'function') return () => {};
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

function emitAuth() {
  for (const cb of authListeners) {
    try {
      cb(currentUser);
    } catch (e) {
      console.warn('[auth]', e);
    }
  }
}

function setAccessToken(token) {
  accessToken = token || '';
  if (token) localStorage.setItem(ACCESS_KEY, token);
  else localStorage.removeItem(ACCESS_KEY);
}

async function rawFetch(path, opts = {}) {
  const headers = {
    ...(opts.headers || {}),
    'X-Device-Fingerprint': getDeviceFingerprint(),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }

  return fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
    credentials: 'include',
  });
}

async function refreshAccessToken() {
  const res = await rawFetch('/auth/refresh', { method: 'POST' });
  if (!res.ok) return false;
  const data = await res.json();
  setAccessToken(data.accessToken);
  return true;
}

export async function api(path, opts = {}) {
  let res = await rawFetch(path, opts);
  if (res.status === 401 && !opts._retry) {
    const ok = await refreshAccessToken();
    if (ok) {
      res = await rawFetch(path, { ...opts, _retry: true });
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || res.statusText);
    err.code = data.error;
    err.status = res.status;
    if (data.retryAfterSec != null) err.retryAfterSec = data.retryAfterSec;
    throw err;
  }
  return data;
}

export async function initAuth() {
  if (!accessToken) {
    currentUser = null;
    emitAuth();
    return null;
  }
  try {
    const data = await api('/auth/me');
    currentUser = data.user;
    emitAuth();
    return currentUser;
  } catch {
    setAccessToken('');
    currentUser = null;
    emitAuth();
    return null;
  }
}

export async function register({ email, username, password, displayName }) {
  const data = await api('/auth/register', {
    method: 'POST',
    body: { email, username, password, displayName, deviceFingerprint: getDeviceFingerprint() },
  });
  setAccessToken(data.accessToken);
  currentUser = data.user;
  emitAuth();
  return data.user;
}

export async function login({ email, password }) {
  const data = await api('/auth/login', {
    method: 'POST',
    body: { email, password, deviceFingerprint: getDeviceFingerprint() },
  });
  setAccessToken(data.accessToken);
  currentUser = data.user;
  emitAuth();
  return data.user;
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    /* session may already be dead */
  }
  setAccessToken('');
  currentUser = null;
  emitAuth();
}

export async function updateProfile(patch) {
  const data = await api('/profile/profile', { method: 'PATCH', body: patch });
  currentUser = data.user;
  emitAuth();
  return data.user;
}

export async function fetchProfileMeta() {
  return api('/profile/meta');
}

export async function fetchLeaderboard(mode = 'all') {
  return api(`/scores/leaderboard?mode=${encodeURIComponent(mode)}`);
}

export async function submitScore(payload) {
  if (!isLoggedIn()) return null;
  return api('/scores/submit', { method: 'POST', body: payload });
}

export async function presenceHeartbeat(payload = {}) {
  if (!isLoggedIn()) return;
  try {
    await api('/presence/heartbeat', { method: 'POST', body: payload });
  } catch (e) {
    if (e.code === 'session_revoked') {
      setAccessToken('');
      currentUser = null;
      emitAuth();
    }
  }
}

export async function presenceOffline() {
  if (!isLoggedIn()) return;
  try {
    await api('/presence/offline', { method: 'POST' });
  } catch {
    /* ignore */
  }
}

/** Global menu banner (no auth required). */
export async function fetchAnnouncement() {
  const res = await rawFetch('/announcement');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  return data.announcement || null;
}

/* —— Friends & Inbox —— */
export async function listFriends() {
  return api('/friends');
}

export async function listFriendRequests() {
  return api('/friends/requests');
}

export async function lookupFriends(q) {
  return api(`/friends/lookup?q=${encodeURIComponent(q || '')}`);
}

export async function requestFriend(payload) {
  return api('/friends/request', { method: 'POST', body: payload });
}

export async function acceptFriend(requestId) {
  return api(`/friends/requests/${requestId}/accept`, { method: 'POST' });
}

export async function denyFriend(requestId) {
  return api(`/friends/requests/${requestId}/deny`, { method: 'POST' });
}

export async function removeFriend(friendId) {
  return api(`/friends/${friendId}`, { method: 'DELETE' });
}

export async function sendLobbyInvite(friendId, { roomId, inviteUrl }) {
  return api(`/friends/${friendId}/lobby-invite`, {
    method: 'POST',
    body: { roomId, inviteUrl },
  });
}

export async function consumeLobbyInvite({ id, roomId }) {
  return api('/inbox/consume-lobby-invite', {
    method: 'POST',
    body: { id, roomId },
  });
}

export async function listInbox(opts = {}) {
  const q = new URLSearchParams();
  if (opts.limit) q.set('limit', String(opts.limit));
  if (opts.unreadOnly) q.set('unreadOnly', '1');
  const qs = q.toString();
  return api(`/inbox${qs ? `?${qs}` : ''}`);
}

export async function inboxUnreadCount() {
  return api('/inbox/unread-count');
}

export async function inboxMarkRead(ids) {
  return api('/inbox/read', { method: 'POST', body: { ids } });
}

export async function inboxMarkUnread(ids) {
  return api('/inbox/unread', { method: 'POST', body: { ids } });
}

export async function inboxDelete(ids) {
  return api('/inbox/delete', { method: 'POST', body: { ids } });
}

/* —— Economy (coins, ammo, daily, wheel, market) —— */
export async function fetchEconomyState() {
  if (!isLoggedIn()) return null;
  return api('/economy/state');
}

export async function claimDailyReward() {
  return api('/economy/daily/claim', { method: 'POST' });
}

export async function spinWheelOfLuck() {
  return api('/economy/wheel/spin', { method: 'POST' });
}

export async function buyMarketItem(itemId) {
  return api('/economy/market/buy', { method: 'POST', body: { itemId } });
}
