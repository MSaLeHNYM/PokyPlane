/**
 * Minecraft-style chunked open world.
 * Height from noise always (even for unloaded chunks).
 * Meshes stream in/out around the player.
 */
import * as THREE from 'three';
import { createNoise } from './noise.js';
import { getMap } from './maps.js';

export const CHUNK_SIZE = 64;
export const CHUNK_SEGS = 16; // verts per side - 1

const skyVert = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const skyFrag = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  varying vec3 vPos;
  void main() {
    float h = normalize(vPos).y;
    vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
    col = mix(uBottom, col, smoothstep(-0.15, 0.02, h));
    gl_FragColor = vec4(col, 1.0);
  }
`;

const waterVert = /* glsl */ `
  uniform float uTime;
  varying float vWave;
  void main() {
    vec3 p = position;
    float w = sin(p.x * 0.05 + uTime) * 0.4 + cos(p.z * 0.07 + uTime * 0.8) * 0.3;
    p.y += w;
    vWave = w;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
  }
`;
const waterFrag = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  varying float vWave;
  void main() {
    float f = clamp(0.35 + abs(vWave) * 0.4, 0.0, 1.0);
    gl_FragColor = vec4(mix(uDeep, uShallow, f), 0.72);
  }
`;

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

export class World {
  constructor(scene, quality = 'medium', mapId = 'meadow') {
    this.scene = scene;
    this.quality = quality;
    this.mapId = mapId;
    this.map = getMap(mapId);
    this.noise = createNoise(this.map.seed);
    this.dayTime = 0.35;
    this.viewRadius = 4;
    this.chunks = new Map();
    this.group = new THREE.Group();
    this.group.name = 'chunkWorld';
    scene.add(this.group);

    this.uniforms = {
      water: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(this.map.waterDeep) },
        uShallow: { value: new THREE.Color(this.map.waterShallow) },
      },
      sky: {
        uTop: { value: new THREE.Color(this.map.skyTop) },
        uHorizon: { value: new THREE.Color(this.map.skyHorizon) },
        uBottom: { value: new THREE.Color(this.map.skyBottom) },
      },
    };

    this._buildGlobals();
    this._lastCx = null;
    this._lastCz = null;
    // Seed initial chunks around origin
    this.updateChunks(0, 0, true);
  }

  setViewRadius(n) {
    const r = Math.max(2, Math.min(8, Math.round(n)));
    if (r === this.viewRadius) return;
    this.viewRadius = r;
    this._lastCx = null; // force reload around player
  }

  get worldBound() {
    return Infinity; // truly open — chunks forever
  }

  get mpTerritory() {
    return this.map.mpTerritory ?? 220;
  }

  rebuild(mapId, quality = this.quality) {
    this.dispose();
    this.quality = quality;
    this.mapId = mapId;
    this.map = getMap(mapId);
    this.noise = createNoise(this.map.seed);
    // keep existing viewRadius unless quality rebuild alone
    this.uniforms.water.uDeep.value.set(this.map.waterDeep);
    this.uniforms.water.uShallow.value.set(this.map.waterShallow);
    this.uniforms.sky.uTop.value.set(this.map.skyTop);
    this.uniforms.sky.uHorizon.value.set(this.map.skyHorizon);
    this.uniforms.sky.uBottom.value.set(this.map.skyBottom);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.chunks = new Map();
    this._buildGlobals();
    this._lastCx = null;
    this.updateChunks(0, 0, true);
  }

  dispose() {
    for (const ch of this.chunks.values()) this._disposeChunk(ch);
    this.chunks.clear();
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
          else {
            o.material.map?.dispose?.();
            o.material.dispose?.();
          }
        }
      });
    }
    this.group = null;
    this.sky = this.water = this.sun = this.hemi = this.amb = this.runway = null;
  }

  /** Continuous height — chunk-independent (Minecraft-style sample). */
  sampleHeight(x, z) {
    const m = this.map;
    const scale = 0.0045;
    const n = this.noise.fbm(x * scale, z * scale, 5, 2.05, 0.5);
    const ridge = 1 - Math.abs(this.noise.fbm(x * scale * 0.6 + 20, z * scale * 0.6 + 20, 3));
    let h = (n * 22 + ridge * ridge * 38) * m.heightScale;

    if (m.islandBias) {
      // Soft continents via very large noise
      const land = this.noise.fbm(x * 0.0008, z * 0.0008, 3);
      const mask = THREE.MathUtils.smoothstep(-0.15, 0.25, land);
      h = h * mask - (1 - mask) * 6;
    }

    // Flat airport disc at origin
    const dist = Math.hypot(x, z);
    if (dist < 90) {
      const t = dist / 90;
      h = THREE.MathUtils.lerp(1.6, h, t * t);
    }

    return h;
  }

  getHeight(x, z) {
    return this.sampleHeight(x, z);
  }

  _buildGlobals() {
    const m = this.map;
    // Sky dome follows camera later
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 20, 12),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms.sky,
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: THREE.BackSide,
        depthWrite: false,
      })
    );
    this.group.add(this.sky);

    // Large water plane under everything
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000, 32, 32),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms.water,
        vertexShader: waterVert,
        fragmentShader: waterFrag,
        transparent: true,
        depthWrite: false,
      })
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = m.waterY;
    this.group.add(this.water);

    this.hemi = new THREE.HemisphereLight(m.hemiSky, m.hemiGround, 0.75);
    this.group.add(this.hemi);
    this.sun = new THREE.DirectionalLight(m.sun, 1.15);
    this.sun.position.set(100, 140, 60);
    this.sun.castShadow = this.quality !== 'low';
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.near = 10;
    sc.far = 500;
    sc.left = sc.bottom = -150;
    sc.right = sc.top = 150;
    this.group.add(this.sun);
    this.group.add(this.sun.target);
    this.amb = new THREE.AmbientLight(0x5080a0, 0.28);
    this.group.add(this.amb);

    // Visible sun + moon discs (fixed to sky with player)
    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(22, 18, 14),
      new THREE.MeshBasicMaterial({ color: 0xfff0a0, fog: false })
    );
    this.sunMesh.renderOrder = -1;
    this.group.add(this.sunMesh);

    this.moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(12, 14, 12),
      new THREE.MeshBasicMaterial({ color: 0xd0d8ea, fog: false })
    );
    this.moonMesh.renderOrder = -1;
    this.group.add(this.moonMesh);

    this.scene.fog = new THREE.FogExp2(m.fog, m.fogDensity * 0.85);

    this._buildCloudField();
    // Runway at spawn
    this._buildRunway();
  }

  _buildCloudField() {
    this.cloudField = new THREE.Group();
    this.group.add(this.cloudField);
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.78,
      flatShading: true,
      depthWrite: false,
    });
    const count = this.quality === 'low' ? 18 : 40;
    for (let i = 0; i < count; i++) {
      const cloud = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 4);
      for (let j = 0; j < n; j++) {
        const s = 7 + Math.random() * 16;
        const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 6, 5), mat);
        puff.position.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 14);
        puff.scale.set(1, 0.4 + Math.random() * 0.3, 1);
        cloud.add(puff);
      }
      cloud.userData.ox = (Math.random() - 0.5) * 1000;
      cloud.userData.oy = 50 + Math.random() * 100;
      cloud.userData.oz = (Math.random() - 0.5) * 1000;
      cloud.userData.drift = 1.5 + Math.random() * 3;
      this.cloudField.add(cloud);
    }
  }

  _buildRunway() {
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
    tex.repeat.set(10, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.runway = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 140),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })
    );
    this.runway.rotation.x = -Math.PI / 2;
    this.runway.position.set(0, this.sampleHeight(0, 0) + 0.08, 0);
    this.group.add(this.runway);

    const hangar = new THREE.Mesh(
      new THREE.BoxGeometry(16, 7, 12),
      new THREE.MeshStandardMaterial({ color: 0xa8b0b8, flatShading: true })
    );
    hangar.position.set(28, this.sampleHeight(28, -25) + 3.5, -25);
    this.group.add(hangar);
  }

  _buildChunk(cx, cz) {
    const segs = this.quality === 'low' ? 10 : CHUNK_SEGS;
    const size = CHUNK_SIZE;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const m = this.map;
    const originX = cx * size;
    const originZ = cz * size;

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const wx = originX + lx;
      const wz = originZ + lz;
      const h = this.sampleHeight(wx, wz);
      pos.setY(i, h);

      if (h < 2) c.set(m.low);
      else if (h < 12) c.set(m.mid).lerp(new THREE.Color(m.mid2), (h - 2) / 10);
      else if (h < 32) c.set(m.mid2).lerp(new THREE.Color(m.rock), (h - 12) / 20);
      else if (h < 50) c.set(m.rock).lerp(new THREE.Color(m.snow), (h - 32) / 18);
      else c.set(m.snow);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.94,
        metalness: 0,
        flatShading: true,
      })
    );
    mesh.position.set(originX, 0, originZ);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);

    // Scatter a few props in chunk (skip airport chunk)
    const props = this._scatterInChunk(cx, cz, originX, originZ);

    return { mesh, props, cx, cz };
  }

  _scatterInChunk(cx, cz, ox, oz) {
    if (cx === 0 && cz === 0) return [];
    const m = this.map;
    const objs = [];
    const count = this.quality === 'low' ? 4 : 8;
    const rng = (this.map.seed * 73856093 + cx * 19349663 + cz * 83492791) >>> 0;
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
      if (h < 2.2 || h > 28) continue;

      let mesh;
      if (m.props === 'rocks' || m.props === 'cactus') {
        mesh = new THREE.Mesh(
          m.props === 'cactus'
            ? new THREE.CylinderGeometry(0.2, 0.3, 1.8 + rand(), 5)
            : new THREE.DodecahedronGeometry(0.6 + rand() * 0.8, 0),
          new THREE.MeshStandardMaterial({
            color: m.props === 'cactus' ? 0x3a7a3a : m.rockColor,
            flatShading: true,
          })
        );
        mesh.position.set(x, h + 0.4, z);
      } else {
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.18, 1.1, 5),
          new THREE.MeshStandardMaterial({ color: m.treeTrunk, flatShading: true })
        );
        const leaf = new THREE.Mesh(
          new THREE.ConeGeometry(m.props === 'pines' ? 0.8 : 1.0, m.props === 'pines' ? 2.6 : 2.0, 6),
          new THREE.MeshStandardMaterial({ color: m.treeLeaf, flatShading: true })
        );
        const g = new THREE.Group();
        trunk.position.y = 0.55;
        leaf.position.y = m.props === 'pines' ? 2.2 : 1.9;
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
    this.group.remove(ch.mesh);
    ch.mesh.geometry.dispose();
    ch.mesh.material.dispose();
    for (const p of ch.props) {
      this.group.remove(p);
      p.traverse?.((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
      if (p.geometry) p.geometry.dispose();
      if (p.material) p.material.dispose();
    }
  }

  /** Call each frame with player world position. */
  updateChunks(x, z, force = false) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    if (!force && cx === this._lastCx && cz === this._lastCz) return;
    this._lastCx = cx;
    this._lastCz = cz;

    const needed = new Set();
    const r = this.viewRadius;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        // circular-ish load
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

    for (const key of needed) {
      if (this.chunks.has(key)) continue;
      const [sx, sz] = key.split(',').map(Number);
      this.chunks.set(key, this._buildChunk(sx, sz));
    }
  }

  update(dt, weather = 'clear', followPos = null) {
    this.dayTime = (this.dayTime + dt * 0.008) % 1;
    const ang = this.dayTime * Math.PI * 2;
    const elev = Math.sin(ang);
    const ox = followPos?.x ?? 0;
    const oy = (followPos?.y ?? 0) * 0.15;
    const oz = followPos?.z ?? 0;
    const orbit = 480;

    // Celestial positions relative to player (fixes far-out bug)
    const sx = Math.cos(ang) * orbit;
    const sy = elev * orbit;
    const sz = Math.sin(ang) * orbit * 0.55;

    if (this.sun) {
      this.sun.position.set(ox + sx, oy + Math.max(sy, -40), oz + sz);
      // Day light / soft moonlight
      if (elev > 0.05) {
        this.sun.intensity = THREE.MathUtils.clamp(elev * 1.35 + 0.15, 0.15, 1.3);
        this.sun.color.set(this.map.sun);
      } else {
        this.sun.intensity = THREE.MathUtils.clamp(0.12 + Math.abs(elev) * 0.2, 0.08, 0.35);
        this.sun.color.set(0xa8b8e8);
      }
      if (followPos) {
        this.sun.target.position.copy(followPos);
        this.sun.target.updateMatrixWorld();
      }
    }

    if (this.sunMesh) {
      this.sunMesh.position.set(ox + sx, oy + sy, oz + sz);
      this.sunMesh.visible = elev > -0.2;
      const sunCol = elev > 0.15 ? 0xfff2a8 : elev > 0 ? 0xff8040 : 0xff6030;
      this.sunMesh.material.color.setHex(sunCol);
      const sc = THREE.MathUtils.clamp(0.85 + elev * 0.4, 0.7, 1.35);
      this.sunMesh.scale.setScalar(sc);
    }
    if (this.moonMesh) {
      this.moonMesh.position.set(ox - sx, oy - sy, oz - sz);
      this.moonMesh.visible = elev < 0.35;
      this.moonMesh.material.opacity = elev < 0 ? 1 : THREE.MathUtils.clamp(1 - elev * 2.2, 0.2, 1);
      this.moonMesh.material.transparent = true;
    }

    if (this.hemi) {
      this.hemi.intensity = 0.22 + Math.max(0, elev) * 0.55;
    }
    if (this.amb) {
      this.amb.intensity = 0.12 + Math.max(0, elev) * 0.22;
    }

    const day = new THREE.Color(this.map.skyTop);
    const dusk = new THREE.Color(this.map.lava ? 0xff5020 : 0xe07a4a);
    const night = new THREE.Color(0x060e1c);
    const top =
      elev > 0.1
        ? day.clone().lerp(dusk, THREE.MathUtils.smoothstep(0.4, 0.05, elev))
        : dusk.clone().lerp(night, THREE.MathUtils.smoothstep(0.05, -0.25, elev));
    this.uniforms.sky.uTop.value.copy(top);
    this.uniforms.sky.uHorizon.value.set(elev > 0 ? this.map.skyHorizon : 0x1a2438);
    this.uniforms.sky.uBottom.value.set(elev > 0 ? this.map.skyBottom : 0x0c121c);

    if (this.scene.fog) {
      this.scene.fog.color.copy(top.clone().lerp(new THREE.Color(this.map.fog), 0.35));
      this.scene.fog.density =
        weather === 'clear' ? this.map.fogDensity * 0.9 : weather === 'rain' ? 0.003 : 0.0026;
    }
    this.uniforms.water.uTime.value += dt;

    // Soft cloud field near player + slow drift
    if (this.cloudField && followPos) {
      const wrap = 520;
      for (const c of this.cloudField.children) {
        c.userData.ox += c.userData.drift * dt;
        if (c.userData.ox > wrap) c.userData.ox -= wrap * 2;
        if (c.userData.ox < -wrap) c.userData.ox += wrap * 2;
        c.position.set(
          followPos.x + c.userData.ox,
          c.userData.oy,
          followPos.z + c.userData.oz
        );
      }
      // Dim clouds at night
      const nightFog = elev > 0 ? 1 : 0.35;
      this.cloudField.visible = true;
      this.cloudField.traverse((o) => {
        if (o.isMesh && o.material) o.material.opacity = 0.75 * nightFog;
      });
    }

    // Keep sky + water near player (infinite feel)
    if (followPos) {
      if (this.sky) this.sky.position.set(followPos.x, 0, followPos.z);
      if (this.water) this.water.position.set(followPos.x, this.map.waterY, followPos.z);
      this.updateChunks(followPos.x, followPos.z);
    }
  }
}
