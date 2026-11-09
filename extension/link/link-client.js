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
      this._connecting = false;
      this.reconnectAttempts = 0;
      this.reconnectTimer = null;
      this.heartbeatTimer = null;
      this.messageListeners = new Set();
      this.stateListeners = new Set();

      this._boundOnOpen = this._onOpen.bind(this);
      this._boundOnMessage = this._onMessage.bind(this);
      this._boundOnError = this._onError.bind(this);
      this._boundOnClose = this._onClose.bind(this);

      // Listen to chrome.storage.onChanged to auto-restart on new pairing token
      if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (changes[EXTENSION_AUTH_STORAGE_KEY] || changes[EXTENSION_AUTH_PERSISTENT_STORAGE_KEY]) {
            this.token = null;
            this.start().catch(() => {});
          }
        });
      }
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
        // Offline or unauthenticated: surface no_token state
        this.needsPairing = true;
        this.status = "no_token";
        this.statusReason = "Pairing code required";
        this._updateStatusChip("no_token", this.statusReason);
        this._notifyStateChange();
        return;
      }
      this.needsPairing = false;
      this.status = "connecting";
      this.statusReason = "";
      this._updateStatusChip("connecting");
      this._connect().catch(() => {});
    }

    _updateStatusChip(status, reason = "") {
      this.status = status;
      this.statusReason = reason;
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "LINK_STATUS",
          status: this.status,
          reason: this.statusReason
        }).catch(() => {});
      }
      if (typeof document === "undefined") return;
      const chip = document.querySelector("#indicator-link");
      if (!chip) return;
      const val = chip.querySelector(".system-status-value");
      chip.classList.remove("ok", "error", "checking", "warning", "unpaired");
      if (status === "connected" || status === "ok") {
        chip.classList.add("ok");
        if (val) val.textContent = "Connected";
        chip.title = "Link: Connected to Desktop";
      } else if (status === "no_token" || status === "needs_pairing") {
        chip.classList.add("warning");
        if (val) val.textContent = "Needs Pairing";
        chip.title = `Link: Desktop pairing required${reason ? ` (${reason})` : ""}`;
      } else if (status === "connecting") {
        chip.classList.add("checking");
        if (val) val.textContent = "Connecting…";
        chip.title = "Link: Connecting…";
      } else if (status === "unauthorized") {
        chip.classList.add("error");
        if (val) val.textContent = "Unauthorized";
        chip.title = `Link: Unauthorized (4401)${reason ? ` - ${reason}` : ""}`;
      } else {
        chip.classList.add("error");
        if (val) val.textContent = "Unreachable";
        chip.title = `Link: Unreachable${reason ? ` - ${reason}` : ""}`;
      }
    }

    stop() {
      this.stopped = true;
      this._clearTimers();
      this._clearSocket();
      this.connected = false;
      this.authenticated = false;
      this._notifyStateChange();
    }

    _clearSocket() {
      if (this.ws) {
        try {
          if (typeof this.ws.removeEventListener === "function") {
            this.ws.removeEventListener("open", this._boundOnOpen);
            this.ws.removeEventListener("message", this._boundOnMessage);
            this.ws.removeEventListener("error", this._boundOnError);
            this.ws.removeEventListener("close", this._boundOnClose);
          }
          this.ws.onopen = null;
          this.ws.onmessage = null;
          this.ws.onerror = null;
          this.ws.onclose = null;
          this.ws.close();
        } catch (_) {}
        this.ws = null;
      }
    }

    async _checkBackendOnline() {
      if (typeof fetch === "undefined" || this.WebSocketClass !== (typeof WebSocket !== "undefined" ? WebSocket : null)) {
        return true;
      }
      try {
        const httpUrl = this.wsUrl
          .replace(/^ws:\/\//i, "http://")
          .replace(/^wss:\/\//i, "https://")
          .replace(/\/api\/link\/ws.*$/i, "/api/link/status");
        const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
        let tid = null;
        try {
          tid = ctrl ? setTimeout(() => {
            try { ctrl.abort(); } catch (_) {}
          }, 2000) : null;
          const resp = await fetch(httpUrl, { signal: ctrl?.signal, method: "GET" }).catch(() => null);
          if (tid) clearTimeout(tid);
          return Boolean(resp && (resp.status === 200 || resp.status === 401 || resp.status === 403));
        } catch (_) {
          if (tid) clearTimeout(tid);
          return false;
        }
      } catch (_) {
        return true;
      }
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

    async _connect() {
      if (this.stopped || !this.WebSocketClass) return;
      if (this._connecting) return;
      if (this.connected && this.authenticated && this.ws && this.ws.readyState === 1) return;
      this._connecting = true;

      try {
        this._clearTimers();
        this._clearSocket();

        // Guard against ERR_CONNECTION_REFUSED in Chrome extension errors log by checking backend health
        const isOnline = await this._checkBackendOnline();
        if (!isOnline) {
          this._updateStatusChip("unreachable", "Backend offline");
          this._scheduleReconnect();
          return;
        }

        if (this.stopped) return;

        const socket = new this.WebSocketClass(this.wsUrl);
        this.ws = socket;

        const onOpen = () => {
          if (this.ws !== socket) return;
          this._onOpen(socket);
        };
        const onMessage = (ev) => {
          if (this.ws !== socket) return;
          this._onMessage(ev);
        };
        const onError = (ev) => {
          if (this.ws !== socket) return;
          this._onError(ev);
        };
        const onClose = (ev) => {
          if (this.ws !== socket) return;
          this._onClose(ev);
        };

        if (typeof socket.addEventListener === "function") {
          socket.addEventListener("open", onOpen);
          socket.addEventListener("message", onMessage);
          socket.addEventListener("error", onError);
          socket.addEventListener("close", onClose);
        } else {
          socket.onopen = onOpen;
          socket.onmessage = onMessage;
          socket.onerror = onError;
          socket.onclose = onClose;
        }
      } catch (_) {
        this._scheduleReconnect();
      } finally {
        this._connecting = false;
      }
    }

    _onOpen(socket = this.ws) {
      this.connected = true;
      this.reconnectAttempts = 0;
      this._sendHello(socket);
    }

    _sendHello(socket = this.ws) {
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
      this._sendRaw(helloEnvelope, socket);
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
          this._updateStatusChip("connected");
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

    _onError(err) {
      if (err && typeof err.preventDefault === "function") {
        try { err.preventDefault(); } catch (_) {}
      }
      // Handled by onclose
    }

    _onClose(event) {
      this.connected = false;
      this.authenticated = false;
      const code = event?.code;
      const reason = event?.reason || "";
      const isTransient = reason && reason.toLowerCase().includes("timeout");
      if (code === 4401 && !isTransient) {
        this.needsPairing = true;
        this._updateStatusChip("unauthorized", reason || "Invalid pairing token (4401)");
      } else if (!this.token) {
        this.needsPairing = true;
        this._updateStatusChip("no_token", "Pairing required");
      } else {
        this._updateStatusChip("unreachable", reason || `Connection closed (code ${code || 'unknown'})`);
      }
      this._clearTimers();
      this._notifyStateChange();
      if (!this.stopped && (code !== 4401 || isTransient)) {
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
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      const delay = Math.min(
        this.minReconnectMs * Math.pow(1.5, this.reconnectAttempts),
        this.maxReconnectMs
      );
      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(() => {
        if (!this.stopped) {
          this._connect().catch(() => {});
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

    _sendRaw(envelope, socket = this.ws) {
      try {
        const target = socket || this.ws;
        if (target && (target.readyState === 1 || target.readyState === undefined)) {
          const str = JSON.stringify(envelope);
          target.send(str);
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
