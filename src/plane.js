/**
 * Eight arcade aircraft — each with unique silhouette, colors, flight feel, and physics body.
 */
import * as THREE from 'three';

/** Derive wheel/collision dimensions from visual scale + per-type overrides. */
function physique(scale, overrides = {}) {
  return {
    gearHeight: +(1.08 * scale + 0.28).toFixed(2),
    wheelRadius: +(0.055 + scale * 0.038).toFixed(3),
    wheelTube: +(0.022 + scale * 0.016).toFixed(3),
    wheelSpread: +(0.26 + scale * 0.08).toFixed(2),
    strutLength: +(0.38 + scale * 0.08).toFixed(2),
    tailWheelRadius: +(0.038 + scale * 0.018).toFixed(3),
    wheelOffsetZ: 0.2,
    noseOffsetZ: +(0.95 + scale * 0.52).toFixed(2),
    tailOffsetZ: -(0.82 + scale * 0.32).toFixed(2),
    collisionRadius: +(2.0 + scale * 1.05).toFixed(2),
    collisionLength: +(3.8 + scale * 1.6).toFixed(2),
    wingspan: +(3.6 + scale * 1.4).toFixed(2),
    mass: +(0.55 + scale * 0.42).toFixed(2),
    liftFactor: 1.0,
    dragFactor: 1.0,
    groundGrip: 1.0,
    alignStrength: 2.6,
    autoBank: 0.55,
    ...overrides,
  };
}

