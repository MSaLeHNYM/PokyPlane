/**
 * Minecraft-style chunked open world with streaming atmosphere.
 * Height from noise always (even for unloaded chunks).
 * Meshes stream in/out around the player.
 */
import * as THREE from 'three';
import { createNoise, deriveSeed, randomWorldSeed } from './noise.js';
import { getMap, themeBaseSeedOf } from './maps.js';
import {
  generateAirports,
  flattenForAirports,
  runwaySpawnPose,
  pickSpawnAirport,
  localToWorldXZ,
  tryGenerateChunkStrip,
  clamp,
} from './airports.js';
import { getQualityTier, normalizeQuality } from './quality.js';
import { applyMapTerrainColor, propHeightRange, sampleRawHeight } from './terrainGen.js';

export const CHUNK_SIZE = 64;
export const CHUNK_SEGS = 16;
/** Hard caps — oversized streaming can exhaust system RAM and hang the OS. */
const MAX_LOAD_RADIUS = 22;
const MAX_CHUNKS_IN_MEMORY = 1600;
const MAX_PENDING_CHUNK_KEYS = 1800;
const MAX_VIEW_DISTANCE_KM = 1000;
const MAX_HORIZON_METERS = MAX_VIEW_DISTANCE_KM * 1000;
/** Sky mesh radius cap — camera far can exceed this; fog sells ultra-long views. */
const MAX_SKY_SHELL_RADIUS = 32000;
/** Catch-up builds per frame when the queue is large (reduces visible pop-in). */
const CHUNK_BUILD_BURST = 64;

