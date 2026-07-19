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
          <button class="btn-sm" data-msg="${u.id}">Msg</button>
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
  await Promise.all([
    loadStats(),
    loadOnline(),
    loadUsers(),
    loadIpBans(),
    loadSecurity(),
    loadAnnouncementAdmin(),
    loadInboxRecent(),
    loadPushStats(),
  ]);
  renderPushSamples();
}

const PUSH_SAMPLES_FA = [
  { title: 'به آسمان برگرد!', body: 'دوستان منتظر پروازت هستن. همین الان بیا پوک‌پلین!' },
  { title: 'رویداد ویژه امروز', body: 'تا آخر شب امتیاز دوبرابر در مسابقه حلقه‌ها فعال است.' },
  { title: 'نبرد آسمانی شروع شد', body: 'موج جدید دشمنان منتظرته — آماده نبردی؟' },
  { title: 'دوستت دعوتت کرد', body: 'یک دوست در لابی چندنفره منتظر پیوستنت هست.' },
  { title: 'رکورد جدید ثبت کن', body: 'هفته‌ای تازه — جدول امتیاز منتظر اسم توست.' },
  { title: 'سوخت تموم نشه!', body: 'توی پرواز آزاد سوخت رو مدیریت کن و تا افق برو.' },
  { title: 'هواپیما جدید آزاد شد', body: 'یک هواپیمای تازه در گاراژ منتظرته. بیا امتحانش کن!' },
  { title: 'یادآور روزانه', body: 'فقط چند دقیقه پرواز کن و روزت رو تازه‌تر کن.' },
  { title: 'جلسه چندنفره امشب', body: 'ساعت ۲۱ به وقت ایران با خلبان‌ها هم‌پرواز شو.' },
  { title: 'پاداش ورود امروز', body: 'اولین پرواز روزت جایزه کوچیک داره — از دست نده.' },
  { title: 'خطر در آسمان!', body: 'طوفان نزدیکه — در حالت نبرد مراقب باش.' },
  { title: 'پیام از ادمین', body: 'سرور به‌زودی آپدیت می‌شه. چند دقیقه قطعی ممکنه.' },
  { title: 'حریف پیدا شد', body: 'یک خلبان آنلاین آماده‌س. بیا مبارزه کنیم!' },
  { title: 'حلقه‌ها منتظرتن', body: 'مسیر حلقه‌ها رو کامل کن و بهترین زمانت رو بزن.' },
  { title: 'شب پرواز آزاد', body: 'آسمان آرومه — وقتشه پرواز آزاد رو تست کنی.' },
  { title: 'تبریک خلبان!', body: 'ایول! یکی از بالاترین‌ امتیازهای هفته مال توئه. ادامه بده.' },
  { title: 'دوستی در راهه', body: 'درخواست دوستی تازه‌ای داری — صندوق پیام رو چک کن.' },
  { title: 'بازگشت قهرمان', body: 'خیلی وقته پرواز نکردی. آسمون دلت تنگ شده!' },
  { title: 'آپدیت بازی', body: 'نسخه تازه پوک‌پلین آماده‌ست. همین الان اپ رو باز کن.' },
  { title: 'جایزه هفته', body: 'تا پایان هفته در صدر جدول باش و جایزه ویژه بگیر.' },
];

function renderPushSamples() {
  const box = document.getElementById('push-samples');
  if (!box || box.dataset.ready) return;
  box.dataset.ready = '1';
  box.innerHTML = PUSH_SAMPLES_FA.map(
    (s, i) => `<button type="button" class="push-sample" data-sample="${i}">
      <strong>${escapeHtml(s.title)}</strong>
      <span>${escapeHtml(s.body)}</span>
    </button>`
  ).join('');
}

async function loadPushStats() {
  const el = document.getElementById('push-stats');
  if (!el) return;
  try {
    const s = await api('/admin/push/stats');
    el.textContent = s.configured
      ? `Push configured · ${s.subscriptions} device subscription(s)`
      : 'Push NOT configured — set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY on the server.';
  } catch (ex) {
    el.textContent = `Push stats unavailable: ${ex.message}`;
  }
}

function showPushStatus(msg, ok = true) {
  const el = document.getElementById('push-status');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden', 'ok', 'error');
  el.classList.add(ok ? 'ok' : 'error');
}

let inboxRecentCache = [];
/** @type {Set<number>} indices into inboxRecentCache */
const inboxRecentSelected = new Set();
let inboxRecentFilter = 'all'; // all | locked | unlocked

function filteredInboxRecent() {
  return inboxRecentCache
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => {
      if (inboxRecentFilter === 'locked') return r.allowDelete === false;
      if (inboxRecentFilter === 'unlocked') return r.allowDelete !== false;
      return true;
    });
}

