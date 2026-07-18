/**
 * Procedural one-shot SFX bank with cooldowns and voice limiting.
 */
import { whiteNoiseBuffer, pinkNoiseBuffer, brownNoiseBuffer } from './noise.js';

const MAX_VOICES = 8;

export class SfxBank {
  /**
   * @param {import('./AudioContextHub.js').AudioContextHub} hub
   * @param {import('./SpatialListener.js').SpatialListener} spatial
   */
  constructor(hub, spatial) {
    this.hub = hub;
    this.spatial = spatial;
    this._cooldowns = new Map();
    this._voices = 0;
    this._stall = null;
    this._stallOn = false;
    this._stallTimer = null;
  }

  _ready(kind, ms) {
    const now = performance.now();
    const next = this._cooldowns.get(kind) || 0;
    if (now < next) return false;
    this._cooldowns.set(kind, now + ms);
    return true;
  }

  _acquire() {
    if (this._voices >= MAX_VOICES) return false;
    this._voices += 1;
    return true;
  }

  _release(afterSec) {
    const ctx = this.hub.ctx;
    const ms = Math.max(50, (afterSec || 0.2) * 1000);
    setTimeout(() => {
      this._voices = Math.max(0, this._voices - 1);
    }, ms);
    // Also schedule against audio clock if available
    if (ctx) {
      /* voice count is approximate; timeout is fine */
    }
  }

  _dest(x, y, z, bus = 'sfx') {
    if (x != null && y != null && z != null) {
      return this.spatial.createPanner(bus, { x, y, z });
    }
    return this.hub.bus(bus);
  }

