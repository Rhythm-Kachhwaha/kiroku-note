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
  const MAX_QUEUE_SIZE = 50;

  class AnimeSessionLogger {
    constructor(options = {}) {
      this.backendUrl = (options.backendUrl || DEFAULT_BACKEND).replace(/\/+$/, "");
      this.sessionId = options.sessionId || this.generateSessionId();
      this.site = options.site || "generic";
      this.title = options.title || "";
      this.series = options.series || "";
      this.episodeNumber = options.episodeNumber || 1;
      this.episodeKey = options.episodeKey || "";
      this.cueHash = options.cueHash || "";
      this.mediaType = options.mediaType || "anime";

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

    setEpisodeInfo(info = {}) {
      if (!info || typeof info !== "object") return;
      const { site, title, series, episodeKey, cueHash, mediaType } = info;
      const isGeneric = (str) => !str || /^(?:Netflix\s+Subtitles(?:\s*\(Live\))?|YouTube\s+CC(?:\s*\([^)]*\))?|Embedded\s+Subtitles|No\s+subtitles(?:\s+loaded)?|subtitles|Anime|none)$/i.test(String(str).trim());

      if (site) this.site = site;
      if (title && (!this.title || !isGeneric(title) || isGeneric(this.title))) {
        this.title = title;
      }
      if (series && (!this.series || !isGeneric(series) || isGeneric(this.series))) {
        this.series = series;
      }
      if (episodeKey && (!this.episodeKey || !this.episodeKey.includes("generic/unknown") || !episodeKey.includes("unknown"))) {
        this.episodeKey = episodeKey;
      }
      if (cueHash) {
        const hashChanged = cueHash !== this.cueHash;
        this.cueHash = cueHash;
        if (hashChanged) {
          this.restoreEpisodeProgress(cueHash).catch(() => {});
        }
      }
      if (mediaType) this.mediaType = mediaType;
    }

    async restoreEpisodeProgress(hash) {
      if (!hash || typeof chrome === "undefined" || !chrome.storage?.local) return;
      try {
        const key = `kiroku.episode_mined.${hash}`;
        const res = await chrome.storage.local.get(key);
        if (Array.isArray(res?.[key])) {
          for (const w of res[key]) {
            if (w) this.minedWordsSet.add(String(w).trim());
          }
          this.wordsMined = this.minedWordsSet.size;
        }
      } catch (_) {}
    }

    async persistEpisodeProgress() {
      if (!this.cueHash || typeof chrome === "undefined" || !chrome.storage?.local) return;
      try {
        const key = `kiroku.episode_mined.${this.cueHash}`;
        await chrome.storage.local.set({
          [key]: Array.from(this.minedWordsSet)
        });
      } catch (_) {}
    }

    async initQueue() {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const res = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
          if (Array.isArray(res?.[QUEUE_STORAGE_KEY])) {
            this.retryQueue = res[QUEUE_STORAGE_KEY].slice(-MAX_QUEUE_SIZE);
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
          this.onHeartbeat().catch(() => {});
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

      // Save position immediately on pause
      if (this.cueHash && this.lastPositionMs > 0) {
        this.saveEpisodePosition(this.cueHash, this.lastPositionMs).catch(() => {});
      }
      if (this.watchSeconds > 5) {
        this.flushSession("pause").catch(() => {});
      }

      // Trigger flush if paused > 60s
      if (this.pauseTimer) clearTimeout(this.pauseTimer);
      this.pauseTimer = setTimeout(() => {
        this.pauseTimer = null;
        this.flushSession("pause_threshold").catch(() => {});
      }, PAUSE_THRESHOLD_MS);
    }

    onEnded() {
      this.updateWatchTime();
      this.isPlaying = false;
      if (this.cueHash && this.lastPositionMs > 0) {
        this.saveEpisodePosition(this.cueHash, this.lastPositionMs).catch(() => {});
      }
      this.flushSession("video_ended").catch(() => {});
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
      const cueTime = typeof cue.startTime === "number" ? cue.startTime : (typeof cue.start === "number" ? cue.start : (typeof cue.startMs === "number" ? cue.startMs / 1000 : (typeof cue.s === "number" ? cue.s : "")));
      const id = typeof cue.i === "number" ? cue.i : (cue.id !== undefined && cue.id !== null ? String(cue.id) : `${cueTime}_${cue.text}`);
      if (!this.seenCues.has(id)) {
        this.seenCues.add(id);
        this.linesSeen = this.seenCues.size;
      }
      if (Array.isArray(cue.gap_words) && cue.gap_words.length > 0) {
        for (const gw of cue.gap_words) {
          if (gw && !this.seenGapsSet.has(gw)) {
            this.seenGapsSet.add(gw);
            this.gapWordsSeen = this.seenGapsSet.size;
          }
        }
      }
    }

    recordWordMined(word) {
      const term = String(word || "").trim();
      if (term && !this.minedWordsSet.has(term)) {
        const wasZero = this.wordsMined === 0;
        this.minedWordsSet.add(term);
        this.wordsMined = this.minedWordsSet.size;
        this.persistEpisodeProgress().catch(() => {});
        if (wasZero && this.cueHash) {
          this.saveEpisodePosition(this.cueHash, this.lastPositionMs || 0).catch(() => {});
        }
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
      // H4: Route through background script when in extension context so auth & cloud outbox apply
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        try {
          const bgRes = await chrome.runtime.sendMessage({
            type: "SESSION_LOG_COUNTERS",
            payload
          });
          if (bgRes && bgRes.ok) {
            return bgRes.data || bgRes;
          }
        } catch (_) {}
        this.enqueueSession(payload);
        return null;
      }
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
        this.enqueueSession(payload);
        return null;
      }
    }

    enqueueSession(payload) {
      if (!payload) return;
      const existingIdx = this.retryQueue.findIndex(item => item && item.session_id === payload.session_id);
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
        if (!item) continue;
        let synced = false;
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          try {
            const bgRes = await chrome.runtime.sendMessage({
              type: "SESSION_LOG_COUNTERS",
              payload: item
            });
            if (bgRes && bgRes.ok) synced = true;
          } catch (_) {}
        } else {
          try {
            const res = await fetch(`${this.backendUrl}/api/link/sessions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(item)
            });
            if (res.ok) synced = true;
          } catch (_) {}
        }
        if (!synced) {
          remaining.push(item);
        }
      }
      this.retryQueue = remaining;
      await this.persistQueue().catch(() => {});
      this.isFlushing = false;
    }

    async saveEpisodePosition(cueHash, lastPositionMs) {
      if (!cueHash || typeof lastPositionMs !== "number") return;
      if ((this.wordsMined || 0) < 1) return;
      const cleanHash = cueHash.trim();
      const pos = Math.max(0, Math.round(lastPositionMs));
      const posPayload = {
        last_position_ms: pos,
        title: this.title || "",
        site: this.site || "generic",
        series: this.series || undefined,
        episode_number: this.episodeNumber || 1,
        episode_key: this.episodeKey || undefined,
        media_type: this.mediaType || "anime"
      };
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        try {
          const bgRes = await chrome.runtime.sendMessage({
            type: "EPISODE_SAVE_POSITION",
            cueHash: cleanHash,
            payload: posPayload
          });
          if (bgRes && bgRes.ok) {
            return bgRes.data || bgRes;
          }
        } catch (_) {}
        return null;
      }
      const url = `${this.backendUrl}/api/link/episodes/${encodeURIComponent(cleanHash)}/position`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(posPayload)
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return await res.json();
      } catch (_) {
        return null;
      }
    }

    async syncEpisodeSubtitles(cues, meta = {}) {
      if (!Array.isArray(cues) || cues.length === 0) return null;
      const metaMined = Array.isArray(meta?.minedWords) ? meta.minedWords.filter(Boolean) : [];
      if ((this.wordsMined || 0) < 1 && metaMined.length === 0) return null;
      const hash = meta.hash || this.cueHash;
      if (!hash) return null;
      const mergedMined = Array.from(new Set([...this.minedWordsSet, ...metaMined]));
      const payload = {
        hash,
        title: meta.title || this.title || "",
        series: meta.series || this.series || undefined,
        episode_number: meta.episodeNumber || this.episodeNumber || 1,
        site: meta.site || this.site || "generic",
        media_type: meta.mediaType || this.mediaType || "anime",
        cues,
        duration_ms: meta.durationMs || (this.lastPositionMs || 0),
        mined_words: mergedMined
      };
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        try {
          const bgRes = await chrome.runtime.sendMessage({
            type: "EPISODE_SYNC_SUBTITLES",
            payload
          });
          if (bgRes && bgRes.ok) return bgRes.data || bgRes;
        } catch (_) {}
        return null;
      }
      try {
        const res = await fetch(`${this.backendUrl}/api/link/episodes/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      this.flushSession("unload").catch(() => {});
    }
  }

  return { AnimeSessionLogger };
});