export const PLANE_TYPES = [
  {
    id: 'poky',
    emoji: '🛩️',
    nameKey: 'planePoky',
    descKey: 'planePokyDesc',
    tag: 'small',
    colors: {
      body: 0x457b9d,
      accent: 0xf1faee,
      stripe: 0xe63946,
      canopy: 0xa8dff5,
      prop: 0x222222,
      metal: 0x9aa8b8,
    },
    stats: {
      maxSpeed: 125,
      maxThrust: 86,
      stallSpeed: 24,
      takeoffSpeed: 28,
      safeLandSpeed: 40,
      pitchRate: 1.25,
      turnRate: 1.42,
      rollRate: 1.48,
      scale: 1.0,
      ...physique(1.0, {
        mass: 1.0,
        liftFactor: 1.0,
        dragFactor: 1.0,
        groundGrip: 1.05,
        alignStrength: 2.6,
        autoBank: 0.52,
      }),
    },
  },
  {
    id: 'whale',
    emoji: '🐋',
    nameKey: 'planeWhale',
    descKey: 'planeWhaleDesc',
    tag: 'big',
    colors: {
      body: 0xe8eef5,
      accent: 0x2563eb,
      stripe: 0x3b82f6,
      canopy: 0x1e3a5f,
      prop: 0x334155,
      metal: 0x94a3b8,
    },
    stats: {
      maxSpeed: 98,
      maxThrust: 72,
      stallSpeed: 20,
      takeoffSpeed: 32,
      safeLandSpeed: 36,
      pitchRate: 0.85,
      turnRate: 0.78,
      rollRate: 0.72,
      scale: 1.42,
      ...physique(1.42, {
        mass: 1.9,
        liftFactor: 1.35,
        dragFactor: 1.22,
        groundGrip: 0.78,
        wheelOffsetZ: 0.45,
        alignStrength: 2.1,
        autoBank: 0.32,
      }),
    },
  },
  {
    id: 'banana',
    emoji: '🍌',
    nameKey: 'planeBanana',
    descKey: 'planeBananaDesc',
    tag: 'funny',
    colors: {
      body: 0xffe135,
      accent: 0x8b4513,
      stripe: 0xff6b00,
      canopy: 0x88ccff,
      prop: 0x1a1a1a,
      metal: 0xc4a574,
    },
    stats: {
      maxSpeed: 112,
      maxThrust: 80,
      stallSpeed: 22,
      takeoffSpeed: 26,
      safeLandSpeed: 38,
      pitchRate: 1.15,
      turnRate: 1.2,
      rollRate: 1.35,
      scale: 1.05,
      ...physique(1.05, {
        mass: 0.92,
        liftFactor: 0.88,
        dragFactor: 1.08,
        groundGrip: 1.12,
        wheelSpread: 0.38,
        alignStrength: 2.4,
        autoBank: 0.62,
      }),
    },
  },
  {
    id: 'falcon',
    emoji: '⚔️',
    nameKey: 'planeFalcon',
    descKey: 'planeFalconDesc',
    tag: 'war',
    colors: {
      body: 0x3d4f3a,
      accent: 0x6b7280,
      stripe: 0x1f2937,
      canopy: 0x0ea5e9,
      prop: 0x111827,
      metal: 0x4b5563,
    },
    stats: {
      maxSpeed: 168,
      maxThrust: 102,
      stallSpeed: 30,
      takeoffSpeed: 38,
      safeLandSpeed: 48,
      pitchRate: 1.35,
      turnRate: 1.55,
      rollRate: 1.6,
      scale: 1.08,
      ...physique(1.08, {
        mass: 1.15,
        liftFactor: 1.18,
        dragFactor: 0.82,
        groundGrip: 1.0,
        wheelRadius: 0.09,
        gearHeight: 1.22,
        alignStrength: 3.1,
        autoBank: 0.68,
      }),
    },
  },
  {
    id: 'moth',
    emoji: '🦋',
    nameKey: 'planeMoth',
    descKey: 'planeMothDesc',
    tag: 'small',
    colors: {
      body: 0xf8fafc,
      accent: 0xf472b6,
      stripe: 0xc084fc,
      canopy: 0xbae6fd,
      prop: 0x475569,
      metal: 0xcbd5e1,
    },
    stats: {
      maxSpeed: 108,
      maxThrust: 74,
      stallSpeed: 17,
      takeoffSpeed: 22,
      safeLandSpeed: 32,
      pitchRate: 1.55,
      turnRate: 1.65,
      rollRate: 1.75,
      scale: 0.62,
      ...physique(0.62, {
        mass: 0.42,
        liftFactor: 0.72,
        dragFactor: 0.88,
        groundGrip: 1.25,
        wheelSpread: 0.22,
        wheelRadius: 0.055,
        gearHeight: 0.88,
        collisionRadius: 2.05,
        alignStrength: 3.4,
        autoBank: 0.78,
      }),
    },
  },
  {
    id: 'fortress',
    emoji: '💣',
    nameKey: 'planeFortress',
    descKey: 'planeFortressDesc',
    tag: 'war',
    colors: {
      body: 0x4a5d23,
      accent: 0x1c1917,
      stripe: 0x78716c,
      canopy: 0x57534e,
      prop: 0x0c0a09,
      metal: 0x6b7280,
    },
    stats: {
      maxSpeed: 118,
      maxThrust: 96,
      stallSpeed: 26,
      takeoffSpeed: 34,
      safeLandSpeed: 44,
      pitchRate: 0.92,
      turnRate: 0.88,
      rollRate: 0.82,
      scale: 1.32,
      ...physique(1.32, {
        mass: 2.05,
        liftFactor: 1.15,
        dragFactor: 1.18,
        groundGrip: 0.72,
        wheelOffsetZ: 0.35,
        wheelSpread: 0.48,
        alignStrength: 2.0,
        autoBank: 0.28,
      }),
    },
  },
  {
    id: 'loopy',
    emoji: '🎪',
    nameKey: 'planeLoopy',
    descKey: 'planeLoopyDesc',
    tag: 'funny',
    colors: {
      body: 0xff6b4a,
      accent: 0xffd166,
      stripe: 0x06d6a0,
      canopy: 0x7dd3fc,
      prop: 0x292524,
      metal: 0xfbbf24,
    },
    stats: {
      maxSpeed: 132,
      maxThrust: 92,
      stallSpeed: 19,
      takeoffSpeed: 24,
      safeLandSpeed: 36,
      pitchRate: 1.62,
      turnRate: 1.58,
      rollRate: 1.85,
      scale: 0.96,
      ...physique(0.96, {
        mass: 0.82,
        liftFactor: 1.05,
        dragFactor: 0.92,
        groundGrip: 1.15,
        alignStrength: 3.2,
        autoBank: 0.85,
      }),
    },
  },
  {
    id: 'neon',
    emoji: '🏎️',
    nameKey: 'planeNeon',
    descKey: 'planeNeonDesc',
    tag: 'sport',
    colors: {
      body: 0xdc2626,
      accent: 0xffffff,
      stripe: 0x0f172a,
      canopy: 0x38bdf8,
      prop: 0x171717,
      metal: 0xe2e8f0,
    },
    stats: {
      maxSpeed: 158,
      maxThrust: 100,
      stallSpeed: 28,
      takeoffSpeed: 36,
      safeLandSpeed: 46,
      pitchRate: 1.22,
      turnRate: 1.38,
      rollRate: 1.35,
      scale: 1.02,
      ...physique(1.02, {
        mass: 1.08,
        liftFactor: 1.22,
        dragFactor: 0.78,
        groundGrip: 1.02,
        wheelRadius: 0.088,
        gearHeight: 1.18,
        alignStrength: 3.0,
        autoBank: 0.58,
      }),
    },
  },
];

