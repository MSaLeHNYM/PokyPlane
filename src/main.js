/**
 * PokyPlane — main entry: scene, i18n, settings, matchmaking, loop.
 */
import * as THREE from 'three';
import { createPlane, updatePlaneVisuals, applyPlaneStats, PLANE_TYPES, getPlaneType, getPlaneHitRadius } from './plane.js';
import { SoundEngine } from './sound.js';
import { ParticleSystem } from './particles.js';
import { World } from './terrain.js';
import { FlightModel } from './physics.js';
import { Input } from './controls.js';
import { CameraManager } from './camera.js';
import { HUD } from './hud.js';
import { RingCourse, CombatWave, Storage } from './modes.js';
import { t, setLang, getLang, applyDomLang } from './i18n.js';
import {
  loadSettings,
  saveSettings,
  applyGraphics,
  difficultyMods,
  DEFAULT_SETTINGS,
  clampSetting,
  snapViewDistanceKm,
} from './settings.js';
import { Matchmaking, getRoomFromUrl, clearRoomFromUrl } from './matchmaking.js';
import { MpHub } from './mpHub.js';
import { WeaponSystem, WEAPON_ORDER, WEAPON_DEFS, DEFAULT_WEAPON_FLAGS, isExplosiveWeapon } from './weapons.js';
import { FuelPickups } from './fuel.js';
import { setupAuthUI, isLoggedIn, getUser, openAuthModal } from './authUi.js';
import { onAuthChanged, fetchAnnouncement, submitScore, updateProfile } from './api.js';
import {
  setupInboxUI,
  openInboxScreen,
  closeInboxScreen,
  setInboxJoinLobbyHandler,
  setInviteRoomContext,
} from './inboxUi.js';
import { makeNameTag, setNameTagText, disposeNameTag } from './nameTag.js';
import { startPresenceLoop, stopPresenceLoop } from './presence.js';
import { MAPS, getMap, getMapWind, mapLabel } from './maps.js';
import { randomWorldSeed } from './noise.js';
import { pickSpawnAirport, runwaySpawnPose } from './airports.js';
import {
  DEFAULT_KEY_BINDINGS,
  cloneKeyBindings,
  formatBinding,
  normalizeKeyBindings,
} from './keybindings.js';
import { TargetLockSystem, buildThreatMarkers, findAimAssistTarget } from './targeting.js';
import { normalizeQuality, QUALITY_LEVELS } from './quality.js';
import {
  registerServiceWorker,
  bindInstallPrompt,
  applyPwaGate,
  isPwaGateActive,
  forceLandscape,
  promptPwaInstall,
  canPlayGame,
  isTouchMobile,
} from './pwaGate.js';
import { setupPushNotifications } from './pushNotify.js';
import {
  applyTouchLayout,
  startTouchLayoutEditor,
  stopTouchLayoutEditor,
  resetTouchLayoutDraft,
  isTouchLayoutEditing,
} from './touchLayout.js';
import {
  buildCloudSettingsPayload,
  mergeCloudSettingsIntoLocal,
  snapshotGraphicsSettings,
  applyGraphicsProfile,
  SYNCED_SETTING_KEYS,
} from './settingsCloud.js';

// ----- Settings & audio -----
let settings = loadSettings();

const canvas = document.getElementById('game-canvas');
const launchMax = normalizeQuality(settings.quality) === 'max';
// Prefer discrete / high-perf GPU (incl. mobile Adreno/Mali) — low-power often sticks to weak iGPU.
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: launchMax,
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: false,
});
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2500);

const sound = new SoundEngine();
sound.setPlaneTypes(PLANE_TYPES);
const match = new Matchmaking();
const mpHub = new MpHub(match);
const input = new Input();
const hud = new HUD();
const camRig = new CameraManager(camera);
let weapons = null;

let selectedMapId = localStorage.getItem('pokyplane_map') || 'meadow';
/** Session world seed — regenerated each flight (synced via MP lobby). */
let sessionWorldSeed = randomWorldSeed();
let mpLobby = {
  mapId: selectedMapId,
  worldSeed: sessionWorldSeed,
  mode: 'dogfight',
  difficulty: 'normal',
  maxPlayers: 2,
  matchDurationMin: 2,
  weapons: true,
  weaponFlags: { ...DEFAULT_WEAPON_FLAGS },
  fuelLimit: false,
  weatherCycle: true,
  dayNight: true,
  airportSpawnChance: 5,
  enabledPlanes: PLANE_TYPES.map(() => true),
  spawnAirportId: 'main',
};

const MP_DURATION_OPTIONS = [1, 2, 3, 5, 10];

function clampMatchDurationMin(v) {
  const n = Math.round(Number(v));
  return MP_DURATION_OPTIONS.includes(n) ? n : 2;
}

function isMpDogfight() {
  return gameMode === 'multiplayer' && (mpLobby.mode || 'dogfight') !== 'freefly';
}

function syncWorldSeedUi(seed = sessionWorldSeed) {
  const el = document.getElementById('menu-world-seed');
  if (el) el.textContent = String(seed >>> 0);
}

function defaultEnabledPlanes() {
  return PLANE_TYPES.map(() => true);
}

function clampAirportChance(v) {
  return clampSetting(v, 0, 100, 5);
}

function clampViewDistanceKm(v) {
  return snapViewDistanceKm(Number(v));
}

function clampMaxPlayers(v) {
  return Math.round(clampSetting(v, 2, 8, 2));
}

function resolveSpawn(world, opts = {}) {
  const role = opts.role || 'host';
  const chance = clampAirportChance(opts.randomChance ?? settings.airportSpawnChance ?? 5);
  let ap = opts.airportId ? world.airports.find((a) => a.id === opts.airportId) : null;
  if (!ap) {
    ap = pickSpawnAirport(world.airports, chance);
  }
  const pose = runwaySpawnPose(ap, role);
  const y = world.getHeight(pose.x, pose.z);
  return {
    x: pose.x,
    z: pose.z,
    y,
    heading: pose.heading,
    pitch: 0,
    roll: 0,
    airport: ap,
    random: !ap.primary,
    airportId: ap.id,
  };
}

function firstEnabledPlaneIndex(enabled = defaultEnabledPlanes()) {
  const idx = enabled.findIndex(Boolean);
  return idx >= 0 ? idx : 0;
}

function normalizePlaneForLobby(idx, enabled = defaultEnabledPlanes()) {
  if (enabled[idx]) return idx;
  return firstEnabledPlaneIndex(enabled);
}

let world = null;
let particles = null;
let flight = new FlightModel();
let planeGroup = null;
let planeParts = null;
let menuPlane = null;
let menuParts = null;
let remotePlane = null;
let remoteParts = null;
let remoteNameTag = null;
let remoteInterp = {
  pos: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  targetPos: new THREE.Vector3(),
  targetQuat: new THREE.Quaternion(),
  health: 100,
  throttle: 0.5,
  skin: 0,
  _gotState: false,
};
let localMpName = 'Pilot';
let mpPeerName = '';
let mpPeerDevice = ''; // 'pc' | 'mobile'
let mpGuestConnected = false;
let mpEditingSettings = false;
/** Room to join after login (invite link / join blocked by auth). */
let pendingMpRoom = null;
let mpKills = 0;
let mpDeaths = 0;
let mpPeerKills = 0;
let mpMatchTimeLeft = null;
let mpMatchEnded = false;
let mpLocalVote = null; // 'replay' | 'leave'
let mpRemoteVote = null;
let mpDying = false;
let mpRespawnTimer = null;
/** Ignore spam `died` events from peer until this time (ms, performance.now). */
let mpPeerDiedIgnoreUntil = 0;
const mpChatHistory = [];
const MP_CHAT_MAX = 40;

const _aimOrigin = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _aimWorld = new THREE.Vector3();
const _aimSmooth = new THREE.Vector3();
const _aimProj = new THREE.Vector3();
const targetLock = new TargetLockSystem();
let _prevLockId = null;
let _aimSmoothReady = false;
let _assistStickyId = null;
let _assistStickyKind = null;
let _lockHeldActive = false;

let state = 'menu';
let gameMode = 'freeroam';
let planeTypeIndex = Number(localStorage.getItem('pokyplane_plane') || 0);
/** @deprecated alias for multiplayer sync */
let skinIndex = planeTypeIndex;
let weather = 'clear';
let weatherTimer = 0;
let race = null;
let combat = null;
let fuelDrops = null;
let gunCooldown = 0;
let flightTime = 0;
let settingsView = 'simple';
let settingsTab = 'graphics';
let bannerDismissed = sessionStorage.getItem('pokyplane_banner_dismissed') === '1';
/** Server-managed banner; null = use local settings fallback. */
let serverAnnouncement = null;
let fpsAccum = 0;
let fpsFrames = 0;
let fpsValue = 60;
let lastFrameTime = performance.now();
let frameBudget = 0;

// UI refs
const menuEl = document.getElementById('menu');
const optionsEl = document.getElementById('options');
const pauseEl = document.getElementById('pause');
const resultsEl = document.getElementById('results');
const mpEl = document.getElementById('multiplayer');
const inboxEl = document.getElementById('inbox');
const fpsEl = document.getElementById('fps-counter');
const announceEl = document.getElementById('announce-banner');
const announceText = document.getElementById('announce-text');

function syncWorldVisibility() {
  if (!world?.group) return;
  world.group.visible = state === 'playing' || state === 'paused';
  input.setGameActive(state === 'playing' || state === 'paused');
}

function syncTouchUi() {
  if (isTouchLayoutEditing()) {
    input.setTouchVisible(true);
    syncOrientationLock();
    return;
  }
  input.setTouchVisible(state === 'playing');
  syncOrientationLock();
}

function isPortrait() {
  return window.matchMedia('(orientation: portrait)').matches;
}

function syncOrientationLock() {
  if (!input.isTouchUi || isPwaGateActive()) {
    document.body.classList.remove('force-landscape', 'portrait-locked', 'menu-portrait-ok');
    document.getElementById('rotate-lock')?.classList.add('hidden');
    return;
  }

  // Entire game (including menu) is landscape-only on mobile / PWA.
  document.body.classList.add('force-landscape');
  document.body.classList.remove('menu-portrait-ok');

  const portrait = isPortrait();
  document.body.classList.toggle('portrait-locked', portrait);
  // Never prompt to rotate — CSS + Orientation API handle it.
  document.getElementById('rotate-lock')?.classList.add('hidden');

  forceLandscape();
}

function syncNavBack() {
  const btn = document.getElementById('nav-back');
  if (!btn) return;
  const onOptions = !optionsEl?.classList.contains('hidden');
  const onMp = !mpEl?.classList.contains('hidden');
  const onPause = !pauseEl?.classList.contains('hidden');
  const onResults = !resultsEl?.classList.contains('hidden');
  const onInbox = !inboxEl?.classList.contains('hidden');
  const hostModal = !document.getElementById('mp-host-modal')?.classList.contains('hidden');
  const inviteModal = !document.getElementById('mp-invite-friend-modal')?.classList.contains('hidden');
  const visible =
    input.isTouchUi &&
    (onOptions || onMp || onPause || onResults || onInbox || hostModal || inviteModal) &&
    state !== 'playing';
  btn.classList.toggle('hidden', !visible);
}

function navigateBack() {
  if (isTouchLayoutEditing()) {
    finishTouchLayoutEditor(false);
    return;
  }
  const inviteModal = document.getElementById('mp-invite-friend-modal');
  if (inviteModal && !inviteModal.classList.contains('hidden')) {
    inviteModal.classList.add('hidden');
    syncNavBack();
    return;
  }
  const hostModal = document.getElementById('mp-host-modal');
  if (hostModal && !hostModal.classList.contains('hidden')) {
    closeHostModal();
    syncNavBack();
    return;
  }
  if (!inboxEl?.classList.contains('hidden')) {
    showScreen('menu');
    return;
  }
  if (!optionsEl?.classList.contains('hidden')) {
    showScreen(state === 'paused' ? 'pause' : 'menu');
    return;
  }
  if (!mpEl?.classList.contains('hidden')) {
    showScreen('menu');
    return;
  }
  if (!pauseEl?.classList.contains('hidden')) {
    state = 'playing';
    showScreen('none');
    return;
  }
  if (!resultsEl?.classList.contains('hidden')) {
    quitToMenu();
    return;
  }
  if (state === 'playing') {
    state = 'paused';
    showScreen('pause');
    return;
  }
  showScreen('menu');
}

function showScreen(id) {
  [menuEl, optionsEl, pauseEl, resultsEl, mpEl, inboxEl].forEach((el) => el?.classList.add('hidden'));
  if (id === 'menu') menuEl?.classList.remove('hidden');
  if (id === 'options') optionsEl?.classList.remove('hidden');
  if (id === 'pause') {
    pauseEl?.classList.remove('hidden');
    const endBtn = document.getElementById('mp-end-match-btn');
    const showEnd =
      match.role === 'host' &&
      gameMode === 'multiplayer' &&
      !mpMatchEnded &&
      (state === 'paused' || state === 'playing');
    endBtn?.classList.toggle('hidden', !showEnd);
  }
  if (id === 'results') resultsEl?.classList.remove('hidden');
  if (id === 'multiplayer') mpEl?.classList.remove('hidden');
  if (id === 'inbox') {
    inboxEl?.classList.remove('hidden');
    openInboxScreen();
  } else {
    closeInboxScreen();
  }
  syncWorldVisibility();
  syncTouchUi();
  syncOrientationLock();
  syncNavBack();

  // History stack so Android back uses in-app navigation
  if (id && id !== 'none') {
    try {
      const cur = history.state?.screen;
      if (cur !== id) history.pushState({ screen: id, gameState: state }, '');
    } catch {
      /* */
    }
  }
}

async function unlockAudio() {
  await sound.resume();
  sound.setMix({
    master: settings.masterVolume,
    engine: settings.engineVolume,
    wind: settings.windVolume,
    sfx: settings.sfxVolume,
    music: settings.musicVolume,
  });
}

