/**
 * Persistent settings — simple presets + advanced overrides.
 * Survives reloads via localStorage.
 */
const STORAGE_KEY = 'pokyplane_settings_v2';

export const DEFAULT_SETTINGS = {
  language: 'en',
  // Graphics
  quality: 'medium',
  fpsCap: 60, // 0 = unlimited
  showFps: false,
  shadows: true,
  antialias: true,
  particles: true,
  pixelRatio: 1.5,
  fog: true,
  chunkDistance: 4, // Minecraft-style render distance (chunks radius)
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
  // Announcement (host/editor can edit for local banner)
  announcement: {
    en: 'Welcome pilots! Host a match and share the link — fly together.',
    fa: 'خلبان‌ها خوش آمدید! مسابقه بسازید و لینک را بفرستید — با هم پرواز کنید.',
  },
  announcementEnabled: true,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, announcement: { ...DEFAULT_SETTINGS.announcement } };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      announcement: { ...DEFAULT_SETTINGS.announcement, ...(parsed.announcement || {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, announcement: { ...DEFAULT_SETTINGS.announcement } };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** Apply renderer/world/sound/particle side-effects from settings. */
export function applyGraphics(settings, { renderer, world, particles, scene }) {
  const pr = Math.min(
    window.devicePixelRatio,
    settings.quality === 'low' ? 1 : settings.quality === 'high' ? Math.min(2, settings.pixelRatio) : settings.pixelRatio
  );
  renderer.setPixelRatio(pr);
  renderer.shadowMap.enabled = !!settings.shadows && settings.quality !== 'low';
  if (world?.sun) world.sun.castShadow = renderer.shadowMap.enabled;
  if (scene?.fog) scene.fog.density = settings.fog ? (scene.fog.density || 0.0018) : 0;
  if (!settings.fog && scene) scene.fog = null;
  else if (settings.fog && scene && !scene.fog) {
    const THREE = window.__THREE_FOG__;
    // fog restored by world.update if present
  }
  if (world) {
    if (typeof settings.chunkDistance === 'number') {
      world.setViewRadius?.(settings.chunkDistance);
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