/** @deprecated use PLANE_TYPES */
export const SKINS = PLANE_TYPES.map((p) => ({ name: p.nameKey, ...p.colors }));

function mat(color, extras = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.15,
    flatShading: true,
    ...extras,
  });
}

function makeDecalTexture(colors, text = 'PP') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `#${colors.body.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = `#${colors.stripe.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 40, 256, 28);
  ctx.fillStyle = `#${colors.accent.toString(16).padStart(6, '0')}`;
  ctx.font = 'bold 32px Fredoka, Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 100);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCanopy(colors) {
  const geo = new THREE.SphereGeometry(0.38, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  return new THREE.Mesh(
    geo,
    new THREE.MeshPhysicalMaterial({
      color: colors.canopy,
      transparent: true,
      opacity: 0.55,
      roughness: 0.08,
      metalness: 0.1,
      transmission: 0.65,
      thickness: 0.3,
      flatShading: true,
    })
  );
}

function makeProp(colors, metalMat, propMat, bladeCount = 3, bladeLen = 0.9) {
  const propPivot = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.18, 8), metalMat);
  hub.rotation.x = Math.PI / 2;
  propPivot.add(hub);
  const blades = [];
  for (let i = 0; i < bladeCount; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, bladeLen, 0.04), propMat);
    blade.position.y = bladeLen * 0.4;
    const holder = new THREE.Group();
    holder.rotation.z = (i / bladeCount) * Math.PI * 2;
    holder.add(blade);
    propPivot.add(holder);
    blades.push(holder);
  }
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
  return { propPivot, blurDisc, blades };
}

function makeGear(metalMat, propMat, stats = {}) {
  const spread = stats.wheelSpread ?? 0.35;
  const z = stats.wheelOffsetZ ?? 0.2;
  const wheelR = stats.wheelRadius ?? 0.1;
  const wheelT = stats.wheelTube ?? 0.04;
  const strutLen = stats.strutLength ?? 0.45;
  const tailR = stats.tailWheelRadius ?? 0.06;
  const gear = new THREE.Group();
  gear.name = 'landingGear';
  const makeWheel = (x) => {
    const leg = new THREE.Group();
    const strut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.035, strutLen, 6),
      metalMat
    );
    strut.position.y = -strutLen * 0.55;
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(wheelR, wheelT, 6, 12),
      propMat
    );
    wheel.rotation.y = Math.PI / 2;
    wheel.position.y = -strutLen;
    leg.add(strut, wheel);
    leg.position.set(x, -0.12, z);
    return leg;
  };
  gear.add(makeWheel(-spread), makeWheel(spread));
  const tailWheel = new THREE.Mesh(new THREE.SphereGeometry(tailR, 6, 6), propMat);
  tailWheel.position.set(0, -strutLen * 0.62, -1.1);
  gear.add(tailWheel);
  return gear;
}

function addShadow(group, radius = 1.2) {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.7;
  shadow.name = 'fakeShadow';
  group.add(shadow);
}

function finishPlane(group, parts, type, typeIndex) {
  group.scale.setScalar(type.stats.scale);
  group.name = type.id;
  parts.planeType = type.id;
  parts.typeIndex = typeIndex;
  parts._gearT = 0;
  return { group, parts, skin: type.colors, type };
}

/** Apply aircraft stats + physics body to the flight model. */
export function applyPlaneStats(flight, typeIndex, sens = 1, { stallAssist = false, stallMod = 18 } = {}) {
  const type = PLANE_TYPES[typeIndex % PLANE_TYPES.length];
  const s = type.stats;
  flight.planeId = type.id;
  flight.maxSpeed = s.maxSpeed;
  flight.maxThrust = s.maxThrust;
  flight.takeoffSpeed = s.takeoffSpeed;
  flight.safeLandSpeed = s.safeLandSpeed;
  flight.stallSpeed = (stallAssist ? s.stallSpeed - 4 : s.stallSpeed) + (stallMod - 18) * 0.45;
  flight.pitchRate = s.pitchRate * sens;
  flight.turnRate = s.turnRate * sens;
  flight.rollRate = s.rollRate * sens;
  flight.gearHeight = s.gearHeight;
  flight.wheelSpread = s.wheelSpread ?? 0.35;
  flight.wheelOffsetZ = s.wheelOffsetZ ?? 0.2;
  flight.noseOffsetZ = s.noseOffsetZ ?? 1.55;
  flight.tailOffsetZ = s.tailOffsetZ ?? -1.1;
  flight.hitRadius = s.collisionRadius;
  flight.collisionLength = s.collisionLength;
  flight.wingspan = s.wingspan;
  flight.mass = s.mass;
  flight.liftFactor = s.liftFactor;
  flight.dragFactor = s.dragFactor;
  flight.groundGrip = s.groundGrip;
  flight.alignStrength = s.alignStrength;
  flight.autoBank = s.autoBank;
  return type;
}