function updateBanner() {
  if (!announceEl) return;
  const src = serverAnnouncement ?? {
    enabled: settings.announcementEnabled,
    en: settings.announcement?.en || '',
    fa: settings.announcement?.fa || '',
  };
  const lang = getLang();
  const text = String(src[lang] || src.en || src.fa || '')
    .replace(/\s+/g, ' ')
    .trim();
  const on = !!src.enabled && !bannerDismissed && !!text;
  announceEl.classList.toggle('hidden', !on);
  if (announceText) announceText.textContent = text;
}

async function loadServerAnnouncement() {
  try {
    serverAnnouncement = await fetchAnnouncement();
  } catch {
    serverAnnouncement = null;
  }
  updateBanner();
}

function syncLangButtons() {
  document.querySelectorAll('.lang-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === getLang());
  });
}

function buildMenuPlane() {
  if (menuPlane) scene.remove(menuPlane);
  const built = createPlane(planeTypeIndex);
  menuPlane = built.group;
  menuParts = built.parts;
  menuPlane.position.set(0, 1.15, 0);
  menuPlane.scale.setScalar(1.45);
  scene.add(menuPlane);
}

function destroyWorld() {
  world?.disableStreaming?.();
  world?.dispose?.();
  world = null;
}

function ensureWorld(mapId = selectedMapId, worldSeed = null) {
  const seed =
    worldSeed != null
      ? worldSeed >>> 0
      : sessionWorldSeed != null
        ? sessionWorldSeed >>> 0
        : randomWorldSeed();
  sessionWorldSeed = seed;
  if (!weapons) weapons = new WeaponSystem(scene);
  if (!world) {
    world = new World(scene, settings.quality, mapId, seed);
    particles = new ParticleSystem(scene);
  } else if (world.mapId !== mapId || world.worldSeed !== seed) {
    world.rebuild(mapId, settings.quality, seed);
  }
  selectedMapId = mapId;
  localStorage.setItem('pokyplane_map', mapId);
  syncWorldSeedUi(seed);
  applySettingsEffects();
}

function applySettingsEffects() {
  applyGraphics(settings, { renderer, world, particles, scene, camera });
  input.setKeyBindings(settings.keyBindings);
  particles?.setSmoke(settings.smoke);
  sound.setMix({
    master: settings.masterVolume,
    engine: settings.engineVolume,
    wind: settings.windVolume,
    sfx: settings.sfxVolume,
    music: settings.musicVolume,
  });
  input.setMouseLook(settings.mouseLook);
  fpsEl?.classList.toggle('hidden', !settings.showFps);
  const mods = difficultyMods(settings.difficulty);
  if (flight) {
    const sens = 0.65 + (settings.mouseSens || 1) * 0.35;
    applyPlaneStats(flight, planeTypeIndex, sens, {
      stallAssist: settings.stallAssist,
      stallMod: mods.stallSpeed,
    });
  }
  updateBanner();
  syncShadowCasters();
  applyTouchLayout(settings.touchLayout);
}

async function persistSyncedSettingsToCloud() {
  if (!isLoggedIn()) return;
  const user = getUser();
  const prev = user?.settings && typeof user.settings === 'object' ? user.settings : {};
  try {
    await updateProfile({
      settings: buildCloudSettingsPayload(settings, prev),
    });
  } catch (err) {
    console.warn('[settings] cloud sync failed', err);
  }
}

/** @deprecated alias — touch layout save uses full synced payload */
const persistTouchLayoutToCloud = persistSyncedSettingsToCloud;

function cloudHasSyncedPrefs(cloud) {
  if (!cloud || typeof cloud !== 'object') return false;
  return SYNCED_SETTING_KEYS.some((k) => cloud[k] !== undefined && cloud[k] !== null);
}

function mergeCloudUserSettings(user) {
  if (!user) return;
  const cloud = user.settings;

  if (cloudHasSyncedPrefs(cloud)) {
    if (mergeCloudSettingsIntoLocal(settings, cloud)) {
      saveSettings(settings);
      setLang(settings.language);
      syncLangButtons();
      applySettingsEffects();
      fillSettingsForm();
    }
    return;
  }

  // First time on this account: upload local sound / gameplay / touch layout
  persistSyncedSettingsToCloud();
}

let graphicsDetectRunning = false;

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sample smoothed game loop FPS (main loop fpsValue). Cap must be 0 while sampling. */
async function sampleLoopFps(durationMs = 1800) {
  const samples = [];
  const end = performance.now() + durationMs;
  // Reset accumulator so first reading is fresh
  fpsAccum = 0;
  fpsFrames = 0;
  while (performance.now() < end) {
    await sleepMs(520);
    if (fpsValue > 0) samples.push(fpsValue);
  }
  if (!samples.length) return 0;
  samples.sort((a, b) => a - b);
  // Use median — more stable than average for short windows
  return samples[Math.floor(samples.length / 2)];
}

async function autoDetectBestGraphics() {
  if (graphicsDetectRunning) return;
  graphicsDetectRunning = true;
  hud.toast(t('graphicsDetecting'));

  const backup = snapshotGraphicsSettings(settings);
  const showFpsWas = settings.showFps;
  let best = 'low';
  let bestFps = 0;

  try {
    // Heavier load than idle menu (terrain in view)
    ensureWorld(selectedMapId || 'meadow', sessionWorldSeed);
    const wasVisible = !!world?.group?.visible;
    if (world?.group) world.group.visible = true;

    settings.showFps = true;
    fpsEl?.classList.remove('hidden');

    const detectBtns = document.querySelectorAll('[data-action="graphics-autodetect"]');
    detectBtns.forEach((b) => {
      b.disabled = true;
      b.textContent = t('graphicsDetecting');
    });

    for (const quality of QUALITY_LEVELS) {
      applyGraphicsProfile(settings, quality);
      settings.fpsCap = 0; // uncapped so we can see if device can hold 60+
      applySettingsEffects();
      await sleepMs(400); // settle GPU/state
      const fps = await sampleLoopFps(1600);
      if (fps >= 55) {
        best = quality;
        bestFps = fps;
      } else {
        // Ascending ladder — stop once we drop under target
        if (!bestFps) {
          best = 'low';
          bestFps = fps;
        }
        break;
      }
    }

    applyGraphicsProfile(settings, best);
    settings.fpsCap = 60;
    settings.showFps = showFpsWas;
    applySettingsEffects();
    saveSettings(settings); // graphics are device-local only
    fillSettingsForm();
    if (world?.group) world.group.visible = wasVisible || state === 'playing' || state === 'paused';
    syncWorldVisibility();
    hud.toast(`${t('graphicsDetectDone')}: ${best.toUpperCase()} (~${Math.round(bestFps)} FPS)`);
  } catch (err) {
    console.warn('[graphics] auto-detect failed', err);
    Object.assign(settings, backup);
    settings.showFps = showFpsWas;
    applySettingsEffects();
    fillSettingsForm();
    hud.toast(t('graphicsDetectFail'));
  } finally {
    graphicsDetectRunning = false;
    document.querySelectorAll('[data-action="graphics-autodetect"]').forEach((b) => {
      b.disabled = false;
      b.setAttribute('data-i18n', 'graphicsAutoDetect');
      b.textContent = t('graphicsAutoDetect');
    });
    applyDomLang();
  }
}

let touchLayoutReturnScreen = 'menu';

function openTouchLayoutEditor() {
  if (!input.isTouchUi) return;
  touchLayoutReturnScreen = state === 'paused' ? 'pause' : state === 'playing' ? 'none' : 'options';
  if (state === 'playing') {
    state = 'paused';
  }
  // Hide overlays; show stick/buttons for editing
  [menuEl, optionsEl, pauseEl, resultsEl, mpEl].forEach((el) => el?.classList.add('hidden'));
  document.getElementById('mp-host-modal')?.classList.add('hidden');
  input.setGameActive(false);
  input.setTouchVisible(true);
  startTouchLayoutEditor(settings.touchLayout, (draft) => {
    /* live preview already applied inside editor */
    void draft;
  });
  applyDomLang();
  syncNavBack();
}

function finishTouchLayoutEditor(save) {
  if (!isTouchLayoutEditing()) return;
  if (save) {
    settings.touchLayout = stopTouchLayoutEditor({ useCssDefaults: false });
    saveSettings(settings);
    applyTouchLayout(settings.touchLayout);
    persistTouchLayoutToCloud();
    hud.toast(t('touchLayoutSaved'));
  } else {
    stopTouchLayoutEditor({ useCssDefaults: true });
    applyTouchLayout(settings.touchLayout);
  }
  if (touchLayoutReturnScreen === 'none') {
    state = 'playing';
    showScreen('none');
  } else if (touchLayoutReturnScreen === 'pause') {
    state = 'paused';
    showScreen('pause');
  } else if (touchLayoutReturnScreen === 'options') {
    showScreen('options');
  } else {
    showScreen('menu');
  }
}

function syncShadowCasters() {
  const wantShadows = !!settings.shadows;
  world?.setShadowsEnabled?.(wantShadows);
  if (planeGroup) {
    planeGroup.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = wantShadows;
        o.receiveShadow = wantShadows;
      }
    });
  }
}

function spawnPlayerPlane() {
  if (planeGroup) scene.remove(planeGroup);
  const built = createPlane(planeTypeIndex);
  planeGroup = built.group;
  planeParts = built.parts;
  scene.add(planeGroup);
  syncShadowCasters();
}

function spawnRemotePlane(skin = 1, seedPos = null) {
  if (remotePlane) {
    disposeNameTag(remoteNameTag);
    remoteNameTag = null;
    scene.remove(remotePlane);
  }
  const built = createPlane(skin);
  remotePlane = built.group;
  remoteParts = built.parts;
  const p = seedPos || { x: 24, y: 28, z: -24 };
  remotePlane.position.set(p.x, p.y, p.z);
  remoteInterp.pos.set(p.x, p.y, p.z);
  remoteInterp.targetPos.set(p.x, p.y, p.z);
  remoteNameTag = makeNameTag(formatMpName(mpPeerName || t('mpGuest'), mpPeerDevice));
  remotePlane.add(remoteNameTag);
  scene.add(remotePlane);
}

function clearRemotePlane() {
  if (remotePlane) {
    disposeNameTag(remoteNameTag);
    remoteNameTag = null;
    scene.remove(remotePlane);
    remotePlane = null;
    remoteParts = null;
  }
  sound.removeRemoteEngine('peer');
  remoteInterp._gotState = false;
  remoteInterp.health = 100;
}

function refreshRemoteNameTag() {
  if (!remoteNameTag || !mpPeerName) return;
  setNameTagText(remoteNameTag, formatMpName(mpPeerName, mpPeerDevice));
}

function clearModes() {
  race?.dispose();
  race = null;
  combat?.dispose();
  combat = null;
  fuelDrops?.clear();
  targetLock.clear();
  _prevLockId = null;
  _aimSmoothReady = false;
  _assistStickyId = null;
  _assistStickyKind = null;
  _lockHeldActive = false;
}

function startGame(mode, mapOverride = null) {
  if (!canPlayGame()) {
    applyPwaGate();
    return;
  }
  const mapId = mapOverride || selectedMapId || document.getElementById('menu-map')?.value || 'meadow';

  // New random world each solo flight; MP uses lobby seed (host generates once).
  if (mode === 'multiplayer') {
    if (mpLobby.worldSeed == null) {
      mpLobby.worldSeed = randomWorldSeed();
    }
    sessionWorldSeed = mpLobby.worldSeed >>> 0;
  } else {
    sessionWorldSeed = randomWorldSeed();
  }

  ensureWorld(mapId, sessionWorldSeed);
  world?.setTimeOfDay(0.22);
  clearModes();
  hud.toast(`${t('worldSeed')}: ${sessionWorldSeed}`, 2200);
  weapons?.clear();
  gameMode = mode;
  state = 'playing';
  flightTime = 0;
  weather = 'clear';
  weatherTimer = 20 + Math.random() * 40;

  if (menuPlane) {
    scene.remove(menuPlane);
    menuPlane = null;
  }
  scene.background = null;

  flight = new FlightModel();
  flight.worldBound = world.worldBound;
  const mods = difficultyMods(
    mode === 'multiplayer' ? mpLobby.difficulty : settings.difficulty
  );
  const enabledPlanes =
    mode === 'multiplayer' ? mpLobby.enabledPlanes || defaultEnabledPlanes() : defaultEnabledPlanes();
  planeTypeIndex = normalizePlaneForLobby(planeTypeIndex, enabledPlanes);
  skinIndex = planeTypeIndex;
  localStorage.setItem('pokyplane_plane', String(planeTypeIndex));

  const sens = 0.65 + (settings.mouseSens || 0.75) * 0.35;
  applyPlaneStats(flight, planeTypeIndex, sens, {
    stallAssist: settings.stallAssist,
    stallMod: mods.stallSpeed,
  });

  const useFuel =
    mode === 'multiplayer' ? !!mpLobby.fuelLimit : !!settings.fuelLimit;
  const diffKey = mode === 'multiplayer' ? mpLobby.difficulty : settings.difficulty;
  flight.fuelLimit = useFuel;
  flight.fuelBurn = mods.fuelBurn ?? 3.2;
  flight.fuelBoostBurn = mods.fuelBoostBurn ?? 8;
  flight.fuelMax = 100;
  flight.fuel = useFuel ? mods.startFuel ?? 100 : 100;

  const spawnRole = mode === 'multiplayer' && match.role === 'guest' ? 'guest' : 'host';
  const spawnChance =
    mode === 'multiplayer' ? mpLobby.airportSpawnChance : settings.airportSpawnChance;
  const spawnInfo = resolveSpawn(world, {
    role: spawnRole,
    randomChance: spawnChance,
    airportId: mode === 'multiplayer' ? mpLobby.spawnAirportId : undefined,
  });
  if (mode === 'multiplayer' && match.role === 'host' && !mpLobby.spawnAirportId) {
    mpLobby.spawnAirportId = spawnInfo.airportId;
  }

  world?.enableStreaming?.(spawnInfo.x, spawnInfo.z);

  flight.reset({
    x: spawnInfo.x,
    y: spawnInfo.y + flight.gearHeight,
    z: spawnInfo.z,
    heading: spawnInfo.heading,
    pitch: spawnInfo.pitch,
    roll: spawnInfo.roll,
  });
  if (useFuel) flight.fuel = mods.startFuel ?? 100;

  if (spawnInfo.random) {
    const lang = getLang();
    const name = spawnInfo.airport?.name?.[lang] || spawnInfo.airport?.name?.en || t('airport');
    hud.toast(`${t('spawnedAtAirport')}: ${name}`);
  }

  if (!fuelDrops) fuelDrops = new FuelPickups(scene);
  fuelDrops.setEnabled(useFuel, diffKey);
  spawnPlayerPlane();
  camRig.setPreset(settings.defaultCam === 'cockpit' ? 'cockpit' : 'chase');
  camRig.snapTo(flight);

  if (mode === 'multiplayer') {
    const seed = MpHub.seedRemotePose(
      { x: spawnInfo.x, y: spawnInfo.y + 10, z: spawnInfo.z },
      match.role
    );
    spawnRemotePlane(remoteInterp.skin, seed);
    document.getElementById('hud-mp')?.classList.remove('hidden');
    mpHub.markLocalReady();
  } else {
    clearRemotePlane();
    document.getElementById('hud-mp')?.classList.add('hidden');
  }

  showScreen('none');
  syncWorldVisibility();
  syncOrientationLock();
  forceLandscape();
  hud.show(true);
  sound.stopAmbient();
  const planeType = getPlaneType(planeTypeIndex);
  sound.startEngine(planeType?.id || planeTypeIndex, planeType?.tag);
  sound.startWind();
  sound.setMusicState(mode === 'combat' ? 'combat' : 'flight');
  particles.setSmoke(settings.smoke);

  startPresenceLoop(() => ({
    status: 'playing',
    gameMode,
    mapId: world?.mapId,
  }));

  // Weapon loadout — all 4 in solo; host flags in MP
  if (weapons) {
    if (mode === 'multiplayer') {
      weapons.setEnabled(mpLobby.weaponFlags || DEFAULT_WEAPON_FLAGS);
    } else if (mode === 'race') {
      weapons.setEnabled({ mg: false, cannon: false, rocket: false, missile: false });
    } else {
      weapons.setEnabled(DEFAULT_WEAPON_FLAGS);
    }
  }

  if (mode === 'race') {
    race = new RingCourse(scene, 12);
    hud.toast(t('raceToast'));
  } else if (mode === 'combat') {
    combat = new CombatWave(scene, createPlane);
    hud.toast(t('combatToast'));
  } else if (mode === 'multiplayer') {
    hud.toast(t('mpToast'));
  } else {
    hud.toast(`${t('freeRoamToast')} · A/D=turn · Shift=speed · X=slow · S=takeoff`);
  }
}

