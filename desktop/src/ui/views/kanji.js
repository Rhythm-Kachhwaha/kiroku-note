/**
 * Kiroku Note Desktop — Kanji Studio View Controller
 * Kanji search, real KanjiVG stroke order player, On/Kun readings matrix,
 * radical breakdowns, universal JLPT level sync, level browsing and common compounds with 1-click card mining.
 */

import { apiClient } from '../services/api_client.js';
import { renderAssetSlot } from '../assets_map.js';
import { getUniversalJlptLevel } from '../utils/learner.js';

export class KanjiView {
  constructor(router) {
    this.router = router;
    this.keepAlive = true;
    this.container = null;
    this.currentChar = '静';
    this.currentStrokes = 0;
    this.isPlaying = false;
    this.strokeAnimations = new Set();
    this.strokePlayToken = 0;
    this.currentStrokeIndex = 0;
    this.strokePaths = [];
    this.strokeNumbers = [];
    this.activeLevel = 'N4';
    this.isBrowseOpen = false;
    this.browseLimit = '36';
    this.browseLoadedLevel = null;
    this.browseLoadedLimit = null;

    // List View & Study List state
    this.viewMode = 'grid'; // 'grid' | 'list'
    this.isCoverMode = false;
    this.listLevel = 'N5';
    this.listItems = [];
    this.listTotalCount = 0;
    this.listOffset = 0;
    this.listLimit = 2500;
    this.isLoadingList = false;
    this.listSearchQuery = '';
    this.activeInspectorCompound = null;
    this.activePopoverKanji = null;
    this.availableDecks = ['Default'];
    this._scrollListener = null;
    this._keydownListener = null;
  }