export function getPlaneHitRadius(typeIndex) {
  return PLANE_TYPES[typeIndex % PLANE_TYPES.length].stats.collisionRadius;
}

function buildPoky(type, typeIndex) {
  const c = type.colors;
  const group = new THREE.Group();
  const bodyMat = mat(c.body);
  const accentMat = mat(c.accent);
  const metalMat = mat(c.metal, { metalness: 0.55, roughness: 0.35 });
  const propMat = mat(c.prop);
  const decalMat = new THREE.MeshStandardMaterial({
    map: makeDecalTexture(c, 'Poky'),
    roughness: 0.6,
    flatShading: true,
  });

  const sections = [
    { r: 0.12, l: 0.35, z: 1.35 },
    { r: 0.32, l: 0.55, z: 0.95 },
    { r: 0.42, l: 0.9, z: 0.35 },
    { r: 0.38, l: 0.85, z: -0.45 },
    { r: 0.22, l: 0.55, z: -1.1 },
    { r: 0.08, l: 0.3, z: -1.5 },
  ];
  sections.forEach((s, i) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(s.r * 0.85, s.r, s.l, 8), i === 2 ? decalMat : bodyMat);
    m.rotation.x = Math.PI / 2;
    m.position.z = s.z;
    group.add(m);
  });

  const canopy = makeCanopy(c);
  canopy.position.set(0, 0.28, 0.35);
  canopy.scale.set(1, 0.7, 1.1);
  group.add(canopy);

  const wing = (side) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.7), bodyMat));
    g.children[0].position.set(side * 1.2, 0, 0);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.45), accentMat);
    tip.position.set(side * 2.35, 0, -0.05);
    const aileron = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.22), metalMat);
    aileron.position.set(side * 1.6, -0.02, -0.4);
    aileron.name = 'aileron';
    g.add(tip, aileron);
    g.rotation.z = side * 0.08;
    g.position.set(0, 0.02, 0.1);
    return { wing: g, aileron };
  };
  const left = wing(-1);
  const right = wing(1);
  group.add(left.wing, right.wing);

  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.2), accentMat);
  rudder.position.set(0, 0.35, -1.5);
  rudder.name = 'rudder';
  const elevL = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.16), metalMat);
  elevL.position.set(-0.35, 0.1, -1.5);
  elevL.name = 'elevatorL';
  const elevR = elevL.clone();
  elevR.position.x = 0.35;
  elevR.name = 'elevatorR';
  const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.45), bodyMat);
  vertical.position.set(0, 0.4, -1.25);
  group.add(vertical, rudder, elevL, elevR);

  const { propPivot, blurDisc, blades } = makeProp(c, metalMat, propMat);
  propPivot.position.z = 1.55;
  group.add(propPivot);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.28, 8), accentMat);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.set(0, 0, 1.72);
  group.add(spinner);

  const gear = makeGear(metalMat, propMat, type.stats);
  group.add(gear);
  addShadow(group, type.stats.collisionRadius * 0.38);

  return finishPlane(group, {
    propMode: 'single',
    propPivot,
    blurDisc,
    blades,
    aileronL: left.aileron,
    aileronR: right.aileron,
    rudder,
    elevatorL: elevL,
    elevatorR: elevR,
    gear,
    canopy,
  }, type, typeIndex);
}