function endGame(title, body) {
  state = 'results';
  world?.disableStreaming?.();
  sound.setStall(false);
  sound.stopEngine();
  sound.stopWind();
  sound.clearRemoteEngines();
  const win =
    /win|clear|course/i.test(String(title)) ||
    title === t('youWin') ||
    title === t('courseClear');
  sound.setMusicState(win ? 'victory' : 'defeat');
  stopPresenceLoop();

  const scoreVal =
    gameMode === 'race' && race
      ? race.score
      : gameMode === 'combat' && combat
        ? combat.score
        : gameMode === 'multiplayer'
          ? mpKills
          : Math.floor(flightTime);

  if (isLoggedIn()) {
    submitScore({
      mode: gameMode,
      score: scoreVal,
      mapId: world?.mapId,
      flightTimeSec: flightTime,
    }).catch(() => {});
  }

  document.getElementById('results-title').textContent = title;
  document.getElementById('results-body').textContent = body;
  document.getElementById('results-solo-actions')?.classList.remove('hidden');
  document.getElementById('results-mp-actions')?.classList.add('hidden');
  showScreen('results');
  hud.show(false);
}

function updateMpVoteUi() {
  const el = document.getElementById('results-vote-status');
  if (!el) return;
  const lines = [];
  if (mpLocalVote === 'replay') lines.push(t('voteYouReplay'));
  else if (mpLocalVote === 'leave') lines.push(t('voteYouLeave'));
  else lines.push(t('voteWaiting'));
  if (mpRemoteVote === 'replay') lines.push(t('votePeerReplay'));
  else if (mpRemoteVote === 'leave') lines.push(t('votePeerLeave'));
  el.textContent = lines.join(' · ');
}

/** Multiplayer results — keep PeerJS link for rematch votes. */
function endMpMatch(reason = 'time', opts = {}) {
  if (mpMatchEnded) return;
  mpMatchEnded = true;
  clearMpRespawnTimer();
  mpDying = false;
  state = 'results';
  world?.disableStreaming?.();
  sound.setStall(false);
  sound.stopEngine();
  sound.stopWind();
  // Keep remote engine drones quiet until rematch
  sound.clearRemoteEngines();

  if (opts.peerKills != null) mpPeerKills = opts.peerKills;

  const youWin = mpKills > mpPeerKills;
  const draw = mpKills === mpPeerKills;
  const title = draw ? t('mpDraw') : youWin ? t('youWin') : t('youLose');
  sound.setMusicState(youWin || draw ? 'victory' : 'defeat');

  const reasonText =
    reason === 'host'
      ? t('matchHostEnded')
      : reason === 'time'
        ? t('matchTimeUp')
        : reason === 'peer-left'
          ? t('peerLeft')
          : '';

  const body = [
    `${t('mpKills')}: ${mpKills}`,
    `${t('mpTheirKills')}: ${mpPeerKills}`,
    reasonText,
  ]
    .filter(Boolean)
    .join('\n');

  if (isLoggedIn()) {
    submitScore({
      mode: 'multiplayer',
      score: mpKills,
      mapId: world?.mapId,
      flightTimeSec: flightTime,
    }).catch(() => {});
  }

  mpLocalVote = null;
  mpRemoteVote = null;
  document.getElementById('results-title').textContent = title;
  document.getElementById('results-body').textContent = body;
  document.getElementById('results-solo-actions')?.classList.add('hidden');
  document.getElementById('results-mp-actions')?.classList.remove('hidden');
  updateMpVoteUi();
  showScreen('results');
  hud.show(false);
  stopPresenceLoop();
}

function hostEndMatch() {
  if (match.role !== 'host') return;
  if (gameMode !== 'multiplayer' || mpMatchEnded) return;
  if (state !== 'playing' && state !== 'paused') return;
  mpHub.sendMatchEnd({ reason: 'host', kills: mpKills, deaths: mpDeaths });
  endMpMatch('host');
}

function castMpVote(choice) {
  if (gameMode !== 'multiplayer' || state !== 'results') return;
  if (choice !== 'replay' && choice !== 'leave') return;

  // Leave must always work — peer may already be gone (isConnected false).
  if (choice === 'leave') {
    mpLocalVote = choice;
    if (match.isConnected) {
      try {
        mpHub.sendVote(choice);
      } catch {
        /* ignore */
      }
    }
    match.destroy();
    quitToMenu();
    showScreen('multiplayer');
    return;
  }

  if (!match.isConnected) return;
  mpLocalVote = choice;
  mpHub.sendVote(choice);
  updateMpVoteUi();
  tryMpRematch();
}

function tryMpRematch() {
  if (mpLocalVote !== 'replay' || mpRemoteVote !== 'replay') return;
  if (!match.isConnected) return;
  if (match.role !== 'host') return;
  hud.toast(t('rematchStarting'));
  startMpRematch();
}

function startMpRematch() {
  mpLobby.worldSeed = randomWorldSeed();
  mpLobby.spawnAirportId = null;
  sessionWorldSeed = mpLobby.worldSeed;
  syncWorldSeedUi(sessionWorldSeed);
  resetMpMatchStats();
  mpHub.publishLobby({ ...mpLobby });
  mpHub.sendRematch({ ...mpLobby });
  beginMultiplayerMatch(mpLobby.mapId, { rematch: true });
}

function respawnLocalMp() {
  if (gameMode !== 'multiplayer' || mpMatchEnded || state !== 'playing') {
    mpDying = false;
    return;
  }
  const spawnRole = match.role === 'guest' ? 'guest' : 'host';
  const spawnInfo = resolveSpawn(world, {
    role: spawnRole,
    randomChance: mpLobby.airportSpawnChance,
    airportId: mpLobby.spawnAirportId,
  });
  const mods = difficultyMods(mpLobby.difficulty);
  const useFuel = !!mpLobby.fuelLimit;

  flight.reset({
    x: spawnInfo.x,
    y: spawnInfo.y + flight.gearHeight,
    z: spawnInfo.z,
    heading: spawnInfo.heading,
    pitch: 0,
    roll: 0,
  });
  if (useFuel) flight.fuel = mods.startFuel ?? 100;
  weapons?.clear?.();
  clearMpRespawnTimer();
  mpDying = false;
  hud.toast(t('youDiedRespawn'), 1200);
  sound.startEngine(getPlaneType(planeTypeIndex)?.id || planeTypeIndex, getPlaneType(planeTypeIndex)?.tag);
  sound.startWind();
}

function handleLocalMpDeath() {
  if (mpDying || mpMatchEnded || gameMode !== 'multiplayer') return;
  mpDying = true;
  mpDeaths += 1;
  particles?.burstExplosion(flight.position);
  sound.playCrash(flight.position.x, flight.position.y, flight.position.z);
  if (settings.camShake) camRig.addShake(0.55);

  match.sendEvent({
    type: 'died',
    kills: mpKills,
    deaths: mpDeaths,
  });

  if (isMpDogfight() || (mpLobby.mode || 'dogfight') === 'freefly') {
    hud.toast(t('youDiedRespawn'));
    // Clear only the timer — keep mpDying true until respawn, or every
    // frame re-fires death (kill spam) while the plane is still crashed.
    if (mpRespawnTimer) {
      clearTimeout(mpRespawnTimer);
      mpRespawnTimer = null;
    }
    mpRespawnTimer = setTimeout(() => respawnLocalMp(), 1600);
  } else {
    endMpMatch('death');
  }
}

function quitToMenu() {
  state = 'menu';
  world?.disableStreaming?.();
  stopPresenceLoop();
  clearModes();
  clearRemotePlane();
  clearMpRespawnTimer();
  mpDying = false;
  mpMatchEnded = false;
  mpLocalVote = null;
  mpRemoteVote = null;
  document.getElementById('hud-chat')?.classList.add('hidden');
  document.getElementById('results-solo-actions')?.classList.remove('hidden');
  document.getElementById('results-mp-actions')?.classList.add('hidden');
  sound.stopEngine();
  sound.stopWind();
  sound.setStall(false);
  sound.clearRemoteEngines();
  sound.setMusicState('menu');
  sound.startAmbient();
  if (planeGroup) {
    scene.remove(planeGroup);
    planeGroup = null;
  }
  hud.show(false);
  showScreen('menu');
  scene.background = new THREE.Color(0x143a5c);
  buildMenuPlane();
  camera.position.set(6, 3, 10);
  camera.lookAt(0, 1.5, 0);
  updateBanner();
}

function restart() {
  if (gameMode === 'multiplayer') {
    // Solo restart is disabled in MP — use vote rematch from results
    if (state === 'results') return;
    if (!match.isConnected) {
      quitToMenu();
      return;
    }
    return;
  }
  startGame(gameMode);
}

// ----- Settings UI -----
function fillSettingsForm() {
  const map = {
    'set-language-simple': settings.language,
    'set-quality-simple': settings.quality,
    'set-master-simple': Math.round(settings.masterVolume * 100),
    'set-difficulty-simple': settings.difficulty,
    'set-smoke-simple': settings.smoke,
    'set-showfps-simple': settings.showFps,
    'set-viewdist-simple': String(settings.viewDistanceKm ?? 1),
    'set-quality': settings.quality,
    'set-fpscap': String(settings.fpsCap),
    'set-pixelratio': settings.pixelRatio,
    'set-showfps': settings.showFps,
    'set-shadows': settings.shadows,
    'set-antialias': settings.antialias,
    'set-particles': settings.particles,
    'set-fog': settings.fog,
    'set-viewdist': String(settings.viewDistanceKm ?? 1),
    'set-master': Math.round(settings.masterVolume * 100),
    'set-engine': Math.round(settings.engineVolume * 100),
    'set-wind': Math.round(settings.windVolume * 100),
    'set-sfx': Math.round(settings.sfxVolume * 100),
    'set-music': Math.round(settings.musicVolume * 100),
    'set-difficulty': settings.difficulty,
    'set-smoke': settings.smoke,
    'set-defaultcam': settings.defaultCam,
    'set-mousesens': settings.mouseSens,
    'set-mouselook': settings.mouseLook,
    'set-inverty': settings.invertY,
    'set-camshake': settings.camShake,
    'set-stallassist': settings.stallAssist,
    'set-weather': settings.weatherCycle,
    'set-daynight': settings.dayNight,
    'set-fuellimit': settings.fuelLimit,
    'set-fuellimit-simple': settings.fuelLimit,
    'set-airport-spawn': settings.airportSpawnChance ?? 5,
    'set-language': settings.language,
    'set-announce-on': settings.announcementEnabled,
  };
  for (const [id, val] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!val;
    else el.value = val;
  }
  const en = document.getElementById('set-announce-en');
  const fa = document.getElementById('set-announce-fa');
  if (en) en.value = settings.announcement?.en || '';
  if (fa) fa.value = settings.announcement?.fa || '';
  refreshKeybindButtons();
}

function refreshKeybindButtons() {
  const bindings = normalizeKeyBindings(settings.keyBindings);
  document.querySelectorAll('.keybind-btn').forEach((btn) => {
    const action = btn.dataset.bind;
    if (!action) return;
    btn.textContent = formatBinding(bindings[action]);
    btn.classList.remove('listening');
  });
}

let keyCapture = null;

function setupKeybindUI() {
  document.querySelectorAll('.keybind-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (keyCapture?.btn) {
        keyCapture.btn.classList.remove('listening');
        refreshKeybindButtons();
      }
      keyCapture = { action: btn.dataset.bind, btn };
      btn.classList.add('listening');
      btn.textContent = t('keyPressPrompt');
    });
  });

  window.addEventListener(
    'keydown',
    (e) => {
      if (!keyCapture) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') {
        keyCapture.btn.classList.remove('listening');
        refreshKeybindButtons();
        keyCapture = null;
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        hud.toast(t('keyNoModifiers'));
        return;
      }
      if (e.code === 'Tab') return;
      if (!settings.keyBindings) settings.keyBindings = cloneKeyBindings(DEFAULT_KEY_BINDINGS);
      settings.keyBindings[keyCapture.action] = [e.code];
      input.setKeyBindings(settings.keyBindings);
      keyCapture.btn.textContent = formatBinding([e.code]);
      keyCapture.btn.classList.remove('listening');
      keyCapture = null;
    },
    true
  );
}

