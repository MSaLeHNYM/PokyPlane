/**
 * Link-based P2P matchmaking via PeerJS (WebRTC data channel).
 * Host gets an ID → share URL `?room=<id>` → guest connects.
 * Syncs plane state + fire/damage events for co-op dogfight.
 */
import Peer from 'peerjs';

const SYNC_HZ = 20;

export class Matchmaking {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.role = null; // 'host' | 'guest'
    this.roomId = null;
    this.status = 'idle'; // idle | hosting | connecting | connected | error
    this.onStatus = null;
    this.onPeerState = null;
    this.onEvent = null;
    this._lastSend = 0;
    this._remoteState = null;
  }

  get inviteUrl() {
    if (!this.roomId) return '';
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.roomId);
    return url.toString();
  }

  _emitStatus() {
    this.onStatus?.({
      status: this.status,
      role: this.role,
      roomId: this.roomId,
      inviteUrl: this.inviteUrl,
    });
  }

  _wireConn(conn) {
    this.conn = conn;
    conn.on('open', () => {
      this.status = 'connected';
      this._emitStatus();
      this.onEvent?.({ type: 'peer-joined' });
    });
    conn.on('data', (data) => {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'state') {
        this._remoteState = data;
        this.onPeerState?.(data);
      } else {
        this.onEvent?.(data);
      }
    });
    conn.on('close', () => {
      this.status = 'idle';
      this.conn = null;
      this._remoteState = null;
      this.onEvent?.({ type: 'peer-left' });
      this._emitStatus();
    });
    conn.on('error', (err) => {
      console.warn('[matchmaking]', err);
      this.status = 'error';
      this._emitStatus();
    });
  }

  async host() {
    await this.destroy();
    this.role = 'host';
    this.status = 'hosting';
    this._emitStatus();

    return new Promise((resolve, reject) => {
      this.peer = new Peer({
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        },
      });
      this.peer.on('open', (id) => {
        this.roomId = id;
        this._emitStatus();
        resolve({ roomId: id, inviteUrl: this.inviteUrl });
      });
      this.peer.on('connection', (conn) => {
        if (this.conn) {
          conn.close();
          return;
        }
        this._wireConn(conn);
      });
      this.peer.on('error', (err) => {
        this.status = 'error';
        this._emitStatus();
        reject(err);
      });
    });
  }

  async join(roomId) {
    await this.destroy();
    this.role = 'guest';
    this.roomId = roomId;
    this.status = 'connecting';
    this._emitStatus();

    return new Promise((resolve, reject) => {
      this.peer = new Peer({
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        },
      });
      this.peer.on('open', () => {
        const conn = this.peer.connect(roomId, { reliable: true });
        this._wireConn(conn);
        conn.on('open', () => resolve({ roomId }));
      });
      this.peer.on('error', (err) => {
        this.status = 'error';
        this._emitStatus();
        reject(err);
      });
    });
  }

  /** Send local flight snapshot (throttled). */
  sendState(payload) {
    if (!this.conn || !this.conn.open) return;
    const now = performance.now();
    if (now - this._lastSend < 1000 / SYNC_HZ) return;
    this._lastSend = now;
    try {
      this.conn.send({ type: 'state', t: now, ...payload });
    } catch (e) {
      console.warn(e);
    }
  }

  sendEvent(event) {
    if (!this.conn || !this.conn.open) return;
    try {
      this.conn.send(event);
    } catch (e) {
      console.warn(e);
    }
  }

  get remoteState() {
    return this._remoteState;
  }

  get isConnected() {
    return this.status === 'connected' && this.conn?.open;
  }

  async destroy() {
    try {
      this.conn?.close();
    } catch { /* */ }
    try {
      this.peer?.destroy();
    } catch { /* */ }
    this.peer = null;
    this.conn = null;
    this.role = null;
    this.roomId = null;
    this.status = 'idle';
    this._remoteState = null;
    this._emitStatus();
  }
}

/** Parse ?room= from URL for auto-join. */
export function getRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('room') || params.get('join') || null;
}

export function clearRoomFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  url.searchParams.delete('join');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}
