/**
 * Four arcade weapon types — MG, Cannon, Rockets, Homing missiles.
 * Host can enable/disable each type in multiplayer.
 */
import * as THREE from 'three';

export const WEAPON_ORDER = ['mg', 'cannon', 'rocket', 'missile'];

export const WEAPON_DEFS = {
  mg: {
    id: 'mg',
    nameKey: 'wpnMg',
    fireRate: 0.08,
    damage: 12,
    speed: 400,
    life: 1.15,
    spread: 0.022,
    color: 0xffe066,
    radius: 0.05,
    length: 1.6,
    sound: 'gun',
  },
  cannon: {
    id: 'cannon',
    nameKey: 'wpnCannon',
    fireRate: 0.32,
    damage: 40,
    speed: 290,
    life: 1.5,
    spread: 0.006,
    color: 0xff9933,
    radius: 0.13,
    length: 2.6,
    sound: 'gun',
  },
  rocket: {
    id: 'rocket',
    nameKey: 'wpnRocket',
    fireRate: 0.9,
    damage: 75,
    speed: 195,
    life: 2.8,
    spread: 0.012,
    color: 0xff5522,
    radius: 0.2,
    length: 3.4,
    sound: 'rocket',
  },
  missile: {
    id: 'missile',
    nameKey: 'wpnMissile',
    fireRate: 1.55,
    damage: 58,
    speed: 155,
    life: 4.2,
    spread: 0,
    color: 0x55e8a0,
    radius: 0.15,
    length: 2.9,
    sound: 'rocket',
    homing: true,
    turnRate: 3.6,
  },
};

export const DEFAULT_WEAPON_FLAGS = {
  mg: true,
  cannon: true,
  rocket: true,
  missile: true,
};

export function isExplosiveWeapon(weaponId) {
  return weaponId === 'rocket' || weaponId === 'missile';
}

function groundHitThreshold(weaponId) {
  if (weaponId === 'mg') return 0.55;
  if (weaponId === 'cannon') return 0.95;
  return 1.45;
}

export class WeaponSystem {
  constructor(scene) {
    this.scene = scene;
    this.bullets = [];
    this.pool = [];
    this.cooldown = 0;
    this.activeId = 'mg';
    this.enabled = { ...DEFAULT_WEAPON_FLAGS };
    // MG is always infinite; the rest come from the player's inventory.
    this.ammo = { mg: Infinity, cannon: Infinity, rocket: Infinity, missile: Infinity };
    this.ammoUsed = { cannon: 0, rocket: 0, missile: 0 };

    this._mats = {};
    this._geos = {};
    for (const id of WEAPON_ORDER) {
      const d = WEAPON_DEFS[id];
      this._geos[id] = new THREE.CylinderGeometry(d.radius, d.radius * 0.85, d.length, 5);
      this._geos[id].rotateX(Math.PI / 2);
      this._mats[id] = new THREE.MeshBasicMaterial({
        color: d.color,
        transparent: true,
        opacity: 0.95,
      });
    }
    this._matEnemy = new THREE.MeshBasicMaterial({
      color: 0xff5555,
      transparent: true,
      opacity: 0.9,
    });
  }

  get active() {
    return WEAPON_DEFS[this.activeId] || WEAPON_DEFS.mg;
  }

  /** Seed ammo counts (MG stays infinite). */
  setAmmo({ cannon, rocket, missile } = {}) {
    if (cannon != null) this.ammo.cannon = Math.max(0, Math.floor(cannon));
    if (rocket != null) this.ammo.rocket = Math.max(0, Math.floor(rocket));
    if (missile != null) this.ammo.missile = Math.max(0, Math.floor(missile));
  }

  getAmmo(id = this.activeId) {
    return this.ammo[id] ?? 0;
  }

  hasAmmo(id = this.activeId) {
    return (this.ammo[id] ?? 0) > 0;
  }

  resetAmmoUsed() {
    this.ammoUsed = { cannon: 0, rocket: 0, missile: 0 };
  }