function readSettingsForm() {
  const num = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? Number(el.value) : fallback;
  };
  const str = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? el.value : fallback;
  };
  const chk = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? el.checked : fallback;
  };

  if (settingsView === 'simple') {
    settings.language = str('set-language-simple', settings.language);
    settings.quality = str('set-quality-simple', settings.quality);
    settings.masterVolume = num('set-master-simple', 70) / 100;
    settings.difficulty = str('set-difficulty-simple', settings.difficulty);
    settings.smoke = str('set-smoke-simple', settings.smoke);
    settings.showFps = chk('set-showfps-simple', settings.showFps);
    settings.viewDistanceKm = clampViewDistanceKm(str('set-viewdist-simple', settings.viewDistanceKm ?? 1));
    settings.fuelLimit = chk('set-fuellimit-simple', settings.fuelLimit);
  } else {
    settings.quality = str('set-quality', settings.quality);
    settings.fpsCap = num('set-fpscap', settings.fpsCap);
    settings.pixelRatio = num('set-pixelratio', settings.pixelRatio);
    settings.showFps = chk('set-showfps', settings.showFps);
    settings.shadows = chk('set-shadows', settings.shadows);
    settings.antialias = chk('set-antialias', settings.antialias);
    settings.particles = chk('set-particles', settings.particles);
    settings.fog = chk('set-fog', settings.fog);
    settings.viewDistanceKm = clampViewDistanceKm(str('set-viewdist', settings.viewDistanceKm ?? 1));
    settings.masterVolume = num('set-master', 70) / 100;
    settings.engineVolume = num('set-engine', 100) / 100;
    settings.windVolume = num('set-wind', 100) / 100;
    settings.sfxVolume = num('set-sfx', 100) / 100;
    settings.musicVolume = num('set-music', 80) / 100;
    settings.difficulty = str('set-difficulty', settings.difficulty);
    settings.smoke = str('set-smoke', settings.smoke);
    settings.defaultCam = str('set-defaultcam', settings.defaultCam);
    settings.mouseSens = num('set-mousesens', 1);
    settings.mouseLook = chk('set-mouselook', false);
    settings.invertY = chk('set-inverty', false);
    settings.camShake = chk('set-camshake', true);
    settings.stallAssist = chk('set-stallassist', false);
    settings.weatherCycle = chk('set-weather', true);
    settings.dayNight = chk('set-daynight', true);
    settings.fuelLimit = chk('set-fuellimit', false);
    settings.airportSpawnChance = clampAirportChance(num('set-airport-spawn', settings.airportSpawnChance ?? 5));
    settings.language = str('set-language', settings.language);
    settings.announcementEnabled = chk('set-announce-on', true);
    settings.announcement = {
      en: document.getElementById('set-announce-en')?.value || '',
      fa: document.getElementById('set-announce-fa')?.value || '',
    };
  }
}

function setSettingsMode(mode) {
  settingsView = mode;
  const shell = document.querySelector('.settings-shell');
  shell?.classList.toggle('simple-mode', mode === 'simple');
  document.querySelectorAll('.mode-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.settingsMode === mode);
  });
  document.getElementById('settings-simple')?.classList.toggle('hidden', mode !== 'simple');
  document.querySelectorAll('.advanced-only').forEach((el) => {
    el.classList.add('hidden');
  });
  if (mode === 'advanced') {
    showSettingsTab(settingsTab);
  }
}

function showSettingsTab(tab) {
  settingsTab = tab;
  document.querySelectorAll('.settings-nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.settingsTab === tab);
  });
  ['graphics', 'sound', 'gameplay', 'language'].forEach((name) => {
    document.getElementById(`tab-${name}`)?.classList.toggle('hidden', name !== tab);
  });
}

function applyAndSaveSettings() {
  readSettingsForm();
  saveSettings(settings);
  setLang(settings.language);
  syncLangButtons();
  applySettingsEffects();
  fillSettingsForm();
  persistSyncedSettingsToCloud();
  hud.toast(t('saved'));
}

// ----- Host modal -----
function fillHostModal() {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  const setChk = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  };

  setVal('mp-map', mpLobby.mapId || selectedMapId);
  setVal('mp-mode', mpLobby.mode || 'dogfight');
  setVal('mp-difficulty', mpLobby.difficulty || 'normal');
  setVal('mp-max-players', mpLobby.maxPlayers ?? 2);
  setVal('mp-airport-spawn', mpLobby.airportSpawnChance ?? 5);
  setVal('mp-duration', clampMatchDurationMin(mpLobby.matchDurationMin ?? 2));
  setChk('mp-fuel-limit', mpLobby.fuelLimit);
  setChk('mp-weather', mpLobby.weatherCycle !== false);
  setChk('mp-daynight', mpLobby.dayNight !== false);
  setChk('mp-wpn-mg', mpLobby.weaponFlags?.mg !== false);
  setChk('mp-wpn-cannon', mpLobby.weaponFlags?.cannon !== false);
  setChk('mp-wpn-rocket', mpLobby.weaponFlags?.rocket !== false);
  setChk('mp-wpn-missile', mpLobby.weaponFlags?.missile !== false);

  const enabled = mpLobby.enabledPlanes || defaultEnabledPlanes();
  document.querySelectorAll('[data-mp-plane]').forEach((el) => {
    const i = Number(el.dataset.mpPlane);
    el.checked = enabled[i] !== false;
  });
}

function readHostModal() {
  const flags = {
    mg: document.getElementById('mp-wpn-mg')?.checked !== false,
    cannon: document.getElementById('mp-wpn-cannon')?.checked !== false,
    rocket: document.getElementById('mp-wpn-rocket')?.checked !== false,
    missile: document.getElementById('mp-wpn-missile')?.checked !== false,
  };
  const enabledPlanes = defaultEnabledPlanes();
  document.querySelectorAll('[data-mp-plane]').forEach((el) => {
    const i = Number(el.dataset.mpPlane);
    if (i >= 0 && i < enabledPlanes.length) enabledPlanes[i] = el.checked;
  });
  if (!enabledPlanes.some(Boolean)) enabledPlanes[0] = true;

  return {
    mapId: document.getElementById('mp-map')?.value || selectedMapId,
    mode: document.getElementById('mp-mode')?.value || 'dogfight',
    difficulty: document.getElementById('mp-difficulty')?.value || 'normal',
    maxPlayers: clampMaxPlayers(document.getElementById('mp-max-players')?.value),
    airportSpawnChance: clampAirportChance(document.getElementById('mp-airport-spawn')?.value),
    matchDurationMin: clampMatchDurationMin(document.getElementById('mp-duration')?.value),
    fuelLimit: document.getElementById('mp-fuel-limit')?.checked === true,
    weatherCycle: document.getElementById('mp-weather')?.checked !== false,
    dayNight: document.getElementById('mp-daynight')?.checked !== false,
    weapons: WEAPON_ORDER.some((id) => flags[id]),
    weaponFlags: flags,
    enabledPlanes,
  };
}

function openHostModal(editing = false) {
  mpEditingSettings = !!editing && match.role === 'host';
  fillHostModal();
  const submit = document.querySelector('#mp-host-modal [data-action="mp-host"]');
  if (submit) {
    submit.setAttribute('data-i18n', mpEditingSettings ? 'applyHostSettings' : 'startHosting');
    submit.textContent = t(mpEditingSettings ? 'applyHostSettings' : 'startHosting');
  }
  document.getElementById('mp-host-modal')?.classList.remove('hidden');
  syncNavBack();
  syncOrientationLock();
}

function closeHostModal() {
  document.getElementById('mp-host-modal')?.classList.add('hidden');
  mpEditingSettings = false;
  syncNavBack();
  syncOrientationLock();
}

function localDisplayName() {
  const u = getUser();
  return (u?.displayName || u?.username || 'Pilot').slice(0, 24);
}

/** Local client platform for MP tags. */
function localDeviceKind() {
  return input.isTouchUi ? 'mobile' : 'pc';
}

function deviceLabel(kind) {
  if (kind === 'mobile') return t('deviceMobile');
  if (kind === 'pc') return t('devicePc');
  return '';
}

function formatMpName(name, deviceKind) {
  const base = String(name || 'Pilot').slice(0, 24);
  const tag = deviceLabel(deviceKind);
  return tag ? `${base} · ${tag}` : base;
}

function mpDeviceBadgeHtml(kind) {
  const label = deviceLabel(kind);
  if (!label) return '';
  const cls = kind === 'mobile' ? 'mobile' : 'pc';
  return `<span class="mp-device ${cls}">${escapeHtml(label)}</span>`;
}

function requireMpLogin(opts = {}) {
  if (isLoggedIn()) {
    localMpName = localDisplayName();
    return true;
  }
  if (opts.pendingRoom) pendingMpRoom = String(opts.pendingRoom).trim().toLowerCase() || pendingMpRoom;
  hud.toast(t('loginRequiredMp'));
  openAuthModal();
  return false;
}

/** True while already hosting, joining, connected, or in an MP match. */
function isBusyInMultiplayer() {
  if (gameMode === 'multiplayer' && (state === 'playing' || state === 'paused' || state === 'results')) {
    return true;
  }
  const role = match?.role;
  const status = match?.status;
  if (!role || status === 'idle') return false;
  if (role === 'host' && (status === 'hosting' || status === 'connected' || match.isConnected)) return true;
  if (role === 'guest' && (status === 'connecting' || status === 'connected' || match.isConnected)) {
    return true;
  }
  return false;
}

function canOpenNewHostSession() {
  // Editing settings of your current lobby is allowed via mp-edit-settings.
  if (match.role === 'host' && (match.status === 'hosting' || match.isConnected)) return false;
  return !isBusyInMultiplayer();
}

async function flushPendingMpJoin() {
  if (!pendingMpRoom || !isLoggedIn()) return;
  const room = pendingMpRoom;
  pendingMpRoom = null;
  showScreen('multiplayer');
  await joinMatch(room);
}

function sendMpHello() {
  localMpName = localDisplayName();
  match.sendEvent({
    type: 'hello',
    name: localMpName,
    device: localDeviceKind(),
  });
}

function appendChatMessage(name, text, self = false) {
  const cleanName = String(name || 'Pilot').slice(0, 24);
  const cleanText = String(text || '').trim().slice(0, 120);
  if (!cleanText) return;
  const entry = { name: cleanName, text: cleanText, self: !!self, t: Date.now() };
  mpChatHistory.push(entry);
  while (mpChatHistory.length > MP_CHAT_MAX) mpChatHistory.shift();
  renderChatLogs();
}

