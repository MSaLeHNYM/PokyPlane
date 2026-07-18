/**
 * Link-based P2P matchmaking via PeerJS (WebRTC data channel).
 * Signaling uses PeerJS cloud by default so host/guest always share one broker
 * (in-memory PeerServer on Liara breaks across instances / proxy hops).
 */
import Peer from 'peerjs';

const SYNC_HZ = 20;
const JOIN_RETRIES = 10;
const JOIN_RETRY_MS = 700;
const HEARTBEAT_MS = 3000;

/** Prefer cloud; set VITE_PEER_LOCAL=1 or ?peerLocal=1 to use same-origin /peerjs. */
function useLocalPeerServer() {
  try {
    if (import.meta.env?.VITE_PEER_LOCAL === '1') return true;
    if (typeof location !== 'undefined') {
      return new URLSearchParams(location.search).get('peerLocal') === '1';
    }
  } catch {
    /* */
  }
  return false;
}

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

function shortRoomId() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = 'pp';
  for (let i = 0; i < 6; i++) id += alphabet[(Math.random() * alphabet.length) | 0];
  return id;
}

function peerOptions() {
  const base = {
    debug: 1,
    pingInterval: 4000,
    config: {
      iceServers: ICE_SERVERS,
      sdpSemantics: 'unified-plan',
    },
  };

  if (!useLocalPeerServer()) {
    // PeerJS cloud — shared realm for all clients
    return {
      ...base,
      host: '0.peerjs.com',
      port: 443,
      path: '/',
      secure: true,
    };
  }

  const loc = typeof location !== 'undefined' ? location : null;
  if (loc && (loc.protocol === 'http:' || loc.protocol === 'https:')) {
    const port = loc.port
      ? Number(loc.port)
      : loc.protocol === 'https:'
        ? 443
        : 80;
    return {
      ...base,
      host: loc.hostname,
      port,
      path: '/peerjs',
      secure: loc.protocol === 'https:',
    };
  }
  return base;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postHeartbeat(roomId) {
  if (!roomId || typeof fetch !== 'function') return;
  try {
    await fetch('/api/mp/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId }),
      keepalive: true,
    });
  } catch {
    /* optional */
  }
}

