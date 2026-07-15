/**
 * Arcade flight model with realistic ground handling.
 * On the ground: yaw-only steering, wings level, no climb.
 * Airborne: per-aircraft mass, lift, drag, and control feel.
 *
 * Terrain: separate nose + main-gear height probes.
 * Stall: wing-drop and incipient spin when slow + banked.
 * Wind: map + weather drive crosswind, gusts, and lift bumps.
 */
import * as THREE from 'three';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _local = new THREE.Vector3();
const _wind = new THREE.Vector3();
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
    this.spinning = false;
    this.crashed = false;
    this.canTakeoff = false;
    this.phase = 'taxi';
    this.rotateForTakeoff = false;

    this.maxThrust = 90;
    this.baseDrag = 0.024;
    this.gravity = 30;
    this.stallSpeed = 26;
    this.takeoffSpeed = 30;
    this.maxSpeed = 145;
    this.safeLandSpeed = 42;

    this.fuelLimit = false;
    this.fuel = 100;
    this.fuelMax = 100;
    this.fuelBurn = 3.2;
    this.fuelBoostBurn = 8;
    this.outOfFuel = false;

    this.pitchRate = 1.2;
    this.turnRate = 1.35;
    this.rollRate = 1.4;
    this.autoBank = 0.55;
    this.alignStrength = 2.6;
    this.gearHeight = 1.35;
    this.wheelSpread = 0.35;
    this.wheelOffsetZ = 0.2;
    this.noseOffsetZ = 1.55;
    this.tailOffsetZ = -1.1;
    this.hitRadius = 3.2;
    this.collisionLength = 5.4;
    this.wingspan = 4.8;
    this.mass = 1;
    this.liftFactor = 1;
    this.dragFactor = 1;
    this.groundGrip = 1;
    this.planeId = 'poky';
    this.worldBound = Infinity;

    this.pitchVel = 0;
    this.turnVel = 0;
    this.rollVel = 0;

    this._envWind = null;
    this._weather = 'clear';
    this._envTime = 0;
    this._windLiftMod = 1;
    this.windSpeed = 0;
    this.crosswind = 0;

    /** Per-probe terrain clearance (m), updated each frame. */
    this.contact = { nose: 0, gearL: 0, gearR: 0, tail: 0 };
  }

  setEnvironment({ mapWind, weather, time }) {
    this._envWind = mapWind;
    this._weather = weather || 'clear';
    this._envTime = time ?? 0;
  }

  reset(spawn = { x: 0, y: null, z: 20, heading: 0 }) {
    this.position.set(spawn.x, spawn.y ?? this.gearHeight + 0.5, spawn.z);
    this.velocity.set(0, 0, 0);
    this.quaternion.identity();
    if (spawn.heading != null || spawn.pitch != null || spawn.roll != null) {
      _euler.set(spawn.pitch ?? 0, spawn.heading ?? 0, spawn.roll ?? 0, 'YXZ');
      this.quaternion.setFromEuler(_euler);
    }
    this.throttle = 0;
    this.health = 100;
    this.fuel = this.fuelMax;
    this.outOfFuel = false;
    this.onGround = true;
    this.stalling = false;
    this.spinning = false;
    this.crashed = false;
    this.phase = 'taxi';
    this.rotateForTakeoff = false;
    this.pitchVel = 0;
    this.turnVel = 0;
    this.rollVel = 0;
    this._windLiftMod = 1;
    this._lockGroundAttitude();
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

  _lockGroundAttitude() {
    _euler.setFromQuaternion(this.quaternion, 'YXZ');
    _euler.x = 0;
    _euler.z = 0;
    this.quaternion.setFromEuler(_euler);
    this.quaternion.normalize();
  }

  _ease(cur, target, k, dt) {
    return cur + (target - cur) * (1 - Math.exp(-k * dt));
  }

  /** Raycast-style height probes at nose, main gear, and tail. */
  _sampleContacts(getHeight) {
    const probes = [
      { key: 'nose', lx: 0, lz: this.noseOffsetZ },
      { key: 'gearL', lx: -this.wheelSpread, lz: this.wheelOffsetZ },
      { key: 'gearR', lx: this.wheelSpread, lz: this.wheelOffsetZ },
      { key: 'tail', lx: 0, lz: this.tailOffsetZ },
    ];

    let maxPen = 0;
    let minClear = Infinity;
    const groundYs = {};

    for (const p of probes) {
      _local.set(p.lx, -this.gearHeight, p.lz).applyQuaternion(this.quaternion);
      const wx = this.position.x + _local.x;
      const wy = this.position.y + _local.y;
      const wz = this.position.z + _local.z;
      const gy = getHeight(wx, wz);
      const clearance = wy - gy;
      const pen = gy - wy;

      this.contact[p.key] = clearance;
      groundYs[p.key] = gy;
      minClear = Math.min(minClear, clearance);
      if (pen > maxPen) maxPen = pen;
    }

    const grounded = minClear <= 0.14;
    return { grounded, maxPen, minClear, groundYs };
  }

  _applyGroundAttitude(dt, groundYs, allowPitch) {
    _euler.setFromQuaternion(this.quaternion, 'YXZ');

    const noseG = groundYs.nose ?? 0;
    const tailG = groundYs.tail ?? 0;
    const leftG = groundYs.gearL ?? 0;
    const rightG = groundYs.gearR ?? 0;

    const wheelbase = this.noseOffsetZ - this.tailOffsetZ;
    const slopePitch = Math.atan2(noseG - tailG, Math.max(wheelbase, 0.5));
    const slopeRoll = Math.atan2(rightG - leftG, Math.max(this.wheelSpread * 2, 0.2));

    if (allowPitch) {
      const pitchTarget = THREE.MathUtils.clamp(slopePitch, -0.32, 0.28);
      _euler.x = THREE.MathUtils.lerp(_euler.x, pitchTarget, 1 - Math.exp(-5 * dt));
    } else {
      _euler.x = THREE.MathUtils.lerp(_euler.x, 0, 1 - Math.exp(-8 * dt));
    }

    const rollTarget = THREE.MathUtils.clamp(slopeRoll, -0.22, 0.22);
    _euler.z = THREE.MathUtils.lerp(_euler.z, rollTarget, 1 - Math.exp(-6 * dt));

    this.quaternion.setFromEuler(_euler);
    this.quaternion.normalize();
  }

  _applyWind(dt) {
    const w = this._envWind;
    if (!w || this.onGround) {
      this.windSpeed = 0;
      this.crosswind = 0;
      this._windLiftMod = 1;
      return;
    }

    const t = this._envTime;
    const gust =
      Math.sin(t * 2.4 + this.position.x * 0.018) *
      Math.cos(t * 1.7 + this.position.z * 0.014) *
      w.turbulence *
      7;
    const dir = w.direction + Math.sin(t * 0.09) * 0.4;

    _wind.set(Math.sin(dir), 0, Math.cos(dir)).multiplyScalar(w.speed + gust);
    this.windSpeed = _wind.length();

    const relWind = _tmp.copy(_wind).sub(
      _local.set(this.velocity.x, 0, this.velocity.z)
    );
    this.crosswind = relWind.dot(this.right);

    this.velocity.x += _wind.x * 0.38 * dt;
    this.velocity.z += _wind.z * 0.38 * dt;

    const vBump =
      Math.sin(this.position.x * 0.06 + t * 3.2) *
      Math.cos(this.position.z * 0.05 + t * 2.6) *
      w.turbulence *
      5.5;
    this.velocity.y += vBump * dt * 0.35;

    this.turnVel += this.crosswind * 0.0018 * dt;
    this._windLiftMod = THREE.MathUtils.clamp(1 - Math.abs(vBump) * 0.018, 0.82, 1.08);
  }

  _applyStallSpin(dt) {
    this.spinning = false;
    if (this.onGround || !this.stalling) return;

    _euler.setFromQuaternion(this.quaternion, 'YXZ');
    const bank = _euler.z;
    const bankAbs = Math.abs(bank);
    const speed = this.airspeed;

    if (bankAbs > 0.35 && speed < this.stallSpeed * 0.92) {
      const dropDir = bank >= 0 ? 1 : -1;
      const drop = (0.55 + bankAbs * 1.4) * (1 - speed / this.stallSpeed);
      this.rollVel += dropDir * drop * dt * 2.8;
      this.turnVel += dropDir * bankAbs * 1.35 * dt;
      this.pitchVel += 0.45 * dt;
      this.spinning = bankAbs > 0.55 && speed < this.stallSpeed * 0.72;
    } else if (speed < this.stallSpeed * 0.78) {
      this.pitchVel += 0.35 * dt;
    }

    if (this.spinning) {
      const spinPush = (0.65 + bankAbs) * (1 - speed / (this.stallSpeed * 1.1));
      this.rollVel += (bank >= 0 ? 1 : -1) * spinPush * dt * 1.6;
      this.turnVel += (bank >= 0 ? 1 : -1) * spinPush * dt * 1.1;
    }
  }

  update(dt, input, getHeight) {
    if (this.crashed) return;

    if (this.fuelLimit) {
      const burn =
        this.throttle * this.fuelBurn * dt +
        (input.boost && this.fuel > 0 ? this.fuelBoostBurn * dt : 0);
      this.fuel = Math.max(0, this.fuel - burn);
      this.outOfFuel = this.fuel <= 0.05;
      if (this.outOfFuel) {
        this.fuel = 0;
        this.throttle = Math.max(0, this.throttle - dt * 1.2);
      }
    } else {
      this.outOfFuel = false;
    }

    const canPower = !this.fuelLimit || this.fuel > 0;
    if (canPower && input.throttleUp) this.throttle = Math.min(1, this.throttle + dt * 0.5);
    if (input.throttleDown) this.throttle = Math.max(0, this.throttle - dt * 0.55);
    if (canPower && input.boost) this.throttle = Math.min(1, this.throttle + dt * 0.85);

    const contacts = this._sampleContacts(getHeight);
    const grounded = contacts.grounded;
    const agl = this.position.y - getHeight(this.position.x, this.position.z);

    const turnIn = input.turn ?? input.yaw ?? 0;
    const pitchIn = input.pitch ?? 0;
    const rollIn = input.roll ?? 0;

    _fwd.set(0, 0, 1).applyQuaternion(this.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.quaternion);
    _right.set(1, 0, 0).applyQuaternion(this.quaternion);

    const speed = Math.max(this.airspeed, 0.01);
    this.stalling = !grounded && speed < this.stallSpeed;
    this.canTakeoff = grounded && speed >= this.takeoffSpeed && this.throttle > 0.52;

    // ---- Rotation ----
    if (grounded) {
      this.rotateForTakeoff = this.canTakeoff && pitchIn < -0.28;
      const yawAuth = 1.05 * this.groundGrip;
      this.turnVel = this._ease(this.turnVel, turnIn * this.turnRate * yawAuth, 12, dt);
      this.pitchVel = this._ease(this.pitchVel, 0, 18, dt);
      this.rollVel = this._ease(this.rollVel, 0, 18, dt);

      _quat.setFromAxisAngle(_worldUp, this.turnVel * dt);
      this.quaternion.premultiply(_quat);
      this._applyGroundAttitude(dt, contacts.groundYs, this.rotateForTakeoff);
    } else {
      this.rotateForTakeoff = false;
      this.turnVel = this._ease(this.turnVel, turnIn * this.turnRate, 11, dt);
      this.pitchVel = this._ease(this.pitchVel, pitchIn * this.pitchRate, 10, dt);
      this.rollVel = this._ease(this.rollVel, rollIn * this.rollRate, 10, dt);

      _quat.setFromAxisAngle(_worldUp, this.turnVel * dt);
      this.quaternion.premultiply(_quat);

      _quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitchVel * dt);
      this.quaternion.multiply(_quat);

      _quat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.rollVel * dt);
      this.quaternion.multiply(_quat);

      _euler.setFromQuaternion(this.quaternion, 'YXZ');
      const desiredBank = THREE.MathUtils.clamp(
        -this.turnVel * this.autoBank + this.rollVel * 0.55,
        -1.15,
        1.15
      );
      const bankK = Math.abs(rollIn) > 0.15 ? 4.5 : 6;
      _euler.z = THREE.MathUtils.lerp(_euler.z, desiredBank, 1 - Math.exp(-bankK * dt));
      this.quaternion.setFromEuler(_euler);
      this.quaternion.normalize();

      _fwd.set(0, 0, 1).applyQuaternion(this.quaternion);
      _up.set(0, 1, 0).applyQuaternion(this.quaternion);

      this._applyStallSpin(dt);
    }

    this._applyWind(dt);

    // Phase labels
    if (grounded && speed < 8) this.phase = 'taxi';
    else if (grounded && speed >= 8) this.phase = this.canTakeoff ? 'takeoff' : 'taxi';
    else if (!grounded && this.throttle < 0.35 && agl < 40) this.phase = 'landing';
    else if (this.spinning) this.phase = 'spin';
    else this.phase = 'airborne';

    // ---- Forces ----
    const boostMul = canPower && input.boost ? 1.4 : 1;
    const thrust = (this.maxThrust * this.throttle * boostMul) / this.mass;
    this.velocity.addScaledVector(_fwd, thrust * dt);

    if (grounded) {
      const brake = input.throttleDown ? 1.6 : 0;
      const friction = (0.55 + (1 - this.throttle) * 2.4 + brake) * this.groundGrip;
      this.velocity.multiplyScalar(Math.max(0, 1 - friction * dt));
      this.velocity.y = 0;

      const flat = _tmp.set(_fwd.x, 0, _fwd.z);
      if (flat.lengthSq() > 1e-6) {
        flat.normalize();
        const hSpd = Math.hypot(this.velocity.x, this.velocity.z);
        this.velocity.x = flat.x * hSpd;
        this.velocity.z = flat.z * hSpd;
      }

      if (this.rotateForTakeoff && speed >= this.takeoffSpeed * 0.98) {
        const liftKick = (speed - this.takeoffSpeed * 0.9) * 0.12 + 2.5;
        this.velocity.y = Math.max(this.velocity.y, liftKick / this.mass);
      }
    } else {
      this.velocity.y -= this.gravity * dt;

      const level = Math.max(0.15, _up.dot(_worldUp));
      let lift = speed * speed * 0.00052 * level * this.liftFactor * this._windLiftMod;
      if (this.stalling) lift *= speed / this.stallSpeed;
      this.velocity.addScaledVector(_up, (lift * dt * 20) / this.mass);

      const pitchDot = _fwd.dot(_worldUp);
      this.velocity.addScaledVector(_fwd, (-pitchDot * 14 * dt) / this.mass);

      const drag = (this.baseDrag + (1 - this.throttle) * 0.012) * this.dragFactor;
      this.velocity.multiplyScalar(Math.max(0, 1 - drag * speed * dt));

      if (!this.stalling) {
        const target = _tmp.copy(_fwd).multiplyScalar(Math.max(speed, 8));
        this.velocity.lerp(target, 1 - Math.exp(-this.alignStrength * dt));
      }
    }

    const maxSp = this.maxSpeed * (input.boost ? 1.15 : 1);
    const softMax = THREE.MathUtils.lerp(22, maxSp, Math.max(this.throttle, grounded ? 0 : 0.2));
    if (this.velocity.length() > softMax) {
      this.velocity.setLength(
        THREE.MathUtils.lerp(this.velocity.length(), softMax, 1 - Math.exp(-3 * dt))
      );
    }

    this.position.addScaledVector(this.velocity, dt);

    // ---- Ground contact (multi-point) ----
    const post = this._sampleContacts(getHeight);
    if (post.grounded || post.maxPen > 0) {
      const impactVy = this.velocity.y;
      const wasAir = !this.onGround;

      if (post.maxPen > 0) {
        this.position.y += post.maxPen + 0.02;
      }

      _euler.setFromQuaternion(this.quaternion, 'YXZ');
      const horiz = Math.hypot(this.velocity.x, this.velocity.z);
      const steep = Math.abs(_euler.x) > 0.38 || Math.abs(_euler.z) > 0.55;
      const noseDig = this.contact.nose < -0.08;

      if (wasAir) {
        if (horiz > this.safeLandSpeed || impactVy < -28 || steep || noseDig) {
          const over = Math.max(0, horiz - this.safeLandSpeed);
          this.takeDamage(50 + over * 2.4 + Math.max(0, -impactVy) + (steep ? 55 : 0) + (noseDig ? 25 : 0));
        }
      }

      this.onGround = true;
      this.velocity.y = 0;
      if (!this.rotateForTakeoff) {
        this._applyGroundAttitude(dt, post.groundYs, false);
      }
    } else if (this.velocity.y > 0.4 || post.minClear > 0.35) {
      this.onGround = false;
    }

    this.position.y = Math.min(this.position.y, 320);
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
