/**
 * Review Settings Modal
 * Plain-English configuration of Anki / FSRS parameters.
 */

export class ReviewSettingsModal {
  constructor({
    currentDeck = 'Default',
    availableDecks = ['Default'],
    buriedCount = 0,
    values = {},
    explanations = {},
    onSave = null,
    onClose = null,
    onDeckChange = null,
    onCreateDeck = null,
    onUnbury = null,
    onSyncAnki = null
  } = {}) {
    this.currentDeck = currentDeck;
    this.availableDecks = availableDecks.length ? availableDecks : ['Default'];
    this.buriedCount = buriedCount;
    this.onDeckChange = onDeckChange;
    this.onCreateDeck = onCreateDeck;
    this.onUnbury = onUnbury;
    this.onSyncAnki = onSyncAnki;
    this.values = {
      new_cards_per_day: 20,
      max_reviews_per_day: 200,
      desired_retention: 0.90,
      easy_initial_cap_days: 6,
      max_interval_days: 365,
      auto_sync_anki: 1,
      ...values
    };
    this.explanations = {
      new_cards_per_day: 'How many brand new words to learn each day. Lower this if your daily reviews feel heavy.',
      max_reviews_per_day: 'The ceiling on how many review cards Kiroku will show you in a single day.',
      desired_retention: 'The percentage of cards you want to successfully recall (default: 90%). Higher = shorter intervals; lower = fewer reviews.',
      easy_initial_cap_days: 'Caps the initial interval for new cards marked Easy (default: 6 days). Prevents unmastered words from vanishing for a month. Once graduated, intervals grow exponentially.',
      max_interval_days: 'The maximum number of days a card can be scheduled into the future (default: 365 days).',
      auto_sync_anki: 'Automatically import existing Anki cards on launch and push reviews to Anki.',
      ...explanations
    };
    this.onSave = onSave;
    this.onClose = onClose;
    this.element = null;
  }

  render() {
    const v = this.values;
    const exp = this.explanations;
    return `
      <div class="kiroku-modal-scrim" id="review-settings-modal">
        <div class="review-settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div class="review-settings-header">
            <h2 class="settings-title" id="settings-title">Review & Algorithm Settings</h2>
            <button class="settings-close-btn" type="button" aria-label="Close settings">&times;</button>
          </div>

          <div class="review-settings-body">
            <div class="setting-item deck-select-item">
              <div class="setting-label-row">
                <label for="setting-deck-select">Active Deck</label>
                <div class="deck-select-controls">
                  <select id="setting-deck-select" class="setting-select font-mono">
                    ${this.availableDecks.map(d => `<option value="${d}" ${d === this.currentDeck ? 'selected' : ''}>${d}</option>`).join('')}
                  </select>
                  <button type="button" class="settings-action-btn font-mono" id="btn-create-deck-trigger">+ Create Deck</button>
                </div>
              </div>
              <div class="create-deck-inline-row" id="create-deck-inline-row" style="display: none;">
                <input type="text" id="new-deck-name-input" placeholder="New deck name..." class="setting-input-text font-mono" />
                <button type="button" class="settings-btn settings-btn-save font-mono" id="btn-confirm-create-deck">Create</button>
              </div>
            </div>

            <div class="setting-item deck-quick-actions">
              <div class="setting-label-row">
                <label>Deck Operations</label>
                <div class="deck-quick-btn-group">
                  <button type="button" class="settings-action-btn font-mono" id="btn-modal-unbury" title="Unbury cards for this deck">
                    <span>Unbury Cards</span>
                    <span class="badge-count font-mono" id="modal-unbury-badge">${this.buriedCount || 0}</span>
                  </button>
                  <button type="button" class="settings-action-btn font-mono" id="btn-modal-sync-anki" title="Sync with Anki">
                    <span>Sync with Anki</span>
                  </button>
                </div>
              </div>
              <div class="settings-sync-status font-mono" id="modal-sync-status" style="display: none;"></div>
            </div>

            <div class="setting-item">
              <div class="setting-label-row">
                <label for="setting-new-cards">New Cards Per Day</label>
                <input type="number" id="setting-new-cards" name="new_cards_per_day" value="${v.new_cards_per_day}" min="1" max="200" class="setting-input" />
              </div>
              <p class="setting-desc">${exp.new_cards_per_day || ''}</p>
            </div>

            <div class="setting-item">
              <div class="setting-label-row">
                <label for="setting-max-reviews">Maximum Reviews Per Day</label>
                <input type="number" id="setting-max-reviews" name="max_reviews_per_day" value="${v.max_reviews_per_day}" min="5" max="2000" class="setting-input" />
              </div>
              <p class="setting-desc">${exp.max_reviews_per_day || ''}</p>
            </div>

            <div class="setting-item">
              <div class="setting-label-row">
                <label for="setting-retention">Target Retention Rate</label>
                <div class="setting-range-wrap">
                  <input type="range" id="setting-retention-range" min="70" max="98" value="${Math.round((v.desired_retention || 0.9) * 100)}" class="setting-range" />
                  <span id="retention-val" class="range-val-badge">${Math.round((v.desired_retention || 0.9) * 100)}%</span>
                </div>
              </div>
              <p class="setting-desc">${exp.desired_retention || ''}</p>
            </div>

            <div class="setting-item">
              <div class="setting-label-row">
                <label for="setting-easy-cap">Initial Easy Cap (Days)</label>
                <input type="number" id="setting-easy-cap" name="easy_initial_cap_days" value="${v.easy_initial_cap_days}" min="1" max="30" class="setting-input" />
              </div>
              <p class="setting-desc">${exp.easy_initial_cap_days || ''}</p>
            </div>

            <div class="setting-item">
              <div class="setting-label-row">
                <label for="setting-max-interval">Maximum Interval (Days)</label>
                <input type="number" id="setting-max-interval" name="max_interval_days" value="${v.max_interval_days}" min="30" max="3650" class="setting-input" />
              </div>
              <p class="setting-desc">${exp.max_interval_days || ''}</p>
            </div>

            <div class="setting-item">
              <div class="setting-label-row">
                <label for="setting-auto-sync">Auto-Sync with Anki</label>
                <input type="checkbox" id="setting-auto-sync" name="auto_sync_anki" ${v.auto_sync_anki ? 'checked' : ''} class="setting-checkbox" />
              </div>
              <p class="setting-desc">${exp.auto_sync_anki || ''}</p>
            </div>
          </div>

          <div class="review-settings-footer">
            <button class="settings-btn settings-btn-cancel" type="button">Cancel</button>
            <button class="settings-btn settings-btn-save" type="button">Save Settings</button>
          </div>
        </div>
      </div>
    `.trim();
  }

