/**
 * Procedural airports (فردودگاه) — main spawn strip + scattered landing strips.
 */
import * as THREE from 'three';

export const RUNWAY_WIDTH = 18;
export const RUNWAY_LENGTH = 120;
/** Legacy fallback only — runways now snap to sampled terrain height. */
export const RUNWAY_ELEVATION = 1.65;

/** @param {number} v @param {number} lo @param {number} hi */
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** @param {object} ap @param {number} lx @param {number} lz */
export function localToWorldXZ(ap, lx, lz) {
  const c = Math.cos(ap.heading);
  const s = Math.sin(ap.heading);
  return {
    x: ap.x + lx * c - lz * s,
    z: ap.z + lx * s + lz * c,
  };
}

/** @param {object} ap @param {number} x @param {number} z */
export function worldToRunwayLocal(ap, x, z) {
  const dx = x - ap.x;
  const dz = z - ap.z;
  const c = Math.cos(-ap.heading);
  const s = Math.sin(-ap.heading);
  return {
    lx: dx * c - dz * s,
    lz: dx * s + dz * c,
  };
}

/** Flat runway surface height (no pitch/roll). */
export function runwayHeightAt(ap, _lx, _lz) {
  return ap.elevation ?? RUNWAY_ELEVATION;
}

/**
 * Level runway pad — elevation = lowest terrain under footprint (cut into hills).
 * @param {object} ap
 * @param {(x:number,z:number)=>number} rawHeight
 */
export function computeRunwaySurface(ap, rawHeight) {
  const hw = ap.width * 0.5;
  const hl = ap.length * 0.5;
  const padW = hw + 18;
  const padL = hl + 22;

  const samples = [];
  for (let iz = -padL; iz <= padL; iz += padL / 3) {
    for (let ix = -padW; ix <= padW; ix += padW / 3) {
      const w = localToWorldXZ(ap, ix, iz);
      samples.push(rawHeight(w.x, w.z));
    }
  }

  const minH = Math.min(...samples);
  const maxH = Math.max(...samples);

  return {
    elevation: minH + 0.12,
    pitch: 0,
    roll: 0,
    cutDepth: maxH - minH,
  };
}

/**
 * Main hub runway at world origin; extra strips roll in per chunk via tryGenerateChunkStrip.
 * @param {import('./maps.js').MAPS[0]} map
 * @param {(x:number,z:number)=>number} rawHeight
 */
export function generateAirports(map, rawHeight) {
  const airports = [];

  const main = {
    id: 'main',
    name: { en: 'PokyField Intl', fa: 'فرودگاه پوکی‌فیلد' },
    x: 0,
    z: 0,
    heading: 0,
    length: 140,
    width: 20,
    primary: true,
  };
  Object.assign(main, computeRunwaySurface(main, rawHeight));
  if (map.waterY != null) {
    main.elevation = Math.max(main.elevation, map.waterY + (map.id === 'islands' ? 2.8 : 0.35));
  }
  airports.push(main);

  return airports;
}

/**
 * Deterministic runway strip roll when a terrain chunk loads.
 * @param {number} cx
 * @param {number} cz
 * @param {number} chunkSize
 * @param {object} map
 * @param {(x:number,z:number)=>number} rawHeight
 * @param {object[]} airports existing strips (distance checks)
 * @param {number} chancePercent 0–100 per chunk
 * @param {number} seed map seed
 */