function renderInboxRecent() {
  const body = document.getElementById('inbox-recent-body');
  if (!body) return;
  const rows = filteredInboxRecent();
  // Drop selections that are hidden by filter
  const visible = new Set(rows.map((x) => x.i));
  for (const idx of [...inboxRecentSelected]) {
    if (!visible.has(idx)) inboxRecentSelected.delete(idx);
  }
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6">No sends match this filter</td></tr>`;
  } else {
    body.innerHTML = rows
      .map(({ r, i }) => {
        const checked = inboxRecentSelected.has(i) ? 'checked' : '';
        return `<tr>
          <td><input type="checkbox" data-recent-check="${i}" ${checked} /></td>
          <td>${new Date(r.createdAt).toLocaleString()}</td>
          <td>${escapeHtml(r.title)}</td>
          <td>${r.recipients}</td>
          <td>${r.allowDelete ? 'unlocked' : '<span class="badge-locked">locked</span>'}</td>
          <td class="row-actions">
            <button type="button" class="btn-sm" data-resend-inbox="${i}">Re-send</button>
            <button type="button" class="btn-sm btn-warn" data-force-del-inbox="${i}">Delete</button>
          </td>
        </tr>`;
      })
      .join('');
  }
  syncInboxRecentBulk();
  const selectAll = document.getElementById('inbox-recent-select-all');
  if (selectAll) {
    const allChecked = rows.length > 0 && rows.every(({ i }) => inboxRecentSelected.has(i));
    selectAll.checked = allChecked;
    selectAll.indeterminate =
      !allChecked && rows.some(({ i }) => inboxRecentSelected.has(i));
  }
}

function syncInboxRecentBulk() {
  const bar = document.getElementById('inbox-recent-bulk');
  const n = inboxRecentSelected.size;
  if (bar) bar.classList.toggle('hidden', n === 0);
  const count = document.getElementById('inbox-recent-selected-count');
  if (count) count.textContent = String(n);
}

async function loadInboxRecent() {
  try {
    const { recent } = await api('/admin/inbox/recent');
    inboxRecentCache = recent || [];
    inboxRecentSelected.clear();
    renderInboxRecent();
  } catch (ex) {
    console.warn('[admin] inbox recent', ex.message);
  }
}

async function forceDeleteRecentAt(index) {
  const row = inboxRecentCache[index];
  if (!row) return 0;
  const data = await api('/admin/inbox/force-delete', {
    method: 'POST',
    body: {
      batchId: row.batchId || undefined,
      title: row.title,
      body: row.body || '',
      createdAt: row.createdAt,
      allowDelete: row.allowDelete !== false,
    },
  });
  return data.deleted || 0;
}

async function resendRecentAt(index) {
  const row = inboxRecentCache[index];
  if (!row) return 0;
  const data = await api('/admin/inbox', {
    method: 'POST',
    body: {
      broadcast: true,
      title: row.title,
      body: row.body || '',
      allowDelete: row.allowDelete !== false,
    },
  });
  return data.sent || 0;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showInboxStatus(msg, ok = true) {
  const el = document.getElementById('inbox-status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
  el.classList.toggle('ok', ok);
  el.classList.toggle('error', !ok);
  if (msg) setTimeout(() => el.classList.add('hidden'), 4000);
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
    if (t === 'messages') loadInboxRecent();
    if (t === 'push') loadPushStats();
  });
});

document.querySelectorAll('input[name="inbox-mode"]').forEach((el) => {
  el.addEventListener('change', () => {
    const mode = document.querySelector('input[name="inbox-mode"]:checked')?.value;
    document.getElementById('inbox-user-wrap')?.classList.toggle('hidden', mode === 'broadcast');
  });
});

document.getElementById('inbox-msg-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const mode = document.querySelector('input[name="inbox-mode"]:checked')?.value || 'single';
    const body = {
      title: document.getElementById('inbox-title').value,
      body: document.getElementById('inbox-body').value,
      allowDelete: document.getElementById('inbox-allow-delete').checked,
    };
    if (mode === 'broadcast') body.broadcast = true;
    else body.userId = document.getElementById('inbox-user-id').value.trim();
    const data = await api('/admin/inbox', { method: 'POST', body });
    showInboxStatus(`Sent to ${data.sent} inbox(es).`, true);
    document.getElementById('inbox-title').value = '';
    document.getElementById('inbox-body').value = '';
    loadInboxRecent();
  } catch (ex) {
    showInboxStatus(ex.message || 'Send failed.', false);
  }
});

document.querySelectorAll('input[name="push-mode"]').forEach((el) => {
  el.addEventListener('change', () => {
    const mode = document.querySelector('input[name="push-mode"]:checked')?.value;
    document.getElementById('push-user-wrap')?.classList.toggle('hidden', mode !== 'single');
  });
});

document.getElementById('push-samples')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-sample]');
  if (!btn) return;
  const s = PUSH_SAMPLES_FA[Number(btn.dataset.sample)];
  if (!s) return;
  document.getElementById('push-title').value = s.title;
  document.getElementById('push-body').value = s.body;
  document.getElementById('push-title')?.focus();
});

document.getElementById('push-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const mode = document.querySelector('input[name="push-mode"]:checked')?.value || 'broadcast';
    const body = {
      title: document.getElementById('push-title').value,
      body: document.getElementById('push-body').value,
      url: document.getElementById('push-url').value || '/',
    };
    if (mode === 'broadcast') body.broadcast = true;
    else body.userId = document.getElementById('push-user-id').value.trim();
    const data = await api('/admin/push', { method: 'POST', body });
    showPushStatus(
      `Sent ${data.sent}/${data.targeted} (failed ${data.failed}, stale removed ${data.removed}).`,
      true
    );
    loadPushStats();
  } catch (ex) {
    showPushStatus(ex.message || 'Send failed.', false);
  }
});

