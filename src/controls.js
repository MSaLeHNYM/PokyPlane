/**
 * Keyboard + touch + optional gamepad input aggregation.
 */
export class Input {
  constructor() {
    this.keys = Object.create(null);
    this.mouse = { x: 0, y: 0, look: false };
    this.touch = { pitch: 0, roll: 0, throttleUp: false, fire: false };
    this._mouseDown = false;
    this.cameraCycle = false;
    this.pausePressed = false;
    this.firePressed = false;
    this.weaponSlot = null;
    this._camLatch = false;
    this._pauseLatch = false;
    this._fireLatch = false;

    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
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
      if (e.button === 0) this._mouseDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._mouseDown = false;
    });

    this._setupTouch();
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
      if (mag > 1) { dx /= mag; dy /= mag; }
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

    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      setStick(t.clientX, t.clientY);
    }, { passive: false });
    stick.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      setStick(t.clientX, t.clientY);
    }, { passive: false });
    stick.addEventListener('touchend', resetStick);
    stick.addEventListener('touchcancel', resetStick);

    const hold = (el, prop) => {
      if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); this.touch[prop] = true; }, { passive: false });
      el.addEventListener('touchend', () => { this.touch[prop] = false; });
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
    const cam = !!this.keys.KeyC;
    this.cameraCycle = cam && !this._camLatch;
    this._camLatch = cam;

    const pause = !!(this.keys.KeyP || this.keys.Escape);
    this.pausePressed = pause && !this._pauseLatch;
    this._pauseLatch = pause;

    const fire = !!(this.keys.KeyF || this.touch.fire || this._mouseDown);
    this.firePressed = fire && !this._fireLatch;
    this._fireLatch = fire;

    // Weapon slots 1–4
    this.weaponSlot = null;
    const slotKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
    for (let i = 0; i < 4; i++) {
      const down = !!this.keys[slotKeys[i]];
      const latch = `_wpnLatch${i}`;
      if (down && !this[latch]) this.weaponSlot = i;
      this[latch] = down;
    }
  }

  getFlightInput() {
    let pitch = 0;
    let turn = 0; // key remap: A=+1 → nose LEFT, D=-1 → nose RIGHT
    let roll = 0; // Q/E only

    // W/↑ dive, S/↓ climb
    if (this.keys.KeyW || this.keys.ArrowUp) pitch += 1;
    if (this.keys.KeyS || this.keys.ArrowDown) pitch -= 1;
    // A/← left, D/→ right (inverted vs math +Y so chase-cam feel is correct)
    if (this.keys.KeyA || this.keys.ArrowLeft) turn += 1;
    if (this.keys.KeyD || this.keys.ArrowRight) turn -= 1;
    // Q/E manual wing roll (Q = left wing down, E = right wing down)
    if (this.keys.KeyQ) roll -= 1;
    if (this.keys.KeyE) roll += 1;

    pitch += this.touch.pitch;
    turn -= this.touch.roll; // stick right → nose right

    const pads = navigator.getGamepads?.() || [];
    const gp = pads[0];
    let gpFire = false;
    let gpBoost = false;
    if (gp) {
      const ax = Math.abs(gp.axes[0]) > 0.15 ? gp.axes[0] : 0;
      const ay = Math.abs(gp.axes[1]) > 0.15 ? gp.axes[1] : 0;
      turn -= ax; // stick right → turn right
      pitch += ay;
      if (gp.buttons[6]?.pressed) this.touch.throttleUp = true;
      gpFire = !!(gp.buttons[0]?.pressed || gp.buttons[7]?.pressed);
      gpBoost = !!gp.buttons[1]?.pressed;
    }

    pitch = Math.max(-1, Math.min(1, pitch));
    turn = Math.max(-1, Math.min(1, turn));
    roll = Math.max(-1, Math.min(1, roll));

    const fire = !!(
      this.keys.KeyF ||
      this.keys.Mouse0 ||
      this.touch.fire ||
      this._mouseDown ||
      gpFire
    );

    return {
      pitch,
      turn,
      yaw: turn, // alias used by older code
      roll,
      throttleUp: !!(this.keys.ShiftLeft || this.keys.ShiftRight || this.touch.throttleUp),
      throttleDown: !!(this.keys.ControlLeft || this.keys.ControlRight || this.keys.KeyZ),
      boost: !!(this.keys.Space || gpBoost),
      fire,
    };
  }
}
