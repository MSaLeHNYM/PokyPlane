/**
 * Multiplayer hub — lobby config, ready handshake, damage sync.
 * Wraps Matchmaking so host/guest start together on the same worldSeed.
 */
export class MpHub {
  constructor(match) {
    this.match = match;
    this.config = null;
    this.localReady = false;
    this.remoteReady = false;
    this._onBothReady = null;
    this._started = false;
  }

  reset() {
    this.config = null;
    this.localReady = false;
    this.remoteReady = false;
    this._started = false;
    this._onBothReady = null;
  }

  setConfig(config) {
    this.config = { ...config };
  }

  /** Host publishes lobby + waits for guest ready before starting. */
  publishLobby(config) {
    this.setConfig(config);
    this.match.sendEvent({ type: 'lobby', config: this.config });
  }

  /** Host tells everyone to leave lobby and begin the match. */
  sendStart() {
    this.match.sendEvent({ type: 'start' });
  }

  onBothReady(cb) {
    this._onBothReady = cb;
  }

  markLocalReady() {
    this.localReady = true;
    this.match.sendEvent({ type: 'ready' });
    this._tryStart();
  }

  handleRemoteReady() {
    this.remoteReady = true;
    this._tryStart();
  }

  _tryStart() {
    if (this._started) return;
    if (!this.localReady || !this.remoteReady) return;
    this._started = true;
    this._onBothReady?.(this.config);
  }

  sendDamage(amount, weapon) {
    this.match.sendEvent({
      type: 'damage',
      amount: Number(amount) || 0,
      weapon: weapon || 'mg',
    });
  }

  /** Seed remote plane near opposite runway side so it never flashes at origin. */
  static seedRemotePose(spawnPose, role) {
    const side = role === 'guest' ? -1 : 1;
    return {
      x: (spawnPose?.x ?? 0) + side * 28,
      y: (spawnPose?.y ?? 20) + 8,
      z: (spawnPose?.z ?? 0) + side * 12,
    };
  }
}
