/**
 * Keyboard + touch + optional gamepad input aggregation.
 */
import { DEFAULT_KEY_BINDINGS, normalizeKeyBindings, allBoundCodes } from './keybindings.js';

function detectTouchUi() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(pointer: coarse)').matches) return true;
  return 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
}

export class Input {
  constructor() {
    this.keys = Object.create(null);
    this.bindings = normalizeKeyBindings(DEFAULT_KEY_BINDINGS);
    this._boundCodes = allBoundCodes(this.bindings);
    this.gameActive = false;
    this.isTouchUi = detectTouchUi();
    this.mouse = { x: 0, y: 0, look: false };
    this.touch = {
      pitch: 0,
      roll: 0,
      throttleUp: false,
      throttleDown: false,
      boost: false,
      fire: false,
      camera: false,
      pause: false,
      weaponCycle: false,
    };
    this._mouseDown = false;
    this._mouseLockDown = false;
    this.cameraCycle = false;
    this.pausePressed = false;
    this.firePressed = false;
    this.lockHeld = false;
    this.weaponSlot = null;
    this.weaponCycle = false;
    this._camLatch = false;
    this._pauseLatch = false;
    this._fireLatch = false;
    this._wpnCycleLatch = false;

    window.addEventListener('keydown', (e) => {
      if (this.gameActive && this._shouldPreventDefault(e)) {
        e.preventDefault();
      }
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.mouse.look) return;
      this.mouse.x += e.movementX * 0.002;
      this.mouse.y += e.movementY * 0.002;
      this.mouse.y = Math.max(-1.2, Math.min(1.2, this.mouse.y));
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.gameActive) return;
      if (e.button === 0) this._mouseDown = true;
      if (e.button === 2) this._mouseLockDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._mouseDown = false;
      if (e.button === 2) this._mouseLockDown = false;
    });
    window.addEventListener('contextmenu', (e) => {
      if (this.gameActive) e.preventDefault();
    });

    this._setupTouch();
  }

  setKeyBindings(bindings) {
    this.bindings = normalizeKeyBindings(bindings);
    this._boundCodes = allBoundCodes(this.bindings);
  }

  setGameActive(on) {
    this.gameActive = !!on;
  }

  /** Show/hide on-screen controls (menus stay above; only show while flying). */
  setTouchVisible(on) {
    const touchUI = document.getElementById('touch');
    if (!touchUI) return;
    const show = !!(on && this.isTouchUi);
    touchUI.classList.toggle('hidden', !show);
    touchUI.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (!show) this._resetTouchState();
  }

  _resetTouchState() {
    this.touch.pitch = 0;
    this.touch.roll = 0;
    this.touch.throttleUp = false;
    this.touch.throttleDown = false;
    this.touch.boost = false;
    this.touch.fire = false;
    this.touch.camera = false;
    this.touch.pause = false;
    this.touch.weaponCycle = false;
    const knob = document.querySelector('#stick-move .stick-knob');
    if (knob) knob.style.transform = 'translate(-50%, -50%)';
  }

  _shouldPreventDefault(e) {
    if (this._boundCodes.has(e.code)) return true;
    return ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code);
  }

  _any(action) {
    const codes = this.bindings[action];
    if (!codes?.length) return false;
    return codes.some((c) => this.keys[c]);
  }

  _setupTouch() {
    const stick = document.getElementById('stick-move');
    const knob = stick?.querySelector('.stick-knob');
    const touchUI = document.getElementById('touch');

    // Keep hidden until playing — main.js calls setTouchVisible
    if (touchUI) {
      touchUI.classList.add('hidden');
      touchUI.setAttribute('aria-hidden', 'true');
    }

    if (!this.isTouchUi || !stick) return;

    const setStick = (clientX, clientY) => {
      const rect = stick.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = (clientX - cx) / (rect.width / 2);
      let dy = (clientY - cy) / (rect.height / 2);
      const mag = Math.hypot(dx, dy);
      if (mag > 1) {
        dx /= mag;
        dy /= mag;
      }
      this.touch.roll = dx;
      this.touch.pitch = dy;
      if (knob) {
        const travel = Math.min(rect.width, rect.height) * 0.28;
        knob.style.transform = `translate(calc(-50% + ${dx * travel}px), calc(-50% + ${dy * travel}px))`;
      }
    };
    const resetStick = () => {
      this.touch.roll = 0;
      this.touch.pitch = 0;
      if (knob) knob.style.transform = 'translate(-50%, -50%)';
    };

    stick.addEventListener(
      'touchstart',
      (e) => {
        if (document.body.classList.contains('touch-layout-editing')) return;
        e.preventDefault();
        const t = e.changedTouches[0];
        setStick(t.clientX, t.clientY);
      },
      { passive: false }
    );
    stick.addEventListener(
      'touchmove',
      (e) => {
        if (document.body.classList.contains('touch-layout-editing')) return;
        e.preventDefault();
        const t = e.changedTouches[0];
        setStick(t.clientX, t.clientY);
      },
      { passive: false }
    );
    stick.addEventListener('touchend', resetStick);
    stick.addEventListener('touchcancel', resetStick);

    const hold = (el, prop) => {
      if (!el) return;
      const down = (e) => {
        if (document.body.classList.contains('touch-layout-editing')) return;
        e.preventDefault();
        this.touch[prop] = true;
      };
      const up = () => {
        this.touch[prop] = false;
      };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up);
      el.addEventListener('touchcancel', up);
      // Mouse fallback for hybrid devices / DevTools
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.touch[prop] = true;
      });
      el.addEventListener('mouseup', up);
      el.addEventListener('mouseleave', up);
    };

    hold(document.getElementById('touch-throttle'), 'throttleUp');
    hold(document.getElementById('touch-brake'), 'throttleDown');
    hold(document.getElementById('touch-boost'), 'boost');
    hold(document.getElementById('touch-fire'), 'fire');
    hold(document.getElementById('touch-camera'), 'camera');
    hold(document.getElementById('touch-pause'), 'pause');
    hold(document.getElementById('touch-weapon'), 'weaponCycle');
  }

  setMouseLook(on) {
    this.mouse.look = on;
    if (on) {
      document.body.requestPointerLock?.();
    } else if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
  }

  /** Edge-triggered flags. */
  pollEdges() {
    const cam = this._any('camera') || this.touch.camera;
    this.cameraCycle = cam && !this._camLatch;
    this._camLatch = cam;

    const pause = this._any('pause') || this.touch.pause;
    this.pausePressed = pause && !this._pauseLatch;
    this._pauseLatch = pause;

    const fire = !!(this._any('fire') || this.touch.fire || this._mouseDown);
    this.firePressed = fire && !this._fireLatch;
    this._fireLatch = fire;

    this.lockHeld = this._any('targetLock') || this._mouseLockDown;

    this.weaponSlot = null;
    for (let i = 0; i < 4; i++) {
      const action = `weapon${i + 1}`;
      const down = this._any(action);
      const latch = `_wpnLatch${i}`;
      if (down && !this[latch]) this.weaponSlot = i;
      this[latch] = down;
    }

    const wpnCycle = !!this.touch.weaponCycle;
    this.weaponCycle = wpnCycle && !this._wpnCycleLatch;
    this._wpnCycleLatch = wpnCycle;
  }

  getFlightInput() {
    let pitch = 0;
    let turn = 0;
    let roll = 0;

    if (this._any('pitchUp')) pitch += 1;
    if (this._any('pitchDown')) pitch -= 1;
    if (this._any('turnLeft')) turn += 1;
    if (this._any('turnRight')) turn -= 1;
    if (this._any('rollLeft')) roll -= 1;
    if (this._any('rollRight')) roll += 1;

    pitch += this.touch.pitch;
    turn -= this.touch.roll;

    const pads = navigator.getGamepads?.() || [];
    const gp = pads[0];
    let gpFire = false;
    let gpBoost = false;
    let gpThrottleUp = false;
    if (gp) {
      const ax = Math.abs(gp.axes[0]) > 0.15 ? gp.axes[0] : 0;
      const ay = Math.abs(gp.axes[1]) > 0.15 ? gp.axes[1] : 0;
      turn -= ax;
      pitch += ay;
      gpThrottleUp = !!gp.buttons[6]?.pressed;
      gpFire = !!(gp.buttons[0]?.pressed || gp.buttons[7]?.pressed);
      gpBoost = !!gp.buttons[1]?.pressed;
    }

    pitch = Math.max(-1, Math.min(1, pitch));
    turn = Math.max(-1, Math.min(1, turn));
    roll = Math.max(-1, Math.min(1, roll));

    const fire = !!(this._any('fire') || this.touch.fire || this._mouseDown || gpFire);

    return {
      pitch,
      turn,
      yaw: turn,
      roll,
      throttleUp: !!(this._any('throttleUp') || this.touch.throttleUp || gpThrottleUp),
      throttleDown: !!(this._any('throttleDown') || this.touch.throttleDown),
      boost: !!(this._any('boost') || this.touch.boost || gpBoost),
      fire,
    };
  }
}
