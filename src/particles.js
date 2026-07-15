/**
 * Unified GPU-friendly particle pools using THREE.Points + BufferGeometry.
 * Typed-array updates only — no per-frame `new` allocations in hot paths.
 */
import * as THREE from 'three';
import { getQualityTier } from './quality.js';

function makePoints(count, size, color, opts = {}) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const life = new Float32Array(count); // remaining life fraction
  const maxLife = new Float32Array(count);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size,
    vertexColors: true,
    transparent: true,
    opacity: opts.opacity ?? 0.85,
    depthWrite: false,
    fog: false,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  // Start dead
  for (let i = 0; i < count; i++) life[i] = 0;

  return { points, positions, colors, velocities, life, maxLife, count, cursor: 0 };
}

function spawn(pool, x, y, z, vx, vy, vz, r, g, b, lifeSec) {
  const i = pool.cursor;
  pool.cursor = (pool.cursor + 1) % pool.count;
  const i3 = i * 3;
  pool.positions[i3] = x;
  pool.positions[i3 + 1] = y;
  pool.positions[i3 + 2] = z;
  pool.velocities[i3] = vx;
  pool.velocities[i3 + 1] = vy;
  pool.velocities[i3 + 2] = vz;
  pool.colors[i3] = r;
  pool.colors[i3 + 1] = g;
  pool.colors[i3 + 2] = b;
  pool.maxLife[i] = lifeSec;
  pool.life[i] = lifeSec;
}

const _back = new THREE.Vector3();
const _side = new THREE.Vector3();
const _smokeHueColor = new THREE.Color();

const EXPLOSION_PROFILES = {
  mg: {
    scale: 0.32,
    debris: 14,
    debrisSpd: [5, 14],
    debrisLife: [0.12, 0.32],
    debrisColor: () => ({
      r: 0.98 + Math.random() * 0.02,
      g: 0.88 + Math.random() * 0.1,
      b: 0.35 + Math.random() * 0.2,
    }),
    sparks: 10,
    sparkColor: [1, 0.96, 0.55],
    smoke: 0,
    ring: 8,
    ringColor: [1, 0.9, 0.45],
  },
  cannon: {
    scale: 0.62,
    debris: 32,
    debrisSpd: [9, 24],
    debrisLife: [0.25, 0.55],
    debrisColor: () => ({
      r: 1,
      g: 0.45 + Math.random() * 0.35,
      b: 0.08 + Math.random() * 0.12,
    }),
    sparks: 18,
    sparkColor: [1, 0.65, 0.18],
    smoke: 10,
    smokeColor: [0.14, 0.11, 0.09],
    ring: 12,
    ringColor: [1, 0.55, 0.12],
  },
  rocket: {
    scale: 1.85,
    debris: 230,
    debrisSpd: [16, 52],
    debrisLife: [0.6, 1.65],
    debrisColor: () => ({
      r: 1,
      g: 0.28 + Math.random() * 0.45,
      b: 0.02 + Math.random() * 0.12,
    }),
    sparks: 88,
    sparkColor: [1, 0.78, 0.18],
    smoke: 62,
    smokeColor: [0.16, 0.1, 0.06],
    ring: 46,
    ringColor: [1, 0.45, 0.08],
  },
  missile: {
    scale: 2.15,
    spreadMul: 0.55,
    debris: 2500,
    debrisSpd: [18, 58],
    debrisLife: [0.7, 1.85],
    debrisColor: () => ({
      r: 0.15 + Math.random() * 0.35,
      g: 0.82 + Math.random() * 0.18,
      b: 0.62 + Math.random() * 0.3,
    }),
    sparks: 1500,
    sparkColor: [0.35, 1, 0.82],
    smoke: 1000,
    smokeColor: [0.06, 0.2, 0.16],
    ring: 54,
    ringSpread: 0.28,
    ringVelMul: 0.2,
    ringColor: [0.3, 0.95, 0.7],
  },
};

