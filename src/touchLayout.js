/**
 * Per-user touch HUD layout — move/resize stick & buttons (Android / touch UI).
 * Positions are % of the #touch overlay (center of each control). Size is a scale multiplier.
 */

export const TOUCH_CONTROL_IDS = [
  'stick',
  'pause',
  'camera',
  'weapon',
  'brake',
  'boost',
  'throttle',
  'fire',
  'flare',
  'dodge',
  'reverse',
];

/** Sensible landscape defaults (center % + scale). Used when seeding the editor. */
export const DEFAULT_TOUCH_LAYOUT = {
  stick: { x: 14, y: 78, size: 1 },
  pause: { x: 92, y: 8, size: 1 },
  camera: { x: 78, y: 56, size: 1 },
  weapon: { x: 90, y: 56, size: 1 },
  brake: { x: 78, y: 68, size: 1 },
  boost: { x: 90, y: 68, size: 1 },
  throttle: { x: 78, y: 82, size: 1 },
  fire: { x: 90, y: 82, size: 1 },
  flare: { x: 66, y: 82, size: 1 },
  dodge: { x: 66, y: 68, size: 1 },
  reverse: { x: 66, y: 56, size: 1 },
};

const SELECTORS = {
  stick: '#stick-move',
  pause: '#touch-pause',
  camera: '#touch-camera',
  weapon: '#touch-weapon',
  brake: '#touch-brake',
  boost: '#touch-boost',
  throttle: '#touch-throttle',
  fire: '#touch-fire',
  flare: '#touch-flare',
  dodge: '#touch-dodge',
  reverse: '#touch-reverse',
};

