/**
 * Kiroku Note - Kiroku API Client Library
 *
 * Provides typed methods for extension scripts and background service worker
 * to communicate with the local Kiroku FastAPI backend.
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.KirokuApi = exports.KirokuApi;
    root.defaultKirokuApi = exports.defaultKirokuApi;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_BASE_URL = "http://127.0.0.1:21828";
  const DEFAULT_CLOUD_BASE_URL = "https://kiroku-note.rhythmkach.workers.dev";
  const BACKEND_OFFLINE_MSG = "Kiroku backend is unreachable. Please ensure Kiroku Desktop or the local server is running.";
  const SAFE_HASH_PATTERN = /^[a-zA-Z0-9_\-\.]{1,128}$/;

  async function _parseJsonSafe(response) {
    try {
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (_) {
      return {};
    }
  }

  class KirokuApi {
    constructor(baseUrl = DEFAULT_BASE_URL, authToken = null, options = {}) {
      this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
      this.authToken = authToken ? String(authToken).trim() : null;
      this.cloudBaseUrl = (options.cloudBaseUrl || DEFAULT_CLOUD_BASE_URL).replace(/\/+$/, "");
      this.cloudAuthToken = options.cloudAuthToken ? String(options.cloudAuthToken).trim() : null;
    }

    setAuthToken(token) {
      this.authToken = token ? String(token).trim() : null;
    }

    setCloudAuthToken(token) {
      this.cloudAuthToken = token ? String(token).trim() : null;
    }

    getAuthToken() {
      return this.authToken;
    }

    getCloudAuthToken() {
      return this.cloudAuthToken;
    }

    _getHeaders(extraHeaders = {}) {
      const headers = { ...extraHeaders };
      if (this.authToken) {
        headers["Authorization"] = `Bearer ${this.authToken}`;
      }
      return headers;
    }

    async checkHealth() {
      const url = `${this.baseUrl}/api/health`;
      try {
        const response = await fetch(url, {
          headers: this._getHeaders()
        });
        if (!response.ok) return { ok: false, error: `Backend returned status ${response.status}` };
        const data = await _parseJsonSafe(response);
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: BACKEND_OFFLINE_MSG };
      }
    }

    async capture(text, deckName = "Default", options = {}) {
      if (!text || !text.trim()) {
        throw new Error("Text is required for capture.");
      }
      const url = `${this.baseUrl}/api/capture`;
      let response;
      let localFailed = false;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: this._getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            text: text.trim(),
            deck_name: deckName,
            auto_save: Boolean(options.autoSave)
          })
        });
      } catch (err) {
        localFailed = true;
      }

      if (!localFailed && response && response.ok) {
        const token = options.cloudToken || this.cloudAuthToken;
        if (token && this.cloudBaseUrl) {
          fetch(`${this.cloudBaseUrl}/sync/push`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ ops: [cardPayload] }),
            signal: AbortSignal.timeout(5000)
          }).catch(() => {});
        }
        return await _parseJsonSafe(response);
      }

      // Cloud edge capture fallback
      if (options.useCloudFallback !== false && this.cloudBaseUrl) {
        try {
          const cloudHeaders = { "Content-Type": "application/json" };
          const token = options.cloudToken || this.cloudAuthToken;
          if (token) cloudHeaders["Authorization"] = `Bearer ${token}`;
          const cloudResp = await fetch(`${this.cloudBaseUrl}/api/capture`, {
            method: "POST",
            headers: cloudHeaders,
            body: JSON.stringify({ text: text.trim(), deck_name: deckName }),
            signal: AbortSignal.timeout(5000)
          });
          if (cloudResp.ok) {
            const data = await _parseJsonSafe(cloudResp);
            return { ok: true, source: "cloud", ...data };
          }
        } catch (_) {}
      }

      if (response && !response.ok) {
        const err = await _parseJsonSafe(response);
        throw new Error(err.detail || `Capture failed with status ${response.status}`);
      }
      throw new Error(BACKEND_OFFLINE_MSG);
    }

    async saveCard(cardPayload, options = {}) {
      if (!cardPayload || !cardPayload.expression) {
        throw new Error("Expression is required to save card.");
      }
      const url = `${this.baseUrl}/api/cards/save`;
      let response;
      let localFailed = false;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: this._getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(cardPayload),
          signal: AbortSignal.timeout(4000)
        });
      } catch (err) {
        localFailed = true;
      }

      if (!localFailed && response && response.ok) {
        const token = options.cloudToken || this.cloudAuthToken;
        if (token && this.cloudBaseUrl) {
          fetch(`${this.cloudBaseUrl}/sync/push`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ ops: [cardPayload] }),
            signal: AbortSignal.timeout(5000)
          }).catch(() => {});
        }
        return await _parseJsonSafe(response);
      }

      // Cloud worker sync/push fallback
      if (options.useCloudFallback !== false && this.cloudBaseUrl) {
        try {
          const cloudHeaders = { "Content-Type": "application/json" };
          const token = options.cloudToken || this.cloudAuthToken;
          if (token) cloudHeaders["Authorization"] = `Bearer ${token}`;
          const cloudResp = await fetch(`${this.cloudBaseUrl}/sync/push`, {
            method: "POST",
            headers: cloudHeaders,
            body: JSON.stringify({ ops: [cardPayload] }),
            signal: AbortSignal.timeout(5000)
          });
          if (cloudResp.ok) {
            const data = await _parseJsonSafe(cloudResp);
            return { ok: true, source: "cloud", ...data };
          }
        } catch (_) {}
      }

      if (response && !response.ok) {
        const err = await _parseJsonSafe(response);
        throw new Error(err.detail || `Save card failed with status ${response.status}`);
      }
      throw new Error(BACKEND_OFFLINE_MSG);
    }

    async annotateCues(cues = [], learnerLevel = null, ignoreFunctionWords = true) {
      const url = `${this.baseUrl}/api/subtitle/annotate`;
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: this._getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            cues,
            learner_level: learnerLevel,
            ignore_function_words: ignoreFunctionWords
          })
        });
      } catch (err) {
        throw new Error(BACKEND_OFFLINE_MSG);
      }

      if (!response.ok) {
        const err = await _parseJsonSafe(response);
        throw new Error(err.detail || `Annotation failed with status ${response.status}`);
      }
      return await _parseJsonSafe(response);
    }

    async logSession(payload = {}) {
      const url = `${this.baseUrl}/api/link/sessions`;
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: this._getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(payload)
        });
      } catch (err) {
        return { ok: false, error: BACKEND_OFFLINE_MSG };
      }
      if (!response.ok) {
        return { ok: false, error: `Session logging failed (${response.status})` };
      }
      const data = await _parseJsonSafe(response);
      return { ok: true, data };
    }

    async saveEpisodePosition(cueHash, lastPositionMs, meta = {}) {
      if (!cueHash || typeof cueHash !== "string" || !SAFE_HASH_PATTERN.test(cueHash.trim())) {
        return { ok: false, error: "Invalid cueHash format" };
      }
      const safeHash = cueHash.trim();
      const url = `${this.baseUrl}/api/link/episodes/${encodeURIComponent(safeHash)}/position`;
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: this._getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            last_position_ms: Math.max(0, Math.round(lastPositionMs || 0)),
            ...meta
          })
        });
      } catch (err) {
        return { ok: false, error: BACKEND_OFFLINE_MSG };
      }
      if (!response.ok) {
        return { ok: false, error: `Position save failed (${response.status})` };
      }
      const data = await _parseJsonSafe(response);
      return { ok: true, data };
    }

    async syncEpisodeSession(sessionPayload = {}) {
      if (!sessionPayload || !sessionPayload.hash || typeof sessionPayload.hash !== "string" || !SAFE_HASH_PATTERN.test(sessionPayload.hash.trim())) {
        return { ok: false, error: "Invalid session hash format" };
      }
      const url = `${this.baseUrl}/api/link/episodes/sync`;
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: this._getHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(sessionPayload)
        });
      } catch (err) {
        return { ok: false, error: BACKEND_OFFLINE_MSG };
      }
      if (!response.ok) {
        return { ok: false, error: `Episode sync failed (${response.status})` };
      }
      const data = await _parseJsonSafe(response);
      return { ok: true, data };
    }

    async getAnkiStatus() {
      const url = `${this.baseUrl}/api/anki/status`;
      try {
        const response = await fetch(url, {
          headers: this._getHeaders()
        });
        if (!response.ok) return { connected: false, version: 0, error: `Status ${response.status}` };
        return await _parseJsonSafe(response);
      } catch (err) {
        return { connected: false, version: 0, error: BACKEND_OFFLINE_MSG };
      }
    }

    async syncUserProgress(batchPayload = {}) {
      const url = `${this.cloudBaseUrl || DEFAULT_CLOUD_BASE_URL}/api/user/progress/sync`;
      const token = this.cloudAuthToken || this.authToken;
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(batchPayload)
        });
        if (!response.ok) {
          return { ok: false, error: `Cloud sync failed (${response.status})` };
        }
        return await _parseJsonSafe(response);
      } catch (err) {
        return { ok: false, error: err.message || "Cloud unreachable" };
      }
    }

    async syncAnimePlayback(seriesId, episodeNumber = 1, lastPositionMs = 0, durationMs = 0, completed = false, minedCount = 0) {
      const url = `${this.cloudBaseUrl || DEFAULT_CLOUD_BASE_URL}/api/user/progress/anime`;
      const token = this.cloudAuthToken || this.authToken;
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            series_id: seriesId,
            episode_number: episodeNumber,
            last_position_ms: lastPositionMs,
            duration_ms: durationMs,
            completed: Boolean(completed),
            mined_card_count: minedCount
          })
        });
        if (!response.ok) {
          return { ok: false, error: `Anime sync failed (${response.status})` };
        }
        return await _parseJsonSafe(response);
      } catch (err) {
        return { ok: false, error: err.message || "Cloud unreachable" };
      }
    }
  }

  const defaultApi = new KirokuApi();

  return {
    KirokuApi,
    defaultKirokuApi: defaultApi
  };
});

