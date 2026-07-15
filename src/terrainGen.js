/**
 * Per-map terrain height + vertex coloring.
 * Each map id gets a distinct landform profile.
 */
import * as THREE from 'three';

function smoothRange(t, edge0, edge1) {
  return THREE.MathUtils.smoothstep(edge0, edge1, t);
}

function ridged(noise, x, z, freq, octaves = 4, seed = 0) {
  return noise.ridgedFbm(x * freq + seed, z * freq + seed, octaves, 2.12, 0.52);
}

/** Green Meadows — pastoral lowlands + noise-defined mountain ranges with tall peaks. */
function heightMeadow(x, z, noise, map) {
  const seed = map.seed * 0.17;
  const s = 0.0045;

  // Domain warp breaks grid alignment — mountain chains feel natural.
  const macro = noise.warp2Double(x * s * 0.14 + seed, z * s * 0.14 + seed, 2.4);
  const wx = macro.x / s;
  const wz = macro.y / s;

  // --- WHERE mountains exist (large-scale noise masks) ---
  const continental = noise.fbm(wx * s * 0.16, wz * s * 0.16, 4, 2.0, 0.48);
  const rangeLines = noise.ridgedFbm(wx * s * 0.09 + 80, wz * s * 0.09 + 80, 3, 2.05, 0.5);
  const mountainField = continental * 0.52 + rangeLines * 0.48;
  let mountainZone = smoothRange(mountainField, 0.34, 0.68);

  // Keep spawn hub as gentle pasture (runway area stays approachable).
  const hubDist = Math.hypot(x, z);
  mountainZone *= smoothRange(hubDist, 80, 420);

  // Per-range height: some cordillera are taller than others.
  const rangeAmpN = noise.fbm(wx * s * 0.11 + 210, wz * s * 0.11 + 210, 3, 2.0, 0.5);
  const rangeAmp = THREE.MathUtils.lerp(0.75, 2.6, smoothRange(rangeAmpN, -0.08, 0.78));

  // --- Pastoral base (everywhere, dominant in low mountainZone) ---
  const pasture = noise.fbm(x * s, z * s, 5, 2.03, 0.48) * 13;
  const pastureDetail = noise.fbm(x * s * 2.4, z * s * 2.4, 2, 2.15, 0.42) * 3.5;
  const meadows = pasture + pastureDetail;

  // --- Big ridged mountains (only where mountainZone > 0) ---
  const ridge = ridged(noise, wx, wz, s * 0.52, 7, seed + 25);
  const crags = ridged(noise, wx, wz, s * 1.05, 3, seed + 55) * 0.35;

  const summitN = Math.max(0, noise.fbm(x * s * 1.7, z * s * 1.7, 3, 2.25, 0.42));
  const summits = summitN * ridge * 38 * rangeAmp;

  const skyN = noise.fbm(wx * s * 0.07 + 520, wz * s * 0.07 + 520, 2, 2.0, 0.5);
  const skyPeaks = smoothRange(skyN, 0.58, 0.92) * ridge * 62 * rangeAmp;

  const mountainCore = ridge * 105 * rangeAmp + crags * 28 * rangeAmp + summits + skyPeaks;
  const mountainBlend = meadows * 0.12 + mountainCore;

  // Soft blend: open fields ↔ alpine walls
  const blend = mountainZone * mountainZone * (3 - 2 * mountainZone);
  const h = meadows * (1 - blend) + mountainBlend * blend;

  return h * map.heightScale;
}

