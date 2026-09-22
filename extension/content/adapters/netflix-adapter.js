/**
 * AnkiMiner - Netflix Native Subtitle Extractor Adapter
 * 
 * Automatically detects Netflix's live Japanese subtitles from `.player-timedtext`,
 * suppresses Netflix's native overlay using CSS (opacity: 0), and emits cues
 * to AnkiMiner's selectable, Yomitan-hoverable overlay.
 */

(() => {
  function isNetflixPage() {
    if (typeof location === "undefined") return false;
    return location.hostname.includes("netflix.com");
  }

  function containsJapanese(text) {
    if (!text || typeof text !== "string") return false;
    return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
  }

  function extractTextFromTimedtextElement(el) {
    if (!el) return "";

    const textContainers = el.querySelectorAll(".player-timedtext-text-container");
    if (textContainers && textContainers.length > 0) {
      const lines = [];
      for (const container of textContainers) {
        const line = (container.textContent || "").trim();
        if (line) lines.push(line);
      }
      return lines.join("\n");
    }

    return (el.textContent || "").trim();
  }

  function hideNativeNetflixCaptions() {
    if (typeof document === "undefined" || typeof document.createElement !== "function") return;
    if (document.getElementById("ankiminer-hide-netflix-captions")) return;

    const style = document.createElement("style");
    style.id = "ankiminer-hide-netflix-captions";
    style.textContent = `
      .player-timedtext,
      [data-uia="player-timedtext"] {
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeNativeNetflixCaptionsHiding() {
    if (typeof document === "undefined") return;
    const style = document.getElementById("ankiminer-hide-netflix-captions");
    if (style && style.parentNode) {
      style.parentNode.removeChild(style);
    }
  }

  class NetflixAdapter {
    constructor({ onCue, video } = {}) {
      this.onCue = onCue;
      this.video = video || null;
      this.observer = null;
      this.timedtextEl = null;
      this.currentText = "";
      this.displayEnabled = true;
      this.discoveryObserver = null;
    }

    init() {
      if (!isNetflixPage()) return;

      this.setDisplayEnabled(this.displayEnabled);
      this._findAndObserve();
    }

    setVideo(video) {
      this.video = video;
    }

    setDisplayEnabled(enabled) {
      this.displayEnabled = Boolean(enabled);
      if (this.displayEnabled) {
        hideNativeNetflixCaptions();
      } else {
        removeNativeNetflixCaptionsHiding();
      }
    }

    _findAndObserve() {
      const el = document.querySelector(".player-timedtext, [data-uia=\"player-timedtext\"]");
      if (el) {
        this._observeElement(el);
      } else if (typeof MutationObserver !== "undefined" && document.body) {
        this.discoveryObserver = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes || []) {
              if (!node || node.nodeType !== 1) continue;
              const found = node.matches?.(".player-timedtext, [data-uia=\"player-timedtext\"]")
                ? node
                : node.querySelector?.(".player-timedtext, [data-uia=\"player-timedtext\"]");
              if (found) {
                this.discoveryObserver.disconnect();
                this.discoveryObserver = null;
                this._observeElement(found);
                return;
              }
            }
          }
        });
        this.discoveryObserver.observe(document.body, { childList: true, subtree: true });
      }
    }

    _observeElement(el) {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      this.timedtextEl = el;

      if (typeof MutationObserver !== "undefined") {
        this.observer = new MutationObserver(() => this._handleMutation());
        this.observer.observe(el, {
          childList: true,
          subtree: true,
          characterData: true
        });
      }

      // Check current content immediately
      this._handleMutation();
    }

    _handleMutation() {
      if (!this.timedtextEl) return;

      const rawText = extractTextFromTimedtextElement(this.timedtextEl);
      if (rawText === this.currentText) return;

      this.currentText = rawText;

      if (!rawText) {
        if (typeof this.onCue === "function") {
          this.onCue(null);
        }
        return;
      }

      // Check if text has Japanese characters
      const isJa = containsJapanese(rawText);
      const currentTime = this.video ? this.video.currentTime : 0;

      const cue = {
        startTime: currentTime,
        endTime: currentTime + 4.0, // Default duration if continuous
        text: rawText,
        isJapanese: isJa
      };

      if (typeof this.onCue === "function") {
        this.onCue(cue);
      }
    }

    destroy() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.discoveryObserver) {
        this.discoveryObserver.disconnect();
        this.discoveryObserver = null;
      }
      removeNativeNetflixCaptionsHiding();
      this.timedtextEl = null;
      this.currentText = "";
    }
  }

  const NetflixModule = {
    isNetflixPage,
    containsJapanese,
    extractTextFromTimedtextElement,
    hideNativeNetflixCaptions,
    removeNativeNetflixCaptionsHiding,
    NetflixAdapter
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = NetflixModule;
  } else {
    globalThis.NetflixAdapter = NetflixModule;
  }
})();
