/**
 * Airframe / prop-wash wind — filtered noise driven by airspeed & stall.
 */
import { pinkNoiseBuffer, whiteNoiseBuffer } from './noise.js';

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export class WindSynth {
  /** @param {import('./AudioContextHub.js').AudioContextHub} hub */
  constructor(hub) {
    this.hub = hub;
    this.nodes = null;
  }

  start() {
    if (!this.hub.ctx || this.nodes) return;
    const ctx = this.hub.ctx;
    const bus = this.hub.bus('wind');

    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(bus);

    // Main airframe rush
    const src = ctx.createBufferSource();
    src.buffer = pinkNoiseBuffer(ctx, 2);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.55;
    src.connect(bp);
    bp.connect(out);

    // High vortex / canopy whistle
    const vortex = ctx.createBufferSource();
    vortex.buffer = whiteNoiseBuffer(ctx, 1.5);
    vortex.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2400;
    const vortexG = ctx.createGain();
    vortexG.gain.value = 0;
    vortex.connect(hp);
    hp.connect(vortexG);
    vortexG.connect(out);

    // Ground roll scrape
    const roll = ctx.createBufferSource();
    roll.buffer = pinkNoiseBuffer(ctx, 1.2);
    roll.loop = true;
    const rollLp = ctx.createBiquadFilter();
    rollLp.type = 'lowpass';
    rollLp.frequency.value = 320;
    const rollG = ctx.createGain();
    rollG.gain.value = 0;
    roll.connect(rollLp);
    rollLp.connect(rollG);
    rollG.connect(bus);

    src.start();
    vortex.start();
    roll.start();

    this.nodes = { out, bp, vortexG, hp, rollG, sources: [src, vortex, roll] };
  }

  stop() {
    if (!this.nodes) return;
    for (const s of this.nodes.sources) {
      try {
        s.stop();
      } catch (_) {
        /* */
      }
    }
    this.nodes = null;
  }

  /**
   * @param {number|object} airspeedNormOrState
   * @param {object} [maybeState]
   */
  update(airspeedNormOrState, maybeState) {
    if (!this.nodes || !this.hub.ctx) return;
    const state =
      typeof airspeedNormOrState === 'object' && airspeedNormOrState
        ? airspeedNormOrState
        : { airspeedNorm: airspeedNormOrState, ...(maybeState || {}) };

    const t = this.hub.currentTime;
    const air = clamp(state.airspeedNorm ?? 0, 0, 1.8);
    const stalling = !!(state.stalling || state.spinning);
    const grounded = !!state.grounded;
    const agl = Math.max(0, state.agl ?? 50);

    const airVol = grounded
      ? Math.min(0.08, air * 0.12)
      : Math.min(0.42, air * 0.38 + (stalling ? 0.08 : 0));
    const altQuiet = clamp(1 - agl / 6000, 0.5, 1);

    this.nodes.out.gain.setTargetAtTime(airVol * altQuiet, t, 0.12);
    this.nodes.bp.frequency.setTargetAtTime(350 + air * 2400 + (stalling ? 400 : 0), t, 0.15);
    this.nodes.vortexG.gain.setTargetAtTime(
      !grounded && air > 0.35 ? (air - 0.35) * 0.35 + (stalling ? 0.12 : 0) : 0,
      t,
      0.1
    );
    this.nodes.hp.frequency.setTargetAtTime(2000 + air * 3000, t, 0.2);

    const rollVol = grounded && air > 0.02 ? Math.min(0.22, air * 0.35) : 0;
    this.nodes.rollG.gain.setTargetAtTime(rollVol, t, 0.08);
  }
}
