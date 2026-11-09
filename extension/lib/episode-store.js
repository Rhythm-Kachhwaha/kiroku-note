/**
 * Kiroku Note - Episode Store (G4)
 *
 * Persists and retrieves episode-specific subtitle track, offset, and position:
 * kiroku.anime.episodes[episodeKey] -> { sourceId, jimakuId, offsetMs, lastPos, lastUpdated }
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.EpisodeStore = exports.EpisodeStore;
    root.defaultEpisodeStore = exports.defaultEpisodeStore;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "kiroku.anime.episodes";

  class EpisodeStore {
    constructor(storageAdapter = null) {
      this.storageAdapter = storageAdapter || this._resolveDefaultStorage();
      this._cache = {};
      this._loaded = false;
    }

    _resolveDefaultStorage() {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        return {
          async get(key) {
            return new Promise((resolve) => {
              chrome.storage.local.get(key, (res) => resolve(res?.[key] || null));
            });
          },
          async set(key, val) {
            return new Promise((resolve) => {
              chrome.storage.local.set({ [key]: val }, () => resolve());
            });
          }
        };
      }
      if (typeof localStorage !== "undefined") {
        return {
          async get(key) {
            const raw = localStorage.getItem(key);
            try {
              return raw ? JSON.parse(raw) : null;
            } catch (_) {
              return null;
            }
          },
          async set(key, val) {
            try {
              localStorage.setItem(key, JSON.stringify(val));
            } catch (_) {}
          }
        };
      }
      // Memory fallback for tests or headless environments
      const mem = new Map();
      return {
        async get(key) { return mem.get(key) || null; },
        async set(key, val) { mem.set(key, val); }
      };
    }

    async init() {
      if (this._loaded) return;
      const stored = await this.storageAdapter.get(STORAGE_KEY);
      if (stored && typeof stored === "object") {
        this._cache = { ...stored };
      } else {
        this._cache = {};
      }
      this._loaded = true;
    }

    /**
     * Get episode state for a given episodeKey
     * @param {string} episodeKey
     * @returns {Promise<{sourceId: string|null, jimakuId: string|number|null, offsetMs: number, lastPos: number, lastUpdated: number}|null>}
     */
    async getEpisode(episodeKey) {
      if (!episodeKey) return null;
      await this.init();
      const ep = this._cache[episodeKey];
      return ep ? { ...ep } : null;
    }

    /**
     * Update episode state for a given episodeKey
     * @param {string} episodeKey
     * @param {Object} partial - { sourceId, jimakuId, offsetMs, lastPos }
     */
    async setEpisode(episodeKey, partial = {}) {
      if (!episodeKey) return null;
      await this.init();

      const existing = this._cache[episodeKey] || {
        sourceId: null,
        jimakuId: null,
        offsetMs: 0,
        lastPos: 0,
        lastUpdated: 0
      };

      const updated = {
        sourceId: partial.sourceId !== undefined ? partial.sourceId : existing.sourceId,
        jimakuId: partial.jimakuId !== undefined ? partial.jimakuId : existing.jimakuId,
        offsetMs: typeof partial.offsetMs === "number" && !isNaN(partial.offsetMs) ? partial.offsetMs : existing.offsetMs,
        lastPos: typeof partial.lastPos === "number" && !isNaN(partial.lastPos) ? partial.lastPos : existing.lastPos,
        lastUpdated: Date.now()
      };

      this._cache[episodeKey] = updated;
      await this.storageAdapter.set(STORAGE_KEY, this._cache);
      return { ...updated };
    }

    /**
     * Clear all episode data (used for testing or reset)
     */
    async clear() {
      this._cache = {};
      await this.storageAdapter.set(STORAGE_KEY, this._cache);
    }
  }

  const defaultStore = new EpisodeStore();

  return {
    EpisodeStore,
    defaultEpisodeStore: defaultStore
  };
});
