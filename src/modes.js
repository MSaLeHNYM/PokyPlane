/**
 * Ring Race (time trial) + Sky Combat AI enemies.
 */
import * as THREE from 'three';

export class RingCourse {
  constructor(scene, count = 12) {
    this.scene = scene;
    this.rings = [];
    this.current = 0;
    this.score = 0;
    this.timeLeft = 60;
    this.finished = false;
    this.failed = false;
    this._build(count);
  }

  _build(count) {
    // Spiral path through the sky starting near runway
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const ang = t * Math.PI * 2.5;
      const rad = 40 + t * 120;
      const x = Math.sin(ang) * rad;
      const z = -30 - t * 180 + Math.cos(ang) * 20;
      const y = 18 + Math.sin(t * Math.PI * 3) * 12 + t * 25;

      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(5, 0.45, 8, 24),
        new THREE.MeshStandardMaterial({
          color: i === 0 ? 0xffd166 : 0x4ade80,
          emissive: i === 0 ? 0xaa6600 : 0x14532d,
          emissiveIntensity: 0.4,
          flatShading: true,
          roughness: 0.4,
        })
      );
      torus.position.set(x, y, z);
      // Face roughly along path
      torus.lookAt(x + Math.cos(ang) * 10, y, z - 10);
      torus.userData.index = i;
      torus.userData.active = i === 0;
      this.scene.add(torus);
      this.rings.push(torus);
    }
  }

  update(dt, playerPos, onPass) {
    if (this.finished || this.failed) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.failed = true;
      return;
    }

    const ring = this.rings[this.current];
    if (!ring) {
      this.finished = true;
      return;
    }

    const dist = playerPos.distanceTo(ring.position);
    if (dist < 6) {
      this.score += 100 + Math.floor(this.timeLeft);
      this.timeLeft += 5;
      onPass?.(ring.position.clone());
      ring.material.color.set(0x64748b);
      ring.material.emissiveIntensity = 0.1;
      this.current++;
      if (this.current >= this.rings.length) {
        this.finished = true;
      } else {
        const next = this.rings[this.current];
        next.material.color.set(0xffd166);
        next.material.emissive.set(0xaa6600);
        next.material.emissiveIntensity = 0.5;
      }
    }
  }

  dispose() {
    this.rings.forEach((r) => {
      this.scene.remove(r);
      r.geometry.dispose();
      r.material.dispose();
    });
    this.rings = [];
  }
}

export class EnemyFighter {
  constructor(scene, createPlaneFn, skinIndex, spawn) {
    const { group, parts } = createPlaneFn(skinIndex);
    group.scale.setScalar(0.9);
    this.group = group;
    this.parts = parts;
    this.position = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.velocity = new THREE.Vector3(0, 0, -40);
    this.quaternion = new THREE.Quaternion();
    this.health = 40;
    this.alive = true;
    this.cooldown = 0;
    scene.add(group);
  }

  update(dt, playerPos, getHeight) {
    if (!this.alive) return;

    // Simple pursuit: steer toward player
    const toPlayer = playerPos.clone().sub(this.position).normalize();
    const desired = toPlayer.clone().multiplyScalar(55);
    this.velocity.lerp(desired, 1 - Math.exp(-1.5 * dt));

    // Face velocity (plane nose is local +Z)
    if (this.velocity.lengthSq() > 1) {
      const dir = this.velocity.clone().normalize();
      this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    }

    this.position.addScaledVector(this.velocity, dt);
    const g = getHeight(this.position.x, this.position.z);
    if (this.position.y < g + 8) this.position.y = g + 8;

    this.group.position.copy(this.position);
    this.group.quaternion.copy(this.quaternion);
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  hit(dmg = 20) {
    this.health -= dmg;
    if (this.health <= 0) {
      this.alive = false;
      this.group.visible = false;
      return true;
    }
    return false;
  }

  dispose(scene) {
    scene.remove(this.group);
  }
}

export class CombatWave {
  constructor(scene, createPlaneFn) {
    this.scene = scene;
    this.createPlaneFn = createPlaneFn;
    this.enemies = [];
    this.wave = 1;
    this.score = 0;
    this.bullets = [];
    this.enemyBullets = [];
    this._bulletPool = [];
    this._geo = new THREE.SphereGeometry(0.25, 6, 6);
    this._matPlayer = new THREE.MeshBasicMaterial({ color: 0xffe066 });
    this._matEnemy = new THREE.MeshBasicMaterial({ color: 0xff4466 });
  }