function renderChatLogs() {
  const renderInto = (el, limit) => {
    if (!el) return;
    const slice = mpChatHistory.slice(-limit);
    el.innerHTML = slice
      .map(
        (m) =>
          `<div class="chat-line${m.self ? ' self' : ''}"><strong>${escapeHtml(m.name)}</strong>: ${escapeHtml(m.text)}</div>`
      )
      .join('');
    el.scrollTop = el.scrollHeight;
  };
  renderInto(document.getElementById('mp-chat-log'), 30);
  renderInto(document.getElementById('hud-chat-log'), 6);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sendChatFromInput(inputEl) {
  if (!match.isConnected) return;
  const text = (inputEl?.value || '').trim().slice(0, 120);
  if (!text) return;
  const name = localDisplayName();
  match.sendEvent({ type: 'chat', name, text });
  appendChatMessage(name, text, true);
  if (inputEl) inputEl.value = '';
}

function syncMpLobbyUi() {
  const hostControls = document.getElementById('mp-host-controls');
  const guestWait = document.getElementById('mp-guest-wait');
  const startBtn = document.getElementById('mp-start-btn');
  const kickBtn = document.getElementById('mp-kick-btn');
  const list = document.getElementById('mp-player-list');
  const hostOpenBtn = document.querySelector('[data-action="mp-host-open"]');
  const isHost = match.role === 'host';
  const connected = match.isConnected || mpGuestConnected;

  if (hostOpenBtn) {
    const blockNewHost = !canOpenNewHostSession();
    hostOpenBtn.disabled = blockNewHost;
    hostOpenBtn.title = blockNewHost ? t('disconnectBeforeHost') : '';
  }

  hostControls?.classList.toggle('hidden', !isHost || match.status === 'idle');
  guestWait?.classList.toggle('hidden', isHost || !connected || state === 'playing');
  if (startBtn) startBtn.disabled = !isHost || !connected;
  if (kickBtn) kickBtn.disabled = !isHost || !connected;

  if (list) {
    const you = localDisplayName();
    const youDevice = localDeviceKind();
    const peer = mpPeerName || (connected ? t('mpGuest') : '—');
    const rows = [];
    if (isHost) {
      rows.push(
        `<li><span class="mp-role">${t('mpHost')}</span> ${escapeHtml(you)}${mpDeviceBadgeHtml(youDevice)} <em>(${t('mpYou')})</em></li>`
      );
      rows.push(
        `<li><span class="mp-role">${t('mpGuest')}</span> ${
          connected ? `${escapeHtml(peer)}${mpDeviceBadgeHtml(mpPeerDevice)}` : '—'
        }</li>`
      );
    } else if (match.role === 'guest') {
      rows.push(
        `<li><span class="mp-role">${t('mpHost')}</span> ${
          peer !== '—' ? `${escapeHtml(peer)}${mpDeviceBadgeHtml(mpPeerDevice)}` : '—'
        }</li>`
      );
      rows.push(
        `<li><span class="mp-role">${t('mpGuest')}</span> ${escapeHtml(you)}${mpDeviceBadgeHtml(youDevice)} <em>(${t('mpYou')})</em></li>`
      );
    } else {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = rows.join('');
  }

  const hudMp = document.getElementById('hud-mp');
  if (hudMp && gameMode === 'multiplayer') {
    hudMp.textContent = mpPeerName
      ? `MP · ${formatMpName(mpPeerName, mpPeerDevice)}`
      : 'MP';
  }
}

function resetMpMatchStats() {
  mpKills = 0;
  mpDeaths = 0;
  mpPeerKills = 0;
  mpMatchEnded = false;
  mpLocalVote = null;
  mpRemoteVote = null;
  mpDying = false;
  mpPeerDiedIgnoreUntil = 0;
  if (mpRespawnTimer) {
    clearTimeout(mpRespawnTimer);
    mpRespawnTimer = null;
  }
  const dur = clampMatchDurationMin(mpLobby.matchDurationMin ?? 2);
  mpMatchTimeLeft = dur * 60;
}

function clearMpRespawnTimer() {
  if (mpRespawnTimer) {
    clearTimeout(mpRespawnTimer);
    mpRespawnTimer = null;
  }
}

function resetMpLobbyState() {
  mpGuestConnected = false;
  mpPeerName = '';
  mpPeerDevice = '';
  mpEditingSettings = false;
  clearMpRespawnTimer();
  mpDying = false;
  mpPeerDiedIgnoreUntil = 0;
  mpMatchEnded = false;
  mpLocalVote = null;
  mpRemoteVote = null;
  mpKills = 0;
  mpDeaths = 0;
  mpPeerKills = 0;
  mpMatchTimeLeft = null;
  syncMpLobbyUi();
}

function applyHostSettingsFromModal() {
  mpLobby = { ...mpLobby, ...readHostModal() };
  if (mpLobby.worldSeed == null) mpLobby.worldSeed = randomWorldSeed();
  sessionWorldSeed = mpLobby.worldSeed;
  syncWorldSeedUi(sessionWorldSeed);
  if (match.role === 'host' && (match.status === 'hosting' || match.isConnected)) {
    ensureWorld(mpLobby.mapId, mpLobby.worldSeed);
    mpHub.publishLobby({ ...mpLobby });
    hud.toast(t('applyHostSettings'));
  }
  closeHostModal();
}

// ----- Matchmaking UI -----
function updateMpStatus(info) {
  const statusEl = document.getElementById('mp-status');
  const codeEl = document.getElementById('mp-room-code');
  const urlEl = document.getElementById('mp-invite-url');
  const box = document.getElementById('mp-host-box');
  if (!statusEl) return;

  if (info.status === 'hosting') {
    box?.classList.remove('hidden');
    statusEl.textContent = mpGuestConnected ? t('peerInLobby') : t('waitingPeer');
    if (codeEl) codeEl.textContent = info.roomId || '';
    if (urlEl) urlEl.value = info.inviteUrl || '';
    if (info.roomId && info.inviteUrl) {
      setInviteRoomContext({ roomId: info.roomId, inviteUrl: info.inviteUrl });
    }
  } else if (info.status === 'connecting') {
    box?.classList.remove('hidden');
    statusEl.textContent = t('connecting');
  } else if (info.status === 'connected') {
    box?.classList.remove('hidden');
    mpGuestConnected = true;
    statusEl.textContent = t('connected');
  } else if (info.status === 'error') {
    statusEl.textContent = 'Connection error';
  } else if (info.status === 'idle') {
    statusEl.textContent = '';
    setInviteRoomContext(null);
    resetMpLobbyState();
  }
  syncMpLobbyUi();
}

match.onStatus = updateMpStatus;

match.onPeerState = (data) => {
  if (!data) return;
  if (!remoteInterp._gotState) {
    remoteInterp._gotState = true;
    remoteInterp.pos.set(data.x, data.y, data.z);
  }
  remoteInterp.targetPos.set(data.x, data.y, data.z);
  remoteInterp.targetQuat.set(data.qx, data.qy, data.qz, data.qw);
  remoteInterp.health = data.health ?? 100;
  remoteInterp.throttle = data.throttle ?? 0.5;
  if (data.kills != null) mpPeerKills = Number(data.kills) || 0;
  if (data.name && data.name !== mpPeerName) {
    mpPeerName = String(data.name).slice(0, 24);
    if (data.device === 'mobile' || data.device === 'pc') mpPeerDevice = data.device;
    refreshRemoteNameTag();
    syncMpLobbyUi();
  } else if (data.device === 'mobile' || data.device === 'pc') {
    if (data.device !== mpPeerDevice) {
      mpPeerDevice = data.device;
      refreshRemoteNameTag();
      syncMpLobbyUi();
    }
  }
  if (data.skin != null && data.skin !== remoteInterp.skin && remotePlane) {
    remoteInterp.skin = data.skin;
    spawnRemotePlane(data.skin, {
      x: data.x,
      y: data.y,
      z: data.z,
    });
  }
};

function beginMultiplayerMatch(mapId, opts = {}) {
  const rematch = !!opts.rematch;
  if (state === 'playing' && gameMode === 'multiplayer' && !rematch) return;
  document.getElementById('hud-chat')?.classList.remove('hidden');
  resetMpMatchStats();
  startGame('multiplayer', mapId || mpLobby.mapId);
}

match.onEvent = (ev) => {
  if (ev.type === 'hello') {
    mpPeerName = String(ev.name || '').slice(0, 24) || t('mpGuest');
    mpPeerDevice = ev.device === 'mobile' || ev.device === 'pc' ? ev.device : mpPeerDevice;
    refreshRemoteNameTag();
    syncMpLobbyUi();
    return;
  }
  if (ev.type === 'chat') {
    appendChatMessage(ev.name, ev.text, false);
    return;
  }
  if (ev.type === 'kick') {
    hud.toast(t('kicked'));
    pendingMpRoom = null;
    match.destroy();
    resetMpLobbyState();
    clearRoomFromUrl();
    quitToMenu();
    document.getElementById('mp-host-box')?.classList.add('hidden');
    showScreen('multiplayer');
    return;
  }
  if (ev.type === 'start') {
    if ((state === 'playing' || state === 'paused') && gameMode === 'multiplayer') return;
    beginMultiplayerMatch(mpLobby.mapId);
    return;
  }
  if (ev.type === 'rematch') {
    if (ev.config) {
      mpLobby = {
        ...mpLobby,
        ...ev.config,
        worldSeed:
          ev.config.worldSeed != null ? ev.config.worldSeed >>> 0 : mpLobby.worldSeed,
        matchDurationMin: clampMatchDurationMin(
          ev.config.matchDurationMin ?? mpLobby.matchDurationMin
        ),
      };
      if (mpLobby.worldSeed != null) sessionWorldSeed = mpLobby.worldSeed >>> 0;
      mpHub.setConfig(mpLobby);
    }
    hud.toast(t('rematchStarting'));
    beginMultiplayerMatch(mpLobby.mapId, { rematch: true });
    return;
  }
  if (ev.type === 'match-end') {
    if (mpMatchEnded) return;
    if (ev.kills != null) mpPeerKills = Number(ev.kills) || mpPeerKills;
    endMpMatch(ev.reason || 'host', { peerKills: mpPeerKills });
    return;
  }
  if (ev.type === 'vote') {
    const choice = ev.choice === 'leave' ? 'leave' : ev.choice === 'replay' ? 'replay' : null;
    if (!choice) return;
    mpRemoteVote = choice;
    updateMpVoteUi();
    if (choice === 'leave') {
      hud.toast(t('peerLeft'));
      // Peer is leaving — if they disconnect PeerJS will fire peer-left
      return;
    }
    tryMpRematch();
    return;
  }
  if (ev.type === 'lobby') {
    mpLobby = {
      ...mpLobby,
      ...ev.config,
      worldSeed:
        ev.config?.worldSeed != null ? ev.config.worldSeed >>> 0 : mpLobby.worldSeed,
      weaponFlags: { ...DEFAULT_WEAPON_FLAGS, ...(ev.config?.weaponFlags || {}) },
      enabledPlanes: ev.config?.enabledPlanes?.length
        ? ev.config.enabledPlanes
        : mpLobby.enabledPlanes,
      airportSpawnChance: clampAirportChance(
        ev.config?.airportSpawnChance ?? mpLobby.airportSpawnChance
      ),
      maxPlayers: clampMaxPlayers(ev.config?.maxPlayers ?? mpLobby.maxPlayers),
      matchDurationMin: clampMatchDurationMin(
        ev.config?.matchDurationMin ?? mpLobby.matchDurationMin
      ),
    };
    if (mpLobby.worldSeed != null) sessionWorldSeed = mpLobby.worldSeed >>> 0;
    weapons?.setEnabled(mpLobby.weaponFlags);
    mpHub.setConfig(mpLobby);

    if (state === 'playing' || state === 'paused') return;

    ensureWorld(mpLobby.mapId, mpLobby.worldSeed);
    // Guest stays in lobby until host Start
    if (match.role === 'guest') {
      document.getElementById('mp-status').textContent = t('waitingHostStart');
      syncMpLobbyUi();
    }
    return;
  }
  if (ev.type === 'ready') {
    mpHub.handleRemoteReady();
    return;
  }
  if (ev.type === 'peer-joined') {
    if (match.role === 'host') {
      hud.toast(t('peerJoined'));
      sound.playUI('success');
    }
    mpGuestConnected = true;
    sendMpHello();
    if (match.role === 'host') {
      mpHub.reset();
      mpHub.onBothReady(() => {
        /* load sync only — match start is host Start button */
      });
      if (mpLobby.worldSeed == null) mpLobby.worldSeed = randomWorldSeed();
      ensureWorld(mpLobby.mapId, mpLobby.worldSeed);
      const pre = resolveSpawn(world, {
        role: 'host',
        randomChance: mpLobby.airportSpawnChance,
      });
      mpLobby.spawnAirportId = pre.airportId;
      mpHub.publishLobby({ ...mpLobby });
      document.getElementById('mp-status').textContent = t('peerInLobby');
    } else {
      document.getElementById('mp-status').textContent = t('waitingHostStart');
    }
    syncMpLobbyUi();
  } else if (ev.type === 'peer-left') {
    const skipToast = !!match._kicking;
    match._kicking = false;
    if (!skipToast) hud.toast(t('peerLeft'));
    mpHub.reset();
    mpGuestConnected = false;
    mpPeerName = '';
    mpPeerDevice = '';
    syncMpLobbyUi();
    const inMatch =
      gameMode === 'multiplayer' &&
      (state === 'playing' || state === 'paused' || state === 'results');
    if (inMatch && !mpMatchEnded) {
      endMpMatch('peer-left');
    } else if (state === 'results' && gameMode === 'multiplayer') {
      // Peer left during vote screen
      mpRemoteVote = 'leave';
      updateMpVoteUi();
      hud.toast(t('peerLeft'));
    } else if (match.role === 'guest' && state !== 'results') {
      // Stay on lobby and let Matchmaking attempt a soft rejoin (do not destroy).
      document.getElementById('mp-status').textContent = t('connecting');
      syncMpLobbyUi();
    } else if (match.role === 'host' && state !== 'results') {
      document.getElementById('mp-status').textContent = t('waitingPeer');
    }
  } else if (ev.type === 'damage') {
    if (state !== 'playing' || gameMode !== 'multiplayer' || mpMatchEnded || mpDying) return;
    const mods = difficultyMods(mpLobby.difficulty);
    const amt = (Number(ev.amount) || 0) * mods.damageScale;
    if (amt <= 0) return;
    flight.takeDamage(amt);
    if (settings.camShake) camRig.addShake(0.22);
    sound.playHit();
    if (flight.crashed || flight.health <= 0) handleLocalMpDeath();
  } else if (ev.type === 'fire') {
    if (!weapons) return;
    const origin = new THREE.Vector3(ev.x, ev.y, ev.z);
    const dir = new THREE.Vector3(ev.dx, ev.dy, ev.dz);
    const wpn = ev.weapon || 'mg';
    if (WEAPON_DEFS[wpn]?.sound === 'rocket') sound.playRocket();
    else sound.playGunfire(wpn === 'cannon' ? 'cannon' : 'mg');
    let lockTarget = null;
    if (ev.lockId != null && ev.lockKind) {
      // Sender locked 'peer' (you); remap so local homing resolves against self.
      const kind = ev.lockKind === 'peer' ? 'self' : ev.lockKind;
      lockTarget = { id: kind === 'self' ? 'self' : ev.lockId, kind };
    }
    weapons.fire(origin, dir, {
      owner: 'remote',
      enemy: true,
      force: true,
      weapon: wpn,
      lockTarget,
    });
  } else if (ev.type === 'died') {
    if (gameMode !== 'multiplayer' || mpMatchEnded) return;
    if (state !== 'playing' && state !== 'paused') return;
    // Deduplicate death spam (e.g. old clients / race before respawn gate)
    const now = performance.now();
    if (now < mpPeerDiedIgnoreUntil) return;
    mpPeerDiedIgnoreUntil = now + 2200;
    // Victim died — award a kill to the local player
    mpKills += 1;
    if (ev.kills != null) mpPeerKills = Number(ev.kills) || mpPeerKills;
    particles?.burstExplosion(remoteInterp.pos);
    sound.playScore();
    hud.toast(t('killedPeer'));
    if (settings.camShake) camRig.addShake(0.12);
  }
};

async function hostMatch() {
  if (!requireMpLogin()) return;
  await unlockAudio();
  if (mpEditingSettings || (match.role === 'host' && (match.status === 'hosting' || match.isConnected))) {
    applyHostSettingsFromModal();
    return;
  }
  if (!canOpenNewHostSession()) {
    hud.toast(t('disconnectBeforeHost'));
    closeHostModal();
    return;
  }
  mpHub.reset();
  mpChatHistory.length = 0;
  renderChatLogs();
  resetMpLobbyState();
  localMpName = localDisplayName();
  mpLobby = { ...mpLobby, ...readHostModal(), worldSeed: randomWorldSeed(), spawnAirportId: null };
  sessionWorldSeed = mpLobby.worldSeed;
  syncWorldSeedUi(sessionWorldSeed);
  closeHostModal();
  try {
    const { inviteUrl, roomId } = await match.host();
    document.getElementById('mp-host-box')?.classList.remove('hidden');
    document.getElementById('mp-room-code').textContent = roomId;
    document.getElementById('mp-invite-url').value = inviteUrl;
    document.getElementById('mp-status').textContent = t('waitingPeer');
    setInviteRoomContext({ roomId, inviteUrl });
    syncMpLobbyUi();
  } catch (e) {
    console.error(e);
    hud.toast(t('hostFailed'));
    setInviteRoomContext(null);
  }
}

async function joinMatch(code) {
  const raw = (code || '').trim();
  let room = raw;
  if (room.includes('room=')) {
    try {
      room = new URL(room).searchParams.get('room') || room;
    } catch {
      const m = room.match(/room=([^&]+)/);
      if (m) room = m[1];
    }
  }
  room = String(room || '')
    .trim()
    .toLowerCase();
  if (!room) return;

  if (!requireMpLogin({ pendingRoom: room })) return;
  await unlockAudio();

  mpChatHistory.length = 0;
  renderChatLogs();
  resetMpLobbyState();
  localMpName = localDisplayName();
  try {
    document.getElementById('mp-status').textContent = t('connecting');
    document.getElementById('mp-host-box')?.classList.remove('hidden');
    await match.join(room);
    clearRoomFromUrl();
    pendingMpRoom = null;
    document.getElementById('mp-status').textContent = t('waitingHostStart');
    syncMpLobbyUi();
  } catch (e) {
    console.error(e);
    const msg =
      e?.type === 'peer-unavailable' ||
      e?.type === 'peer_open_timeout' ||
      /peer|connect|timeout/i.test(String(e?.message || e))
        ? t('joinFailedHint')
        : t('joinFailed');
    hud.toast(msg);
    document.getElementById('mp-status').textContent = msg;
  }
}

function hostStartMatch() {
  if (match.role !== 'host' || !match.isConnected) return;
  if (mpLobby.worldSeed == null) mpLobby.worldSeed = randomWorldSeed();
  mpHub.publishLobby({ ...mpLobby });
  mpHub.sendStart();
  beginMultiplayerMatch(mpLobby.mapId);
}

function hostKickGuest() {
  if (match.role !== 'host') return;
  match.kickGuest();
  mpGuestConnected = false;
  mpPeerName = '';
  mpPeerDevice = '';
  hud.toast(t('peerLeft'));
  document.getElementById('mp-status').textContent = t('waitingPeer');
  syncMpLobbyUi();
}

// ----- Events -----
document.querySelectorAll('[data-action]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await unlockAudio();
    sound.playUI('click');
    const action = btn.dataset.action;
    if (action === 'start-freeroam') startGame('freeroam');
    if (action === 'start-race') startGame('race');
    if (action === 'start-combat') startGame('combat');
    if (action === 'multiplayer') {
      if (!requireMpLogin()) return;
      showScreen('multiplayer');
    }
    if (action === 'close-multiplayer') {
      await match.destroy();
      clearRoomFromUrl();
      pendingMpRoom = null;
      resetMpLobbyState();
      mpChatHistory.length = 0;
      renderChatLogs();
      document.getElementById('mp-host-box')?.classList.add('hidden');
      document.getElementById('hud-chat')?.classList.add('hidden');
      setInviteRoomContext(null);
      showScreen('menu');
      return;
    }
    if (action === 'close-inbox') {
      showScreen('menu');
      return;
    }
    if (action === 'mp-host-open') {
      if (!requireMpLogin()) return;
      if (!canOpenNewHostSession()) {
        hud.toast(t('disconnectBeforeHost'));
        return;
      }
      openHostModal(false);
    }
    if (action === 'mp-host-cancel') closeHostModal();
    if (action === 'mp-host') hostMatch();
    if (action === 'mp-edit-settings') {
      if (match.role !== 'host') return;
      openHostModal(true);
    }
    if (action === 'mp-start') hostStartMatch();
    if (action === 'mp-kick') hostKickGuest();
    if (action === 'mp-chat-send') {
      sendChatFromInput(document.getElementById('mp-chat-input'));
    }
    if (action === 'mp-join') joinMatch(document.getElementById('mp-join-input')?.value);
    if (action === 'mp-copy') {
      const url = document.getElementById('mp-invite-url')?.value;
      if (url) {
        await navigator.clipboard?.writeText(url);
        hud.toast(t('linkCopied'));
      }
    }
    if (action === 'mp-disconnect') {
      await match.destroy();
      clearRoomFromUrl();
      resetMpLobbyState();
      mpChatHistory.length = 0;
      renderChatLogs();
      document.getElementById('mp-host-box')?.classList.add('hidden');
      document.getElementById('hud-chat')?.classList.add('hidden');
      setInviteRoomContext(null);
    }
    if (action === 'options' || action === 'options-from-pause') {
      fillSettingsForm();
      setSettingsMode(settingsView);
      showScreen('options');
    }
    if (action === 'close-options') {
      showScreen(state === 'paused' ? 'pause' : 'menu');
    }
    if (action === 'settings-apply') applyAndSaveSettings();
    if (action === 'graphics-autodetect') {
      autoDetectBestGraphics();
      return;
    }
    if (action === 'touch-layout-edit') {
      openTouchLayoutEditor();
      return;
    }
    if (action === 'touch-layout-done') {
      finishTouchLayoutEditor(true);
      return;
    }
    if (action === 'touch-layout-cancel') {
      finishTouchLayoutEditor(false);
      return;
    }
    if (action === 'touch-layout-reset') {
      resetTouchLayoutDraft();
      return;
    }
    if (action === 'settings-reset') {
      settings = {
        ...DEFAULT_SETTINGS,
        announcement: { ...DEFAULT_SETTINGS.announcement },
        keyBindings: cloneKeyBindings(DEFAULT_KEY_BINDINGS),
        touchLayout: null,
      };
      fillSettingsForm();
      applySettingsEffects();
      saveSettings(settings);
      persistSyncedSettingsToCloud();
      hud.toast(t('resetDefaults'));
      return;
    }
    if (action === 'keybind-reset') {
      settings.keyBindings = cloneKeyBindings(DEFAULT_KEY_BINDINGS);
      refreshKeybindButtons();
      input.setKeyBindings(settings.keyBindings);
      saveSettings(settings);
      persistSyncedSettingsToCloud();
      hud.toast(t('keybindReset'));
      return;
    }
    if (action === 'resume') {
      state = 'playing';
      showScreen('none');
    }
    if (action === 'restart') restart();
    if (action === 'mp-end-match') {
      hostEndMatch();
      return;
    }
    if (action === 'mp-vote-replay') {
      castMpVote('replay');
      return;
    }
    if (action === 'mp-vote-leave') {
      castMpVote('leave');
      return;
    }
    if (action === 'quit') {
      if (gameMode === 'multiplayer') await match.destroy();
      quitToMenu();
    }
  });
});

