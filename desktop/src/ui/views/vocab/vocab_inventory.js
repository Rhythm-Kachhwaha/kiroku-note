/**
 * Kiroku Note Desktop — Vocab Inventory View Controller
 * Comprehensive Japanese vocabulary knowledge base:
 * - Telemetry metrics (Total, Known, Learning, Unseen Gaps, Today's Encounters)
 * - Search & multi-axis filtering (JLPT level, status, category/POS, source)
 * - Dense interactive data grid with Ruby readings
 * - Multi-select floating action bar (bulk status update, Study Selected)
 * - "Study these" button scoped to current filters
 * - Slide-over inspector drawer with full JMdict senses, tags, and encounter sentences
 */

import { apiClient } from '../../services/api_client.js';
import { escapeHtml } from '../../utils/sanitizer.js';
import { getUniversalJlptLevel, getUniversalAnkiDeck } from '../../utils/learner.js';
import { mountCounter } from '../../vendor/counter_bundle.js';

const INVENTORY_SUBVIEW_KEY = 'kiroku:vocab-inventory-subview';
const INVENTORY_OPENED_SHELVES_KEY = 'kiroku:vocab-opened-shelves';

export class VocabInventoryComponent {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.activeSubView = 'shelves'; // 'shelves' | 'table'
    this.items = [];
    this.totalItems = 0;
    this.countsByState = { total: 0, known: 0, learning: 0, unseen: 0, ignored: 0 };
    this.selectedExpressions = new Set();
    this.activeItem = null;

    // Shelves State
    this.openedShelves = new Set(); // Collapsed by default per user preference
    this.shelfLimits = {
      transitive: 30,
      adverbs: 40,
      onomatopoeia: 40,
      adjectives: 40,
      verbs: 40,
      loanwords: 40,
      keigo: 30,
      gaps: 40,
    };

    this.transitivePairs = [];
    this.transitiveSummary = null;
    this.transitiveLevelFilter = 'all';
    this.transitiveMasteryFilter = 'all';

    this.adverbNuanceFilter = 'all';
    this.onomatopoeiaNuanceFilter = 'all';
    this.adjectivesTab = 'all'; // 'all' | 'i' | 'na'
    this.verbsGroupFilter = 'all'; // 'all' | 'group_1' | 'group_2' | 'group_3'
    this.loanwordsStateFilter = 'all'; // 'all' | 'unseen' | 'learning' | 'known'

    this.keigoItems = [];
    this.keigoSummary = null;
    this.keigoTypeFilter = 'all';

    this.gapBreakdown = null;
    this.gapCategoryFilter = 'all';
    this.miningGaps = new Set();

    this._shelfFilteredItems = {};
    this.shelfReviewSession = null;
    this._shelfReviewKeyHandler = null;

    // Table Filters
    this.filterSearch = '';
    this.filterLevel = 'all';
    this.filterState = 'all';
    this.filterCategory = 'all';
    this.filterSource = 'all';

    // Pagination
    this.currentPage = 1;
    this.pageSize = 25;
    this.isLoading = false;
    this.lastError = null;
    this.learnerLevel = 'N4';
    this._searchTimer = null;
    this._levelListener = null;
    this._authListener = null;
    this._dataChangeListener = null;

