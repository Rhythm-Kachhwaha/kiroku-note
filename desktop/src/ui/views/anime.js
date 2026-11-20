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
import { getUniversalJlptLevel } from '../utils/learner.js';

let _sharedLinkClient = null;
let _sharedLinkStore = null;
let _sharedLinkMineService = null;

export function getSharedLink(options = {}) {
  if (!_sharedLinkClient) {
    _sharedLinkClient = options.linkClient || null;
    _sharedLinkStore = options.linkStore || new LinkStore(_sharedLinkClient);
  }
  if (!_sharedLinkMineService) {
    _sharedLinkMineService = options.linkMineService || new LinkMineService({
      linkStore: _sharedLinkStore,
      apiClient: options.apiClient || apiClient
    });
  }
  return {
    linkClient: _sharedLinkClient,
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
    this.reviewSession = null;
    this._reviewKeyHandler = null;
    this.activeStreamSession = null;
    this.isLoading = false;
    this.backendPort = 21828;
    this._lastFetchAt = 0;

    // Bound listeners
    this._onSessionChange = this._onSessionChange.bind(this);
    if (this.linkStore && typeof this.linkStore.on === 'function') {
      this.linkStore.on('session', this._onSessionChange);
    }
  }

  getSeriesTitle(item, lang = this.titleLang) {
    if (!item) return '';
    if (lang === 'jp') {
      return item.title_native || item.series_title_native || item.series || '';
    }
    return item.title_english || item.series_title_english || item.series || '';
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

  _onSessionChange(session) {
    this.activeStreamSession = session;
    this.renderStreamPill();
  }

  _startStatusPolling() {
    this._stopStatusPolling();
    const poll = async () => {
      try {
        const status = await this.apiClient.request('/api/link/status');
        if (status && status.active_session) {
          this.activeStreamSession = status.active_session;
        } else if (status && Array.isArray(status.sessions) && status.sessions.length > 0) {
          this.activeStreamSession = status.sessions[0];
        } else if (!this.linkStore || !this.linkStore.currentSession) {
          this.activeStreamSession = null;
        }
        this.renderStreamPill();
      } catch (_) {}
    };
    poll();
    this._statusPollTimer = setInterval(poll, 5000);
  }

  _stopStatusPolling() {
    if (this._statusPollTimer) {
      clearInterval(this._statusPollTimer);
      this._statusPollTimer = null;
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
      window.addEventListener('kiroku:learner-level-changed', this.boundLearnerLevelHandler);
    }
    try {
      const info = await this.apiClient.getBackendInfo();
      if (info && info.port) this.backendPort = info.port;
    } catch (_) {}
    this.render();
    this._startStatusPolling();
    await this.fetchWatchHistory();
  }

  async fetchWatchHistory() {
    this.isLoading = true;
    try {
      const data = await this.apiClient.request('/api/link/series');
      this.seriesList = Array.isArray(data) ? data : [];
      try {
        const sess = await this.apiClient.request('/api/link/sessions');
        this.recentSessions = Array.isArray(sess) ? sess : [];
      } catch (e) {
        this.recentSessions = [];
      }
    } catch (err) {
      console.warn('[AnimeView] Failed to load series:', err);
      this.seriesList = [];
      this.recentSessions = [];
    } finally {
      this.isLoading = false;
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

            <!-- Right Controls: Language Toggle & Category Section Pills -->
            <div class="anime-header-right">
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

          <!-- Active Live Stream Bar -->
          <div id="anime-stream-pill-container"></div>

          <!-- Main Content: History List / Series Grid or Empty State -->
          <div id="anime-history-list" class="anime-history-list-root">
            ${this._renderGridContent()}
          </div>
        </div>
      </div>
    `;

    this.renderStreamPill();
    this.setupEvents();
  }

  renderStreamPill() {
    if (!this.container) return;
    const pillContainer = this.container.querySelector('#anime-stream-pill-container');
    if (!pillContainer) return;

    if (!this.activeStreamSession) {
      pillContainer.innerHTML = '';
      return;
    }

    const title = escapeHtml(this.activeStreamSession.title || 'Live Video');
    const site = escapeHtml(this.activeStreamSession.site || 'web');
    pillContainer.innerHTML = `
      <div class="anime-stream-pill">
        <div class="stream-pill-left">
          <span class="stream-badge">LIVE STREAM</span>
          <span class="stream-title">${title}</span>
          <span class="stream-site">(${site})</span>
        </div>
        <button class="stream-open-btn" id="stream-jump-btn">Open Series</button>
      </div>
    `;

    const jumpBtn = pillContainer.querySelector('#stream-jump-btn');
    if (jumpBtn) {
      jumpBtn.onclick = () => {
        const found = this.seriesList.find(s => s.series === this.activeStreamSession.title || s.series.toLowerCase().includes(this.activeStreamSession.title.toLowerCase()));
        if (found) {
          this.openSeriesDetail(found);
        }
      };
    }
  }

  renderConnectionStepper(statusSummary = {}) {
    const isBackendUp = true;
    const isExtConnected = Boolean((statusSummary.extCount && statusSummary.extCount > 0) || (statusSummary.peerCounts && statusSummary.peerCounts.ext > 0));
    const hasVideo = Boolean(statusSummary.hasVideo || statusSummary.activeSession);
    const hasSubs = Boolean((statusSummary.subCount && statusSummary.subCount > 0) || (statusSummary.cueCount && statusSummary.cueCount > 0) || (statusSummary.subStatus && statusSummary.subStatus.count > 0));
    const videoTitle = statusSummary.videoTitle || (statusSummary.activeSession ? statusSummary.activeSession.title : (hasVideo ? 'Sample Anime' : ''));

    let rejectHtml = '';
    if (this.lastReject) {
      rejectHtml = `
        <div class="anime-reject-banner">
          Extension Connection Rejected (${escapeHtml(this.lastReject.reason || 'unknown')})
        </div>
      `;
    }

    return `
      <div class="anime-connection-stepper-card">
        ${rejectHtml}
        <div class="stepper-step step-1 ${isBackendUp ? 'is-complete' : ''}">
          <span class="step-label">Step 1: Link Hub Backend</span>
          <span class="step-desc">Online</span>
        </div>
        <div class="stepper-step step-2 ${isExtConnected ? 'is-complete' : ''}">
          <span class="step-label">Step 2: Extension Online</span>
          <span class="step-desc">${isExtConnected ? 'Browser extension connected' : 'Extension not connected'}</span>
        </div>
        <div class="stepper-step step-3 ${hasVideo ? 'is-complete' : ''}">
          <span class="step-label">Step 3: Video Detected</span>
          <span class="step-desc">${hasVideo ? escapeHtml(videoTitle) : 'No video'}</span>
        </div>
        <div class="stepper-step step-4 ${hasSubs ? 'is-complete' : ''}">
          <span class="step-label">Step 4: Subtitles Loaded</span>
          <span class="step-desc">${hasSubs ? 'Subtitles active' : 'No subtitles'}</span>
        </div>
      </div>
    `;
  }

  isSeriesPinned(seriesName) {
    try {
      const saved = JSON.parse(localStorage.getItem('kiroku_anime_pinned') || localStorage.getItem('kiroku_anime_bookmarks') || '[]');
      return Array.isArray(saved) && saved.includes(seriesName);
    } catch (e) {
      return false;
    }
  }

  toggleSeriesPin(seriesName) {
    try {
      let saved = JSON.parse(localStorage.getItem('kiroku_anime_pinned') || localStorage.getItem('kiroku_anime_bookmarks') || '[]');
      if (!Array.isArray(saved)) saved = [];
      if (saved.includes(seriesName)) {
        saved = saved.filter(s => s !== seriesName);
      } else {
        saved.push(seriesName);
      }
      localStorage.setItem('kiroku_anime_pinned', JSON.stringify(saved));
      this.render();
    } catch (e) {
      console.warn('[AnimeView] Failed to toggle pin:', e);
    }
  }

  isSeriesBookmarked(seriesName) {
    return this.isSeriesPinned(seriesName);
  }

  toggleSeriesBookmark(seriesName) {
    this.toggleSeriesPin(seriesName);
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

    const filtered = (this.activeCategory === 'all'
      ? this.seriesList
      : this.seriesList.filter(s => (s.media_type || 'anime').toLowerCase() === this.activeCategory)
    ).filter(s => !isWeirdWebItem(s));

    // Empty state with continuous Ghibli Tribute SVG
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
      const proxyUrl = poster && poster.startsWith('http')
        ? `http://127.0.0.1:${port}/api/link/poster?url=${encodeURIComponent(poster)}`
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

    // Render immediately so user sees smooth FLIP glide start from clicked position
    this.renderSeriesDetail(sourceRect);

    // Fetch mined cards for this series
    try {
      this.seriesCards = await this.apiClient.getSeriesCards(seriesObj.series);
    } catch (e) {
      console.warn('[AnimeView] Failed to load cards for series:', e);
      this.seriesCards = [];
    }

    // If series has episodes, auto-load primer for first unwatched episode
    const episodes = seriesObj.episodes || [];
    const targetEp = episodes.find(ep => {
      const durMs = ep.duration_ms || (ep.minutes && ep.minutes > 0 ? ep.minutes * 60000 : 24 * 60000);
      const posMs = ep.last_position_ms || 0;
      return durMs > 0 ? (posMs < durMs * 0.85) : true;
    }) || episodes[0];

    if (targetEp && targetEp.hash) {
      try {
        this.selectedEpisodePrimer = await this.apiClient.getEpisodePrimer(targetEp.hash);
      } catch (e) {
        // primer optional fallback
      }
      // Pre-warm only the currently focused episode to avoid backend thread congestion
      getUniversalJlptLevel().then(lvl => {
        if (targetEp?.hash && !this.episodeInspectorCache.has(targetEp.hash)) {
          this.apiClient.getEpisodeInspector(targetEp.hash, lvl).then(data => {
            if (data) this.episodeInspectorCache.set(targetEp.hash, data);
          }).catch(() => {});
        }
      }).catch(() => {});
    }

    this._updateDetailSubtabContent();
  }

  renderSeriesDetail(sourceRect = null) {
    if (!this.container || !this.selectedSeries) return;

    const s = this.selectedSeries;
    const displayTitle = this.getSeriesTitle(s);
    const titleHtml = escapeHtml(displayTitle);
    const poster = s.poster_url || '';
    const port = this.backendPort || 21828;
    const proxyUrl = poster && poster.startsWith('http')
      ? `http://127.0.0.1:${port}/api/link/poster?url=${encodeURIComponent(poster)}`
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
          try {
            this.selectedEpisodePrimer = await this.apiClient.getEpisodePrimer(hash);
            this.seriesDetailTab = 'primer';
            const subtabs = this.container?.querySelectorAll('.anime-subtab');
            subtabs?.forEach(tab => {
              tab.classList.toggle('active', tab.getAttribute('data-subtab') === 'primer');
            });
            this._updateDetailSubtabContent();
          } catch (err) {
            console.warn('[AnimeView] Primer fetch failed:', err);
          }
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

    // Study primer button
    const studyBtn = scopeEl.querySelector('#study-primer-btn');
    if (studyBtn) {
      studyBtn.onclick = () => {
        if (this.router && typeof this.router.navigate === 'function') {
          this.router.navigate('study');
        }
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
          epMap.set(epNum, ep);
        } else {
          const existing = epMap.get(epNum);
          if ((ep.minutes || 0) > (existing.minutes || 0) || (ep.known_pct || 0) > (existing.known_pct || 0)) {
            epMap.set(epNum, ep);
          }
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
            const isLoading = this.loadingInspectorHash === ep.hash;

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
            const meaning = escapeHtml(c.meaning || '');
            const img = c.image || '';
            const sentence = escapeHtml(c.example_sentence || c.source_text || '');

            return `
              <div class="anime-mined-card">
                ${img ? `<div class="card-thumb-wrap"><img src="${escapeHtml(img)}" class="card-snap-img" alt="${word}" /></div>` : ''}
                <div class="card-body">
                  <div class="card-headword">
                    <span class="card-expr">${word}</span>
                    <span class="card-reading">${reading}</span>
                  </div>
                  <p class="card-meaning">${meaning}</p>
                  ${sentence ? `<p class="card-sentence">${sentence}</p>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    if (this.seriesDetailTab === 'primer') {
      const p = this.selectedEpisodePrimer;
      if (!p || (!p.gap_words?.length && !p.grammar_points?.length)) {
        return `<div class="subtab-empty">No gap words calculated for this episode yet. Play video with subtitle track to generate pre-watch primer.</div>`;
      }

      const words = p.gap_words || [];
      const grammar = p.grammar_points || [];

      return `
        <div class="anime-primer-panel">
          <div class="primer-header-action">
            <div>
              <h3 class="primer-section-title">Pre-Watch Gap Words (${words.length} items)</h3>
              <p class="primer-subtitle">Learn these critical unfamiliar words before pressing play to maximize comprehension.</p>
            </div>
            <button class="anime-study-btn" id="study-primer-btn">Study These Gap Words</button>
          </div>

          <div class="primer-words-list">
            ${words.slice(0, 15).map(w => `
              <div class="primer-word-chip">
                <span class="chip-expr">${escapeHtml(w.word)}</span>
                <span class="chip-reading">${escapeHtml(w.reading || '')}</span>
                <span class="chip-meaning">${escapeHtml(w.meaning || '')}</span>
                ${w.level ? `<span class="chip-level">${escapeHtml(w.level)}</span>` : ''}
              </div>
            `).join('')}
          </div>

          ${grammar.length > 0 ? `
            <h4 class="primer-grammar-title">Top Grammar Points</h4>
            <div class="primer-grammar-list">
              ${grammar.map(g => `
                <div class="primer-grammar-chip">
                  <span class="g-display">${escapeHtml(g.display || g.pattern_key)}</span>
                  ${g.level ? `<span class="chip-level">${escapeHtml(g.level)}</span>` : ''}
                </div>
              `).join('')}
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

  _renderInlineEpisodeInspector(ep, data, isLoading) {
    if (isLoading) {
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
    if (!data) {
      return `
        <div class="anime-inline-inspector anime-inspector-panel empty" id="inspector-${escapeHtml(ep.hash)}">
          <p class="inspector-empty-text">No subtitle cues or analytics available for this episode yet. Play media to capture cues.</p>
        </div>
      `;
    }

    const diff = data.difficulty || {};
    const missed = data.missed_words || [];
    const allWords = data.all_words || [];
    const rawGrammar = data.grammar_points || [];
    const minedCards = data.mined_cards || [];
    const dumped = this.getDumpedGrammar();
    const grammar = rawGrammar.filter(g => !dumped.has(g.point) && !dumped.has(g.pattern_key));
    const activeLevel = (typeof localStorage !== 'undefined' ? (localStorage.getItem('learner_jlpt_level') || localStorage.getItem('learner.jlptLevel')) : null);
    const targetLevel = this.learnerLevel || activeLevel || data?.target_learner_level || diff.target_learner_level || 'N3';

    const n5 = diff.n5_pct || 0;
    const n4 = diff.n4_pct || 0;
    const n3 = diff.n3_pct || 0;
    const n2 = diff.n2_pct || 0;
    const n1 = diff.n1_pct || 0;
    const unranked = diff.unranked_pct || 0;

    const displayList = this.wordsViewMode === 'all' ? (allWords.length > 0 ? allWords : missed) : missed;
    const shownWords = this.wordsExpanded ? displayList : displayList.slice(0, 24);

    return `
      <div class="anime-inline-inspector anime-inspector-panel" id="inspector-${escapeHtml(ep.hash)}">
        <!-- Inspector Action Toolbar with Tactile Review Buttons -->
        <div class="inspector-actions-row">
          <button type="button" class="inspector-review-btn btn-review-all" data-hash="${escapeHtml(ep.hash)}" data-action="review-all" title="Review all gap words & grammar in brutalist flashcards">
            <svg viewBox="0 0 24 24" class="btn-icon" width="16" height="16" fill="currentColor">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            Review All (${missed.length + grammar.length})
          </button>
          <button type="button" class="inspector-review-btn btn-review-vocab" data-hash="${escapeHtml(ep.hash)}" data-action="review-vocab" title="Review gap words in brutalist flashcards">
            Review Words (${missed.length})
          </button>
          <button type="button" class="inspector-review-btn btn-review-grammar" data-hash="${escapeHtml(ep.hash)}" data-action="review-grammar" title="Review grammar in subtitle context">
            Review Grammar (${grammar.length})
          </button>
        </div>

        <!-- Section 1: Difficulty & JLPT Gauge -->
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
        </div>

        <!-- Section 2: Words Grid (with Gap Words vs All Vocabulary toggle) -->
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
              <button type="button" class="inspector-inline-review-btn" data-hash="${escapeHtml(ep.hash)}" data-action="review-vocab">
                Review Words
              </button>
              ${displayList.length > 24 ? `
                <button type="button" class="inspector-expand-toggle-btn" data-action="toggle-words-expand">
                  ${this.wordsExpanded ? 'Collapse' : `Show All (${displayList.length})`}
                </button>
              ` : ''}
            </div>
          </div>
          ${displayList.length === 0 ? `
            <div class="inspector-empty-msg">No unfamiliar gap words detected! Great comprehension.</div>
          ` : `
            <div class="inspector-missed-grid">
              ${shownWords.map(w => `
                <div class="inspector-word-card">
                  <div class="word-card-top">
                    <span class="word-card-expr">${escapeHtml(w.word)}</span>
                    <span class="word-card-reading">${escapeHtml(w.reading || '')}</span>
                    <span class="word-card-level ${(w.jlpt || 'unranked').toLowerCase()}">${escapeHtml(w.jlpt || 'N?')}</span>
                    <span class="word-card-freq">${w.frequency || 1}x</span>
                  </div>
                  <div class="word-card-meaning">${escapeHtml(w.meaning || '')}</div>
                  ${w.context_sentence ? `
                    <div class="word-card-sentence" title="${escapeHtml(w.context_sentence)}">
                      ${this._highlightContext(w.context_sentence, w.word)}
                    </div>
                  ` : ''}
                  <button type="button" class="inspector-quick-mine-btn"
                          data-expr="${escapeHtml(w.word)}"
                          data-reading="${escapeHtml(w.reading || '')}"
                          data-meaning="${escapeHtml(w.meaning || '')}"
                          data-sentence="${escapeHtml(w.context_sentence || '')}"
                          title="Save card">
                    Mine
                  </button>
                </div>
              `).join('')}
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
            <div class="inspector-empty-msg">No grammar patterns indexed (or all known patterns hidden).</div>
          ` : `
            <div class="inspector-grammar-strip">
              ${grammar.map(g => `
                <div class="inspector-grammar-pill" tabindex="0" role="button" aria-expanded="false">
                  <div class="grammar-pill-main">
                    <span class="grammar-pill-name">${escapeHtml(g.point)}</span>
                    <span class="grammar-pill-level ${(g.jlpt || 'n4').toLowerCase()}">${escapeHtml(g.jlpt || 'N4')}</span>
                    <span class="grammar-pill-count">${g.occurrences}x</span>
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
              `).join('')}
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
      const data = this.episodeInspectorCache.get(hash);
      if (inspectBtn) inspectBtn.textContent = 'Collapse';
      let drawer = epGroup.querySelector('.anime-inline-inspector');
      const drawerHtml = this._renderInlineEpisodeInspector(ep, data, false);
      if (drawer) {
        drawer.outerHTML = drawerHtml;
      } else {
        epGroup.insertAdjacentHTML('beforeend', drawerHtml);
      }
      this._bindInlineInspectorEvents(epGroup);
      return;
    }

    // 5. If not cached, show immediate animated tactile skeleton loader in place
    if (inspectBtn) inspectBtn.textContent = 'Loading...';
    let drawer = epGroup.querySelector('.anime-inline-inspector');
    const loadingHtml = this._renderInlineEpisodeInspector(ep, null, true);
    if (drawer) {
      drawer.outerHTML = loadingHtml;
    } else {
      epGroup.insertAdjacentHTML('beforeend', loadingHtml);
    }

    // 6. Fetch inspection data
    try {
      let level = this.learnerLevel;
      if (!level) {
        try {
          level = await getUniversalJlptLevel();
        } catch (_) {
          level = 'N3';
        }
      }
      const data = await this.apiClient.getEpisodeInspector(hash, level);
      if (data) this.episodeInspectorCache.set(hash, data);

      if (this.expandedEpisodeHash === hash) {
        if (inspectBtn) inspectBtn.textContent = 'Collapse';
        const currentDrawer = epGroup.querySelector('.anime-inline-inspector');
        const finalHtml = this._renderInlineEpisodeInspector(ep, data, false);
        if (currentDrawer) {
          currentDrawer.outerHTML = finalHtml;
        } else {
          epGroup.insertAdjacentHTML('beforeend', finalHtml);
        }
        this._bindInlineInspectorEvents(epGroup);
      }
    } catch (err) {
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

  _bindInlineInspectorEvents(scopeEl) {
    if (!scopeEl) return;

    // Quick-mine buttons
    const quickMineBtns = scopeEl.querySelectorAll('.inspector-quick-mine-btn');
    quickMineBtns.forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const expr = btn.getAttribute('data-expr');
        const reading = btn.getAttribute('data-reading') || '';
        const meaning = btn.getAttribute('data-meaning') || '';
        if (expr) {
          try {
            btn.textContent = 'Mined';
            btn.classList.add('mined');
            btn.disabled = true;
            await this.apiClient.request('/api/cards/save', {
              method: 'POST',
              body: {
                expression: expr,
                reading: reading,
                meaning: meaning,
                deck_name: 'Default',
                source_text: `Mined from ${this.selectedSeries?.series || 'Anime'}`
              }
            });
            if (this.selectedSeries && Array.isArray(this.selectedSeries.episodes)) {
              const ep = this.selectedSeries.episodes.find(epItem => epItem.hash === this.expandedEpisodeHash);
              if (ep) ep.mined = (ep.mined || 0) + 1;
            }
          } catch (err) {
            console.warn('[AnimeView] Quick mine failed:', err);
            btn.textContent = 'Failed';
          }
        }
      };
    });

    // Grammar pills toggle example sentence
    const grammarPills = scopeEl.querySelectorAll('.inspector-grammar-pill');
    grammarPills.forEach(pill => {
      pill.onclick = (e) => {
        if (e.target.closest('.inspector-grammar-dump-btn')) return;
        e.stopPropagation();
        const sentEl = pill.querySelector('.inspector-grammar-sent');
        if (sentEl) {
          sentEl.hidden = !sentEl.hidden;
          pill.setAttribute('aria-expanded', String(!sentEl.hidden));
        }
      };
    });

    // Dismiss known grammar points
    const dumpBtns = scopeEl.querySelectorAll('.inspector-grammar-dump-btn');
    dumpBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const point = btn.getAttribute('data-point');
        const key = btn.getAttribute('data-key') || point;
        if (!point) return;
        this.dumpGrammarPoint(point, key);
        const pill = btn.closest('.inspector-grammar-pill');
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
      };
    });

    // Review action triggers
    const reviewBtns = scopeEl.querySelectorAll('.inspector-review-btn, .inspector-inline-review-btn');
    reviewBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const hash = btn.getAttribute('data-hash') || this.expandedEpisodeHash;
        if (action === 'review-all') {
          this.startReviewSession('all', hash);
        } else if (action === 'review-vocab') {
          this.startReviewSession('vocab', hash);
        } else if (action === 'review-grammar') {
          this.startReviewSession('grammar', hash);
        }
      };
    });

    // Words View Mode Tabs (Gap Words vs All Vocabulary)
    const wordsTabBtns = scopeEl.querySelectorAll('.words-tab-pill');
    wordsTabBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const mode = btn.getAttribute('data-mode');
        if (mode && mode !== this.wordsViewMode) {
          this.wordsViewMode = mode;
          this._refreshInlineInspector(scopeEl);
        }
      };
    });

    // Expand / Collapse Words List
    const expandBtns = scopeEl.querySelectorAll('[data-action="toggle-words-expand"]');
    expandBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.wordsExpanded = !this.wordsExpanded;
        this._refreshInlineInspector(scopeEl);
      };
    });
  }

  _refreshInlineInspector(scopeEl) {
    const epGroup = scopeEl.closest('.anime-episode-group') || scopeEl;
    const ep = (this.selectedSeries?.episodes || []).find(e => e.hash === this.expandedEpisodeHash);
    const data = this.episodeInspectorCache.get(this.expandedEpisodeHash);
    if (ep && data) {
      const currentDrawer = epGroup.querySelector('.anime-inline-inspector');
      const finalHtml = this._renderInlineEpisodeInspector(ep, data, false);
      if (currentDrawer) {
        currentDrawer.outerHTML = finalHtml;
      }
      this._bindInlineInspectorEvents(epGroup);
    }
  }

  _renderReviewOverlay() {
    if (!this.reviewSession) return '';

    const session = this.reviewSession;
    const isFinished = session.currentIndex >= session.items.length;

    if (isFinished) {
      return `
        <div class="brutalist-review-overlay" id="brutalist-review-overlay" role="dialog" aria-modal="true">
          <div class="brutalist-card brutalist-card--finished">
            <div class="brutalist-card__header">
              <div class="brutalist-card__icon">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              </div>
              <div class="brutalist-card__alert">SESSION FINISHED</div>
              <button type="button" class="brutalist-card__close-btn" data-action="close-review" aria-label="Close">✕</button>
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
        <div class="brutalist-card">
          <div class="brutalist-card__header">
            <div class="brutalist-card__icon">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"></path>
              </svg>
            </div>
            <div class="brutalist-card__alert">${alertLabel} ${levelLabel}</div>
            <div class="brutalist-card__counter">${session.currentIndex + 1} / ${session.items.length}</div>
            <button type="button" class="brutalist-card__close-btn" data-action="close-review" aria-label="Close review" title="Close (Esc)">✕</button>
          </div>
          <div class="brutalist-card__body">
            ${item.image ? `
              <div class="brutalist-card__frame">
                <img src="${escapeHtml(item.image)}" alt="Episode Frame" />
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

  startReviewSession(type, epHash) {
    if (!epHash) return;
    const data = this.episodeInspectorCache.get(epHash);
    if (!data) return;

    const items = [];
    if (type === 'vocab' || type === 'all') {
      const missed = data.missed_words || [];
      const pool = missed.length > 0 ? missed : (data.all_words || []);
      pool.forEach(w => {
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
      epHash,
      items,
      currentIndex: 0,
      minedCount: 0,
      knownCount: 0,
    };
    this._attachReviewKeyboardListener();
    this.renderSeriesDetail();
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
    window.addEventListener('keydown', this._reviewKeyHandler);
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
    this.renderSeriesDetail();
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
      this.apiClient.request('/api/cards/save', {
        method: 'POST',
        body: {
          expression: item.word,
          reading: item.reading,
          meaning: item.meaning,
          sentence: item.context_sentence || '',
          deck_name: 'Default',
          source_text: `Mined from ${seriesName} [${item.type}]`
        }
      }).catch(() => {});
      if (this.selectedSeries && Array.isArray(this.selectedSeries.episodes)) {
        const ep = this.selectedSeries.episodes.find(e => e.hash === session.epHash);
        if (ep) ep.mined = (ep.mined || 0) + 1;
      }
      session.minedCount++;
    }

    session.currentIndex++;
    this.renderSeriesDetail();
  }

  getDumpedGrammar() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('kiroku_dumped_grammar') : null;
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
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('kiroku_dumped_grammar', JSON.stringify(Array.from(dumped)));
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
              <h3 class="anime-confirm-title" id="anime-confirm-title">${this.escapeHtml(title)}</h3>
            </div>
          </div>
          <p class="anime-confirm-desc">${this.escapeHtml(message)}</p>
          <div class="anime-confirm-actions">
            <button type="button" class="anime-confirm-btn-cancel">${this.escapeHtml(cancelText)}</button>
            <button type="button" class="anime-confirm-btn-delete">${this.escapeHtml(confirmText)}</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('is-open'));

      const cleanup = (confirmed) => {
        window.removeEventListener('keydown', onKeyDown);
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
      window.addEventListener('keydown', onKeyDown);
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
      window.removeEventListener('scroll', closePopover, true);
    };

    const onOutsideClick = (e) => {
      if (!popover.contains(e.target) && e.target !== anchorBtn && !anchorBtn.contains(e.target)) {
        closePopover();
      }
    };

    setTimeout(() => {
      document.addEventListener('click', onOutsideClick);
      window.addEventListener('scroll', closePopover, { capture: true, once: true });
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
          try {
            this.selectedEpisodePrimer = await this.apiClient.getEpisodePrimer(hash);
            this.seriesDetailTab = 'primer';
            subtabs.forEach(t => {
              const isActive = t.getAttribute('data-subtab') === 'primer';
              t.classList.toggle('active', isActive);
              t.setAttribute('aria-selected', String(isActive));
            });
            this._updateDetailSubtabContent();
          } catch (e) {
            console.warn('[AnimeView] Primer fetch failed:', e);
          }
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

    // Quick-mine buttons inside inline inspector
    const quickMineBtns = this.container.querySelectorAll('.inspector-quick-mine-btn');
    quickMineBtns.forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const expr = btn.getAttribute('data-expr');
        const reading = btn.getAttribute('data-reading') || '';
        const meaning = btn.getAttribute('data-meaning') || '';
        if (expr) {
          try {
            btn.textContent = 'Mined';
            btn.classList.add('mined');
            btn.disabled = true;
            await this.apiClient.request('/api/cards/save', {
              method: 'POST',
              body: {
                expression: expr,
                reading: reading,
                meaning: meaning,
                deck_name: 'Default',
                source_text: `Mined from ${this.selectedSeries?.series || 'Anime'}`
              }
            });
            if (this.selectedSeries && Array.isArray(this.selectedSeries.episodes)) {
              const ep = this.selectedSeries.episodes.find(e => e.hash === this.expandedEpisodeHash);
              if (ep) ep.mined = (ep.mined || 0) + 1;
            }
          } catch (err) {
            console.warn('[AnimeView] Quick mine failed:', err);
            btn.textContent = 'Failed';
          }
        }
      };
    });

    // Grammar pills toggle example sentence
    const grammarPills = this.container.querySelectorAll('.inspector-grammar-pill');
    grammarPills.forEach(pill => {
      pill.onclick = (e) => {
        if (e.target.closest('.inspector-grammar-dump-btn')) return;
        e.stopPropagation();
        const sentEl = pill.querySelector('.inspector-grammar-sent');
        if (sentEl) {
          sentEl.hidden = !sentEl.hidden;
          pill.setAttribute('aria-expanded', String(!sentEl.hidden));
        }
      };
    });

    // Dismiss / Hide known grammar points
    const dumpBtns = this.container.querySelectorAll('.inspector-grammar-dump-btn');
    dumpBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const point = btn.getAttribute('data-point');
        const key = btn.getAttribute('data-key') || point;
        if (!point) return;
        this.dumpGrammarPoint(point, key);
        const pill = btn.closest('.inspector-grammar-pill');
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
      };
    });

    // Study These button
    const studyBtn = this.container.querySelector('#study-primer-btn');
    if (studyBtn) {
      studyBtn.onclick = () => {
        if (this.router && typeof this.router.navigate === 'function') {
          this.router.navigate('study');
        }
      };
    }

    // Review action triggers (All, Words, Grammar)
    const reviewBtns = this.container.querySelectorAll('.inspector-review-btn, .inspector-inline-review-btn');
    reviewBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const hash = btn.getAttribute('data-hash') || this.expandedEpisodeHash;
        if (action === 'review-all') {
          this.startReviewSession('all', hash);
        } else if (action === 'review-vocab') {
          this.startReviewSession('vocab', hash);
        } else if (action === 'review-grammar') {
          this.startReviewSession('grammar', hash);
        }
      };
    });

    // Words View Mode Tabs (Gap Words vs All Vocabulary)
    const wordsTabBtns = this.container.querySelectorAll('.words-tab-pill');
    wordsTabBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const mode = btn.getAttribute('data-mode');
        if (mode && mode !== this.wordsViewMode) {
          this.wordsViewMode = mode;
          this.renderSeriesDetail();
        }
      };
    });

    // Expand / Collapse Words List
    const expandBtns = this.container.querySelectorAll('[data-action="toggle-words-expand"]');
    expandBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.wordsExpanded = !this.wordsExpanded;
        this.renderSeriesDetail();
      };
    });

    // Review Overlay actions (Known, Mine, Close)
    const reviewCloseBtns = this.container.querySelectorAll('[data-action="close-review"]');
    reviewCloseBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.closeReviewSession();
      };
    });

    const reviewKnownBtn = this.container.querySelector('[data-action="review-known"]');
    if (reviewKnownBtn) {
      reviewKnownBtn.onclick = (e) => {
        e.stopPropagation();
        this.handleReviewAction('known');
      };
    }

    const reviewMineBtn = this.container.querySelector('[data-action="review-mine"]');
    if (reviewMineBtn) {
      reviewMineBtn.onclick = (e) => {
        e.stopPropagation();
        this.handleReviewAction('mine');
      };
    }

    const overlayEl = this.container.querySelector('#brutalist-review-overlay');
    if (overlayEl) {
      overlayEl.onclick = (e) => {
        if (e.target === overlayEl) {
          this.closeReviewSession();
        }
      };
    }
  }

  unmount() {
    this._stopStatusPolling();
    this._detachReviewKeyboardListener();
    if (this.boundLearnerLevelHandler) {
      window.removeEventListener('kiroku:learner-level-changed', this.boundLearnerLevelHandler);
      this.boundLearnerLevelHandler = null;
    }
    if (this.linkStore && typeof this.linkStore.off === 'function') {
      this.linkStore.off('session', this._onSessionChange);
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
  }

  onHide() {}
}
