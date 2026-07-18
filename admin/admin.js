const API = '/api';

function deviceFingerprint() {
  let fp = localStorage.getItem('poky_device_fp');
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem('poky_device_fp', fp);
  }
  return fp;
}

let accessToken = sessionStorage.getItem('admin_access') || '';

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}), 'X-Device-Fingerprint': deviceFingerprint() };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers,
    credentials: 'include',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = data.message || data.error;
    if (!msg && res.status === 404) {
      msg =
        'API not found — restart the backend (npm run dev:api) and run npm run db:migrate, then hard-refresh this page.';
    }
    throw new Error(msg || res.statusText);
  }
  return data;
}

function show(id) {
  document.getElementById('login-screen').classList.toggle('hidden', id !== 'login');
  document.getElementById('admin-app').classList.toggle('hidden', id !== 'app');
}

async function login(email, password) {
  const data = await api('/auth/login', {
    method: 'POST',
    body: { email, password, deviceFingerprint: deviceFingerprint() },
  });
  if (data.user?.role !== 'admin') {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    throw new Error('Not an admin account.');
  }
  accessToken = data.accessToken;
  sessionStorage.setItem('admin_access', accessToken);
  document.getElementById('admin-user-label').textContent = data.user.username;
  show('app');
  await loadAll();
}