  mount(parent = document.body) {
    if (typeof document === 'undefined') return;
    this.close();

    const wrapper = document.createElement('div');
    wrapper.innerHTML = this.render();
    this.element = wrapper.firstElementChild;
    parent.appendChild(this.element);

    // Wire events
    const range = this.element.querySelector('#setting-retention-range');
    const badge = this.element.querySelector('#retention-val');
    if (range && badge) {
      range.addEventListener('input', () => {
        badge.textContent = `${range.value}%`;
      });
    }

    // Deck switching
    const deckSelect = this.element.querySelector('#setting-deck-select');
    if (deckSelect) {
      deckSelect.addEventListener('change', async (e) => {
        this.currentDeck = e.target.value;
        if (this.onDeckChange) {
          const res = await this.onDeckChange(this.currentDeck);
          if (res && res.values) {
            this.values = { ...this.values, ...res.values };
            const nInput = this.element.querySelector('#setting-new-cards');
            const rInput = this.element.querySelector('#setting-max-reviews');
            const capInput = this.element.querySelector('#setting-easy-cap');
            const ivlInput = this.element.querySelector('#setting-max-interval');
            const syncInput = this.element.querySelector('#setting-auto-sync');
            if (nInput) nInput.value = this.values.new_cards_per_day;
            if (rInput) rInput.value = this.values.max_reviews_per_day;
            if (range) range.value = Math.round((this.values.desired_retention || 0.9) * 100);
            if (badge) badge.textContent = `${Math.round((this.values.desired_retention || 0.9) * 100)}%`;
            if (capInput) capInput.value = this.values.easy_initial_cap_days;
            if (ivlInput) ivlInput.value = this.values.max_interval_days;
            if (syncInput) syncInput.checked = Boolean(this.values.auto_sync_anki);
            if (typeof res.buriedCount === 'number') {
              const bBadge = this.element.querySelector('#modal-unbury-badge');
              if (bBadge) bBadge.textContent = String(res.buriedCount);
            }
          }
        }
      });
    }

    // Inline Create Deck Toggle & Action
    const triggerBtn = this.element.querySelector('#btn-create-deck-trigger');
    const createRow = this.element.querySelector('#create-deck-inline-row');
    const createInput = this.element.querySelector('#new-deck-name-input');
    const confirmCreateBtn = this.element.querySelector('#btn-confirm-create-deck');

    if (triggerBtn && createRow) {
      triggerBtn.addEventListener('click', () => {
        const isHidden = createRow.style.display === 'none';
        createRow.style.display = isHidden ? 'flex' : 'none';
        if (isHidden && createInput) {
          createInput.focus();
        }
      });
    }

    if (confirmCreateBtn && createInput) {
      createInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmCreateBtn.click();
        }
      });

      confirmCreateBtn.addEventListener('click', async () => {
        const name = createInput.value.trim();
        if (!name) return;
        if (this.onCreateDeck) {
          await this.onCreateDeck(name);
        }
        if (deckSelect) {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          opt.selected = true;
          deckSelect.appendChild(opt);
          deckSelect.dispatchEvent(new Event('change'));
        }
        createInput.value = '';
        createRow.style.display = 'none';
      });
    }

    // Unbury Action
    const unburyBtn = this.element.querySelector('#btn-modal-unbury');
    const syncStatusEl = this.element.querySelector('#modal-sync-status');
    if (unburyBtn) {
      unburyBtn.addEventListener('click', async () => {
        if (this.onUnbury) {
          const res = await this.onUnbury(this.currentDeck);
          const badgeEl = this.element.querySelector('#modal-unbury-badge');
          if (badgeEl) badgeEl.textContent = '0';
          if (syncStatusEl) {
            const count = res?.unburied_count ?? 0;
            syncStatusEl.textContent = `Unburied ${count} cards.`;
            syncStatusEl.style.display = 'block';
            setTimeout(() => { syncStatusEl.style.display = 'none'; }, 2500);
          }
        }
      });
    }

    // Sync Anki Action
    const syncAnkiBtn = this.element.querySelector('#btn-modal-sync-anki');
    if (syncAnkiBtn) {
      syncAnkiBtn.addEventListener('click', async () => {
        if (syncStatusEl) {
          syncStatusEl.textContent = 'Syncing with Anki...';
          syncStatusEl.style.display = 'block';
        }
        if (this.onSyncAnki) {
          try {
            const res = await this.onSyncAnki(this.currentDeck);
            if (syncStatusEl) {
              const imported = res?.imported_count ?? res?.imported_anki_cards ?? 0;
              syncStatusEl.textContent = `Sync complete (${imported} cards updated).`;
              setTimeout(() => { syncStatusEl.style.display = 'none'; }, 2500);
            }
          } catch (err) {
            if (syncStatusEl) {
              syncStatusEl.textContent = 'Anki sync failed. Is Anki open?';
              setTimeout(() => { syncStatusEl.style.display = 'none'; }, 2500);
            }
          }
        }
      });
    }

    const closeBtn = this.element.querySelector('.settings-close-btn');
    const cancelBtn = this.element.querySelector('.settings-btn-cancel');
    const dismiss = () => {
      this.close();
      if (this.onClose) this.onClose();
    };
    if (closeBtn) closeBtn.addEventListener('click', dismiss);
    if (cancelBtn) cancelBtn.addEventListener('click', dismiss);

    if (typeof window !== 'undefined') {
      this._boundKeyHandler = (e) => {
        if (e.key === 'Escape') dismiss();
      };
      window.addEventListener('keydown', this._boundKeyHandler);
    }

    const saveBtn = this.element.querySelector('.settings-btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const newCards = parseInt(this.element.querySelector('#setting-new-cards').value, 10) || 20;
        const maxReviews = parseInt(this.element.querySelector('#setting-max-reviews').value, 10) || 200;
        const retention = (parseInt(range.value, 10) || 90) / 100.0;
        const easyCap = parseInt(this.element.querySelector('#setting-easy-cap').value, 10) || 6;
        const maxIvl = parseInt(this.element.querySelector('#setting-max-interval').value, 10) || 365;
        const autoSync = this.element.querySelector('#setting-auto-sync').checked ? 1 : 0;

        const updated = {
          new_cards_per_day: newCards,
          max_reviews_per_day: maxReviews,
          desired_retention: retention,
          easy_initial_cap_days: easyCap,
          max_interval_days: maxIvl,
          auto_sync_anki: autoSync
        };

        if (this.onSave) {
          this.onSave(updated);
        }
        this.close();
      });
    }
  }

  close() {
    if (typeof window !== 'undefined' && this._boundKeyHandler) {
      window.removeEventListener('keydown', this._boundKeyHandler);
      this._boundKeyHandler = null;
    }
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('review-settings-modal');
    if (existing) {
      existing.remove();
    }
    this.element = null;
  }
}