  setEnabled(flags = {}) {
    this.enabled = { ...DEFAULT_WEAPON_FLAGS, ...flags };
    if (!this.enabled[this.activeId]) this.selectFirstEnabled();
  }

  selectFirstEnabled() {
    const next = WEAPON_ORDER.find((id) => this.enabled[id]);
    this.activeId = next || 'mg';
  }

  /** Slot 0–3 or weapon id. Returns true if changed. */
  select(slotOrId) {
    const id =
      typeof slotOrId === 'number' ? WEAPON_ORDER[slotOrId] : slotOrId;
    if (!id || !WEAPON_DEFS[id]) return false;
    if (!this.enabled[id]) return false;
    if (this.activeId === id) return false;
    this.activeId = id;
    this.cooldown = Math.min(this.cooldown, 0.12);
    return true;
  }

  cycle(dir = 1) {
    const idx = WEAPON_ORDER.indexOf(this.activeId);
    for (let i = 1; i <= WEAPON_ORDER.length; i++) {
      const next = WEAPON_ORDER[(idx + dir * i + WEAPON_ORDER.length * 4) % WEAPON_ORDER.length];
      if (this.enabled[next]) {
        this.activeId = next;
        this.cooldown = Math.min(this.cooldown, 0.12);
        return next;
      }
    }
    return this.activeId;
  }

  canFire() {
    return this.cooldown <= 0 && !!this.enabled[this.activeId] && this.hasAmmo(this.activeId);
  }

  /**
   * @returns {{ origin, dir, weapon } | null}
   */
  fire(origin, forward, opts = {}) {
    const weaponId = opts.weapon || this.activeId;
    const def = WEAPON_DEFS[weaponId] || WEAPON_DEFS.mg;
    if (!opts.force) {
      if (!this.enabled[weaponId]) return null;
      if (!this.canFire()) return null;
      this.cooldown = opts.rate ?? def.fireRate;
      if (Number.isFinite(this.ammo[weaponId])) {
        this.ammo[weaponId] = Math.max(0, this.ammo[weaponId] - 1);
        if (weaponId in this.ammoUsed) this.ammoUsed[weaponId] += 1;
      }
    } else if (opts.rate != null) {
      // Remote/replay fire: skip gate but only touch cooldown when rate is set.
      this.cooldown = opts.rate;
    }

    const dir = forward.clone().normalize();
    dir.x += (Math.random() - 0.5) * def.spread;
    dir.y += (Math.random() - 0.5) * def.spread;
    dir.z += (Math.random() - 0.5) * def.spread;
    dir.normalize();

    const mat = opts.enemy ? this._matEnemy : this._mats[weaponId];
    const mesh = this.pool.pop() || new THREE.Mesh(this._geos[weaponId], mat);
    mesh.geometry = this._geos[weaponId];
    mesh.material = mat;
    mesh.visible = true;
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    this.scene.add(mesh);

    this.bullets.push({
      mesh,
      vel: dir.clone().multiplyScalar(opts.speed ?? def.speed),
      life: opts.life ?? def.life,
      damage: opts.damage ?? def.damage,
      owner: opts.owner || 'local',
      weapon: weaponId,
      homing: !!def.homing,
      turnRate: def.turnRate || 0,
      lockId: opts.lockTarget?.id ?? null,
      lockKind: opts.lockTarget?.kind ?? null,
      lockBroken: false,
    });

    return {
      origin: origin.clone(),
      dir: dir.clone(),
      owner: opts.owner || 'local',
      weapon: weaponId,
    };
  }

  static rayHit(origin, dir, targets, maxDist = 280, step = 4) {
    const p = origin.clone();
    const d = dir.clone().normalize().multiplyScalar(step);
    const steps = Math.ceil(maxDist / step);
    for (let i = 0; i < steps; i++) {
      p.add(d);
      for (const t of targets) {
        const r = t.radius ?? 3.2;
        if (p.distanceTo(t.position) < r) {
          return { target: t, point: p.clone(), dist: i * step };
        }
      }
    }
    return null;
  }

