/**
 * Link-based P2P matchmaking via PeerJS (WebRTC data channel).
 * Signaling uses PeerJS cloud by default so host/guest always share one broker
 * (in-memory PeerServer on Liara breaks across instances / proxy hops).
 */
import Peer from 'peerjs';

const SYNC_HZ = 20;
const JOIN_RETRIES = 12;
const JOIN_RETRY_MS = 650;
const JOIN_ATTEMPT_MS = 5000;
const PEER_OPEN_MS = 15000;
const HEARTBEAT_MS = 3000;
const HOST_REREGISTER_MS = 900;
/** Close empty host lobby after this long with no guest connected. */
const LOBBY_AFK_MS = 30_000;

/** Prefer cloud; set VITE_PEER_LOCAL=1 or ?peerLocal=1 to use same-origin /peerjs. */
export function useLocalPeerServer() {
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
  // Free public TURN — may be overloaded; TCP helps restricted networks
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turns:openrelay.metered.ca:443',
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

function safeCloseConn(conn) {
  if (!conn) return;
  try {
    conn.close();
  } catch {
    /* */
  }
}

async function postHeartbeat(roomId, guestConnected = false) {
  if (!roomId || typeof fetch !== 'function') return;
  try {
    await fetch('/api/mp/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, guestConnected }),
      keepalive: true,
    });
  } catch {
    /* optional */
  }
}

async function postLeave(roomId) {
  if (!roomId || typeof fetch !== 'function') return;
  try {
    await fetch('/api/mp/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId }),
      keepalive: true,
    });
  } catch {
    /* optional */
  }
}

async function waitForRoomAlive(roomId, attempts = 8) {
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
    await wait(400);
  }
  return false;
}

/**
 * Wait until PeerJS signaling is open, with a hard timeout.
 * @param {import('peerjs').Peer} peer
 * @param {number} ms
 */
function waitForPeerOpen(peer, ms = PEER_OPEN_MS) {
  return new Promise((resolve, reject) => {
    if (peer.destroyed) {
      reject(new Error('peer_destroyed'));
      return;
    }
    if (peer.open) {
      resolve(peer.id);
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(Object.assign(new Error('peer_open_timeout'), { type: 'peer_open_timeout' }));
    }, ms);

    const onOpen = (id) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(id);
    };
    const onError = (err) => {
      // unavailable-id / network during open — surface to caller
      if (settled) return;
      if (err?.type === 'peer-unavailable') return;
      if (err?.type === 'network' || err?.type === 'disconnected') return;
      settled = true;
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      peer.off('open', onOpen);
      peer.off('error', onError);
    };

    peer.on('open', onOpen);
    peer.on('error', onError);
  });
}

/**
 * Open a DataConnection with timeout; always closes the conn on failure
 * so orphaned ICE attempts cannot steal the host's single slot.
 */
