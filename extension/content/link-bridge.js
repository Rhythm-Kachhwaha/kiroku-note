/**
 * Kiroku Note - Extension Link Bridge (Slice 37)
 * Runs in content script context.
 * Attaches to active video via window.__kirokuVideo.
 * Emits video.attach, video.detach, video.state, cue.active, cue.list to background.
 * Executes cmd.play, cmd.pause, cmd.seek, cmd.jump, cmd.replay, cmd.sub_toggle.
 * DRM site flag checked via Netflix/DRM adapter list.
 * Offline = silent no-op.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.LinkBridge = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class LinkBridge {
    constructor(options = {}) {
      this.getVideoHelper = options.getVideoHelper || (() => {
        if (typeof window !== "undefined" && window.__kirokuVideo) {
          return window.__kirokuVideo.getVideo();
        }
        return null;
      });
      this.getPocInstance = options.getPocInstance || (() => {
        if (typeof window !== "undefined" && window.__kirokuVideo) {
          return window.__kirokuVideo.getInstance();
        }
        return null;
      });

      this.chromeRuntime = options.chromeRuntime || (typeof chrome !== "undefined" ? chrome.runtime : null);
      this.isDrmSite = options.isDrmSite || this._detectDrmSite.bind(this);

      const Controller = (typeof require === "function")
        ? (() => {
            try { return require("./video-mining/controller.js"); } catch (_) { return null; }
          })()
        : (typeof root !== "undefined" && root.KirokuVideoController ? root.KirokuVideoController : null);

      const DetectorClass = options.NextEpisodeDetector || Controller?.NextEpisodeDetector;
      this.nextEpisodeDetector = DetectorClass ? new DetectorClass() : {
        hasNextEpisode: () => false,
        triggerNextEpisode: () => false
      };

      this.attached = false;
      this.activeVideo = null;
      this.attachedTabId = null;
      this.pollTimer = null;
      this.lastStateEmit = 0;
      this.minStateIntervalMs = 100; // 10Hz throttle

      this._boundOnPlay = this._onPlay.bind(this);
      this._boundOnPause = this._onPause.bind(this);
      this._boundOnTimeUpdate = this._onTimeUpdate.bind(this);
      this._boundOnRateChange = this._onRateChange.bind(this);
      this._boundOnEnded = this._onEnded.bind(this);
      this._boundRuntimeMessage = this._handleRuntimeMessage.bind(this);
    }

    _detectDrmSite() {
      try {
        if (typeof location !== "undefined" && location.hostname) {
          const host = location.hostname.toLowerCase();
          if (host.includes("netflix.com") || host.includes("disneyplus.com") || host.includes("hulu.com") || host.includes("primevideo.com")) {
            return true;
          }
        }
        const poc = this.getPocInstance();
        if (poc && typeof poc.isNetflixPlatform === "function") {
          return Boolean(poc.isNetflixPlatform());
        }
      } catch (_) {}
      return false;
    }

    _getVideoTitle() {
      let title = (typeof document !== "undefined" && document.title) ? document.title.trim() : "";
      if (!title && typeof document !== "undefined") {
        const titleEl = document.querySelector("title");
        if (titleEl?.textContent) {
          title = titleEl.textContent.trim();
        }
      }
      if (!title && typeof location !== "undefined" && location.hostname) {
        title = location.hostname;
      }
      return title || "Video";
    }

    start() {
      if (this.chromeRuntime?.onMessage?.addListener) {
        this.chromeRuntime.onMessage.addListener(this._boundRuntimeMessage);
      }
      this._startPolling();
    }

    stop() {
      this._stopPolling();
      if (this.attached) {
        this._detach();
      }
      if (this.chromeRuntime?.onMessage?.removeListener) {
        this.chromeRuntime.onMessage.removeListener(this._boundRuntimeMessage);
      }
    }

    _startPolling() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => {
        this._checkVideo();
      }, 1000);
      this._checkVideo();
    }

    _stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    }

    _checkVideo() {
      const vid = this.getVideoHelper();
      if (vid && !this.attached) {
        this._attach(vid);
      } else if (!vid && this.attached) {
        this._detach();
      }
    }

    _attach(video) {
      if (!video) return;
      this.activeVideo = video;
      this.attached = true;

      try {
        video.addEventListener("play", this._boundOnPlay);
        video.addEventListener("pause", this._boundOnPause);
        video.addEventListener("timeupdate", this._boundOnTimeUpdate);
        video.addEventListener("ratechange", this._boundOnRateChange);
        video.addEventListener("ended", this._boundOnEnded);
      } catch (_) {}

      // Emit video.attach
      const title = this._getVideoTitle();
      const site = (typeof location !== "undefined" && location.hostname) ? location.hostname : "unknown";
      const duration = typeof video.duration === "number" && !isNaN(video.duration) ? video.duration : 0.0;
      const drm = this.isDrmSite();
      const hasNextEpisode = Boolean(this.nextEpisodeDetector?.hasNextEpisode?.());

      this.emitToBackground("video.attach", {
        tab: this.attachedTabId || 0,
        site,
        title,
        duration,
        drm,
        hasNextEpisode
      });

      // Emit initial state
      this._emitVideoState();

      // Emit initial cue.list if available
      this._emitCueList();
    }

    _detach() {
      if (this.activeVideo) {
        try {
          this.activeVideo.removeEventListener("play", this._boundOnPlay);
          this.activeVideo.removeEventListener("pause", this._boundOnPause);
          this.activeVideo.removeEventListener("timeupdate", this._boundOnTimeUpdate);
          this.activeVideo.removeEventListener("ratechange", this._boundOnRateChange);
          this.activeVideo.removeEventListener("ended", this._boundOnEnded);
        } catch (_) {}
      }
      this.activeVideo = null;
      this.attached = false;

      this.emitToBackground("video.detach", {
        tab: this.attachedTabId || 0
      });
    }

    _onPlay() {
      this._emitVideoState();
    }

    _onPause() {
      this._emitVideoState();
    }

    _onRateChange() {
      this._emitVideoState();
    }

    _onEnded() {
      this._emitVideoState();
    }

    _onTimeUpdate() {
      const now = Date.now();
      if (now - this.lastStateEmit < this.minStateIntervalMs) {
        return;
      }
      this.lastStateEmit = now;
      this._emitVideoState();
    }

    _emitVideoState() {
      if (!this.attached || !this.activeVideo) return;
      const t = typeof this.activeVideo.currentTime === "number" ? this.activeVideo.currentTime : 0.0;
      const paused = Boolean(this.activeVideo.paused);
      const rate = typeof this.activeVideo.playbackRate === "number" ? this.activeVideo.playbackRate : 1.0;
      const duration = typeof this.activeVideo.duration === "number" && !isNaN(this.activeVideo.duration) ? this.activeVideo.duration : 0.0;
      const hasNextEpisode = Boolean(this.nextEpisodeDetector?.hasNextEpisode?.());

      this.emitToBackground("video.state", {
        tab: this.attachedTabId || 0,
        t,
        paused,
        rate,
        duration,
        hasNextEpisode
      });
    }

    _emitCueList() {
      const poc = this.getPocInstance();
      if (poc?.syncEngine?.cues && Array.isArray(poc.syncEngine.cues) && poc.syncEngine.cues.length > 0) {
        const rawCues = poc.syncEngine.cues;
        const cues = rawCues.map((c, idx) => {
          const s = typeof c.startTime === "number" ? c.startTime : (c.startMs ? c.startMs / 1000 : 0.0);
          const rawEnd = typeof c.endTime === "number" ? c.endTime : (c.endMs ? c.endMs / 1000 : 0.0);
          const e = Math.max(s, rawEnd);
          return {
            i: typeof c.id === "number" ? c.id : idx,
            s,
            e,
            text: c.text || c.rawText || ""
          };
        });

        const title = this._getVideoTitle();
        let hash = "";
        try {
          const raw = encodeURIComponent(String(title || "")) + String(cues.length);
          if (typeof btoa === "function") {
            hash = btoa(raw).slice(0, 16);
          } else if (typeof Buffer !== "undefined") {
            hash = Buffer.from(raw).toString("base64").slice(0, 16);
          }
        } catch (_) {}
        if (!hash) {
          hash = `hash-${Date.now()}-${cues.length}`;
        }

        this.emitToBackground("cue.list", {
          tab: this.attachedTabId || 0,
          hash,
          cues
        });
      }
    }

    emitActiveCue(cue) {
      if (!cue) {
        this.emitToBackground("cue.active", {
          tab: this.attachedTabId || 0,
          i: null,
          secondary_text: null
        });
        return;
      }
      const cueIndex = typeof cue.id === "number"
        ? cue.id
        : (typeof cue.i === "number"
          ? cue.i
          : (typeof cue.idx === "number" ? cue.idx : 0));
      const secondaryText = typeof cue.secondary_text === "string"
        ? cue.secondary_text
        : (typeof cue.secondaryText === "string" ? cue.secondaryText : null);

      this.emitToBackground("cue.active", {
        tab: this.attachedTabId || 0,
        i: cueIndex,
        secondary_text: secondaryText
      });
    }

    emitToBackground(type, payload) {
      if (!this.chromeRuntime?.sendMessage) return;
      try {
        this.chromeRuntime.sendMessage({
          type: "LINK_RELAY_OUT",
          linkType: type,
          payload: payload || {}
        }).catch(() => {});
      } catch (_) {}
    }

    _handleRuntimeMessage(message, _sender, sendResponse) {
      if (message?.type === "LINK_CMD") {
        const cmdType = message.cmdType;
        const payload = message.payload || {};
        if (cmdType === "SUBTITLE_CUE_CHANGED") {
          const cue = payload.cue || (payload.payload && payload.payload.cue) || null;
          this.emitActiveCue(cue);
          if (sendResponse) {
            sendResponse({ ok: true });
          }
          return true;
        }
        const handled = this.executeCommand(cmdType, payload);
        if (sendResponse) {
          sendResponse({ ok: handled });
        }
        return true;
      }

      // Also listen to existing POC events if emitted internally
      if (message?.type === "SUBTITLE_CUE_CHANGED") {
        this.emitActiveCue(message.cue);
      } else if (message?.type === "SUBTITLE_FILE_LOADED" || message?.type === "LOAD_SUBTITLE_CUES") {
        setTimeout(() => this._emitCueList(), 100);
      }
    }

    executeCommand(cmdType, payload = {}) {
      const vid = this.activeVideo || this.getVideoHelper();
      const poc = this.getPocInstance();

      switch (cmdType) {
        case "cmd.play":
          if (vid && typeof vid.play === "function") {
            vid.play().catch?.(() => {});
            this._emitVideoState();
            return true;
          }
          break;

        case "cmd.pause":
          if (vid && typeof vid.pause === "function") {
            vid.pause();
            this._emitVideoState();
            return true;
          }
          break;

        case "cmd.seek": {
          if (vid) {
            if (payload.delta !== undefined && !isNaN(Number(payload.delta))) {
              const delta = Number(payload.delta);
              vid.currentTime = Math.max(0, (vid.currentTime || 0) + delta);
              if (poc?.syncEngine?.sync) {
                poc.syncEngine.sync(true);
              }
              this._emitVideoState();
              return true;
            }
            const t = typeof payload.t === "number" ? payload.t : (payload.t !== undefined && !isNaN(Number(payload.t)) ? Number(payload.t) : null);
            if (t !== null) {
              vid.currentTime = Math.max(0, t);
              if (poc?.syncEngine?.sync) {
                poc.syncEngine.sync(true);
              }
              this._emitVideoState();
              return true;
            }
          }
          break;
        }

        case "cmd.jump": {
          const delta = typeof payload.delta === "number" ? payload.delta : (!isNaN(Number(payload.delta)) ? Number(payload.delta) : 0);
          if (vid) {
            vid.currentTime = Math.max(0, (vid.currentTime || 0) + delta);
            if (poc?.syncEngine?.sync) {
              poc.syncEngine.sync(true);
            }
            this._emitVideoState();
            return true;
          }
          break;
        }

        case "cmd.replay": {
          // Replay active cue or current segment
          if (poc?.hotkeyController && typeof poc.hotkeyController.replayCurrentCue === "function") {
            poc.hotkeyController.replayCurrentCue();
            this._emitVideoState();
            return true;
          }
          if (vid) {
            const currentCue = poc?.syncEngine?.currentCue;
            if (currentCue && typeof currentCue.startTime === "number") {
              vid.currentTime = currentCue.startTime;
            } else {
              vid.currentTime = Math.max(0, (vid.currentTime || 0) - 5);
            }
            if (poc?.syncEngine?.sync) poc.syncEngine.sync(true);
            this._emitVideoState();
            return true;
          }
          break;
        }

        case "cmd.sub_toggle": {
          if (poc) {
            const nextDisplay = payload.enabled !== undefined ? Boolean(payload.enabled) : !(poc.renderer?.displayEnabled !== false);
            if (typeof poc.setSubtitlesDisplay === "function") {
              poc.setSubtitlesDisplay(nextDisplay);
            } else if (poc.renderer && typeof poc.renderer.setDisplayEnabled === "function") {
              poc.renderer.setDisplayEnabled(nextDisplay);
            }
            return true;
          }
          break;
        }

        case "cmd.next_episode": {
          if (this.nextEpisodeDetector && typeof this.nextEpisodeDetector.triggerNextEpisode === "function") {
            const handled = this.nextEpisodeDetector.triggerNextEpisode();
            return Boolean(handled);
          }
          break;
        }

        default:
          break;
      }
      return false;
    }
  }

  // Auto-start in content script environment if in browser
  if (typeof window !== "undefined") {
    if (!window.__kirokuLinkBridge) {
      const bridge = new LinkBridge();
      bridge.start();
      window.__kirokuLinkBridge = bridge;
    }
  }

  return {
    LinkBridge
  };
});
