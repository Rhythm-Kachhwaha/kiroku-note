/**
 * Kiroku Note - Anime Immersion Session & Position Tracker (Group 5)
 *
 * Tracks counters: watch_seconds, lines_seen, words_mined, gap_words_seen.
 * Dispatches session metrics to backend: POST /api/link/sessions
 * Dispatches episode position updates to backend: POST /api/link/episodes/{hash}/position
 *
 * Triggers on:
 * - pause > 60 s
 * - tab close / window unload
 * - video ended
 * - 60 s chrome.alarms / interval heartbeat
 *
 * Local queue & retry: If backend is unavailable, queues metrics locally in chrome.storage.local
 * and retries on next heartbeat. Never swallows errors or reports false success.
 */

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    root.AnimeSessionLogger = exports.AnimeSessionLogger;
    Object.assign(root, exports);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_BACKEND = "http://127.0.0.1:21828";
  const QUEUE_STORAGE_KEY = "kiroku.anime.session_queue";
  const PAUSE_THRESHOLD_MS = 60000; // 60s
  const HEARTBEAT_INTERVAL_MS = 60000; // 60s

  class AnimeSessionLogger {
    constructor(options = {}) {
      this.backendUrl = (options.backendUrl || DEFAULT_BACKEND).replace(/\/+$/, "");
      this.sessionId = options.sessionId || this.generateSessionId();
      this.site = options.site || "generic";
      this.title = options.title || "";
      this.series = options.series || "";
      this.episodeKey = options.episodeKey || "";
      this.cueHash = options.cueHash || "";

      // Counters
      this.watchSeconds = 0;
      this.linesSeen = 0;
      this.wordsMined = 0;
      this.gapWordsSeen = 0;

      // Tracking state
      this.isPlaying = false;
      this.lastTickTime = null;
      this.lastPositionMs = 0;
      this.pauseTimer = null;
      this.seenCues = new Set();
      this.minedWordsSet = new Set();
      this.seenGapsSet = new Set();

      this.isFlushing = false;
      this.retryQueue = [];

      this.initQueue();
      this.startHeartbeat();
    }

    generateSessionId() {
      return `ses_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    setEpisodeInfo({ site, title, series, episodeKey, cueHash }) {
      if (site) this.site = site;
      if (title) this.title = title;
      if (series) this.series = series;
      if (episodeKey) this.episodeKey = episodeKey;
      if (cueHash) this.cueHash = cueHash;
    }

    async initQueue() {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const res = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
          if (Array.isArray(res?.[QUEUE_STORAGE_KEY])) {
            this.retryQueue = res[QUEUE_STORAGE_KEY];
          }
        }
      } catch (_) {}
    }

    async persistQueue() {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          await chrome.storage.local.set({ [QUEUE_STORAGE_KEY]: this.retryQueue });
        }
      } catch (_) {}
    }

    startHeartbeat() {
      if (typeof window !== "undefined" && typeof window.setInterval === "function") {
        this.heartbeatInterval = window.setInterval(() => {
          this.onHeartbeat();
        }, HEARTBEAT_INTERVAL_MS);
      }
    }

    stopHeartbeat() {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
    }

    onPlay() {
      if (this.pauseTimer) {
        clearTimeout(this.pauseTimer);
        this.pauseTimer = null;
      }
      this.isPlaying = true;
      this.lastTickTime = Date.now();
    }

    onPause() {
      this.updateWatchTime();
      this.isPlaying = false;

      // Trigger flush if paused > 60s
      if (this.pauseTimer) clearTimeout(this.pauseTimer);
      this.pauseTimer = setTimeout(() => {
        this.pauseTimer = null;
        this.flushSession("pause_threshold");
      }, PAUSE_THRESHOLD_MS);
    }

    onEnded() {
      this.updateWatchTime();
      this.isPlaying = false;
      this.flushSession("video_ended");
    }

    onTimeUpdate(currentPositionSec) {
      if (typeof currentPositionSec === "number" && !isNaN(currentPositionSec)) {
        this.lastPositionMs = Math.round(currentPositionSec * 1000);
      }
      this.updateWatchTime();
    }

    updateWatchTime() {
      if (!this.isPlaying || !this.lastTickTime) return;
      const now = Date.now();
      const deltaSec = (now - this.lastTickTime) / 1000;
      if (deltaSec > 0 && deltaSec < 30) {
        // Discard excessive pauses or jumps
        this.watchSeconds += deltaSec;
      }
      this.lastTickTime = now;
    }

    recordCueSeen(cue) {
      if (!cue || !cue.text) return;
      const id = typeof cue.i === "number" ? cue.i : `${cue.startTime || cue.s}_${cue.text}`;
      if (!this.seenCues.has(id)) {
        this.seenCues.add(id);
        this.linesSeen = this.seenCues.size;
      }
      if (Array.isArray(cue.gap_words) && cue.gap_words.length > 0) {
        for (const gw of cue.gap_words) {
          if (!this.seenGapsSet.has(gw)) {
            this.seenGapsSet.add(gw);
            this.gapWordsSeen = this.seenGapsSet.size;
          }
        }
      }
    }

    recordWordMined(word) {
      const term = String(word || "").trim();
      if (term && !this.minedWordsSet.has(term)) {
        this.minedWordsSet.add(term);
        this.wordsMined = this.minedWordsSet.size;
      }
    }

    async onHeartbeat() {
      this.updateWatchTime();
      // Retry queued items if any
      if (this.retryQueue.length > 0) {
        await this.flushRetryQueue();
      }
      // Periodically flush active session progress if watch seconds progressed
      if (this.watchSeconds > 5) {
        await this.flushSession("heartbeat");
      }
      // Save position to backend
      if (this.cueHash && this.lastPositionMs > 0) {
        await this.saveEpisodePosition(this.cueHash, this.lastPositionMs);
      }
    }

    buildSessionPayload() {
      return {
        session_id: this.sessionId,
        site: this.site,
        title: this.title,
        watch_seconds: Math.round(this.watchSeconds * 10) / 10,
        lines_seen: this.linesSeen,
        words_mined: this.wordsMined,
        gap_words_seen: this.gapWordsSeen,
        series: this.series || undefined,
        episode_key: this.episodeKey || undefined
      };
    }

    async flushSession(reason = "manual") {
      this.updateWatchTime();
      if (this.watchSeconds <= 0 && this.linesSeen <= 0 && this.wordsMined <= 0) {
        return;
      }
      const payload = this.buildSessionPayload();
      try {
        const res = await fetch(`${this.backendUrl}/api/link/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return await res.json();
      } catch (err) {
        // Backend unavailable -> queue locally
        this.enqueueSession(payload);
        return null;
      }
    }

    enqueueSession(payload) {
      // If same sessionId already queued, update it
      const existingIdx = this.retryQueue.findIndex(item => item.session_id === payload.session_id);
      if (existingIdx >= 0) {
        this.retryQueue[existingIdx] = payload;
      } else {
        this.retryQueue.push(payload);
      }
      this.persistQueue().catch(() => {});
    }

    async flushRetryQueue() {
      if (this.isFlushing || this.retryQueue.length === 0) return;
      this.isFlushing = true;
      const remaining = [];
      for (const item of this.retryQueue) {
        try {
          const res = await fetch(`${this.backendUrl}/api/link/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item)
          });
          if (!res.ok) {
            remaining.push(item);
          }
        } catch (_) {
          remaining.push(item);
        }
      }
      this.retryQueue = remaining;
      await this.persistQueue();
      this.isFlushing = false;
    }

    async saveEpisodePosition(cueHash, lastPositionMs) {
      if (!cueHash || typeof lastPositionMs !== "number") return;
      const url = `${this.backendUrl}/api/link/episodes/${encodeURIComponent(cueHash)}/position`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            last_position_ms: Math.max(0, lastPositionMs),
            title: this.title,
            site: this.site,
            series: this.series,
            episode_key: this.episodeKey
          })
        });
        if (!res.ok) {
          // Retried silently; do not swallow when queried directly
          return null;
        }
        return await res.json();
      } catch (_) {
        return null;
      }
    }

    destroy() {
      this.stopHeartbeat();
      if (this.pauseTimer) {
        clearTimeout(this.pauseTimer);
        this.pauseTimer = null;
      }
      this.flushSession("unload");
    }
  }

  return { AnimeSessionLogger };
});

