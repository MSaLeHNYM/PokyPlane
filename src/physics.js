/**
 * =============================================================================
 * POKYPLANE NAVIGATION PLAN (arcade — Ace Combat "Standard / Novice")
 * =============================================================================
 * Real aircraft axes:
 *   PITCH  — nose up/down     (elevator)
 *   YAW    — nose left/right  (rudder)
 *   ROLL   — wings bank       (ailerons)
 *
 * Real efficient turn = bank (roll) then pull (pitch). Hard for casual players.
 * Arcade STANDARD scheme (Rogue Squadron / Ace Combat Normal):
 *   Left/Right directly YAWS the nose left/right ("drive the plane"),
 *   and we AUTO-BANK visually into the turn for polish.
 *
 * CONTROLS
 *   A / ←     Nose LEFT   (turn left)
 *   D / →     Nose RIGHT  (turn right)
 *   W / ↑     Nose DOWN   (dive)
 *   S / ↓     Nose UP     (climb / rotate for takeoff)
 *   Q / E     Extra roll (barrel / fine wing level)
 *   Shift     Throttle UP (speed)
 *   Ctrl / Z  Throttle DOWN (slow / approach)
 *   Space     Boost
 *
 * TAKEOFF
 *   1) Shift to build throttle & roll down runway
 *   2) A/D steer nose while taxiing
 *   3) At takeoffSpeed + throttle high → pull S → lift off
 *
 * LANDING
 *   1) Cut throttle, line up with A/D (wings stay mostly level)
 *   2) Gentle descent; touchdown only safe under safeLandSpeed
 *   3) Faster than safeLandSpeed on contact → crash
 *
 * Model: aircraft nose = local +Z.
 * =============================================================================
 */
import * as THREE from 'three';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _worldUp = new THREE.Vector3(0, 1, 0);