function updatePlanePickerUi() {
  const type = getPlaneType(planeTypeIndex);
  document.querySelectorAll('.plane-btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.plane) === planeTypeIndex);
  });
  const tag = document.getElementById('plane-tagline');
  if (tag) {
    tag.textContent = `${t(type.nameKey)} — ${t(type.descKey)}`;
  }
}

function selectPlane(index) {
  planeTypeIndex = ((index % PLANE_TYPES.length) + PLANE_TYPES.length) % PLANE_TYPES.length;
  skinIndex = planeTypeIndex;
  localStorage.setItem('pokyplane_plane', String(planeTypeIndex));
  updatePlanePickerUi();
  if (state === 'menu') buildMenuPlane();
  const pt = getPlaneType(planeTypeIndex);
  sound.setEnginePlane(pt?.id || planeTypeIndex, pt?.tag);
  if (state === 'menu') sound.setMusicState('hangar');
}

document.querySelectorAll('.plane-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await unlockAudio();
    sound.playUI('click');
    selectPlane(Number(btn.dataset.plane));
  });
});
updatePlanePickerUi();

document.querySelectorAll('.lang-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await unlockAudio();
    sound.playUI('click');
    settings.language = btn.dataset.lang;
    saveSettings(settings);
    setLang(settings.language);
    syncLangButtons();
    updateBanner();
    fillSettingsForm();
    updatePlanePickerUi();
    persistSyncedSettingsToCloud();
  });
});

document.querySelectorAll('.mode-tab').forEach((btn) => {
  btn.addEventListener('click', () => setSettingsMode(btn.dataset.settingsMode));
});

document.querySelectorAll('.settings-nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => showSettingsTab(btn.dataset.settingsTab));
});

document.getElementById('announce-close')?.addEventListener('click', () => {
  bannerDismissed = true;
  sessionStorage.setItem('pokyplane_banner_dismissed', '1');
  updateBanner();
});

window.addEventListener('resize', () => {
  if (!isHangarPreviewVisible()) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
  syncMenuStageHole();
});

document.getElementById('menu-map')?.addEventListener('change', (e) => {
  selectedMapId = e.target.value;
  localStorage.setItem('pokyplane_map', selectedMapId);
  const mpMap = document.getElementById('mp-map');
  if (mpMap) mpMap.value = selectedMapId;
  if (world && world.mapId !== selectedMapId) {
    ensureWorld(selectedMapId);
    applySettingsEffects();
  }
});

const menuMapEl = document.getElementById('menu-map');
if (menuMapEl) menuMapEl.value = selectedMapId;
const mpMapEl = document.getElementById('mp-map');
if (mpMapEl) mpMapEl.value = selectedMapId;
syncWorldSeedUi(sessionWorldSeed);

window.addEventListener(
  'pointerdown',
  async () => {
    await unlockAudio();
    if (state === 'menu') {
      sound.setMusicState('menu');
      sound.startAmbient();
    }
  },
  { once: true }
);

// ----- Init -----
registerServiceWorker();
bindInstallPrompt();
setLang(settings.language);
syncLangButtons();

const pwaBlocked = applyPwaGate();
document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
  const ok = await promptPwaInstall();
  if (!ok) {
    /* user dismissed — steps on the card still apply */
  }
  applyPwaGate();
  applyDomLang();
});
window.addEventListener('appinstalled', () => {
  applyPwaGate();
  applyDomLang();
});
window.matchMedia('(display-mode: standalone)').addEventListener?.('change', () => {
  applyPwaGate();
  syncOrientationLock();
});

if (input.isTouchUi || isTouchMobile()) {
  document.body.classList.add('touch-ui');
  document.querySelectorAll('.touch-only-ui').forEach((el) => el.classList.remove('hidden'));
  const hint = document.querySelector('#menu .hint');
  if (hint) hint.setAttribute('data-i18n', 'hintMobile');
  document.querySelector('.keybind-touch-note')?.classList.remove('hidden');
  applyTouchLayout(settings.touchLayout);
  window.addEventListener('orientationchange', () => {
    syncOrientationLock();
    setTimeout(() => syncOrientationLock(), 250);
  });
  window.addEventListener('resize', () => syncOrientationLock());
  // Re-lock landscape on gesture (no fullscreen)
  const relock = () => {
    if (!isPwaGateActive()) forceLandscape();
    syncOrientationLock();
  };
  window.addEventListener('pointerdown', relock, { passive: true });
  document.getElementById('nav-back')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigateBack();
  });
  window.addEventListener('popstate', () => {
    navigateBack();
  });
  if (!pwaBlocked) {
    syncOrientationLock();
    syncNavBack();
  }
}
applyDomLang();
updateBanner();
loadServerAnnouncement();
fillSettingsForm();
setupKeybindUI();
setSettingsMode('simple');

syncWorldVisibility();
syncTouchUi();
buildMenuPlane();
document.getElementById('mp-host-close')?.addEventListener('click', () => closeHostModal());
camera.position.set(6, 3, 10);
camera.lookAt(0, 1.5, 0);
showScreen('menu');
applySettingsEffects();

const menuLight = new THREE.DirectionalLight(0xffe8cc, 1.15);
menuLight.position.set(5, 10, 7);
scene.add(menuLight);
scene.add(new THREE.AmbientLight(0x6080a0, 0.62));
scene.add(new THREE.HemisphereLight(0x8ec8f0, 0x1a4028, 0.45));
scene.background = new THREE.Color(0x143a5c);

// Await auth before invite auto-join so logged-in tokens hydrate currentUser first.
(async () => {
  await setupAuthUI();
  setupPushNotifications();
  setupInboxUI();
  setInboxJoinLobbyHandler((roomId) => {
    showScreen('multiplayer');
    if (isLoggedIn()) joinMatch(roomId);
    else {
      pendingMpRoom = String(roomId).trim().toLowerCase();
      openAuthModal();
    }
  });
  document.getElementById('btn-inbox')?.addEventListener('click', () => {
    if (!isLoggedIn()) {
      openAuthModal();
      return;
    }
    showScreen('inbox');
  });
  onAuthChanged((user) => {
    if (user) {
      mergeCloudUserSettings(user);
      flushPendingMpJoin();
    }
  });
  mergeCloudUserSettings(getUser());
  if (isPwaGateActive() || !canPlayGame()) {
    applyPwaGate();
    return;
  }
  const urlRoom = getRoomFromUrl();
  if (urlRoom) {
    showScreen('multiplayer');
    if (isLoggedIn()) joinMatch(urlRoom);
    else {
      pendingMpRoom = String(urlRoom).trim().toLowerCase();
      requireMpLogin({ pendingRoom: pendingMpRoom });
    }
  }
})();

document.getElementById('mp-chat-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendChatFromInput(e.target);
  }
});
document.getElementById('hud-chat-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendChatFromInput(e.target);
  }
});
document.getElementById('hud-chat-send')?.addEventListener('click', () => {
  sendChatFromInput(document.getElementById('hud-chat-input'));
});

// ----- Loop -----
const clock = new THREE.Clock();

function getFlightInputAdjusted() {
  const fi = input.getFlightInput();
  if (settings.invertY) fi.pitch *= -1;
  return fi;
}

