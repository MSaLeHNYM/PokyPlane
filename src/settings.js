/**
 * Persistent settings — simple presets + advanced overrides.
 * Survives reloads via localStorage.
 */
import * as THREE from 'three';
import { cloneKeyBindings, DEFAULT_KEY_BINDINGS, normalizeKeyBindings } from './keybindings.js';
import { getQualityTier, normalizeQuality } from './quality.js';

const STORAGE_KEY = 'pokyplane_settings_v2';

export const DEFAULT_SETTINGS = {
  language: 'en',
  // Graphics — conservative defaults to avoid GPU-driver OS hangs
  quality: 'low',
  fpsCap: 60, // 0 = unlimited
  showFps: false,
  shadows: false,
  antialias: false,
  particles: true,
  pixelRatio: 1,
  fog: true,
  chunkDistance: 4, // legacy — migrated to viewDistanceKm
  viewDistanceKm: 1,
  // Sound
  masterVolume: 0.7,
  engineVolume: 1,
  windVolume: 1,
  sfxVolume: 1,
  musicVolume: 0.8,
  // Gameplay
  smoke: 'off',
  mouseLook: false,
  invertY: false,
  mouseSens: 0.75,
  camShake: true,
  stallAssist: false,
  difficulty: 'normal',
  defaultCam: 'chase',
  weatherCycle: true,
  dayNight: true,
  fuelLimit: false,
  airportSpawnChance: 5,
  keyBindings: cloneKeyBindings(DEFAULT_KEY_BINDINGS),
  // Announcement (host/editor can edit for local banner)
  announcement: {
    en: 'Welcome pilots! Host a match and share the link — fly together.',
    fa: 'خلبان‌ها خوش آمدید! مسابقه بسازید و لینک را بفرستید — با هم پرواز کنید.',
  },
  announcementEnabled: true,
};

const VIEW_DISTANCE_KM_OPTIONS = [0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];

function snapViewDistanceKm(km) {
  const k = clampSetting(km, 0.25, 1000, DEFAULT_SETTINGS.viewDistanceKm);
  let best = VIEW_DISTANCE_KM_OPTIONS[0];
  let bestD = Math.abs(k - best);
  for (const opt of VIEW_DISTANCE_KM_OPTIONS) {
    const d = Math.abs(k - opt);
    if (d < bestD) {
      best = opt;
      bestD = d;
    }
  }
  return best;
}

/** Legacy chunk count → km, or read viewDistanceKm directly. */
function migrateViewDistanceKm(parsed) {
  if (parsed.viewDistanceKm != null) {
    return snapViewDistanceKm(parsed.viewDistanceKm);
  }
  if (parsed.chunkDistance != null) {
    return snapViewDistanceKm((parsed.chunkDistance * 64) / 1000);
  }
  return DEFAULT_SETTINGS.viewDistanceKm;
}

export { snapViewDistanceKm };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, announcement: { ...DEFAULT_SETTINGS.announcement } };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      chunkDistance: clampSetting(parsed.chunkDistance, 4, 16, DEFAULT_SETTINGS.chunkDistance),
      viewDistanceKm: migrateViewDistanceKm(parsed),
      quality: normalizeQuality(parsed.quality),
      pixelRatio: clampSetting(parsed.pixelRatio, 1, 2, DEFAULT_SETTINGS.pixelRatio),
      shadows: !!parsed.shadows,
      keyBindings: migrateKeyBindings(parsed.keyBindings),
      announcement: { ...DEFAULT_SETTINGS.announcement, ...(parsed.announcement || {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, announcement: { ...DEFAULT_SETTINGS.announcement } };
  }
}

/** Drop Ctrl/Meta brake binds — they conflict with browser shortcuts (Ctrl+W). */
function migrateKeyBindings(raw) {
  const bindings = normalizeKeyBindings(raw);
  const brake = bindings.throttleDown;
  if (brake.some((c) => c.startsWith('Control') || c.startsWith('Meta'))) {
    bindings.throttleDown = [...DEFAULT_KEY_BINDINGS.throttleDown];
  }
  return bindings;
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** Apply renderer/world/sound/particle side-effects from settings. */
export function applyGraphics(settings, { renderer, world, particles, scene, camera }) {
  const tier = getQualityTier(normalizeQuality(settings.quality));
  const pr = Math.min(window.devicePixelRatio || 1, tier.dprCap, settings.pixelRatio || tier.dprCap);
  renderer.setPixelRatio(pr);

  const wantShadows = !!settings.shadows;
  const shadowMapSize = tier.premium ? 1024 : 512;

  if (wantShadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (world?.sun) {
      world.sun.castShadow = true;
      world.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    }
  } else {
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.BasicShadowMap;
    if (world?.sun) world.sun.castShadow = false;
  }

  world?.setShadowsEnabled?.(wantShadows);

  if (tier.toneMapping) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = tier.exposure;
  } else {
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
  }

  if (world) {
    world.setViewDistanceKm?.(settings.viewDistanceKm ?? 1);
    world.setQuality?.(settings.quality);
    world.setFogEnabled?.(settings.fog);
    world.setStripSpawnChance?.(settings.airportSpawnChance ?? 5);
    if (camera && world.getCameraFar) {
      camera.far = world.getCameraFar();
      camera.updateProjectionMatrix();
    } else if (camera && world.getClipDistance) {
      camera.far = world.getClipDistance() + 500;
      camera.updateProjectionMatrix();
    }
  }
  particles?.setQuality(settings.quality);
  if (particles) {
    particles.weather.points.visible = settings.particles && settings.quality !== 'low';
    particles.smoke.points.visible = settings.particles;
    particles.exhaust.points.visible = settings.particles;
    particles.clouds.points.visible = settings.particles;
  }
}

export function clampSetting(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function difficultyMods(diff) {
  if (diff === 'easy') {
    return {
      stallSpeed: 14,
      damageScale: 0.6,
      enemyAim: 0.7,
      startFuel: 100,
      fuelBurn: 2.2,
      fuelBoostBurn: 5.5,
    };
  }
  if (diff === 'hard') {
    return {
      stallSpeed: 24,
      damageScale: 1.4,
      enemyAim: 1.3,
      startFuel: 70,
      fuelBurn: 4.6,
      fuelBoostBurn: 11,
    };
  }
  return {
    stallSpeed: 18,
    damageScale: 1,
    enemyAim: 1,
    startFuel: 100,
    fuelBurn: 3.2,
    fuelBoostBurn: 8,
  };
}
