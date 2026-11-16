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
    this.seriesList = [];
    this.selectedSeries = null;
    this.seriesDetailTab = 'episodes'; // 'episodes' | 'cards' | 'primer'
    this.seriesCards = [];
    this.selectedEpisodePrimer = null;
    this.activeStreamSession = null;
    this.isLoading = false;
    this.backendPort = 21828;

    // Bound listeners
    this._onSessionChange = this._onSessionChange.bind(this);
    if (this.linkStore && typeof this.linkStore.on === 'function') {
      this.linkStore.on('session', this._onSessionChange);
    }
  }

  _onSessionChange(session) {
    this.activeStreamSession = session;
    this.renderStreamPill();
  }

  async mount(container) {
    this.container = container;
    try {
      const info = await this.apiClient.getBackendInfo();
      if (info && info.port) this.backendPort = info.port;
    } catch (_) {}
    this.render();
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

            <!-- Category Section Pills -->
            <div class="anime-category-pills" role="tablist">
              <button class="anime-cat-pill ${this.activeCategory === 'anime' ? 'active' : ''}" data-cat="anime">Anime</button>
              <button class="anime-cat-pill ${this.activeCategory === 'youtube' ? 'active' : ''}" data-cat="youtube">YouTube</button>
              <button class="anime-cat-pill ${this.activeCategory === 'tv' ? 'active' : ''}" data-cat="tv">TV Shows</button>
              <button class="anime-cat-pill ${this.activeCategory === 'all' ? 'active' : ''}" data-cat="all">All Media</button>
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
      const durMs = (ep.minutes && ep.minutes > 0 ? ep.minutes * 60 : 24 * 60) * 1000;
      const posMs = ep.last_position_ms || 0;
      // An episode is completed if logged >= 85% of duration or >= 20 minutes recorded
      if (posMs >= durMs * 0.85 || (ep.minutes && ep.minutes >= 20)) {
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
    const filtered = this.activeCategory === 'all'
      ? this.seriesList
      : this.seriesList.filter(s => (s.media_type || 'anime').toLowerCase() === this.activeCategory);

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
      const seriesTitle = escapeHtml(item.series);
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
        <div class="anime-poster-card" data-series="${seriesTitle}">
          <div class="poster-image-wrap">
            ${poster 
              ? `<img src="${escapeHtml(poster)}" alt="${seriesTitle}" class="poster-img" referrerpolicy="no-referrer" loading="lazy" onerror="if (!this.dataset.triedProxy && '${proxyUrl}') { this.dataset.triedProxy = '1'; this.src = '${escapeHtml(proxyUrl)}'; } else { this.onerror=null; this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='flex'; }" />
                 <div class="poster-placeholder" style="display: none;"><span>${seriesTitle.slice(0, 2).toUpperCase()}</span></div>` 
              : `<div class="poster-placeholder"><span>${seriesTitle.slice(0, 2).toUpperCase()}</span></div>`
            }
            <button type="button" class="anime-card-bookmark-btn ${isPinned ? 'has-bookmark is-active' : ''}" data-action="toggle-pin" data-series="${seriesTitle}" title="${isPinned ? 'Unpin series from top' : 'Pin series to top of Anime tab'}">
              <svg class="anime-bookmark-svg" viewBox="0 0 24 24" width="15" height="15">
                <path class="anime-bookmark-ribbon" d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            <div class="anime-poster-progress-badge poster-score-badge">${watchPct}%</div>
          </div>
          <div class="poster-meta">
            <div class="poster-title-row">
              <h3 class="poster-title" title="${seriesTitle}">${seriesTitle}</h3>
              <button type="button" class="anime-poster-more-btn" data-series="${seriesTitle}" title="Series Options">
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

    // If series has episodes, auto-load primer for first episode
    const firstEp = (seriesObj.episodes || [])[0];
    if (firstEp && firstEp.hash) {
      try {
        this.selectedEpisodePrimer = await this.apiClient.getEpisodePrimer(firstEp.hash);
      } catch (e) {
        // primer optional fallback
      }
    }

    this._updateDetailSubtabContent();
  }

  renderSeriesDetail(sourceRect = null) {
    if (!this.container || !this.selectedSeries) return;

    const s = this.selectedSeries;
    const title = escapeHtml(s.series);
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
          <!-- Top Bar: Back Button & Category -->
          <div class="anime-detail-top-bar">
            <button class="anime-back-btn" id="anime-back-btn" title="Back to Media Library">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>Back to Media Library</span>
            </button>
            <div class="anime-type-override-wrap">
              <span class="override-label">Category:</span>
              <select id="series-type-select" class="anime-type-select">
                <option value="anime" ${currentType === 'anime' ? 'selected' : ''}>Anime</option>
                <option value="youtube" ${currentType === 'youtube' ? 'selected' : ''}>YouTube</option>
                <option value="tv" ${currentType === 'tv' ? 'selected' : ''}>TV Show</option>
              </select>
            </div>
          </div>

          <!-- Main Two-Column Layout: Poster & Title on Left, Immersion Deck on Right -->
          <div class="anime-detail-body">
            <!-- Left Column: Poster + Title below it + Metadata -->
            <aside class="anime-detail-left-col">
              <div class="detail-poster-wrap">
                ${poster 
                  ? `<img src="${escapeHtml(poster)}" alt="${title}" class="detail-poster-img" referrerpolicy="no-referrer" loading="lazy" onerror="if (!this.dataset.triedProxy && '${proxyUrl}') { this.dataset.triedProxy = '1'; this.src = '${escapeHtml(proxyUrl)}'; } else { this.onerror=null; this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='flex'; }" />
                     <div class="poster-placeholder" style="display: none;"><span>${title.slice(0, 2).toUpperCase()}</span></div>` 
                  : `<div class="poster-placeholder"><span>${title.slice(0, 2).toUpperCase()}</span></div>`
                }
                <div class="anime-poster-progress-badge">${watchPct}%</div>
              </div>
              
              <!-- Title strictly below the poster as requested -->
              <h1 class="anime-detail-left-title" title="${title}">${title}</h1>

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
    if (contentEl) contentEl.innerHTML = this._renderDetailTabContent();
  }

  _renderDetailTabContent() {
    if (this.seriesDetailTab === 'episodes') {
      const eps = this.selectedSeries.episodes || [];
      if (eps.length === 0) {
        return `<div class="subtab-empty">No episodes recorded for this series.</div>`;
      }
      return `
        <div class="anime-episodes-table">
          ${eps.map((ep, idx) => {
            const epTitle = escapeHtml(ep.title || `Episode ${idx + 1}`);
            const known = Math.round(ep.known_pct || 0);
            const mined = ep.mined || 0;
            const minutes = Math.round(ep.minutes || 0);
            return `
              <div class="anime-episode-row">
                <div class="ep-left">
                  <span class="ep-index">#${idx + 1}</span>
                  <span class="ep-title">${epTitle}</span>
                </div>
                <div class="ep-right">
                  <span class="ep-badge">${known}% known</span>
                  <span class="ep-meta">${mined} mined</span>
                  <span class="ep-meta">${minutes} min</span>
                  <button class="ep-primer-btn" data-hash="${escapeHtml(ep.hash)}">Gap Primer</button>
                </div>
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

  setupEvents() {
    if (!this.container) return;

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

    // Subtabs
    const subtabs = this.container.querySelectorAll('.anime-subtab');
    subtabs.forEach(tab => {
      tab.onclick = () => {
        const val = tab.getAttribute('data-subtab');
        if (val) {
          this.seriesDetailTab = val;
          this.renderSeriesDetail();
        }
      };
    });

    // Episode row gap primer buttons
    const primerBtns = this.container.querySelectorAll('.ep-primer-btn');
    primerBtns.forEach(btn => {
      btn.onclick = async () => {
        const hash = btn.getAttribute('data-hash');
        if (hash) {
          try {
            this.selectedEpisodePrimer = await this.apiClient.getEpisodePrimer(hash);
            this.seriesDetailTab = 'primer';
            this.renderSeriesDetail();
          } catch (e) {
            console.warn('[AnimeView] Primer fetch failed:', e);
          }
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
  }

  unmount() {
    if (this.linkStore && typeof this.linkStore.off === 'function') {
      this.linkStore.off('session', this._onSessionChange);
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.container = null;
  }

  onShow() {
    this.fetchWatchHistory();
  }

  onHide() {}
}
