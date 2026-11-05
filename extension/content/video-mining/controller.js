/**
 * Kiroku Note - Universal Video Mining Controller & Next-Episode Web Bridge
 * Detects and clicks next-episode buttons across streaming platforms:
 * Netflix, Crunchyroll, YouTube, HiAnime, and generic HTML5 player controls.
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.KirokuVideoController = exports;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NEXT_EPISODE_SELECTORS = [
    // Netflix
    'button[data-uia="next-episode-seamless-button"]',
    'button[data-uia="control-next"]',
    '.button-nfPlayerNextEpisode',
    '[aria-label="Next Episode"]',

    // Crunchyroll
    '[data-t="next-episode-btn"]',
    '.next-episode-btn',
    'button.vjs-next-button',
    '[aria-label*="Next Episode"]',

    // YouTube
    'a.ytp-next-button',
    'button.ytp-next-button',
    '[aria-label*="Next (SHIFT+N)"]',
    '[aria-label="Next video"]',

    // HiAnime / Generic Anime Streams
    '.btn-next',
    '.next-episode',
    'a[title*="Next Episode"]',
    'button[title*="Next Episode"]',
    '[data-action="next-episode"]',
    '[title*="Next episode" i]',
    'a.forward.button',

    // Generic >>| next controls
    '[data-action="next"]',
    'button[title*="Next"]',
    '[aria-label*="Next"]'
  ];

  class NextEpisodeDetector {
    constructor(options = {}) {
      this.selectors = options.selectors || NEXT_EPISODE_SELECTORS;
    }

    findNextEpisodeButton(doc = (typeof document !== "undefined" ? document : null)) {
      if (!doc || typeof doc.querySelector !== "function") return null;

      for (const selector of this.selectors) {
        try {
          const el = doc.querySelector(selector);
          if (el) {
            // Must not be hidden or disabled
            if (el.disabled) continue;
            if (el.style && (el.style.display === "none" || el.style.visibility === "hidden")) continue;
            return el;
          }
        } catch (_) {}
      }

      return null;
    }

    hasNextEpisode(doc = (typeof document !== "undefined" ? document : null)) {
      return Boolean(this.findNextEpisodeButton(doc));
    }

    triggerNextEpisode(doc = (typeof document !== "undefined" ? document : null)) {
      const btn = this.findNextEpisodeButton(doc);
      if (!btn) return false;

      try {
        if (typeof btn.click === "function") {
          btn.click();
        } else if (typeof btn.dispatchEvent === "function") {
          const event = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: typeof window !== "undefined" ? window : null
          });
          btn.dispatchEvent(event);
        }
        return true;
      } catch (err) {
        console.warn("[NextEpisodeDetector] Failed to trigger next episode click:", err);
        return false;
      }
    }
  }

  return {
    NextEpisodeDetector,
    NEXT_EPISODE_SELECTORS
  };
});
