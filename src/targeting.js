/**
 * Target lock + screen-edge threat indicators.
 */
import * as THREE from 'three';

const _proj = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

/** Pick best target inside a wide aim cone — forgiving lock assist. */
export function findAimAssistTarget(origin, dir, targets, opts = {}) {
  const maxDist = opts.maxDist ?? 520;
  const coneHalf = opts.coneHalf ?? 0.48; // ~27° half-angle
  const minDot = Math.cos(coneHalf);
  const preferId = opts.preferId;
  const preferKind = opts.preferKind;
  let best = null;
  let bestScore = Infinity;

  for (const t of targets) {
    if (t.kind === 'self' || t.kind === 'flare') continue;
    _toTarget.subVectors(t.position, origin);
    const dist = _toTarget.length();
    if (dist > maxDist || dist < 6) continue;
    _toTarget.normalize();
    const dot = dir.dot(_toTarget);
    if (dot < minDot) continue;
    const angleScore = (1 - dot) * 120;
    const distScore = (dist / maxDist) * 35;
    let score = angleScore + distScore;
    // Stick to current soft target so the cursor doesn't hop between foes.
    if (preferId != null && t.id === preferId && t.kind === preferKind) {
      score *= 0.55;
    }
    if (score < bestScore) {
      bestScore = score;
      best = { target: t, dist, point: t.position.clone() };
    }
  }
  return best;
}

export class TargetLockSystem {
  constructor() {
    this.lockId = null;
    this.lockKind = null;
    this.acquire = 0;
    this.acquireTime = 0.65;
    this.maxLockDist = 620;
    /** Half-angle (rad) — lock breaks if target leaves this forward cone. */
    this.maintainConeHalf = 0.72; // ~41°
    this._pendingId = null;
    this._pendingKind = null;
    this._justLocked = false;
  }

  clear() {
    this.lockId = null;
    this.lockKind = null;
    this.acquire = 0;
    this._pendingId = null;
    this._pendingKind = null;
    this._justLocked = false;
  }

  /** @returns {object|null} locked hitTarget entry */
  getLockedTarget(hitTargets) {
    if (this.lockId == null || this.acquire < this.acquireTime) return null;
    return (
      hitTargets.find((t) => t.id === this.lockId && t.kind === this.lockKind) || null
    );
  }

  consumeJustLocked() {
    const v = this._justLocked;
    this._justLocked = false;
    return v;
  }

  /** True if target is still ahead of the nose within the maintain cone. */
  _isInView(playerPos, aimDir, targetPos) {
    if (!aimDir || !playerPos || !targetPos) return true;
    _toTarget.subVectors(targetPos, playerPos);
    if (_toTarget.lengthSq() < 4) return true;
    _toTarget.normalize();
    return aimDir.dot(_toTarget) >= Math.cos(this.maintainConeHalf);
  }

