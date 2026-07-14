/**
 * Procedural PokyPlane aircraft built entirely from Three.js primitives.
 * No GLB/GLTF/textures imported — CanvasTextures are generated in code for
 * stripes, logo, and tail ID. Control surfaces rotate for visual feedback.
 */
import * as THREE from 'three';

/** Skin palettes — same geometry, different materials. */
export const SKINS = [
  {
    name: 'Cherry Red',
    body: 0xe63946,
    accent: 0xffffff,
    stripe: 0xffd166,
    canopy: 0x88ccff,
    prop: 0x333333,
    metal: 0x8899aa,
  },
  {
    name: 'Sky Blue',
    body: 0x457b9d,
    accent: 0xf1faee,
    stripe: 0xe63946,
    canopy: 0xa8dff5,
    prop: 0x222222,
    metal: 0x9aa8b8,
  },
  {
    name: 'Sunny Yellow',
    body: 0xf4a261,
    accent: 0x264653,
    stripe: 0x2a9d8f,
    canopy: 0xb8e0f0,
    prop: 0x1a1a1a,
    metal: 0xa0a8b0,
  },
];

function mat(color, extras = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.15,
    flatShading: true,
    ...extras,
  });
}

/** Tiny generated canvas for wing/fuselage stripes + "PokyPlane" wordmark. */
function makeDecalTexture(skin, text = 'PP') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `#${skin.body.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = `#${skin.stripe.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 40, 256, 28);
  ctx.fillStyle = `#${skin.accent.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 48, 256, 12);
  ctx.font = 'bold 36px Fredoka, Nunito, sans-serif';
  ctx.fillStyle = `#${skin.accent.toString(16).padStart(6, '0')}`;
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 100);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Build a stubby, friendly cartoon plane as a THREE.Group.
 * @param {number} skinIndex
 * @returns {{ group: THREE.Group, parts: object }}
 */