  async getTargetDeck() {
    let targetDeck = 'Default';
    if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
      try {
        const stored = await new Promise((res) => {
          window.chrome.storage.local.get(['anki_deck', 'vocab.selectedDeck'], res);
        });
        if (stored?.['anki_deck']) {
          targetDeck = stored['anki_deck'];
        } else if (stored?.['vocab.selectedDeck']) {
          targetDeck = stored['vocab.selectedDeck'];
        }
      } catch (err) {
        console.debug('[Kanji] Target deck preference restore error:', err);
      }
    }
    return targetDeck;
  }

  async mount(container) {
    this.container = container;
    try {
      const univLevel = await getUniversalJlptLevel();
      if (univLevel) {
        this.activeLevel = univLevel;
      }
    } catch (err) {
      console.debug('[Kanji] Resolve universal level error:', err);
    }

    this.render();
    this.setupEvents();
    this.loadKanji(this.currentChar);
    // By default, do not display kanjis until user clicks the dropdown
  }

  render() {
    this.container.innerHTML = `
      <div class="kanji-view-wrapper">
        <div class="kanji-view-container">
          <div class="grammar-header-row kanji-header-controls">
            <div class="grammar-brand-header" aria-label="Kanji 漢字">
              <h1 class="grammar-word-title">
                <span class="hero-letter">K</span><span class="hero-letter">A</span><span class="hero-letter">N</span><span class="hero-letter">J</span><span class="hero-letter">I</span>
              </h1>
              <span class="grammar-word-kanji">
                <span class="hero-letter">漢</span><span class="hero-letter">字</span>
              </span>
            </div>
            <div class="kanji-view-toggle tactile-segmented" role="tablist" aria-label="Kanji Display Mode">
              <button type="button" class="kanji-toggle-btn ${this.viewMode === 'grid' ? 'is-active' : ''}" id="btn-view-grid" data-mode="grid" role="tab" aria-selected="${this.viewMode === 'grid'}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M4 11h5V5H4v6zm0 7h5v-6H4v6zm6 0h5v-6h-5v6zm6 0h5v-6h-5v6zm-6-7h5V5h-5v6zm6-6v6h5V5h-5z"/>
                </svg>
                <span>Grid View</span>
              </button>
              <button type="button" class="kanji-toggle-btn ${this.viewMode === 'list' ? 'is-active' : ''}" id="btn-view-list" data-mode="list" role="tab" aria-selected="${this.viewMode === 'list'}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M4 14h4v-4H4v4zm0 5h4v-4H4v4zM4 9h4V5H4v4zm5 5h12v-4H9v4zm0 5h12v-4H9v4zM9 5v4h12V5H9z"/>
                </svg>
                <span>List View</span>
              </button>
            </div>
          </div>

          <!-- Grid View Container -->
          <div class="kanji-grid-view" id="kanji-grid-view" style="${this.viewMode === 'list' ? 'display: none;' : ''}">
            <!-- Top Search & JLPT Level Filters -->
          <div class="kanji-search-card tactile-card">
            <div class="kanji-search-row">
              <div class="kanji-input-wrap">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <input
                  type="text"
                  id="kanji-search-input"
                  class="tactile-input kanji-search-input"
                  placeholder="Enter Kanji (e.g. 静, 墨, 録)..."
                  value="${this.currentChar}"
                  maxlength="2"
                />
              </div>
              <button class="tactile-btn tactile-btn-primary" id="btn-kanji-lookup">Lookup</button>
            </div>

            <!-- JLPT Filter Pills -->
            <div class="kanji-level-filters" role="radiogroup" aria-label="JLPT Level">
              ${['N5', 'N4', 'N3', 'N2', 'N1'].map(lvl => `
                <button class="level-pill ${lvl === this.activeLevel ? 'is-active' : ''}" data-level="${lvl}">${lvl}</button>
              `).join('')}
              <button class="level-pill ${this.activeLevel === 'joyo' ? 'is-active' : ''}" data-level="joyo">Joyo</button>
            </div>

            <!-- Kanji Quick Browse Row with Dropdown & Option to View All -->
            <!-- FINAL:KANJI-MASTERY-MARKUP START -->
            <div class="kanji-browse-row">
              <div class="kanji-browse-toggle-bar">
                <button
                  type="button"
                  class="kanji-accordion-trigger"
                  id="btn-toggle-kanji-browse"
                  aria-expanded="false"
                  aria-controls="kanji-accordion-panel"
                >
                  <svg class="kanji-chevron-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                  </svg>
                  <span class="kanji-accordion-title" id="kanji-accordion-title">Show ${this.activeLevel} Kanji Mastery</span>
                  <span class="tactile-pill tactile-pill-peach text-xs" id="kanji-total-count-badge">Mastery</span>
                  <span class="text-xs text-muted kanji-trigger-hint" id="kanji-trigger-hint">Click to expand</span>
                </button>

                <div class="kanji-limit-wrap" id="kanji-limit-wrap">
                  <label for="kanji-limit-select" class="text-xs text-muted font-mono">View:</label>
                  <div class="kanji-select-custom-wrapper">
                    <select id="kanji-limit-select" class="tactile-select kanji-limit-select" aria-label="Kanji view limit">
                      <option value="36" ${this.browseLimit === '36' ? 'selected' : ''}>First 36</option>
                      <option value="100" ${this.browseLimit === '100' ? 'selected' : ''}>Top 100</option>
                      <option value="all" id="kanji-limit-opt-all" ${this.browseLimit === 'all' ? 'selected' : ''}>All ${this.activeLevel} Kanji</option>
                    </select>
                    <svg class="kanji-select-chevron" viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                      <path d="M7 10l5 5 5-5z"/>
                    </svg>
                  </div>
                </div>
              </div>

              <!-- Animated Accordion Dropdown Panel -->
              <div class="kanji-accordion-panel" id="kanji-accordion-panel" aria-hidden="true">
                <div class="kanji-accordion-panel-inner" id="kanji-browse-chips">
                  <div class="text-xs text-muted py-2 text-center">Click dropdown to reveal ${this.activeLevel} kanji mastery.</div>
                </div>
              </div>
            </div>
            <!-- FINAL:KANJI-MASTERY-MARKUP END -->
          </div>

          <!-- Visible Error Banner -->
          <div class="kanji-error-banner" id="kanji-error-banner" style="display: none;">
            <span class="error-msg" id="kanji-error-msg"></span>
            <button type="button" class="btn-dismiss-error" id="btn-dismiss-kanji-error" aria-label="Dismiss error"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>
          </div>

          <!-- Main Layout Grid: Stroke Canvas & Hero (Left) + Readings & Compounds (Right) -->
          <div class="kanji-content-grid">
            <!-- Left Column: Hero Glyph & KanjiVG Stroke Canvas -->
            <div class="kanji-left-column">
              <!-- Mandatory Pitch-Black Stroke Player Surface (#000000) -->
              <div class="kanji-stroke-card surface-pitch-black tactile-card">
                <div class="stroke-header-row">
                  <span class="stroke-title">Stroke Order</span>
                  <span class="stroke-counter-tag font-mono text-gold" id="stroke-counter">Stroke -- of --</span>
                </div>

                <!-- Vector SVG Canvas Container -->
                <div class="stroke-canvas-container" id="stroke-canvas">
                  <div class="text-muted text-sm py-8 text-center" id="stroke-loading">Loading stroke vector...</div>
                </div>

                <!-- Stroke Player Controls Bar -->
                <div class="stroke-controls-bar">
                  <button type="button" class="tactile-btn tactile-btn-sm" id="btn-stroke-replay" title="Replay from start" aria-label="Replay stroke order">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                    </svg>
                  </button>
                  <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-stroke-play" title="Play animation" aria-label="Play stroke order">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </button>
                  <input type="range" id="stroke-slider" min="1" max="1" value="1" class="stroke-scrubber" />
                </div>
              </div>

            </div>

            <!-- Right Column: Hero Character, Readings Matrix & Compounds -->
            <div class="kanji-right-column">
              <!-- Hero Character Info Card -->
              <div class="kanji-info-card tactile-card">
                <div class="kanji-hero-row">
                  <span class="kanji-hero-glyph" id="kanji-glyph">${this.currentChar}</span>
                  <div class="kanji-hero-meta">
                    <div class="flex items-center gap-2">
                      <span class="tactile-pill tactile-pill-gold" id="kanji-jlpt">JLPT --</span>
                      <span class="tactile-pill" id="kanji-grade">--</span>
                    </div>
                    <h2 class="kanji-meanings-list" id="kanji-meanings">Loading meanings...</h2>
                    <span class="kanji-freq-rank text-xs text-muted" id="kanji-meta-rank">--</span>
                  </div>
                </div>

                <!-- Readings Matrix Table -->
                <div class="readings-matrix-box">
                  <table class="readings-table">
                    <tbody>
                      <tr>
                        <th class="reading-type">On'yomi</th>
                        <td class="reading-value font-bold text-gold" id="kanji-onyomi">--</td>
                      </tr>
                      <tr>
                        <th class="reading-type">Kun'yomi</th>
                        <td class="reading-value text-warm-paper" id="kanji-kunyomi">--</td>
                      </tr>
                      <tr>
                        <th class="reading-type">Radical</th>
                        <td class="reading-value text-secondary" id="kanji-radical">--</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- High-Frequency Compounds Table with 1-Click Mine Stamp -->
              <div class="compounds-card tactile-card">
                <div class="compounds-header-row">
                  <span class="compounds-title">Common Compounds</span>
                  <span class="text-xs text-muted">1-Click Mine to Local &amp; Anki</span>
                </div>
                <div class="compounds-list" id="compounds-list">
                  <div class="text-muted text-sm py-4 text-center">Loading compounds...</div>
                </div>
              </div>
            </div>
          </div>
        </div> <!-- end kanji-grid-view -->

        <!-- Full-Screen Textbook List View -->
        <div class="kanji-list-view-container" id="kanji-list-view-container" style="${this.viewMode === 'grid' ? 'display: none;' : ''}">
          <div class="kanji-list-toolbar tactile-card">
            <div class="kanji-list-toolbar-left">
              <!-- JLPT Level Pills for List View -->
              <div class="kanji-level-filters" role="radiogroup" aria-label="Study List JLPT Level">
                ${['N5', 'N4', 'N3', 'N2', 'N1'].map(lvl => `
                  <button type="button" class="level-pill kanji-list-level-pill ${lvl === this.listLevel ? 'is-active' : ''}" data-list-level="${lvl}">${lvl}</button>
                `).join('')}
              </div>
              <!-- Subtle Real-Time Search Filter -->
              <div class="kanji-list-search-wrap">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <input
                  type="text"
                  id="kanji-list-search-input"
                  class="tactile-input kanji-list-search-input"
                  placeholder="Filter kanji, reading, or meaning..."
                  value="${escapeHtml(this.listSearchQuery)}"
                />
              </div>
            </div>

            <!-- Cover Mode (Blur Readings) Toggle -->
            <button
              type="button"
              class="tactile-btn tactile-btn-sm kanji-cover-toggle ${this.isCoverMode ? 'is-active' : ''}"
              id="btn-toggle-cover-mode"
              title="Toggle blur on readings for self-testing"
              aria-pressed="${this.isCoverMode}"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
              </svg>
              <span>${this.isCoverMode ? 'Readings Blurred' : 'Blur Readings'}</span>
            </button>
          </div>

          <!-- List Count Summary -->
          <div class="kanji-list-summary text-xs text-muted mb-2 font-mono" id="kanji-list-summary">
            Loading ${this.listLevel} study list...
          </div>

          <!-- High-Density Textbook Study List Rows -->
          <div class="kanji-textbook-list ${this.isCoverMode ? 'kanji-cover-active' : ''}" id="kanji-textbook-list">
            <!-- Dynamically populated rows -->
          </div>
          <div class="kanji-list-loading text-center py-4 text-xs text-muted font-mono" id="kanji-list-loading" style="display: none;">
            Loading more kanji...
          </div>
        </div>

        <!-- Slide-Over Card Inspector Drawer & Backdrop -->
        <div class="kanji-inspector-backdrop" id="kanji-inspector-backdrop" style="display: none;"></div>
        <aside class="kanji-inspector-drawer tactile-card" id="kanji-card-inspector" role="dialog" aria-modal="true" aria-hidden="true" aria-label="Kanji Compound Inspector">
          <div class="kanji-inspector-header">
            <h3 class="kanji-inspector-title">Card Inspector</h3>
            <button type="button" class="kanji-inspector-close-btn" id="btn-close-kanji-inspector" aria-label="Close inspector">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </div>
          <div class="kanji-inspector-body" id="kanji-inspector-body">
            <div class="kanji-inspector-field">
              <label class="kanji-inspector-label" for="kanji-insp-term">Expression / Term</label>
              <input type="text" id="kanji-insp-term" class="tactile-input font-japanese font-bold text-lg" />
            </div>
            <div class="kanji-inspector-field">
              <label class="kanji-inspector-label" for="kanji-insp-reading">Reading (Kana)</label>
              <input type="text" id="kanji-insp-reading" class="tactile-input font-japanese text-sm" />
            </div>
            <div class="kanji-inspector-field">
              <label class="kanji-inspector-label" for="kanji-insp-meaning">Meaning &amp; Gloss</label>
              <textarea id="kanji-insp-meaning" class="tactile-input text-sm" rows="3"></textarea>
            </div>
            <div class="kanji-inspector-field">
              <label class="kanji-inspector-label" for="kanji-insp-tags">Tags</label>
              <input type="text" id="kanji-insp-tags" class="tactile-input font-mono text-xs" />
            </div>
            <div class="kanji-inspector-field">
              <label class="kanji-inspector-label" for="kanji-insp-notes">Study Notes / Mnemonic</label>
              <textarea id="kanji-insp-notes" class="tactile-input text-sm" rows="3" placeholder="Add custom notes or mnemonic..."></textarea>
            </div>
            <div class="kanji-inspector-field">
              <label class="kanji-inspector-label" for="kanji-insp-deck">Target Deck</label>
              <select id="kanji-insp-deck" class="tactile-select text-sm">
                ${this.availableDecks.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
              </select>
            </div>
            <div class="kanji-inspector-actions mt-2">
              <button type="button" class="tactile-btn tactile-btn-primary w-full" id="btn-kanji-insp-mine">
                Mine to Kiroku &amp; Anki
              </button>
            </div>
            <div class="kanji-insp-feedback text-xs text-center font-mono mt-1" id="kanji-insp-feedback" style="display: none;"></div>
          </div>
        </aside>

        <!-- Compact Add Custom Compound Popover -->
        <div class="kanji-add-popover tactile-card" id="kanji-add-popover" style="display: none;">
          <h4 class="kanji-add-popover-title" id="kanji-add-popover-title">Add Compound</h4>
          <div class="kanji-inspector-field">
            <label class="kanji-inspector-label" for="kanji-add-term">Term</label>
            <input type="text" id="kanji-add-term" class="tactile-input font-japanese text-sm" placeholder="e.g. 正確" />
          </div>
          <div class="kanji-inspector-field">
            <label class="kanji-inspector-label" for="kanji-add-reading">Reading</label>
            <input type="text" id="kanji-add-reading" class="tactile-input font-japanese text-sm" placeholder="e.g. せいかく" />
          </div>
          <div class="kanji-inspector-field">
            <label class="kanji-inspector-label" for="kanji-add-meaning">Meaning</label>
            <input type="text" id="kanji-add-meaning" class="tactile-input text-sm" placeholder="e.g. accurate, correct" />
          </div>
          <div class="kanji-add-popover-actions">
            <button type="button" class="tactile-btn tactile-btn-sm" id="btn-cancel-custom-compound">Cancel</button>
            <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-save-custom-compound">Add</button>
          </div>
        </div>
      </div>
    </div>
  `;
  }

  setupEvents() {
    const btnLookup = document.getElementById('btn-kanji-lookup');
    const inputKanji = document.getElementById('kanji-search-input');
    const btnDismiss = document.getElementById('btn-dismiss-kanji-error');

    if (btnDismiss) {
      btnDismiss.addEventListener('click', () => this.clearError());
    }

    if (btnLookup && inputKanji) {
      btnLookup.addEventListener('click', () => {
        const char = inputKanji.value.trim();
        if (char) this.loadKanji(char);
      });

      inputKanji.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const char = inputKanji.value.trim();
          if (char) this.loadKanji(char);
        }
      });
    }

    // Level Filter Pills
    const levelPills = this.container.querySelectorAll('.kanji-level-filters .level-pill');
    if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
      window.chrome.storage.local.get('kanji.activeLevel').then((stored) => {
        const lvl = stored?.['kanji.activeLevel'];
        if (lvl && ['N5', 'N4', 'N3', 'N2', 'N1', 'joyo'].includes(lvl)) {
          this.activeLevel = lvl;
          levelPills.forEach((p) => p.classList.toggle('is-active', p.dataset.level === lvl));
          this.updateBrowseLabels();
        }
      }).catch((err) => {
        console.debug('[Kanji] Failed to restore activeLevel preference:', err);
      });
    }

    levelPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        levelPills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.activeLevel = pill.dataset.level;
        if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
          window.chrome.storage.local.set({ 'kanji.activeLevel': this.activeLevel });
        }
        this.updateBrowseLabels();
        if (this.isBrowseOpen) {
          this.loadLevelBrowse(this.activeLevel);
        } else {
          this.browseLoadedLevel = null;
        }
      });
    });

    // Accordion Dropdown Toggle
    const toggleBtn = document.getElementById('btn-toggle-kanji-browse');
    const panel = document.getElementById('kanji-accordion-panel');
    const hint = document.getElementById('kanji-trigger-hint');

    if (toggleBtn && panel) {
      toggleBtn.addEventListener('click', () => {
        this.isBrowseOpen = !this.isBrowseOpen;
        toggleBtn.classList.toggle('is-open', this.isBrowseOpen);
        panel.classList.toggle('is-open', this.isBrowseOpen);
        toggleBtn.setAttribute('aria-expanded', String(this.isBrowseOpen));
        panel.setAttribute('aria-hidden', String(!this.isBrowseOpen));

        if (hint) {
          hint.textContent = this.isBrowseOpen ? 'Click to collapse' : 'Click to expand';
        }
        this.updateBrowseLabels();

        if (this.isBrowseOpen) {
          if (this.browseLoadedLevel !== this.activeLevel || this.browseLoadedLimit !== this.browseLimit) {
            this.loadLevelBrowse(this.activeLevel);
          }
        }
      });
    }

    // Limit Dropdown Selection
    const limitSelect = document.getElementById('kanji-limit-select');
    if (limitSelect) {
      limitSelect.addEventListener('change', (e) => {
        this.browseLimit = e.target.value;
        if (!this.isBrowseOpen && toggleBtn && panel) {
          this.isBrowseOpen = true;
          toggleBtn.classList.add('is-open');
          panel.classList.add('is-open');
          toggleBtn.setAttribute('aria-expanded', 'true');
          panel.setAttribute('aria-hidden', 'false');
          if (hint) hint.textContent = 'Click to collapse';
          this.updateBrowseLabels();
        }
        this.loadLevelBrowse(this.activeLevel);
      });
    }

    // Stroke Replay & Play buttons
    const btnPlay = document.getElementById('btn-stroke-play');
    const btnReplay = document.getElementById('btn-stroke-replay');
    const slider = document.getElementById('stroke-slider');

    if (btnPlay) {
      btnPlay.addEventListener('click', () => this.toggleStrokePlay());
    }
    if (btnReplay) {
      btnReplay.addEventListener('click', () => this.replayStrokes());
    }
    if (slider) {
      slider.addEventListener('input', () => {
        this.pauseStrokes();
        const idx = Math.max(0, parseInt(slider.value, 10) - 1);
        this.renderStrokeStep(idx);
      });
    }

    // View Mode Toggle (Grid vs List)
    const btnViewGrid = document.getElementById('btn-view-grid');
    const btnViewList = document.getElementById('btn-view-list');
    if (btnViewGrid) {
      btnViewGrid.addEventListener('click', () => this.setViewMode('grid'));
    }
    if (btnViewList) {
      btnViewList.addEventListener('click', () => this.setViewMode('list'));
    }

    // List View JLPT Level Pills
    const listLevelPills = this.container.querySelectorAll('.kanji-list-level-pill');
    listLevelPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        this.setListLevel(pill.dataset.listLevel);
      });
    });

    // Real-Time Subtle Search Filter for List View
    const listSearchInput = document.getElementById('kanji-list-search-input');
    if (listSearchInput) {
      listSearchInput.addEventListener('input', (e) => {
        this.filterList(e.target.value);
      });
    }

    // Cover Mode (Blur Readings) Toggle
    const btnCover = document.getElementById('btn-toggle-cover-mode');
    if (btnCover) {
      btnCover.addEventListener('click', () => this.toggleCoverMode());
    }

    // Event delegation for Textbook Study List
    const textbookList = document.getElementById('kanji-textbook-list');
    if (textbookList) {
      textbookList.addEventListener('click', (e) => {
        // 1. Click large kanji glyph -> inspect in slide-out Kanji Drawer
        const charEl = e.target.closest('.kanji-list-char');
        if (charEl && charEl.dataset.char) {
          window.kirokuUi?.openKanji?.(charEl.dataset.char);
          return;
        }

        // 2. Click compound chip -> open right-side Card Inspector
        const chipEl = e.target.closest('.kanji-compound-chip');
        if (chipEl) {
          const term = chipEl.dataset.term;
          const reading = chipEl.dataset.reading;
          const meaning = chipEl.dataset.meaning;
          const char = chipEl.dataset.char;
          this.openCardInspector({ term, reading, meaning, char });
          return;
        }

        // 3. Click add custom compound button (+)
        const addBtn = e.target.closest('.kanji-compound-add-btn');
        if (addBtn) {
          const char = addBtn.dataset.char;
          this.openAddPopover(char, addBtn);
          return;
        }

        // 4. Click blurred readings box to unblur locally
        const readingsBox = e.target.closest('.kanji-reading-blur');
        if (readingsBox) {
          readingsBox.classList.toggle('is-unblurred');
          return;
        }
      });
    }

    // Infinite scroll for List View
    this._scrollListener = () => {
      if (this.viewMode !== 'list' || this.isLoadingList) return;
      if (this.listItems.length >= this.listTotalCount) return;

      const viewEl = document.getElementById('view-container');
      if (viewEl) {
        const scrollRemaining = viewEl.scrollHeight - viewEl.clientHeight - viewEl.scrollTop;
        if (scrollRemaining < 450) {
          this.loadStudyList(this.listLevel, this.listOffset + this.listLimit, true);
        }
      } else {
        const scrollRemaining = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
        if (scrollRemaining < 450) {
          this.loadStudyList(this.listLevel, this.listOffset + this.listLimit, true);
        }
      }
    };
    const viewContainer = document.getElementById('view-container');
    if (viewContainer) {
      viewContainer.addEventListener('scroll', this._scrollListener, { passive: true });
    }
    window.addEventListener('scroll', this._scrollListener, { passive: true });

    // Card Inspector Drawer Events
    const btnCloseInsp = document.getElementById('btn-close-kanji-inspector');
    const backdropInsp = document.getElementById('kanji-inspector-backdrop');
    const btnMineInsp = document.getElementById('btn-kanji-insp-mine');

    if (btnCloseInsp) {
      btnCloseInsp.addEventListener('click', () => this.closeCardInspector());
    }
    if (backdropInsp) {
      backdropInsp.addEventListener('click', () => this.closeCardInspector());
    }
    if (btnMineInsp) {
      btnMineInsp.addEventListener('click', () => this.mineCurrentCard());
    }

    // Add Compound Popover Events
    const btnCancelPop = document.getElementById('btn-cancel-custom-compound');
    const btnSavePop = document.getElementById('btn-save-custom-compound');

    if (btnCancelPop) {
      btnCancelPop.addEventListener('click', () => this.closeAddPopover());
    }
    if (btnSavePop) {
      btnSavePop.addEventListener('click', () => this.saveCustomCompound());
    }

    // Global Keydown Handler (Escape closes inspector and popover)
    this._keydownListener = (e) => {
      if (e.key === 'Escape') {
        if (this.activePopoverKanji) {
          this.closeAddPopover();
        } else if (this.activeInspectorCompound) {
          this.closeCardInspector();
        }
      }
    };
    window.addEventListener('keydown', this._keydownListener);
  }

  showError(message) {
    const banner = document.getElementById('kanji-error-banner');
    const msg = document.getElementById('kanji-error-msg');
    if (banner && msg) {
      msg.textContent = message;
      banner.style.display = 'flex';
    }
  }

  clearError() {
    const banner = document.getElementById('kanji-error-banner');
    if (banner) {
      banner.style.display = 'none';
    }
  }

  async loadKanji(char) {
    if (!char || !char.trim()) return;
    const cleanChar = char.trim()[0];
    this.currentChar = cleanChar;
    this.clearError();
    this.pauseStrokes();

    const input = document.getElementById('kanji-search-input');
    if (input) input.value = cleanChar;

    const glyphEl = document.getElementById('kanji-glyph');
    if (glyphEl) glyphEl.textContent = cleanChar;

    // 1. Fetch character details
    try {
      const details = await apiClient.getKanjiDetails(cleanChar);
      this.renderKanjiDetails(cleanChar, details);
    } catch (err) {
      console.warn('[Kanji] Get details failed:', err);
      this.showError(`Details for "${cleanChar}" not found: ` + (err.message || 'Network error'));
    }

    // 2. Fetch KanjiVG stroke order SVG
    try {
      const svgText = await apiClient.getKanjiStrokes(cleanChar);
      this.renderStrokeCanvas(svgText);
    } catch (err) {
      console.warn('[Kanji] Get strokes failed:', err);
      const canvas = document.getElementById('stroke-canvas');
      if (canvas) {
        canvas.innerHTML = `<div class="text-sm text-muted py-8 text-center">Stroke diagram unavailable for ${cleanChar}</div>`;
      }
    }

    // 3. Fetch common compounds
    try {
      const res = await apiClient.getKanjiCompounds(cleanChar, { limit: 15 });
      this.renderCompounds(res?.compounds || []);
    } catch (err) {
      console.warn('[Kanji] Get compounds failed:', err);
      const list = document.getElementById('compounds-list');
      if (list) {
        list.innerHTML = `<div class="text-sm text-error py-4 text-center">Failed to load compounds.</div>`;
      }
    }
  }

  renderKanjiDetails(char, details) {
    if (!details) return;

    const jlptTag = document.getElementById('kanji-jlpt');
    const gradeTag = document.getElementById('kanji-grade');
    const meaningsEl = document.getElementById('kanji-meanings');
    const rankEl = document.getElementById('kanji-meta-rank');
    const onyomiEl = document.getElementById('kanji-onyomi');
    const kunyomiEl = document.getElementById('kanji-kunyomi');
    const radicalEl = document.getElementById('kanji-radical');

    const level = details.level || '--';
    const grade = details.grade ? `Grade ${details.grade}` : 'Non-Joyo';
    const freq = details.freq ? `Frequency Rank #${details.freq}` : 'Rare';
    const strokes = details.strokes ? `${details.strokes} Strokes` : '';
    const meanings = (details.meanings || []).join(' · ') || 'No English meaning';

    if (jlptTag) jlptTag.textContent = `JLPT ${level}`;
    if (gradeTag) gradeTag.textContent = grade;
    if (meaningsEl) meaningsEl.textContent = meanings;
    if (rankEl) rankEl.textContent = `${freq} · ${strokes}`;

    if (onyomiEl) {
      const on = Array.isArray(details.onyomi) ? details.onyomi.join(', ') : (details.onyomi || '--');
      onyomiEl.textContent = on || 'None';
    }
    if (kunyomiEl) {
      const kun = Array.isArray(details.kunyomi) ? details.kunyomi.join(', ') : (details.kunyomi || '--');
      kunyomiEl.textContent = kun || 'None';
    }
    if (radicalEl) {
      radicalEl.textContent = details.radical || 'None';
    }
  }

  renderStrokeCanvas(svgText) {
    const canvas = document.getElementById('stroke-canvas');
    if (!canvas || !svgText) return;

    canvas.innerHTML = svgText;
    const svgEl = canvas.querySelector('svg');
    if (svgEl) {
      svgEl.setAttribute('id', 'kanjivg-svg');
      svgEl.setAttribute('class', 'kanjivg-svg');
      svgEl.setAttribute('width', '220');
      svgEl.setAttribute('height', '220');
    }

    // Extract stroke paths and stroke order numbers
    this.strokePaths = Array.from(canvas.querySelectorAll('path'));
    this.strokeNumbers = Array.from(canvas.querySelectorAll('text'));
    this.currentStrokes = this.strokePaths.length;
    this.currentStrokeIndex = 0;

    // Style stroke number text elements for pitch-black canvas
    this.strokeNumbers.forEach((t) => {
      t.style.fontFamily = 'var(--font-mono)';
      t.style.fontSize = '10px';
      t.style.fill = 'var(--text-muted)';
      t.style.userSelect = 'none';
    });

    const slider = document.getElementById('stroke-slider');
    if (slider) {
      slider.min = '1';
      slider.max = String(this.currentStrokes || 1);
      slider.value = '1';
    }

    const playBtn = document.getElementById('btn-stroke-play');
    if (playBtn) {
      playBtn.disabled = this.strokePaths.length === 0;
      this.updateHeroPlayButton();
    }

    this.renderStrokeStep(0, false);
  }

  updateHeroPlayButton() {
    const btn = document.getElementById('btn-stroke-play');
    if (!btn) return;
    if (this.isPlaying) {
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
      btn.setAttribute('aria-label', 'Pause stroke animation');
      btn.setAttribute('title', 'Pause animation');
    } else {
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
      btn.setAttribute('aria-label', 'Play stroke animation');
      btn.setAttribute('title', 'Play animation');
    }
  }

  renderStrokeStep(index, isAnimating = false) {
    if (!this.strokePaths || this.strokePaths.length === 0) return;
    this.currentStrokeIndex = Math.max(0, Math.min(index, this.strokePaths.length - 1));

    this.strokePaths.forEach((path, i) => {
      const length = (typeof path.getTotalLength === 'function') ? path.getTotalLength() : 100;
      path.style.strokeDasharray = `${length}px ${length}px`;
      path.style.fill = 'none';

      if (i < this.currentStrokeIndex) {
        path.style.stroke = 'var(--warm-paper)';
        path.style.opacity = '1';
        path.style.strokeWidth = '3';
        path.style.strokeDashoffset = '0px';
      } else if (i === this.currentStrokeIndex) {
        path.style.stroke = 'var(--accent-gold)';
        path.style.opacity = '1';
        path.style.strokeWidth = '4.5';
        path.style.strokeDashoffset = isAnimating ? `${length}px` : '0px';
      } else {
        path.style.stroke = 'var(--tactile-stroke)';
        path.style.opacity = '0.2';
        path.style.strokeWidth = '2';
        path.style.strokeDashoffset = '0px';
      }
    });

    // Progressive stroke order numbers
    this.strokeNumbers.forEach((numEl, i) => {
      if (i <= this.currentStrokeIndex) {
        numEl.style.display = 'block';
        numEl.style.fill = (i === this.currentStrokeIndex) ? 'var(--accent-gold)' : 'var(--text-muted)';
        numEl.style.fontWeight = (i === this.currentStrokeIndex) ? '700' : '400';
      } else {
        numEl.style.display = 'none';
      }
    });

    const counter = document.getElementById('stroke-counter');
    if (counter) {
      counter.textContent = `Stroke ${this.currentStrokeIndex + 1} of ${this.currentStrokes || this.strokePaths.length}`;
    }

    const slider = document.getElementById('stroke-slider');
    if (slider) {
      slider.value = String(this.currentStrokeIndex + 1);
    }
  }

  toggleStrokePlay() {
    if (this.isPlaying) {
      this.pauseStrokes();
    } else {
      this.startStrokePlay();
    }
  }

  startStrokePlay() {
    if (this.strokePaths.length === 0) return;
    this.cancelStrokeAnimations();
    this.isPlaying = true;
    this.updateHeroPlayButton();

    if (this.currentStrokeIndex >= this.strokePaths.length - 1) {
      this.currentStrokeIndex = 0;
      this.renderStrokeStep(0, true);
    } else {
      this.renderStrokeStep(this.currentStrokeIndex, true);
    }

    this.animateCurrentStroke(this.strokePlayToken);
  }

  pauseStrokes() {
    this.isPlaying = false;
    this.cancelStrokeAnimations();
    this.updateHeroPlayButton();
    this.renderStrokeStep(this.currentStrokeIndex, false);
  }

  replayStrokes() {
    this.cancelStrokeAnimations();
    this.isPlaying = false;
    this.currentStrokeIndex = 0;
    this.renderStrokeStep(0, false);
    this.startStrokePlay();
  }

  cancelStrokeAnimations() {
    this.strokePlayToken += 1;
    this.strokeAnimations.forEach((animation) => {
      try {
        animation.cancel();
      } catch (e) {}
    });
    this.strokeAnimations.clear();
  }

  animateCurrentStroke(playToken) {
    if (!this.isPlaying || playToken !== this.strokePlayToken) return;

    const path = this.strokePaths[this.currentStrokeIndex];
    if (!path) {
      this.pauseStrokes();
      return;
    }

    const length = (typeof path.getTotalLength === 'function') ? path.getTotalLength() : 100;
    path.style.strokeDasharray = `${length}px ${length}px`;
    path.style.strokeDashoffset = `${length}px`;
    path.style.stroke = 'var(--accent-gold)';
    path.style.strokeWidth = '4.5';
    path.style.opacity = '1';
    path.style.fill = 'none';

    const duration = Math.max(160, Math.min(Math.round(length * 1.4), 480));
    const easing = typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim() || 'ease-out'
      : 'ease-out';

    if (typeof path.animate === 'function') {
      const animation = path.animate(
        [{ strokeDashoffset: `${length}px` }, { strokeDashoffset: '0px' }],
        { duration, easing, fill: 'forwards' },
      );
      this.strokeAnimations.add(animation);
      animation.onfinish = () => {
        this.strokeAnimations.delete(animation);
        path.style.strokeDashoffset = '0px';
        path.style.fill = 'none';
        this.advanceStroke(playToken);
      };
      animation.oncancel = () => {
        this.strokeAnimations.delete(animation);
      };
    } else {
      path.style.strokeDashoffset = '0px';
      path.style.fill = 'none';
      this.advanceStroke(playToken);
    }
  }

  advanceStroke(playToken) {
    if (!this.isPlaying || playToken !== this.strokePlayToken) return;
    if (this.currentStrokeIndex < this.strokePaths.length - 1) {
      this.renderStrokeStep(this.currentStrokeIndex + 1, true);
      this.animateCurrentStroke(playToken);
    } else {
      this.isPlaying = false;
      this.updateHeroPlayButton();
      this.renderStrokeStep(this.strokePaths.length - 1, false);
      const lastPath = this.strokePaths[this.strokePaths.length - 1];
      if (lastPath) {
        lastPath.style.stroke = 'var(--warm-paper)';
        lastPath.style.strokeWidth = '3';
        lastPath.style.strokeDashoffset = '0px';
        lastPath.style.fill = 'none';
      }
    }
  }

  renderCompounds(compounds) {
    const list = document.getElementById('compounds-list');
    if (!list) return;

    if (!compounds || compounds.length === 0) {
      list.innerHTML = `<div class="text-sm text-muted py-4 text-center">No common compounds found for ${this.currentChar}.</div>`;
      return;
    }

    list.innerHTML = compounds.map((c) => `
      <div class="compound-row">
        <div class="compound-head">
          <ruby class="compound-glyph">${escapeHtml(c.term)}<rt>${escapeHtml(c.reading || '')}</rt></ruby>
          <span class="compound-gloss">${escapeHtml(c.meaning || '')}</span>
        </div>
        <button
          type="button"
          class="tactile-btn tactile-btn-sm tactile-btn-primary btn-mine-compound"
          data-expr="${escapeHtml(c.term)}"
          data-read="${escapeHtml(c.reading || '')}"
          data-gloss="${escapeHtml(c.meaning || '')}"
        >Mine</button>
      </div>
    `).join('');

    // Attach 1-Click Mine listeners
    list.querySelectorAll('.btn-mine-compound').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const expr = btn.dataset.expr;
        const read = btn.dataset.read;
        const gloss = btn.dataset.gloss;

        btn.disabled = true;
        btn.textContent = 'Mining...';

        try {
          const targetDeck = await this.getTargetDeck();
          await apiClient.saveCard({
            expression: expr,
            reading: read,
            meaning: gloss,
            deck_name: targetDeck,
            tags: 'kanji-compound'
          });
          btn.textContent = 'Mined';
          btn.classList.add('is-mined');
        } catch (err) {
          console.error('[Kanji] Save compound failed:', err);
          btn.disabled = false;
          btn.textContent = 'Mine';
          this.showError(`Failed to mine "${expr}": ` + (err.message || 'Save error'));
        }
      });
    });
  }

  updateBrowseLabels() {
    const title = document.getElementById('kanji-accordion-title');
    const optAll = document.getElementById('kanji-limit-opt-all');
    if (title) {
      title.textContent = this.isBrowseOpen
        ? `Hide ${this.activeLevel} Kanji Mastery`
        : `Show ${this.activeLevel} Kanji Mastery`;
    }
    if (optAll) {
      optAll.textContent = `All ${this.activeLevel} Kanji`;
    }
  }

  async loadLevelBrowse(level) {
    const container = document.getElementById('kanji-browse-chips');
    if (!container) return;

    container.innerHTML = `<span class="text-xs text-muted">Loading ${level} kanji...</span>`;

    const limitVal = this.browseLimit === 'all' ? 2500 : (parseInt(this.browseLimit, 10) || 36);

    try {
      const [browseRes, seenRes, knownRes] = await Promise.allSettled([
        apiClient.browseKanji({ level, limit: limitVal }),
        apiClient.getSeenKanji(),
        apiClient.getKnownWords()
      ]);

      const kanjiList = (browseRes.status === 'fulfilled' && browseRes.value?.kanji) ? browseRes.value.kanji : [];
      const totalKanji = (browseRes.status === 'fulfilled' && typeof browseRes.value?.total === 'number') ? browseRes.value.total : kanjiList.length;

      this.browseLoadedLevel = level;
      this.browseLoadedLimit = this.browseLimit;

      const badge = document.getElementById('kanji-total-count-badge');
      if (badge) {
        badge.textContent = `${totalKanji} kanji`;
      }
      const optAll = document.getElementById('kanji-limit-opt-all');
      if (optAll) {
        optAll.textContent = `All (${totalKanji})`;
      }
      const seenMap = (seenRes.status === 'fulfilled' && seenRes.value?.seen_kanji) ? seenRes.value.seen_kanji : {};

      let knownWords = new Set();
      if (knownRes.status === 'fulfilled' && knownRes.value) {
        const words = Array.isArray(knownRes.value.words) ? knownRes.value.words : (Array.isArray(knownRes.value) ? knownRes.value : []);
        knownWords = new Set(words);
      }

      if (kanjiList.length === 0) {
        container.innerHTML = `<span class="text-xs text-muted">No kanji listed for ${level}.</span>`;
        return;
      }

      container.innerHTML = `
        <div class="kanji-mastery-grid">
          ${kanjiList.map((k) => {
            const seenCount = seenMap[k.character] || 0;
            const isKnown = knownWords.has(k.character);
            const isMastered = isKnown || seenCount >= 3;
            const progressPct = isMastered ? 100 : (seenCount > 0 ? Math.min(80, Math.max(30, seenCount * 25)) : 0);
            const reading = k.reading || k.onyomi || (Array.isArray(k.meanings) ? k.meanings[0] : (k.meanings || ''));
            const masteredClass = isMastered ? 'is-mastered' : '';
            const activeClass = k.character === this.currentChar ? 'is-active' : '';
            const titleText = isMastered
              ? `${k.character} (Mastered · ${reading})`
              : (seenCount > 0 ? `${k.character} (${seenCount} seen · ${reading})` : `${k.character} (${reading})`);

            return `
              <button
                type="button"
                class="kanji-squircle-card ${masteredClass} ${activeClass}"
                data-char="${escapeHtml(k.character)}"
                title="${escapeHtml(titleText)}"
              >
                <span class="kanji-char ${isMastered ? 'text-gold' : ''}">${escapeHtml(k.character)}</span>
                <span class="kanji-sub-reading">${escapeHtml(reading)}</span>
                <div class="kanji-progress-bar">
                  <div class="kanji-progress-fill ${isMastered ? 'is-mastered' : ''}" style="width: ${progressPct}%;"></div>
                </div>
              </button>
            `;
          }).join('')}
        </div>
      `;

      container.querySelectorAll('.kanji-squircle-card').forEach((card) => {
        card.addEventListener('click', () => {
          container.querySelectorAll('.kanji-squircle-card').forEach((c) => c.classList.remove('is-active'));
          card.classList.add('is-active');
          this.loadKanji(card.dataset.char);
        });
      });
    } catch (err) {
      console.warn('[Kanji] Browse kanji error:', err);
      container.innerHTML = `<span class="text-xs text-error">Browse error: ${escapeHtml(err.message || 'Offline')}</span>`;
    }
  }

  setViewMode(mode) {
    if (this.viewMode === mode) return;
    this.viewMode = mode;

    const gridEl = document.getElementById('kanji-grid-view');
    const listEl = document.getElementById('kanji-list-view-container');
    const btnGrid = document.getElementById('btn-view-grid');
    const btnList = document.getElementById('btn-view-list');

    if (btnGrid) {
      btnGrid.classList.toggle('is-active', mode === 'grid');
      btnGrid.setAttribute('aria-selected', String(mode === 'grid'));
    }
    if (btnList) {
      btnList.classList.toggle('is-active', mode === 'list');
      btnList.setAttribute('aria-selected', String(mode === 'list'));
    }

    if (gridEl) gridEl.style.display = mode === 'grid' ? '' : 'none';
    if (listEl) listEl.style.display = mode === 'list' ? '' : 'none';

    if (mode === 'list' && this.listItems.length === 0) {
      this.loadStudyList(this.listLevel, 0);
    }
  }

  setListLevel(level) {
    if (this.listLevel === level && this.listItems.length > 0) return;
    this.listLevel = level;

    const pills = this.container.querySelectorAll('.kanji-list-level-pill');
    pills.forEach((p) => p.classList.toggle('is-active', p.dataset.listLevel === level));

    this.listOffset = 0;
    this.listItems = [];
    this.listSearchQuery = '';
    const searchInput = document.getElementById('kanji-list-search-input');
    if (searchInput) searchInput.value = '';

    this.loadStudyList(level, 0);
  }

  toggleCoverMode() {
    this.isCoverMode = !this.isCoverMode;
    const btn = document.getElementById('btn-toggle-cover-mode');
    const list = document.getElementById('kanji-textbook-list');

    if (btn) {
      btn.classList.toggle('is-active', this.isCoverMode);
      btn.setAttribute('aria-pressed', String(this.isCoverMode));
      const span = btn.querySelector('span');
      if (span) span.textContent = this.isCoverMode ? 'Readings Blurred' : 'Blur Readings';
    }

    if (list) {
      list.classList.toggle('kanji-cover-active', this.isCoverMode);
      const readingBoxes = list.querySelectorAll('.kanji-list-readings');
      readingBoxes.forEach((rb) => {
        rb.classList.toggle('kanji-reading-blur', this.isCoverMode);
        rb.classList.remove('is-unblurred');
      });
    }
  }

  async loadStudyList(level = this.listLevel, offset = 0, append = false) {
    if (this.isLoadingList) return;
    this.isLoadingList = true;

    const listEl = document.getElementById('kanji-textbook-list');
    const summaryEl = document.getElementById('kanji-list-summary');
    const loadingEl = document.getElementById('kanji-list-loading');

    if (!append && listEl) {
      listEl.innerHTML = '<div class="text-xs text-muted py-8 text-center font-mono">Loading textbook study list...</div>';
    }
    if (loadingEl) loadingEl.style.display = 'block';

    try {
      const res = await apiClient.getKanjiStudyList({
        level: level,
        limit: this.listLimit,
        offset: offset,
      });

      const items = res?.items || [];
      this.listTotalCount = res?.total || 0;
      this.listOffset = offset;

      if (!append) {
        this.listItems = items;
        if (listEl) {
          if (items.length === 0) {
            listEl.innerHTML = '<div class="text-xs text-muted py-8 text-center font-mono">No kanji found for this level.</div>';
          } else {
            // Render first 50 items immediately for sub-16ms initial paint
            const firstBatch = items.slice(0, 50);
            listEl.innerHTML = firstBatch.map((it) => this.renderListRow(it)).join('');

            // Progressively append remaining items via requestAnimationFrame
            if (items.length > 50) {
              const remaining = items.slice(50);
              const chunkSize = 100;
              let currentIdx = 0;

              const renderNextChunk = () => {
                if (currentIdx >= remaining.length || this.listLevel !== level || this.viewMode !== 'list') return;
                const chunk = remaining.slice(currentIdx, currentIdx + chunkSize);
                currentIdx += chunkSize;
                const fragment = document.createRange().createContextualFragment(
                  chunk.map((it) => this.renderListRow(it)).join('')
                );
                listEl.appendChild(fragment);
                if (this.listSearchQuery) {
                  this.filterList(this.listSearchQuery);
                }
                if (currentIdx < remaining.length) {
                  requestAnimationFrame(renderNextChunk);
                }
              };
              requestAnimationFrame(renderNextChunk);
            }
          }
        }
      } else {
        this.listItems.push(...items);
        if (listEl) {
          const fragment = document.createRange().createContextualFragment(
            items.map((it) => this.renderListRow(it)).join('')
          );
          listEl.appendChild(fragment);
        }
      }

      if (summaryEl) {
        summaryEl.textContent = `Showing ${this.listItems.length} of ${this.listTotalCount} kanji in ${level}`;
      }

      if (this.listSearchQuery) {
        this.filterList(this.listSearchQuery);
      }
    } catch (err) {
      console.error('[Kanji] Load study list error:', err);
      if (!append && listEl) {
        listEl.innerHTML = '<div class="text-xs text-muted py-8 text-center font-mono">Failed to load study list. Please try again.</div>';
      }
    } finally {
      this.isLoadingList = false;
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  renderListRow(item) {
    const onyomiStr = Array.isArray(item.onyomi) && item.onyomi.length > 0
      ? item.onyomi.join('、 ')
      : '―';
    const kunyomiStr = Array.isArray(item.kunyomi) && item.kunyomi.length > 0
      ? item.kunyomi.join('、 ')
      : '―';
    const meaningsStr = Array.isArray(item.meanings) && item.meanings.length > 0
      ? item.meanings.slice(0, 3).join(', ')
      : '';

    const allCompounds = [
      ...(item.custom_compounds || []).map((c) => ({ ...c, isCustom: true })),
      ...(item.compounds || []).map((c) => ({ ...c, isCustom: false })),
    ];

    const compoundsHtml = allCompounds.map((comp) => {
      const term = escapeHtml(comp.term || comp.expression || '');
      const reading = escapeHtml(comp.reading || '');
      const meaning = escapeHtml(comp.meaning || '');
      const isCustom = comp.isCustom;

      let glyphHtml = term;
      if (reading && reading !== term) {
        glyphHtml = `<ruby>${term}<rt>${reading}</rt></ruby>`;
      }

      return `
        <div
          class="kanji-compound-chip ${isCustom ? 'kanji-compound-chip-custom' : ''}"
          data-term="${term}"
          data-reading="${reading}"
          data-meaning="${meaning}"
          data-char="${escapeHtml(item.character)}"
          role="button"
          tabindex="0"
          title="Inspect compound: ${term} (${reading}) - ${meaning}"
        >
          <span class="kanji-chip-head">${glyphHtml}</span>
          ${meaning ? `<span class="kanji-chip-gloss">${meaning}</span>` : ''}
        </div>
      `;
    }).join('');

    const searchHaystack = `${item.character} ${onyomiStr} ${kunyomiStr} ${meaningsStr} ${allCompounds.map((c) => c.term + ' ' + c.reading).join(' ')}`.toLowerCase();

    return `
      <div class="kanji-list-row tactile-card" data-char="${escapeHtml(item.character)}" data-search="${escapeHtml(searchHaystack)}">
        <span class="kanji-list-index">${item.index}</span>
        <span class="kanji-list-char font-display" role="button" tabindex="0" title="Inspect ${escapeHtml(item.character)} strokes" data-char="${escapeHtml(item.character)}">
          ${escapeHtml(item.character)}
        </span>
        <div class="kanji-list-readings ${this.isCoverMode ? 'kanji-reading-blur' : ''}">
          <div class="kanji-onyomi-line font-japanese" title="On'yomi (Katakana)">${escapeHtml(onyomiStr)}</div>
          <div class="kanji-kunyomi-line font-japanese" title="Kun'yomi (Hiragana)">${escapeHtml(kunyomiStr)}</div>
          ${meaningsStr ? `<div class="kanji-meaning-line text-muted" title="${escapeHtml(meaningsStr)}">${escapeHtml(meaningsStr)}</div>` : ''}
        </div>
        <div class="kanji-list-compounds">
          ${compoundsHtml}
          <button
            type="button"
            class="kanji-compound-add-btn"
            data-char="${escapeHtml(item.character)}"
            title="Add custom compound for ${escapeHtml(item.character)}"
            aria-label="Add custom compound"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  filterList(query) {
    this.listSearchQuery = query;
    const cleanQuery = query.trim().toLowerCase();
    const rows = this.container.querySelectorAll('.kanji-list-row');
    let visibleCount = 0;

    rows.forEach((row) => {
      const searchData = row.dataset.search || '';
      const char = row.dataset.char || '';
      const matches = !cleanQuery || searchData.includes(cleanQuery) || char.includes(cleanQuery);
      row.style.display = matches ? '' : 'none';
      if (matches) visibleCount++;
    });

    const summaryEl = document.getElementById('kanji-list-summary');
    if (summaryEl) {
      if (cleanQuery) {
        summaryEl.textContent = `Filtered: ${visibleCount} of ${this.listItems.length} kanji matching "${escapeHtml(query)}"`;
      } else {
        summaryEl.textContent = `Showing ${this.listItems.length} of ${this.listTotalCount} kanji in ${this.listLevel}`;
      }
    }
  }

  openCardInspector(data) {
    this.activeInspectorCompound = data;
    const drawer = document.getElementById('kanji-card-inspector');
    const backdrop = document.getElementById('kanji-inspector-backdrop');
    if (!drawer || !backdrop) return;

    const termInput = document.getElementById('kanji-insp-term');
    const readingInput = document.getElementById('kanji-insp-reading');
    const meaningInput = document.getElementById('kanji-insp-meaning');
    const tagsInput = document.getElementById('kanji-insp-tags');
    const notesInput = document.getElementById('kanji-insp-notes');
    const feedback = document.getElementById('kanji-insp-feedback');

    if (termInput) termInput.value = data.term || '';
    if (readingInput) readingInput.value = data.reading || '';
    if (meaningInput) meaningInput.value = data.meaning || '';
    if (tagsInput) tagsInput.value = `kanji, ${this.listLevel || 'N?'}, ${data.char || ''}`;
    if (notesInput) notesInput.value = '';
    if (feedback) feedback.style.display = 'none';

    backdrop.style.display = 'block';
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
  }

  closeCardInspector() {
    this.activeInspectorCompound = null;
    const drawer = document.getElementById('kanji-card-inspector');
    const backdrop = document.getElementById('kanji-inspector-backdrop');
    if (drawer) {
      drawer.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
    }
    if (backdrop) backdrop.style.display = 'none';
  }

  async mineCurrentCard() {
    const termInput = document.getElementById('kanji-insp-term');
    const readingInput = document.getElementById('kanji-insp-reading');
    const meaningInput = document.getElementById('kanji-insp-meaning');
    const tagsInput = document.getElementById('kanji-insp-tags');
    const notesInput = document.getElementById('kanji-insp-notes');
    const deckSelect = document.getElementById('kanji-insp-deck');
    const feedback = document.getElementById('kanji-insp-feedback');
    const btnMine = document.getElementById('btn-kanji-insp-mine');

    const term = termInput?.value.trim();
    const reading = readingInput?.value.trim() || term;
    const meaning = meaningInput?.value.trim() || '';
    const tags = tagsInput?.value.trim() || '';
    const notes = notesInput?.value.trim() || '';
    const deck = deckSelect?.value || 'Default';

    if (!term) return;

    if (btnMine) btnMine.disabled = true;
    if (feedback) {
      feedback.style.display = 'block';
      feedback.style.color = 'var(--text-muted)';
      feedback.textContent = 'Mining card...';
    }

    try {
      await apiClient.saveCard({
        expression: term,
        reading: reading,
        meaning: meaning,
        tags: tags,
        notes: notes,
        deck_name: deck,
        card_kind: 'vocab',
        jlpt_level: this.listLevel,
      });

      if (feedback) {
        feedback.style.color = 'var(--gold-eye)';
        feedback.textContent = 'Card successfully mined to Kiroku & Anki!';
      }
      setTimeout(() => {
        this.closeCardInspector();
        if (btnMine) btnMine.disabled = false;
      }, 700);
    } catch (err) {
      console.error('[Kanji] Mine card error:', err);
      if (feedback) {
        feedback.style.color = 'var(--vermilion)';
        feedback.textContent = `Mining failed: ${err.message || 'Error saving card'}`;
      }
      if (btnMine) btnMine.disabled = false;
    }
  }

  openAddPopover(char, targetBtn) {
    this.activePopoverKanji = char;
    const popover = document.getElementById('kanji-add-popover');
    const title = document.getElementById('kanji-add-popover-title');
    const termInput = document.getElementById('kanji-add-term');
    const readingInput = document.getElementById('kanji-add-reading');
    const meaningInput = document.getElementById('kanji-add-meaning');

    if (!popover || !targetBtn) return;

    if (title) title.textContent = `Add Compound for ${char}`;
    if (termInput) {
      termInput.value = '';
      termInput.placeholder = `e.g. ${char}...`;
    }
    if (readingInput) readingInput.value = '';
    if (meaningInput) meaningInput.value = '';

    const rect = targetBtn.getBoundingClientRect();
    const popoverWidth = 280;
    let left = rect.left - popoverWidth + 30;
    if (left < 10) left = 10;
    let top = rect.bottom + 8;
    if (top + 220 > window.innerHeight) {
      top = rect.top - 230;
    }

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.display = 'flex';

    setTimeout(() => termInput?.focus(), 50);
  }

  closeAddPopover() {
    this.activePopoverKanji = null;
    const popover = document.getElementById('kanji-add-popover');
    if (popover) popover.style.display = 'none';
  }

  async saveCustomCompound() {
    const termInput = document.getElementById('kanji-add-term');
    const readingInput = document.getElementById('kanji-add-reading');
    const meaningInput = document.getElementById('kanji-add-meaning');

    const char = this.activePopoverKanji;
    const term = termInput?.value.trim();
    const reading = readingInput?.value.trim() || term;
    const meaning = meaningInput?.value.trim() || '';

    if (!char || !term) return;

    try {
      await apiClient.addCustomCompound({
        character: char,
        term,
        reading,
        meaning,
      });

      const row = this.container.querySelector(`.kanji-list-row[data-char="${char}"]`);
      if (row) {
        const tray = row.querySelector('.kanji-list-compounds');
        const addBtn = tray?.querySelector('.kanji-compound-add-btn');
        if (tray && addBtn) {
          let glyphHtml = escapeHtml(term);
          if (reading && reading !== term) {
            glyphHtml = `<ruby>${escapeHtml(term)}<rt>${escapeHtml(reading)}</rt></ruby>`;
          }
          const chipHtml = `
            <div
              class="kanji-compound-chip kanji-compound-chip-custom"
              data-term="${escapeHtml(term)}"
              data-reading="${escapeHtml(reading)}"
              data-meaning="${escapeHtml(meaning)}"
              data-char="${escapeHtml(char)}"
              role="button"
              tabindex="0"
              title="Inspect compound: ${escapeHtml(term)} (${escapeHtml(reading)}) - ${escapeHtml(meaning)}"
            >
              <span class="kanji-chip-head">${glyphHtml}</span>
              ${meaning ? `<span class="kanji-chip-gloss">${escapeHtml(meaning)}</span>` : ''}
            </div>
          `;
          const chipEl = document.createRange().createContextualFragment(chipHtml);
          tray.insertBefore(chipEl, addBtn);
        }
      }

      this.closeAddPopover();
    } catch (err) {
      console.error('[Kanji] Save custom compound error:', err);
    }
  }

  unmount() {
    this.pauseStrokes();
    if (this._scrollListener) {
      const viewContainer = document.getElementById('view-container');
      if (viewContainer) {
        viewContainer.removeEventListener('scroll', this._scrollListener);
      }
      window.removeEventListener('scroll', this._scrollListener);
      this._scrollListener = null;
    }
    if (this._keydownListener) {
      window.removeEventListener('keydown', this._keydownListener);
      this._keydownListener = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  onHide() {
    this.pauseStrokes();
  }
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
