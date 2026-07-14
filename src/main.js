/**
 * PokyPlane — main entry: scene, i18n, settings, matchmaking, loop.
 */
import * as THREE from 'three';
import { createPlane, updatePlaneVisuals } from './plane.js';
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
} from './settings.js';
import { Matchmaking, getRoomFromUrl, clearRoomFromUrl } from './matchmaking.js';
import { WeaponSystem, WEAPON_ORDER, WEAPON_DEFS, DEFAULT_WEAPON_FLAGS } from './weapons.js';
import { FuelPickups } from './fuel.js';
import { MAPS, getMap, mapLabel } from './maps.js';

// ----- Settings & audio -----
let settings = loadSettings();

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: settings.antialias,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = settings.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 900);

const sound = new SoundEngine();
const match = new Matchmaking();
const input = new Input();
const hud = new HUD();
const camRig = new CameraManager(camera);
let weapons = null;

let selectedMapId = localStorage.getItem('pokyplane_map') || 'meadow';
let mpLobby = {
  mapId: selectedMapId,
  mode: 'dogfight',
  difficulty: 'normal',
  weapons: true,
  weaponFlags: { ...DEFAULT_WEAPON_FLAGS },
  fuelLimit: false,
};

let world = null;
let particles = null;
let flight = new FlightModel();
let planeGroup = null;
let planeParts = null;
let menuPlane = null;
let menuParts = null;
let remotePlane = null;
let remoteParts = null;
let remoteInterp = {
  pos: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  targetPos: new THREE.Vector3(),
  targetQuat: new THREE.Quaternion(),
  health: 100,
  throttle: 0.5,
  skin: 1,
};

let state = 'menu';
let gameMode = 'freeroam';
let skinIndex = 1;
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
const fpsEl = document.getElementById('fps-counter');
const announceEl = document.getElementById('announce-banner');
const announceText = document.getElementById('announce-text');

function showScreen(id) {
  [menuEl, optionsEl, pauseEl, resultsEl, mpEl].forEach((el) => el?.classList.add('hidden'));
  if (id === 'menu') menuEl?.classList.remove('hidden');
  if (id === 'options') optionsEl?.classList.remove('hidden');
  if (id === 'pause') pauseEl?.classList.remove('hidden');
  if (id === 'results') resultsEl?.classList.remove('hidden');
  if (id === 'multiplayer') mpEl?.classList.remove('hidden');
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
  const on = settings.announcementEnabled && !bannerDismissed;
  announceEl.classList.toggle('hidden', !on);
  const lang = getLang();
  announceText.textContent =
    settings.announcement?.[lang] || settings.announcement?.en || '';
}

function syncLangButtons() {
  document.querySelectorAll('.lang-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === getLang());
  });
}

function buildMenuPlane() {
  if (menuPlane) scene.remove(menuPlane);
  const built = createPlane(skinIndex);
  menuPlane = built.group;
  menuParts = built.parts;
  menuPlane.position.set(0, 2, 0);
  menuPlane.scale.setScalar(1.2);
  scene.add(menuPlane);
}

function ensureWorld(mapId = selectedMapId) {
  if (!weapons) weapons = new WeaponSystem(scene);
  if (!world) {
    world = new World(scene, settings.quality, mapId);
    particles = new ParticleSystem(scene);
  } else if (world.mapId !== mapId) {
    world.rebuild(mapId, settings.quality);
  }
  selectedMapId = mapId;
  localStorage.setItem('pokyplane_map', mapId);
  applySettingsEffects();
}

function applySettingsEffects() {
  applyGraphics(settings, { renderer, world, particles, scene });
  if (world && !settings.fog) {
    scene.fog = null;
  } else if (world && settings.fog && !scene.fog) {
    scene.fog = new THREE.FogExp2(0x87b8d8, 0.0018);
  }
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
    flight.stallSpeed = settings.stallAssist ? mods.stallSpeed - 4 : mods.stallSpeed;
    // Mild sensitivity from settings (default lower for easy fun)
    const sens = 0.65 + (settings.mouseSens || 1) * 0.35;
    flight.pitchRate = 1.2 * sens;
    flight.turnRate = 1.35 * sens;
    flight.rollRate = 1.4 * sens;
  }
  updateBanner();
}