async function waitForRoomAlive(roomId, attempts = 12) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`/api/mp/room/${encodeURIComponent(roomId)}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.alive) return true;
      }
    } catch {
      /* */
    }
    await wait(500);
  }
  return false;
}

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
    this._destroyed = false;
    this._heartbeatTimer = null;
    this._reconnectTimer = null;
    this._onVis = null;
    this._kicking = false;
  }

  get inviteUrl() {
    if (!this.roomId) return '';
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.roomId);
    url.searchParams.delete('peerLocal');
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

  _clearHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _startHeartbeat() {
    this._clearHeartbeat();
    if (!this.roomId || this.role !== 'host') return;
    const beat = () => {
      if (this._destroyed || !this.peer?.open) return;
      postHeartbeat(this.roomId);
    };
    beat();
    this._heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
  }

  _wireConn(conn) {
    this.conn = conn;
    conn.on('open', () => {
      if (this._destroyed) return;
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
      if (this._destroyed) return;
      this.status = this.role === 'host' ? 'hosting' : 'idle';
      this.conn = null;
      this._remoteState = null;
      this.onEvent?.({ type: 'peer-left' });
      this._emitStatus();
    });
    conn.on('error', (err) => {
      console.warn('[matchmaking] conn', err);
      if (this._destroyed) return;
      this.status = 'error';
      this._emitStatus();
    });
  }

  _bindPeerLifecycle(peer, { onOpen, onFail }) {
    peer.on('open', (id) => {
      onOpen?.(id);
    });

    peer.on('connection', (conn) => {
      if (this.role !== 'host') {
        conn.close();
        return;
      }
      if (this.conn?.open) {
        conn.close();
        return;
      }
      this._wireConn(conn);
    });

    peer.on('disconnected', () => {
      if (this._destroyed) return;
      console.warn('[matchmaking] peer disconnected — reconnecting');
      try {
        peer.reconnect();
      } catch (e) {
        console.warn(e);
        // Prefer reconnect only; never tear down a live data channel.
        if (!this.conn?.open) this._scheduleHostReregister();
      }
    });

    peer.on('close', () => {
      if (this._destroyed) return;
      if (this.role === 'host' && this.roomId && !this.conn?.open) {
        this._scheduleHostReregister();
      }
    });

    peer.on('error', (err) => {
      if (err?.type === 'peer-unavailable') return;
      if (err?.type === 'network' || err?.type === 'disconnected') {
        console.warn('[matchmaking] peer network', err);
        return;
      }
      onFail?.(err);
    });
  }

  _scheduleHostReregister() {
    if (this._destroyed || this.role !== 'host' || !this.roomId) return;
    // Live peer data channel — do not destroy the Peer (would kill the match).
    if (this.conn?.open) return;
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._destroyed || this.role !== 'host' || !this.roomId) return;
      if (this.conn?.open) return;
      const keepId = this.roomId;
      try {
        this.peer?.destroy();
      } catch {
        /* */
      }
      this.peer = this._createPeer(keepId);
      this._bindPeerLifecycle(this.peer, {
        onOpen: (id) => {
          this.roomId = id;
          this.status = this.conn?.open ? 'connected' : 'hosting';
          this._startHeartbeat();
          this._emitStatus();
        },
        onFail: (err) => console.warn('[matchmaking] reregister failed', err),
      });
    }, 800);
  }

  _watchVisibility() {
    if (typeof document === 'undefined' || this._onVis) return;
    this._onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (this._destroyed || this.role !== 'host') return;
      if (this.conn?.open) {
        this._startHeartbeat();
        return;
      }
      if (this.peer && !this.peer.open && !this.peer.destroyed) {
        try {
          this.peer.reconnect();
        } catch {
          this._scheduleHostReregister();
        }
      } else if (!this.peer || this.peer.destroyed) {
        this._scheduleHostReregister();
      }
      this._startHeartbeat();
    };
    document.addEventListener('visibilitychange', this._onVis);
  }

  _createPeer(preferredId = null) {
    const opts = peerOptions();
    return preferredId ? new Peer(preferredId, opts) : new Peer(opts);
  }

  async host() {
    await this.destroy();
    this._destroyed = false;
    this.role = 'host';
    this.status = 'hosting';
    this._emitStatus();
    this._watchVisibility();

    const tryId = shortRoomId();

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        this.status = 'error';
        this._emitStatus();
        reject(err);
      };

      const startWithId = (id) => {
        this.peer = this._createPeer(id);
        this._bindPeerLifecycle(this.peer, {
          onOpen: (openId) => {
            if (settled) {
              this.roomId = openId;
              this._startHeartbeat();
              this._emitStatus();
              return;
            }
            settled = true;
            this.roomId = openId;
            this._startHeartbeat();
            this._emitStatus();
            resolve({ roomId: openId, inviteUrl: this.inviteUrl });
          },
          onFail: (err) => {
            if (err?.type === 'unavailable-id' && !settled) {
              try {
                this.peer.destroy();
              } catch {
                /* */
              }
              // Retry once with a fresh short id
              startWithId(shortRoomId());
              return;
            }
            fail(err);
          },
        });
      };

      startWithId(tryId);
    });
  }

  async join(roomId) {
    const clean = String(roomId || '')
      .trim()
      .replace(/^.*[?&]room=([^&]+).*$/i, '$1')
      .trim()
      .toLowerCase();
    if (!clean) throw new Error('missing_room');

    await this.destroy();
    this._destroyed = false;
    this.role = 'guest';
    this.roomId = clean;
    this.status = 'connecting';
    this._emitStatus();

    // Wait until host has heartbeated (best-effort; cloud may still work without it)
    await waitForRoomAlive(clean, 8);

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (settled || this._destroyed) return;
        settled = true;
        this.status = 'error';
        this._emitStatus();
        reject(err instanceof Error ? err : new Error(String(err?.message || err)));
      };

      this.peer = this._createPeer();

      let rejectAttempt = null;
      this.peer.on('error', (err) => {
        if (err?.type === 'peer-unavailable') {
          rejectAttempt?.(err);
          return;
        }
        if (err?.type === 'network') return;
        fail(err);
      });

      this.peer.on('open', async () => {
        let lastErr = null;
        for (let attempt = 0; attempt < JOIN_RETRIES; attempt++) {
          if (this._destroyed || settled) return;
          if (attempt > 0) await waitForRoomAlive(clean, 4);

          try {
            const conn = this.peer.connect(clean, {
              reliable: true,
            });
            await new Promise((res, rej) => {
              const t = setTimeout(() => rej(new Error('connect_timeout')), 4500);
              rejectAttempt = (e) => {
                clearTimeout(t);
                rej(e);
              };
              conn.on('open', () => {
                clearTimeout(t);
                rejectAttempt = null;
                res();
              });
              conn.on('error', (e) => {
                clearTimeout(t);
                rejectAttempt = null;
                rej(e);
              });
            });
            if (settled) return;
            settled = true;
            this._wireConn(conn);
            if (conn.open) {
              this.status = 'connected';
              this._emitStatus();
              this.onEvent?.({ type: 'peer-joined' });
            }
            resolve({ roomId: clean });
            return;
          } catch (e) {
            lastErr = e;
            await wait(JOIN_RETRY_MS * (1 + attempt * 0.25));
          }
        }
        fail(
          lastErr ||
            Object.assign(new Error('peer_unavailable'), { type: 'peer-unavailable' })
        );
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

  /** Host: notify guest then drop the data channel. */
  kickGuest() {
    if (this.role !== 'host') return;
    this._kicking = true;
    try {
      this.conn?.send({ type: 'kick' });
    } catch {
      /* */
    }
    try {
      this.conn?.close();
    } catch {
      /* */
    }
    this.conn = null;
    this.status = 'hosting';
    this._emitStatus();
  }

  get remoteState() {
    return this._remoteState;
  }

  get isConnected() {
    return this.status === 'connected' && this.conn?.open;
  }

  async destroy() {
    this._destroyed = true;
    this._clearHeartbeat();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._onVis && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVis);
      this._onVis = null;
    }
    try {
      this.conn?.close();
    } catch {
      /* */
    }
    try {
      this.peer?.destroy();
    } catch {
      /* */
    }
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
