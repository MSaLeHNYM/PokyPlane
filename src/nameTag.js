/**
 * Billboard name tag above a plane (canvas → Sprite).
 */
import * as THREE from 'three';

export function makeNameTag(name, opts = {}) {
  const label = String(name || 'Pilot').slice(0, 24);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 28px Nunito, Vazirmatn, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = Math.min(240, ctx.measureText(label).width + 28);
  const th = 40;
  const x = (canvas.width - tw) / 2;
  const y = (canvas.height - th) / 2;
  ctx.fillStyle = 'rgba(8, 20, 36, 0.78)';
  ctx.beginPath();
  const r = 10;
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + tw, y, x + tw, y + th, r);
  ctx.arcTo(x + tw, y + th, x, y + th, r);
  ctx.arcTo(x, y + th, x, y, r);
  ctx.arcTo(x, y, x + tw, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = opts.accent || 'rgba(96, 165, 250, 0.65)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#f0f6ff';
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(opts.scaleX ?? 12, opts.scaleY ?? 3, 1);
  sprite.center.set(0.5, 0);
  sprite.position.set(0, opts.y ?? 4.2, 0);
  sprite.userData.nameTag = label;
  return sprite;
}

export function setNameTagText(sprite, name, opts = {}) {
  if (!sprite?.material?.map?.image) return;
  const next = makeNameTag(name, opts);
  const oldMap = sprite.material.map;
  sprite.material.map = next.material.map;
  sprite.material.needsUpdate = true;
  sprite.userData.nameTag = next.userData.nameTag;
  oldMap.dispose();
  next.material.dispose();
}

export function disposeNameTag(sprite) {
  if (!sprite) return;
  sprite.material?.map?.dispose();
  sprite.material?.dispose();
  sprite.parent?.remove(sprite);
}
