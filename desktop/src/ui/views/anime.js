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

    // Continue watching banner if any episode is in-progress
    let continueWatchingHtml = '';
    const inProgressEps = [];
    for (const s of filtered) {
      for (const ep of (s.episodes || [])) {
        if (ep.last_position_ms && ep.last_position_ms > 0) {
          inProgressEps.push({ ...ep, series_name: s.series });
        }
      }
    }

    if (inProgressEps.length > 0) {
      const p = inProgressEps[0];
      const mins = Math.floor(p.last_position_ms / 60000);
      const secs = Math.floor((p.last_position_ms % 60000) / 1000);
      const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      continueWatchingHtml = `
        <div class="anime-continue-strip">
          <span class="continue-badge">Continue Watching</span>
          <span class="continue-title">${escapeHtml(p.title || p.series_name)}</span>
          <span class="continue-time">Resume at ${timeStr}</span>
        </div>
      `;
    }

    // Recent immersion sessions if available
    let sessionsHtml = '';
    if (this.recentSessions && this.recentSessions.length > 0) {
      sessionsHtml = `
        <div class="anime-sessions-section">
          <h3 class="anime-sessions-header">Recent Immersion Sessions</h3>
          <div class="anime-sessions-list">
            ${this.recentSessions.map(sess => {
              const mins = Math.round((sess.watch_seconds || 0) / 60);
              const lines = sess.lines_seen || 0;
              return `
                <div class="anime-session-row">
                  <span class="session-title">${escapeHtml(sess.title || sess.series || 'Immersion')}</span>
                  <span class="session-meta">${mins} min (${lines} lines)</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // Media Poster Grid
    const cardsHtml = filtered.map(item => {
      const seriesTitle = escapeHtml(item.series);
      const eps = item.episodes || [];
      const epCount = eps.length;
      const avgKnown = epCount > 0 ? Math.round(eps.reduce((a, b) => a + (b.known_pct || 0), 0) / epCount) : 0;
      const poster = item.poster_url || '';
      const mediaType = escapeHtml(item.media_type || 'anime');

      return `
        <div class="anime-poster-card" data-series="${seriesTitle}">
          <div class="poster-image-wrap">
            ${poster 
              ? `<img src="${escapeHtml(poster)}" alt="${seriesTitle}" class="poster-img" onerror="this.style.display='none'" />` 
              : `<div class="poster-placeholder"><span>${seriesTitle.slice(0, 2)}</span></div>`
            }
            <span class="poster-type-badge">${mediaType.toUpperCase()}</span>
            <span class="poster-score-badge">${avgKnown}% known</span>
          </div>
          <div class="poster-meta">
            <h3 class="poster-title" title="${seriesTitle}">${seriesTitle}</h3>
            <div class="poster-subtext">
              <span class="poster-count-badge">${epCount} ${epCount === 1 ? 'Episode' : 'Episodes'}</span>
              <div class="sr-only" style="display:none;">
                ${eps.map(e => `<span>${escapeHtml(e.title || '')} (${Math.round(e.known_pct || 0)}% known)</span>`).join('')}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      ${continueWatchingHtml}
      <div class="anime-series-grid">
        ${cardsHtml}
      </div>
      ${sessionsHtml}
    `;
  }

  async openSeriesDetail(seriesObj) {
    this.selectedSeries = seriesObj;
    this.seriesDetailTab = 'episodes';
    this.selectedEpisodePrimer = null;
    this.seriesCards = [];

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

    this.render();
  }

  renderSeriesDetail() {
    if (!this.container || !this.selectedSeries) return;

    const s = this.selectedSeries;
    const title = escapeHtml(s.series);
    const poster = s.poster_url || '';
    const synopsis = escapeHtml(s.synopsis || 'No synopsis available.');
    const eps = s.episodes || [];
    const epCount = eps.length;
    const totalMinutes = Math.round(eps.reduce((a, b) => a + (b.minutes || 0), 0));
    const avgKnown = epCount > 0 ? Math.round(eps.reduce((a, b) => a + (b.known_pct || 0), 0) / epCount) : 0;
    const currentType = s.media_type || 'anime';

    this.container.innerHTML = `
      <div class="anime-view-wrapper">
        <div class="anime-detail-container">
          <!-- Back button -->
          <div class="anime-detail-back-row">
            <button class="anime-back-btn" id="anime-back-btn">
              <span class="back-arrow">&larr;</span> Back to Media Library
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

          <!-- Series Banner Header -->
          <div class="anime-detail-header">
            <div class="detail-poster-wrap">
              ${poster ? `<img src="${escapeHtml(poster)}" alt="${title}" class="detail-poster-img" />` : `<div class="poster-placeholder"><span>${title.slice(0, 2)}</span></div>`}
            </div>
            <div class="detail-header-info">
              <h1 class="detail-series-title">${title}</h1>
              <div class="detail-stats-row">
                <span class="detail-stat-pill score">${avgKnown}% Known</span>
                <span class="detail-stat-pill">${epCount} ${epCount === 1 ? 'Episode' : 'Episodes'}</span>
                <span class="detail-stat-pill">${totalMinutes} min watched</span>
                <span class="detail-stat-pill">${this.seriesCards.length} cards mined</span>
              </div>
              <p class="detail-synopsis">${synopsis}</p>
            </div>
          </div>

          <!-- Detail Tabs (Episodes | Mined Cards | Pre-Watch Primer) -->
          <div class="anime-subtab-nav">
            <button class="anime-subtab ${this.seriesDetailTab === 'episodes' ? 'active' : ''}" data-subtab="episodes">Episodes</button>
            <button class="anime-subtab ${this.seriesDetailTab === 'cards' ? 'active' : ''}" data-subtab="cards">Mined Cards (${this.seriesCards.length})</button>
            <button class="anime-subtab ${this.seriesDetailTab === 'primer' ? 'active' : ''}" data-subtab="primer">Pre-Watch Gap Words</button>
          </div>

          <!-- Tab Content Body -->
          <div class="anime-subtab-content">
            ${this._renderDetailTabContent()}
          </div>
        </div>
      </div>
    `;

    this.setupDetailEvents();
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

    // Poster clicks
    const cards = this.container.querySelectorAll('.anime-poster-card');
    cards.forEach(card => {
      card.onclick = () => {
        const sName = card.getAttribute('data-series');
        const found = this.seriesList.find(s => s.series === sName);
        if (found) {
          this.openSeriesDetail(found);
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
