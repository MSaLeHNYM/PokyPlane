/**
 * Cheap positional remote-plane engine drones for multiplayer.
 */
import { getEngineProfile, resolvePlaneAudioKey } from './engineProfiles.js';

export class RemoteEnginePool {
  /**
   * @param {import('./AudioContextHub.js').AudioContextHub} hub
   * @param {import('./SpatialListener.js').SpatialListener} spatial
   */
  constructor(hub, spatial) {
    this.hub = hub;
    this.spatial = spatial;
    /** @type {Map<string, object>} */
    this._voices = new Map();
  }

  /**
   * Upsert a remote engine voice.
   * @param {string} id
   * @param {{
   *   x:number, y:number, z:number,
   *   throttle?: number,
   *   planeId?: string|number,
   *   planeTypes?: {id:string}[],
   * }} state
   */
  update(id, state) {
    if (!this.hub.ctx || !id) return;
    let voice = this._voices.get(id);
    if (!voice) {
      voice = this._create(id, state);
      this._voices.set(id, voice);
    }

    const planeId = resolvePlaneAudioKey(state.planeId ?? 'poky', state.planeTypes);
    if (voice.planeId !== planeId) {
      this.remove(id);
      voice = this._create(id, state);
      this._voices.set(id, voice);
    }

    const p = voice.profile;
    const t = this.hub.currentTime;
    const throttle = Math.max(0, Math.min(1, state.throttle ?? 0.4));
    const fund = p.baseHz + throttle * p.rpmSpan * 0.85;

    voice.osc.frequency.setTargetAtTime(fund, t, 0.1);
    voice.osc2.frequency.setTargetAtTime(fund * 1.01, t, 0.1);
    voice.filter.frequency.setTargetAtTime(p.filterIdle + throttle * (p.filterFull - p.filterIdle) * 0.7, t, 0.12);
    voice.gain.gain.setTargetAtTime(0.04 + throttle * 0.12, t, 0.1);
    this.spatial.setPannerPosition(voice.panner, state.x, state.y, state.z);
  }

  _create(id, state) {
    const ctx = this.hub.ensure();
    const planeId = resolvePlaneAudioKey(state.planeId ?? 'poky', state.planeTypes);
    const profile = getEngineProfile(planeId);
    const panner = this.spatial.createPanner('engine', {
      x: state.x,
      y: state.y,
      z: state.z,
      refDistance: 18,
      maxDistance: 450,
      rolloffFactor: 1.2,
    });

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = profile.filterIdle;
    filter.connect(panner);

    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    gain.connect(filter);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = profile.baseHz;
    osc.connect(gain);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = profile.baseHz * 1.01;
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    osc2.connect(g2);
    g2.connect(gain);

    osc.start();
    osc2.start();

    return { id, planeId, profile, panner, filter, gain, osc, osc2 };
  }

  remove(id) {
    const voice = this._voices.get(id);
    if (!voice) return;
    try {
      voice.osc.stop();
    } catch (_) {
      /* */
    }
    try {
      voice.osc2.stop();
    } catch (_) {
      /* */
    }
    try {
      voice.panner.disconnect();
    } catch (_) {
      /* */
    }
    this._voices.delete(id);
  }

  clear() {
    for (const id of [...this._voices.keys()]) this.remove(id);
  }
}