document.getElementById('inbox-recent-select-all')?.addEventListener('change', (e) => {
  const on = !!e.target.checked;
  const rows = filteredInboxRecent();
  if (on) {
    for (const { i } of rows) inboxRecentSelected.add(i);
  } else {
    for (const { i } of rows) inboxRecentSelected.delete(i);
  }
  renderInboxRecent();
});

document.getElementById('inbox-recent-body')?.addEventListener('change', (e) => {
  const cb = e.target.closest('[data-recent-check]');
  if (!cb) return;
  const idx = Number(cb.dataset.recentCheck);
  if (cb.checked) inboxRecentSelected.add(idx);
  else inboxRecentSelected.delete(idx);
  syncInboxRecentBulk();
  const rows = filteredInboxRecent();
  const selectAll = document.getElementById('inbox-recent-select-all');
  if (selectAll) {
    const allChecked = rows.length > 0 && rows.every(({ i }) => inboxRecentSelected.has(i));
    selectAll.checked = allChecked;
    selectAll.indeterminate =
      !allChecked && rows.some(({ i }) => inboxRecentSelected.has(i));
  }
});

document.getElementById('inbox-recent-bulk-delete')?.addEventListener('click', async () => {
  const idxs = [...inboxRecentSelected];
  if (!idxs.length) return;
  if (!confirm(`Force-delete ${idxs.length} selected send(s) for all recipients?`)) return;
  let total = 0;
  try {
    for (const idx of idxs) {
      total += await forceDeleteRecentAt(idx);
    }
    showInboxStatus(`Force-deleted ${total} message row(s) across ${idxs.length} send(s).`, true);
    loadInboxRecent();
  } catch (ex) {
    showInboxStatus(ex.message || 'Bulk delete failed.', false);
    loadInboxRecent();
  }
});

document.getElementById('inbox-recent-resend')?.addEventListener('click', async () => {
  const idxs = [...inboxRecentSelected];
  if (!idxs.length) return;
  if (!confirm(`Re-send (broadcast) ${idxs.length} selected message(s) to all users?`)) return;
  let total = 0;
  try {
    for (const idx of idxs) {
      total += await resendRecentAt(idx);
    }
    showInboxStatus(`Re-sent ${idxs.length} message(s) · ${total} inbox row(s) created.`, true);
    loadInboxRecent();
  } catch (ex) {
    showInboxStatus(ex.message || 'Bulk re-send failed.', false);
    loadInboxRecent();
  }
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
  const msg = e.target.closest('[data-msg]');
  const forceDel = e.target.closest('[data-force-del-inbox]');
  const resendOne = e.target.closest('[data-resend-inbox]');
  const filterChip = e.target.closest('[data-inbox-recent-filter]');

  if (filterChip) {
    inboxRecentFilter = filterChip.dataset.inboxRecentFilter || 'all';
    document.querySelectorAll('[data-inbox-recent-filter]').forEach((b) => {
      b.classList.toggle('active', b.dataset.inboxRecentFilter === inboxRecentFilter);
    });
    renderInboxRecent();
    return;
  }

  if (resendOne) {
    const idx = Number(resendOne.dataset.resendInbox);
    const row = inboxRecentCache[idx];
    if (!row) return;
    if (!confirm(`Re-send (broadcast) this message to all users?\n\n"${row.title}"`)) return;
    try {
      const sent = await resendRecentAt(idx);
      showInboxStatus(`Re-sent to ${sent} inbox(es).`, true);
      loadInboxRecent();
    } catch (ex) {
      showInboxStatus(ex.message || 'Re-send failed.', false);
    }
    return;
  }

  if (forceDel) {
    const idx = Number(forceDel.dataset.forceDelInbox);
    const row = inboxRecentCache[idx];
    if (!row) return;
    if (
      !confirm(
        row.allowDelete === false
          ? `Force-delete this LOCKED admin message for all recipients?\n\n"${row.title}"`
          : `Delete this admin message for all recipients?\n\n"${row.title}"`
      )
    ) {
      return;
    }
    try {
      const deleted = await forceDeleteRecentAt(idx);
      showInboxStatus(`Force-deleted ${deleted} message(s).`, true);
      loadInboxRecent();
    } catch (ex) {
      showInboxStatus(ex.message || 'Delete failed.', false);
    }
    return;
  }

  if (msg) {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.add('hidden'));
    document.querySelector('.tab[data-tab="messages"]')?.classList.add('active');
    document.getElementById('tab-messages')?.classList.remove('hidden');
    const single = document.querySelector('input[name="inbox-mode"][value="single"]');
    if (single) single.checked = true;
    document.getElementById('inbox-user-wrap')?.classList.remove('hidden');
    document.getElementById('inbox-user-id').value = msg.dataset.msg;
    document.getElementById('inbox-title')?.focus();
  }
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