function spawnPlayerPlane() {
  if (planeGroup) scene.remove(planeGroup);
  const built = createPlane(skinIndex);
  planeGroup = built.group;
  planeParts = built.parts;
  scene.add(planeGroup);
}

function spawnRemotePlane(skin = 1) {
  if (remotePlane) scene.remove(remotePlane);
  const built = createPlane(skin);
  remotePlane = built.group;
  remoteParts = built.parts;
  remotePlane.position.set(20, 20, -20);
  scene.add(remotePlane);
}

function clearRemotePlane() {
  if (remotePlane) {
    scene.remove(remotePlane);
    remotePlane = null;
    remoteParts = null;
  }
}

function clearModes() {
  race?.dispose();
  race = null;
  combat?.dispose();
  combat = null;
  fuelDrops?.clear();
}

function startGame(mode, mapOverride = null) {
  const mapId = mapOverride || selectedMapId || document.getElementById('menu-map')?.value || 'meadow';
  ensureWorld(mapId);
  clearModes();
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

  flight = new FlightModel();
  flight.worldBound = world.worldBound;
  const mods = difficultyMods(
    mode === 'multiplayer' ? mpLobby.difficulty : settings.difficulty
  );
  flight.stallSpeed = settings.stallAssist ? mods.stallSpeed - 4 : mods.stallSpeed;
  const sens = 0.65 + (settings.mouseSens || 0.75) * 0.35;
  flight.pitchRate = 1.2 * sens;
  flight.turnRate = 1.35 * sens;
  flight.rollRate = 1.4 * sens;

  const useFuel =
    mode === 'multiplayer' ? !!mpLobby.fuelLimit : !!settings.fuelLimit;
  const diffKey = mode === 'multiplayer' ? mpLobby.difficulty : settings.difficulty;
  flight.fuelLimit = useFuel;
  flight.fuelBurn = mods.fuelBurn ?? 3.2;
  flight.fuelBoostBurn = mods.fuelBoostBurn ?? 8;
  flight.fuelMax = 100;
  flight.fuel = useFuel ? mods.startFuel ?? 100 : 100;

  const spawnZ = mode === 'multiplayer' && match.role === 'guest' ? 40 : 30;
  const spawnX = mode === 'multiplayer' && match.role === 'guest' ? 30 : 0;
  const groundY = world.getHeight(spawnX, spawnZ);
  flight.reset({ x: spawnX, y: groundY + 1.4, z: spawnZ });
  if (useFuel) flight.fuel = mods.startFuel ?? 100;

  if (!fuelDrops) fuelDrops = new FuelPickups(scene);
  fuelDrops.setEnabled(useFuel, diffKey);
  spawnPlayerPlane();
  camRig.setPreset(settings.defaultCam === 'cockpit' ? 'cockpit' : 'chase');
  camRig.snapTo(flight);

  if (mode === 'multiplayer') {
    spawnRemotePlane(remoteInterp.skin);
    document.getElementById('hud-mp')?.classList.remove('hidden');
  } else {
    clearRemotePlane();
    document.getElementById('hud-mp')?.classList.add('hidden');
  }

  showScreen('none');
  hud.show(true);
  sound.stopAmbient();
  sound.startEngine();
  sound.startWind();
  particles.setSmoke(settings.smoke);

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
    combat.spawnWave();
    hud.toast(t('combatToast'));
  } else if (mode === 'multiplayer') {
    hud.toast(t('mpToast'));
  } else {
    hud.toast(`${t('freeRoamToast')} · A/D=turn · Shift=speed · S=takeoff`);
  }
}

function endGame(title, body) {
  state = 'results';
  sound.setStall(false);
  sound.stopEngine();
  document.getElementById('results-title').textContent = title;
  document.getElementById('results-body').textContent = body;
  showScreen('results');
  hud.show(false);
}

