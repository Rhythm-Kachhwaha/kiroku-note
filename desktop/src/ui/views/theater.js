/**
 * Kiroku Note Desktop — Theater Tier 1 (Slice 42)
 *
 * Local video player with integrated subtitle support:
 * - HTML5 <video> player (Electron H.264/AAC/VP8/VP9/AV1)
 * - File picker for mp4/mkv/webm with codec error detection
 * - Subtitle loading (.srt/.ass/.vtt) & sidecar auto-detection
 * - Jimaku.cc search & download provider
 * - Local PlayerAdapter implementing Link client command & event protocol
 * - Reuse of Vocab Watch panel component (Slice 39)
 * - Canvas screenshot + MediaRecorder audio clip capture
 * - Last position memory keyed by file hash
 */

import { SubtitleParser } from '../lib-shared/subtitle_parser.mjs';
import { VocabWatchView } from './vocab_watch.js';
import { LinkStore } from '../services/link_store.js';
import { escapeHtml } from '../utils/sanitizer.js';

export function computeFileHash(fileOrName, size = 0, lastModified = 0) {
  const name = typeof fileOrName === 'string' ? fileOrName : (fileOrName?.name || 'unknown');
  const s = typeof fileOrName === 'object' && fileOrName?.size ? fileOrName.size : size;
  const m = typeof fileOrName === 'object' && fileOrName?.lastModified ? fileOrName.lastModified : lastModified;
  let str = `${name}:${s}:${m}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return `f${Math.abs(hash).toString(16)}`;
}

/**
 * Natural alphanumeric sort comparison (e.g. Ep 2 before Ep 10)
 */
export function naturalCompare(a, b) {
  const strA = typeof a === 'string' ? a : (a?.name || '');
  const strB = typeof b === 'string' ? b : (b?.name || '');
  return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Finds the next episode file in the same folder list using natural sorting.
 */
export function findNextEpisode(currentName, fileList) {
  if (!currentName || !Array.isArray(fileList) || fileList.length === 0) return null;
  const videoFiles = fileList.filter(f => {
    const name = typeof f === 'string' ? f : (f?.name || '');
    return /\.(mp4|mkv|webm)$/i.test(name);
  });
  if (videoFiles.length <= 1) return null;

  const sorted = [...videoFiles].sort((a, b) => naturalCompare(a, b));

  const curIdx = sorted.findIndex(f => {
    const name = typeof f === 'string' ? f : (f?.name || '');
    return name === currentName;
  });

  if (curIdx >= 0 && curIdx < sorted.length - 1) {
    return sorted[curIdx + 1];
  }
  return null;
}

/**
 * Jimaku Subtitle Acquisition Provider (Ported from extension)
 */
export class JimakuSearchProvider {
  constructor(options = {}) {
    this.parser = options.parser || SubtitleParser;
    this.fetchFunction = options.fetchFunction || null;
    this.apiKey = options.apiKey || '';
  }

  setApiKey(key) {
    this.apiKey = typeof key === 'string' ? key.trim() : '';
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('jimaku_api_key', this.apiKey);
      } catch (err) {
        console.debug('[Theater] localStorage setItem failed:', err);
      }
    }
  }

  loadSavedApiKey() {
    if (!this.apiKey && typeof localStorage !== 'undefined') {
      try {
        this.apiKey = localStorage.getItem('jimaku_api_key') || '';
      } catch (err) {
        console.debug('[Theater] localStorage getItem failed:', err);
      }
    }
    return this.apiKey;
  }

  async _callApi(url) {
    if (!this.apiKey) {
      throw new Error('MISSING_API_KEY: Jimaku API key is required');
    }

    if (this.fetchFunction) {
      const res = await this.fetchFunction({ url, apiKey: this.apiKey });
      if (!res || res.ok === false) {
        throw new Error(res?.error || 'API request failed');
      }
      return res;
    }

    // Try desktop IPC runtime messaging if available
    if (typeof window !== 'undefined' && window.desktopAPI?.chrome?.runtime?.sendMessage) {
      try {
        const response = await window.desktopAPI.chrome.runtime.sendMessage({
          type: 'FETCH_JIMAKU_API',
          url,
          apiKey: this.apiKey
        });
        if (response && response.ok !== false && (response.data || response.text)) {
          return response;
        }
      } catch (err) {
        console.debug('[Theater] sendMessage failed:', err);
      }
    }

    // Direct fetch fallback
    if (typeof fetch !== 'undefined') {
      const res = await fetch(url, {
        headers: {
          'Authorization': this.apiKey,
          'Accept': 'application/json, text/plain, text/vtt, text/x-ssa, */*'
        }
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error('UNAUTHORIZED: Invalid Jimaku API key');
        if (res.status === 429) throw new Error('RATE_LIMITED: Jimaku rate limit reached');
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        return { ok: true, data, isJson: true };
      } else {
        const text = await res.text();
        return { ok: true, text, isJson: false };
      }
    }

    throw new Error('No network transport available for Jimaku API');
  }

  async searchEntries(query) {
    if (!query || typeof query !== 'string') return [];
    const url = `https://jimaku.cc/api/entries/search?query=${encodeURIComponent(query.trim())}`;
    const res = await this._callApi(url);
    return Array.isArray(res?.data) ? res.data : [];
  }

  async getFilesForEntry(entryId) {
    if (!entryId) return [];
    const url = `https://jimaku.cc/api/entries/${entryId}/files`;
    const res = await this._callApi(url);
    return Array.isArray(res?.data) ? res.data : [];
  }

  async downloadSubtitle(fileUrl, filename = 'subtitles.ass') {
    if (!fileUrl) throw new Error('Download URL required');
    const targetUrl = fileUrl.startsWith('http') ? fileUrl : `https://jimaku.cc${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
    const res = await this._callApi(targetUrl);
    const rawText = res.text || (typeof res.data === 'string' ? res.data : JSON.stringify(res.data || ''));
    const parsed = this.parser.parseSubtitles(rawText, filename);
    const cues = typeof this.parser.normalizeCues === 'function' ? this.parser.normalizeCues(parsed) : parsed;
    return { filename, cues, rawText };
  }
}

/**
 * Local PlayerAdapter implementing Link Protocol Command Set and Event System
 */
export class PlayerAdapter {
  constructor(options = {}) {
    this.videoEl = options.videoEl || null;
    this.status = 'connected';
    this.listeners = new Map();
    this.cues = [];
    this.cueHash = null;
    this.activeCue = null;
    this.activeCueIndex = null;
    this.session = null;
    this.currentHash = null;
    this.offsetSec = 0;

    this._bindVideoEvents();
  }

  setVideoElement(videoEl) {
    this.videoEl = videoEl;
    this._bindVideoEvents();
  }

  _bindVideoEvents() {
    if (!this.videoEl) return;
    const v = this.videoEl;

    // Restore remembered volume & playbackRate (Slice 31)
    if (typeof localStorage !== 'undefined') {
      try {
        const savedRate = parseFloat(localStorage.getItem('kiroku:theater:rate'));
        if (!isNaN(savedRate) && savedRate > 0) {
          v.playbackRate = savedRate;
        }
        const savedVol = parseFloat(localStorage.getItem('kiroku:theater:vol'));
        if (!isNaN(savedVol) && savedVol >= 0 && savedVol <= 1) {
          v.volume = savedVol;
        }
        const savedMuted = localStorage.getItem('kiroku:theater:muted');
        if (savedMuted !== null) {
          v.muted = savedMuted === 'true';
        }
      } catch (err) {
        console.debug('[Theater] localStorage read volume/rate failed:', err);
      }
    }

    const emitState = () => {
      const state = {
        t: v.currentTime || 0,
        paused: Boolean(v.paused),
        rate: v.playbackRate || 1,
        vol: v.volume ?? 1,
        muted: Boolean(v.muted)
      };
      this._updateActiveCue(state.t);
      this.emit('video.state', state);
      this.emit('change');

      // Save position to localStorage
      if (this.currentHash && typeof localStorage !== 'undefined' && state.t > 0) {
        try {
          localStorage.setItem(`kiroku:theater:pos:${this.currentHash}`, String(state.t));
        } catch (err) {
          console.debug('[Theater] localStorage save position failed:', err);
        }
      }
    };

    v.addEventListener('timeupdate', emitState);
    v.addEventListener('play', emitState);
    v.addEventListener('pause', emitState);
    v.addEventListener('ratechange', () => {
      emitState();
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('kiroku:theater:rate', String(v.playbackRate));
        } catch (_) {}
      }
    });
    v.addEventListener('volumechange', () => {
      emitState();
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('kiroku:theater:vol', String(v.volume));
          localStorage.setItem('kiroku:theater:muted', String(v.muted));
        } catch (_) {}
      }
    });
    v.addEventListener('seeked', emitState);

    v.addEventListener('loadedmetadata', () => {
      if (this.session) {
        this.session.duration = v.duration || 0;
        this.emit('video.attach', this.session);
      }
    });
  }

  _updateActiveCue(currentTime) {
    if (!this.cues || this.cues.length === 0) {
      if (this.activeCueIndex !== null) {
        this.activeCueIndex = null;
        this.activeCue = null;
        this.emit('cue.active', { i: null });
      }
      return;
    }

    const t = currentTime - this.offsetSec;
    const match = this.cues.find(c => t >= c.s && t <= c.e);

    if (match) {
      if (this.activeCueIndex !== match.i) {
        this.activeCueIndex = match.i;
        this.activeCue = match;
        this.emit('cue.active', { i: match.i });
      }
    } else {
      if (this.activeCueIndex !== null) {
        this.activeCueIndex = null;
        this.activeCue = null;
        this.emit('cue.active', { i: null });
      }
    }
  }

  on(event, fn) {
    if (typeof fn !== 'function') return this;
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(fn);
    return this;
  }

  off(event, fn) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(fn);
    }
    return this;
  }

  emit(event, ...args) {
    if (this.listeners.has(event)) {
      for (const fn of this.listeners.get(event)) {
        try {
          fn(...args);
        } catch (err) {
          console.error(`[PlayerAdapter] Error in listener "${event}":`, err);
        }
      }
    }
  }

  /**
   * Command executor implementing desktop Link cmd.* methods
   */
  async sendCommand(cmd, payload = {}) {
    if (!this.videoEl) return { ok: false, error: 'No video element' };

    switch (cmd) {
      case 'cmd.play':
        try {
          await this.videoEl.play();
        } catch (err) {
          console.debug('[Theater] video play failed:', err);
        }
        return { ok: true };

      case 'cmd.pause':
        this.videoEl.pause();
        return { ok: true };

      case 'cmd.toggle':
        if (this.videoEl.paused) {
          try {
            await this.videoEl.play();
          } catch (err) {
            console.debug('[Theater] video play toggle failed:', err);
          }
        } else {
          this.videoEl.pause();
        }
        return { ok: true };

      case 'cmd.seek':
        if (typeof payload.t === 'number') {
          this.videoEl.currentTime = Math.max(0, payload.t);
        } else if (typeof payload.delta === 'number') {
          this.videoEl.currentTime = Math.max(0, (this.videoEl.currentTime || 0) + payload.delta);
        }
        return { ok: true };

      case 'cmd.cue':
        return this.handleJumpCue(payload);

      case 'cmd.loop':
        return this.handleLoop(payload);

      case 'cmd.rate':
        if (typeof payload.v === 'number') {
          this.videoEl.playbackRate = payload.v;
        }
        return { ok: true };

      case 'cmd.offset':
        if (typeof payload.ms === 'number') {
          this.offsetSec = payload.ms / 1000;
          this._updateActiveCue(this.videoEl.currentTime || 0);
        }
        return { ok: true };

      case 'cmd.clip':
        return this.handleClip(payload);

      default:
        return { ok: false, error: `Unknown command: ${cmd}` };
    }
  }

  handleJumpCue(payload = {}) {
    if (!this.cues || this.cues.length === 0) return { ok: false };
    const curIdx = this.activeCueIndex ?? 0;
    let targetIdx = null;

    if (payload.to === 'next') {
      targetIdx = Math.min(this.cues.length - 1, (this.activeCueIndex !== null ? this.activeCueIndex + 1 : 0));
    } else if (payload.to === 'prev') {
      targetIdx = Math.max(0, (this.activeCueIndex !== null ? this.activeCueIndex - 1 : 0));
    } else if (payload.to === 'first') {
      targetIdx = 0;
    } else if (payload.to === 'last') {
      targetIdx = this.cues.length - 1;
    } else if (typeof payload.i === 'number') {
      targetIdx = Math.max(0, Math.min(this.cues.length - 1, payload.i));
    }

    if (targetIdx !== null && this.cues[targetIdx]) {
      const targetCue = this.cues[targetIdx];
      this.activeCueIndex = targetIdx;
      this.activeCue = targetCue;
      this.videoEl.currentTime = Math.max(0, targetCue.s + this.offsetSec);
      this.emit('cue.active', { i: targetIdx });
      return { ok: true, i: targetIdx };
    }

    return { ok: false };
  }

  handleLoop(payload = {}) {
    const s = typeof payload.s === 'number' ? payload.s : 0;
    const e = typeof payload.e === 'number' ? payload.e : s + 3;
    const count = payload.count || 1;

    let loopsRemaining = count;
    this.videoEl.currentTime = s;
    if (this.videoEl.paused) {
      this.videoEl.play().catch(() => {});
    }

    const checkLoop = () => {
      if (this.videoEl.currentTime >= e) {
        loopsRemaining--;
        if (loopsRemaining > 0) {
          this.videoEl.currentTime = s;
        } else {
          this.videoEl.removeEventListener('timeupdate', checkLoop);
        }
      }
    };

    this.videoEl.addEventListener('timeupdate', checkLoop);
    return { ok: true };
  }

  async handleClip(payload = {}) {
    const reqId = payload.reqId || `clip-${Date.now()}`;
    const s = typeof payload.s === 'number' ? payload.s : (this.videoEl?.currentTime || 0);
    const e = typeof payload.e === 'number' ? payload.e : s + 3;
    const want = Array.isArray(payload.want) ? payload.want : ['image', 'audio'];

    let image_b64 = null;
    let audio_b64 = null;

    // 1. Screenshot capture via canvas
    if (want.includes('image') && this.videoEl && typeof document !== 'undefined') {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = this.videoEl.videoWidth || 640;
        canvas.height = this.videoEl.videoHeight || 360;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(this.videoEl, 0, 0, canvas.width, canvas.height);
          image_b64 = canvas.toDataURL('image/jpeg', 0.85);
        }
      } catch (err) {
        console.debug('[PlayerAdapter] Frame capture failed:', err);
      }
    }

    // 2. Audio segment capture via MediaRecorder on video.captureStream()
    if (want.includes('audio') && this.videoEl) {
      try {
        audio_b64 = await this.captureAudioSegment(s, e);
      } catch (err) {
        console.debug('[PlayerAdapter] Audio capture failed:', err);
      }
    }

    const result = {
      reqId,
      image_b64,
      audio_b64,
      ok: true
    };

    this.emit('clip.result', result);
    return result;
  }

  async captureAudioSegment(s, e) {
    if (!this.videoEl) return null;
    const captureStream = this.videoEl.captureStream || this.videoEl.mozCaptureStream;
    if (typeof captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      return null;
    }

    try {
      const stream = captureStream.call(this.videoEl);
      const audioTracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
      if (audioTracks.length === 0) return null;

      const audioStream = new MediaStream(audioTracks);
      const recorder = new MediaRecorder(audioStream);
      const chunks = [];

      return new Promise((resolve) => {
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) chunks.push(event.data);
        };

        recorder.onstop = () => {
          if (chunks.length === 0) return resolve(null);
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        };

        recorder.start();
        const durationMs = Math.max(100, Math.min(5000, (e - s) * 1000));
        setTimeout(() => {
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
        }, durationMs);
      });
    } catch (_) {
      return null;
    }
  }

  loadCues(rawCues = [], filename = '') {
    const normalized = SubtitleParser.normalizeCues(rawCues);
    this.cues = normalized.map((c, idx) => ({
      i: idx,
      s: c.startTime,
      e: c.endTime,
      text: c.text
    }));
    this.cueHash = computeFileHash(filename || 'subtitles', this.cues.length);
    this.emit('cue.list', { cues: this.cues, hash: this.cueHash });
    if (this.videoEl) {
      this._updateActiveCue(this.videoEl.currentTime || 0);
    }
  }

  attachFile(fileOrUrl, title = 'Local Video') {
    if (!this.videoEl) return;
    const fileName = typeof fileOrUrl === 'string' ? title : (fileOrUrl.name || title);
    this.currentHash = computeFileHash(fileOrUrl, fileOrUrl.size, fileOrUrl.lastModified);

    if (typeof fileOrUrl === 'string') {
      this.videoEl.src = fileOrUrl;
    } else if (typeof Blob !== 'undefined' && fileOrUrl instanceof Blob && typeof URL !== 'undefined' && URL.createObjectURL) {
      this.videoEl.src = URL.createObjectURL(fileOrUrl);
    } else {
      this.videoEl.src = fileOrUrl?.name || 'local_video';
    }

    this.session = {
      tab: 'theater-local',
      site: 'LOCAL',
      title: fileName,
      duration: this.videoEl.duration || 0,
      drm: false
    };

    this.emit('status', 'connected');
    this.emit('video.attach', this.session);

    // Restore last remembered position
    if (this.currentHash && typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem(`kiroku:theater:pos:${this.currentHash}`);
        if (saved) {
          const t = parseFloat(saved);
          if (!isNaN(t) && t > 0) {
            this.videoEl.currentTime = t;
          }
        }
      } catch (err) {
        console.debug('[Theater] localStorage get position failed:', err);
      }
    }
  }
}

/**
 * Theater View Controller (Tier 1)
 */
export class TheaterView {
  constructor(options = {}) {
    this.router = options.router || null;
    this.container = null;
    this.videoEl = null;
    this.playerAdapter = new PlayerAdapter();
    this.linkStore = new LinkStore(this.playerAdapter);
    this.jimakuProvider = new JimakuSearchProvider();
    this.watchView = null;
    this.currentFileName = '';
    this.currentSubName = '';
    this.lastError = null;
    this.isJimakuOpen = false;

    // Slice 31 Polish: Recent files, folder files & next episode, offset, hotkeys
    this.folderFiles = [];
    this.nextEpisodeFile = null;
    this.subtitleOffsetMs = 0;
    this.isRecentOpen = false;
    this._keyListener = null;
  }

  getRecentFiles() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem('kiroku:theater:recent_files');
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  addRecentFile(file) {
    if (!file || typeof localStorage === 'undefined') return;
    try {
      const recents = this.getRecentFiles().filter(r => r.name !== file.name);
      recents.unshift({
        name: file.name,
        size: file.size || 0,
        lastModified: file.lastModified || 0,
        hash: computeFileHash(file),
        openedAt: Date.now()
      });
      localStorage.setItem('kiroku:theater:recent_files', JSON.stringify(recents.slice(0, 10)));
    } catch (err) {
      console.debug('[Theater] save recent file failed:', err);
    }
  }

  renderRecentFiles() {
    const dropdown = this.container?.querySelector('#theater-recent-dropdown');
    if (!dropdown) return;
    const recents = this.getRecentFiles();
    if (recents.length === 0) {
      dropdown.innerHTML = '<span class="text-xs text-muted" style="padding:0.5rem;">No recent files</span>';
      return;
    }
    dropdown.innerHTML = recents.map(r => {
      let posText = '';
      if (typeof localStorage !== 'undefined' && r.hash) {
        const savedPos = localStorage.getItem(`kiroku:theater:pos:${r.hash}`);
        if (savedPos) {
          const s = Math.floor(parseFloat(savedPos) || 0);
          posText = ` • ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        }
      }
      return `
        <div class="theater-recent-item" data-name="${escapeHtml(r.name)}" data-hash="${escapeHtml(r.hash || '')}">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;">${escapeHtml(r.name)}</span>
          <span class="text-xs text-muted">${posText}</span>
        </div>
      `;
    }).join('');

    dropdown.querySelectorAll('.theater-recent-item').forEach(el => {
      el.addEventListener('click', () => {
        const name = el.getAttribute('data-name');
        dropdown.style.display = 'none';
        this.isRecentOpen = false;
        const match = this.folderFiles.find(f => f.name === name);
        if (match) {
          this.openVideoFile(match, this.folderFiles);
        } else {
          this.openVideoFile({ name });
        }
      });
    });
  }

  setSubtitleOffset(val, isDelta = false) {
    if (isDelta) {
      this.subtitleOffsetMs += val;
    } else {
      this.subtitleOffsetMs = val;
    }
    this.playerAdapter.offsetSec = this.subtitleOffsetMs / 1000;
    this.updateOffsetDisplay();
  }

  updateOffsetDisplay() {
    const badge = this.container?.querySelector('#theater-offset-badge');
    if (badge) {
      const val = this.subtitleOffsetMs;
      badge.textContent = `${val > 0 ? '+' : ''}${val}ms`;
    }
  }

  playNextEpisode() {
    if (this.nextEpisodeFile) {
      this.openVideoFile(this.nextEpisodeFile, this.folderFiles);
    }
  }

  updateNextEpisodeButton() {
    const btn = this.container?.querySelector('#theater-next-episode-btn');
    if (btn) {
      btn.disabled = !this.nextEpisodeFile;
      btn.title = this.nextEpisodeFile ? `Next: ${this.nextEpisodeFile.name} (Hotkey N)` : 'No next episode found (Hotkey N)';
    }
  }

  ensureStyles() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('theater-style')) {
      const link = document.createElement('link');
      link.id = 'theater-style';
      link.rel = 'stylesheet';
      link.href = './ui/styles/views/theater.css';
      document.head?.appendChild(link);
    }
  }

  mount(container) {
    this.container = container;
    this.ensureStyles();
    this.render();
    this.setupEvents();
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="theater-container" id="theater-root">
        <!-- Top Toolbar -->
        <header class="theater-toolbar">
          <div class="theater-toolbar-actions">
            <label class="theater-btn theater-btn-primary" title="Open Video File (mp4, mkv, webm)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              <span>Open Video</span>
              <input type="file" id="theater-video-input" accept="video/mp4,video/webm,video/x-matroska,.mp4,.mkv,.webm" style="display:none;" />
            </label>

            <!-- Recent Files (Slice 31) -->
            <div class="theater-recent-wrapper">
              <button type="button" class="theater-btn" id="theater-recent-btn" title="Recent Files">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                <span>Recent</span>
              </button>
              <div class="theater-recent-dropdown" id="theater-recent-dropdown" style="display: none;"></div>
            </div>

            <label class="theater-btn" title="Load Subtitle File (srt, ass, vtt)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 6h16M4 12h16M4 18h10"></path>
              </svg>
              <span>Load Subtitles</span>
              <input type="file" id="theater-sub-input" accept=".srt,.ass,.ssa,.vtt" style="display:none;" />
            </label>

            <!-- Next Episode (Slice 31) -->
            <button type="button" class="theater-btn" id="theater-next-episode-btn" title="Next Episode (Hotkey N)" disabled>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 4 15 12 5 20 5 4"></polygon>
                <line x1="19" y1="5" x2="19" y2="19"></line>
              </svg>
              <span>Next Ep</span>
            </button>

            <!-- Subtitle Offset Controls (Slice 31) -->
            <div class="theater-offset-controls">
              <span class="text-xs text-muted">Offset:</span>
              <button type="button" class="theater-btn theater-btn-sm" id="btn-theater-offset-minus" title="Offset -100ms (Hotkey [)">-100ms</button>
              <button type="button" class="theater-btn theater-btn-sm" id="btn-theater-offset-zero" title="Reset Offset (Hotkey \)"><span id="theater-offset-badge">0ms</span></button>
              <button type="button" class="theater-btn theater-btn-sm" id="btn-theater-offset-plus" title="Offset +100ms (Hotkey ])">+100ms</button>
            </div>

            <button type="button" class="theater-btn" id="theater-jimaku-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <span>Jimaku Search</span>
            </button>
          </div>

          <div class="theater-file-info">
            <span class="theater-badge">THEATER</span>
            <span id="theater-file-label">${escapeHtml(this.currentFileName || 'No video loaded')}</span>
            ${this.currentSubName ? `<span class="theater-badge">${escapeHtml(this.currentSubName)}</span>` : ''}
          </div>
        </header>

        <!-- Codec / General Error Banner -->
        <div id="theater-error-banner" class="theater-error-banner" style="display: ${this.lastError ? 'flex' : 'none'};">
          <span id="theater-error-text">${escapeHtml(this.lastError || '')}</span>
          <button type="button" class="theater-btn" id="theater-dismiss-error">Dismiss</button>
        </div>

        <!-- Main Split: Video Player + Watch Panel -->
        <div class="theater-main-split">
          <div class="theater-video-pane" id="theater-dropzone">
            <video class="theater-video-element" id="theater-video-player" controls preload="metadata"></video>
            <div class="theater-empty-dropzone" id="theater-placeholder" style="display: ${this.currentFileName ? 'none' : 'flex'};">
              <h3 class="text-lg font-bold font-display text-warm-paper mb-2">Drag & Drop Video or Subtitles</h3>
              <p class="text-sm text-secondary mb-4">Supports MP4, WebM, and MKV (H.264/AAC)</p>
              <button type="button" class="theater-btn theater-btn-primary" id="theater-empty-open-btn">
                Select Local Video File
              </button>
            </div>
          </div>

          <!-- Vocab Watch Panel Container (Slice 39 UI Reused) -->
          <div class="theater-watch-pane" id="theater-watch-container"></div>
        </div>

        <!-- Jimaku Search Modal -->
        <div id="theater-jimaku-modal" class="theater-jimaku-modal" style="display: ${this.isJimakuOpen ? 'flex' : 'none'};">
          <div class="theater-modal-header">
            <span>Jimaku Subtitle Search</span>
            <button type="button" class="theater-btn" id="theater-close-jimaku">✕</button>
          </div>
          <div class="theater-modal-body">
            <input type="text" class="theater-input" id="theater-jimaku-key" placeholder="Jimaku API Key" value="${escapeHtml(this.jimakuProvider.loadSavedApiKey())}" />
            <div style="display:flex;gap:var(--space-2);">
              <input type="text" class="theater-input" id="theater-jimaku-query" placeholder="Anime or Drama Title..." />
              <button type="button" class="theater-btn theater-btn-primary" id="theater-jimaku-search-btn">Search</button>
            </div>
            <div class="theater-search-results" id="theater-jimaku-results"></div>
          </div>
        </div>
      </div>
    `;

    this.videoEl = this.container.querySelector('#theater-video-player');
    this.playerAdapter.setVideoElement(this.videoEl);

    // Mount Watch Panel reusing VocabWatchView with the PlayerAdapter & its LinkStore!
    const watchContainer = this.container.querySelector('#theater-watch-container');
    if (watchContainer) {
      this.watchView = new VocabWatchView({
        linkClient: this.playerAdapter,
        linkStore: this.linkStore
      });
      this.watchView.mount(watchContainer);
    }
  }

  setupEvents() {
    if (!this.container) return;

    const videoInput = this.container.querySelector('#theater-video-input');
    const subInput = this.container.querySelector('#theater-sub-input');
    const emptyOpenBtn = this.container.querySelector('#theater-empty-open-btn');
    const dismissErrBtn = this.container.querySelector('#theater-dismiss-error');
    const dropzone = this.container.querySelector('#theater-dropzone');
    const jimakuBtn = this.container.querySelector('#theater-jimaku-btn');
    const closeJimakuBtn = this.container.querySelector('#theater-close-jimaku');
    const searchJimakuBtn = this.container.querySelector('#theater-jimaku-search-btn');

    if (emptyOpenBtn && videoInput) {
      emptyOpenBtn.addEventListener('click', () => videoInput.click());
    }

    if (dismissErrBtn) {
      dismissErrBtn.addEventListener('click', () => {
        this.lastError = null;
        const banner = this.container.querySelector('#theater-error-banner');
        if (banner) banner.style.display = 'none';
      });
    }

    // Video File Selection
    if (videoInput) {
      videoInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) this.openVideoFile(file);
      });
    }

    // Subtitle File Selection
    if (subInput) {
      subInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (file) await this.loadSubtitleFile(file);
      });
    }

    // Codec Error Detection on HTML5 video element
    if (this.videoEl) {
      this.videoEl.addEventListener('error', () => {
        const err = this.videoEl.error;
        let msg = 'Failed to play video file.';
        const isMkv = this.currentFileName?.toLowerCase().endsWith('.mkv');

        if (isMkv || err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          msg = 'MKV codec limit: Electron supports H.264, AAC, VP8, VP9, and AV1. Audio/video codecs like HEVC, AC3, or DTS are not natively supported. Please convert or remux the file to MP4 (H.264/AAC).';
        } else if (err?.message) {
          msg = `Playback error: ${err.message}`;
        }
        this.showError(msg);
      });
    }

    // Drag and Drop support with sidecar auto-detection
    const attachDropEvents = (targetEl) => {
      if (!targetEl) return;
      targetEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone?.classList.add('is-dragover');
      });
      targetEl.addEventListener('dragleave', () => {
        dropzone?.classList.remove('is-dragover');
      });
      targetEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropzone?.classList.remove('is-dragover');
        const files = Array.from(e.dataTransfer?.files || []);
        if (files.length === 0) return;

        // Auto-detect video vs subtitle files
        const videoFiles = files.filter(f => /\.(mp4|mkv|webm)$/i.test(f.name));
        const subFiles = files.filter(f => /\.(srt|ass|ssa|vtt)$/i.test(f.name));

        if (files.length > 1) {
          this.folderFiles = files;
        }

        if (videoFiles.length > 0) {
          videoFiles.sort((a, b) => naturalCompare(a, b));
          this.openVideoFile(videoFiles[0], files);
          if (subFiles.length > 0) {
            await this.loadSubtitleFile(subFiles[0]);
          }
        } else if (subFiles.length > 0) {
          await this.loadSubtitleFile(subFiles[0]);
        }
      });
    };

    attachDropEvents(dropzone);
    attachDropEvents(this.videoEl);

    // Recent Files Dropdown (Slice 31)
    const recentBtn = this.container.querySelector('#theater-recent-btn');
    const recentDropdown = this.container.querySelector('#theater-recent-dropdown');
    if (recentBtn && recentDropdown) {
      recentBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.isRecentOpen = !this.isRecentOpen;
        recentDropdown.style.display = this.isRecentOpen ? 'flex' : 'none';
        if (this.isRecentOpen) {
          this.renderRecentFiles();
        }
      });
    }

    // Next Episode Button (Slice 31)
    const nextEpBtn = this.container.querySelector('#theater-next-episode-btn');
    if (nextEpBtn) {
      nextEpBtn.addEventListener('click', () => {
        this.playNextEpisode();
      });
    }

    // Subtitle Offset Controls (Slice 31)
    const btnOffsetMinus = this.container.querySelector('#btn-theater-offset-minus');
    const btnOffsetZero = this.container.querySelector('#btn-theater-offset-zero');
    const btnOffsetPlus = this.container.querySelector('#btn-theater-offset-plus');

    btnOffsetMinus?.addEventListener('click', () => {
      this.setSubtitleOffset(-100, true);
    });
    btnOffsetZero?.addEventListener('click', () => {
      this.setSubtitleOffset(0, false);
    });
    btnOffsetPlus?.addEventListener('click', () => {
      this.setSubtitleOffset(100, true);
    });

    // Keyboard Hotkeys (Slice 31 - shared with Slice 26)
    this._keyListener = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        this.playerAdapter.handleCommand('cmd.toggle');
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.playerAdapter.handleCommand('cmd.cue', { to: 'prev' });
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.playerAdapter.handleCommand('cmd.cue', { to: 'next' });
      } else if (e.code === 'KeyR' || e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        this.playerAdapter.handleCommand('cmd.cue', { to: 'replay' });
      } else if (e.code === 'KeyN' || e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        this.playNextEpisode();
      } else if (e.key === '[' || e.code === 'BracketLeft') {
        e.preventDefault();
        this.setSubtitleOffset(-100, true);
      } else if (e.key === ']' || e.code === 'BracketRight') {
        e.preventDefault();
        this.setSubtitleOffset(100, true);
      } else if (e.key === '\\' || e.code === 'Backslash' || e.key === '0') {
        e.preventDefault();
        this.setSubtitleOffset(0, false);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._keyListener);
    }

    // Jimaku Search Modal Events
    if (jimakuBtn) {
      jimakuBtn.addEventListener('click', () => {
        this.isJimakuOpen = true;
        const modal = this.container.querySelector('#theater-jimaku-modal');
        if (modal) modal.style.display = 'flex';
      });
    }

    if (closeJimakuBtn) {
      closeJimakuBtn.addEventListener('click', () => {
        this.isJimakuOpen = false;
        const modal = this.container.querySelector('#theater-jimaku-modal');
        if (modal) modal.style.display = 'none';
      });
    }

    if (searchJimakuBtn) {
      searchJimakuBtn.addEventListener('click', async () => {
        const keyInput = this.container.querySelector('#theater-jimaku-key');
        const queryInput = this.container.querySelector('#theater-jimaku-query');
        const resultsEl = this.container.querySelector('#theater-jimaku-results');

        if (keyInput?.value) {
          this.jimakuProvider.setApiKey(keyInput.value);
        }

        const query = queryInput?.value?.trim();
        if (!query) return;

        if (resultsEl) resultsEl.innerHTML = '<span class="text-xs text-muted">Searching Jimaku...</span>';

        try {
          const entries = await this.jimakuProvider.searchEntries(query);
          if (!resultsEl) return;
          if (entries.length === 0) {
            resultsEl.innerHTML = '<span class="text-xs text-muted">No subtitles found.</span>';
            return;
          }

          resultsEl.innerHTML = entries.slice(0, 10).map(e => `
            <div class="theater-result-item" data-id="${escapeHtml(e.id)}">
              <span>${escapeHtml(e.name || e.japanese_name || 'Entry')}</span>
              <button type="button" class="theater-btn theater-btn-primary theater-select-jimaku" data-id="${escapeHtml(e.id)}">Select</button>
            </div>
          `).join('');

          // Wire result clicks to fetch files
          resultsEl.querySelectorAll('.theater-select-jimaku').forEach(btn => {
            btn.addEventListener('click', async () => {
              const id = btn.getAttribute('data-id');
              try {
                resultsEl.innerHTML = '<span class="text-xs text-muted">Fetching files...</span>';
                const files = await this.jimakuProvider.getFilesForEntry(id);
                if (files.length === 0) {
                  resultsEl.innerHTML = '<span class="text-xs text-muted">No files for entry.</span>';
                  return;
                }
                resultsEl.innerHTML = files.slice(0, 5).map(f => `
                  <div class="theater-result-item" data-url="${escapeHtml(f.url)}">
                    <span>${escapeHtml(f.name || 'Subtitles')}</span>
                    <button type="button" class="theater-btn theater-download-jimaku" data-url="${escapeHtml(f.url)}" data-name="${escapeHtml(f.name || 'subtitles.ass')}">Download</button>
                  </div>
                `).join('');

                resultsEl.querySelectorAll('.theater-download-jimaku').forEach(dlBtn => {
                  dlBtn.addEventListener('click', async () => {
                    const url = dlBtn.getAttribute('data-url');
                    const name = dlBtn.getAttribute('data-name');
                    resultsEl.innerHTML = '<span class="text-xs text-muted">Downloading...</span>';
                    const dlResult = await this.jimakuProvider.downloadSubtitle(url, name);
                    this.playerAdapter.loadCues(dlResult.cues, name);
                    this.currentSubName = name;
                    this.isJimakuOpen = false;
                    const modal = this.container.querySelector('#theater-jimaku-modal');
                    if (modal) modal.style.display = 'none';
                    this.updateLabels();
                  });
                });
              } catch (err) {
                resultsEl.innerHTML = `<span class="text-xs text-danger">${escapeHtml(err.message)}</span>`;
              }
            });
          });
        } catch (err) {
          if (resultsEl) resultsEl.innerHTML = `<span class="text-xs text-danger">${escapeHtml(err.message)}</span>`;
        }
      });
    }
  }

  showError(message) {
    this.lastError = message;
    const banner = this.container?.querySelector('#theater-error-banner');
    const text = this.container?.querySelector('#theater-error-text');
    if (banner && text) {
      text.textContent = message;
      banner.style.display = 'flex';
    }
  }

  openVideoFile(file, siblingFiles = null) {
    this.currentFileName = file.name;
    this.lastError = null;
    this.addRecentFile(file);
    if (Array.isArray(siblingFiles) && siblingFiles.length > 0) {
      this.folderFiles = siblingFiles;
    }
    this.nextEpisodeFile = findNextEpisode(file.name, this.folderFiles);
    const placeholder = this.container?.querySelector('#theater-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    this.playerAdapter.attachFile(file, file.name);
    this.updateLabels();
    this.updateNextEpisodeButton();
  }

  async loadSubtitleFile(file) {
    try {
      const text = await file.text();
      const parsed = SubtitleParser.parseSubtitles(text, file.name);
      this.playerAdapter.loadCues(parsed, file.name);
      this.currentSubName = file.name;
      this.updateLabels();
    } catch (err) {
      this.showError(`Failed to load subtitle: ${err.message}`);
    }
  }

  updateLabels() {
    const label = this.container?.querySelector('#theater-file-label');
    if (label) {
      label.textContent = this.currentFileName || 'No video loaded';
    }
  }

  unmount() {
    if (this._keyListener && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._keyListener);
      this._keyListener = null;
    }
    if (this.watchView && typeof this.watchView.unmount === 'function') {
      this.watchView.unmount();
    }
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
  }
}

/**
 * Auto-inject "Open a video file" button into Vocab > Watch view
 */
export function injectTheaterIntoWatch() {
  if (typeof document === 'undefined') return;

  const inject = () => {
    const watchWrapper = document.querySelector('.watch-view-wrapper');
    if (watchWrapper && !document.getElementById('watch-theater-open-btn')) {
      const stateCard = watchWrapper.querySelector('.watch-state-card');
      if (stateCard) {
        const btn = document.createElement('button');
        btn.id = 'watch-theater-open-btn';
        btn.type = 'button';
        btn.className = 'watch-ctrl-btn';
        btn.style.marginTop = 'var(--space-3)';
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.gap = 'var(--space-2)';
        btn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          <span>Open a video file</span>
        `;
        btn.addEventListener('click', () => {
          const container = document.getElementById('vocab-watch-container');
          if (container) {
            const theater = new TheaterView();
            container.__theaterInstance = theater;
            theater.mount(container);
          }
        });
        stateCard.appendChild(btn);
      }
    }
  };

  inject();
  const observer = new MutationObserver(inject);
  const target = document.getElementById('vocab-watch-container');
  if (target) {
    observer.observe(target, { childList: true, subtree: true });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectTheaterIntoWatch);
  } else {
    injectTheaterIntoWatch();
  }
}
