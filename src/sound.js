/**
 * SoundEngine — all audio synthesized with Web Audio API.
 * No MP3/WAV files. Resume AudioContext on first user gesture (autoplay policy).
 */
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buses = { engine: null, wind: null, sfx: null, music: null };
    this.mix = { master: 0.7, engine: 1, wind: 1, sfx: 1, music: 0.8 };
    this.volume = 0.7;
    this.enabled = false;
    this.engine = null;
    this.wind = null;
    this.stall = null;
    this.ambient = null;
    this._stallOn = false;
  }

  /** Call from a click/keydown handler before playback. */
  async resume() {
    if (!this.ctx) this._init();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.enabled = true;
    return this.ctx;
  }

  _init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.mix.master;
    this.master.connect(this.ctx.destination);
    for (const name of ['engine', 'wind', 'sfx', 'music']) {
      const g = this.ctx.createGain();
      g.gain.value = this.mix[name];
      g.connect(this.master);
      this.buses[name] = g;
    }
  }

  setVolume(v) {
    this.setMix({ master: v });
  }

  /** @param {Partial<{master:number,engine:number,wind:number,sfx:number,music:number}>} mix */
  setMix(mix) {
    Object.assign(this.mix, mix);
    this.volume = this.mix.master;
    if (this.master) this.master.gain.value = this.mix.master;
    if (this.buses.engine) this.buses.engine.gain.value = this.mix.engine;
    if (this.buses.wind) this.buses.wind.gain.value = this.mix.wind;
    if (this.buses.sfx) this.buses.sfx.gain.value = this.mix.sfx;
    if (this.buses.music) this.buses.music.gain.value = this.mix.music;
  }

  _bus(name) {
    return this.buses[name] || this.master;
  }

  /** White-noise AudioBuffer of given seconds. */
  _noiseBuffer(seconds = 1) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _osc(type, freq, gainVal, dest) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = gainVal;
    o.connect(g);
    g.connect(dest);
    return { osc: o, gain: g };
  }

  // --- Engine drone: detuned saw + square, LPF opens with RPM ---
  startEngine() {
    if (!this.ctx || this.engine) return;
    const bus = this.ctx.createGain();
    bus.gain.value = 0.22;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 1;
    bus.connect(filter);
    filter.connect(this._bus('engine'));

    const layers = [
      this._osc('sawtooth', 55, 0.35, bus),
      this._osc('sawtooth', 55.7, 0.28, bus),
      this._osc('square', 27.5, 0.12, bus),
    ];
    layers.forEach((l) => l.osc.start());
    this.engine = { bus, filter, layers };
  }

  /** @param {number} rpmNorm 0–1 throttle/RPM */
  updateEngine(rpmNorm) {
    if (!this.engine || !this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 45 + rpmNorm * 90;
    this.engine.layers[0].osc.frequency.setTargetAtTime(base, t, 0.05);
    this.engine.layers[1].osc.frequency.setTargetAtTime(base * 1.015, t, 0.05);
    this.engine.layers[2].osc.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    this.engine.filter.frequency.setTargetAtTime(350 + rpmNorm * 2800, t, 0.08);
    this.engine.bus.gain.setTargetAtTime(0.08 + rpmNorm * 0.28, t, 0.1);
  }

  stopEngine() {
    if (!this.engine) return;
    this.engine.layers.forEach((l) => {
      try { l.osc.stop(); } catch (_) { /* already stopped */ }
    });
    this.engine = null;
  }

  // --- Wind: looping filtered noise, volume ∝ airspeed ---
  startWind() {
    if (!this.ctx || this.wind) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(2);
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800;
    filter.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(filter);
    filter.connect(g);
    g.connect(this._bus('wind'));
    src.start();
    this.wind = { src, filter, gain: g };
  }

  updateWind(airspeedNorm) {
    if (!this.wind || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.wind.gain.gain.setTargetAtTime(Math.min(0.35, airspeedNorm * 0.4), t, 0.15);
    this.wind.filter.frequency.setTargetAtTime(400 + airspeedNorm * 2200, t, 0.2);
  }

  // --- Stall warning: pulsing sine ---
  setStall(on) {
    if (!this.ctx) return;
    if (on && !this._stallOn) {
      this._stallOn = true;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 780;
      g.gain.value = 0;
      osc.connect(g);
      g.connect(this._bus('sfx'));
      osc.start();
      const pulse = () => {
        if (!this._stallOn || !this.ctx) return;
        const now = this.ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.18, now + 0.08);
        g.gain.linearRampToValueAtTime(0, now + 0.28);
        this._stallTimer = setTimeout(pulse, 400);
      };
      this.stall = { osc, gain: g };
      pulse();
    } else if (!on && this._stallOn) {
      this._stallOn = false;
      clearTimeout(this._stallTimer);
      if (this.stall) {
        try { this.stall.osc.stop(); } catch (_) { /* */ }
        this.stall = null;
      }
    }
  }

  // --- Gunfire: noise burst + click ---
  playGunfire() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(0.15);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    noise.connect(bp);
    bp.connect(g);
    g.connect(this._bus('sfx'));
    noise.start(t);
    noise.stop(t + 0.1);

    const click = this.ctx.createOscillator();
    const cg = this.ctx.createGain();
    click.type = 'square';
    click.frequency.value = 220;
    cg.gain.setValueAtTime(0.15, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    click.connect(cg);
    cg.connect(this._bus('sfx'));
    click.start(t);
    click.stop(t + 0.05);
  }

  playRocket() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(0.35);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(280, t + 0.28);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    noise.connect(lp);
    lp.connect(g);
    g.connect(this._bus('sfx'));
    noise.start(t);
    noise.stop(t + 0.35);

    const whoosh = this.ctx.createOscillator();
    const wg = this.ctx.createGain();
    whoosh.type = 'sawtooth';
    whoosh.frequency.setValueAtTime(140, t);
    whoosh.frequency.exponentialRampToValueAtTime(60, t + 0.25);
    wg.gain.setValueAtTime(0.12, t);
    wg.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    whoosh.connect(wg);
    wg.connect(this._bus('sfx'));
    whoosh.start(t);
    whoosh.stop(t + 0.3);
  }

  // --- Explosion: noise + sub thump, optional 3D panner ---
  playExplosion(x = 0, y = 0, z = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 10;
    panner.maxDistance = 400;
    panner.setPosition(x, y, z);
    panner.connect(this._bus('sfx'));

    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(0.6);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    noise.connect(lp);
    lp.connect(g);
    g.connect(panner);
    noise.start(t);
    noise.stop(t + 0.6);

    const sub = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(60, t);
    sub.frequency.exponentialRampToValueAtTime(25, t + 0.4);
    sg.gain.setValueAtTime(0.55, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    sub.connect(sg);
    sg.connect(panner);
    sub.start(t);
    sub.stop(t + 0.5);
  }

  // --- UI blip ---
  playUI(kind = 'click') {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const freqs = { click: 520, success: 660, ring: 880, warn: 320 };
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = kind === 'ring' ? 'triangle' : 'sine';
    osc.frequency.value = freqs[kind] || 520;
    if (kind === 'success' || kind === 'ring') {
      osc.frequency.setValueAtTime(freqs[kind], t);
      osc.frequency.linearRampToValueAtTime(freqs[kind] * 1.5, t + 0.12);
    }
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'ring' ? 0.25 : 0.1));
    osc.connect(g);
    g.connect(this._bus('sfx'));
    osc.start(t);
    osc.stop(t + 0.3);
  }

  // --- Soft ambient pad for menu ---
  startAmbient() {
    if (!this.ctx || this.ambient) return;
    const bus = this.ctx.createGain();
    bus.gain.value = 0.06;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    bus.connect(filter);
    filter.connect(this._bus('music'));

    const freqs = [110, 138.59, 164.81];
    const oscs = freqs.map((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = 0.3 - i * 0.05;
      o.connect(g);
      g.connect(bus);
      o.start();
      return o;
    });

    // Slow LFO on filter
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 400;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    this.ambient = { oscs, lfo, bus };
  }

  stopAmbient() {
    if (!this.ambient) return;
    this.ambient.oscs.forEach((o) => {
      try { o.stop(); } catch (_) { /* */ }
    });
    try { this.ambient.lfo.stop(); } catch (_) { /* */ }
    this.ambient = null;
  }

  /** Update listener pose for positional audio. */
  setListener(x, y, z, fx, fy, fz) {
    if (!this.ctx || !this.ctx.listener) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else if (l.setPosition) {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }
}
