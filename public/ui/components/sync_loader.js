/**
 * Protective Flipping-Book Sync Loader Component
 * Renders an animated book overlay during AnkiConnect synchronization.
 */

export class SyncLoaderOverlay {
  constructor() {
    this.overlayElement = null;
  }

  renderHtml(title = 'Syncing with Anki...', desc = 'Importing existing reviews') {
    return `
      <div class="kiroku-sync-overlay" id="kiroku-sync-overlay">
        <div class="loader">
          <div class="book-wrapper">
            <svg class="book" viewBox="0 0 100 70" xmlns="http://www.w3.org/2000/svg">
              <rect x="10" y="10" width="40" height="50" rx="3" fill="var(--ink-surface)" stroke="var(--tactile-stroke)" stroke-width="3" />
              <rect x="50" y="10" width="40" height="50" rx="3" fill="var(--ink-surface)" stroke="var(--tactile-stroke)" stroke-width="3" />
              <line x1="50" y1="10" x2="50" y2="60" stroke="var(--vermilion)" stroke-width="4" stroke-linecap="round" />
            </svg>
            <svg class="book-page" viewBox="0 0 50 70" xmlns="http://www.w3.org/2000/svg">
              <path d="M 0 10 L 40 10 L 40 60 L 0 60 Z" fill="var(--warm-paper)" stroke="var(--tactile-stroke)" stroke-width="2" />
              <line x1="6" y1="20" x2="34" y2="20" stroke="var(--tactile-stroke)" stroke-width="2" stroke-linecap="round" />
              <line x1="6" y1="30" x2="34" y2="30" stroke="var(--tactile-stroke)" stroke-width="2" stroke-linecap="round" />
              <line x1="6" y1="40" x2="24" y2="40" stroke="var(--tactile-stroke)" stroke-width="2" stroke-linecap="round" />
            </svg>
          </div>
        </div>
        <div class="sync-status-title">${title}</div>
        <div class="sync-status-desc">${desc}</div>
        <div class="sync-status-progress" id="sync-status-progress" style="display:none;"></div>
      </div>
    `.trim();
  }

  show(title = 'Syncing with Anki...', desc = 'Importing existing reviews') {
    if (typeof document === 'undefined') return;
    this.hide();

    const wrapper = document.createElement('div');
    wrapper.innerHTML = this.renderHtml(title, desc);
    this.overlayElement = wrapper.firstElementChild;
    document.body.appendChild(this.overlayElement);
  }

  updateProgress(current, total) {
    if (!this.overlayElement) return;
    const progressEl = this.overlayElement.querySelector('#sync-status-progress');
    if (progressEl) {
      progressEl.style.display = 'block';
      progressEl.textContent = `${current} / ${total}`;
    }
  }

  hide() {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('kiroku-sync-overlay');
    if (existing) {
      existing.remove();
    }
    this.overlayElement = null;
  }
}
