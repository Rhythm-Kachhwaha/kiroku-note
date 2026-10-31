/**
 * Kiroku Note Desktop — Vocab History View Controller
 * Card inventory data grid, telemetry metric pods, bulk selection,
 * sync status troubleshooting, and slide-over card inspector drawer.
 */

import { apiClient } from '../services/api_client.js';

export class VocabHistoryView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.cards = [];
    this.selectedCard = null;
    this.selectedIds = new Set();
    this.filterStatus = 'all';
    this.searchQuery = '';
    this.currentPage = 1;
    this.pageSize = 20;
    this.totalCards = 0;
  }

  async mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
    await this.loadData();
  }

  render() {
    this.container.innerHTML = `
      <div class="history-view-wrapper">
        <div class="history-view-container">
          <!-- Page Header & Metrics Row -->
          <div class="history-header-section">
            <div class="history-title-row">
              <div class="history-title-group">
                <h1 class="history-page-title">Mined Cards & Inventory · 単語帳</h1>
                <p class="history-page-sub">Local SQLite storage with automatic AnkiConnect background synchronization.</p>
              </div>
              <div class="history-header-actions">
                <button class="tactile-btn tactile-btn-primary" id="btn-sync-all-pending">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
                  </svg>
                  <span>Sync Pending to Anki</span>
                </button>
                <button class="tactile-btn" id="btn-export-csv" title="Export cards collection">
                  <span>Export</span>
                </button>
              </div>
            </div>

            <!-- 5 Telemetry Metric Pods -->
            <div class="metrics-grid">
              <div class="metric-pod tactile-card">
                <span class="metric-label">TOTAL MINED</span>
                <span class="metric-value" id="metric-total">0</span>
              </div>
              <div class="metric-pod tactile-card">
                <span class="metric-label text-green">SYNCED TO ANKI</span>
                <span class="metric-value text-green" id="metric-synced">0</span>
              </div>
              <div class="metric-pod tactile-card">
                <span class="metric-label text-amber">PENDING SYNC</span>
                <span class="metric-value text-amber" id="metric-pending">0</span>
              </div>
              <div class="metric-pod tactile-card">
                <span class="metric-label text-red">FAILED SYNC</span>
                <span class="metric-value text-red" id="metric-failed">0</span>
              </div>
              <div class="metric-pod tactile-card">
                <span class="metric-label text-gold">TODAY'S MINED</span>
                <span class="metric-value text-gold" id="metric-today">0</span>
              </div>
            </div>
          </div>

          <!-- Toolbar: Search Filter & Status Tabs -->
          <div class="history-toolbar tactile-card">
            <div class="toolbar-search-wrap">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <input type="text" id="history-search-input" class="tactile-input" placeholder="Search expression, reading, or meaning (⌘F)..." />
            </div>

            <div class="toolbar-status-filter" role="radiogroup">
              <button class="filter-pill is-active" data-filter="all">All</button>
              <button class="filter-pill" data-filter="synced">Synced</button>
              <button class="filter-pill" data-filter="pending">Pending</button>
              <button class="filter-pill" data-filter="failed">Failed</button>
            </div>
          </div>

          <!-- Cards Inventory Data Grid Table -->
          <div class="history-table-container tactile-card">
            <table class="history-table" id="cards-table">
              <thead>
                <tr>
                  <th class="col-check"><input type="checkbox" id="check-select-all" /></th>
                  <th class="col-expression">Expression</th>
                  <th class="col-reading">Reading</th>
                  <th class="col-meaning">Meaning</th>
                  <th class="col-deck">Deck</th>
                  <th class="col-status">Sync Status</th>
                  <th class="col-actions"></th>
                </tr>
              </thead>
              <tbody id="cards-tbody">
                <tr>
                  <td colspan="7" class="text-center py-6 text-muted">Loading cards collection...</td>
                </tr>
              </tbody>
            </table>

            <!-- Pagination Bar -->
            <div class="history-pagination-row">
              <span class="pagination-info" id="pagination-info">Showing 0 of 0 cards</span>
              <div class="pagination-buttons">
                <button class="tactile-btn tactile-btn-sm" id="btn-page-prev" disabled>Previous</button>
                <button class="tactile-btn tactile-btn-sm" id="btn-page-next" disabled>Next</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Slide-Over Card Inspector Drawer -->
        <aside class="card-inspector-drawer" id="card-inspector" aria-hidden="true">
          <div class="drawer-header">
            <h3 class="drawer-title">Card Inspector</h3>
            <button class="drawer-close-btn" id="btn-close-drawer" aria-label="Close inspector">✕</button>
          </div>
          <div class="drawer-body" id="drawer-body"></div>
        </aside>
      </div>
    `;
  }

  setupEvents() {
    const searchInput = document.getElementById('history-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim().toLowerCase();
        this.renderTableRows();
      });
    }

    const filterPills = this.container.querySelectorAll('.filter-pill');
    filterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        filterPills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.filterStatus = pill.dataset.filter;
        this.renderTableRows();
      });
    });

    const btnSyncAll = document.getElementById('btn-sync-all-pending');
    if (btnSyncAll) {
      btnSyncAll.addEventListener('click', async () => {
        btnSyncAll.disabled = true;
        try {
          await apiClient.syncAllPendingCards();
          await this.loadData();
        } catch (err) {
          console.warn('[History] Sync failed:', err);
        } finally {
          btnSyncAll.disabled = false;
        }
      });
    }

    const btnCloseDrawer = document.getElementById('btn-close-drawer');
    if (btnCloseDrawer) {
      btnCloseDrawer.addEventListener('click', () => this.closeInspector());
    }
  }

  async loadData() {
    try {
      const [stats, cardsData] = await Promise.allSettled([
        apiClient.getCardStats(),
        apiClient.getCards({ limit: 100 })
      ]);

      if (stats.status === 'fulfilled' && stats.value) {
        this.updateMetrics(stats.value);
      }

      if (cardsData.status === 'fulfilled' && cardsData.value) {
        this.cards = Array.isArray(cardsData.value) ? cardsData.value : (cardsData.value.items || []);
        this.renderTableRows();
      }
    } catch (err) {
      console.warn('[History] Error loading data:', err);
    }
  }

  updateMetrics(stats) {
    const elTotal = document.getElementById('metric-total');
    const elSynced = document.getElementById('metric-synced');
    const elPending = document.getElementById('metric-pending');
    const elFailed = document.getElementById('metric-failed');
    const elToday = document.getElementById('metric-today');

    if (elTotal) elTotal.textContent = stats.total_cards || this.cards.length || 0;
    if (elSynced) elSynced.textContent = stats.synced_cards || 0;
    if (elPending) elPending.textContent = stats.pending_cards || 0;
    if (elFailed) elFailed.textContent = stats.failed_cards || 0;
    if (elToday) elToday.textContent = stats.today_cards || 0;
  }

  renderTableRows() {
    const tbody = document.getElementById('cards-tbody');
    if (!tbody) return;

    let filtered = this.cards;

    if (this.filterStatus !== 'all') {
      filtered = filtered.filter((c) => (c.status || 'synced').toLowerCase() === this.filterStatus);
    }

    if (this.searchQuery) {
      filtered = filtered.filter((c) =>
        (c.expression && c.expression.toLowerCase().includes(this.searchQuery)) ||
        (c.reading && c.reading.toLowerCase().includes(this.searchQuery)) ||
        (c.meaning && c.meaning.toLowerCase().includes(this.searchQuery))
      );
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-muted">No cards found matching your criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((card) => {
      const isSynced = card.status === 'synced' || card.anki_note_id;
      const statusClass = isSynced ? 'status-pill-synced' : 'status-pill-pending';
      const statusLabel = isSynced ? 'Synced' : 'Pending';

      return `
        <tr class="history-table-row" data-id="${card.id || ''}">
          <td class="col-check"><input type="checkbox" class="card-select-box" data-id="${card.id || ''}" /></td>
          <td class="col-expression font-bold text-warm-paper">${card.expression || ''}</td>
          <td class="col-reading text-secondary">${card.reading || ''}</td>
          <td class="col-meaning text-truncate">${card.meaning || ''}</td>
          <td class="col-deck font-mono text-sm">${card.deck || 'Japanese::Vocab'}</td>
          <td class="col-status">
            <span class="table-status-pill ${statusClass}">● ${statusLabel}</span>
          </td>
          <td class="col-actions">
            <button class="tactile-btn tactile-btn-sm btn-inspect-card" data-id="${card.id || ''}">Inspect</button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-inspect-card').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        const card = this.cards.find((c) => String(c.id) === String(id));
        if (card) this.openInspector(card);
      });
    });
  }

  openInspector(card) {
    this.selectedCard = card;
    const drawer = document.getElementById('card-inspector');
    const body = document.getElementById('drawer-body');
    if (!drawer || !body) return;

    body.innerHTML = `
      <div class="inspector-section">
        <ruby class="inspector-hero-expr">${card.expression}<rt>${card.reading || ''}</rt></ruby>
        <span class="pitch-accent-badge">${card.pitch || '[0] 平板'}</span>
      </div>

      <div class="inspector-field">
        <label>Meaning & Gloss</label>
        <p class="inspector-text">${card.meaning || 'No definition'}</p>
      </div>

      <div class="inspector-field">
        <label>Context Sentence</label>
        <p class="inspector-sentence-ja">${card.sentence || 'No context sentence'}</p>
        <p class="inspector-sentence-en text-muted">${card.sentence_translation || ''}</p>
      </div>

      <div class="inspector-field">
        <label>Anki Note ID</label>
        <p class="font-mono text-gold">${card.anki_note_id || 'Not synced yet'}</p>
      </div>

      <div class="inspector-actions">
        <button class="tactile-btn tactile-btn-primary" id="btn-drawer-sync">Sync to Anki</button>
        <button class="tactile-btn text-red" id="btn-drawer-delete">Delete Card</button>
      </div>
    `;

    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');

    const btnDelete = document.getElementById('btn-drawer-delete');
    if (btnDelete) {
      btnDelete.addEventListener('click', async () => {
        if (confirm(`Delete card "${card.expression}"?`)) {
          await apiClient.deleteCard(card.id);
          this.closeInspector();
          await this.loadData();
        }
      });
    }
  }

  closeInspector() {
    const drawer = document.getElementById('card-inspector');
    if (drawer) {
      drawer.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
    }
  }

  unmount() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
