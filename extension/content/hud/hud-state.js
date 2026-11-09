/**
 * Kiroku Note - HUD State & Preference Store
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.HudState = exports.HudState;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "kiroku.hud.prefs";

  const DEFAULT_PREFS = {
    fontSize: 24,
    position: { relX: 0.5, relY: 0.78 },
    furigana: true,
    showJa: true,
    showNative: false,
    blur: false,
    learningMode: false
  };

  class HudState {
    constructor() {
      this.prefs = { ...DEFAULT_PREFS };
      this.selectedWords = new Set();
      this.activeCue = null;
      this.listeners = new Set();
      this.loadPrefs();
    }

    async loadPrefs() {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const res = await chrome.storage.local.get(STORAGE_KEY);
          if (res && res[STORAGE_KEY]) {
            this.prefs = { ...this.prefs, ...res[STORAGE_KEY] };
            this.notify();
          }
        }
      } catch (_) {}
    }

    async savePrefs(newPrefs = {}) {
      this.prefs = { ...this.prefs, ...newPrefs };
      this.notify();
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          await chrome.storage.local.set({ [STORAGE_KEY]: this.prefs });
        }
      } catch (_) {}
    }

    setActiveCue(cue) {
      this.activeCue = cue ? { ...cue } : null;
      this.notify();
    }

    toggleWordSelection(word) {
      if (!word) return;
      if (this.selectedWords.has(word)) {
        this.selectedWords.delete(word);
      } else {
        this.selectedWords.add(word);
      }
      this.notify();
    }

    clearWordSelection() {
      this.selectedWords.clear();
      this.notify();
    }

    subscribe(listener) {
      if (typeof listener === "function") {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }
      return () => {};
    }

    notify() {
      for (const listener of this.listeners) {
        try {
          listener(this);
        } catch (_) {}
      }
    }
  }

  return {
    HudState,
    defaultHudState: new HudState()
  };
});
