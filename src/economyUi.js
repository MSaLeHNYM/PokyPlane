/**
 * Rewards screen — Daily reward, Wheel of Luck, Marketplace — plus the
 * menu coins chip. Server-authoritative via /api/economy.
 */
import { t } from './i18n.js';
import { claimDailyReward, spinWheelOfLuck, buyMarketItem, isLoggedIn } from './api.js';
import {
  getEconomyState,
  setEconomyState,
  onEconomyChanged,
  refreshEconomy,
} from './economy.js';

const SEGMENT_COLORS = [
  '#3b82f6', '#f59e0b', '#10b981', '#ef4444',
  '#8b5cf6', '#f97316', '#14b8a6', '#eab308',
];

let isOpen = false;
let activeTab = 'daily';
let wheelRotation = 0; // cumulative CSS rotation (rad)
let spinning = false;
let dailyTimer = 0;
let toastFn = (msg) => console.log('[economy]', msg);

function itemLabel(key) {
  switch (key) {
    case 'ammo_cannon':
      return t('wpnCannon');
    case 'ammo_rocket':
      return t('wpnRocket');
    case 'ammo_missile':
      return t('wpnMissile');
    case 'wheel_spin':
      return t('wheelSpinItem');
    default:
      return key;
  }
}

function rewardText({ coins = 0, items = {} } = {}) {
  const parts = [];
  if (coins > 0) parts.push(`+${coins} ${t('coins')}`);
  for (const [key, qty] of Object.entries(items)) {
    if (qty > 0) parts.push(`+${qty} ${itemLabel(key)}`);
  }
  return parts.join(' · ');
}

function updateCoinsChips(state) {
  const coins = state?.coins ?? null;
  const chip = document.getElementById('coins-chip');
  const chipVal = document.getElementById('coins-chip-value');
  if (chip && chipVal) {
    chip.classList.toggle('hidden', coins == null);
    if (coins != null) chipVal.textContent = String(coins);
  }
  const rc = document.getElementById('rewards-coins');
  if (rc) rc.textContent = coins != null ? String(coins) : '—';
}

/* ---------- Daily ---------- */

function secsToNextUtcDay() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, Math.floor((next - now.getTime()) / 1000));
}

function fmtHMS(total) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderDaily() {
  const state = getEconomyState();
  const card = document.getElementById('daily-reward-card');
  const btn = document.getElementById('daily-claim-btn');
  const status = document.getElementById('daily-status');
  if (!card || !btn || !status) return;

  const reward = state?.dailyReward;
  card.innerHTML = reward
    ? `<div class="daily-reward-items">${rewardText(reward)}</div>`
    : `<div class="daily-reward-items">${t('loading')}</div>`;

  const available = !!state?.dailyRewardAvailable;
  btn.disabled = !available;
  if (available) {
    status.textContent = t('dailyAvailable');
  } else {
    status.textContent = `${t('dailyComeBack')} ${fmtHMS(secsToNextUtcDay())}`;
  }
}

async function onClaimDaily() {
  const btn = document.getElementById('daily-claim-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await claimDailyReward();
    if (res?.state) setEconomyState(res.state);
    toastFn(`${t('dailyClaimed')} ${rewardText(res?.reward)}`);
  } catch (e) {
    toastFn(e?.message || t('errorGeneric'));
    renderDaily();
  }
}

/* ---------- Wheel ---------- */

function segmentShortLabel(seg) {
  if (seg.coins) return String(seg.coins);
  const [key, qty] = Object.entries(seg.items || {})[0] || [];
  if (!key) return '?';
  const prefix =
    key === 'ammo_cannon' ? 'C' : key === 'ammo_rocket' ? 'R' : key === 'ammo_missile' ? 'M' : '★';
  return key === 'wheel_spin' ? `★${qty}` : `${prefix}+${qty}`;
}

