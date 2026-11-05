/**
 * AnkiMiner - Video Mining Mode Proof of Concept (POC)
 * 
 * Objectives:
 * 1. Detect HTML5 <video> elements (in top frame or cross-origin iframes via all_frames: true)
 * 2. Synchronize hardcoded Japanese subtitle cues to video.currentTime
 * 3. Render active cue as a normal, text-selectable DOM overlay on the video
 * 4. Verify Yomitan hover scanning and AnkiMiner text selection capture
 * 5. Native TextTrack experiment for YouTube / generic HTML5
 */

(() => {
  // Prevent duplicate initialization in the same frame
  if (window.__KIROKU_VIDEO_POC__ || window.__ANKIMINER_VIDEO_POC__) {
    return;
  }

  // -------------------------------------------------------------
  // Step 1: Video Detector
  // -------------------------------------------------------------
  class VideoDetector {
    constructor(onVideoChanged) {
      this.onVideoChanged = onVideoChanged;
      this.activeVideo = null;
      this.observer = null;
      this._boundCheck = this.checkVideos.bind(this);
      this._boundMutations = this.handleMutations.bind(this);
    }

    start() {
      this.checkVideos();
      this.observer = new MutationObserver(this._boundMutations);
      if (document.body) {
        this.observer.observe(document.body, { childList: true, subtree: true });
      } else {
        document.addEventListener("DOMContentLoaded", () => {
          this.checkVideos();
          if (document.body) {
            this.observer.observe(document.body, { childList: true, subtree: true });
          }
        });
      }
      window.addEventListener("resize", this._boundCheck);
      document.addEventListener("fullscreenchange", this._boundCheck);
      document.addEventListener("webkitfullscreenchange", this._boundCheck);
      document.addEventListener("play", this._boundCheck, true);
      document.addEventListener("playing", this._boundCheck, true);
      document.addEventListener("loadeddata", this._boundCheck, true);
    }

    stop() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      window.removeEventListener("resize", this._boundCheck);
      document.removeEventListener("fullscreenchange", this._boundCheck);
      document.removeEventListener("webkitfullscreenchange", this._boundCheck);
      document.removeEventListener("play", this._boundCheck, true);
      document.removeEventListener("playing", this._boundCheck, true);
      document.removeEventListener("loadeddata", this._boundCheck, true);
    }

    findAllVideos() {
      return Array.from(document.querySelectorAll("video"));
    }

    handleMutations(mutations) {
      if (!Array.isArray(mutations) || mutations.some((mutation) => {
        const nodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])];
        return nodes.some((node) => {
          if (!node || node.nodeType !== 1) return false;
          return (node.tagName || "").toLowerCase() === "video" ||
            (typeof node.querySelector === "function" && Boolean(node.querySelector("video")));
        });
      })) {
        this.checkVideos();
      }
    }

    findPrimaryVideo() {
      const allVideos = this.findAllVideos();
      if (this.activeVideo && this.activeVideo.isConnected) {
        const fsEl = getFullscreenElement();
        if (fsEl || (typeof document !== "undefined" && (document.fullscreenElement || document.webkitFullscreenElement))) {
          return this.activeVideo;
        }
      }

      const videos = allVideos.filter(v => {
        // Must be in DOM
        if (!v || !v.isConnected) return false;
        if (v === this.activeVideo) return true;
        const rect = typeof v.getBoundingClientRect === "function" ? v.getBoundingClientRect() : null;
        if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return false;
        // Discard 0-size invisible tracking videos
        return rect.width > 20 && rect.height > 20;
      });

      if (videos.length === 0) return null;
      if (videos.length === 1) return videos[0];

      // Prioritize currently playing video
      const playing = videos.find(v => !v.paused && !v.ended && v.readyState > 2);
      if (playing) return playing;

      // Otherwise pick largest visible video
      let largest = videos[0];
      let maxArea = 0;
      for (const v of videos) {
        const rect = typeof v.getBoundingClientRect === "function" ? v.getBoundingClientRect() : null;
        const area = (rect && Number.isFinite(rect.width) && Number.isFinite(rect.height)) ? (rect.width * rect.height) : 0;
        if (area > maxArea) {
          maxArea = area;
          largest = v;
        }
      }
      return largest;
    }

    checkVideos() {
      if (this.activeVideo && this.activeVideo.isConnected && !this.activeVideo.paused && this.activeVideo.readyState > 2) {
        return;
      }
      const primary = this.findPrimaryVideo();
      if (primary !== this.activeVideo) {
        this.activeVideo = primary;
        if (typeof this.onVideoChanged === "function") {
          this.onVideoChanged(this.activeVideo);
        }
      }
    }

    getVideoState() {
      if (!this.activeVideo) return null;
      return {
        currentTime: this.activeVideo.currentTime,
        duration: this.activeVideo.duration,
        paused: this.activeVideo.paused,
        ended: this.activeVideo.ended,
        videoWidth: this.activeVideo.videoWidth,
        videoHeight: this.activeVideo.videoHeight
      };
    }
  }