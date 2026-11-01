/**
 * Kiroku Note Desktop — Shared Top Chrome Component
 * Wordmark letter lift, frameless window branding, universal learner level badge,
 * section indicator, live telemetry chips, and Windows window controls.
 */

import { getUniversalJlptLevel } from '../utils/learner.js';

export class TopChrome {
  constructor(options = {}) {
    this.container = options.container || document.getElementById('top-chrome-container');
    this.onNavigate = options.onNavigate || (() => {});
    this.handleLevelChanged = this.handleLevelChanged.bind(this);
    this.handleSectionChanged = this.handleSectionChanged.bind(this);
    this.telemetryInterval = null;
    this.currentSection = 'home';
  }

  async init() {
    this.render();
    this.setupWordmarkAnimation();
    this.setupActions();
    this.setupWindowControls();
    this.setupSectionListener();
    await this.updateLearnerBadge();
    this.startTelemetryPolling();

    if (typeof window !== 'undefined') {
      window.removeEventListener('kiroku:learner-level-changed', this.handleLevelChanged);
      window.addEventListener('kiroku:learner-level-changed', this.handleLevelChanged);
    }
  }

  setupSectionListener() {
    if (typeof window === 'undefined') return;

    window.removeEventListener('kiroku:section-changed', this.handleSectionChanged);
    window.addEventListener('kiroku:section-changed', this.handleSectionChanged);

    window.removeEventListener('hashchange', this.handleSectionChanged);
    window.addEventListener('hashchange', this.handleSectionChanged);

    const initial = window.location.hash.replace('#', '') || 'home';
    this.setSection(initial);
  }

  handleSectionChanged(e) {
    const section = e?.detail?.section || e?.detail?.tab || (typeof window !== 'undefined' ? window.location.hash.replace('#', '') : 'home');
    this.setSection(section || 'home');
  }

  setSection(section) {
    this.currentSection = section;
    const indicator = document.getElementById('top-chrome-section-indicator');
    if (!indicator) return;

    const sectionLabels = {
      'home': 'Home',
      'vocab': 'Vocabulary',
      'vocab-history': 'History',
      'grammar': 'Grammar',
      'kanji': 'Kanji',
      'test': 'Mock Exam',
      'study': 'Study Drills',
      'settings': 'Settings'
    };
    indicator.textContent = sectionLabels[section] || section;
  }

  async updateTelemetry() {
    try {
      if (typeof window === 'undefined') return;
      if (typeof window.desktopAPI?.getServicesStatus === 'function') {
        const status = await window.desktopAPI.getServicesStatus();
        this.applyTelemetryStatus(status);
      } else {
        this.applyTelemetryStatus(null);
      }
    } catch (err) {
      console.debug('[TopChrome] Telemetry update failed:', err);
    }
  }

  applyTelemetryStatus(status) {
    const services = [
      { id: 'backend', label: 'Backend', active: status ? Boolean(status.backend ?? status.backendRunning) : null },
      { id: 'yomitan', label: 'Yomitan', active: status ? Boolean(status.yomitan ?? status.yomitanConnected) : null },
      { id: 'anki', label: 'Anki', active: status ? Boolean(status.anki ?? status.ankiConnected) : null },
      { id: 'ocr', label: 'OCR', active: status ? Boolean(status.ocr ?? status.ocrAvailable) : null }
    ];

    for (const service of services) {
      const pip = document.getElementById(`pip-${service.id}`);
      const chip = document.getElementById(`chip-${service.id}`);
      if (!pip) continue;

      pip.classList.remove('is-online', 'is-offline', 'is-checking');

      let stateText = 'Checking';
      if (service.active === true) {
        pip.classList.add('is-online');
        stateText = 'Online';
      } else if (service.active === false) {
        pip.classList.add('is-offline');
        stateText = 'Offline';
      } else {
        pip.classList.add('is-checking');
        stateText = 'Checking';
      }

      if (chip) {
        chip.title = `${service.label}: ${stateText}`;
        chip.setAttribute('aria-label', `${service.label}: ${stateText}`);
      }
    }
  }

  startTelemetryPolling() {
    this.stopTelemetryPolling();
    this.updateTelemetry().catch((err) => {
      console.debug('[TopChrome] Initial telemetry update error:', err);
    });

    this.telemetryInterval = setInterval(() => {
      this.updateTelemetry().catch((err) => {
        console.debug('[TopChrome] Periodic telemetry poll error:', err);
      });
    }, 4000);
  }