  spawnWave() {
    const n = 2 + this.wave;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const e = new EnemyFighter(this.scene, this.createPlaneFn, (i + 1) % 3, {
        x: Math.cos(ang) * 80,
        y: 40 + Math.random() * 20,
        z: Math.sin(ang) * 80 - 60,
      });
      this.enemies.push(e);
    }
  }

  fireBullet(from, dir, isPlayer) {
    let mesh = this._bulletPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(this._geo, isPlayer ? this._matPlayer : this._matEnemy);
      this.scene.add(mesh);
    }
    mesh.material = isPlayer ? this._matPlayer : this._matEnemy;
    mesh.visible = true;
    mesh.position.copy(from);
    const bullet = { mesh, vel: dir.clone().multiplyScalar(isPlayer ? 180 : 100), life: 2, isPlayer };
    (isPlayer ? this.bullets : this.enemyBullets).push(bullet);
  }

  update(dt, player, getHeight, onEnemyKill, onPlayerHit) {
    // Enemies
    let alive = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      alive++;
      e.update(dt, player.position, getHeight);
      // Occasional enemy fire
      if (e.cooldown <= 0 && e.position.distanceTo(player.position) < 120) {
        const dir = player.position.clone().sub(e.position).normalize();
        this.fireBullet(e.position.clone(), dir, false);
        e.cooldown = 1.2 + Math.random();
      }
    }

    if (alive === 0 && this.enemies.length) {
      this.wave++;
      this.enemies = this.enemies.filter((e) => e.alive);
      this.spawnWave();
    }

    // Player bullets vs enemies
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = false;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (b.mesh.position.distanceTo(e.position) < 3.5) {
          if (e.hit(25)) {
            this.score += 250;
            onEnemyKill?.(e.position.clone());
          }
          hit = true;
          break;
        }
      }
      if (hit || b.life <= 0) {
        b.mesh.visible = false;
        this._bulletPool.push(b.mesh);
        this.bullets.splice(i, 1);
      }
    }

    // Enemy bullets vs player
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i];
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      if (b.mesh.position.distanceTo(player.position) < 2.5) {
        onPlayerHit?.(12);
        b.life = 0;
      }
      if (b.life <= 0) {
        b.mesh.visible = false;
        this._bulletPool.push(b.mesh);
        this.enemyBullets.splice(i, 1);
      }
    }
  }

  dispose() {
    this.enemies.forEach((e) => e.dispose(this.scene));
    [...this.bullets, ...this.enemyBullets, ...this._bulletPool].forEach((b) => {
      const m = b.mesh || b;
      this.scene.remove(m);
    });
    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
  }
}

/** localStorage helpers for best times / unlocks */
export const Storage = {
  getBest(mode) {
    return Number(localStorage.getItem(`pokyplane_best_${mode}`) || 0);
  },
  setBest(mode, score) {
    const prev = this.getBest(mode);
    if (score > prev) {
      localStorage.setItem(`pokyplane_best_${mode}`, String(score));
      return true;
    }
    return false;
  },
  unlockSmoke(color) {
    const raw = JSON.parse(localStorage.getItem('pokyplane_unlocks') || '[]');
    if (!raw.includes(color)) {
      raw.push(color);
      localStorage.setItem('pokyplane_unlocks', JSON.stringify(raw));
    }
  },
  getUnlocks() {
    return JSON.parse(localStorage.getItem('pokyplane_unlocks') || '["white"]');
  },
};
