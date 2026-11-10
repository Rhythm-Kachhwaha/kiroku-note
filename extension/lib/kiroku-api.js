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
  const BACKEND_OFFLINE_MSG = "Kiroku backend is unreachable. Please ensure Kiroku Desktop or the local server is running.";

  class KirokuApi {
    constructor(baseUrl = DEFAULT_BASE_URL) {
      this.baseUrl = baseUrl.replace(/\/+$/, "");
    }

    async checkHealth() {
      const url = `${this.baseUrl}/api/health`;
      try {
        const response = await fetch(url);
        if (!response.ok) return { ok: false, error: `Backend returned status ${response.status}` };
        const data = await response.json();
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
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: text.trim(),
            deck_name: deckName,
            auto_save: Boolean(options.autoSave)
          })
        });
      } catch (err) {
        throw new Error(BACKEND_OFFLINE_MSG);
      }

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Capture failed with status ${response.status}`);
      }
      return await response.json();
    }

    async saveCard(cardPayload) {
      if (!cardPayload || !cardPayload.expression) {
        throw new Error("Expression is required to save card.");
      }
      const url = `${this.baseUrl}/api/cards/save`;
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cardPayload)
        });
      } catch (err) {
        throw new Error(BACKEND_OFFLINE_MSG);
      }

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Save card failed with status ${response.status}`);
      }
      return await response.json();
    }

    async annotateCues(cues = [], learnerLevel = null, ignoreFunctionWords = true) {
      const url = `${this.baseUrl}/api/subtitle/annotate`;
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Annotation failed with status ${response.status}`);
      }
      return await response.json();
    }

    async logSession(payload = {}) {
      const url = `${this.baseUrl}/api/link/sessions`;
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        return { ok: false, error: BACKEND_OFFLINE_MSG };
      }
      if (!response.ok) {
        return { ok: false, error: `Session logging failed (${response.status})` };
      }
      const data = await response.json();
      return { ok: true, data };
    }

    async saveEpisodePosition(cueHash, lastPositionMs, meta = {}) {
      if (!cueHash) return { ok: false, error: "Missing cueHash" };
      const url = `${this.baseUrl}/api/link/episodes/${encodeURIComponent(cueHash)}/position`;
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
      const data = await response.json();
      return { ok: true, data };
    }

    async getAnkiStatus() {
      const url = `${this.baseUrl}/api/anki/status`;
      try {
        const response = await fetch(url);
        if (!response.ok) return { connected: false, version: 0, error: `Status ${response.status}` };
        return await response.json();
      } catch (err) {
        return { connected: false, version: 0, error: BACKEND_OFFLINE_MSG };
      }
    }
  }

  const defaultApi = new KirokuApi();

  return {
    KirokuApi,
    defaultKirokuApi: defaultApi
  };
});

