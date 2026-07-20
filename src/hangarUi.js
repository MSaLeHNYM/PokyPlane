/**
 * Hangar panel — 3D plane preview with flight stats (mirrors armory layout).
 */
import * as THREE from 'three';
import { PLANE_TYPES, createPlane } from './plane.js';
import { t } from './i18n.js';

const TAG_KEYS = {
  small: 'planeTagSmall',
  big: 'planeTagBig',
  war: 'planeTagWar',
  funny: 'planeTagFunny',
  sport: 'planeTagSport',
};

let renderer = null;
let scene = null;
let camera = null;
let model = null;
let rafId = 0;
let activeIndex = 0;
let isOpen = false;
let getPlaneIndex = () => 0;
let onSelectPlane = () => {};

function disposeObject3D(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
      else o.material.dispose?.();
    }
  });
}

function ensureRenderer() {
  if (renderer) return;
  const canvas = document.getElementById('hangar-canvas');
  if (!canvas) return;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.05, 40);
  camera.position.set(0.4, 0.55, 3.4);
  camera.lookAt(0, 0.1, 0);

  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x2a3446, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(3, 4, 2.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88bbff, 0.55);
  rim.position.set(-3, 2, -2.5);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffe8c8, 0.35);
  fill.position.set(0, -1, 2);
  scene.add(fill);
}

function fitCanvas() {
  const canvas = document.getElementById('hangar-canvas');
  if (!canvas || !renderer) return;
  const rect = canvas.parentElement?.getBoundingClientRect();
  const w = Math.max(120, Math.floor(rect?.width || 320));
  const h = Math.max(120, Math.floor(rect?.height || 260));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function setModel(index) {
  if (!scene) return;
  if (model) {
    scene.remove(model);
    disposeObject3D(model);
    model = null;
  }
  model = createPlane(index).group;
  model.rotation.y = Math.PI * 0.22;

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = 1.35 / maxDim;
  model.scale.setScalar(s);
  model.position.sub(center.multiplyScalar(s));
  model.position.y += 0.05;
  scene.add(model);
}

function loop() {
  if (!isOpen) return;
  rafId = requestAnimationFrame(loop);
  if (model) {
    model.rotation.y += 0.006;
    model.rotation.z = Math.sin(performance.now() * 0.0005) * 0.04;
  }
  fitCanvas();
  renderer.render(scene, camera);
}

function statRow(label, value, extraClass = '') {
  return `<div class="hangar-stat-row ${extraClass}">
    <span class="hangar-stat-label">${label}</span>
    <span class="hangar-stat-value">${value}</span>
  </div>`;
}

function rateBar(value, max = 2) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return `<span class="hangar-rate" aria-hidden="true"><span class="hangar-rate-fill" style="width:${pct}%"></span></span> ${value.toFixed(2)}`;
}

function renderList() {
  const list = document.getElementById('hangar-list');
  if (!list) return;
  const equipped = getPlaneIndex();
  list.innerHTML = '';
  PLANE_TYPES.forEach((plane, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `hangar-item${index === activeIndex ? ' active' : ''}${index === equipped ? ' equipped' : ''}`;
    btn.setAttribute('role', 'option');
    btn.innerHTML = `
      <span class="hangar-item-main">
        <span class="hangar-item-emoji">${plane.emoji}</span>
        <span class="hangar-item-name">${t(plane.nameKey)}</span>
      </span>
      <span class="hangar-item-meta">${plane.stats.maxSpeed}</span>`;
    btn.addEventListener('click', () => {
      activeIndex = index;
      setModel(index);
      onSelectPlane(index);
      renderList();
      renderStats();
    });
    list.appendChild(btn);
  });
}

function renderStats() {
  const box = document.getElementById('hangar-stats');
  if (!box) return;
  const plane = PLANE_TYPES[activeIndex];
  const s = plane.stats;
  const tagKey = TAG_KEYS[plane.tag] || plane.tag;
  const equipped = getPlaneIndex() === activeIndex;

  box.innerHTML = `
    <h3 class="hangar-stats-title">${plane.emoji} ${t(plane.nameKey)}</h3>
    <p class="hangar-stats-desc">${t(plane.descKey)}</p>
    ${statRow(t('statPlaneClass'), t(tagKey), 'hangar-tag')}
    ${equipped ? statRow(t('hangarEquipped'), '✓', 'hangar-equipped') : ''}
    ${statRow(t('statPlaneMaxSpeed'), s.maxSpeed)}
    ${statRow(t('statPlaneThrust'), s.maxThrust)}
    ${statRow(t('statPlaneHealth'), '100')}
    ${statRow(t('statPlaneStall'), s.stallSpeed)}
    ${statRow(t('statPlaneTakeoff'), s.takeoffSpeed)}
    ${statRow(t('statPlaneLand'), s.safeLandSpeed)}
    ${statRow(t('statPlanePitch'), rateBar(s.pitchRate))}
    ${statRow(t('statPlaneTurn'), rateBar(s.turnRate))}
    ${statRow(t('statPlaneRoll'), rateBar(s.rollRate))}
    ${statRow(t('statPlaneMass'), s.mass.toFixed(2))}
    ${statRow(t('statPlaneWingspan'), `${s.wingspan.toFixed(1)} m`)}
    ${statRow(t('statPlaneHitbox'), `${s.collisionRadius.toFixed(1)} m`)}
    ${statRow(t('statPlaneLift'), s.liftFactor.toFixed(2))}
    ${statRow(t('statPlaneDrag'), s.dragFactor.toFixed(2))}
    ${statRow(t('statPlaneGrip'), s.groundGrip.toFixed(2))}
  `;
}

export function setupHangarUI({ getSelectedPlane, selectPlane } = {}) {
  if (getSelectedPlane) getPlaneIndex = getSelectedPlane;
  if (selectPlane) onSelectPlane = selectPlane;
}

export function openHangar() {
  isOpen = true;
  activeIndex = getPlaneIndex();
  ensureRenderer();
  if (!renderer) return;
  fitCanvas();
  setModel(activeIndex);
  renderList();
  renderStats();
  cancelAnimationFrame(rafId);
  loop();
}

export function closeHangar() {
  if (!isOpen) return;
  isOpen = false;
  cancelAnimationFrame(rafId);
}