function quitToMenu() {
  state = 'menu';
  clearModes();
  clearRemotePlane();
  sound.stopEngine();
  sound.setStall(false);
  sound.startAmbient();
  if (planeGroup) {
    scene.remove(planeGroup);
    planeGroup = null;
  }
  hud.show(false);
  showScreen('menu');
  buildMenuPlane();
  camera.position.set(6, 3, 10);
  camera.lookAt(0, 1.5, 0);
  updateBanner();
}

function restart() {
  if (gameMode === 'multiplayer' && !match.isConnected) {
    quitToMenu();
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
    'set-chunkdist-simple': String(settings.chunkDistance ?? 4),
    'set-quality': settings.quality,
    'set-fpscap': String(settings.fpsCap),
    'set-pixelratio': settings.pixelRatio,
    'set-showfps': settings.showFps,
    'set-shadows': settings.shadows,
    'set-antialias': settings.antialias,
    'set-particles': settings.particles,
    'set-fog': settings.fog,
    'set-chunkdist': String(settings.chunkDistance ?? 4),
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
    settings.chunkDistance = num('set-chunkdist-simple', settings.chunkDistance ?? 4);
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
    settings.chunkDistance = num('set-chunkdist', settings.chunkDistance ?? 4);
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
  hud.toast(t('saved'));
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
    statusEl.textContent = t('waitingPeer');
    if (codeEl) codeEl.textContent = info.roomId || '';
    if (urlEl) urlEl.value = info.inviteUrl || '';
  } else if (info.status === 'connecting') {
    box?.classList.remove('hidden');
    statusEl.textContent = t('connecting');
  } else if (info.status === 'connected') {
    box?.classList.remove('hidden');
    statusEl.textContent = t('connected');
  } else if (info.status === 'error') {
    statusEl.textContent = 'Connection error';
  }
}

match.onStatus = updateMpStatus;

match.onPeerState = (data) => {
  if (!data) return;
  remoteInterp.targetPos.set(data.x, data.y, data.z);
  remoteInterp.targetQuat.set(data.qx, data.qy, data.qz, data.qw);
  remoteInterp.health = data.health ?? 100;
  remoteInterp.throttle = data.throttle ?? 0.5;
  if (data.skin != null && data.skin !== remoteInterp.skin && remotePlane) {
    remoteInterp.skin = data.skin;
    spawnRemotePlane(data.skin);
  }
};

match.onEvent = (ev) => {
  if (ev.type === 'lobby') {
    mpLobby = {
      ...mpLobby,
      ...ev.config,
      weaponFlags: { ...DEFAULT_WEAPON_FLAGS, ...(ev.config?.weaponFlags || {}) },
    };
    weapons?.setEnabled(mpLobby.weaponFlags);
    if (match.role === 'guest' && state !== 'playing') {
      startGame('multiplayer', mpLobby.mapId);
    } else {
      ensureWorld(mpLobby.mapId);
    }
    return;
  }
  if (ev.type === 'peer-joined') {
    hud.toast(t('peerJoined'));
    sound.playUI('success');
    if (match.role === 'host') {
      match.sendEvent({ type: 'lobby', config: { ...mpLobby } });
      startGame('multiplayer', mpLobby.mapId);
    }
    // Guest waits for lobby packet
  } else if (ev.type === 'peer-left') {
    hud.toast(t('peerLeft'));
    if (gameMode === 'multiplayer' && state === 'playing') {
      endGame(t('youWin'), t('peerLeft'));
    }
  } else if (ev.type === 'fire') {
    if (!weapons) return;
    const origin = new THREE.Vector3(ev.x, ev.y, ev.z);
    const dir = new THREE.Vector3(ev.dx, ev.dy, ev.dz);
    const wpn = ev.weapon || 'mg';
    if (WEAPON_DEFS[wpn]?.sound === 'rocket') sound.playRocket();
    else sound.playGunfire();
    weapons.fire(origin, dir, {
      owner: 'remote',
      enemy: true,
      rate: 0,
      force: true,
      weapon: wpn,
    });
  } else if (ev.type === 'died') {
    endGame(t('youWin'), t('peerLeft'));
  }
};