  update(dt, hitTargets = [], onHit, getGroundHeight = null) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const _aim = new THREE.Vector3();
    const _sample = new THREE.Vector3();

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const prev = b.mesh.position.clone();

      // Homing: follow locked target, else nearest; flares can seduce missile after lock break
      if (b.homing && hitTargets.length) {
        let best = null;

        if (!b.lockBroken && b.lockId != null && b.lockKind) {
          best = hitTargets.find((t) => t.id === b.lockId && t.kind === b.lockKind) || null;
          if (!best) b.lockBroken = true;
        }

        if (!best) {
          let bestD = Infinity;
          for (const t of hitTargets) {
            if (t.owner && t.owner === b.owner) continue;
            if (t.kind === 'flare') {
              const d = b.mesh.position.distanceToSquared(t.position);
              if (d < bestD && d < 160 * 160) {
                bestD = d;
                best = t;
              }
              continue;
            }
            const d = b.mesh.position.distanceToSquared(t.position);
            if (d < bestD) {
              bestD = d;
              best = t;
            }
          }
          if (best?.kind === 'flare') b.lockBroken = true;
        }

        if (best) {
          _aim.copy(best.position).sub(b.mesh.position).normalize();
          const spd = b.vel.length();
          b.vel.normalize().lerp(_aim, Math.min(1, b.turnRate * dt)).normalize().multiplyScalar(spd);
        }
      }

      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;

      if (b.vel.lengthSq() > 0.1) {
        b.mesh.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          b.vel.clone().normalize()
        );
      }

      let hit = false;
      let impactPoint = null;

      for (const t of hitTargets) {
        if (t.owner && t.owner === b.owner) continue;
        const r = t.radius ?? 3.2;
        if (t.kind === 'flare') {
          if (b.mesh.position.distanceTo(t.position) < r + 0.8) {
            impactPoint = b.mesh.position.clone();
            onHit?.({
              target: t,
              damage: 0,
              point: impactPoint,
              owner: b.owner,
              weapon: b.weapon,
            });
            hit = true;
            break;
          }
          continue;
        }
        if (b.mesh.position.distanceTo(t.position) < r + 1.5) {
          impactPoint = b.mesh.position.clone();
          onHit?.({
            target: t,
            damage: b.damage,
            point: impactPoint,
            owner: b.owner,
            weapon: b.weapon,
          });
          hit = true;
          break;
        }
        const mid = prev.clone().lerp(b.mesh.position, 0.5);
        if (mid.distanceTo(t.position) < r + 1.2) {
          impactPoint = mid;
          onHit?.({
            target: t,
            damage: b.damage,
            point: impactPoint,
            owner: b.owner,
            weapon: b.weapon,
          });
          hit = true;
          break;
        }
      }

      // Detonate on terrain — all weapons (mg/cannon = small puff, rocket/missile = big blast)
      if (!hit && getGroundHeight) {
        const steps = 5;
        const groundY = groundHitThreshold(b.weapon);
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          _sample.lerpVectors(prev, b.mesh.position, u);
          const gy = getGroundHeight(_sample.x, _sample.z);
          if (_sample.y <= gy + groundY) {
            impactPoint = _sample.clone();
            impactPoint.y = gy + 0.35;
            onHit?.({
              target: { kind: 'terrain' },
              damage: 0,
              point: impactPoint,
              owner: b.owner,
              weapon: b.weapon,
            });
            hit = true;
            break;
          }
        }
      }

      if (hit || b.life <= 0) {
        b.mesh.visible = false;
        this.scene.remove(b.mesh);
        this.pool.push(b.mesh);
        this.bullets.splice(i, 1);
      }
    }
  }

  clear() {
    for (const b of this.bullets) {
      b.mesh.visible = false;
      this.scene.remove(b.mesh);
      this.pool.push(b.mesh);
    }
    this.bullets.length = 0;
  }
}