export function createPlane(skinIndex = 1) {
  const skin = SKINS[skinIndex % SKINS.length];
  const group = new THREE.Group();
  group.name = 'PokyPlane';

  const bodyMat = mat(skin.body);
  const accentMat = mat(skin.accent);
  const metalMat = mat(skin.metal, { metalness: 0.55, roughness: 0.35 });
  const propMat = mat(skin.prop);
  const decalTex = makeDecalTexture(skin, 'Poky');
  const decalMat = new THREE.MeshStandardMaterial({
    map: decalTex,
    roughness: 0.6,
    metalness: 0.1,
    flatShading: true,
  });

  // --- Fuselage: tapered stack of cylinders (rounded stubby body) ---
  const fuselage = new THREE.Group();
  const sections = [
    { r: 0.12, l: 0.35, z: 1.35 }, // nose tip
    { r: 0.32, l: 0.55, z: 0.95 },
    { r: 0.42, l: 0.9, z: 0.35 },
    { r: 0.38, l: 0.85, z: -0.45 },
    { r: 0.22, l: 0.55, z: -1.1 },
    { r: 0.08, l: 0.3, z: -1.5 }, // tail tip
  ];
  sections.forEach((s, i) => {
    const geo = new THREE.CylinderGeometry(s.r * 0.85, s.r, s.l, 8);
    const m = new THREE.Mesh(geo, i === 2 ? decalMat : bodyMat);
    m.rotation.x = Math.PI / 2;
    m.position.z = s.z;
    m.castShadow = true;
    fuselage.add(m);
  });
  group.add(fuselage);

  // --- Cockpit canopy (glass-like sphere slice) ---
  const canopyGeo = new THREE.SphereGeometry(0.38, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const canopyMat = new THREE.MeshPhysicalMaterial({
    color: skin.canopy,
    transparent: true,
    opacity: 0.55,
    roughness: 0.08,
    metalness: 0.1,
    transmission: 0.65,
    thickness: 0.3,
    flatShading: true,
  });
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 0.28, 0.35);
  canopy.scale.set(1, 0.7, 1.1);
  group.add(canopy);

  // --- Wings with dihedral + ailerons ---
  const wingRoot = new THREE.Group();
  const wingShape = (side) => {
    const wing = new THREE.Group();
    const geo = new THREE.BoxGeometry(2.4, 0.08, 0.7);
    // Taper tip by scaling
    const mesh = new THREE.Mesh(geo, bodyMat);
    mesh.scale.set(1, 1, 1);
    mesh.position.set(side * 1.2, 0, 0);
    // Slight chord taper via nested tip
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.45), accentMat);
    tip.position.set(side * 2.35, 0, -0.05);
    const aileron = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.22), metalMat);
    aileron.position.set(side * 1.6, -0.02, -0.4);
    aileron.name = 'aileron';
    wing.add(mesh, tip, aileron);
    wing.rotation.z = side * 0.08; // dihedral
    wing.position.y = 0.02;
    wing.position.z = 0.1;
    return { wing, aileron };
  };
  const left = wingShape(-1);
  const right = wingShape(1);
  wingRoot.add(left.wing, right.wing);
  group.add(wingRoot);

  // Wing stripes (colored boxes as "painted" bands)
  [-1, 1].forEach((side) => {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.09, 0.72),
      mat(skin.stripe)
    );
    stripe.position.set(side * 1.5, 0.01, 0.1);
    group.add(stripe);
  });

  // --- Tail assembly ---
  const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.45), bodyMat);
  vertical.position.set(0, 0.4, -1.25);
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.2), accentMat);
  rudder.position.set(0, 0.35, -1.5);
  rudder.name = 'rudder';

  const hStabL = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.35), bodyMat);
  hStabL.position.set(-0.4, 0.12, -1.3);
  const hStabR = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.35), bodyMat);
  hStabR.position.set(0.4, 0.12, -1.3);
  const elevL = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.16), metalMat);
  elevL.position.set(-0.35, 0.1, -1.5);
  elevL.name = 'elevatorL';
  const elevR = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.16), metalMat);
  elevR.position.set(0.35, 0.1, -1.5);
  elevR.name = 'elevatorR';

  // Tail number (CanvasTexture plane)
  const idCanvas = document.createElement('canvas');
  idCanvas.width = 64;
  idCanvas.height = 32;
  const idCtx = idCanvas.getContext('2d');
  idCtx.fillStyle = `#${skin.accent.toString(16).padStart(6, '0')}`;
  idCtx.fillRect(0, 0, 64, 32);
  idCtx.fillStyle = `#${skin.body.toString(16).padStart(6, '0')}`;
  idCtx.font = 'bold 18px Nunito, sans-serif';
  idCtx.textAlign = 'center';
  idCtx.fillText(`P${skinIndex + 1}`, 32, 22);
  const idTex = new THREE.CanvasTexture(idCanvas);
  idTex.colorSpace = THREE.SRGBColorSpace;
  const idMark = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.14),
    new THREE.MeshBasicMaterial({ map: idTex, transparent: true, side: THREE.DoubleSide })
  );
  idMark.position.set(0.05, 0.45, -1.25);
  idMark.rotation.y = Math.PI / 2;

  group.add(vertical, rudder, hStabL, hStabR, elevL, elevR, idMark);

  // --- Propeller (pivot spun every frame) ---
  const propPivot = new THREE.Group();
  propPivot.position.set(0, 0, 1.55);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.18, 8), metalMat);
  hub.rotation.x = Math.PI / 2;
  propPivot.add(hub);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.04), propMat);
    blade.position.y = 0.35;
    const holder = new THREE.Group();
    holder.rotation.z = (i / 3) * Math.PI * 2;
    holder.add(blade);
    propPivot.add(holder);
  }
  // Motion-blur disc swapped in at high RPM
  const blurDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 24),
    new THREE.MeshBasicMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  blurDisc.rotation.x = Math.PI / 2;
  propPivot.add(blurDisc);
  group.add(propPivot);

  // Spinner cone
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.28, 8), accentMat);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.set(0, 0, 1.72);
  group.add(spinner);

  // --- Landing gear (retractable) ---
  const gear = new THREE.Group();
  gear.name = 'landingGear';
  const makeWheel = (x) => {
    const leg = new THREE.Group();
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 6), metalMat);
    strut.position.y = -0.25;
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.04, 6, 12), propMat);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.y = -0.48;
    const hubW = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), metalMat);
    hubW.position.y = -0.48;
    leg.add(strut, wheel, hubW);
    leg.position.set(x, -0.15, 0.2);
    return leg;
  };
  gear.add(makeWheel(-0.35), makeWheel(0.35));
  // Tail wheel
  const tailWheel = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), propMat);
  tailWheel.position.set(0, -0.28, -1.2);
  gear.add(tailWheel);
  group.add(gear);

  // Soft shadow blob under plane (fake contact)
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.2, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.7;
  shadow.name = 'fakeShadow';
  group.add(shadow);

  const parts = {
    propPivot,
    blurDisc,
    blades: propPivot.children.filter((c) => c.type === 'Group'),
    aileronL: left.aileron,
    aileronR: right.aileron,
    rudder,
    elevatorL: elevL,
    elevatorR: elevR,
    gear,
    canopy,
    skinIndex,
  };

  return { group, parts, skin };
}

/** Animate control surfaces + propeller from flight state. */
export function updatePlaneVisuals(parts, state, dt) {
  const { rollInput = 0, pitchInput = 0, yawInput = 0, turnInput = 0, throttle = 0.5, airspeed = 0, onGround = false } = state;
  const turn = turnInput || yawInput;

  // Propeller spin — RPM linked to throttle
  const rpm = 8 + throttle * 45 + airspeed * 0.05;
  parts.propPivot.rotation.z += rpm * dt;
  const blur = Math.min(1, throttle * 1.2);
  parts.blurDisc.material.opacity = blur * 0.35;
  parts.blades.forEach((b) => {
    b.visible = blur < 0.7;
  });

  // Surfaces: turn steers rudder + mild aileron; Q/E is rollInput
  const def = 0.45;
  const bankViz = turn * 0.7 + rollInput;
  parts.aileronL.rotation.x = bankViz * def;
  parts.aileronR.rotation.x = -bankViz * def;
  parts.elevatorL.rotation.x = pitchInput * def;
  parts.elevatorR.rotation.x = pitchInput * def;
  parts.rudder.rotation.y = -turn * def;

  // Retract gear when airborne and fast enough
  const gearTarget = onGround || airspeed < 25 ? 0 : 1;
  parts._gearT = THREE.MathUtils.lerp(parts._gearT ?? 0, gearTarget, 1 - Math.exp(-3 * dt));
  parts.gear.rotation.x = parts._gearT * 1.2;
  parts.gear.position.y = -parts._gearT * 0.15;
  parts.gear.visible = parts._gearT < 0.95;
}
