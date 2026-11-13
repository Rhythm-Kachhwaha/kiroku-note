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

export class VocabInventoryComponent {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.items = [];
    this.totalItems = 0;
    this.countsByState = { total: 0, known: 0, learning: 0, unseen: 0, ignored: 0 };
    this.selectedExpressions = new Set();
    this.activeItem = null;

    // Filters
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
  }

  async mount(container) {
    this.container = container;
    this.learnerLevel = await getUniversalJlptLevel();
    this.render();
    this.setupEvents();
    await this.loadData();
  }

  render() {
    this.container.innerHTML = `
      <div class="vocab-inventory-view">
        <!-- Telemetry Metrics Bar -->
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
      btnRetry.addEventListener('click', () => this.loadData());
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

    if (elTotal) elTotal.textContent = (this.countsByState.total || 0).toLocaleString();
    if (elKnown) elKnown.textContent = (this.countsByState.known || 0).toLocaleString();
    if (elLearning) elLearning.textContent = (this.countsByState.learning || 0).toLocaleString();
    if (elUnseen) elUnseen.textContent = (this.countsByState.unseen || 0).toLocaleString();
    if (elFiltered) elFiltered.textContent = this.totalItems.toLocaleString();
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
}
