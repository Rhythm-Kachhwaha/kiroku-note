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

  class KirokuApi {
    constructor(baseUrl = DEFAULT_BASE_URL) {
      this.baseUrl = baseUrl.replace(/\/+$/, "");
    }

    async capture(text, deckName = "Default", options = {}) {
      if (!text || !text.trim()) {
        throw new Error("Text is required for capture.");
      }
      const url = `${this.baseUrl}/api/capture`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          deck_name: deckName,
          auto_save: Boolean(options.autoSave)
        })
      });

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
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cardPayload)
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Save card failed with status ${response.status}`);
      }
      return await response.json();
    }

    async annotateCues(cues = [], learnerLevel = null, ignoreFunctionWords = true) {
      const url = `${this.baseUrl}/api/subtitle/annotate`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cues,
          learner_level: learnerLevel,
          ignore_function_words: ignoreFunctionWords
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || `Annotation failed with status ${response.status}`);
      }
      return await response.json();
    }

    async getAnkiStatus() {
      const url = `${this.baseUrl}/api/anki/status`;
      const response = await fetch(url);
      if (!response.ok) return { connected: false, version: 0 };
      return await response.json();
    }
  }

  const defaultApi = new KirokuApi();

  return {
    KirokuApi,
    defaultKirokuApi: defaultApi
  };
});
