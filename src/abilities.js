/**
 * Player combat abilities: flare decoys, dodge barrel-roll, quick-reverse.
 * Maneuvers run as scripted orientation overrides applied after the flight
 * model update, so terrain/collision handling keeps working.
 */
import * as THREE from 'three';

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _v = new THREE.Vector3();

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/* ------------------------------------------------------------------ */
/* Flares                                                             */
/* ------------------------------------------------------------------ */

export class FlareSystem {
  constructor(scene) {
    this.scene = scene;
    this.decoys = [];
    this.maxStock = 6;
    this.stock = this.maxStock;
    this.cooldown = 0;
    this.cooldownTime = 1.8;
    this._geo = new THREE.SphereGeometry(0.5, 6, 6);
    this._mat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
    this._n = 0;
  }

  reset() {
    this.clear();
    this.stock = this.maxStock;
    this.cooldown = 0;
  }

  get ready() {
    return this.stock > 0 && this.cooldown <= 0;
  }

  /** Drop a spread of 3 decoys behind the plane. Returns true if deployed. */
  deploy(flight) {
    if (!this.ready) return false;
    this.stock -= 1;
    this.cooldown = this.cooldownTime;

    const back = flight.velocity.clone().normalize().multiplyScalar(-1);
    if (back.lengthSq() < 0.01) back.copy(flight.forward).multiplyScalar(-1);

    for (let i = 0; i < 3; i++) {
      const pos = flight.position
        .clone()
        .addScaledVector(back, 4 + i * 2.5)
        .add(
          _v.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3 - 0.5, (Math.random() - 0.5) * 4)
        );
      const mesh = new THREE.Mesh(this._geo, this._mat);
      mesh.position.copy(pos);
      this.scene.add(mesh);
      this.decoys.push({
        id: `pflare-${this._n++}`,
        position: pos.clone(),
        vel: back
          .clone()
          .multiplyScalar(16 + Math.random() * 10)
          .add(_v.set(0, -3 - Math.random() * 3, 0)),
        life: 2.6 + Math.random() * 0.7,
        mesh,
      });
    }
    return true;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i];
      d.life -= dt;
      d.vel.multiplyScalar(Math.max(0, 1 - 1.4 * dt));
      d.vel.y -= 6 * dt;
      d.position.addScaledVector(d.vel, dt);
      d.mesh.position.copy(d.position);
      const flicker = 0.7 + Math.random() * 0.6;
      d.mesh.scale.setScalar(flicker);
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        this.decoys.splice(i, 1);
      }
    }
  }

  /** hitTarget entries so hostile missiles can chase the decoys. */
  getDecoyTargets() {
    return this.decoys.map((d) => ({
      position: d.position,
      radius: 2.4,
      id: d.id,
      kind: 'flare',
      owner: 'local',
      ref: d,
    }));
  }

  clear() {
    for (const d of this.decoys) this.scene.remove(d.mesh);
    this.decoys.length = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Maneuvers: dodge roll + quick reverse                              */
/* ------------------------------------------------------------------ */

export const DODGE_COOLDOWN = 4;
export const REVERSE_COOLDOWN = 10;

export class ManeuverSystem {
  constructor() {
    this.active = null; // { type, t, dur, ... }
    this.dodgeCooldown = 0;
    this.reverseCooldown = 0;
  }

  reset() {
    this.active = null;
    this.dodgeCooldown = 0;
    this.reverseCooldown = 0;
  }

  get dodgeReady() {
    return !this.active && this.dodgeCooldown <= 0;
  }

  get reverseReady() {
    return !this.active && this.reverseCooldown <= 0;
  }

  get isDodging() {
    return this.active?.type === 'dodge';
  }

  get isReversing() {
    return this.active?.type === 'reverse';
  }

  /** Quick barrel roll with a lateral jink. dir: -1 left, +1 right. */
  startDodge(flight, dir = 1) {
    if (!this.dodgeReady || flight.onGround) return false;
    this.dodgeCooldown = DODGE_COOLDOWN;
    this.active = { type: 'dodge', t: 0, dur: 0.62, dir: dir >= 0 ? 1 : -1, rolled: 0 };
    // Lateral impulse so the dodge actually displaces the plane
    flight.velocity.addScaledVector(flight.right, this.active.dir * 26);
    flight.velocity.y += 6;
    return true;
  }

  /** Scripted fast 180 reversal (Immelmann-style pitch-up + roll-through). */
  startReverse(flight) {
    if (!this.reverseReady || flight.onGround) return false;
    this.reverseCooldown = REVERSE_COOLDOWN;
    _euler.setFromQuaternion(flight.quaternion, 'YXZ');
    this.active = {
      type: 'reverse',
      t: 0,
      dur: 1.15,
      yaw0: _euler.y,
      dir: Math.random() < 0.5 ? 1 : -1,
      speed0: Math.max(flight.airspeed, flight.stallSpeed + 14),
    };
    return true;
  }

  /** Zero player control while a reverse is scripted. */
  filterInput(fi) {
    if (!this.isReversing) return fi;
    return {
      ...fi,
      pitch: 0,
      turn: 0,
      yaw: 0,
      roll: 0,
      boost: true,
      throttleDown: false,
    };
  }

  /** Call right after flight.update(). Applies scripted orientation. */
  update(dt, flight) {
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    this.reverseCooldown = Math.max(0, this.reverseCooldown - dt);
    const a = this.active;
    if (!a) return null;

    a.t += dt;
    const t = Math.min(1, a.t / a.dur);
    let finished = null;

    if (a.type === 'dodge') {
      // Integrate a full 360° roll on top of the physics orientation.
      const targetRoll = easeInOut(t) * Math.PI * 2 * a.dir;
      const delta = targetRoll - a.rolled;
      a.rolled = targetRoll;
      _quat.setFromAxisAngle(_v.set(0, 0, 1), delta);
      flight.quaternion.multiply(_quat).normalize();
      flight.rollVel = 0;
    } else if (a.type === 'reverse') {
      const e = easeInOut(t);
      const yaw = a.yaw0 + Math.PI * e * a.dir;
      const pitch = -Math.sin(Math.PI * e) * 0.85; // nose-up bump over the top
      const roll = Math.sin(Math.PI * e) * 2.35 * a.dir; // roll through near-inverted
      _euler.set(pitch, yaw, roll, 'YXZ');
      flight.quaternion.setFromEuler(_euler).normalize();
      flight.pitchVel = 0;
      flight.turnVel = 0;
      flight.rollVel = 0;
      // Keep velocity glued to the nose so the plane whips around
      const spd = THREE.MathUtils.lerp(a.speed0, a.speed0 * 0.86, e);
      flight.velocity.copy(flight.forward).multiplyScalar(spd);
    }

    if (a.t >= a.dur) {
      finished = a.type;
      this.active = null;
    }
    return finished;
  }
}
