
  // -------------------------------------------------------------
  // Step 5: Video Mining POC Controller
  // -------------------------------------------------------------
  class VideoMiningPOC {
    constructor() {
      this.renderer = new SubtitleOverlayRenderer();
      this.syncEngine = new SubtitleSynchronizer([], (cue) => {
        this.renderer.renderCue(cue);
        this.broadcastActiveCue(cue);
      });
      this.detector = new VideoDetector((video) => {
        this.onVideoDetected(video);
      });
      this.activeVideo = null;
      this.activeFilename = "";
      this.subtitlesDisplayEnabled = false;
      this.renderer.setDisplayEnabled(false);
      this.ytAdapter = null;
      this.netflixAdapter = null;
      this.recentCues = [];

      this.hotkeyController = new SubtitleHotkeyController({
        getVideo: () => this.activeVideo,
        getSyncEngine: () => this.syncEngine,
        onOffsetChanged: (offsetMs) => {
          this.broadcastOffset(offsetMs);
          this.persistOffset(offsetMs);
        }
      });

      this.autoPauseController = new SubtitleAutoPauseController({
        getVideo: () => this.activeVideo,
        getRenderer: () => this.renderer,
        getSyncEngine: () => this.syncEngine
      });

      // Wire up file drag-and-drop
      this.renderer.onFileDropped = async (file) => {
        await this.handleDroppedFile(file);
      };

      // Wire up position persistence on drag end
      this.renderer.onPositionChanged = (pos) => {
        this.persistPosition(pos);
        this.broadcastPosition(pos);
      };

      this._boundMessageHandler = this.handleMessage.bind(this);
    }

    async handleDroppedFile(file) {
      if (!file) return;
      try {
        let text = "";
        if (typeof file.text === "function") {
          text = await file.text();
        } else if (typeof FileReader !== "undefined") {
          text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsText(file);
          });
        }
        const parser = typeof SubtitleParser !== "undefined"
          ? SubtitleParser
          : (typeof globalThis !== "undefined" ? globalThis.SubtitleParser : null);
        if (!parser) return;
        const parsedCues = parser.parseSubtitles(text, file.name);
        const cues = typeof parser.normalizeCues === "function"
          ? parser.normalizeCues(parsedCues)
          : parsedCues;
        if (cues && cues.length > 0) {
          this.syncEngine.setCues(cues);
          this.activeFilename = file.name;
          this.renderer.ensureMounted();
          this.renderer.updatePosition();
          try {
            if (typeof chrome !== "undefined" && chrome.storage?.local) {
              chrome.storage.local.set({
                active_subtitle_cues: cues,
                active_subtitle_filename: file.name
              });
            }
          } catch (_) {}
          try {
            if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({
                type: "SUBTITLE_FILE_LOADED",
                filename: file.name
              }).catch(() => {});
            }
          } catch (_) {}
          this.broadcastActiveCue(this.syncEngine.currentCue);
        }
      } catch (err) {
        console.error("[AnkiMiner Video] Failed to read dropped subtitle file:", err);
      }
    }

    broadcastActiveCue(cue) {
      try {
        if (cue && cue.text) {
          const isSameAsLatest = this.recentCues.length > 0 &&
            this.recentCues[0].text === cue.text &&
            Math.abs((this.recentCues[0].startTime || 0) - (cue.startTime || 0)) < 0.05;
          if (!isSameAsLatest) {
            const cueCopy = {
              startTime: cue.startTime,
              endTime: cue.endTime,
              startMs: typeof cue.startMs === "number" ? cue.startMs : Math.round((cue.startTime || 0) * 1000),
              endMs: typeof cue.endMs === "number" ? cue.endMs : Math.round((cue.endTime || 0) * 1000),
              text: cue.text,
              rawText: cue.rawText || cue.text
            };
            this.recentCues.unshift(cueCopy);
            if (this.recentCues.length > 9) {
              this.recentCues.length = 9;
            }
            if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({
                type: "RECENT_CUES_UPDATED",
                cues: [...this.recentCues]
              }).catch(() => {});
            }
          }
        }
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: "SUBTITLE_CUE_CHANGED",
            cue,
            highlightTerm: (this.renderer && typeof this.renderer.activeHighlightTerm === "string") ? this.renderer.activeHighlightTerm : "",
            offset: this.syncEngine.offset,
            offsetMs: this.syncEngine.offsetMs
          }).catch(() => {});
        }
      } catch (_) {}
    }

    broadcastOffset(offsetMs) {
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: "SUBTITLE_OFFSET_CHANGED",
            offsetMs,
            offset: offsetMs / 1000
          }).catch(() => {});
        }
      } catch (_) {}
      this.broadcastActiveCue(this.syncEngine.currentCue);
    }

    persistOffset(offsetMs) {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.set({ subtitle_timing_offset: offsetMs });
        }
      } catch (_) {}
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("subtitle_timing_offset", String(offsetMs));
        }
      } catch (_) {}
    }

    broadcastPosition(pos) {
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: "SUBTITLE_POSITION_CHANGED",
            position: pos
          }).catch(() => {});
        }
      } catch (_) {}
    }

    persistPosition(pos) {
      if (!pos || typeof pos.relX !== "number" || typeof pos.relY !== "number") return;
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.set({ subtitle_overlay_position: pos });
        }
      } catch (_) {}
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("subtitle_overlay_position", JSON.stringify(pos));
        }
      } catch (_) {}
    }

    setSubtitlesDisplay(enabled) {
      this.subtitlesDisplayEnabled = Boolean(enabled);
      this.renderer.setDisplayEnabled(this.subtitlesDisplayEnabled);
      if (this.ytAdapter && typeof this.ytAdapter.setDisplayEnabled === "function") {
        this.ytAdapter.setDisplayEnabled(this.subtitlesDisplayEnabled);
      }
      if (this.netflixAdapter && typeof this.netflixAdapter.setDisplayEnabled === "function") {
        this.netflixAdapter.setDisplayEnabled(this.subtitlesDisplayEnabled);
      }
      if (this.subtitlesDisplayEnabled && this.syncEngine?.currentCue) {
        this.renderer.renderCue(this.syncEngine.currentCue);
      }
    }

    async captureCurrentFrame(options = {}) {
      if (!this.activeVideo || !this.activeVideo.isConnected) {
        return {
          ok: false,
          error: "NO_ACTIVE_VIDEO",
          message: "No active video element detected"
        };
      }

      const rect = typeof this.activeVideo.getBoundingClientRect === "function"
        ? this.activeVideo.getBoundingClientRect()
        : null;

      if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
        return {
          ok: false,
          error: "INVALID_VIDEO_RECT",
          message: "Video dimensions are 0 or not visible"
        };
      }

      const cropper = typeof ImageCropper !== "undefined"
        ? ImageCropper
        : (typeof window !== "undefined" ? window.ImageCropper : null);

      if (!cropper || typeof cropper.cropVideoFrame !== "function") {
        return {
          ok: false,
          error: "IMAGE_CROPPER_MISSING",
          message: "ImageCropper utility is not loaded"
        };
      }

      const targetTime = (typeof options.targetTime === "number" && Number.isFinite(options.targetTime))
        ? options.targetTime
        : ((typeof options.timestamp === "number" && Number.isFinite(options.timestamp)) ? options.timestamp : null);

      if (targetTime !== null && this.activeVideo.paused && Math.abs(this.activeVideo.currentTime - targetTime) > 0.15) {
        try {
          await new Promise((resolve) => {
            let settled = false;
            const onSeeked = () => {
              if (settled) return;
              settled = true;
              if (this.activeVideo && typeof this.activeVideo.removeEventListener === "function") {
                this.activeVideo.removeEventListener("seeked", onSeeked);
              }
              resolve();
            };
            if (typeof this.activeVideo.addEventListener === "function") {
              this.activeVideo.addEventListener("seeked", onSeeked, { once: true });
            }
            this.activeVideo.currentTime = Math.max(0, targetTime);
            setTimeout(() => {
              if (!settled) {
                settled = true;
                resolve();
              }
            }, 350);
          });
        } catch (_) {}
      }

      // Attempt Tier 1: Direct canvas capture from video element (untainted / local / same-origin)
      if (typeof document !== "undefined" && typeof document.createElement === "function") {
        try {
          const vw = Number.isFinite(this.activeVideo.videoWidth) && this.activeVideo.videoWidth > 0
            ? this.activeVideo.videoWidth
            : (Number.isFinite(this.activeVideo.clientWidth) ? this.activeVideo.clientWidth : 0);
          const vh = Number.isFinite(this.activeVideo.videoHeight) && this.activeVideo.videoHeight > 0
            ? this.activeVideo.videoHeight
            : (Number.isFinite(this.activeVideo.clientHeight) ? this.activeVideo.clientHeight : 0);
          if (vw > 0 && vh > 0) {
            const targetDim = cropper.calculateTargetDimensions(vw, vh, options.maxWidth || 640, options.maxHeight || 360);
            const canvas = typeof options.createCanvas === "function"
              ? options.createCanvas(targetDim.width, targetDim.height)
              : document.createElement("canvas");
            canvas.width = targetDim.width;
            canvas.height = targetDim.height;
            const ctx = (typeof canvas.getContext === "function" && canvas.getContext("2d", { willReadFrequently: true })) || (typeof canvas.getContext === "function" && canvas.getContext("2d"));
            if (ctx) {
              ctx.drawImage(this.activeVideo, 0, 0, canvas.width, canvas.height);
              if (options.checkDrm !== false && typeof cropper.checkBlackFrame === "function" && typeof ctx.getImageData === "function") {
                try {
                  const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                  if (frameData && frameData.data && cropper.checkBlackFrame(frameData.data, canvas.width, canvas.height)) {
                    throw new Error("BLACK_FRAME_DETECTED");
                  }
                } catch (readErr) {
                  // Canvas tainted or black frame -> throw to fall back to Tier 2 captureVisibleTab
                  throw readErr;
                }
              }
              const dataUrl = typeof canvas.toDataURL === "function"
                ? canvas.toDataURL("image/jpeg", options.quality || 0.92)
                : "";
              if (dataUrl && dataUrl.startsWith("data:image/jpeg")) {
                const res = {
                  ok: true,
                  dataUrl,
                  width: canvas.width,
                  height: canvas.height
                };
                if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
                  chrome.runtime.sendMessage({
                    type: "SCREENSHOT_CAPTURED",
                    dataUrl: res.dataUrl,
                    timestamp: this.activeVideo.currentTime,
                    width: res.width,
                    height: res.height,
                    captureId: options.captureId || null
                  }).catch(() => {});
                }
                return res;
              }
            }
          }
        } catch (_) {
          // Cross-origin stream / tainted canvas / black frame -> fall back to captureVisibleTab below
        }
      }

      let bgResponse;
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          bgResponse = await chrome.runtime.sendMessage({
            type: "CAPTURE_VIDEO_FRAME",
            format: options.format || "jpeg",
            quality: options.quality || 95
          });
        }
      } catch (err) {
        return {
          ok: false,
          error: "CAPTURE_REQUEST_FAILED",
          message: err?.message || "Failed to communicate with background service worker"
        };
      }

      if (!bgResponse?.ok || !bgResponse.dataUrl) {
        const failRes = {
          ok: false,
          error: bgResponse?.error || "CAPTURE_FAILED",
          message: bgResponse?.message || "Failed to capture visible tab"
        };
        try {
          if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
              type: "SCREENSHOT_CAPTURE_STATUS",
              ok: false,
              error: failRes.error,
              message: failRes.message,
              captureId: options.captureId || null
            }).catch(() => {});
          }
        } catch (_) {}
        return failRes;
      }

      const dpr = typeof options.devicePixelRatio === "number"
        ? options.devicePixelRatio
        : (typeof window !== "undefined" && window.devicePixelRatio) || 1;

      const cropResult = await cropper.cropVideoFrame(bgResponse.dataUrl, rect, {
        devicePixelRatio: dpr,
        maxWidth: options.maxWidth || 640,
        maxHeight: options.maxHeight || 360,
        quality: options.quality || 0.92,
        checkDrm: options.checkDrm !== false,
        loadImage: options.loadImage,
        createCanvas: options.createCanvas
      });

      if (cropResult.ok) {
        try {
          if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
              type: "SCREENSHOT_CAPTURED",
              dataUrl: cropResult.dataUrl,
              timestamp: this.activeVideo.currentTime,
              width: cropResult.width,
              height: cropResult.height,
              captureId: options.captureId || null
            }).catch(() => {});
          }
        } catch (_) {}
      } else {
        try {
          if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
              type: "SCREENSHOT_CAPTURE_STATUS",
              ok: false,
              error: cropResult.error || "CAPTURE_FAILED",
              message: cropResult.message || "Protected video frame cannot be captured",
              captureId: options.captureId || null
            }).catch(() => {});
          }
        } catch (_) {}
      }

      return cropResult;
    }

    handleMessage(message, _sender, sendResponse) {
      if (message?.type === "TRIGGER_VIDEO_SCREENSHOT") {
        this.captureCurrentFrame(message.options).then(res => {
          sendResponse?.(res);
        }).catch(err => {
          sendResponse?.({ ok: false, error: err?.message || "SCREENSHOT_FAILED" });
        });
        return true;
      }
      if (message?.type === "SEEK_TO") {
        const ms = typeof message.ms === "number"
          ? message.ms
          : (typeof message.time === "number"
            ? message.time * 1000
            : (typeof message.seconds === "number" ? message.seconds * 1000 : null));
        if (ms !== null && !isNaN(ms) && this.activeVideo) {
          this.activeVideo.currentTime = Math.max(0, ms / 1000);
          if (this.syncEngine && typeof this.syncEngine.sync === "function") {
            this.syncEngine.sync(true);
          }
          sendResponse?.({ ok: true, currentTime: this.activeVideo.currentTime });
          return true;
        }
        sendResponse?.({ ok: false, error: "NO_ACTIVE_VIDEO_OR_INVALID_TIME" });
        return true;
      }
      if (message?.type === "GET_RECENT_CUES") {
        sendResponse?.({ ok: true, cues: [...(this.recentCues || [])] });
        return true;
      }
      if (message?.type === "LOAD_SUBTITLE_CUES" && Array.isArray(message.cues)) {
        this.syncEngine.setCues(message.cues);
        if (message.filename) this.activeFilename = message.filename;
        this.recentCues = [];
        this.renderer.ensureMounted();
        this.renderer.updatePosition();
        try {
          if (typeof chrome !== "undefined" && chrome.storage?.local) {
            chrome.storage.local.set({
              active_subtitle_cues: message.cues,
              active_subtitle_filename: message.filename || ""
            });
          }
        } catch (_) {}
        try {
          if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: "RECENT_CUES_UPDATED", cues: [] }).catch(() => {});
          }
        } catch (_) {}
        this.broadcastActiveCue(this.syncEngine.currentCue);
        sendResponse?.({ ok: true, cueCount: message.cues.length });
        return true;
      }
      if (message?.type === "UPDATE_ANNOTATED_CUES") {
        const incomingCues = Array.isArray(message.cues) ? message.cues : (Array.isArray(message.annotatedCues) ? message.annotatedCues : []);
        if (Array.isArray(this.syncEngine.cues) && this.syncEngine.cues.length > 0) {
          for (let i = 0; i < incomingCues.length; i++) {
            const incCue = incomingCues[i];
            if (!incCue) continue;
            let existing = null;
            if (incCue.id !== undefined && incCue.id !== null) {
              existing = this.syncEngine.cues.find((c, idx) => String(c.id ?? idx) === String(incCue.id));
            }
            if (!existing && i < this.syncEngine.cues.length && this.syncEngine.cues[i].text === incCue.text) {
              existing = this.syncEngine.cues[i];
            }
            if (!existing) {
              existing = this.syncEngine.cues.find(c => c.text === incCue.text);
            }
            if (existing && Array.isArray(incCue.tokens)) {
              existing.tokens = incCue.tokens;
            }
          }
        } else if (incomingCues.length > 0) {
          this.syncEngine.setCues(incomingCues);
        }

        if (this.syncEngine.currentCue) {
          const cur = this.syncEngine.currentCue;
          const matching = incomingCues.find(c =>
            (c.id !== undefined && cur.id !== undefined && String(c.id) === String(cur.id)) ||
            (c.text === cur.text)
          );
          if (matching && Array.isArray(matching.tokens)) {
            cur.tokens = matching.tokens;
          }
          this.renderer.renderCue(this.syncEngine.currentCue);
          this.broadcastActiveCue(this.syncEngine.currentCue);
        }

        try {
          if (typeof chrome !== "undefined" && chrome.storage?.local) {
            chrome.storage.local.set({
              active_subtitle_cues: this.syncEngine.cues
            });
          }
        } catch (_) {}

        sendResponse?.({ ok: true, count: incomingCues.length });
        return true;
      }
      if (message?.type === "CLEAR_SUBTITLES") {
        this.syncEngine.setCues([]);
        this.syncEngine.setOffsetMs(0);
        this.persistOffset(0);
        this.activeFilename = "";
        this.recentCues = [];
        try {
          if (typeof chrome !== "undefined" && chrome.storage?.local) {
            chrome.storage.local.remove(["active_subtitle_cues", "active_subtitle_filename"]);
          }
        } catch (_) {}
        try {
          if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: "RECENT_CUES_UPDATED", cues: [] }).catch(() => {});
          }
        } catch (_) {}
        this.renderer.renderCue(null);
        this.broadcastActiveCue(null);
        this.broadcastOffset(0);
        sendResponse?.({ ok: true });
        return true;
      }
      if (message?.type === "HIGHLIGHT_SUBTITLE_WORD" || message?.type === "JAPANESE_TEXT_CAPTURED") {
        if (typeof message.text === "string" && message.text.trim()) {
          this.renderer.activeHighlightTerm = message.text.trim();
          // Orange highlighting strictly belongs to Subtitle History & Side Panel preview, not the live video overlay
        }
        sendResponse?.({ ok: true });
        return true;
      }
      if (message?.type === "SET_SUBTITLE_OFFSET") {
        let offsetMs = 0;
        if (typeof message.offsetMs === "number" && !isNaN(message.offsetMs)) {
          offsetMs = Math.round(message.offsetMs);
        } else if (typeof message.offset === "number" && !isNaN(message.offset)) {
          if (message.unit === "ms") {
            offsetMs = Math.round(message.offset);
          } else {
            offsetMs = Math.round(message.offset * 1000);
          }
        }
        this.syncEngine.setOffsetMs(offsetMs);
        this.persistOffset(offsetMs);
        this.broadcastOffset(offsetMs);
        sendResponse?.({ ok: true, offset: offsetMs / 1000, offsetMs });
        return true;
      }
      if (message?.type === "SET_SUBTITLE_POSITION" && message.position) {
        this.renderer.setPosition(message.position);
        this.persistPosition(message.position);
        this.broadcastPosition(message.position);
        sendResponse?.({ ok: true, position: this.renderer.getPosition() });
        return true;
      }
      if (message?.type === "GET_SUBTITLE_POSITION") {
        sendResponse?.({ ok: true, position: this.renderer.getPosition() });
        return true;
      }
      if (message?.type === "RESET_SUBTITLE_POSITION") {
        this.renderer.resetPosition();
        this.persistPosition(this.renderer.getPosition());
        this.broadcastPosition(this.renderer.getPosition());
        sendResponse?.({ ok: true, position: this.renderer.getPosition() });
        return true;
      }
      if (message?.type === "SET_AUTO_PAUSE_ON_HOVER" && typeof message.enabled === "boolean") {
        this.autoPauseController.setEnabled(message.enabled);
        sendResponse?.({ ok: true, enabled: message.enabled });
        return true;
      }
      if (message?.type === "SET_SUBTITLES_DISPLAY" && typeof message.enabled === "boolean") {
        this.setSubtitlesDisplay(message.enabled);
        sendResponse?.({ ok: true, enabled: message.enabled });
        return true;
      }
      if (message?.type === "GET_SUBTITLES_DISPLAY") {
        sendResponse?.({ ok: true, enabled: this.renderer.displayEnabled !== false });
        return true;
      }
      if (message?.type === "GET_VIDEO_STATE") {
        sendResponse?.({
          ok: true,
          hasVideo: Boolean(this.activeVideo),
          videoState: this.detector.getVideoState(),
          offset: this.syncEngine.offset,
          offsetMs: this.syncEngine.offsetMs,
          cueCount: this.syncEngine.cues.length,
          activeFilename: this.activeFilename,
          autoPauseEnabled: this.autoPauseController.enabled,
          subtitlesDisplayEnabled: this.renderer.displayEnabled !== false,
          subtitlePosition: this.renderer.getPosition(),
          recentCues: [...(this.recentCues || [])]
        });
        return true;
      }
    }

    init() {
      this.detector.start();

      if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener(this._boundMessageHandler);
      }

      this.hotkeyController.attach();

      // Initialize active subtitle cues from storage (supports all frames and HiAnime iframes)
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.get(["active_subtitle_cues", "active_subtitle_filename"], (result) => {
            if (Array.isArray(result?.active_subtitle_cues) && result.active_subtitle_cues.length > 0) {
              this.syncEngine.setCues(result.active_subtitle_cues);
              if (result.active_subtitle_filename) this.activeFilename = result.active_subtitle_filename;
              this.broadcastActiveCue(this.syncEngine.currentCue);
            }
          });
          if (chrome.storage?.onChanged) {
            chrome.storage.onChanged.addListener((changes, areaName) => {
              if (areaName === "local" && changes?.active_subtitle_cues) {
                const newCues = Array.isArray(changes.active_subtitle_cues.newValue)
                  ? changes.active_subtitle_cues.newValue
                  : [];
                this.syncEngine.setCues(newCues);
                if (changes.active_subtitle_filename?.newValue) {
                  this.activeFilename = changes.active_subtitle_filename.newValue;
                } else if (newCues.length === 0) {
                  this.activeFilename = "";
                }
                this.renderer.ensureMounted();
                this.renderer.updatePosition();
                this.broadcastActiveCue(this.syncEngine.currentCue);
              }
            });
          }
        }
      } catch (_) {}

      // Initialize subtitle overlay position from storage
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.get("subtitle_overlay_position", (result) => {
            if (result?.subtitle_overlay_position && typeof result.subtitle_overlay_position.relX === "number" && typeof result.subtitle_overlay_position.relY === "number") {
              this.renderer.setPosition(result.subtitle_overlay_position);
            }
          });
          if (chrome.storage?.onChanged) {
            chrome.storage.onChanged.addListener((changes, areaName) => {
              if (areaName === "local" && changes?.subtitle_overlay_position?.newValue) {
                const newPos = changes.subtitle_overlay_position.newValue;
                if (newPos && typeof newPos.relX === "number" && typeof newPos.relY === "number") {
                  this.renderer.setPosition(newPos);
                }
              }
            });
          }
        } else if (typeof localStorage !== "undefined") {
          const stored = localStorage.getItem("subtitle_overlay_position");
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              if (parsed && typeof parsed.relX === "number" && typeof parsed.relY === "number") {
                this.renderer.setPosition(parsed);
              }
            } catch (_) {}
          }
        }
      } catch (_) {}

      // Initialize subtitle timing offset preference from storage
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.get("subtitle_timing_offset", (result) => {
            if (typeof result?.subtitle_timing_offset === "number" && !isNaN(result.subtitle_timing_offset)) {
              this.syncEngine.setOffsetMs(result.subtitle_timing_offset);
            }
          });
          if (chrome.storage?.onChanged) {
            chrome.storage.onChanged.addListener((changes, areaName) => {
              if (areaName === "local" && changes?.subtitle_timing_offset && typeof changes.subtitle_timing_offset.newValue === "number") {
                this.syncEngine.setOffsetMs(changes.subtitle_timing_offset.newValue);
              }
            });
          }
        } else if (typeof localStorage !== "undefined") {
          const stored = localStorage.getItem("subtitle_timing_offset");
          if (stored !== null) {
            const parsed = parseInt(stored, 10);
            if (!isNaN(parsed)) {
              this.syncEngine.setOffsetMs(parsed);
            }
          }
        }
      } catch (_) {}

      // Initialize auto-pause preference from storage
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.get("auto_pause_on_hover", (result) => {
            if (typeof result?.auto_pause_on_hover === "boolean") {
              this.autoPauseController.setEnabled(result.auto_pause_on_hover);
            }
          });
          if (chrome.storage?.onChanged) {
            chrome.storage.onChanged.addListener((changes, areaName) => {
              if (areaName === "local" && changes?.auto_pause_on_hover) {
                this.autoPauseController.setEnabled(Boolean(changes.auto_pause_on_hover.newValue));
              }
            });
          }
        } else if (typeof localStorage !== "undefined") {
          const stored = localStorage.getItem("auto_pause_on_hover");
          if (stored !== null) {
            this.autoPauseController.setEnabled(stored === "true");
          }
        }
      } catch (_) {}

      // Initialize subtitle display preference from storage (defaults to false)
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.get("subtitles_display_enabled", (result) => {
            if (typeof result?.subtitles_display_enabled === "boolean") {
              this.setSubtitlesDisplay(result.subtitles_display_enabled);
            } else {
              this.setSubtitlesDisplay(false);
            }
          });
          if (chrome.storage?.onChanged) {
            chrome.storage.onChanged.addListener((changes, areaName) => {
              if (areaName === "local" && typeof changes?.subtitles_display_enabled?.newValue === "boolean") {
                this.setSubtitlesDisplay(changes.subtitles_display_enabled.newValue);
              }
            });
          }
        } else if (typeof localStorage !== "undefined") {
          const stored = localStorage.getItem("subtitles_display_enabled");
          if (stored !== null) {
            this.setSubtitlesDisplay(stored === "true");
          } else {
            this.setSubtitlesDisplay(false);
          }
        } else {
          this.setSubtitlesDisplay(false);
        }
      } catch (_) {
        this.setSubtitlesDisplay(false);
      }

      // Check for YouTube adapter
      const ytMod = typeof YouTubeAdapter !== "undefined"
        ? YouTubeAdapter
        : (typeof window !== "undefined" ? window.YouTubeAdapter : null);
      if (ytMod && typeof ytMod.YouTubeAdapter === "function" && ytMod.isYouTubePage()) {
        this.ytAdapter = new ytMod.YouTubeAdapter({
          onCuesLoaded: (cues, track) => {
            this.syncEngine.setCues(cues);
            this.activeFilename = `YouTube CC (${track.name || track.languageCode})`;
            try {
              if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({
                  type: "SUBTITLE_FILE_LOADED",
                  filename: this.activeFilename
                }).catch(() => {});
              }
            } catch (_) {}
            this.broadcastActiveCue(this.syncEngine.currentCue);
          }
        });
        this.ytAdapter.setDisplayEnabled(this.subtitlesDisplayEnabled);
        this.ytAdapter.init();
      }

      // Check for Netflix adapter
      const nfMod = typeof NetflixAdapter !== "undefined"
        ? NetflixAdapter
        : (typeof window !== "undefined" ? window.NetflixAdapter : null);
      if (nfMod && typeof nfMod.NetflixAdapter === "function" && nfMod.isNetflixPage()) {
        this.netflixAdapter = new nfMod.NetflixAdapter({
          video: this.activeVideo,
          onCue: (cue) => {
            if (cue) {
              this.activeFilename = "Netflix Subtitles (Live)";
              this.renderer.renderCue(cue);
              this.broadcastActiveCue(cue);
            } else {
              this.renderer.renderCue(null);
              this.broadcastActiveCue(null);
            }
          }
        });
        this.netflixAdapter.setDisplayEnabled(this.subtitlesDisplayEnabled);
        this.netflixAdapter.init();
      }

      console.log("[AnkiMiner Video POC] Initialized in frame:", typeof window !== "undefined" ? window.location?.href : "");
    }

    onVideoDetected(video) {
      this.activeVideo = video;
      this.autoPauseController.attachVideo(video);
      if (this.netflixAdapter && typeof this.netflixAdapter.setVideo === "function") {
        this.netflixAdapter.setVideo(video);
      }
      if (video) {
        console.log("[AnkiMiner Video POC] Primary video detected:", video);
        try {
          const trackReport = inspectNativeTextTracks(video);
          console.log("[AnkiMiner Video POC] Native TextTracks report:", trackReport);
        } catch {}
        this.renderer.mount(video);
        this.autoPauseController.attachOverlay(this.renderer.subtitleEl);
        this.syncEngine.attach(video);
      } else {
        console.log("[AnkiMiner Video POC] No active video present.");
        this.autoPauseController.detachOverlay();
        this.autoPauseController.detachVideo();
        this.syncEngine.detach();
        this.renderer.unmount();
      }
    }

    destroy() {
      if (this.hotkeyController) {
        this.hotkeyController.detach();
      }
      if (this.autoPauseController) {
        this.autoPauseController.detachOverlay();
        this.autoPauseController.detachVideo();
      }
      if (this.ytAdapter && typeof this.ytAdapter.destroy === "function") {
        this.ytAdapter.destroy();
        this.ytAdapter = null;
      }
      if (this.netflixAdapter && typeof this.netflixAdapter.destroy === "function") {
        this.netflixAdapter.destroy();
        this.netflixAdapter = null;
      }
      this.detector.stop();
      this.syncEngine.detach();
      this.renderer.unmount();
      this.recentCues = [];
      this.activeVideo = null;
    }
  }

  // Instantiate and expose for testability/debugging
  const pocInstance = new VideoMiningPOC();
  pocInstance.init();

  const pocExport = {
    instance: pocInstance,
    VideoMiningPOC,
    VideoDetector,
    SubtitleSynchronizer,
    SubtitleOverlayRenderer,
    SubtitleHotkeyController,
    SubtitleAutoPauseController,
    ImageCropper: typeof ImageCropper !== "undefined" ? ImageCropper : (typeof window !== "undefined" ? window.ImageCropper : null),
    isEditableTarget,
    isNetflixPlatform,
    inspectNativeTextTracks
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = pocExport;
  }

  window.__KIROKU_VIDEO_POC__ = pocExport;
  window.__ANKIMINER_VIDEO_POC__ = pocExport;
  window.__kirokuVideo = {
    getVideo: () => pocInstance.activeVideo || null,
    getInstance: () => pocInstance
  };
})();
