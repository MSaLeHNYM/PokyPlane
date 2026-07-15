/**
 * HUD gauges + radar minimap (no center artificial-horizon circle).
 */
import { t } from './i18n.js';

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class HUD {
  constructor() {
    this.els = {
      mode: document.getElementById('hud-mode'),
      score: document.getElementById('hud-score'),
      timer: document.getElementById('hud-timer'),
      speed: document.getElementById('hud-speed'),
      alt: document.getElementById('hud-alt'),
      heading: document.getElementById('hud-heading'),
      weapon: document.getElementById('hud-weapon'),
      throttle: document.getElementById('throttle-fill'),
      fuel: document.getElementById('fuel-fill'),
      fuelWrap: document.getElementById('fuel-wrap'),
      health: document.getElementById('health-fill'),
      objective: document.getElementById('objective'),
      stall: document.getElementById('stall-warning'),
      vignette: document.getElementById('damage-vignette'),
      minimap: document.getElementById('minimap'),
      hud: document.getElementById('hud'),
      toast: document.getElementById('toast'),
      reticle: document.getElementById('target-reticle'),
      reticleRange: document.querySelector('#target-reticle .reticle-range'),
      threats: document.getElementById('threat-indicators'),
      lockStatus: document.getElementById('lock-status'),
    };
    this._threatPool = [];
    this.mctx = this.els.minimap?.getContext('2d');
    if (this.els.minimap) {
      this.els.minimap.width = 196;
      this.els.minimap.height = 196;
    }
  }

  show(on) {
    this.els.hud?.classList.toggle('hidden', !on);
    if (!on) {
      this.updateReticle({ visible: false });
      this.updateThreatIndicators([]);
      this.updateLockStatus(null);
    }
  }

  toast(msg, ms = 1800) {
    const el = this.els.toast;
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('show'), ms);
  }

  update(state) {
    const {
      mode,
      score,
      timer,
      speed,
      alt,
      heading,
      throttle,
      health,
      fuel = null,
      fuelLimit = false,
      objective,
      stalling,
      spinning = false,
      playerPos,
      markers = [],
      territory = null,
      mapTint = null,
      onGround = false,
      weaponLabel = '',
      radarRange = 220,
    } = state;

    if (this.els.mode) this.els.mode.textContent = mode;
    if (this.els.score) this.els.score.textContent = `${t('score')}: ${score}`;
    if (this.els.timer) {
      if (timer != null) {
        const m = Math.floor(timer / 60);
        const s = Math.floor(timer % 60);
        this.els.timer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      } else this.els.timer.textContent = '';
    }
    if (this.els.speed) this.els.speed.textContent = String(Math.round(speed));
    if (this.els.alt) this.els.alt.textContent = String(Math.round(Math.max(0, alt)));
    if (this.els.heading) {
      const idx = Math.round(heading / 45) % 8;
      this.els.heading.textContent = CARDINALS[idx];
    }
    if (this.els.weapon && weaponLabel) this.els.weapon.textContent = weaponLabel;
    if (this.els.throttle) this.els.throttle.style.height = `${throttle * 100}%`;
    if (this.els.fuelWrap) {
      this.els.fuelWrap.classList.toggle('hidden', !fuelLimit);
    }
    if (this.els.fuel && fuelLimit) {
      const pct = Math.max(0, Math.min(100, fuel ?? 0));
      this.els.fuel.style.height = `${pct}%`;
      this.els.fuel.style.background =
        pct > 40
          ? 'linear-gradient(180deg, #fbbf24, #f59e0b)'
          : pct > 15
            ? 'linear-gradient(180deg, #fb923c, #ea580c)'
            : 'linear-gradient(180deg, #f87171, #dc2626)';
    }
    if (this.els.health) {
      this.els.health.style.height = `${health}%`;
      this.els.health.style.background =
        health > 50
          ? 'linear-gradient(180deg, #4ade80, #22c55e)'
          : health > 25
            ? 'linear-gradient(180deg, #fbbf24, #f59e0b)'
            : 'linear-gradient(180deg, #f87171, #ef4444)';
    }
    if (this.els.objective) this.els.objective.textContent = objective || '';
    if (this.els.stall) {
      if (spinning) {
        this.els.stall.textContent = t('spin');
        this.els.stall.classList.add('spin-warn');
      } else {
        this.els.stall.textContent = t('stall');
        this.els.stall.classList.remove('spin-warn');
      }
      this.els.stall.classList.toggle('hidden', !stalling && !spinning);
    }
    if (this.els.vignette) {
      this.els.vignette.style.opacity = String(Math.max(0, (100 - health) / 120));
    }

    if (playerPos) {
      this._drawMinimap(playerPos, heading, markers, territory, mapTint, onGround, radarRange);
    }
    if (state.reticle) this.updateReticle(state.reticle);
  }

  updateReticle({
    visible,
    x,
    y,
    weapon = 'mg',
    locked = false,
    hardLocked = false,
    acquiring = 0,
    dist = null,
    onScreen = true,
    softTarget = false,
  }) {
    const el = this.els.reticle;
    if (!el) return;

    el.classList.toggle('hidden', !visible);
    if (!visible) return;

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.classList.toggle('locked', locked);
    el.classList.toggle('hard-locked', hardLocked);
    el.classList.toggle('soft-target', softTarget);
    el.classList.toggle('off-screen', !onScreen);
    el.style.setProperty('--acquire', String(Math.max(0, Math.min(1, acquiring))));

    for (const id of ['mg', 'cannon', 'rocket', 'missile']) {
      el.classList.toggle(`wpn-${id}`, weapon === id);
    }

    if (this.els.reticleRange) {
      this.els.reticleRange.textContent = dist != null ? `${Math.round(dist)}m` : '';
    }
  }

  updateLockStatus(text) {
    const el = this.els.lockStatus;
    if (!el) return;
    if (!text) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.textContent = text;
    el.classList.remove('hidden');
  }

  updateThreatIndicators(markers) {
    const root = this.els.threats;
    if (!root) return;

    while (this._threatPool.length < markers.length) {
      const node = document.createElement('div');
      node.className = 'threat-marker';
      node.innerHTML =
        '<span class="threat-arrow"></span><span class="threat-label"></span><span class="threat-dist"></span>';
      root.appendChild(node);
      this._threatPool.push(node);
    }

    for (let i = 0; i < this._threatPool.length; i++) {
      const node = this._threatPool[i];
      const m = markers[i];
      if (!m) {
        node.classList.add('hidden');
        continue;
      }
      node.classList.remove('hidden');
      node.classList.toggle('on-screen', m.onScreen);
      node.classList.toggle('locked', m.locked);
      node.classList.toggle('peer', m.kind === 'peer');
      node.style.left = `${m.x}px`;
      node.style.top = `${m.y}px`;
      node.style.setProperty('--threat-angle', `${m.angle}rad`);
      const label = node.querySelector('.threat-label');
      const dist = node.querySelector('.threat-dist');
      if (label) label.textContent = m.label;
      if (dist) dist.textContent = `${Math.round(m.dist)}m`;
    }
  }

  _drawMinimap(playerPos, heading, markers, territory, mapTint, onGround, radarRange) {
    const ctx = this.mctx;
    const canvas = this.els.minimap;
    if (!ctx || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = w / 2 - 4;
    const scale = radius / radarRange;

    ctx.clearRect(0, 0, w, h);

    // Radar background
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, 'rgba(16, 48, 72, 0.95)');
    grad.addColorStop(1, 'rgba(8, 24, 40, 0.92)');
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = onGround ? 'rgba(74, 222, 128, 0.55)' : 'rgba(96, 165, 250, 0.45)';
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate((-heading * Math.PI) / 180);

    // Range rings
    ctx.lineWidth = 1;
    for (const frac of [0.25, 0.5, 0.75, 1]) {
      ctx.beginPath();
      ctx.arc(0, 0, radius * frac, 0, Math.PI * 2);
      ctx.strokeStyle =
        frac === 1 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)';
      ctx.stroke();
    }

    // Cross grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.moveTo(-radius, 0);
    ctx.lineTo(radius, 0);
    ctx.moveTo(0, -radius);
    ctx.lineTo(0, radius);
    ctx.stroke();

    const hx = -playerPos.x * scale;
    const hz = -playerPos.z * scale;

    if (territory?.radius) {
      ctx.beginPath();
      ctx.arc(hx, hz, territory.radius * scale, 0, Math.PI * 2);
      ctx.strokeStyle = territory.warning ? 'rgba(248,113,113,0.85)' : 'rgba(74,222,128,0.45)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Blips — inside radar or clamped to rim for long range
    for (const m of markers) {
      const dx = (m.x - playerPos.x) * scale;
      const dz = (m.z - playerPos.z) * scale;
      const dist = Math.hypot(dx, dz);
      const ang = Math.atan2(dz, dx);
      const inside = dist <= radius - 6;
      const px = inside ? dx : Math.cos(ang) * (radius - 5);
      const pz = inside ? dz : Math.sin(ang) * (radius - 5);
      const dotR = m.locked ? 4.5 : inside ? m.r || 3.5 : 3;

      if (!inside) {
        // Rim tick pointing toward contact
        ctx.save();
        ctx.translate(px, pz);
        ctx.rotate(ang);
        ctx.fillStyle = m.color || '#f87171';
        ctx.beginPath();
        ctx.moveTo(5, 0);
        ctx.lineTo(-2, -3);
        ctx.lineTo(-2, 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (m.shape === 'diamond') {
        ctx.fillStyle = m.color || '#4ade80';
        ctx.beginPath();
        ctx.moveTo(px, pz - dotR);
        ctx.lineTo(px + dotR, pz);
        ctx.lineTo(px, pz + dotR);
        ctx.lineTo(px - dotR, pz);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = m.color || '#4ade80';
        ctx.beginPath();
        ctx.arc(px, pz, dotR, 0, Math.PI * 2);
        ctx.fill();
        if (m.locked) {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      if (m.kind === 'enemy' && (inside || m.locked)) {
        const label = m.dist != null ? `${Math.round(m.dist)}` : '';
        if (label) {
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.font = 'bold 8px Nunito, Vazirmatn, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(label, px, pz - dotR - 3);
        }
      }
    }

    // Player icon
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(hx - 2, hz - 9, 4, 18);
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath();
    ctx.arc(hx, hz, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Fixed heading arrow + range label
    ctx.fillStyle = '#ff6b4a';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 9);
    ctx.lineTo(cx - 5, cy + 6);
    ctx.lineTo(cx + 5, cy + 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = 'bold 9px Nunito, Vazirmatn, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, 12);

    ctx.fillStyle = 'rgba(147, 197, 253, 0.85)';
    ctx.font = 'bold 8px Nunito, Vazirmatn, sans-serif';
    ctx.fillText(`${Math.round(radarRange / 100) / 10}km`, cx, h - 6);
  }
}
