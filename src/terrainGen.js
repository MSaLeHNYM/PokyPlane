/**
 * Layered open-world height + shoreline-aware vertex coloring.
 * Themes share one stack; climate params live on map.terrain.
 */
import * as THREE from 'three';

/** Hermite blend — Three.js uses smoothstep(x, min, max), not GLSL order. */
function smoothRange(t, edge0, edge1) {
  return THREE.MathUtils.smoothstep(t, edge0, edge1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function profileOf(map) {
  return (
    map.terrain || {
      freq: 0.0042,
      warpStr: 2.2,
      landBias: 0.25,
      mountainLo: 0.36,
      mountainHi: 0.7,
      hillsAmp: 16,
      detailAmp: 3,
      ridgeAmp: 90,
      peakAmp: 40,
      rangeAmpMin: 0.85,
      rangeAmpMax: 1.5,
      hubRadius: 380,
      oceanDepth: 0,
      style: 'alpine',
    }
  );
}

function channelOffset(map, key, fallback = 0) {
  const ch = map.channels?.[key];
  return ch != null ? (ch % 10000) * 0.0017 : fallback;
}

/**
 * Shared layered height field — continental → mountains → hills → detail.
 * Deterministic for (x,z,noise,map.worldSeed/channels).
 */
export function sampleRawHeight(x, z, noise, map) {
  const p = profileOf(map);
  const s = p.freq;
  const oWarp = channelOffset(map, 'warp', map.seed * 0.17);
  const oMtn = channelOffset(map, 'mountains', 25);
  const scale = map.heightScale ?? 1;
  const waterY = map.waterY ?? 0;
  const style = p.style || 'alpine';

  // Macro domain warp — breaks grid alignment of ranges/coasts.
  const macro = noise.warp2Double(x * s * 0.13 + oWarp, z * s * 0.13 + oWarp, p.warpStr);
  const wx = macro.x / s;
  const wz = macro.y / s;

  // Continental / land mask
  const continental = noise.fbm(wx * s * 0.15, wz * s * 0.15, 5, 2.02, 0.5);
  const landField = continental + (p.landBias || 0);

  // Soft hub — spawn stays approachable (weaker than old hard cut).
  const hubDist = Math.hypot(x, z);
  const hubR = p.hubRadius || 380;
  const hubSoft = smoothRange(hubDist, hubR * 0.22, hubR);

  if (style === 'islands' || (p.oceanDepth || 0) > 0) {
    return heightIslandsLayered(x, z, noise, map, p, landField, hubSoft, wx, wz, s, oMtn, scale, waterY);
  }
  if (style === 'desert') {
    return heightDesertLayered(x, z, noise, map, p, landField, hubSoft, wx, wz, s, oMtn, scale);
  }
  if (style === 'volcanic') {
    return heightVolcanicLayered(x, z, noise, map, p, landField, hubSoft, wx, wz, s, oMtn, scale);
  }
  return heightAlpineLayered(x, z, noise, map, p, landField, hubSoft, wx, wz, s, oMtn, scale);
}

function heightAlpineLayered(x, z, noise, map, p, landField, hubSoft, wx, wz, s, oMtn, scale) {
  const rangeLines = noise.ridgedFbm(wx * s * 0.085 + 80 + oMtn, wz * s * 0.085 + 80, 4, 2.08, 0.5);
  const mountainField = landField * 0.35 + rangeLines * 0.65;
  let mountainZone = smoothRange(mountainField, p.mountainLo, p.mountainHi) * hubSoft;

  const rangeAmpN = noise.fbm(wx * s * 0.1 + 210, wz * s * 0.1 + 210, 3, 2.0, 0.5);
  const rangeAmp = lerp(p.rangeAmpMin, p.rangeAmpMax, smoothRange(rangeAmpN, -0.1, 0.75));

  const hills =
    noise.fbm(x * s, z * s, 5, 2.03, 0.48) * p.hillsAmp +
    noise.fbm(x * s * 2.5, z * s * 2.5, 3, 2.12, 0.42) * p.detailAmp;

  const ridge = noise.ridgedFbm(wx * s * 0.48 + oMtn, wz * s * 0.48 + oMtn, 6, 2.12, 0.52);
  const crags = noise.ridgedFbm(wx * s * 1.05 + oMtn + 40, wz * s * 1.05, 3, 2.15, 0.48) * 0.35;
  const summitN = Math.max(0, noise.fbm(x * s * 1.6, z * s * 1.6, 3, 2.2, 0.42));
  const peaks = summitN * ridge * p.peakAmp * rangeAmp;

  const mountainCore = (ridge * p.ridgeAmp + crags * p.ridgeAmp * 0.32 + peaks) * rangeAmp;
  const blend = mountainZone * mountainZone * (3 - 2 * mountainZone);
  const h = hills * (1 - blend) + (hills * 0.12 + mountainCore) * blend;

  const valley = noise.fbm(x * s * 0.55 + 90, z * s * 0.55 + 90, 2, 2.0, 0.5) * 5.5 * (1 - blend * 0.85);
  return (h + valley) * scale;
}

function heightDesertLayered(x, z, noise, map, p, landField, hubSoft, wx, wz, s, oMtn, scale) {
  const dunes =
    noise.billowFbm(x * s * 1.35 + oMtn, z * s * 1.35, 5, 2.15, 0.52) * (p.hillsAmp + 6) +
    noise.fbm(x * s * 6.2, z * s * 6.2, 2, 2.5, 0.4) * p.detailAmp;

  const basin = Math.max(0, -landField) * 5;

  // Mesas from unwarped coords — warp collapsed the mask range.
  const mesaN = noise.fbm(x * s * 0.18 + 90 + oMtn, z * s * 0.18 + 90, 4, 2.0, 0.5);
  const mesaMask = smoothRange(mesaN, p.mountainLo, p.mountainHi) * hubSoft;
  const mesaTop = noise.ridgedFbm(x * s * 0.42 + oMtn, z * s * 0.42, 4, 2.08, 0.5);
  const mesa = mesaMask * (18 + mesaTop * p.ridgeAmp * 0.7);

  const butteN = noise.fbm(x * s * 0.09 + 40, z * s * 0.09 + 40, 3, 2.0, 0.5);
  const butte =
    smoothRange(butteN, 0.35, 0.72) *
    hubSoft *
    noise.ridgedFbm(x * s * 0.75 + oMtn, z * s * 0.75, 3, 2.12, 0.48) *
    p.peakAmp;

  return (dunes - basin + mesa + butte) * scale;
}

function heightIslandsLayered(x, z, noise, map, p, landField, hubSoft, wx, wz, s, oMtn, scale, waterY) {
  const oceanFloor = waterY - (p.oceanDepth || 16);
  // Hub island always present near origin.
  const hubBoost = (1 - hubSoft) * 1.15;
  let field = landField * 0.7 + hubBoost + noise.fbm(wx * s * 0.35, wz * s * 0.35, 3, 2.05, 0.5) * 0.25;

  const land = smoothRange(field, 0.02, 0.36);
  if (land < 0.02) {
    const seabed = noise.fbm(x * 0.0016 + oMtn, z * 0.0016, 3, 2.0, 0.5) * 5;
    return oceanFloor + seabed;
  }

  const hills =
    noise.fbm(x * s * 1.1, z * s * 1.1, 4, 2.05, 0.5) * p.hillsAmp +
    noise.fbm(x * s * 3.2, z * s * 3.2, 2, 2.2, 0.42) * p.detailAmp;

  const mtnMask = smoothRange(field, p.mountainLo, p.mountainHi) * land;
  const ridge = noise.ridgedFbm(wx * s * 0.55 + oMtn, wz * s * 0.55, 5, 2.1, 0.5);
  const volcano = mtnMask * ridge * p.ridgeAmp * 0.65;

  const shore = smoothRange(field, 0.02, 0.3);
  const h = waterY + 1.8 + (hills * shore + volcano) * land;
  return h * scale;
}

function heightVolcanicLayered(x, z, noise, map, p, landField, hubSoft, wx, wz, s, oMtn, scale) {
  const base =
    noise.fbm(x * s, z * s, 4, 2.05, 0.5) * p.hillsAmp +
    noise.fbm(x * s * 2.8, z * s * 2.8, 2, 2.15, 0.42) * p.detailAmp;

  // Procedural cone field from noise (seeded, not fixed coords).
  const cell = 220;
  const cx = Math.floor(x / cell);
  const cz = Math.floor(z / cell);
  let cones = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ix = cx + dx;
      const iz = cz + dz;
      const n = noise.noise2(ix * 19.7 + oMtn, iz * 31.3 + oMtn * 0.5);
      if (n < 0.12) continue;
      const jx = (ix + 0.5 + noise.noise2(ix + 2.1, iz + 7.3) * 0.35) * cell;
      const jz = (iz + 0.5 + noise.noise2(ix + 5.5, iz + 1.9) * 0.35) * cell;
      const radius = 70 + n * 55;
      const peak = 38 + n * p.peakAmp;
      const dist = Math.hypot(x - jx, z - jz);
      if (dist > radius) continue;
      const t = 1 - dist / radius;
      cones = Math.max(cones, t * t * peak);
    }
  }

  const ridge =
    noise.ridgedFbm(wx * s * 0.55 + oMtn, wz * s * 0.55, 4, 2.1, 0.5) * p.ridgeAmp * 0.45 * hubSoft;
  let h = Math.max(base, cones) + ridge;

  // Soft caldera near origin for landmark (scaled by seed offset).
  const calderaR = 70 + (map.seed % 40);
  const caldera = Math.hypot(x, z);
  h -= smoothRange(caldera, 22, calderaR + 40) * 12 * (1 - hubSoft * 0.3);

  return h * scale;
}

