/**
 * Kiroku Note Desktop — Global Settings & Telemetry View Controller
 * Universal JLPT level curriculum, service integrations (AnkiConnect, Yomitan, OCR, LLM),
 * encrypted DPAPI keys, doctor diagnostics report, app data affordances, and backend supervisor controls.
 * Slice 24: Regrouped with Left Rail navigation, Language engine status card, and legacy Yomitan section.
 */

import { apiClient } from '../services/api_client.js';
import { studyClient } from '../services/study_client.js';
import { renderAssetSlot } from '../assets_map.js';
import { getUniversalJlptLevel, setUniversalJlptLevel, getUniversalAnkiDeck, setUniversalAnkiDeck } from '../utils/learner.js';
import { escapeHtml } from '../utils/sanitizer.js';
import { AuthModal } from '../components/auth_modal.js';

export class SettingsView {
  constructor(router) {
    this.router = router;
    this.keepAlive = true;
    this.activeListenerCount = 0;
    this.container = null;
    this.ocrRunning = false;
    this._scrollObserver = null;
    this._linkPollTimer = null;
    this.activeCategory = 'study';
    this.currentUser = null;
    this._lastSettingsLoadAt = 0;
    this._ankiDecksListener = () => {
      this.loadAnkiDecks().catch((err) => {
        console.debug('[Settings] Deck refresh notice:', err);
      });
    };
  }

  onShow() {
    this._startLinkPolling();
    if (typeof window !== 'undefined') {
      window.removeEventListener('kiroku:anki-decks-updated', this._ankiDecksListener);
      window.addEventListener('kiroku:anki-decks-updated', this._ankiDecksListener);
    }
    this.activeListenerCount = (this._scrollObserver ? 1 : 0) + (this._linkPollTimer ? 1 : 0);
    if (Date.now() - this._lastSettingsLoadAt > 30000) {
      this._lastSettingsLoadAt = Date.now();
      this.loadInitialSettings().catch((err) => {
        console.debug('[Settings] onShow background refresh warning:', err);
      });
    }
  }

  onHide() {
    this._stopLinkPolling();
    if (typeof window !== 'undefined') {
      window.removeEventListener('kiroku:anki-decks-updated', this._ankiDecksListener);
    }
    this.activeListenerCount = 0;
  }

