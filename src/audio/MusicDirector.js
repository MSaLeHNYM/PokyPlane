/**
 * Generative procedural music director — state-based layers, no audio files.
 */

const SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor
const ROOT = 48; // C3 MIDI-ish

function midiToHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function degreeToMidi(degree, octave = 0) {
  const d = ((degree % SCALE.length) + SCALE.length) % SCALE.length;
  const oct = Math.floor(degree / SCALE.length) + octave;
  return ROOT + SCALE[d] + oct * 12;
}

const STATE_CFG = {
  menu: { bpm: 72, density: 0.35, pad: 0.07, arp: 0.05, bass: 0.06, perc: 0, lead: 0 },
  hangar: { bpm: 78, density: 0.4, pad: 0.06, arp: 0.06, bass: 0.05, perc: 0, lead: 0.02 },
  flight: { bpm: 96, density: 0.55, pad: 0.05, arp: 0.07, bass: 0.07, perc: 0.02, lead: 0.04 },
  combat: { bpm: 128, density: 0.85, pad: 0.04, arp: 0.09, bass: 0.09, perc: 0.08, lead: 0.07 },
  victory: { bpm: 110, density: 0.6, pad: 0.08, arp: 0.08, bass: 0.06, perc: 0.03, lead: 0.06 },
  defeat: { bpm: 60, density: 0.25, pad: 0.09, arp: 0.02, bass: 0.08, perc: 0, lead: 0 },
};

export class MusicDirector {
  /** @param {import('./AudioContextHub.js').AudioContextHub} hub */
  constructor(hub) {
    this.hub = hub;
    this.state = null;
    this._running = false;
    this._timer = null;
    this._step = 0;
    this._cfg = STATE_CFG.menu;
    this._bus = null;
    this._pad = null;
    this._duck = 1;
    this._fade = null;
  }

  start(state = 'menu') {
    if (!this.hub.ctx) return;
    if (this._running) {
      this.setState(state);
      return;
    }
    this._buildPad();
    this._running = true;
    this.setState(state);
    this._schedule();
  }

  get running() {
    return this._running;
  }

  /** Alias for menu ambient compatibility. */
  startAmbient() {
    this.start('menu');
  }

  stop() {
    this._running = false;
    clearTimeout(this._timer);
    this._timer = null;
    if (this._pad) {
      for (const o of this._pad.oscs) {
        try {
          o.stop();
        } catch (_) {
          /* */
        }
      }
      try {
        this._pad.lfo.stop();
      } catch (_) {
        /* */
      }
      this._pad = null;
    }
    this._bus = null;
    this.state = null;
  }

  stopAmbient() {
    this.stop();
  }

  setState(state) {
    if (!STATE_CFG[state]) state = 'menu';
    if (this.state === state) return;
    this.state = state;
    this._cfg = STATE_CFG[state];
    this._crossfadePad();
  }

  /** Sidechain ducking 0–1 (1 = full music). */
  setDuck(amount) {
    this._duck = Math.max(0.25, Math.min(1, amount));
    if (this._bus && this.hub.ctx) {
      this._bus.gain.setTargetAtTime(this._duck, this.hub.currentTime, 0.08);
    }
  }

  _buildPad() {
    const ctx = this.hub.ctx;
    this._bus = ctx.createGain();
    this._bus.gain.value = 1;
    this._bus.connect(this.hub.bus('music'));

    const padG = ctx.createGain();
    padG.gain.value = 0.06;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    padG.connect(filter);
    filter.connect(this._bus);

    const freqs = [midiToHz(ROOT), midiToHz(ROOT + 7), midiToHz(ROOT + 12)];
    const oscs = freqs.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.28 - i * 0.05;
      o.connect(g);
      g.connect(padG);
      o.start();
      return o;
    });

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 350;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    this._pad = { oscs, lfo, padG, filter };
  }

  _crossfadePad() {
    if (!this._pad || !this.hub.ctx) return;
    const t = this.hub.currentTime;
    const g = this._pad.padG.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this._cfg.pad, t + 1.2);
    this._pad.filter.frequency.setTargetAtTime(
      this.state === 'combat' ? 1400 : this.state === 'defeat' ? 500 : 900,
      t,
      0.5
    );
  }

  _schedule() {
    if (!this._running || !this.hub.ctx) return;
    const cfg = this._cfg;
    const beatMs = (60 / cfg.bpm) * 1000;
    const stepMs = beatMs / 2;

    this._tick();
    this._step += 1;
    this._timer = setTimeout(() => this._schedule(), stepMs);
  }

  _tick() {
    if (!this.hub.ctx || !this._bus) return;
    const cfg = this._cfg;
    const t = this.hub.currentTime;
    const step = this._step;

    // Bass on downs
    if (cfg.bass > 0 && step % 4 === 0 && Math.random() < cfg.density) {
      this._note(degreeToMidi(0, 0), 0.18, cfg.bass, 'triangle', t);
    }

    // Arp
    if (cfg.arp > 0 && Math.random() < cfg.density) {
      const deg = (step * 2 + Math.floor(Math.random() * 3)) % 7;
      this._note(degreeToMidi(deg, 1), 0.12, cfg.arp, 'sine', t);
    }

    // Lead (combat / victory)
    if (cfg.lead > 0 && step % 2 === 0 && Math.random() < cfg.density * 0.6) {
      const deg = [0, 2, 4, 5, 7][step % 5];
      this._note(degreeToMidi(deg, 2), 0.15, cfg.lead, 'triangle', t);
    }

    // Percussion noise hits
    if (cfg.perc > 0 && step % 2 === 0 && Math.random() < cfg.density) {
      this._perc(cfg.perc * (step % 4 === 0 ? 1.2 : 0.6), t);
    }
  }

  _note(midi, dur, gainVal, type, t) {
    const ctx = this.hub.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = midiToHz(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(gainVal, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 2200;
    o.connect(filt);
    filt.connect(g);
    g.connect(this._bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _perc(gainVal, t) {
    const ctx = this.hub.ctx;
    const len = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 200 + Math.random() * 400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(bp);
    bp.connect(g);
    g.connect(this._bus);
    src.start(t);
    src.stop(t + 0.09);
  }
}
