/**
 * Kiroku Note Desktop — Pacman Sync Loader Component
 * Renders an animated Pacman overlay with a progress bar during cloud/Anki synchronization.
 */

export const PACMAN_LOADING_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" class="pacman3351" viewBox="50 0 500 300">
  <style>
    .pacman3351-dot {
      fill: currentColor;
    }
    .pacman3351-open,
    .pacman3351-mouth-top,
    .pacman3351-mouth-bottom {
      fill: currentColor;
    }
    .pacman3351-mouth-top,
    .pacman3351-mouth-bottom {
      animation-duration: 175ms;
      animation-timing-function: linear;
      animation-direction: alternate;
      animation-iteration-count: infinite;
      transform-origin: calc(300px/2) 150px;
    }
    .pacman3351-mouth-top {
      animation-name: rotate3351-counterclockwise;
    }
    .pacman3351-mouth-bottom {
      animation-name: rotate3351-clockwise;
    }
    @keyframes rotate3351-counterclockwise {
      100% {
        transform: rotate(-30deg);
      }
    }
    @keyframes rotate3351-clockwise {
      100% {
        transform: rotate(30deg);
      }
    }
    .pacman3351-dot {
      animation-name: dot3351-motion;
      animation-duration: 600ms;
      animation-timing-function: linear;
      animation-iteration-count: infinite;
    }
    @keyframes dot3351-motion {
      100% {
        transform: translateX(-100px);
      }
    }
  </style>
  <circle class="pacman3351-dot" cx="250" cy="50%" r="10"/>
  <circle class="pacman3351-dot" cx="350" cy="50%" r="10"/>
  <circle class="pacman3351-dot" cx="450" cy="50%" r="10"/>
  <circle class="pacman3351-dot" cx="550" cy="50%" r="10"/>
  <circle class="pacman3351-dot" cx="650" cy="50%" r="10"/>
  <path class="pacman3351-mouth-bottom" d="
    M 150,150
    L 220.4,221.0
    A 100 100 0 0 0 250,150
    Z"/>
  <path class="pacman3351-mouth-top" d="
    M 150,150 
    L 220.4,79.0
    A 100 100 0 0 1 250,150
    Z"/>
  <path class="pacman3351-open" d="
    M 150,150
    L 236.6,100
    A 100 100 0 1 0 236.6,200
    Z"/>
</svg>
`.trim();

export class SyncLoaderOverlay {
  constructor() {
    this.overlayElement = null;
  }

  renderHtml(
    title = 'Syncing with Kiroku Cloud...',
    desc = 'Synchronizing cards and study progress',
    current = 0,
    total = 0,
    variant = 'pacman'
  ) {
    const percent = (total > 0 && current >= 0) ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const progressText = total > 0 ? `${current} / ${total} (${percent}%)` : (current > 0 ? `${current} items` : '');
    const displayStyle = total > 0 || current > 0 ? 'block' : 'none';

    return `
      <div class="kiroku-sync-overlay" id="kiroku-sync-overlay" role="dialog" aria-modal="true" aria-label="Synchronization in progress">
        <div class="sync-loader-card">
          <div class="loader pacman-loader-wrap">
            ${PACMAN_LOADING_SVG}
          </div>
          <div class="book-wrapper" style="display:none;" aria-hidden="true">
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
          <div class="sync-status-title" id="sync-status-title">${title}</div>
          <div class="sync-status-desc" id="sync-status-desc">${desc}</div>
          <div class="sync-progress-bar-container" id="sync-progress-bar-container" style="display:${displayStyle};">
            <div class="sync-progress-bar-fill" id="sync-progress-bar-fill" style="width: ${percent}%;"></div>
          </div>
          <div class="sync-status-progress font-mono" id="sync-status-progress" style="display:${displayStyle};">
            ${progressText}
          </div>
        </div>
      </div>
    `.trim();
  }

  show(
    title = 'Syncing with Kiroku Cloud...',
    desc = 'Synchronizing cards and study progress',
    current = 0,
    total = 0
  ) {
    if (typeof document === 'undefined') return;
    this.hide(true);

    const percent = (total > 0 && current >= 0) ? Math.min(100, Math.round((current / total) * 100)) : 8;
    const pill = document.createElement('div');
    pill.className = 'kiroku-sync-pill';
    pill.id = 'kiroku-sync-overlay';
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    pill.innerHTML = `
      <div class="sync-pill-row">
        <span class="sync-pill-dot" aria-hidden="true"></span>
        <span class="sync-pill-text" id="sync-status-desc">${desc || title}</span>
        <span class="sync-pill-meta font-mono" id="sync-status-progress">${total > 0 ? `${percent}%` : ''}</span>
      </div>
      <div class="sync-pill-track" id="sync-progress-bar-container">
        <div class="sync-pill-fill" id="sync-progress-bar-fill" style="transform: scaleX(${percent / 100});"></div>
      </div>
    `.trim();
    this.overlayElement = pill;
    document.body.appendChild(pill);
    requestAnimationFrame(() => {
      if (this.overlayElement === pill) {
        pill.classList.add('is-visible');
      }
    });
  }

  updateProgress(current, total, detailText = '') {
    if (!this.overlayElement) return;
    const progressEl = this.overlayElement.querySelector('#sync-status-progress');
    const fillEl = this.overlayElement.querySelector('#sync-progress-bar-fill');
    const descEl = this.overlayElement.querySelector('#sync-status-desc');

    const percent = (total > 0 && current >= 0) ? Math.min(100, Math.round((current / total) * 100)) : 0;

    if (fillEl) {
      fillEl.style.transform = `scaleX(${Math.max(0.04, percent / 100)})`;
    }

    if (progressEl) {
      progressEl.textContent = total > 0 ? `${percent}%` : (current > 0 ? `${current}` : '');
    }

    if (detailText && descEl) {
      descEl.textContent = detailText;
    }
  }

  hide(immediate = false) {
    if (typeof document === 'undefined') return;
    const existing = this.overlayElement || document.getElementById('kiroku-sync-overlay');
    this.overlayElement = null;
    if (!existing) return;
    if (immediate) {
      existing.remove();
      return;
    }
    existing.classList.remove('is-visible');
    setTimeout(() => existing.remove(), 200);
  }
}