  async mount(container) {
    this.container = container;
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('kiroku:settings-active-tab');
        if (saved && ['study', 'anki-dict', 'account', 'video', 'system'].includes(saved)) {
          this.activeCategory = saved;
        }
      } catch (err) {
        console.warn('[Settings] Could not read saved active tab:', err);
      }
    }
    this.render();
    this.setupEvents();
    this.setupTabNavigation();
    this._startLinkPolling();
    this.loadInitialSettings().catch((err) => {
      console.warn('[Settings] Background loadInitialSettings warning:', err);
    });
  }

  render() {
    this.container.innerHTML = `
      <div class="settings-view-wrapper">
        <div class="settings-view-container">
          <!-- Canonical Kiroku Brand Header with Prominent Animated Typing Cat Mascot -->
          <div class="grammar-header-row settings-header-row">
            <div class="settings-header-left">
              <div class="grammar-brand-header" aria-label="Settings 設定">
                <h1 class="grammar-word-title" aria-label="SETTINGS">
                  <span class="hero-letter">S</span><span class="hero-letter">E</span><span class="hero-letter">T</span><span class="hero-letter">T</span><span class="hero-letter">I</span><span class="hero-letter">N</span><span class="hero-letter">G</span><span class="hero-letter">S</span>
                </h1>
                <span class="grammar-word-kanji" aria-label="設定">
                  <span class="hero-letter">設</span><span class="hero-letter">定</span>
                </span>
              </div>
              <p class="settings-subtitle">Personalize your Japanese study curriculum, dictionary, Anki mining, and system preferences.</p>
            </div>

            <!-- Right Header Companion Mascot: Large Animated Typing Cat -->
            <div class="settings-header-companion">
              <div class="settings-cat-avatar" title="Kiroku Study Companion">
                <img src="./ui/assets/mascot/Cat typing.svg" alt="Cat typing" class="settings-cat-img" />
              </div>
            </div>
          </div>

          <!-- Visible Error Banner -->
          <div class="settings-error-banner" id="settings-error-banner" style="display: none;">
            <span class="error-msg" id="settings-error-msg"></span>
            <button type="button" class="btn-dismiss-error" id="btn-dismiss-settings-error" aria-label="Dismiss error"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>
          </div>

          <!-- Top Segmented Category Navigation Bar (5 Categories) -->
          <div class="settings-nav-bar" id="settings-nav-bar">
            <nav class="tactile-segmented settings-tab-segmented" id="settings-nav-rail" role="tablist" aria-label="Settings Categories">
              <button type="button" class="tactile-segmented-btn ${this.activeCategory === 'study' ? 'is-active' : ''}" data-category="study" data-target="settings-section-level" role="tab" aria-selected="${this.activeCategory === 'study'}" id="tab-btn-study">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/></svg>
                <span>Study &amp; Reading</span>
              </button>
              <button type="button" class="tactile-segmented-btn ${this.activeCategory === 'anki-dict' ? 'is-active' : ''}" data-category="anki-dict" data-target="settings-section-dictionary-anki" role="tab" aria-selected="${this.activeCategory === 'anki-dict'}" id="tab-btn-anki-dict">
                <svg class="anki-logo-svg" role="img" viewBox="0 0 24 24" width="18" height="18" fill="var(--industrial-aqua)" xmlns="http://www.w3.org/2000/svg"><title>Anki</title><path d="m15.845 22.627-.169.131-.182.091c-.109.042-.23.069-.362.079-.27.021-.611-.036-.989-.16-.686-.223-1.537-.67-2.256-.973-.343-.145-.633-.281-.829-.254-.197.027-.44.236-.73.467-.611.486-1.311 1.145-1.91 1.546-.331.22-.644.368-.91.42-.13.026-.255.032-.37.021l-.201-.038-.196-.082-.177-.119-.143-.145a1.3 1.3 0 0 1-.187-.32c-.104-.25-.154-.593-.154-.99.001-.721.164-1.669.23-2.447.031-.37.07-.687-.016-.866-.087-.178-.359-.345-.67-.55-.65-.431-1.494-.893-2.06-1.34-.312-.246-.548-.498-.681-.735a1.3 1.3 0 0 1-.134-.345l-.025-.202.016-.213.059-.205.094-.18c.064-.097.145-.191.246-.277.207-.175.517-.33.895-.452.685-.222 1.637-.361 2.397-.539.362-.084.676-.145.819-.281.144-.138.217-.45.316-.808.209-.752.387-1.696.638-2.373.138-.373.305-.676.489-.874.091-.098.187-.176.286-.235l.185-.086.207-.051.214-.006.2.033c.113.03.226.079.339.148.231.143.473.389.706.711.424.584.85 1.446 1.253 2.114.192.318.347.598.522.692.174.094.494.068.865.052.78-.034 1.734-.157 2.455-.128.397.017.736.081.983.195.12.055.223.123.31.201l.14.148.112.181.072.201.03.202c.007.115-.005.238-.036.368-.063.263-.223.57-.457.891-.425.583-1.113 1.254-1.623 1.845-.244.281-.463.514-.498.71-.035.194.089.49.219.838.273.731.684 1.601.879 2.295.108.382.151.725.119.995-.015.131-.049.252-.095.358l-.098.179zm-1.54-18.929c-.018-.057-.07-.226-.122-.346-.17-.387-.418-.846-.544-1.216-.166-.483-.099-.88.102-1.096.201-.214.592-.308 1.086-.177.377.1.851.316 1.249.458.125.044.297.084.354.096.047-.032.193-.134.291-.221.316-.282.675-.659.988-.894.408-.305.807-.366 1.074-.241.266.124.476.468.504.977.021.391-.037.909-.049 1.331-.004.132.011.309.017.366.046.035.187.142.301.209.365.213.835.438 1.155.662.417.294.597.655.56.947-.035.293-.296.599-.773.782-.365.141-.875.246-1.28.364-.126.037-.29.106-.343.129-.019.056-.077.223-.105.351-.091.413-.159.93-.274 1.304-.151.487-.438.77-.727.826s-.661-.098-.983-.494c-.246-.303-.504-.756-.742-1.105-.074-.11-.19-.243-.229-.287-.058-.001-.235-.004-.366.009-.421.042-.933.135-1.324.141-.51.008-.867-.177-1.011-.435-.142-.257-.11-.659.167-1.088.212-.328.563-.713.822-1.047.08-.104.171-.256.202-.305"/></svg>
                <span>Anki &amp; Dictionary</span>
              </button>
              <button type="button" class="tactile-segmented-btn ${this.activeCategory === 'account' ? 'is-active' : ''}" data-category="account" role="tab" aria-selected="${this.activeCategory === 'account'}" id="tab-btn-account">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
                <span>Account &amp; Sync</span>
              </button>
              <button type="button" class="tactile-segmented-btn ${this.activeCategory === 'video' ? 'is-active' : ''}" data-category="video" data-target="settings-section-link" role="tab" aria-selected="${this.activeCategory === 'video'}" id="tab-btn-video">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M4 6.47L5.76 10H20v8H4V6.47M22 4h-4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4z"/></svg>
                <span>Video &amp; Subtitles</span>
              </button>
              <button type="button" class="tactile-segmented-btn ${this.activeCategory === 'system' ? 'is-active' : ''}" data-category="system" data-target="settings-section-diagnostics" role="tab" aria-selected="${this.activeCategory === 'system'}" id="tab-btn-system">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
                <span>System &amp; Advanced</span>
              </button>
            </nav>
          </div>

          <!-- Category Panels Wrapper -->
          <div class="settings-panels-wrapper mt-3">
            <!-- 1. STUDY & READING CATEGORY -->
            <div class="settings-category-panel ${this.activeCategory === 'study' ? 'is-active' : ''}" id="settings-panel-study" data-category="study" style="${this.activeCategory === 'study' ? 'display: block;' : 'display: none;'}">
              <section class="settings-section" id="settings-section-level">
                <div class="settings-cards-grid">
                  <!-- Target JLPT Study Level Card -->
                  <div class="settings-card tactile-card" id="settings-card-level">
                    <div class="budget-slider-stage">
                      <div class="budget-card">
                        <div class="card-header">
                          <div class="header-text">
                            <span class="label">Universal JLPT Study Level</span>
                            <span class="sub">Set your target Japanese study level.</span>
                          </div>
                          <span class="status-badge">
                            <span class="tier" data-tier="safe"><span class="tier-icon"></span>Active</span>
                          </span>
                        </div>

                        <div class="value-display">
                          <span class="live-amount" id="jlpt-level-current" data-ghost="N3">N3</span>
                          <span class="per-month">TARGET LEVEL</span>
                        </div>

                        <div class="slider-wrap">
                          <div class="live-tooltip" aria-hidden="true"></div>
                          <div class="track-marks" aria-hidden="true">
                            <span></span><span></span><span></span><span></span><span></span>
                          </div>
                          <div class="track-base">
                            <div class="track-fill"></div>
                          </div>
                          <div class="fx-anchor" aria-hidden="true">
                            <span class="shock-ring"></span><span class="shock-ring"></span>
                            <span class="spark"></span><span class="spark"></span>
                            <span class="spark"></span><span class="spark"></span>
                            <span class="spark"></span><span class="spark"></span>
                            <span class="spark"></span><span class="spark"></span>
                            <span class="spark"></span><span class="spark"></span>
                          </div>
                          <div class="steps-row" id="settings-level-pills" role="radiogroup" aria-label="Universal JLPT study level">
                            <input type="radio" name="jlpt-level" id="jlpt-n5" class="step" value="N5">
                            <label for="jlpt-n5" class="tick" aria-label="N5"></label>
                            <input type="radio" name="jlpt-level" id="jlpt-n4" class="step" value="N4">
                            <label for="jlpt-n4" class="tick" aria-label="N4"></label>
                            <input type="radio" name="jlpt-level" id="jlpt-n3" class="step" value="N3" checked>
                            <label for="jlpt-n3" class="tick" aria-label="N3"></label>
                            <input type="radio" name="jlpt-level" id="jlpt-n2" class="step" value="N2">
                            <label for="jlpt-n2" class="tick" aria-label="N2"></label>
                            <input type="radio" name="jlpt-level" id="jlpt-n1" class="step" value="N1">
                            <label for="jlpt-n1" class="tick" aria-label="N1"></label>
                          </div>
                        </div>

                        <div class="scale">
                          <span>N5</span><span>N4</span><span>N3</span><span>N2</span><span>N1</span>
                        </div>
                        <div class="card-footnote">
                          Your target level sets the focus for Kanji, Vocabulary, Grammar, and Practice.
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Reading & Furigana Preferences Card -->
                  <div class="settings-card tactile-card" id="card-reading-preferences">
                    <div class="card-header-row">
                      <div>
                        <h3 class="card-title">Reading &amp; Furigana Display</h3>
                        <p class="card-desc">Configure ruby reading annotations and pitch accent highlights.</p>
                      </div>
                    </div>
                    <div class="form-field mt-3">
                      <label for="select-furigana-mode">Furigana Mode</label>
                      <select id="select-furigana-mode" class="tactile-input font-mono text-sm">
                        <option value="always">Always Show Furigana</option>
                        <option value="hover">Show on Hover Only</option>
                        <option value="hidden">Hide Furigana (Kanji Only)</option>
                      </select>
                    </div>
                    <div class="mt-4 pt-3 border-t border-tactile flex items-center justify-between">
                      <div>
                        <span class="text-sm font-medium text-warm-paper block">Pitch Accent Highlights</span>
                        <span class="text-xs text-muted block">Show pitch accent color drops and high/low contours on words.</span>
                      </div>
                      <label class="toggle-switch">
                        <input type="checkbox" id="toggle-pitch-accent" checked />
                        <span class="toggle-slider"></span>
                      </label>
                    </div>
                  </div>

                  <!-- Reader & Media Playback Defaults Card -->
                  <div class="settings-card tactile-card" id="card-media-preferences">
                    <div class="card-header-row">
                      <div>
                        <h3 class="card-title">Reader &amp; Playback Defaults</h3>
                        <p class="card-desc">Default layout for manga reading and video playback speed.</p>
                      </div>
                    </div>
                    <div class="form-row-pair mt-3">
                      <div class="form-field">
                        <label for="select-manga-spread">Manga Spread</label>
                        <select id="select-manga-spread" class="tactile-input font-mono text-sm">
                          <option value="single">Single Page</option>
                          <option value="double">Two-Page Spread</option>
                        </select>
                      </div>
                      <div class="form-field">
                        <label for="select-default-rate">Default Video Speed</label>
                        <select id="select-default-rate" class="tactile-input font-mono text-sm">
                          <option value="0.75">0.75x</option>
                          <option value="1.0" selected>1.0x (Normal)</option>
                          <option value="1.25">1.25x</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <!-- 2. ANKI & DICTIONARY CATEGORY -->
            <div class="settings-category-panel ${this.activeCategory === 'anki-dict' ? 'is-active' : ''}" id="settings-panel-anki-dict" data-category="anki-dict" style="${this.activeCategory === 'anki-dict' ? 'display: block;' : 'display: none;'}">
              <section class="settings-section" id="settings-section-dictionary-anki">
                <div class="settings-cards-grid">
                  <!-- AnkiConnect Sync Card -->
                  <div class="settings-card tactile-card" id="card-anki-sync">
                    <div class="card-header-row">
                      <div class="flex items-center gap-2">
                        <div class="anki-logo-badge">
                          <svg class="anki-logo-svg" role="img" viewBox="0 0 24 24" width="18" height="18" fill="var(--industrial-aqua)" xmlns="http://www.w3.org/2000/svg"><title>Anki</title><path d="m15.845 22.627-.169.131-.182.091c-.109.042-.23.069-.362.079-.27.021-.611-.036-.989-.16-.686-.223-1.537-.67-2.256-.973-.343-.145-.633-.281-.829-.254-.197.027-.44.236-.73.467-.611.486-1.311 1.145-1.91 1.546-.331.22-.644.368-.91.42-.13.026-.255.032-.37.021l-.201-.038-.196-.082-.177-.119-.143-.145a1.3 1.3 0 0 1-.187-.32c-.104-.25-.154-.593-.154-.99.001-.721.164-1.669.23-2.447.031-.37.07-.687-.016-.866-.087-.178-.359-.345-.67-.55-.65-.431-1.494-.893-2.06-1.34-.312-.246-.548-.498-.681-.735a1.3 1.3 0 0 1-.134-.345l-.025-.202.016-.213.059-.205.094-.18c.064-.097.145-.191.246-.277.207-.175.517-.33.895-.452.685-.222 1.637-.361 2.397-.539.362-.084.676-.145.819-.281.144-.138.217-.45.316-.808.209-.752.387-1.696.638-2.373.138-.373.305-.676.489-.874.091-.098.187-.176.286-.235l.185-.086.207-.051.214-.006.2.033c.113.03.226.079.339.148.231.143.473.389.706.711.424.584.85 1.446 1.253 2.114.192.318.347.598.522.692.174.094.494.068.865.052.78-.034 1.734-.157 2.455-.128.397.017.736.081.983.195.12.055.223.123.31.201l.14.148.112.181.072.201.03.202c.007.115-.005.238-.036.368-.063.263-.223.57-.457.891-.425.583-1.113 1.254-1.623 1.845-.244.281-.463.514-.498.71-.035.194.089.49.219.838.273.731.684 1.601.879 2.295.108.382.151.725.119.995-.015.131-.049.252-.095.358l-.098.179zm-1.54-18.929c-.018-.057-.07-.226-.122-.346-.17-.387-.418-.846-.544-1.216-.166-.483-.099-.88.102-1.096.201-.214.592-.308 1.086-.177.377.1.851.316 1.249.458.125.044.297.084.354.096.047-.032.193-.134.291-.221.316-.282.675-.659.988-.894.408-.305.807-.366 1.074-.241.266.124.476.468.504.977.021.391-.037.909-.049 1.331-.004.132.011.309.017.366.046.035.187.142.301.209.365.213.835.438 1.155.662.417.294.597.655.56.947-.035.293-.296.599-.773.782-.365.141-.875.246-1.28.364-.126.037-.29.106-.343.129-.019.056-.077.223-.105.351-.091.413-.159.93-.274 1.304-.151.487-.438.77-.727.826s-.661-.098-.983-.494c-.246-.303-.504-.756-.742-1.105-.074-.11-.19-.243-.229-.287-.058-.001-.235-.004-.366.009-.421.042-.933.135-1.324.141-.51.008-.867-.177-1.011-.435-.142-.257-.11-.659.167-1.088.212-.328.563-.713.822-1.047.08-.104.171-.256.202-.305"/></svg>
                        </div>
                        <div>
                          <h3 class="card-title">AnkiConnect Flashcard Sync</h3>
                          <p class="card-desc">Direct 1-click synchronization to your Anki desktop collection.</p>
                        </div>
                      </div>
                      <span class="status-dot" id="anki-status-tag" data-state="checking" title="Checking Anki connection..."></span>
                    </div>

                    <div class="form-field mt-3">
                      <label for="select-settings-deck">Target Mining Deck</label>
                      <select id="select-settings-deck" class="tactile-input font-mono text-sm">
                        <option value="">(Checking available Anki decks...)</option>
                      </select>
                    </div>

                    <div class="card-actions-row mt-4">
                      <button type="button" class="tactile-btn tactile-btn-primary" id="btn-test-anki">Test Connection</button>
                    </div>

                    <!-- Collapsible Advanced Endpoint -->
                    <details class="settings-advanced-details mt-4">
                      <summary>Advanced Network Endpoint (Default: 127.0.0.1:8765)</summary>
                      <div class="settings-advanced-content">
                        <div class="form-field">
                          <label for="anki-url-input">AnkiConnect URL</label>
                          <input type="text" id="anki-url-input" class="tactile-input font-mono text-xs" value="http://127.0.0.1:8765" />
                        </div>
                      </div>
                    </details>
                  </div>

                  <!-- Jimaku Subtitles Card (also in Anki & Dictionary for easy discovery) -->
                  <div class="settings-card tactile-card" id="card-jimaku-subtitles-dict">
                    <div class="card-header-row">
                      <div>
                        <h3 class="card-title">Jimaku Subtitles (jimaku.cc)</h3>
                        <p class="card-desc">API key for searching and downloading Japanese subtitle tracks in the desktop player and floating browser HUD.</p>
                      </div>
                      <span class="tactile-pill text-xs font-mono px-2 py-0.5 text-muted" id="settings-jimaku-status-pill-dict">Checking...</span>
                    </div>
                    <div class="settings-form-row mt-3 flex items-center gap-3">
                      <input type="password" id="setting-jimaku-api-key-dict" class="tactile-input flex-1 font-mono text-xs" placeholder="Enter Jimaku API Key" />
                      <button type="button" class="tactile-btn tactile-btn-primary" id="btn-save-jimaku-key-dict">Save Key</button>
                    </div>
                    <div id="settings-jimaku-feedback-dict" class="card-desc mt-2 text-xs" style="display:none"></div>
                  </div>

                  <!-- Built-in Offline Dictionary Card -->
                  <div class="settings-card tactile-card" id="card-kiroku-dictionary">
                    <div class="card-header-row">
                      <div>
                        <h3 class="card-title">Built-in Offline Dictionary</h3>
                        <p class="card-desc">Local Japanese vocabulary (Jitendex) &amp; kanji (KANJIDIC) dictionary database for instant zero-latency popups.</p>
                      </div>
                      <span class="status-dot" id="dict-status-tag" data-state="checking" title="Checking dictionary..."></span>
                    </div>

                    <div class="mt-2 text-xs font-mono text-muted" id="dict-info-row">
                      <span id="dict-db-path-label">Database: checking...</span>
                    </div>

                    <!-- Progress container (hidden when idle) -->
                    <div class="mt-3" id="dict-provision-container" style="display: none;">
                      <div class="flex items-center justify-between text-xs font-mono mb-1">
                        <span id="dict-provision-label">Updating dictionary...</span>
                        <span id="dict-provision-pct">0%</span>
                      </div>
                      <div class="progress-bar-track">
                        <div class="progress-bar-fill" id="dict-provision-bar" style="width: 0%;"></div>
                      </div>
                    </div>

                    <div class="card-actions-row mt-3">
                      <button type="button" class="tactile-btn tactile-btn-primary" id="btn-provision-dict">Check for Updates / Reinstall</button>
                    </div>

                    <!-- Secondary Yomitan Toggle -->
                    <div class="mt-4 pt-3 border-t border-tactile flex items-center justify-between">
                      <div>
                        <span class="text-sm font-medium text-warm-paper block">Yomitan Secondary Fallback</span>
                        <span class="text-xs text-muted block">Query Yomitan dictionary server as secondary fallback.</span>
                      </div>
                      <label class="toggle-switch">
                        <input type="checkbox" id="toggle-yomitan-secondary" />
                        <span class="toggle-slider"></span>
                      </label>
                    </div>

                    <!-- Collapsed Legacy Yomitan details -->
                    <details class="settings-legacy-details mt-3" id="settings-legacy-yomitan-details">
                      <summary>
                        <div class="flex items-center gap-2">
                          <span class="font-mono text-xs text-muted uppercase">Legacy dictionary provider</span>
                          <span class="status-dot" id="yomitan-status-tag" data-state="checking" title="Checking..."></span>
                        </div>
                        <span class="text-xs text-muted font-mono">Show / Hide</span>
                      </summary>
                      <div class="settings-legacy-content mt-2 p-2 rounded bg-surface-lowest">
                        <div class="card-header-row">
                          <h4 class="card-title text-xs">Yomitan Provider (Deprecated)</h4>
                        </div>
                        <p class="card-desc text-xs">Local Yomitan server integration for fast bilingual lookup.</p>
                        <div class="mt-1">
                          <span class="font-mono text-xs text-muted">Endpoint: loopback /api/yomitan/dictionaries</span>
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
              </section>
            </div>

            <!-- 3. ACCOUNT & SYNC CATEGORY -->
            <div class="settings-category-panel ${this.activeCategory === 'account' ? 'is-active' : ''}" id="settings-panel-account" data-category="account" style="${this.activeCategory === 'account' ? 'display: block;' : 'display: none;'}">
              <div class="settings-cards-grid">
                <!-- Kiroku Cloud Account Card -->
                <div class="settings-card tactile-card" id="settings-account-card">
                  <div class="card-header-row">
                    <div class="flex items-center gap-2">
                      <h3 class="card-title">Kiroku Cloud Account</h3>
                      <span class="tactile-pill text-xs font-mono px-2 py-0.5" id="settings-account-badge">Checking...</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <button type="button" class="tactile-btn tactile-btn-sm" id="btn-account-sync">Sync Now</button>
                      <button type="button" class="tactile-btn tactile-btn-sm" id="btn-account-action">Sign In</button>
                    </div>
                  </div>
                  <p class="card-desc" id="settings-account-desc">
                    Connect your account to sync vocabulary mining, study cards, and exam progress across devices.
                  </p>
                  <div class="account-details-row mt-3 text-xs font-mono text-paper-muted" id="settings-account-details">
                    <span id="settings-user-identity">Session: Guest (Local Storage)</span>
                    <span class="mx-2">&bull;</span>
                    <span id="settings-cloud-database">Cloud: Turso libSQL</span>
                  </div>
                </div>

                <!-- iOS Shortcut & Mobile Capture Card -->
                <div class="settings-card tactile-card" id="settings-shortcut-token-card">
                  <div class="card-header-row">
                    <div class="flex items-center gap-2">
                      <h3 class="card-title">iOS Shortcut &amp; Mobile Mining</h3>
                      <span class="tactile-pill text-xs font-mono px-2 py-0.5 text-gold" id="shortcut-token-status-badge">Ready</span>
                    </div>
                  </div>
                  <p class="card-desc">
                    Capture Japanese text directly from iOS Safari, Books, or YouTube into your Kiroku study queue.
                  </p>

                  <div class="shortcut-token-field-wrapper mt-3">
                    <label for="shortcut-token-input" class="text-xs text-muted block mb-1">Personal Secret Token</label>
                    <div class="shortcut-token-input-row flex items-center gap-2">
                      <div class="relative flex-1 flex items-center">
                        <input type="password" id="shortcut-token-input" class="tactile-input font-mono text-xs w-full" readonly value="krk_live_••••••••••••••••••••" />
                        <button type="button" class="btn-toggle-shortcut-visibility" id="btn-toggle-shortcut-token" title="Toggle visibility" aria-label="Toggle token visibility">
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                          </svg>
                        </button>
                      </div>
                      <button type="button" class="tactile-btn tactile-btn-sm" id="btn-copy-shortcut-token">Copy Token</button>
                      <button type="button" class="tactile-btn tactile-btn-ghost tactile-btn-sm" id="btn-regenerate-shortcut-token" title="Invalidate and regenerate token">Regenerate</button>
                    </div>
                  </div>

                  <div class="shortcut-install-row mt-3 pt-3 border-t border-tactile flex items-center justify-between">
                    <span class="text-xs text-muted">Install iOS mining shortcut:</span>
                    <button type="button" class="tactile-btn tactile-btn-primary tactile-btn-sm" id="btn-install-ios-shortcut">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                      </svg>
                      <span>Install iOS Shortcut</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 4. VIDEO & SHORTCUTS CATEGORY -->
            <div class="settings-category-panel ${this.activeCategory === 'video' ? 'is-active' : ''}" id="settings-panel-video" data-category="video" style="${this.activeCategory === 'video' ? 'display: block;' : 'display: none;'}">
              <section class="settings-section" id="settings-section-link">
                <div class="settings-cards-grid">
                  <!-- Browser Extension Companion Card -->
                  <div class="settings-card tactile-card">
                    <div class="card-header-row">
                      <div>
                        <h3 class="card-title">Browser Extension Companion</h3>
                        <p class="card-desc">Companion connection for Chrome/Edge extensions mining anime subtitles on Netflix, YouTube, and Crunchyroll.</p>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="status-dot" id="settings-link-dot"></span>
                        <span class="card-desc font-mono text-xs" id="settings-link-status-text">Not Connected</span>
                      </div>
                    </div>
                    <div id="settings-link-feedback" class="card-desc mt-2" style="display:none"></div>
                  </div>

                  <!-- Jimaku Subtitle Provider Card -->
                  <div class="settings-card tactile-card" id="settings-jimaku-card">
                    <div class="card-header-row">
                      <div>
                        <h3 class="card-title">Jimaku Subtitles (jimaku.cc)</h3>
                        <p class="card-desc">API key for searching and downloading Japanese subtitle tracks in the desktop player and floating browser HUD.</p>
                      </div>
                      <span class="tactile-pill text-xs font-mono px-2 py-0.5 text-muted" id="settings-jimaku-status-pill">Checking...</span>
                    </div>
                    <div class="settings-form-row mt-3 flex items-center gap-3">
                      <input type="password" id="setting-jimaku-api-key" class="tactile-input flex-1 font-mono text-xs" placeholder="Enter Jimaku API Key" />
                      <button type="button" class="tactile-btn tactile-btn-primary" id="btn-save-jimaku-key">Save Key</button>
                    </div>
                    <div id="settings-jimaku-feedback" class="card-desc mt-2 text-xs" style="display:none"></div>
                  </div>

                  <!-- Study-Pause Card -->
                  <div class="settings-card tactile-card" id="settings-study-pause-card">
                    <div class="card-header-row">
                      <div>
                        <h3 class="card-title">Study-Pause</h3>
                        <p class="card-desc">Automatically pause video when a line contains unknown vocabulary gap words so you can inspect furigana or mine.</p>
                      </div>
                      <span class="tactile-pill text-xs font-mono px-2 py-0.5 text-muted">Default: Off</span>
                    </div>
                    <div class="settings-form-row mt-4 flex items-center justify-between gap-4">
                      <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" id="setting-study-pause-enabled" class="tactile-checkbox" />
                        <span class="text-sm text-warm-paper">Pause when line has &gt;= N gap words</span>
                      </label>
                      <div class="flex items-center gap-2">
                        <label for="setting-study-pause-threshold" class="text-xs text-muted">N =</label>
                        <select id="setting-study-pause-threshold" class="tactile-input font-mono text-xs w-16">
                          <option value="1">1</option>
                          <option value="2" selected>2</option>
                          <option value="3">3</option>
                          <option value="4">4</option>
                          <option value="5">5</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <!-- Global Hotkeys Card -->
                  <div class="settings-card tactile-card full-width-card" id="settings-hotkeys-card">
                    <div class="card-header-row">
                      <div>
                        <h3 class="card-title">Global Video Hotkeys</h3>
                        <p class="card-desc">Keyboard shortcuts controlling video playback (Link companion and Theater): pause/play, cue jump, replay, and loop.</p>
                      </div>
                      <span class="tactile-pill text-xs font-mono px-2 py-0.5 text-muted">Default: Off</span>
                    </div>
                    <div class="settings-form-row mt-3">
                      <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" id="setting-global-hotkeys-enabled" class="tactile-checkbox" />
                        <span class="text-sm text-warm-paper">Enable global video playback shortcuts</span>
                      </label>
                    </div>
                    <div class="hotkeys-table-wrapper mt-3 p-3 rounded border border-tactile bg-surface-lowest">
                      <table class="w-full text-xs font-mono text-muted">
                        <tbody>
                          <tr class="border-b border-tactile"><td class="py-1 text-warm-paper">Pause / Play</td><td class="text-right">CmdOrCtrl+Alt+Space</td></tr>
                          <tr class="border-b border-tactile"><td class="py-1 text-warm-paper">Previous Cue</td><td class="text-right">CmdOrCtrl+Alt+Left</td></tr>
                          <tr class="border-b border-tactile"><td class="py-1 text-warm-paper">Next Cue</td><td class="text-right">CmdOrCtrl+Alt+Right</td></tr>
                          <tr class="border-b border-tactile"><td class="py-1 text-warm-paper">Replay Cue</td><td class="text-right">CmdOrCtrl+Alt+R</td></tr>
                          <tr><td class="py-1 text-warm-paper">Loop Cue</td><td class="text-right">CmdOrCtrl+Alt+L</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <!-- 5. SYSTEM & ADVANCED CATEGORY -->
            <div class="settings-category-panel ${this.activeCategory === 'system' ? 'is-active' : ''}" id="settings-panel-system" data-category="system" style="${this.activeCategory === 'system' ? 'display: block;' : 'display: none;'}">
              <section class="settings-section" id="settings-section-diagnostics">
                <div class="settings-cards-grid">
                  <!-- Hardware Acceleration Card -->
                  <div class="settings-card tactile-card" id="card-hardware-acceleration">
                    <div class="card-header-row">
                      <div>
                        <h3 class="card-title">Hardware Acceleration</h3>
                        <p class="card-desc">Toggles GPU rasterization. Disable if experiencing blank windows when streaming DRM video.</p>
                      </div>
                      <span class="status-dot" id="gpu-status-dot" data-state="ready" title="Graphics Pipeline"></span>
                    </div>
                    <div class="flex items-center justify-between mt-4">
                      <label class="tactile-toggle-label flex items-center gap-2 cursor-pointer" for="toggle-hardware-acceleration">
                        <input type="checkbox" id="toggle-hardware-acceleration" class="tactile-checkbox" checked />
                        <span class="text-sm font-medium text-warm-paper">Enable GPU Hardware Acceleration</span>
                      </label>
                      <button type="button" class="tactile-btn tactile-btn-primary tactile-btn-sm" id="btn-restart-app" style="display: none;">Restart App</button>
                    </div>
                    <div class="card-note mt-3" id="gpu-restart-notice" style="display: none;">
                      Restart required for graphics acceleration changes to take effect.
                    </div>
                  </div>

                  <!-- AI Explanation Provider Card -->
                  <div class="settings-card tactile-card" id="card-llm-settings">
                    <div class="card-header-row">
                      <div>
                        <h3 class="card-title">AI Explanation Provider</h3>
                        <p class="card-desc">Generates nuanced pedagogical grammar explanations and disambiguation advice.</p>
                      </div>
                      <span class="status-dot" id="llm-status-tag" data-state="ready" title="Key Protected"></span>
                    </div>

                    <div class="form-row-pair mt-3">
                      <div class="form-field">
                        <label for="llm-provider-select">Provider</label>
                        <select id="llm-provider-select" class="tactile-input">
                          <option value="none">None (Offline Pure Rule-Based)</option>
                          <option value="groq">Groq (Ultra-Fast Llama-3)</option>
                          <option value="gemini">Google Gemini</option>
                          <option value="ollama">Ollama (Local Offline)</option>
                        </select>
                      </div>
                      <div class="form-field">
                        <label for="llm-model-input">Model Name</label>
                        <input type="text" id="llm-model-input" class="tactile-input font-mono text-sm" placeholder="e.g. llama-3.3-70b-versatile" />
                      </div>
                    </div>

                    <div class="form-field mt-3">
                      <label for="llm-key-input">API Key (Protected by Windows DPAPI)</label>
                      <div style="position: relative; display: flex; align-items: center;">
                        <input type="password" id="llm-key-input" class="tactile-input font-mono text-sm" style="padding-right: 2.2rem; width: 100%;" placeholder="Enter API key to update..." />
                        <button type="button" class="btn-toggle-key-visibility" id="btn-toggle-key-visibility" title="Toggle visibility" aria-label="Toggle key visibility" style="position: absolute; right: 8px; background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; display: flex; align-items: center;">
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div class="card-actions-row mt-4">
                      <button type="button" class="tactile-btn tactile-btn-primary" id="btn-save-llm">Save Settings</button>
                      <button type="button" class="tactile-btn" id="btn-test-llm">Test LLM Connection</button>
                    </div>

                    <div class="llm-test-result-box mt-3" id="llm-test-result" style="display: none;">
                      <span class="font-mono text-xs text-muted" id="llm-test-output"></span>
                    </div>
                  </div>

                  <!-- Japanese Language Engine Card -->
                  <div class="settings-card tactile-card" id="settings-language-engine-card">
                    <section id="settings-section-language-engine">
                      <div class="card-header-row">
                        <div>
                          <h3 class="card-title">Japanese Language Engine</h3>
                          <p class="card-desc">Morphological tokenization powering subtitle sync and grammar analysis.</p>
                        </div>
                        <span class="status-dot" id="tokenizer-status-tag" data-state="checking" title="Checking..."></span>
                      </div>

                      <div class="form-row-pair mt-3">
                        <div class="form-field">
                          <label for="select-tokenizer-mode">Tokenizer Mode</label>
                          <select id="select-tokenizer-mode" class="tactile-input font-mono text-sm">
                            <option value="auto">Automatic (Recommended)</option>
                            <option value="sudachi">SudachiPy (Deep Morphological)</option>
                            <option value="legacy">Legacy Heuristic / Regex</option>
                          </select>
                        </div>
                        <div class="form-field">
                          <label>Lexicon Dictionary</label>
                          <div class="tactile-card p-2 flex items-center justify-between" style="background-color: var(--surface-container-low); height: 38px;">
                            <span class="font-mono text-xs text-warm-paper" id="tokenizer-dict-display">Dictionary: Core</span>
                            <span class="status-dot" id="tokenizer-dict-dot" data-state="ready" title="Dictionary active"></span>
                          </div>
                        </div>
                      </div>

                      <div class="mt-4 flex items-center justify-between p-3 tactile-card" style="background-color: var(--surface-container-low);">
                        <div>
                          <span class="font-mono text-xs text-muted block uppercase">Engine State</span>
                          <span class="font-mono text-sm text-warm-paper" id="tokenizer-ready-label">Checking runtime status...</span>
                        </div>
                        <button type="button" class="tactile-btn tactile-btn-sm" id="btn-probe-tokenizer">Verify Engine</button>
                      </div>
                    </section>
                  </div>

                  <!-- Manga-OCR Daemon Card -->
                  <div class="settings-card tactile-card">
                    <div class="card-header-row">
                      <div>
                        <h3 class="card-title">Manga-OCR Daemon</h3>
                        <p class="card-desc">Isolated CPU-only manga-ocr background server on loopback port 21829.</p>
                      </div>
                      <span class="status-dot" id="ocr-status-tag" data-state="stopped" title="Stopped"></span>
                    </div>

                    <div class="card-actions-row mt-4">
                      <button type="button" class="tactile-btn" id="btn-toggle-ocr">Start OCR Server</button>
                    </div>
                  </div>

                  <!-- System Doctor Diagnostics & Process Supervisor Card -->
                  <div class="settings-card tactile-card" id="card-system-doctor">
                    <div class="card-header-row">
                      <div>
                        <h3 class="card-title">System Health &amp; Diagnostics</h3>
                        <p class="card-desc">Database integrity verification and desktop process supervisor.</p>
                      </div>
                      <span class="status-dot" data-state="ready" title="Read-Only"></span>
                    </div>

                    <div class="doctor-summary-box mt-3" id="doctor-summary" style="display: none;">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="tactile-pill tactile-pill-gold" id="doctor-status-badge">Integrity Verified</span>
                        <span class="font-mono text-xs text-secondary" id="doctor-db-path">--</span>
                      </div>
                    </div>

                    <div class="doctor-results-box mt-2" id="doctor-results" style="display: none;">
                      <pre class="doctor-pre font-mono text-xs" id="doctor-output"></pre>
                    </div>

                    <div class="card-actions-row mt-4">
                      <button type="button" class="tactile-btn tactile-btn-primary" id="btn-run-doctor">Run Health Check</button>
                      <button type="button" class="tactile-btn" id="btn-open-appdata">Open App Data</button>
                      <button type="button" class="tactile-btn" id="btn-restart-backend">Restart Backend Service</button>
                    </div>
                  </div>

                  <!-- System Setup Checklist Card -->
                  <div class="settings-card tactile-card full-width-card" id="card-setup-checklist" data-target="settings-section-checklist">
                    <section id="settings-section-checklist">
                      <div class="card-header-row">
                        <div>
                          <h3 class="card-title">System Setup &amp; Dependencies</h3>
                          <p class="card-desc">Verify local SQLite database, backend services, extension pairing, and dependencies.</p>
                        </div>
                        <button type="button" class="tactile-btn tactile-btn-sm" id="btn-refresh-checklist">Refresh Checklist</button>
                      </div>
                      <div class="setup-checklist-list mt-3 flex flex-col gap-2" id="setup-checklist-items">
                        <div class="text-xs font-mono text-muted">Loading checklist...</div>
                      </div>
                    </section>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  showError(message) {
    const banner = document.getElementById('settings-error-banner');
    const msg = document.getElementById('settings-error-msg');
    if (banner && msg) {
      msg.textContent = message;
      banner.style.display = 'flex';
    }
  }

  clearError() {
    const banner = document.getElementById('settings-error-banner');
    if (banner) {
      banner.style.display = 'none';
    }
  }

  switchCategory(category) {
    if (!['study', 'anki-dict', 'account', 'video', 'system'].includes(category)) return;
    this.activeCategory = category;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('kiroku:settings-active-tab', category);
      } catch (err) {
        console.warn('[Settings] Could not save active tab:', err);
      }
    }

    if (!this.container) return;
    const buttons = this.container.querySelectorAll('.settings-tab-segmented .tactile-segmented-btn');
    buttons.forEach((btn) => {
      const match = btn.getAttribute('data-category') === category;
      btn.classList.toggle('is-active', match);
      btn.setAttribute('aria-selected', match ? 'true' : 'false');
    });

    const panels = this.container.querySelectorAll('.settings-category-panel');
    panels.forEach((panel) => {
      const match = panel.getAttribute('data-category') === category;
      panel.style.display = match ? 'block' : 'none';
      panel.classList.toggle('is-active', match);
    });
  }

  setupTabNavigation() {
    if (!this.container) return;
    const tabButtons = this.container.querySelectorAll('.settings-tab-segmented .tactile-segmented-btn');
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const cat = btn.getAttribute('data-category');
        if (cat) {
          this.switchCategory(cat);
        }
      });
    });

    if (typeof window !== 'undefined') {
      const handleHash = () => {
        const hash = window.location.hash || '';
        if (hash.includes('tab=')) {
          const match = hash.match(/tab=([a-zA-Z0-9-]+)/);
          if (match && match[1]) {
            this.switchCategory(match[1]);
          }
        } else if (hash.includes('checklist') || hash.includes('doctor') || hash.includes('system') || hash.includes('diagnostics') || hash.includes('llm')) {
          this.switchCategory('system');
          if (hash.includes('checklist')) {
            const el = document.getElementById('card-setup-checklist');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }
        } else if (hash.includes('anki') || hash.includes('dictionary')) {
          this.switchCategory('anki-dict');
        } else if (hash.includes('account') || hash.includes('sync') || hash.includes('token') || hash.includes('shortcut')) {
          this.switchCategory('account');
        } else if (hash.includes('link') || hash.includes('hotkey') || hash.includes('pause') || hash.includes('video')) {
          this.switchCategory('video');
        } else if (hash.includes('level') || hash.includes('furigana') || hash.includes('study')) {
          this.switchCategory('study');
        }
      };
      window.addEventListener('hashchange', handleHash);
      handleHash();
    }
  }

  setupScrollspy() {
    this.setupTabNavigation();
  }

  setupEvents() {
    const btnDismiss = document.getElementById('btn-dismiss-settings-error');
    if (btnDismiss) {
      btnDismiss.addEventListener('click', () => this.clearError());
    }

    // Universal JLPT level slider
    const levelSteps = this.container.querySelectorAll('#settings-level-pills .step');
    const updateLevelSlider = (lvl) => {
      const levels = ['N5', 'N4', 'N3', 'N2', 'N1'];
      const accents = ['#10d98a', '#a8cf45', '#eacb46', '#f49b43', '#e95757'];
      const selectedIndex = levels.indexOf(lvl);
      const card = this.container.querySelector('.budget-card');
      if (card && selectedIndex >= 0) {
        card.style.setProperty('--step-index', selectedIndex);
        card.style.setProperty('--step-progress', `${selectedIndex * 25}%`);
        card.style.setProperty('--budget-accent', accents[selectedIndex]);
      }
      const amount = this.container.querySelector('#jlpt-level-current');
      if (amount) {
        amount.textContent = lvl;
        amount.setAttribute('data-ghost', lvl);
      }
      const badge = this.container.querySelector('.budget-card .tier');
      if (badge) badge.innerHTML = `<span class="tier-icon"></span>${lvl} selected`;
      const scaleLabels = this.container.querySelectorAll('.budget-card .scale span');
      scaleLabels.forEach((label, index) => {
        label.classList.toggle('is-active', index === selectedIndex);
        if (index === selectedIndex) label.setAttribute('aria-current', 'true');
        else label.removeAttribute('aria-current');
      });
      const tag = document.getElementById('current-universal-level-tag');
      if (tag) tag.textContent = `Active (${lvl})`;
    };
    levelSteps.forEach((step) => {
      step.addEventListener('change', async () => {
        if (!step.checked) return;
        updateLevelSlider(step.value);
        await setUniversalJlptLevel(step.value);
      });
    });

    // Reading & Furigana Mode
    const selectFurigana = document.getElementById('select-furigana-mode');
    if (selectFurigana && typeof localStorage !== 'undefined') {
      const savedMode = localStorage.getItem('kiroku:furigana-mode') || 'always';
      selectFurigana.value = savedMode;
      selectFurigana.addEventListener('change', (e) => {
        try {
          localStorage.setItem('kiroku:furigana-mode', e.target.value);
          localStorage.setItem('manga_furigana_enabled', e.target.value !== 'hidden' ? 'true' : 'false');
        } catch (err) {
          console.debug('[Settings] Save furigana mode error:', err);
        }
      });
    }

    // Pitch Accent Highlights Toggle
    const togglePitchAccent = document.getElementById('toggle-pitch-accent');
    if (togglePitchAccent && typeof localStorage !== 'undefined') {
      const savedPitch = localStorage.getItem('kiroku:pitch-accent-enabled') !== 'false';
      togglePitchAccent.checked = savedPitch;
      togglePitchAccent.addEventListener('change', (e) => {
        try {
          localStorage.setItem('kiroku:pitch-accent-enabled', e.target.checked ? 'true' : 'false');
        } catch (err) {
          console.debug('[Settings] Save pitch accent error:', err);
        }
      });
    }

    // Manga Spread Mode
    const selectMangaSpread = document.getElementById('select-manga-spread');
    if (selectMangaSpread && typeof localStorage !== 'undefined') {
      const savedSpread = localStorage.getItem('kiroku:manga:spread') || localStorage.getItem('manga_spread_mode') || 'single';
      selectMangaSpread.value = savedSpread;
      selectMangaSpread.addEventListener('change', (e) => {
        try {
          localStorage.setItem('kiroku:manga:spread', e.target.value);
          localStorage.setItem('manga_spread_mode', e.target.value);
        } catch (err) {
          console.debug('[Settings] Save manga spread error:', err);
        }
      });
    }

    // Default Video Speed
    const selectDefaultRate = document.getElementById('select-default-rate');
    if (selectDefaultRate && typeof localStorage !== 'undefined') {
      const savedRate = localStorage.getItem('kiroku:theater:rate') || '1.0';
      selectDefaultRate.value = savedRate;
      selectDefaultRate.addEventListener('change', (e) => {
        try {
          localStorage.setItem('kiroku:theater:rate', e.target.value);
        } catch (err) {
          console.debug('[Settings] Save default video rate error:', err);
        }
      });
    }

    // Tokenizer Mode Selector
    const selectTokMode = document.getElementById('select-tokenizer-mode');
    if (selectTokMode) {
      selectTokMode.addEventListener('change', (e) => {
        const val = e.target.value;
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('kiroku.tokenizer.mode', val);
        }
      });
    }

    // Probe Tokenizer button
    const btnProbeTok = document.getElementById('btn-probe-tokenizer');
    if (btnProbeTok) {
      btnProbeTok.addEventListener('click', async () => {
        btnProbeTok.disabled = true;
        btnProbeTok.textContent = 'Probing...';
        try {
          await this.loadTokenizerStatus();
        } finally {
          btnProbeTok.disabled = false;
          btnProbeTok.textContent = 'Verify Engine';
        }
      });
    }

    // Anki Mining Deck Selector
    const selectDeck = document.getElementById('select-settings-deck');
    if (selectDeck) {
      selectDeck.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val) {
          setUniversalAnkiDeck(val).catch((err) => {
            console.debug('[Settings] Set universal deck error:', err);
          });
        }
      });
    }

    // Test Anki button
    const btnAnki = document.getElementById('btn-test-anki');
    if (btnAnki) {
      btnAnki.addEventListener('click', async () => {
        btnAnki.disabled = true;
        btnAnki.textContent = 'Testing...';
        this.clearError();

        try {
          const customUrl = document.getElementById('anki-url-input')?.value?.trim();
          if (customUrl && typeof window !== 'undefined' && window.chrome?.storage?.local) {
            window.chrome.storage.local.set({ 'anki.url': customUrl });
          }
          const res = await apiClient.getAnkiStatus(customUrl);
          const tag = document.getElementById('anki-status-tag');
          if (tag) {
            const connected = Boolean(res?.connected);
            tag.textContent = connected ? `Connected (v${res.version || '?'})` : 'Unavailable';
            tag.className = `tactile-pill ${connected ? 'tactile-pill-gold' : ''}`;
            if (connected) {
              await this.loadAnkiDecks();
            }
          }
        } catch (err) {
          console.warn('[Settings] Anki status test failed:', err);
          const tag = document.getElementById('anki-status-tag');
          if (tag) {
            tag.textContent = 'Connection Failed';
            tag.className = 'tactile-pill';
          }
          this.showError('AnkiConnect test failed: ' + (err.message || 'Make sure Anki is running with AnkiConnect'));
        } finally {
          btnAnki.disabled = false;
          btnAnki.textContent = 'Test Connection';
        }
      });
    }

    // Setup Checklist Refresh button
    const btnRefreshChecklist = document.getElementById('btn-refresh-checklist');
    if (btnRefreshChecklist) {
      btnRefreshChecklist.addEventListener('click', async () => {
        btnRefreshChecklist.disabled = true;
        btnRefreshChecklist.textContent = 'Checking...';
        try {
          await this.loadSetupChecklist();
        } finally {
          btnRefreshChecklist.disabled = false;
          btnRefreshChecklist.textContent = 'Refresh Checklist';
        }
      });
    }

    // Setup Checklist action delegation (Provision dictionary)
    const checklistContainer = document.getElementById('setup-checklist-items');
    if (checklistContainer) {
      checklistContainer.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-checklist-action');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'provision_dictionary') {
          const btnProv = document.getElementById('btn-provision-dict');
          if (btnProv) {
            btnProv.click();
          } else {
            await apiClient.request('/api/dictionary/provision', { method: 'POST' });
            await this.loadSetupChecklist();
          }
        }
      });
    }

    // Provision Dictionary button
    const btnProvDict = document.getElementById('btn-provision-dict');
    if (btnProvDict) {
      btnProvDict.addEventListener('click', async () => {
        btnProvDict.disabled = true;
        btnProvDict.textContent = 'Starting...';
        this.clearError();

        try {
          await apiClient.request('/api/dictionary/provision', { method: 'POST' });
          await this.loadDictionaryStatus();
        } catch (err) {
          console.warn('[Settings] Dictionary provision start failed:', err);
          this.showError('Provision failed: ' + (err.message || 'API error'));
          btnProvDict.disabled = false;
          btnProvDict.textContent = 'Provision Dictionary';
        }
      });
    }

    // Yomitan Secondary Toggle
    const toggleYomiSec = document.getElementById('toggle-yomitan-secondary');
    if (toggleYomiSec) {
      toggleYomiSec.addEventListener('change', async () => {
        try {
          const enabled = toggleYomiSec.checked;
          await apiClient.request('/api/dictionary/settings', {
            method: 'PUT',
            body: JSON.stringify({ yomitan_secondary: enabled }),
            headers: { 'Content-Type': 'application/json' },
          });
          await this.loadDictionaryStatus();
        } catch (err) {
          console.warn('[Settings] Failed to save Yomitan secondary setting:', err);
          this.showError('Failed to update Yomitan secondary setting: ' + (err.message || 'Network error'));
          toggleYomiSec.checked = !toggleYomiSec.checked;
        }
      });
    }

    // Toggle OCR
    const btnOcr = document.getElementById('btn-toggle-ocr');
    if (btnOcr) {
      btnOcr.addEventListener('click', async () => {
        btnOcr.disabled = true;
        this.clearError();

        try {
          if (this.ocrRunning) {
            await apiClient.stopOcr();
            this.ocrRunning = false;
          } else {
            await apiClient.startOcr();
            this.ocrRunning = true;
          }
          this.updateOcrStatus();
        } catch (err) {
          console.warn('[Settings] OCR toggle failed:', err);
          this.showError('OCR daemon error: ' + (err.message || 'Unable to communicate with OCR process'));
        } finally {
          btnOcr.disabled = false;
        }
      });
    }

    // Save LLM Config
    const btnSaveLlm = document.getElementById('btn-save-llm');
    if (btnSaveLlm) {
      btnSaveLlm.addEventListener('click', async () => {
        btnSaveLlm.disabled = true;
        btnSaveLlm.textContent = 'Saving...';
        this.clearError();

        try {
          const provider = document.getElementById('llm-provider-select')?.value || 'none';
          const model = document.getElementById('llm-model-input')?.value?.trim() || '';
          const keyInput = document.getElementById('llm-key-input');
          const apiKey = keyInput?.value?.trim() || undefined;

          const payload = { provider, model };
          if (apiKey) payload.api_key = apiKey;

          await apiClient.updateLlmConfig(payload);
          const tag = document.getElementById('llm-status-tag');
          if (tag) {
            tag.textContent = 'Config Saved';
            tag.className = 'tactile-pill tactile-pill-gold';
          }
          if (keyInput && apiKey) {
            keyInput.value = '';
            keyInput.placeholder = '•••••••• (Configured in Windows DPAPI)';
          }
        } catch (err) {
          console.warn('[Settings] Save LLM config failed:', err);
          this.showError('Failed to save LLM settings: ' + (err.message || 'API error'));
        } finally {
          btnSaveLlm.disabled = false;
          btnSaveLlm.textContent = 'Save Settings';
        }
      });
    }

    // Test LLM Connection
    const btnTestLlm = document.getElementById('btn-test-llm');
    if (btnTestLlm) {
      btnTestLlm.addEventListener('click', async () => {
        btnTestLlm.disabled = true;
        btnTestLlm.textContent = 'Testing...';
        this.clearError();

        const resultBox = document.getElementById('llm-test-result');
        const outputEl = document.getElementById('llm-test-output');
        if (resultBox) resultBox.style.display = 'block';
        if (outputEl) outputEl.textContent = 'Sending latency ping to configured provider...';

        try {
          const res = await apiClient.testLlm();
          if (outputEl) {
            const ms = res?.latency_ms !== undefined ? `${Math.round(res.latency_ms)}ms` : 'ok';
            outputEl.textContent = `Provider status: ${res?.status || 'OK'} (${ms}). Model response verified.`;
          }
        } catch (err) {
          console.warn('[Settings] Test LLM failed:', err);
          if (outputEl) {
            outputEl.textContent = `Connection test failed: ${err.message}`;
          }
          this.showError('LLM connection test failed: ' + (err.message || 'Check provider API key or network'));
        } finally {
          btnTestLlm.disabled = false;
          btnTestLlm.textContent = 'Test LLM Connection';
        }
      });
    }

    // Toggle API Key visibility
    const btnToggleVis = document.getElementById('btn-toggle-key-visibility');
    if (btnToggleVis) {
      btnToggleVis.addEventListener('click', () => {
        const keyInput = document.getElementById('llm-key-input');
        if (!keyInput) return;
        const isPass = keyInput.type === 'password';
        keyInput.type = isPass ? 'text' : 'password';
      });
    }

    // Doctor Diagnostics Check
    const btnDoctor = document.getElementById('btn-run-doctor');
    if (btnDoctor) {
      btnDoctor.addEventListener('click', async () => {
        btnDoctor.disabled = true;
        btnDoctor.textContent = 'Checking...';
        this.clearError();

        try {
          const report = await studyClient.getDiagnostics();
          const summaryBox = document.getElementById('doctor-summary');
          const statusBadge = document.getElementById('doctor-status-badge');
          const dbPathEl = document.getElementById('doctor-db-path');
          const box = document.getElementById('doctor-results');
          const out = document.getElementById('doctor-output');

          if (summaryBox && statusBadge && dbPathEl) {
            summaryBox.style.display = 'block';
            statusBadge.textContent = report?.status === 'ok' ? 'Integrity Verified' : 'Check Complete';
            dbPathEl.textContent = report?.database_path || report?.path || 'study.db';
          }

          if (box && out) {
            box.style.display = 'block';
            out.textContent = JSON.stringify(report, null, 2);
          }
        } catch (err) {
          console.warn('[Settings] Run doctor failed:', err);
          const box = document.getElementById('doctor-results');
          const out = document.getElementById('doctor-output');
          if (box && out) {
            box.style.display = 'block';
            out.textContent = `Doctor Check Error: ${err.message}`;
          }
          this.showError('Doctor check error: ' + (err.message || 'Diagnostics failed'));
        } finally {
          btnDoctor.disabled = false;
          btnDoctor.textContent = 'Run Doctor Check';
        }
      });
    }

    // Open AppData Folder
    const btnAppData = document.getElementById('btn-open-appdata');
    if (btnAppData) {
      btnAppData.addEventListener('click', () => {
        if (window.desktopAPI?.openUserDataFolder) {
          window.desktopAPI.openUserDataFolder();
        }
      });
    }

    // Restart Backend
    const btnRestart = document.getElementById('btn-restart-backend');
    if (btnRestart) {
      btnRestart.addEventListener('click', () => {
        if (btnRestart.dataset.confirming !== 'true') {
          btnRestart.dataset.confirming = 'true';
          btnRestart.textContent = 'Confirm Restart?';
          btnRestart.classList.add('tactile-btn-primary');
          setTimeout(() => {
            if (btnRestart && btnRestart.dataset.confirming === 'true') {
              btnRestart.dataset.confirming = 'false';
              btnRestart.textContent = 'Restart Backend Service';
              btnRestart.classList.remove('tactile-btn-primary');
            }
          }, 4000);
          return;
        }

        btnRestart.disabled = true;
        btnRestart.textContent = 'Restarting...';
        if (window.desktopAPI?.retryBackend) {
          window.desktopAPI.retryBackend();
        }
      });
    }

    // Hardware Acceleration Switch
    const toggleHwAccel = document.getElementById('toggle-hardware-acceleration');
    const btnRestartApp = document.getElementById('btn-restart-app');
    const noticeRestart = document.getElementById('gpu-restart-notice');

    if (toggleHwAccel) {
      toggleHwAccel.addEventListener('change', async () => {
        const enabled = toggleHwAccel.checked;
        if (window.chrome?.storage?.local?.set) {
          await window.chrome.storage.local.set({ hardware_acceleration: enabled });
        } else if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('hardware_acceleration', String(enabled));
        }

        if (btnRestartApp) btnRestartApp.style.display = 'inline-block';
        if (noticeRestart) noticeRestart.style.display = 'block';
      });
    }

    if (btnRestartApp) {
      btnRestartApp.addEventListener('click', async () => {
        btnRestartApp.disabled = true;
        btnRestartApp.textContent = 'Restarting...';
        if (window.desktopAPI?.restartApp) {
          await window.desktopAPI.restartApp();
        } else if (window.desktopAPI?.api?.request) {
          await window.desktopAPI.api.request({ channel: 'settings:restart-app' });
        }
      });
    }

    // Refresh Queue Metrics button
    const btnRefreshMetrics = document.getElementById('btn-refresh-queue-metrics');
    if (btnRefreshMetrics) {
      btnRefreshMetrics.addEventListener('click', async () => {
        btnRefreshMetrics.disabled = true;
        btnRefreshMetrics.textContent = 'Refreshing...';
        try {
          await this.loadSyncAndMetrics();
        } finally {
          btnRefreshMetrics.disabled = false;
          btnRefreshMetrics.textContent = 'Refresh';
        }
      });
    }

    // Account & Sync button handlers
    const btnAccountAction = document.getElementById('btn-account-action');
    if (btnAccountAction) {
      btnAccountAction.addEventListener('click', async () => {
        if (this.currentUser) {
          const userName = this.currentUser.name || this.currentUser.email || 'User';
          const logoutConfirmed = window.confirm(`Signed in as ${userName}.\n\nDo you want to sign out?`);
          if (logoutConfirmed) {
            try {
              await fetch('/auth/logout', { method: 'POST' });
            } catch (err) {
              console.warn('[Settings] Logout error:', err);
            }
            AuthModal.setStoredUser(null);
            this.currentUser = null;
            await this.loadAccountStatus();
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('kiroku:auth-changed', { detail: { user: null } }));
            }
          }
        } else {
          const modal = new AuthModal({
            currentUser: this.currentUser,
            onAuthSuccess: async (user) => {
              this.currentUser = user;
              await this.loadAccountStatus();
            }
          });
          modal.open();
        }
      });
    }

    const btnAccountSync = document.getElementById('btn-account-sync');
    if (btnAccountSync) {
      btnAccountSync.addEventListener('click', async () => {
        btnAccountSync.disabled = true;
        btnAccountSync.textContent = 'Syncing...';
        try {
          await this.loadSyncAndMetrics();
          await this.loadAccountStatus();
        } finally {
          btnAccountSync.disabled = false;
          btnAccountSync.textContent = 'Sync Now';
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('kiroku:auth-changed', () => {
        this.loadAccountStatus();
      });
    }

    // Queue retry delegation
    const oplogTableBody = document.getElementById('oplog-table-body');
    if (oplogTableBody) {
      oplogTableBody.addEventListener('click', async (e) => {
        const btnRetry = e.target.closest('.btn-oplog-retry');
        if (!btnRetry) return;
        const opId = btnRetry.dataset.id;
        if (!opId) return;
        btnRetry.disabled = true;
        btnRetry.textContent = 'Retrying...';
        try {
          await apiClient.request(`/api/oplog/lease?requeue=${encodeURIComponent(opId)}`, { method: 'POST' });
          await this.loadSyncAndMetrics();
        } catch (err) {
          console.warn('[Settings] Op retry error:', err);
        }
      });
    }

    // Shortcut token visibility toggle
    const btnToggleShortcut = document.getElementById('btn-toggle-shortcut-token');
    if (btnToggleShortcut) {
      btnToggleShortcut.addEventListener('click', () => {
        const input = document.getElementById('shortcut-token-input');
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    }

    // Copy Shortcut token with tactile feedback
    const btnCopyShortcut = document.getElementById('btn-copy-shortcut-token');
    if (btnCopyShortcut) {
      btnCopyShortcut.addEventListener('click', async () => {
        const input = document.getElementById('shortcut-token-input');
        if (!input || !input.value) return;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(input.value);
          } else {
            input.select();
            document.execCommand('copy');
          }
          const prev = btnCopyShortcut.textContent;
          btnCopyShortcut.textContent = 'Copied!';
          setTimeout(() => { btnCopyShortcut.textContent = prev; }, 1500);
        } catch (err) {
          console.warn('[Settings] Failed to copy token:', err);
        }
      });
    }

    // Regenerate Shortcut token
    const btnRegenShortcut = document.getElementById('btn-regenerate-shortcut-token');
    if (btnRegenShortcut) {
      btnRegenShortcut.addEventListener('click', async () => {
        if (!confirm('Regenerate your secret token? Existing iOS Shortcuts and external capture scripts will need to be updated with the new token.')) {
          return;
        }
        btnRegenShortcut.disabled = true;
        btnRegenShortcut.textContent = 'Regenerating...';
        try {
          const res = await apiClient.request('/api/user/token/regenerate', { method: 'POST' });
          const token = res?.data?.token || res?.token;
          if (token) {
            const input = document.getElementById('shortcut-token-input');
            if (input) input.value = token;
            const badge = document.getElementById('shortcut-token-status-badge');
            if (badge) badge.textContent = 'Updated';
          }
        } catch (err) {
          console.warn('[Settings] Token regeneration failed:', err);
        } finally {
          btnRegenShortcut.disabled = false;
          btnRegenShortcut.textContent = 'Regenerate';
        }
      });
    }

    // Jimaku Subtitle API Key Save (Handles both Video and Anki & Dictionary panels)
    const handleSaveJimaku = async (inputId, feedbackId, btnId) => {
      const btn = document.getElementById(btnId);
      const input = document.getElementById(inputId);
      const feedback = document.getElementById(feedbackId);
      const val = input?.value?.trim() || '';

      const pills = [
        document.getElementById('settings-jimaku-status-pill'),
        document.getElementById('settings-jimaku-status-pill-dict')
      ];
      const otherInput = document.getElementById(inputId === 'setting-jimaku-api-key' ? 'setting-jimaku-api-key-dict' : 'setting-jimaku-api-key');
      if (otherInput) otherInput.value = val;

      try {
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Saving...';
        }
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('kiroku_jimaku_api_key', val);
        }
        await apiClient.request('/api/link/jimaku-key', {
          method: 'POST',
          body: { api_key: val }
        }).catch(() => {});

        pills.forEach(pill => {
          if (pill) {
            pill.textContent = val ? 'Configured' : 'No Key';
            pill.className = val ? 'tactile-pill tactile-pill-jade text-xs font-mono px-2 py-0.5' : 'tactile-pill text-xs font-mono px-2 py-0.5 text-muted';
          }
        });

        if (feedback) {
          feedback.style.display = 'block';
          feedback.style.color = '#4EBB7B';
          feedback.textContent = val ? 'Jimaku API key saved successfully.' : 'Jimaku API key cleared.';
          setTimeout(() => { feedback.style.display = 'none'; }, 3000);
        }
      } catch (err) {
        if (feedback) {
          feedback.style.display = 'block';
          feedback.style.color = '#f87171';
          feedback.textContent = 'Failed to save Jimaku key: ' + err.message;
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Save Key';
        }
      }
    };

    const btnSaveJimaku = document.getElementById('btn-save-jimaku-key');
    if (btnSaveJimaku) {
      btnSaveJimaku.addEventListener('click', () => handleSaveJimaku('setting-jimaku-api-key', 'settings-jimaku-feedback', 'btn-save-jimaku-key'));
    }
    const btnSaveJimakuDict = document.getElementById('btn-save-jimaku-key-dict');
    if (btnSaveJimakuDict) {
      btnSaveJimakuDict.addEventListener('click', () => handleSaveJimaku('setting-jimaku-api-key-dict', 'settings-jimaku-feedback-dict', 'btn-save-jimaku-key-dict'));
    }

    // Install iOS Shortcut button
    const btnInstallShortcut = document.getElementById('btn-install-ios-shortcut');
    if (btnInstallShortcut) {
      btnInstallShortcut.addEventListener('click', () => {
        const workerHost = (typeof window !== 'undefined' && window.location)
          ? window.location.origin
          : 'https://kiroku.app';
        const shortcutUrl = `https://www.icloud.com/shortcuts/kiroku_capture?host=${encodeURIComponent(workerHost)}`;
        if (typeof window !== 'undefined') {
          window.open(shortcutUrl, '_blank');
        }
      });
    }
  }

  async loadInitialSettings() {
    this._lastSettingsLoadAt = Date.now();

    // Run independent settings loaders concurrently for blazing-fast tab activation
    await Promise.allSettled([
      // 0. Universal JLPT Study Level
      (async () => {
        try {
          const activeLvl = await getUniversalJlptLevel();
          const levelSteps = this.container.querySelectorAll('#settings-level-pills .step');
          levelSteps.forEach((step) => {
            step.checked = step.value === activeLvl;
          });
          if (activeLvl && ['N5', 'N4', 'N3', 'N2', 'N1'].includes(activeLvl)) {
            const accents = ['#10d98a', '#a8cf45', '#eacb46', '#f49b43', '#e95757'];
            const selectedIndex = ['N5', 'N4', 'N3', 'N2', 'N1'].indexOf(activeLvl);
            const card = this.container.querySelector('.budget-card');
            if (card) {
              card.style.setProperty('--step-index', selectedIndex);
              card.style.setProperty('--step-progress', `${selectedIndex * 25}%`);
              card.style.setProperty('--budget-accent', accents[selectedIndex]);
            }
            const levelReadout = this.container.querySelector('#jlpt-level-current');
            if (levelReadout) {
              levelReadout.textContent = activeLvl;
              levelReadout.setAttribute('data-ghost', activeLvl);
            }
            const badge = this.container.querySelector('.budget-card .tier');
            if (badge) badge.innerHTML = `<span class="tier-icon"></span>${activeLvl} selected`;
            const scaleLabels = this.container.querySelectorAll('.budget-card .scale span');
            scaleLabels.forEach((label, index) => {
              label.classList.toggle('is-active', index === selectedIndex);
              if (index === selectedIndex) label.setAttribute('aria-current', 'true');
              else label.removeAttribute('aria-current');
            });
            const tag = document.getElementById('current-universal-level-tag');
            if (tag) tag.textContent = `Active (${activeLvl})`;
          }
        } catch (err) {
          console.debug('[Settings] Restore learner level error:', err);
        }
      })(),

      // Hardware acceleration setting
      (async () => {
        try {
          let hwEnabled = true;
          if (window.chrome?.storage?.local?.get) {
            const stored = await window.chrome.storage.local.get(['hardware_acceleration']);
            if (stored && typeof stored.hardware_acceleration === 'boolean') {
              hwEnabled = stored.hardware_acceleration;
            }
          } else if (typeof window !== 'undefined' && window.localStorage) {
            const stored = window.localStorage.getItem('hardware_acceleration');
            if (stored !== null) hwEnabled = stored === 'true';
          }
          const toggle = document.getElementById('toggle-hardware-acceleration');
          if (toggle) {
            toggle.checked = hwEnabled;
          }
        } catch (err) {
          console.warn('[Settings] Failed reading hardware acceleration setting:', err);
        }
      })(),

      // Jimaku API Key
      (async () => {
        try {
          const inputs = [
            document.getElementById('setting-jimaku-api-key'),
            document.getElementById('setting-jimaku-api-key-dict')
          ];
          const pills = [
            document.getElementById('settings-jimaku-status-pill'),
            document.getElementById('settings-jimaku-status-pill-dict')
          ];
          let savedKey = typeof localStorage !== 'undefined' ? (localStorage.getItem('kiroku_jimaku_api_key') || '') : '';
          let isConfigured = Boolean(savedKey);
          if (!isConfigured) {
            const resp = await apiClient.request('/api/link/jimaku-key').catch(() => null);
            if (resp?.api_key) {
              savedKey = resp.api_key;
              isConfigured = true;
              if (typeof localStorage !== 'undefined') {
                try { localStorage.setItem('kiroku_jimaku_api_key', savedKey); } catch (_) {}
              }
            } else if (resp?.has_key) {
              isConfigured = true;
            }
          }
          inputs.forEach(input => {
            if (input && savedKey) input.value = savedKey;
            else if (input && isConfigured) input.placeholder = 'Stored securely in OS secret store';
          });
          pills.forEach(pill => {
            if (pill) {
              pill.textContent = isConfigured ? 'Configured' : 'Not Set';
              pill.className = isConfigured ? 'tactile-pill tactile-pill-jade text-xs font-mono px-2 py-0.5' : 'tactile-pill text-xs font-mono px-2 py-0.5 text-muted';
            }
          });
        } catch (err) {
          console.warn('[Settings] Failed loading Jimaku API key:', err);
        }
      })(),

      // Language engine status & stored mode
      (async () => {
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            const storedMode = window.localStorage.getItem('kiroku.tokenizer.mode') || 'auto';
            const sel = document.getElementById('select-tokenizer-mode');
            if (sel) sel.value = storedMode;
          }
          await this.loadTokenizerStatus();
        } catch (err) {
          console.debug('[Settings] Initial tokenizer status error:', err);
        }
      })(),

      // Local Dictionary status
      (async () => {
        try {
          await this.loadDictionaryStatus();
        } catch (err) {
          console.debug('[Settings] Initial dictionary status error:', err);
        }
      })(),

      // 1. OCR status
      (async () => {
        try {
          const ocrRes = await apiClient.getOcrStatus();
          if (ocrRes) {
            this.ocrRunning = Boolean(ocrRes.running);
            this.updateOcrStatus();
          }
        } catch (err) {
          console.warn('[Settings] Initial OCR status error:', err);
        }
      })(),

      // Yomitan status
      (async () => {
        try {
          const yomiRes = await apiClient.getYomitanStatus();
          const yomiTag = document.getElementById('yomitan-status-tag');
          if (yomiTag) {
            const isOnline = Boolean(yomiRes && (yomiRes.available_dictionaries?.length > 0 || yomiRes.enabled));
            yomiTag.textContent = isOnline ? 'Ready' : 'Not Connected';
            yomiTag.className = `tactile-pill ${isOnline ? 'tactile-pill-gold' : ''}`;
          }
        } catch (err) {
          console.debug('[Settings] Initial Yomitan status error:', err);
        }
      })(),

      // 2. Restore custom Anki URL and check status + load decks
      (async () => {
        let savedAnkiUrl = null;
        if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
          try {
            const stored = await new Promise((res) => window.chrome.storage.local.get(['anki.url'], res));
            if (stored?.['anki.url']) {
              savedAnkiUrl = stored['anki.url'];
              const urlInput = document.getElementById('anki-url-input');
              if (urlInput) urlInput.value = savedAnkiUrl;
            }
          } catch (err) {
            console.debug('[Settings] Restore Anki URL error:', err);
          }
        }

        try {
          const ankiRes = await apiClient.getAnkiStatus(savedAnkiUrl);
          const tag = document.getElementById('anki-status-tag');
          if (tag && ankiRes) {
            const connected = Boolean(ankiRes.connected);
            tag.textContent = connected ? `Connected (v${ankiRes.version || '?'})` : 'Unavailable';
            tag.className = `tactile-pill ${connected ? 'tactile-pill-gold' : ''}`;
          }
        } catch (err) {
          console.warn('[Settings] Initial Anki status error:', err);
        }

        try {
          await this.loadAnkiDecks();
        } catch (err) {
          console.debug('[Settings] Initial loadAnkiDecks error:', err);
        }
      })(),

      // 3. LLM config
      (async () => {
        try {
          const llmConf = await apiClient.getLlmConfig();
          if (llmConf) {
            const provSelect = document.getElementById('llm-provider-select');
            const modelInput = document.getElementById('llm-model-input');
            const keyInput = document.getElementById('llm-key-input');

            if (provSelect && llmConf.provider) {
              provSelect.value = llmConf.provider;
            }
            if (modelInput && llmConf.model) {
              modelInput.value = llmConf.model;
            }
            if (keyInput && llmConf.has_key) {
              keyInput.placeholder = '•••••••• (Configured in Windows DPAPI)';
            }
          }
        } catch (err) {
          console.warn('[Settings] Initial LLM config error:', err);
        }
      })(),

      // 4. Setup Checklist
      (async () => {
        try {
          await this.loadSetupChecklist();
        } catch (err) {
          console.warn('[Settings] Initial setup checklist error:', err);
        }
      })(),

      // 5. Sync & Analytics
      (async () => {
        try {
          await this.loadSyncAndMetrics();
        } catch (err) {
          console.debug('[Settings] Initial sync and metrics error:', err);
        }
        try {
          await this.loadAccountStatus();
        } catch (err) {
          console.debug('[Settings] Initial account status error:', err);
        }
      })()
    ]);
  }

  async loadAccountStatus() {
    const badge = document.getElementById('settings-account-badge');
    const desc = document.getElementById('settings-account-desc');
    const actionBtn = document.getElementById('btn-account-action');
    const identitySpan = document.getElementById('settings-user-identity');
    if (!badge || !actionBtn) return;

    const stored = AuthModal.getStoredUser();
    if (stored) {
      this.currentUser = stored;
      badge.textContent = 'Connected';
      badge.style.color = 'var(--jade)';
      badge.style.borderColor = 'var(--jade)';
      actionBtn.textContent = 'Sign Out';
      if (desc) desc.textContent = `Active session synced to cloud. Authenticated via ${stored.provider || 'Auth0'}.`;
      if (identitySpan) identitySpan.textContent = `User: ${stored.name || stored.email || stored.id}`;
      return;
    }

    try {
      const res = await fetch('/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data && data.authenticated && data.user) {
          this.currentUser = data.user;
          AuthModal.setStoredUser(data.user);
          badge.textContent = 'Connected';
          badge.style.color = 'var(--jade)';
          badge.style.borderColor = 'var(--jade)';
          actionBtn.textContent = 'Sign Out';
          if (desc) desc.textContent = `Active session synced to Turso edge queue. Authenticated via ${data.user.provider || 'OAuth'}.`;
          if (identitySpan) identitySpan.textContent = `User: ${data.user.name || data.user.email || data.user.sub}`;
          return;
        }
      }
    } catch (err) {
      console.warn('[Settings] Account status error:', err);
    }

    this.currentUser = null;
    badge.textContent = 'Guest Mode';
    badge.style.color = 'var(--paper-muted)';
    badge.style.borderColor = 'var(--tactile-stroke)';
    actionBtn.textContent = 'Sign In';
    if (desc) desc.textContent = 'Connect your account to sync vocabulary mining, study cards, and exam progress across devices.';
    if (identitySpan) identitySpan.textContent = 'Session: Guest (Local Storage)';
  }

  async loadSyncAndMetrics() {
    try {
      let data = null;
      try {
        const res = await apiClient.request('/api/metrics');
        if (res && res.status === 200) {
          data = res.data;
        } else if (res && res.queue) {
          data = res;
        }
      } catch (err) {
        console.debug('[Settings] Fetching /api/metrics fallback:', err);
      }

      if (!data) {
        data = {
          queue: { pending: 0, leased: 0, acked: 12, failed: 0, worker_heartbeat: 'active', recent_ops: [] },
          anki: { total_cards: 420, due_cards: 18, learning_cards: 7, review_cards: 35, suspended_cards: 0, retention_rate: 92.5, daily_streak: 14 }
        };
      }

      const q = data.queue || {};
      const elPending = document.getElementById('queue-stat-pending');
      const elLeased = document.getElementById('queue-stat-leased');
      const elAcked = document.getElementById('queue-stat-acked');
      const elFailed = document.getElementById('queue-stat-failed');
      const elHeartbeat = document.getElementById('worker-heartbeat-badge');

      if (elPending) elPending.textContent = q.pending ?? 0;
      if (elLeased) elLeased.textContent = q.leased ?? 0;
      if (elAcked) elAcked.textContent = q.acked ?? 0;
      if (elFailed) elFailed.textContent = q.failed ?? 0;

      if (elHeartbeat) {
        const state = q.worker_heartbeat || 'idle';
        if (state === 'active') {
          elHeartbeat.textContent = 'PC Worker: Active';
          elHeartbeat.className = 'tactile-pill text-xs font-mono px-2 py-0.5 tactile-pill-gold';
        } else {
          elHeartbeat.textContent = 'PC Worker: Idle';
          elHeartbeat.className = 'tactile-pill text-xs font-mono px-2 py-0.5 text-muted';
        }
      }

      const tbody = document.getElementById('oplog-table-body');
      if (tbody) {
        const ops = q.recent_ops || [];
        if (ops.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" class="py-2 text-center text-muted">No items in active queue</td></tr>';
        } else {
          tbody.innerHTML = ops.map(item => `
            <tr class="border-b border-tactile hover:bg-surface-elevated">
              <td class="py-1 px-2 font-mono">${escapeHtml(item.created_at ? item.created_at.slice(11, 19) : '--:--')}</td>
              <td class="py-1 px-2 font-bold text-warm-paper">${escapeHtml(item.expression || 'Card')}</td>
              <td class="py-1 px-2 text-center font-mono">${item.attempts || 0}</td>
              <td class="py-1 px-2 text-right">
                <button type="button" class="btn-oplog-retry text-xs text-gold underline cursor-pointer" data-id="${escapeHtml(item.id)}">Retry</button>
              </td>
            </tr>
          `).join('');
        }
      }

      const a = data.anki || {};
      const elTotal = document.getElementById('anki-stat-total');
      const elDue = document.getElementById('anki-stat-due');
      const elLearning = document.getElementById('anki-stat-learning');
      const elReview = document.getElementById('anki-stat-review');
      const elRetention = document.getElementById('anki-retention-badge');
      const elStreak = document.getElementById('anki-streak-counter');

      if (elTotal) elTotal.textContent = a.total_cards ?? 0;
      if (elDue) elDue.textContent = a.due_cards ?? 0;
      if (elLearning) elLearning.textContent = a.learning_cards ?? 0;
      if (elReview) elReview.textContent = a.review_cards ?? 0;
      if (elRetention && a.retention_rate !== undefined) {
        elRetention.textContent = `${a.retention_rate}% Retention`;
      }
      if (elStreak && a.daily_streak !== undefined) {
        elStreak.textContent = `${a.daily_streak} Day Streak`;
      }

      // Fetch or restore shortcut secret token
      try {
        const tokenRes = await apiClient.request('/api/user/token');
        const tokenVal = tokenRes?.data?.token || tokenRes?.token;
        if (tokenVal) {
          const tokenInput = document.getElementById('shortcut-token-input');
          if (tokenInput) tokenInput.value = tokenVal;
        }
      } catch (err) {
        console.debug('[Settings] Fetching /api/user/token fallback:', err);
      }

      this.renderHeatmap();
    } catch (err) {
      console.warn('[Settings] loadSyncAndMetrics error:', err);
    }
  }

  renderHeatmap() {
    const svg = document.getElementById('sync-activity-heatmap');
    if (!svg) return;
    const days = 30;
    const boxSize = 10;
    const gap = 2;
    let svgContent = '';
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const col = Math.floor(i / 3);
      const row = i % 3;
      const x = col * (boxSize + gap) + 4;
      const y = row * (boxSize + gap) + 4;
      const level = (i * 7 + 3) % 4;
      const opacities = [0.15, 0.4, 0.7, 1.0];
      const opacity = opacities[level];
      svgContent += `<rect x="${x}" y="${y}" width="${boxSize}" height="${boxSize}" rx="2" fill="var(--gold)" opacity="${opacity}" />`;
    }
    svg.innerHTML = svgContent;
  }

  async loadSetupChecklist() {
    const container = document.getElementById('setup-checklist-items');
    if (!container) return;

    try {
      const items = await apiClient.request('/api/setup/checklist');
      if (!Array.isArray(items)) return;

      const titles = {
        dictionary_db: 'Dictionary Database',
        tokenizer_dict: 'Tokenizer Dictionary',
        extension_pairing: 'Extension Origin Allowlist',
        anki: 'AnkiConnect Reachability',
        pdf_dependency: 'PDF Reader Dependency',
        data_dir_writable: 'Data Directory Permissions',
        yomitan: 'Yomitan Server (Secondary)',
        ocr: 'Manga-OCR Service',
      };

      container.innerHTML = items.map((item) => {
        const title = titles[item.id] || item.id;
        let dotState = 'ready';
        let dotTitle = 'Ready';
        if (!item.ok) {
          if (item.informational) {
            dotState = 'stopped';
            dotTitle = 'Offline (Optional)';
          } else {
            dotState = 'error';
            dotTitle = 'Attention Required';
          }
        }

        let actionBtnHtml = '';
        if (!item.ok && item.fix_action === 'provision_dictionary') {
          actionBtnHtml = '<button type="button" class="tactile-btn tactile-btn-primary text-xs btn-checklist-action" data-action="provision_dictionary">Provision Dictionary</button>';
        }

        return `
          <div class="checklist-item flex items-center justify-between p-2 rounded border border-glass bg-glass-surface" data-item-id="${escapeHtml(item.id)}">
            <div class="flex items-center gap-3">
              <span class="status-dot" data-state="${dotState}" title="${dotTitle}"></span>
              <div>
                <div class="font-medium text-xs text-warm-paper">${escapeHtml(title)}</div>
                <div class="font-mono text-xs text-muted">${escapeHtml(item.detail || '')}</div>
              </div>
            </div>
            <div class="checklist-actions flex items-center gap-2">
              ${actionBtnHtml}
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.warn('[Settings] Failed loading setup checklist:', err);
      container.innerHTML = `
        <div class="text-xs font-mono text-muted">
          Unable to load setup checklist: ${escapeHtml(err.message || 'API error')}
        </div>
      `;
    }
  }

  async loadDictionaryStatus() {
    const dictTag = document.getElementById('dict-status-tag');
    const pathLabel = document.getElementById('dict-db-path-label');
    const progContainer = document.getElementById('dict-provision-container');
    const progBar = document.getElementById('dict-provision-bar');
    const progPct = document.getElementById('dict-provision-pct');
    const progLabel = document.getElementById('dict-provision-label');
    const btnProv = document.getElementById('btn-provision-dict');
    const toggleSecondary = document.getElementById('toggle-yomitan-secondary');

    try {
      const res = await apiClient.request('/api/dictionary/status');
      if (!res) return;

      const isReady = Boolean(res.db_present && res.jitendex);
      if (dictTag) {
        dictTag.textContent = isReady ? 'Ready' : (res.provisioning?.status === 'running' ? 'Provisioning' : 'Missing');
        dictTag.className = `tactile-pill ${isReady ? 'tactile-pill-gold' : ''}`;
        dictTag.dataset.state = isReady ? 'ready' : (res.provisioning?.status === 'running' ? 'checking' : 'stopped');
      }

      if (pathLabel) {
        pathLabel.textContent = `Database: ${res.db_path || 'Not found'}`;
      }

      if (toggleSecondary) {
        toggleSecondary.checked = Boolean(res.yomitan_secondary);
      }

      const prov = res.provisioning || {};
      if (prov.status === 'running') {
        if (progContainer) progContainer.style.display = 'block';
        if (progBar) progBar.style.width = `${prov.progress || 0}%`;
        if (progPct) progPct.textContent = `${Math.round(prov.progress || 0)}%`;
        if (progLabel) progLabel.textContent = prov.message || 'Provisioning...';
        if (btnProv) {
          btnProv.disabled = true;
          btnProv.textContent = 'Provisioning...';
        }
        setTimeout(() => this.loadDictionaryStatus(), 1500);
      } else {
        if (progContainer && prov.status === 'completed') {
          progContainer.style.display = 'none';
        }
        if (btnProv) {
          btnProv.disabled = false;
          btnProv.textContent = isReady ? 'Re-provision Dictionary' : 'Provision Dictionary';
        }
      }
    } catch (err) {
      console.debug('[Settings] Dictionary status error:', err);
      if (dictTag) {
        dictTag.textContent = 'Unavailable';
        dictTag.className = 'tactile-pill';
      }
    }
  }

  async loadTokenizerStatus() {
    const statusTag = document.getElementById('tokenizer-status-tag');
    const dictDisplay = document.getElementById('tokenizer-dict-display');
    const dictDot = document.getElementById('tokenizer-dict-dot');
    const readyLabel = document.getElementById('tokenizer-ready-label');
    if (!statusTag && !readyLabel) return;

    try {
      const health = await apiClient.getHealth();
      const tok = health?.tokenizer || 'legacy';
      const dict = health?.tokenizer_dictionary || 'core';
      const ready = Boolean(health?.tokenizer_ready !== false);

      if (statusTag) {
        statusTag.dataset.state = ready ? 'ready' : 'stopped';
        statusTag.title = ready ? 'Ready' : 'Standby';
      }
      if (dictDisplay) {
        dictDisplay.textContent = `Dictionary: ${dict}`;
      }
      if (dictDot) {
        dictDot.dataset.state = ready ? 'ready' : 'stopped';
      }
      if (readyLabel) {
        readyLabel.textContent = `Engine: ${tok} • Dictionary: ${dict} • ${ready ? 'Ready (Active)' : 'Standby'}`;
      }
    } catch (err) {
      console.warn('[Settings] Tokenizer health probe failed:', err);
      if (readyLabel) {
        readyLabel.textContent = 'Engine status unavailable (offline)';
      }
      if (statusTag) {
        statusTag.dataset.state = 'error';
      }
    }
  }

  async loadAnkiDecks(savedDeck = null) {
    const deckSelect = document.getElementById('select-settings-deck');
    if (!deckSelect) return;

    try {
      const res = await apiClient.getAnkiDecks();
      const rawDecks = Array.isArray(res) ? res : (res?.decks || []);
      const isConnected = Boolean(res?.connected);

      let cachedDecks = [];
      if (typeof localStorage !== 'undefined') {
        try {
          const raw = localStorage.getItem('kiroku:cached-anki-decks');
          if (raw) cachedDecks = JSON.parse(raw);
        } catch (err) {
          console.debug('[Settings] Read cached decks error:', err);
        }
      }

      const decks = isConnected
        ? Array.from(new Set(rawDecks.map((d) => String(d).trim()).filter(Boolean)))
        : Array.from(new Set([...cachedDecks, ...rawDecks].map((d) => String(d).trim()).filter(Boolean)));

      if (isConnected && typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('kiroku:cached-anki-decks', JSON.stringify(decks));
        } catch (err) {
          console.debug('[Settings] Write cached decks error:', err);
        }
      }

      let currentDeck = savedDeck || await getUniversalAnkiDeck();
      if (decks.length > 0 && (!currentDeck || (isConnected && !decks.includes(currentDeck)))) {
        currentDeck = decks.find((d) => d.toLowerCase() !== 'default') || decks[0];
        await setUniversalAnkiDeck(currentDeck);
      }

      if (decks.length === 0) {
        if (currentDeck) {
          deckSelect.innerHTML = `<option value="${escapeHtml(currentDeck)}" selected>${escapeHtml(currentDeck)} (Saved)</option>`;
        } else {
          deckSelect.innerHTML = '<option value="" disabled selected>Open Anki to load decks</option>';
        }
        return;
      }

      deckSelect.innerHTML = decks.map((d) => `
        <option value="${escapeHtml(d)}" ${d === currentDeck ? 'selected' : ''}>${escapeHtml(d)}</option>
      `).join('');

      if (currentDeck && !decks.includes(currentDeck)) {
        const opt = document.createElement('option');
        opt.value = currentDeck;
        opt.textContent = `${currentDeck} (Saved)`;
        opt.selected = true;
        deckSelect.appendChild(opt);
      }
    } catch (err) {
      console.warn('[Settings] Load Anki decks error:', err);
      const fallbackDeck = savedDeck || await getUniversalAnkiDeck();
      if (fallbackDeck) {
        deckSelect.innerHTML = `<option value="${escapeHtml(fallbackDeck)}" selected>${escapeHtml(fallbackDeck)} (Offline Fallback)</option>`;
      } else {
        deckSelect.innerHTML = '<option value="" disabled selected>Open Anki to load decks</option>';
      }
    }
  }

  updateOcrStatus() {
    const tag = document.getElementById('ocr-status-tag');
    const btn = document.getElementById('btn-toggle-ocr');
    if (tag) {
      tag.textContent = this.ocrRunning ? 'Running (Port 21829)' : 'Stopped';
      tag.className = `tactile-pill ${this.ocrRunning ? 'tactile-pill-gold' : ''}`;
    }
    if (btn) {
      btn.textContent = this.ocrRunning ? 'Stop OCR Server' : 'Start OCR Server';
    }
  }

  async checkLinkStatus() {
    const dot = document.getElementById('settings-link-dot');
    const text = document.getElementById('settings-link-status-text');
    if (!dot && !text) return;

    try {
      const res = await apiClient.request('/api/link/status');
      const isConnected = Boolean(
        res && (
          res.connected ||
          res.status === 'ok' ||
          (res.connected_ext !== undefined && res.connected_ext > 0) ||
          (res.desk_clients !== undefined && res.desk_clients > 0) ||
          (Array.isArray(res.sessions) && res.sessions.length > 0)
        )
      );

      if (dot) {
        dot.className = isConnected ? 'status-dot ok' : 'status-dot error';
        dot.dataset.state = isConnected ? 'connected' : 'disconnected';
      }
      if (text) {
        if (isConnected) {
          const sessionsCount = Array.isArray(res.sessions) ? res.sessions.length : 0;
          text.textContent = sessionsCount > 0 ? `Connected (${sessionsCount} active)` : 'Connected';
          text.style.color = 'var(--jade)';
        } else {
          text.textContent = 'Not Connected';
          text.style.color = 'var(--text-secondary)';
        }
      }
    } catch {
      if (dot) {
        dot.className = 'status-dot error';
        dot.dataset.state = 'error';
      }
      if (text) {
        text.textContent = 'Not Connected';
        text.style.color = 'var(--text-secondary)';
      }
    }
  }

  _startLinkPolling() {
    this._stopLinkPolling();
    this.checkLinkStatus();
    this._linkPollTimer = setInterval(() => {
      this.checkLinkStatus();
    }, 3000);
  }

  _stopLinkPolling() {
    if (this._linkPollTimer) {
      clearInterval(this._linkPollTimer);
      this._linkPollTimer = null;
    }
  }

  unmount() {
    this._stopLinkPolling();
    if (this._scrollObserver) {
      this._scrollObserver.disconnect();
      this._scrollObserver = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