/** Sunscar Desert — dunes, dry basins, sandstone mesas (not alpine peaks). */
function heightDesert(x, z, noise, map) {
  const s = 0.0036;
  const seed = map.seed * 0.23;

  const dunes = noise.fbm(x * s * 1.5 + seed, z * s * 1.5 + seed, 4, 2.25, 0.55);
  const ripples = noise.fbm(x * s * 7, z * s * 7, 2, 2.6, 0.38) * 1.8;

  const mesaN = noise.fbm(x * s * 0.22 + 90, z * s * 0.22 + 90, 3, 2.0, 0.48);
  const mesaMask = THREE.MathUtils.smoothstep(0.42, 0.68, mesaN);
  const mesa = mesaMask * ridged(noise, x, z, s * 0.48, 3, seed) * 26;

  const butteN = noise.fbm(x * s * 0.12, z * s * 0.12, 2, 2.0, 0.5);
  const butte = THREE.MathUtils.smoothstep(0.68, 0.9, butteN) * ridged(noise, x, z, s * 0.85, 2, seed + 5) * 18;

  return (dunes * 9 + ripples + mesa + butte) * map.heightScale;
}

/** Frostbite Peaks — sharp alpine ranges, heavy snow line, dramatic elevation. */
function heightArctic(x, z, noise, map) {
  const s = 0.0042;
  const seed = map.seed * 0.31;
  const base = noise.fbm(x * s, z * s, 5, 2.05, 0.5) * 14;
  const ridge = ridged(noise, x, z, s * 0.58, 5, seed + 15);

  const regionAmp = noise.fbm(x * s * 0.16 + seed, z * s * 0.16 + seed, 3, 2.0, 0.5);
  const amp = THREE.MathUtils.lerp(0.9, 2.8, THREE.MathUtils.smoothstep(-0.15, 0.82, regionAmp));

  const maskN = noise.fbm(x * s * 0.28, z * s * 0.28, 3, 2.0, 0.45);
  const mask = THREE.MathUtils.smoothstep(-0.08, 0.42, maskN);

  const peakDetail = noise.fbm(x * s * 1.6, z * s * 1.6, 4, 2.2, 0.4);
  const peaks = Math.max(0, peakDetail) * ridge * 42 * amp * mask;

  return (base + ridge * 78 * amp * mask + peaks) * map.heightScale;
}

/** Coral Archipelago — ocean with scattered tropical islands; hub island at spawn. */
function heightIslands(x, z, noise, map) {
  const waterY = map.waterY ?? 0;
  const oceanFloor = waterY - 16;
  const s = 0.00038;
  const seed = map.seed * 0.41;

  const macro = noise.fbm(x * s + seed, z * s + seed, 4, 2.0, 0.52);
  const medium = noise.fbm(x * s * 2.8 + seed, z * s * 2.8 + seed, 3, 2.1, 0.48);
  let field = macro * 0.68 + medium * 0.32;

  // Starter island + runway always above water at world origin.
  const hubDist = Math.hypot(x, z);
  const hubBoost = THREE.MathUtils.smoothstep(380, 0, hubDist) * 1.05;
  field = Math.max(field, hubBoost);

  const land = THREE.MathUtils.smoothstep(0.06, 0.38, field);
  if (land < 0.012) {
    const seabed = noise.fbm(x * 0.0018 + seed, z * 0.0018 + seed, 2, 2.0, 0.5) * 4;
    return oceanFloor + seabed;
  }

  const rolling = noise.fbm(x * 0.0038 + seed, z * 0.0038 + seed, 4, 2.0, 0.5);
  const micro = noise.fbm(x * 0.011, z * 0.011, 2, 2.2, 0.45) * 4;
  const hills = rolling * 16 + micro;
  const shore = THREE.MathUtils.smoothstep(0.06, 0.32, field);

  return (waterY + 2.4 + hills * shore * land) * map.heightScale;
}

/** Ember Crater — volcanic cones, caldera bowl, basalt ridges. */
function heightVolcanic(x, z, noise, map) {
  const s = 0.004;
  const seed = map.seed * 0.19;
  let h = noise.fbm(x * s, z * s, 4, 2.05, 0.5) * 12;

  const cones = [
    [0, 0, 130, 62],
    [200, 140, 95, 48],
    [-170, 210, 105, 52],
    [240, -190, 88, 44],
    [-210, -160, 92, 46],
  ];

  for (const [cx, cz, radius, peak] of cones) {
    const dist = Math.hypot(x - cx, z - cz);
    if (dist > radius) continue;
    const t = 1 - dist / radius;
    const cone = t * t * (peak + noise.fbm(x * s * 2.5, z * s * 2.5, 2, 2.2, 0.4) * 12);
    h = Math.max(h, cone);
  }

  const ridges = ridged(noise, x, z, s * 0.72, 3, seed) * 22;
  h += ridges;

  const caldera = Math.hypot(x, z);
  const bowl = THREE.MathUtils.smoothstep(95, 18, caldera) * 14;
  h -= bowl * 0.55;

  return h * map.heightScale;
}