  /**
   * Hold T while a target is in the aim cone to acquire lock.
   * Completed locks break if the target leaves the forward view / dies / outranges.
   * @param {boolean} lockHeld T key held down
   * @param {object|null} assistHit from findAimAssistTarget
   * @param {THREE.Vector3} [aimDir] aircraft forward (for view break)
   */
  update(dt, hitTargets, assistHit, lockHeld, playerPos, aimDir = null) {
    this._justLocked = false;
    const aimTarget = assistHit?.target;
    const validKinds = new Set(['ai', 'peer']);
    let fullyLocked = this.lockId != null && this.acquire >= this.acquireTime;

    if (fullyLocked) {
      const locked = hitTargets.find((t) => t.id === this.lockId && t.kind === this.lockKind);
      if (!locked) {
        this.clear();
      } else {
        const dist = playerPos.distanceTo(locked.position);
        if (dist > this.maxLockDist || (locked.ref && locked.ref.alive === false)) {
          this.clear();
        } else if (!this._isInView(playerPos, aimDir, locked.position)) {
          // Looked away — break lock so player must re-acquire
          this.clear();
        }
      }
      fullyLocked = this.lockId != null && this.acquire >= this.acquireTime;
      // Keep completed lock while still holding and target remains in view;
      // if lockHeld is false (looked away on touch), still already cleared above when out of view.
      if (fullyLocked && !lockHeld) return;
    }

    if (lockHeld) {
      const candidate =
        aimTarget && validKinds.has(aimTarget.kind)
          ? aimTarget
          : this._nearestTarget(hitTargets, playerPos, validKinds, 620);

      if (candidate) {
        if (this._pendingId !== candidate.id || this._pendingKind !== candidate.kind) {
          if (!fullyLocked || this.lockId !== candidate.id) {
            this._pendingId = candidate.id;
            this._pendingKind = candidate.kind;
            if (!fullyLocked) this.acquire = Math.max(this.acquire, 0.15);
          }
        }

        const prev = this.acquire;
        this.acquire = Math.min(this.acquireTime, this.acquire + dt * 1.15);
        if (prev < this.acquireTime && this.acquire >= this.acquireTime) {
          this.lockId = candidate.id;
          this.lockKind = candidate.kind;
          this._justLocked = true;
        }
      } else if (!fullyLocked) {
        this.acquire = Math.max(0, this.acquire - dt * 1.4);
        if (this.acquire <= 0) {
          this._pendingId = null;
          this._pendingKind = null;
        }
      }
      return;
    }

    // Released T before lock finished — reset progress
    if (!fullyLocked) {
      this.acquire = Math.max(0, this.acquire - dt * 1.6);
      if (this.acquire <= 0) {
        this.lockId = null;
        this.lockKind = null;
        this._pendingId = null;
        this._pendingKind = null;
      }
    }
  }

  _nearestTarget(hitTargets, playerPos, validKinds, maxDist = 620) {
    const list = hitTargets.filter((t) => validKinds.has(t.kind));
    if (!list.length) return null;
    list.sort((a, b) => playerPos.distanceTo(a.position) - playerPos.distanceTo(b.position));
    const nearest = list[0];
    if (playerPos.distanceTo(nearest.position) > maxDist) return null;
    return nearest;
  }

  get acquireRatio() {
    return Math.min(1, this.acquire / this.acquireTime);
  }

  isLockedOn(id, kind) {
    return this.lockId === id && this.lockKind === kind && this.acquire >= this.acquireTime;
  }
}

/**
 * Project world threats to screen / edge-clamped HUD markers.
 * @returns {Array<{id, kind, x, y, onScreen, dist, locked, color, label}>}
 */
export function buildThreatMarkers(threats, camera, playerPos, lockSystem) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const margin = 42;
  const out = [];

  for (const th of threats) {
    if (!th.position) continue;
    _proj.copy(th.position).project(camera);
    if (_proj.z > 1) continue;

    const sx = (_proj.x * 0.5 + 0.5) * w;
    const sy = (-_proj.y * 0.5 + 0.5) * h;
    const onScreen =
      _proj.z >= -1 &&
      sx >= margin &&
      sx <= w - margin &&
      sy >= margin &&
      sy <= h - margin;

    let x = sx;
    let y = sy;
    if (!onScreen) {
      _dir.set(sx - cx, sy - cy, 0);
      if (_dir.lengthSq() < 1) _dir.set(0, -1, 0);
      _dir.normalize();
      const absX = Math.abs(_dir.x);
      const absY = Math.abs(_dir.y);
      const reach = Math.min(
        absX > 0.001 ? (w * 0.5 - margin) / absX : Infinity,
        absY > 0.001 ? (h * 0.5 - margin) / absY : Infinity
      );
      x = cx + _dir.x * reach;
      y = cy + _dir.y * reach;
    }

    const dist = playerPos.distanceTo(th.position);
    const locked = lockSystem?.isLockedOn(th.id, th.kind);
    out.push({
      id: th.id,
      kind: th.kind,
      x,
      y,
      angle: Math.atan2(y - cy, x - cx),
      onScreen,
      dist,
      locked,
      color: th.kind === 'peer' ? '#60a5fa' : '#f87171',
      label: th.kind === 'peer' ? 'P' : 'E',
    });
  }

  return out;
}
