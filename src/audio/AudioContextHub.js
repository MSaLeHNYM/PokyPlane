/**
 * Audio graph hub — context, buses, compressor + limiter master chain.
 */

export class AudioContextHub {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.compressor = null;
    this.limiter = null;
    this.buses = { engine: null, wind: null, sfx: null, music: null };
    this.mix = { master: 0.7, engine: 1, wind: 1, sfx: 1, music: 0.8 };
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.mix.master;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 3.5;
    this.compressor.attack.value = 0.008;
    this.compressor.release.value = 0.18;

    // Soft brickwall via compressor at high ratio / low threshold
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.05;

    this.master.connect(this.compressor);
    this.compressor.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    for (const name of ['engine', 'wind', 'sfx', 'music']) {
      const g = this.ctx.createGain();
      g.gain.value = this.mix[name];
      g.connect(this.master);
      this.buses[name] = g;
    }
    return this.ctx;
  }

  async resume() {
    this.ensure();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  bus(name) {
    return this.buses[name] || this.master;
  }

  setMix(partial) {
    Object.assign(this.mix, partial);
    if (this.master) this.master.gain.value = this.mix.master;
    if (this.buses.engine) this.buses.engine.gain.value = this.mix.engine;
    if (this.buses.wind) this.buses.wind.gain.value = this.mix.wind;
    if (this.buses.sfx) this.buses.sfx.gain.value = this.mix.sfx;
    if (this.buses.music) this.buses.music.gain.value = this.mix.music;
  }

  get currentTime() {
    return this.ctx?.currentTime ?? 0;
  }
}
