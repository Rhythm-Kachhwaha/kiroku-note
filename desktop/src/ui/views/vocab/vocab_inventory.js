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
import { getUniversalJlptLevel } from '../../utils/learner.js';
import { mountCounter } from '../../vendor/counter_bundle.js';

const INVENTORY_SUBVIEW_KEY = 'kiroku:vocab-inventory-subview';

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
    this.transitivePairs = [];
    this.transitiveSummary = null;
    this.transitiveLevelFilter = 'all';
    this.transitiveMasteryFilter = 'all';

    this.adverbNuanceFilter = 'all';
    this.adjectivesTab = 'all'; // 'all' | 'i' | 'na'

    this.gapBreakdown = null;
    this.gapCategoryFilter = 'all';
    this.miningGaps = new Set();

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

    this.restoreSubViewPreference();
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
    window.addEventListener('kiroku:learner-level-changed', this._levelListener);

    if (this.activeSubView === 'shelves') {
      await Promise.all([this.loadData(), this.loadShelvesData()]);
    } else {
      await this.loadData();
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="vocab-inventory-view">
        <!-- Sub-View Switcher (Shelves vs Full Table) -->
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
        </div>

        <!-- Telemetry Metrics Bar (Animated with Spring Counter) -->
        <div class="vocab-inventory-metrics metrics-grid">
          <div class="metric-pod tactile-card">
            <span class="metric-label">Total tracked</span>
            <span class="metric-value font-mono" id="inv-metric-total">0</span>
          </div>
          <div class="metric-pod tactile-card">
            <span class="metric-label text-green">Known words</span>
            <span class="metric-value text-green font-mono" id="inv-metric-known">0</span>
          </div>
          <div class="metric-pod tactile-card">
            <span class="metric-label text-amber">Learning</span>
            <span class="metric-value text-amber font-mono" id="inv-metric-learning">0</span>
          </div>
          <div class="metric-pod tactile-card">
            <span class="metric-label text-red">Unseen gaps</span>
            <span class="metric-value text-red font-mono" id="inv-metric-unseen">0</span>
          </div>
          <div class="metric-pod tactile-card">
            <span class="metric-label text-gold">Filtered total</span>
            <span class="metric-value text-gold font-mono" id="inv-metric-filtered">0</span>
          </div>
        </div>

        <!-- VIEW MODE 1: CURATED SHELVES CONTAINER -->
        <div class="inv-shelves-container" id="inv-shelves-container" style="${this.activeSubView === 'shelves' ? '' : 'display: none;'}">
          
          <!-- 1. Transitive <-> Intransitive Hub -->
          <section class="vocab-shelf-card tactile-card" id="shelf-transitive-pairs">
            <div class="shelf-header">
              <div class="shelf-title-group">
                <div class="shelf-title-row">
                  <h2 class="shelf-title font-sans font-bold">Transitive & Intransitive Verb Pairs</h2>
                  <span class="shelf-badge font-mono" id="transitive-pairs-count">0 pairs</span>
                </div>
                <p class="shelf-sub text-xs text-muted font-sans">
                  Learn paired verbs side by side. Transitive verbs act upon a direct object (<span class="font-japanese text-gold">を</span>), while intransitive verbs describe actions that occur independently (<span class="font-japanese text-green">が</span>).
                </p>
              </div>

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
            </div>

            <div class="transitive-pairs-grid" id="transitive-pairs-grid">
              <span class="text-xs text-muted py-4 font-sans">Loading transitive and intransitive verb pairs...</span>
            </div>
          </section>

          <!-- 2. Adverbs & Mimetics Shelf -->
          <section class="vocab-shelf-card tactile-card" id="shelf-adverbs-mimetics">
            <div class="shelf-header">
              <div class="shelf-title-group">
                <div class="shelf-title-row">
                  <h2 class="shelf-title font-sans font-bold">Adverbs & Mimetics (Onomatopoeia)</h2>
                  <span class="shelf-badge font-mono" id="adverbs-count">0 words</span>
                </div>
                <p class="shelf-sub text-xs text-muted font-sans">
                  Nuanced expressions classified by texture: Sound effects (擬音語), Human/animal voices (擬声語), Manner & states (擬態語), and Emotional sensations (心理・感覚).
                </p>
              </div>

              <div class="shelf-filters-row">
                <div class="shelf-filter-group" role="radiogroup" aria-label="Mimetic Nuance">
                  <button type="button" class="filter-pill filter-adverb-tab is-active" data-nuance="all">All Nuances</button>
                  <button type="button" class="filter-pill filter-adverb-tab" data-nuance="giongo">Sounds (擬音語)</button>
                  <button type="button" class="filter-pill filter-adverb-tab" data-nuance="giseigo">Voices (擬声語)</button>
                  <button type="button" class="filter-pill filter-adverb-tab" data-nuance="gitaigo">Manner (擬態語)</button>
                  <button type="button" class="filter-pill filter-adverb-tab" data-nuance="emotion">Emotions (感情)</button>
                </div>
              </div>
            </div>

            <div class="adverbs-shelf-grid" id="adverbs-shelf-grid">
              <span class="text-xs text-muted py-4 font-sans">Loading adverbs and mimetic expressions...</span>
            </div>
          </section>

          <!-- 3. Adjectives Shelf -->
          <section class="vocab-shelf-card tactile-card" id="shelf-adjectives">
            <div class="shelf-header">
              <div class="shelf-title-group">
                <div class="shelf-title-row">
                  <h2 class="shelf-title font-sans font-bold">Adjectives Showcase</h2>
                  <span class="shelf-badge font-mono" id="adjectives-count">0 words</span>
                </div>
                <p class="shelf-sub text-xs text-muted font-sans">
                  Essential descriptive Japanese: Inflecting <span class="font-japanese text-gold">い-形容詞</span> and nominal <span class="font-japanese text-green">な-形容詞</span> with connection patterns.
                </p>
              </div>

              <div class="shelf-filters-row">
                <div class="shelf-filter-group" role="radiogroup" aria-label="Adjective Type">
                  <button type="button" class="filter-pill filter-adj-tab is-active" data-tab="all">All Adjectives</button>
                  <button type="button" class="filter-pill filter-adj-tab" data-tab="i">i-Adjectives (~い)</button>
                  <button type="button" class="filter-pill filter-adj-tab" data-tab="na">na-Adjectives (~な)</button>
                </div>
              </div>
            </div>

            <div class="adjectives-shelf-grid" id="adjectives-shelf-grid">
              <span class="text-xs text-muted py-4 font-sans">Loading adjectives...</span>
            </div>
          </section>

          <!-- 4. JLPT Gaps Shelf -->
          <section class="vocab-shelf-card tactile-card" id="shelf-jlpt-gaps">
            <div class="shelf-header">
              <div class="shelf-title-group">
                <div class="shelf-title-row">
                  <h2 class="shelf-title font-sans font-bold">JLPT Level Gaps (${this.learnerLevel})</h2>
                  <span class="shelf-badge font-mono" id="gaps-breakdown-count">0 gaps</span>
                </div>
                <p class="shelf-sub text-xs text-muted font-sans">
                  Targeted vocabulary at or below your target level (<span class="font-mono text-gold">${this.learnerLevel}</span>) not yet in your inventory. Add to cards with one click.
                </p>
              </div>

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
            </div>

            <div class="gaps-shelf-grid" id="gaps-shelf-grid">
              <span class="text-xs text-muted py-4 font-sans">Loading categorized level gaps...</span>
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
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 14z"/>
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
          <div class="drawer-header">
            <h3 class="drawer-title font-sans font-bold">Word Inspector</h3>
            <button class="drawer-close-btn" id="btn-close-inv-drawer" aria-label="Close inspector">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
          <div class="drawer-body" id="inv-drawer-body"></div>
        </aside>
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

      if (mode === 'shelves') {
        await this.loadShelvesData();
      } else {
        await this.loadData();
      }
    };

    if (tabShelves) tabShelves.addEventListener('click', () => switchSubView('shelves'));
    if (tabTable) tabTable.addEventListener('click', () => switchSubView('table'));

    // Shelves: Transitive Level Pills
    const pairLevelPills = this.container.querySelectorAll('.filter-pair-level');
    pairLevelPills.forEach((pill) => {
      pill.addEventListener('click', async () => {
        pairLevelPills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.transitiveLevelFilter = pill.dataset.level || 'all';
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
        await this.refreshTransitivePairs();
      });
    });

    // Shelves: Adverb Nuance Tabs
    const adverbTabs = this.container.querySelectorAll('.filter-adverb-tab');
    adverbTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        adverbTabs.forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        this.adverbNuanceFilter = tab.dataset.nuance || 'all';
        this.renderAdverbsShelf();
      });
    });

    // Shelves: Adjectives Tabs
    const adjTabs = this.container.querySelectorAll('.filter-adj-tab');
    adjTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        adjTabs.forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        this.adjectivesTab = tab.dataset.tab || 'all';
        this.renderAdjectivesShelf();
      });
    });

    // Shelves: Gap Category Pills
    const gapCatPills = this.container.querySelectorAll('.filter-gap-cat');
    gapCatPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        gapCatPills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.gapCategoryFilter = pill.dataset.cat || 'all';
        this.renderGapsShelf();
      });
    });

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
            <ruby class="inv-ruby font-japanese">
              ${escapeHtml(item.expression)}
              <rt class="font-japanese text-muted">${escapeHtml(item.reading || '')}</rt>
            </ruby>
          </td>
          <td>
            <span class="inv-level-badge font-mono">${escapeHtml(lvlLabel)}</span>
          </td>
          <td class="inv-col-meaning font-sans text-secondary" title="${escapeHtml(item.meaning || '')}">
            ${escapeHtml(item.meaning || '—')}
          </td>
          <td>${cats || '<span class="text-muted">—</span>'}</td>
          <td>
            <button type="button" class="inv-state-pill-btn ${stateClass} font-mono" data-expression="${escapeHtml(item.expression)}" data-current-state="${escapeHtml(item.state || 'unseen')}" title="Click to cycle status">
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

    tbody.querySelectorAll('.inv-state-pill-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const expr = btn.dataset.expression;
        const cur = btn.dataset.currentState;
        const nextState = cur === 'known' ? 'learning' : cur === 'learning' ? 'ignored' : 'known';
        await this.handleSingleStateChange(expr, nextState);
      });
    });

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

  async handleSingleStateChange(expression, newState) {
    try {
      await apiClient.bulkSetWordStates([expression], newState);
      const item = this.items.find((x) => x.expression === expression);
      if (item) item.state = newState;
      this.renderTableRows();
      if (this.activeItem && this.activeItem.expression === expression) {
        this.activeItem.state = newState;
        this.renderDrawerBody(this.activeItem);
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

  openDrawer(item) {
    this.activeItem = item;
    const drawer = document.getElementById('inv-drawer');
    const backdrop = document.getElementById('inv-drawer-backdrop');
    if (drawer && backdrop) {
      this.renderDrawerBody(item);
      backdrop.style.display = 'block';
      drawer.classList.add('is-open');
      drawer.setAttribute('aria-hidden', 'false');
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

  renderDrawerBody(item) {
    const body = document.getElementById('inv-drawer-body');
    if (!body) return;

    const cats = (item.categories || []).map((c) => `<span class="inv-cat-chip font-mono">${escapeHtml(c)}</span>`).join(' ');

    body.innerHTML = `
      <div class="drawer-content-pane">
        <!-- Hero showcase -->
        <div class="inv-drawer-hero tactile-card">
          <ruby class="inv-drawer-expression font-display">
            ${escapeHtml(item.expression)}
            <rt class="font-japanese text-muted">${escapeHtml(item.reading || '')}</rt>
          </ruby>
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

        <!-- Categories -->
        <div class="drawer-section mt-4">
          <h4 class="text-xs font-mono text-muted uppercase">Categories</h4>
          <div class="inv-drawer-categories mt-1">
            ${cats || '<span class="text-muted text-xs font-sans">No tags</span>'}
          </div>
        </div>

        <!-- Status selector -->
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

        <!-- Encounters -->
        <div class="drawer-section mt-4">
          <h4 class="text-xs font-mono text-muted uppercase">Encounter History</h4>
          <p class="text-xs font-sans text-secondary mt-1">
            Encountered <strong>${item.encounters_count}</strong> time(s).
            ${item.last_seen_at ? `<br>Last seen: ${escapeHtml(item.last_seen_at.slice(0, 10))}` : ''}
          </p>
        </div>

        <!-- Action Buttons -->
        <div class="drawer-section mt-6" style="display: flex; flex-direction: column; gap: 0.5rem;">
          <button type="button" class="tactile-btn tactile-btn-primary" id="btn-drawer-practice-word">
            Practice this word
          </button>
          ${!item.is_mined ? `
            <button type="button" class="tactile-btn" id="btn-drawer-mine-card">
              Mine as Anki card
            </button>
          ` : ''}
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
          await apiClient.saveCard({
            expression: item.expression,
            reading: item.reading,
            meaning: item.meaning,
            source_type: 'vocab_inventory',
            deck_name: 'Default'
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
    try {
      const [pairsRes, gapsRes, adverbsRes, adjectivesRes] = await Promise.allSettled([
        apiClient.getTransitivePairs({
          level: this.transitiveLevelFilter !== 'all' ? this.transitiveLevelFilter : undefined,
          mastery: this.transitiveMasteryFilter !== 'all' ? this.transitiveMasteryFilter : undefined,
        }),
        apiClient.getGapBreakdown(this.learnerLevel),
        apiClient.getVocabInventory({ category: 'adverb', limit: 30, include_reference: true }),
        apiClient.getVocabInventory({ category: 'adjective', limit: 30, include_reference: true }),
      ]);

      if (pairsRes.status === 'fulfilled' && pairsRes.value) {
        this.transitivePairs = pairsRes.value.pairs || [];
        this.transitiveSummary = pairsRes.value.summary || null;
        this.renderTransitivePairsHub();
      }

      if (gapsRes.status === 'fulfilled' && gapsRes.value) {
        this.gapBreakdown = gapsRes.value;
        this.renderGapsShelf();
      }

      const advItems = adverbsRes.status === 'fulfilled' && adverbsRes.value ? (adverbsRes.value.items || []) : [];
      this._cachedAdverbs = advItems;
      this.renderAdverbsShelf(advItems);

      const adjItems = adjectivesRes.status === 'fulfilled' && adjectivesRes.value ? (adjectivesRes.value.items || []) : [];
      this._cachedAdjectives = adjItems;
      this.renderAdjectivesShelf(adjItems);
    } catch (err) {
      console.debug('[VocabInventory] loadShelvesData error:', err);
    }
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

  renderTransitivePairsHub() {
    const grid = document.getElementById('transitive-pairs-grid');
    const badge = document.getElementById('transitive-pairs-count');
    if (!grid) return;

    if (badge) {
      const total = this.transitivePairs.length;
      badge.textContent = `${total} pair${total === 1 ? '' : 's'}`;
    }

    if (this.transitivePairs.length === 0) {
      grid.innerHTML = `
        <div class="shelf-empty-state text-muted py-6 font-sans">
          <span>No transitive verb pairs match the selected level and mastery filters.</span>
        </div>
      `;
      return;
    }

    grid.innerHTML = this.transitivePairs.map((pair) => {
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
                <span class="particle-badge particle-transitive font-japanese font-bold">[${escapeHtml(vt.particle || 'を')}] 他動詞</span>
                <span class="half-state-pill state-pill-${vt.state || 'unseen'} font-mono">${escapeHtml(vt.state || 'unseen')}</span>
              </div>
              <div class="pair-word-row">
                <ruby class="pair-ruby font-japanese">
                  ${escapeHtml(vt.expression)}
                  <rt class="font-japanese text-muted">${escapeHtml(vt.reading || '')}</rt>
                </ruby>
              </div>
              <p class="pair-meaning-text font-sans text-secondary">${escapeHtml(vt.meaning || '')}</p>
              ${vt.example_hint ? `<div class="pair-example-hint font-japanese text-xs"><span class="text-gold font-bold">${escapeHtml(vt.particle)}:</span> ${escapeHtml(vt.example_hint)}</div>` : ''}
            </div>

            <div class="pair-divider-vertical font-mono text-muted" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"/>
              </svg>
            </div>

            <!-- Intransitive Half -->
            <div class="pair-half-card pair-intransitive-side" data-expression="${escapeHtml(vi.expression)}" title="Click to inspect intransitive verb">
              <div class="pair-particle-row">
                <span class="particle-badge particle-intransitive font-japanese font-bold">[${escapeHtml(vi.particle || 'が')}] 自動詞</span>
                <span class="half-state-pill state-pill-${vi.state || 'unseen'} font-mono">${escapeHtml(vi.state || 'unseen')}</span>
              </div>
              <div class="pair-word-row">
                <ruby class="pair-ruby font-japanese">
                  ${escapeHtml(vi.expression)}
                  <rt class="font-japanese text-muted">${escapeHtml(vi.reading || '')}</rt>
                </ruby>
              </div>
              <p class="pair-meaning-text font-sans text-secondary">${escapeHtml(vi.meaning || '')}</p>
              ${vi.example_hint ? `<div class="pair-example-hint font-japanese text-xs"><span class="text-green font-bold">${escapeHtml(vi.particle)}:</span> ${escapeHtml(vi.example_hint)}</div>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach click events on pair half cards
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
  }

  renderAdverbsShelf(cachedItems = null) {
    const grid = document.getElementById('adverbs-shelf-grid');
    const badge = document.getElementById('adverbs-count');
    if (!grid) return;

    const source = cachedItems || this._cachedAdverbs || [];
    let filtered = source;
    if (this.adverbNuanceFilter !== 'all') {
      const nuance = this.adverbNuanceFilter;
      filtered = source.filter((it) => {
        return (it.categories || []).some((c) => c.toLowerCase().includes(nuance)) ||
               (it.meaning || '').toLowerCase().includes(nuance);
      });
    }

    if (badge) {
      badge.textContent = `${filtered.length} word${filtered.length === 1 ? '' : 's'}`;
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="shelf-empty-state text-muted py-6 font-sans">
          <span>No adverbs or mimetics found for nuance "${escapeHtml(this.adverbNuanceFilter)}".</span>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.slice(0, 24).map((it) => {
      const stateClass = `state-pill-${it.state || 'unseen'}`;
      return `
        <div class="adverb-shelf-card tactile-card" data-expression="${escapeHtml(it.expression)}">
          <div class="adverb-card-header">
            <ruby class="adverb-ruby font-japanese">
              ${escapeHtml(it.expression)}
              <rt class="font-japanese text-muted">${escapeHtml(it.reading || '')}</rt>
            </ruby>
            <span class="adverb-state-pill ${stateClass} font-mono">${escapeHtml(it.state || 'unseen')}</span>
          </div>
          <p class="adverb-card-meaning font-sans text-secondary">${escapeHtml(it.meaning || '—')}</p>
          <div class="adverb-card-footer">
            <span class="adverb-level font-mono">${escapeHtml(it.jlpt_level || 'N/A')}</span>
            <span class="adverb-chip font-mono">adv / on-mim</span>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.adverb-shelf-card').forEach((card) => {
      card.addEventListener('click', () => {
        const expr = card.dataset.expression;
        const item = filtered.find((x) => x.expression === expr);
        if (item) this.openDrawer(item);
      });
    });
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

    if (badge) {
      badge.textContent = `${filtered.length} word${filtered.length === 1 ? '' : 's'}`;
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="shelf-empty-state text-muted py-6 font-sans">
          <span>No adjectives found matching tab "${escapeHtml(this.adjectivesTab)}".</span>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.slice(0, 24).map((it) => {
      const isIAdj = it.expression.endsWith('い');
      const adjTypeBadge = isIAdj ? 'i-adjective (~い)' : 'na-adjective (~な)';
      const adjTypeClass = isIAdj ? 'adj-type-i' : 'adj-type-na';

      return `
        <div class="adjective-shelf-card tactile-card" data-expression="${escapeHtml(it.expression)}">
          <div class="adj-card-header">
            <ruby class="adj-ruby font-japanese">
              ${escapeHtml(it.expression)}
              <rt class="font-japanese text-muted">${escapeHtml(it.reading || '')}</rt>
            </ruby>
            <span class="adj-type-badge font-sans ${adjTypeClass}">${escapeHtml(adjTypeBadge)}</span>
          </div>
          <p class="adj-card-meaning font-sans text-secondary">${escapeHtml(it.meaning || '—')}</p>
          <div class="adj-card-footer">
            <span class="adj-level font-mono">${escapeHtml(it.jlpt_level || 'N/A')}</span>
            <span class="adj-state font-mono state-pill-${it.state || 'unseen'}">${escapeHtml(it.state || 'unseen')}</span>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.adjective-shelf-card').forEach((card) => {
      card.addEventListener('click', () => {
        const expr = card.dataset.expression;
        const item = filtered.find((x) => x.expression === expr);
        if (item) this.openDrawer(item);
      });
    });
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

    const breakdown = this.gapBreakdown.breakdown || {};
    let items = [];
    if (this.gapCategoryFilter === 'all') {
      Object.values(breakdown).forEach((arr) => { items = items.concat(arr); });
    } else {
      items = breakdown[this.gapCategoryFilter] || [];
    }

    if (badge) {
      const total = items.length;
      badge.textContent = `${total} gap${total === 1 ? '' : 's'}`;
    }

    if (items.length === 0) {
      grid.innerHTML = `
        <div class="shelf-empty-state text-muted py-6 font-sans">
          <span>No unseen vocabulary gaps found for category "${escapeHtml(this.gapCategoryFilter)}". Great progress!</span>
        </div>
      `;
      return;
    }

    grid.innerHTML = items.slice(0, 30).map((gap) => {
      const isMining = this.miningGaps.has(gap.expression);
      return `
        <div class="gap-shelf-card tactile-card" data-expression="${escapeHtml(gap.expression)}">
          <div class="gap-card-top">
            <ruby class="gap-ruby font-japanese">
              ${escapeHtml(gap.expression)}
              <rt class="font-japanese text-muted">${escapeHtml(gap.reading || '')}</rt>
            </ruby>
            <span class="gap-category-chip font-mono">${escapeHtml(gap.category || 'word')}</span>
          </div>
          <p class="gap-card-meaning font-sans text-secondary">${escapeHtml(gap.meaning || '—')}</p>
          <div class="gap-card-actions">
            <span class="gap-level-chip font-mono">${escapeHtml(gap.jlpt_level || this.learnerLevel)}</span>
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
  }

  async handleMineGapWord(expression, reading, meaning, btnEl) {
    if (!expression || this.miningGaps.has(expression)) return;
    this.miningGaps.add(expression);
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = `<span>Mining...</span>`;
    }

    try {
      await apiClient.saveCard({
        expression,
        reading,
        meaning,
        source_type: 'vocab_gap',
        deck_name: 'Default',
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
}