async function hostMatch() {
  await unlockAudio();
  const flags = {
    mg: document.getElementById('mp-wpn-mg')?.checked !== false,
    cannon: document.getElementById('mp-wpn-cannon')?.checked !== false,
    rocket: document.getElementById('mp-wpn-rocket')?.checked !== false,
    missile: document.getElementById('mp-wpn-missile')?.checked !== false,
  };
  const anyOn = WEAPON_ORDER.some((id) => flags[id]);
  mpLobby = {
    mapId: document.getElementById('mp-map')?.value || selectedMapId,
    mode: document.getElementById('mp-mode')?.value || 'dogfight',
    difficulty: document.getElementById('mp-difficulty')?.value || 'normal',
    weapons: anyOn,
    weaponFlags: flags,
    fuelLimit: document.getElementById('mp-fuel-limit')?.checked === true,
  };
  try {
    const { inviteUrl, roomId } = await match.host();
    document.getElementById('mp-host-box')?.classList.remove('hidden');
    document.getElementById('mp-room-code').textContent = roomId;
    document.getElementById('mp-invite-url').value = inviteUrl;
    document.getElementById('mp-status').textContent = t('waitingPeer');
  } catch (e) {
    console.error(e);
    hud.toast('Host failed — check network');
  }
}

async function joinMatch(code) {
  await unlockAudio();
  let room = (code || '').trim();
  if (room.includes('room=')) {
    try {
      room = new URL(room).searchParams.get('room') || room;
    } catch {
      const m = room.match(/room=([^&]+)/);
      if (m) room = m[1];
    }
  }
  if (!room) return;
  try {
    document.getElementById('mp-status').textContent = t('connecting');
    document.getElementById('mp-host-box')?.classList.remove('hidden');
    await match.join(room);
    clearRoomFromUrl();
  } catch (e) {
    console.error(e);
    hud.toast('Join failed');
  }
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
    if (action === 'multiplayer') showScreen('multiplayer');
    if (action === 'close-multiplayer') showScreen('menu');
    if (action === 'mp-host') hostMatch();
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
      document.getElementById('mp-host-box')?.classList.add('hidden');
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
    if (action === 'settings-reset') {
      settings = { ...DEFAULT_SETTINGS, announcement: { ...DEFAULT_SETTINGS.announcement } };
      fillSettingsForm();
      applyAndSaveSettings();
    }
    if (action === 'resume') {
      state = 'playing';
      showScreen('none');
    }
    if (action === 'restart') restart();
    if (action === 'quit') {
      if (gameMode === 'multiplayer') await match.destroy();
      quitToMenu();
    }
  });
});

document.querySelectorAll('.skin-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await unlockAudio();
    sound.playUI('click');
    skinIndex = Number(btn.dataset.skin);
    document.querySelectorAll('.skin-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    if (state === 'menu') buildMenuPlane();
  });
});

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
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById('menu-map')?.addEventListener('change', (e) => {
  selectedMapId = e.target.value;
  localStorage.setItem('pokyplane_map', selectedMapId);
  const mpMap = document.getElementById('mp-map');
  if (mpMap) mpMap.value = selectedMapId;
});

const menuMapEl = document.getElementById('menu-map');
if (menuMapEl) menuMapEl.value = selectedMapId;
const mpMapEl = document.getElementById('mp-map');
if (mpMapEl) mpMapEl.value = selectedMapId;

window.addEventListener(
  'pointerdown',
  async () => {
    await unlockAudio();
    if (state === 'menu') sound.startAmbient();
  },
  { once: true }
);

// ----- Init -----
setLang(settings.language);
syncLangButtons();
applyDomLang();
updateBanner();
fillSettingsForm();
setSettingsMode('simple');

ensureWorld();
buildMenuPlane();
camera.position.set(6, 3, 10);
camera.lookAt(0, 1.5, 0);
showScreen('menu');
applySettingsEffects();

const menuLight = new THREE.DirectionalLight(0xffe8cc, 1);
menuLight.position.set(5, 10, 7);
scene.add(menuLight);
scene.add(new THREE.AmbientLight(0x6080a0, 0.5));
scene.background = new THREE.Color(0x1a4a7a);