export class FlightModel {
  constructor() {
    this.position = new THREE.Vector3(0, 2.5, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.quaternion = new THREE.Quaternion();

    this.throttle = 0;
    this.health = 100;
    this.onGround = true;
    this.stalling = false;
    this.crashed = false;
    this.canTakeoff = false;
    this.phase = 'taxi'; // taxi | takeoff | airborne | landing

    this.maxThrust = 90;
    this.baseDrag = 0.024;
    this.gravity = 30;
    this.stallSpeed = 26;
    this.takeoffSpeed = 30;
    this.maxSpeed = 145;
    this.safeLandSpeed = 42;

    // Fuel (optional limit)
    this.fuelLimit = false;
    this.fuel = 100;
    this.fuelMax = 100;
    this.fuelBurn = 3.2; // % per second at full throttle
    this.fuelBoostBurn = 8; // extra %/s while boosting
    this.outOfFuel = false;

    // Softer rates — easy & fun
    this.pitchRate = 1.2;
    this.turnRate = 1.35; // nose left/right (main steer)
    this.rollRate = 1.4; // Q/E barrel only
    this.autoBank = 0.55; // visual bank into turn
    this.alignStrength = 2.6;
    this.gearHeight = 1.35;
    this.worldBound = Infinity;

    // Smoothed inputs
    this.pitchVel = 0;
    this.turnVel = 0;
    this.rollVel = 0;
  }

  reset(spawn = { x: 0, y: null, z: 20 }) {
    this.position.set(spawn.x, spawn.y ?? 2.5, spawn.z);
    this.velocity.set(0, 0, 0);
    this.quaternion.identity();
    this.throttle = 0;
    this.health = 100;
    this.fuel = this.fuelMax;
    this.outOfFuel = false;
    this.onGround = true;
    this.stalling = false;
    this.crashed = false;
    this.phase = 'taxi';
    this.pitchVel = 0;
    this.turnVel = 0;
    this.rollVel = 0;
  }

  addFuel(amount) {
    if (!this.fuelLimit) return;
    this.fuel = Math.min(this.fuelMax, this.fuel + amount);
    this.outOfFuel = this.fuel <= 0;
  }

  get airspeed() {
    return this.velocity.length();
  }

  get forward() {
    return _fwd.set(0, 0, 1).applyQuaternion(this.quaternion);
  }

  get right() {
    return _right.set(1, 0, 0).applyQuaternion(this.quaternion);
  }

  get up() {
    return _up.set(0, 1, 0).applyQuaternion(this.quaternion);
  }

  get heading() {
    const f = this.forward;
    let deg = (Math.atan2(f.x, f.z) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  }

  /**
   * input.turn:  controls map D → negative turn → nose RIGHT (see controls.js)
   * input.pitch: +1 = nose DOWN (W),   -1 = nose UP (S)
   * input.roll:  Q/E barrel roll only
   */
  update(dt, input, getHeight) {
    if (this.crashed) return;

    // ---- Fuel burn ----
    if (this.fuelLimit) {
      const burn =
        this.throttle * this.fuelBurn * dt +
        (input.boost && this.fuel > 0 ? this.fuelBoostBurn * dt : 0);
      // Idle bleed only while airborne with some throttle
      this.fuel = Math.max(0, this.fuel - burn);
      this.outOfFuel = this.fuel <= 0.05;
      if (this.outOfFuel) {
        this.fuel = 0;
        this.throttle = Math.max(0, this.throttle - dt * 1.2);
      }
    } else {
      this.outOfFuel = false;
    }

    // ---- Throttle ----
    const canPower = !this.fuelLimit || this.fuel > 0;
    if (canPower && input.throttleUp) this.throttle = Math.min(1, this.throttle + dt * 0.5);
    if (input.throttleDown) this.throttle = Math.max(0, this.throttle - dt * 0.55);
    if (canPower && input.boost) this.throttle = Math.min(1, this.throttle + dt * 0.85);

    const ground = getHeight(this.position.x, this.position.z);
    const agl = this.position.y - ground;
    const grounded = agl <= this.gearHeight + 0.15;

    // ---- Smooth stick ----
    const ease = (cur, target, k) => cur + (target - cur) * (1 - Math.exp(-k * dt));
    const turnIn = input.turn ?? input.yaw ?? 0; // compat
    const pitchIn = input.pitch ?? 0;
    const rollIn = input.roll ?? 0;

    // Ground: strong steer for taxi; pitch limited
    const turnAuth = grounded ? 1.1 : 1;
    const pitchAuth = grounded ? 0.35 : 1;

    this.turnVel = ease(this.turnVel, turnIn * this.turnRate * turnAuth, 11);
    this.pitchVel = ease(this.pitchVel, pitchIn * this.pitchRate * pitchAuth, 10);
    this.rollVel = ease(this.rollVel, rollIn * this.rollRate * (grounded ? 0.1 : 1), 10);

    // 1) YAW nose on world-up — Standard scheme: +turn = nose RIGHT (D)
    //    Facing +Z: +Y rotation moves nose toward +X = screen-right.
    _quat.setFromAxisAngle(_worldUp, this.turnVel * dt);
    this.quaternion.premultiply(_quat);

    // 2) Pitch in local space (nose up/down)
    _quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitchVel * dt);
    this.quaternion.multiply(_quat);

    // 3) Optional manual roll (Q/E)
    _quat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.rollVel * dt);
    this.quaternion.multiply(_quat);

    // 4) Auto-bank into turn + keep manual roll (do not wipe Q/E)
    _euler.setFromQuaternion(this.quaternion, 'YXZ');
    const desiredBank = THREE.MathUtils.clamp(
      -this.turnVel * this.autoBank + this.rollVel * 0.55,
      -1.15,
      1.15
    );
    const bankK = Math.abs(rollIn) > 0.15 ? 4.5 : 6;
    if (!grounded) {
      _euler.z = THREE.MathUtils.lerp(_euler.z, desiredBank, 1 - Math.exp(-bankK * dt));
    } else {
      // Level wings on ground
      _euler.z = THREE.MathUtils.lerp(_euler.z, 0, 1 - Math.exp(-8 * dt));
      _euler.x = THREE.MathUtils.clamp(_euler.x, -0.2, 0.06);
    }
    this.quaternion.setFromEuler(_euler);
    this.quaternion.normalize();

    _fwd.set(0, 0, 1).applyQuaternion(this.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.quaternion);
    _right.set(1, 0, 0).applyQuaternion(this.quaternion);

    const speed = Math.max(this.airspeed, 0.01);
    this.stalling = !grounded && speed < this.stallSpeed;
    this.canTakeoff = grounded && speed >= this.takeoffSpeed && this.throttle > 0.55;

    // Phase labels (HUD / teaching)
    if (grounded && speed < 8) this.phase = 'taxi';
    else if (grounded && speed >= 8) this.phase = this.canTakeoff ? 'takeoff' : 'taxi';
    else if (!grounded && this.throttle < 0.35 && agl < 40) this.phase = 'landing';
    else this.phase = 'airborne';

    // ---- Forces ----
    const boostMul = canPower && input.boost ? 1.4 : 1;
    const thrust = this.maxThrust * this.throttle * boostMul;
    this.velocity.addScaledVector(_fwd, thrust * dt);

    if (grounded) {
      // Taxi / ground roll
      const friction = 0.45 + (1 - this.throttle) * 2.6;
      this.velocity.multiplyScalar(Math.max(0, 1 - friction * dt));
      this.velocity.y = 0;
      const flat = _tmp.set(_fwd.x, 0, _fwd.z);
      if (flat.lengthSq() > 1e-6) {
        flat.normalize();
        const hSpd = Math.hypot(this.velocity.x, this.velocity.z);
        this.velocity.x = flat.x * hSpd;
        this.velocity.z = flat.z * hSpd;
      }
    } else {
      this.velocity.y -= this.gravity * dt;

      // Lift when wings have speed
      const level = Math.max(0.15, _up.dot(_worldUp));
      let lift = speed * speed * 0.0005 * level;
      if (this.stalling) lift *= speed / this.stallSpeed;
      this.velocity.addScaledVector(_up, lift * dt * 20);

      // Energy trade climb/dive
      const pitchDot = _fwd.dot(_worldUp);
      this.velocity.addScaledVector(_fwd, -pitchDot * 14 * dt);

      const drag = this.baseDrag + (1 - this.throttle) * 0.012;
      this.velocity.multiplyScalar(Math.max(0, 1 - drag * speed * dt));

      // Arcade: airspeed follows nose
      if (!this.stalling) {
        const target = _tmp.copy(_fwd).multiplyScalar(Math.max(speed, 8));
        this.velocity.lerp(target, 1 - Math.exp(-this.alignStrength * dt));
      }
    }

    // Throttle-limited top speed
    const maxSp = this.maxSpeed * (input.boost ? 1.15 : 1);
    const softMax = THREE.MathUtils.lerp(22, maxSp, Math.max(this.throttle, grounded ? 0 : 0.2));
    if (this.velocity.length() > softMax) {
      this.velocity.setLength(
        THREE.MathUtils.lerp(this.velocity.length(), softMax, 1 - Math.exp(-3 * dt))
      );
    }

    this.position.addScaledVector(this.velocity, dt);

    // ---- Ground contact / LANDING ----
    if (this.position.y < ground + this.gearHeight) {
      const impactVy = this.velocity.y;
      const wasAir = !this.onGround;
      this.position.y = ground + this.gearHeight;

      _euler.setFromQuaternion(this.quaternion, 'YXZ');
      const horiz = Math.hypot(this.velocity.x, this.velocity.z);
      const steep = Math.abs(_euler.x) > 0.4 || Math.abs(_euler.z) > 0.55;

      if (wasAir) {
        // High-speed landings crash — must bleed speed first
        if (horiz > this.safeLandSpeed || impactVy < -28 || steep) {
          const over = Math.max(0, horiz - this.safeLandSpeed);
          this.takeDamage(50 + over * 2.4 + Math.max(0, -impactVy) + (steep ? 55 : 0));
        }
      }

      this.onGround = true;
      this.velocity.y = 0;
    } else {
      this.onGround = false;
    }

    // ---- TAKEOFF rotate ----
    // Pull nose up (S → pitch < 0) once at rotate speed
    if (this.onGround && this.canTakeoff && pitchIn < -0.25) {
      this.position.y += 0.5;
      this.velocity.y = 7;
      this.onGround = false;
      this.phase = 'airborne';
    }

    this.position.y = Math.min(this.position.y, 260);
  }

  territoryStatus(radius, soft = 40) {
    const d = Math.hypot(this.position.x, this.position.z);
    if (d < radius - soft) return { outside: false, t: 0, dist: d };
    if (d < radius) return { outside: false, t: (d - (radius - soft)) / soft, dist: d };
    return { outside: true, t: 1, dist: d };
  }

  applyTerritoryPush(radius, dt) {
    const st = this.territoryStatus(radius);
    if (st.t <= 0) return st;
    const push = _tmp.set(-this.position.x, 0, -this.position.z).normalize();
    this.velocity.addScaledVector(push, 45 * st.t * dt);
    if (st.outside) this.takeDamage(6 * dt);
    return st;
  }

  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.crashed = true;
  }
}
