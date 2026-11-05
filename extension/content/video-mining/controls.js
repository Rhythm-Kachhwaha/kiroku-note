
  // -------------------------------------------------------------
  // Step 4: Native TextTrack Inspector (YouTube / generic)
  // -------------------------------------------------------------
  function inspectNativeTextTracks(video) {
    if (!video) return { supported: false, tracks: [] };
    const trackList = video.textTracks ? Array.from(video.textTracks) : [];
    const domTracks = video.querySelectorAll ? Array.from(video.querySelectorAll("track")) : [];

    const tracksReport = trackList.map((t, idx) => {
      let cueCount = 0;
      let accessible = false;
      let sampleText = "";

      try {
        if (t.cues) {
          cueCount = t.cues.length;
          accessible = true;
          if (cueCount > 0 && t.cues[0]?.text) {
            sampleText = t.cues[0].text;
          }
        }
      } catch (err) {
        accessible = false;
      }

      return {
        index: idx,
        kind: t.kind,
        label: t.label,
        language: t.language,
        mode: t.mode,
        cueCount,
        accessible,
        sampleText
      };
    });

    return {
      supported: Boolean(video.textTracks),
      trackCount: trackList.length,
      domTrackElementCount: domTracks.length,
      tracks: tracksReport
    };
  }

  // -------------------------------------------------------------
  // Step 4.5: Subtitle Navigation Hotkeys Controller
  // -------------------------------------------------------------
  function isEditableTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = (target.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (typeof target.getAttribute === "function") {
      const role = target.getAttribute("role");
      if (role === "textbox" || role === "combobox" || role === "searchbox") return true;
      const contentEditable = target.getAttribute("contenteditable");
      if (contentEditable && contentEditable !== "false") return true;
    }
    if (typeof target.closest === "function") {
      const editableAncestor = target.closest("input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox']");
      if (editableAncestor) return true;
    }
    return false;
  }

  function isNetflixPlatform() {
    const nfMod = typeof NetflixAdapter !== "undefined"
      ? NetflixAdapter
      : (typeof window !== "undefined" ? window.NetflixAdapter : null);
    if (nfMod && typeof nfMod.isNetflixPage === "function") {
      return nfMod.isNetflixPage();
    }
    if (typeof location !== "undefined" && location.hostname) {
      return location.hostname.includes("netflix.com");
    }
    return false;
  }

  class SubtitleHotkeyController {
    constructor({ getVideo, getSyncEngine, onOffsetChanged } = {}) {
      this.getVideo = typeof getVideo === "function" ? getVideo : () => null;
      this.getSyncEngine = typeof getSyncEngine === "function" ? getSyncEngine : () => null;
      this.onOffsetChanged = typeof onOffsetChanged === "function" ? onOffsetChanged : null;
      this.enabled = true;
      this._boundKeyDown = this.handleKeyDown.bind(this);
      this._isAttached = false;
    }

    attach() {
      if (this._isAttached) return;
      // Phase 8.1 subtitle navigation hotkeys disabled on Netflix
      if (isNetflixPlatform()) return;
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("keydown", this._boundKeyDown, true);
        this._isAttached = true;
      }
    }

    detach() {
      if (!this._isAttached) return;
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("keydown", this._boundKeyDown, true);
        this._isAttached = false;
      }
    }

    handleKeyDown(event) {
      if (!this.enabled) return;
      // Phase 8.1 subtitle navigation hotkeys disabled on Netflix
      if (isNetflixPlatform()) return;
      if (!event) return;

      // Do not trigger when modifier keys (Ctrl, Alt, Meta) are held down
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Do not trigger when typing in editable elements or inputs
      if (isEditableTarget(event.target)) return;
      if (typeof document !== "undefined" && isEditableTarget(document.activeElement)) return;

      const video = this.getVideo();
      if (!video || !video.isConnected) return;

      const key = (event.key || "").toLowerCase();
      const rawKey = event.key || "";
      const code = event.code || "";

      if (key === "a") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        this.previousSubtitle();
      } else if (key === "s") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        this.replaySubtitle();
      } else if (key === "d") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        this.nextSubtitle();
      } else if (key === " " || code === "Space") {
        // If user is focused on a native button, allow normal button click
        const targetTag = (event.target?.tagName || "").toUpperCase();
        if (targetTag === "BUTTON") return;

        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        this.togglePlayPause();
      } else if (rawKey === "[" || code === "BracketLeft") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        this.adjustOffset(-100);
      } else if (rawKey === "]" || code === "BracketRight") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        this.adjustOffset(100);
      } else if (rawKey === "\\" || code === "Backslash") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        this.resetOffset();
      }
    }

    adjustOffset(deltaMs) {
      const syncEngine = this.getSyncEngine();
      if (!syncEngine) return;
      const currentMs = typeof syncEngine.offsetMs === "number"
        ? syncEngine.offsetMs
        : Math.round((syncEngine.offset || 0) * 1000);
      const newMs = currentMs + deltaMs;
      syncEngine.setOffsetMs(newMs);
      if (typeof this.onOffsetChanged === "function") {
        this.onOffsetChanged(newMs);
      }
    }

    resetOffset() {
      const syncEngine = this.getSyncEngine();
      if (!syncEngine) return;
      syncEngine.setOffsetMs(0);
      if (typeof this.onOffsetChanged === "function") {
        this.onOffsetChanged(0);
      }
    }

    getSortedCues() {
      const syncEngine = this.getSyncEngine();
      if (!syncEngine || !Array.isArray(syncEngine.cues) || syncEngine.cues.length === 0) {
        return [];
      }
      return [...syncEngine.cues].sort((a, b) => a.startTime - b.startTime);
    }

    getActiveCue(sortedCues, videoTime) {
      const syncEngine = this.getSyncEngine();
      if (syncEngine && typeof syncEngine.findCueAtTime === "function") {
        const found = syncEngine.findCueAtTime(videoTime);
        if (found) return found;
      }
      if (syncEngine?.currentCue) {
        return syncEngine.currentCue;
      }
      const offset = syncEngine?.offset || 0;
      const unshiftedTime = videoTime - offset;
      for (const cue of sortedCues) {
        if (unshiftedTime >= cue.startTime && unshiftedTime < cue.endTime) {
          return cue;
        }
      }
      return null;
    }

    previousSubtitle() {
      const video = this.getVideo();
      if (!video) return;

      const syncEngine = this.getSyncEngine();
      const sortedCues = this.getSortedCues();
      if (sortedCues.length === 0) return;

      const offset = syncEngine?.offset || 0;
      const videoTime = video.currentTime;
      const activeCue = this.getActiveCue(sortedCues, videoTime);

      if (activeCue) {
        const idx = sortedCues.findIndex(c =>
          c === activeCue ||
          (Math.abs(c.startTime - activeCue.startTime) < 0.001 && c.text === activeCue.text)
        );
        if (idx > 0) {
          this.seekToCue(sortedCues[idx - 1]);
        }
      } else {
        const unshiftedTime = videoTime - offset;
        let prevCue = null;
        for (let i = sortedCues.length - 1; i >= 0; i--) {
          if (sortedCues[i].startTime < unshiftedTime - 0.05) {
            prevCue = sortedCues[i];
            break;
          }
        }
        if (prevCue) {
          this.seekToCue(prevCue);
        }
      }
    }

    replaySubtitle() {
      const video = this.getVideo();
      if (!video) return;

      const syncEngine = this.getSyncEngine();
      const sortedCues = this.getSortedCues();
      const videoTime = video.currentTime;
      const activeCue = this.getActiveCue(sortedCues, videoTime);

      if (activeCue && typeof activeCue.startTime === "number") {
        this.seekToCue(activeCue);
      }
    }

    nextSubtitle() {
      const video = this.getVideo();
      if (!video) return;

      const syncEngine = this.getSyncEngine();
      const sortedCues = this.getSortedCues();
      if (sortedCues.length === 0) return;

      const offset = syncEngine?.offset || 0;
      const videoTime = video.currentTime;
      const activeCue = this.getActiveCue(sortedCues, videoTime);

      if (activeCue) {
        const idx = sortedCues.findIndex(c =>
          c === activeCue ||
          (Math.abs(c.startTime - activeCue.startTime) < 0.001 && c.text === activeCue.text)
        );
        if (idx >= 0 && idx < sortedCues.length - 1) {
          this.seekToCue(sortedCues[idx + 1]);
        }
      } else {
        const unshiftedTime = videoTime - offset;
        const nextCue = sortedCues.find(c => c.startTime > unshiftedTime + 0.05);
        if (nextCue) {
          this.seekToCue(nextCue);
        }
      }
    }

    seekToCue(cue) {
      if (!cue || typeof cue.startTime !== "number") return;
      const video = this.getVideo();
      if (!video) return;

      const syncEngine = this.getSyncEngine();
      const offset = syncEngine?.offset || 0;
      // Phase 8.3: Effective cue start time in video time is cue.startTime + offset
      const targetTime = Math.max(0, cue.startTime + offset);

      if (typeof video.seek === "function") {
        video.seek(targetTime);
      } else {
        video.currentTime = targetTime;
        try {
          if (typeof Event === "function") {
            video.dispatchEvent(new Event("seeked"));
            video.dispatchEvent(new Event("timeupdate"));
          } else {
            video.dispatchEvent({ type: "seeked" });
            video.dispatchEvent({ type: "timeupdate" });
          }
        } catch (_) {}
      }

      if (syncEngine && typeof syncEngine.sync === "function") {
        syncEngine.sync();
      }
    }

    togglePlayPause() {
      const video = this.getVideo();
      if (!video) return;

      try {
        if (video.paused) {
          const p = video.play();
          if (p && typeof p.catch === "function") {
            p.catch(() => {});
          }
        } else {
          video.pause();
        }
      } catch (_) {}
    }
  }

  // -------------------------------------------------------------
  // Step 4.6: Subtitle Auto-Pause on Hover Controller
  // -------------------------------------------------------------
  class SubtitleAutoPauseController {
    constructor({ getVideo, getRenderer, getSyncEngine } = {}) {
      this.getVideo = typeof getVideo === "function" ? getVideo : () => null;
      this.getRenderer = typeof getRenderer === "function" ? getRenderer : () => null;
      this.getSyncEngine = typeof getSyncEngine === "function" ? getSyncEngine : () => null;

      this.enabled = false;
      this.isHovering = false;
      this.pausedByHover = false;
      this._hoverPauseActive = false;
      this._pauseTimestamp = 0;
      this.activeElement = null;
      this.attachedVideo = null;
      this._resumeTimeout = null;
      this.resumeDelayMs = 150;

      this._boundMouseEnter = this.handleMouseEnter.bind(this);
      this._boundMouseLeave = this.handleMouseLeave.bind(this);
      this._boundVideoPlay = this.handleVideoPlay.bind(this);
    }

    setEnabled(enabled) {
      this.enabled = Boolean(enabled);
      if (!this.enabled) {
        this.cancelResume();
        if (this.pausedByHover) {
          this.resumePlayback();
        }
        this.isHovering = false;
        this._hoverPauseActive = false;
      }
    }

    attachOverlay(element) {
      this.detachOverlay();
      if (!element || typeof element.addEventListener !== "function") return;
      this.activeElement = element;
      this.activeElement.addEventListener("mouseenter", this._boundMouseEnter);
      this.activeElement.addEventListener("mouseleave", this._boundMouseLeave);
    }

    detachOverlay() {
      this.cancelResume();
      if (this.activeElement && typeof this.activeElement.removeEventListener === "function") {
        this.activeElement.removeEventListener("mouseenter", this._boundMouseEnter);
        this.activeElement.removeEventListener("mouseleave", this._boundMouseLeave);
      }
      this.activeElement = null;
      this.isHovering = false;
      this.pausedByHover = false;
      this._hoverPauseActive = false;
    }

    attachVideo(video) {
      if (this.attachedVideo === video) return;
      this.detachVideo();
      if (!video || typeof video.addEventListener !== "function") return;
      this.attachedVideo = video;
      this.attachedVideo.addEventListener("play", this._boundVideoPlay);
    }

    detachVideo() {
      if (this.attachedVideo && typeof this.attachedVideo.removeEventListener === "function") {
        this.attachedVideo.removeEventListener("play", this._boundVideoPlay);
      }
      this.attachedVideo = null;
      this.cancelResume();
      this.pausedByHover = false;
      this._hoverPauseActive = false;
    }

    handleVideoPlay() {
      // If an in-flight play event fires synchronously or in the same microtask as our pause call,
      // ignore it so it doesn't immediately corrupt the pausedByHover state.
      if (this._isPausing) {
        return;
      }
      // If the user or page explicitly resumed playback, relinquish hover lock
      this.pausedByHover = false;
      this._hoverPauseActive = false;
    }

    cancelResume() {
      if (this._resumeTimeout !== null) {
        clearTimeout(this._resumeTimeout);
        this._resumeTimeout = null;
      }
    }

    _doPlatformPause(video) {
      if (!video) return;
      try {
        const isNetflix = typeof location !== "undefined" && location.hostname && location.hostname.includes("netflix.com");
        if (isNetflix && typeof document !== "undefined") {
          const nfPauseBtn = document.querySelector(".button-nfplayerPause, [data-uia=\"control-play-pause\"]");
          if (nfPauseBtn && typeof nfPauseBtn.click === "function") {
            nfPauseBtn.click();
            return;
          }
        }
        if (typeof video.pause === "function") {
          video.pause();
        }
      } catch (_) {
        // Best effort: Never throw or disrupt if player overrides
      }
    }

    _doPlatformPlay(video) {
      if (!video) return;
      try {
        const isNetflix = typeof location !== "undefined" && location.hostname && location.hostname.includes("netflix.com");
        if (isNetflix && typeof document !== "undefined") {
          const nfPlayBtn = document.querySelector(".button-nfplayerPlay, [data-uia=\"control-play-pause\"]");
          if (nfPlayBtn && typeof nfPlayBtn.click === "function") {
            nfPlayBtn.click();
            return;
          }
        }
        if (typeof video.play === "function") {
          const p = video.play();
          if (p && typeof p.catch === "function") {
            p.catch(() => {});
          }
        }
      } catch (_) {
        // Best effort: Never throw
      }
    }

    handleMouseEnter() {
      if (!this.enabled) return;

      this.isHovering = true;
      this.cancelResume();

      const renderer = this.getRenderer();
      if (renderer && typeof renderer.setHoverLocked === "function") {
        renderer.setHoverLocked(true);
      }

      const video = this.getVideo();
      if (!video || !video.isConnected || video.ended) {
        return;
      }

      // Only pause if the video is currently playing
      // If already paused, we do NOT take ownership or resume on leave
      if (!video.paused) {
        this.pausedByHover = true;
        this._hoverPauseActive = true;
        this._isPausing = true;
        try {
          this._doPlatformPause(video);
        } finally {
          this._isPausing = false;
        }
      }
    }

    handleMouseLeave() {
      if (!this.enabled) return;

      this.isHovering = false;
      this.cancelResume();

      const performResume = () => {
        this._resumeTimeout = null;

        const renderer = this.getRenderer();
        if (renderer && typeof renderer.setHoverLocked === "function") {
          renderer.setHoverLocked(false);
        }

        const video = this.getVideo();
        if (!video || !video.isConnected || video.ended) {
          this.pausedByHover = false;
          this._hoverPauseActive = false;
          return;
        }

        // Resume playback ONLY if AnkiMiner paused the video because of the hover
        if (this.pausedByHover) {
          this.pausedByHover = false;
          this._hoverPauseActive = false;
          if (video.paused) {
            this._doPlatformPlay(video);
          }
        }
      };

      if (this.resumeDelayMs > 0) {
        this._resumeTimeout = setTimeout(performResume, this.resumeDelayMs);
      } else {
        performResume();
      }
    }

    resumePlayback() {
      this.cancelResume();
      const renderer = this.getRenderer();
      if (renderer && typeof renderer.setHoverLocked === "function") {
        renderer.setHoverLocked(false);
      }

      const video = this.getVideo();
      if (this.pausedByHover && video && video.isConnected && !video.ended && video.paused) {
        this.pausedByHover = false;
        this._hoverPauseActive = false;
        this._doPlatformPlay(video);
      } else {
        this.pausedByHover = false;
        this._hoverPauseActive = false;
      }
    }
  }