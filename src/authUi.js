import {
  initAuth,
  login,
  register,
  logout,
  onAuthChanged,
  getUser,
  isLoggedIn,
  fetchProfileMeta,
  updateProfile,
  fetchLeaderboard,
} from './api.js';
import { mountAvatar, getAvatarMeta } from './avatars.js';
import { t } from './i18n.js';

let metaCache = null;

export async function setupAuthUI() {
  await initAuth();
  onAuthChanged(renderAccountChip);
  renderAccountChip(getUser());
  bindAuthModal();
  bindProfileModal();
  bindScoreboardModal();
}

function renderAccountChip(user) {
  const chip = document.getElementById('account-chip');
  const loginBtn = document.getElementById('btn-login');
  const accountRow = document.getElementById('menu-account-row');
  if (!chip) return;

  if (user) {
    chip.classList.remove('hidden');
    chip.innerHTML = `<span class="account-avatar" id="chip-avatar"></span>
      <span class="account-name">${user.displayName || user.username}</span>`;
    paintAvatar(document.getElementById('chip-avatar'), user.profileAvatar);
    loginBtn?.classList.add('hidden');
    accountRow?.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
    loginBtn?.classList.remove('hidden');
    accountRow?.classList.add('hidden');
  }
}

function paintAvatar(el, avatarId) {
  if (!el) return;
  const size = el.classList.contains('account-avatar') ? 32 : 72;
  mountAvatar(el, avatarId, size);
}

function bindAuthModal() {
  const modal = document.getElementById('auth-modal');
  const form = document.getElementById('auth-form');
  const toggle = document.getElementById('auth-toggle-mode');
  const errEl = document.getElementById('auth-error');
  let registerMode = false;

  document.getElementById('btn-login')?.addEventListener('click', () => {
    openAuthModal();
  });
  document.getElementById('auth-close')?.addEventListener('click', () => modal?.classList.add('hidden'));

  toggle?.addEventListener('click', () => {
    registerMode = !registerMode;
    document.getElementById('auth-register-fields')?.classList.toggle('hidden', !registerMode);
    document.getElementById('auth-submit').textContent = registerMode ? t('register') : t('login');
    toggle.textContent = registerMode ? t('haveAccount') : t('needAccount');
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl?.classList.add('hidden');
    try {
      const email = document.getElementById('auth-email').value;
      const password = document.getElementById('auth-password').value;
      if (registerMode) {
        await register({
          email,
          password,
          username: document.getElementById('auth-username').value,
          displayName: document.getElementById('auth-display').value,
        });
      } else {
        await login({ email, password });
      }
      modal?.classList.add('hidden');
      form.reset();
    } catch (ex) {
      if (errEl) {
        errEl.textContent = ex.message;
        errEl.classList.remove('hidden');
      }
    }
  });

  document.getElementById('btn-logout')?.addEventListener('click', () => logout());
}

/** Open login/register modal (e.g. multiplayer gate). */
export function openAuthModal() {
  const modal = document.getElementById('auth-modal');
  const errEl = document.getElementById('auth-error');
  errEl?.classList.add('hidden');
  modal?.classList.remove('hidden');
}

async function ensureMeta() {
  if (!metaCache) metaCache = await fetchProfileMeta();
  return metaCache;
}

function bindProfileModal() {
  const modal = document.getElementById('profile-modal');
  document.getElementById('btn-profile')?.addEventListener('click', async () => {
    const user = getUser();
    if (!user) return;
    const meta = await ensureMeta();
    modal?.classList.remove('hidden');

    const avatarGrid = document.getElementById('avatar-grid');
    avatarGrid.innerHTML = meta.avatars
      .map(
        (a) =>
          `<button type="button" class="avatar-pick${a.id === user.profileAvatar ? ' active' : ''}" data-id="${a.id}" title="${a.label}">
            <span class="avatar-pick-inner" data-avatar-slot="${a.id}"></span>
            <span class="avatar-pick-label">${a.label.split('—')[0].trim()}</span>
          </button>`
      )
      .join('');

    avatarGrid.querySelectorAll('[data-avatar-slot]').forEach((slot) => {
      mountAvatar(slot, slot.dataset.avatarSlot, 72);
    });

    const countrySel = document.getElementById('profile-country');
    countrySel.innerHTML = meta.countries
      .map((c) => `<option value="${c.code}"${c.code === user.countryCode ? ' selected' : ''}>${c.flag} ${c.name}</option>`)
      .join('');

    document.getElementById('profile-display').value = user.displayName || '';
    document.getElementById('profile-bio').value = user.bio || '';
    document.getElementById('profile-gender').value = user.gender || 'prefer_not_say';
  });

  document.getElementById('profile-close')?.addEventListener('click', () => modal?.classList.add('hidden'));

  document.getElementById('avatar-grid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.avatar-pick');
    if (!btn) return;
    document.querySelectorAll('.avatar-pick').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });

  document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const active = document.querySelector('.avatar-pick.active');
    try {
      await updateProfile({
        displayName: document.getElementById('profile-display').value,
        profileAvatar: active?.dataset.id,
        countryCode: document.getElementById('profile-country').value,
        gender: document.getElementById('profile-gender').value,
        bio: document.getElementById('profile-bio').value,
      });
      modal?.classList.add('hidden');
    } catch (ex) {
      alert(ex.message);
    }
  });
}

function bindScoreboardModal() {
  const modal = document.getElementById('scoreboard-modal');
  const body = document.getElementById('scoreboard-body');

  async function load(mode) {
    document.querySelectorAll('.sb-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    const data = await fetchLeaderboard(mode);
    body.innerHTML =
      data.leaderboard
        .map((r) => {
          const av = getAvatarMeta(r.profileAvatar);
          return `<tr>
            <td>${r.rank}</td>
            <td>${r.countryFlag} ${r.displayName || r.username}</td>
            <td><span class="sb-avatar" data-sb-av="${r.profileAvatar}"></span></td>
            <td>${r.bestScore}</td>
          </tr>`;
        })
        .join('') || `<tr><td colspan="4">${t('noScores')}</td></tr>`;

    body.querySelectorAll('[data-sb-av]').forEach((el) => mountAvatar(el, el.dataset.sbAv, 36));
  }

  document.getElementById('btn-scoreboard')?.addEventListener('click', async () => {
    modal?.classList.remove('hidden');
    await load('all');
  });
  document.getElementById('scoreboard-close')?.addEventListener('click', () => modal?.classList.add('hidden'));
  document.querySelectorAll('.sb-tab').forEach((btn) => {
    btn.addEventListener('click', () => load(btn.dataset.mode));
  });
}

export { isLoggedIn, getUser };
