/**
 * Airborne fuel pickups — spawn density / refill amount follow difficulty.
 */
import * as THREE from 'three';

export class FuelPickups {
  constructor(scene) {
    this.scene = scene;
    this.pickups = [];
    this.enabled = false;
    this.spawnTimer = 0;
    this.cfg = {
      spawnInterval: 12,
      maxAlive: 6,
      refill: 35,
      radius: 180,
      minAlt: 35,
      maxAlt: 120,
    };
    this._bob = 0;

    this._mat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xb45309,
      emissiveIntensity: 0.45,
      roughness: 0.4,
      metalness: 0.2,
      flatShading: true,
    });
    this._glowMat = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
  }

  configure(difficulty = 'normal') {
    if (difficulty === 'easy') {
      this.cfg = {
        spawnInterval: 7,
        maxAlive: 10,
        refill: 45,
        radius: 140,
        minAlt: 30,
        maxAlt: 100,
      };
    } else if (difficulty === 'hard') {
      this.cfg = {
        spawnInterval: 18,
        maxAlive: 4,
        refill: 22,
        radius: 240,
        minAlt: 50,
        maxAlt: 150,
      };
    } else {
      this.cfg = {
        spawnInterval: 12,
        maxAlive: 6,
        refill: 35,
        radius: 180,
        minAlt: 35,
        maxAlt: 120,
      };
    }
  }

  setEnabled(on, difficulty = 'normal') {
    this.enabled = !!on;
    this.configure(difficulty);
    this.spawnTimer = 1;
    if (!this.enabled) this.clear();
  }

  clear() {
    for (const p of this.pickups) {
      this.scene.remove(p.group);
      p.group.traverse((o) => {
        o.geometry?.dispose?.();
      });
    }
    this.pickups.length = 0;
  }

  dispose() {
    this.clear();
    this._mat.dispose();
    this._glowMat.dispose();
  }

  _makeMesh() {
    const group = new THREE.Group();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.4, 8), this._mat);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.25, 8), this._mat);
    cap.position.y = 0.85;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), this._glowMat);
    glow.scale.y = 0.7;
    group.add(can, cap, glow);
    return group;
  }

  spawnNear(playerPos, getHeight) {
    if (!this.enabled) return;
    if (this.pickups.length >= this.cfg.maxAlive) return;

    const ang = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * this.cfg.radius;
    const x = playerPos.x + Math.cos(ang) * dist;
    const z = playerPos.z + Math.sin(ang) * dist;
    const ground = getHeight?.(x, z) ?? 0;
    const y =
      ground +
      this.cfg.minAlt +
      Math.random() * (this.cfg.maxAlt - this.cfg.minAlt);

    const group = this._makeMesh();
    group.position.set(x, y, z);
    this.scene.add(group);
    this.pickups.push({
      group,
      baseY: y,
      phase: Math.random() * Math.PI * 2,
      amount: this.cfg.refill,
    });
  }

  /**
   * @returns {{ amount: number } | null} if player collected
   */
  update(dt, playerPos, getHeight) {
    if (!this.enabled) return null;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnNear(playerPos, getHeight);
      // Randomize next spawn a bit
      const jitter = 0.65 + Math.random() * 0.7;
      this.spawnTimer = this.cfg.spawnInterval * jitter;
    }

    this._bob += dt;
    let collected = null;

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.group.position.y = p.baseY + Math.sin(this._bob * 1.6 + p.phase) * 1.4;
      p.group.rotation.y += dt * 1.2;

      const d = p.group.position.distanceTo(playerPos);
      if (d < 5.5) {
        collected = { amount: p.amount };
        this.scene.remove(p.group);
        this.pickups.splice(i, 1);
        continue;
      }

      // Cull very far pickups so the sky doesn't fill forever
      if (d > this.cfg.radius * 2.8) {
        this.scene.remove(p.group);
        this.pickups.splice(i, 1);
      }
    }

    return collected;
  }

  markers() {
    return this.pickups.map((p) => ({
      x: p.group.position.x,
      z: p.group.position.z,
      color: '#fbbf24',
      r: 3,
    }));
  }
}