    this.restoreSubViewPreference();
    this.restoreOpenedShelvesPreference();
  }

  restoreSubViewPreference() {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem(INVENTORY_SUBVIEW_KEY);
        if (saved === 'shelves' || saved === 'table') {
          this.activeSubView = saved;
        }
      } catch (err) {
        console.debug('[VocabInventory] Failed to read subview preference:', err);
      }
    }
  }

  saveSubViewPreference(subView) {
    this.activeSubView = subView;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(INVENTORY_SUBVIEW_KEY, subView);
      } catch (err) {
        console.debug('[VocabInventory] Failed to save subview preference:', err);
      }
    }
  }

  restoreOpenedShelvesPreference() {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(INVENTORY_OPENED_SHELVES_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            this.openedShelves = new Set(parsed);
          }
        }
      } catch (err) {
        console.debug('[VocabInventory] Failed to read opened shelves:', err);
      }
    }
  }

  saveOpenedShelvesPreference() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(
          INVENTORY_OPENED_SHELVES_KEY,
          JSON.stringify(Array.from(this.openedShelves))
        );
      } catch (err) {
        console.debug('[VocabInventory] Failed to save opened shelves:', err);
      }
    }
  }

  isShelfOpen(shelfId) {
    return this.openedShelves.has(shelfId);
  }

  toggleShelf(shelfId) {
    if (this.openedShelves.has(shelfId)) {
      this.openedShelves.delete(shelfId);
    } else {
      this.openedShelves.add(shelfId);
    }
    this.saveOpenedShelvesPreference();
    this.applyShelfState(shelfId);
  }

  applyShelfState(shelfId) {
    const card = document.getElementById(`shelf-${shelfId}`);
    if (!card) return;
    const isOpen = this.openedShelves.has(shelfId);
    card.classList.toggle('is-open', isOpen);
    card.classList.toggle('is-collapsed', !isOpen);
    const content = card.querySelector('.shelf-content-collapsible');
    if (content) content.style.display = isOpen ? '' : 'none';
    const toggle = card.querySelector('.shelf-accordion-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  expandAllShelves() {
    ['transitive-pairs', 'adverbs', 'onomatopoeia', 'adjectives', 'verbs', 'loanwords', 'keigo', 'jlpt-gaps'].forEach((id) => {
      this.openedShelves.add(id);
      this.applyShelfState(id);
    });
    this.saveOpenedShelvesPreference();
  }

  collapseAllShelves() {
    this.openedShelves.clear();
    ['transitive-pairs', 'adverbs', 'onomatopoeia', 'adjectives', 'verbs', 'loanwords', 'keigo', 'jlpt-gaps'].forEach((id) => {
      this.applyShelfState(id);
    });
    this.saveOpenedShelvesPreference();
  }

  onShow() {
    if (this._levelListener && typeof window !== 'undefined') {
      window.addEventListener('kiroku:learner-level-changed', this._levelListener);
    }
    if (this._authListener && typeof window !== 'undefined') {
      window.addEventListener('kiroku:auth-changed', this._authListener);
    }
    if (this._dataChangeListener && typeof window !== 'undefined') {
      window.addEventListener('kiroku:data-changed', this._dataChangeListener);
    }
  }

  onHide() {
    if (this._levelListener && typeof window !== 'undefined') {
      window.removeEventListener('kiroku:learner-level-changed', this._levelListener);
    }
    if (this._authListener && typeof window !== 'undefined') {
      window.removeEventListener('kiroku:auth-changed', this._authListener);
    }
    if (this._dataChangeListener && typeof window !== 'undefined') {
      window.removeEventListener('kiroku:data-changed', this._dataChangeListener);
    }
  }

  async mount(container) {
    this.container = container;
    this.learnerLevel = await getUniversalJlptLevel();
    this.render();
    this.setupEvents();
    
    this._levelListener = (e) => {
      if (e.detail?.level) {
        this.learnerLevel = e.detail.level;
        if (this.activeSubView === 'shelves') {
          this.loadShelvesData();
        } else {
          this.loadData();
        }
      }
    };
    this._authListener = async () => {
      this.learnerLevel = await getUniversalJlptLevel();
      this.selectedExpressions.clear();
      this.updateBulkBar();
      if (this.activeSubView === 'shelves') {
        await this.loadShelvesData();
        this.fetchMetricsOnly();
      } else {
        await this.loadData();
      }
    };
    this._dataChangeListener = () => {
      if (this.activeSubView === 'shelves') {
        this.loadShelvesData().catch(() => {});
        this.fetchMetricsOnly();
      } else {
        this.loadData().catch(() => {});
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('kiroku:learner-level-changed', this._levelListener);
      window.addEventListener('kiroku:auth-changed', this._authListener);
      window.addEventListener('kiroku:data-changed', this._dataChangeListener);
    }

    if (this.activeSubView === 'shelves') {
      await this.loadShelvesData();
      this.fetchMetricsOnly();
    } else {
      await this.loadData();
    }
  }

  async fetchMetricsOnly() {
    try {
      const res = await apiClient.getVocabInventory({ limit: 1, offset: 0, include_reference: true });
      if (res) {
        this.countsByState = res.counts_by_state || { total: 0, known: 0, learning: 0, unseen: 0, ignored: 0 };
        this.totalItems = typeof res.total === 'number' ? res.total : 0;
        this.updateMetrics();
      }
    } catch (err) {
      console.debug('[VocabInventory] fetchMetricsOnly error:', err);
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="vocab-inventory-view">
        <!-- Sub-View Switcher & Shelves Controls -->
        <div class="inv-header-controls">
          <div class="inv-sub-segments" role="tablist" aria-label="Inventory View Selection">
            <button type="button" class="inv-sub-tab ${this.activeSubView === 'shelves' ? 'is-active' : ''}" id="tab-sub-shelves" data-sub="shelves" role="tab" aria-selected="${this.activeSubView === 'shelves'}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
              </svg>
              <span>Curated Shelves</span>
            </button>
            <button type="button" class="inv-sub-tab ${this.activeSubView === 'table' ? 'is-active' : ''}" id="tab-sub-table" data-sub="table" role="tab" aria-selected="${this.activeSubView === 'table'}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M3 3v18h18V3H3zm8 16H5v-6h6v6zm0-8H5V5h6v6zm8 8h-6v-6h6v6zm0-8h-6V5h6v6z"/>
              </svg>
              <span>Full Inventory</span>
            </button>
          </div>

          <!-- Shelves Toolbar: Expand / Collapse All (aligned inline on the right in Shelves mode) -->
          <div class="shelves-toolbar-actions" id="shelves-header-actions" style="${this.activeSubView === 'shelves' ? '' : 'display: none;'}">
            <button type="button" class="tactile-btn tactile-btn-sm font-sans" id="btn-shelves-expand-all" title="Expand all shelves">
              Expand all
            </button>
            <button type="button" class="tactile-btn tactile-btn-sm font-sans" id="btn-shelves-collapse-all" title="Collapse all shelves">
              Collapse all
            </button>
          </div>
        </div>

        <!-- Telemetry Metrics Bar (Visible only in Full Inventory) -->
        <div class="vocab-inventory-metrics metrics-grid ${this.activeSubView === 'table' ? '' : 'is-hidden'}" id="inv-metrics-bar" style="${this.activeSubView === 'table' ? '' : 'display: none !important;'}">
          <div class="metric-pod tactile-card" title="Total Japanese vocabulary tracked across your database and JLPT dictionary reference">
            <span class="metric-label">Total vocabulary</span>
            <span class="metric-value font-mono" id="inv-metric-total">0</span>
            <span class="metric-hint font-sans text-xs text-muted">All words in scope</span>
          </div>
          <div class="metric-pod tactile-card" title="Words you have marked as known">
            <span class="metric-label text-green">Known words</span>
            <span class="metric-value text-green font-mono" id="inv-metric-known">0</span>
            <span class="metric-hint font-sans text-xs text-muted">Marked known</span>
          </div>
          <div class="metric-pod tactile-card" title="Words currently being studied or captured to flashcards">
            <span class="metric-label text-amber">In learning</span>
            <span class="metric-value text-amber font-mono" id="inv-metric-learning">0</span>
            <span class="metric-hint font-sans text-xs text-muted">Mined & active cards</span>
          </div>
          <div class="metric-pod tactile-card" title="JLPT reference vocabulary you have not encountered or learned yet">
            <span class="metric-label text-red">Unseen JLPT gaps</span>
            <span class="metric-value text-red font-mono" id="inv-metric-unseen">0</span>
            <span class="metric-hint font-sans text-xs text-muted">Available to learn</span>
          </div>
          <div class="metric-pod tactile-card" title="Vocabulary words matching your active filters and search query">
            <span class="metric-label text-gold">Matching filter</span>
            <span class="metric-value text-gold font-mono" id="inv-metric-filtered">0</span>
            <span class="metric-hint font-sans text-xs text-muted">Table view matches</span>
          </div>
        </div>

        <!-- VIEW MODE 1: CURATED SHELVES CONTAINER -->
        <div class="inv-shelves-container" id="inv-shelves-container" style="${this.activeSubView === 'shelves' ? '' : 'display: none;'}">
          
          <!-- 1. Transitive <-> Intransitive Hub -->
          <section class="vocab-shelf-card tactile-card ${this.isShelfOpen('transitive-pairs') ? 'is-open' : 'is-collapsed'}" id="shelf-transitive-pairs" data-shelf="transitive-pairs">
            <div class="shelf-header shelf-accordion-toggle" role="button" tabindex="0" aria-expanded="${this.isShelfOpen('transitive-pairs')}">
              <div class="shelf-title-group">
                <div class="shelf-title-row">
                  <div class="shelf-title-with-chevron">
                    <svg class="shelf-chevron" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                    </svg>
                    <h2 class="shelf-title font-sans font-bold">Transitive & Intransitive Verb Pairs</h2>
                  </div>
                  <div class="shelf-header-actions">
                    <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary shelf-review-btn font-sans" data-review-shelf="transitive-pairs" title="Review words one by one">Review</button>
                    <span class="shelf-badge font-mono" id="transitive-pairs-count">0 pairs</span>
                  </div>
                </div>
                <p class="shelf-sub text-xs text-muted font-sans">
                  Compare object-taking (<span class="font-japanese text-gold font-bold">を</span>) and self-occurring (<span class="font-japanese text-green font-bold">が</span>) verbs side by side.
                </p>
              </div>
            </div>

            <div class="shelf-content-collapsible" style="${this.isShelfOpen('transitive-pairs') ? '' : 'display: none;'}">
              <!-- Filter Pills for Transitive Hub -->
              <div class="shelf-filters-row">
                <div class="shelf-filter-group" data-filter="level" role="radiogroup" aria-label="Transitive Level Filter">
                  <span class="text-xs text-muted font-mono">Level:</span>
                  <button type="button" class="filter-pill filter-pair-level is-active" data-level="all">All</button>
                  <button type="button" class="filter-pill filter-pair-level" data-level="N5">N5</button>
                  <button type="button" class="filter-pill filter-pair-level" data-level="N4">N4</button>
                  <button type="button" class="filter-pill filter-pair-level" data-level="N3">N3</button>
                  <button type="button" class="filter-pill filter-pair-level" data-level="N2">N2</button>
                  <button type="button" class="filter-pill filter-pair-level" data-level="N1">N1</button>
                </div>

                <div class="shelf-filter-group" data-filter="mastery" role="radiogroup" aria-label="Transitive Mastery Filter">
                  <span class="text-xs text-muted font-mono">Mastery:</span>
                  <button type="button" class="filter-pill filter-pair-mastery is-active" data-mastery="all">All</button>
                  <button type="button" class="filter-pill filter-pair-mastery" data-mastery="both_known">Both Known</button>
                  <button type="button" class="filter-pill filter-pair-mastery" data-mastery="half_known">Half Known</button>
                  <button type="button" class="filter-pill filter-pair-mastery" data-mastery="unseen">Unseen</button>
                </div>
              </div>

              <div class="transitive-pairs-grid" id="transitive-pairs-grid">
                <span class="text-xs text-muted py-4 font-sans">Loading transitive and intransitive verb pairs...</span>
              </div>
              <div class="shelf-pagination-footer" id="transitive-pagination" style="display: none;"></div>
            </div>
          </section>

          <!-- 2. Adverbs Shelf (Separated from Onomatopoeia) -->
          <section class="vocab-shelf-card tactile-card ${this.isShelfOpen('adverbs') ? 'is-open' : 'is-collapsed'}" id="shelf-adverbs" data-shelf="adverbs">
            <div class="shelf-header shelf-accordion-toggle" role="button" tabindex="0" aria-expanded="${this.isShelfOpen('adverbs')}">
              <div class="shelf-title-group">
                <div class="shelf-title-row">
                  <div class="shelf-title-with-chevron">
                    <svg class="shelf-chevron" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                    </svg>
                    <h2 class="shelf-title font-sans font-bold">Adverbs Shelf</h2>
                  </div>
                  <div class="shelf-header-actions">
                    <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary shelf-review-btn font-sans" data-review-shelf="adverbs" title="Review words one by one">Review</button>
                    <span class="shelf-badge font-mono" id="adverbs-count">0 words</span>
                  </div>
                </div>
                <p class="shelf-sub text-xs text-muted font-sans">
                  Standard adverbs grouped by degree, time, frequency, and manner.
                </p>
              </div>
            </div>

            <div class="shelf-content-collapsible" style="${this.isShelfOpen('adverbs') ? '' : 'display: none;'}">
              <div class="shelf-filters-row">
                <div class="shelf-filter-group" role="radiogroup" aria-label="Adverb Nuance">
                  <button type="button" class="filter-pill filter-adverb-tab is-active" data-type="all">All Adverbs</button>
                  <button type="button" class="filter-pill filter-adverb-tab" data-type="degree">Degree</button>
                  <button type="button" class="filter-pill filter-adverb-tab" data-type="time">Time</button>
                  <button type="button" class="filter-pill filter-adverb-tab" data-type="frequency">Frequency</button>
                  <button type="button" class="filter-pill filter-adverb-tab" data-type="manner">Manner</button>
                </div>
              </div>

              <div class="adverbs-shelf-grid" id="adverbs-shelf-grid">
                <span class="text-xs text-muted py-4 font-sans">Loading adverbs...</span>
              </div>
              <div class="shelf-pagination-footer" id="adverbs-pagination" style="display: none;"></div>
            </div>
          </section>

          <!-- 3. Onomatopoeia & Mimetics Shelf (Separated) -->
          <section class="vocab-shelf-card tactile-card ${this.isShelfOpen('onomatopoeia') ? 'is-open' : 'is-collapsed'}" id="shelf-onomatopoeia" data-shelf="onomatopoeia">
            <div class="shelf-header shelf-accordion-toggle" role="button" tabindex="0" aria-expanded="${this.isShelfOpen('onomatopoeia')}">
              <div class="shelf-title-group">
                <div class="shelf-title-row">
                  <div class="shelf-title-with-chevron">
                    <svg class="shelf-chevron" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                    </svg>
                    <h2 class="shelf-title font-sans font-bold">Onomatopoeia & Mimetics</h2>
                  </div>
                  <div class="shelf-header-actions">
                    <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary shelf-review-btn font-sans" data-review-shelf="onomatopoeia" title="Review words one by one">Review</button>
                    <span class="shelf-badge font-mono" id="onomatopoeia-count">0 words</span>
                  </div>
                </div>
                <p class="shelf-sub text-xs text-muted font-sans">
                  Sound symbolism across sounds, voices, states, and feelings.
                </p>
              </div>
            </div>

            <div class="shelf-content-collapsible" style="${this.isShelfOpen('onomatopoeia') ? '' : 'display: none;'}">
              <div class="shelf-filters-row">
                <div class="shelf-filter-group" role="radiogroup" aria-label="Mimetic Nuance">
                  <button type="button" class="filter-pill filter-onomatopoeia-tab is-active" data-nuance="all">All Nuances</button>
                  <button type="button" class="filter-pill filter-onomatopoeia-tab" data-nuance="giongo">Sounds</button>
                  <button type="button" class="filter-pill filter-onomatopoeia-tab" data-nuance="giseigo">Voices</button>
                  <button type="button" class="filter-pill filter-onomatopoeia-tab" data-nuance="gitaigo">Manner</button>
                  <button type="button" class="filter-pill filter-onomatopoeia-tab" data-nuance="emotion">Emotions</button>
                </div>
              </div>

              <div class="onomatopoeia-shelf-grid" id="onomatopoeia-shelf-grid">
                <span class="text-xs text-muted py-4 font-sans">Loading onomatopoeic and mimetic expressions...</span>
              </div>
              <div class="shelf-pagination-footer" id="onomatopoeia-pagination" style="display: none;"></div>
            </div>
          </section>

          <!-- 4. Adjectives Shelf -->
          <section class="vocab-shelf-card tactile-card ${this.isShelfOpen('adjectives') ? 'is-open' : 'is-collapsed'}" id="shelf-adjectives" data-shelf="adjectives">
            <div class="shelf-header shelf-accordion-toggle" role="button" tabindex="0" aria-expanded="${this.isShelfOpen('adjectives')}">
              <div class="shelf-title-group">
                <div class="shelf-title-row">
                  <div class="shelf-title-with-chevron">
                    <svg class="shelf-chevron" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                    </svg>
                    <h2 class="shelf-title font-sans font-bold">Adjectives Showcase</h2>
                  </div>
                  <div class="shelf-header-actions">
                    <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary shelf-review-btn font-sans" data-review-shelf="adjectives" title="Review words one by one">Review</button>
                    <span class="shelf-badge font-mono" id="adjectives-count">0 words</span>
                  </div>
                </div>
                <p class="shelf-sub text-xs text-muted font-sans">
                  Inflecting <span class="font-japanese text-gold font-bold">い-adj</span> and nominal <span class="font-japanese text-green font-bold">な-adj</span>.
                </p>
              </div>
            </div>

            <div class="shelf-content-collapsible" style="${this.isShelfOpen('adjectives') ? '' : 'display: none;'}">
              <div class="shelf-filters-row">
                <div class="shelf-filter-group" role="radiogroup" aria-label="Adjective Type">
                  <button type="button" class="filter-pill filter-adj-tab is-active" data-tab="all">All Adjectives</button>
                  <button type="button" class="filter-pill filter-adj-tab" data-tab="i">い-adj</button>
                  <button type="button" class="filter-pill filter-adj-tab" data-tab="na">な-adj</button>
                </div>
              </div>

              <div class="adjectives-shelf-grid" id="adjectives-shelf-grid">
                <span class="text-xs text-muted py-4 font-sans">Loading adjectives...</span>
              </div>
              <div class="shelf-pagination-footer" id="adjectives-pagination" style="display: none;"></div>
            </div>
          </section>

          <!-- 4b. Verbs by Group Shelf -->
          <section class="vocab-shelf-card tactile-card ${this.isShelfOpen('verbs') ? 'is-open' : 'is-collapsed'}" id="shelf-verbs" data-shelf="verbs">
            <div class="shelf-header shelf-accordion-toggle" role="button" tabindex="0" aria-expanded="${this.isShelfOpen('verbs')}">
              <div class="shelf-title-group">
                <div class="shelf-title-row">
                  <div class="shelf-title-with-chevron">
                    <svg class="shelf-chevron" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                    </svg>
                    <h2 class="shelf-title font-sans font-bold">Verbs by Group</h2>
                  </div>
                  <div class="shelf-header-actions">
                    <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary shelf-review-btn font-sans" data-review-shelf="verbs" title="Review words one by one">Review</button>
                    <span class="shelf-badge font-mono" id="verbs-count">0 words</span>
                  </div>
                </div>
                <p class="shelf-sub text-xs text-muted font-sans">
                  Organized by conjugation class: <span class="text-gold font-bold">G1</span>, <span class="text-green font-bold">G2</span>, and <span class="font-bold">G3</span>.
                </p>
              </div>
            </div>

            <div class="shelf-content-collapsible" style="${this.isShelfOpen('verbs') ? '' : 'display: none;'}">
              <div class="shelf-filters-row">
                <div class="shelf-filter-group" role="radiogroup" aria-label="Verb Conjugation Group">
                  <button type="button" class="filter-pill filter-verb-group is-active" data-group="all">All Verbs</button>
                  <button type="button" class="filter-pill filter-verb-group" data-group="group_1">G1</button>
                  <button type="button" class="filter-pill filter-verb-group" data-group="group_2">G2</button>
                  <button type="button" class="filter-pill filter-verb-group" data-group="group_3">G3</button>
                </div>
              </div>

              <div class="verbs-shelf-grid" id="verbs-shelf-grid">
                <span class="text-xs text-muted py-4 font-sans">Loading verbs...</span>
              </div>
              <div class="shelf-pagination-footer" id="verbs-pagination" style="display: none;"></div>
            </div>
          </section>

          <!-- 4c. Loan Words (Katakana) Shelf -->
          <section class="vocab-shelf-card tactile-card ${this.isShelfOpen('loanwords') ? 'is-open' : 'is-collapsed'}" id="shelf-loanwords" data-shelf="loanwords">
            <div class="shelf-header shelf-accordion-toggle" role="button" tabindex="0" aria-expanded="${this.isShelfOpen('loanwords')}">
              <div class="shelf-title-group">
                <div class="shelf-title-row">
                  <div class="shelf-title-with-chevron">
                    <svg class="shelf-chevron" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                    </svg>
                    <h2 class="shelf-title font-sans font-bold">Loan Words (Katakana)</h2>
                  </div>
                  <div class="shelf-header-actions">
                    <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary shelf-review-btn font-sans" data-review-shelf="loanwords" title="Review words one by one">Review</button>
                    <span class="shelf-badge font-mono" id="loanwords-count">0 words</span>
                  </div>
                </div>
                <p class="shelf-sub text-xs text-muted font-sans">
                  Katakana borrowed vocabulary for recognition and recall.
                </p>
              </div>
            </div>

            <div class="shelf-content-collapsible" style="${this.isShelfOpen('loanwords') ? '' : 'display: none;'}">
              <div class="shelf-filters-row">
                <div class="shelf-filter-group" role="radiogroup" aria-label="Loanword Mastery">
                  <button type="button" class="filter-pill filter-loanword-state is-active" data-state="all">All Loanwords</button>
                  <button type="button" class="filter-pill filter-loanword-state" data-state="unseen">Unseen</button>
                  <button type="button" class="filter-pill filter-loanword-state" data-state="learning">Learning</button>
                  <button type="button" class="filter-pill filter-loanword-state" data-state="known">Known</button>
                </div>
              </div>

              <div class="loanwords-shelf-grid" id="loanwords-shelf-grid">
                <span class="text-xs text-muted py-4 font-sans">Loading loanwords...</span>
              </div>
              <div class="shelf-pagination-footer" id="loanwords-pagination" style="display: none;"></div>
            </div>
          </section>

          <!-- 5. Keigo (Honorifics) Hub -->
          <section class="vocab-shelf-card tactile-card ${this.isShelfOpen('keigo') ? 'is-open' : 'is-collapsed'}" id="shelf-keigo" data-shelf="keigo">
            <div class="shelf-header shelf-accordion-toggle" role="button" tabindex="0" aria-expanded="${this.isShelfOpen('keigo')}">
              <div class="shelf-title-group">
                <div class="shelf-title-row">
                  <div class="shelf-title-with-chevron">
                    <svg class="shelf-chevron" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                    </svg>
                    <h2 class="shelf-title font-sans font-bold">Keigo Honorifics Hub</h2>
                  </div>
                  <div class="shelf-header-actions">
                    <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary shelf-review-btn font-sans" data-review-shelf="keigo" title="Review words one by one">Review</button>
                    <span class="shelf-badge font-mono" id="keigo-count">0 forms</span>
                  </div>
                </div>
                <p class="shelf-sub text-xs text-muted font-sans">
                  Respectful, humble, and polite forms.
                </p>
              </div>
            </div>

            <div class="shelf-content-collapsible" style="${this.isShelfOpen('keigo') ? '' : 'display: none;'}">
              <div class="shelf-filters-row">
                <div class="shelf-filter-group" role="radiogroup" aria-label="Keigo Filter">
                  <button type="button" class="filter-pill filter-keigo-tab is-active" data-type="all">All Forms</button>
                  <button type="button" class="filter-pill filter-keigo-tab" data-type="sonkeigo">Respectful</button>
                  <button type="button" class="filter-pill filter-keigo-tab" data-type="kenjougo">Humble</button>
                </div>
              </div>

              <div class="keigo-shelf-grid" id="keigo-shelf-grid">
                <span class="text-xs text-muted py-4 font-sans">Loading honorific expressions...</span>
              </div>
              <div class="shelf-pagination-footer" id="keigo-pagination" style="display: none;"></div>
            </div>
          </section>

          <!-- 6. JLPT Gaps Shelf -->
          <section class="vocab-shelf-card tactile-card ${this.isShelfOpen('jlpt-gaps') ? 'is-open' : 'is-collapsed'}" id="shelf-jlpt-gaps" data-shelf="jlpt-gaps">
            <div class="shelf-header shelf-accordion-toggle" role="button" tabindex="0" aria-expanded="${this.isShelfOpen('jlpt-gaps')}">
              <div class="shelf-title-group">
                <div class="shelf-title-row">
                  <div class="shelf-title-with-chevron">
                    <svg class="shelf-chevron" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                    </svg>
                    <h2 class="shelf-title font-sans font-bold">JLPT Level Gaps (${this.learnerLevel})</h2>
                  </div>
                  <div class="shelf-header-actions">
                    <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary shelf-review-btn font-sans" data-review-shelf="jlpt-gaps" title="Review words one by one">Review</button>
                    <span class="shelf-badge font-mono" id="gaps-breakdown-count">0 gaps</span>
                  </div>
                </div>
                <p class="shelf-sub text-xs text-muted font-sans">
                  Unseen <span class="font-mono text-gold font-bold">${this.learnerLevel}</span> vocabulary ready to mine or drill.
                </p>
              </div>
            </div>

            <div class="shelf-content-collapsible" style="${this.isShelfOpen('jlpt-gaps') ? '' : 'display: none;'}">
              <div class="shelf-filters-row">
                <div class="shelf-filter-group" role="radiogroup" aria-label="Gap Categories">
                  <button type="button" class="filter-pill filter-gap-cat is-active" data-cat="all">All Categories</button>
                  <button type="button" class="filter-pill filter-gap-cat" data-cat="adverb">Adverbs</button>
                  <button type="button" class="filter-pill filter-gap-cat" data-cat="noun">Nouns</button>
                  <button type="button" class="filter-pill filter-gap-cat" data-cat="katakana_loanword">Loanwords</button>
                  <button type="button" class="filter-pill filter-gap-cat" data-cat="verb">Verbs</button>
                  <button type="button" class="filter-pill filter-gap-cat" data-cat="adjective">Adjectives</button>
                </div>

                <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary font-sans" id="btn-drill-shelf-gaps">
                  Drill in Study
                </button>
              </div>

              <div class="gaps-shelf-grid" id="gaps-shelf-grid">
                <span class="text-xs text-muted py-4 font-sans">Loading categorized level gaps...</span>
              </div>
              <div class="shelf-pagination-footer" id="gaps-pagination" style="display: none;"></div>
            </div>
          </section>
        </div>

        <!-- VIEW MODE 2: FULL INVENTORY TABLE SECTION -->
        <div class="inv-table-section" id="inv-table-section" style="${this.activeSubView === 'table' ? '' : 'display: none;'}">
          <!-- Filter & Actions Toolbar -->
          <div class="vocab-inventory-toolbar tactile-card">
            <div class="inv-toolbar-top">
              <div class="inv-search-wrap">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" class="search-icon">
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <input type="text" id="inv-search-input" class="tactile-input inv-search-input" placeholder="Search expression, reading, meaning..." value="${escapeHtml(this.filterSearch)}" />
              </div>

              <div class="inv-toolbar-actions">
                <button type="button" class="tactile-btn tactile-btn-primary" id="btn-inv-study-these" title="Launch Study practice with currently filtered words">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                  </svg>
                  <span>Study these</span>
                </button>
              </div>
            </div>

            <div class="inv-toolbar-filters">
              <!-- Level Filter Pills -->
              <div class="inv-filter-group" data-filter="level" role="radiogroup" aria-label="JLPT Level">
                <span class="inv-filter-label font-mono">Level:</span>
                <button type="button" class="filter-pill inv-level-pill is-active" data-val="all">All</button>
                <button type="button" class="filter-pill inv-level-pill" data-val="N5">N5</button>
                <button type="button" class="filter-pill inv-level-pill" data-val="N4">N4</button>
                <button type="button" class="filter-pill inv-level-pill" data-val="N3">N3</button>
                <button type="button" class="filter-pill inv-level-pill" data-val="N2">N2</button>
                <button type="button" class="filter-pill inv-level-pill" data-val="N1">N1</button>
              </div>

              <!-- State Filter Pills -->
              <div class="inv-filter-group" data-filter="state" role="radiogroup" aria-label="Learner State">
                <span class="inv-filter-label font-mono">Status:</span>
                <button type="button" class="filter-pill inv-state-pill is-active" data-val="all">All</button>
                <button type="button" class="filter-pill inv-state-pill" data-val="known">Known</button>
                <button type="button" class="filter-pill inv-state-pill" data-val="learning">Learning</button>
                <button type="button" class="filter-pill inv-state-pill" data-val="unseen">Unseen</button>
                <button type="button" class="filter-pill inv-state-pill" data-val="ignored">Ignored</button>
              </div>

              <!-- Category / POS Filter Dropdown -->
              <div class="inv-filter-group">
                <span class="inv-filter-label font-mono">Category:</span>
                <select id="inv-select-category" class="tactile-select inv-filter-select">
                  <option value="all">All categories</option>
                  <option value="adverb">Adverbs</option>
                  <option value="onomatopoeia">Onomatopoeia</option>
                  <option value="suru_verb">Suru verbs</option>
                  <option value="verb_transitive">Transitive verbs</option>
                  <option value="verb_intransitive">Intransitive verbs</option>
                  <option value="adjective_i">i-Adjectives</option>
                  <option value="adjective_na">na-Adjectives</option>
                  <option value="noun">Nouns</option>
                  <option value="expression">Expressions</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Floating Bulk Action Bar -->
          <div class="inv-bulk-bar tactile-card" id="inv-bulk-bar" style="display: none;">
            <div class="bulk-info">
              <span class="bulk-count font-mono font-bold text-gold" id="inv-bulk-count">0</span>
              <span class="text-xs text-muted font-sans">words selected</span>
            </div>
            <div class="bulk-actions-buttons">
              <button type="button" class="tactile-btn tactile-btn-sm" id="btn-bulk-known">Mark Known</button>
              <button type="button" class="tactile-btn tactile-btn-sm" id="btn-bulk-learning">Mark Learning</button>
              <button type="button" class="tactile-btn tactile-btn-sm" id="btn-bulk-ignored">Mark Ignored</button>
              <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-bulk-study">Study Selected</button>
              <button type="button" class="tactile-btn tactile-btn-sm" id="btn-bulk-deselect">Deselect</button>
            </div>
          </div>

          <!-- Error Banner -->
          <div class="inv-error-banner" id="inv-error-banner" style="display: none;" role="alert">
            <span class="error-msg" id="inv-error-text">Failed to communicate with backend.</span>
            <button class="tactile-btn tactile-btn-sm" id="btn-inv-retry">Retry</button>
          </div>

          <!-- Dense Data Grid -->
          <div class="inv-table-container tactile-card">
            <table class="inv-table" id="inv-table">
              <thead>
                <tr>
                  <th style="width: 38px; text-align: center;">
                    <input type="checkbox" id="inv-select-all" title="Select all on this page" />
                  </th>
                  <th style="width: 170px;">Expression</th>
                  <th style="width: 70px;">Level</th>
                  <th>Meaning</th>
                  <th style="width: 140px;">Categories</th>
                  <th style="width: 100px;">Status</th>
                  <th style="width: 80px; text-align: center;">Seen</th>
                  <th style="width: 90px; text-align: right;">Action</th>
                </tr>
              </thead>
              <tbody id="inv-table-body">
                <tr>
                  <td colspan="8" class="text-center py-8 text-muted">
                    <span class="font-mono text-sm">Loading vocabulary inventory...</span>
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- Pagination Row -->
            <div class="inv-pagination-row">
              <span class="pagination-info" id="inv-pagination-info">Showing 0 of 0 words</span>
              <div class="pagination-buttons">
                <button class="tactile-btn tactile-btn-sm" id="btn-inv-prev" disabled>Previous</button>
                <button class="tactile-btn tactile-btn-sm" id="btn-inv-next" disabled>Next</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Slide-Over Inspector Drawer & Backdrop -->
        <div class="drawer-backdrop" id="inv-drawer-backdrop" style="display: none;"></div>
        <aside class="card-inspector-drawer inv-drawer" id="inv-drawer" role="dialog" aria-modal="true" aria-hidden="true">
          <div class="drawer-header drawer-header-minimal">
            <button class="drawer-close-btn" id="btn-close-inv-drawer" aria-label="Close inspector">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
          <div class="drawer-body" id="inv-drawer-body"></div>
        </aside>

        <!-- Per-Shelf Flashcard Reviewer Modal -->
        <div class="brutalist-review-overlay" id="shelf-review-overlay" style="display: none;" role="dialog" aria-modal="true" aria-label="Shelf Word Reviewer"></div>
      </div>
    `;
  }

  setupEvents() {
    // 1. Sub-segment switching (Shelves vs Full Table)
    const tabShelves = document.getElementById('tab-sub-shelves');
    const tabTable = document.getElementById('tab-sub-table');
    const shelvesContainer = document.getElementById('inv-shelves-container');
    const tableSection = document.getElementById('inv-table-section');

    const switchSubView = async (mode) => {
      this.saveSubViewPreference(mode);
      if (tabShelves) {
        tabShelves.classList.toggle('is-active', mode === 'shelves');
        tabShelves.setAttribute('aria-selected', mode === 'shelves' ? 'true' : 'false');
      }
      if (tabTable) {
        tabTable.classList.toggle('is-active', mode === 'table');
        tabTable.setAttribute('aria-selected', mode === 'table' ? 'true' : 'false');
      }
      if (shelvesContainer) shelvesContainer.style.display = mode === 'shelves' ? '' : 'none';
      if (tableSection) tableSection.style.display = mode === 'table' ? '' : 'none';
      const shelvesHeaderActions = document.getElementById('shelves-header-actions');
      if (shelvesHeaderActions) shelvesHeaderActions.style.display = mode === 'shelves' ? '' : 'none';
      const metricsBar = document.getElementById('inv-metrics-bar');
      if (metricsBar) {
        metricsBar.classList.toggle('is-hidden', mode !== 'table');
        metricsBar.style.setProperty('display', mode === 'table' ? '' : 'none', mode === 'table' ? '' : 'important');
      }

      if (mode === 'shelves') {
        await this.loadShelvesData();
      } else {
        await this.loadData();
      }
    };

    if (tabShelves) tabShelves.addEventListener('click', () => switchSubView('shelves'));
    if (tabTable) tabTable.addEventListener('click', () => switchSubView('table'));

    // Shelves: Per-shelf Review buttons (stopPropagation so accordion does not toggle)
    this.container.querySelectorAll('.shelf-review-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const shelfKey = btn.dataset.reviewShelf;
        if (shelfKey) {
          this.startShelfReview(shelfKey);
        }
      });
    });

    // Shelves: Accordion header click to toggle open/close
    const accordionToggles = this.container.querySelectorAll('.shelf-accordion-toggle');
    accordionToggles.forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const card = toggle.closest('.vocab-shelf-card');
        const shelfId = card?.dataset.shelf;
        if (shelfId) {
          this.toggleShelf(shelfId);
        }
      });
      toggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const card = toggle.closest('.vocab-shelf-card');
          const shelfId = card?.dataset.shelf;
          if (shelfId) {
            this.toggleShelf(shelfId);
          }
        }
      });
    });

    // Shelves Toolbar: Expand / Collapse All
    const btnExpandAll = document.getElementById('btn-shelves-expand-all');
    const btnCollapseAll = document.getElementById('btn-shelves-collapse-all');
    if (btnExpandAll) {
      btnExpandAll.addEventListener('click', () => this.expandAllShelves());
    }
    if (btnCollapseAll) {
      btnCollapseAll.addEventListener('click', () => this.collapseAllShelves());
    }

    // Shelves: Transitive Level Pills
    const pairLevelPills = this.container.querySelectorAll('.filter-pair-level');
    pairLevelPills.forEach((pill) => {
      pill.addEventListener('click', async () => {
        pairLevelPills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.transitiveLevelFilter = pill.dataset.level || 'all';
        this.shelfLimits.transitive = 30;
        await this.refreshTransitivePairs();
      });
    });

    // Shelves: Transitive Mastery Pills
    const pairMasteryPills = this.container.querySelectorAll('.filter-pair-mastery');
    pairMasteryPills.forEach((pill) => {
      pill.addEventListener('click', async () => {
        pairMasteryPills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.transitiveMasteryFilter = pill.dataset.mastery || 'all';
        this.shelfLimits.transitive = 30;
        await this.refreshTransitivePairs();
      });
    });

    // Shelves: Adverb Type Tabs (Degree, Time, Frequency, Manner)
    const adverbTabs = this.container.querySelectorAll('.filter-adverb-tab');
    adverbTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        adverbTabs.forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        this.adverbNuanceFilter = tab.dataset.type || 'all';
        this.shelfLimits.adverbs = 40;
        this.renderAdverbsShelf();
      });
    });

    // Shelves: Onomatopoeia Nuance Tabs (Sounds, Voices, Manner, Emotions)
    const onomTabs = this.container.querySelectorAll('.filter-onomatopoeia-tab');
    onomTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        onomTabs.forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        this.onomatopoeiaNuanceFilter = tab.dataset.nuance || 'all';
        this.shelfLimits.onomatopoeia = 40;
        this.renderOnomatopoeiaShelf();
      });
    });

    // Shelves: Keigo Filter Tabs (All, Sonkeigo, Kenjougo)
    const keigoTabs = this.container.querySelectorAll('.filter-keigo-tab');
    keigoTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        keigoTabs.forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        this.keigoTypeFilter = tab.dataset.type || 'all';
        this.shelfLimits.keigo = 30;
        this.renderKeigoShelf();
      });
    });

    // Shelves: Adjectives Tabs
    const adjTabs = this.container.querySelectorAll('.filter-adj-tab');
    adjTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        adjTabs.forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        this.adjectivesTab = tab.dataset.tab || 'all';
        this.shelfLimits.adjectives = 40;
        this.renderAdjectivesShelf();
      });
    });

    // Shelves: Verbs Group Tabs
    const verbGroupTabs = this.container.querySelectorAll('.filter-verb-group');
    verbGroupTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        verbGroupTabs.forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        this.verbsGroupFilter = tab.dataset.group || 'all';
        this.shelfLimits.verbs = 40;
        this.renderVerbsShelf();
      });
    });

    // Shelves: Loanwords State Tabs
    const loanwordTabs = this.container.querySelectorAll('.filter-loanword-state');
    loanwordTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        loanwordTabs.forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        this.loanwordsStateFilter = tab.dataset.state || 'all';
        this.shelfLimits.loanwords = 40;
        this.renderLoanwordsShelf();
      });
    });

    // Shelves: Gap Category Pills
    const gapCatPills = this.container.querySelectorAll('.filter-gap-cat');
    gapCatPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        gapCatPills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.gapCategoryFilter = pill.dataset.cat || 'all';
        this.shelfLimits.gaps = 40;
        this.renderGapsShelf();
      });
    });

    // Shelves Pagination Delegated Click Handler ("Show more" / "Show all")
    if (shelvesContainer) {
      shelvesContainer.addEventListener('click', (e) => {
        const moreBtn = e.target.closest('.btn-shelf-show-more');
        if (moreBtn) {
          const shelf = moreBtn.dataset.shelf;
          if (shelf && this.shelfLimits[shelf] !== undefined) {
            this.shelfLimits[shelf] += 30;
            this.reRenderShelf(shelf);
          }
          return;
        }

        const allBtn = e.target.closest('.btn-shelf-show-all');
        if (allBtn) {
          const shelf = allBtn.dataset.shelf;
          const total = parseInt(allBtn.dataset.total, 10);
          if (shelf && total) {
            this.shelfLimits[shelf] = Math.max(total, 500);
            this.reRenderShelf(shelf);
          }
        }
      });
    }

    // Shelves: Drill in Study button
    const btnDrillGaps = document.getElementById('btn-drill-shelf-gaps');
    if (btnDrillGaps) {
      btnDrillGaps.addEventListener('click', () => {
        const words = this.getVisibleGapWords();
        const query = words.length ? `words=${encodeURIComponent(words.join(','))}` : '';
        this.router.navigateToTab('study', { query });
      });
    }

    // --- Full Table Events ---
    // Search input with debounce
    const searchInput = document.getElementById('inv-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => {
          this.filterSearch = e.target.value.trim();
          this.currentPage = 1;
          this.loadData();
        }, 250);
      });
    }

    // Level filter pills
    const levelPills = this.container.querySelectorAll('.inv-level-pill');
    levelPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        levelPills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.filterLevel = pill.dataset.val || 'all';
        this.currentPage = 1;
        this.loadData();
      });
    });

    // State filter pills
    const statePills = this.container.querySelectorAll('.inv-state-pill');
    statePills.forEach((pill) => {
      pill.addEventListener('click', () => {
        statePills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.filterState = pill.dataset.val || 'all';
        this.currentPage = 1;
        this.loadData();
      });
    });

    // Category dropdown
    const selectCat = document.getElementById('inv-select-category');
    if (selectCat) {
      selectCat.addEventListener('change', (e) => {
        this.filterCategory = e.target.value || 'all';
        this.currentPage = 1;
        this.loadData();
      });
    }

    // Select all checkbox
    const selectAll = document.getElementById('inv-select-all');
    if (selectAll) {
      selectAll.addEventListener('change', (e) => {
        const checked = e.target.checked;
        this.container.querySelectorAll('.inv-row-check').forEach((cb) => {
          cb.checked = checked;
          const expr = cb.dataset.expression;
          if (expr) {
            if (checked) this.selectedExpressions.add(expr);
            else this.selectedExpressions.delete(expr);
          }
        });
        this.updateBulkBar();
      });
    }

    // Pagination buttons
    const btnPrev = document.getElementById('btn-inv-prev');
    const btnNext = document.getElementById('btn-inv-next');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.loadData();
        }
      });
    }
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        const maxPage = Math.ceil(this.totalItems / this.pageSize) || 1;
        if (this.currentPage < maxPage) {
          this.currentPage++;
          this.loadData();
        }
      });
    }

    // Retry button
    const btnRetry = document.getElementById('btn-inv-retry');
    if (btnRetry) {
      btnRetry.addEventListener('click', () => {
        if (this.activeSubView === 'shelves') this.loadShelvesData();
        else this.loadData();
      });
    }

    // Drawer close buttons
    const btnCloseDrawer = document.getElementById('btn-close-inv-drawer');
    const backdrop = document.getElementById('inv-drawer-backdrop');
    if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', () => this.closeDrawer());
    if (backdrop) backdrop.addEventListener('click', () => this.closeDrawer());

    // Bulk buttons
    const btnBulkKnown = document.getElementById('btn-bulk-known');
    const btnBulkLearning = document.getElementById('btn-bulk-learning');
    const btnBulkIgnored = document.getElementById('btn-bulk-ignored');
    const btnBulkDeselect = document.getElementById('btn-bulk-deselect');
    const btnBulkStudy = document.getElementById('btn-bulk-study');
    const btnStudyThese = document.getElementById('btn-inv-study-these');

    if (btnBulkKnown) btnBulkKnown.addEventListener('click', () => this.handleBulkState('known'));
    if (btnBulkLearning) btnBulkLearning.addEventListener('click', () => this.handleBulkState('learning'));
    if (btnBulkIgnored) btnBulkIgnored.addEventListener('click', () => this.handleBulkState('ignored'));
    if (btnBulkDeselect) {
      btnBulkDeselect.addEventListener('click', () => {
        this.selectedExpressions.clear();
        this.updateBulkBar();
        this.renderTableRows();
      });
    }
    if (btnBulkStudy) btnBulkStudy.addEventListener('click', () => this.handleStudySelected());
    if (btnStudyThese) btnStudyThese.addEventListener('click', () => this.handleStudyThese());
  }

  async loadData() {
    this.isLoading = true;
    const tbody = document.getElementById('inv-table-body');
    const errBanner = document.getElementById('inv-error-banner');
    if (errBanner) errBanner.style.display = 'none';

    try {
      const offset = (this.currentPage - 1) * this.pageSize;
      const params = {
        limit: this.pageSize,
        offset: offset,
        include_reference: true
      };

      if (this.filterSearch) params.search = this.filterSearch;
      if (this.filterLevel !== 'all') params.jlpt_level = this.filterLevel;
      if (this.filterState !== 'all') params.state = this.filterState;
      if (this.filterCategory !== 'all') params.category = this.filterCategory;
      if (this.filterSource !== 'all') params.source = this.filterSource;

      const res = await apiClient.getVocabInventory(params);
      if (res) {
        this.items = Array.isArray(res.items) ? res.items : [];
        this.totalItems = typeof res.total === 'number' ? res.total : this.items.length;
        this.countsByState = res.counts_by_state || { total: 0, known: 0, learning: 0, unseen: 0, ignored: 0 };
        this.updateMetrics();
        this.renderTableRows();
        this.updatePagination();
      }
    } catch (err) {
      this.showError(`Error loading vocabulary inventory: ${err.message || 'Unknown network error'}`);
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-red">Failed to load vocabulary inventory. Check backend connection.</td></tr>`;
      }
    } finally {
      this.isLoading = false;
    }
  }

  updateMetrics() {
    const elTotal = document.getElementById('inv-metric-total');
    const elKnown = document.getElementById('inv-metric-known');
    const elLearning = document.getElementById('inv-metric-learning');
    const elUnseen = document.getElementById('inv-metric-unseen');
    const elFiltered = document.getElementById('inv-metric-filtered');

    if (elTotal) mountCounter(elTotal, { targetValue: this.countsByState.total || 0, delay: 0 });
    if (elKnown) mountCounter(elKnown, { targetValue: this.countsByState.known || 0, delay: 40 });
    if (elLearning) mountCounter(elLearning, { targetValue: this.countsByState.learning || 0, delay: 80 });
    if (elUnseen) mountCounter(elUnseen, { targetValue: this.countsByState.unseen || 0, delay: 120 });
    if (elFiltered) mountCounter(elFiltered, { targetValue: this.totalItems || 0, delay: 160 });
  }

  renderTableRows() {
    const tbody = document.getElementById('inv-table-body');
    if (!tbody) return;

    if (this.items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center py-8 text-muted">
            <span class="font-sans">No vocabulary words match the current filters.</span>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = this.items.map((item) => {
      const isChecked = this.selectedExpressions.has(item.expression);
      const stateClass = `state-pill-${item.state || 'unseen'}`;
      const stateLabel = item.state ? item.state.charAt(0).toUpperCase() + item.state.slice(1) : 'Unseen';
      const lvlLabel = item.jlpt_level || '—';
      const cats = (item.categories || []).slice(0, 2).map((c) => `<span class="inv-cat-chip font-mono">${escapeHtml(c)}</span>`).join(' ');

      return `
        <tr class="inv-table-row ${isChecked ? 'is-selected' : ''}" data-expression="${escapeHtml(item.expression)}">
          <td style="text-align: center;" onclick="event.stopPropagation();">
            <input type="checkbox" class="inv-row-check" data-expression="${escapeHtml(item.expression)}" ${isChecked ? 'checked' : ''} />
          </td>
          <td class="inv-col-word">
            ${this.renderRubyText(item.expression, item.reading, 'inv-ruby font-japanese', 'font-japanese text-muted')}
          </td>
          <td>
            <span class="inv-level-badge font-mono">${escapeHtml(lvlLabel)}</span>
          </td>
          <td class="inv-col-meaning font-sans text-secondary" title="${escapeHtml(item.meaning || '')}">
            ${escapeHtml(item.meaning || '—')}
          </td>
          <td>${cats || '<span class="text-muted">—</span>'}</td>
          <td>
            <button type="button" class="inv-state-pill-btn inline-state-trigger ${stateClass} font-mono" data-expression="${escapeHtml(item.expression)}" data-state="${escapeHtml(item.state || 'unseen')}" title="Click to change status">
              ${escapeHtml(stateLabel)}
            </button>
          </td>
          <td style="text-align: center;">
            <span class="inv-encounters-count font-mono ${item.encounters_count > 0 ? 'text-gold' : 'text-muted'}">${item.encounters_count}</span>
          </td>
          <td style="text-align: right;">
            <button type="button" class="tactile-btn tactile-btn-sm inv-btn-inspect" data-expression="${escapeHtml(item.expression)}" title="Open word inspector drawer">
              Inspect
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach row events
    tbody.querySelectorAll('.inv-table-row').forEach((row) => {
      const expr = row.dataset.expression;
      row.addEventListener('click', () => {
        const item = this.items.find((x) => x.expression === expr);
        if (item) this.openDrawer(item);
      });
    });

    tbody.querySelectorAll('.inv-row-check').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const expr = cb.dataset.expression;
        if (e.target.checked) this.selectedExpressions.add(expr);
        else this.selectedExpressions.delete(expr);
        this.updateBulkBar();
      });
    });

    this.bindInlineStateTriggers(tbody);

    tbody.querySelectorAll('.inv-btn-inspect').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const expr = btn.dataset.expression;
        const item = this.items.find((x) => x.expression === expr);
        if (item) this.openDrawer(item);
      });
    });
  }

  updateBulkBar() {
    const bar = document.getElementById('inv-bulk-bar');
    const countEl = document.getElementById('inv-bulk-count');
    const count = this.selectedExpressions.size;

    if (bar && countEl) {
      if (count > 0) {
        countEl.textContent = count;
        bar.style.display = 'flex';
      } else {
        bar.style.display = 'none';
      }
    }
  }

  hasKanji(text) {
    return /[\u4e00-\u9faf\u3400-\u4dbf\u3005]/.test(String(text || ''));
  }

  renderRubyText(expression, reading, rubyClass = '', rtClass = '') {
    const expr = String(expression || '');
    const read = String(reading || '').trim();
    const showFurigana = this.hasKanji(expr) && read && read !== expr;
    if (!showFurigana) {
      return `<span class="${rubyClass}">${escapeHtml(expr)}</span>`;
    }
    return `
      <ruby class="${rubyClass}">
        ${escapeHtml(expr)}
        <rt class="${rtClass}">${escapeHtml(read)}</rt>
      </ruby>
    `;
  }

  closeInlineStateMenu() {
    if (this._inlineMenuCleanup) {
      this._inlineMenuCleanup();
      this._inlineMenuCleanup = null;
    }
    const existing = document.getElementById('inv-inline-state-popover');
    if (existing) existing.remove();
  }

  openInlineStateMenu(anchorEl, expression, currentState) {
    this.closeInlineStateMenu();
    if (!anchorEl || !expression) return;

    const menu = document.createElement('div');
    menu.id = 'inv-inline-state-popover';
    menu.className = 'inline-state-popover tactile-card';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = ['known', 'learning', 'unseen', 'ignored'].map((st) => `
      <button type="button" class="inline-state-option state-pill-${st} ${currentState === st ? 'is-current' : ''} font-mono" data-state="${st}" role="menuitem">
        ${st.charAt(0).toUpperCase() + st.slice(1)}
      </button>
    `).join('');

    menu.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(menu);

    const rect = anchorEl.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const top = Math.min(window.innerHeight - menuRect.height - 8, rect.bottom + 6);
    const left = Math.max(8, Math.min(window.innerWidth - menuRect.width - 8, rect.right - menuRect.width));
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    menu.querySelectorAll('.inline-state-option').forEach((opt) => {
      opt.addEventListener('click', async (e) => {
        e.stopPropagation();
        const nextState = opt.dataset.state;
        this.closeInlineStateMenu();
        if (nextState && nextState !== currentState) {
          await this.handleSingleStateChange(expression, nextState);
        }
      });
    });

    const onDocClick = () => this.closeInlineStateMenu();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') this.closeInlineStateMenu();
    };
    setTimeout(() => {
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onKeyDown);
    }, 0);
    this._inlineMenuCleanup = () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }

  bindInlineStateTriggers(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('.inline-state-trigger').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const expr = btn.dataset.expression;
        const cur = btn.dataset.state || 'unseen';
        this.openInlineStateMenu(btn, expr, cur);
      });
    });
  }

  async handleSingleStateChange(expression, newState) {
    try {
      await apiClient.bulkSetWordStates([expression], newState);
      const item = this.items.find((x) => x.expression === expression);
      if (item) item.state = newState;

      // Sync cached shelf datasets so inline card state & done/total badges update immediately
      let refreshAdverbs = false;
      let refreshOnom = false;
      let refreshAdj = false;
      let refreshVerbs = false;
      let refreshLoanwords = false;
      let refreshTransitive = false;
      let refreshKeigo = false;
      let refreshGaps = false;

      (this._cachedAdverbs || []).forEach((x) => {
        if (x.expression === expression) { x.state = newState; refreshAdverbs = true; }
      });
      (this._cachedOnomatopoeia || []).forEach((x) => {
        if (x.expression === expression) { x.state = newState; refreshOnom = true; }
      });
      (this._cachedAdjectives || []).forEach((x) => {
        if (x.expression === expression) { x.state = newState; refreshAdj = true; }
      });
      (this._cachedVerbs || []).forEach((x) => {
        if (x.expression === expression) { x.state = newState; refreshVerbs = true; }
      });
      (this._cachedLoanwords || []).forEach((x) => {
        if (x.expression === expression) { x.state = newState; refreshLoanwords = true; }
      });
      (this.transitivePairs || []).forEach((pair) => {
        if (pair.transitive?.expression === expression) { pair.transitive.state = newState; refreshTransitive = true; }
        if (pair.intransitive?.expression === expression) { pair.intransitive.state = newState; refreshTransitive = true; }
        if (refreshTransitive) {
          const vtKnown = pair.transitive?.state === 'known';
          const viKnown = pair.intransitive?.state === 'known';
          const anyLearning = pair.transitive?.state === 'learning' || pair.intransitive?.state === 'learning';
          pair.pair_mastery = (vtKnown && viKnown) ? 'both_known' : (vtKnown || viKnown) ? 'half_known' : anyLearning ? 'learning' : 'unseen';
        }
      });
      (this.keigoItems || []).forEach((trio) => {
        if (trio.sonkeigo?.expression === expression) { trio.sonkeigo.state = newState; refreshKeigo = true; }
        if (trio.kenjougo?.expression === expression) { trio.kenjougo.state = newState; refreshKeigo = true; }
        if (refreshKeigo) {
          const sonKnown = trio.sonkeigo?.state === 'known';
          const kenKnown = trio.kenjougo?.state === 'known';
          const anyLearning = trio.sonkeigo?.state === 'learning' || trio.kenjougo?.state === 'learning';
          trio.mastery_status = (sonKnown && kenKnown) ? 'mastered' : (sonKnown || kenKnown || anyLearning) ? 'learning' : 'unseen';
        }
      });
      if (this.gapBreakdown?.breakdown) {
        Object.values(this.gapBreakdown.breakdown).forEach((arr) => {
          (arr || []).forEach((g) => {
            if (g.expression === expression) { g.state = newState; refreshGaps = true; }
          });
        });
      }

      if (refreshAdverbs) this.renderAdverbsShelf();
      if (refreshOnom) this.renderOnomatopoeiaShelf();
      if (refreshAdj) this.renderAdjectivesShelf();
      if (refreshVerbs) this.renderVerbsShelf();
      if (refreshLoanwords) this.renderLoanwordsShelf();
      if (refreshTransitive) this.renderTransitivePairsHub();
      if (refreshKeigo) this.renderKeigoShelf();
      if (refreshGaps) this.renderGapsShelf();

      this.renderTableRows();
      if (this.activeItem && this.activeItem.expression === expression) {
        this.activeItem.state = newState;
        this.renderDrawerBody(this.activeItem);
      }
      this.fetchMetricsOnly();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kiroku:word-state-changed', {
          detail: { expression, state: newState }
        }));
        window.dispatchEvent(new CustomEvent('kiroku:data-changed'));
      }
    } catch (err) {
      this.showError(`Failed to update state for ${expression}: ${err.message}`);
    }
  }

  async handleBulkState(state) {
    if (this.selectedExpressions.size === 0) return;
    const expressions = Array.from(this.selectedExpressions);
    try {
      await apiClient.bulkSetWordStates(expressions, state);
      this.selectedExpressions.clear();
      this.updateBulkBar();
      await this.loadData();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kiroku:word-state-changed', {
          detail: { expressions, state }
        }));
        window.dispatchEvent(new CustomEvent('kiroku:data-changed'));
      }
    } catch (err) {
      this.showError(`Failed bulk update: ${err.message}`);
    }
  }

  async handleStudySelected() {
    if (this.selectedExpressions.size === 0) return;
    const words = Array.from(this.selectedExpressions);
    await this.launchStudyWithWords(words, 'Selected Inventory Words');
  }

  async handleStudyThese() {
    const words = this.items.map((x) => x.expression).filter(Boolean);
    if (words.length === 0) {
      this.showError('No words found to study in current filter.');
      return;
    }
    const filterDesc = `${this.filterLevel.toUpperCase()} ${this.filterState} words`;
    await this.launchStudyWithWords(words, filterDesc);
  }

  async launchStudyWithWords(words, name) {
    try {
      const items = words.slice(0, 50).map((w) => ({ expression: w, sequence_id: 1 }));
      const payload = {
        name: `Vocab Drill: ${name}`,
        description: `Auto-generated from Vocab Inventory (${words.length} words)`,
        items: items
      };
      const res = await apiClient.createWordSet(payload);
      const slug = res?.slug || res?.id || 'custom';
      this.router.navigateToTab('study', { query: `mode=vocab&set=${encodeURIComponent(slug)}` });
    } catch (err) {
      // Fallback direct navigate
      const query = `words=${encodeURIComponent(words.slice(0, 30).join(','))}`;
      this.router.navigateToTab('study', { query });
    }
  }

  async openDrawer(item) {
    this.activeItem = item;
    const drawer = document.getElementById('inv-drawer');
    const backdrop = document.getElementById('inv-drawer-backdrop');
    if (drawer && backdrop) {
      this.renderDrawerBody(item);
      backdrop.style.display = 'block';
      drawer.classList.add('is-open');
      drawer.setAttribute('aria-hidden', 'false');

      // Enrich example sentence & translation if missing on shelf/pair item
      if (!item.example_sentence && item.expression) {
        const fromLoaded = this.items.find((x) => x.expression === item.expression && x.example_sentence);
        if (fromLoaded) {
          item.example_sentence = fromLoaded.example_sentence;
          item.example_translation = fromLoaded.example_translation || '';
          if (this.activeItem?.expression === item.expression) {
            this.renderDrawerBody(item);
          }
        } else {
          try {
            const res = await apiClient.getVocabInventory({ search: item.expression, limit: 5, include_reference: true });
            const match = (res?.items || []).find((x) => x.expression === item.expression && x.example_sentence);
            if (match && this.activeItem?.expression === item.expression) {
              item.example_sentence = match.example_sentence;
              item.example_translation = match.example_translation || '';
              this.renderDrawerBody(item);
            }
          } catch (_) {}
        }
      }

      // Fetch verb conjugation forms & formation rules if word is a verb
      const cats = (item.categories || []).map((c) => c.toLowerCase());
      const looksLikeVerb = cats.some((c) => c.includes('verb') || c.startsWith('v1') || c.startsWith('v5') || c === 'vt' || c === 'vi' || c.startsWith('vs') || c === 'vk');
      if (looksLikeVerb && !item._conjugations && item.expression) {
        item._conjugationsLoading = true;
        this.renderDrawerBody(item);
        try {
          const conj = await apiClient.getVerbConjugations(item.expression, item.reading || '', item.categories || []);
          item._conjugations = conj;
        } catch (_) {
          item._conjugations = null;
        } finally {
          item._conjugationsLoading = false;
          if (this.activeItem?.expression === item.expression) {
            this.renderDrawerBody(item);
          }
        }
      }
    }
  }

  closeDrawer() {
    const drawer = document.getElementById('inv-drawer');
    const backdrop = document.getElementById('inv-drawer-backdrop');
    if (drawer && backdrop) {
      drawer.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
      backdrop.style.display = 'none';
      this.activeItem = null;
    }
  }

  renderDrawerConjugationsSection(item) {
    if (item._conjugationsLoading) {
      return `
        <div class="drawer-section mt-4">
          <div class="inv-conj-dropdown-stub text-xs font-mono text-muted">Loading conjugation forms...</div>
        </div>
      `;
    }
    const conj = item._conjugations;
    if (!conj || !conj.is_verb || !Array.isArray(conj.forms) || conj.forms.length === 0) {
      return '';
    }

    const groupShort = conj.group === 'group_1' ? 'G1' : conj.group === 'group_2' ? 'G2' : conj.group === 'group_3' ? 'G3' : (conj.group_label || '');

    const rowsHtml = conj.forms.map((f) => {
      const showReading = f.reading && f.reading !== f.value;
      return `
        <div class="inv-conj-row">
          <div class="inv-conj-left">
            <span class="inv-conj-label font-sans">${escapeHtml(f.label)}</span>
            <span class="inv-conj-rule font-mono">${escapeHtml(f.rule || '')}</span>
          </div>
          <div class="inv-conj-right">
            <span class="inv-conj-val font-japanese">${escapeHtml(f.value)}</span>
            ${showReading ? `<span class="inv-conj-read font-japanese">${escapeHtml(f.reading)}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="drawer-section mt-4">
        <details class="inv-conj-dropdown">
          <summary class="inv-conj-summary">
            <div class="inv-conj-summary-left">
              <svg class="inv-conj-chevron" viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
              </svg>
              <span class="inv-conj-title font-mono">CONJUGATIONS &amp; FORMATION</span>
            </div>
            <div class="inv-conj-summary-right">
              ${groupShort ? `<span class="inv-conj-group-badge font-mono">${escapeHtml(groupShort)}</span>` : ''}
              <span class="inv-conj-count font-mono">${conj.forms.length} forms</span>
            </div>
          </summary>
          <div class="inv-conj-body">
            ${conj.exception_note ? `<p class="inv-conj-exception text-xs font-sans">${escapeHtml(conj.exception_note)}</p>` : ''}
            <div class="inv-conj-list">
              ${rowsHtml}
            </div>
          </div>
        </details>
      </div>
    `;
  }

  renderDrawerBody(item) {
    const body = document.getElementById('inv-drawer-body');
    if (!body) return;

    const cats = (item.categories || []).map((c) => `<span class="inv-cat-chip font-mono">${escapeHtml(c)}</span>`).join(' ');
    const exampleJa = item.example_sentence || item.example_hint || '';
    const exampleEn = item.example_translation || '';

    body.innerHTML = `
      <div class="drawer-content-pane">
        <!-- Hero showcase -->
        <div class="inv-drawer-hero tactile-card">
          ${this.renderRubyText(item.expression, item.reading, 'inv-drawer-expression font-display', 'font-japanese inv-drawer-furigana')}
          <div class="inv-drawer-badges mt-2">
            <span class="inv-level-badge font-mono">${escapeHtml(item.jlpt_level || 'No level')}</span>
            ${item.is_mined ? '<span class="mined-badge font-mono text-green">Mined card</span>' : '<span class="mined-badge font-mono text-muted">Not mined</span>'}
          </div>
        </div>

        <!-- Meaning block -->
        <div class="drawer-section mt-4">
          <h4 class="text-xs font-mono text-muted uppercase">Meaning</h4>
          <p class="font-sans text-warm-paper mt-1" style="font-size: 1rem; line-height: 1.5;">
            ${escapeHtml(item.meaning || 'No meaning definition available.')}
          </p>
        </div>

        <!-- Status selector & Quick Actions (kept above fold so no scrolling needed to save) -->
        <div class="drawer-section mt-4">
          <h4 class="text-xs font-mono text-muted uppercase">Learner Status</h4>
          <div class="inv-drawer-status-group mt-2">
            ${['unseen', 'learning', 'known', 'ignored'].map((st) => `
              <button type="button" class="tactile-btn tactile-btn-sm inv-drawer-state-btn ${item.state === st ? 'is-active tactile-btn-primary' : ''}" data-state="${st}">
                ${st.charAt(0).toUpperCase() + st.slice(1)}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="drawer-section mt-3" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <button type="button" class="tactile-btn tactile-btn-primary" id="btn-drawer-practice-word" style="flex: 1;">
            Practice this word
          </button>
          ${!item.is_mined ? `
            <button type="button" class="tactile-btn" id="btn-drawer-mine-card" style="flex: 1;">
              Mine as Anki card
            </button>
          ` : ''}
        </div>

        <!-- Collapsible Verb Conjugations & Formation Dropdown -->
        ${this.renderDrawerConjugationsSection(item)}

        <!-- Example Sentence & Translation -->
        <div class="drawer-section mt-4">
          <h4 class="text-xs font-mono text-muted uppercase">Example Sentence</h4>
          ${exampleJa ? `
            <div class="inv-drawer-example-box mt-1">
              <p class="inv-drawer-example-ja font-japanese">${escapeHtml(exampleJa)}</p>
              ${exampleEn ? `<p class="inv-drawer-example-en font-sans">${escapeHtml(exampleEn)}</p>` : ''}
            </div>
          ` : `
            <p class="text-xs font-sans text-muted mt-1">No example sentence available.</p>
          `}
        </div>

        <!-- Categories -->
        <div class="drawer-section mt-4">
          <h4 class="text-xs font-mono text-muted uppercase">Categories</h4>
          <div class="inv-drawer-categories mt-1">
            ${cats || '<span class="text-muted text-xs font-sans">No tags</span>'}
          </div>
        </div>

        <!-- Encounters -->
        <div class="drawer-section mt-4">
          <h4 class="text-xs font-mono text-muted uppercase">Encounter History</h4>
          <p class="text-xs font-sans text-secondary mt-1">
            Encountered <strong>${item.encounters_count}</strong> time(s).
            ${item.last_seen_at ? `<br>Last seen: ${escapeHtml(item.last_seen_at.slice(0, 10))}` : ''}
          </p>
        </div>
      </div>
    `;

    // Drawer state buttons
    body.querySelectorAll('.inv-drawer-state-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const newState = btn.dataset.state;
        await this.handleSingleStateChange(item.expression, newState);
      });
    });

    const btnPractice = document.getElementById('btn-drawer-practice-word');
    if (btnPractice) {
      btnPractice.addEventListener('click', () => {
        this.closeDrawer();
        this.router.navigateToTab('study', { query: `mode=vocab&words=${encodeURIComponent(item.expression)}` });
      });
    }

    const btnMine = document.getElementById('btn-drawer-mine-card');
    if (btnMine) {
      btnMine.addEventListener('click', async () => {
        btnMine.disabled = true;
        btnMine.textContent = 'Mining...';
        try {
          const targetDeck = await getUniversalAnkiDeck();
          if (!targetDeck) {
            throw new Error('No Anki deck selected. Please choose a deck in Settings.');
          }
          await apiClient.saveCard({
            expression: item.expression,
            reading: item.reading,
            meaning: item.meaning,
            source_type: 'vocab_inventory',
            deck_name: targetDeck
          });
          item.is_mined = true;
          this.renderDrawerBody(item);
          this.renderTableRows();
        } catch (err) {
          this.showError(`Mining failed: ${err.message}`);
          btnMine.disabled = false;
          btnMine.textContent = 'Mine as Anki card';
        }
      });
    }
  }

  updatePagination() {
    const elInfo = document.getElementById('inv-pagination-info');
    const btnPrev = document.getElementById('btn-inv-prev');
    const btnNext = document.getElementById('btn-inv-next');

    const total = this.totalItems;
    const start = total === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(this.currentPage * this.pageSize, total);

    if (elInfo) elInfo.textContent = `Showing ${start} - ${end} of ${total.toLocaleString()} words`;
    if (btnPrev) btnPrev.disabled = this.currentPage <= 1;
    if (btnNext) btnNext.disabled = end >= total;
  }

  showError(message) {
    this.lastError = message;
    const banner = document.getElementById('inv-error-banner');
    const text = document.getElementById('inv-error-text');
    if (banner && text) {
      text.textContent = message;
      banner.style.display = 'flex';
    }
  }

  // =========================================================================
  // Shelves Data & Rendering Pipeline
  // =========================================================================

  async loadShelvesData() {
    // Progressive / streaming shelf loader:
    // Render fast in-memory and lightweight hubs immediately as they resolve,
    // so user does not wait for all 6 network queries before seeing content.
    try {
      // 1. Fast hubs: Transitive Pairs, Keigo Hub, Gap Breakdown
      const pTransitive = apiClient.getTransitivePairs({
        level: this.transitiveLevelFilter !== 'all' ? this.transitiveLevelFilter : undefined,
        mastery: this.transitiveMasteryFilter !== 'all' ? this.transitiveMasteryFilter : undefined,
      }).then((res) => {
        if (res) {
          this.transitivePairs = res.pairs || [];
          this.transitiveSummary = res.summary || null;
          this.renderTransitivePairsHub();
        }
      }).catch((err) => console.debug('[VocabInventory] load transitive error:', err));

      const pKeigo = apiClient.getKeigo().then((res) => {
        if (res) {
          this.keigoItems = res.items || [];
          this.keigoSummary = res.summary || null;
          this.renderKeigoShelf();
        }
      }).catch((err) => console.debug('[VocabInventory] load keigo error:', err));

      const pGaps = apiClient.getGapBreakdown(this.learnerLevel, 150).then((res) => {
        if (res) {
          this.gapBreakdown = res;
          this.renderGapsShelf();
        }
      }).catch((err) => console.debug('[VocabInventory] load gaps error:', err));

      // 2. Lexical shelves: Adverbs, Onomatopoeia, Adjectives (cumulative N5..targetLvl)
      const targetLvl = this.learnerLevel || 'N4';
      const fetchShelfCategory = async (category) => {
        const pageSize = 500;
        const first = await apiClient.getVocabInventory({
          category,
          jlpt_level: targetLvl,
          cumulative: true,
          limit: pageSize,
          offset: 0,
          include_reference: true,
        });
        const items = Array.isArray(first?.items) ? [...first.items] : [];
        const total = typeof first?.total === 'number' ? first.total : items.length;
        let offset = items.length;
        while (offset < total && offset < 2500) {
          const next = await apiClient.getVocabInventory({
            category,
            jlpt_level: targetLvl,
            cumulative: true,
            limit: pageSize,
            offset,
            include_reference: true,
          });
          const batch = Array.isArray(next?.items) ? next.items : [];
          if (batch.length === 0) break;
          items.push(...batch);
          offset += batch.length;
        }
        return items;
      };

      const pAdverbs = fetchShelfCategory('adverb').then((advItems) => {
        this._cachedAdverbs = advItems;
        this.renderAdverbsShelf(advItems);
      }).catch((err) => {
        console.debug('[VocabInventory] load adverbs error:', err);
        this.renderAdverbsShelf([]);
      });

      const pOnom = fetchShelfCategory('onomatopoeia').then((onomItems) => {
        this._cachedOnomatopoeia = onomItems;
        this.renderOnomatopoeiaShelf(onomItems);
      }).catch((err) => {
        console.debug('[VocabInventory] load onomatopoeia error:', err);
        this.renderOnomatopoeiaShelf([]);
      });

      const pAdj = fetchShelfCategory('adjective').then((adjItems) => {
        this._cachedAdjectives = adjItems;
        this.renderAdjectivesShelf(adjItems);
      }).catch((err) => {
        console.debug('[VocabInventory] load adjectives error:', err);
        this.renderAdjectivesShelf([]);
      });

      const pVerbs = fetchShelfCategory('verb').then((verbItems) => {
        this._cachedVerbs = verbItems;
        this.renderVerbsShelf(verbItems);
      }).catch((err) => {
        console.debug('[VocabInventory] load verbs error:', err);
        this.renderVerbsShelf([]);
      });

      const pLoanwords = fetchShelfCategory('katakana_loanword').then((loanItems) => {
        this._cachedLoanwords = loanItems;
        this.renderLoanwordsShelf(loanItems);
      }).catch((err) => {
        console.debug('[VocabInventory] load loanwords error:', err);
        this.renderLoanwordsShelf([]);
      });

      // Wait for all in background without blocking incremental UI rendering
      await Promise.allSettled([pTransitive, pKeigo, pGaps, pAdverbs, pOnom, pAdj, pVerbs, pLoanwords]);
    } catch (err) {
      console.debug('[VocabInventory] loadShelvesData error:', err);
    }
  }

  reRenderShelf(shelfKey) {
    switch (shelfKey) {
      case 'transitive':
        this.renderTransitivePairsHub();
        break;
      case 'adverbs':
        this.renderAdverbsShelf();
        break;
      case 'onomatopoeia':
        this.renderOnomatopoeiaShelf();
        break;
      case 'adjectives':
        this.renderAdjectivesShelf();
        break;
      case 'verbs':
        this.renderVerbsShelf();
        break;
      case 'loanwords':
        this.renderLoanwordsShelf();
        break;
      case 'keigo':
        this.renderKeigoShelf();
        break;
      case 'gaps':
        this.renderGapsShelf();
        break;
    }
  }

  updateShelfPagination(footerId, shelfKey, currentLimit, totalCount) {
    const footer = document.getElementById(footerId);
    if (!footer) return;
    if (totalCount <= currentLimit) {
      footer.style.display = 'none';
      footer.innerHTML = '';
      return;
    }
    footer.style.display = 'flex';
    footer.innerHTML = `
      <div class="shelf-pagination-controls">
        <span class="text-xs text-muted font-sans">
          Showing <span class="font-mono text-warm font-bold">${Math.min(currentLimit, totalCount)}</span> of <span class="font-mono text-warm font-bold">${totalCount}</span>
        </span>
        <div class="shelf-pagination-actions">
          <button type="button" class="tactile-btn tactile-btn-sm btn-shelf-show-more font-sans" data-shelf="${shelfKey}">
            Show +30 more
          </button>
          <button type="button" class="tactile-btn tactile-btn-sm btn-shelf-show-all font-sans" data-shelf="${shelfKey}" data-total="${totalCount}">
            Show all (${totalCount})
          </button>
        </div>
      </div>
    `;
  }

  async refreshTransitivePairs() {
    try {
      const res = await apiClient.getTransitivePairs({
        level: this.transitiveLevelFilter !== 'all' ? this.transitiveLevelFilter : undefined,
        mastery: this.transitiveMasteryFilter !== 'all' ? this.transitiveMasteryFilter : undefined,
      });
      if (res) {
        this.transitivePairs = res.pairs || [];
        this.transitiveSummary = res.summary || null;
        this.renderTransitivePairsHub();
      }
    } catch (err) {
      console.debug('[VocabInventory] refreshTransitivePairs error:', err);
    }
  }

  /**
   * Condense verbose multi-sense JMdict glosses for clean shelf card scannability
   * while preserving the full gloss in hover tooltips and the detail drawer.
   */
  formatShelfMeaning(rawMeaning) {
    const text = String(rawMeaning || '').trim();
    if (!text) return '—';
    const parts = text
      .split(/\s*[;\/]\s*|\s+\d+\.\s+/)
      .map((s) => s.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean);
    const primary = parts.slice(0, 2).join('; ');
    return primary.length > 72 ? `${primary.slice(0, 69).trimEnd()}...` : primary;
  }

  renderTransitivePairsHub() {
    const grid = document.getElementById('transitive-pairs-grid');
    const badge = document.getElementById('transitive-pairs-count');
    if (!grid) return;

    const total = this.transitivePairs.length;
    const doneCount = this.transitivePairs.filter(
      (p) => p.pair_mastery === 'both_known' || p.pair_mastery === 'mastered'
    ).length;
    if (badge) {
      badge.textContent = `${doneCount} / ${total} done`;
      badge.title = `${doneCount} pairs mastered out of ${total} total (${this.learnerLevel || 'all'})`;
    }

    if (total === 0) {
      grid.innerHTML = `
        <div class="shelf-empty-state text-muted py-6 font-sans">
          <span>No transitive verb pairs match the selected level and mastery filters.</span>
        </div>
      `;
      this.updateShelfPagination('transitive-pagination', 'transitive', this.shelfLimits.transitive, 0);
      return;
    }

    const limit = this.shelfLimits.transitive;
    const slice = this.transitivePairs.slice(0, limit);

    grid.innerHTML = slice.map((pair) => {
      const vt = pair.transitive;
      const vi = pair.intransitive;
      const masteryLabel = pair.pair_mastery === 'both_known'
        ? 'Both Known'
        : pair.pair_mastery === 'half_known'
        ? 'Half Known'
        : pair.pair_mastery === 'learning'
        ? 'Learning'
        : 'Unseen';
      const masteryBadgeClass = `mastery-badge-${pair.pair_mastery || 'unseen'}`;

      return `
        <div class="transitive-pair-card tactile-card" data-pair-id="${escapeHtml(pair.id)}">
          <div class="pair-card-header">
            <div class="pair-card-title-group">
              <span class="pair-concept-label font-sans font-bold">${escapeHtml(pair.english_concept || 'Verb Pair')}</span>
              <span class="pair-pattern-chip font-mono">[${escapeHtml(pair.pattern)}]</span>
            </div>
            <div class="pair-header-tags">
              <span class="pair-level-badge font-mono">${escapeHtml(pair.level)}</span>
              <span class="pair-mastery-chip font-sans ${masteryBadgeClass}">${escapeHtml(masteryLabel)}</span>
            </div>
          </div>

          <div class="pair-split-columns">
            <!-- Transitive Half -->
            <div class="pair-half-card pair-transitive-side" data-expression="${escapeHtml(vt.expression)}" title="Click to inspect transitive verb">
              <div class="pair-particle-row">
                <span class="particle-badge particle-transitive font-japanese font-bold">[${escapeHtml(vt.particle || 'を')}]</span>
                <span class="pair-role-tag font-sans">Acts on object</span>
                <button type="button" class="half-state-pill inline-state-trigger state-pill-${vt.state || 'unseen'} font-mono" data-expression="${escapeHtml(vt.expression)}" data-state="${escapeHtml(vt.state || 'unseen')}" title="Click to change status">${escapeHtml(vt.state || 'unseen')}</button>
              </div>
              <div class="pair-word-row">
                <ruby class="pair-ruby font-japanese">
                  ${escapeHtml(vt.expression)}
                  <rt class="font-japanese">${escapeHtml(vt.reading || '')}</rt>
                </ruby>
              </div>
              <p class="pair-meaning-text font-sans">${escapeHtml(vt.meaning || '')}</p>
              ${vt.example_hint ? `<div class="pair-example-hint pair-example-transitive font-japanese"><span class="pair-hint-particle font-bold">${escapeHtml(vt.particle)}:</span> ${escapeHtml(vt.example_hint)}</div>` : ''}
            </div>

            <div class="pair-divider-vertical font-mono" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"/>
              </svg>
            </div>

            <!-- Intransitive Half -->
            <div class="pair-half-card pair-intransitive-side" data-expression="${escapeHtml(vi.expression)}" title="Click to inspect intransitive verb">
              <div class="pair-particle-row">
                <span class="particle-badge particle-intransitive font-japanese font-bold">[${escapeHtml(vi.particle || 'が')}]</span>
                <span class="pair-role-tag font-sans">Happens itself</span>
                <button type="button" class="half-state-pill inline-state-trigger state-pill-${vi.state || 'unseen'} font-mono" data-expression="${escapeHtml(vi.expression)}" data-state="${escapeHtml(vi.state || 'unseen')}" title="Click to change status">${escapeHtml(vi.state || 'unseen')}</button>
              </div>
              <div class="pair-word-row">
                <ruby class="pair-ruby font-japanese">
                  ${escapeHtml(vi.expression)}
                  <rt class="font-japanese">${escapeHtml(vi.reading || '')}</rt>
                </ruby>
              </div>
              <p class="pair-meaning-text font-sans">${escapeHtml(vi.meaning || '')}</p>
              ${vi.example_hint ? `<div class="pair-example-hint pair-example-intransitive font-japanese"><span class="pair-hint-particle font-bold">${escapeHtml(vi.particle)}:</span> ${escapeHtml(vi.example_hint)}</div>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach click events on pair half cards
    this.bindInlineStateTriggers(grid);
    grid.querySelectorAll('.pair-half-card').forEach((card) => {
      card.addEventListener('click', () => {
        const expr = card.dataset.expression;
        if (!expr) return;
        const item = this.items.find((x) => x.expression === expr) || {
          expression: expr,
          reading: card.querySelector('rt')?.textContent?.trim() || '',
          meaning: card.querySelector('.pair-meaning-text')?.textContent?.trim() || '',
          state: card.querySelector('.half-state-pill')?.textContent?.trim() || 'unseen',
          categories: ['verb'],
          encounters_count: 0
        };
        this.openDrawer(item);
      });
    });

    this.updateShelfPagination('transitive-pagination', 'transitive', limit, total);
  }

  renderAdverbsShelf(cachedItems = null) {
    const grid = document.getElementById('adverbs-shelf-grid');
    const badge = document.getElementById('adverbs-count');
    if (!grid) return;

    const source = cachedItems || this._cachedAdverbs || [];

    // Filter out pure onomatopoeia/mimetics to keep standard grammatical adverbs pure
    const standardAdverbs = source.filter((it) => {
      const cats = it.categories || [];
      const hasOnom = cats.some((c) => c.includes('onomatopoeia') || c.includes('mimetic') || c.includes('giongo') || c.includes('gitaigo'));
      return !hasOnom;
    });

    const DEGREE_KEYWORDS = ['degree', 'very', 'quite', 'rather', 'extremely', 'pretty', 'too', 'almost', 'mostly', '程度', 'とても', 'かなり', 'ちょっと', '少し', '非常に', '随分', 'もっと', 'ずっと', 'ほぼ', '大体', 'ほとんど', '結構'];
    const TIME_KEYWORDS = ['time', 'soon', 'already', 'recently', 'finally', 'eventually', 'before', 'ago', 'now', '時間', 'やっと', 'すぐに', 'もうすぐ', 'そろそろ', 'まもなく', 'いつか', '既に', '以前', '最近', 'この頃', '今後'];
    const FREQ_KEYWORDS = ['frequency', 'always', 'often', 'sometimes', 'seldom', 'never', 'usually', 'frequently', '頻度', 'いつも', 'たいてい', 'よく', 'ときどき', 'たまに', 'めったに', '決して', '常に', 'しばしば'];
    const MANNER_KEYWORDS = ['manner', 'clearly', 'firmly', 'slowly', 'properly', 'quietly', 'suddenly', '様態', 'しっかり', 'はっきり', 'ゆっくり', 'ちゃんと', 'じっくり', 'ぴったり', 'そっと', 'ぎゅっと', 'いきなり'];

    let filtered = standardAdverbs;
    if (this.adverbNuanceFilter === 'degree') {
      filtered = standardAdverbs.filter((it) => {
        const text = `${it.expression} ${it.reading} ${it.meaning} ${(it.categories || []).join(' ')}`.toLowerCase();
        return DEGREE_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
      });
    } else if (this.adverbNuanceFilter === 'time') {
      filtered = standardAdverbs.filter((it) => {
        const text = `${it.expression} ${it.reading} ${it.meaning} ${(it.categories || []).join(' ')}`.toLowerCase();
        return TIME_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
      });
    } else if (this.adverbNuanceFilter === 'frequency') {
      filtered = standardAdverbs.filter((it) => {
        const text = `${it.expression} ${it.reading} ${it.meaning} ${(it.categories || []).join(' ')}`.toLowerCase();
        return FREQ_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
      });
    } else if (this.adverbNuanceFilter === 'manner') {
      filtered = standardAdverbs.filter((it) => {
        const text = `${it.expression} ${it.reading} ${it.meaning} ${(it.categories || []).join(' ')}`.toLowerCase();
        return MANNER_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
      });
    }

    const total = filtered.length;
    const doneCount = filtered.filter((it) => it.state === 'known' || it.state === 'mastered').length;
    if (badge) {
      badge.textContent = `${doneCount} / ${total} done`;
      badge.title = `${doneCount} adverbs mastered out of ${total} total (${this.learnerLevel || 'all'})`;
    }

    if (total === 0) {
      grid.innerHTML = `
        <div class="shelf-empty-state text-muted py-6 font-sans">
          <span>No standard adverbs found for type "${escapeHtml(this.adverbNuanceFilter)}".</span>
        </div>
      `;
      this.updateShelfPagination('adverbs-pagination', 'adverbs', this.shelfLimits.adverbs, 0);
      return;
    }

    const limit = this.shelfLimits.adverbs;
    const slice = filtered.slice(0, limit);

    grid.innerHTML = slice.map((it) => {
      const stateClass = `state-pill-${it.state || 'unseen'}`;
      const shortMeaning = this.formatShelfMeaning(it.meaning);
      return `
        <div class="adverb-shelf-card tactile-card" data-expression="${escapeHtml(it.expression)}" title="${escapeHtml(it.meaning || '')}">
          <div class="adverb-card-header">
            ${this.renderRubyText(it.expression, it.reading, 'adverb-ruby font-japanese', 'font-japanese')}
            <button type="button" class="adverb-state-pill inline-state-trigger ${stateClass} font-mono" data-expression="${escapeHtml(it.expression)}" data-state="${escapeHtml(it.state || 'unseen')}" title="Click to change status">${escapeHtml(it.state || 'unseen')}</button>
          </div>
          <p class="adverb-card-meaning font-sans">${escapeHtml(shortMeaning)}</p>
          <div class="adverb-card-footer">
            <span class="adverb-level font-mono">${escapeHtml(it.jlpt_level || 'N/A')}</span>
            <span class="adverb-chip font-japanese">副詞</span>
          </div>
        </div>
      `;
    }).join('');

    this.bindInlineStateTriggers(grid);
    grid.querySelectorAll('.adverb-shelf-card').forEach((card) => {
      card.addEventListener('click', () => {
        const expr = card.dataset.expression;
        const item = filtered.find((x) => x.expression === expr);
        if (item) this.openDrawer(item);
      });
    });

    this.updateShelfPagination('adverbs-pagination', 'adverbs', limit, total);
  }

  renderOnomatopoeiaShelf(cachedItems = null) {
    const grid = document.getElementById('onomatopoeia-shelf-grid');
    const badge = document.getElementById('onomatopoeia-count');
    if (!grid) return;

    const source = cachedItems || this._cachedOnomatopoeia || [];

    const GIONGO_KW = ['sound', 'noise', 'clatter', 'bang', 'crash', 'rumble', 'drip', 'splash', '擬音', 'ざあざあ', 'ごろごろ', 'ばたん', 'がらがら', 'どかん', 'かちかち', 'どんどん', 'ガタガタ'];
    const GISEIGO_KW = ['voice', 'animal', 'bark', 'meow', 'laugh', 'cry', 'whisper', '擬声', 'わんわん', 'にゃあにゃあ', 'げらげら', 'くすくす', 'めそめそ', 'ぺちゃくちゃ', 'ペラペラ'];
    const GITAIGO_KW = ['state', 'condition', 'texture', 'manner', 'appearance', 'smooth', 'fluffy', 'shiny', 'sticky', '擬態', 'ふわふわ', 'ぴかぴか', 'ぎゅうぎゅう', 'べたべた', 'つるつる', 'さらさら', 'ぐっすり'];
    const EMOTION_KW = ['emotion', 'feeling', 'heart', 'nervous', 'excited', 'irritated', 'thrill', 'psychological', '感情', 'わくわく', 'どきどき', 'いらいら', 'うきうき', 'はらはら', 'ぞくぞく', 'そわそわ'];

    let filtered = source;
    if (this.onomatopoeiaNuanceFilter === 'giongo') {
      filtered = source.filter((it) => {
        const text = `${it.expression} ${it.reading} ${it.meaning} ${(it.categories || []).join(' ')}`.toLowerCase();
        return GIONGO_KW.some((kw) => text.includes(kw.toLowerCase()));
      });
    } else if (this.onomatopoeiaNuanceFilter === 'giseigo') {
      filtered = source.filter((it) => {
        const text = `${it.expression} ${it.reading} ${it.meaning} ${(it.categories || []).join(' ')}`.toLowerCase();
        return GISEIGO_KW.some((kw) => text.includes(kw.toLowerCase()));
      });
    } else if (this.onomatopoeiaNuanceFilter === 'gitaigo') {
      filtered = source.filter((it) => {
        const text = `${it.expression} ${it.reading} ${it.meaning} ${(it.categories || []).join(' ')}`.toLowerCase();
        return GITAIGO_KW.some((kw) => text.includes(kw.toLowerCase()));
      });
    } else if (this.onomatopoeiaNuanceFilter === 'emotion') {
      filtered = source.filter((it) => {
        const text = `${it.expression} ${it.reading} ${it.meaning} ${(it.categories || []).join(' ')}`.toLowerCase();
        return EMOTION_KW.some((kw) => text.includes(kw.toLowerCase()));
      });
    }

    const total = filtered.length;
    const doneCount = filtered.filter((it) => it.state === 'known' || it.state === 'mastered').length;
    if (badge) {
      badge.textContent = `${doneCount} / ${total} done`;
      badge.title = `${doneCount} adverbs mastered out of ${total} total (${this.learnerLevel || 'all'})`;
    }

    if (total === 0) {
      grid.innerHTML = `
        <div class="shelf-empty-state text-muted py-6 font-sans">
          <span>No onomatopoeic expressions found for nuance "${escapeHtml(this.onomatopoeiaNuanceFilter)}".</span>
        </div>
      `;
      this.updateShelfPagination('onomatopoeia-pagination', 'onomatopoeia', this.shelfLimits.onomatopoeia, 0);
      return;
    }

    const limit = this.shelfLimits.onomatopoeia;
    const slice = filtered.slice(0, limit);

    grid.innerHTML = slice.map((it) => {
      const stateClass = `state-pill-${it.state || 'unseen'}`;
      const shortMeaning = this.formatShelfMeaning(it.meaning);
      return `
        <div class="onomatopoeia-shelf-card tactile-card" data-expression="${escapeHtml(it.expression)}" title="${escapeHtml(it.meaning || '')}">
          <div class="adverb-card-header">
            ${this.renderRubyText(it.expression, it.reading, 'adverb-ruby font-japanese', 'font-japanese')}
            <button type="button" class="adverb-state-pill inline-state-trigger ${stateClass} font-mono" data-expression="${escapeHtml(it.expression)}" data-state="${escapeHtml(it.state || 'unseen')}" title="Click to change status">${escapeHtml(it.state || 'unseen')}</button>
          </div>
          <p class="adverb-card-meaning font-sans">${escapeHtml(shortMeaning)}</p>
          <div class="adverb-card-footer">
            <span class="adverb-level font-mono">${escapeHtml(it.jlpt_level || 'N/A')}</span>
            <span class="adverb-chip font-japanese">オノマトペ</span>
          </div>
        </div>
      `;
    }).join('');

    this.bindInlineStateTriggers(grid);
    grid.querySelectorAll('.onomatopoeia-shelf-card').forEach((card) => {
      card.addEventListener('click', () => {
        const expr = card.dataset.expression;
        const item = filtered.find((x) => x.expression === expr);
        if (item) this.openDrawer(item);
      });
    });

    this.updateShelfPagination('onomatopoeia-pagination', 'onomatopoeia', limit, total);
  }

  renderAdjectivesShelf(cachedItems = null) {
    const grid = document.getElementById('adjectives-shelf-grid');
    const badge = document.getElementById('adjectives-count');
    if (!grid) return;

    const source = cachedItems || this._cachedAdjectives || [];
    let filtered = source;

    if (this.adjectivesTab === 'i') {
      filtered = source.filter((it) => it.expression.endsWith('い') || (it.categories || []).some((c) => c.includes('adj-i') || c.includes('adjective_i')));
    } else if (this.adjectivesTab === 'na') {
      filtered = source.filter((it) => !it.expression.endsWith('い') || (it.categories || []).some((c) => c.includes('adj-na') || c.includes('adjective_na')));
    }

    const total = filtered.length;
    const doneCount = filtered.filter((it) => it.state === 'known' || it.state === 'mastered').length;
    if (badge) {
      badge.textContent = `${doneCount} / ${total} done`;
      badge.title = `${doneCount} adverbs mastered out of ${total} total (${this.learnerLevel || 'all'})`;
    }

    if (total === 0) {
      grid.innerHTML = `
        <div class="shelf-empty-state text-muted py-6 font-sans">
          <span>No adjectives found matching tab "${escapeHtml(this.adjectivesTab)}".</span>
        </div>
      `;
      this.updateShelfPagination('adjectives-pagination', 'adjectives', this.shelfLimits.adjectives, 0);
      return;
    }

    const limit = this.shelfLimits.adjectives;
    const slice = filtered.slice(0, limit);

    grid.innerHTML = slice.map((it) => {
      const cats = it.categories || [];
      const hasNaCat = cats.some((c) => c.includes('adj-na') || c.includes('adjective_na'));
      const hasICat = cats.some((c) => c.includes('adj-i') || c.includes('adjective_i'));
      const isIAdj = hasNaCat ? false : (hasICat || it.expression.endsWith('い'));
      const adjTypeBadge = isIAdj ? 'い-adj' : 'な-adj';
      const adjTypeClass = isIAdj ? 'adj-type-i' : 'adj-type-na';
      const adjShadowClass = isIAdj ? 'adj-is-i' : 'adj-is-na';
      const shortMeaning = this.formatShelfMeaning(it.meaning);

      return `
        <div class="adjective-shelf-card ${adjShadowClass} tactile-card" data-expression="${escapeHtml(it.expression)}" title="${escapeHtml(it.meaning || '')}">
          <div class="adj-card-header">
            ${this.renderRubyText(it.expression, it.reading, 'adj-ruby font-japanese', 'font-japanese')}
            <span class="adj-type-badge font-mono ${adjTypeClass}">${escapeHtml(adjTypeBadge)}</span>
          </div>
          <p class="adj-card-meaning font-sans">${escapeHtml(shortMeaning)}</p>
          <div class="adj-card-footer">
            <span class="adj-level font-mono">${escapeHtml(it.jlpt_level || 'N/A')}</span>
            <button type="button" class="adj-state inline-state-trigger font-mono state-pill-${it.state || 'unseen'}" data-expression="${escapeHtml(it.expression)}" data-state="${escapeHtml(it.state || 'unseen')}" title="Click to change status">${escapeHtml(it.state || 'unseen')}</button>
          </div>
        </div>
      `;
    }).join('');

    this.bindInlineStateTriggers(grid);
    grid.querySelectorAll('.adjective-shelf-card').forEach((card) => {
      card.addEventListener('click', () => {
        const expr = card.dataset.expression;
        const item = filtered.find((x) => x.expression === expr);
        if (item) this.openDrawer(item);
      });
    });

    this.updateShelfPagination('adjectives-pagination', 'adjectives', limit, total);
  }

  resolveVerbGroup(item) {
    const cats = (item.categories || []).map((c) => c.toLowerCase());
    if (cats.some((c) => c.includes('suru_verb') || c.includes('verb_kuru') || c.startsWith('vs') || c === 'vk')) {
      return 'group_3';
    }
    if (cats.some((c) => c.includes('verb_ichidan') || c === 'v1' || c === 'v1-s' || c.startsWith('v1:'))) {
      return 'group_2';
    }
    if (cats.some((c) => c.includes('verb_godan') || c === 'v5' || c.startsWith('v5'))) {
      return 'group_1';
    }
    const expr = item.expression || '';
    if (expr === 'する' || expr === '来る' || expr === 'くる' || expr.endsWith('する') || expr.endsWith('来る')) {
      return 'group_3';
    }
    return 'group_1';
  }

  renderVerbsShelf(cachedItems = null) {
    const grid = document.getElementById('verbs-shelf-grid');
    const badge = document.getElementById('verbs-count');
    if (!grid) return;

    const source = cachedItems || this._cachedVerbs || [];
    let filtered = source;
    if (this.verbsGroupFilter !== 'all') {
      filtered = source.filter((it) => this.resolveVerbGroup(it) === this.verbsGroupFilter);
    }

    const total = filtered.length;
    const doneCount = filtered.filter((it) => it.state === 'known' || it.state === 'mastered').length;
    if (badge) {
      badge.textContent = `${doneCount} / ${total} done`;
      badge.title = `${doneCount} verbs mastered out of ${total} total (${this.learnerLevel || 'all'})`;
    }

    if (total === 0) {
      grid.innerHTML = `
        <div class="shelf-empty-state text-muted py-6 font-sans">
          <span>No verbs found matching group "${escapeHtml(this.verbsGroupFilter)}".</span>
        </div>
      `;
      this.updateShelfPagination('verbs-pagination', 'verbs', this.shelfLimits.verbs, 0);
      return;
    }

    const limit = this.shelfLimits.verbs;
    const slice = filtered.slice(0, limit);

    const groupMeta = {
      group_1: { badge: 'G1', cls: 'verb-group-1', shadow: 'verb-is-g1' },
      group_2: { badge: 'G2', cls: 'verb-group-2', shadow: 'verb-is-g2' },
      group_3: { badge: 'G3', cls: 'verb-group-3', shadow: 'verb-is-g3' },
    };

    grid.innerHTML = slice.map((it) => {
      const grp = this.resolveVerbGroup(it);
      const meta = groupMeta[grp] || groupMeta.group_1;
      const shortMeaning = this.formatShelfMeaning(it.meaning);

      return `
        <div class="verb-shelf-card ${meta.shadow} tactile-card" data-expression="${escapeHtml(it.expression)}" title="${escapeHtml(it.meaning || '')}">
          <div class="adj-card-header">
            ${this.renderRubyText(it.expression, it.reading, 'adj-ruby font-japanese', 'font-japanese')}
            <span class="verb-group-badge font-mono ${meta.cls}">${escapeHtml(meta.badge)}</span>
          </div>
          <p class="adj-card-meaning font-sans">${escapeHtml(shortMeaning)}</p>
          <div class="adj-card-footer">
            <span class="adj-level font-mono">${escapeHtml(it.jlpt_level || 'N/A')}</span>
            <button type="button" class="adj-state inline-state-trigger font-mono state-pill-${it.state || 'unseen'}" data-expression="${escapeHtml(it.expression)}" data-state="${escapeHtml(it.state || 'unseen')}" title="Click to change status">${escapeHtml(it.state || 'unseen')}</button>
          </div>
        </div>
      `;
    }).join('');

    this.bindInlineStateTriggers(grid);
    grid.querySelectorAll('.verb-shelf-card').forEach((card) => {
      card.addEventListener('click', () => {
        const expr = card.dataset.expression;
        const item = filtered.find((x) => x.expression === expr);
        if (item) this.openDrawer(item);
      });
    });

    this.updateShelfPagination('verbs-pagination', 'verbs', limit, total);
  }

  renderLoanwordsShelf(cachedItems = null) {
    const grid = document.getElementById('loanwords-shelf-grid');
    const badge = document.getElementById('loanwords-count');
    if (!grid) return;

    const source = cachedItems || this._cachedLoanwords || [];
    let filtered = source;
    if (this.loanwordsStateFilter !== 'all') {
      filtered = source.filter((it) => (it.state || 'unseen') === this.loanwordsStateFilter);
    }

    const total = filtered.length;
    const doneCount = filtered.filter((it) => it.state === 'known' || it.state === 'mastered').length;
    if (badge) {
      badge.textContent = `${doneCount} / ${total} done`;
      badge.title = `${doneCount} loanwords mastered out of ${total} total (${this.learnerLevel || 'all'})`;
    }

    if (total === 0) {
      grid.innerHTML = `
        <div class="shelf-empty-state text-muted py-6 font-sans">
          <span>No loanwords found for status "${escapeHtml(this.loanwordsStateFilter)}".</span>
        </div>
      `;
      this.updateShelfPagination('loanwords-pagination', 'loanwords', this.shelfLimits.loanwords, 0);
      return;
    }

    const limit = this.shelfLimits.loanwords;
    const slice = filtered.slice(0, limit);

    grid.innerHTML = slice.map((it) => {
      const stateClass = `state-pill-${it.state || 'unseen'}`;
      const shortMeaning = this.formatShelfMeaning(it.meaning);
      return `
        <div class="loanword-shelf-card tactile-card" data-expression="${escapeHtml(it.expression)}" title="${escapeHtml(it.meaning || '')}">
          <div class="adverb-card-header">
            ${this.renderRubyText(it.expression, it.reading, 'adverb-ruby font-japanese', 'font-japanese')}
            <button type="button" class="adverb-state-pill inline-state-trigger ${stateClass} font-mono" data-expression="${escapeHtml(it.expression)}" data-state="${escapeHtml(it.state || 'unseen')}" title="Click to change status">${escapeHtml(it.state || 'unseen')}</button>
          </div>
          <p class="adverb-card-meaning font-sans">${escapeHtml(shortMeaning)}</p>
          <div class="adverb-card-footer">
            <span class="adverb-level font-mono">${escapeHtml(it.jlpt_level || 'N/A')}</span>
          </div>
        </div>
      `;
    }).join('');

    this.bindInlineStateTriggers(grid);
    grid.querySelectorAll('.loanword-shelf-card').forEach((card) => {
      card.addEventListener('click', () => {
        const expr = card.dataset.expression;
        const item = filtered.find((x) => x.expression === expr);
        if (item) this.openDrawer(item);
      });
    });

    this.updateShelfPagination('loanwords-pagination', 'loanwords', limit, total);
  }

  renderKeigoShelf() {
    const grid = document.getElementById('keigo-shelf-grid');
    const badge = document.getElementById('keigo-count');
    if (!grid) return;

    let items = this.keigoItems || [];
    if (this.keigoTypeFilter === 'sonkeigo') {
      items = (this.keigoItems || []).filter((it) => it.sonkeigo && it.sonkeigo.expression);
    } else if (this.keigoTypeFilter === 'kenjougo') {
      items = (this.keigoItems || []).filter((it) => it.kenjougo && it.kenjougo.expression);
    }

    const total = items.length;
    const doneCount = items.filter((it) => it.mastery_status === 'mastered').length;
    if (badge) {
      badge.textContent = `${doneCount} / ${total} done`;
      badge.title = `${doneCount} keigo forms mastered out of ${total} total (${this.learnerLevel || 'all'})`;
    }

    if (total === 0) {
      grid.innerHTML = `
        <div class="shelf-empty-state text-muted py-6 font-sans">
          <span>No Keigo honorific expressions found for filter "${escapeHtml(this.keigoTypeFilter)}".</span>
        </div>
      `;
      this.updateShelfPagination('keigo-pagination', 'keigo', this.shelfLimits.keigo, 0);
      return;
    }

    const limit = this.shelfLimits.keigo;
    const slice = items.slice(0, limit);

    grid.innerHTML = slice.map((trio) => {
      const son = trio.sonkeigo;
      const ken = trio.kenjougo;
      const tei = trio.teineigo;
      const masteryLabel = trio.mastery_status === 'mastered'
        ? 'Mastered'
        : trio.mastery_status === 'learning'
        ? 'Learning'
        : 'Unseen';
      const masteryBadgeClass = `mastery-badge-${trio.mastery_status || 'unseen'}`;

      return `
        <div class="keigo-trio-card tactile-card" data-keigo-id="${escapeHtml(trio.id)}">
          <div class="keigo-trio-header">
            <div class="keigo-trio-base-group">
              <span class="keigo-concept-title font-sans font-bold">${escapeHtml(trio.english_concept || 'Concept')}</span>
              <span class="keigo-base-verb font-japanese">Plain: ${escapeHtml(trio.base_verb)} (${escapeHtml(trio.base_reading)})</span>
            </div>
            <div class="keigo-header-tags">
              <span class="keigo-level-badge font-mono">${escapeHtml(trio.level || 'N4')}</span>
              <span class="keigo-mastery-chip font-sans ${masteryBadgeClass}">${escapeHtml(masteryLabel)}</span>
            </div>
          </div>

          <div class="keigo-forms-grid">
            <!-- Sonkeigo (Respectful) -->
            <div class="keigo-form-box keigo-sonkeigo-box" data-expression="${escapeHtml(son.expression)}" title="Click to inspect respectful form">
              <div class="keigo-form-top">
                <span class="keigo-type-badge keigo-badge-sonkeigo font-sans font-bold">Respectful</span>
                <button type="button" class="keigo-state-pill inline-state-trigger state-pill-${son.state || 'unseen'} font-mono" data-expression="${escapeHtml(son.expression)}" data-state="${escapeHtml(son.state || 'unseen')}" title="Click to change status">${escapeHtml(son.state || 'unseen')}</button>
              </div>
              <div class="keigo-expression-row">
                <ruby class="keigo-expression-ruby font-japanese">
                  ${escapeHtml(son.expression)}
                  <rt class="font-japanese">${escapeHtml(son.reading || '')}</rt>
                </ruby>
              </div>
              <p class="keigo-meaning-text font-sans">${escapeHtml(son.meaning || '')}</p>
              ${son.nuance ? `<div class="keigo-nuance-hint font-sans">${escapeHtml(son.nuance)}</div>` : ''}
              ${son.example_sentence ? `<div class="keigo-example-text keigo-example-sonkeigo font-japanese"><span class="keigo-example-label font-bold">例:</span> ${escapeHtml(son.example_sentence)}</div>` : ''}
            </div>

            <!-- Kenjougo (Humble) -->
            <div class="keigo-form-box keigo-kenjougo-box" data-expression="${escapeHtml(ken.expression)}" title="Click to inspect humble form">
              <div class="keigo-form-top">
                <span class="keigo-type-badge keigo-badge-kenjougo font-sans font-bold">Humble</span>
                <button type="button" class="keigo-state-pill inline-state-trigger state-pill-${ken.state || 'unseen'} font-mono" data-expression="${escapeHtml(ken.expression)}" data-state="${escapeHtml(ken.state || 'unseen')}" title="Click to change status">${escapeHtml(ken.state || 'unseen')}</button>
              </div>
              <div class="keigo-expression-row">
                <ruby class="keigo-expression-ruby font-japanese">
                  ${escapeHtml(ken.expression)}
                  <rt class="font-japanese">${escapeHtml(ken.reading || '')}</rt>
                </ruby>
              </div>
              <p class="keigo-meaning-text font-sans">${escapeHtml(ken.meaning || '')}</p>
              ${ken.nuance ? `<div class="keigo-nuance-hint font-sans">${escapeHtml(ken.nuance)}</div>` : ''}
              ${ken.example_sentence ? `<div class="keigo-example-text keigo-example-kenjougo font-japanese"><span class="keigo-example-label font-bold">例:</span> ${escapeHtml(ken.example_sentence)}</div>` : ''}
            </div>
          </div>

          ${tei ? `
            <div class="keigo-teineigo-bar">
              <span class="keigo-type-badge keigo-badge-teineigo font-sans">Polite</span>
              <span class="keigo-teineigo-word font-japanese font-bold">${escapeHtml(tei.expression)}</span>
              <span class="keigo-teineigo-meaning font-sans">— ${escapeHtml(tei.meaning || '')}</span>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    // Attach click events on Keigo form boxes
    this.bindInlineStateTriggers(grid);
    grid.querySelectorAll('.keigo-form-box').forEach((box) => {
      box.addEventListener('click', () => {
        const expr = box.dataset.expression;
        if (!expr) return;
        const item = this.items.find((x) => x.expression === expr) || {
          expression: expr,
          reading: box.querySelector('rt')?.textContent?.trim() || '',
          meaning: box.querySelector('.keigo-meaning-text')?.textContent?.trim() || '',
          state: box.querySelector('.keigo-state-pill')?.textContent?.trim() || 'unseen',
          categories: ['keigo', 'verb'],
          encounters_count: 0
        };
        this.openDrawer(item);
      });
    });

    this.updateShelfPagination('keigo-pagination', 'keigo', limit, total);
  }

  getVisibleGapWords() {
    if (!this.gapBreakdown?.breakdown) return [];
    const breakdown = this.gapBreakdown.breakdown;
    let list = [];
    if (this.gapCategoryFilter === 'all') {
      Object.values(breakdown).forEach((arr) => { list = list.concat(arr); });
    } else {
      list = breakdown[this.gapCategoryFilter] || [];
    }
    return list.map((g) => g.expression).filter(Boolean);
  }

  renderGapsShelf() {
    const grid = document.getElementById('gaps-shelf-grid');
    const badge = document.getElementById('gaps-breakdown-count');
    if (!grid || !this.gapBreakdown) return;

    // Sync filter pills visual active state
    const gapCatPills = this.container?.querySelectorAll('.filter-gap-cat');
    if (gapCatPills) {
      gapCatPills.forEach((p) => {
        p.classList.toggle('is-active', (p.dataset.cat || 'all') === this.gapCategoryFilter);
      });
    }

    const breakdown = this.gapBreakdown.breakdown || {};
    let items = [];
    if (this.gapCategoryFilter === 'all') {
      Object.values(breakdown).forEach((arr) => { items = items.concat(arr); });
    } else {
      items = breakdown[this.gapCategoryFilter] || [];
    }

    const total = items.length;
    const minedCount = items.filter((g) => this.miningGaps.has(g.expression)).length;
    if (badge) {
      badge.textContent = `${minedCount} / ${total} mined`;
      badge.title = `${minedCount} gap words mined to cards out of ${total} total (${this.learnerLevel || 'all'})`;
    }

    if (total === 0) {
      grid.innerHTML = `
        <div class="shelf-empty-state text-muted py-6 font-sans">
          <span>No unseen vocabulary gaps found for category "${escapeHtml(this.gapCategoryFilter)}". Great progress!</span>
        </div>
      `;
      this.updateShelfPagination('gaps-pagination', 'gaps', this.shelfLimits.gaps, 0);
      return;
    }

    const limit = this.shelfLimits.gaps;
    const slice = items.slice(0, limit);

    grid.innerHTML = slice.map((gap) => {
      const isMining = this.miningGaps.has(gap.expression);
      const shortMeaning = this.formatShelfMeaning(gap.meaning);
      return `
        <div class="gap-shelf-card tactile-card" data-expression="${escapeHtml(gap.expression)}" title="${escapeHtml(gap.meaning || '')}">
          <div class="gap-card-top">
            <ruby class="gap-ruby font-japanese">
              ${escapeHtml(gap.expression)}
              <rt class="font-japanese">${escapeHtml(gap.reading || '')}</rt>
            </ruby>
            <span class="gap-category-chip font-mono">${escapeHtml(gap.category || 'word')}</span>
          </div>
          <p class="gap-card-meaning font-sans">${escapeHtml(shortMeaning)}</p>
          <div class="gap-card-actions">
            <div class="gap-card-meta-left">
              <span class="gap-level-chip font-mono">${escapeHtml(gap.jlpt_level || this.learnerLevel)}</span>
              <button type="button" class="gap-state-pill inline-state-trigger state-pill-${gap.state || 'unseen'} font-mono" data-expression="${escapeHtml(gap.expression)}" data-state="${escapeHtml(gap.state || 'unseen')}" title="Click to change status">${escapeHtml(gap.state || 'unseen')}</button>
            </div>
            <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary btn-mine-gap font-sans" data-expression="${escapeHtml(gap.expression)}" data-reading="${escapeHtml(gap.reading || '')}" data-meaning="${escapeHtml(gap.meaning || '')}" ${isMining ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
              <span>${isMining ? 'Mined' : 'Mine Card'}</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.bindInlineStateTriggers(grid);
    grid.querySelectorAll('.btn-mine-gap').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const expr = btn.dataset.expression;
        const read = btn.dataset.reading;
        const mean = btn.dataset.meaning;
        await this.handleMineGapWord(expr, read, mean, btn);
      });
    });

    grid.querySelectorAll('.gap-shelf-card').forEach((card) => {
      card.addEventListener('click', () => {
        const expr = card.dataset.expression;
        const item = items.find((x) => x.expression === expr);
        if (item) {
          this.openDrawer({
            expression: item.expression,
            reading: item.reading,
            meaning: item.meaning,
            state: 'unseen',
            categories: [item.category],
            encounters_count: 0
          });
        }
      });
    });

    this.updateShelfPagination('gaps-pagination', 'gaps', limit, total);
  }

  async handleMineGapWord(expression, reading, meaning, btnEl) {
    if (!expression || this.miningGaps.has(expression)) return;
    this.miningGaps.add(expression);
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = `<span>Mining...</span>`;
    }

    try {
      const targetDeck = await getUniversalAnkiDeck();
      if (!targetDeck) {
        throw new Error('No Anki deck selected. Please choose a deck in Settings.');
      }
      await apiClient.saveCard({
        expression,
        reading,
        meaning,
        source_type: 'vocab_gap',
        deck_name: targetDeck,
      });
      if (btnEl) {
        btnEl.classList.remove('tactile-btn-primary');
        btnEl.innerHTML = `<span>Mined</span>`;
      }
      // Also register into local state
      await this.loadData();
    } catch (err) {
      this.miningGaps.delete(expression);
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = `<span>Mine Card</span>`;
      }
      this.showError(`Failed to mine gap card: ${err.message}`);
    }
  }

  getShelfReviewItems(shelfKey) {
    let raw = [];
    if (shelfKey === 'adverbs') {
      raw = (this._cachedAdverbs || []).filter((it) => {
        const cats = it.categories || [];
        return !cats.some((c) => c.includes('onomatopoeia') || c.includes('mimetic') || c.includes('giongo') || c.includes('gitaigo'));
      });
    } else if (shelfKey === 'onomatopoeia') {
      raw = this._cachedOnomatopoeia || [];
    } else if (shelfKey === 'adjectives') {
      const src = this._cachedAdjectives || [];
      if (this.adjectivesTab === 'i') {
        raw = src.filter((it) => it.expression.endsWith('い') || (it.categories || []).some((c) => c.includes('adj-i') || c.includes('adjective_i')));
      } else if (this.adjectivesTab === 'na') {
        raw = src.filter((it) => !it.expression.endsWith('い') || (it.categories || []).some((c) => c.includes('adj-na') || c.includes('adjective_na')));
      } else {
        raw = src;
      }
    } else if (shelfKey === 'verbs') {
      const src = this._cachedVerbs || [];
      raw = this.verbsGroupFilter === 'all' ? src : src.filter((it) => this.resolveVerbGroup(it) === this.verbsGroupFilter);
    } else if (shelfKey === 'loanwords') {
      const src = this._cachedLoanwords || [];
      raw = this.loanwordsStateFilter === 'all' ? src : src.filter((it) => (it.state || 'unseen') === this.loanwordsStateFilter);
    } else if (shelfKey === 'transitive-pairs') {
      (this.transitivePairs || []).forEach((pair) => {
        if (pair.transitive?.expression) {
          raw.push({ ...pair.transitive, categories: ['verb', 'verb_transitive'], example_hint: pair.transitive.example_hint || '' });
        }
        if (pair.intransitive?.expression) {
          raw.push({ ...pair.intransitive, categories: ['verb', 'verb_intransitive'], example_hint: pair.intransitive.example_hint || '' });
        }
      });
    } else if (shelfKey === 'keigo') {
      (this.keigoItems || []).forEach((trio) => {
        if (this.keigoTypeFilter !== 'kenjougo' && trio.sonkeigo?.expression) {
          raw.push({ ...trio.sonkeigo, meaning: trio.meaning || trio.sonkeigo.meaning || '', jlpt_level: trio.jlpt_level });
        }
        if (this.keigoTypeFilter !== 'sonkeigo' && trio.kenjougo?.expression) {
          raw.push({ ...trio.kenjougo, meaning: trio.meaning || trio.kenjougo.meaning || '', jlpt_level: trio.jlpt_level });
        }
      });
    } else if (shelfKey === 'jlpt-gaps') {
      const bd = this.gapBreakdown?.breakdown || {};
      if (this.gapCategoryFilter === 'all') {
        Object.values(bd).forEach((arr) => {
          if (Array.isArray(arr)) raw.push(...arr);
        });
      } else {
        raw = bd[this.gapCategoryFilter] || [];
      }
    }

    const nonKnown = raw.filter((it) => it.state !== 'known' && it.state !== 'mastered');
    return nonKnown.length > 0 ? nonKnown : raw;
  }

  startShelfReview(shelfKey) {
    const items = this.getShelfReviewItems(shelfKey);
    if (!items || items.length === 0) {
      this.showError('No words available to review in this shelf yet.');
      return;
    }

    const titleMap = {
      'transitive-pairs': 'Transitive & Intransitive Pairs',
      adverbs: 'Adverbs Shelf',
      onomatopoeia: 'Onomatopoeia & Mimetics',
      adjectives: 'Adjectives Showcase',
      verbs: 'Verbs by Group',
      loanwords: 'Loan Words (Katakana)',
      keigo: 'Keigo Honorifics',
      'jlpt-gaps': `JLPT Gaps (${this.learnerLevel || 'N3'})`,
    };

    this.shelfReviewSession = {
      shelfKey,
      title: titleMap[shelfKey] || 'Shelf Review',
      items,
      index: 0,
      revealed: false,
      knownCount: 0,
      ankiCount: 0,
      busy: false,
    };

    if (this._shelfReviewKeyHandler) {
      document.removeEventListener('keydown', this._shelfReviewKeyHandler);
    }
    this._shelfReviewKeyHandler = (e) => {
      if (!this.shelfReviewSession) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeShelfReview();
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!this.shelfReviewSession.revealed) {
          this.shelfReviewSession.revealed = true;
          this.renderShelfReviewModal();
        }
        return;
      }
      if (e.key === '1' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.handleShelfReviewAction('known');
      } else if (e.key === '2' || e.key.toLowerCase() === 'l') {
        e.preventDefault();
        this.handleShelfReviewAction('anki');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.handleShelfReviewAction('skip');
      }
    };
    document.addEventListener('keydown', this._shelfReviewKeyHandler);

    this.renderShelfReviewModal();
  }

  closeShelfReview() {
    this.shelfReviewSession = null;
    if (this._shelfReviewKeyHandler) {
      document.removeEventListener('keydown', this._shelfReviewKeyHandler);
      this._shelfReviewKeyHandler = null;
    }
    const overlay = document.getElementById('shelf-review-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.innerHTML = '';
    }
  }

  async handleShelfReviewAction(action) {
    const sess = this.shelfReviewSession;
    if (!sess || sess.busy) return;
    const item = sess.items[sess.index];
    if (!item) {
      this.closeShelfReview();
      return;
    }

    if (action === 'reveal') {
      sess.revealed = true;
      this.renderShelfReviewModal();
      return;
    }

    if (action === 'known') {
      sess.busy = true;
      this.renderShelfReviewModal();
      try {
        await this.handleSingleStateChange(item.expression, 'known');
        sess.knownCount += 1;
      } finally {
        sess.busy = false;
      }
    } else if (action === 'anki') {
      sess.busy = true;
      this.renderShelfReviewModal();
      try {
        await this.handleSingleStateChange(item.expression, 'learning');
        if (!item.is_mined) {
          const targetDeck = await getUniversalAnkiDeck();
          if (!targetDeck) {
            throw new Error('No Anki deck selected. Please choose a deck in Settings.');
          }
          await apiClient.saveCard({
            expression: item.expression,
            reading: item.reading || item.expression,
            meaning: item.meaning || '',
            source_type: 'vocab_shelf_review',
            deck_name: targetDeck,
          });
          item.is_mined = true;
        }
        sess.ankiCount += 1;
      } catch (err) {
        this.showError(`Failed to add to Anki: ${err.message}`);
      } finally {
        sess.busy = false;
      }
    }

    sess.index += 1;
    sess.revealed = false;
    this.renderShelfReviewModal();
  }

  renderShelfReviewModal() {
    const overlay = document.getElementById('shelf-review-overlay');
    const sess = this.shelfReviewSession;
    if (!overlay || !sess) return;

    overlay.style.display = 'flex';
    const total = sess.items.length;

    if (sess.index >= total) {
      overlay.innerHTML = `
        <div class="brutalist-card brutalist-card--finished">
          <div class="brutalist-card__header">
            <div class="brutalist-card__alert">SESSION FINISHED</div>
            <button type="button" class="brutalist-card__close-btn" id="btn-shelf-review-close" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="brutalist-card__body">
            <div class="brutalist-card__word">お疲れ様！</div>
            <div class="brutalist-card__message">
              Review complete! ${total} cards reviewed in ${escapeHtml(sess.title)}.
            </div>
            <div class="brutalist-card__stats">
              <div class="brutalist-stat-box">
                <span class="brutalist-stat-num">${sess.ankiCount}</span>
                <span class="brutalist-stat-label">Added to Anki</span>
              </div>
              <div class="brutalist-stat-box">
                <span class="brutalist-stat-num">${sess.knownCount}</span>
                <span class="brutalist-stat-label">Words Known</span>
              </div>
            </div>
          </div>
          <div class="brutalist-card__actions">
            <button type="button" class="brutalist-card__button brutalist-card__button--mine" id="btn-shelf-review-finish">
              Return to Shelves
            </button>
          </div>
        </div>
      `;
      document.getElementById('btn-shelf-review-close')?.addEventListener('click', () => this.closeShelfReview());
      document.getElementById('btn-shelf-review-finish')?.addEventListener('click', () => this.closeShelfReview());
      overlay.onclick = (e) => {
        if (e.target === overlay) this.closeShelfReview();
      };
      return;
    }

    const item = sess.items[sess.index];
    const exJa = item.example_sentence || item.example_hint || '';
    const exEn = item.example_translation || '';
    const levelLabel = item.jlpt_level ? ` • ${escapeHtml(item.jlpt_level)}` : '';

    overlay.innerHTML = `
      <div class="brutalist-card brutalist-card--wide">
        <div class="brutalist-card__header">
          <div class="brutalist-card__alert">${escapeHtml(sess.title)}${levelLabel}</div>
          <div class="brutalist-card__counter">${sess.index + 1} / ${total}</div>
          <button type="button" class="brutalist-card__close-btn" id="btn-shelf-review-close" aria-label="Close review" title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="brutalist-card__body">
          <div class="brutalist-card__word">${escapeHtml(item.expression)}</div>
          ${sess.revealed ? `
            ${item.reading && item.reading !== item.expression ? `<div class="brutalist-card__reading">${escapeHtml(item.reading)}</div>` : ''}
            <div class="brutalist-card__message">
              ${escapeHtml(item.meaning || 'No definition available')}
            </div>
            ${exJa ? `
              <div class="brutalist-card__context">
                <div class="context-caption">Example Context:</div>
                <div class="context-text">${escapeHtml(exJa)}</div>
                ${exEn ? `<div class="context-translation">${escapeHtml(exEn)}</div>` : ''}
              </div>
            ` : ''}
          ` : ''}
        </div>

        ${sess.revealed ? `
          <div class="brutalist-card__actions">
            <button type="button" class="brutalist-card__button brutalist-card__button--known" id="btn-shelf-review-known" ${sess.busy ? 'disabled' : ''}>
              Known (Dismiss)
            </button>
            <button type="button" class="brutalist-card__button brutalist-card__button--mine" id="btn-shelf-review-anki" ${sess.busy ? 'disabled' : ''}>
              Add to Anki (Learning)
            </button>
            <button type="button" class="brutalist-card__button" id="btn-shelf-review-skip" ${sess.busy ? 'disabled' : ''}>
              Skip
            </button>
          </div>
          <div class="brutalist-card__shortcuts">
            <span>[1 / K] Known</span> • <span>[2 / L] Add to Anki</span> • <span>[→] Skip</span> • <span>[Esc] Close</span>
          </div>
        ` : `
          <div class="brutalist-card__actions">
            <button type="button" class="brutalist-card__button brutalist-card__button--mine" id="btn-shelf-review-reveal">
              Show Meaning
            </button>
          </div>
        `}
      </div>
    `;

    document.getElementById('btn-shelf-review-close')?.addEventListener('click', () => this.closeShelfReview());
    document.getElementById('btn-shelf-review-reveal')?.addEventListener('click', () => this.handleShelfReviewAction('reveal'));
    document.getElementById('btn-shelf-review-known')?.addEventListener('click', () => this.handleShelfReviewAction('known'));
    document.getElementById('btn-shelf-review-anki')?.addEventListener('click', () => this.handleShelfReviewAction('anki'));
    document.getElementById('btn-shelf-review-skip')?.addEventListener('click', () => this.handleShelfReviewAction('skip'));
    overlay.onclick = (e) => {
      if (e.target === overlay) this.closeShelfReview();
    };
  }

  unmount() {
    this.closeShelfReview();
    this.closeInlineStateMenu();
    if (this._levelListener && typeof window !== 'undefined') {
      window.removeEventListener('kiroku:learner-level-changed', this._levelListener);
      this._levelListener = null;
    }
    if (this._authListener && typeof window !== 'undefined') {
      window.removeEventListener('kiroku:auth-changed', this._authListener);
      this._authListener = null;
    }
    if (this._dataChangeListener && typeof window !== 'undefined') {
      window.removeEventListener('kiroku:data-changed', this._dataChangeListener);
      this._dataChangeListener = null;
    }
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
  }
}