function buildWhale(type, typeIndex) {
  const c = type.colors;
  const group = new THREE.Group();
  const bodyMat = mat(c.body);
  const accentMat = mat(c.accent);
  const metalMat = mat(c.metal, { metalness: 0.5 });
  const propMat = mat(c.prop);

  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 3.8), bodyMat);
  fuselage.position.set(0, 0.15, 0);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.6, 8), accentMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.15, 2.1);
  group.add(fuselage, nose);

  const canopy = makeCanopy(c);
  canopy.position.set(0, 0.55, 0.8);
  canopy.scale.set(1.3, 0.8, 1.6);
  group.add(canopy);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.12, 1.1), bodyMat);
  wing.position.set(0, 0.05, 0.2);
  group.add(wing);

  [-1, 1].forEach((side) => {
    [-0.8, 0.9].forEach((z) => {
      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.7, 8), metalMat);
      nacelle.rotation.x = Math.PI / 2;
      nacelle.position.set(side * 2.0, -0.15, z);
      group.add(nacelle);
      const { propPivot } = makeProp(c, metalMat, propMat, 4, 0.55);
      propPivot.scale.setScalar(0.7);
      propPivot.position.set(side * 2.0, -0.15, z + 0.45);
      group.add(propPivot);
    });
  });

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.4, 0.9), accentMat);
  tail.position.set(0, 0.55, -1.85);
  group.add(tail);

  const gear = makeGear(metalMat, propMat, type.stats);
  group.add(gear);
  addShadow(group, type.stats.collisionRadius * 0.38);

  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.25), accentMat);
  rudder.position.set(0, 0.5, -2.1);
  rudder.name = 'rudder';

  return finishPlane(group, {
    propMode: 'none',
    propPivot: new THREE.Group(),
    blurDisc: { material: { opacity: 0 } },
    blades: [],
    aileronL: wing,
    aileronR: wing,
    rudder,
    elevatorL: tail,
    elevatorR: tail,
    gear,
    canopy,
  }, type, typeIndex);
}

function buildBanana(type, typeIndex) {
  const c = type.colors;
  const group = new THREE.Group();
  const bodyMat = mat(c.body);
  const accentMat = mat(c.accent);
  const metalMat = mat(c.metal);
  const propMat = mat(c.prop);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.8, 6, 10), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.position.set(0, 0.1, 0.2);
  body.scale.set(1, 1, 1.15);
  group.add(body);

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.35, 6), accentMat);
  stem.position.set(0, 0.35, 1.35);
  group.add(stem);

  const makeWing = (y, span) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(span, 0.06, 0.55), bodyMat);
    w.position.set(0, y, 0.15);
    const strutL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), accentMat);
    strutL.position.set(-0.5, y - 0.25, 0.15);
    const strutR = strutL.clone();
    strutR.position.x = 0.5;
    group.add(w, strutL, strutR);
    return w;
  };
  const topWing = makeWing(0.55, 2.8);
  const botWing = makeWing(0.08, 2.4);

  const canopy = makeCanopy(c);
  canopy.position.set(0, 0.42, 0.35);
  canopy.scale.set(0.75, 0.6, 0.9);
  group.add(canopy);

  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.18), accentMat);
  rudder.position.set(0, 0.35, -1.05);
  rudder.name = 'rudder';
  group.add(rudder);

  const { propPivot, blurDisc, blades } = makeProp(c, metalMat, propMat, 2, 1.1);
  propPivot.position.set(0, 0.1, 1.55);
  group.add(propPivot);

  const gear = makeGear(metalMat, propMat, type.stats);
  group.add(gear);
  addShadow(group, type.stats.collisionRadius * 0.38);

  return finishPlane(group, {
    propMode: 'single',
    propPivot,
    blurDisc,
    blades,
    aileronL: topWing,
    aileronR: botWing,
    rudder,
    elevatorL: botWing,
    elevatorR: botWing,
    gear,
    canopy,
  }, type, typeIndex);
}

