/**
 * Kiroku Note - Extension Link Client (Slice 37)
 * WebSocket client connecting to Link Hub backend.
 * Features:
 *  - Token retrieval from pairing storage (session/local fallback).
 *  - Exponential backoff reconnect: 1s to 30s.
 *  - Heartbeat ping every 20s.
 *  - Enforces schema v=1 envelopes.
 *  - Relays content messages <-> WebSocket.
 *  - Offline = silent no-op.
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    const Client = exports.LinkClient || exports;
    root.LinkClient = Client;
    Object.assign(root.LinkClient, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_WS_URL = "ws://127.0.0.1:21828/api/link/ws";
  const DEFAULT_HEARTBEAT_INTERVAL_MS = 20000;
  const MIN_RECONNECT_MS = 1000;
  const MAX_RECONNECT_MS = 30000;
  const EXTENSION_AUTH_STORAGE_KEY = "kiroku.extension.session_token";
  const EXTENSION_AUTH_PERSISTENT_STORAGE_KEY = "kiroku.extension.remembered_token";

  class LinkClient {
    constructor(options = {}) {
      this.wsUrl = options.wsUrl || DEFAULT_WS_URL;
      this.token = options.token || null;
      this.needsPairing = false;
      this.clientId = options.clientId || `ext-${Date.now()}`;
      this.heartbeatIntervalMs = options.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS;
      this.minReconnectMs = options.minReconnectMs || MIN_RECONNECT_MS;
      this.maxReconnectMs = options.maxReconnectMs || MAX_RECONNECT_MS;
      this.WebSocketClass = options.WebSocketClass || (typeof WebSocket !== "undefined" ? WebSocket : null);

      this.ws = null;
      this.connected = false;
      this.authenticated = false;
      this.stopped = false;
      this.reconnectAttempts = 0;
      this.reconnectTimer = null;
      this.heartbeatTimer = null;
      this.messageListeners = new Set();
      this.stateListeners = new Set();

      this._boundOnOpen = this._onOpen.bind(this);
      this._boundOnMessage = this._onMessage.bind(this);
      this._boundOnError = this._onError.bind(this);
      this._boundOnClose = this._onClose.bind(this);
    }

    async resolveToken() {
      if (this.token) return this.token;
      try {
        if (typeof chrome !== "undefined" && chrome.storage) {
          if (chrome.storage.session) {
            const stored = await chrome.storage.session.get(EXTENSION_AUTH_STORAGE_KEY).catch(() => null);
            if (stored && stored[EXTENSION_AUTH_STORAGE_KEY]) {
              this.token = stored[EXTENSION_AUTH_STORAGE_KEY];
              return this.token;
            }
          }
          if (chrome.storage.local) {
            const stored = await chrome.storage.local.get([EXTENSION_AUTH_PERSISTENT_STORAGE_KEY, EXTENSION_AUTH_STORAGE_KEY]).catch(() => null);
            if (stored && (stored[EXTENSION_AUTH_PERSISTENT_STORAGE_KEY] || stored[EXTENSION_AUTH_STORAGE_KEY])) {
              this.token = stored[EXTENSION_AUTH_PERSISTENT_STORAGE_KEY] || stored[EXTENSION_AUTH_STORAGE_KEY];
              return this.token;
            }
          }
        }
      } catch (_) {}
      return null;
    }

    async start() {
      this.stopped = false;
      await this.resolveToken();
      if (!this.token) {
        // Offline or unauthenticated: surface needs_pairing state
        this.needsPairing = true;
        this._updateStatusChip("needs_pairing");
        this._notifyStateChange();
        return;
      }
      this.needsPairing = false;
      this._updateStatusChip("connecting");
      this._connect();
    }

    _updateStatusChip(status) {
      if (typeof document === "undefined") return;
      const chip = document.querySelector("#indicator-link");
      if (!chip) return;
      const val = chip.querySelector(".system-status-value");
      chip.classList.remove("ok", "error", "checking", "warning", "unpaired");
      if (status === "ok") {
        chip.classList.add("ok");
        if (val) val.textContent = "Connected";
        chip.title = "Link: Connected to Desktop";
      } else if (status === "needs_pairing") {
        chip.classList.add("warning");
        if (val) val.textContent = "Needs Pairing";
        chip.title = "Link: Desktop pairing required";
      } else if (status === "connecting") {
        chip.classList.add("checking");
        if (val) val.textContent = "Connecting…";
        chip.title = "Link: Connecting…";
      } else {
        chip.classList.add("error");
        if (val) val.textContent = "Disconnected";
        chip.title = "Link: Disconnected";
      }
    }

    stop() {
      this.stopped = true;
      this._clearTimers();
      if (this.ws) {
        try {
          this.ws.close();
        } catch (_) {}
        this.ws = null;
      }
      this.connected = false;
      this.authenticated = false;
      this._notifyStateChange();
    }

    _clearTimers() {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }

    _connect() {
      if (this.stopped || !this.WebSocketClass) return;
      this._clearTimers();

      try {
        this.ws = new this.WebSocketClass(this.wsUrl);
        if (typeof this.ws.addEventListener === "function") {
          this.ws.addEventListener("open", this._boundOnOpen);
          this.ws.addEventListener("message", this._boundOnMessage);
          this.ws.addEventListener("error", this._boundOnError);
          this.ws.addEventListener("close", this._boundOnClose);
        } else {
          this.ws.onopen = this._boundOnOpen;
          this.ws.onmessage = this._boundOnMessage;
          this.ws.onerror = this._boundOnError;
          this.ws.onclose = this._boundOnClose;
        }
      } catch (_) {
        this._scheduleReconnect();
      }
    }

    _onOpen() {
      this.connected = true;
      this.reconnectAttempts = 0;
      this._sendHello();
    }

    _sendHello() {
      const helloEnvelope = {
        v: 1,
        id: `hello-${Date.now()}`,
        ts: Date.now(),
        type: "hello",
        src: "ext",
        payload: {
          role: "ext",
          token: this.token || "",
          client: this.clientId
        }
      };
      this._sendRaw(helloEnvelope);
    }

    _onMessage(event) {
      try {
        const raw = typeof event.data === "string" ? event.data : (event.data?.toString ? event.data.toString() : "");
        if (!raw) return;
        const msg = JSON.parse(raw);
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "hello.ok") {
          this.authenticated = true;
          this.needsPairing = false;
          this._updateStatusChip("ok");
          this._startHeartbeat();
          this._notifyStateChange();
          return;
        }

        if (msg.type === "ping") {
          this.send("pong", {});
          return;
        }

        if (msg.type === "pong") {
          return;
        }

        // Forward to registered message listeners
        for (const listener of this.messageListeners) {
          try {
            listener(msg);
          } catch (_) {}
        }
      } catch (_) {}
    }

    _onError() {
      // Handled by onclose
    }

    _onClose() {
      this.connected = false;
      this.authenticated = false;
      this._updateStatusChip(this.token ? "disconnected" : "needs_pairing");
      this._clearTimers();
      this._notifyStateChange();
      if (!this.stopped) {
        this._scheduleReconnect();
      }
    }

    _startHeartbeat() {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        if (this.connected && this.authenticated) {
          this.send("ping", {});
        }
      }, this.heartbeatIntervalMs);
    }

    _scheduleReconnect() {
      if (this.stopped) return;
      const delay = Math.min(
        this.minReconnectMs * Math.pow(1.5, this.reconnectAttempts),
        this.maxReconnectMs
      );
      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(() => {
        if (!this.stopped) {
          this._connect();
        }
      }, delay);
    }

    send(type, payload = {}) {
      if (!this.connected || !this.authenticated || !this.ws) {
        return false;
      }
      const envelope = {
        v: 1,
        id: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
        type,
        src: "ext",
        payload: payload || {}
      };
      return this._sendRaw(envelope);
    }

    _sendRaw(envelope) {
      try {
        if (this.ws && (this.ws.readyState === 1 || this.ws.readyState === undefined)) {
          const str = JSON.stringify(envelope);
          this.ws.send(str);
          return true;
        }
      } catch (_) {}
      return false;
    }

    onMessage(callback) {
      if (typeof callback === "function") {
        this.messageListeners.add(callback);
      }
      return () => this.messageListeners.delete(callback);
    }

    onStateChange(callback) {
      if (typeof callback === "function") {
        this.stateListeners.add(callback);
      }
      return () => this.stateListeners.delete(callback);
    }

    _notifyStateChange() {
      const state = {
        connected: this.connected,
        authenticated: this.authenticated,
        needsPairing: Boolean(!this.token && !this.authenticated)
      };
      for (const listener of this.stateListeners) {
        try {
          listener(state);
        } catch (_) {}
      }
    }
  }

  return {
    LinkClient,
    DEFAULT_WS_URL,
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    EXTENSION_AUTH_STORAGE_KEY
  };
});