async function loadStats() {
  const s = await api('/admin/stats');
  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card"><strong>${s.totalUsers}</strong>Users</div>
    <div class="stat-card"><strong>${s.onlinePlayers}</strong>Online</div>
    <div class="stat-card"><strong>${s.bannedUsers}</strong>Banned</div>
    <div class="stat-card"><strong>${s.totalScores}</strong>Scores</div>
    <div class="stat-card"><strong>${s.securityEvents24h}</strong>Events 24h</div>`;
}

async function loadOnline() {
  const { players } = await api('/admin/online');
  document.getElementById('online-body').innerHTML = players
    .map(
      (p) => `<tr>
        <td>${p.displayName || p.username} <span class="badge">${p.role}</span></td>
        <td>${p.status}${p.gameMode ? ` · ${p.gameMode}` : ''}</td>
        <td>${p.gameMode || '—'}</td>
        <td>${p.ip || '—'}</td>
        <td>${new Date(p.lastSeen).toLocaleString()}</td>
        <td>
          <button class="btn-sm btn-warn" data-kick="${p.userId}">Kick</button>
          <button class="btn-sm btn-danger" data-ban="${p.userId}">Ban</button>
          ${p.ip ? `<button class="btn-sm btn-danger" data-ban-ip="${p.ip}">Ban IP</button>` : ''}
        </td></tr>`
    )
    .join('');
}

async function loadUsers(q = '') {
  const { users } = await api(`/admin/users?q=${encodeURIComponent(q)}`);
  document.getElementById('users-body').innerHTML = users
    .map(
      (u) => `<tr>
        <td>${u.displayName || u.username}<br><small>${u.email}</small></td>
        <td><span class="badge ${u.role === 'admin' ? 'admin' : ''}">${u.role}</span></td>
        <td>${u.countryCode || '—'}</td>
        <td>${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</td>
        <td>${u.isBanned ? '<span class="badge banned">banned</span>' : 'active'}</td>
        <td>
          <button class="btn-sm btn-warn" data-kick="${u.id}">Kick</button>
          ${u.isBanned
            ? `<button class="btn-sm btn-ok" data-unban="${u.id}">Unban</button>`
            : `<button class="btn-sm btn-danger" data-ban="${u.id}">Ban</button>`}
        </td></tr>`
    )
    .join('');
}

async function loadIpBans() {
  const { bans } = await api('/admin/ip-bans');
  document.getElementById('ipbans-body').innerHTML = bans
    .map(
      (b) => `<tr>
        <td>${b.ip_address}</td>
        <td>${b.reason || '—'}</td>
        <td>${b.expires_at ? new Date(b.expires_at).toLocaleString() : 'Permanent'}</td>
        <td><button class="btn-sm btn-ok" data-unban-ip="${b.ip_address}">Remove</button></td>
      </tr>`
    )
    .join('');
}

async function loadSecurity() {
  const { events } = await api('/admin/security-events');
  document.getElementById('security-body').innerHTML = events
    .map(
      (e) => `<tr>
        <td>${new Date(e.created_at).toLocaleString()}</td>
        <td>${e.event_type}</td>
        <td>${e.user_id || '—'}</td>
        <td>${e.ip_address || '—'}</td>
        <td><code>${JSON.stringify(e.details)}</code></td>
      </tr>`
    )
    .join('');
}

async function loadAll() {
  await Promise.all([loadStats(), loadOnline(), loadUsers(), loadIpBans(), loadSecurity(), loadAnnouncementAdmin()]);
}

async function loadAnnouncementAdmin() {
  try {
    const { announcement } = await api('/admin/announcement');
    if (!announcement) return;
    document.getElementById('ann-enabled').checked = !!announcement.enabled;
    document.getElementById('ann-en').value = announcement.en || '';
    document.getElementById('ann-fa').value = announcement.fa || '';
    const updated = document.getElementById('ann-updated');
    if (updated && announcement.updatedAt) {
      updated.textContent = `Last saved: ${new Date(announcement.updatedAt).toLocaleString()}`;
    }
  } catch (ex) {
    console.warn('[admin] announcement load', ex.message);
  }
}

function showAnnStatus(msg, ok = true) {
  const el = document.getElementById('ann-status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
  el.classList.toggle('ok', ok);
  el.classList.toggle('error', !ok);
  if (msg) setTimeout(() => el.classList.add('hidden'), 3000);
}

document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('login-error');
  err.classList.add('hidden');
  try {
    await login(
      document.getElementById('admin-email').value,
      document.getElementById('admin-password').value
    );
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
});

document.getElementById('admin-logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  accessToken = '';
  sessionStorage.removeItem('admin_access');
  show('login');
});

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
  });
});

document.querySelectorAll('[data-refresh]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.refresh;
    if (t === 'online') loadOnline();
    if (t === 'users') loadUsers(document.getElementById('user-search').value);
    if (t === 'security') loadSecurity();
    if (t === 'announcement') loadAnnouncementAdmin();
  });
});

document.getElementById('user-search')?.addEventListener('input', (e) => {
  loadUsers(e.target.value);
});

document.getElementById('announcement-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { announcement } = await api('/admin/announcement', {
      method: 'POST',
      body: {
        enabled: document.getElementById('ann-enabled').checked,
        en: document.getElementById('ann-en').value,
        fa: document.getElementById('ann-fa').value,
      },
    });
    const updated = document.getElementById('ann-updated');
    if (updated && announcement?.updatedAt) {
      updated.textContent = `Last saved: ${new Date(announcement.updatedAt).toLocaleString()}`;
    }
    showAnnStatus('Announcement saved.', true);
  } catch (ex) {
    showAnnStatus(ex.message || 'Save failed.', false);
  }
});

document.getElementById('ip-ban-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/admin/ip-ban', {
    method: 'POST',
    body: {
      ip: document.getElementById('ban-ip').value,
      reason: document.getElementById('ban-reason').value,
      expiresInHours: document.getElementById('ban-hours').value || null,
    },
  });
  e.target.reset();
  loadIpBans();
});

document.body.addEventListener('click', async (e) => {
  const kick = e.target.closest('[data-kick]');
  const ban = e.target.closest('[data-ban]');
  const unban = e.target.closest('[data-unban]');
  const banIp = e.target.closest('[data-ban-ip]');
  const unbanIp = e.target.closest('[data-unban-ip]');

  if (kick) {
    await api(`/admin/users/${kick.dataset.kick}/kick`, { method: 'POST' });
    loadOnline();
  }
  if (ban) {
    const reason = prompt('Ban reason?') || 'Banned by admin';
    await api(`/admin/users/${ban.dataset.ban}/ban`, { method: 'POST', body: { reason } });
    loadUsers();
    loadOnline();
  }
  if (unban) {
    await api(`/admin/users/${unban.dataset.unban}/unban`, { method: 'POST' });
    loadUsers();
  }
  if (banIp) {
    await api('/admin/ip-ban', { method: 'POST', body: { ip: banIp.dataset.banIp, reason: 'From admin panel' } });
    loadIpBans();
  }
  if (unbanIp) {
    await api(`/admin/ip-ban/${encodeURIComponent(unbanIp.dataset.unbanIp)}`, { method: 'DELETE' });
    loadIpBans();
  }
});

// Auto refresh online list
setInterval(() => {
  if (!document.getElementById('admin-app').classList.contains('hidden')) {
    loadStats();
    if (!document.getElementById('tab-online').classList.contains('hidden')) loadOnline();
  }
}, 15000);

if (accessToken) {
  api('/auth/me')
    .then((d) => {
      if (d.user?.role !== 'admin') throw new Error('not admin');
      document.getElementById('admin-user-label').textContent = d.user.username;
      show('app');
      loadAll();
    })
    .catch(() => show('login'));
} else {
  show('login');
}
