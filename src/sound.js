/**
 * SoundEngine — all audio synthesized with Web Audio API.
 * No MP3/WAV files. Resume AudioContext on first user gesture (autoplay policy).
 *
 * Implementation lives in ./audio/* — this file re-exports the facade.
 */
export { SoundEngine } from './audio/SoundEngine.js';
export { getEngineProfile, ENGINE_PROFILES } from './audio/engineProfiles.js';