export function sampleRawHeight(x, z, noise, map) {
  switch (map.id) {
    case 'desert':
      return heightDesert(x, z, noise, map);
    case 'arctic':
      return heightArctic(x, z, noise, map);
    case 'islands':
      return heightIslands(x, z, noise, map);
    case 'volcanic':
      return heightVolcanic(x, z, noise, map);
    default:
      return heightMeadow(x, z, noise, map);
  }
}

export function applyMapTerrainColor(h, c, c2, map) {
  const wy = map.waterY ?? 0;

  if (map.id === 'desert') {
    if (h < 1) c.set(map.low);
    else if (h < 10) c.set(map.mid).lerp(c2.set(map.mid2), h / 10);
    else if (h < 22) c.set(map.mid2).lerp(c2.set(map.rock), (h - 10) / 12);
    else c.set(map.rock).lerp(c2.set(map.snow), Math.min(1, (h - 22) / 16));
    return;
  }

  if (map.id === 'arctic') {
    if (h < 4) c.set(map.low);
    else if (h < 14) c.set(map.mid).lerp(c2.set(map.mid2), (h - 4) / 10);
    else if (h < 26) c.set(map.mid2).lerp(c2.set(map.rock), (h - 14) / 12);
    else if (h < 38) c.set(map.rock).lerp(c2.set(map.snow), (h - 26) / 12);
    else {
      c.set(map.snow);
      c.lerp(c2.set(map.rock), Math.min(0.22, (h - 38) / 70));
    }
    return;
  }

  if (map.id === 'islands') {
    if (h < wy + 0.3) c.set(map.waterShallow != null ? map.low : map.low);
    else if (h < wy + 3) c.set(map.low).lerp(c2.set(map.mid), (h - wy - 0.3) / 2.7);
    else if (h < wy + 12) c.set(map.mid).lerp(c2.set(map.mid2), (h - wy - 3) / 9);
    else if (h < wy + 22) c.set(map.mid2).lerp(c2.set(map.rock), (h - wy - 12) / 10);
    else c.set(map.rock);
    return;
  }

  if (map.id === 'volcanic') {
    if (h < 2) c.set(map.low);
    else if (h < 12) c.set(map.mid).lerp(c2.set(map.mid2), (h - 2) / 10);
    else if (h < 28) c.set(map.mid2).lerp(c2.set(map.rock), (h - 12) / 16);
    else if (h < 42) c.set(map.rock).lerp(c2.set(map.snow), (h - 28) / 14);
    else c.set(map.snow);
    return;
  }

  // Meadow — greens below, rock + snow on tall noise-driven peaks
  if (h < 2) c.set(map.low);
  else if (h < 14) c.set(map.mid).lerp(c2.set(map.mid2), (h - 2) / 12);
  else if (h < 36) c.set(map.mid2).lerp(c2.set(map.rock), (h - 14) / 22);
  else if (h < 72) c.set(map.rock).lerp(c2.set(map.snow), (h - 36) / 36);
  else {
    c.set(map.snow);
    c.lerp(c2.set(map.rock), Math.min(0.28, (h - 72) / 100));
  }
}

/** Prop spawn height range per map biome. */
export function propHeightRange(map) {
  const wy = map.waterY ?? 0;
  switch (map.id) {
    case 'islands':
      return { min: wy + 2.5, max: wy + 24 };
    case 'desert':
      return { min: 1.5, max: 20 };
    case 'arctic':
      return { min: 3, max: 24 };
    case 'volcanic':
      return { min: 2.5, max: 32 };
    default:
      return { min: 2.2, max: 32 };
  }
}
