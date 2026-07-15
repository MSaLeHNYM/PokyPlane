/**
 * Keyboard + touch + optional gamepad input aggregation.
 */
import { DEFAULT_KEY_BINDINGS, normalizeKeyBindings, allBoundCodes } from './keybindings.js';

export class Input {
  constructor() {
    this.keys = Object.create(null);
    this.bindings = normalizeKeyBindings(DEFAULT_KEY_BINDINGS);
    this._boundCodes = allBoundCodes(this.bindings);
    this.gameActive = false;
    this.mouse = { x: 0, y: 0, look: false };
    this.touch = { pitch: 0, roll: 0, throttleUp: false, fire: false };
    this._mouseDown = false;
    this._mouseLockDown = false;
    this.cameraCycle = false;
    this.pausePressed = false;
    this.firePressed = false;
    this.lockHeld = false;
    this.weaponSlot = null;
    this._camLatch = false;
    this._pauseLatch = false;
    this._fireLatch = false;

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
    const thr = document.getElementById('touch-throttle');
    const fire = document.getElementById('touch-fire');
    const touchUI = document.getElementById('touch');

    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouch && touchUI) touchUI.classList.remove('hidden');

    if (!stick) return;

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
        knob.style.transform = `translate(calc(-50% + ${dx * 28}px), calc(-50% + ${dy * 28}px))`;
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
        e.preventDefault();
        const t = e.changedTouches[0];
        setStick(t.clientX, t.clientY);
      },
      { passive: false }
    );
    stick.addEventListener(
      'touchmove',
      (e) => {
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
      el.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          this.touch[prop] = true;
        },
        { passive: false }
      );
      el.addEventListener('touchend', () => {
        this.touch[prop] = false;
      });
    };
    hold(thr, 'throttleUp');
    hold(fire, 'fire');
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
    const cam = this._any('camera');
    this.cameraCycle = cam && !this._camLatch;
    this._camLatch = cam;

    const pause = this._any('pause');
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
    if (gp) {
      const ax = Math.abs(gp.axes[0]) > 0.15 ? gp.axes[0] : 0;
      const ay = Math.abs(gp.axes[1]) > 0.15 ? gp.axes[1] : 0;
      turn -= ax;
      pitch += ay;
      if (gp.buttons[6]?.pressed) this.touch.throttleUp = true;
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
      throttleUp: !!(this._any('throttleUp') || this.touch.throttleUp),
      throttleDown: !!this._any('throttleDown'),
      boost: !!(this._any('boost') || gpBoost),
      fire,
    };
  }
}
