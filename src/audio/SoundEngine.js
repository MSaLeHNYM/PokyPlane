/**
 * SoundEngine facade — procedural Web Audio stack (no audio files).
 * Public API stays compatible with legacy call sites in main.js.
 */
import { AudioContextHub } from './AudioContextHub.js';
import { SpatialListener } from './SpatialListener.js';
import { EngineSynth } from './EngineSynth.js';
import { WindSynth } from './WindSynth.js';
import { SfxBank } from './SfxBank.js';
import { MusicDirector } from './MusicDirector.js';
import { RemoteEnginePool } from './RemoteEnginePool.js';
import { resolvePlaneAudioKey } from './engineProfiles.js';

export class SoundEngine {
  constructor() {
    this.hub = new AudioContextHub();
    this.spatial = new SpatialListener(this.hub);
    this.engineSynth = new EngineSynth(this.hub);
    this.windSynth = new WindSynth(this.hub);
    this.sfx = new SfxBank(this.hub, this.spatial);
    this.music = new MusicDirector(this.hub);
    this.remotes = new RemoteEnginePool(this.hub, this.spatial);

    this.enabled = false;
    this._planeId = 'poky';
    this._planeTypes = null;
    this._prevBoost = false;
    this._prevGrounded = true;

    // Legacy mirrors
    this.ctx = null;
    this.master = null;
    this.buses = this.hub.buses;
    this.mix = this.hub.mix;
    this.volume = this.hub.mix.master;
  }

  /** Call from a click/keydown handler before playback. */
  async resume() {
    try {
      await this.hub.resume();
      this.ctx = this.hub.ctx;
      this.master = this.hub.master;
      this.buses = this.hub.buses;
      this.enabled = true;
    } catch (_) {
      this.enabled = false;
    }
    return this.ctx;
  }

  setVolume(v) {
    this.setMix({ master: v });
  }

  /** @param {Partial<{master:number,engine:number,wind:number,sfx:number,music:number}>} mix */
  setMix(mix) {
    this.hub.setMix(mix);
    this.mix = this.hub.mix;
    this.volume = this.hub.mix.master;
  }

  /**
   * Optional plane type table for id resolution from indices.
   * @param {{id:string, tag?:string}[]} planeTypes
   */
  setPlaneTypes(planeTypes) {
    this._planeTypes = planeTypes;
  }

  /**
   * @param {string|number} [planeIdOrIndex]
   * @param {string} [tag]
   */
  startEngine(planeIdOrIndex, tag) {
    if (!this.ctx) return;
    const id = resolvePlaneAudioKey(planeIdOrIndex ?? this._planeId, this._planeTypes);
    this._planeId = id;
    this._prevBoost = false;
    this._prevGrounded = true;
    this.engineSynth.start(id, tag);
  }

  setEnginePlane(planeIdOrIndex, tag) {
    const id = resolvePlaneAudioKey(planeIdOrIndex ?? this._planeId, this._planeTypes);
    this._planeId = id;
    if (this.engineSynth.running) this.engineSynth.setPlane(id, tag);
  }

  /**
   * @param {number|object} rpmOrState  legacy: throttle 0–1, or rich state object
   */
  updateEngine(rpmOrState) {
    if (!this.enabled) return;
    const state =
      typeof rpmOrState === 'object' && rpmOrState
        ? rpmOrState
        : { throttle: rpmOrState ?? 0 };

    if (state.boost && !this._prevBoost) this.sfx.playBoost();
    this._prevBoost = !!state.boost;

    if (state.grounded && !this._prevGrounded) {
      const sink = Math.abs(state.verticalSpeed ?? 0);
      const severity = Math.min(1.4, 0.35 + sink / 40);
      this.sfx.playTouchdown(severity);
    }
    this._prevGrounded = !!state.grounded;

    this.engineSynth.update(state);

    // Duck music under high engine load / boost
    const load = (state.throttle ?? 0) * 0.5 + (state.boost ? 0.25 : 0);
    this.music.setDuck(1 - load * 0.35);
  }

  stopEngine() {
    this.engineSynth.stop();
    this._prevBoost = false;
  }

  startWind() {
    if (!this.ctx) return;
    this.windSynth.start();
  }

  updateWind(airspeedNormOrState, maybeState) {
    if (!this.enabled) return;
    this.windSynth.update(airspeedNormOrState, maybeState);
  }

  stopWind() {
    this.windSynth.stop();
  }

  setStall(on) {
    this.sfx.setStall(on);
  }

  playGunfire(variant) {
    if (!this.enabled) return;
    this.sfx.playGunfire(variant);
  }

  playRocket() {
    if (!this.enabled) return;
    this.sfx.playRocket();
  }

  playExplosion(x = 0, y = 0, z = 0, size = 1) {
    if (!this.enabled) return;
    this.sfx.playExplosion(x, y, z, size);
    this.music.setDuck(0.45);
    setTimeout(() => this.music.setDuck(1), 400);
  }

  playCrash(x = 0, y = 0, z = 0) {
    if (!this.enabled) return;
    this.sfx.playCrash(x, y, z);
    this.music.setDuck(0.3);
    setTimeout(() => this.music.setDuck(1), 800);
  }

  playHit() {
    if (!this.enabled) return;
    this.sfx.playHit();
  }

  playBoost() {
    if (!this.enabled) return;
    this.sfx.playBoost();
  }

  playTouchdown(severity) {
    if (!this.enabled) return;
    this.sfx.playTouchdown(severity);
  }

  playFuelPickup() {
    if (!this.enabled) return;
    this.sfx.playFuelPickup();
  }

  playScore() {
    if (!this.enabled) return;
    this.sfx.playScore();
  }

  playUI(kind = 'click') {
    if (!this.enabled) return;
    this.sfx.playUI(kind);
  }

  startAmbient() {
    if (!this.ctx) return;
    this.music.startAmbient();
  }

  stopAmbient() {
    this.music.stopAmbient();
  }

  /** @param {'menu'|'hangar'|'flight'|'combat'|'victory'|'defeat'} state */
  setMusicState(state) {
    if (!this.ctx) return;
    if (!this.music.running) this.music.start(state);
    else this.music.setState(state);
  }

  setListener(x, y, z, fx, fy, fz) {
    this.spatial.setListener(x, y, z, fx, fy, fz);
  }

  /**
   * Update / create a remote multiplayer engine drone.
   * @param {string} id
   * @param {object} state
   */
  updateRemoteEngine(id, state) {
    if (!this.enabled) return;
    this.remotes.update(id, { ...state, planeTypes: this._planeTypes });
  }

  removeRemoteEngine(id) {
    this.remotes.remove(id);
  }

  clearRemoteEngines() {
    this.remotes.clear();
  }
}
