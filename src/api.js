const API_BASE = import.meta.env.VITE_API_URL || '/api';

const ACCESS_KEY = 'poky_access_token';
const DEVICE_KEY = 'poky_device_fp';

let accessToken = localStorage.getItem(ACCESS_KEY) || '';
let currentUser = null;
let onAuthChange = null;

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
  onAuthChange = cb;
}

function emitAuth() {
  onAuthChange?.(currentUser);
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