function profileForWeapon(weapon) {
  return EXPLOSION_PROFILES[weapon] || EXPLOSION_PROFILES.mg;
}

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.exhaust = makePoints(400, 0.35, 0xffffff, { opacity: 0.6 });
    this.smoke = makePoints(2400, 0.9, 0xffffff, { opacity: 0.5 });
    this.weather = makePoints(800, 0.25, 0xffffff, { opacity: 0.7 });
    this.debris = makePoints(3200, 0.55, 0xff8844, { additive: true, opacity: 0.95 });
    this.sparkle = makePoints(3400, 0.55, 0xffffff, { additive: true });
    this.speedLines = makePoints(120, 0.15, 0xffffff, { additive: true, opacity: 0.7 });
    this.clouds = makePoints(120, 14, 0xffffff, { opacity: 0.28 });
    this._cloudOffsets = [];

    [
      this.exhaust,
      this.smoke,
      this.weather,
      this.debris,
      this.sparkle,
      this.speedLines,
      this.clouds,
    ].forEach((p) => scene.add(p.points));

    this.weatherMode = 'clear'; // clear | rain | snow
    this.smokeColor = null; // {r,g,b} or 'rainbow' or null
    this._smokeHue = 0;
    this._seedClouds();
  }

  _seedClouds() {
    this._cloudOffsets = [];
    for (let i = 0; i < this.clouds.count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 120 + Math.random() * 520;
      this._cloudOffsets.push({
        ox: Math.cos(ang) * rad,
        oz: Math.sin(ang) * rad,
        y: 240 + Math.random() * 180,
        drift: 0.6 + Math.random() * 1.4,
      });
      const i3 = i * 3;
      this.clouds.positions[i3] = 0;
      this.clouds.positions[i3 + 1] = this._cloudOffsets[i].y;
      this.clouds.positions[i3 + 2] = 0;
      this.clouds.colors[i3] = 0.92;
      this.clouds.colors[i3 + 1] = 0.95;
      this.clouds.colors[i3 + 2] = 1;
      this.clouds.life[i] = 1;
      this.clouds.maxLife[i] = 1;
    }
    this.clouds.points.geometry.attributes.position.needsUpdate = true;
    this.clouds.points.geometry.attributes.color.needsUpdate = true;
  }

  /** Keep soft cloud sprites anchored to the player. */
  followClouds(camPos, dt) {
    if (!camPos || !this._cloudOffsets?.length) return;
    const pos = this.clouds.positions;
    const wrap = 620;
    for (let i = 0; i < this.clouds.count; i++) {
      const c = this._cloudOffsets[i];
      c.ox += c.drift * dt;
      if (c.ox > wrap) c.ox -= wrap * 2;
      if (c.ox < -wrap) c.ox += wrap * 2;
      const i3 = i * 3;
      pos[i3] = camPos.x + c.ox;
      pos[i3 + 1] = c.y;
      pos[i3 + 2] = camPos.z + c.oz;
    }
    this.clouds.points.geometry.attributes.position.needsUpdate = true;
  }

  setWeather(mode) {
    this.weatherMode = mode;
  }

  setSmoke(colorName) {
    if (!colorName || colorName === 'off') {
      this.smokeColor = null;
      return;
    }
    const map = {
      white: { r: 0.95, g: 0.95, b: 0.97 },
      red: { r: 0.95, g: 0.25, b: 0.2 },
      blue: { r: 0.25, g: 0.45, b: 0.95 },
      rainbow: 'rainbow',
    };
    this.smokeColor = map[colorName] ?? null;
  }

  /**
   * Emit exhaust / contrails behind the aircraft.
   * Dense contrails when altitude is high.
   */
  emitExhaust(pos, vel, throttle, altitude) {
    if (throttle < 0.05) return;
    const speed = vel.length();
    if (speed < 28) return;
    const n = 1 + Math.floor(throttle * 2);
    const altFactor = THREE.MathUtils.clamp((altitude - 30) / 80, 0, 1);
    _back.copy(vel).multiplyScalar(-1 / speed);
    for (let k = 0; k < n; k++) {
      spawn(
        this.exhaust,
        pos.x + _back.x * 1.5 + (Math.random() - 0.5) * 0.3,
        pos.y + _back.y * 1.5 + (Math.random() - 0.5) * 0.2,
        pos.z + _back.z * 1.5 + (Math.random() - 0.5) * 0.3,
        _back.x * 2 + (Math.random() - 0.5),
        _back.y * 2 + 0.5 + Math.random(),
        _back.z * 2 + (Math.random() - 0.5),
        0.3 + altFactor * 0.5,
        0.3 + altFactor * 0.5,
        0.32 + altFactor * 0.5,
        0.4 + altFactor * 1.5
      );
    }
  }

  emitSmoke(pos, vel) {
    if (!this.smokeColor) return;
    const speed = vel.length();
    if (speed < 28) return;
    let r, g, b;
    if (this.smokeColor === 'rainbow') {
      this._smokeHue = (this._smokeHue + 0.02) % 1;
      _smokeHueColor.setHSL(this._smokeHue, 0.85, 0.55);
      r = _smokeHueColor.r;
      g = _smokeHueColor.g;
      b = _smokeHueColor.b;
    } else {
      ({ r, g, b } = this.smokeColor);
    }
    _back.copy(vel).multiplyScalar(-1 / speed);
    spawn(
      this.smoke,
      pos.x + _back.x * 2,
      pos.y + _back.y * 2,
      pos.z + _back.z * 2,
      _back.x * 3 + (Math.random() - 0.5),
      1 + Math.random(),
      _back.z * 3 + (Math.random() - 0.5),
      r, g, b,
      2.5
    );
  }

  emitWeather(camPos, airspeed) {
    if (this.weatherMode === 'clear') return;
    const isRain = this.weatherMode === 'rain';
    for (let k = 0; k < (isRain ? 8 : 3); k++) {
      const x = camPos.x + (Math.random() - 0.5) * 60;
      const y = camPos.y + 20 + Math.random() * 30;
      const z = camPos.z + (Math.random() - 0.5) * 60;
      if (isRain) {
        spawn(this.weather, x, y, z, 0, -25 - airspeed * 0.15, 0, 0.6, 0.7, 0.9, 0.8);
      } else {
        spawn(
          this.weather, x, y, z,
          (Math.random() - 0.5) * 2, -2 - Math.random() * 2, (Math.random() - 0.5) * 2,
          0.9, 0.92, 1, 3
        );
      }
    }
  }

  burstExplosion(pos, count = 80) {
    this.emitImpactExplosion(pos, { weapon: 'cannon', scale: count / 80 });
  }

  /** Per-weapon impact burst — mg/cannon small, rocket orange, missile green. */
  emitImpactExplosion(pos, opts = {}) {
    const weapon = opts.weapon || 'mg';
    const prof = profileForWeapon(weapon);
    const scaleMul = opts.scale ?? 1;
    const scale = prof.scale * scaleMul;
    const spread = prof.spreadMul ?? 1;
    const px = pos.x;
    const py = pos.y;
    const pz = pos.z;

    const debrisN = Math.floor(prof.debris * scaleMul);
    const [dLo, dHi] = prof.debrisSpd;
    const [lifeLo, lifeHi] = prof.debrisLife;

    for (let i = 0; i < debrisN; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const sp = (dLo + Math.random() * (dHi - dLo)) * scale * spread;
      const { r, g, b } = prof.debrisColor();
      spawn(
        this.debris,
        px,
        py,
        pz,
        Math.sin(phi) * Math.cos(theta) * sp,
        Math.abs(Math.cos(phi)) * sp * 0.85 + (4 * scale + Math.random() * 6 * scale) * spread,
        Math.sin(phi) * Math.sin(theta) * sp,
        r,
        g,
        b,
        lifeLo + Math.random() * (lifeHi - lifeLo)
      );
    }

    const [sr, sg, sb] = prof.sparkColor;
    const sparkN = Math.floor(prof.sparks * scaleMul);
    for (let i = 0; i < sparkN; i++) {
      const theta = Math.random() * Math.PI * 2;
      const sp = (4 + Math.random() * 18) * scale * spread;
      spawn(
        this.sparkle,
        px + (Math.random() - 0.5) * scale * 2 * spread,
        py + (Math.random() - 0.5) * scale * spread,
        pz + (Math.random() - 0.5) * scale * 2 * spread,
        Math.cos(theta) * sp,
        (3 + Math.random() * 14 * scale) * spread,
        Math.sin(theta) * sp,
        sr,
        sg,
        sb,
        0.15 + Math.random() * 0.35 * scale
      );
    }

    if (prof.smoke > 0) {
      const [smR, smG, smB] = prof.smokeColor || [0.12, 0.11, 0.1];
      const smokeN = Math.floor(prof.smoke * scaleMul);
      for (let i = 0; i < smokeN; i++) {
        const theta = Math.random() * Math.PI * 2;
        const sp = (2 + Math.random() * 6) * scale * spread;
        spawn(
          this.smoke,
          px + (Math.random() - 0.5) * scale * 2.5 * spread,
          py + 0.4 + Math.random() * scale * spread,
          pz + (Math.random() - 0.5) * scale * 2.5 * spread,
          Math.cos(theta) * sp,
          (2 + Math.random() * 8 * scale) * spread,
          Math.sin(theta) * sp,
          smR + Math.random() * 0.04,
          smG + Math.random() * 0.03,
          smB + Math.random() * 0.03,
          1.2 + Math.random() * 2 * scale
        );
      }
    }

    const [rr, rg, rb] = prof.ringColor || prof.sparkColor;
    const ringN = Math.floor(prof.ring * scaleMul);
    const ringSpread = prof.ringSpread ?? 1;
    const ringVelMul = prof.ringVelMul ?? 1;
    for (let i = 0; i < ringN; i++) {
      const a = (i / Math.max(1, ringN)) * Math.PI * 2 + Math.random() * 0.35;
      const rad = (1 + Math.random() * 3.5) * scale * ringSpread;
      const ringVel = (4 + 3 * scale) * ringVelMul;
      spawn(
        this.sparkle,
        px + Math.cos(a) * rad,
        py + 0.15,
        pz + Math.sin(a) * rad,
        Math.cos(a) * ringVel,
        (1.5 + Math.random() * 3 * scale) * ringVelMul,
        Math.sin(a) * ringVel,
        rr,
        rg,
        rb,
        0.2 + Math.random() * 0.25 * scale
      );
    }
  }

  ringSparkle(pos) {
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      spawn(
        this.sparkle,
        pos.x + Math.cos(a) * 2,
        pos.y + Math.sin(a) * 2,
        pos.z,
        Math.cos(a) * 4,
        Math.sin(a) * 4,
        (Math.random() - 0.5) * 2,
        1, 0.9, 0.3,
        0.6
      );
    }
  }

  emitSpeedLines(pos, forward, speedNorm) {
    if (speedNorm < 0.65) return;
    for (let k = 0; k < 2; k++) {
      const ox = (Math.random() - 0.5) * 8;
      const oy = (Math.random() - 0.5) * 5;
      spawn(
        this.speedLines,
        pos.x + ox,
        pos.y + oy,
        pos.z,
        -forward.x * 40,
        -forward.y * 40,
        -forward.z * 40,
        0.8, 0.9, 1,
        0.15
      );
    }
  }

  update(dt, gravity = true, followPos = null) {
    this._step(this.exhaust, dt, 0.5, false);
    this._step(this.smoke, dt, 0.2, false);
    this._step(this.weather, dt, this.weatherMode === 'rain' ? 0 : 0.5, false);
    this._step(this.debris, dt, 18, true);
    this._step(this.sparkle, dt, 2, false);
    this._step(this.speedLines, dt, 0, false);
    if (followPos) this.followClouds(followPos, dt);
  }

  _step(pool, dt, grav, fadeColor) {
    const pos = pool.positions;
    const vel = pool.velocities;
    const life = pool.life;
    const max = pool.maxLife;
    const col = pool.colors;
    let live = false;
    for (let i = 0; i < pool.count; i++) {
      if (life[i] <= 0) {
        // Park dead particles far away
        const i3 = i * 3;
        pos[i3 + 1] = -9999;
        continue;
      }
      live = true;
      life[i] -= dt;
      const i3 = i * 3;
      if (grav) vel[i3 + 1] -= grav * dt;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      if (fadeColor && max[i] > 0) {
        const f = Math.max(0, life[i] / max[i]);
        col[i3] *= 0.98;
        col[i3 + 1] *= 0.97;
        col[i3 + 2] *= 0.95;
        // soft brightness via unused — PointsMaterial uses vertex colors as-is
        void f;
      }
    }
    pool.points.geometry.attributes.position.needsUpdate = true;
    if (fadeColor) pool.points.geometry.attributes.color.needsUpdate = true;
    pool.points.visible = true;
  }

  setQuality(level) {
    const tier = getQualityTier(level);
    const s = tier.particleScale;
    this.exhaust.points.material.size = 0.35 * s;
    this.smoke.points.material.size = 0.9 * s;
    this.clouds.points.material.size = tier.cloudPointSize;
    this.weather.points.visible = tier.id !== 'low';
  }
}
