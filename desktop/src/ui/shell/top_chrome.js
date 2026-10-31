/**
 * Kiroku Note Desktop — Shared Top Chrome Component
 * Wordmark letter lift, frameless window branding, and quick navigation actions.
 * Note: Service statuses reside strictly in the Settings tab.
 */

export class TopChrome {
  constructor(options = {}) {
    this.container = options.container || document.getElementById('top-chrome-container');
    this.onNavigate = options.onNavigate || (() => {});
  }

  init() {
    this.render();
    this.setupWordmarkAnimation();
    this.setupActions();
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <header class="top-chrome" role="banner">
        <!-- Left: Wordmark -->
        <div class="top-chrome-left">
          <div class="brand-wordmark-container" id="brand-wordmark-container" title="Kiroku Note Home">
            <span class="brand-wordmark" id="kiroku-letters" aria-label="Kiroku">
              <span class="brand-letter">K</span>
              <span class="brand-letter">i</span>
              <span class="brand-letter">r</span>
              <span class="brand-letter">o</span>
              <span class="brand-letter">k</span>
              <span class="brand-letter">u</span>
            </span>
            <span class="brand-badge">DESKTOP</span>
          </div>
        </div>

        <!-- Right: Quick Navigation Actions -->
        <div class="top-chrome-right">
          <!-- History Action Button -->
          <button class="chrome-action-btn" id="btn-chrome-history" title="Card Mining History" aria-label="View Mining History">
            <svg viewBox="0 0 24 24">
              <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>
            </svg>
          </button>

          <!-- Settings Action Button -->
          <button class="chrome-action-btn chrome-action-btn-settings" id="btn-chrome-settings" title="Application Settings" aria-label="Open Settings">
            <svg viewBox="0 0 24 24">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
          </button>
        </div>
      </header>
    `;
  }

  setupWordmarkAnimation() {
    const brandContainer = document.getElementById('brand-wordmark-container');
    const letters = document.querySelectorAll('#kiroku-letters .brand-letter');

    if (!brandContainer || !letters.length) return;

    // Mousemove ripple stagger
    brandContainer.addEventListener('mousemove', (e) => {
      const mouseX = e.clientX;
      letters.forEach((letter) => {
        const rect = letter.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const dist = Math.abs(mouseX - center);
        const radius = 45;
        let lift = 0;
        if (dist < radius) {
          lift = Math.cos((dist / radius) * (Math.PI / 2)) * -5;
        }
        letter.style.transform = `translateY(${lift.toFixed(1)}px)`;
      });
    });

    brandContainer.addEventListener('mouseleave', () => {
      letters.forEach((l) => (l.style.transform = 'translateY(0)'));
    });

    brandContainer.addEventListener('click', () => {
      letters.forEach((letter, i) => {
        setTimeout(() => {
          letter.style.transform = 'translateY(-6px)';
          setTimeout(() => {
            letter.style.transform = 'translateY(0)';
          }, 150);
        }, i * 35);
      });
      this.onNavigate('home');
    });
  }

  setupActions() {
    const btnHistory = document.getElementById('btn-chrome-history');
    if (btnHistory) {
      btnHistory.addEventListener('click', () => {
        this.onNavigate('vocab-history');
      });
    }

    const btnSettings = document.getElementById('btn-chrome-settings');
    if (btnSettings) {
      btnSettings.addEventListener('click', () => {
        this.onNavigate('settings');
      });
    }
  }

  destroy() {
    // Top chrome cleanup
  }
}