  playGunfire(variant = 'mg') {
    if (!this.hub.ctx || !this._acquire()) return;
    if (!this._ready(`gun-${variant}`, variant === 'cannon' ? 70 : 35)) {
      this._voices -= 1;
      return;
    }
    const ctx = this.hub.ctx;
    const t = ctx.currentTime;
    const dest = this.hub.bus('sfx');
    const hi = variant === 'cannon' ? 900 : 1800;
    const dur = variant === 'cannon' ? 0.14 : 0.08;

    const noise = ctx.createBufferSource();
    noise.buffer = whiteNoiseBuffer(ctx, 0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = hi;
    bp.Q.value = variant === 'cannon' ? 1.2 : 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(variant === 'cannon' ? 0.55 : 0.38, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(bp);
    bp.connect(g);
    g.connect(dest);
    noise.start(t);
    noise.stop(t + dur + 0.02);

    const click = ctx.createOscillator();
    click.type = 'square';
    click.frequency.value = variant === 'cannon' ? 110 : 220;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(variant === 'cannon' ? 0.22 : 0.14, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    click.connect(cg);
    cg.connect(dest);
    click.start(t);
    click.stop(t + 0.06);
    this._release(dur);
  }

  playRocket() {
    if (!this.hub.ctx || !this._acquire()) return;
    if (!this._ready('rocket', 80)) {
      this._voices -= 1;
      return;
    }
    const ctx = this.hub.ctx;
    const t = ctx.currentTime;
    const dest = this.hub.bus('sfx');

    const noise = ctx.createBufferSource();
    noise.buffer = pinkNoiseBuffer(ctx, 0.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1100, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.32);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.58, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
    noise.connect(lp);
    lp.connect(g);
    g.connect(dest);
    noise.start(t);
    noise.stop(t + 0.4);

    const whoosh = ctx.createOscillator();
    whoosh.type = 'sawtooth';
    whoosh.frequency.setValueAtTime(160, t);
    whoosh.frequency.exponentialRampToValueAtTime(55, t + 0.28);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.14, t);
    wg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    whoosh.connect(wg);
    wg.connect(dest);
    whoosh.start(t);
    whoosh.stop(t + 0.32);
    this._release(0.4);
  }

  playExplosion(x = 0, y = 0, z = 0, size = 1) {
    if (!this.hub.ctx || !this._acquire()) return;
    if (!this._ready('explosion', 40)) {
      this._voices -= 1;
      return;
    }
    const ctx = this.hub.ctx;
    const t = ctx.currentTime;
    const s = Math.max(0.4, Math.min(2.2, size));
    const dest = this._dest(x, y, z);

    const noise = ctx.createBufferSource();
    noise.buffer = brownNoiseBuffer(ctx, 0.7);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500 * s;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.75 * s, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55 * s);
    noise.connect(lp);
    lp.connect(g);
    g.connect(dest);
    noise.start(t);
    noise.stop(t + 0.65 * s);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(55 / Math.sqrt(s), t);
    sub.frequency.exponentialRampToValueAtTime(22, t + 0.45 * s);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.6 * s, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.5 * s);
    sub.connect(sg);
    sg.connect(dest);
    sub.start(t);
    sub.stop(t + 0.55 * s);

    // Debris ticks
    for (let i = 0; i < 3; i++) {
      const tick = ctx.createOscillator();
      tick.type = 'triangle';
      const tt = t + 0.05 + i * 0.04;
      tick.frequency.value = 400 + Math.random() * 800;
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.08, tt);
      tg.gain.exponentialRampToValueAtTime(0.001, tt + 0.06);
      tick.connect(tg);
      tg.connect(dest);
      tick.start(tt);
      tick.stop(tt + 0.08);
    }
    this._release(0.7 * s);
  }

  playCrash(x = 0, y = 0, z = 0) {
    this.playExplosion(x, y, z, 1.8);
    if (!this.hub.ctx) return;
    const ctx = this.hub.ctx;
    const t = ctx.currentTime;
    const dest = this._dest(x, y, z);
    const metal = ctx.createOscillator();
    metal.type = 'sawtooth';
    metal.frequency.setValueAtTime(220, t);
    metal.frequency.exponentialRampToValueAtTime(40, t + 0.8);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(0.25, t);
    mg.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600;
    metal.connect(bp);
    bp.connect(mg);
    mg.connect(dest);
    metal.start(t);
    metal.stop(t + 1);
  }

  playHit() {
    if (!this.hub.ctx || !this._acquire()) return;
    if (!this._ready('hit', 50)) {
      this._voices -= 1;
      return;
    }
    const ctx = this.hub.ctx;
    const t = ctx.currentTime;
    const dest = this.hub.bus('sfx');
    const noise = ctx.createBufferSource();
    noise.buffer = whiteNoiseBuffer(ctx, 0.15);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    noise.connect(bp);
    bp.connect(g);
    g.connect(dest);
    noise.start(t);
    noise.stop(t + 0.12);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.value = 90;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.2, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    thump.connect(tg);
    tg.connect(dest);
    thump.start(t);
    thump.stop(t + 0.12);
    this._release(0.15);
  }

  playBoost() {
    if (!this.hub.ctx || !this._acquire()) return;
    if (!this._ready('boost', 200)) {
      this._voices -= 1;
      return;
    }
    const ctx = this.hub.ctx;
    const t = ctx.currentTime;
    const dest = this.hub.bus('sfx');
    const noise = ctx.createBufferSource();
    noise.buffer = pinkNoiseBuffer(ctx, 0.35);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(2200, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    noise.connect(bp);
    bp.connect(g);
    g.connect(dest);
    noise.start(t);
    noise.stop(t + 0.35);
    this._release(0.35);
  }

  playTouchdown(severity = 0.5) {
    if (!this.hub.ctx || !this._acquire()) return;
    if (!this._ready('touchdown', 250)) {
      this._voices -= 1;
      return;
    }
    const ctx = this.hub.ctx;
    const t = ctx.currentTime;
    const dest = this.hub.bus('sfx');
    const s = Math.max(0.2, Math.min(1.5, severity));

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(70, t);
    thump.frequency.exponentialRampToValueAtTime(30, t + 0.2);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.35 * s, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    thump.connect(tg);
    tg.connect(dest);
    thump.start(t);
    thump.stop(t + 0.28);

    const scrape = ctx.createBufferSource();
    scrape.buffer = pinkNoiseBuffer(ctx, 0.3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.25 * s, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    scrape.connect(lp);
    lp.connect(sg);
    sg.connect(dest);
    scrape.start(t);
    scrape.stop(t + 0.3);
    this._release(0.35);
  }

  playFuelPickup() {
    if (!this.hub.ctx || !this._acquire()) return;
    const ctx = this.hub.ctx;
    const t = ctx.currentTime;
    const dest = this.hub.bus('sfx');
    const freqs = [523.25, 659.25, 783.99, 1046.5];
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      const st = t + i * 0.045;
      g.gain.setValueAtTime(0.001, st);
      g.gain.linearRampToValueAtTime(0.16, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.18);
      o.connect(g);
      g.connect(dest);
      o.start(st);
      o.stop(st + 0.2);
    });
    this._release(0.35);
  }

  playUI(kind = 'click') {
    if (!this.hub.ctx) return;
    const ctx = this.hub.ctx;
    const t = ctx.currentTime;
    const dest = this.hub.bus('sfx');

    if (kind === 'back') {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(440, t);
      o.frequency.linearRampToValueAtTime(280, t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + 0.15);
      return;
    }

    if (kind === 'hover') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 740;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      o.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + 0.08);
      return;
    }

    const freqs = { click: 520, success: 660, ring: 880, warn: 320 };
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = kind === 'ring' ? 'triangle' : 'sine';
    osc.frequency.value = freqs[kind] || 520;
    if (kind === 'success' || kind === 'ring') {
      osc.frequency.setValueAtTime(freqs[kind], t);
      osc.frequency.linearRampToValueAtTime(freqs[kind] * 1.5, t + 0.12);
    }
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'ring' ? 0.25 : 0.1));
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  playScore() {
    if (!this.hub.ctx) return;
    const ctx = this.hub.ctx;
    const t = ctx.currentTime;
    const dest = this.hub.bus('sfx');
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      const st = t + i * 0.06;
      g.gain.setValueAtTime(0.14, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.2);
      o.connect(g);
      g.connect(dest);
      o.start(st);
      o.stop(st + 0.22);
    });
  }

  setStall(on) {
    if (!this.hub.ctx) return;
    if (on && !this._stallOn) {
      this._stallOn = true;
      const ctx = this.hub.ctx;
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc2.type = 'square';
      osc.frequency.value = 780;
      osc2.frequency.value = 1170;
      const g2 = ctx.createGain();
      g2.gain.value = 0.35;
      g.gain.value = 0;
      osc.connect(g);
      osc2.connect(g2);
      g2.connect(g);
      g.connect(this.hub.bus('sfx'));
      osc.start();
      osc2.start();
      const pulse = () => {
        if (!this._stallOn || !this.hub.ctx) return;
        const now = this.hub.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.2, now + 0.07);
        g.gain.linearRampToValueAtTime(0, now + 0.26);
        this._stallTimer = setTimeout(pulse, 380);
      };
      this._stall = { osc, osc2, gain: g };
      pulse();
    } else if (!on && this._stallOn) {
      this._stallOn = false;
      clearTimeout(this._stallTimer);
      if (this._stall) {
        try {
          this._stall.osc.stop();
        } catch (_) {
          /* */
        }
        try {
          this._stall.osc2.stop();
        } catch (_) {
          /* */
        }
        this._stall = null;
      }
    }
  }
}