/**
 * Shoreline / wetness-aware coloring — avoids bright sand deep underwater flicker.
 */
export function applyMapTerrainColor(h, c, c2, map) {
  const wy = map.waterY ?? 0;
  const depth = h - wy;
  const id = map.id;

  // Deep underwater: muted seabed, not beach sand.
  if (depth < -1.2) {
    const deep = c2.set(map.waterDeep ?? map.rock).multiplyScalar(0.45);
    c.copy(deep).lerp(c2.set(map.rock), smoothRange(depth, -14, -1.2));
    return;
  }

  if (id === 'desert') {
    if (depth < 0.4) c.set(map.low).lerp(c2.set(map.mid), smoothRange(depth, -0.5, 2));
    else if (h < 12) c.set(map.mid).lerp(c2.set(map.mid2), h / 12);
    else if (h < 28) c.set(map.mid2).lerp(c2.set(map.rock), (h - 12) / 16);
    else c.set(map.rock).lerp(c2.set(map.snow), Math.min(1, (h - 28) / 20));
    return;
  }

  if (id === 'arctic') {
    if (depth < 0.6) c.set(map.low).lerp(c2.set(map.mid), smoothRange(depth, -0.4, 3));
    else if (h < 18) c.set(map.mid).lerp(c2.set(map.mid2), (h - 4) / 14);
    else if (h < 40) c.set(map.mid2).lerp(c2.set(map.rock), (h - 18) / 22);
    else if (h < 70) c.set(map.rock).lerp(c2.set(map.snow), (h - 40) / 30);
    else {
      c.set(map.snow);
      c.lerp(c2.set(map.rock), Math.min(0.2, (h - 70) / 80));
    }
    return;
  }

  if (id === 'islands') {
    if (depth < 0.15) {
      c.set(map.rock).multiplyScalar(0.55).lerp(c2.set(map.low), smoothRange(depth, -2, 0.15));
    } else if (depth < 2.5) c.set(map.low).lerp(c2.set(map.mid), (depth - 0.15) / 2.35);
    else if (depth < 14) c.set(map.mid).lerp(c2.set(map.mid2), (depth - 2.5) / 11.5);
    else if (depth < 28) c.set(map.mid2).lerp(c2.set(map.rock), (depth - 14) / 14);
    else c.set(map.rock);
    return;
  }

  if (id === 'volcanic') {
    if (depth < 0.5) c.set(map.low);
    else if (h < 16) c.set(map.mid).lerp(c2.set(map.mid2), (h - 2) / 14);
    else if (h < 36) c.set(map.mid2).lerp(c2.set(map.rock), (h - 16) / 20);
    else if (h < 55) c.set(map.rock).lerp(c2.set(map.snow), (h - 36) / 19);
    else c.set(map.snow);
    return;
  }

  // Meadow
  if (depth < 0.5) c.set(map.low).lerp(c2.set(map.mid), smoothRange(depth, -0.4, 2.5));
  else if (h < 18) c.set(map.mid).lerp(c2.set(map.mid2), (h - 2) / 16);
  else if (h < 48) c.set(map.mid2).lerp(c2.set(map.rock), (h - 18) / 30);
  else if (h < 95) c.set(map.rock).lerp(c2.set(map.snow), (h - 48) / 47);
  else {
    c.set(map.snow);
    c.lerp(c2.set(map.rock), Math.min(0.25, (h - 95) / 90));
  }
}

/** Prop spawn height range per map biome. */
export function propHeightRange(map) {
  const wy = map.waterY ?? 0;
  switch (map.id) {
    case 'islands':
      return { min: wy + 2.5, max: wy + 36 };
    case 'desert':
      return { min: 1.5, max: 28 };
    case 'arctic':
      return { min: 3, max: 42 };
    case 'volcanic':
      return { min: 2.5, max: 48 };
    default:
      return { min: 2.2, max: 48 };
  }
}
