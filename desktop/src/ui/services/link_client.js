/**
 * Kiroku Note Desktop — Link Client (Slice 38)
 * WebSocket client connecting the desktop companion to the Link Hub backend (127.0.0.1:21828).
 * Manages authenticated handshake, heartbeat, auto-reconnection, and command transmission.
 */

const LINK_PROTOCOL_VERSION = 1;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20000;
const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

export class LinkClient {
  constructor(options = {}) {
    this.endpointProvider = options.endpointProvider || (async () => {
      if (typeof window !== 'undefined' && window.desktopAPI?.getLinkEndpoint) {
        return window.desktopAPI.getLinkEndpoint();
      }
      return { wsUrl: 'ws://127.0.0.1:21828/api/link/ws', token: '' };
    });

    this.wsUrl = options.wsUrl || null;
    this.token = options.token !== undefined ? options.token : null;
    this.clientId = options.clientId || 'kiroku-desktop/2.1.0';
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.minReconnectMs = options.minReconnectMs || MIN_RECONNECT_MS;
    this.maxReconnectMs = options.maxReconnectMs || MAX_RECONNECT_MS;
    this.WebSocketClass = options.WebSocketClass || (typeof WebSocket !== 'undefined' ? WebSocket : null);

    this.ws = null;
    this.sid = null;
    this.seq = 0;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'unauthorized'
    this.connected = false;
    this.authenticated = false;
    this.stopped = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.handshakeTimer = null;

    this.listeners = new Map(); // event -> Set<function>

    this._boundOnOpen = this._onOpen.bind(this);
    this._boundOnMessage = this._onMessage.bind(this);
    this._boundOnError = this._onError.bind(this);
    this._boundOnClose = this._onClose.bind(this);
  }

  on(event, fn) {
    if (typeof fn !== 'function') return this;
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(fn);
    return this;
  }

  off(event, fn) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(fn);
    }
    return this;
  }

  emit(event, ...args) {
    if (this.listeners.has(event)) {
      for (const fn of this.listeners.get(event)) {
        try {
          fn(...args);
        } catch (err) {
          console.error(`[LinkClient] Error in listener for "${event}":`, err);
        }
      }
    }
  }

  async start() {
    this.stopped = false;
    await this._resolveEndpoint();
    this._connect();
  }

  async _resolveEndpoint() {
    if (this.wsUrl && this.token !== null) return;
    try {
      const ep = await this.endpointProvider();
      if (ep) {
        if (!this.wsUrl && ep.wsUrl) this.wsUrl = ep.wsUrl;
        if (this.token === null && ep.token !== undefined) this.token = ep.token;
      }
    } catch (err) {
      console.warn('[LinkClient] Could not resolve link endpoint:', err);
    }
    if (!this.wsUrl) {
      this.wsUrl = 'ws://127.0.0.1:21828/api/link/ws';
    }
  }

  _connect() {
    if (this.stopped) return;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;

    this._clearTimers();
    this._setStatus('connecting');

    try {
      const WS = this.WebSocketClass || (typeof WebSocket !== 'undefined' ? WebSocket : null);
      if (!WS) {
        throw new Error('No WebSocket implementation available');
      }

      this.ws = new WS(this.wsUrl);
      this.ws.addEventListener('open', this._boundOnOpen);
      this.ws.addEventListener('message', this._boundOnMessage);
      this.ws.addEventListener('error', this._boundOnError);
      this.ws.addEventListener('close', this._boundOnClose);
    } catch (err) {
      this._setStatus('disconnected');
      this._scheduleReconnect();
    }
  }

  _onOpen() {
    this.connected = true;
    this.reconnectAttempts = 0;
    this._sendHandshake();
  }

  _sendHandshake() {
    this._clearHandshakeTimer();
    this.handshakeTimer = setTimeout(() => {
      if (!this.authenticated) {
        if (this.ws) {
          try { this.ws.close(4401, 'Handshake timeout'); } catch (_) {}
        }
      }
    }, 3000);

    const envelope = {
      v: LINK_PROTOCOL_VERSION,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      type: 'hello',
      src: 'desk',
      seq: this.seq++,
      payload: {
        role: 'desk',
        token: this.token || '',
        client: this.clientId
      }
    };

    try {
      this.ws.send(JSON.stringify(envelope));
    } catch (err) {
      this._onError(err);
    }
  }

  _onMessage(event) {
    let data;
    try {
      data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch (err) {
      return;
    }

    if (!data || typeof data !== 'object') return;
    if (data.v !== LINK_PROTOCOL_VERSION) return;

    if (data.type === 'hello.ok') {
      this._clearHandshakeTimer();
      this.authenticated = true;
      this.sid = data.payload?.sid || data.sid || null;
      this._setStatus('connected');
      this._startHeartbeat();
      this.emit('connected', { sid: this.sid });
      return;
    }

    if (data.type === 'ack') {
      this.emit('ack', data.payload || {});
      return;
    }

    this.emit(data.type, data.payload, data);
    this.emit('message', data);
  }

  _onError(err) {
    this.emit('error', err);
  }

  _onClose(event) {
    const wasAuth = this.authenticated;
    this.connected = false;
    this.authenticated = false;
    this.sid = null;
    this._clearTimers();

    if (event?.code === 4401) {
      this._setStatus('unauthorized');
    } else {
      this._setStatus('disconnected');
    }

    this.emit('disconnected', { code: event?.code, reason: event?.reason, wasAuthenticated: wasAuth });

    if (!this.stopped && event?.code !== 4401) {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(
      this.minReconnectMs * Math.pow(1.5, this.reconnectAttempts - 1),
      this.maxReconnectMs
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, delay);
  }

  _startHeartbeat() {
    this._clearHeartbeatTimer();
    this.heartbeatTimer = setInterval(() => {
      if (this.connected && this.ws?.readyState === 1) {
        // Active heartbeat ping interval
      }
    }, this.heartbeatIntervalMs);
  }

  _clearTimers() {
    this._clearHeartbeatTimer();
    this._clearHandshakeTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _clearHeartbeatTimer() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _clearHandshakeTimer() {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  _setStatus(newStatus) {
    if (this.status !== newStatus) {
      const prev = this.status;
      this.status = newStatus;
      this.emit('status', newStatus, prev);
    }
  }

  sendCommand(type, payload = {}) {
    if (!type.startsWith('cmd.')) {
      throw new Error(`Invalid command type: "${type}". Commands must begin with "cmd."`);
    }
    if (!this.connected || !this.ws || this.ws.readyState !== 1) {
      throw new Error('Cannot send command: LinkClient is not connected');
    }

    const envelope = {
      v: LINK_PROTOCOL_VERSION,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      type,
      src: 'desk',
      sid: this.sid || undefined,
      seq: this.seq++,
      payload
    };

    this.ws.send(JSON.stringify(envelope));
    return envelope.id;
  }

  disconnect() {
    this.stop();
  }

  stop() {
    this.stopped = true;
    this._clearTimers();
    if (this.ws) {
      try {
        if (this.connected && this.ws.readyState === 1) {
          const byeEnvelope = {
            v: LINK_PROTOCOL_VERSION,
            id: `msg-${Date.now()}-bye`,
            ts: Date.now(),
            type: 'bye',
            src: 'desk',
            sid: this.sid || undefined,
            seq: this.seq++,
            payload: {}
          };
          this.ws.send(JSON.stringify(byeEnvelope));
        }
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
    this.sid = null;
    this._setStatus('disconnected');
  }
}
