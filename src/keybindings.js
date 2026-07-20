/**
 * Keyboard bindings — stored as KeyboardEvent.code strings (e.g. KeyX, ShiftLeft).
 * Avoid Ctrl/Meta defaults: browsers reserve Ctrl+W, Ctrl+R, etc.
 */

export const DEFAULT_KEY_BINDINGS = {
  throttleUp: ['ShiftLeft', 'ShiftRight'],
  throttleDown: ['KeyX', 'KeyZ'],
  boost: ['Space'],
  pitchUp: ['KeyW', 'ArrowUp'],
  pitchDown: ['KeyS', 'ArrowDown'],
  turnLeft: ['KeyA', 'ArrowLeft'],
  turnRight: ['KeyD', 'ArrowRight'],
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  fire: ['KeyF'],
  targetLock: ['KeyT'],
  camera: ['KeyC'],
  pause: ['KeyP', 'Escape'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  weapon3: ['Digit3'],
  weapon4: ['Digit4'],
  flare: ['KeyG'],
  dodge: ['KeyR'],
  quickTurn: ['KeyV'],
};

export const KEY_BIND_ACTIONS = [
  'throttleUp',
  'throttleDown',
  'boost',
  'pitchUp',
  'pitchDown',
  'turnLeft',
  'turnRight',
  'rollLeft',
  'rollRight',
  'fire',
  'targetLock',
  'camera',
  'pause',
  'weapon1',
  'weapon2',
  'weapon3',
  'weapon4',
  'flare',
  'dodge',
  'quickTurn',
];

const KEY_LABELS = {
  Space: 'Space',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  MetaLeft: 'Meta',
  MetaRight: 'Meta',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Tab: 'Tab',
};

/** Human-readable label for one key code. */
export function formatKeyCode(code) {
  if (!code) return '?';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return code;
}

/** Human-readable label for an action's bound keys. */
export function formatBinding(codes) {
  if (!Array.isArray(codes) || !codes.length) return '—';
  const labels = [];
  const seen = new Set();
  for (const code of codes) {
    const label = formatKeyCode(code);
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels.join(' / ');
}

/** Merge saved bindings with defaults; drop invalid entries. */
export function normalizeKeyBindings(raw) {
  const out = {};
  for (const action of KEY_BIND_ACTIONS) {
    const defaults = DEFAULT_KEY_BINDINGS[action];
    const user = raw?.[action];
    if (Array.isArray(user) && user.length && user.every((c) => typeof c === 'string' && c.length)) {
      out[action] = [...user];
    } else {
      out[action] = [...defaults];
    }
  }
  return out;
}

export function cloneKeyBindings(bindings) {
  return normalizeKeyBindings(bindings);
}

/** Flat list of all bound codes (for preventDefault while playing). */
export function allBoundCodes(bindings) {
  const set = new Set();
  for (const codes of Object.values(normalizeKeyBindings(bindings))) {
    for (const c of codes) set.add(c);
  }
  return set;
}