export function tryGenerateChunkStrip(cx, cz, chunkSize, map, rawHeight, airports, chancePercent, seed) {
  const chance = clamp(chancePercent, 0, 100);
  if (chance <= 0 || (cx === 0 && cz === 0)) return null;

  let s = (seed * 73856093 + cx * 19349663 + cz * 83492791) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s >>> 0) / 4294967296;
  };

  if (rand() * 100 >= chance) return null;

  const originX = cx * chunkSize;
  const originZ = cz * chunkSize;
  const x = originX + chunkSize * (0.18 + rand() * 0.64);
  const z = originZ + chunkSize * (0.18 + rand() * 0.64);

  if (Math.hypot(x, z) < 90) return null;

  const h = rawHeight(x, z);
  const minLand = map.waterY != null ? map.waterY + (map.id === 'islands' ? 1.5 : 0.8) : -2;
  if (h < minLand) return null;
  if (h > (map.id === 'islands' ? 36 : 48)) return null;

  const slopeProbe = rawHeight(x + 18, z) - rawHeight(x - 18, z);
  if (Math.abs(slopeProbe) > 20) return null;

  for (const ap of airports) {
    if (Math.hypot(ap.x - x, ap.z - z) < 70) return null;
  }

  const heading = rand() * Math.PI * 2;
  const idx = airports.filter((a) => !a.primary).length + 1;
  const strip = {
    id: `chunk_${cx}_${cz}`,
    name: {
      en: `Strip ${idx}`,
      fa: `باند ${idx}`,
    },
    x,
    z,
    heading,
    length: RUNWAY_LENGTH + Math.floor(rand() * 40),
    width: RUNWAY_WIDTH,
    primary: false,
    chunkCx: cx,
    chunkCz: cz,
  };
  Object.assign(strip, computeRunwaySurface(strip, rawHeight));
  if (map.waterY != null && strip.elevation < map.waterY + 0.35) return null;
  if ((strip.cutDepth ?? 0) > 32) return null;

  return strip;
}

/**
 * Flatten terrain under runway footprints.
 * @param {number} x
 * @param {number} z
 * @param {number} h
 * @param {object[]} airports
 */
export function flattenForAirports(x, z, h, airports) {
  let out = h;
  for (const ap of airports) {
    const { lx, lz } = worldToRunwayLocal(ap, x, z);
    const hw = ap.width * 0.5;
    const hl = ap.length * 0.5;
    const padW = hw + 18;
    const padL = hl + 22;
    const bermW = padW + 20;
    const bermL = padL + 24;

    const ax = Math.abs(lx);
    const az = Math.abs(lz);
    if (ax > bermW || az > bermL) continue;

    const elev = ap.elevation ?? RUNWAY_ELEVATION;

    // Hard-flat runway + apron pad (cut/fill to level elevation).
    if (ax <= padW && az <= padL) {
      out = elev;
      continue;
    }

    // Sloped berm — terrain blends back to natural height at pad edge.
    const edgeX = 1 - THREE.MathUtils.smoothstep(padW, bermW, ax);
    const edgeZ = 1 - THREE.MathUtils.smoothstep(padL, bermL, az);
    const blend = edgeX * edgeZ;
    if (blend <= 0) continue;
    out = THREE.MathUtils.lerp(out, elev, blend);
  }
  return out;
}

const _offset = new THREE.Vector3();

/**
 * Spawn pose at runway threshold, facing along strip.
 * @param {object} airport
 * @param {'host'|'guest'} role
 */
export function runwaySpawnPose(airport, role = 'host') {
  const half = airport.length * 0.5;
  const along = -half + 22 + (role === 'guest' ? 14 : 0);
  const lateral = role === 'guest' ? 6 : 0;
  _offset.set(lateral, 0, along).applyAxisAngle(new THREE.Vector3(0, 1, 0), airport.heading);
  return {
    x: airport.x + _offset.x,
    z: airport.z + _offset.z,
    heading: airport.heading,
  };
}

/**
 * Pick spawn airport — main by default; random secondary strip by chance %.
 * @param {object[]} airports
 * @param {number} randomChancePercent 0–100
 */
export function pickSpawnAirport(airports, randomChancePercent = 5) {
  const chance = clamp(randomChancePercent, 0, 100);
  const secondary = airports.filter((a) => !a.primary);
  if (secondary.length && Math.random() * 100 < chance) {
    return secondary[Math.floor(Math.random() * secondary.length)];
  }
  return airports.find((a) => a.primary) || airports[0];
}
