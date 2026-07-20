/**
 * Armory panel — 3D weapon preview with stats and owned ammo.
 * Uses its own small renderer/scene so it never touches the game scene.
 */
import * as THREE from 'three';
import { WEAPON_DEFS, WEAPON_ORDER } from './weapons.js';
import { createWeaponModel } from './weaponModels.js';
import { t } from './i18n.js';
import { getEconomyState, onEconomyChanged, ammoFromState } from './economy.js';
import { isLoggedIn } from './api.js';

const AMMO_KEY_BY_WEAPON = {
  cannon: 'ammo_cannon',
  rocket: 'ammo_rocket',
  missile: 'ammo_missile',
};

let renderer = null;
let scene = null;
let camera = null;
let model = null;
let rafId = 0;
let activeWeaponId = 'mg';
let isOpen = false;

function ensureRenderer() {
  if (renderer) return;
  const canvas = document.getElementById('armory-canvas');
  if (!canvas) return;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.05, 20);
  camera.position.set(0, 0.35, 2.1);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x2a3446, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(2.4, 3, 2.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88bbff, 0.6);
  rim.position.set(-2.5, 1, -2);
  scene.add(rim);
}

function fitCanvas() {
  const canvas = document.getElementById('armory-canvas');
  if (!canvas || !renderer) return;
  const rect = canvas.parentElement?.getBoundingClientRect();
  const w = Math.max(120, Math.floor(rect?.width || 320));
  const h = Math.max(120, Math.floor(rect?.height || 260));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function setModel(weaponId) {
  if (!scene) return;
  if (model) {
    scene.remove(model);
    model.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    model = null;
  }
  model = createWeaponModel(weaponId);
  // Normalize to a consistent on-screen size
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = 1.15 / maxDim;
  model.scale.setScalar(s);
  model.position.sub(center.multiplyScalar(s));
  scene.add(model);
}

function loop() {
  if (!isOpen) return;
  rafId = requestAnimationFrame(loop);
  if (model) {
    model.rotation.y += 0.008;
    model.rotation.x = Math.sin(performance.now() * 0.0006) * 0.12;
  }
  fitCanvas();
  renderer.render(scene, camera);
}

function ammoText(weaponId) {
  if (weaponId === 'mg') return '∞';
  const ammo = ammoFromState(getEconomyState());
  return String(ammo[weaponId] ?? 0);
}

function renderList() {
  const list = document.getElementById('armory-list');
  if (!list) return;
  list.innerHTML = '';
  for (const id of WEAPON_ORDER) {
    const def = WEAPON_DEFS[id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `armory-item${id === activeWeaponId ? ' active' : ''}`;
    btn.setAttribute('role', 'option');
    btn.innerHTML = `
      <span class="armory-item-name">${t(def.nameKey)}</span>
      <span class="armory-item-ammo">${ammoText(id)}</span>`;
    btn.addEventListener('click', () => {
      activeWeaponId = id;
      setModel(id);
      renderList();
      renderStats();
    });
    list.appendChild(btn);
  }
}

function statRow(label, value, extraClass = '') {
  return `<div class="armory-stat-row ${extraClass}">
    <span class="armory-stat-label">${label}</span>
    <span class="armory-stat-value">${value}</span>
  </div>`;
}

function renderStats() {
  const box = document.getElementById('armory-stats');
  if (!box) return;
  const def = WEAPON_DEFS[activeWeaponId];
  const shotsPerSec = (1 / def.fireRate).toFixed(1);
  const range = Math.round(def.speed * def.life);
  const owned =
    activeWeaponId === 'mg'
      ? `∞ (${t('armoryInfinite')})`
      : `${ammoText(activeWeaponId)}${isLoggedIn() ? '' : ` (${t('armoryGuest')})`}`;

  box.innerHTML = `
    <h3 class="armory-stats-title">${t(def.nameKey)}</h3>
    ${statRow(t('statOwned'), owned, 'armory-owned')}
    ${statRow(t('statDamage'), def.damage)}
    ${statRow(t('statSpeed'), `${def.speed} m/s`)}
    ${statRow(t('statFireRate'), `${shotsPerSec}/s`)}
    ${statRow(t('statRange'), `${range} m`)}
    ${statRow(t('statHoming'), def.homing ? t('yes') : t('no'))}
  `;
}

export function setupArmoryUI() {
  onEconomyChanged(() => {
    if (!isOpen) return;
    renderList();
    renderStats();
  });
}

export function openArmory() {
  isOpen = true;
  ensureRenderer();
  if (!renderer) return;
  fitCanvas();
  setModel(activeWeaponId);
  renderList();
  renderStats();
  cancelAnimationFrame(rafId);
  loop();
}

export function closeArmory() {
  if (!isOpen) return;
  isOpen = false;
  cancelAnimationFrame(rafId);
}