  stopTelemetryPolling() {
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }
  }

  handleLevelChanged(e) {
    const level = e?.detail?.level;
    const badge = document.getElementById('btn-top-chrome-level');
    if (badge && level) {
      badge.textContent = `JLPT ${level}`;
    }
  }

  async updateLearnerBadge() {
    try {
      const level = await getUniversalJlptLevel();
      const badge = document.getElementById('btn-top-chrome-level');
      if (badge && level) {
        badge.textContent = `JLPT ${level}`;
      }
    } catch (err) {
      console.debug('[TopChrome] Update badge error:', err);
    }
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <header class="top-chrome" role="banner">
        <!-- Left: Wordmark & Section Indicator -->
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

          <div class="top-chrome-section-container" id="top-chrome-section-container" aria-label="Current Section">
            <span class="top-chrome-section-divider">/</span>
            <span class="top-chrome-section-indicator" id="top-chrome-section-indicator">Home</span>
          </div>
        </div>

        <!-- Right: Live Telemetry, Universal Level, Quick Actions & Window Controls -->
        <div class="top-chrome-right">
          <!-- Live Telemetry Strip -->
          <div class="telemetry-strip" id="telemetry-strip" role="status" aria-label="Services telemetry">
            <div class="telemetry-chip" id="chip-backend" title="Backend: Checking" aria-label="Backend status">
              <span class="telemetry-pip is-checking" id="pip-backend"></span>
              <span class="telemetry-label">Backend</span>
            </div>
            <div class="telemetry-chip" id="chip-yomitan" title="Yomitan: Checking" aria-label="Yomitan status">
              <span class="telemetry-pip is-checking" id="pip-yomitan"></span>
              <span class="telemetry-label">Yomitan</span>
            </div>
            <div class="telemetry-chip" id="chip-anki" title="Anki: Checking" aria-label="Anki status">
              <span class="telemetry-pip is-checking" id="pip-anki"></span>
              <span class="telemetry-label">Anki</span>
            </div>
            <div class="telemetry-chip" id="chip-ocr" title="OCR: Checking" aria-label="OCR status">
              <span class="telemetry-pip is-checking" id="pip-ocr"></span>
              <span class="telemetry-label">OCR</span>
            </div>
          </div>

          <!-- Universal JLPT Study Level Badge -->
          <button type="button" class="top-chrome-learner-badge" id="btn-top-chrome-level" title="Universal JLPT Level — Click to change in Settings" aria-label="Target JLPT Level">
            JLPT N4
          </button>

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

          <!-- Windows Window Controls -->
          <div class="window-controls" id="window-controls" role="group" aria-label="Window controls">
            <button type="button" class="window-control-btn" id="btn-window-minimize" title="Minimize" aria-label="Minimize Window">
              <svg viewBox="0 0 12 12"><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            </button>
            <button type="button" class="window-control-btn" id="btn-window-maximize" title="Maximize or Restore" aria-label="Maximize or Restore Window">
              <svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
            </button>
            <button type="button" class="window-control-btn window-control-close" id="btn-window-close" title="Close" aria-label="Close Window">
              <svg viewBox="0 0 12 12"><line x1="2.5" y1="2.5" x2="9.5" y2="9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="9.5" y1="2.5" x2="2.5" y2="9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
      </header>
    `;
  }

  setupWordmarkAnimation() {
    const brandContainer = document.getElementById('brand-wordmark-container');
    const letters = document.querySelectorAll('#kiroku-letters .brand-letter');

    if (!brandContainer || !letters.length) return;

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
    const btnLevel = document.getElementById('btn-top-chrome-level');
    if (btnLevel) {
      btnLevel.addEventListener('click', () => {
        this.onNavigate('settings');
      });
    }

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

  setupWindowControls() {
    const btnMin = document.getElementById('btn-window-minimize');
    if (btnMin) {
      btnMin.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          window.desktopAPI?.minimize?.();
        } catch (err) {
          console.debug('[TopChrome] minimize error:', err);
        }
      });
    }

    const btnMax = document.getElementById('btn-window-maximize');
    if (btnMax) {
      btnMax.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          window.desktopAPI?.toggleMaximize?.();
        } catch (err) {
          console.debug('[TopChrome] toggleMaximize error:', err);
        }
      });
    }

    const btnClose = document.getElementById('btn-window-close');
    if (btnClose) {
      btnClose.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          window.desktopAPI?.close?.();
        } catch (err) {
          console.debug('[TopChrome] close error:', err);
        }
      });
    }
  }

  destroy() {
    this.stopTelemetryPolling();
    if (typeof window !== 'undefined') {
      window.removeEventListener('kiroku:learner-level-changed', this.handleLevelChanged);
      if (this.handleSectionChanged) {
        window.removeEventListener('kiroku:section-changed', this.handleSectionChanged);
        window.removeEventListener('hashchange', this.handleSectionChanged);
      }
    }
  }
}