function buildFalcon(type, typeIndex) {
  const c = type.colors;
  const group = new THREE.Group();
  const bodyMat = mat(c.body);
  const accentMat = mat(c.accent);
  const metalMat = mat(c.metal, { metalness: 0.65, roughness: 0.3 });
  const darkMat = mat(c.stripe, { metalness: 0.4 });

  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 2.8, 8), bodyMat);
  fuse.rotation.x = Math.PI / 2;
  fuse.position.z = 0.2;
  group.add(fuse);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 8), darkMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = 1.75;
  group.add(nose);

  const canopy = makeCanopy(c);
  canopy.position.set(0, 0.22, 0.55);
  canopy.scale.set(0.85, 0.55, 1.2);
  group.add(canopy);

  const wingL = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 1.4), bodyMat);
  wingL.position.set(-0.85, -0.02, 0.1);
  wingL.rotation.z = 0.35;
  wingL.rotation.y = -0.15;
  const wingR = wingL.clone();
  wingR.position.x = 0.85;
  wingR.rotation.z = -0.35;
  wingR.rotation.y = 0.15;
  const aileronL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.3), metalMat);
  aileronL.position.set(-1.35, -0.05, -0.35);
  aileronL.name = 'aileron';
  const aileronR = aileronL.clone();
  aileronR.position.x = 1.35;
  aileronR.name = 'aileron';
  group.add(wingL, wingR, aileronL, aileronR);

  const missile = (x) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6), accentMat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, -0.12, 0.35);
    group.add(m);
  };
  missile(-0.35);
  missile(0.35);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.5), bodyMat);
  tail.position.set(0, 0.35, -1.15);
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.35, 0.2), accentMat);
  rudder.position.set(0, 0.35, -1.45);
  rudder.name = 'rudder';
  group.add(tail, rudder);

  const exhaustL = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.14, 0.35, 8),
    mat(c.metal, { metalness: 0.65, emissive: 0x442200, emissiveIntensity: 0 })
  );
  exhaustL.rotation.x = Math.PI / 2;
  exhaustL.position.set(-0.18, 0, -1.35);
  const exhaustR = exhaustL.clone();
  exhaustR.position.x = 0.18;
  group.add(exhaustL, exhaustR);

  const gear = makeGear(metalMat, darkMat, type.stats);
  group.add(gear);
  addShadow(group, type.stats.collisionRadius * 0.38);

  const propPivot = new THREE.Group();
  propPivot.add(exhaustL, exhaustR);

  return finishPlane(group, {
    propMode: 'jet',
    propPivot,
    blurDisc: { material: { opacity: 0 } },
    blades: [],
    aileronL,
    aileronR,
    rudder,
    elevatorL: tail,
    elevatorR: tail,
    gear,
    canopy,
    exhausts: [exhaustL, exhaustR],
  }, type, typeIndex);
}

function buildMoth(type, typeIndex) {
  const c = type.colors;
  const group = new THREE.Group();
  const bodyMat = mat(c.body);
  const accentMat = mat(c.accent);
  const metalMat = mat(c.metal);
  const propMat = mat(c.prop);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.2, 6), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.1;
  group.add(body);

  const wingL = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.03, 0.35), accentMat);
  wingL.position.set(-0.55, 0.02, 0.05);
  const wingR = wingL.clone();
  wingR.position.x = 0.55;
  const aileronL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.025, 0.12), metalMat);
  aileronL.position.set(-0.75, 0, -0.15);
  aileronL.name = 'aileron';
  const aileronR = aileronL.clone();
  aileronR.position.x = 0.75;
  aileronR.name = 'aileron';
  group.add(wingL, wingR, aileronL, aileronR);

  const canopy = makeCanopy(c);
  canopy.position.set(0, 0.12, 0.15);
  canopy.scale.set(0.55, 0.45, 0.65);
  group.add(canopy);

  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.28, 0.1), accentMat);
  rudder.position.set(0, 0.12, -0.55);
  rudder.name = 'rudder';
  group.add(rudder);

  const { propPivot, blurDisc, blades } = makeProp(c, metalMat, propMat, 2, 0.55);
  propPivot.scale.setScalar(0.65);
  propPivot.position.z = 0.75;
  group.add(propPivot);

  const gear = makeGear(metalMat, propMat, type.stats);
  gear.scale.setScalar(0.75);
  group.add(gear);
  addShadow(group, type.stats.collisionRadius * 0.38);

  return finishPlane(group, {
    propMode: 'single',
    propPivot,
    blurDisc,
    blades,
    aileronL,
    aileronR,
    rudder,
    elevatorL: wingL,
    elevatorR: wingR,
    gear,
    canopy,
  }, type, typeIndex);
}