function updateMultiplayer(dt, fi) {
  if (!match.isConnected || !remotePlane) return;

  remoteInterp.pos.lerp(remoteInterp.targetPos, 1 - Math.exp(-12 * dt));
  remoteInterp.quat.slerp(remoteInterp.targetQuat, 1 - Math.exp(-12 * dt));
  remotePlane.position.copy(remoteInterp.pos);
  remotePlane.quaternion.copy(remoteInterp.quat);
  updatePlaneVisuals(remoteParts, {
    rollInput: 0,
    pitchInput: 0,
    yawInput: 0,
    throttle: remoteInterp.throttle,
    airspeed: 40,
    onGround: false,
  }, dt);

  sound.updateRemoteEngine('peer', {
    x: remoteInterp.pos.x,
    y: remoteInterp.pos.y,
    z: remoteInterp.pos.z,
    throttle: remoteInterp.throttle,
    planeId: remoteInterp.skin,
  });

  match.sendState({
    x: flight.position.x,
    y: flight.position.y,
    z: flight.position.z,
    qx: flight.quaternion.x,
    qy: flight.quaternion.y,
    qz: flight.quaternion.z,
    qw: flight.quaternion.w,
    health: flight.health,
    throttle: flight.throttle,
    skin: planeTypeIndex,
    name: localMpName || localDisplayName(),
    device: localDeviceKind(),
    kills: mpKills,
    deaths: mpDeaths,
  });

  // Territory soft boundary
  const terr = flight.applyTerritoryPush(world.mpTerritory, dt);
  if (terr.t > 0.55 && Math.random() < 0.02) hud.toast(t('territoryWarn'));

  if (flight.crashed || flight.health <= 0) {
    handleLocalMpDeath();
  }
}

function handleWeaponImpact({ target, damage, point, owner, weapon }) {
  if (!particles) return;
  const p = point || target?.position;
  if (!p) return;

  const w = weapon || 'mg';
  particles.emitImpactExplosion(p, { weapon: w });

  if (w === 'missile' || w === 'rocket') {
    sound.playExplosion(p.x, p.y, p.z, w === 'missile' ? 1.4 : 1.1);
    if (settings.camShake) camRig.addShake(w === 'missile' ? 0.24 : 0.18);
  } else if (w === 'cannon') {
    sound.playExplosion(p.x, p.y, p.z, 0.7);
    if (settings.camShake) camRig.addShake(0.07);
  } else if (w === 'mg') {
    if (settings.camShake) camRig.addShake(0.012);
  }
}

function buildHitTargets() {
  const hitTargets = [];
  if (gameMode === 'combat' && combat) {
    combat.enemies.forEach((e) => {
      if (e.alive) {
        hitTargets.push({
          position: e.position,
          radius: 3.5,
          id: e.id,
          kind: 'ai',
          ref: e,
        });
      }
    });
    hitTargets.push(...combat.getDecoyTargets());
  }
  if (gameMode === 'multiplayer' && remotePlane) {
    hitTargets.push({
      position: remoteInterp.pos,
      radius: getPlaneHitRadius(remoteInterp.skin ?? 1),
      id: 'peer',
      kind: 'peer',
      owner: 'remote',
    });
    if (!mpDying) {
      hitTargets.push({
        position: flight.position,
        radius: flight.hitRadius ?? 3.2,
        id: 'self',
        kind: 'self',
        owner: 'local',
      });
    }
  }
  return hitTargets;
}

function getIncomingMissiles() {
  if (!weapons) return [];
  const out = [];
  for (const b of weapons.bullets) {
    if (!b.homing || b.weapon !== 'missile') continue;
    out.push({
      pos: b.mesh.position,
      vel: b.vel,
      lockId: b.lockId,
      lockKind: b.lockKind,
    });
  }
  return out;
}

function buildThreatSources(hitTargets) {
  const threats = [];
  for (const t of hitTargets) {
    if (t.kind === 'ai' || t.kind === 'peer') {
      threats.push({ position: t.position, id: t.id, kind: t.kind });
    }
  }
  return threats;
}

function updateAimReticle(hitTargets, dt) {
  const weaponsOn =
    weapons &&
    gameMode !== 'race' &&
    !(gameMode === 'multiplayer' && !mpLobby.weapons);

  if (!weaponsOn) {
    hud.updateReticle({ visible: false });
    hud.updateThreatIndicators([]);
    hud.updateLockStatus(null);
    _aimSmoothReady = false;
    _assistStickyId = null;
    _assistStickyKind = null;
    _lockHeldActive = false;
    return;
  }

  _aimDir.copy(flight.forward).normalize();
  _aimOrigin.copy(flight.position).addScaledVector(_aimDir, 3.2);
  const aimTargets = hitTargets.filter((t) => t.kind !== 'self' && t.kind !== 'flare');
  // Touch / Android: wider cone + auto-lock (no RMB/T). Desktop: hold T/RMB.
  const touchCombat =
    input.isTouchUi && (gameMode === 'combat' || gameMode === 'multiplayer');
  const assistHit = findAimAssistTarget(_aimOrigin, _aimDir, aimTargets, {
    maxDist: touchCombat ? 560 : 520,
    coneHalf: input.lockHeld || touchCombat ? 0.55 : 0.42,
    preferId: _assistStickyId,
    preferKind: _assistStickyKind,
  });

  if (assistHit?.target) {
    _assistStickyId = assistHit.target.id;
    _assistStickyKind = assistHit.target.kind;
  } else {
    _assistStickyId = null;
    _assistStickyKind = null;
  }

  const touchAutoLock =
    touchCombat &&
    !!assistHit?.target &&
    (assistHit.target.kind === 'ai' || assistHit.target.kind === 'peer');
  const lockHeld = input.lockHeld || touchAutoLock;
  _lockHeldActive = lockHeld;

  targetLock.update(dt, hitTargets, assistHit, lockHeld, flight.position, _aimDir);
  const locked = targetLock.getLockedTarget(hitTargets);
  const hardLocked = !!locked;

  if (hardLocked) {
    _aimWorld.copy(locked.position);
  } else if (assistHit?.point) {
    _aimWorld.copy(assistHit.point);
  } else {
    _aimWorld.copy(_aimOrigin).addScaledVector(_aimDir, 260);
  }

  // Smooth aim point in world space before projection (stable soft-lock cursor).
  if (!_aimSmoothReady) {
    _aimSmooth.copy(_aimWorld);
    _aimSmoothReady = true;
  } else {
    const hz = hardLocked ? 28 : assistHit?.target ? 16 : 22;
    const a = 1 - Math.exp(-hz * Math.max(0.001, dt));
    _aimSmooth.lerp(_aimWorld, a);
  }

  _aimProj.copy(_aimSmooth).project(camera);
  const w = window.innerWidth;
  const h = window.innerHeight;
  const onScreen =
    _aimProj.z >= -1 &&
    _aimProj.z <= 1 &&
    Math.abs(_aimProj.x) <= 1.05 &&
    Math.abs(_aimProj.y) <= 1.05;

  const dist = hardLocked
    ? flight.position.distanceTo(locked.position)
    : assistHit?.dist ?? null;

  hud.updateReticle({
    visible: true,
    x: (_aimProj.x * 0.5 + 0.5) * w,
    y: (-_aimProj.y * 0.5 + 0.5) * h,
    weapon: weapons.activeId,
    locked: !!(lockHeld || assistHit?.target) && targetLock.acquireRatio > 0.03,
    hardLocked,
    acquiring: lockHeld ? targetLock.acquireRatio : assistHit ? 0.12 : 0,
    dist,
    onScreen,
    softTarget: !!assistHit?.target && !hardLocked,
  });

  if (hardLocked) {
    hud.updateLockStatus(t('targetLocked'));
  } else if (lockHeld && targetLock.acquireRatio > 0.05) {
    hud.updateLockStatus(`${t('targetLocking')} ${Math.round(targetLock.acquireRatio * 100)}%`);
  } else {
    hud.updateLockStatus(null);
  }

  if (targetLock.consumeJustLocked()) {
    hud.toast(t('targetLocked'), 1000);
    sound.playUI('success');
  }

  if (
    _prevLockId != null &&
    targetLock.lockId == null &&
    (gameMode === 'combat' || gameMode === 'multiplayer')
  ) {
    hud.toast(t('targetLost'), 1200);
  }
  _prevLockId = targetLock.lockId;

  const threats = buildThreatSources(hitTargets);
  const showThreats = gameMode === 'combat' || gameMode === 'multiplayer';
  hud.updateThreatIndicators(
    showThreats ? buildThreatMarkers(threats, camera, flight.position, targetLock) : []
  );
}

function tryFire(fi, hitTargets) {
  if (!fi.fire || !weapons) return;
  if (gameMode === 'race') return;
  if (gameMode === 'multiplayer' && !mpLobby.weapons) return;

  const origin = flight.position.clone().addScaledVector(flight.forward, 3.2);
  const locked = targetLock.getLockedTarget(hitTargets);
  const lockTarget = locked ? { id: locked.id, kind: locked.kind } : null;

  let fireDir = flight.forward.clone().normalize();
  if (locked) {
    _aimDir.subVectors(locked.position, origin).normalize();
    const bias = weapons.activeId === 'missile' ? 0.5 : weapons.activeId === 'rocket' ? 0.35 : 0.22;
    fireDir.lerp(_aimDir, bias).normalize();
  } else if (_lockHeldActive) {
    const soft = findAimAssistTarget(origin, fireDir, hitTargets, { maxDist: 520, coneHalf: 0.55 });
    if (soft?.target) {
      _aimDir.subVectors(soft.point, origin).normalize();
      fireDir.lerp(_aimDir, 0.18).normalize();
    }
  }

  const shot = weapons.fire(origin, fireDir, {
    owner: 'local',
    lockTarget,
  });
  if (!shot) return;
  if (weapons.active.sound === 'rocket') sound.playRocket();
  else sound.playGunfire(weapons.activeId === 'cannon' ? 'cannon' : 'mg');
  camRig.addShake(settings.camShake ? (weapons.activeId === 'mg' ? 0.03 : 0.08) : 0);

  if (gameMode === 'multiplayer' && match.isConnected) {
    match.sendEvent({
      type: 'fire',
      x: shot.origin.x,
      y: shot.origin.y,
      z: shot.origin.z,
      dx: shot.dir.x,
      dy: shot.dir.y,
      dz: shot.dir.z,
      weapon: shot.weapon,
      lockId: lockTarget?.id ?? null,
      lockKind: lockTarget?.kind ?? null,
    });
  }
}