let editing = false;
let selectedId = null;
let drag = null;
let pinch = null;
let onChange = null;
let layoutDraft = null;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function touchDist(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function syncSizeSlider() {
  const slider = document.getElementById('tle-size');
  if (slider && selectedId && layoutDraft?.[selectedId]) {
    slider.value = String(Math.round(layoutDraft[selectedId].size * 100));
  }
}

function cloneLayout(layout) {
  const out = {};
  for (const id of TOUCH_CONTROL_IDS) {
    const src = layout?.[id] || DEFAULT_TOUCH_LAYOUT[id];
    out[id] = {
      x: clamp(Number(src.x) || DEFAULT_TOUCH_LAYOUT[id].x, 4, 96),
      y: clamp(Number(src.y) || DEFAULT_TOUCH_LAYOUT[id].y, 4, 96),
      size: clamp(Number(src.size) || 1, 0.5, 2),
    };
  }
  return out;
}

export function normalizeTouchLayout(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return cloneLayout(raw);
}

function elFor(id) {
  return document.querySelector(SELECTORS[id]);
}

function touchRoot() {
  return document.getElementById('touch');
}

/** Read current on-screen centers into a layout object (CSS defaults → %). */
export function captureTouchLayoutFromDom() {
  const root = touchRoot();
  if (!root) return cloneLayout(DEFAULT_TOUCH_LAYOUT);
  const rr = root.getBoundingClientRect();
  if (rr.width < 8 || rr.height < 8) return cloneLayout(DEFAULT_TOUCH_LAYOUT);
  const out = {};
  for (const id of TOUCH_CONTROL_IDS) {
    const el = elFor(id);
    if (!el) {
      out[id] = { ...DEFAULT_TOUCH_LAYOUT[id] };
      continue;
    }
    const r = el.getBoundingClientRect();
    out[id] = {
      x: clamp(((r.left + r.width / 2 - rr.left) / rr.width) * 100, 4, 96),
      y: clamp(((r.top + r.height / 2 - rr.top) / rr.height) * 100, 4, 96),
      size: layoutDraft?.[id]?.size || DEFAULT_TOUCH_LAYOUT[id].size,
    };
  }
  return out;
}

function styleControl(el, entry) {
  if (!el || !entry) return;
  el.style.left = `${entry.x}%`;
  el.style.top = `${entry.y}%`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.transform = `translate(-50%, -50%) scale(${entry.size})`;
  el.style.transformOrigin = 'center center';
}

/** Apply saved layout, or clear custom styles when layout is null. */
export function applyTouchLayout(layout) {
  const root = touchRoot();
  if (!root) return;
  const normalized = normalizeTouchLayout(layout);
  if (!normalized) {
    root.classList.remove('touch-custom');
    for (const id of TOUCH_CONTROL_IDS) {
      const el = elFor(id);
      if (!el) continue;
      el.style.left = '';
      el.style.top = '';
      el.style.right = '';
      el.style.bottom = '';
      el.style.transform = '';
      el.style.transformOrigin = '';
      el.classList.remove('touch-selected');
    }
    return;
  }
  root.classList.add('touch-custom');
  for (const id of TOUCH_CONTROL_IDS) {
    styleControl(elFor(id), normalized[id]);
  }
}

export function isTouchLayoutEditing() {
  return editing;
}

function setSelected(id) {
  selectedId = id;
  for (const cid of TOUCH_CONTROL_IDS) {
    elFor(cid)?.classList.toggle('touch-selected', cid === id);
  }
  syncSizeSlider();
  const label = document.getElementById('tle-selected');
  if (label) label.textContent = id || '—';
}

function emitChange() {
  onChange?.(cloneLayout(layoutDraft));
}

function beginPinch(touches) {
  const id = selectedId || TOUCH_CONTROL_IDS[0];
  if (!id || !layoutDraft?.[id]) return;
  setSelected(id);
  const d0 = touchDist(touches[0], touches[1]);
  if (d0 < 8) return;
  drag = null;
  pinch = {
    id,
    startDist: d0,
    origSize: layoutDraft[id].size,
  };
}

function onPointerDown(e) {
  if (!editing) return;
  if (e.touches && e.touches.length >= 2) {
    e.preventDefault();
    e.stopPropagation();
    beginPinch(e.touches);
    return;
  }
  const ctrl = e.target.closest?.('[data-touch-id]');
  if (!ctrl || !touchRoot()?.contains(ctrl)) return;
  e.preventDefault();
  e.stopPropagation();
  const id = ctrl.dataset.touchId;
  setSelected(id);
  const root = touchRoot();
  const rr = root.getBoundingClientRect();
  const pt = e.touches?.[0] || e;
  pinch = null;
  drag = {
    id,
    startX: pt.clientX,
    startY: pt.clientY,
    origX: layoutDraft[id].x,
    origY: layoutDraft[id].y,
    rw: rr.width,
    rh: rr.height,
  };
}

function onPointerMove(e) {
  if (!editing) return;
  if (pinch && e.touches && e.touches.length >= 2) {
    e.preventDefault();
    e.stopPropagation();
    const d = touchDist(e.touches[0], e.touches[1]);
    const scale = d / pinch.startDist;
    layoutDraft[pinch.id].size = clamp(pinch.origSize * scale, 0.5, 2);
    styleControl(elFor(pinch.id), layoutDraft[pinch.id]);
    syncSizeSlider();
    return;
  }
  if (!drag) return;
  e.preventDefault();
  const pt = e.touches?.[0] || e;
  const dx = ((pt.clientX - drag.startX) / drag.rw) * 100;
  const dy = ((pt.clientY - drag.startY) / drag.rh) * 100;
  layoutDraft[drag.id].x = clamp(drag.origX + dx, 4, 96);
  layoutDraft[drag.id].y = clamp(drag.origY + dy, 4, 96);
  styleControl(elFor(drag.id), layoutDraft[drag.id]);
}

function onPointerUp(e) {
  if (pinch && (!e.touches || e.touches.length < 2)) {
    pinch = null;
    emitChange();
  }
  if (drag && (!e.touches || e.touches.length === 0)) {
    drag = null;
    emitChange();
  }
  // Mouse up
  if (!e.touches) {
    if (drag) {
      drag = null;
      emitChange();
    }
    pinch = null;
  }
}

/**
 * Enter layout editor. Returns draft layout (always a full object).
 * @param {object|null} current
 * @param {(layout: object) => void} changeCb
 */
export function startTouchLayoutEditor(current, changeCb) {
  const root = touchRoot();
  if (!root) return null;
  editing = true;
  onChange = changeCb || null;
  // Seed from DOM first so visual start matches what player sees
  root.classList.remove('hidden');
  root.setAttribute('aria-hidden', 'false');
  if (normalizeTouchLayout(current)) {
    layoutDraft = cloneLayout(current);
    applyTouchLayout(layoutDraft);
  } else {
    // show CSS defaults briefly then capture
    applyTouchLayout(null);
    layoutDraft = captureTouchLayoutFromDom();
    applyTouchLayout(layoutDraft);
  }
  document.body.classList.add('touch-layout-editing');
  root.classList.add('touch-editing');
  document.getElementById('touch-layout-editor')?.classList.remove('hidden');
  setSelected('stick');

  root.addEventListener('touchstart', onPointerDown, { passive: false, capture: true });
  root.addEventListener('touchmove', onPointerMove, { passive: false, capture: true });
  root.addEventListener('touchend', onPointerUp, { capture: true });
  root.addEventListener('touchcancel', onPointerUp, { capture: true });
  root.addEventListener('mousedown', onPointerDown, true);
  window.addEventListener('mousemove', onPointerMove, true);
  window.addEventListener('mouseup', onPointerUp, true);

  document.getElementById('tle-size')?.addEventListener('input', onSizeInput);

  emitChange();
  return cloneLayout(layoutDraft);
}

function onSizeInput(e) {
  if (!editing || !selectedId || !layoutDraft) return;
  layoutDraft[selectedId].size = clamp(Number(e.target.value) / 100, 0.5, 2);
  styleControl(elFor(selectedId), layoutDraft[selectedId]);
  emitChange();
}

export function resetTouchLayoutDraft() {
  if (!editing) return null;
  layoutDraft = cloneLayout(DEFAULT_TOUCH_LAYOUT);
  applyTouchLayout(layoutDraft);
  setSelected(selectedId || 'stick');
  emitChange();
  return cloneLayout(layoutDraft);
}

/** Exit editor. Returns final layout or null if cancelled (useCssDefaults). */
export function stopTouchLayoutEditor({ useCssDefaults = false } = {}) {
  const root = touchRoot();
  const result = useCssDefaults ? null : layoutDraft ? cloneLayout(layoutDraft) : null;

  editing = false;
  drag = null;
  pinch = null;
  onChange = null;
  document.body.classList.remove('touch-layout-editing');
  root?.classList.remove('touch-editing');
  document.getElementById('touch-layout-editor')?.classList.add('hidden');
  for (const id of TOUCH_CONTROL_IDS) {
    elFor(id)?.classList.remove('touch-selected');
  }

  if (root) {
    root.removeEventListener('touchstart', onPointerDown, true);
    root.removeEventListener('touchmove', onPointerMove, true);
    root.removeEventListener('touchend', onPointerUp, true);
    root.removeEventListener('touchcancel', onPointerUp, true);
    root.removeEventListener('mousedown', onPointerDown, true);
  }
  window.removeEventListener('mousemove', onPointerMove, true);
  window.removeEventListener('mouseup', onPointerUp, true);
  document.getElementById('tle-size')?.removeEventListener('input', onSizeInput);

  applyTouchLayout(result);
  layoutDraft = null;
  selectedId = null;
  return result;
}

export function getTouchLayoutDraft() {
  return layoutDraft ? cloneLayout(layoutDraft) : null;
}
