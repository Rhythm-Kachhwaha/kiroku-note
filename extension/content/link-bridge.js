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
  if (typeof window !== "undefined" && window.__kirokuLinkBridgeLoaded) {
    return;
  }
  if (typeof window !== "undefined") {
    window.__kirokuLinkBridgeLoaded = true;
  }
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
        : (typeof globalThis !== "undefined" && globalThis.KirokuVideoController
            ? globalThis.KirokuVideoController
            : (typeof window !== "undefined" && window.KirokuVideoController
                ? window.KirokuVideoController
                : null));

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
      this.minStateIntervalMs = 250; // 4Hz throttle per protocol spec
      this._activeLoopHandler = null;
      this._activeLoopVideo = null;

      this._boundOnPlay = this._onPlay.bind(this);
      this._boundOnPause = this._onPause.bind(this);
      this._boundOnTimeUpdate = this._onTimeUpdate.bind(this);
      this._boundOnRateChange = this._onRateChange.bind(this);
      this._boundOnVolumeChange = this._onVolumeChange.bind(this);
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
      const rawUrl = (typeof location !== "undefined" && location.href) ? location.href : "";
      const parser = (typeof TitleParser !== "undefined")
        ? TitleParser
        : (typeof globalThis !== "undefined" && globalThis.TitleParser
            ? globalThis.TitleParser
            : (typeof window !== "undefined" && window.TitleParser
                ? window.TitleParser
                : (typeof require === "function" ? (() => { try { return require("../lib/title-parser.js"); } catch (_) { return null; } })() : null)));

      if (title && parser && typeof parser.cleanAnimeTitle === "function") {
        const parsed = parser.cleanAnimeTitle(title, rawUrl);
        if (parsed?.title) {
          if (typeof parsed.episode === "number" && !isNaN(parsed.episode)) {
            title = `${parsed.title} - Ep ${parsed.episode}`;
          } else {
            title = parsed.title;
          }
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
      if (vid && (!this.attached || this.activeVideo !== vid)) {
        if (this.attached && this.activeVideo !== vid) {
          this._detach();
        }
        this._attach(vid);
      } else if (!vid && this.attached) {
        this._detach();
      }
    }

    _clearActiveLoop() {
      if (this._activeLoopVideo && this._activeLoopHandler) {
        try {
          this._activeLoopVideo.removeEventListener("timeupdate", this._activeLoopHandler);
        } catch (_) {}
      }
      this._activeLoopHandler = null;
      this._activeLoopVideo = null;
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
        video.addEventListener("volumechange", this._boundOnVolumeChange);
        video.addEventListener("ended", this._boundOnEnded);
        window.addEventListener("pagehide", () => this._detach(), { once: true });
      } catch (_) {}

      this._emitVideoAttach();
      this._emitVideoState();
      this._emitCueList();
    }

    _emitVideoAttach() {
      if (!this.activeVideo) return;
      const title = this._getVideoTitle();
      const site = (typeof location !== "undefined" && location.hostname) ? location.hostname : "unknown";
      const duration = typeof this.activeVideo.duration === "number" && !isNaN(this.activeVideo.duration) ? this.activeVideo.duration : 0.0;
      const drm = this.isDrmSite();
      const hasNextEpisode = Boolean(this.nextEpisodeDetector?.hasNextEpisode?.());

      this.emitToBackground("video.attach", {
        tab: this.attachedTabId || 0,
        frame: 0,
        site,
        title,
        duration,
        drm,
        hasNextEpisode
      });
    }

    _emitSubStatus() {
      const poc = this.getPocInstance();
      const cues = poc?.syncEngine?.cues;
      const count = Array.isArray(cues) ? cues.length : 0;
      const name = poc?.activeFilename || (count > 0 ? "subtitles" : "");
      const source = poc?.activeFilename ? "file" : (count > 0 ? "embedded" : "none");
      const offsetMs = poc?.syncEngine?.offsetMs || 0;

      this.emitToBackground("sub.status", {
        tab: this.attachedTabId || 0,
        frame: 0,
        source,
        name,
        count,
        offsetMs
      });
    }

    _detach() {
      this._clearActiveLoop();
      if (this.activeVideo) {
        try {
          this.activeVideo.removeEventListener("play", this._boundOnPlay);
          this.activeVideo.removeEventListener("pause", this._boundOnPause);
          this.activeVideo.removeEventListener("timeupdate", this._boundOnTimeUpdate);
          this.activeVideo.removeEventListener("ratechange", this._boundOnRateChange);
          this.activeVideo.removeEventListener("volumechange", this._boundOnVolumeChange);
          this.activeVideo.removeEventListener("ended", this._boundOnEnded);
        } catch (_) {}
      }
      this.activeVideo = null;
      this.attached = false;

      this.emitToBackground("video.detach", {
        tab: this.attachedTabId || 0,
        frame: 0
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

    _onVolumeChange() {
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
      const vol = typeof this.activeVideo.volume === "number" ? this.activeVideo.volume : 1.0;
      const muted = Boolean(this.activeVideo.muted);
      const duration = typeof this.activeVideo.duration === "number" && !isNaN(this.activeVideo.duration) ? this.activeVideo.duration : 0.0;
      const hasNextEpisode = Boolean(this.nextEpisodeDetector?.hasNextEpisode?.());

      this.emitToBackground("video.state", {
        tab: this.attachedTabId || 0,
        t,
        paused,
        rate,
        vol,
        muted,
        duration,
        hasNextEpisode
      });
    }

    _calculateCueHash(cues) {
      if (!Array.isArray(cues) || cues.length === 0) return "empty";
      const first = cues[0];
      const last = cues[cues.length - 1];
      const joined = cues.map(c => c.text).join("");
      const key = `${cues.length}|${first.s}|${last.e}|${joined}`;

      // FNV-1a 32-bit hash
      let h = 0x811c9dc5;
      for (let i = 0; i < key.length; i++) {
        h = (h ^ key.charCodeAt(i)) * 0x01000193;
        h = h >>> 0;
      }
      return h.toString(16).padStart(8, "0");
    }

    _emitCueList() {
      const poc = this.getPocInstance();
      if (poc?.syncEngine?.cues && Array.isArray(poc.syncEngine.cues) && poc.syncEngine.cues.length > 0) {
        const rawCues = poc.syncEngine.cues;
        const cues = rawCues.map((c, idx) => {
          const s = typeof c.startTime === "number" ? c.startTime : (c.startMs ? c.startMs / 1000 : 0.0);
          const rawEnd = typeof c.endTime === "number" ? c.endTime : (c.endMs ? c.endMs / 1000 : 0.0);
          const e = Math.max(s, rawEnd);
          const secondary = typeof c.secondary_text === "string"
            ? c.secondary_text
            : (typeof c.secondaryText === "string" ? c.secondaryText : undefined);
          const item = {
            i: typeof c.id === "number" ? c.id : idx,
            s,
            e,
            text: c.text || c.rawText || ""
          };
          if (secondary) {
            item.secondary_text = secondary;
          }
          return item;
        });

        const hash = this._calculateCueHash(cues);
        const CHUNK_SIZE = 500;
        const parts = Math.ceil(cues.length / CHUNK_SIZE);

        for (let p = 0; p < parts; p++) {
          const chunk = cues.slice(p * CHUNK_SIZE, (p + 1) * CHUNK_SIZE);
          this.emitToBackground("cue.list", {
            tab: this.attachedTabId || 0,
            frame: 0,
            hash,
            part: p + 1,
            parts,
            cues: chunk
          });
        }
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
      if (message?.type === "LINK_RESYNC") {
        if (this.attached && this.activeVideo) {
          this._emitVideoAttach();
          this._emitVideoState();
          this._emitCueList();
          this._emitSubStatus();
        }
        if (sendResponse) sendResponse({ ok: true });
        return true;
      }

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
        const result = this.executeCommand(cmdType, payload);
        if (sendResponse) {
          if (typeof result === "object" && result !== null) {
            sendResponse(result);
          } else {
            sendResponse({ ok: Boolean(result) });
          }
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
            try {
              const res = vid.play();
              if (res && typeof res.catch === "function") {
                res.catch(() => {});
              }
            } catch (_) {}
            this._emitVideoState();
            return true;
          }
          return false;

        case "cmd.pause":
          this._clearActiveLoop();
          if (vid && typeof vid.pause === "function") {
            vid.pause();
            this._emitVideoState();
            return true;
          }
          break;

        case "cmd.toggle": {
          if (vid) {
            if (vid.paused) {
              const res = vid.play();
              if (res && typeof res.catch === "function") res.catch(() => {});
            } else {
              vid.pause();
            }
            this._emitVideoState();
            return true;
          }
          break;
        }

        case "cmd.rate": {
          const v = typeof payload.v === "number" ? payload.v : (!isNaN(Number(payload.v)) ? Number(payload.v) : 1.0);
          if (vid && v > 0) {
            vid.playbackRate = v;
            this._emitVideoState();
            return true;
          }
          break;
        }

        case "cmd.offset": {
          const ms = typeof payload.ms === "number" ? payload.ms : (!isNaN(Number(payload.ms)) ? Number(payload.ms) : 0);
          if (poc?.syncEngine?.setOffsetMs) {
            poc.syncEngine.setOffsetMs(ms);
          }
          const hud = (typeof window !== "undefined" && window.__kirokuAnimeHud) ? window.__kirokuAnimeHud : null;
          if (hud && typeof hud.setSubStatus === "function") {
            hud.setSubStatus({ offsetMs: ms });
          }
          this._emitSubStatus();
          return true;
        }

        case "cmd.cue": {
          const delta = typeof payload.delta === "number" ? payload.delta : (!isNaN(Number(payload.delta)) ? Number(payload.delta) : 0);
          const targetIdx = typeof payload.i === "number" ? payload.i : null;
          const cues = poc?.syncEngine?.cues;
          if (vid && Array.isArray(cues) && cues.length > 0) {
            let targetCue = null;
            if (targetIdx !== null) {
              targetCue = cues.find(c => (c.id === targetIdx || c.i === targetIdx));
            } else if (delta !== 0) {
              const curTime = vid.currentTime || 0;
              const curIdx = cues.findIndex(c => {
                const s = typeof c.startTime === "number" ? c.startTime : (c.startMs ? c.startMs / 1000 : 0);
                const e = typeof c.endTime === "number" ? c.endTime : (c.endMs ? c.endMs / 1000 : 0);
                return curTime >= s && curTime <= e;
              });
              const nextIdx = Math.max(0, Math.min(cues.length - 1, (curIdx >= 0 ? curIdx : 0) + delta));
              targetCue = cues[nextIdx];
            }
            if (targetCue) {
              const s = typeof targetCue.startTime === "number" ? targetCue.startTime : (targetCue.startMs ? targetCue.startMs / 1000 : 0);
              vid.currentTime = Math.max(0, s);
              if (poc?.syncEngine?.sync) poc.syncEngine.sync(true);
              this._emitVideoState();
              return true;
            }
          }
          break;
        }

        case "cmd.loop": {
          const s = typeof payload.s === "number" ? payload.s : 0;
          const e = typeof payload.e === "number" ? payload.e : s + 3;
          if (vid) {
            this._clearActiveLoop();
            vid.currentTime = s;
            const onLoopCheck = () => {
              if (vid.currentTime >= e) {
                vid.currentTime = s;
              }
            };
            this._activeLoopHandler = onLoopCheck;
            this._activeLoopVideo = vid;
            vid.addEventListener("timeupdate", onLoopCheck);
            vid.addEventListener("pause", () => {
              this._clearActiveLoop();
            }, { once: true });
            if (vid.paused) {
              vid.play()?.catch?.(() => {});
            }
            this._emitVideoState();
            return true;
          }
          break;
        }

        case "cmd.seek": {
          this._clearActiveLoop();
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

        case "cmd.subs": {
          const action = payload.action;
          const hud = (typeof window !== "undefined" && window.__kirokuAnimeHud) ? window.__kirokuAnimeHud : null;
          if (action === "open_menu") {
            if (hud && typeof hud.openMenu === "function") {
              hud.openMenu();
              return true;
            }
          } else if (action === "clear") {
            if (poc?.syncEngine?.setCues) {
              poc.syncEngine.setCues([]);
            }
            if (hud && typeof hud.setSubStatus === "function") {
              hud.setSubStatus({ source: "none", name: "No subtitles loaded", count: 0, offsetMs: 0 });
            }
            return true;
          }
          break;
        }

        case "cmd.clip": {
          const ClipHandlerClass = (typeof LinkClipHandler === "function")
            ? LinkClipHandler
            : (typeof globalThis !== "undefined" && globalThis.LinkClipHandler
                ? (typeof globalThis.LinkClipHandler === "function" ? globalThis.LinkClipHandler : globalThis.LinkClipHandler.LinkClipHandler)
                : (typeof window !== "undefined" && window.LinkClipHandler
                    ? (typeof window.LinkClipHandler === "function" ? window.LinkClipHandler : window.LinkClipHandler.LinkClipHandler)
                    : null));
          const handler = ClipHandlerClass ? new ClipHandlerClass({
            getVideoElement: () => vid,
            captureVisibleTab: async () => {
              if (this.chromeRuntime?.sendMessage) {
                const resp = await new Promise((resolve) => {
                  this.chromeRuntime.sendMessage(
                    { type: "CAPTURE_VIDEO_FRAME", format: "jpeg", quality: 85 },
                    (res) => resolve(res)
                  );
                });
                if (resp && resp.ok && resp.dataUrl) {
                  return resp.dataUrl;
                }
              }
              return null;
            }
          }) : null;
          if (handler) {
            handler.handleClipCommand(payload).then((clipRes) => {
              this.emitToBackground("clip.result", clipRes);
            }).catch(() => {});
            return true;
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
