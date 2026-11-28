/**
 * Kiroku Note Desktop — Anime & Media Immersion View
 * Supports Anime, YouTube, and TV Show categories with:
 * - Active video stream indicator pill
 * - Ghibli animated tribute empty state
 * - Media series poster grid with comprehension % and watch time
 * - Dedicated Series Detail Page (Episodes, Mined Cards Deck, Pre-Watch Primer & Study)
 */

import { LinkStore } from '../services/link_store.js';
import { LinkMineService } from '../services/link_mine.js';
import { apiClient } from '../services/api_client.js';
import { escapeHtml } from '../utils/sanitizer.js';
import { getUniversalJlptLevel, getUniversalAnkiDeck } from '../utils/learner.js';
import { JimakuSearchProvider } from './theater.js';
import { SubtitleParser } from '../lib-shared/subtitle_parser.mjs';

let _sharedLinkStore = null;
let _sharedLinkMineService = null;

export function getSharedLink(options = {}) {
  if (!_sharedLinkStore) {
    _sharedLinkStore = options.linkStore || new LinkStore();
  }
  if (!_sharedLinkMineService) {
    _sharedLinkMineService = options.linkMineService || new LinkMineService({
      linkStore: _sharedLinkStore,
      apiClient: options.apiClient || apiClient
    });
  }
  return {
    linkStore: _sharedLinkStore,
    linkMineService: _sharedLinkMineService
  };
}

export class AnimeView {
  constructor(router, options = {}) {
    this.router = router;
    this.keepAlive = true;
    this.options = options;
    this.apiClient = options.apiClient || apiClient;
    this.container = null;
    
    // Services
    const shared = getSharedLink(options);
    this.linkStore = options.linkStore || shared.linkStore;
    this.linkMineService = options.linkMineService || shared.linkMineService;

    // View State
    this.activeCategory = 'anime'; // 'anime' | 'youtube' | 'tv' | 'all'
    let savedLang = 'en';
    try {
      savedLang = localStorage.getItem('kiroku_anime_title_lang') || 'en';
    } catch (_) {}
    this.titleLang = (savedLang === 'jp') ? 'jp' : 'en';
    this.seriesList = [];
    this.selectedSeries = null;
    this.seriesDetailTab = 'episodes'; // 'episodes' | 'cards' | 'primer'
    this.seriesCards = [];
    this.selectedEpisodePrimer = null;
    this.expandedEpisodeHash = null;
    this.episodeInspectorCache = new Map();
    this.loadingInspectorHash = null;
    this.wordsViewMode = 'gap'; // 'gap' | 'all'
    this.wordsExpanded = false;
    this.jlptFilter = 'all'; // 'all' | 'target' | 'reach' | 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
    this.kanjiCache = new Map();
    this.primerCache = new Map();
    this.primerLoading = false;
    this.primerStatusText = '';
    this.primerError = '';
    this.primerQuizState = {};
    this.reviewSession = null;
    this._reviewKeyHandler = null;
    this.isLoading = false;
    this.loadState = 'idle'; // 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'auth_error'
    this.loadErrorMessage = '';
    this.backendPort = 21828;
    this._lastFetchAt = 0;
    this.isSyncing = false;
    this.syncStatus = 'idle'; // 'idle' | 'syncing' | 'synced' | 'error'
    this.syncProgressPct = 0;
    this.syncProgressText = '';
    this._syncHideTimer = null;
    this._autoSyncTimer = null;
  }

  getSeriesTitle(item, lang = this.titleLang) {
    if (!item) return '';
    if (lang === 'jp') {
      return item.title_native || item.series_title_native || item.series || '';
    }
    return item.title_english || item.series_title_english || item.series || '';
  }

  _mergeEpisodesIntoList(curEps, incomingEps = []) {
    for (const ep of (incomingEps || [])) {
      let epNum = Number(ep.episode_number || 0);
      if (!epNum) {
        const m = String(ep.title || ep.hash || '').match(/\d+/);
        epNum = m ? parseInt(m[0], 10) : 1;
      }

      const existing = curEps.find(e => {
        if (e.hash && ep.hash && e.hash === ep.hash) return true;
        if (e.episode_key && ep.episode_key && e.episode_key === ep.episode_key) return true;
        let eNum = Number(e.episode_number || 0);
        if (!eNum) {
          const m = String(e.title || e.hash || '').match(/\d+/);
          eNum = m ? parseInt(m[0], 10) : 0;
        }
        return epNum > 0 && eNum === epNum;
      });

      if (!existing) {
        curEps.push({ ...ep, episode_number: epNum });
      } else {
        existing.last_position_ms = Math.max(Number(existing.last_position_ms || 0), Number(ep.last_position_ms || 0));
        existing.duration_ms = Math.max(Number(existing.duration_ms || 0), Number(ep.duration_ms || 0));
        existing.completed = existing.completed || ep.completed;
        existing.mined = Math.max(Number(existing.mined || 0), Number(ep.mined || 0));
        existing.known_pct = Math.max(Number(existing.known_pct || 0), Number(ep.known_pct || 0));
        if (ep.has_cues && !existing.has_cues) {
          existing.has_cues = true;
          if (ep.hash) existing.hash = ep.hash;
        }
        if (!existing.poster_url && ep.poster_url) existing.poster_url = ep.poster_url;
        if (!existing.title && ep.title) existing.title = ep.title;
      }
    }
    curEps.sort((a, b) => (Number(a.episode_number || 0) - Number(b.episode_number || 0)));
    return curEps;
  }

  deduplicateSeriesList(list = []) {
    if (!Array.isArray(list) || list.length === 0) return [];
    const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s\-_!?:;.,'"()[\]{}]+/g, '');
    const hasLatin = (str) => /[a-zA-Z]/.test(str || '');
    const isJp = (str) => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(str || '');

    // Extract season/special token to distinguish seasons and specials
    const getSeasonToken = (item) => {
      const titles = [item.series, item.title_english, item.title_native, item.series_title, item.title_romaji].filter(Boolean);
      for (const t of titles) {
        const m = String(t).match(/\b(?:season\s*(\d+)|s(\d+)(?!e\d)|(\d+)(?:nd|rd|th)?\s*season|part\s*(\d+)|cour\s*(\d+)|ova|movie|special)\b/i);
        if (m) {
          const rawTok = m[0].toLowerCase().replace(/\s+/g, '');
          const numMatch = rawTok.match(/^(?:season(\d+)|s(\d+)|(\d+)(?:nd|rd|th)?season)$/);
          if (numMatch) {
            const n = Number(numMatch[1] || numMatch[2] || numMatch[3]);
            return n === 1 ? '' : `s${n}`;
          }
          return rawTok;
        }
      }
      return '';
    };

    const unified = [];

    for (const item of list) {
      if (!item) continue;
      const sLower = String(item.series || item.series_title || item.title_english || '').toLowerCase();
      // Only filter explicit test fixtures, NEVER legitimate anime keywords (e.g. Frieren)
      if (sLower === 'test-series' || sLower === 'test-anime' || sLower.startsWith('test_') || sLower.startsWith('test-') || sLower.startsWith('mock-')) {
        continue;
      }

      const itemPoster = (item.poster_url || '').trim();
      const itemSeason = getSeasonToken(item);
      const itemNames = [item.series, item.title_english, item.title_native, item.series_title, item.title_romaji]
        .filter(Boolean)
        .map(norm);

      let found = null;
      for (const cur of unified) {
        const curSeason = getSeasonToken(cur);
        // Do not merge different seasons or specials together (including Season 1 vs Season 2+)
        if (itemSeason !== curSeason) {
          continue;
        }

        // Match by exact poster url if present
        if (itemPoster && cur.poster_url && norm(cur.poster_url) === norm(itemPoster)) {
          found = cur;
          break;
        }

        // Match by title normalization
        const curNames = [cur.series, cur.title_english, cur.title_native, cur.series_title, cur.title_romaji]
          .filter(Boolean)
          .map(norm);
        if (itemNames.some(n => curNames.includes(n))) {
          found = cur;
          break;
        }
      }

      if (!found) {
        const copy = {
          ...item,
          episodes: this._mergeEpisodesIntoList([], item.episodes)
        };
        if (!copy.title_english && hasLatin(copy.series)) copy.title_english = copy.series;
        if (!copy.title_native && isJp(copy.series)) copy.title_native = copy.series;
        unified.push(copy);
      } else {
        // Reconcile and preserve metadata
        if (!found.poster_url && item.poster_url) found.poster_url = item.poster_url;
        if (!found.synopsis && item.synopsis) found.synopsis = item.synopsis;
        if (item.synopsis && found.synopsis && item.synopsis.length > found.synopsis.length) {
          found.synopsis = item.synopsis;
        }

        if (!hasLatin(found.series) && hasLatin(item.series)) {
          found.title_native = found.title_native || found.series;
          found.series = item.series;
        }
        if (item.title_english && !found.title_english) found.title_english = item.title_english;
        if (hasLatin(item.series) && !found.title_english) found.title_english = item.series;
        if (item.title_native && !found.title_native) found.title_native = item.title_native;
        if (isJp(item.series) && !found.title_native) found.title_native = item.series;

        // Reconcile episodes without duplicating episode numbers
        found.episodes = this._mergeEpisodesIntoList(found.episodes || [], item.episodes);
      }
    }

    return unified.filter(s => Array.isArray(s.episodes) && s.episodes.some(ep => Number(ep?.mined || 0) >= 1));
  }

  setTitleLang(lang) {
    if (lang !== 'en' && lang !== 'jp') return;
    this.titleLang = lang;
    try {
      localStorage.setItem('kiroku_anime_title_lang', lang);
    } catch (_) {}
    if (this.selectedSeries) {
      this.renderSeriesDetail();
    } else {
      this.render();
    }
  }


  async mount(container) {
    this.container = container;
    try {
      this.learnerLevel = await getUniversalJlptLevel();
    } catch (_) {
      this.learnerLevel = 'N3';
    }
    if (!this.boundLearnerLevelHandler) {
      this.boundLearnerLevelHandler = (e) => {
        const newLevel = e?.detail?.level;
        if (newLevel) {
          this.learnerLevel = newLevel;
          this.episodeInspectorCache.clear();
          if (this.expandedEpisodeHash && this.container) {
            this.toggleEpisodeInspector(this.expandedEpisodeHash, true);
          }
        }
      };
      if (typeof window !== 'undefined') {
        window.addEventListener('kiroku:learner-level-changed', this.boundLearnerLevelHandler);
      }
    }
    if (!this._boundAuthChangedHandler) {
      this._boundAuthChangedHandler = (e) => {
        const user = e?.detail?.user ?? null;
        if (user && (this.loadState === 'auth_error' || !this.seriesList || this.seriesList.length === 0)) {
          this.fetchWatchHistory();
        }
      };
      if (typeof window !== 'undefined') {
        window.addEventListener('kiroku:auth-changed', this._boundAuthChangedHandler);
      }
    }
    try {
      const info = await this.apiClient.getBackendInfo();
      if (info && info.port) this.backendPort = info.port;
    } catch (_) {}

    // Hydrate offline anime cache if available for instant non-blocking render
    try {
      if (typeof localStorage !== 'undefined') {
        const rawCached = localStorage.getItem('kiroku_anime_series_cache');
        if (rawCached) {
          const cached = JSON.parse(rawCached);
          if (Array.isArray(cached) && cached.length > 0) {
            this.seriesList = this.deduplicateSeriesList(cached);
            this.loadState = 'success';
          }
        }
      }
    } catch (_) {}

    this.render();
    await this.fetchWatchHistory();
    this.triggerAutoSync(1500);
  }