function buildFortress(type, typeIndex) {
  const c = type.colors;
  const group = new THREE.Group();
  const bodyMat = mat(c.body);
  const accentMat = mat(c.accent);
  const metalMat = mat(c.metal);
  const propMat = mat(c.prop);

  const fuse = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.75, 2.6), bodyMat);
  fuse.position.set(0, 0.1, 0);
  group.add(fuse);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.38, 8, 8), accentMat);
  nose.position.set(0, 0.05, 1.45);
  group.add(nose);

  const turret = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), metalMat);
  turret.position.set(0, 0.45, 0.3);
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6), accentMat);
  gun.rotation.x = Math.PI / 2;
  gun.position.set(0, 0.45, 0.65);
  group.add(turret, gun);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.1, 0.85), bodyMat);
  wing.position.set(0, 0.05, 0.15);
  group.add(wing);

  [-1, 1].forEach((side) => {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.55, 8), metalMat);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(side * 1.35, -0.05, 0.2);
    group.add(eng);
    const { propPivot } = makeProp(c, metalMat, propMat, 3, 0.75);
    propPivot.scale.setScalar(0.85);
    propPivot.position.set(side * 1.35, -0.05, 0.55);
    group.add(propPivot);
  });

  const tailL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.65, 0.35), bodyMat);
  tailL.position.set(-0.22, 0.4, -1.25);
  const tailR = tailL.clone();
  tailR.position.x = 0.22;
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.15), accentMat);
  rudder.position.set(0, 0.35, -1.45);
  rudder.name = 'rudder';
  group.add(tailL, tailR, rudder);

  const gear = makeGear(metalMat, propMat, type.stats);
  group.add(gear);
  addShadow(group, type.stats.collisionRadius * 0.38);

  return finishPlane(group, {
    propMode: 'none',
    propPivot: new THREE.Group(),
    blurDisc: { material: { opacity: 0 } },
    blades: [],
    aileronL: wing,
    aileronR: wing,
    rudder,
    elevatorL: tailL,
    elevatorR: tailR,
    gear,
    canopy: turret,
  }, type, typeIndex);
}

function buildLoopy(type, typeIndex) {
  const c = type.colors;
  const group = new THREE.Group();
  const bodyMat = mat(c.body);
  const accentMat = mat(c.accent);
  const stripeMat = mat(c.stripe);
  const metalMat = mat(c.metal);
  const propMat = mat(c.prop);

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), bodyMat);
  body.scale.set(1, 0.85, 1.4);
  body.position.z = 0.15;
  group.add(body);

  const wingL = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.07, 0.65), stripeMat);
  wingL.position.set(-0.95, 0.05, 0.1);
  const wingR = wingL.clone();
  wingR.position.x = 0.95;
  [-1, 1].forEach((side) => {
    for (let i = 0; i < 4; i++) {
      const sq = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.075, 0.22),
        i % 2 ? accentMat : bodyMat
      );
      sq.position.set(side * (0.55 + i * 0.35), 0.06, 0.1);
      group.add(sq);
    }
  });
  const aileronL = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.18), metalMat);
  aileronL.position.set(-1.25, 0, -0.25);
  aileronL.name = 'aileron';
  const aileronR = aileronL.clone();
  aileronR.position.x = 1.25;
  aileronR.name = 'aileron';
  group.add(wingL, wingR, aileronL, aileronR);

  const canopy = makeCanopy(c);
  canopy.position.set(0, 0.25, 0.35);
  group.add(canopy);

  const bigTail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.55), accentMat);
  bigTail.position.set(0, 0.45, -0.85);
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.65, 0.25), stripeMat);
  rudder.position.set(0, 0.45, -1.15);
  rudder.name = 'rudder';
  group.add(bigTail, rudder);

  const { propPivot, blurDisc, blades } = makeProp(c, metalMat, propMat, 3, 1.0);
  propPivot.position.z = 1.05;
  group.add(propPivot);

  const gear = makeGear(metalMat, propMat, type.stats);
  group.add(gear);
  addShadow(group, type.stats.collisionRadius * 0.38);

  return finishPlane(group, {
    propMode: 'single',
    propPivot,
    blurDisc,
    blades,
    aileronL,
    aileronR,
    rudder,
    elevatorL: bigTail,
    elevatorR: bigTail,
    gear,
    canopy,
  }, type, typeIndex);
}

