/**
 * Review Settings Modal
 * Plain-English configuration of Anki / FSRS parameters.
 */

export class ReviewSettingsModal {
  constructor({ values = {}, explanations = {}, onSave = null, onClose = null } = {}) {
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

    const closeBtn = this.element.querySelector('.settings-close-btn');
    const cancelBtn = this.element.querySelector('.settings-btn-cancel');
    const dismiss = () => {
      this.close();
      if (this.onClose) this.onClose();
    };
    if (closeBtn) closeBtn.addEventListener('click', dismiss);
    if (cancelBtn) cancelBtn.addEventListener('click', dismiss);

    const saveBtn = this.element.querySelector('.settings-btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const newCards = parseInt(this.element.querySelector('#setting-new-cards').value, 10);
        const maxReviews = parseInt(this.element.querySelector('#setting-max-reviews').value, 10);
        const retention = parseInt(range.value, 10) / 100.0;
        const easyCap = parseInt(this.element.querySelector('#setting-easy-cap').value, 10);
        const maxIvl = parseInt(this.element.querySelector('#setting-max-interval').value, 10);
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
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('review-settings-modal');
    if (existing) {
      existing.remove();
    }
    this.element = null;
  }
}
