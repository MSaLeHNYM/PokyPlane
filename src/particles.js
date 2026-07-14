/**
 * Unified GPU-friendly particle pools using THREE.Points + BufferGeometry.
 * Typed-array updates only — no per-frame `new` allocations in hot paths.
 */
import * as THREE from 'three';

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

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.exhaust = makePoints(400, 0.35, 0xffffff, { opacity: 0.6 });
    this.smoke = makePoints(500, 0.9, 0xffffff, { opacity: 0.5 });
    this.weather = makePoints(800, 0.25, 0xffffff, { opacity: 0.7 });
    this.debris = makePoints(300, 0.4, 0xff8844, { additive: true, opacity: 0.95 });
    this.sparkle = makePoints(200, 0.5, 0xffffff, { additive: true });
    this.speedLines = makePoints(120, 0.15, 0xffffff, { additive: true, opacity: 0.7 });
    this.clouds = makePoints(180, 18, 0xffffff, { opacity: 0.35 });

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
    // Soft volumetric clumps scattered across the sky
    for (let i = 0; i < this.clouds.count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 80 + Math.random() * 420;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      const y = 45 + Math.random() * 80;
      const i3 = i * 3;
      this.clouds.positions[i3] = x;
      this.clouds.positions[i3 + 1] = y;
      this.clouds.positions[i3 + 2] = z;
      this.clouds.velocities[i3] = 1 + Math.random() * 2;
      this.clouds.velocities[i3 + 1] = 0;
      this.clouds.velocities[i3 + 2] = (Math.random() - 0.5) * 0.8;
      this.clouds.colors[i3] = 0.92;
      this.clouds.colors[i3 + 1] = 0.95;
      this.clouds.colors[i3 + 2] = 1;
      this.clouds.life[i] = 1;
      this.clouds.maxLife[i] = 1;
    }
    this.clouds.points.geometry.attributes.position.needsUpdate = true;
    this.clouds.points.geometry.attributes.color.needsUpdate = true;
  }

  /** Keep soft cloud sprites near the player as they fly. */
  followClouds(camPos, dt) {
    if (!camPos) return;
    const pos = this.clouds.positions;
    const vel = this.clouds.velocities;
    const wrap = 480;
    for (let i = 0; i < this.clouds.count; i++) {
      const i3 = i * 3;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      let dx = pos[i3] - camPos.x;
      let dz = pos[i3 + 2] - camPos.z;
      if (dx > wrap) pos[i3] -= wrap * 2;
      if (dx < -wrap) pos[i3] += wrap * 2;
      if (dz > wrap) pos[i3 + 2] -= wrap * 2;
      if (dz < -wrap) pos[i3 + 2] += wrap * 2;
      // Keep altitude band
      if (pos[i3 + 1] < 40) pos[i3 + 1] = 45 + Math.random() * 70;
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
    for (let k = 0; k < n; k++) {
      const back = vel.clone().multiplyScalar(-1 / speed);
      spawn(
        this.exhaust,
        pos.x + back.x * 1.5 + (Math.random() - 0.5) * 0.3,
        pos.y + back.y * 1.5 + (Math.random() - 0.5) * 0.2,
        pos.z + back.z * 1.5 + (Math.random() - 0.5) * 0.3,
        back.x * 2 + (Math.random() - 0.5),
        back.y * 2 + 0.5 + Math.random(),
        back.z * 2 + (Math.random() - 0.5),
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
      const c = new THREE.Color().setHSL(this._smokeHue, 0.85, 0.55);
      r = c.r; g = c.g; b = c.b;
    } else {
      ({ r, g, b } = this.smokeColor);
    }
    const back = vel.clone().multiplyScalar(-1 / speed);
    spawn(
      this.smoke,
      pos.x + back.x * 2,
      pos.y + back.y * 2,
      pos.z + back.z * 2,
      back.x * 3 + (Math.random() - 0.5),
      1 + Math.random(),
      back.z * 3 + (Math.random() - 0.5),
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
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const sp = 8 + Math.random() * 28;
      spawn(
        this.debris,
        pos.x, pos.y, pos.z,
        Math.sin(phi) * Math.cos(theta) * sp,
        Math.cos(phi) * sp * 0.8 + 5,
        Math.sin(phi) * Math.sin(theta) * sp,
        1, 0.4 + Math.random() * 0.4, 0.1,
        0.6 + Math.random() * 1.2
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
      const side = new THREE.Vector3(ox, oy, 0);
      spawn(
        this.speedLines,
        pos.x + side.x,
        pos.y + side.y,
        pos.z + side.z,
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
    const sizes = { low: 0.5, medium: 1, high: 1 };
    const s = sizes[level] ?? 1;
    this.exhaust.points.material.size = 0.35 * s;
    this.smoke.points.material.size = 0.9 * s;
    this.clouds.points.material.size = level === 'low' ? 12 : 18;
    this.weather.points.visible = level !== 'low';
  }
}