// Auto-join from invite link
const urlRoom = getRoomFromUrl();
if (urlRoom) {
  showScreen('multiplayer');
  joinMatch(urlRoom);
}

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
    skin: skinIndex,
  });

  // Territory soft boundary
  const terr = flight.applyTerritoryPush(world.mpTerritory, dt);
  if (terr.t > 0.55 && Math.random() < 0.02) hud.toast(t('territoryWarn'));

  if (flight.crashed || flight.health <= 0) {
    match.sendEvent({ type: 'died' });
    particles.burstExplosion(flight.position);
    sound.playExplosion(flight.position.x, flight.position.y, flight.position.z);
    endGame(t('youLose'), t('youCrashed'));
  }
}

function tryFire(fi) {
  if (!fi.fire || !weapons) return;
  if (gameMode === 'race') return;
  if (gameMode === 'multiplayer' && !mpLobby.weapons) return;

  const origin = flight.position.clone().addScaledVector(flight.forward, 3.2);
  const shot = weapons.fire(origin, flight.forward, { owner: 'local' });
  if (!shot) return;
  if (weapons.active.sound === 'rocket') sound.playRocket();
  else sound.playGunfire();
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

  const fi = getFlightInputAdjusted();
  if (settings.mouseLook) {
    input.mouse.x *= settings.mouseSens;
    input.mouse.y *= settings.mouseSens;
  }

  flight.update(dt, fi, (x, z) => world.getHeight(x, z));

  if (fuelDrops?.enabled) {
    const got = fuelDrops.update(dt, flight.position, (x, z) => world.getHeight(x, z));
    if (got) {
      flight.addFuel(got.amount);
      sound.playUI('success');
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

  sound.updateEngine(flight.throttle);
  sound.updateWind(flight.airspeed / flight.maxSpeed);
  sound.setStall(flight.stalling);
  sound.setListener(
    camera.position.x,
    camera.position.y,
    camera.position.z,
    flight.forward.x,
    flight.forward.y,
    flight.forward.z
  );

  if (flight.stalling && settings.camShake) camRig.addShake(0.015);

  tryFire(fi);

  // Weapon hit resolution
  const hitTargets = [];
  if (gameMode === 'combat' && combat) {
    combat.enemies.forEach((e, i) => {
      if (e.alive) hitTargets.push({ position: e.position, radius: 3.5, id: i, kind: 'ai', ref: e });
    });
  }
  if (gameMode === 'multiplayer' && remotePlane) {
    hitTargets.push({
      position: remoteInterp.pos,
      radius: 3.4,
      id: 'peer',
      kind: 'peer',
      owner: 'remote',
    });
    // Let enemy missiles home toward us
    hitTargets.push({
      position: flight.position,
      radius: 3.4,
      id: 'self',
      kind: 'self',
      owner: 'local',
    });
  }
  weapons?.update(dt, hitTargets, ({ target, damage }) => {
    if (target.kind === 'ai' && target.ref) {
      if (target.ref.hit(damage)) {
        particles.burstExplosion(target.position);
        sound.playExplosion(target.position.x, target.position.y, target.position.z);
        combat.score += 250;
        hud.toast(t('enemyDown'));
      }
    } else if (target.kind === 'peer') {
      // Local confirmation juice — damage applied on their client via tracers + state
      sound.playUI('success');
      camRig.addShake(settings.camShake ? 0.12 : 0);
    }
  });

  // Apply remote bullet hits to local player
  if (gameMode === 'multiplayer' && weapons) {
    for (const b of weapons.bullets) {
      if (b.owner !== 'remote') continue;
      if (b.mesh.position.distanceTo(flight.position) < 3.2) {
        const mods = difficultyMods(mpLobby.difficulty);
        flight.takeDamage(b.damage * mods.damageScale);
        camRig.addShake(settings.camShake ? 0.3 : 0);
        b.life = 0;
      }
    }
  }

  if (gameMode === 'multiplayer') updateMultiplayer(dt, fi);

  let score = 0;
  let timer = null;
  let objective = t('objectiveFree');
  const markers = [];
  if (fuelDrops?.enabled) markers.push(...fuelDrops.markers());
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
      sound.playUI('ring');
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
      sound.playExplosion(flight.position.x, flight.position.y, flight.position.z);
      endGame(t('runOver'), flight.crashed ? t('youCrashed') : t('timeExpired'));
      return;
    }
  }

  if (gameMode === 'combat' && combat) {
    combat.update(
      dt,
      flight,
      (x, z) => world.getHeight(x, z),
      (pos) => {
        particles.burstExplosion(pos);
        sound.playExplosion(pos.x, pos.y, pos.z);
        hud.toast(t('enemyDown'));
      },
      (dmg) => {
        const mods = difficultyMods(settings.difficulty);
        flight.takeDamage(dmg * mods.damageScale);
        if (settings.camShake) camRig.addShake(0.2);
      }
    );
    score = combat.score;
    objective = `Wave ${combat.wave}`;
    combat.enemies.forEach((e) => {
      if (e.alive) markers.push({ x: e.position.x, z: e.position.z, color: '#f87171', r: 3 });
    });
  }

  if (gameMode === 'multiplayer') {
    objective = t('objectiveMp');
    score = Math.max(0, Math.floor(100 - remoteInterp.health));
    markers.push({
      x: remoteInterp.pos.x,
      z: remoteInterp.pos.z,
      color: '#f87171',
      r: 5,
      shape: 'diamond',
    });
  }

  if (gameMode === 'freeroam') {
    objective = `${mapLabel(getMap(selectedMapId), getLang())} · ${t('fireHint')}`;
    score = Math.floor(flightTime);
  }

  if (flight.crashed && gameMode !== 'race' && gameMode !== 'multiplayer') {
    particles.burstExplosion(flight.position);
    sound.playExplosion(flight.position.x, flight.position.y, flight.position.z);
    if (settings.camShake) camRig.addShake(0.8);
    endGame(t('crashed'), `${Math.floor(flightTime)}s · ${t('score')} ${score}`);
    return;
  }

  if (settings.weatherCycle) {
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

  const worldDt = settings.dayNight ? dt : 0;
  world.update(worldDt || dt * 0.0001, weather, flight.position);

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
    playerPos: flight.position,
    markers,
    territory: territoryHud,
    mapTint: 'rgba(12, 36, 56, 0.82)',
    onGround: flight.onGround,
    weaponLabel: weapons ? t(weapons.active.nameKey) : '',
  });

  if (!settings.camShake) camRig.shake = 0;
  camRig.update(dt, flight, {
    mouse: settings.mouseLook ? input.mouse : { x: 0, y: 0 },
    boost: fi.boost,
    getHeight: (x, z) => world.getHeight(x, z),
    camShake: settings.camShake,
  });
}

function updateMenu(dt) {
  if (menuPlane && menuParts) {
    menuPlane.rotation.y += dt * 0.55;
    updatePlaneVisuals(
      menuParts,
      {
        rollInput: Math.sin(performance.now() * 0.001) * 0.3,
        pitchInput: 0,
        yawInput: 0,
        throttle: 0.6,
        airspeed: 40,
        onGround: true,
      },
      dt
    );
  }
  world?.update(dt * 0.3, 'clear', camera.position);
  const tOrbit = performance.now() * 0.0003;
  camera.position.set(Math.cos(tOrbit) * 9, 3.5, Math.sin(tOrbit) * 9);
  camera.lookAt(0, 1.2, 0);
}

function frame(now) {
  requestAnimationFrame(frame);

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

  if (state === 'playing') updatePlaying(dt);
  else if (state === 'paused') {
    input.pollEdges();
    if (input.pausePressed) {
      state = 'playing';
      showScreen('none');
    }
  } else {
    // Menu or multiplayer lobby
    updateMenu(dt);
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(frame);

console.info('%cPokyPlane', 'color:#ff6b4a;font-weight:bold', '— EN/FA · settings · P2P multiplayer');
