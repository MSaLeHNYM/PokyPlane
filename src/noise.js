/**
 * 2D gradient noise + terrain helpers (fbm, ridged, domain warp).
 * Self-contained — no external textures or libraries.
 */

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function grad2(hash, x, y) {
  const h = hash & 3;
  const u = h < 2 ? x : y;
  const v = h < 2 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Build a permutation table from an optional seed. */
export function createNoise(seed = 1337) {
  const p = new Uint8Array(512);
  const perm = new Uint8Array(256);
  let s = seed >>> 0;
  for (let i = 0; i < 256; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    perm[i] = i;
  }
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = perm[i];
    perm[i] = perm[j];
    perm[j] = tmp;
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  function noise2(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
    const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  }

  /** Fractal Brownian motion — smooth rolling hills. */
  function fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise2(x * freq, y * freq) * amp;
      max += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / max;
  }

  /** Ridged multifractal — sharp mountain ridges with natural weighting. */
  function ridgedFbm(x, y, octaves = 4, lacunarity = 2.1, gain = 0.52) {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let weight = 1;
    for (let i = 0; i < octaves; i++) {
      let n = noise2(x * freq, y * freq);
      n = 1 - Math.abs(n);
      n *= n;
      n *= weight;
      sum += n * amp;
      weight = Math.min(1, Math.max(0, n * 2.1));
      amp *= gain;
      freq *= lacunarity;
    }
    return sum;
  }

  /** Billow noise — soft rounded bumps (dunes, cloud-like hills). */
  function billowFbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < octaves; i++) {
      sum += Math.abs(noise2(x * freq, y * freq)) * amp;
      max += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / max;
  }

  /**
   * Domain warp — offsets (x,z) by fbm for organic, non-grid-aligned features.
   * @returns {{ x: number, y: number }}
   */
  function warp2(x, y, strength = 1, octaves = 3) {
    const wx = fbm(x + 17.3, y + 9.1, octaves, 2.05, 0.5);
    const wy = fbm(x + 41.7, y + 23.5, octaves, 2.05, 0.5);
    return { x: x + wx * strength, y: y + wy * strength };
  }

  /** Double domain warp — smoother, more natural macro shapes. */
  function warp2Double(x, y, strength = 1) {
    const q = warp2(x, y, strength * 0.55, 3);
    return warp2(q.x, q.y, strength, 3);
  }

  return { noise2, fbm, ridgedFbm, billowFbm, warp2, warp2Double };
}
