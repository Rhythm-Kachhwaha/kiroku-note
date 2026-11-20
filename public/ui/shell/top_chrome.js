/**
 * Kiroku Note Desktop — Shared Top Chrome Component
 * Wordmark letter lift, frameless window branding, universal learner level badge,
 * section indicator, live telemetry chips, and Windows window controls.
 */

import { getUniversalJlptLevel } from '../utils/learner.js';
import { AuthModal } from '../components/auth_modal.js';
import { SyncCoordinator } from '../services/sync_coordinator.js';

export class TopChrome {
  constructor(options = {}) {
    this.container = options.container || document.getElementById('top-chrome-container');
    this.onNavigate = options.onNavigate || (() => {});
    this.handleLevelChanged = this.handleLevelChanged.bind(this);
    this.handleSectionChanged = this.handleSectionChanged.bind(this);
    this.telemetryInterval = null;
    this.currentSection = 'home';
    this.currentUser = null;
    this.syncCoordinator = new SyncCoordinator();
  }

  async init() {
    this.render();
    this.setupWordmarkAnimation();
    this.setupActions();
    this.setupWindowControls();
    this.setupSectionListener();
    await this.updateLearnerBadge();
    await this.checkAuthStatus();
    this.setupAutoSync();
    this.startTelemetryPolling();

    if (typeof window !== 'undefined') {
      window.removeEventListener('kiroku:learner-level-changed', this.handleLevelChanged);
      window.addEventListener('kiroku:learner-level-changed', this.handleLevelChanged);
      window.addEventListener('kiroku:auth-refresh', () => this.checkAuthStatus());

      if (window.desktopAPI?.auth?.onAuthSuccess) {
        window.desktopAPI.auth.onAuthSuccess((session) => {
          if (session && session.user) {
            this.currentUser = session.user;
            this.updateAuthUI(session.user);
            AuthModal.setStoredUser(session.user);
            this.triggerCloudSync({ silent: false });
          }
        });
      }

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.stopTelemetryPolling();
        } else {
          this.startTelemetryPolling();
        }
      });
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
      'home': { en: 'Home', ja: '' },
      'vocab': { en: 'Vocab', ja: '単語' },
      'vocab-history': { en: 'History', ja: '履歴' },
      'grammar': { en: 'Grammar', ja: '文法' },
      'kanji': { en: 'Kanji', ja: '漢字' },
      'test': { en: 'Test', ja: 'テスト' },
      'anime': { en: 'Anime', ja: 'アニメ' },
      'manga': { en: 'Manga', ja: 'マンガ' },
      'study': { en: 'Study', ja: '勉強' },
      'settings': { en: 'Settings', ja: '設定' },
      'stats': { en: 'Stats', ja: '統計' }
    };
    const meta = sectionLabels[section] || { en: section || 'Home', ja: '' };
    indicator.textContent = meta.en;

    let kanjiSpan = document.getElementById('top-chrome-section-kanji');
    if (!kanjiSpan && indicator.parentNode) {
      kanjiSpan = document.createElement('span');
      kanjiSpan.id = 'top-chrome-section-kanji';
      kanjiSpan.className = 'top-chrome-section-kanji';
      indicator.parentNode.appendChild(kanjiSpan);
    }
    if (kanjiSpan) {
      kanjiSpan.textContent = meta.ja;
      kanjiSpan.style.display = meta.ja ? 'inline-block' : 'none';
    }

    const btnStats = document.getElementById('btn-chrome-stats');
    const btnHistory = document.getElementById('btn-chrome-history');
    const btnSettings = document.getElementById('btn-chrome-settings');
    if (btnStats) btnStats.classList.toggle('is-active', section === 'stats');
    if (btnHistory) btnHistory.classList.toggle('is-active', section === 'vocab-history');
    if (btnSettings) btnSettings.classList.toggle('is-active', section === 'settings');
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
    const resolveStatus = (val1, val2) => {
      if (!status) return null;
      const v = val1 ?? val2;
      return v === undefined || v === null ? null : Boolean(v);
    };

    const services = [
      { id: 'backend', label: 'Backend', active: resolveStatus(status?.backend, status?.backendRunning) },
      { id: 'yomitan', label: 'Yomitan', active: resolveStatus(status?.yomitan, status?.yomitanConnected) },
      { id: 'anki', label: 'Anki', active: resolveStatus(status?.anki, status?.ankiConnected) },
      { id: 'ocr', label: 'OCR', active: resolveStatus(status?.ocr, status?.ocrAvailable) }
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
            JLPT
          </button>

          <!-- History Action Button -->
          <button class="chrome-action-btn" id="btn-chrome-history" title="Card Mining History" aria-label="View Mining History">
            <svg viewBox="0 0 24 24">
              <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>
            </svg>
          </button>

          <!-- Stats Action Button with Animated SVG -->
          <button class="chrome-action-btn chrome-action-btn-stats" id="btn-chrome-stats" title="Learning Analytics & Stats" aria-label="Open Stats">
            <svg class="stats-icon-svg" viewBox="0 0 24 24">
              <rect class="stats-bar-1" x="3" y="11" width="3.2" height="10" rx="1" />
              <rect class="stats-bar-2" x="8.5" y="5" width="3.2" height="16" rx="1" />
              <rect class="stats-bar-3" x="14" y="8" width="3.2" height="13" rx="1" />
              <rect class="stats-bar-4" x="19.5" y="2" width="3.2" height="19" rx="1" />
            </svg>
          </button>

          <!-- Settings Action Button -->
          <button class="chrome-action-btn chrome-action-btn-settings" id="btn-chrome-settings" title="Application Settings" aria-label="Open Settings">
            <svg viewBox="0 0 24 24">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
          </button>

          <!-- Cloud Sync Action Button with tactile state & tooltip -->
          <button type="button" class="chrome-action-btn chrome-action-btn-sync" id="btn-chrome-sync" title="Sync with Kiroku Cloud" aria-label="Sync with Cloud">
            <svg class="sync-icon-svg" viewBox="0 0 24 24">
              <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
            </svg>
            <span class="sync-status-indicator" id="sync-status-indicator"></span>
          </button>

          <!-- Auth / Account Pill -->
          <button type="button" class="top-chrome-auth-btn" id="btn-top-chrome-auth" title="Sign In to Kiroku Cloud" aria-label="Account">
            <svg viewBox="0 0 24 24">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
            <span class="auth-btn-label" id="top-chrome-auth-label">Sign in</span>
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

    const btnStats = document.getElementById('btn-chrome-stats');
    if (btnStats) {
      btnStats.addEventListener('click', () => {
        this.onNavigate('stats');
      });
    }

    const btnSettings = document.getElementById('btn-chrome-settings');
    if (btnSettings) {
      btnSettings.addEventListener('click', () => {
        this.onNavigate('settings');
      });
    }

    const btnSync = document.getElementById('btn-chrome-sync');
    if (btnSync) {
      btnSync.addEventListener('click', async () => {
        if (!this.currentUser) {
          const modal = new AuthModal({
            currentUser: null,
            onAuthSuccess: (user) => {
              this.currentUser = user;
              this.updateAuthUI(user);
              if (user) this.triggerCloudSync({ silent: false });
            }
          });
          modal.open();
          return;
        }
        await this.triggerCloudSync({ silent: false });
      });
    }

    const btnAuth = document.getElementById('btn-top-chrome-auth');
    if (btnAuth) {
      btnAuth.addEventListener('click', async () => {
        const modal = new AuthModal({
          currentUser: this.currentUser,
          onAuthSuccess: (user) => {
            this.currentUser = user;
            this.updateAuthUI(user);
            if (user) this.triggerCloudSync({ silent: false });
          }
        });
        modal.open();
      });
    }
  }

  async triggerCloudSync({ silent = false } = {}) {
    const btnSync = document.getElementById('btn-chrome-sync');
    if (btnSync) btnSync.classList.add('is-syncing');

    try {
      const res = await this.syncCoordinator.runSync({ showOverlay: !silent });
      if (res && res.ok && btnSync) {
        btnSync.classList.add('is-synced');
        setTimeout(() => btnSync.classList.remove('is-synced'), 2000);
      }
    } catch (err) {
      console.warn('[TopChrome] Trigger cloud sync notice:', err);
    } finally {
      if (btnSync) btnSync.classList.remove('is-syncing');
      if (this._hasPendingSync) {
        this._hasPendingSync = false;
        setTimeout(() => this.triggerCloudSync({ silent: true }), 800);
      }
    }
  }

  setupAutoSync() {
    if (typeof window === 'undefined') return;
    let autoSyncDebounceTimer = null;
    this._hasPendingSync = false;

    const triggerDebouncedSync = () => {
      clearTimeout(autoSyncDebounceTimer);
      autoSyncDebounceTimer = setTimeout(async () => {
        const token = await this.syncCoordinator.getAuthToken();
        if (!token) return;
        if (this.syncCoordinator.isSyncing) {
          this._hasPendingSync = true;
          return;
        }
        await this.triggerCloudSync({ silent: true });
      }, 1500);
    };

    window.removeEventListener('kiroku:data-changed', triggerDebouncedSync);
    window.addEventListener('kiroku:data-changed', triggerDebouncedSync);
    window.removeEventListener('kiroku:study-bank-updated', triggerDebouncedSync);
    window.addEventListener('kiroku:study-bank-updated', triggerDebouncedSync);
  }

  async checkAuthStatus() {
    // 1. Check Electron DesktopStore persistent session
    if (typeof window !== 'undefined' && window.desktopAPI?.auth?.getSession) {
      try {
        const session = await window.desktopAPI.auth.getSession();
        if (session && session.user) {
          this.currentUser = session.user;
          this.updateAuthUI(session.user);
          AuthModal.setStoredUser(session.user, session);
          return;
        }
      } catch (err) {
        console.warn('[TopChrome] Desktop session retrieval warning:', err);
      }
    }

    // 2. Check localStorage cached user
    const stored = AuthModal.getStoredUser();
    if (stored) {
      this.currentUser = stored;
      this.updateAuthUI(stored);
      return;
    }

    // 3. Fallback to /auth/me only when running in web / http environment
    if (typeof window !== 'undefined' && window.location?.protocol !== 'file:') {
      try {
        const res = await fetch('/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (data && data.authenticated && data.user) {
            this.currentUser = data.user;
            this.updateAuthUI(data.user);
            await this.migrateGuestDataIfNeeded(data.user);
            window.dispatchEvent(new CustomEvent('kiroku:auth-changed', { detail: { user: data.user } }));
            return;
          }
        }
      } catch (_) {}
    }

    this.currentUser = null;
    this.updateAuthUI(null);
  }

  updateAuthUI(user) {
    const authBtn = document.getElementById('btn-top-chrome-auth');
    const label = document.getElementById('top-chrome-auth-label');
    if (!authBtn || !label) return;

    if (user) {
      authBtn.classList.add('is-authenticated');
      const displayName = user.name ? user.name.split(' ')[0] : (user.email ? user.email.split('@')[0] : 'Account');
      label.textContent = displayName;
      authBtn.title = `Signed in as ${user.name || user.email || 'User'} — Click to sign out`;
    } else {
      authBtn.classList.remove('is-authenticated');
      label.textContent = 'Sign in';
      authBtn.title = 'Sign In to Kiroku Cloud';
    }
  }

  async migrateGuestDataIfNeeded(user) {
    if (!user || typeof window === 'undefined') return;
    const migrationKey = `kiroku_migrated_${user.sub || user.id || 'user'}`;
    if (localStorage.getItem(migrationKey)) return;

    try {
      const guestCards = localStorage.getItem('kiroku_guest_cards');
      if (guestCards) {
        let cards = [];
        try {
          cards = JSON.parse(guestCards);
        } catch (_) {}

        if (Array.isArray(cards) && cards.length > 0) {
          const res = await fetch('/api/oplog/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: cards })
          });

          if (!res.ok) {
            console.warn('[Auth] Guest migration server rejected batch write with status:', res.status);
            return;
          }

          const data = await res.json().catch(() => ({}));
          if (data.status !== 'ok') {
            console.warn('[Auth] Guest migration unsuccessful:', data);
            return;
          }

          localStorage.removeItem('kiroku_guest_cards');
        }
      }

      localStorage.setItem(migrationKey, 'true');
      console.info('[Auth] Guest data migration completed successfully for user:', user.sub || user.email);
    } catch (err) {
      console.warn('[Auth] Guest migration network error:', err);
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