  async fetchWatchHistory() {
    this.isLoading = true;
    if (!this.seriesList || this.seriesList.length === 0) {
      this.loadState = 'loading';
    }
    try {
      const data = await this.apiClient.request('/api/link/series');
      this.seriesList = this.deduplicateSeriesList(Array.isArray(data) ? data : []);
      this.loadState = this.seriesList.length > 0 ? 'success' : 'empty';
      this.loadErrorMessage = '';
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('kiroku_anime_series_cache', JSON.stringify(this.seriesList));
        }
      } catch (_) {}
      try {
        const sess = await this.apiClient.request('/api/link/sessions');
        this.recentSessions = Array.isArray(sess) ? sess : [];
      } catch (e) {
        this.recentSessions = [];
      }
    } catch (err) {
      console.warn('[AnimeView] Failed to load series:', err);
      // If we already have cached series, keep showing them and gracefully avoid breaking UI
      if (this.seriesList && this.seriesList.length > 0) {
        this.loadState = 'success';
        return;
      }
      this.seriesList = [];
      this.recentSessions = this.recentSessions || [];
      const status = err?.status || (String(err?.message || '').includes('401') ? 401 : null);
      if (status === 401) {
        this.loadState = 'auth_error';
        this.loadErrorMessage = 'Sign in with Google to synchronize your anime watch history across devices.';
      } else if (status === 502 || status === 504 || status === 0) {
        this.loadState = 'waking_up';
        this.loadErrorMessage = 'Loading Anime Library...';
        if (!this._retryTimer) {
          this._retryTimer = setTimeout(() => {
            this._retryTimer = null;
            this.fetchWatchHistory();
          }, 4500);
        }
      } else {
        this.loadState = 'error';
        this.loadErrorMessage = 'Backend unavailable. No watch history yet received from offline backend.';
      }
    } finally {
      this.isLoading = false;
      if (this.selectedSeries) {
        // Do not clobber the active Series Detail / Episode Inspector DOM on background refresh
        return;
      }
      const historyEl = this.container?.querySelector?.('#anime-history-list');
      if (historyEl) {
        historyEl.innerHTML = this._renderGridContent();
        this.setupEvents();
      } else {
        this.render();
      }
    }
  }

  render() {
    if (!this.container) return;
    this._ensureDelegatedClickHandler();

    if (this.selectedSeries) {
      this.renderSeriesDetail();
      return;
    }

    this.container.innerHTML = `
      <div class="anime-view-wrapper">
        <div class="anime-view-container">
          <!-- Page Header: Uplifting Letters & Katakana Subhead -->
          <div class="anime-header-row grammar-header-row">
            <div>
              <div class="grammar-brand-header" aria-label="Anime アニメ">
                <h1 class="grammar-word-title" aria-label="ANIME">
                  <span class="hero-letter">A</span><span class="hero-letter">N</span><span class="hero-letter">I</span><span class="hero-letter">M</span><span class="hero-letter">E</span>
                </h1>
                <span class="grammar-word-kanji" aria-label="アニメ">
                  <span class="hero-letter">ア</span><span class="hero-letter">ニ</span><span class="hero-letter">メ</span>
                </span>
              </div>
            </div>

            <!-- Right Controls: Sync Button, Language Toggle & Category Section Pills -->
            <div class="anime-header-right">
              <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm ${this.isSyncing ? 'is-syncing' : ''}" id="btn-anime-sync" title="Sync anime watch history, posters & cards to cloud">
                <svg class="anime-sync-icon ${this.isSyncing ? 'is-spinning' : ''}" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
                </svg>
                <span id="label-anime-sync">${this.isSyncing ? 'Syncing...' : (this.syncStatus === 'synced' ? 'Synced' : 'Sync Cloud')}</span>
              </button>

              <div class="anime-lang-toggle" role="group" aria-label="Title Language">
                <button type="button" class="anime-lang-btn ${this.titleLang === 'en' ? 'active' : ''}" data-lang="en" title="Show English titles">EN</button>
                <button type="button" class="anime-lang-btn ${this.titleLang === 'jp' ? 'active' : ''}" data-lang="jp" title="Show Japanese titles">日本語</button>
              </div>

              <div class="anime-category-pills" role="tablist">
                <button class="anime-cat-pill ${this.activeCategory === 'anime' ? 'active' : ''}" data-cat="anime">Anime</button>
                <button class="anime-cat-pill ${this.activeCategory === 'youtube' ? 'active' : ''}" data-cat="youtube">YouTube</button>
                <button class="anime-cat-pill ${this.activeCategory === 'tv' ? 'active' : ''}" data-cat="tv">TV Shows</button>
                <button class="anime-cat-pill ${this.activeCategory === 'all' ? 'active' : ''}" data-cat="all">All Media</button>
              </div>
            </div>
          </div>

          <!-- Non-blocking Inline Sync Progress Bar -->
          <div class="anime-sync-progress-wrap" id="anime-sync-progress" ${this.isSyncing || this.syncProgressText ? '' : 'hidden'}>
            <div class="anime-sync-progress-meta">
              <span class="anime-sync-progress-text" id="anime-sync-progress-text">${escapeHtml(this.syncProgressText || 'Syncing...')}</span>
              <span class="anime-sync-progress-pct" id="anime-sync-progress-pct">${Math.round(this.syncProgressPct || 0)}%</span>
            </div>
            <div class="anime-sync-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(this.syncProgressPct || 0)}">
              <div class="anime-sync-progress-fill ${this.syncStatus === 'synced' ? 'is-done' : (this.syncStatus === 'error' ? 'is-error' : '')}" id="anime-sync-progress-fill" style="width: ${Math.max(0, Math.min(100, this.syncProgressPct || 0))}%"></div>
            </div>
          </div>

          <!-- Main Content: History List / Series Grid or Empty State -->
          <div id="anime-history-list" class="anime-history-list-root">
            ${this._renderGridContent()}
          </div>
        </div>
      </div>
    `;

    this.setupEvents();
  }


  isSeriesPinned(seriesName) {
    try {
      const storage = typeof localStorage !== 'undefined' ? localStorage : this._memoryStorage;
      if (!storage) return false;
      const saved = JSON.parse(storage.getItem('kiroku_anime_pinned') || storage.getItem('kiroku_anime_bookmarks') || '[]');
      return Array.isArray(saved) && saved.includes(seriesName);
    } catch (e) {
      return false;
    }
  }

  toggleSeriesPin(seriesName) {
    try {
      if (typeof localStorage === 'undefined' && !this._memoryStorage) {
        this._memoryStorage = {
          _data: new Map(),
          getItem(k) { return this._data.get(k) || null; },
          setItem(k, v) { this._data.set(k, String(v)); }
        };
      }
      const storage = typeof localStorage !== 'undefined' ? localStorage : this._memoryStorage;
      let saved = JSON.parse(storage.getItem('kiroku_anime_pinned') || storage.getItem('kiroku_anime_bookmarks') || '[]');
      if (!Array.isArray(saved)) saved = [];
      if (saved.includes(seriesName)) {
        saved = saved.filter(s => s !== seriesName);
      } else {
        saved.push(seriesName);
      }
      storage.setItem('kiroku_anime_pinned', JSON.stringify(saved));
      if (this.container) this.render();
    } catch (e) {
      console.warn('[AnimeView] Failed to toggle pin:', e);
    }
  }

  isSeriesBookmarked(seriesName) {
    try {
      const storage = typeof localStorage !== 'undefined' ? localStorage : this._memoryStorage;
      if (!storage) return false;
      const saved = JSON.parse(storage.getItem('kiroku_anime_bookmarks') || '[]');
      return Array.isArray(saved) && saved.includes(seriesName);
    } catch (e) {
      return false;
    }
  }

  toggleSeriesBookmark(seriesName) {
    try {
      if (typeof localStorage === 'undefined' && !this._memoryStorage) {
        this._memoryStorage = {
          _data: new Map(),
          getItem(k) { return this._data.get(k) || null; },
          setItem(k, v) { this._data.set(k, String(v)); }
        };
      }
      const storage = typeof localStorage !== 'undefined' ? localStorage : this._memoryStorage;
      let saved = JSON.parse(storage.getItem('kiroku_anime_bookmarks') || '[]');
      if (!Array.isArray(saved)) saved = [];
      if (saved.includes(seriesName)) {
        saved = saved.filter(s => s !== seriesName);
      } else {
        saved.push(seriesName);
      }
      storage.setItem('kiroku_anime_bookmarks', JSON.stringify(saved));
      if (this.container) this.render();
    } catch (e) {
      console.warn('[AnimeView] Failed to toggle bookmark:', e);
    }
  }

  calculateWatchProgress(seriesOrEps, maybeEps = null) {
    if (!seriesOrEps) return 0;
    const isArray = Array.isArray(seriesOrEps);
    const eps = isArray ? seriesOrEps : (maybeEps || seriesOrEps.episodes || []);
    if (!eps || eps.length === 0) return 0;

    let completedCount = 0;
    for (const ep of eps) {
      const durMs = ep.duration_ms || (ep.minutes && ep.minutes > 0 ? ep.minutes * 60000 : 24 * 60000);
      const posMs = ep.last_position_ms || 0;
      // An episode is completed only when logged playback position reaches at least 85% of duration
      if (durMs > 0 && posMs >= durMs * 0.85) {
        completedCount += 1;
      }
    }

    if (completedCount === 0) return 0;

    const totalSeasonEpisodes = (!isArray && seriesOrEps.total_episodes && seriesOrEps.total_episodes > 0)
      ? seriesOrEps.total_episodes
      : (eps.length > 0 ? eps.length : 1);

    return Math.min(100, Math.round((completedCount / totalSeasonEpisodes) * 100));
  }

  _renderGridContent() {
    const isWeirdWebItem = (s) => {
      const sName = (s.series || '').trim();
      const isUrl = /^https?:\/\//i.test(sName) || /^www\./i.test(sName) || /\.(?:com|org|net|io|edu|gov|html|php)(?:\/|$)/i.test(sName);
      const isWebType = (s.media_type || '').toLowerCase() === 'web';
      return isUrl || isWebType;
    };

    const deduplicated = this.deduplicateSeriesList(this.seriesList || []);
    const filtered = (this.activeCategory === 'all'
      ? deduplicated
      : deduplicated.filter(s => (s.media_type || 'anime').toLowerCase() === this.activeCategory)
    ).filter(s => !isWeirdWebItem(s));

    // 1. Library loading state (initial load or reconnecting during cold starts)
    if ((this.isLoading || this.loadState === 'waking_up') && (!this.seriesList || this.seriesList.length === 0)) {
      return `
        <div class="anime-loading-state" role="status">
          <div class="anime-spinner"></div>
          <p class="anime-loading-text">Loading Anime Library...</p>
        </div>
      `;
    }

    // 2. Authentication failure state
    if (this.loadState === 'auth_error' && (!this.seriesList || this.seriesList.length === 0)) {
      return `
        <div class="anime-error-state anime-auth-error-state" role="alert">
          <div class="anime-error-badge">Authentication Required</div>
          <h2 class="anime-error-title">Sign-in Required</h2>
          <p class="anime-error-desc">${escapeHtml(this.loadErrorMessage)}</p>
          <div class="flex items-center gap-2 mt-2">
            <button type="button" class="tactile-btn tactile-btn-primary" id="btn-anime-auth-login">Sign In with Google</button>
            <button type="button" class="tactile-btn tactile-btn-ghost" id="btn-anime-auth-guest">Browse as Guest</button>
          </div>
        </div>
      `;
    }

    // 3. Backend unavailable / API error state (never show empty library if API request failed)
    if (this.loadState === 'error' && (!this.seriesList || this.seriesList.length === 0)) {
      return `
        <div class="anime-error-state" role="alert">
          <div class="anime-error-badge">Connection Issue</div>
          <h2 class="anime-error-title">Backend Unavailable</h2>
          <p class="anime-error-desc">${escapeHtml(this.loadErrorMessage)}</p>
          <button type="button" class="tactile-btn tactile-btn-primary" id="btn-anime-retry-load">Retry Connection</button>
        </div>
      `;
    }

    // 4. Empty state with continuous Ghibli Tribute SVG
    if (!filtered || filtered.length === 0) {
      return `
        <div class="anime-empty-state">
          <div class="anime-empty-illustration">
            <img src="./ui/assets/ghibli/Gibli Tribute.svg" class="anime-ghibli-svg" alt="Ghibli Tribute animation" />
          </div>
          <h2 class="anime-empty-title">Nothing to show yet</h2>
          <p class="anime-empty-desc">No watch history yet. Start watching anime, YouTube, or Netflix with the Kiroku extension to track series, mined words, and comprehension.</p>
        </div>
      `;
    }

    // Sort pinned series to the top of the grid
    const sorted = [...filtered].sort((a, b) => {
      const aPinned = this.isSeriesPinned(a.series);
      const bPinned = this.isSeriesPinned(b.series);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return 0;
    });

    // Media Poster Grid — Exact match to Manga card structure & hover
    const port = this.backendPort || 21828;
    const cardsHtml = sorted.map(item => {
      const canonicalSeries = item.series || '';
      const displayTitle = this.getSeriesTitle(item);
      const seriesTitleAttr = escapeHtml(canonicalSeries);
      const displayTitleHtml = escapeHtml(displayTitle);
      const eps = item.episodes || [];
      const epCount = eps.length;
      const avgKnown = epCount > 0 ? Math.round(eps.reduce((a, b) => a + (b.known_pct || 0), 0) / epCount) : 0;
      const watchPct = this.calculateWatchProgress(item);
      const poster = item.poster_url || '';
      const isRemoteWeb = typeof window !== 'undefined' &&
        window.location.protocol === 'https:' &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1';
      const proxyBase = isRemoteWeb ? window.location.origin : `http://127.0.0.1:${port}`;
      const proxyUrl = poster && poster.startsWith('http')
        ? `${proxyBase}/api/link/poster?url=${encodeURIComponent(poster)}`
        : '';
      const isPinned = this.isSeriesPinned(item.series);

      return `
        <div class="anime-poster-card" data-series="${seriesTitleAttr}">
          <div class="poster-image-wrap">
            ${poster 
              ? `<img src="${escapeHtml(poster)}" alt="${displayTitleHtml}" class="poster-img" referrerpolicy="no-referrer" loading="lazy" onerror="if (!this.dataset.triedProxy && '${proxyUrl}') { this.dataset.triedProxy = '1'; this.src = '${escapeHtml(proxyUrl)}'; } else { this.onerror=null; this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='flex'; }" />
                 <div class="poster-placeholder" style="display: none;"><span>${displayTitle.slice(0, 2).toUpperCase()}</span></div>` 
              : `<div class="poster-placeholder"><span>${displayTitle.slice(0, 2).toUpperCase()}</span></div>`
            }
            <button type="button" class="anime-card-bookmark-btn ${isPinned ? 'has-bookmark is-active' : ''}" data-action="toggle-pin" data-series="${seriesTitleAttr}" title="${isPinned ? 'Unpin series from top' : 'Pin series to top of Anime tab'}">
              <svg class="anime-bookmark-svg" viewBox="0 0 24 24" width="15" height="15">
                <path class="anime-bookmark-ribbon" d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            <div class="anime-poster-progress-badge poster-score-badge">${watchPct}%</div>
          </div>
          <div class="poster-meta">
            <div class="poster-title-row">
              <h3 class="poster-title" title="${displayTitleHtml}">${displayTitleHtml}</h3>
              <button type="button" class="anime-poster-more-btn" data-series="${seriesTitleAttr}" title="Series Options">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
                </svg>
              </button>
            </div>
            <div class="poster-subtext">
              <span class="poster-count-badge">${epCount > 0 ? (epCount === 1 ? '1 Episode' : `${epCount} Episodes`) : 'No episodes'}</span>
              <div class="sr-only" style="display:none;">
                ${eps.map(e => `<span>${escapeHtml(e.title || '')} (${Math.round(e.known_pct || 0)}% known)</span>`).join('')}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="anime-series-grid">
        ${cardsHtml}
      </div>
    `;
  }

  async openSeriesDetail(seriesObj, sourceRect = null) {
    this.selectedSeries = seriesObj;
    this.seriesDetailTab = 'episodes';
    this.selectedEpisodePrimer = null;
    this.seriesCards = [];

    // Hydrate cached series cards & episode inspector for instant render
    const cardsCacheKey = `kiroku:anime-cards:${seriesObj.series}`;
    if (typeof localStorage !== 'undefined') {
      try {
        const cachedCards = localStorage.getItem(cardsCacheKey);
        if (cachedCards) {
          const parsed = JSON.parse(cachedCards);
          if (Array.isArray(parsed)) this.seriesCards = parsed;
        }
      } catch (_) {}
    }

    // Render immediately so user sees smooth FLIP glide start from clicked position
    this.renderSeriesDetail(sourceRect);

    // Fetch mined cards for this series
    try {
      const freshCards = await this.apiClient.getSeriesCards(seriesObj.series);
      this.seriesCards = Array.isArray(freshCards) ? freshCards : [];
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem(cardsCacheKey, JSON.stringify(this.seriesCards)); } catch (_) {}
      }
      this._refreshContinueWatchingButton();
    } catch (e) {
      console.warn('[AnimeView] Failed to load cards for series:', e);
      if (!Array.isArray(this.seriesCards)) this.seriesCards = [];
    }

    // If series has episodes, auto-load primer and pre-warm analytics for first unwatched episode
    const episodes = seriesObj.episodes || [];
    const targetEp = episodes.find(ep => {
      const durMs = ep.duration_ms || (ep.minutes && ep.minutes > 0 ? ep.minutes * 60000 : 24 * 60000);
      const posMs = ep.last_position_ms || 0;
      return durMs > 0 ? (posMs < durMs * 0.85) : true;
    }) || episodes[0];

    if (targetEp && targetEp.hash) {
      const lvl = this.learnerLevel || 'N3';
      const inspCacheKey = `kiroku:anime-insp:${targetEp.hash}:${lvl}`;
      if (!this.episodeInspectorCache.has(targetEp.hash) && typeof localStorage !== 'undefined') {
        try {
          const cachedInsp = localStorage.getItem(inspCacheKey);
          if (cachedInsp) {
            const parsedInsp = JSON.parse(cachedInsp);
            if (parsedInsp) this.episodeInspectorCache.set(targetEp.hash, parsedInsp);
          }
        } catch (_) {}
      }
      try {
        this.selectedEpisodePrimer = await this.apiClient.getEpisodePrimer(targetEp.hash);
      } catch (e) {
        // primer optional fallback
      }
      if (!this.episodeInspectorCache.has(targetEp.hash)) {
        if (!this._inFlightInspectors) this._inFlightInspectors = new Map();
        const fetchPromise = this.apiClient.getEpisodeInspector(targetEp.hash, lvl).then(data => {
          this._inFlightInspectors.delete(targetEp.hash);
          if (data) {
            this.episodeInspectorCache.set(targetEp.hash, data);
            if (typeof localStorage !== 'undefined') {
              try { localStorage.setItem(inspCacheKey, JSON.stringify(data)); } catch (_) {}
            }
            if (this.expandedEpisodeHash === targetEp.hash && this.container) {
              const epGroup = this.container.querySelector(`.anime-episode-row[data-hash="${targetEp.hash}"]`)?.closest('.anime-episode-group');
              if (epGroup) {
                const currentDrawer = epGroup.querySelector('.anime-inline-inspector');
                const finalHtml = this._renderInlineEpisodeInspector(targetEp, data, false);
                if (currentDrawer) currentDrawer.outerHTML = finalHtml;
                const btn = epGroup.querySelector('.ep-inspect-toggle-btn');
                if (btn) btn.textContent = 'Collapse';
              }
            }
          }
          return data;
        }).catch(() => {
          this._inFlightInspectors.delete(targetEp.hash);
        });
        this._inFlightInspectors.set(targetEp.hash, fetchPromise);
      }
    }

    this._updateDetailSubtabContent();
  }

  _getSeriesContinueWatchUrl(seriesObj = this.selectedSeries) {
    if (!seriesObj) return '';
    const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim());
    const eps = Array.isArray(seriesObj.episodes) ? [...seriesObj.episodes] : [];
    eps.sort((a, b) => {
      const ta = Number(a?.last_watched_at || 0) || (a?.ts ? Date.parse(a.ts) || 0 : 0);
      const tb = Number(b?.last_watched_at || 0) || (b?.ts ? Date.parse(b.ts) || 0 : 0);
      return tb - ta;
    });
    for (const ep of eps) {
      if (isHttpUrl(ep?.source_url)) return ep.source_url.trim();
    }
    if (Array.isArray(this.seriesCards)) {
      for (const card of this.seriesCards) {
        if (isHttpUrl(card?.source_url)) return card.source_url.trim();
      }
    }
    return '';
  }

  _refreshContinueWatchingButton() {
    if (!this.container || !this.selectedSeries) return;
    const btn = this.container.querySelector('#anime-continue-watching-btn');
    if (!btn) return;
    const watchUrl = this._getSeriesContinueWatchUrl(this.selectedSeries);
    if (watchUrl) {
      btn.dataset.watchUrl = watchUrl;
      btn.title = watchUrl;
      btn.style.display = '';
    } else {
      btn.dataset.watchUrl = '';
      btn.style.display = 'none';
    }
  }

  renderSeriesDetail(sourceRect = null) {
    if (!this.container || !this.selectedSeries) return;
    this._ensureDelegatedClickHandler();

    const s = this.selectedSeries;
    const displayTitle = this.getSeriesTitle(s);
    const titleHtml = escapeHtml(displayTitle);
    const poster = s.poster_url || '';
    const port = this.backendPort || 21828;
    const isRemoteWeb = typeof window !== 'undefined' &&
      window.location.protocol === 'https:' &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1';
    const proxyBase = isRemoteWeb ? window.location.origin : `http://127.0.0.1:${port}`;
    const proxyUrl = poster && poster.startsWith('http')
      ? `${proxyBase}/api/link/poster?url=${encodeURIComponent(poster)}`
      : '';
    const rawSynopsis = s.synopsis || 'No synopsis available.';
    const paragraphs = rawSynopsis
      .replace(/<br\s*\/?>/gi, '\n')
      .split(/\n+/)
      .map(p => p.trim())
      .filter(Boolean);
    const synopsisHtml = paragraphs
      .map(p => `<p class="anime-synopsis-para">${escapeHtml(p)}</p>`)
      .join('');
    const eps = s.episodes || [];
    const epCount = eps.length;
    const totalMinutes = Math.round(eps.reduce((a, b) => a + Math.max(b.minutes || 0, (b.last_position_ms || 0) / 60000), 0));
    const avgKnown = epCount > 0 ? Math.round(eps.reduce((a, b) => a + (b.known_pct || 0), 0) / epCount) : 0;
    const watchPct = this.calculateWatchProgress(s);
    const currentType = s.media_type || 'anime';

    this.container.innerHTML = `
      <div class="anime-view-wrapper">
        <div class="anime-detail-container">
          <!-- Top Bar: Back Button, Language Toggle & Category -->
          <div class="anime-detail-top-bar">
            <button class="anime-back-btn" id="anime-back-btn" title="Back to Media Library">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>Back to Media Library</span>
            </button>
            <div class="anime-detail-top-actions">
              <div class="anime-lang-toggle" role="group" aria-label="Title Language">
                <button type="button" class="anime-lang-btn ${this.titleLang === 'en' ? 'active' : ''}" data-lang="en" title="Show English titles">EN</button>
                <button type="button" class="anime-lang-btn ${this.titleLang === 'jp' ? 'active' : ''}" data-lang="jp" title="Show Japanese titles">日本語</button>
              </div>
              <div class="anime-type-override-wrap">
                <span class="override-label">Category:</span>
                <select id="series-type-select" class="anime-type-select">
                  <option value="anime" ${currentType === 'anime' ? 'selected' : ''}>Anime</option>
                  <option value="youtube" ${currentType === 'youtube' ? 'selected' : ''}>YouTube</option>
                  <option value="tv" ${currentType === 'tv' ? 'selected' : ''}>TV Show</option>
                </select>
              </div>
              <button type="button" class="anime-btn-bin" id="anime-delete-series-btn" title="Remove series from library" aria-label="Remove series">
                <svg class="bin-animated-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path class="bin-lid" d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  <path class="bin-body" d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 5v6m4-6v6m4-6v6"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- Main Two-Column Layout: Poster & Title on Left, Immersion Deck on Right -->
          <div class="anime-detail-body">
            <!-- Left Column: Poster + Title below it + Metadata -->
            <aside class="anime-detail-left-col">
              <div class="detail-poster-wrap">
                ${poster 
                  ? `<img src="${escapeHtml(poster)}" alt="${titleHtml}" class="detail-poster-img" referrerpolicy="no-referrer" loading="lazy" onerror="if (!this.dataset.triedProxy && '${proxyUrl}') { this.dataset.triedProxy = '1'; this.src = '${escapeHtml(proxyUrl)}'; } else { this.onerror=null; this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='flex'; }" />
                     <div class="poster-placeholder" style="display: none;"><span>${displayTitle.slice(0, 2).toUpperCase()}</span></div>` 
                  : `<div class="poster-placeholder"><span>${displayTitle.slice(0, 2).toUpperCase()}</span></div>`
                }
                <div class="anime-poster-progress-badge">${watchPct}%</div>
              </div>
              
              <!-- Title strictly below the poster as requested -->
              <h1 class="anime-detail-left-title" title="${titleHtml}">${titleHtml}</h1>

              <!-- Left Column Stats & Synopsis -->
              <div class="anime-detail-left-meta">
                <div class="detail-stats-row">
                  <span class="detail-stat-pill score">${watchPct}% Watched</span>
                  <span class="detail-stat-pill">${s.total_episodes && s.total_episodes > epCount ? `${epCount} of ${s.total_episodes} Episodes` : (epCount === 1 ? '1 Episode' : `${epCount} Episodes`)}</span>
                  <span class="detail-stat-pill">${totalMinutes} min watched</span>
                  <span class="detail-stat-pill" id="detail-cards-mined-pill">${this.seriesCards.length} mined</span>
                </div>
                ${(() => {
                  const watchUrl = this._getSeriesContinueWatchUrl(s);
                  return `
                    <button type="button" class="anime-continue-watch-btn" id="anime-continue-watching-btn" data-watch-url="${escapeHtml(watchUrl)}" title="${escapeHtml(watchUrl || '')}" style="${watchUrl ? '' : 'display: none;'}">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                        <polygon points="6 4 20 12 6 20 6 4"></polygon>
                      </svg>
                      <span>Continue Watching</span>
                    </button>
                  `;
                })()}
                ${synopsisHtml ? `
                  <div class="anime-synopsis-section">
                    <h4 class="anime-about-heading">About</h4>
                    <div class="anime-synopsis-text">${synopsisHtml}</div>
                  </div>
                ` : ''}
              </div>
            </aside>

            <!-- Right Column: Navigation Tabs & Tab Content -->
            <main class="anime-detail-right-col">
              <!-- Subtabs -->
              <div class="anime-subtab-nav">
                <button class="anime-subtab ${this.seriesDetailTab === 'episodes' ? 'active' : ''}" data-subtab="episodes">
                  Episodes (${epCount})
                </button>
                <button class="anime-subtab ${this.seriesDetailTab === 'cards' ? 'active' : ''}" data-subtab="cards" id="detail-cards-subtab">
                  Mined Cards (${this.seriesCards.length})
                </button>
                <button class="anime-subtab ${this.seriesDetailTab === 'primer' ? 'active' : ''}" data-subtab="primer">
                  Pre-Watch Gap Words
                </button>
              </div>

              <!-- Subtab Content -->
              <div class="anime-subtab-content" id="anime-subtab-content">
                ${this._renderDetailTabContent()}
              </div>
            </main>
          </div>
        </div>
      </div>
      ${this._renderReviewOverlay()}
    `;

    this.setupDetailEvents();

    if (sourceRect && typeof sourceRect.width === 'number' && sourceRect.width > 0) {
      this._runPosterGlideAnimation(sourceRect);
    }
  }

  _runPosterGlideAnimation(sourceRect) {
    if (!this.container) return;
    const targetWrap = this.container.querySelector('.detail-poster-wrap');
    if (!targetWrap) return;

    const targetRect = targetWrap.getBoundingClientRect ? targetWrap.getBoundingClientRect() : null;
    if (!targetRect || !targetRect.width) return;

    const dx = sourceRect.left - targetRect.left;
    const dy = sourceRect.top - targetRect.top;
    const sw = sourceRect.width / targetRect.width;
    const sh = sourceRect.height / targetRect.height;

    // Apply inverted transform to start position
    targetWrap.style.transformOrigin = 'top left';
    targetWrap.style.transform = `translate(${dx}px, ${dy}px) scale(${sw}, ${sh})`;
    targetWrap.style.transition = 'none';
    targetWrap.style.zIndex = '50';
    targetWrap.style.boxShadow = '3px 3px 0 var(--gold)';
    targetWrap.style.borderColor = 'var(--gold)';

    const topBar = this.container.querySelector('.anime-detail-top-bar');
    const leftTitle = this.container.querySelector('.anime-detail-left-title');
    const leftMeta = this.container.querySelector('.anime-detail-left-meta');
    const rightCol = this.container.querySelector('.anime-detail-right-col');

    [topBar, leftTitle, leftMeta, rightCol].forEach(el => {
      if (el) {
        el.style.opacity = '0';
        el.style.transform = 'translateY(12px)';
        el.style.transition = 'none';
      }
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!targetWrap || !this.container) return;
        targetWrap.style.transition = 'transform 380ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 380ms ease-out, border-color 380ms ease-out';
        targetWrap.style.transform = 'translate(0px, 0px) scale(1, 1)';
        targetWrap.style.boxShadow = '3px 3px 0 var(--tactile-stroke)';
        targetWrap.style.borderColor = 'var(--tactile-stroke)';

        [topBar, leftTitle, leftMeta, rightCol].forEach((el, i) => {
          if (!el) return;
          el.style.transition = `opacity 280ms ease-out ${140 + i * 40}ms, transform 280ms cubic-bezier(0.16, 1, 0.3, 1) ${140 + i * 40}ms`;
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
        });
      });
    });
  }

  _updateDetailSubtabContent() {
    if (!this.container || !this.selectedSeries) return;
    const cardsPill = this.container.querySelector('#detail-cards-mined-pill');
    if (cardsPill) cardsPill.textContent = `${this.seriesCards.length} mined`;
    const cardsSubtab = this.container.querySelector('#detail-cards-subtab');
    if (cardsSubtab) cardsSubtab.textContent = `Mined Cards (${this.seriesCards.length})`;
    const contentEl = this.container.querySelector('#anime-subtab-content');
    if (contentEl) {
      contentEl.innerHTML = this._renderDetailTabContent();
      this._bindSubtabEvents(contentEl);
    }
  }

  _bindSubtabEvents(scopeEl) {
    if (!scopeEl) return;

    // Episode row gap primer buttons
    const primerBtns = scopeEl.querySelectorAll('.ep-primer-btn');
    primerBtns.forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const hash = btn.getAttribute('data-hash');
        if (hash) {
          await this.openEpisodePrimer(hash);
        }
      };
    });

    // Episode row inspection toggle buttons
    const inspectToggleBtns = scopeEl.querySelectorAll('.ep-inspect-toggle-btn');
    inspectToggleBtns.forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const hash = btn.getAttribute('data-hash');
        await this.toggleEpisodeInspector(hash);
      };
    });

    // Episode row delete buttons
    const deleteBtns = scopeEl.querySelectorAll('.ep-delete-btn');
    deleteBtns.forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const hash = btn.getAttribute('data-hash');
        if (!hash) return;
        const confirmed = await this.showConfirmModal({
          title: 'Remove Episode?',
          message: 'Are you sure you want to remove this episode from your library? Cards mined from this episode will remain in your study deck.',
          confirmText: 'Remove Episode'
        });
        if (!confirmed) return;
        const group = btn.closest('.anime-episode-group') || btn.closest('.anime-episode-row');
        if (group) {
          group.style.transition = 'all 160ms ease';
          group.style.opacity = '0';
          group.style.transform = 'scale(0.95)';
          setTimeout(() => group.remove(), 160);
        }
        if (this.selectedSeries && Array.isArray(this.selectedSeries.episodes)) {
          this.selectedSeries.episodes = this.selectedSeries.episodes.filter(ep => ep.hash !== hash);
        }
        try {
          await this.apiClient.request(`/api/link/episodes/${encodeURIComponent(hash)}`, { method: 'DELETE' });
        } catch (err) {
          console.warn('[AnimeView] Failed to delete episode record:', err);
        }
      };
    });

    // Row click expands episode inspector drawer
    const epRows = scopeEl.querySelectorAll('.anime-episode-row');
    epRows.forEach(row => {
      row.onclick = async (e) => {
        if (e.target.closest('.ep-primer-btn') || e.target.closest('.ep-inspect-toggle-btn') || e.target.closest('.ep-delete-btn')) {
          return;
        }
        const hash = row.getAttribute('data-hash');
        await this.toggleEpisodeInspector(hash);
      };
    });

    // Study primer button (handled by delegated handler too, kept for direct scope)
    const studyBtn = scopeEl.querySelector('#study-primer-btn');
    if (studyBtn) {
      studyBtn.onclick = () => {
        this.startPrimerReviewSession();
      };
    }
  }

  _renderDetailTabContent() {
    if (this.seriesDetailTab === 'episodes') {
      const rawEps = this.selectedSeries.episodes || [];
      if (rawEps.length === 0) {
        return `<div class="subtab-empty">No episodes recorded for this series.</div>`;
      }

      // Client-side deduplication by episode number: ensures duplicate episode hashes for the same episode merge seamlessly
      const epMap = new Map();
      for (let i = 0; i < rawEps.length; i++) {
        const ep = rawEps[i];
        const epNum = ep.episode_number || (function() {
          const m = ep.title?.match(/(?:episode|ep|e|s\d+e)\s*[-.:]?\s*0*(\d+)/i)
            || ep.title?.match(/第\s*0*(\d+)\s*[話話]/)
            || ep.title?.match(/[-_\s]0*(\d{1,3})(?:v\d+)?(?:[\s._-]|$)/)
            || ep.title?.match(/\b0*(\d{1,3})\b/);
          return m ? parseInt(m[1], 10) : 1;
        })();
        ep._computedEpNum = epNum;
        if (!epMap.has(epNum)) {
          epMap.set(epNum, { ...ep });
        } else {
          const existing = epMap.get(epNum);
          existing.minutes = Math.max(existing.minutes || 0, ep.minutes || 0);
          existing.known_pct = Math.max(existing.known_pct || 0, ep.known_pct || 0);
          existing.mined = Math.max(existing.mined || 0, ep.mined || 0);
          existing.last_position_ms = Math.max(existing.last_position_ms || 0, ep.last_position_ms || 0);
          existing.duration_ms = Math.max(existing.duration_ms || 0, ep.duration_ms || 0);
          existing.completed = Math.max(existing.completed || 0, ep.completed || 0);
          if (!existing.hash && ep.hash) existing.hash = ep.hash;
          if (ep.title && (!existing.title || existing.title.startsWith('Episode '))) existing.title = ep.title;
          if (ep.poster_url && !existing.poster_url) existing.poster_url = ep.poster_url;
        }
      }
      const eps = Array.from(epMap.values()).sort((a, b) => (a._computedEpNum || 0) - (b._computedEpNum || 0));

      return `
        <div class="anime-episodes-table">
          ${eps.map((ep, idx) => {
            let epTitle = ep.title || `Episode ${idx + 1}`;
            const epNum = ep._computedEpNum || (idx + 1);
            if (this.titleLang === 'jp' && this.selectedSeries.title_native) {
              epTitle = `${this.selectedSeries.title_native} 第${epNum}話`;
            } else if (this.titleLang === 'en' && this.selectedSeries.title_english) {
              epTitle = `${this.selectedSeries.title_english} Episode ${epNum}`;
            }
            const cleanTitle = escapeHtml(epTitle);
            const known = Math.round(ep.known_pct || 0);
            const mined = ep.mined || 0;
            const minutes = Math.round(ep.minutes || 0);
            const isExpanded = this.expandedEpisodeHash === ep.hash;
            const inspectorData = this.episodeInspectorCache.get(ep.hash);
            const isLoading = this.loadingInspectorHash === ep.hash || (isExpanded && !inspectorData);

            return `
              <div class="anime-episode-group ${isExpanded ? 'is-expanded' : ''}">
                <div class="anime-episode-row ${isExpanded ? 'active' : ''}" data-hash="${escapeHtml(ep.hash)}" role="button" tabindex="0" aria-expanded="${isExpanded}">
                  <div class="ep-left">
                    <span class="ep-index">#${epNum}</span>
                    <span class="ep-title">${cleanTitle}</span>
                  </div>
                  <div class="ep-right">
                    <span class="ep-badge">${known}% known</span>
                    <span class="ep-meta">${mined} mined</span>
                    <span class="ep-meta">${minutes} min</span>
                    <button type="button" class="ep-inspect-toggle-btn btn-anime-toggle-inspector" data-hash="${escapeHtml(ep.hash)}" title="Toggle episode analytics">
                      ${isExpanded ? 'Collapse' : 'Analytics'}
                    </button>
                    <button type="button" class="ep-primer-btn" data-hash="${escapeHtml(ep.hash)}">Gap Primer</button>
                    <button type="button" class="ep-delete-btn" data-hash="${escapeHtml(ep.hash)}" title="Remove episode from library">×</button>
                  </div>
                </div>
                ${isExpanded ? this._renderInlineEpisodeInspector(ep, inspectorData, isLoading) : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    if (this.seriesDetailTab === 'cards') {
      if (!this.seriesCards || this.seriesCards.length === 0) {
        return `<div class="subtab-empty">No vocabulary cards mined from this series yet. Capture subtitles while watching to build your deck!</div>`;
      }
      return `
        <div class="anime-mined-cards-grid">
          ${this.seriesCards.map(c => {
            const word = escapeHtml(c.expression || '');
            const reading = escapeHtml(c.reading || '');
            const meaningHtml = this._formatCardMeaning(c.meaning);
            const imgUrl = this._resolveCardImageUrl(c.image);
            const sentence = escapeHtml(c.example_sentence || c.source_text || '');

            return `
              <div class="anime-mined-card">
                ${imgUrl ? `
                  <div class="card-thumb-wrap">
                    <img src="${escapeHtml(imgUrl)}" class="card-snap-img" alt="${word}" onerror="this.parentElement.style.display='none'" />
                  </div>
                ` : ''}
                <div class="card-body">
                  <div class="card-headword">
                    <span class="card-expr">${word}</span>
                    <span class="card-reading">${reading}</span>
                  </div>
                  ${meaningHtml}
                  ${sentence ? `<p class="card-sentence">${sentence}</p>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    if (this.seriesDetailTab === 'primer') {
      if (this.primerLoading) {
        return `
          <div class="anime-primer-panel primer-loading-panel">
            <div class="inspector-skeleton-bar" style="width: 45%"></div>
            <p class="primer-subtitle">${escapeHtml(this.primerStatusText || 'Building pre-watch Gap Primer...')}</p>
            <div class="inspector-skeleton-grid">
              <div class="inspector-skeleton-card"></div>
              <div class="inspector-skeleton-card"></div>
              <div class="inspector-skeleton-card"></div>
            </div>
          </div>
        `;
      }

      if (this.primerError) {
        return `<div class="subtab-empty primer-error-msg">${escapeHtml(this.primerError)}</div>`;
      }

      const p = this.selectedEpisodePrimer;
      if (!p || (!p.gap_words?.length && !p.grammar_points?.length)) {
        return `<div class="subtab-empty">No gap words calculated for this episode yet. Click "Gap Primer" on an episode row to auto-fetch subtitles from Jimaku.</div>`;
      }

      const words = p.gap_words || [];
      const grammar = p.grammar_points || [];
      const quiz = p.quiz || [];
      const highYieldCount = words.filter(w => (w.frequency || 1) >= 3).length;

      return `
        <div class="anime-primer-panel">
          <div class="primer-header-action">
            <div>
              <div class="primer-title-row">
                <h3 class="primer-section-title">Pre-Watch Cram (${words.length} High-Yield Words)</h3>
                ${p.jimaku_filename ? `<span class="primer-source-badge">Jimaku: ${escapeHtml(p.jimaku_filename)}</span>` : '<span class="primer-source-badge">Local Cues</span>'}
              </div>
              <p class="primer-subtitle">
                ${highYieldCount > 0 ? `${highYieldCount} words repeat 3x+ in this episode. ` : ''}Learn these before pressing play to unlock dialogue comprehension.
              </p>
            </div>
            <button type="button" class="anime-study-btn" id="study-primer-btn">Study These Gap Words</button>
          </div>

          <div class="primer-words-list">
            ${words.slice(0, 20).map(w => {
              const freq = w.frequency || 1;
              const isHighYield = freq >= 3;
              return `
                <div class="primer-word-chip ${isHighYield ? 'is-high-yield' : ''}">
                  <div class="primer-chip-top">
                    <span class="chip-expr">${escapeHtml(w.word)}</span>
                    <span class="chip-reading">${escapeHtml(w.reading || '')}</span>
                    ${w.level ? `<span class="word-card-level ${(w.level || 'unranked').toLowerCase()}">${escapeHtml(w.level)}</span>` : ''}
                    <span class="chip-freq ${isHighYield ? 'high-yield' : ''}">${freq}x${isHighYield ? ' KEY' : ''}</span>
                  </div>
                  <div class="chip-meaning">${this._formatPrimerMeaning(w.meaning)}</div>
                </div>
              `;
            }).join('')}
          </div>

          ${grammar.length > 0 ? `
            <h4 class="primer-grammar-title">Top Grammar Points</h4>
            <div class="primer-grammar-list">
              ${grammar.map(g => {
                const spoken = g.spoken_form && g.formal_form ? { spoken: g.spoken_form, formal: g.formal_form } : this._detectSpokenContractionClient(g);
                return `
                  <div class="primer-grammar-chip">
                    <div class="primer-grammar-top">
                      <span class="g-display">${escapeHtml(g.display || g.pattern_key)}</span>
                      ${g.level ? `<span class="word-card-level ${(g.level || 'n4').toLowerCase()}">${escapeHtml(g.level)}</span>` : ''}
                      ${g.frequency ? `<span class="chip-freq">${g.frequency}x</span>` : ''}
                    </div>
                    ${spoken ? `<div class="spoken-contraction-badge">Spoken: ${escapeHtml(spoken.spoken)} → ${escapeHtml(spoken.formal)}</div>` : ''}
                    ${g.meaning ? `<div class="primer-grammar-meaning">${escapeHtml(g.meaning)}</div>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          ` : ''}

          ${quiz.length > 0 ? `
            <div class="primer-quiz-section">
              <h4 class="primer-grammar-title">Pre-Watch Quick Check (${quiz.length} Questions)</h4>
              <div class="primer-quiz-list">
                ${quiz.map((q, qIdx) => {
                  const chosen = this.primerQuizState?.[q.id];
                  const answered = chosen !== undefined;
                  return `
                    <div class="primer-quiz-card" data-qid="${q.id}">
                      <div class="primer-quiz-prompt">
                        <span class="quiz-num">${qIdx + 1}.</span>
                        <span class="quiz-word">${escapeHtml(q.word)}</span>
                        ${q.reading ? `<span class="quiz-reading">${escapeHtml(q.reading)}</span>` : ''}
                      </div>
                      <div class="primer-quiz-options">
                        ${(q.options || []).map((opt, optIdx) => {
                          let cls = 'primer-quiz-option';
                          if (answered) {
                            if (optIdx === q.correct_index) cls += ' is-correct';
                            else if (optIdx === chosen) cls += ' is-wrong';
                          }
                          return `
                            <button type="button" class="${cls}" data-action="primer-quiz-answer" data-qid="${q.id}" data-opt="${optIdx}" ${answered ? 'disabled' : ''}>
                              ${escapeHtml(opt)}
                            </button>
                          `;
                        }).join('')}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }

    return '';
  }

  _highlightContext(sentence, target) {
    if (!sentence) return '';
    if (!target) return escapeHtml(sentence);
    const cleanTarget = target.replace(/^[〜～~]/, '').replace(/[〜～~]$/, '').trim();
    if (!cleanTarget) return escapeHtml(sentence);
    const idx = sentence.indexOf(cleanTarget);
    if (idx === -1) {
      return escapeHtml(sentence);
    }
    const before = sentence.slice(0, idx);
    const match = sentence.slice(idx, idx + cleanTarget.length);
    const after = sentence.slice(idx + cleanTarget.length);
    return `${escapeHtml(before)}<mark class="brutalist-context-mark">${escapeHtml(match)}</mark>${escapeHtml(after)}`;
  }

  _resolveCardImageUrl(img) {
    if (!img || typeof img !== 'string') return '';
    let clean = img.trim();
    if (clean.includes('<img')) {
      const match = clean.match(/src=["']([^"']+)["']/i);
      if (match) clean = match[1];
    }
    if (!clean) return '';
    if (clean.startsWith('data:') || clean.startsWith('http://') || clean.startsWith('https://')) {
      return clean;
    }
    const port = this.backendPort || 21828;
    const isRemoteWeb = typeof window !== 'undefined' &&
      window.location?.protocol === 'https:' &&
      window.location?.hostname !== 'localhost' &&
      window.location?.hostname !== '127.0.0.1';
    const base = isRemoteWeb ? window.location.origin : `http://127.0.0.1:${port}`;
    if (clean.startsWith('/api/media/')) {
      return `${base}${clean}`;
    }
    return `${base}/api/media/${encodeURIComponent(clean)}`;
  }

  _formatCardMeaning(rawMeaning) {
    if (!rawMeaning) return '';
    const meaning = String(rawMeaning).trim();
    if (!meaning) return '';

    const plain = meaning.replace(/<br\s*\/?>/gi, '\n');
    const parts = plain
      .split(/(?:\r?\n|\s+(?=\d+\.\s+))/)
      .map(p => p.trim())
      .filter(Boolean);

    if (parts.length > 1) {
      const items = parts.map((part, idx) => {
        const m = part.match(/^(\d+)\.\s*(.+)$/s);
        const num = m ? m[1] : (idx + 1);
        const text = m ? m[2].trim() : part;
        return `
          <div class="card-meaning-row">
            <span class="card-meaning-num">${escapeHtml(String(num))}</span>
            <span class="card-meaning-text">${escapeHtml(text)}</span>
          </div>
        `;
      });
      return `<div class="card-meanings-list">${items.join('')}</div>`;
    }

    return `<p class="card-meaning">${escapeHtml(meaning)}</p>`;
  }

  _renderInlineEpisodeInspector(ep, data, isLoading) {
    if (isLoading || !data) {
      return `
        <div class="anime-inline-inspector anime-inspector-panel loading" id="inspector-${escapeHtml(ep.hash)}">
          <div class="inspector-loading-card">
            <div class="inspector-loading-pulse-ring" aria-hidden="true"></div>
            <div class="inspector-loading-text">
              <h4>Analyzing Episode Subtitles</h4>
              <p>Compiling JLPT difficulty, gap vocabulary, and grammar patterns...</p>
            </div>
          </div>
          <div class="inspector-skeleton-bars" aria-hidden="true">
            <div class="skeleton-shimmer-bar" style="width: 75%;"></div>
            <div class="skeleton-shimmer-bar" style="width: 90%;"></div>
            <div class="skeleton-shimmer-bar" style="width: 60%;"></div>
          </div>
        </div>
      `;
    }

    const diff = data.difficulty || {};
    const missed = data.missed_words || [];
    const allWords = data.all_words || [];
    const rawGrammar = data.grammar_points || [];

    const hasCues = data.cues_available !== false && (
      (data.cue_count && data.cue_count > 0) ||
      missed.length > 0 ||
      allWords.length > 0 ||
      (diff.unique_words_count && diff.unique_words_count > 0) ||
      rawGrammar.length > 0
    );

    if (!hasCues) {
      return `
        <div class="anime-inline-inspector anime-inspector-panel empty" id="inspector-${escapeHtml(ep.hash)}">
          <div class="inspector-empty-card">
            <div class="inspector-empty-badge">Subtitle Cues Unavailable</div>
            <h4 class="inspector-empty-title">No Subtitle Analytics Synced</h4>
            <p class="inspector-empty-text">Subtitle cues have not been ingested for this episode yet. Subtitles are captured independently by the browser extension when media is watched.</p>
          </div>
        </div>
      `;
    }
    const minedCards = data.mined_cards || [];
    const dumped = this.getDumpedGrammar();
    const rawFilteredGrammar = rawGrammar.filter(g => !dumped.has(g.point) && !dumped.has(g.pattern_key));
    const activeLevel = (typeof localStorage !== 'undefined' ? (localStorage.getItem('learner_jlpt_level') || localStorage.getItem('learner.jlptLevel')) : null);
    const targetLevel = (this.learnerLevel || activeLevel || data?.target_learner_level || diff.target_learner_level || 'N3').toUpperCase();
    const reachMap = { N5: 'N4', N4: 'N3', N3: 'N2', N2: 'N1', N1: 'N1' };
    const reachLevel = reachMap[targetLevel] || 'N2';

    const n5 = diff.n5_pct || 0;
    const n4 = diff.n4_pct || 0;
    const n3 = diff.n3_pct || 0;
    const n2 = diff.n2_pct || 0;
    const n1 = diff.n1_pct || 0;
    const unranked = diff.unranked_pct || 0;

    const readiness = this._computeComprehensionReadiness(allWords, missed, ep);

    const baseWordsList = this.wordsViewMode === 'all' ? (allWords.length > 0 ? allWords : missed) : missed;
    const displayList = baseWordsList.filter(w => this._matchesJlptFilter(w.jlpt, targetLevel));
    const grammar = rawFilteredGrammar.filter(g => this._matchesJlptFilter(g.jlpt, targetLevel));
    const shownWords = this.wordsExpanded ? displayList : displayList.slice(0, 24);
    const hasKanjiRe = /[\u4e00-\u9faf\u3400-\u4dbf]/;

    return `
      <div class="anime-inline-inspector anime-inspector-panel" id="inspector-${escapeHtml(ep.hash)}">
        <!-- Inspector Action Toolbar with Tactile Review Buttons -->
        <div class="inspector-actions-row">
          <button type="button" class="inspector-review-btn btn-review-all" data-hash="${escapeHtml(ep.hash)}" data-action="review-all" title="Review all gap words & grammar in brutalist flashcards">
            <svg viewBox="0 0 24 24" class="btn-icon" width="16" height="16" fill="currentColor">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            Review All (${missed.length + rawFilteredGrammar.length})
          </button>
          <button type="button" class="inspector-review-btn btn-review-vocab" data-hash="${escapeHtml(ep.hash)}" data-action="review-vocab" title="Review gap words in brutalist flashcards">
            Review Words (${missed.length})
          </button>
          <button type="button" class="inspector-review-btn btn-review-grammar" data-hash="${escapeHtml(ep.hash)}" data-action="review-grammar" title="Review grammar in subtitle context">
            Review Grammar (${rawFilteredGrammar.length})
          </button>
        </div>

        <!-- Section 1: Difficulty & JLPT Gauge + Comprehension Readiness -->
        <div class="inspector-section difficulty-section">
          <div class="inspector-section-header">
            <span class="inspector-section-title">Difficulty Breakdown</span>
            <div class="inspector-diff-badges">
              <span class="diff-level-badge level-${(diff.overall_level || 'N4').toLowerCase()}" title="Episode Vocabulary Level based on subtitle content">Episode Level: ${escapeHtml(diff.overall_level || 'N4')}</span>
              <span class="diff-target-badge level-${(targetLevel || 'N3').toLowerCase()}" title="Your universal target JLPT study level">Your Target: ${escapeHtml(targetLevel || 'N3')}</span>
              <span class="diff-count-badge">${diff.unique_words_count || allWords.length || 0} unique words</span>
            </div>
          </div>
          <div class="inspector-level-bar" role="progressbar" aria-label="JLPT Level Distribution">
            ${n5 > 0 ? `<div class="bar-segment level-n5" style="width: ${n5}%;" title="N5: ${n5}%"></div>` : ''}
            ${n4 > 0 ? `<div class="bar-segment level-n4" style="width: ${n4}%;" title="N4: ${n4}%"></div>` : ''}
            ${n3 > 0 ? `<div class="bar-segment level-n3" style="width: ${n3}%;" title="N3: ${n3}%"></div>` : ''}
            ${n2 > 0 ? `<div class="bar-segment level-n2" style="width: ${n2}%;" title="N2: ${n2}%"></div>` : ''}
            ${n1 > 0 ? `<div class="bar-segment level-n1" style="width: ${n1}%;" title="N1: ${n1}%"></div>` : ''}
            ${unranked > 0 ? `<div class="bar-segment level-unranked" style="width: ${unranked}%;" title="Unranked: ${unranked}%"></div>` : ''}
          </div>
          <div class="inspector-level-legend">
            <span class="legend-pill n5"><span class="legend-dot n5"></span> N5 ${n5}%</span>
            <span class="legend-pill n4"><span class="legend-dot n4"></span> N4 ${n4}%</span>
            <span class="legend-pill n3"><span class="legend-dot n3"></span> N3 ${n3}%</span>
            <span class="legend-pill n2"><span class="legend-dot n2"></span> N2 ${n2}%</span>
            <span class="legend-pill n1"><span class="legend-dot n1"></span> N1 ${n1}%</span>
            ${unranked > 0 ? `<span class="legend-pill unranked"><span class="legend-dot unranked"></span> Other ${unranked}%</span>` : ''}
          </div>
          ${readiness ? `
            <div class="comprehension-readiness-bar">
              <div class="readiness-meter">
                <div class="readiness-fill" style="width: ${readiness.currentPct}%"></div>
              </div>
              <div class="readiness-copy">
                <span class="readiness-pct">Comprehension: <strong>${readiness.currentPct}%</strong></span>
                ${readiness.wordsNeeded > 0 ? `
                  <span class="readiness-boost">Learning top <strong>${readiness.wordsNeeded}</strong> gap words boosts you to <strong>${readiness.targetPct}%</strong></span>
                ` : `
                  <span class="readiness-boost">Strong i+1 match for your current vocabulary</span>
                `}
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Section 2: Words Grid (with Gap Words vs All Vocabulary + JLPT Filter) -->
        <div class="inspector-section missed-words-section anime-inspector-vocab">
          <div class="inspector-section-header">
            <div class="words-tab-group" role="tablist">
              <button type="button" class="words-tab-pill ${this.wordsViewMode === 'gap' ? 'active' : ''}" data-mode="gap">
                Gap Words (${missed.length})
              </button>
              <button type="button" class="words-tab-pill ${this.wordsViewMode === 'all' ? 'active' : ''}" data-mode="all">
                All Vocabulary (${allWords.length || diff.unique_words_count || 0})
              </button>
            </div>
            <div class="inspector-words-header-right">
              <select class="jlpt-filter-select" data-action="jlpt-filter-select" aria-label="Filter by JLPT level">
                <option value="all" ${this.jlptFilter === 'all' ? 'selected' : ''}>Level: All</option>
                <option value="target" ${this.jlptFilter === 'target' ? 'selected' : ''}>Target (${escapeHtml(targetLevel)})</option>
                <option value="reach" ${this.jlptFilter === 'reach' ? 'selected' : ''}>Reach (${escapeHtml(reachLevel)})</option>
                <option value="N5" ${this.jlptFilter === 'N5' ? 'selected' : ''}>N5 only</option>
                <option value="N4" ${this.jlptFilter === 'N4' ? 'selected' : ''}>N4 only</option>
                <option value="N3" ${this.jlptFilter === 'N3' ? 'selected' : ''}>N3 only</option>
                <option value="N2" ${this.jlptFilter === 'N2' ? 'selected' : ''}>N2 only</option>
                <option value="N1" ${this.jlptFilter === 'N1' ? 'selected' : ''}>N1 only</option>
              </select>
              ${displayList.length > 24 ? `
                <button type="button" class="inspector-expand-toggle-btn" data-action="toggle-words-expand">
                  ${this.wordsExpanded ? 'Collapse' : `Show All (${displayList.length})`}
                </button>
              ` : ''}
            </div>
          </div>
          ${displayList.length === 0 ? `
            <div class="inspector-empty-msg">No words match this filter (${escapeHtml(this.jlptFilter.toUpperCase())}). Try "All" to see everything.</div>
          ` : `
            <div class="inspector-missed-grid">
              ${shownWords.map(w => {
                const hasKanji = hasKanjiRe.test(w.word || '');
                const isKanjiOpen = hasKanji && this.openKanjiWords?.has(w.word);
                const cachedKanji = isKanjiOpen ? this.kanjiCache.get(w.word) : null;
                return `
                  <div class="inspector-word-card">
                    <div class="word-card-top">
                      <span class="word-card-expr">${escapeHtml(w.word)}</span>
                      <span class="word-card-reading">${escapeHtml(w.reading || '')}</span>
                      <span class="word-card-level ${(w.jlpt || 'unranked').toLowerCase()}">${escapeHtml(w.jlpt || 'N?')}</span>
                      ${hasKanji ? `
                        <button type="button" class="word-kanji-btn ${isKanjiOpen ? 'is-open' : ''}" data-action="toggle-kanji" data-word="${escapeHtml(w.word)}" title="Toggle Kanji breakdown">
                          Kanji
                        </button>
                      ` : ''}
                      <span class="word-card-freq">${w.frequency || 1}x</span>
                    </div>
                    <div class="word-card-meaning">${escapeHtml(w.meaning || '')}</div>
                    ${w.context_sentence ? `
                      <div class="word-card-sentence" title="${escapeHtml(w.context_sentence)}">
                        ${this._highlightContext(w.context_sentence, w.word)}
                      </div>
                    ` : ''}
                    ${cachedKanji ? this._renderKanjiTrayHtml(cachedKanji) : '<div class="word-card-kanji-tray" hidden></div>'}
                    <button type="button" class="inspector-quick-mine-btn"
                            data-expr="${escapeHtml(w.word)}"
                            data-reading="${escapeHtml(w.reading || '')}"
                            data-meaning="${escapeHtml(w.meaning || '')}"
                            data-sentence="${escapeHtml(w.context_sentence || '')}"
                            title="Save card">
                      Mine
                    </button>
                  </div>
                `;
              }).join('')}
            </div>
          `}
          ${displayList.length > 24 && !this.wordsExpanded ? `
            <div class="inspector-expand-footer">
              <button type="button" class="inspector-expand-full-btn" data-action="toggle-words-expand">
                View All ${displayList.length} Words ↓
              </button>
            </div>
          ` : ''}
        </div>

        <!-- Section 3: Grammar Strip -->
        <div class="inspector-section grammar-section anime-inspector-grammar">
          <div class="inspector-section-header">
            <div class="inspector-title-with-btn">
              <span class="inspector-section-title">Episode Grammar Patterns (${grammar.length})</span>
              <button type="button" class="inspector-inline-review-btn" data-hash="${escapeHtml(ep.hash)}" data-action="review-grammar">
                Review Grammar
              </button>
            </div>
            <span class="inspector-section-subtitle">Click pattern for context • Click × to dismiss known grammar</span>
          </div>
          ${grammar.length === 0 ? `
            <div class="inspector-empty-msg">No grammar patterns match this filter (or all known patterns hidden).</div>
          ` : `
            <div class="inspector-grammar-strip">
              ${grammar.map(g => {
                const spoken = g.spoken_form && g.formal_form ? { spoken: g.spoken_form, formal: g.formal_form } : this._detectSpokenContractionClient(g);
                return `
                  <div class="inspector-grammar-pill" tabindex="0" role="button" aria-expanded="false">
                    <div class="grammar-pill-main">
                      <span class="grammar-pill-name">${escapeHtml(g.point)}</span>
                      <span class="grammar-pill-level ${(g.jlpt || 'n4').toLowerCase()}">${escapeHtml(g.jlpt || 'N4')}</span>
                      <span class="grammar-pill-count">${g.occurrences}x</span>
                      ${spoken ? `<span class="spoken-contraction-badge" title="Spoken colloquial form in anime dialogue">${escapeHtml(spoken.spoken)} → ${escapeHtml(spoken.formal)}</span>` : ''}
                      <button type="button" class="inspector-grammar-dump-btn" data-point="${escapeHtml(g.point)}" data-key="${escapeHtml(g.pattern_key || g.point)}" title="Hide this grammar pattern everywhere (already known)">×</button>
                    </div>
                    <div class="inspector-grammar-sent" hidden>
                      ${g.meaning ? `
                        <div class="inspector-grammar-meaning">${escapeHtml(g.meaning)}</div>
                      ` : ''}
                      ${g.formation ? `
                        <div class="inspector-grammar-formation"><span class="formation-label">Structure:</span> ${escapeHtml(g.formation)}</div>
                      ` : ''}
                      ${g.example_sentence ? `
                        <div class="inspector-grammar-context"><span class="sent-label">Context:</span> ${this._highlightContext(g.example_sentence, g.point)}</div>
                      ` : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <!-- Section 4: Mined in Session -->
        ${minedCards.length > 0 ? `
          <div class="inspector-section mined-section">
            <div class="inspector-section-header">
              <span class="inspector-section-title">Mined in Series / Episode (${minedCards.length})</span>
            </div>
            <div class="inspector-mined-chips">
              ${minedCards.slice(0, 10).map(c => `
                <div class="inspector-mined-chip">
                  <span class="chip-expr">${escapeHtml(c.expression)}</span>
                  <span class="chip-reading">${escapeHtml(c.reading || '')}</span>
                  <span class="chip-meaning">${escapeHtml(c.meaning || '')}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  async toggleEpisodeInspector(hash, forceReload = false) {
    if (!hash) return;

    if (!this.container) {
      if (!forceReload && this.expandedEpisodeHash === hash) {
        this.expandedEpisodeHash = null;
        return;
      }
      this.expandedEpisodeHash = hash;
      if (forceReload || !this.episodeInspectorCache.has(hash)) {
        try {
          const level = this.learnerLevel || await getUniversalJlptLevel();
          const data = await this.apiClient.getEpisodeInspector(hash, level);
          if (data) this.episodeInspectorCache.set(hash, data);
        } catch (_) {}
      }
      return;
    }

    const epRow = this.container.querySelector(`.anime-episode-row[data-hash="${hash}"]`);
    const epGroup = epRow?.closest('.anime-episode-group');
    if (!epRow || !epGroup) {
      if (!forceReload && this.expandedEpisodeHash === hash) {
        this.expandedEpisodeHash = null;
        return;
      }
      this.expandedEpisodeHash = hash;
      if (forceReload || !this.episodeInspectorCache.has(hash)) {
        try {
          const level = this.learnerLevel || await getUniversalJlptLevel();
          const data = await this.apiClient.getEpisodeInspector(hash, level);
          if (data) this.episodeInspectorCache.set(hash, data);
        } catch (_) {}
      }
      return;
    }

    const inspectBtn = epRow.querySelector('.ep-inspect-toggle-btn');

    // 1. If currently expanded, collapse it cleanly without full-page re-render (unless forceReload)
    if (!forceReload && this.expandedEpisodeHash === hash) {
      if (this.loadingInspectorHash === hash) return;
      this.expandedEpisodeHash = null;
      epGroup.classList.remove('is-expanded');
      epRow.classList.remove('active');
      epRow.setAttribute('aria-expanded', 'false');
      if (inspectBtn) inspectBtn.textContent = 'Analytics';
      const existingDrawer = epGroup.querySelector('.anime-inline-inspector');
      if (existingDrawer) existingDrawer.remove();
      return;
    }

    // 2. If another episode was expanded, collapse that one first
    if (this.expandedEpisodeHash && this.expandedEpisodeHash !== hash) {
      const prevRow = this.container.querySelector(`.anime-episode-row[data-hash="${this.expandedEpisodeHash}"]`);
      const prevGroup = prevRow?.closest('.anime-episode-group');
      if (prevGroup) {
        prevGroup.classList.remove('is-expanded');
        prevRow?.classList.remove('active');
        prevRow?.setAttribute('aria-expanded', 'false');
        const prevBtn = prevRow?.querySelector('.ep-inspect-toggle-btn');
        if (prevBtn) prevBtn.textContent = 'Analytics';
        const prevDrawer = prevGroup.querySelector('.anime-inline-inspector');
        if (prevDrawer) prevDrawer.remove();
      }
    }

    // 3. Mark newly expanded episode
    this.expandedEpisodeHash = hash;
    epGroup.classList.add('is-expanded');
    epRow.classList.add('active');
    epRow.setAttribute('aria-expanded', 'true');

    const ep = (this.selectedSeries?.episodes || []).find(e => e.hash === hash) || { hash };

    // 4. If cached, render immediately with zero latency!
    if (this.episodeInspectorCache.has(hash)) {
      this.loadingInspectorHash = null;
      const data = this.episodeInspectorCache.get(hash);
      if (inspectBtn) inspectBtn.textContent = 'Collapse';
      let drawer = epGroup.querySelector('.anime-inline-inspector');
      const drawerHtml = this._renderInlineEpisodeInspector(ep, data, false);
      if (drawer) {
        drawer.outerHTML = drawerHtml;
      } else {
        epGroup.insertAdjacentHTML('beforeend', drawerHtml);
      }
      return;
    }

    // 5. If not cached, show immediate animated tactile skeleton loader in place
    this.loadingInspectorHash = hash;
    if (inspectBtn) inspectBtn.textContent = 'Loading...';
    let drawer = epGroup.querySelector('.anime-inline-inspector');
    const loadingHtml = this._renderInlineEpisodeInspector(ep, null, true);
    if (drawer) {
      drawer.outerHTML = loadingHtml;
    } else {
      epGroup.insertAdjacentHTML('beforeend', loadingHtml);
    }

    // 6. Fetch inspection data (reuse in-flight request if present)
    try {
      if (!this._inFlightInspectors) this._inFlightInspectors = new Map();
      let fetchPromise = this._inFlightInspectors.get(hash);
      if (!fetchPromise) {
        let level = this.learnerLevel;
        if (!level) {
          try {
            level = await getUniversalJlptLevel();
          } catch (_) {
            level = 'N3';
          }
        }
        fetchPromise = this.apiClient.getEpisodeInspector(hash, level);
        this._inFlightInspectors.set(hash, fetchPromise);
      }
      const data = await fetchPromise;
      this._inFlightInspectors.delete(hash);
      if (data) this.episodeInspectorCache.set(hash, data);

      if (this.expandedEpisodeHash === hash) {
        this.loadingInspectorHash = null;
        if (inspectBtn) inspectBtn.textContent = 'Collapse';
        const currentDrawer = epGroup.querySelector('.anime-inline-inspector');
        const finalHtml = this._renderInlineEpisodeInspector(ep, data, false);
        if (currentDrawer) {
          currentDrawer.outerHTML = finalHtml;
        } else {
          epGroup.insertAdjacentHTML('beforeend', finalHtml);
        }
      }
    } catch (err) {
      this._inFlightInspectors.delete(hash);
      this.loadingInspectorHash = null;
      console.warn('[AnimeView] Failed to load episode inspection:', err);
      if (this.expandedEpisodeHash === hash) {
        if (inspectBtn) inspectBtn.textContent = 'Analytics';
        const currentDrawer = epGroup.querySelector('.anime-inline-inspector');
        if (currentDrawer) {
          currentDrawer.innerHTML = `
            <div class="inspector-empty-text" style="padding: 1.5rem; text-align: center; color: var(--text-muted);">
              Unable to load episode analytics. Please verify media playback or network connection.
            </div>
          `;
        }
      }
    }
  }

  _ensureDelegatedClickHandler() {
    if (!this.container || typeof this.container.addEventListener !== 'function') return;
    if (this._delegatedContainer === this.container && this._delegatedClickHandler) return;

    if (this._delegatedContainer && this._delegatedClickHandler && typeof this._delegatedContainer.removeEventListener === 'function') {
      this._delegatedContainer.removeEventListener('click', this._delegatedClickHandler);
    }

    this._delegatedContainer = this.container;
    this._delegatedClickHandler = async (e) => {
      const target = e.target;
      if (!target || typeof target.closest !== 'function') return;

      // 1. Review Overlay Close / Known / Mine / Backdrop
      const closeReviewBtn = target.closest('[data-action="close-review"]');
      if (closeReviewBtn) {
        e.stopPropagation();
        this.closeReviewSession();
        return;
      }
      const reviewKnownBtn = target.closest('[data-action="review-known"]');
      if (reviewKnownBtn) {
        e.stopPropagation();
        this.handleReviewAction('known');
        return;
      }
      const reviewMineBtn = target.closest('[data-action="review-mine"]');
      if (reviewMineBtn) {
        e.stopPropagation();
        this.handleReviewAction('mine');
        return;
      }
      if (target.id === 'brutalist-review-overlay') {
        this.closeReviewSession();
        return;
      }

      // 2. Review Session Triggers (Review All, Review Words, Review Grammar)
      const reviewBtn = target.closest('.inspector-review-btn, .inspector-inline-review-btn');
      if (reviewBtn) {
        e.stopPropagation();
        const action = reviewBtn.getAttribute('data-action');
        const epGroup = reviewBtn.closest('.anime-episode-group');
        const rowHash = epGroup?.querySelector?.('.anime-episode-row')?.getAttribute('data-hash');
        const hash = reviewBtn.getAttribute('data-hash') || rowHash || this.expandedEpisodeHash;
        if (action === 'review-all') {
          await this.startReviewSession('all', hash);
        } else if (action === 'review-vocab') {
          await this.startReviewSession('vocab', hash);
        } else if (action === 'review-grammar') {
          await this.startReviewSession('grammar', hash);
        }
        return;
      }

      // 3. Expand / Collapse Words List (Show All / View All)
      const expandBtn = target.closest('[data-action="toggle-words-expand"]');
      if (expandBtn) {
        e.stopPropagation();
        this.wordsExpanded = !this.wordsExpanded;
        this._refreshInlineInspector(expandBtn);
        return;
      }

      // 4. Words View Mode Tabs (Gap Words vs All Vocabulary)
      const wordsTabBtn = target.closest('.words-tab-pill');
      if (wordsTabBtn) {
        e.stopPropagation();
        const mode = wordsTabBtn.getAttribute('data-mode');
        if (mode && mode !== this.wordsViewMode) {
          this.wordsViewMode = mode;
          this._refreshInlineInspector(wordsTabBtn);
        }
        return;
      }

      // 4b. JLPT Target Focus & Level Filter Pills
      const jlptFilterBtn = target.closest('[data-action="set-jlpt-filter"]');
      if (jlptFilterBtn) {
        e.stopPropagation();
        const filter = jlptFilterBtn.getAttribute('data-filter') || 'all';
        if (filter !== this.jlptFilter) {
          this.jlptFilter = filter;
          this.wordsExpanded = false;
          this._refreshInlineInspector(jlptFilterBtn);
        }
        return;
      }

      // 4c. Kanji Breakdown Toggle on Word Cards
      const kanjiBtn = target.closest('[data-action="toggle-kanji"]');
      if (kanjiBtn) {
        e.stopPropagation();
        const word = kanjiBtn.getAttribute('data-word');
        if (word) {
          await this._toggleKanjiBreakdown(word, kanjiBtn);
        }
        return;
      }

      // 4d. Gap Primer Study Button & Mini Quiz
      const studyPrimerBtn = target.closest('#study-primer-btn');
      if (studyPrimerBtn) {
        e.stopPropagation();
        this.startPrimerReviewSession();
        return;
      }

      const quizOptBtn = target.closest('[data-action="primer-quiz-answer"]');
      if (quizOptBtn) {
        e.stopPropagation();
        const qId = quizOptBtn.getAttribute('data-qid');
        const optIdx = parseInt(quizOptBtn.getAttribute('data-opt'), 10);
        if (qId !== null && !Number.isNaN(optIdx)) {
          this.primerQuizState = { ...(this.primerQuizState || {}), [qId]: optIdx };
          this._updateDetailSubtabContent();
        }
        return;
      }

      // 5. Dismiss Known Grammar Point
      const dumpBtn = target.closest('.inspector-grammar-dump-btn');
      if (dumpBtn) {
        e.stopPropagation();
        const point = dumpBtn.getAttribute('data-point');
        const key = dumpBtn.getAttribute('data-key') || point;
        if (!point) return;
        this.dumpGrammarPoint(point, key);
        const pill = dumpBtn.closest('.inspector-grammar-pill');
        if (pill) {
          pill.style.transition = 'all 160ms ease';
          pill.style.opacity = '0';
          pill.style.transform = 'scale(0.8)';
          setTimeout(() => {
            const strip = pill.parentElement;
            pill.remove();
            if (strip) {
              const remaining = strip.querySelectorAll('.inspector-grammar-pill').length;
              const titleEl = strip.closest('.grammar-section')?.querySelector('.inspector-section-title');
              if (titleEl) titleEl.textContent = `Episode Grammar Patterns (${remaining})`;
            }
          }, 160);
        }
        return;
      }

      // 6. Grammar Pill Toggle Example Sentence
      const grammarPill = target.closest('.inspector-grammar-pill');
      if (grammarPill) {
        e.stopPropagation();
        const sentEl = grammarPill.querySelector('.inspector-grammar-sent');
        if (sentEl) {
          sentEl.hidden = !sentEl.hidden;
          grammarPill.setAttribute('aria-expanded', String(!sentEl.hidden));
        }
        return;
      }

      // 7. Quick-Mine Button
      const mineBtn = target.closest('.inspector-quick-mine-btn');
      if (mineBtn) {
        e.stopPropagation();
        if (mineBtn.classList.contains('mined') || mineBtn.disabled) return;

        const expr = mineBtn.getAttribute('data-expr') || mineBtn.getAttribute('data-word');
        const reading = mineBtn.getAttribute('data-reading') || '';
        const meaning = mineBtn.getAttribute('data-meaning') || '';
        const sentence = mineBtn.getAttribute('data-sentence') || '';
        const image = mineBtn.getAttribute('data-image') || '';
        const seriesName = this.selectedSeries?.series || 'Anime';

        if (!expr) return;

        mineBtn.textContent = 'Saving...';
        mineBtn.disabled = true;

        try {
          const targetDeck = await getUniversalAnkiDeck();
          if (!targetDeck) {
            throw new Error('No Anki deck selected. Please choose a deck in Settings.');
          }
          let res;
          if (this.linkMineService && typeof this.linkMineService.mineWord === 'function') {
            res = await this.linkMineService.mineWord({
              expression: expr,
              reading,
              meaning,
              sentence,
              image,
              cue: { text: sentence, s: 0, e: 0 },
              session: { title: seriesName, site: 'anime' },
              deckName: targetDeck,
              tags: ['kiroku', 'anime', seriesName.replace(/\s+/g, '_')]
            });
          } else {
            const fallbackPayload = {
              expression: expr,
              reading: reading || expr,
              meaning,
              deck_name: targetDeck,
              source_text: `Mined from ${seriesName}`
            };
            const saveRes = typeof this.apiClient.saveAndSyncCard === 'function'
              ? await this.apiClient.saveAndSyncCard(fallbackPayload)
              : await this.apiClient.request('/api/cards/save', { method: 'POST', body: fallbackPayload });
            if (typeof this.apiClient.markKnownWord === 'function') {
              this.apiClient.markKnownWord(expr).catch(() => {});
            }
            res = { ok: true, isDuplicate: Boolean(saveRes?.is_duplicate || saveRes?.status === 'already_saved') };
          }

          if (res && res.ok) {
            mineBtn.textContent = res.isDuplicate ? 'Already Saved' : 'Mined';
            mineBtn.classList.add('mined');
            mineBtn.disabled = true;
            if (this.selectedSeries && Array.isArray(this.selectedSeries.episodes)) {
              const ep = this.selectedSeries.episodes.find(epItem => epItem.hash === this.expandedEpisodeHash);
              if (ep && !res.isDuplicate) ep.mined = (ep.mined || 0) + 1;
            }
          } else {
            mineBtn.textContent = 'Retry';
            mineBtn.classList.remove('mined');
            mineBtn.disabled = false;
          }
        } catch (err) {
          console.warn('[AnimeView] Quick mine failed:', err);
          mineBtn.textContent = 'Retry';
          mineBtn.classList.remove('mined');
          mineBtn.disabled = false;
        }
      }
    };

    this.container.addEventListener('click', this._delegatedClickHandler);
    this._delegatedChangeHandler = (e) => {
      const selectEl = e.target?.closest?.('[data-action="jlpt-filter-select"]');
      if (selectEl) {
        const filter = selectEl.value || 'all';
        if (filter !== this.jlptFilter) {
          this.jlptFilter = filter;
          this.wordsExpanded = false;
          this._refreshInlineInspector(selectEl);
        }
      }
    };
    this.container.addEventListener('change', this._delegatedChangeHandler);
  }

  _bindInlineInspectorEvents(scopeEl) {
    this._ensureDelegatedClickHandler();
  }

  _refreshInlineInspector(scopeEl) {
    if (!scopeEl) return;
    const epGroup = scopeEl.closest?.('.anime-episode-group') || scopeEl.closest?.('.anime-inline-inspector')?.parentElement || scopeEl;
    const epRow = epGroup.querySelector?.('.anime-episode-row');
    const targetHash = this.expandedEpisodeHash || epRow?.getAttribute?.('data-hash');
    if (!targetHash) return;
    this.expandedEpisodeHash = targetHash;
    const ep = (this.selectedSeries?.episodes || []).find(e => e.hash === targetHash) || { hash: targetHash };
    const data = this.episodeInspectorCache.get(targetHash);
    if (ep && data) {
      const currentDrawer = epGroup.querySelector('.anime-inline-inspector');
      const finalHtml = this._renderInlineEpisodeInspector(ep, data, false);
      if (currentDrawer) {
        currentDrawer.outerHTML = finalHtml;
      }
    }
  }

  _formatPrimerMeaning(meaning) {
    if (!meaning) return '';
    const raw = String(meaning).trim();
    const parts = raw.split(/(?=(?:^|\s)\d+\.\s)/).map(s => s.trim()).filter(Boolean);
    if (parts.length <= 1) {
      return escapeHtml(raw.length > 130 ? `${raw.slice(0, 127)}...` : raw);
    }
    const top = parts.slice(0, 3).map(p => {
      const cleaned = p.replace(/^\d+\.\s*/, '').trim();
      return cleaned.length > 65 ? `${cleaned.slice(0, 62)}...` : cleaned;
    });
    const extra = parts.length > 3 ? ` (+${parts.length - 3} more)` : '';
    return escapeHtml(top.join('; ') + extra);
  }

  _matchesJlptFilter(itemLevel, targetLevel = 'N3') {
    const f = (this.jlptFilter || 'all').toUpperCase();
    if (f === 'ALL') return true;
    const lvl = (itemLevel || '').toUpperCase();
    if (!lvl) return false;
    const t = (targetLevel || 'N3').toUpperCase();
    const reachMap = { N5: 'N4', N4: 'N3', N3: 'N2', N2: 'N1', N1: 'N1' };
    const reach = reachMap[t] || 'N2';
    if (f === 'TARGET') return lvl === t;
    if (f === 'REACH') return lvl === t || lvl === reach;
    return lvl === f;
  }

  _computeComprehensionReadiness(allWords = [], missed = [], ep = {}) {
    if (!allWords || allWords.length === 0) {
      return null;
    }
    const pool = allWords;
    let totalOcc = 0;
    for (const w of pool) totalOcc += (w.frequency || 1);
    let missedOcc = 0;
    for (const w of (missed || [])) missedOcc += (w.frequency || 1);

    if (totalOcc <= 0) return null;
    const knownOcc = Math.max(0, totalOcc - missedOcc);
    const currentPct = Math.min(100, Math.max(0, Math.round((knownOcc / totalOcc) * 100)));

    const targetPct = currentPct >= 90 ? 95 : 90;
    const neededOcc = Math.max(0, Math.ceil((targetPct / 100) * totalOcc) - knownOcc);

    let wordsNeeded = 0;
    if (neededOcc > 0 && missed && missed.length > 0) {
      const sortedMissed = [...missed].sort((a, b) => (b.frequency || 1) - (a.frequency || 1));
      let acc = 0;
      for (const w of sortedMissed) {
        acc += (w.frequency || 1);
        wordsNeeded += 1;
        if (acc >= neededOcc) break;
      }
    }
    return { currentPct, targetPct, wordsNeeded };
  }

  _detectSpokenContractionClient(g) {
    const hay = `${g?.point || ''} ${g?.pattern_key || ''} ${g?.matched_formation || ''} ${g?.example_sentence || ''}`;
    const pkey = `${g?.point || ''} ${g?.pattern_key || ''}`;
    const rules = [
      { forms: ['ちゃった', 'ちゃう', 'じゃった', 'じゃう'], spoken: '〜ちゃった/ちゃう', formal: '〜てしまう', root: 'てしまう' },
      { forms: ['なきゃ', 'なくちゃ'], spoken: '〜なきゃ', formal: '〜なければならない', root: 'なければならない' },
      { forms: ['とく', 'どく', 'といた', 'どいた'], spoken: '〜とく/どく', formal: '〜ておく', root: 'ておく' },
      { forms: ['てる', 'でる', 'てた', 'でた'], spoken: '〜てる/でる', formal: '〜ている', root: 'ている' },
      { forms: ['っけ'], spoken: '〜っけ', formal: '〜っけ (casual recall)', root: 'っけ' },
      { forms: ['だもん', 'んだもん', 'もん'], spoken: '〜もん', formal: '〜ものだ', root: 'もの' },
      { forms: ['じゃん'], spoken: '〜じゃん', formal: '〜じゃないか', root: 'じゃないか' },
      { forms: ['ってば', 'ったら'], spoken: '〜ってば', formal: '〜といえば', root: 'といえば' },
    ];
    for (const r of rules) {
      if (r.forms.some(f => hay.includes(f)) && (pkey.includes(r.root) || r.forms.some(f => pkey.includes(f)))) {
        return { spoken: r.spoken, formal: r.formal };
      }
    }
    return null;
  }

  _renderKanjiTrayHtml(kanjiList) {
    if (!Array.isArray(kanjiList) || kanjiList.length === 0) {
      return `<div class="word-card-kanji-tray"><span class="kanji-tray-empty">No kanji breakdown available.</span></div>`;
    }
    return `
      <div class="word-card-kanji-tray">
        ${kanjiList.map(k => {
          const on = (k.onyomi || []).slice(0, 2).join('・');
          const kun = (k.kunyomi || []).slice(0, 2).join('・');
          const meaning = (k.meanings || []).slice(0, 3).join(', ');
          return `
            <div class="kanji-tray-item">
              <span class="kanji-tray-char">${escapeHtml(k.character || '')}</span>
              <div class="kanji-tray-meta">
                ${(on || kun) ? `<div class="kanji-tray-readings">${escapeHtml([on, kun].filter(Boolean).join(' / '))}</div>` : ''}
                ${meaning ? `<div class="kanji-tray-meaning">${escapeHtml(meaning)}</div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  async _toggleKanjiBreakdown(word, btnEl) {
    const card = btnEl.closest('.inspector-word-card');
    if (!card) return;
    const tray = card.querySelector('.word-card-kanji-tray');
    if (!tray) return;
    if (!this.openKanjiWords) this.openKanjiWords = new Set();

    if (!tray.hidden && tray.innerHTML.trim()) {
      tray.hidden = true;
      btnEl.classList.remove('is-open');
      this.openKanjiWords.delete(word);
      return;
    }

    this.openKanjiWords.add(word);
    if (this.kanjiCache.has(word)) {
      tray.outerHTML = this._renderKanjiTrayHtml(this.kanjiCache.get(word));
      btnEl.classList.add('is-open');
      return;
    }

    btnEl.textContent = '...';
    try {
      const res = await this.apiClient.request(`/api/dictionary/lookup?term=${encodeURIComponent(word)}`);
      const kanjiList = res?.kanji || [];
      this.kanjiCache.set(word, kanjiList);
      tray.outerHTML = this._renderKanjiTrayHtml(kanjiList);
      btnEl.textContent = 'Kanji';
      btnEl.classList.add('is-open');
    } catch (err) {
      btnEl.textContent = 'Kanji';
      tray.innerHTML = `<span class="kanji-tray-empty">Failed to load kanji data.</span>`;
      tray.hidden = false;
    }
  }

  async openEpisodePrimer(hash) {
    if (!hash) return;
    this.seriesDetailTab = 'primer';
    this.primerError = '';
    this.primerQuizState = {};

    const subtabs = this.container?.querySelectorAll('.anime-subtab');
    subtabs?.forEach(t => {
      const isActive = t.getAttribute('data-subtab') === 'primer';
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', String(isActive));
    });

    if (this.primerCache.has(hash)) {
      const cached = this.primerCache.get(hash);
      if (cached && (cached.gap_words?.length || cached.grammar_points?.length)) {
        this.selectedEpisodePrimer = cached;
        this.primerLoading = false;
        this._updateDetailSubtabContent();
        return;
      }
    }

    this.primerLoading = true;
    this.primerStatusText = 'Checking local episode subtitles...';
    this._updateDetailSubtabContent();

    const level = this.learnerLevel || await getUniversalJlptLevel();
    try {
      const p = await this.apiClient.getEpisodePrimer(hash, level);
      if (p && (p.gap_words?.length || p.grammar_points?.length)) {
        this.selectedEpisodePrimer = p;
        this.primerCache.set(hash, p);
        this.primerLoading = false;
        this._updateDetailSubtabContent();
        return;
      }
    } catch (err) {
      // Fallback to Jimaku auto-fetch below
    }

    const epObj = (this.selectedSeries?.episodes || []).find(e => e.hash === hash) || { hash };
    await this._fetchJimakuPrimer(hash, epObj, level);
  }

  _matchJimakuEpisodeFile(files = [], epNum = 1) {
    const subFiles = files.filter(f => /\.(ass|srt|vtt|ssa)$/i.test(f.name || f.url || ''));
    if (subFiles.length === 0) return null;

    const padded = String(epNum).padStart(2, '0');
    const patterns = [
      new RegExp(`(?:^|[^0-9])0*${epNum}(?:v\\d+)?(?:[^0-9]|$)`, 'i'),
      new RegExp(`(?:ep|e|episode|第)\\s*0*${epNum}(?:話)?`, 'i'),
      new RegExp(`\\b${padded}\\b`, 'i'),
    ];

    for (const pat of patterns) {
      const match = subFiles.find(f => pat.test(f.name || ''));
      if (match) return match;
    }
    return epNum === 1 ? subFiles[0] : subFiles[Math.min(epNum - 1, subFiles.length - 1)] || subFiles[0];
  }

  async _fetchJimakuPrimer(hash, epObj, level = 'N3') {
    try {
      this.primerStatusText = 'Fetching Jimaku API key...';
      this._updateDetailSubtabContent();

      let apiKey = '';
      try {
        const keyRes = await this.apiClient.request('/api/link/jimaku-key');
        apiKey = keyRes?.api_key || '';
      } catch (_) {}
      if (!apiKey && typeof localStorage !== 'undefined') {
        apiKey = localStorage.getItem('jimaku_api_key') || '';
      }

      if (!apiKey) {
        this.primerLoading = false;
        this.primerError = 'No local subtitles found and no Jimaku API key is configured. Add your Jimaku.cc API key in Settings to auto-fetch subtitles for Gap Primer.';
        this._updateDetailSubtabContent();
        return;
      }

      const jimaku = new JimakuSearchProvider({ apiKey, parser: SubtitleParser });
      const seriesQueries = [
        this.selectedSeries?.title_native,
        this.selectedSeries?.title_romaji,
        this.selectedSeries?.title_english,
        this.selectedSeries?.series,
      ].filter((q, idx, arr) => q && arr.indexOf(q) === idx);

      let entries = [];
      for (const q of seriesQueries) {
        this.primerStatusText = `Searching Jimaku for "${q}"...`;
        this._updateDetailSubtabContent();
        try {
          entries = await jimaku.searchEntries(q);
          if (entries && entries.length > 0) break;
        } catch (_) {}
      }

      if (!entries || entries.length === 0) {
        this.primerLoading = false;
        this.primerError = `Could not find subtitles on Jimaku for "${seriesQueries[0] || 'this series'}".`;
        this._updateDetailSubtabContent();
        return;
      }

      const entryId = entries[0].id;
      this.primerStatusText = `Loading subtitle files for "${entries[0].name || seriesQueries[0]}"...`;
      this._updateDetailSubtabContent();

      const files = await jimaku.getFilesForEntry(entryId);
      const epNum = epObj._computedEpNum || epObj.episode_number;
      if (!epNum) {
        this.primerLoading = false;
        this.primerError = 'Could not determine episode number for Jimaku subtitle matching.';
        this._updateDetailSubtabContent();
        return;
      }
      const targetFile = this._matchJimakuEpisodeFile(files, epNum);

      if (!targetFile || !targetFile.url) {
        this.primerLoading = false;
        this.primerError = `Found "${entries[0].name || 'series'}" on Jimaku, but no matching subtitle file for Episode ${epNum}.`;
        this._updateDetailSubtabContent();
        return;
      }

      this.primerStatusText = `Downloading & analyzing ${targetFile.name || 'subtitles'}...`;
      this._updateDetailSubtabContent();

      const dl = await jimaku.downloadSubtitle(targetFile.url, targetFile.name || 'subtitles.ass');
      const normalizedCues = (dl.cues || []).slice(0, 2500).map((c, idx) => ({
        i: idx,
        s: c.start ?? c.s ?? 0,
        e: c.end ?? c.e ?? 0,
        text: c.text || '',
      })).filter(c => c.text.trim());

      if (normalizedCues.length === 0) {
        this.primerLoading = false;
        this.primerError = `Downloaded "${targetFile.name}", but no dialogue cues could be parsed.`;
        this._updateDetailSubtabContent();
        return;
      }

      const primer = await this.apiClient.request('/api/link/primer', {
        method: 'POST',
        body: {
          hash,
          cues: normalizedCues,
          learner_level: level,
        }
      });

      if (primer) {
        primer.jimaku_filename = targetFile.name || 'Jimaku';
        this.selectedEpisodePrimer = primer;
        this.primerCache.set(hash, primer);
      }
      this.primerLoading = false;
      this._updateDetailSubtabContent();
    } catch (err) {
      console.warn('[AnimeView] Jimaku Gap Primer fetch failed:', err);
      this.primerLoading = false;
      this.primerError = err?.message || 'Failed to auto-fetch subtitles from Jimaku.';
      this._updateDetailSubtabContent();
    }
  }

  startPrimerReviewSession() {
    const p = this.selectedEpisodePrimer;
    if (!p) return;
    const items = [];
    for (const w of (p.gap_words || [])) {
      items.push({
        type: 'vocab',
        word: w.word,
        reading: w.reading || '',
        meaning: w.meaning || '',
        level: w.level || 'Unranked',
        context_sentence: '',
        image: '',
      });
    }
    for (const g of (p.grammar_points || [])) {
      items.push({
        type: 'grammar',
        word: g.display || g.pattern_key,
        pattern_key: g.pattern_key || g.display,
        reading: '',
        meaning: g.meaning || '',
        level: g.level || 'N4',
        context_sentence: g.example_sentence || '',
        image: '',
      });
    }
    if (items.length === 0) return;

    this.reviewSession = {
      type: 'primer',
      epHash: p.hash || 'primer',
      items,
      currentIndex: 0,
      minedCount: 0,
      knownCount: 0,
    };
    this._attachReviewKeyboardListener();
    this._updateReviewOverlay();
  }

  _renderReviewOverlay() {
    if (!this.reviewSession) return '';

    const session = this.reviewSession;
    const isFinished = session.currentIndex >= session.items.length;

    if (isFinished) {
      return `
        <div class="brutalist-review-overlay" id="brutalist-review-overlay" role="dialog" aria-modal="true">
          <div class="brutalist-card brutalist-card--wide brutalist-card--finished">
            <div class="brutalist-card__header">
              <div class="brutalist-card__alert">SESSION FINISHED</div>
              <button type="button" class="brutalist-card__close-btn" data-action="close-review" aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="brutalist-card__body">
              <div class="brutalist-card__word">お疲れ様！</div>
              <div class="brutalist-card__message">
                Review complete! All ${session.items.length} cards reviewed in this session.
              </div>
              <div class="brutalist-card__stats">
                <div class="brutalist-stat-box">
                  <span class="brutalist-stat-num">${session.minedCount}</span>
                  <span class="brutalist-stat-label">Cards Mined</span>
                </div>
                <div class="brutalist-stat-box">
                  <span class="brutalist-stat-num">${session.knownCount}</span>
                  <span class="brutalist-stat-label">Words Known</span>
                </div>
              </div>
            </div>
            <div class="brutalist-card__actions">
              <button type="button" class="brutalist-card__button brutalist-card__button--mine" data-action="close-review">
                Return to Episode
              </button>
            </div>
          </div>
        </div>
      `;
    }

    const item = session.items[session.currentIndex];
    if (!item) return '';

    const isGrammar = item.type === 'grammar';
    const alertLabel = isGrammar ? 'GRAMMAR' : 'VOCABULARY';
    const levelLabel = item.level ? `• ${escapeHtml(item.level)}` : '';

    return `
      <div class="brutalist-review-overlay" id="brutalist-review-overlay" role="dialog" aria-modal="true" aria-label="Flashcard Review">
        <div class="brutalist-card brutalist-card--wide">
          <div class="brutalist-card__header">
            <div class="brutalist-card__alert">${alertLabel} ${levelLabel}</div>
            <div class="brutalist-card__counter">${session.currentIndex + 1} / ${session.items.length}</div>
            <button type="button" class="brutalist-card__close-btn" data-action="close-review" aria-label="Close review" title="Close (Esc)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="brutalist-card__body">
            ${item.image ? `
              <div class="brutalist-card__frame">
                <img src="${escapeHtml(this._resolveCardImageUrl(item.image))}" alt="Episode Frame" onerror="this.parentElement.style.display='none'" />
              </div>
            ` : ''}
            <div class="brutalist-card__word">${escapeHtml(item.word)}</div>
            ${item.reading ? `<div class="brutalist-card__reading">${escapeHtml(item.reading)}</div>` : ''}
            <div class="brutalist-card__message">
              ${escapeHtml(item.meaning || 'No definition available')}
            </div>
            ${item.context_sentence ? `
              <div class="brutalist-card__context">
                <div class="context-caption">Subtitle Context:</div>
                <div class="context-text">${this._highlightContext(item.context_sentence, item.word)}</div>
              </div>
            ` : ''}
          </div>
          <div class="brutalist-card__actions">
            <button type="button" class="brutalist-card__button brutalist-card__button--known" data-action="review-known" title="Dismiss word: won't show up again (Key: 1 or K)">
              Known (Dismiss)
            </button>
            <button type="button" class="brutalist-card__button brutalist-card__button--mine" data-action="review-mine" title="Mine to study deck until perfected according to FSRS (Key: 2 or M)">
              Mine to Deck
            </button>
          </div>
          <div class="brutalist-card__shortcuts">
            <span>[1 / K] Known</span> • <span>[2 / M] Mine</span> • <span>[Esc] Close</span>
          </div>
        </div>
      </div>
    `;
  }

  async startReviewSession(type, epHash) {
    const targetHash = epHash || this.expandedEpisodeHash;
    if (!targetHash) return;
    let data = this.episodeInspectorCache.get(targetHash);
    if (!data) {
      try {
        const level = this.learnerLevel || await getUniversalJlptLevel();
        data = await this.apiClient.getEpisodeInspector(targetHash, level);
        if (data) this.episodeInspectorCache.set(targetHash, data);
      } catch (err) {
        window.showToast?.(`Could not load episode review data: ${err?.message || 'error'}`, 'error');
        return;
      }
    }
    if (!data) return;

    const items = [];
    if (type === 'vocab' || type === 'all') {
      const missed = data.missed_words || [];
      missed.forEach(w => {
        items.push({
          type: 'vocab',
          word: w.word,
          reading: w.reading || '',
          meaning: w.meaning || '',
          level: w.jlpt || 'Unranked',
          context_sentence: w.context_sentence || '',
          image: w.image || '',
        });
      });
    }

    if (type === 'grammar' || type === 'all') {
      const grammar = (data.grammar_points || []).filter(g => !this.getDumpedGrammar().has(g.point));
      grammar.forEach(g => {
        items.push({
          type: 'grammar',
          word: g.point,
          pattern_key: g.pattern_key || g.point,
          reading: g.formation || '',
          meaning: g.meaning || '',
          level: g.jlpt || 'N4',
          context_sentence: g.example_sentence || '',
          image: '',
        });
      });
    }

    if (items.length === 0) return;

    this.reviewSession = {
      type,
      epHash: targetHash,
      items,
      currentIndex: 0,
      minedCount: 0,
      knownCount: 0,
    };
    this._attachReviewKeyboardListener();
    this._updateReviewOverlay();
  }

  _updateReviewOverlay() {
    if (!this.container) {
      this.renderSeriesDetail();
      return;
    }
    const existing = this.container.querySelector('#brutalist-review-overlay');
    if (typeof document !== 'undefined') {
      document.body?.classList.toggle('review-mode-active', Boolean(this.reviewSession));
    }
    if (!this.reviewSession) {
      if (existing) existing.remove();
      return;
    }
    const html = this._renderReviewOverlay();
    if (existing) {
      existing.outerHTML = html;
    } else {
      this.container.insertAdjacentHTML('beforeend', html);
    }
    this._bindReviewOverlayEvents();
  }

  _bindReviewOverlayEvents() {
    if (!this.container) return;
    const overlayEl = this.container.querySelector('#brutalist-review-overlay');
    if (!overlayEl) return;

    overlayEl.querySelectorAll('[data-action="close-review"]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.closeReviewSession();
      };
    });

    const reviewKnownBtn = overlayEl.querySelector('[data-action="review-known"]');
    if (reviewKnownBtn) {
      reviewKnownBtn.onclick = (e) => {
        e.stopPropagation();
        this.handleReviewAction('known');
      };
    }

    const reviewMineBtn = overlayEl.querySelector('[data-action="review-mine"]');
    if (reviewMineBtn) {
      reviewMineBtn.onclick = (e) => {
        e.stopPropagation();
        this.handleReviewAction('mine');
      };
    }

    overlayEl.onclick = (e) => {
      if (e.target === overlayEl) {
        this.closeReviewSession();
      }
    };
  }

  _attachReviewKeyboardListener() {
    this._detachReviewKeyboardListener();
    if (typeof window === 'undefined') return;
    this._reviewKeyHandler = (e) => {
      if (!this.reviewSession) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeReviewSession();
      } else if (e.key === '1' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        this.handleReviewAction('known');
      } else if (e.key === '2' || e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        this.handleReviewAction('mine');
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._reviewKeyHandler);
    }
  }

  _detachReviewKeyboardListener() {
    if (this._reviewKeyHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._reviewKeyHandler);
      this._reviewKeyHandler = null;
    }
  }

  closeReviewSession() {
    this._detachReviewKeyboardListener();
    this.reviewSession = null;
    this._updateReviewOverlay();
  }

  async handleReviewAction(action) {
    if (!this.reviewSession) return;
    const session = this.reviewSession;
    const item = session.items[session.currentIndex];
    if (!item) {
      this.closeReviewSession();
      return;
    }

    if (action === 'known') {
      if (item.type === 'vocab') {
        if (typeof this.apiClient.markKnownWord === 'function') {
          this.apiClient.markKnownWord(item.word).catch(() => {});
        }
      } else if (item.type === 'grammar') {
        this.dumpGrammarPoint(item.word, item.pattern_key);
      }
      session.knownCount++;
    } else if (action === 'mine') {
      const seriesName = this.selectedSeries?.series || 'Anime';
      getUniversalAnkiDeck().then((targetDeck) => {
        if (!targetDeck) {
          console.warn('[AnimeView] No universal Anki deck selected.');
          window.showToast?.('No universal Anki deck selected in Settings.', 'error');
          return;
        }
        if (this.linkMineService && typeof this.linkMineService.mineWord === 'function') {
          this.linkMineService.mineWord({
            expression: item.word,
            reading: item.reading,
            meaning: item.meaning,
            sentence: item.context_sentence || '',
            image: item.image || '',
            cue: { text: item.context_sentence || '', s: 0, e: 0 },
            session: { title: seriesName, site: 'anime' },
            deckName: targetDeck,
            tags: ['kiroku', 'anime', seriesName.replace(/\s+/g, '_')]
          }).catch(() => {});
        } else {
          const fallbackPayload = {
            expression: item.word,
            reading: item.reading || item.word,
            meaning: item.meaning,
            sentence: item.context_sentence || '',
            deck_name: targetDeck,
            source_text: `Mined from ${seriesName} [${item.type}]`
          };
          const savePromise = typeof this.apiClient.saveAndSyncCard === 'function'
            ? this.apiClient.saveAndSyncCard(fallbackPayload)
            : this.apiClient.request('/api/cards/save', { method: 'POST', body: fallbackPayload });
          savePromise.then(() => {
            if (typeof this.apiClient.markKnownWord === 'function') {
              this.apiClient.markKnownWord(item.word).catch(() => {});
            }
          }).catch(() => {});
        }
      }).catch(() => {});
      if (this.selectedSeries && Array.isArray(this.selectedSeries.episodes)) {
        const ep = this.selectedSeries.episodes.find(e => e.hash === session.epHash);
        if (ep) ep.mined = (ep.mined || 0) + 1;
      }
      session.minedCount++;
    }

    session.currentIndex++;
    this._updateReviewOverlay();
  }

  getDumpedGrammar() {
    try {
      const storage = typeof localStorage !== 'undefined' ? localStorage : this._memoryStorage;
      const raw = storage ? storage.getItem('kiroku_dumped_grammar') : null;
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (_) {
      return new Set();
    }
  }

  dumpGrammarPoint(point, key) {
    if (!point) return;
    const dumped = this.getDumpedGrammar();
    dumped.add(point);
    if (key) dumped.add(key);
    try {
      if (typeof localStorage === 'undefined' && !this._memoryStorage) {
        this._memoryStorage = {
          _data: new Map(),
          getItem(k) { return this._data.get(k) || null; },
          setItem(k, v) { this._data.set(k, String(v)); }
        };
      }
      const storage = typeof localStorage !== 'undefined' ? localStorage : this._memoryStorage;
      if (storage) {
        storage.setItem('kiroku_dumped_grammar', JSON.stringify(Array.from(dumped)));
      }
    } catch (_) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ kiroku_dumped_grammar: Array.from(dumped) });
      }
    } catch (_) {}
    try {
      const patternKey = key || point;
      this.apiClient.request(`/api/grammar/points/${encodeURIComponent(patternKey)}`, {
        method: 'PATCH',
        body: { status: 'ignored' }
      }).catch(() => {});
    } catch (_) {}
  }

  showConfirmModal({ title = 'Remove from Library', message = 'Are you sure?', confirmText = 'Remove', cancelText = 'Cancel' } = {}) {
    return new Promise((resolve) => {
      const existing = typeof document !== 'undefined' ? document.querySelector('.anime-confirm-modal-overlay') : null;
      if (existing) existing.remove();

      if (typeof document === 'undefined') {
        resolve(true);
        return;
      }

      const overlay = document.createElement('div');
      overlay.className = 'anime-confirm-modal-overlay';
      overlay.innerHTML = `
        <div class="anime-confirm-modal-card" role="dialog" aria-modal="true" aria-labelledby="anime-confirm-title">
          <div class="anime-confirm-header">
            <div class="anime-confirm-icon-wrap" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
            </div>
            <div>
              <h3 class="anime-confirm-title" id="anime-confirm-title">${escapeHtml(title)}</h3>
            </div>
          </div>
          <p class="anime-confirm-desc">${escapeHtml(message)}</p>
          <div class="anime-confirm-actions">
            <button type="button" class="anime-confirm-btn-cancel">${escapeHtml(cancelText)}</button>
            <button type="button" class="anime-confirm-btn-delete">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('is-open'));

      const cleanup = (confirmed) => {
        if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeyDown);
        overlay.classList.remove('is-open');
        overlay.classList.add('is-closing');
        setTimeout(() => {
          overlay.remove();
          resolve(confirmed);
        }, 160);
      };

      const cancelBtn = overlay.querySelector('.anime-confirm-btn-cancel');
      const confirmBtn = overlay.querySelector('.anime-confirm-btn-delete');

      if (cancelBtn) cancelBtn.onclick = () => cleanup(false);
      if (confirmBtn) confirmBtn.onclick = () => cleanup(true);
      overlay.onclick = (e) => {
        if (e.target === overlay) cleanup(false);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          cleanup(false);
        }
      };
      if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown);
      if (confirmBtn) confirmBtn.focus();
    });
  }

  showCardOptionsPopover(anchorBtn, seriesName) {
    if (typeof document === 'undefined') return;
    const existing = document.querySelector('.anime-card-menu-popover');
    if (existing) {
      existing.remove();
      if (existing._anchor === anchorBtn) return;
    }

    const isBookmarked = this.isSeriesBookmarked(seriesName);
    const popover = document.createElement('div');
    popover.className = 'anime-card-menu-popover';
    popover._anchor = anchorBtn;

    popover.innerHTML = `
      <button type="button" class="anime-menu-item anime-menu-open-series">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        <span>Open Series</span>
      </button>
      <button type="button" class="anime-menu-item anime-menu-toggle-bookmark">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${isBookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
        <span>${isBookmarked ? 'Remove Bookmark' : 'Bookmark Series'}</span>
      </button>
      <div class="anime-menu-divider"></div>
      <button type="button" class="anime-menu-item anime-menu-item--danger anime-menu-delete-series">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
        <span>Remove from Library</span>
      </button>
    `;

    document.body.appendChild(popover);

    if (typeof anchorBtn.getBoundingClientRect === 'function') {
      const rect = anchorBtn.getBoundingClientRect();
      const popoverWidth = 180;
      let left = rect.right - popoverWidth;
      if (left < 10) left = 10;
      let top = rect.bottom + 6;
      popover.style.position = 'fixed';
      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
      popover.style.zIndex = '9999';
    }

    const closePopover = () => {
      popover.remove();
      document.removeEventListener('click', onOutsideClick);
      if (typeof window !== 'undefined') window.removeEventListener('scroll', closePopover, true);
    };

    const onOutsideClick = (e) => {
      if (!popover.contains(e.target) && e.target !== anchorBtn && !anchorBtn.contains(e.target)) {
        closePopover();
      }
    };

    setTimeout(() => {
      document.addEventListener('click', onOutsideClick);
      if (typeof window !== 'undefined') window.addEventListener('scroll', closePopover, { capture: true, once: true });
    }, 10);

    const openBtn = popover.querySelector('.anime-menu-open-series');
    const bookmarkBtn = popover.querySelector('.anime-menu-toggle-bookmark');
    const deleteBtn = popover.querySelector('.anime-menu-delete-series');

    if (openBtn) {
      openBtn.onclick = (e) => {
        e.stopPropagation();
        closePopover();
        const found = this.seriesList.find(s => s.series === seriesName || s.series?.toLowerCase() === (seriesName || '').toLowerCase());
        if (found) this.openSeriesDetail(found);
      };
    }

    if (bookmarkBtn) {
      bookmarkBtn.onclick = (e) => {
        e.stopPropagation();
        closePopover();
        this.toggleSeriesBookmark(seriesName);
      };
    }

    if (deleteBtn) {
      deleteBtn.onclick = async (e) => {
        e.stopPropagation();
        closePopover();
        const confirmed = await this.showConfirmModal({
          title: 'Remove Series',
          message: `Are you sure you want to remove "${seriesName}" and all tracked progress from your library?`,
          confirmText: 'Remove',
          cancelText: 'Cancel'
        });
        if (confirmed) {
          try {
            await this.apiClient.request(`/api/link/series/${encodeURIComponent(seriesName)}`, { method: 'DELETE' });
            this.seriesList = this.seriesList.filter(s => s.series !== seriesName);
            try {
              if (typeof localStorage !== 'undefined') {
                localStorage.setItem('kiroku_anime_series_cache', JSON.stringify(this.seriesList));
              }
            } catch (_) {}
            this.render();
          } catch (err) {
            console.warn('[AnimeView] Failed to delete series:', err);
          }
        }
      };
    }
  }

  setupEvents() {
    if (!this.container) return;

    // Retry load button (shown in error or auth_error states)
    const btnRetry = this.container.querySelector('#btn-anime-retry-load');
    if (btnRetry) {
      btnRetry.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.fetchWatchHistory();
      };
    }

    // Auth actions in auth_error state
    const btnAuthLogin = this.container.querySelector('#btn-anime-auth-login');
    if (btnAuthLogin) {
      btnAuthLogin.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window !== 'undefined' && window.desktopAPI?.auth?.startOAuth) {
          window.desktopAPI.auth.startOAuth('google');
        } else if (typeof window !== 'undefined') {
          window.location.href = '/auth/google';
        }
      };
    }

    const btnAuthGuest = this.container.querySelector('#btn-anime-auth-guest');
    if (btnAuthGuest) {
      btnAuthGuest.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.loadState = 'empty';
        this.render();
      };
    }

    // Sync Cloud button
    const btnSync = this.container.querySelector('#btn-anime-sync');
    if (btnSync) {
      btnSync.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.isSyncing) return;
        await this.syncAnimeToCloud();
      };
    }

    // Title language toggle buttons
    const langBtns = this.container.querySelectorAll('.anime-lang-btn');
    langBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const lang = btn.getAttribute('data-lang');
        if (lang && lang !== this.titleLang) {
          this.setTitleLang(lang);
        }
      };
    });

    // Category pills
    const pills = this.container.querySelectorAll('.anime-cat-pill');
    pills.forEach(pill => {
      pill.onclick = () => {
        const cat = pill.getAttribute('data-cat');
        if (cat && cat !== this.activeCategory) {
          this.activeCategory = cat;
          this.render();
        }
      };
    });

    // Poster clicks with smooth glide FLIP (direct + delegation fallback)
    const historyList = this.container.querySelector('#anime-history-list');
    if (historyList) {
      historyList.onclick = (e) => {
        const card = e.target.closest('.anime-poster-card');
        if (!card) return;
        const bookmarkBtn = e.target.closest('.anime-card-bookmark-btn');
        if (bookmarkBtn) {
          e.stopPropagation();
          const sName = card.getAttribute('data-series');
          this.toggleSeriesBookmark(sName);
          return;
        }
        const moreBtn = e.target.closest('.anime-poster-more-btn');
        if (moreBtn) {
          e.stopPropagation();
          const sName = card.getAttribute('data-series');
          if (!sName) return;
          this.showCardOptionsPopover(moreBtn, sName);
          return;
        }

        const sName = card.getAttribute('data-series');
        const found = this.seriesList.find(s => s.series === sName || s.series?.toLowerCase() === (sName || '').toLowerCase());
        if (found) {
          const posterWrap = card.querySelector('.poster-image-wrap') || card;
          const rect = typeof posterWrap.getBoundingClientRect === 'function' ? posterWrap.getBoundingClientRect() : null;
          this.openSeriesDetail(found, rect);
        }
      };
    }

    const cards = this.container.querySelectorAll('.anime-poster-card');
    cards.forEach(card => {
      card.onclick = (e) => {
        const bookmarkBtn = e.target.closest('.anime-card-bookmark-btn');
        if (bookmarkBtn) {
          e.stopPropagation();
          const sName = card.getAttribute('data-series');
          this.toggleSeriesBookmark(sName);
          return;
        }
        const moreBtn = e.target.closest('.anime-poster-more-btn');
        if (moreBtn) {
          e.stopPropagation();
          const sName = card.getAttribute('data-series');
          if (!sName) return;
          this.showCardOptionsPopover(moreBtn, sName);
          return;
        }

        const sName = card.getAttribute('data-series');
        const found = this.seriesList.find(s => s.series === sName || s.series?.toLowerCase() === (sName || '').toLowerCase());
        if (found) {
          const posterWrap = card.querySelector('.poster-image-wrap') || card;
          const rect = typeof posterWrap.getBoundingClientRect === 'function' ? posterWrap.getBoundingClientRect() : null;
          this.openSeriesDetail(found, rect);
        }
      };
    });
  }

  setupDetailEvents() {
    if (!this.container) return;

    // Back button
    const backBtn = this.container.querySelector('#anime-back-btn');
    if (backBtn) {
      backBtn.onclick = () => {
        this.selectedSeries = null;
        this.render();
      };
    }

    // Title language toggle buttons in detail view
    const langBtns = this.container.querySelectorAll('.anime-lang-btn');
    langBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const lang = btn.getAttribute('data-lang');
        if (lang && lang !== this.titleLang) {
          this.setTitleLang(lang);
        }
      };
    });

    // Category override select
    const typeSelect = this.container.querySelector('#series-type-select');
    if (typeSelect && this.selectedSeries) {
      typeSelect.onchange = async () => {
        const newCat = typeSelect.value;
        this.selectedSeries.media_type = newCat;
        try {
          await this.apiClient.updateSeriesCategory(this.selectedSeries.series, newCat);
        } catch (e) {
          console.warn('[AnimeView] Failed to update category:', e);
        }
      };
    }

    // Continue Watching button (opens last watched episode link in default browser)
    const continueWatchBtn = this.container.querySelector('#anime-continue-watching-btn');
    if (continueWatchBtn) {
      continueWatchBtn.onclick = (e) => {
        e.stopPropagation();
        const url = continueWatchBtn.dataset.watchUrl || this._getSeriesContinueWatchUrl(this.selectedSeries);
        if (url && /^https?:\/\//i.test(url) && typeof window !== 'undefined' && typeof window.open === 'function') {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      };
    }

    // Delete entire series button
    const deleteSeriesBtn = this.container.querySelector('#anime-delete-series-btn');
    if (deleteSeriesBtn && this.selectedSeries) {
      deleteSeriesBtn.onclick = async (e) => {
        e.stopPropagation();
        const sName = this.selectedSeries.series;
        if (!sName) return;
        const confirmed = await this.showConfirmModal({
          title: 'Remove Series',
          message: `Are you sure you want to remove "${sName}" and all its episodes from your library?`,
          confirmText: 'Remove',
          cancelText: 'Cancel'
        });
        if (!confirmed) return;
        try {
          await this.apiClient.request(`/api/link/series/${encodeURIComponent(sName)}`, { method: 'DELETE' });
          this.seriesList = this.seriesList.filter(s => s.series !== sName);
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('kiroku_anime_series_cache', JSON.stringify(this.seriesList));
            }
          } catch (_) {}
          this.selectedSeries = null;
          this.render();
        } catch (err) {
          console.warn('[AnimeView] Failed to delete series:', err);
        }
      };
    }

    // Subtabs
    const subtabs = this.container.querySelectorAll('.anime-subtab');
    subtabs.forEach(tab => {
      tab.onclick = () => {
        const val = tab.getAttribute('data-subtab');
        if (val) {
          this.seriesDetailTab = val;
          subtabs.forEach(t => {
            const isActive = t.getAttribute('data-subtab') === val;
            t.classList.toggle('active', isActive);
            t.setAttribute('aria-selected', String(isActive));
          });
          this._updateDetailSubtabContent();
        }
      };
    });

    // Episode row gap primer buttons
    const primerBtns = this.container.querySelectorAll('.ep-primer-btn');
    primerBtns.forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const hash = btn.getAttribute('data-hash');
        if (hash) {
          await this.openEpisodePrimer(hash);
        }
      };
    });

    // Episode row inspection toggle buttons
    const inspectToggleBtns = this.container.querySelectorAll('.ep-inspect-toggle-btn');
    inspectToggleBtns.forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const hash = btn.getAttribute('data-hash');
        await this.toggleEpisodeInspector(hash);
      };
    });

    // Episode row delete buttons
    const deleteBtns = this.container.querySelectorAll('.ep-delete-btn');
    deleteBtns.forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const hash = btn.getAttribute('data-hash');
        if (!hash) return;
        const confirmed = await this.showConfirmModal({
          title: 'Remove Episode',
          message: 'Are you sure you want to remove this episode from your library?',
          confirmText: 'Remove',
          cancelText: 'Cancel'
        });
        if (!confirmed) return;
        const group = btn.closest('.anime-episode-group') || btn.closest('.anime-episode-row');
        if (group) {
          group.style.transition = 'all 160ms ease';
          group.style.opacity = '0';
          group.style.transform = 'scale(0.95)';
          setTimeout(() => group.remove(), 160);
        }
        if (this.selectedSeries && Array.isArray(this.selectedSeries.episodes)) {
          this.selectedSeries.episodes = this.selectedSeries.episodes.filter(ep => ep.hash !== hash);
        }
        try {
          await this.apiClient.request(`/api/link/episodes/${encodeURIComponent(hash)}`, { method: 'DELETE' });
        } catch (err) {
          console.warn('[AnimeView] Failed to delete episode record:', err);
        }
      };
    });

    // Row click expands episode inspector drawer
    const epRows = this.container.querySelectorAll('.anime-episode-row');
    epRows.forEach(row => {
      row.onclick = async (e) => {
        if (e.target.closest('.ep-primer-btn') || e.target.closest('.ep-inspect-toggle-btn') || e.target.closest('.ep-delete-btn')) {
          return;
        }
        const hash = row.getAttribute('data-hash');
        await this.toggleEpisodeInspector(hash);
      };
    });

    // Study These button
    const studyBtn = this.container.querySelector('#study-primer-btn');
    if (studyBtn) {
      studyBtn.onclick = () => {
        this.startPrimerReviewSession();
      };
    }

    // Bind inline inspector events if an inspector drawer is currently open
    const expandedGroup = this.container.querySelector('.anime-episode-group.is-expanded');
    if (expandedGroup) {
      this._bindInlineInspectorEvents(expandedGroup);
    }

    // Review Overlay actions (Known, Mine, Close)
    this._bindReviewOverlayEvents();
  }

  updateSyncProgress(pct, text = '', state = null) {
    if (this._syncHideTimer) {
      clearTimeout(this._syncHideTimer);
      this._syncHideTimer = null;
    }
    this.syncProgressPct = Math.max(0, Math.min(100, Number(pct) || 0));
    this.syncProgressText = text || '';
    const wrap = this.container?.querySelector?.('#anime-sync-progress');
    const textEl = this.container?.querySelector?.('#anime-sync-progress-text');
    const pctEl = this.container?.querySelector?.('#anime-sync-progress-pct');
    const fillEl = this.container?.querySelector?.('#anime-sync-progress-fill');
    const trackEl = wrap?.querySelector?.('.anime-sync-progress-track');
    if (wrap) wrap.hidden = !this.syncProgressText && !this.isSyncing;
    if (textEl) textEl.textContent = this.syncProgressText;
    if (pctEl) pctEl.textContent = `${Math.round(this.syncProgressPct)}%`;
    if (trackEl) trackEl.setAttribute('aria-valuenow', String(Math.round(this.syncProgressPct)));
    if (fillEl) {
      fillEl.style.width = `${this.syncProgressPct}%`;
      fillEl.classList.toggle('is-done', state === 'synced');
      fillEl.classList.toggle('is-error', state === 'error');
    }
  }

  updateSyncButtonUI() {
    const btn = this.container?.querySelector('#btn-anime-sync');
    const label = this.container?.querySelector('#label-anime-sync');
    const icon = btn?.querySelector('.anime-sync-icon');
    if (!btn || !label) return;

    if (this.isSyncing) {
      btn.classList.add('is-syncing');
      icon?.classList.add('is-spinning');
      label.textContent = 'Syncing...';
      btn.title = 'Syncing anime watch history and posters to cloud...';
    } else if (this.syncStatus === 'synced') {
      btn.classList.remove('is-syncing');
      icon?.classList.remove('is-spinning');
      label.textContent = 'Synced';
      btn.title = 'All anime series, posters and watch history synced to cloud';
    } else if (this.syncStatus === 'error') {
      btn.classList.remove('is-syncing');
      icon?.classList.remove('is-spinning');
      label.textContent = 'Sync Retry';
      btn.title = 'Sync interrupted. Click to retry';
    } else {
      btn.classList.remove('is-syncing');
      icon?.classList.remove('is-spinning');
      label.textContent = 'Sync Cloud';
      btn.title = 'Sync anime watch history, posters & cards to cloud';
    }
  }

  async _getCloudAuthToken() {
    let token = '';
    if (typeof window !== 'undefined' && window.desktopAPI?.auth?.getSession) {
      try {
        const s = await window.desktopAPI.auth.getSession();
        token = s?.token || s?.access_token || '';
      } catch (_) {}
    }
    if (!token && typeof localStorage !== 'undefined') {
      try {
        token = (localStorage.getItem('kiroku_auth_token') || localStorage.getItem('token') || '').replace(/^"|"$/g, '').trim();
        if (!token) {
          const sessionRaw = localStorage.getItem('kiroku_auth_session');
          if (sessionRaw) {
            const parsed = JSON.parse(sessionRaw);
            token = parsed?.token || parsed?.access_token || '';
          }
        }
        if (!token) {
          const rawUser = localStorage.getItem('kiroku:auth-user') || localStorage.getItem('kiroku_auth_user');
          if (rawUser) {
            const u = JSON.parse(rawUser);
            token = u?.token || u?.access_token || '';
          }
        }
      } catch (_) {}
    }
    return token;
  }

  async requestCloudApi(endpoint, options = {}) {
    const isDesktop = typeof window !== 'undefined' && Boolean(window.desktopAPI?.isDesktop);

    if (!isDesktop && this.apiClient) {
      return this.apiClient.request(endpoint, options);
    }

    const workerHost = (typeof process !== 'undefined' && process.env?.WORKER_URL) || 'https://kiroku-note.rhythmkach.workers.dev';
    const token = await this._getCloudAuthToken();
    if (!token) {
      throw new Error('Not signed in. Please sign in with Google first.');
    }

    const url = `${workerHost}${endpoint}`;
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };

    const controller = new AbortController();
    const timeoutMs = options.timeout || 25000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`Cloud API ${resp.status}: ${errText}`);
      }
      return await resp.json();
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  _parseEpisodeNum(ep) {
    const explicit = Number(ep?.episode_number || 0);
    if (explicit > 1) return explicit;
    const text = String(ep?.title || ep?.hash || '');
    for (const pat of [
      /S\d+\s*E(\d+)/i,
      /第\s*(\d+)\s*話/,
      /(?:ep|episode|#)\s*(\d+)/i,
      /(?:^|[\s\-_])(\d{1,3})(?:\s*$|[\s\-_\[.(])/,
    ]) {
      const m = text.match(pat);
      if (m) {
        const v = parseInt(m[1], 10);
        if (v > 0 && v < 2000) return v;
      }
    }
    return explicit >= 1 ? explicit : 1;
  }

  async syncAnimeToCloud(options = {}) {
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.syncStatus = 'syncing';
    this.updateSyncButtonUI();
    if (!options.silent) {
      this.updateSyncProgress(8, 'Preparing anime watch history...');
    }

    try {
      // 1. Ensure latest local series & episodes
      if (!this.seriesList || this.seriesList.length === 0) {
        await this.fetchWatchHistory();
      }
      if (!options.silent) {
        this.updateSyncProgress(22, 'Pushing watch progress to cloud...');
      }

      // 2. Build non-destructive payload
      const payload = [];
      const localSeries = this.deduplicateSeriesList(this.seriesList || []);
      for (const s of localSeries) {
        const sId = s.series || s.title_english || 'Anime';
        const posterUrl = s.poster_url || '';
        const synopsis = s.synopsis || '';
        const mediaType = s.media_type || 'anime';
        const seriesTitle = s.title_english || s.series || '';
        const titleNative = s.title_native || '';
        const titleEnglish = s.title_english || seriesTitle;

        const episodes = Array.isArray(s.episodes) ? s.episodes : [];
        if (episodes.length === 0) {
          payload.push({
            series_id: sId,
            series_title: seriesTitle,
            title_native: titleNative,
            title_english: titleEnglish,
            episode_number: 1,
            last_position_ms: 0,
            duration_ms: 0,
            completed: 0,
            mined_card_count: 0,
            poster_url: posterUrl,
            synopsis: synopsis,
            media_type: mediaType
          });
        } else {
          for (const ep of episodes) {
            const epNum = this._parseEpisodeNum(ep);
            const dur = Number(ep.duration_ms || 0);
            const pos = Number(ep.last_position_ms || 0);
            const completed = (ep.completed || (dur > 0 && pos >= dur * 0.85)) ? 1 : 0;
            const mined = Number(ep.mined || 0);
            payload.push({
              series_id: sId,
              series_title: seriesTitle,
              title_native: titleNative,
              title_english: titleEnglish,
              episode_number: epNum,
              last_position_ms: pos,
              duration_ms: dur,
              completed: completed,
              mined_card_count: mined,
              poster_url: posterUrl || ep.poster_url || '',
              synopsis: synopsis || ep.synopsis || '',
              media_type: mediaType,
              cue_hash: ep.hash || ''
            });
          }
        }
      }

      // Merge with queued offline updates if any
      const queueKey = 'kiroku_anime_sync_queue';
      let queuedPayload = [];
      try {
        const rawQueue = typeof localStorage !== 'undefined' ? localStorage.getItem(queueKey) : null;
        if (rawQueue) queuedPayload = JSON.parse(rawQueue);
      } catch (_) {}

      const combined = [...queuedPayload, ...payload];
      const dedupMap = new Map();
      for (const item of combined) {
        const k = item.cue_hash ? `hash:${item.cue_hash}` : `${item.series_id}_ep${item.episode_number}`;
        if (!dedupMap.has(k) || (item.last_position_ms || 0) > (dedupMap.get(k).last_position_ms || 0)) {
          dedupMap.set(k, item);
        }
      }
      const finalPayload = Array.from(dedupMap.values());

      // 3. Batch push to cloud
      if (finalPayload.length > 0) {
        if (!options.silent) {
          this.updateSyncProgress(22, `Uploading watch progress (${finalPayload.length} episodes)...`);
        }
        try {
          await this.requestCloudApi('/api/user/progress/anime/batch', {
            method: 'POST',
            body: JSON.stringify({ progress: finalPayload, anime_progress: finalPayload })
          });
          if (typeof localStorage !== 'undefined') localStorage.removeItem(queueKey);
        } catch (pushErr) {
          if (typeof localStorage !== 'undefined') {
            try {
              localStorage.setItem(queueKey, JSON.stringify(finalPayload.slice(-50)));
            } catch (_) {}
          }
          throw pushErr;
        }
      }

      // 4. Fetch cloud progress & episode cues for bidirectional additive merge
      if (!options.silent) {
        this.updateSyncProgress(38, 'Fetching cloud watch progress...');
      }
      const cloudData = await this.requestCloudApi('/api/user/progress/anime');
      const cloudProgress = Array.isArray(cloudData?.progress) ? cloudData.progress : [];
      if (!options.silent) {
        this.updateSyncProgress(48, 'Checking cloud subtitle cues...');
      }
      let cloudEpisodes = [];
      try {
        const epsResp = await this.requestCloudApi('/api/link/episodes?limit=200');
        cloudEpisodes = Array.isArray(epsResp)
          ? epsResp
          : (Array.isArray(epsResp?.episodes) ? epsResp.episodes : []);
      } catch (_) {}

      let hadCloudUpdates = false;
      const localEpByHash = new Map();
      for (const s of localSeries) {
        for (const e of (s.episodes || [])) {
          if (e.hash) localEpByHash.set(e.hash, e);
        }
      }

      for (const cp of cloudProgress) {
        const cpPos = Number(cp.last_position_ms || 0);
        const cpDur = Number(cp.duration_ms || 0);
        const cpCompleted = Boolean(cp.completed || (cpDur > 0 && cpPos >= cpDur * 0.85));
        const sTitle = cp.series_title || cp.series_id || 'Anime';
        const cpHash = (cp.cue_hash || '').trim();

        const matched = localSeries.find(s => (
          s.series === cp.series_id ||
          s.title_english === cp.series_id ||
          s.title_native === cp.series_id ||
          s.series === cp.series_title ||
          s.title_english === cp.series_title ||
          s.title_native === cp.series_title ||
          (s.poster_url && cp.poster_url && s.poster_url === cp.poster_url)
        ));

        let ep = cpHash ? localEpByHash.get(cpHash) : null;
        if (!ep && matched) {
          ep = (matched.episodes || []).find(e => this._parseEpisodeNum(e) === Number(cp.episode_number || 1));
        }

        const targetHash = (ep && ep.hash) || cpHash || `${cp.series_id || 'ep'}_ep${cp.episode_number || 1}`;
        const currentLocalPos = Number(ep?.last_position_ms || 0);
        const currentLocalDur = Number(ep?.duration_ms || 0);
        const needsLocalPersist = !ep || cpPos > currentLocalPos || cpDur > currentLocalDur || (cpCompleted && !ep.completed);

        if (needsLocalPersist) {
          try {
            await this.apiClient.request(`/api/link/episodes/${encodeURIComponent(targetHash)}/position`, {
              method: 'POST',
              body: JSON.stringify({
                last_position_ms: Math.max(currentLocalPos, cpPos),
                duration_ms: Math.max(currentLocalDur, cpDur),
                completed: Boolean(ep?.completed) || cpCompleted,
                title: ep?.title || `Episode ${cp.episode_number || 1}`,
                series: sTitle,
                episode_number: cp.episode_number || 1,
                media_type: cp.media_type || 'anime',
                poster_url: cp.poster_url || '',
              })
            });
            hadCloudUpdates = true;
          } catch (_) {}
        }
      }

      // Pull missing cues for cloud episodes so local SQLite has full analytics & transcripts
      for (const ce of cloudEpisodes) {
        const ceHash = (ce.hash || '').trim();
        if (!ceHash) continue;
        const localEp = localEpByHash.get(ceHash);
        if (!localEp || !localEp.has_cues) {
          try {
            const cueDetail = await this.requestCloudApi(`/api/link/episodes/${encodeURIComponent(ceHash)}/cues`);
            if (cueDetail && Array.isArray(cueDetail.cues) && cueDetail.cues.length > 0) {
              await this.apiClient.request('/api/link/episodes/sync', {
                method: 'POST',
                body: JSON.stringify({
                  hash: ceHash,
                  title: cueDetail.title || ce.title || '',
                  series: cueDetail.series || ce.series || '',
                  episode_number: cueDetail.episode_number || ce.episode_number || 1,
                  episode_key: cueDetail.episode_key || ce.episode_key || '',
                  site: cueDetail.site || ce.site || 'generic',
                  media_type: cueDetail.media_type || ce.media_type || 'anime',
                  cues: cueDetail.cues,
                  duration_ms: cueDetail.duration_ms || ce.duration_ms || 0,
                  mined_words: cueDetail.mined_words || [],
                })
              });
              hadCloudUpdates = true;
            }
          } catch (_) {}
        }
      }

      // 4.5 On Desktop, push local episode cues & grammar that are missing in Cloud Turso
      const isDesktop = typeof window !== 'undefined' && Boolean(window.desktopAPI?.isDesktop);
      if (isDesktop && this.apiClient) {
        try {
          const cloudEpMap = new Map(cloudEpisodes.map(ce => [String(ce.hash || '').trim(), ce]));
          const localEpsRaw = await this.apiClient.request('/api/link/episodes?limit=200').catch(() => []);
          const localEps = Array.isArray(localEpsRaw) ? localEpsRaw : (Array.isArray(localEpsRaw?.episodes) ? localEpsRaw.episodes : []);
          const toUpload = localEps.filter(le => {
            const leHash = String(le?.hash || '').trim();
            if (!leHash || !le?.has_cues) return false;
            const cloudMatch = cloudEpMap.get(leHash);
            const hasCloudCues = cloudMatch && Number(cloudMatch.total_lines || 0) > 0;
            const hasGrammarSynced = typeof localStorage !== 'undefined' && localStorage.getItem(`kiroku_grammar_synced_${leHash}`) === '1';
            return !hasCloudCues || !hasGrammarSynced;
          });
          for (let idx = 0; idx < toUpload.length; idx++) {
            const le = toUpload[idx];
            const leHash = String(le.hash).trim();
            const cloudMatch = cloudEpMap.get(leHash);
            const hasCloudCues = cloudMatch && Number(cloudMatch.total_lines || 0) > 0;
            if (!options.silent) {
              const pct = 55 + Math.round(((idx + 1) / Math.max(1, toUpload.length)) * 18);
              this.updateSyncProgress(pct, `Uploading subtitle cues & grammar (${idx + 1}/${toUpload.length})...`);
            }
            try {
              const localDetail = hasCloudCues
                ? { cues: [] }
                : await this.apiClient.request(`/api/link/episodes/${encodeURIComponent(leHash)}/cues`);
              const rawCues = Array.isArray(localDetail?.cues) ? localDetail.cues : [];
              if (!hasCloudCues && rawCues.length === 0) continue;
              let grammarPoints = [];
              try {
                const insp = await this.apiClient.getEpisodeInspector(leHash, this.learnerLevel || 'N4');
                if (Array.isArray(insp?.grammar_points)) grammarPoints = insp.grammar_points;
              } catch (_) {}
              const compactCues = rawCues.map((q, idx) => {
                const out = {
                  i: q?.i ?? idx,
                  s: Number(q?.s ?? q?.startTime ?? 0) || 0,
                  e: Number(q?.e ?? q?.endTime ?? 0) || 0,
                  text: String(q?.text || '').slice(0, 2000)
                };
                if (Array.isArray(q?.tokens) && q.tokens.length > 0) {
                  out.tokens = q.tokens.map(t => ({
                    surface: t?.surface || t?.text || '',
                    lemma: t?.lemma || t?.surface || '',
                    reading: t?.reading || '',
                    pos: Array.isArray(t?.pos) ? (t.pos[0] || '') : (t?.pos || ''),
                    jlpt_level: t?.jlpt_level || t?.jlpt || '',
                    status: t?.status || 'unstyled',
                    meaning: t?.meaning || t?.gloss || ''
                  }));
                }
                return out;
              });
              const matchedLocalSeries = localSeries.find(s => (s.episodes || []).some(e => e.hash === leHash));
              await this.requestCloudApi('/api/link/episodes/sync', {
                method: 'POST',
                timeout: 45000,
                body: JSON.stringify({
                  hash: leHash,
                  title: localDetail.title || le.title || '',
                  series: localDetail.series || le.series || matchedLocalSeries?.series || '',
                  episode_number: localDetail.episode_number || le.episode_number || this._parseEpisodeNum(le),
                  episode_key: localDetail.episode_key || le.episode_key || '',
                  site: localDetail.site || le.site || 'generic',
                  media_type: localDetail.media_type || le.media_type || matchedLocalSeries?.media_type || 'anime',
                  poster_url: matchedLocalSeries?.poster_url || '',
                  synopsis: matchedLocalSeries?.synopsis || '',
                  known_pct: Number(le.known_pct || 0) || 0,
                  cues: compactCues,
                  grammar_points: grammarPoints,
                  duration_ms: localDetail.duration_ms || le.duration_ms || 0,
                  mined_words: localDetail.mined_words || []
                })
              });
              if (grammarPoints.length > 0 && typeof localStorage !== 'undefined') {
                try { localStorage.setItem(`kiroku_grammar_synced_${leHash}`, '1'); } catch (_) {}
              }
            } catch (epPushErr) {
              console.debug('[AnimeSync] Cue upload notice for', leHash, epPushErr?.message);
            }
          }
        } catch (_) {}
      }

      // 5. On Desktop, also sync mined cards & frames with cloud queue
      if (isDesktop && this.apiClient) {
        if (!options.silent) {
          this.updateSyncProgress(76, 'Syncing mined cards & episode frames...');
        }
        const cloudToken = await this._getCloudAuthToken().catch(() => '');
        try {
          const syncRes = await this.apiClient.request('/api/cloud/sync/run', {
            method: 'POST',
            body: cloudToken ? { token: cloudToken } : {}
          });
          if (syncRes && (syncRes.pulled > 0 || syncRes.imported > 0)) {
            hadCloudUpdates = true;
          }
        } catch (cardSyncErr) {
          console.debug('[AnimeSync] Card sync notice:', cardSyncErr?.message);
        }
        if (cloudToken) {
          try {
            const seriesNames = localSeries.flatMap(s => [s.series, s.title_english, s.title_native].filter(Boolean));
            const repushRes = await this.apiClient.request('/api/cloud/sync/push-anime-cards', {
              method: 'POST',
              body: { token: cloudToken, series_names: seriesNames }
            });
            if (!options.silent && repushRes?.pushed > 0) {
              this.updateSyncProgress(90, `Uploaded ${repushRes.pushed} mined cards & frames...`);
            }
          } catch (repushErr) {
            console.debug('[AnimeSync] Anime cards repush notice:', repushErr?.message);
          }
        }
      }

      if (hadCloudUpdates) {
        if (!options.silent) {
          this.updateSyncProgress(95, 'Refreshing library...');
        }
        await this.fetchWatchHistory();
        if (this.selectedSeries && this.apiClient?.getSeriesCards) {
          try {
            this.seriesCards = await this.apiClient.getSeriesCards(this.selectedSeries.series);
            this._updateDetailSubtabContent();
          } catch (_) {}
        }
      }

      this.syncStatus = 'synced';
      if (!options.silent) {
        this.updateSyncProgress(100, hadCloudUpdates ? 'Synced & pulled latest updates' : 'Library up to date', 'synced');
        window.showToast?.(hadCloudUpdates ? 'Synced & pulled latest updates from cloud.' : 'Anime library is up to date.', 'success');
      }
    } catch (err) {
      console.warn('[AnimeSync] Sync error:', err);
      this.syncStatus = 'error';
      if (!options.silent) {
        this.updateSyncProgress(100, `Sync failed: ${err?.message || 'Check login or network.'}`, 'error');
        window.showToast?.(`Cloud sync failed: ${err?.message || 'Check login or network.'}`, 'error');
      }
    } finally {
      this.isSyncing = false;
      this.updateSyncButtonUI();
      if (!options.silent) {
        this._syncHideTimer = setTimeout(() => {
          this.updateSyncProgress(0, '');
        }, 3000);
        setTimeout(() => {
          if (this.syncStatus === 'synced') {
            this.syncStatus = 'idle';
            this.updateSyncButtonUI();
          }
        }, 4000);
      }
    }
  }

  triggerAutoSync(delayMs = 2000) {
    if (this._autoSyncTimer) {
      clearTimeout(this._autoSyncTimer);
    }
    this._autoSyncTimer = setTimeout(() => {
      this.syncAnimeToCloud({ silent: true }).catch(err => {
        console.debug('[AnimeView] Auto-sync quiet notice:', err.message);
      });
    }, delayMs);
  }

  unmount() {
    this.closeReviewSession();
    this._detachReviewKeyboardListener();
    if (this._delegatedContainer && this._delegatedClickHandler && typeof this._delegatedContainer.removeEventListener === 'function') {
      this._delegatedContainer.removeEventListener('click', this._delegatedClickHandler);
    }
    this._delegatedContainer = null;
    this._delegatedClickHandler = null;
    if (this._autoSyncTimer) {
      clearTimeout(this._autoSyncTimer);
      this._autoSyncTimer = null;
    }
    if (this.boundLearnerLevelHandler) {
      if (typeof window !== 'undefined') window.removeEventListener('kiroku:learner-level-changed', this.boundLearnerLevelHandler);
      this.boundLearnerLevelHandler = null;
    }
    if (this._boundAuthChangedHandler) {
      if (typeof window !== 'undefined') window.removeEventListener('kiroku:auth-changed', this._boundAuthChangedHandler);
      this._boundAuthChangedHandler = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.container = null;
  }

  async onShow() {
    try {
      const currentLevel = await getUniversalJlptLevel();
      if (currentLevel && currentLevel !== this.learnerLevel) {
        this.learnerLevel = currentLevel;
        this.episodeInspectorCache.clear();
        if (this.expandedEpisodeHash && this.container) {
          this.toggleEpisodeInspector(this.expandedEpisodeHash, true);
        }
      }
    } catch (_) {}
    if (Date.now() - this._lastFetchAt > 30000) {
      this._lastFetchAt = Date.now();
      this.fetchWatchHistory();
    }
    this.triggerAutoSync(1500);
  }

  onHide() {
    if (this.reviewSession) {
      this.closeReviewSession();
    }
  }
}
