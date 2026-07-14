/**
 * Camera presets — tracks plane tightly at high speed (no lag).
 * Follow blend scales with airspeed so chase never falls behind.
 */
import * as THREE from 'three';

export const CAMERA_PRESETS = [
  { id: 'chase', label: 'Chase', local: { x: 0, y: 5.5, z: -16 }, look: { x: 0, y: 1.2, z: 12 }, fov: 62 },
  { id: 'near', label: 'Close Chase', local: { x: 0, y: 2.8, z: -8 }, look: { x: 0, y: 0.8, z: 8 }, fov: 68 },
  { id: 'high', label: 'High Chase', local: { x: 0, y: 12, z: -14 }, look: { x: 0, y: 0, z: 10 }, fov: 58 },
  { id: 'wing', label: 'Wing Cam', local: { x: 7, y: 2.5, z: -3 }, look: { x: 0, y: 0.5, z: 10 }, fov: 70 },
  { id: 'cockpit', label: 'Cockpit', local: { x: 0, y: 0.55, z: 0.9 }, look: { x: 0, y: 0.2, z: 40 }, fov: 75, cockpit: true },
  { id: 'nose', label: 'Nose Cam', local: { x: 0, y: 0.3, z: 2.2 }, look: { x: 0, y: 0, z: 50 }, fov: 80, cockpit: true },
  { id: 'orbit', label: 'Orbit', orbit: true, radius: 18, height: 6, fov: 60 },
];

const _look = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _shake = new THREE.Vector3();
const _ideal = new THREE.Vector3();
const _err = new THREE.Vector3();

export class CameraManager {
  constructor(camera) {
    this.camera = camera;
    this.presetIndex = 0;
    this.shake = 0;
    this.fovKick = 0;
    this._pos = new THREE.Vector3(0, 8, -20);
    this._lookPos = new THREE.Vector3();
    this._orbitAng = 0;
  }

  get preset() {
    return CAMERA_PRESETS[this.presetIndex];
  }

  get mode() {
    return this.preset.id;
  }

  setPreset(id) {
    const i = CAMERA_PRESETS.findIndex((p) => p.id === id);
    if (i >= 0) this.presetIndex = i;
    return this.preset;
  }

  cycle() {
    this.presetIndex = (this.presetIndex + 1) % CAMERA_PRESETS.length;
    return this.preset;
  }

  addShake(amount) {
    this.shake = Math.min(1.8, this.shake + amount);
  }

  _localToWorld(flight, lx, ly, lz, out) {
    _fwd.set(0, 0, 1).applyQuaternion(flight.quaternion);
    _up.set(0, 1, 0).applyQuaternion(flight.quaternion);
    _right.set(1, 0, 0).applyQuaternion(flight.quaternion);
    return out
      .copy(flight.position)
      .addScaledVector(_right, lx)
      .addScaledVector(_up, ly)
      .addScaledVector(_fwd, lz);
  }

  update(dt, flight, opts = {}) {
    const { mouse = { x: 0, y: 0 }, boost = false, getHeight = null, camShake = true } = opts;
    const p = this.preset;

    this.shake = Math.max(0, this.shake - dt * 2.8);
    if (!camShake) this.shake = 0;

    const speed = flight.airspeed || 0;
    const speedNorm = Math.min(1, speed / (flight.maxSpeed || 160));
    const kickT = speedNorm * 6 + (boost ? 5 : 0);
    this.fovKick += (kickT - this.fovKick) * (1 - Math.exp(-5 * dt));
    this.camera.fov = (p.fov || 60) + this.fovKick;
    this.camera.updateProjectionMatrix();

    if (p.orbit) {
      this._orbitAng += dt * 0.35;
      const r = p.radius || 18;
      this.camera.position.set(
        flight.position.x + Math.cos(this._orbitAng) * r,
        flight.position.y + (p.height || 6),
        flight.position.z + Math.sin(this._orbitAng) * r
      );
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(flight.position);
    } else {
      const L = p.local;
      const look = p.look;
      let mx = 0;
      let my = 0;
      if (p.cockpit) {
        mx = mouse.x * 6;
        my = -mouse.y * 5;
      }

      this._localToWorld(flight, L.x, L.y, L.z, _ideal);

      // Speed-adaptive tracking — stiffen with airspeed so cam never lags
      const trackK = p.cockpit ? 28 : 14 + speed * 0.35;
      this._pos.lerp(_ideal, 1 - Math.exp(-trackK * dt));

      _err.subVectors(_ideal, this._pos);
      const maxLag = 3.5 + speed * 0.03;
      if (_err.length() > maxLag) {
        this._pos.copy(_ideal).addScaledVector(_err.normalize(), -maxLag * 0.2);
      }

      if (getHeight) {
        const g = getHeight(this._pos.x, this._pos.z) + 2;
        if (this._pos.y < g) this._pos.y = g;
      }

      this._localToWorld(flight, look.x + mx * 0.1, look.y + my * 0.08, look.z, _look);
      if (p.cockpit) {
        _look.addScaledVector(_right.set(1, 0, 0).applyQuaternion(flight.quaternion), mx);
        _look.addScaledVector(_up.set(0, 1, 0).applyQuaternion(flight.quaternion), my);
      }
      this._lookPos.lerp(_look, 1 - Math.exp(-(p.cockpit ? 20 : 14 + speed * 0.2) * dt));

      this.camera.position.copy(this._pos);
      if (p.cockpit) {
        this.camera.up.copy(_up.set(0, 1, 0).applyQuaternion(flight.quaternion));
      } else {
        this.camera.up.set(0, 1, 0);
      }
      this.camera.lookAt(this._lookPos);
    }

    if (this.shake > 0.001) {
      const s = this.shake * this.shake;
      _shake.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.4);
      this.camera.position.add(_shake);
    }
  }

  snapTo(flight) {
    const p = this.preset;
    if (p.orbit) {
      this.camera.position.set(flight.position.x + 16, flight.position.y + 6, flight.position.z);
      this.camera.lookAt(flight.position);
      return;
    }
    this._localToWorld(flight, p.local.x, p.local.y, p.local.z, this._pos);
    this._localToWorld(flight, p.look.x, p.look.y, p.look.z, this._lookPos);
    this.camera.position.copy(this._pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this._lookPos);
  }
}

export { CameraManager as CameraRig };