function drawWheel() {
  const canvas = document.getElementById('wheel-canvas');
  const segs = getEconomyState()?.wheelSegments;
  if (!canvas || !segs?.length) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const cx = w / 2;
  const r = w / 2 - 6;
  const step = (Math.PI * 2) / segs.length;

  ctx.clearRect(0, 0, w, w);
  segs.forEach((seg, i) => {
    const a0 = i * step;
    ctx.beginPath();
    ctx.moveTo(cx, cx);
    ctx.arc(cx, cx, r, a0, a0 + step);
    ctx.closePath();
    ctx.fillStyle = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = 'rgba(10, 20, 34, 0.85)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.save();
    ctx.translate(cx, cx);
    ctx.rotate(a0 + step / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(w * 0.055)}px Fredoka, Nunito, Vazirmatn, sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 4;
    ctx.fillText(segmentShortLabel(seg), r - 14, 8);
    ctx.restore();
  });

  // Hub
  ctx.beginPath();
  ctx.arc(cx, cx, w * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = '#0e1c2e';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function updateSpinButton() {
  const btn = document.getElementById('wheel-spin-btn');
  const status = document.getElementById('wheel-status');
  if (!btn) return;
  const state = getEconomyState();
  const free = !!state?.wheelFreeAvailable;
  const spins = state?.wheelSpins ?? 0;
  btn.disabled = spinning || (!free && spins <= 0);
  btn.textContent = free
    ? `${t('spinWheel')} (${t('freeSpin')})`
    : `${t('spinWheel')} (${spins})`;
  if (status && !spinning) {
    status.textContent =
      free || spins > 0 ? t('wheelReady') : t('wheelNoSpins');
  }
}

async function onSpinWheel() {
  if (spinning) return;
  const canvas = document.getElementById('wheel-canvas');
  const status = document.getElementById('wheel-status');
  const segs = getEconomyState()?.wheelSegments;
  if (!canvas || !segs?.length) return;

  spinning = true;
  updateSpinButton();
  if (status) status.textContent = t('wheelSpinning');

  let res;
  try {
    res = await spinWheelOfLuck();
  } catch (e) {
    spinning = false;
    updateSpinButton();
    if (status) status.textContent = e?.message || t('errorGeneric');
    return;
  }

  const step = (Math.PI * 2) / segs.length;
  const segCenter = res.segmentIndex * step + step / 2;
  // Land the winning segment under the top pointer (-90°), always spinning forward.
  const target = -Math.PI / 2 - segCenter;
  const current = wheelRotation % (Math.PI * 2);
  let delta = target - current;
  while (delta < 0) delta += Math.PI * 2;
  wheelRotation += delta + Math.PI * 2 * 5;

  canvas.style.transition = 'transform 4.2s cubic-bezier(0.12, 0.65, 0.06, 1)';
  canvas.style.transform = `rotate(${wheelRotation}rad)`;

  setTimeout(() => {
    spinning = false;
    if (res.state) setEconomyState(res.state);
    else refreshEconomy();
    const prizeText = rewardText(res.prize);
    if (status) status.textContent = `${t('wheelWon')} ${prizeText}`;
    toastFn(`${t('wheelWon')} ${prizeText}`);
    updateSpinButton();
  }, 4400);
}

/* ---------- Market ---------- */

function marketItemName(entry) {
  const parts = [];
  for (const [key, qty] of Object.entries(entry.items || {})) {
    parts.push(`${qty} × ${itemLabel(key)}`);
  }
  return parts.join(' + ');
}

function renderMarket() {
  const grid = document.getElementById('market-grid');
  if (!grid) return;
  const state = getEconomyState();
  const catalog = state?.market || [];
  const coins = state?.coins ?? 0;
  grid.innerHTML = '';
  for (const entry of catalog) {
    const card = document.createElement('div');
    card.className = 'market-card';
    card.innerHTML = `
      <div class="market-card-name">${marketItemName(entry)}</div>
      <div class="market-card-price">🪙 ${entry.price}</div>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-btn menu-btn-sm primary';
    btn.textContent = t('buy');
    btn.disabled = coins < entry.price;
    btn.addEventListener('click', () => onBuy(entry, btn));
    card.appendChild(btn);
    grid.appendChild(card);
  }
}

async function onBuy(entry, btn) {
  const status = document.getElementById('market-status');
  btn.disabled = true;
  try {
    const res = await buyMarketItem(entry.id);
    if (res?.state) setEconomyState(res.state);
    if (status) status.textContent = `${t('purchased')}: ${marketItemName(entry)}`;
    toastFn(`${t('purchased')}: ${marketItemName(entry)}`);
  } catch (e) {
    if (status) status.textContent = e?.message || t('errorGeneric');
    renderMarket();
  }
}

/* ---------- Tabs / lifecycle ---------- */

function showTab(tab) {
  activeTab = tab;
  document.querySelectorAll('[data-rewards-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.rewardsTab === tab);
  });
  document.getElementById('rewards-daily')?.classList.toggle('hidden', tab !== 'daily');
  document.getElementById('rewards-wheel')?.classList.toggle('hidden', tab !== 'wheel');
  document.getElementById('rewards-market')?.classList.toggle('hidden', tab !== 'market');
  if (tab === 'daily') renderDaily();
  if (tab === 'wheel') {
    drawWheel();
    updateSpinButton();
  }
  if (tab === 'market') renderMarket();
}

function renderAll() {
  const state = getEconomyState();
  updateCoinsChips(state);
  if (!isOpen) return;
  renderDaily();
  updateSpinButton();
  if (activeTab === 'wheel') drawWheel();
  if (activeTab === 'market') renderMarket();
}

export function setupEconomyUI({ toast } = {}) {
  if (typeof toast === 'function') toastFn = toast;

  document.querySelectorAll('[data-rewards-tab]').forEach((b) => {
    b.addEventListener('click', () => showTab(b.dataset.rewardsTab));
  });
  document.getElementById('daily-claim-btn')?.addEventListener('click', onClaimDaily);
  document.getElementById('wheel-spin-btn')?.addEventListener('click', onSpinWheel);

  onEconomyChanged(renderAll);
}

export function openRewards(tab = 'daily') {
  isOpen = true;
  if (isLoggedIn()) refreshEconomy();
  showTab(tab);
  renderAll();
  clearInterval(dailyTimer);
  dailyTimer = setInterval(() => {
    if (isOpen && activeTab === 'daily') renderDaily();
  }, 1000);
}

export function closeRewards() {
  isOpen = false;
  clearInterval(dailyTimer);
}
