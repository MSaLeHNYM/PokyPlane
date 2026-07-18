/**
 * Per-plane engine voice profiles — pure data, no AudioNodes.
 *
 * character:
 *  - light4: light 4-cyl putter + prop tick
 *  - heavyTwin: deep twin drone + slow blade
 *  - funny: uneven LFO / toy wobble
 *  - warProp: aggressive prop + growl
 *  - turbine: spool whine + clean high band
 */

const TAG_DEFAULTS = {
  small: 'light4',
  big: 'heavyTwin',
  funny: 'funny',
  war: 'warProp',
  sport: 'turbine',
};

/** @typedef {'light4'|'heavyTwin'|'funny'|'warProp'|'turbine'} EngineCharacter */

/**
 * @typedef {object} EngineProfile
 * @property {EngineCharacter} character
 * @property {number} baseHz        idle fundamental
 * @property {number} rpmSpan       added Hz at full throttle
 * @property {number} cylinders     firing-rate multiplier feel
 * @property {number} propBlades
 * @property {number} exhaustGain
 * @property {number} propGain
 * @property {number} combustionGain
 * @property {number} whineGain
 * @property {number} rattleGain
 * @property {number} boostGain
 * @property {number} filterIdle
 * @property {number} filterFull
 * @property {number} response      setTarget time constant (lower = snappier)
 * @property {number} wobbleHz      funny pitch LFO
 * @property {number} wobbleDepth
 * @property {number} volume
 */

/** @type {Record<string, EngineProfile>} */
export const ENGINE_PROFILES = {
  poky: {
    character: 'light4',
    baseHz: 48,
    rpmSpan: 95,
    cylinders: 4,
    propBlades: 2,
    exhaustGain: 0.22,
    propGain: 0.18,
    combustionGain: 0.2,
    whineGain: 0.04,
    rattleGain: 0.03,
    boostGain: 0.16,
    filterIdle: 380,
    filterFull: 2600,
    response: 0.06,
    wobbleHz: 0,
    wobbleDepth: 0,
    volume: 0.95,
  },
  moth: {
    character: 'light4',
    baseHz: 62,
    rpmSpan: 110,
    cylinders: 4,
    propBlades: 2,
    exhaustGain: 0.14,
    propGain: 0.22,
    combustionGain: 0.16,
    whineGain: 0.08,
    rattleGain: 0.05,
    boostGain: 0.14,
    filterIdle: 450,
    filterFull: 3200,
    response: 0.045,
    wobbleHz: 0,
    wobbleDepth: 0,
    volume: 0.82,
  },
  whale: {
    character: 'heavyTwin',
    baseHz: 32,
    rpmSpan: 55,
    cylinders: 8,
    propBlades: 4,
    exhaustGain: 0.34,
    propGain: 0.14,
    combustionGain: 0.28,
    whineGain: 0.02,
    rattleGain: 0.08,
    boostGain: 0.12,
    filterIdle: 220,
    filterFull: 1600,
    response: 0.12,
    wobbleHz: 0,
    wobbleDepth: 0,
    volume: 1.15,
  },
  fortress: {
    character: 'heavyTwin',
    baseHz: 28,
    rpmSpan: 60,
    cylinders: 8,
    propBlades: 4,
    exhaustGain: 0.38,
    propGain: 0.12,
    combustionGain: 0.3,
    whineGain: 0.03,
    rattleGain: 0.1,
    boostGain: 0.14,
    filterIdle: 200,
    filterFull: 1500,
    response: 0.14,
    wobbleHz: 0,
    wobbleDepth: 0,
    volume: 1.2,
  },
  banana: {
    character: 'funny',
    baseHz: 55,
    rpmSpan: 100,
    cylinders: 3,
    propBlades: 2,
    exhaustGain: 0.18,
    propGain: 0.2,
    combustionGain: 0.18,
    whineGain: 0.1,
    rattleGain: 0.14,
    boostGain: 0.18,
    filterIdle: 400,
    filterFull: 2800,
    response: 0.05,
    wobbleHz: 2.4,
    wobbleDepth: 7,
    volume: 0.98,
  },
  loopy: {
    character: 'funny',
    baseHz: 70,
    rpmSpan: 120,
    cylinders: 2,
    propBlades: 3,
    exhaustGain: 0.16,
    propGain: 0.24,
    combustionGain: 0.15,
    whineGain: 0.14,
    rattleGain: 0.18,
    boostGain: 0.2,
    filterIdle: 500,
    filterFull: 3400,
    response: 0.04,
    wobbleHz: 3.6,
    wobbleDepth: 11,
    volume: 1.0,
  },
  falcon: {
    character: 'warProp',
    baseHz: 42,
    rpmSpan: 130,
    cylinders: 6,
    propBlades: 3,
    exhaustGain: 0.3,
    propGain: 0.22,
    combustionGain: 0.24,
    whineGain: 0.08,
    rattleGain: 0.06,
    boostGain: 0.22,
    filterIdle: 320,
    filterFull: 3400,
    response: 0.05,
    wobbleHz: 0,
    wobbleDepth: 0,
    volume: 1.08,
  },
  neon: {
    character: 'turbine',
    baseHz: 90,
    rpmSpan: 180,
    cylinders: 1,
    propBlades: 1,
    exhaustGain: 0.12,
    propGain: 0.06,
    combustionGain: 0.1,
    whineGain: 0.32,
    rattleGain: 0.02,
    boostGain: 0.28,
    filterIdle: 700,
    filterFull: 5200,
    response: 0.035,
    wobbleHz: 0,
    wobbleDepth: 0,
    volume: 1.0,
  },
};

const FALLBACK = ENGINE_PROFILES.poky;

/**
 * @param {string} planeId
 * @param {string} [tag]
 * @returns {EngineProfile}
 */
export function getEngineProfile(planeId, tag) {
  if (planeId && ENGINE_PROFILES[planeId]) return ENGINE_PROFILES[planeId];
  const char = TAG_DEFAULTS[tag] || 'light4';
  const fromChar = Object.values(ENGINE_PROFILES).find((p) => p.character === char);
  return fromChar || FALLBACK;
}

/**
 * Resolve plane id from type index or id string.
 * @param {string|number} planeIdOrIndex
 * @param {{id:string, tag?:string}[]} [planeTypes]
 */
export function resolvePlaneAudioKey(planeIdOrIndex, planeTypes) {
  if (typeof planeIdOrIndex === 'string') return planeIdOrIndex;
  if (planeTypes && Number.isFinite(planeIdOrIndex)) {
    const p = planeTypes[((planeIdOrIndex % planeTypes.length) + planeTypes.length) % planeTypes.length];
    return p?.id || 'poky';
  }
  return 'poky';
}