function buildNeon(type, typeIndex) {
  const c = type.colors;
  const group = new THREE.Group();
  const bodyMat = mat(c.body);
  const accentMat = mat(c.accent);
  const metalMat = mat(c.metal, { metalness: 0.7, roughness: 0.25 });
  const darkMat = mat(c.stripe);

  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 8), bodyMat);
  fuse.rotation.x = Math.PI / 2;
  fuse.position.z = 0.15;
  group.add(fuse);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.1, 8), accentMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = 1.65;
  group.add(nose);

  const canopy = makeCanopy(c);
  canopy.position.set(0, 0.18, 0.35);
  canopy.scale.set(0.7, 0.5, 1.0);
  group.add(canopy);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 0.45), bodyMat);
  wing.position.set(0, -0.02, 0.05);
  const aileronL = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.15), metalMat);
  aileronL.position.set(-1.05, -0.03, -0.25);
  aileronL.name = 'aileron';
  const aileronR = aileronL.clone();
  aileronR.position.x = 1.05;
  aileronR.name = 'aileron';
  group.add(wing, aileronL, aileronR);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.055, 0.08), accentMat);
  stripe.position.set(0, 0.01, 0.05);
  group.add(stripe);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.35), bodyMat);
  tail.position.set(0, 0.18, -0.95);
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.12), darkMat);
  rudder.position.set(0, 0.18, -1.15);
  rudder.name = 'rudder';
  group.add(tail, rudder);

  const exhaust = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, 0.3, 8),
    mat(c.metal, { metalness: 0.7, emissive: 0x220033, emissiveIntensity: 0 })
  );
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0, 0, -1.15);
  group.add(exhaust);

  const gear = makeGear(metalMat, darkMat, type.stats);
  group.add(gear);
  addShadow(group, type.stats.collisionRadius * 0.38);

  return finishPlane(group, {
    propMode: 'jet',
    propPivot: exhaust,
    blurDisc: { material: { opacity: 0 } },
    blades: [],
    aileronL,
    aileronR,
    rudder,
    elevatorL: tail,
    elevatorR: tail,
    gear,
    canopy,
    exhausts: [exhaust],
  }, type, typeIndex);
}

const BUILDERS = {
  poky: buildPoky,
  whale: buildWhale,
  banana: buildBanana,
  falcon: buildFalcon,
  moth: buildMoth,
  fortress: buildFortress,
  loopy: buildLoopy,
  neon: buildNeon,
};

/**
 * @param {number} typeIndex 0–7
 */
export function createPlane(typeIndex = 0) {
  const idx = ((typeIndex % PLANE_TYPES.length) + PLANE_TYPES.length) % PLANE_TYPES.length;
  const type = PLANE_TYPES[idx];
  const builder = BUILDERS[type.id] || buildPoky;
  return builder(type, idx);
}

export function getPlaneType(index) {
  const idx = ((index % PLANE_TYPES.length) + PLANE_TYPES.length) % PLANE_TYPES.length;
  return PLANE_TYPES[idx];
}

/** Animate control surfaces + propeller / jet exhaust from flight state. */
export function updatePlaneVisuals(parts, state, dt) {
  const {
    rollInput = 0,
    pitchInput = 0,
    yawInput = 0,
    turnInput = 0,
    throttle = 0.5,
    airspeed = 0,
    onGround = false,
  } = state;
  const turn = turnInput || yawInput;
  const def = 0.45;
  const bankViz = turn * 0.7 + rollInput;

  if (parts.aileronL) parts.aileronL.rotation.x = bankViz * def;
  if (parts.aileronR) parts.aileronR.rotation.x = -bankViz * def;
  if (parts.elevatorL) parts.elevatorL.rotation.x = pitchInput * def;
  if (parts.elevatorR) parts.elevatorR.rotation.x = pitchInput * def;
  if (parts.rudder) parts.rudder.rotation.y = -turn * def;

  const mode = parts.propMode || 'single';
  if (mode === 'single' && parts.propPivot) {
    const rpm = 8 + throttle * 45 + airspeed * 0.05;
    parts.propPivot.rotation.z += rpm * dt;
    const blur = Math.min(1, throttle * 1.2);
    if (parts.blurDisc?.material) parts.blurDisc.material.opacity = blur * 0.35;
    parts.blades?.forEach((b) => {
      b.visible = blur < 0.7;
    });
  } else if (mode === 'jet' && parts.exhausts) {
    const glow = 0.35 + throttle * 0.65;
    parts.exhausts.forEach((ex) => {
      ex.scale.setScalar(1 + throttle * 0.12);
      if (ex.material?.emissive) {
        ex.material.emissive.setHSL(0.08, 1, 0.35 + glow * 0.25);
        ex.material.emissiveIntensity = glow;
      }
    });
  }

  if (parts.gear) {
    const gearTarget = onGround || airspeed < Math.max(18, 22 * (parts.typeIndex === 4 ? 0.75 : 1)) ? 0 : 1;
    parts._gearT = THREE.MathUtils.lerp(parts._gearT ?? 0, gearTarget, 1 - Math.exp(-3 * dt));
    parts.gear.rotation.x = parts._gearT * 1.2;
    parts.gear.position.y = -parts._gearT * 0.15;
    parts.gear.visible = parts._gearT < 0.95;
  }
}
