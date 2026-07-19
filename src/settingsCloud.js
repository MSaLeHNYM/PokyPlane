/**
 * Which settings sync to the user DB vs stay device-local.
 * Graphics stay local (every device has different GPU).
 */

import { cloneKeyBindings, normalizeKeyBindings } from './keybindings.js';
import { normalizeTouchLayout } from './touchLayout.js';

/** Never written to / read from users.settings JSONB */
export const GRAPHICS_SETTING_KEYS = [
  'quality',
  'fpsCap',
  'showFps',
  'shadows',
  'antialias',
  'particles',
  'pixelRatio',
  'fog',
  'chunkDistance',
  'viewDistanceKm',
];

/** Sound + gameplay (+ language / touch HUD) — synced when logged in */
export const SYNCED_SETTING_KEYS = [
  'language',
  'masterVolume',
  'engineVolume',
  'windVolume',
  'sfxVolume',
  'musicVolume',
  'smoke',
  'mouseLook',
  'invertY',
  'mouseSens',
  'camShake',
  'stallAssist',
  'difficulty',
  'defaultCam',
  'weatherCycle',
  'dayNight',
  'fuelLimit',
  'airportSpawnChance',
  'keyBindings',
  'touchLayout',
];

/** Preset graphics applied by auto-detect (view distance left alone). */
export const GRAPHICS_AUTO_PROFILES = {
  low: {
    quality: 'low',
    shadows: false,
    antialias: false,
    particles: true,
    pixelRatio: 1,
    fog: true,
    fpsCap: 60,
  },
  medium: {
    quality: 'medium',
    shadows: false,
    antialias: false,
    particles: true,
    pixelRatio: 1,
    fog: true,
    fpsCap: 60,
  },
  high: {
    quality: 'high',
    shadows: true,
    antialias: false,
    particles: true,
    pixelRatio: 1.25,
    fog: true,
    fpsCap: 60,
  },
  max: {
    quality: 'max',
    shadows: true,
    antialias: true,
    particles: true,
    pixelRatio: 1.5,
    fog: true,
    fpsCap: 60,
  },
};

export function pickSyncedSettings(settings) {
  const out = {};
  for (const key of SYNCED_SETTING_KEYS) {
    if (key === 'keyBindings') {
      out.keyBindings = cloneKeyBindings(settings.keyBindings);
    } else if (key === 'touchLayout') {
      out.touchLayout = normalizeTouchLayout(settings.touchLayout);
    } else if (settings[key] !== undefined) {
      out[key] = settings[key];
    }
  }
  return out;
}

/** Build PATCH payload: keep unknown cloud keys, drop graphics, upsert synced. */
export function buildCloudSettingsPayload(settings, prevCloud = {}) {
  const base =
    prevCloud && typeof prevCloud === 'object' && !Array.isArray(prevCloud)
      ? { ...prevCloud }
      : {};
  for (const key of GRAPHICS_SETTING_KEYS) {
    delete base[key];
  }
  Object.assign(base, pickSyncedSettings(settings));
  return base;
}

/**
 * Merge cloud prefs into local settings without touching graphics.
 * Returns true if local settings changed.
 */
export function mergeCloudSettingsIntoLocal(settings, cloud) {
  if (!cloud || typeof cloud !== 'object') return false;
  let changed = false;

  for (const key of SYNCED_SETTING_KEYS) {
    if (!(key in cloud) || cloud[key] === undefined) continue;

    if (key === 'keyBindings') {
      const next = normalizeKeyBindings(cloud.keyBindings);
      settings.keyBindings = next;
      changed = true;
      continue;
    }
    if (key === 'touchLayout') {
      const next = normalizeTouchLayout(cloud.touchLayout);
      if (JSON.stringify(settings.touchLayout) !== JSON.stringify(next)) {
        settings.touchLayout = next;
        changed = true;
      }
      continue;
    }
    if (settings[key] !== cloud[key]) {
      settings[key] = cloud[key];
      changed = true;
    }
  }
  return changed;
}

export function snapshotGraphicsSettings(settings) {
  const snap = {};
  for (const key of GRAPHICS_SETTING_KEYS) {
    snap[key] = settings[key];
  }
  return snap;
}

export function applyGraphicsProfile(settings, quality) {
  const profile = GRAPHICS_AUTO_PROFILES[quality] || GRAPHICS_AUTO_PROFILES.low;
  Object.assign(settings, profile);
}