function updatePlaying(dt) {
  input.pollEdges();

  if (input.pausePressed) {
    state = 'paused';
    showScreen('pause');
    sound.playUI('click');
    return;
  }
  if (input.cameraCycle) {
    const p = camRig.cycle();
    hud.toast(`${t('camera')}: ${p.label}`);
    sound.playUI('click');
  }
  if (input.weaponSlot != null && weapons) {
    if (weapons.select(input.weaponSlot)) {
      hud.toast(`${t('weapon')}: ${t(weapons.active.nameKey)}`);
      sound.playUI('click');
    } else if (!weapons.enabled[WEAPON_ORDER[input.weaponSlot]]) {
      hud.toast(t('weaponDisabled'));
      sound.playUI('warn');
    }
  }
  if (input.weaponCycle && weapons) {
    weapons.cycle(1);
    hud.toast(`${t('weapon')}: ${t(weapons.active.nameKey)}`);
    sound.playUI('click');
  }

  const fi = getFlightInputAdjusted();
  if (settings.mouseLook) {
    input.mouse.x *= settings.mouseSens;
    input.mouse.y *= settings.mouseSens;
  }

  flight.setEnvironment({
    mapWind: getMapWind(world.map, weather),
    weather,
    time: performance.now() * 0.001,
  });

  if (!(gameMode === 'multiplayer' && mpDying && !mpMatchEnded)) {
    flight.update(dt, fi, (x, z) => world.getHeight(x, z));
  }

  if (fuelDrops?.enabled) {
    const got = fuelDrops.update(dt, flight.position, (x, z) => world.getHeight(x, z));
    if (got) {
      flight.addFuel(got.amount);
      sound.playFuelPickup();
      hud.toast(`+${Math.round(got.amount)} ${t('fuel')}`);
      particles?.ringSparkle(flight.position);
    }
  }

  if (flight.fuelLimit && flight.outOfFuel) {
    if (!flight._fuelWarnLatch) {
      flight._fuelWarnLatch = true;
      hud.toast(t('outOfFuel'));
      sound.playUI('warn');
    }
  } else {
    flight._fuelWarnLatch = false;
  }

  planeGroup.position.copy(flight.position);
  planeGroup.quaternion.copy(flight.quaternion);
  updatePlaneVisuals(planeParts, {
    rollInput: fi.roll,
    pitchInput: fi.pitch,
    turnInput: fi.turn,
    yawInput: fi.turn,
    throttle: flight.throttle,
    airspeed: flight.airspeed,
    onGround: flight.onGround,
  }, dt);

  if (settings.particles) {
    // Exhaust / smoke / speed lines only once airborne & moving
    const trailOk = !flight.onGround && flight.airspeed > 32;
    if (trailOk) {
      if (flight.health < 60) {
        particles.emitExhaust(flight.position, flight.velocity, 1, flight.position.y);
      }
      particles.emitExhaust(flight.position, flight.velocity, flight.throttle, flight.position.y);
      particles.emitSmoke(flight.position, flight.velocity);
      particles.emitSpeedLines(flight.position, flight.forward, flight.airspeed / flight.maxSpeed);
    }
    particles.emitWeather(camera.position, flight.airspeed);
    particles.update(dt, true, flight.position);
  }

  const groundY = world.getHeight(flight.position.x, flight.position.z);
  const agl = Math.max(0, flight.position.y - groundY);
  const airspeedNorm = flight.airspeed / Math.max(1, flight.maxSpeed);
  sound.updateEngine({
    throttle: flight.throttle,
    airspeedNorm,
    boost: !!fi.boost,
    stalling: flight.stalling,
    spinning: flight.spinning,
    grounded: flight.onGround,
    fuelNorm: flight.fuelMax > 0 ? flight.fuel / flight.fuelMax : 1,
    outOfFuel: flight.outOfFuel,
    agl,
    verticalSpeed: flight.velocity.y,
  });
  sound.updateWind({
    airspeedNorm,
    stalling: flight.stalling,
    spinning: flight.spinning,
    grounded: flight.onGround,
    agl,
  });
  sound.setStall(flight.stalling || flight.spinning);
  sound.setListener(
    camera.position.x,
    camera.position.y,
    camera.position.z,
    flight.forward.x,
    flight.forward.y,
    flight.forward.z
  );

  if ((flight.stalling || flight.spinning) && settings.camShake) camRig.addShake(flight.spinning ? 0.028 : 0.015);

  if (gameMode === 'combat' && combat) {
    const wasStarted = combat.started;
    combat.update(
      dt,
      flight,
      (x, z) => world.getHeight(x, z),
      (pos) => {
        particles?.emitImpactExplosion(pos, { weapon: 'rocket' });
      },
      (dmg) => {
        const mods = difficultyMods(settings.difficulty);
        flight.takeDamage(dmg * mods.damageScale);
        sound.playHit();
        if (settings.camShake) camRig.addShake(0.14);
      },
      getIncomingMissiles(),
      (pos, enemyId) => {
        particles?.burstExplosion(pos, 35);
        for (const b of weapons?.bullets || []) {
          if (b.homing && b.lockId === enemyId && b.lockKind === 'ai') {
            b.lockBroken = true;
          }
        }
      }
    );
    if (!wasStarted && combat.started) {
      hud.toast(`${t('modeCombat')} — Wave ${combat.wave}!`);
    }
  }

  const hitTargets = buildHitTargets();

  tryFire(fi, hitTargets);

  weapons?.update(
    dt,
    hitTargets,
    ({ target, damage, point, owner, weapon }) => {
      handleWeaponImpact({ target, damage, point, owner, weapon });

      if (target.kind === 'ai' && target.ref) {
        if (target.ref.hit(damage)) {
          if (combat) combat.score += 250;
          hud.toast(t('enemyDown'));
          sound.playScore();
          if (targetLock.lockId === target.ref.id) targetLock.clear();
        }
      } else if (target.kind === 'peer') {
        sound.playUI('success');
        mpHub.sendDamage(damage, weapon);
      } else if (target.kind === 'self' && owner !== 'local') {
        const mods = difficultyMods(
          gameMode === 'multiplayer' ? mpLobby.difficulty : settings.difficulty
        );
        flight.takeDamage(damage * mods.damageScale);
        sound.playHit();
        if (settings.camShake) camRig.addShake(0.28);
        if (gameMode === 'multiplayer' && (flight.crashed || flight.health <= 0)) {
          handleLocalMpDeath();
        }
      }
    },
    world ? (x, z) => world.getHeight(x, z) : null
  );

  if (gameMode === 'multiplayer') updateMultiplayer(dt, fi);

  let score = 0;
  let timer = null;
  let objective = t('objectiveFree');
  const markers = [];
  if (fuelDrops?.enabled) markers.push(...fuelDrops.markers());
  if (world?.getAirportMarkers) {
    for (const ap of world.getAirportMarkers()) {
      markers.push({
        x: ap.x,
        z: ap.z,
        color: ap.primary ? '#fbbf24' : '#60a5fa',
        r: ap.primary ? 4.5 : 3.2,
      });
    }
  }
  let territoryHud = {
    radius: gameMode === 'multiplayer' ? world.mpTerritory : null,
    worldBound: world.worldBound,
    warning: false,
  };

  if (gameMode === 'multiplayer') {
    const st = flight.territoryStatus(world.mpTerritory);
    territoryHud.warning = st.t > 0.5;
  }

  if (gameMode === 'race' && race) {
    race.update(dt, flight.position, (pos) => {
      particles.ringSparkle(pos);
      sound.playScore();
      hud.toast('+RING!');
    });
    score = race.score;
    timer = race.timeLeft;
    objective = `Gate ${race.current + 1}/${race.rings.length}`;
    race.rings.forEach((r, i) => {
      if (i >= race.current) {
        markers.push({
          x: r.position.x,
          z: r.position.z,
          color: i === race.current ? '#ffd166' : '#4ade80',
          shape: 'diamond',
        });
      }
    });
    if (race.finished) {
      const best = Storage.setBest('race', Math.floor(race.score));
      if (race.score > 800) Storage.unlockSmoke('red');
      endGame(t('courseClear'), `${t('score')} ${race.score}${best ? ' ★' : ''}`);
      return;
    }
    if (race.failed || flight.crashed) {
      particles.burstExplosion(flight.position);
      sound.playCrash(flight.position.x, flight.position.y, flight.position.z);
      endGame(t('runOver'), flight.crashed ? t('youCrashed') : t('timeExpired'));
      return;
    }
  }

  if (gameMode === 'combat' && combat) {
    score = combat.score;
    objective = combat.started
      ? `Wave ${combat.wave}`
      : t('combatTakeoff');
    combat.enemies.forEach((e) => {
      if (e.alive) {
        const d = flight.position.distanceTo(e.position);
        markers.push({
          id: e.id,
          kind: 'enemy',
          x: e.position.x,
          z: e.position.z,
          color: '#f87171',
          r: 3.5,
          dist: d,
        });
      }
    });
  }

  if (gameMode === 'multiplayer') {
    objective = isMpDogfight()
      ? `${t('objectiveMp')} · ${t('mpKills')}: ${mpKills}`
      : t('objectiveMp');
    score = mpKills;
    if (!mpMatchEnded && mpMatchTimeLeft != null) {
      mpMatchTimeLeft = Math.max(0, mpMatchTimeLeft - dt);
      timer = mpMatchTimeLeft;
      if (mpMatchTimeLeft <= 0 && match.role === 'host') {
        mpHub.sendMatchEnd({ reason: 'time', kills: mpKills, deaths: mpDeaths });
        endMpMatch('time');
        return;
      }
    }
    markers.push({
      id: 'peer',
      kind: 'peer',
      x: remoteInterp.pos.x,
      z: remoteInterp.pos.z,
      color: '#60a5fa',
      r: 5,
      shape: 'diamond',
      dist: flight.position.distanceTo(remoteInterp.pos),
    });
  }

  if (gameMode === 'freeroam') {
    objective = `${mapLabel(getMap(selectedMapId), getLang())} · ${t(
      input.isTouchUi ? 'fireHintTouch' : 'fireHint'
    )}`;
    score = Math.floor(flightTime);
  }

  if (flight.crashed && gameMode !== 'race' && gameMode !== 'multiplayer') {
    particles.burstExplosion(flight.position);
    sound.playCrash(flight.position.x, flight.position.y, flight.position.z);
    if (settings.camShake) camRig.addShake(0.8);
    endGame(t('crashed'), `${Math.floor(flightTime)}s · ${t('score')} ${score}`);
    return;
  }

  const weatherOn =
    gameMode === 'multiplayer' ? mpLobby.weatherCycle !== false : settings.weatherCycle;
  const dayNightOn =
    gameMode === 'multiplayer' ? mpLobby.dayNight !== false : settings.dayNight;

  if (weatherOn) {
    weatherTimer -= dt;
    if (weatherTimer <= 0) {
      const modes = ['clear', 'clear', 'rain', 'snow'];
      weather = modes[Math.floor(Math.random() * modes.length)];
      particles.setWeather(weather);
      weatherTimer = 25 + Math.random() * 35;
      if (weather !== 'clear') {
        hud.toast(weather === 'rain' ? t('rainIn') : t('snowIn'));
      }
    }
  }

  const worldDt = dayNightOn ? dt : 0;
  world.update(worldDt, weather, flight.position, {
    advanceTime: dayNightOn,
    velocity: flight.velocity,
  });

  const shadow = planeGroup.getObjectByName('fakeShadow');
  if (shadow) {
    const gh = world.getHeight(flight.position.x, flight.position.z);
    const gap = flight.position.y - gh;
    shadow.position.y = -gap + 0.05;
    shadow.material.opacity = THREE.MathUtils.clamp(0.35 - gap * 0.01, 0, 0.3);
    shadow.visible = gap < 40;
  }

  flightTime += dt;
  const gh = world.getHeight(flight.position.x, flight.position.z);

  const modeLabel =
    gameMode === 'freeroam'
      ? t('modeFree')
      : gameMode === 'race'
        ? t('modeRace')
        : gameMode === 'multiplayer'
          ? t('modeMp')
          : t('modeCombat');

  const radarRange =
    gameMode === 'combat' ? 800 : gameMode === 'multiplayer' ? 650 : 240;

  if (!settings.camShake) camRig.shake = 0;
  camRig.update(dt, flight, {
    mouse: settings.mouseLook ? input.mouse : { x: 0, y: 0 },
    boost: fi.boost,
    getHeight: (x, z) => world.getHeight(x, z),
    camShake: settings.camShake,
  });

  updateAimReticle(hitTargets, dt);

  for (const m of markers) {
    if (m.kind === 'enemy') {
      m.locked = targetLock.isLockedOn(m.id, 'ai');
      m.color = m.locked ? '#4ade80' : '#f87171';
    } else if (m.kind === 'peer') {
      m.locked = targetLock.isLockedOn('peer', 'peer');
      m.color = m.locked ? '#4ade80' : '#60a5fa';
    }
  }

  hud.update({
    mode: modeLabel,
    score: gameMode === 'freeroam' ? Math.floor(flightTime) : score,
    timer,
    speed: flight.airspeed,
    alt: flight.position.y - gh,
    heading: flight.heading,
    throttle: flight.throttle,
    health: flight.health,
    fuel: flight.fuelLimit ? flight.fuel : null,
    fuelLimit: flight.fuelLimit,
    objective,
    stalling: flight.stalling,
    spinning: flight.spinning,
    playerPos: flight.position,
    markers,
    territory: territoryHud,
    mapTint: 'rgba(12, 36, 56, 0.82)',
    onGround: flight.onGround,
    weaponLabel: weapons ? t(weapons.active.nameKey) : '',
    radarRange,
  });
}

function updateMenu(dt) {
  syncWorldVisibility();
  if (menuPlane && menuParts) {
    menuPlane.rotation.y += dt * 0.65;
    updatePlaneVisuals(
      menuParts,
      {
        rollInput: Math.sin(performance.now() * 0.001) * 0.22,
        pitchInput: 0,
        yawInput: 0,
        throttle: 0.55,
        airspeed: 40,
        onGround: true,
      },
      dt
    );
  }
  if (world?.group?.visible) {
    world.update(dt, 'clear', camera.position, { advanceTime: false });
  }

  // Frame plane for stage-local camera (scissor renders into #menu-plane-stage)
  if (menuPlane) menuPlane.position.set(0, 1.15, 0);
  const tOrbit = performance.now() * 0.00028;
  const radius = 6.4;
  const camY = 2.35;
  const angle = Math.PI * 0.18 + Math.sin(tOrbit) * 0.32;
  camera.position.set(Math.cos(angle) * radius, camY, Math.sin(angle) * radius);
  camera.lookAt(0, 1.15, 0);
}

function isHangarPreviewVisible() {
  return !!(menuPlane && menuEl && !menuEl.classList.contains('hidden'));
}

/** Punch a transparent hole in `.menu-bg` exactly over the stage rect. */
function syncMenuStageHole() {
  const bg = menuEl?.querySelector?.('.menu-bg');
  const stage = document.getElementById('menu-plane-stage');
  if (!bg) return;
  if (!isHangarPreviewVisible() || !stage) {
    clearMenuStageHole();
    return;
  }
  const br = bg.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  if (br.width < 2 || br.height < 2 || sr.width < 2 || sr.height < 2) {
    clearMenuStageHole();
    return;
  }
  const l = ((sr.left - br.left) / br.width) * 100;
  const t = ((sr.top - br.top) / br.height) * 100;
  const r = ((sr.right - br.left) / br.width) * 100;
  const b = ((sr.bottom - br.top) / br.height) * 100;
  bg.style.clipPath = `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, ${l}% ${t}%, ${l}% ${b}%, ${r}% ${b}%, ${r}% ${t}%)`;
  bg.style.webkitClipPath = bg.style.clipPath;
}

function clearMenuStageHole() {
  const bg = menuEl?.querySelector?.('.menu-bg');
  if (!bg) return;
  bg.style.clipPath = '';
  bg.style.webkitClipPath = '';
}

function restoreFullViewport() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}

/** Render hangar plane only inside `#menu-plane-stage`. */
function renderHangarPreview() {
  const stage = document.getElementById('menu-plane-stage');
  const w = window.innerWidth;
  const h = window.innerHeight;
  syncMenuStageHole();

  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.setClearColor(0x143a5c, 1);
  renderer.clear();

  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;

  const x = Math.max(0, Math.floor(rect.left));
  const y = Math.max(0, Math.floor(h - rect.bottom));
  const rw = Math.min(Math.ceil(rect.width), w - x);
  const rh = Math.min(Math.ceil(rect.height), h - y);
  if (rw < 2 || rh < 2) return;

  camera.aspect = rw / rh;
  camera.updateProjectionMatrix();
  renderer.setScissorTest(true);
  renderer.setScissor(x, y, rw, rh);
  renderer.setViewport(x, y, rw, rh);
  renderer.render(scene, camera);
  renderer.setScissorTest(false);
}

function renderFrame() {
  if (isHangarPreviewVisible()) {
    renderHangarPreview();
    return;
  }
  clearMenuStageHole();
  restoreFullViewport();
  renderer.render(scene, camera);
}

function frame(now) {
  rafId = requestAnimationFrame(frame);

  // FPS cap
  const cap = settings.fpsCap;
  if (cap > 0) {
    const minDelta = 1000 / cap;
    frameBudget += now - lastFrameTime;
    lastFrameTime = now;
    if (frameBudget < minDelta) return;
    frameBudget %= minDelta;
  } else {
    lastFrameTime = now;
  }

  const dt = Math.min(0.05, clock.getDelta());

  // FPS counter
  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fpsValue = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0;
    fpsFrames = 0;
    if (settings.showFps && fpsEl) fpsEl.textContent = `FPS ${fpsValue}`;
  }

  if (state === 'playing') {
    // Freeze while waiting for landscape on phones
    if (!document.body.classList.contains('portrait-locked')) updatePlaying(dt);
  } else if (state === 'paused') {
    input.pollEdges();
    if (input.pausePressed) {
      state = 'playing';
      showScreen('none');
    }
  } else {
    // Menu or multiplayer lobby
    updateMenu(dt);
  }

  renderFrame();
}

let rafId = 0;
requestAnimationFrame(frame);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(rafId);
    destroyWorld();
  });
}

console.info('%cPokyPlane', 'color:#ff6b4a;font-weight:bold', '— EN/FA · settings · P2P multiplayer');
