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
    };
    this.mctx = this.els.minimap?.getContext('2d');
    if (this.els.minimap) {
      this.els.minimap.width = 168;
      this.els.minimap.height = 168;
    }
  }

  show(on) {
    this.els.hud?.classList.toggle('hidden', !on);
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
      playerPos,
      markers = [],
      territory = null,
      mapTint = null,
      onGround = false,
      weaponLabel = '',
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
      this.els.stall.textContent = t('stall');
      this.els.stall.classList.toggle('hidden', !stalling);
    }
    if (this.els.vignette) {
      this.els.vignette.style.opacity = String(Math.max(0, (100 - health) / 120));
    }

    if (playerPos) this._drawMinimap(playerPos, heading, markers, territory, mapTint, onGround);
  }

  _drawMinimap(playerPos, heading, markers, territory, mapTint, onGround) {
    const ctx = this.mctx;
    const canvas = this.els.minimap;
    if (!ctx || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = w / 2 - 3;
    const scale = radius / 160;

    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = mapTint || 'rgba(12, 36, 56, 0.82)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = onGround ? 'rgba(74, 222, 128, 0.6)' : 'rgba(255,255,255,0.35)';
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate((-heading * Math.PI) / 180);

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    for (let g = -160; g <= 160; g += 40) {
      ctx.beginPath();
      ctx.moveTo(g * scale, -radius);
      ctx.lineTo(g * scale, radius);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-radius, g * scale);
      ctx.lineTo(radius, g * scale);
      ctx.stroke();
    }

    const hx = -playerPos.x * scale;
    const hz = -playerPos.z * scale;
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(hx - 2, hz - 10, 4, 20);
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath();
    ctx.arc(hx, hz, 3, 0, Math.PI * 2);
    ctx.fill();

    if (territory?.radius) {
      ctx.beginPath();
      ctx.arc(hx, hz, territory.radius * scale, 0, Math.PI * 2);
      ctx.strokeStyle = territory.warning ? 'rgba(248,113,113,0.85)' : 'rgba(74,222,128,0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const m of markers) {
      const dx = (m.x - playerPos.x) * scale;
      const dz = (m.z - playerPos.z) * scale;
      if (dx * dx + dz * dz > radius * radius) continue;
      ctx.fillStyle = m.color || '#4ade80';
      ctx.beginPath();
      ctx.arc(dx, dz, m.r || 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = '#ff6b4a';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx - 6, cy + 7);
    ctx.lineTo(cx + 6, cy + 7);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 10px Nunito, Vazirmatn, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, 14);
  }
}
