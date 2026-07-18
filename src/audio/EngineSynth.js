/**
 * Multi-layer procedural engine voice driven by EngineProfile + flight state.
 */
import { pinkNoiseBuffer, brownNoiseBuffer, whiteNoiseBuffer } from './noise.js';
import { getEngineProfile } from './engineProfiles.js';

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export class EngineSynth {
  /**
   * @param {import('./AudioContextHub.js').AudioContextHub} hub
   */
  constructor(hub) {
    this.hub = hub;
    this.planeId = 'poky';
    this.profile = getEngineProfile('poky');
    this.nodes = null;
    this._running = false;
  }

  get running() {
    return this._running;
  }

  start(planeId = 'poky', tag) {
    if (!this.hub.ctx) return;
    this.stop();
    this.planeId = planeId || 'poky';
    this.profile = getEngineProfile(this.planeId, tag);
    this._build();
    this._playIgnition();
    this._running = true;
  }

  setPlane(planeId, tag) {
    if (!planeId || planeId === this.planeId) return;
    const was = this._running;
    if (was) this.start(planeId, tag);
    else {
      this.planeId = planeId;
      this.profile = getEngineProfile(planeId, tag);
    }
  }

  stop() {
    if (!this.nodes) {
      this._running = false;
      return;
    }
    const { oscillators, sources, lfos } = this.nodes;
    for (const o of oscillators) {
      try {
        o.stop();
      } catch (_) {
        /* */
      }
    }
    for (const s of sources) {
      try {
        s.stop();
      } catch (_) {
        /* */
      }
    }
    for (const o of lfos) {
      try {
        o.stop();
      } catch (_) {
        /* */
      }
    }
    this.nodes = null;
    this._running = false;
  }

  _build() {
    const ctx = this.hub.ctx;
    const p = this.profile;
    const dest = this.hub.bus('engine');

    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(dest);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = p.filterIdle;
    filter.Q.value = 0.85;
    filter.connect(out);

    const dry = ctx.createGain();
    dry.gain.value = 1;
    dry.connect(filter);

    const oscillators = [];
    const sources = [];
    const lfos = [];
    const gains = {};

    // --- Exhaust / growl: detuned saws ---
    const exhaustBus = ctx.createGain();
    exhaustBus.gain.value = p.exhaustGain;
    exhaustBus.connect(dry);
    gains.exhaust = exhaustBus;

    const sawA = ctx.createOscillator();
    sawA.type = 'sawtooth';
    sawA.frequency.value = p.baseHz;
    const sawAg = ctx.createGain();
    sawAg.gain.value = 0.55;
    sawA.connect(sawAg);
    sawAg.connect(exhaustBus);
    oscillators.push(sawA);

    const sawB = ctx.createOscillator();
    sawB.type = 'sawtooth';
    sawB.frequency.value = p.baseHz * 1.01;
    const sawBg = ctx.createGain();
    sawBg.gain.value = 0.4;
    sawB.connect(sawBg);
    sawBg.connect(exhaustBus);
    oscillators.push(sawB);

    const sub = ctx.createOscillator();
    sub.type = p.character === 'turbine' ? 'sine' : 'square';
    sub.frequency.value = p.baseHz * 0.5;
    const subG = ctx.createGain();
    subG.gain.value = p.character === 'heavyTwin' ? 0.35 : 0.18;
    sub.connect(subG);
    subG.connect(exhaustBus);
    oscillators.push(sub);

    // --- Combustion: pulsed pink noise ---
    const combBus = ctx.createGain();
    combBus.gain.value = p.combustionGain;
    combBus.connect(dry);
    gains.combustion = combBus;

    const combSrc = ctx.createBufferSource();
    combSrc.buffer = pinkNoiseBuffer(ctx, 1.5);
    combSrc.loop = true;
    const combBp = ctx.createBiquadFilter();
    combBp.type = 'bandpass';
    combBp.frequency.value = 180;
    combBp.Q.value = 1.2;
    const combAmp = ctx.createGain();
    combAmp.gain.value = 0;
    combSrc.connect(combBp);
    combBp.connect(combAmp);
    combAmp.connect(combBus);
    sources.push(combSrc);
    gains.combustionAmp = combAmp;
    gains.combustionBp = combBp;

    // AM pulse for cylinder feel
    const pulse = ctx.createOscillator();
    pulse.type = 'sine';
    pulse.frequency.value = (p.baseHz / 60) * p.cylinders * 0.5;
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.35;
    pulse.connect(pulseDepth);
    pulseDepth.connect(combAmp.gain);
    if (ctx.createConstantSource) {
      const pulseBias = ctx.createConstantSource();
      pulseBias.offset.value = 0.55;
      pulseBias.connect(combAmp.gain);
      pulseBias.start();
      sources.push(pulseBias);
    } else {
      combAmp.gain.value = 0.55;
    }
    oscillators.push(pulse);
    gains.pulse = pulse;

    // --- Prop / blade ---
    const propBus = ctx.createGain();
    propBus.gain.value = p.propGain;
    propBus.connect(dry);
    gains.prop = propBus;

    if (p.character === 'turbine') {
      // fan / compressor hiss
      const fan = ctx.createBufferSource();
      fan.buffer = whiteNoiseBuffer(ctx, 1);
      fan.loop = true;
      const fanBp = ctx.createBiquadFilter();
      fanBp.type = 'bandpass';
      fanBp.frequency.value = 2200;
      fanBp.Q.value = 0.7;
      const fanG = ctx.createGain();
      fanG.gain.value = 0.45;
      fan.connect(fanBp);
      fanBp.connect(fanG);
      fanG.connect(propBus);
      sources.push(fan);
      gains.propFilter = fanBp;
    } else {
      const blade = ctx.createOscillator();
      blade.type = 'triangle';
      blade.frequency.value = p.baseHz * p.propBlades * 0.35;
      const bladeG = ctx.createGain();
      bladeG.gain.value = 0.4;
      blade.connect(bladeG);
      bladeG.connect(propBus);
      oscillators.push(blade);
      gains.blade = blade;

      const bladeNoise = ctx.createBufferSource();
      bladeNoise.buffer = whiteNoiseBuffer(ctx, 0.8);
      bladeNoise.loop = true;
      const bnBp = ctx.createBiquadFilter();
      bnBp.type = 'highpass';
      bnBp.frequency.value = 1200;
      const bnG = ctx.createGain();
      bnG.gain.value = 0.15;
      bladeNoise.connect(bnBp);
      bnBp.connect(bnG);
      bnG.connect(propBus);
      sources.push(bladeNoise);
      gains.propFilter = bnBp;
    }

    // --- Whine / spool ---
    const whineBus = ctx.createGain();
    whineBus.gain.value = p.whineGain;
    whineBus.connect(out);
    gains.whine = whineBus;

    const whine = ctx.createOscillator();
    whine.type = 'sawtooth';
    whine.frequency.value = p.baseHz * 4;
    const whineFilter = ctx.createBiquadFilter();
    whineFilter.type = 'bandpass';
    whineFilter.frequency.value = 1800;
    whineFilter.Q.value = 4;
    const whineG = ctx.createGain();
    whineG.gain.value = 0.35;
    whine.connect(whineFilter);
    whineFilter.connect(whineG);
    whineG.connect(whineBus);
    oscillators.push(whine);
    gains.whineOsc = whine;
    gains.whineFilter = whineFilter;

    // --- Rattle / character ---
    const rattleBus = ctx.createGain();
    rattleBus.gain.value = p.rattleGain;
    rattleBus.connect(dry);
    gains.rattle = rattleBus;

    const rattle = ctx.createBufferSource();
    rattle.buffer = brownNoiseBuffer(ctx, 1.2);
    rattle.loop = true;
    const rattleHp = ctx.createBiquadFilter();
    rattleHp.type = 'highpass';
    rattleHp.frequency.value = 800;
    const rattleG = ctx.createGain();
    rattleG.gain.value = 0.2;
    rattle.connect(rattleHp);
    rattleHp.connect(rattleG);
    rattleG.connect(rattleBus);
    sources.push(rattle);

    // --- Boost / afterburner ---
    const boostBus = ctx.createGain();
    boostBus.gain.value = 0;
    boostBus.connect(out);
    gains.boost = boostBus;

    const boostNoise = ctx.createBufferSource();
    boostNoise.buffer = pinkNoiseBuffer(ctx, 1);
    boostNoise.loop = true;
    const boostLp = ctx.createBiquadFilter();
    boostLp.type = 'lowpass';
    boostLp.frequency.value = 900;
    const boostTone = ctx.createOscillator();
    boostTone.type = 'sawtooth';
    boostTone.frequency.value = 90;
    const boostToneG = ctx.createGain();
    boostToneG.gain.value = 0.2;
    boostNoise.connect(boostLp);
    boostLp.connect(boostBus);
    boostTone.connect(boostToneG);
    boostToneG.connect(boostBus);
    sources.push(boostNoise);
    oscillators.push(boostTone);
    gains.boostTone = boostTone;

    // Funny wobble LFO on exhaust pitch
    if (p.wobbleHz > 0 && p.wobbleDepth > 0) {
      const wobble = ctx.createOscillator();
      wobble.frequency.value = p.wobbleHz;
      const wobbleG = ctx.createGain();
      wobbleG.gain.value = p.wobbleDepth;
      wobble.connect(wobbleG);
      wobbleG.connect(sawA.frequency);
      wobbleG.connect(sawB.frequency);
      lfos.push(wobble);
      wobble.start();
    }

    for (const o of oscillators) o.start();
    for (const s of sources) {
      try {
        s.start();
      } catch (_) {
        /* ConstantSource already started */
      }
    }

    this.nodes = {
      out,
      filter,
      dry,
      oscillators,
      sources,
      lfos,
      gains,
      sawA,
      sawB,
      sub,
    };
  }

  _playIgnition() {
    const ctx = this.hub.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const bus = this.hub.bus('engine');

    const starter = ctx.createBufferSource();
    starter.buffer = whiteNoiseBuffer(ctx, 0.4);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(1200, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    starter.connect(bp);
    bp.connect(g);
    g.connect(bus);
    starter.start(t);
    starter.stop(t + 0.4);

    const crank = ctx.createOscillator();
    crank.type = 'square';
    crank.frequency.setValueAtTime(40, t);
    crank.frequency.exponentialRampToValueAtTime(90, t + 0.28);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.12, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    crank.connect(cg);
    cg.connect(bus);
    crank.start(t);
    crank.stop(t + 0.32);
  }

  /**
   * @param {{
   *   throttle?: number,
   *   airspeedNorm?: number,
   *   boost?: boolean,
   *   stalling?: boolean,
   *   spinning?: boolean,
   *   grounded?: boolean,
   *   fuelNorm?: number,
   *   agl?: number,
   *   outOfFuel?: boolean,
   * }} state
   */
  update(state = {}) {
    if (!this.nodes || !this.hub.ctx) return;
    const p = this.profile;
    const t = this.hub.currentTime;
    const tau = p.response;

    const throttle = clamp(state.throttle ?? 0, 0, 1);
    const air = clamp(state.airspeedNorm ?? 0, 0, 1.5);
    const boost = !!state.boost;
    const stalling = !!(state.stalling || state.spinning);
    const grounded = !!state.grounded;
    const fuelNorm = state.outOfFuel ? 0 : clamp(state.fuelNorm ?? 1, 0, 1);
    const agl = Math.max(0, state.agl ?? 50);

    const alive = fuelNorm > 0.02;
    const load = clamp(throttle * (grounded ? 1.08 : 1) + air * 0.12, 0, 1.25);
    const rpm = alive ? load : 0;

    const fund = p.baseHz + rpm * p.rpmSpan;
    const { sawA, sawB, sub, filter, gains, out } = this.nodes;

    sawA.frequency.setTargetAtTime(fund, t, tau);
    sawB.frequency.setTargetAtTime(fund * 1.012, t, tau);
    sub.frequency.setTargetAtTime(fund * 0.5, t, tau);

    if (gains.pulse) {
      const fireHz = Math.max(4, (fund / 60) * p.cylinders * (0.4 + rpm * 0.8));
      gains.pulse.frequency.setTargetAtTime(fireHz, t, tau);
    }
    if (gains.blade) {
      gains.blade.frequency.setTargetAtTime(fund * p.propBlades * (0.3 + rpm * 0.45), t, tau);
    }
    if (gains.whineOsc) {
      const whineHz =
        p.character === 'turbine' ? 400 + rpm * 2800 : fund * (3.5 + rpm * 2);
      gains.whineOsc.frequency.setTargetAtTime(whineHz, t, tau);
    }
    if (gains.whineFilter) {
      gains.whineFilter.frequency.setTargetAtTime(
        p.character === 'turbine' ? 1200 + rpm * 3500 : 1400 + rpm * 1200,
        t,
        tau
      );
    }
    if (gains.propFilter && p.character === 'turbine') {
      gains.propFilter.frequency.setTargetAtTime(1600 + rpm * 2800, t, tau);
    }
    if (gains.combustionBp) {
      gains.combustionBp.frequency.setTargetAtTime(140 + rpm * 420, t, tau);
    }
    if (gains.boostTone) {
      gains.boostTone.frequency.setTargetAtTime(70 + rpm * 80, t, tau);
    }

    const filt = p.filterIdle + rpm * (p.filterFull - p.filterIdle);
    const stallBright = stalling ? 1.25 : 1;
    filter.frequency.setTargetAtTime(filt * stallBright, t, tau * 1.2);

    // Altitude thinning
    const altMul = clamp(1 - agl / 4500, 0.55, 1);
    // Fuel cough near empty
    let fuelMul = 1;
    if (fuelNorm < 0.15 && alive) {
      const cough = 0.55 + 0.45 * Math.abs(Math.sin(t * 9));
      fuelMul = 0.35 + fuelNorm * 4 * cough;
    } else if (!alive) {
      fuelMul = 0;
    }

    const baseVol = (0.06 + rpm * 0.32) * p.volume * altMul * fuelMul;
    const stallMul = stalling ? 0.85 : 1;
    out.gain.setTargetAtTime(baseVol * stallMul, t, 0.08);

    gains.boost.gain.setTargetAtTime(boost && alive ? p.boostGain * (0.5 + rpm * 0.5) : 0, t, 0.05);
    gains.whine.gain.setTargetAtTime(p.whineGain * (0.3 + rpm * 0.9), t, tau);
    gains.rattle.gain.setTargetAtTime(
      p.rattleGain * (grounded ? 0.6 + rpm * 0.5 : 0.25 + rpm * 0.4) * (stalling ? 1.4 : 1),
      t,
      0.1
    );
    gains.exhaust.gain.setTargetAtTime(p.exhaustGain * (0.4 + rpm * 0.7), t, tau);
    gains.prop.gain.setTargetAtTime(p.propGain * (0.35 + rpm * 0.75), t, tau);
    gains.combustion.gain.setTargetAtTime(p.combustionGain * (0.3 + rpm * 0.8), t, tau);
  }
}
