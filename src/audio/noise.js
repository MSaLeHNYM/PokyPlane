/**
 * Shared procedural noise buffers for Web Audio synths.
 */

const _cache = new Map();

function cacheKey(kind, seconds, sampleRate) {
  return `${kind}|${seconds}|${sampleRate}`;
}

/** White noise AudioBuffer. */
export function whiteNoiseBuffer(ctx, seconds = 1) {
  const key = cacheKey('white', seconds, ctx.sampleRate);
  if (_cache.has(key)) return _cache.get(key);
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  _cache.set(key, buf);
  return buf;
}

/** Pink-ish noise (Voss-McCartney approximation). */
export function pinkNoiseBuffer(ctx, seconds = 1.5) {
  const key = cacheKey('pink', seconds, ctx.sampleRate);
  if (_cache.has(key)) return _cache.get(key);
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  _cache.set(key, buf);
  return buf;
}

/** Brown (red) noise — deeper rumble. */
export function brownNoiseBuffer(ctx, seconds = 1.5) {
  const key = cacheKey('brown', seconds, ctx.sampleRate);
  if (_cache.has(key)) return _cache.get(key);
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  _cache.set(key, buf);
  return buf;
}

export function clearNoiseCache() {
  _cache.clear();
}
