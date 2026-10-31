/**
 * Kiroku Note Desktop — Vocab History View Controller
 * Card inventory data grid, telemetry metric pods, bulk selection,
 * sync status troubleshooting, server-side search & pagination, and slide-over card inspector drawer.
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
    this.isLoading = false;
    this.lastError = null;
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

          <!-- Error Alert Banner (visible on failure) -->
          <div class="history-error-banner" id="history-error-banner" style="display: none;" role="alert">
            <span class="error-msg" id="history-error-text">Failed to communicate with backend.</span>
            <button class="tactile-btn tactile-btn-sm" id="btn-history-retry">Retry</button>
          </div>

          <!-- Toolbar: Search Filter & Status Tabs -->
          <div class="history-toolbar tactile-card">
            <div class="toolbar-search-wrap">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 14z"/>
              </svg>
              <input type="text" id="history-search-input" class="tactile-input" placeholder="Search expression, reading, or meaning..." />
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
      let debounceTimer = null;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.searchQuery = e.target.value.trim();
          this.currentPage = 1;
          this.loadData();
        }, 250);
      });
    }

    const filterPills = this.container.querySelectorAll('.filter-pill');
    filterPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        filterPills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.filterStatus = pill.dataset.filter;
        this.currentPage = 1;
        this.loadData();
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
          this.showError(`Sync all failed: ${err.message}`);
        } finally {
          btnSyncAll.disabled = false;
        }
      });
    }

    const btnExport = document.getElementById('btn-export-csv');
    if (btnExport) {
      btnExport.addEventListener('click', async () => {
        try {
          const exportData = await apiClient.exportCards('csv');
          if (exportData) {
            const blob = new Blob([typeof exportData === 'string' ? exportData : JSON.stringify(exportData)], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `kiroku_cards_${Date.now()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }
        } catch (err) {
          this.showError(`Export failed: ${err.message}`);
        }
      });
    }

    const btnRetry = document.getElementById('btn-history-retry');
    if (btnRetry) {
      btnRetry.addEventListener('click', () => this.loadData());
    }

    const btnPrev = document.getElementById('btn-page-prev');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (this.currentPage > 1) {
          this.currentPage--;
          this.loadData();
        }
      });
    }

    const btnNext = document.getElementById('btn-page-next');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        const totalPages = Math.ceil(this.totalCards / this.pageSize) || 1;
        if (this.currentPage < totalPages) {
          this.currentPage++;
          this.loadData();
        }
      });
    }

    const checkAll = document.getElementById('check-select-all');
    if (checkAll) {
      checkAll.addEventListener('change', (e) => {
        const checked = e.target.checked;
        const boxes = this.container.querySelectorAll('.card-select-box');
        boxes.forEach((b) => {
          b.checked = checked;
          const id = b.dataset.id;
          if (checked && id) this.selectedIds.add(id);
          else if (!checked && id) this.selectedIds.delete(id);
        });
      });
    }

    const btnCloseDrawer = document.getElementById('btn-close-drawer');
    if (btnCloseDrawer) {
      btnCloseDrawer.addEventListener('click', () => this.closeInspector());
    }
  }

  showError(message) {
    this.lastError = message;
    const banner = document.getElementById('history-error-banner');
    const text = document.getElementById('history-error-text');
    if (banner && text) {
      text.textContent = message;
      banner.style.display = 'flex';
    }
  }

  hideError() {
    this.lastError = null;
    const banner = document.getElementById('history-error-banner');
    if (banner) {
      banner.style.display = 'none';
    }
  }

  async loadData() {
    this.isLoading = true;
    this.hideError();

    const tbody = document.getElementById('cards-tbody');
    if (tbody && this.cards.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-muted">Loading cards collection...</td></tr>`;
    }

    try {
      const offset = (this.currentPage - 1) * this.pageSize;
      const params = {
        limit: this.pageSize,
        offset: offset
      };

      if (this.searchQuery) {
        params.search = this.searchQuery;
      }

      if (this.filterStatus !== 'all') {
        params.sync_status = this.filterStatus;
      }

      const [statsRes, cardsRes] = await Promise.allSettled([
        apiClient.getCardStats(),
        apiClient.getCards(params)
      ]);

      if (statsRes.status === 'fulfilled' && statsRes.value) {
        this.updateMetrics(statsRes.value);
      }

      if (cardsRes.status === 'fulfilled' && cardsRes.value) {
        const val = cardsRes.value;
        this.cards = Array.isArray(val) ? val : (val.cards || val.items || []);
        this.totalCards = val.total !== undefined ? val.total : this.cards.length;
        this.renderTableRows();
        this.updatePagination();
      } else if (cardsRes.status === 'rejected') {
        throw cardsRes.reason;
      }
    } catch (err) {
      this.showError(`Error loading cards: ${err.message || 'Unknown network error'}`);
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-red">Failed to load cards collection. Check backend connection.</td></tr>`;
      }
    } finally {
      this.isLoading = false;
    }
  }

  updateMetrics(stats) {
    const elTotal = document.getElementById('metric-total');
    const elSynced = document.getElementById('metric-synced');
    const elPending = document.getElementById('metric-pending');
    const elFailed = document.getElementById('metric-failed');
    const elToday = document.getElementById('metric-today');

    if (elTotal) elTotal.textContent = stats.total ?? (stats.total_cards || this.totalCards || 0);
    if (elSynced) elSynced.textContent = stats.sync_ratio?.synced ?? (stats.synced_cards || 0);
    if (elPending) elPending.textContent = stats.sync_ratio?.pending ?? (stats.pending_cards || 0);
    if (elFailed) elFailed.textContent = stats.sync_ratio?.failed ?? (stats.failed_cards || 0);
    if (elToday) elToday.textContent = stats.timeframe?.today ?? (stats.today_cards || 0);
  }

  updatePagination() {
    const info = document.getElementById('pagination-info');
    const btnPrev = document.getElementById('btn-page-prev');
    const btnNext = document.getElementById('btn-page-next');

    const totalPages = Math.ceil(this.totalCards / this.pageSize) || 1;
    const start = this.totalCards === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(this.currentPage * this.pageSize, this.totalCards);

    if (info) {
      info.textContent = `Showing ${start}–${end} of ${this.totalCards} cards (Page ${this.currentPage} of ${totalPages})`;
    }

    if (btnPrev) btnPrev.disabled = this.currentPage <= 1;
    if (btnNext) btnNext.disabled = this.currentPage >= totalPages;
  }

  renderTableRows() {
    const tbody = document.getElementById('cards-tbody');
    if (!tbody) return;

    if (this.cards.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-muted">No cards found matching your criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = this.cards.map((card) => {
      const isSynced = card.sync_status === 'synced' || card.status === 'synced' || Boolean(card.anki_note_id);
      const isFailed = card.sync_status === 'failed' || card.status === 'failed';
      const statusClass = isSynced ? 'status-pill-synced' : isFailed ? 'status-pill-failed' : 'status-pill-pending';
      const statusLabel = isSynced ? 'Synced' : isFailed ? 'Failed' : 'Pending';

      return `
        <tr class="history-table-row" data-id="${card.id || ''}">
          <td class="col-check"><input type="checkbox" class="card-select-box" data-id="${card.id || ''}" ${this.selectedIds.has(String(card.id)) ? 'checked' : ''} /></td>
          <td class="col-expression font-bold text-warm-paper">${card.expression || ''}</td>
          <td class="col-reading text-secondary">${card.reading || ''}</td>
          <td class="col-meaning text-truncate">${card.meaning || ''}</td>
          <td class="col-deck font-mono text-sm">${card.deck_name || card.deck || 'Default'}</td>
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

    tbody.querySelectorAll('.card-select-box').forEach((box) => {
      box.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        if (e.target.checked && id) this.selectedIds.add(id);
        else if (id) this.selectedIds.delete(id);
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
        <ruby class="inspector-hero-expr">${card.expression || ''}<rt>${card.reading || ''}</rt></ruby>
        <span class="pitch-accent-badge">${card.pitch || '[0] 平板'}</span>
      </div>

      <div class="inspector-field">
        <label>Meaning & Gloss</label>
        <p class="inspector-text">${card.meaning || 'No definition'}</p>
      </div>

      <div class="inspector-field">
        <label>Context Sentence</label>
        <p class="inspector-sentence-ja">${card.example_sentence || card.sentence || 'No context sentence'}</p>
        <p class="inspector-sentence-en text-muted">${card.example_translation || card.sentence_translation || ''}</p>
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

    const btnSync = document.getElementById('btn-drawer-sync');
    if (btnSync) {
      btnSync.addEventListener('click', async () => {
        btnSync.disabled = true;
        try {
          await apiClient.syncCard(card.id);
          this.closeInspector();
          await this.loadData();
        } catch (err) {
          alert(`Sync failed: ${err.message}`);
        } finally {
          btnSync.disabled = false;
        }
      });
    }

    const btnDelete = document.getElementById('btn-drawer-delete');
    if (btnDelete) {
      btnDelete.addEventListener('click', async () => {
        if (confirm(`Delete card "${card.expression}"?`)) {
          try {
            await apiClient.deleteCard(card.id);
            this.closeInspector();
            await this.loadData();
          } catch (err) {
            alert(`Delete failed: ${err.message}`);
          }
        }
      });
    }
  }

  closeInspector() {
    this.selectedCard = null;
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
