
  class SubtitleOverlayRenderer {
    constructor() {
      this.container = null;
      this.boxEl = null;
      this.handleEl = null;
      this.subtitleEl = null;
      this.video = null;
      this.resizeObserver = null;
      this.onFileDropped = null;
      this.onPositionChanged = null;
      this.isHoverLocked = false;
      this.displayEnabled = false;
      this.activeHighlightTerm = "";
      this.currentCue = null;
      this.pendingCue = undefined;
      this.position = { relX: 0.5, relY: 0.78 };
      this.isDragging = false;
      this._dragStartX = 0;
      this._dragStartY = 0;
      this._initialClampedLeft = 0;
      this._initialClampedTop = 0;
      this._hoverWordTimer = null;
      this._lastHoverWord = "";
      this._rafPositionId = null;
      this._fsTimer = null;
      this._lastBaseSize = null;
      this._lastRelLeft = null;
      this._lastRelTop = null;
      this._lastAbsLeft = null;
      this._lastAbsTop = null;
      this._lastPositionMode = null;
      this._boundUpdatePosition = this.updatePosition.bind(this);
      this._boundScheduleUpdatePosition = this.scheduleUpdatePosition.bind(this);
      this._boundFullscreenChange = this._onFullscreenChange.bind(this);

      this._boundSubtitleMouseEnter = () => {
        this.setHoverLocked(true);
      };
      this._boundSubtitleMouseLeave = () => {
        if (!this.isDragging) {
          this.setHoverLocked(false);
        }
      };
      this._boundSubtitleMouseMove = () => {
        if (this.isDragging) return;
        this.setHoverLocked(true);
      };

      this._boundSubtitleMouseDown = (e) => {
        if (typeof e?.stopPropagation === "function") {
          e.stopPropagation();
        }
      };

      this._boundSubtitleMouseUp = (e) => {
        if (typeof e?.stopPropagation === "function") {
          e.stopPropagation();
        }
        if (this.isDragging) return;
        if (typeof window !== "undefined" && window.getSelection) {
          const sel = window.getSelection();
          const selText = sel ? sel.toString().trim() : "";
          if (selText && selText.length > 0) {
            this.activeHighlightTerm = selText;
            try {
              if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({
                  type: "JAPANESE_TEXT_CAPTURED",
                  text: selText,
                  source: "subtitle_selection",
                  sourceType: "video",
                  cue: this.currentCue ? { ...this.currentCue } : null,
                }).catch(() => {});
                chrome.runtime.sendMessage({
                  type: "HIGHLIGHT_SUBTITLE_WORD",
                  text: selText
                }).catch(() => {});
              }
            } catch (_) {}
          }
        }
      };

      this._boundSubtitleClick = (e) => {
        if (typeof e?.stopPropagation === "function") {
          e.stopPropagation();
        }
        if (this.isDragging) return;
        if (typeof window !== "undefined" && window.getSelection) {
          const sel = window.getSelection();
          const selText = sel ? sel.toString().trim() : "";
          if (selText && selText.length > 0) return;
        }

        const extractWordFn = (typeof window !== "undefined" && typeof window.extractJapaneseWordAtPosition === "function")
          ? window.extractJapaneseWordAtPosition
          : (typeof extractJapaneseWordAtPosition === "function" ? extractJapaneseWordAtPosition : null);
        const clientX = typeof e?.clientX === "number" ? e.clientX : 0;
        const clientY = typeof e?.clientY === "number" ? e.clientY : 0;
        let word = null;
        if (e?.target && typeof e.target.getAttribute === "function" && e.target.getAttribute("data-surface")) {
          word = e.target.getAttribute("data-surface");
        } else if (extractWordFn) {
          word = extractWordFn(this.subtitleEl, clientX, clientY);
        } else if (e?.target && e.target !== this.subtitleEl && e.target !== this.boxEl && e.target.textContent) {
          word = e.target.textContent.trim();
        }
        if (word) {
          this.activeHighlightTerm = word;
          try {
            if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({
                type: "JAPANESE_TEXT_CAPTURED",
                text: word,
                source: "subtitle_click",
                sourceType: "video",
                cue: this.currentCue ? { ...this.currentCue } : null,
              }).catch(() => {});
              chrome.runtime.sendMessage({
                type: "HIGHLIGHT_SUBTITLE_WORD",
                text: word
              }).catch(() => {});
            }
          } catch (_) {}
        }
      };

      this._boundHandlePointerDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return; // Left button only
        if (!this.video || !this.container) return;

        const vRect = typeof this.video.getBoundingClientRect === "function"
          ? this.video.getBoundingClientRect()
          : { left: 0, top: 0, width: 800, height: 450 };
        if (vRect.width <= 0 || vRect.height <= 0) return;

        const boxRect = (this.boxEl && typeof this.boxEl.getBoundingClientRect === "function")
          ? this.boxEl.getBoundingClientRect()
          : (typeof this.container.getBoundingClientRect === "function" ? this.container.getBoundingClientRect() : null);
        const boxWidth = (boxRect && Number.isFinite(boxRect.width) && boxRect.width > 0 && boxRect.width < vRect.width)
          ? boxRect.width
          : Math.min(vRect.width * 0.8, 200);
        const boxHeight = (boxRect && Number.isFinite(boxRect.height) && boxRect.height > 0 && boxRect.height < vRect.height)
          ? boxRect.height
          : Math.max(30, Math.round(vRect.height * 0.08));

        this.isDragging = true;
        this._dragStartX = typeof e.clientX === "number" ? e.clientX : 0;
        this._dragStartY = typeof e.clientY === "number" ? e.clientY : 0;
        if (e.type === "pointerdown" && Number.isFinite(e.pointerId) && this.handleEl?.setPointerCapture) {
          try { this.handleEl.setPointerCapture(e.pointerId); } catch (_) {}
        }

        const relX = (typeof this.position?.relX === "number" && !isNaN(this.position.relX)) ? this.position.relX : 0.5;
        const relY = (typeof this.position?.relY === "number" && !isNaN(this.position.relY)) ? this.position.relY : 0.78;
        const desiredLeftInVideo = (relX * vRect.width) - (boxWidth / 2);
        const desiredTopInVideo = relY * vRect.height;
        const maxLeft = Math.max(0, vRect.width - boxWidth);
        const maxTop = Math.max(0, vRect.height - boxHeight);

        this._initialClampedLeft = Math.max(0, Math.min(maxLeft, desiredLeftInVideo));
        this._initialClampedTop = Math.max(0, Math.min(maxTop, desiredTopInVideo));

        this.setHoverLocked(true);

        if (this.handleEl) {
          setStyleProperty(this.handleEl, "cursor", "grabbing", "important");
          setStyleProperty(this.handleEl, "color", "#cc785c", "important");
        }

        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
          window.addEventListener("pointermove", this._boundHandlePointerMove, true);
          window.addEventListener("pointerup", this._boundHandlePointerUp, true);
          window.addEventListener("pointercancel", this._boundHandlePointerUp, true);
          window.addEventListener("mousemove", this._boundHandlePointerMove, true);
          window.addEventListener("mouseup", this._boundHandlePointerUp, true);
        }

        if (typeof e.preventDefault === "function") {
          e.preventDefault();
        }
        if (typeof e.stopPropagation === "function") {
          e.stopPropagation();
        }
      };

      this._boundHandlePointerMove = (e) => {
        if (!this.isDragging || !this.video || !this.container) return;

        const vRect = typeof this.video.getBoundingClientRect === "function"
          ? this.video.getBoundingClientRect()
          : { left: 0, top: 0, width: 800, height: 450 };
        if (vRect.width <= 0 || vRect.height <= 0) return;

        const boxRect = (this.boxEl && typeof this.boxEl.getBoundingClientRect === "function")
          ? this.boxEl.getBoundingClientRect()
          : (typeof this.container.getBoundingClientRect === "function" ? this.container.getBoundingClientRect() : null);
        const boxWidth = (boxRect && Number.isFinite(boxRect.width) && boxRect.width > 0 && boxRect.width < vRect.width)
          ? boxRect.width
          : Math.min(vRect.width * 0.8, 200);
        const boxHeight = (boxRect && Number.isFinite(boxRect.height) && boxRect.height > 0 && boxRect.height < vRect.height)
          ? boxRect.height
          : Math.max(30, Math.round(vRect.height * 0.08));

        const clientX = typeof e.clientX === "number" ? e.clientX : this._dragStartX;
        const clientY = typeof e.clientY === "number" ? e.clientY : this._dragStartY;

        const dx = clientX - this._dragStartX;
        const dy = clientY - this._dragStartY;

        const newLeftInVideo = this._initialClampedLeft + dx;
        const newTopInVideo = this._initialClampedTop + dy;

        const maxLeft = Math.max(0, vRect.width - boxWidth);
        const maxTop = Math.max(0, vRect.height - boxHeight);
        const clampedLeft = Math.max(0, Math.min(maxLeft, newLeftInVideo));
        const clampedTop = Math.max(0, Math.min(maxTop, newTopInVideo));

        const newRelX = vRect.width > 0 ? Math.max(0, Math.min(1.0, (clampedLeft + boxWidth / 2) / vRect.width)) : 0.5;
        const newRelY = vRect.height > 0 ? Math.max(0, Math.min(1.0, clampedTop / vRect.height)) : 0.78;

        this.position = { relX: newRelX, relY: newRelY };
        this.updatePosition();
      };

      this._boundHandlePointerUp = (e) => {
        if (!this.isDragging) return;
        this.isDragging = false;

        if (this.handleEl) {
          setStyleProperty(this.handleEl, "cursor", "grab", "important");
          setStyleProperty(this.handleEl, "color", "rgba(255, 255, 255, 0.5)", "important");
        }

        if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
          window.removeEventListener("pointermove", this._boundHandlePointerMove, true);
          window.removeEventListener("pointerup", this._boundHandlePointerUp, true);
          window.removeEventListener("pointercancel", this._boundHandlePointerUp, true);
          window.removeEventListener("mousemove", this._boundHandlePointerMove, true);
          window.removeEventListener("mouseup", this._boundHandlePointerUp, true);
        }

        this.setHoverLocked(false);

        if (typeof this.onPositionChanged === "function") {
          this.onPositionChanged(this.position);
        }
      };

      this._boundDragOver = (e) => {
        e.preventDefault();
        if (this.boxEl) {
          this.boxEl.style.borderColor = "#cc785c";
        }
      };
      this._boundDragLeave = () => {
        if (this.boxEl) {
          this.boxEl.style.borderColor = "rgba(255, 255, 255, 0.2)";
        }
      };
      this._boundDrop = (e) => {
        e.preventDefault();
        if (this.boxEl) {
          this.boxEl.style.borderColor = "rgba(255, 255, 255, 0.2)";
        }
        const file = e.dataTransfer?.files?.[0];
        if (file && typeof this.onFileDropped === "function") {
          this.onFileDropped(file);
        }
      };
    }

    setPosition(pos) {
      if (!pos) return;
      const relX = typeof pos.relX === "number" && !isNaN(pos.relX) ? Math.max(0, Math.min(1.0, pos.relX)) : 0.5;
      const relY = typeof pos.relY === "number" && !isNaN(pos.relY) ? Math.max(0, Math.min(1.0, pos.relY)) : 0.78;
      this.position = { relX, relY };
      this.updatePosition();
    }

    getPosition() {
      return { ...this.position };
    }

    resetPosition() {
      this.position = { relX: 0.5, relY: 0.78 };
      this.updatePosition();
    }

    getTargetContainer() {
      if (!this.video) return (typeof document !== "undefined" ? document.body : null);
      const fsEl = getFullscreenElement();
      if (fsEl) {
        // Fullscreen container containing the video (HiAnime, YouTube, Netflix player wrappers)
        if (fsEl !== this.video && typeof fsEl.contains === "function" && fsEl.contains(this.video)) {
          return fsEl;
        }
        // Native video element fullscreened directly
        if (fsEl === this.video) {
          return this.video.parentElement || (typeof document !== "undefined" ? document.body : null);
        }
        return fsEl;
      }
      // Windowed mode: Find player container wrapper if present, else video.parentElement
      const playerWrapper = (this.video.closest && this.video.closest(".jwplayer, #player, .video-js, [class*='player'], .art-video-player, #megacloud-player, .html5-video-player, .watch-video")) || this.video.parentElement;
      return playerWrapper || (typeof document !== "undefined" ? document.body : null);
    }

    ensureStylesMounted() {
      if (typeof document === "undefined") return;
      let styleEl = document.getElementById("ankiminer-video-overlay-styles");
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "ankiminer-video-overlay-styles";
        styleEl.textContent = [
          ".video-sub-token {",
          "  display: inline !important;",
          "  background: transparent !important;",
          "  margin: 0 !important;",
          "  padding: 0 !important;",
          "  cursor: text !important;",
          "  user-select: text !important;",
          "  -webkit-user-select: text !important;",
          "  transition: color 0.15s ease, text-decoration-color 0.15s ease !important;",
          "}",
          ".video-sub-token.mined {",
          "  color: #d4884f !important;",
          "  text-decoration: underline !important;",
          "  text-decoration-color: rgba(212, 136, 79, 0.45) !important;",
          "  text-underline-offset: 3px !important;",
          "  text-decoration-thickness: 1.5px !important;",
          "}",
          ".video-sub-token.should-know {",
          "  color: #5db872 !important;",
          "  text-decoration: underline !important;",
          "  text-decoration-color: rgba(93, 184, 114, 0.45) !important;",
          "  text-underline-offset: 3px !important;",
          "  text-decoration-thickness: 1.5px !important;",
          "}",
          ".video-sub-token.unstyled {",
          "  color: inherit !important;",
          "  text-decoration: none !important;",
          "}"
        ].join("\n");

        const target = document.head || document.documentElement || document.body;
        if (target) {
          target.appendChild(styleEl);
        }
      }
    }

    ensureMounted() {
      this.ensureStylesMounted();
      if (!this.container || !this.video) return;
      const target = this.getTargetContainer();
      if (!target) return;
      if (!this.container.isConnected || this.container.parentElement !== target) {
        target.appendChild(this.container);
      }
    }

    mount(video) {
      this.unmount();
      if (!video) return;
      this.video = video;
      this.ensureStylesMounted();

      // Ensure container element exists
      let container = document.getElementById("ankiminer-video-overlay-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "ankiminer-video-overlay-container";
        container.className = "ankiminer-video-overlay-container";
        
        container.style.cssText = [
          "position: fixed !important",
          "display: none !important",
          "visibility: hidden !important",
          "opacity: 0 !important",
          "pointer-events: none !important",
          "z-index: 2147483647 !important",
          "box-sizing: border-box !important",
          "margin: 0 !important",
          "padding: 0 !important",
          "transition: opacity 0.15s ease !important"
        ].join("; ");

        const box = document.createElement("div");
        box.id = "ankiminer-video-subtitle-box";
        box.className = "ankiminer-video-subtitle-box";
        box.style.cssText = [
          "display: inline-flex !important",
          "flex-direction: row !important",
          "align-items: center !important",
          "position: relative !important",
          "pointer-events: auto !important",
          "background: rgba(18, 17, 15, 0.92) !important",
          "padding: 4px 12px 4px 8px !important",
          "border-radius: 6px !important",
          "border: 1px solid rgba(255, 255, 255, 0.2) !important",
          "box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6) !important",
          "box-sizing: border-box !important",
          "max-width: 100% !important",
          "gap: 6px !important",
          "user-select: text !important",
          "-webkit-user-select: text !important"
        ].join("; ");

        const handle = document.createElement("div");
        handle.id = "ankiminer-video-subtitle-handle";
        handle.className = "ankiminer-video-subtitle-handle";
        handle.title = "Drag to reposition subtitles";
        handle.setAttribute("aria-label", "Drag subtitle overlay");
        handle.style.cssText = [
          "display: flex !important",
          "align-items: center !important",
          "justify-content: center !important",
          "cursor: grab !important",
          "color: rgba(255, 255, 255, 0.5) !important",
          "padding: 2px 4px !important",
          "border-radius: 3px !important",
          "user-select: none !important",
          "-webkit-user-select: none !important",
          "touch-action: none !important",
          "flex-shrink: 0 !important",
          "transition: color 0.15s ease, opacity 0.15s ease !important"
        ].join("; ");

        if (typeof document.createElementNS === "function") {
          try {
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("width", "10");
            svg.setAttribute("height", "14");
            svg.setAttribute("viewBox", "0 0 10 14");
            svg.setAttribute("fill", "none");
            svg.style.cssText = "display: block; pointer-events: none;";
            const circles = [
              [3, 3], [7, 3],
              [3, 7], [7, 7],
              [3, 11], [7, 11]
            ];
            circles.forEach(([cx, cy]) => {
              const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
              circle.setAttribute("cx", String(cx));
              circle.setAttribute("cy", String(cy));
              circle.setAttribute("r", "1.2");
              circle.setAttribute("fill", "currentColor");
              svg.appendChild(circle);
            });
            handle.appendChild(svg);
          } catch (_) {
            handle.textContent = "⋮⋮";
          }
        } else {
          handle.textContent = "⋮⋮";
        }

        const span = document.createElement("span");
        span.id = "ankiminer-video-subtitle";
        span.className = "ankiminer-video-subtitle";
        span.style.cssText = [
          "display: none !important",
          "user-select: text !important",
          "-webkit-user-select: text !important",
          "pointer-events: auto !important",
          "cursor: text !important",
          "color: #ffffff !important",
          "background: transparent !important",
          "border: none !important",
          "padding: 0 !important",
          "font-family: 'Noto Sans JP', 'Noto Serif JP', -apple-system, BlinkMacSystemFont, 'Segoe UI', Meiryo, sans-serif !important",
          "font-size: 24px !important",
          "font-weight: 500 !important",
          "line-height: 1.4 !important",
          "text-shadow: 0 2px 4px rgba(0, 0, 0, 0.9) !important",
          "word-break: break-word !important",
          "white-space: pre-wrap !important"
        ].join("; ");

        box.appendChild(handle);
        box.appendChild(span);
        container.appendChild(box);

        this.container = container;
        this.boxEl = box;
        this.handleEl = handle;
        this.subtitleEl = span;
      } else {
        this.container = container;
        this.boxEl = container.querySelector("#ankiminer-video-subtitle-box") || container;
        this.handleEl = container.querySelector("#ankiminer-video-subtitle-handle");
        this.subtitleEl = container.querySelector("#ankiminer-video-subtitle");
        if (!this.handleEl && this.subtitleEl) {
          const box = document.createElement("div");
          box.id = "ankiminer-video-subtitle-box";
          box.className = "ankiminer-video-subtitle-box";
          const handle = document.createElement("div");
          handle.id = "ankiminer-video-subtitle-handle";
          handle.className = "ankiminer-video-subtitle-handle";
          handle.title = "Drag to reposition subtitles";
          handle.setAttribute("aria-label", "Drag subtitle overlay");
          if (this.subtitleEl.parentElement) {
            this.subtitleEl.parentElement.insertBefore(box, this.subtitleEl);
          }
          box.appendChild(handle);
          box.appendChild(this.subtitleEl);
          this.boxEl = box;
          this.handleEl = handle;
        }
      }

      this.ensureMounted();

      // Attach subtitle hover-lock and word detection listeners
      if (this.subtitleEl && typeof this.subtitleEl.addEventListener === "function") {
        this.subtitleEl.addEventListener("mouseenter", this._boundSubtitleMouseEnter);
        this.subtitleEl.addEventListener("mouseleave", this._boundSubtitleMouseLeave);
        this.subtitleEl.addEventListener("mousemove", this._boundSubtitleMouseMove);
        this.subtitleEl.addEventListener("mousedown", this._boundSubtitleMouseDown);
        this.subtitleEl.addEventListener("mouseup", this._boundSubtitleMouseUp);
        this.subtitleEl.addEventListener("click", this._boundSubtitleClick);
      }
      if (this.boxEl && typeof this.boxEl.addEventListener === "function") {
        this.boxEl.addEventListener("mousedown", this._boundSubtitleMouseDown);
        this.boxEl.addEventListener("mouseup", this._boundSubtitleMouseUp);
        this.boxEl.addEventListener("click", this._boundSubtitleClick);
      }

      // Attach handle dragging listeners
      if (this.handleEl && typeof this.handleEl.addEventListener === "function") {
        this.handleEl.addEventListener("pointerdown", this._boundHandlePointerDown);
        this.handleEl.addEventListener("mousedown", this._boundHandlePointerDown);
      }

      // Attach drag and drop listeners
      if (this.container && typeof this.container.addEventListener === "function") {
        this.container.addEventListener("dragover", this._boundDragOver);
        this.container.addEventListener("dragleave", this._boundDragLeave);
        this.container.addEventListener("drop", this._boundDrop);
      }
      if (this.video && typeof this.video.addEventListener === "function") {
        this.video.addEventListener("dragover", this._boundDragOver);
        this.video.addEventListener("dragleave", this._boundDragLeave);
        this.video.addEventListener("drop", this._boundDrop);
        this.video.addEventListener("resize", this._boundScheduleUpdatePosition);
        this.video.addEventListener("loadedmetadata", this._boundScheduleUpdatePosition);
        this.video.addEventListener("loadeddata", this._boundScheduleUpdatePosition);
        this.video.addEventListener("canplay", this._boundScheduleUpdatePosition);
        this.video.addEventListener("play", this._boundScheduleUpdatePosition);
        this.video.addEventListener("seeked", this._boundScheduleUpdatePosition);
      }

      this.updatePosition();

      // Listen for resizing, scroll, and fullscreen changes
      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => this.scheduleUpdatePosition());
        this.resizeObserver.observe(video);
      }
      window.addEventListener("resize", this._boundScheduleUpdatePosition);
      window.addEventListener("scroll", this._boundScheduleUpdatePosition, { passive: true });
      document.addEventListener("fullscreenchange", this._boundFullscreenChange);
      document.addEventListener("webkitfullscreenchange", this._boundFullscreenChange);
      document.addEventListener("mozfullscreenchange", this._boundFullscreenChange);
      document.addEventListener("MSFullscreenChange", this._boundFullscreenChange);
    }

    _onFullscreenChange() {
      this.ensureMounted();
      this.updatePosition();
      if (this.currentCue) {
        this.renderCue(this.currentCue);
      }
      if (this._fsTimer) clearTimeout(this._fsTimer);
      this._fsTimer = setTimeout(() => {
        this.ensureMounted();
        this.updatePosition();
        if (this.currentCue) {
          this.renderCue(this.currentCue);
        }
      }, 80);
    }

    syncNativeTextTrack(cue) {
      if (!this.video || typeof this.video.addTextTrack !== "function") return;
      const fsEl = getFullscreenElement();
      const isDirectVideoFs = Boolean(fsEl && fsEl === this.video);

      if (!isDirectVideoFs) {
        if (this._fallbackTrack) {
          try { this._fallbackTrack.mode = "disabled"; } catch (_) {}
        }
        return;
      }

      try {
        if (!this._fallbackTrack) {
          this._fallbackTrack = this.video.addTextTrack("subtitles", "Kiroku Note", "ja");
        }
        this._fallbackTrack.mode = "showing";
        if (this._fallbackTrack.cues) {
          const cues = Array.from(this._fallbackTrack.cues);
          cues.forEach(c => {
            try { this._fallbackTrack.removeCue(c); } catch (_) {}
          });
        }
        if (cue && cue.text && typeof VTTCue !== "undefined") {
          const start = Math.max(0, this.video.currentTime - 0.2);
          const end = this.video.currentTime + 10.0;
          const vttCue = new VTTCue(start, end, cue.text);
          this._fallbackTrack.addCue(vttCue);
        }
      } catch (_) {}
    }

    scheduleUpdatePosition() {
      if (this._rafPositionId !== null) return;
      if (typeof requestAnimationFrame === "function") {
        this._rafPositionId = requestAnimationFrame(() => {
          this._rafPositionId = null;
          this.updatePosition();
        });
      } else {
        this.updatePosition();
      }
    }

    updatePosition() {
      if (!this.container || !this.video) return;

      this.ensureMounted();

      const vRect = typeof this.video.getBoundingClientRect === "function"
        ? this.video.getBoundingClientRect()
        : { top: 0, left: 0, width: 0, height: 0 };

      if (vRect.width <= 0 || vRect.height <= 0) return;

      const target = this.container.parentElement;
      const isBodyTarget = !target || target === document.body || target === document.documentElement;

      if (this.subtitleEl) {
        const baseSize = Math.max(16, Math.min(38, Math.round(vRect.height * 0.045)));
        if (this._lastBaseSize !== baseSize) {
          this._lastBaseSize = baseSize;
          setStyleProperty(this.subtitleEl, "fontSize", `${baseSize}px`, "important");
          setStyleProperty(this.subtitleEl, "font-size", `${baseSize}px`, "important");
        }
      }

      const boxRect = (this.boxEl && typeof this.boxEl.getBoundingClientRect === "function")
        ? this.boxEl.getBoundingClientRect()
        : (typeof this.container.getBoundingClientRect === "function" ? this.container.getBoundingClientRect() : null);
      const boxWidth = (boxRect && Number.isFinite(boxRect.width) && boxRect.width > 0 && boxRect.width < vRect.width)
        ? boxRect.width
        : Math.min(vRect.width * 0.8, 200);
      const boxHeight = (boxRect && Number.isFinite(boxRect.height) && boxRect.height > 0 && boxRect.height < vRect.height)
        ? boxRect.height
        : Math.max(30, Math.round(vRect.height * 0.08));

      const relX = (typeof this.position?.relX === "number" && !isNaN(this.position.relX)) ? this.position.relX : 0.5;
      const relY = (typeof this.position?.relY === "number" && !isNaN(this.position.relY)) ? this.position.relY : 0.78;

      const desiredLeftInVideo = (relX * vRect.width) - (boxWidth / 2);
      const desiredTopInVideo = relY * vRect.height;

      const maxLeft = Math.max(0, vRect.width - boxWidth);
      const maxTop = Math.max(0, vRect.height - boxHeight);

      const clampedLeftInVideo = Math.max(0, Math.min(maxLeft, desiredLeftInVideo));
      const clampedTopInVideo = Math.max(0, Math.min(maxTop, desiredTopInVideo));

      if (!isBodyTarget) {
        // Ensure non-body target establishes a containing block
        const targetPos = typeof getComputedStyle === "function"
          ? getComputedStyle(target).position
          : (target.style ? target.style.position : "");
        if (!targetPos || targetPos === "static") {
          setStyleProperty(target, "position", "relative");
        }

        const tRect = typeof target.getBoundingClientRect === "function"
          ? target.getBoundingClientRect()
          : { top: 0, left: 0, width: vRect.width, height: vRect.height };

        const relLeft = Math.round(vRect.left - tRect.left + clampedLeftInVideo);
        const relTop = Math.round(vRect.top - tRect.top + clampedTopInVideo);

        if (this._lastRelLeft !== relLeft || this._lastRelTop !== relTop || this._lastPositionMode !== "absolute") {
          this._lastRelLeft = relLeft;
          this._lastRelTop = relTop;
          this._lastPositionMode = "absolute";
          setStyleProperty(this.container, "position", "absolute", "important");
          setStyleProperty(this.container, "top", `${relTop}px`, "important");
          setStyleProperty(this.container, "left", `${relLeft}px`, "important");
          setStyleProperty(this.container, "width", "auto", "important");
          setStyleProperty(this.container, "bottom", "auto", "important");
          setStyleProperty(this.container, "height", "auto", "important");
          setStyleProperty(this.container, "z-index", "2147483647", "important");
        }
      } else {
        const absLeft = Math.round(vRect.left + clampedLeftInVideo);
        const absTop = Math.round(vRect.top + clampedTopInVideo);

        if (this._lastAbsLeft !== absLeft || this._lastAbsTop !== absTop || this._lastPositionMode !== "fixed") {
          this._lastAbsLeft = absLeft;
          this._lastAbsTop = absTop;
          this._lastPositionMode = "fixed";
          setStyleProperty(this.container, "position", "fixed", "important");
          setStyleProperty(this.container, "top", `${absTop}px`, "important");
          setStyleProperty(this.container, "left", `${absLeft}px`, "important");
          setStyleProperty(this.container, "width", "auto", "important");
          setStyleProperty(this.container, "bottom", "auto", "important");
          setStyleProperty(this.container, "height", "auto", "important");
          setStyleProperty(this.container, "z-index", "2147483647", "important");
        }
      }
    }

    setHoverLocked(locked) {
      this.isHoverLocked = Boolean(locked);
      if (!this.isHoverLocked && this.pendingCue !== undefined) {
        const cue = this.pendingCue;
        this.pendingCue = undefined;
        this.renderCue(cue);
      }
    }

    setDisplayEnabled(enabled) {
      this.displayEnabled = Boolean(enabled);
      if (!this.displayEnabled) {
        if (this.subtitleEl) {
          this.subtitleEl.textContent = "";
          setStyleProperty(this.subtitleEl, "display", "none", "important");
        }
        if (this.container) {
          setStyleProperty(this.container, "opacity", "0", "important");
          setStyleProperty(this.container, "visibility", "hidden", "important");
          setStyleProperty(this.container, "display", "none", "important");
          setStyleProperty(this.container, "pointer-events", "none", "important");
          this.container.removeAttribute("data-active-cue");
        }
      } else {
        if (this.container) {
          setStyleProperty(this.container, "display", "flex", "important");
        }
        if (this.currentCue && this.currentCue.text) {
          this.renderCue(this.currentCue);
        } else {
          this.renderCue(null);
        }
      }
    }

    _renderTokens(tokens) {
      if (!this.subtitleEl) return;
      if (typeof this.subtitleEl.replaceChildren === "function") {
        this.subtitleEl.replaceChildren();
      } else {
        while (this.subtitleEl.firstChild) {
          this.subtitleEl.removeChild(this.subtitleEl.firstChild);
        }
        this.subtitleEl.textContent = "";
      }

      for (const token of tokens) {
        if (!token) continue;
        const span = document.createElement("span");
        const rawStatus = token.status || "unstyled";
        const normalizedStatus = rawStatus === "should_know" ? "should-know" : rawStatus;
        const statusClass = rawStatus === normalizedStatus ? rawStatus : `${normalizedStatus} ${rawStatus}`;
        span.className = `video-sub-token ${statusClass}`;
        span.setAttribute("data-surface", token.surface || token.text || "");
        span.setAttribute("data-lemma", token.lemma || "");
        span.setAttribute("data-status", rawStatus);
        if (token.reading) span.setAttribute("data-reading", token.reading);
        if (token.jlpt_level) span.setAttribute("data-jlpt-level", token.jlpt_level);

        span.textContent = token.surface || token.text || "";

        setStyleProperty(span, "display", "inline", "important");
        setStyleProperty(span, "background", "transparent", "important");
        setStyleProperty(span, "margin", "0", "important");
        setStyleProperty(span, "padding", "0", "important");
        setStyleProperty(span, "cursor", "text", "important");
        setStyleProperty(span, "user-select", "text", "important");
        setStyleProperty(span, "-webkit-user-select", "text", "important");

        if (normalizedStatus === "mined") {
          setStyleProperty(span, "color", "#d4884f", "important");
          setStyleProperty(span, "text-decoration", "underline", "important");
          setStyleProperty(span, "text-decoration-color", "rgba(212, 136, 79, 0.45)", "important");
          setStyleProperty(span, "text-underline-offset", "3px", "important");
          setStyleProperty(span, "text-decoration-thickness", "1.5px", "important");
        } else if (normalizedStatus === "should-know") {
          setStyleProperty(span, "color", "#5db872", "important");
          setStyleProperty(span, "text-decoration", "underline", "important");
          setStyleProperty(span, "text-decoration-color", "rgba(93, 184, 114, 0.45)", "important");
          setStyleProperty(span, "text-underline-offset", "3px", "important");
          setStyleProperty(span, "text-decoration-thickness", "1.5px", "important");
        } else {
          setStyleProperty(span, "color", "inherit", "important");
          setStyleProperty(span, "text-decoration", "none", "important");
        }

        this.subtitleEl.appendChild(span);
      }
    }

    renderCue(cue) {
      this.currentCue = cue;
      if (!this.subtitleEl || !this.container) return;
      if (this.isHoverLocked) {
        // If mouse is currently hovering over the subtitle to read/scan it with Yomitan or dragging:
        // If cue is null (e.g. video timestamp barely crossed the end of cue before pause took effect),
        // keep displaying the current cue text stable under the cursor.
        if (!cue || !cue.text) {
          this.pendingCue = null;
          return;
        }
      }
      this.pendingCue = undefined;

      if (cue && cue.text && this.displayEnabled !== false) {
        if (Array.isArray(cue.tokens) && cue.tokens.length > 0) {
          this._renderTokens(cue.tokens);
        } else {
          if (typeof this.subtitleEl.replaceChildren === "function") {
            this.subtitleEl.replaceChildren();
          }
          this.subtitleEl.textContent = cue.text;
        }
        setStyleProperty(this.subtitleEl, "display", "inline-block", "important");
        setStyleProperty(this.container, "display", "flex", "important");
        setStyleProperty(this.container, "opacity", "1", "important");
        setStyleProperty(this.container, "visibility", "visible", "important");
        setStyleProperty(this.container, "pointer-events", "auto", "important");
        this.container.setAttribute("data-active-cue", cue.text);
        this.updatePosition();
        this.syncNativeTextTrack(cue);
      } else {
        if (!this.displayEnabled && cue && cue.text) {
          if (Array.isArray(cue.tokens) && cue.tokens.length > 0) {
            this._renderTokens(cue.tokens);
          } else {
            if (typeof this.subtitleEl.replaceChildren === "function") {
              this.subtitleEl.replaceChildren();
            }
            this.subtitleEl.textContent = cue.text;
          }
        } else {
          if (typeof this.subtitleEl.replaceChildren === "function") {
            this.subtitleEl.replaceChildren();
          }
          this.subtitleEl.textContent = "";
        }
        setStyleProperty(this.subtitleEl, "display", "none", "important");
        setStyleProperty(this.container, "opacity", "0", "important");
        setStyleProperty(this.container, "visibility", "hidden", "important");
        setStyleProperty(this.container, "display", "none", "important");
        setStyleProperty(this.container, "pointer-events", "none", "important");
        this.container.removeAttribute("data-active-cue");
        this.syncNativeTextTrack(null);
      }
    }

    unmount() {
      this.isHoverLocked = false;
      this.pendingCue = undefined;
      if (this._rafPositionId !== null) {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(this._rafPositionId);
        }
        this._rafPositionId = null;
      }
      if (this._fsTimer !== null) {
        clearTimeout(this._fsTimer);
        this._fsTimer = null;
      }
      if (this.isDragging) {
        this.isDragging = false;
        if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
          window.removeEventListener("pointermove", this._boundHandlePointerMove, true);
          window.removeEventListener("pointerup", this._boundHandlePointerUp, true);
          window.removeEventListener("pointercancel", this._boundHandlePointerUp, true);
          window.removeEventListener("mousemove", this._boundHandlePointerMove, true);
          window.removeEventListener("mouseup", this._boundHandlePointerUp, true);
        }
      }
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      window.removeEventListener("resize", this._boundScheduleUpdatePosition);
      window.removeEventListener("scroll", this._boundScheduleUpdatePosition, { passive: true });
      window.removeEventListener("resize", this._boundUpdatePosition);
      window.removeEventListener("scroll", this._boundUpdatePosition, true);
      document.removeEventListener("fullscreenchange", this._boundFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", this._boundFullscreenChange);
      document.removeEventListener("mozfullscreenchange", this._boundFullscreenChange);
      document.removeEventListener("MSFullscreenChange", this._boundFullscreenChange);

      if (this.subtitleEl && typeof this.subtitleEl.removeEventListener === "function") {
        this.subtitleEl.removeEventListener("mouseenter", this._boundSubtitleMouseEnter);
        this.subtitleEl.removeEventListener("mouseleave", this._boundSubtitleMouseLeave);
        this.subtitleEl.removeEventListener("mousemove", this._boundSubtitleMouseMove);
        this.subtitleEl.removeEventListener("mousedown", this._boundSubtitleMouseDown);
        this.subtitleEl.removeEventListener("mouseup", this._boundSubtitleMouseUp);
        this.subtitleEl.removeEventListener("click", this._boundSubtitleClick);
      }
      if (this.boxEl && typeof this.boxEl.removeEventListener === "function") {
        this.boxEl.removeEventListener("mousedown", this._boundSubtitleMouseDown);
        this.boxEl.removeEventListener("mouseup", this._boundSubtitleMouseUp);
        this.boxEl.removeEventListener("click", this._boundSubtitleClick);
      }
      if (this.handleEl && typeof this.handleEl.removeEventListener === "function") {
        this.handleEl.removeEventListener("pointerdown", this._boundHandlePointerDown);
        this.handleEl.removeEventListener("mousedown", this._boundHandlePointerDown);
      }
      if (this._hoverWordTimer) {
        clearTimeout(this._hoverWordTimer);
        this._hoverWordTimer = null;
      }
      this._lastHoverWord = "";

      if (this.container && typeof this.container.removeEventListener === "function") {
        this.container.removeEventListener("dragover", this._boundDragOver);
        this.container.removeEventListener("dragleave", this._boundDragLeave);
        this.container.removeEventListener("drop", this._boundDrop);
      }
      if (this.video && typeof this.video.removeEventListener === "function") {
        this.video.removeEventListener("dragover", this._boundDragOver);
        this.video.removeEventListener("dragleave", this._boundDragLeave);
        this.video.removeEventListener("drop", this._boundDrop);
        this.video.removeEventListener("resize", this._boundScheduleUpdatePosition);
        this.video.removeEventListener("loadedmetadata", this._boundScheduleUpdatePosition);
        this.video.removeEventListener("loadeddata", this._boundScheduleUpdatePosition);
        this.video.removeEventListener("canplay", this._boundScheduleUpdatePosition);
        this.video.removeEventListener("play", this._boundScheduleUpdatePosition);
        this.video.removeEventListener("seeked", this._boundScheduleUpdatePosition);
        this.video.removeEventListener("resize", this._boundUpdatePosition);
        this.video.removeEventListener("loadedmetadata", this._boundUpdatePosition);
        this.video.removeEventListener("loadeddata", this._boundUpdatePosition);
        this.video.removeEventListener("canplay", this._boundUpdatePosition);
        this.video.removeEventListener("play", this._boundUpdatePosition);
        this.video.removeEventListener("seeked", this._boundUpdatePosition);
      }

      if (this.container && this.container.parentElement) {
        this.container.parentElement.removeChild(this.container);
      }
      if (typeof document !== "undefined") {
        const styleEl = document.getElementById("ankiminer-video-overlay-styles");
        if (styleEl && styleEl.parentElement) {
          styleEl.parentElement.removeChild(styleEl);
        }
      }
      this.container = null;
      this.boxEl = null;
      this.handleEl = null;
      this.subtitleEl = null;
      this.video = null;
    }
  }