const DAY_CYCLE_SPEED = 0.0011; // ~15 min full cycle
const MORNING_TIME = 0.22;

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vDir = normalize(worldPos.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;
const skyFrag = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uNight;
  uniform float uSunElev;
  uniform vec3 uSunDir;
  uniform float uFogBoost;
  uniform float uPremium;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec3 dayCol = mix(uHorizon, uTop, smoothstep(0.0, 0.65, h));
    dayCol = mix(uHorizon * 0.92, dayCol, smoothstep(-0.05, 0.18, h));
    float nightMix = smoothstep(0.18, -0.22, uSunElev);
    vec3 nightCol = mix(uHorizon * 0.35, uNight, smoothstep(-0.02, 0.55, h));
    vec3 col = mix(dayCol, nightCol, nightMix);
    col = mix(col, uHorizon, clamp(uFogBoost * (1.0 - smoothstep(-0.08, 0.42, h)), 0.0, 0.55));

    vec3 sunAxis = normalize(uSunDir);
    float mu = max(dot(dir, sunAxis), 0.0);
    if (uSunElev > -0.12) {
      float disc = smoothstep(0.9990, 0.9999, mu);
      float glow = mu * mu * mu * mu * 0.35;
      vec3 sunTint = mix(vec3(1.0, 0.55, 0.2), vec3(1.0, 0.96, 0.85), smoothstep(0.05, 0.4, uSunElev));
      col += sunTint * (disc * 1.8 + glow);
    }

    if (uPremium > 0.5) {
      float ray = pow(1.0 - abs(h), 2.8) * (1.0 - nightMix);
      col += vec3(0.12, 0.32, 0.62) * ray * 0.42;
      float mie = pow(mu, 12.0) * (1.0 - nightMix) * max(uSunElev, 0.0);
      col += vec3(1.0, 0.88, 0.72) * mie * 0.38;
      float disc2 = smoothstep(0.9994, 0.99992, mu);
      col += vec3(1.0, 0.98, 0.94) * disc2 * 2.8 * max(uSunElev + 0.1, 0.0);
      col = pow(col, vec3(0.92));
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

const waterVert = /* glsl */ `
  uniform float uTime;
  varying float vWave;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vec3 p = position;
    float w = sin(p.x * 0.05 + uTime) * 0.4 + cos(p.z * 0.07 + uTime * 0.8) * 0.3;
    p.y += w;
    vWave = w;
    float dx = -cos(p.x * 0.05 + uTime) * 0.02;
    float dz = sin(p.z * 0.07 + uTime * 0.8) * 0.021;
    vNormal = normalize(vec3(-dx, 1.0, -dz));
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const waterFrag = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSunDir;
  uniform float uSunElev;
  uniform float uPremium;
  varying float vWave;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    float depth = clamp(0.35 + abs(vWave) * 0.4, 0.0, 1.0);
    vec3 waterCol = mix(uDeep, uShallow, depth);

    if (uPremium > 0.5) {
      vec3 R = reflect(-V, N);
      vec3 refl = mix(uSkyHorizon, uSkyTop, smoothstep(-0.15, 0.65, R.y));
      waterCol = mix(waterCol, refl, fresnel * 0.72);
      vec3 L = normalize(uSunDir);
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 180.0);
      waterCol += vec3(1.0, 0.96, 0.88) * spec * max(uSunElev, 0.0) * 0.85;
      waterCol += uSkyTop * fresnel * 0.08;
    }

    float alpha = 0.62 + fresnel * (uPremium > 0.5 ? 0.32 : 0.0);
    gl_FragColor = vec4(waterCol, alpha);
  }
`;

function makeSunCoronaTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255, 252, 235, 1)');
  g.addColorStop(0.08, 'rgba(255, 235, 160, 0.95)');
  g.addColorStop(0.22, 'rgba(255, 200, 80, 0.55)');
  g.addColorStop(0.42, 'rgba(255, 140, 50, 0.22)');
  g.addColorStop(0.62, 'rgba(255, 90, 30, 0.08)');
  g.addColorStop(0.82, 'rgba(255, 60, 15, 0.02)');
  g.addColorStop(1, 'rgba(255, 40, 10, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

// Reusable scratch colors — avoids per-vertex allocations while building chunks.
const _tmpColorA = new THREE.Color();
const _tmpColorB = new THREE.Color();

export class World {
  constructor(scene, quality = 'medium', mapId = 'meadow', worldSeed = null) {
    this.scene = scene;
    this.quality = normalizeQuality(quality);
    this._tier = getQualityTier(this.quality);
    this.mapId = mapId;
    this.worldSeed = worldSeed == null ? randomWorldSeed() : worldSeed >>> 0;
    this.map = this._bindMap(mapId, this.worldSeed);
    this.noise = createNoise(this.map.seed);
    this.dayTime = MORNING_TIME;
    this.dayCycleSpeed = DAY_CYCLE_SPEED;
    this.viewDistanceKm = 1;
    this.viewDistanceMeters = 1000;
    this.chunks = new Map();
    this._chunkBuildBudget = 0;
    this.airports = [];
    this.airportMeshes = [];
    this.stripSpawnChance = 5;
    this._stripTried = new Set();
    this._airportMats = null;
    this._shadowsEnabled = false;
    this._preloading = false;
    this._horizonTerrain = null;
    this._horizonSx = null;
    this._horizonSz = null;
    this._horizonMat = null;
    this._horizonCut = null;
    this._viewerAltitude = 0;
    this._sunDir = new THREE.Vector3(1, 0.5, 0);
    this._skyRadius = 1400;
    // Shared GPU resources — avoids VRAM churn while chunks stream in/out.
    this._terrainMat = null;
    this._propGeo = {};
    this._propMat = {};
    this._geoPool = [];
    /** Single FogExp2 instance — never recreate per frame (that leaks shader RAM). */
    this._sceneFog = null;
    this._fogEnabled = false;
    /** Terrain meshes only stream while playing — never on menu / idle. */
    this._streamingEnabled = false;
    this.group = new THREE.Group();
    this.group.name = 'chunkWorld';
    this.atmosphereGroup = new THREE.Group();
    this.atmosphereGroup.name = 'atmosphere';
    scene.add(this.atmosphereGroup);
    scene.add(this.group);

    this.uniforms = {
      water: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(this.map.waterDeep) },
        uShallow: { value: new THREE.Color(this.map.waterShallow) },
        uSkyTop: { value: new THREE.Color(this.map.skyTop) },
        uSkyHorizon: { value: new THREE.Color(this.map.skyHorizon) },
        uSunDir: { value: new THREE.Vector3(1, 0.5, 0.3) },
        uSunElev: { value: 0.5 },
        uPremium: { value: this._tier.premium ? 1 : 0 },
      },
      sky: {
        uTop: { value: new THREE.Color(this.map.skyTop) },
        uHorizon: { value: new THREE.Color(this.map.skyHorizon) },
        uNight: { value: new THREE.Color(0x060e1c) },
        uSunElev: { value: 0.5 },
        uSunDir: { value: new THREE.Vector3(1, 0.5, 0.3) },
        uFogBoost: { value: 0 },
        uPremium: { value: this._tier.premium ? 1 : 0 },
      },
    };

    this._buildGlobals();
    this._initAirports();
    this._rebuildHorizonTerrain();
    this._lastCx = null;
    this._lastCz = null;
    this._pendingChunkKeys = [];
    this._chunkLoadPending = false;
  }

  /** Merge theme + runtime worldSeed into a map object used by height/color/RNG. */
  _bindMap(mapId, worldSeed) {
    const theme = getMap(mapId);
    const themeBase = themeBaseSeedOf(theme);
    const ws = worldSeed >>> 0;
    return {
      ...theme,
      themeBaseSeed: themeBase,
      worldSeed: ws,
      seed: deriveSeed(ws, themeBase, 1),
      channels: {
        height: deriveSeed(ws, themeBase, 1),
        warp: deriveSeed(ws, themeBase, 2),
        mountains: deriveSeed(ws, themeBase, 3),
        moisture: deriveSeed(ws, themeBase, 4),
        props: deriveSeed(ws, themeBase, 5),
      },
    };
  }

  /** Start terrain streaming (call when entering a flight session). */
  enableStreaming(x = 0, z = 0) {
    this._streamingEnabled = true;
    this._lastCx = null;
    this._lastCz = null;
    this._pendingChunkKeys = [];
    this._chunkLoadPending = true;
    this.updateChunks(x, z, true);

    // Preload entire visible ring as fast as possible.
    this._preloading = true;
    let guard = 0;
    const guardMax = MAX_CHUNKS_IN_MEMORY + MAX_PENDING_CHUNK_KEYS;
    while (this._pendingChunkKeys.length && guard < guardMax) {
      guard += 1;
      this.updateChunks(x, z, false);
    }
    this._preloading = false;
    this._rebuildChunksNearAirports();
    if (Number.isFinite(x) && Number.isFinite(z)) {
      this._updateHorizonTerrainFollow(x, z);
    }
  }

  /** Stop streaming and drop all terrain meshes to free RAM. */
  disableStreaming() {
    this._streamingEnabled = false;
    this._chunkLoadPending = false;
    this._pendingChunkKeys = [];
    this.clearTerrainChunks();
  }

  clearTerrainChunks() {
    for (const ch of this.chunks.values()) this._disposeChunk(ch);
    this.chunks.clear();
    this._lastCx = null;
    this._lastCz = null;
  }

  /** Per-chunk runway strip spawn chance (0–100). */
  setStripSpawnChance(percent) {
    this.stripSpawnChance = clamp(Number(percent) || 0, 0, 100);
  }

  /** Requested view radius in chunks (2–16). Fog/horizon scale; mesh load is capped separately. */
  /** Toggle distance fog — only terrain uses Three.js fog (safe); sky uses uFogBoost. */
  setFogEnabled(enabled) {
    const on = !!enabled;
    if (on === this._fogEnabled && (!!this._sceneFog) === on) return;
    this._fogEnabled = on;

    if (on) {
      if (!this._sceneFog) {
        this._sceneFog = new THREE.FogExp2(this.map.fog, this._fogDensityForView());
      } else {
        this._sceneFog.color.set(this.map.fog);
        this._sceneFog.density = this._fogDensityForView();
      }
      this.scene.fog = this._sceneFog;
    } else {
      this.scene.fog = null;
    }

    if (this._terrainMat) this._terrainMat.fog = on;
    if (this.uniforms?.sky?.uFogBoost) this.uniforms.sky.uFogBoost.value = on ? 1 : 0;
  }

  /** Weather adjusts the single fog instance — no object churn. */
  _updateFogDensity(weather = 'clear') {
    if (!this._fogEnabled || !this._sceneFog) return;
    const base = this._fogDensityForView();
    this._sceneFog.density =
      weather === 'clear' ? base : weather === 'rain' ? base * 1.6 : base * 1.35;
  }

  setViewDistanceKm(km) {
    const k = Math.max(0.25, Math.min(MAX_VIEW_DISTANCE_KM, Number(km) || 1));
    if (k === this.viewDistanceKm) return;
    this.viewDistanceKm = k;
    this.viewDistanceMeters = k * 1000;
    this._resizeAtmosphere();
    this._lastCx = null;
    if (this._streamingEnabled) this._chunkLoadPending = true;
    if (this._fogEnabled) this._updateFogDensity('clear');
    this._rebuildHorizonTerrain();
  }

  /** @deprecated use setViewDistanceKm */
  setViewRadius(n) {
    this.setViewDistanceKm((Number(n) * CHUNK_SIZE) / 1000);
  }

  /** Chunks actually loaded around the player — scales with view distance + altitude. */
  get loadRadius() {
    const tier = this._tier || getQualityTier(this.quality);
    const km = this.viewDistanceKm || 1;
    let target = tier.loadRadius;
    if (km >= 1000) target = 22;
    else if (km >= 500) target = 18;
    else if (km >= 100) target = 14;
    else if (km >= 25) target = 10;
    else if (km >= 10) target = 8;
    const alt = this._viewerAltitude || 0;
    if (alt > 200) target += 3;
    else if (alt > 80) target += 2;
    return Math.max(2, Math.min(MAX_LOAD_RADIUS, target));
  }

  getSkyShellRadius() {
    const horizon = this.getHorizonMeters();
    return Math.min(MAX_SKY_SHELL_RADIUS, Math.max(1400, 900 + Math.sqrt(horizon) * 14));
  }

  /** Chunks built per frame while streaming — scales up when catching up. */
  get chunkBuildBudget() {
    return getQualityTier(this.quality).chunkBuildBudget;
  }

  _effectiveBuildBudget() {
    if (this._preloading) return Math.max(this._pendingChunkKeys.length, this.chunkBuildBudget);
    const base = this.chunkBuildBudget;
    const pending = this._pendingChunkKeys.length;
    if (pending <= 0) return base;
    if (pending > 32) return Math.min(CHUNK_BUILD_BURST, pending);
    if (pending > 12) return Math.min(Math.max(base * 2, 16), pending);
    return Math.max(base, Math.min(12, pending));
  }

  _sortPendingByDistance(cx, cz) {
    const bx = this._loadBiasX || 0;
    const bz = this._loadBiasZ || 0;
    const bias = bx * bx + bz * bz > 0.01;
    this._pendingChunkKeys.sort((a, b) => {
      const [ax, az] = a.split(',').map(Number);
      const [bxk, bzk] = b.split(',').map(Number);
      let da = (ax - cx) ** 2 + (az - cz) ** 2;
      let db = (bxk - cx) ** 2 + (bzk - cz) ** 2;
      if (bias) {
        da -= ((ax - cx) * bx + (az - cz) * bz) * 48;
        db -= ((bxk - cx) * bx + (bzk - cz) * bz) * 48;
      }
      return da - db;
    });
  }

  get renderDistanceMeters() {
    return this.viewDistanceMeters;
  }

  /** Visual horizon (sky / sun / water / camera). */
  getHorizonMeters() {
    return Math.min(this.viewDistanceMeters, MAX_HORIZON_METERS);
  }

  getClipDistance() {
    return Math.max(1200, this.getHorizonMeters() * 1.15 + 320);
  }

  /** Camera far plane must exceed sky shell radius. */
  getCameraFar() {
    return this.getClipDistance() + 500;
  }

  setTimeOfDay(t = MORNING_TIME) {
    this.dayTime = ((t % 1) + 1) % 1;
    this._applyLighting(0, null, false);
  }

  setShadowsEnabled(on) {
    this._shadowsEnabled = !!on;
    if (this.sun) this.sun.castShadow = this._shadowsEnabled;
    for (const ch of this.chunks.values()) {
      if (ch?.mesh) ch.mesh.receiveShadow = this._shadowsEnabled;
    }
    for (const m of this.airportMeshes) {
      if (m) m.receiveShadow = this._shadowsEnabled;
    }
  }

  /** Rebuild sun/moon meshes when quality preset changes. */
  setQuality(quality) {
    const q = normalizeQuality(quality);
    if (q === this.quality) return;
    this.quality = q;
    this._tier = getQualityTier(q);
    this._applyTierToMaterials();
    if (this.uniforms?.sky?.uPremium) {
      this.uniforms.sky.uPremium.value = this._tier.premium ? 1 : 0;
    }
    if (this.uniforms?.water?.uPremium) {
      this.uniforms.water.uPremium.value = this._tier.premium ? 1 : 0;
    }
    if (this.hemi) this.hemi.intensity = this._tier.hemiIntensity;
    if (this.sun) {
      this.sun.intensity = this._tier.sunIntensity;
      this.sun.castShadow = this._shadowsEnabled;
      this.sun.shadow.mapSize.set(this._tier.shadowMapSize, this._tier.shadowMapSize);
    }
    if (this.amb) this.amb.intensity = this._tier.ambIntensity;
    this._disposeSunMoonVisuals();
    this._buildSunVisual();
    this._buildMoonVisual();
    this._rebuildCloudField();
    this._resizeAtmosphere();
  }

  _applyTierToMaterials() {
    const tier = this._tier;
    if (this._terrainMat) {
      this._terrainMat.flatShading = tier.terrainFlat;
      this._terrainMat.roughness = tier.terrainRoughness;
      this._terrainMat.metalness = tier.terrainMetalness;
      this._terrainMat.needsUpdate = true;
    }
    for (const mat of Object.values(this._propMat)) {
      if (mat) {
        mat.flatShading = tier.propsFlat;
        mat.roughness = tier.premium ? 0.82 : 0.94;
        mat.needsUpdate = true;
      }
    }
  }

  _disposeSunMoonVisuals() {
    for (const ref of [this.sunVisual, this.moonVisual]) {
      if (!ref) continue;
      this.atmosphereGroup?.remove(ref);
      ref.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) {
          o.material.map?.dispose?.();
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
          else o.material.dispose?.();
        }
      });
    }
    this.sunVisual = this.moonVisual = null;
    this.sunCore = this.sunInnerGlow = this.sunOuterGlow = this.sunCorona = null;
    this.moonCore = null;
  }

  get worldBound() {
    return Infinity;
  }

  get mpTerritory() {
    return this.map.mpTerritory ?? 220;
  }

  rebuild(mapId, quality = this.quality, worldSeed = null) {
    const nextSeed =
      worldSeed == null
        ? this.worldSeed != null
          ? this.worldSeed
          : randomWorldSeed()
        : worldSeed >>> 0;
    this.dispose();
    this.quality = normalizeQuality(quality);
    this._tier = getQualityTier(this.quality);
    this.mapId = mapId;
    this.worldSeed = nextSeed;
    this.map = this._bindMap(mapId, nextSeed);
    this.noise = createNoise(this.map.seed);
    this.uniforms.water.uDeep.value.set(this.map.waterDeep);
    this.uniforms.water.uShallow.value.set(this.map.waterShallow);
    this.uniforms.sky.uTop.value.set(this.map.skyTop);
    this.uniforms.sky.uHorizon.value.set(this.map.skyHorizon);
    this.group = new THREE.Group();
    this.group.name = 'chunkWorld';
    this.scene.add(this.group);
    if (!this.atmosphereGroup) {
      this.atmosphereGroup = new THREE.Group();
      this.atmosphereGroup.name = 'atmosphere';
      this.scene.add(this.atmosphereGroup);
    }
    this.chunks = new Map();
    this.dayTime = MORNING_TIME;
    this._stripTried = new Set();
    this._viewerAltitude = 0;
    this._buildGlobals();
    this._initAirports();
    this._rebuildHorizonTerrain();
    this._streamingEnabled = false;
    this._lastCx = null;
    this._pendingChunkKeys = [];
    this._chunkLoadPending = false;
  }

  dispose() {
    for (const ch of this.chunks.values()) this._disposeChunk(ch);
    this.chunks.clear();
    const disposeGroup = (grp) => {
      if (!grp) return;
      this.scene.remove(grp);
      grp.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
          else {
            o.material.map?.dispose?.();
            o.material.dispose?.();
          }
        }
      });
    };
    disposeGroup(this.group);
    disposeGroup(this.atmosphereGroup);
    this._disposeSharedResources();
    this.scene.fog = null;
    this._sceneFog = null;
    this.group = null;
    this.atmosphereGroup = null;
    this.sky = this.water = this.sun = this.hemi = this.amb = null;
    this.airportMeshes = [];
    this.sunVisual = this.moonVisual = null;
  }

  _initAirports() {
    this.airports = generateAirports(this.map, (x, z) => this._rawHeight(x, z));
    this._stripTried = new Set();
    this._buildAirports();
  }

  getMainAirport() {
    return this.airports.find((a) => a.primary) || this.airports[0];
  }

  /**
   * @param {number} randomChancePercent
   * @param {'host'|'guest'} role
   */
  pickSpawn(randomChancePercent = 5, role = 'host') {
    const ap = pickSpawnAirport(this.airports, randomChancePercent);
    const pose = runwaySpawnPose(ap, role);
    const y = this.getHeight(pose.x, pose.z);
    return {
      x: pose.x,
      z: pose.z,
      y,
      heading: pose.heading,
    pitch: 0,
    roll: 0,
    airport: ap,
      random: !ap.primary,
    };
  }

  getAirportMarkers() {
    return this.airports.map((ap) => ({
      x: ap.x,
      z: ap.z,
      primary: !!ap.primary,
      label: ap.name,
    }));
  }

  _rawHeight(x, z) {
    return sampleRawHeight(x, z, this.noise, this.map);
  }

  _applyTerrainColor(h, c, c2, m) {
    applyMapTerrainColor(h, c, c2, m);
  }

  sampleHeight(x, z) {
    let h = this._rawHeight(x, z);
    h = flattenForAirports(x, z, h, this.airports);
    return h;
  }

  getHeight(x, z) {
    return this.sampleHeight(x, z);
  }

  _waterPlaneSize() {
    // Keep water modest — oversized sheets look like a flat plane over land from altitude.
    const chunkDisk = this.loadRadius * CHUNK_SIZE * 2.2;
    const islands = this.mapId === 'islands';
    const cap = islands ? 24000 : 10000;
    const min = islands ? 6000 : 3200;
    return Math.min(cap, Math.max(min, chunkDisk * (islands ? 1.6 : 1.25)));
  }

  _resizeAtmosphere() {
    const clip = this.getClipDistance();
    const skyR = this.getSkyShellRadius();
    this._skyRadius = skyR;

    if (this.sky) {
      this.sky.geometry.dispose();
      const [sw, sh] = this._tier.skySegs;
      this.sky.geometry = new THREE.SphereGeometry(skyR, sw, sh);
    }
    if (this.water) {
      const waterSize = this._waterPlaneSize();
      this.water.geometry.dispose();
      this.water.geometry = new THREE.PlaneGeometry(
        waterSize,
        waterSize,
        this._tier.waterSegs,
        this._tier.waterSegs
      );
    }
    if (this.sun?.shadow?.camera) {
      const sc = this.sun.shadow.camera;
      const ext = Math.min(220, 80 + this.loadRadius * 6);
      sc.left = sc.bottom = -ext;
      sc.right = sc.top = ext;
      sc.far = Math.min(800, clip * 0.6);
    }
    this._rebuildHorizonTerrain();
    return clip;
  }

  /** Far terrain ring — always on so altitude never falls into empty water. */
  _horizonTerrainRadius() {
    const km = this.viewDistanceKm || 1;
    const chunkExtent = this.loadRadius * CHUNK_SIZE * 3.2;
    if (km >= 1000) return Math.max(90000, chunkExtent);
    if (km >= 500) return Math.max(60000, chunkExtent);
    if (km >= 100) return Math.max(36000, chunkExtent);
    if (km >= 25) return Math.max(20000, chunkExtent);
    if (km >= 10) return Math.max(12000, chunkExtent);
    return Math.max(7000, chunkExtent * 1.25);
  }

  _disposeHorizonTerrain() {
    if (!this._horizonTerrain) return;
    this.group.remove(this._horizonTerrain);
    this._horizonTerrain.geometry?.dispose?.();
    this._horizonTerrain = null;
    this._horizonSx = null;
    this._horizonSz = null;
  }

  _disposeHorizonMaterial() {
    this._horizonMat?.dispose?.();
    this._horizonMat = null;
    this._horizonCut = null;
  }

  _ensureHorizonMaterial() {
    if (this._horizonMat || !this._terrainMat) return;
    this._horizonMat = this._terrainMat.clone();
    this._horizonMat.polygonOffset = true;
    this._horizonMat.polygonOffsetFactor = 2;
    this._horizonMat.polygonOffsetUnits = 2;
    this._horizonMat.depthWrite = true;
    // Punch a hole under the streamed chunk disk so the coarse horizon
    // mesh cannot form flat "lids" across valleys / depressions.
    this._horizonCut = {
      uPlayerXZ: { value: new THREE.Vector2(0, 0) },
      uInnerR2: { value: 1 },
    };
    this._horizonMat.onBeforeCompile = (shader) => {
      shader.uniforms.uPlayerXZ = this._horizonCut.uPlayerXZ;
      shader.uniforms.uInnerR2 = this._horizonCut.uInnerR2;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vHorizonWorld;`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
vHorizonWorld = worldPosition.xyz;`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec2 uPlayerXZ;
uniform float uInnerR2;
varying vec3 vHorizonWorld;`
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
vec2 hDelta = vHorizonWorld.xz - uPlayerXZ;
if (dot(hDelta, hDelta) < uInnerR2) discard;`
        );
    };
    this._horizonMat.customProgramCacheKey = () => 'horizon-cut-v1';
  }

  _syncHorizonCutout(x, z) {
    if (!this._horizonCut) return;
    // Slightly larger than the loaded chunk disk so the seam sits outside detail meshes.
    const inner = Math.max(CHUNK_SIZE * 2, this.loadRadius * CHUNK_SIZE * 1.2);
    this._horizonCut.uPlayerXZ.value.set(x, z);
    this._horizonCut.uInnerR2.value = inner * inner;
  }

  /**
   * Real heights everywhere — no -999 hole (that exposed the water sheet as a
   * flat plane with only mountain tops poking through).
   * Inner disk is discarded in the shader instead (see _ensureHorizonMaterial).
   */
  _fillHorizonTerrainGeo(geo, centerX, centerZ) {
    const pos = geo.attributes.position;
    const colorAttr = geo.attributes.color;
    const colors = colorAttr.array;
    const c = _tmpColorA;
    const c2 = _tmpColorB;
    const m = this.map;
    const pa = pos.array;
    for (let i = 0; i < pos.count; i++) {
      const i3 = i * 3;
      const lx = pa[i3];
      const lz = pa[i3 + 2];
      const wx = centerX + lx;
      const wz = centerZ + lz;
      const h = this.sampleHeight(wx, wz);
      pa[i3 + 1] = h;
      this._applyTerrainColor(h, c, c2, m);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    pos.needsUpdate = true;
    colorAttr.needsUpdate = true;
    geo.computeVertexNormals();
  }

  _rebuildHorizonTerrain() {
    this._disposeHorizonTerrain();
    if (!this._terrainMat) return;
    this._ensureHorizonMaterial();
    const radius = this._horizonTerrainRadius();
    if (radius <= 0) return;

    const km = this.viewDistanceKm || 1;
    const segs = km >= 1000 ? 128 : km >= 100 ? 96 : km >= 25 ? 80 : km >= 10 ? 72 : 64;
    const size = radius * 2;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const count = (segs + 1) * (segs + 1);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this._fillHorizonTerrainGeo(geo, 0, 0);
    this._horizonTerrain = new THREE.Mesh(geo, this._horizonMat);
    this._horizonTerrain.frustumCulled = false;
    this._horizonTerrain.receiveShadow = false;
    this._horizonTerrain.renderOrder = -5;
    this.group.add(this._horizonTerrain);
  }

  _updateHorizonTerrainFollow(x, z) {
    if (!this._horizonTerrain) return;
    const radius = this._horizonTerrainRadius();
    if (radius <= 0) return;
    this._syncHorizonCutout(x, z);
    const snap = Math.max(1600, radius * 0.2);
    const sx = Math.floor(x / snap) * snap;
    const sz = Math.floor(z / snap) * snap;
    if (sx !== this._horizonSx || sz !== this._horizonSz) {
      this._horizonSx = sx;
      this._horizonSz = sz;
      this._fillHorizonTerrainGeo(this._horizonTerrain.geometry, sx, sz);
    }
    this._horizonTerrain.position.set(sx, 0, sz);
  }

  /**
   * Build once-per-map shared geometries/materials reused by every chunk and
   * prop. Sharing (instead of per-chunk allocation) prevents the GPU memory
   * churn that could crash the driver while flying.
   */
  _buildSharedResources() {
    const m = this.map;
    const tier = this._tier;

    this._terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: tier.terrainRoughness,
      metalness: tier.terrainMetalness,
      flatShading: tier.terrainFlat,
      fog: false,
    });

    const geo = {};
    const mat = {};
    if (m.props === 'rocks' || m.props === 'cactus') {
      geo.rock =
        m.props === 'cactus'
          ? new THREE.CylinderGeometry(0.2, 0.32, 2.2, 5)
          : new THREE.DodecahedronGeometry(0.8, 0);
      mat.rock = new THREE.MeshStandardMaterial({
        color: m.props === 'cactus' ? 0x3a7a3a : m.rockColor,
        flatShading: tier.propsFlat,
        roughness: tier.premium ? 0.8 : 0.94,
        fog: false,
      });
    } else {
      const pines = m.props === 'pines';
      const palms = m.props === 'palms';
      geo.trunk = new THREE.CylinderGeometry(0.1, 0.18, 1.1, 5);
      geo.leaf = new THREE.ConeGeometry(pines ? 0.8 : palms ? 1.1 : 1.0, pines ? 2.6 : palms ? 2.8 : 2.0, 6);
      mat.trunk = new THREE.MeshStandardMaterial({
        color: m.treeTrunk,
        flatShading: tier.propsFlat,
        roughness: tier.premium ? 0.85 : 0.94,
        fog: false,
      });
      mat.leaf = new THREE.MeshStandardMaterial({
        color: m.treeLeaf,
        flatShading: tier.propsFlat,
        roughness: tier.premium ? 0.78 : 0.94,
        fog: false,
      });
    }
    this._propGeo = geo;
    this._propMat = mat;
  }

  _disposeSharedResources() {
    this._disposeHorizonTerrain();
    this._disposeHorizonMaterial();
    this._terrainMat?.dispose?.();
    this._terrainMat = null;
    for (const g of Object.values(this._propGeo)) g?.dispose?.();
    for (const mm of Object.values(this._propMat)) mm?.dispose?.();
    this._propGeo = {};
    this._propMat = {};
    for (const g of this._geoPool) g.dispose?.();
    this._geoPool = [];
    this._cloudPuffGeo?.dispose?.();
    this._cloudPuffGeo = null;
    if (this._cloudMats) {
      for (const m of this._cloudMats) m.dispose?.();
      this._cloudMats = null;
    }
    if (this._airportMats) {
      this._airportMats.runway.map?.dispose?.();
      for (const m of Object.values(this._airportMats)) m.dispose?.();
      this._airportMats = null;
    }
  }

  /** Reuse a pooled terrain geometry (same vertex layout) or build a fresh one. */
  _acquireChunkGeometry(segs) {
    const wanted = (segs + 1) * (segs + 1);
    for (let i = this._geoPool.length - 1; i >= 0; i--) {
      const g = this._geoPool[i];
      if (g.attributes.position.count === wanted) {
        this._geoPool.splice(i, 1);
        return g;
      }
    }
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, segs, segs);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(wanted * 3), 3)
    );
    return geo;
  }

  _recycleChunkGeometry(geo) {
    if (!geo) return;
    if (this._geoPool.length < 2048) this._geoPool.push(geo);
    else geo.dispose();
  }

  _buildGlobals() {
    const m = this.map;
    const clip = this.getClipDistance();
    const skyR = this.getSkyShellRadius();
    this._skyRadius = skyR;
    const atmos = this.atmosphereGroup;

    this._buildSharedResources();

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(skyR, this._tier.skySegs[0], this._tier.skySegs[1]),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms.sky,
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      })
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    atmos.add(this.sky);

    const waterSize = this._waterPlaneSize();
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(waterSize, waterSize, this._tier.waterSegs, this._tier.waterSegs),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms.water,
        vertexShader: waterVert,
        fragmentShader: waterFrag,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: false,
      })
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, m.waterY ?? 0, 0);
    this.water.frustumCulled = false;
    this.water.renderOrder = -1;
    this.group.add(this.water);

    this.hemi = new THREE.HemisphereLight(m.hemiSky, m.hemiGround, this._tier.hemiIntensity);
    atmos.add(this.hemi);
    this.sun = new THREE.DirectionalLight(m.sun, this._tier.sunIntensity);
    this.sun.position.set(100, 140, 60);
    this.sun.castShadow = this._shadowsEnabled;
    this.sun.shadow.mapSize.set(this._tier.shadowMapSize, this._tier.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.near = 10;
    sc.far = Math.min(800, clip * 0.6);
    const ext = Math.min(220, 80 + this.loadRadius * 6);
    sc.left = sc.bottom = -ext;
    sc.right = sc.top = ext;
    atmos.add(this.sun);
    atmos.add(this.sun.target);

    this.amb = new THREE.AmbientLight(0x5080a0, this._tier.ambIntensity);
    atmos.add(this.amb);

    this._buildSunVisual();
    this._buildMoonVisual();

    this._buildCloudField();
  }

  _fogDensityForView() {
    const base = this.map.fogDensity * 0.85;
    const km = Math.max(0.25, this.viewDistanceKm || 1);
    const distFactor = THREE.MathUtils.clamp(1 / Math.sqrt(km), 0.006, 1.2);
    return base * distFactor;
  }

  /**
   * Sun mesh sizes are fixed (not tied to sky radius) so high view distance
   * cannot blow up fill-rate and crash the GPU driver.
   */
  _sunVisualParams() {
    const t = this._tier;
    return {
      coreR: t.sunCore,
      corona: t.sunCorona,
      coronaTex: t.sunCoronaTex,
      segs: t.sunSegs,
      innerMul: t.sunInnerMul,
      outerGlow: t.sunOuterGlow,
      outerMul: t.sunOuterMul ?? 0,
      coronaOpacity: t.premium ? 0.92 : t.id === 'high' ? 0.82 : 0.65,
    };
  }

  _buildSunVisual() {
    const p = this._sunVisualParams();
    this._sunCoronaBase = p.corona;
    this.sunOuterGlow = null;
    this.sunUniforms = null;

    if (p.coreR <= 0 && p.corona <= 0) {
      this.sunVisual = null;
      this.sunCore = null;
      this.sunInnerGlow = null;
      this.sunCorona = null;
      return;
    }

    const group = new THREE.Group();
    group.name = 'sunVisual';
    group.frustumCulled = false;
    group.renderOrder = 50;

    if (p.coreR > 0) {
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(p.coreR, p.segs, Math.max(6, p.segs - 2)),
        new THREE.MeshBasicMaterial({
          color: 0xfff6dc,
          fog: false,
          toneMapped: false,
          depthTest: false,
          depthWrite: false,
        })
      );
      core.renderOrder = 52;
      group.add(core);
      this.sunCore = core;

      const innerGlow = new THREE.Mesh(
        new THREE.SphereGeometry(p.coreR * p.innerMul, Math.max(6, p.segs - 2), Math.max(4, p.segs - 4)),
        new THREE.MeshBasicMaterial({
          color: 0xffcc44,
          transparent: true,
          opacity: this._tier.premium ? 0.58 : this._tier.id === 'high' ? 0.5 : 0.38,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          fog: false,
          side: THREE.DoubleSide,
        })
      );
      innerGlow.renderOrder = 51;
      group.add(innerGlow);
      this.sunInnerGlow = innerGlow;

      if (p.outerGlow) {
        const outerGlow = new THREE.Mesh(
          new THREE.SphereGeometry(p.coreR * p.outerMul, 8, 6),
          new THREE.MeshBasicMaterial({
            color: 0xff7722,
            transparent: true,
            opacity: 0.16,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            fog: false,
            side: THREE.DoubleSide,
          })
        );
        outerGlow.renderOrder = 50;
        group.add(outerGlow);
        this.sunOuterGlow = outerGlow;
      }
    } else {
      this.sunCore = null;
      this.sunInnerGlow = null;
    }

    if (p.corona > 0) {
      const corona = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeSunCoronaTexture(p.coronaTex),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
          fog: false,
          opacity: p.coronaOpacity,
        })
      );
      corona.scale.set(p.corona, p.corona, 1);
      corona.renderOrder = 49;
      group.add(corona);
      this.sunCorona = corona;
    } else {
      this.sunCorona = null;
    }

    this.sunVisual = group;
    this.atmosphereGroup.add(group);
  }

  _buildMoonVisual() {
    const tier = this._tier;
    const moonR = tier.moonR;
    const [mw, mh] = tier.moonSegs;
    const group = new THREE.Group();
    group.name = 'moonVisual';
    group.frustumCulled = false;

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(moonR, mw, mh),
      new THREE.MeshStandardMaterial({
        color: 0xd8e0f0,
        emissive: tier.premium ? 0x99aacc : 0x8899bb,
        emissiveIntensity: tier.premium ? 0.45 : 0.35,
        roughness: tier.premium ? 0.75 : 0.9,
        metalness: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      })
    );
    core.renderOrder = 100;
    group.add(core);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(moonR * 1.65, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xa8c0e8,
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        side: THREE.DoubleSide,
      })
    );
    halo.renderOrder = 99;
    group.add(halo);

    this.moonVisual = group;
    this.moonCore = core;
    this.atmosphereGroup.add(group);
  }

  _rebuildCloudField() {
    if (this.cloudField) {
      this.atmosphereGroup?.remove(this.cloudField);
      this.cloudField.traverse((o) => {
        if (o !== this.cloudField && o.geometry !== this._cloudPuffGeo) {
          o.geometry?.dispose?.();
        }
      });
      this.cloudField = null;
    }
    if (this._cloudMats) {
      for (const m of this._cloudMats) m.dispose?.();
      this._cloudMats = null;
    }
    this._buildCloudField();
  }

  _buildCloudField() {
    this.cloudField = new THREE.Group();
    this.cloudField.name = 'meshClouds';
    this.atmosphereGroup.add(this.cloudField);

    const tier = this._tier;
    if (!tier.meshClouds) return;

    // ONE shared puff geometry — unique SphereGeometry per puff was a VRAM leak.
    const puffGeo = new THREE.SphereGeometry(1, tier.premium ? 8 : 6, tier.premium ? 6 : 4);
    this._cloudPuffGeo = puffGeo;

    const mats = [
      (() => {
        const m = new THREE.MeshLambertMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.72,
          flatShading: true,
          depthWrite: false,
          fog: false,
        });
        m.userData.baseOpacity = 0.72;
        return m;
      })(),
      (() => {
        const m = new THREE.MeshLambertMaterial({
          color: 0xf0f4ff,
          transparent: true,
          opacity: 0.58,
          flatShading: true,
          depthWrite: false,
          fog: false,
        });
        m.userData.baseOpacity = 0.58;
        return m;
      })(),
    ];
    this._cloudMats = mats;

    const count = tier.meshCloudCount;
    for (let i = 0; i < count; i++) {
      const cloud = new THREE.Group();
      const n = 2 + Math.floor(Math.random() * 2);
      const mat = mats[i % mats.length];
      for (let j = 0; j < n; j++) {
        const s = 9 + Math.random() * 14;
        const puff = new THREE.Mesh(puffGeo, mat);
        puff.position.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 16);
        puff.scale.set(s, s * (0.35 + Math.random() * 0.2), s);
        cloud.add(puff);
      }
      cloud.userData.ox = (Math.random() - 0.5) * 900;
      cloud.userData.oy = 180 + Math.random() * 180;
      cloud.userData.oz = (Math.random() - 0.5) * 900;
      cloud.userData.drift = 0.6 + Math.random() * 1.6;
      this.cloudField.add(cloud);
    }
  }

  _ensureAirportMaterials() {
    if (this._airportMats) return this._airportMats;

    const makeRunwayTex = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#3a3a42';
      ctx.fillRect(0, 0, 256, 64);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.moveTo(0, 32);
      ctx.lineTo(256, 32);
      ctx.stroke();
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.set(8, 1);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    this._airportMats = {
      runway: new THREE.MeshStandardMaterial({
        map: makeRunwayTex(),
        roughness: 0.92,
        metalness: 0.05,
        fog: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        depthWrite: true,
      }),
      apron: new THREE.MeshStandardMaterial({
        color: 0x4a5058,
        roughness: 0.95,
        fog: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      pad: new THREE.MeshStandardMaterial({
        color: 0x5c5248,
        roughness: 0.98,
        fog: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      concrete: new THREE.MeshStandardMaterial({ color: 0x8a9098, flatShading: true, fog: false }),
      glass: new THREE.MeshStandardMaterial({
        color: 0x9ad0f0,
        transparent: true,
        opacity: 0.62,
        roughness: 0.15,
        metalness: 0.2,
        flatShading: true,
        fog: false,
      }),
    };
    return this._airportMats;
  }

  _addAirportMeshes(ap) {
    const mats = this._ensureAirportMaterials();
    const elev = ap.elevation ?? 0.12;
    // Keep visuals clearly above flattened terrain to avoid z-fighting / sinking
    const yPad = elev + 0.18;
    const yRunway = elev + 0.32;
    const added = [];

    const cutPad = new THREE.Mesh(
      new THREE.PlaneGeometry(ap.width + 44, ap.length + 56),
      mats.pad
    );
    cutPad.rotation.x = -Math.PI / 2;
    cutPad.rotation.z = -ap.heading;
    cutPad.position.set(ap.x, yPad, ap.z);
    cutPad.receiveShadow = this._shadowsEnabled;
    cutPad.renderOrder = 2;
    this.group.add(cutPad);
    added.push(cutPad);

    const strip = new THREE.Mesh(new THREE.PlaneGeometry(ap.width, ap.length), mats.runway);
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = -ap.heading;
    strip.position.set(ap.x, yRunway, ap.z);
    strip.receiveShadow = this._shadowsEnabled;
    strip.renderOrder = 3;
    this.group.add(strip);
    added.push(strip);

    const apron = new THREE.Mesh(new THREE.CircleGeometry(ap.width * 0.55, 12), mats.apron);
    apron.rotation.x = -Math.PI / 2;
    apron.rotation.z = -ap.heading;
    const apronOff = localToWorldXZ(ap, 0, -ap.length * 0.38);
    apron.position.set(apronOff.x, yRunway, apronOff.z);
    apron.renderOrder = 3;
    this.group.add(apron);
    added.push(apron);

    const towerScale = ap.primary ? 1 : 0.72;
    const tower = this._buildControlTower(ap, elev, towerScale, mats.concrete, mats.glass);
    this.group.add(tower);
    added.push(tower);

    if (ap.primary) {
      const hangar = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 12), mats.concrete.clone());
      const hx = ap.x + Math.sin(ap.heading) * 28 + Math.cos(ap.heading) * -25;
      const hz = ap.z + Math.cos(ap.heading) * 28 - Math.sin(ap.heading) * -25;
      hangar.position.set(hx, elev + 3.5, hz);
      hangar.rotation.y = ap.heading;
      this.group.add(hangar);
      added.push(hangar);
    }

    this.airportMeshes.push(...added);
  }

  _trySpawnChunkStrip(cx, cz) {
    const key = chunkKey(cx, cz);
    if (this._stripTried.has(key)) return null;
    this._stripTried.add(key);

    const ap = tryGenerateChunkStrip(
      cx,
      cz,
      CHUNK_SIZE,
      this.map,
      (x, z) => this._rawHeight(x, z),
      this.airports,
      this.stripSpawnChance,
      this.worldSeed ?? this.map.seed ?? 1
    );
    if (!ap) return null;

    this.airports.push(ap);
    this._addAirportMeshes(ap);
    return ap;
  }

  _rebuildChunksNearAirports() {
    for (const ap of this.airports) {
      const pad = ap.length * 0.5 + ap.width + 36;
      const minCx = this._chunkCoord(ap.x - pad);
      const maxCx = this._chunkCoord(ap.x + pad);
      const minCz = this._chunkCoord(ap.z - pad);
      const maxCz = this._chunkCoord(ap.z + pad);

      for (let cz = minCz; cz <= maxCz; cz++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const key = chunkKey(cx, cz);
          const ch = this.chunks.get(key);
          if (!ch) continue;
          this._disposeChunk(ch);
          this.chunks.set(key, this._buildChunk(cx, cz, { skipStripRoll: true }));
        }
      }
    }
  }

  _rebuildLoadedChunksForAirport(ap, skipCx, skipCz) {
    const pad = ap.length * 0.5 + ap.width + 30;
    const minCx = this._chunkCoord(ap.x - pad);
    const maxCx = this._chunkCoord(ap.x + pad);
    const minCz = this._chunkCoord(ap.z - pad);
    const maxCz = this._chunkCoord(ap.z + pad);

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        if (cx === skipCx && cz === skipCz) continue;
        const key = chunkKey(cx, cz);
        const ch = this.chunks.get(key);
        if (!ch) continue;
        this._disposeChunk(ch);
        this.chunks.set(key, this._buildChunk(cx, cz, { skipStripRoll: true }));
      }
    }
  }

  _buildAirports() {
    for (const m of this.airportMeshes) {
      this.group.remove(m);
      m.geometry?.dispose?.();
      if (m.material && m.material !== this._airportMats?.concrete) {
        m.material.map?.dispose?.();
        if (m.material !== this._airportMats?.runway &&
            m.material !== this._airportMats?.apron &&
            m.material !== this._airportMats?.pad &&
            m.material !== this._airportMats?.glass) {
          m.material.dispose?.();
        }
      }
    }
    this.airportMeshes = [];
    this._ensureAirportMaterials();
    for (const ap of this.airports) {
      this._addAirportMeshes(ap);
    }
  }

  _buildControlTower(ap, elev, scale, concreteMat, glassMat) {
    const group = new THREE.Group();
    group.name = 'controlTower';

    const side = ap.width * 0.55 + 14;
    const along = -ap.length * 0.22;
    const w = localToWorldXZ(ap, side, along);

    const base = new THREE.Mesh(new THREE.BoxGeometry(9 * scale, 0.7 * scale, 9 * scale), concreteMat);
    base.position.y = elev + 0.35 * scale;

    const shaft = new THREE.Mesh(new THREE.BoxGeometry(5.5 * scale, 18 * scale, 5.5 * scale), concreteMat);
    shaft.position.y = elev + 9.5 * scale;

    const cab = new THREE.Mesh(new THREE.BoxGeometry(8 * scale, 4 * scale, 8 * scale), glassMat);
    cab.position.y = elev + 20.5 * scale;

    const roof = new THREE.Mesh(new THREE.BoxGeometry(8.6 * scale, 0.45 * scale, 8.6 * scale), concreteMat);
    roof.position.y = elev + 22.7 * scale;

    group.add(base, shaft, cab, roof);
    group.position.set(w.x, 0, w.z);
    group.rotation.y = ap.heading;
    return group;
  }

  _buildRunway() {}

  _chunkSegs() {
    return this._tier.chunkSegs;
  }

  _propCount() {
    return this._tier.propCount;
  }

  _buildChunk(cx, cz, opts = {}) {
    if (!opts.skipStripRoll) {
      const newAp = this._trySpawnChunkStrip(cx, cz);
      if (newAp) this._rebuildLoadedChunksForAirport(newAp, cx, cz);
    }

    const segs = opts.forceSegs ?? this._chunkSegs();
    const size = CHUNK_SIZE;
    const geo = this._acquireChunkGeometry(segs);
    const pos = geo.attributes.position;
    const colorAttr = geo.attributes.color;
    const colors = colorAttr.array;
    const c = _tmpColorA;
    const c2 = _tmpColorB;
    const m = this.map;
    const originX = cx * size;
    const originZ = cz * size;

    const pa = pos.array;
    for (let i = 0; i < pos.count; i++) {
      const i3 = i * 3;
      const lx = pa[i3];
      const lz = pa[i3 + 2];
      const wx = originX + lx;
      const wz = originZ + lz;
      const h = this.sampleHeight(wx, wz);
      pa[i3 + 1] = h;
      this._applyTerrainColor(h, c, c2, m);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    pos.needsUpdate = true;
    colorAttr.needsUpdate = true;
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this._terrainMat);
    mesh.position.set(originX, 0, originZ);
    mesh.receiveShadow = this._shadowsEnabled;
    mesh.castShadow = false;
    this.group.add(mesh);

    const props = this._scatterInChunk(cx, cz, originX, originZ);
    return { mesh, props, cx, cz };
  }

  _scatterInChunk(cx, cz, ox, oz) {
    if (cx === 0 && cz === 0) return [];
    for (const ap of this.airports) {
      const d = Math.hypot(ox + CHUNK_SIZE * 0.5 - ap.x, oz + CHUNK_SIZE * 0.5 - ap.z);
      if (d < ap.length * 0.65 + 24) return [];
    }
    const m = this.map;
    const objs = [];
    const count = this._propCount();
    const { min: minH, max: maxH } = propHeightRange(m);
    const rng = ((this.map.channels?.props ?? this.map.seed) * 73856093 + cx * 19349663 + cz * 83492791) >>> 0;
    let s = rng;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return (s & 0xffff) / 0xffff;
    };

    for (let i = 0; i < count; i++) {
      const x = ox + (rand() - 0.5) * CHUNK_SIZE * 0.9;
      const z = oz + (rand() - 0.5) * CHUNK_SIZE * 0.9;
      if (Math.hypot(x, z) < 100) continue;
      const h = this.sampleHeight(x, z);
      if (h < minH || h > maxH) continue;

      let mesh;
      if (m.props === 'rocks' || m.props === 'cactus') {
        mesh = new THREE.Mesh(this._propGeo.rock, this._propMat.rock);
        const sc = 0.7 + rand() * (m.props === 'cactus' ? 0.9 : 1.1);
        mesh.scale.set(sc, m.props === 'cactus' ? 0.8 + rand() * 0.9 : sc, sc);
        mesh.position.set(x, h + 0.4, z);
      } else {
        const trunk = new THREE.Mesh(this._propGeo.trunk, this._propMat.trunk);
        const leaf = new THREE.Mesh(this._propGeo.leaf, this._propMat.leaf);
        const g = new THREE.Group();
        trunk.position.y = 0.55;
        leaf.position.y = m.props === 'pines' ? 2.2 : m.props === 'palms' ? 2.5 : 1.9;
        g.add(trunk, leaf);
        g.position.set(x, h, z);
        const sc = 0.7 + rand() * 0.8;
        g.scale.setScalar(sc);
        mesh = g;
      }
      this.group.add(mesh);
      objs.push(mesh);
    }
    return objs;
  }

  _disposeChunk(ch) {
    if (!ch?.mesh) return;
    this.group.remove(ch.mesh);
    this._recycleChunkGeometry(ch.mesh.geometry);
    ch.mesh.geometry = null;
    ch.mesh.material = null;
    for (const p of ch.props) {
      this.group.remove(p);
    }
    ch.props.length = 0;
  }

  _chunkCoord(v) {
    if (!Number.isFinite(v)) return 0;
    return Math.floor(v / CHUNK_SIZE);
  }

  updateChunks(x, z, force = false) {
    if (!this._streamingEnabled) return;

    const cx = this._chunkCoord(x);
    const cz = this._chunkCoord(z);
    const moved = cx !== this._lastCx || cz !== this._lastCz;

    if (!force && !moved && !this._chunkLoadPending) return;

    if (moved || force) {
      this._lastCx = cx;
      this._lastCz = cz;

      const r = this.loadRadius;
      const needed = new Set();
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > r * r + 1) continue;
          needed.add(chunkKey(cx + dx, cz + dz));
        }
      }

      for (const [key, ch] of this.chunks) {
        if (!needed.has(key)) {
          this._disposeChunk(ch);
          this.chunks.delete(key);
        }
      }

      this._pendingChunkKeys = [];
      for (const key of needed) {
        if (!this.chunks.has(key)) this._pendingChunkKeys.push(key);
      }
      if (this._pendingChunkKeys.length > MAX_PENDING_CHUNK_KEYS) {
        this._pendingChunkKeys.length = MAX_PENDING_CHUNK_KEYS;
      }
      this._sortPendingByDistance(cx, cz);
    }

    const budget = this._effectiveBuildBudget();
    if (this._pendingChunkKeys.length > 1) {
      this._sortPendingByDistance(cx, cz);
    }
    let built = 0;
    let guard = 0;
    const guardMax = budget + this._pendingChunkKeys.length + 8;
    while (this._pendingChunkKeys.length && built < budget && guard < guardMax) {
      guard += 1;
      const key = this._pendingChunkKeys.shift();
      if (!key || this.chunks.has(key)) continue;
      if (this.chunks.size >= MAX_CHUNKS_IN_MEMORY) break;
      const [sx, sz] = key.split(',').map(Number);
      if (!Number.isFinite(sx) || !Number.isFinite(sz)) continue;
      this.chunks.set(key, this._buildChunk(sx, sz));
      built++;
    }

    this._chunkLoadPending = this._pendingChunkKeys.length > 0;
  }

  _applyLighting(dt, followPos, advanceTime) {
    if (advanceTime) {
      this.dayTime = (this.dayTime + dt * this.dayCycleSpeed) % 1;
    }

    const ang = this.dayTime * Math.PI * 2;
    const elev = Math.sin(ang);
    this.uniforms.sky.uSunElev.value = elev;

    // World-fixed sun arc (east → overhead → west); only translates with player, not camera bearing.
    this._sunDir.set(Math.cos(ang), elev, Math.sin(ang) * 0.55).normalize();
    this.uniforms.sky.uSunDir.value.copy(this._sunDir);
    if (this.uniforms.water.uSunDir) this.uniforms.water.uSunDir.value.copy(this._sunDir);
    if (this.uniforms.water.uSunElev) this.uniforms.water.uSunElev.value = elev;

    const skyR = this._skyRadius || this.getClipDistance() + 200;
    const shell = Math.min(skyR * 0.96, 2400);
    const lightDist = shell * 1.8;

    if (this.sun) {
      this.sun.position.set(
        this._sunDir.x * lightDist,
        Math.max(this._sunDir.y * lightDist, 20),
        this._sunDir.z * lightDist
      );
      if (elev > 0.08) {
        this.sun.intensity = THREE.MathUtils.clamp(elev * 1.2 + 0.2, 0.2, 1.25);
        this.sun.color.set(this.map.sun);
      } else {
        this.sun.intensity = THREE.MathUtils.clamp(0.1 + Math.abs(elev) * 0.18, 0.08, 0.32);
        this.sun.color.set(0xa8b8e8);
      }
      this.sun.target.position.set(0, 0, 0);
      this.sun.target.updateMatrixWorld();
    }

    if (this.sunVisual) {
      this.sunVisual.position.set(
        this._sunDir.x * shell,
        this._sunDir.y * shell,
        this._sunDir.z * shell
      );
      this.sunVisual.visible = elev > -0.15;

      const duskT = elev > 0.28 ? 0 : elev > 0.04 ? (0.28 - elev) / 0.24 : 1;
      const coreDay = _tmpColorA.setHex(0xfffef8);
      const coreDusk = _tmpColorB.setHex(0xffaa55);

      if (this.sunCore?.material) {
        this.sunCore.material.color.copy(coreDay).lerp(coreDusk, duskT);
      }

      if (this.sunInnerGlow?.material) {
        this.sunInnerGlow.material.color.setHex(duskT > 0.5 ? 0xff8844 : 0xffd966);
        this.sunInnerGlow.material.opacity = 0.42 + Math.max(0, elev) * 0.18;
      }
      if (this.sunOuterGlow?.material) {
        this.sunOuterGlow.material.color.setHex(duskT > 0.5 ? 0xff5522 : 0xff8833);
        this.sunOuterGlow.material.opacity = 0.16 + Math.max(0, elev) * 0.1;
      }

      const sc = THREE.MathUtils.clamp(0.88 + elev * 0.2, 0.78, 1.15);
      this.sunVisual.scale.setScalar(sc);

      if (this.sunCorona) {
        const t = this.uniforms.water.uTime.value;
        const pulse = 1 + Math.sin(t * 1.1) * 0.035 + Math.sin(t * 2.3) * 0.015;
        const base = this._sunCoronaBase || 52;
        const coronaSize = base * pulse * sc;
        this.sunCorona.scale.set(coronaSize, coronaSize, 1);
        this.sunCorona.material.opacity =
          (this._tier.premium ? 0.88 : this._tier.id === 'high' ? 0.78 : 0.62) +
          Math.max(0, elev) * 0.15 -
          duskT * 0.12;
        this.sunCorona.material.color.setHex(duskT > 0.5 ? 0xffccaa : 0xffffff);
      }
    }

    if (this.moonVisual) {
      this.moonVisual.position.set(
        -this._sunDir.x * shell,
        -this._sunDir.y * shell,
        -this._sunDir.z * shell
      );
      this.moonVisual.visible = elev < 0.45;
      const moonAlpha = elev < 0 ? 1 : THREE.MathUtils.clamp(1 - elev * 1.8, 0.25, 1);
      if (this.moonCore?.material) {
        this.moonCore.material.emissiveIntensity = 0.25 + moonAlpha * 0.25;
        this.moonCore.visible = moonAlpha > 0.08;
      }
      const moonHalo = this.moonVisual.children.find((c) => c !== this.moonCore);
      if (moonHalo?.material) {
        moonHalo.material.opacity = 0.18 * moonAlpha;
      }
    }

    if (this.hemi) {
      this.hemi.intensity = 0.25 + Math.max(0, elev) * 0.5;
    }
    if (this.amb) {
      this.amb.intensity = 0.14 + Math.max(0, elev) * 0.2;
    }

    const day = _tmpColorA.set(this.map.skyTop);
    const dusk = _tmpColorB.set(this.map.lava ? 0xff5020 : 0xe07a4a);
    const duskMix = THREE.MathUtils.smoothstep(0.35, 0.05, elev);
    this.uniforms.sky.uTop.value.copy(day).lerp(dusk, duskMix * 0.65);
    this.uniforms.sky.uHorizon.value.set(
      elev > 0.05 ? this.map.skyHorizon : 0x2a3448
    );
  }

  update(dt, weather = 'clear', followPos = null, opts = {}) {
    const { advanceTime = true, velocity = null } = opts;
    if (velocity) {
      const spd = Math.hypot(velocity.x, velocity.z);
      if (spd > 12) {
        this._loadBiasX = velocity.x / spd;
        this._loadBiasZ = velocity.z / spd;
      } else {
        this._loadBiasX = 0;
        this._loadBiasZ = 0;
      }
    }
    this.uniforms.water.uTime.value += dt;
    this._applyLighting(dt, followPos, advanceTime);

    const elev = this.uniforms.sky.uSunElev.value;
    this._updateFogDensity(weather);

    if (this.cloudField && followPos) {
      const wrap = Math.max(600, this.renderDistanceMeters * 0.85);
      for (const c of this.cloudField.children) {
        c.userData.ox += c.userData.drift * dt;
        if (c.userData.ox > wrap) c.userData.ox -= wrap * 2;
        if (c.userData.ox < -wrap) c.userData.ox += wrap * 2;
        c.position.set(c.userData.ox, c.userData.oy, c.userData.oz);
      }
      const nightDim = elev > 0 ? 1 : 0.4;
      // Only update shared cloud materials once (not traverse every mesh).
      if (this._cloudMats) {
        for (const m of this._cloudMats) {
          m.opacity = (m.userData.baseOpacity ?? 0.7) * nightDim;
        }
      }
    }

    if (followPos) {
      const groundY = this.sampleHeight(followPos.x, followPos.z);
      const prevAltBand = this._viewerAltitude > 200 ? 2 : this._viewerAltitude > 80 ? 1 : 0;
      this._viewerAltitude = Math.max(0, followPos.y - groundY);
      const altBand = this._viewerAltitude > 200 ? 2 : this._viewerAltitude > 80 ? 1 : 0;
      if (altBand !== prevAltBand && this._streamingEnabled) {
        this._chunkLoadPending = true;
        this._lastCx = null;
      }
      if (this.atmosphereGroup) {
        this.atmosphereGroup.position.copy(followPos);
      }
      if (this.water) {
        this.water.position.set(followPos.x, this.map.waterY ?? 0, followPos.z);
      }
      this._updateHorizonTerrainFollow(followPos.x, followPos.z);
      if (this._streamingEnabled) {
        this.updateChunks(followPos.x, followPos.z);
      }
    }
  }
}
