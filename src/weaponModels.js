/**
 * Procedural 3D weapon models — shared by the Armory preview panel and the
 * plane hardpoint mounts. All models point +Z (plane forward), flat-shaded
 * to match the aircraft art style.
 */
import * as THREE from 'three';

const COLORS = {
  gunmetal: 0x3f4753,
  steel: 0x8b98a8,
  dark: 0x1f242c,
  mgAccent: 0xffe066,
  cannonAccent: 0xff9933,
  rocketBody: 0xd8dee7,
  rocketAccent: 0xff5522,
  missileBody: 0xe8edf3,
  missileAccent: 0x55e8a0,
};

function m(color, extras = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.4,
    flatShading: true,
    ...extras,
  });
}

function cyl(radiusTop, radiusBottom, length, mat, segments = 8) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, length, segments),
    mat
  );
  mesh.rotation.x = Math.PI / 2; // axis → +Z
  return mesh;
}

function cone(radius, length, mat, segments = 8) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, length, segments), mat);
  mesh.rotation.x = Math.PI / 2; // tip → +Z
  return mesh;
}

/** Cross of 4 fins around the body at z; finW along body axis. */
function addFins(group, { z, size, finW, mat, offset }) {
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(size, 0.012, finW), mat);
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    fin.position.set(Math.cos(angle) * offset, Math.sin(angle) * offset, z);
    fin.rotation.z = angle;
    group.add(fin);
  }
}

/** Twin machine-gun pod: receiver + two barrels with muzzle tips. */
export function buildMgModel() {
  const g = new THREE.Group();
  const body = m(COLORS.gunmetal);
  const barrel = m(COLORS.dark, { metalness: 0.6, roughness: 0.3 });
  const accent = m(COLORS.mgAccent, { metalness: 0.2, roughness: 0.5 });

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.42), body);
  receiver.position.z = -0.1;
  g.add(receiver);

  for (const x of [-0.09, 0.09]) {
    const b = cyl(0.035, 0.04, 0.55, barrel, 8);
    b.position.set(x, 0, 0.3);
    g.add(b);
    const muzzle = cyl(0.05, 0.05, 0.07, accent, 8);
    muzzle.position.set(x, 0, 0.56);
    g.add(muzzle);
  }

  const ammoBox = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.2), m(COLORS.steel));
  ammoBox.position.set(0, -0.12, -0.16);
  g.add(ammoBox);
  return g;
}

/** Heavy autocannon: breech + long barrel + muzzle brake. */
export function buildCannonModel() {
  const g = new THREE.Group();
  const body = m(COLORS.gunmetal);
  const barrelMat = m(COLORS.dark, { metalness: 0.65, roughness: 0.28 });
  const accent = m(COLORS.cannonAccent, { metalness: 0.25 });

  const breech = cyl(0.11, 0.13, 0.34, body, 8);
  breech.position.z = -0.22;
  g.add(breech);

  const barrel = cyl(0.055, 0.07, 0.72, barrelMat, 8);
  barrel.position.z = 0.28;
  g.add(barrel);

  // Cooling bands
  for (const z of [0.06, 0.22, 0.38]) {
    const band = cyl(0.075, 0.075, 0.035, accent, 8);
    band.position.z = z;
    g.add(band);
  }

  const brake = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.16), body);
  brake.position.z = 0.68;
  g.add(brake);

  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.12), accent);
  sight.position.set(0, 0.14, -0.15);
  g.add(sight);
  return g;
}

/** Unguided rocket: pointed nose, striped body, 4 tail fins, nozzle. */
export function buildRocketModel() {
  const g = new THREE.Group();
  const bodyMat = m(COLORS.rocketBody, { metalness: 0.2, roughness: 0.5 });
  const accent = m(COLORS.rocketAccent, { metalness: 0.15 });
  const dark = m(COLORS.dark);

  const body = cyl(0.085, 0.085, 0.62, bodyMat, 8);
  g.add(body);

  const nose = cone(0.085, 0.24, accent, 8);
  nose.position.z = 0.43;
  g.add(nose);

  const stripe = cyl(0.09, 0.09, 0.07, accent, 8);
  stripe.position.z = 0.16;
  g.add(stripe);

  addFins(g, { z: -0.26, size: 0.16, finW: 0.14, mat: accent, offset: 0.11 });

  const nozzle = cyl(0.055, 0.075, 0.09, dark, 8);
  nozzle.position.z = -0.35;
  g.add(nozzle);
  return g;
}

/** Homing missile: sleek body, seeker band, mid + tail fin sets. */
export function buildMissileModel() {
  const g = new THREE.Group();
  const bodyMat = m(COLORS.missileBody, { metalness: 0.25, roughness: 0.4 });
  const accent = m(COLORS.missileAccent, { metalness: 0.2, emissive: 0x0e3a28, emissiveIntensity: 0.35 });
  const dark = m(COLORS.dark);

  const body = cyl(0.07, 0.07, 0.78, bodyMat, 8);
  g.add(body);

  const nose = cone(0.07, 0.22, dark, 8);
  nose.position.z = 0.5;
  g.add(nose);

  // Seeker band — glowing green so the homing weapon reads at a glance
  const seeker = cyl(0.074, 0.074, 0.08, accent, 8);
  seeker.position.z = 0.32;
  g.add(seeker);

  addFins(g, { z: 0.08, size: 0.1, finW: 0.16, mat: bodyMat, offset: 0.085 });
  addFins(g, { z: -0.32, size: 0.15, finW: 0.13, mat: accent, offset: 0.1 });

  const nozzle = cyl(0.045, 0.062, 0.08, dark, 8);
  nozzle.position.z = -0.43;
  g.add(nozzle);
  return g;
}

/** Under-wing rocket pod: 3-tube cluster with visible rocket tips. */
export function buildRocketPodModel() {
  const g = new THREE.Group();
  const shell = m(COLORS.gunmetal);
  const tubeMat = m(COLORS.dark);
  const tip = m(COLORS.rocketAccent);

  const pod = cyl(0.14, 0.15, 0.5, shell, 10);
  g.add(pod);

  const tubeOffsets = [
    [0, 0.065],
    [-0.06, -0.04],
    [0.06, -0.04],
  ];
  for (const [x, y] of tubeOffsets) {
    const tube = cyl(0.045, 0.045, 0.06, tubeMat, 8);
    tube.position.set(x, y, 0.25);
    g.add(tube);
    const rocketTip = cone(0.035, 0.08, tip, 8);
    rocketTip.position.set(x, y, 0.3);
    g.add(rocketTip);
  }

  const tail = cyl(0.12, 0.14, 0.05, tubeMat, 10);
  tail.position.z = -0.27;
  g.add(tail);
  return g;
}

const ARMORY_BUILDERS = {
  mg: buildMgModel,
  cannon: buildCannonModel,
  rocket: buildRocketModel,
  missile: buildMissileModel,
};

/** Detailed model for the Armory preview (centered at origin, +Z forward). */
export function createWeaponModel(weaponId) {
  const build = ARMORY_BUILDERS[weaponId] || buildMgModel;
  const g = build();
  g.name = `weapon-${weaponId}`;
  return g;
}

/**
 * Compact model for mounting on planes.
 * mg/cannon → gun pods, rocket → 3-tube pod, missile → single missile.
 */
export function createHardpointModel(weaponId, scale = 1) {
  let g;
  if (weaponId === 'rocket') g = buildRocketPodModel();
  else g = createWeaponModel(weaponId);
  g.scale.setScalar(scale);
  g.name = `hardpoint-${weaponId}`;
  return g;
}