function openDataConnection(peer, hostId, ms = JOIN_ATTEMPT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const conn = peer.connect(hostId, { reliable: true });

    const cleanup = () => {
      clearTimeout(timer);
      try {
        conn.off('open', onOpen);
        conn.off('error', onErr);
        peer.off('error', onPeerErr);
      } catch {
        /* */
      }
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      safeCloseConn(conn);
      reject(err instanceof Error ? err : new Error(String(err?.message || err)));
    };

    const ok = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(conn);
    };

    const timer = setTimeout(() => fail(new Error('connect_timeout')), ms);
    const onOpen = () => ok();
    const onErr = (e) => fail(e);
    const onPeerErr = (err) => {
      if (err?.type === 'peer-unavailable') fail(err);
    };

    conn.on('open', onOpen);
    conn.on('error', onErr);
    peer.on('error', onPeerErr);
  });
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
    this._guestRejoinTimer = null;
    this._onVis = null;
    this._kicking = false;
    this._joinGeneration = 0;
    this._lobbyAfkTimer = null;
    this._leaveRoomId = null;
  }

  get inviteUrl() {
    if (!this.roomId) return '';
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.roomId);
    // Keep peerLocal so guest uses the same broker as host
    if (useLocalPeerServer()) url.searchParams.set('peerLocal', '1');
    else url.searchParams.delete('peerLocal');
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

  _clearLobbyAfkTimer() {
    if (this._lobbyAfkTimer) {
      clearTimeout(this._lobbyAfkTimer);
      this._lobbyAfkTimer = null;
    }
  }

  _startLobbyAfkTimer() {
    this._clearLobbyAfkTimer();
    if (this.role !== 'host' || this._destroyed) return;
    if (this.conn?.open) return;
    this._lobbyAfkTimer = setTimeout(() => {
      this._lobbyAfkTimer = null;
      if (this._destroyed || this.role !== 'host') return;
      if (this.conn?.open) return;
      this.onEvent?.({ type: 'lobby-afk-timeout' });
      this.destroy({ reason: 'lobby-afk' });
    }, LOBBY_AFK_MS);
  }

  _startHeartbeat() {
    this._clearHeartbeat();
    if (!this.roomId || this.role !== 'host') return;
    const beat = () => {
      if (this._destroyed || !this.peer?.open) return;
      postHeartbeat(this.roomId, !!this.conn?.open);
    };
    beat();
    this._heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
  }

  _replaceConn(conn) {
    if (this.conn && this.conn !== conn) {
      safeCloseConn(this.conn);
    }
    this.conn = conn;
  }

  _wireConn(conn) {
    this._replaceConn(conn);
    conn.on('open', () => {
      if (this._destroyed) return;
      this.status = 'connected';
      this._clearLobbyAfkTimer();
      this._emitStatus();
      this.onEvent?.({ type: 'peer-joined' });
      if (this.role === 'host') postHeartbeat(this.roomId, true);
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
      if (this.conn === conn) this.conn = null;
      this._remoteState = null;
      this.status = this.role === 'host' ? 'hosting' : 'idle';
      this.onEvent?.({ type: 'peer-left' });
      this._emitStatus();
      if (this.role === 'host') {
        postHeartbeat(this.roomId, false);
        this._startLobbyAfkTimer();
      } else if (this.role === 'guest' && !this._kicking) {
        this._scheduleGuestRejoin();
      }
    });
    conn.on('error', (err) => {
      console.warn('[matchmaking] conn', err);
      if (this._destroyed) return;
      // Soft error — do not flip to error if channel still open
      if (!conn.open) {
        this.status = this.role === 'host' ? 'hosting' : 'error';
        this._emitStatus();
      }
    });
  }

  _bindHostPeer(peer) {
    peer.on('connection', (conn) => {
      if (this.role !== 'host') {
        safeCloseConn(conn);
        return;
      }
      // Already have a live guest
      if (this.conn?.open) {
        safeCloseConn(conn);
        return;
      }
      // Replace stale half-open connection so a late orphan cannot block forever
      this._wireConn(conn);
    });

    peer.on('disconnected', () => {
      if (this._destroyed) return;
      console.warn('[matchmaking] peer disconnected — reconnecting');
      try {
        peer.reconnect();
      } catch (e) {
        console.warn(e);
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
      if (err?.type === 'unavailable-id' && this.role === 'host') {
        console.warn('[matchmaking] host id unavailable — will reregister with new id');
        this._scheduleHostReregister({ forceNewId: true });
      }
    });
  }

  _scheduleHostReregister(opts = {}) {
    if (this._destroyed || this.role !== 'host' || !this.roomId) return;
    if (this.conn?.open) return;
    if (this._reconnectTimer) return;
    const forceNewId = !!opts.forceNewId;
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._destroyed || this.role !== 'host' || !this.roomId) return;
      if (this.conn?.open) return;

      const keepId = forceNewId ? shortRoomId() : this.roomId;
      try {
        this.peer?.destroy();
      } catch {
        /* */
      }

      try {
        this.peer = this._createPeer(keepId);
        this._bindHostPeer(this.peer);
        const openId = await waitForPeerOpen(this.peer, PEER_OPEN_MS);
        this.roomId = openId;
        this.status = this.conn?.open ? 'connected' : 'hosting';
        this._startHeartbeat();
        this._startLobbyAfkTimer();
        this._emitStatus();
      } catch (err) {
        console.warn('[matchmaking] reregister failed', err);
        if (!forceNewId) {
          // Same id stuck — try a fresh id so hosting can recover
          this._scheduleHostReregister({ forceNewId: true });
        } else {
          this.status = 'error';
          this._emitStatus();
        }
      }
    }, HOST_REREGISTER_MS);
  }

  _scheduleGuestRejoin() {
    if (this._destroyed || this.role !== 'guest' || !this.roomId) return;
    if (this._guestRejoinTimer) return;
    if (this.status === 'connecting') return;
    this._guestRejoinTimer = setTimeout(async () => {
      this._guestRejoinTimer = null;
      if (this._destroyed || this.role !== 'guest' || !this.roomId) return;
      if (this.conn?.open) return;
      const room = this.roomId;
      console.warn('[matchmaking] guest attempting rejoin', room);
      try {
        this.status = 'connecting';
        this._emitStatus();
        await this._connectAsGuest(room, { isRejoin: true });
      } catch (e) {
        console.warn('[matchmaking] guest rejoin failed', e);
        this.status = 'idle';
        this._emitStatus();
      }
    }, 1200);
  }

  _watchVisibility() {
    if (typeof document === 'undefined' || this._onVis) return;
    this._onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (this._destroyed) return;
      if (this.role === 'host') {
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
      } else if (this.role === 'guest' && !this.conn?.open && this.roomId) {
        this._scheduleGuestRejoin();
      }
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

    let tryId = shortRoomId();
    let lastErr = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (this._destroyed) throw new Error('destroyed');
      try {
        this.peer = this._createPeer(tryId);
        this._bindHostPeer(this.peer);
        const openId = await waitForPeerOpen(this.peer, PEER_OPEN_MS);
        this.roomId = openId;
        this._startHeartbeat();
        this._startLobbyAfkTimer();
        this._emitStatus();
        return { roomId: openId, inviteUrl: this.inviteUrl };
      } catch (err) {
        lastErr = err;
        try {
          this.peer?.destroy();
        } catch {
          /* */
        }
        this.peer = null;
        // unavailable-id or timeout → new short id
        tryId = shortRoomId();
        await wait(300);
      }
    }

    this.status = 'error';
    this._emitStatus();
    throw lastErr || new Error('host_failed');
  }

  /**
   * Shared guest connect path (fresh join + rejoin).
   * @param {string} clean
   * @param {{ isRejoin?: boolean }} [opts]
   */
  async _connectAsGuest(clean, opts = {}) {
    const gen = ++this._joinGeneration;

    if (!opts.isRejoin) {
      await waitForRoomAlive(clean, 8);
    }

    if (!this.peer || this.peer.destroyed || !this.peer.open) {
      try {
        this.peer?.destroy();
      } catch {
        /* */
      }
      this.peer = this._createPeer();
      await waitForPeerOpen(this.peer, PEER_OPEN_MS);
    }

    let lastErr = null;
    for (let attempt = 0; attempt < JOIN_RETRIES; attempt++) {
      if (this._destroyed || gen !== this._joinGeneration) {
        throw new Error('join_aborted');
      }
      if (attempt > 0) await waitForRoomAlive(clean, 3);

      try {
        const conn = await openDataConnection(this.peer, clean, JOIN_ATTEMPT_MS);
        if (this._destroyed || gen !== this._joinGeneration) {
          safeCloseConn(conn);
          throw new Error('join_aborted');
        }
        this._wireConn(conn);
        if (conn.open) {
          this.status = 'connected';
          this._emitStatus();
          this.onEvent?.({ type: 'peer-joined' });
        }
        return { roomId: clean };
      } catch (e) {
        lastErr = e;
        await wait(JOIN_RETRY_MS * (1 + attempt * 0.2));
      }
    }

    throw (
      lastErr ||
      Object.assign(new Error('peer_unavailable'), { type: 'peer-unavailable' })
    );
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
    this._watchVisibility();

    try {
      return await this._connectAsGuest(clean);
    } catch (err) {
      this.status = 'error';
      this._emitStatus();
      // Tear down so a retry starts clean
      try {
        this.peer?.destroy();
      } catch {
        /* */
      }
      this.peer = null;
      throw err instanceof Error ? err : new Error(String(err?.message || err));
    }
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
    safeCloseConn(this.conn);
    this.conn = null;
    this.status = 'hosting';
    this._kicking = false;
    this._emitStatus();
  }

  get remoteState() {
    return this._remoteState;
  }

  get isConnected() {
    return this.status === 'connected' && !!this.conn?.open;
  }

  async destroy(opts = {}) {
    const leavingRoom = this.roomId;
    this._destroyed = true;
    this._joinGeneration += 1;
    this._clearHeartbeat();
    this._clearLobbyAfkTimer();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._guestRejoinTimer) {
      clearTimeout(this._guestRejoinTimer);
      this._guestRejoinTimer = null;
    }
    if (this._onVis && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVis);
      this._onVis = null;
    }
    safeCloseConn(this.conn);
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
    this._kicking = false;
    this._emitStatus();
    if (leavingRoom && opts.reason !== 'replace-host') {
      this._leaveRoomId = leavingRoom;
      postLeave(leavingRoom);
    }
  }

  /** Fully tear down, then open a fresh host lobby (unlimited re-host). */
  async replaceHost() {
    const prevRoom = this.roomId;
    await this.destroy({ reason: 'replace-host' });
    if (prevRoom) postLeave(prevRoom);
    this._destroyed = false;
    return this.host();
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
  // Keep peerLocal if present — guest may still need it for a re-host in same tab
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}
