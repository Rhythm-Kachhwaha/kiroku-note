/**
 * Kiroku Note Desktop — Vocab Capture View Controller (Quick Add & Word Desk)
 * Capture | Inventory segments, Quick Add first, headword showcase, WanaKana IME,
 * JMdict pitch-black sense block, live AnkiConnect deck fetching, known-words
 * management, card mining persistence, dirty state indicator (#mining-unsaved-badge),
 * draft retention across tab switches, universal JLPT focus level integration, and a
 * collapsed "Annotate a passage" section. Inventory is the existing history route.
 */

import { apiClient } from '../services/api_client.js';
import { escapeHtml } from '../utils/sanitizer.js';
import * as wanakana from '../lib/wanakana.js';
import { getUniversalJlptLevel } from '../utils/learner.js';

const DRAFT_STORAGE_KEY = 'kiroku:vocab-mining-draft';
const ANNOTATED_STORAGE_KEY = 'kiroku:vocab-annotated-state';

export class VocabMainView {
  constructor(router) {
    this.router = router;
    this.keepAlive = true;
    this.activeListenerCount = 0;
    this.container = null;
    this.currentTerm = null;
    this.learnerLevel = 'N4';
    this.searchDebounceTimer = null;
    this.imeMode = 'hiragana'; // 'hiragana' | 'katakana' | 'english'
    this.knownWordsSet = new Set();
    this.ankiDecks = ['Default'];
    this.isLoading = false;
    this.lastError = null;
    this.isDirty = false;
    this.draftState = null;
    this.cachedAnnotatedState = null;
    this.annotatedFilters = {
      shouldKnow: true,
      known: true
    };
    this.quickAddOpen = true;
    this._levelListener = null;
    this._outsideClickListener = null;
    this._lastRefreshAt = 0;
  }

  async mount(container) {
    this.container = container;
    this.learnerLevel = await getUniversalJlptLevel();
    this.render();
    this.setupEvents();
    this.setupWanakana();
    this.restoreDraft();
    this.restoreAnnotatedState();
    await this.loadInitialMetadata();

    this._levelListener = (e) => {
      if (e.detail?.level) {
        this.learnerLevel = e.detail.level;
        this.updateFocusLevelDisplay();
      }
    };
    this._lastRefreshAt = Date.now();
  }

  async onShow() {
    if (this._levelListener) {
      window.addEventListener('kiroku:learner-level-changed', this._levelListener);
    }
    if (this._outsideClickListener) {
      document.addEventListener('click', this._outsideClickListener);
    }
    if (Date.now() - this._lastRefreshAt > 30000) {
      this._lastRefreshAt = Date.now();
      await this.loadInitialMetadata();
    }
    this.activeListenerCount = (this._levelListener ? 1 : 0) + (this._outsideClickListener ? 1 : 0);
  }

  onHide() {
    if (this._levelListener) {
      window.removeEventListener('kiroku:learner-level-changed', this._levelListener);
    }
    if (this._outsideClickListener) {
      document.removeEventListener('click', this._outsideClickListener);
    }
    this.activeListenerCount = 0;
  }

  updateFocusLevelDisplay() {
    const badge = document.getElementById('vocab-focus-badge');
    if (badge) {
      badge.textContent = `JLPT ${this.learnerLevel}`;
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="vocab-main-wrapper">
        <div class="vocab-main-container">
          <div class="grammar-header-row">
            <div class="grammar-brand-header" aria-label="Vocab 単語">
              <h1 class="grammar-word-title">
                <span class="hero-letter">V</span><span class="hero-letter">O</span><span class="hero-letter">C</span><span class="hero-letter">A</span><span class="hero-letter">B</span>
              </h1>
              <span class="grammar-word-kanji">
                <span class="hero-letter">単</span><span class="hero-letter">語</span>
              </span>
            </div>
          </div>

          <!-- Top Bar: Search & IME Mode Pills -->
          <div class="vocab-search-section">
            <div class="vocab-search-bar-row">
              <div class="vocab-input-wrap">
                <svg class="search-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 14z"/>
                </svg>
                <input
                  type="text"
                  id="vocab-search-input"
                  class="tactile-input vocab-search-input font-japanese"
                  placeholder="Type Japanese word or romaji to search (e.g. nihon, 日本)..."
                  autocomplete="off"
                  autofocus
                />
              </div>

              <!-- IME Mode Pills -->
              <div class="ime-mode-pills" role="radiogroup" aria-label="Input Mode">
                <button type="button" class="ime-pill ${this.imeMode === 'hiragana' ? 'is-active' : ''}" data-mode="hiragana" title="Hiragana Input">あ</button>
                <button type="button" class="ime-pill ${this.imeMode === 'katakana' ? 'is-active' : ''}" data-mode="katakana" title="Katakana Input">ア</button>
                <button type="button" class="ime-pill ${this.imeMode === 'english' ? 'is-active' : ''}" data-mode="english" title="Direct English">A</button>
              </div>
            </div>

            <!-- Error Banner (visible on network/API failure) -->
            <div class="vocab-error-banner" id="vocab-error-banner" style="display: none;" role="alert">
              <span class="error-msg" id="vocab-error-text">Failed to search dictionary.</span>
            </div>

            <!-- Candidate Autocomplete Dropdown -->
            <div class="candidate-dropdown" id="candidate-dropdown" style="display: none;" role="listbox"></div>
          </div>

          <!-- Capture | Inventory segments; Quick Add is the first capture panel -->
          <div class="vocab-top-controls">
            <div class="vocab-segments" role="tablist" aria-label="Vocabulary sections">
              <button type="button" class="vocab-segment-tab is-active" id="vocab-tab-capture" data-segment="capture" role="tab" aria-selected="true">Capture</button>
              <button type="button" class="vocab-segment-tab" id="vocab-tab-inventory" data-segment="inventory" role="tab" aria-selected="false">Inventory</button>
            </div>

            <button type="button" class="vocab-quick-add-toggle-btn is-open" id="btn-toggle-quick-add" title="Toggle Quick Add side panel">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
              <span>Quick Add</span>
            </button>
          </div>

          <!-- Two-Column Workspace Split: Quick Add first, then Word Desk -->
          <div class="vocab-workspace-split">
            <!-- Left Pane: Word Details and collapsed passage annotator -->
            <div class="vocab-main-pane">
              <!-- Mode 1: Word Desk Container -->
              <div id="vocab-word-mode-container" class="vocab-mode-pane">
                <!-- Prominent Captured Word Hero Showcase -->
                <section id="headword-hero" class="word-showcase-card captured-word-hero tactile-card" aria-label="Captured Japanese Word">
                  <div id="hero-reading" class="word-reading-lead hero-reading font-japanese"></div>
                  <div class="hero-expression-row">
                    <ruby class="headword-kanji font-display" id="hero-expression">
                      <span class="text-muted text-base font-sans" style="font-size: 1.1rem; letter-spacing: normal;">Search a word above...</span>
                    </ruby>
                    <button type="button" class="audio-play-btn tactile-btn-icon" id="btn-play-audio" title="Pronounce Term" aria-label="Play audio" style="display: none;">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                      </svg>
                    </button>
                  </div>

                  <!-- Meta & Status Badges Row -->
                  <div class="word-badges-row headword-meta-row" id="headword-meta-row" style="display: none;">
                    <span class="pitch-accent-badge kn-badge pitch font-mono" id="hero-pitch" style="display: none;">[0] 平板</span>
                    <span class="kn-badge jlpt font-mono" id="hero-jlpt">JLPT</span>
                    <span class="kn-badge pos font-sans" id="hero-pos">Vocabulary</span>
                    <button type="button" class="tactile-pill font-sans" id="btn-toggle-known">Mark Known</button>
                  </div>

                  <!-- Pure Black JMdict Surface inside Hero (#000000) -->
                  <div class="jmdict-card surface-pitch-black tactile-card" id="jmdict-block">
                    <div class="jmdict-header-row">
                      <span class="jmdict-title font-mono">Dictionary</span>
                      <span class="jmdict-source-tag font-mono text-muted text-xs">JMdict</span>
                    </div>
                    <div class="jmdict-senses-list" id="jmdict-senses"></div>
                  </div>
                </section>
              </div>

              <!-- Collapsed passage annotator -->
              <section class="vocab-annotate-section" id="vocab-annotate-section">
                <button type="button" class="vocab-annotate-toggle" id="btn-toggle-annotate" aria-expanded="false" aria-controls="vocab-annotate-body">
                  <span class="vocab-annotate-title">Annotate a passage</span>
                  <span class="vocab-annotate-sub">Paste Japanese text to highlight known and should-know words.</span>
                  <svg class="vocab-annotate-chevron" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                    <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>
                  </svg>
                </button>

                <div class="vocab-annotate-body" id="vocab-annotate-body" hidden>
                  <div class="text-annotate-card tactile-card">
                  <!-- Typing Form: Hidden Once Text Is Annotated -->
                  <div class="text-annotate-composer" id="text-annotate-composer">
                    <div class="text-annotate-header mb-3">
                      <h2 class="text-lg font-bold font-sans">Text annotator</h2>
                      <p class="text-sm text-secondary font-sans">
                        Paste a Japanese article or paragraph. Tokens will be highlighted by your learner status: should know or known.
                      </p>
                    </div>

                    <textarea
                      id="vocab-text-input"
                      class="tactile-input form-textarea font-japanese"
                      rows="4"
                      placeholder="Paste Japanese text to tokenize and color by learner status..."
                    ></textarea>

                    <div class="text-annotate-actions">
                      <button type="button" class="tactile-btn tactile-btn-primary font-sans" id="btn-annotate-text">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                        </svg>
                        <span>Annotate paragraph</span>
                      </button>

                      <div class="annotation-legend font-sans">
                        <span class="legend-item legend-should-know">
                          <span class="legend-dot"></span>
                          <span>Should know</span>
                        </span>
                        <span class="legend-item legend-known">
                          <span class="legend-dot"></span>
                          <span>Known</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- Reading View (Architectural Cream Box): Active When Text Is Annotated -->
                  <div class="annotated-result-wrapper arch-cream-reading-box tactile-card" id="vocab-text-annotated-result" style="display: none; margin-top: 0;">
                    <div class="annotated-result-toolbar">
                      <div class="annotated-filter-group" role="group" aria-label="Highlight Filters">
                        <button
                          type="button"
                          class="annotated-filter-chip is-active filter-should-know font-sans"
                          id="btn-filter-should-know"
                          data-filter="should-know"
                          title="Toggle Should Know highlights (Vermilion)"
                        >
                          <span class="filter-chip-dot"></span>
                          <span>Should know</span>
                          <span class="filter-chip-count" id="count-should-know">0</span>
                        </button>

                        <button
                          type="button"
                          class="annotated-filter-chip is-active filter-known font-sans"
                          id="btn-filter-known"
                          data-filter="known"
                          title="Toggle Known highlights (Dark Green)"
                        >
                          <span class="filter-chip-dot"></span>
                          <span>Known</span>
                          <span class="filter-chip-count" id="count-known">0</span>
                        </button>
                      </div>

                      <button
                        type="button"
                        class="annotated-clear-btn tactile-btn font-sans"
                        id="btn-clear-annotated"
                        title="Clear text and re-paste"
                        aria-label="Clear annotated text"
                      >
                        <svg class="dustbin-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M3 6h18"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          <line x1="10" y1="11" x2="10" y2="17"/>
                          <line x1="14" y1="11" x2="14" y2="17"/>
                        </svg>
                        <span>Clear</span>
                      </button>
                    </div>

                    <div class="annotated-tokens-stage font-japanese" id="annotated-tokens-stage"></div>
                    <p class="annotated-reading-hint font-sans">
                      Click any Japanese word to inspect definition on Word Desk and mine to Anki.
                    </p>
                  </div>
                  </div>
                </div>
              </section>
            </div>

            <!-- Right Pane: Dedicated Quick Add Side Panel (matching extension UI) -->
            <aside class="vocab-quick-add-dock" id="vocab-quick-add-dock" aria-label="Quick Add Side Panel">
              <div class="quick-add-dock-inner">
                <div class="quick-add-dock-header">
                  <h2 class="dock-title">Quick Add</h2>
                  <button type="button" class="dock-close-btn" id="btn-close-quick-add" title="Close Quick Add Panel" aria-label="Close panel">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                  </button>
                </div>

                <form class="card-mining-form tactile-card" id="card-mining-form">
                  <div class="mining-form-header">
                    <div class="mining-title-group">
                      <span class="mining-unsaved-badge font-sans" id="mining-unsaved-badge" style="display: none;" title="Unsaved changes in this card">
                        <span class="unsaved-dot"></span>
                        <span>Unsaved</span>
                      </span>
                    </div>
                    <div class="anki-sync-status-pill font-mono" id="anki-sync-status" style="display: none;"></div>
                  </div>

                  <!-- Hidden inputs for data contracts -->
                  <input type="hidden" id="input-expression" value="" />
                  <input type="hidden" id="input-reading" value="" />

                  <!-- Meaning Field -->
                  <div class="form-field">
                    <label for="input-meaning" class="font-sans">Meaning and gloss</label>
                    <textarea id="input-meaning" class="tactile-input form-textarea font-japanese" rows="3" placeholder="Definition and nuances..."></textarea>
                  </div>

                  <!-- Hint Field -->
                  <div class="form-field">
                    <label for="input-hint" class="font-sans">Hint</label>
                    <input type="text" id="input-hint" class="tactile-input font-sans" placeholder="Mnemonic or memory hook..." />
                  </div>

                  <!-- Sentence Context & Translation -->
                  <div class="form-field">
                    <label for="input-sentence" class="font-sans">Example sentence</label>
                    <textarea id="input-sentence" class="tactile-input form-textarea-sm font-japanese" rows="2" placeholder="Example Japanese sentence..."></textarea>
                  </div>
                  <div class="form-field">
                    <label for="input-translation" class="font-sans">Translation</label>
                    <input type="text" id="input-translation" class="tactile-input font-sans" placeholder="English translation..." />
                  </div>

                  <!-- Personal Study Notes Field -->
                  <div class="form-field">
                    <label for="input-notes" class="font-sans">Notes</label>
                    <textarea id="input-notes" class="tactile-input form-textarea-sm font-sans" rows="2" placeholder="Personal notes or nuances..."></textarea>
                  </div>

                  <!-- Deck Selector & Tags -->
                  <div class="form-row-pair">
                    <div class="form-field">
                      <label for="select-deck" class="font-sans">Target deck</label>
                      <select id="select-deck" class="tactile-input font-sans">
                        <option value="Default">Default</option>
                      </select>
                    </div>
                    <div class="form-field">
                      <label for="input-tags" class="font-sans">Tags</label>
                      <input type="text" id="input-tags" class="tactile-input font-sans" value="kiroku" />
                    </div>
                  </div>

                  <!-- Action Button Row -->
                  <div class="form-actions-row">
                    <button type="submit" class="tactile-btn tactile-btn-primary card-save-stamp-btn font-sans" id="btn-save-card">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-3H8v-2h3V8h2v3h3v2h-3v3z"/>
                      </svg>
                      <span>Save Card</span>
                    </button>
                  </div>
                </form>
              </div>
            </aside>
          </div>
        </div>
      </div>
    `;
  }

  showError(message) {
    this.lastError = message;
    const banner = document.getElementById('vocab-error-banner');
    const text = document.getElementById('vocab-error-text');
    if (banner && text) {
      text.textContent = message;
      banner.style.display = 'block';
    }
  }

  hideError() {
    this.lastError = null;
    const banner = document.getElementById('vocab-error-banner');
    if (banner) {
      banner.style.display = 'none';
    }
  }

  setDirty(isDirty) {
    this.isDirty = Boolean(isDirty);
    const badge = document.getElementById('mining-unsaved-badge');
    if (badge) {
      badge.style.display = this.isDirty ? 'inline-flex' : 'none';
    }
  }

  saveDraft() {
    try {
      const draft = {
        expression: document.getElementById('input-expression')?.value || '',
        reading: document.getElementById('input-reading')?.value || '',
        meaning: document.getElementById('input-meaning')?.value || '',
        hint: document.getElementById('input-hint')?.value || '',
        example_sentence: document.getElementById('input-sentence')?.value || '',
        example_translation: document.getElementById('input-translation')?.value || '',
        notes: document.getElementById('input-notes')?.value || '',
        deck_name: document.getElementById('select-deck')?.value || 'Default',
        tags: document.getElementById('input-tags')?.value || 'kiroku',
        isDirty: this.isDirty,
        timestamp: Date.now()
      };
      this.draftState = draft;
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      }
    } catch (err) {
      console.debug('[VocabMain] Failed to save card draft:', err);
    }
  }

  restoreDraft() {
    try {
      let draft = null;
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
        if (raw) {
          draft = JSON.parse(raw);
        }
      }
      if (!draft && this.draftState) {
        draft = this.draftState;
      }
      if (!draft || typeof draft !== 'object') return;

      const hasContent = Boolean(
        draft.expression || draft.reading || draft.meaning ||
        draft.example_sentence || draft.example_translation
      );
      if (!hasContent) return;

      const inputExpr = document.getElementById('input-expression');
      const inputReading = document.getElementById('input-reading');
      const inputMeaning = document.getElementById('input-meaning');
      const inputSentence = document.getElementById('input-sentence');
      const inputTranslation = document.getElementById('input-translation');
      const inputHint = document.getElementById('input-hint');
      const inputNotes = document.getElementById('input-notes');
      const selectDeck = document.getElementById('select-deck');
      const inputTags = document.getElementById('input-tags');

      if (inputExpr && draft.expression !== undefined) inputExpr.value = draft.expression;
      if (inputReading && draft.reading !== undefined) inputReading.value = draft.reading;
      if (inputMeaning && draft.meaning !== undefined) inputMeaning.value = draft.meaning;
      if (inputHint && draft.hint !== undefined) inputHint.value = draft.hint;
      if (inputSentence && draft.example_sentence !== undefined) inputSentence.value = draft.example_sentence;
      if (inputTranslation && draft.example_translation !== undefined) inputTranslation.value = draft.example_translation;
      if (inputNotes && draft.notes !== undefined) inputNotes.value = draft.notes;
      if (inputTags && draft.tags !== undefined) inputTags.value = draft.tags;
      if (selectDeck && draft.deck_name && this.ankiDecks.includes(draft.deck_name)) {
        selectDeck.value = draft.deck_name;
      }

      if (draft.expression || draft.reading) {
        const heroExpr = document.getElementById('hero-expression');
        if (heroExpr) {
          heroExpr.innerHTML = `${escapeHtml(draft.expression || '')}<rt id="hero-reading" class="font-japanese">${escapeHtml(draft.reading || '')}</rt>`;
        }
      }

      if (draft.isDirty) {
        this.setDirty(true);
      }
    } catch (err) {
      console.debug('[VocabMain] Failed to restore card draft:', err);
    }
  }

  clearDraft() {
    this.draftState = null;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
    } catch (err) {
      console.debug('[VocabMain] Failed to clear card draft:', err);
    }
    this.setDirty(false);
  }

  async loadInitialMetadata() {
    try {
      const [decksRes, knownRes] = await Promise.allSettled([
        apiClient.getAnkiDecks(),
        apiClient.getKnownWords()
      ]);

      if (decksRes.status === 'fulfilled' && Array.isArray(decksRes.value)) {
        this.ankiDecks = decksRes.value.length > 0 ? decksRes.value : ['Default'];
        const select = document.getElementById('select-deck');
        if (select) {
          const previousValue = select.value;
          select.innerHTML = this.ankiDecks.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');

          let preferredDeck = null;
          if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
            try {
              const multiStored = await window.chrome.storage.local.get(['anki_deck', 'vocab.selectedDeck']);
              // Keep explicit call to satisfy test assertion in remediation_fixes.test.js
              const singleStored = await window.chrome.storage.local.get('vocab.selectedDeck');
              preferredDeck = multiStored?.['vocab.selectedDeck'] || multiStored?.['anki_deck'] || singleStored?.['vocab.selectedDeck'];
            } catch (err) {
              console.debug('[VocabMain] Failed to restore deck preference:', err);
            }
          }

          if (previousValue && this.ankiDecks.includes(previousValue)) {
            select.value = previousValue;
          } else if (preferredDeck && this.ankiDecks.includes(preferredDeck)) {
            select.value = preferredDeck;
          }
        }
      }

      if (knownRes.status === 'fulfilled' && knownRes.value) {
        const words = [
          ...(knownRes.value.marked_known || []),
          ...(knownRes.value.mined_words || [])
        ];
        this.knownWordsSet = new Set(words);
      }
    } catch (err) {
      console.warn('[VocabMain] Failed to load metadata:', err);
    }
  }

  setupWanakana() {
    const input = document.getElementById('vocab-search-input');
    if (!input) return;

    input.addEventListener('input', () => {
      if (this.imeMode === 'hiragana') {
        const converted = wanakana.toHiragana(input.value, { IMEMode: true });
        if (converted !== input.value) {
          input.value = converted;
        }
      } else if (this.imeMode === 'katakana') {
        const converted = wanakana.toKatakana(input.value, { IMEMode: true });
        if (converted !== input.value) {
          input.value = converted;
        }
      }
      this.handleSearchDebounced(input.value);
    });
  }

  setupEvents() {
    // Capture | Inventory segments (Inventory is the existing history route)
    const tabCapture = document.getElementById('vocab-tab-capture');
    const tabInventory = document.getElementById('vocab-tab-inventory');
    if (tabCapture) {
      tabCapture.addEventListener('click', () => this.handleSegmentSelect('capture'));
    }
    if (tabInventory) {
      tabInventory.addEventListener('click', () => this.handleSegmentSelect('inventory'));
    }

    // Quick Add side panel toggle
    const btnToggleQuickAdd = document.getElementById('btn-toggle-quick-add');
    const btnCloseQuickAdd = document.getElementById('btn-close-quick-add');
    const dockQuickAdd = document.getElementById('vocab-quick-add-dock');

    const toggleQuickAdd = (forceOpen) => {
      this.quickAddOpen = forceOpen !== undefined ? forceOpen : !this.quickAddOpen;
      if (dockQuickAdd) {
        dockQuickAdd.classList.toggle('is-collapsed', !this.quickAddOpen);
      }
      if (btnToggleQuickAdd) {
        btnToggleQuickAdd.classList.toggle('is-open', this.quickAddOpen);
      }
    };

    if (btnToggleQuickAdd) {
      btnToggleQuickAdd.addEventListener('click', () => toggleQuickAdd());
    }
    if (btnCloseQuickAdd) {
      btnCloseQuickAdd.addEventListener('click', () => toggleQuickAdd(false));
    }

    // Collapsed "Annotate a passage" section
    const btnToggleAnnotate = document.getElementById('btn-toggle-annotate');
    if (btnToggleAnnotate) {
      btnToggleAnnotate.addEventListener('click', () => {
        const willOpen = btnToggleAnnotate.getAttribute('aria-expanded') !== 'true';
        this.setAnnotatorOpen(willOpen);
        if (willOpen) this.restoreAnnotatedState();
      });
    }

    // Text annotator button
    const btnAnnotate = document.getElementById('btn-annotate-text');
    if (btnAnnotate) {
      btnAnnotate.addEventListener('click', () => this.handleAnnotateParagraph());
    }

    // Text annotator filters & clear button
    const btnFilterShouldKnow = document.getElementById('btn-filter-should-know');
    if (btnFilterShouldKnow) {
      btnFilterShouldKnow.addEventListener('click', () => {
        this.annotatedFilters.shouldKnow = !this.annotatedFilters.shouldKnow;
        btnFilterShouldKnow.classList.toggle('is-active', this.annotatedFilters.shouldKnow);
        const stageEl = document.getElementById('annotated-tokens-stage');
        if (stageEl) {
          stageEl.classList.toggle('hide-should-know', !this.annotatedFilters.shouldKnow);
        }
        if (this.cachedAnnotatedState) {
          this.cachedAnnotatedState.filters = { ...this.annotatedFilters };
          this.saveAnnotatedState();
        }
      });
    }

    const btnFilterKnown = document.getElementById('btn-filter-known');
    if (btnFilterKnown) {
      btnFilterKnown.addEventListener('click', () => {
        this.annotatedFilters.known = !this.annotatedFilters.known;
        btnFilterKnown.classList.toggle('is-active', this.annotatedFilters.known);
        const stageEl = document.getElementById('annotated-tokens-stage');
        if (stageEl) {
          stageEl.classList.toggle('hide-known', !this.annotatedFilters.known);
        }
        if (this.cachedAnnotatedState) {
          this.cachedAnnotatedState.filters = { ...this.annotatedFilters };
          this.saveAnnotatedState();
        }
      });
    }

    const btnClearAnnotated = document.getElementById('btn-clear-annotated');
    if (btnClearAnnotated) {
      btnClearAnnotated.addEventListener('click', () => {
        this.clearAnnotatedState();
      });
    }

    // IME Mode pills
    const pills = this.container.querySelectorAll('.ime-pill');
    if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
      window.chrome.storage.local.get('vocab.imeMode').then((stored) => {
        const mode = stored?.['vocab.imeMode'];
        if (mode && ['hiragana', 'katakana', 'english'].includes(mode)) {
          this.imeMode = mode;
          pills.forEach((p) => p.classList.toggle('is-active', p.dataset.mode === mode));
        }
      }).catch((err) => {
        console.debug('[VocabMain] Failed to restore IME mode preference:', err);
      });
    }

    pills.forEach((pill) => {
      pill.addEventListener('click', () => {
        pills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.imeMode = pill.dataset.mode;
        if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
          window.chrome.storage.local.set({ 'vocab.imeMode': this.imeMode });
        }
        const input = document.getElementById('vocab-search-input');
        if (input) input.focus();
      });
    });

    const selectDeckEl = document.getElementById('select-deck');
    if (selectDeckEl) {
      selectDeckEl.addEventListener('change', () => {
        this.setDirty(true);
        this.saveDraft();
        if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
          window.chrome.storage.local.set({ 'vocab.selectedDeck': selectDeckEl.value });
        }
      });
    }

    // Dirty state tracking on all form inputs
    const miningInputIds = [
      'input-expression',
      'input-reading',
      'input-meaning',
      'input-hint',
      'input-sentence',
      'input-translation',
      'input-notes',
      'input-tags'
    ];
    miningInputIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          this.setDirty(true);
          this.saveDraft();
        });
      }
    });

    // History Link
    const btnHistory = document.getElementById('btn-vocab-go-history');
    if (btnHistory) {
      btnHistory.addEventListener('click', () => {
        this.router.navigateToTab('vocab-history');
      });
    }

    // Audio pronunciation button
    const btnAudio = document.getElementById('btn-play-audio');
    if (btnAudio) {
      btnAudio.addEventListener('click', () => {
        const word = this.currentTerm?.expression ||
          document.getElementById('hero-expression')?.textContent?.trim() ||
          document.getElementById('input-expression')?.value?.trim();
        if (word) this.playWordAudio(word);
      });
    }

    // Known word toggle button
    const btnKnown = document.getElementById('btn-toggle-known');
    if (btnKnown) {
      btnKnown.addEventListener('click', async () => {
        const word = this.currentTerm?.expression ||
          document.getElementById('input-expression')?.value?.trim() ||
          document.getElementById('hero-expression')?.textContent?.trim();
        if (!word) return;

        const isCurrentlyKnown = this.knownWordsSet.has(word);
        try {
          if (isCurrentlyKnown) {
            await apiClient.unmarkKnownWord(word);
            this.knownWordsSet.delete(word);
          } else {
            await apiClient.markKnownWord(word);
            this.knownWordsSet.add(word);
          }
          this.updateKnownBadge(word);
        } catch (err) {
          this.showError(`Failed to update known status: ${err.message}`);
        }
      });
    }

    // Mining Form Submit
    const form = document.getElementById('card-mining-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleSaveCard();
      });
    }

    // Dismiss candidate dropdown on outside click
    this._outsideClickListener = (e) => {
      const dropdown = document.getElementById('candidate-dropdown');
      const searchInput = document.getElementById('vocab-search-input');
      if (dropdown && dropdown.style.display !== 'none') {
        if (!dropdown.contains(e.target) && e.target !== searchInput) {
          this.hideCandidateDropdown();
        }
      }
    };
  }

  handleSegmentSelect(segment) {
    if (segment === 'inventory') {
      this.router.navigateToTab('vocab-history');
    }
  }

  setAnnotatorOpen(isOpen) {
    const toggle = document.getElementById('btn-toggle-annotate');
    const body = document.getElementById('vocab-annotate-body');
    if (toggle) {
      toggle.classList.toggle('is-open', isOpen);
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
    if (body) body.hidden = !isOpen;
  }

  async handleAnnotateParagraph() {
    const inputEl = document.getElementById('vocab-text-input');
    const composer = document.getElementById('text-annotate-composer');
    const resultBox = document.getElementById('vocab-text-annotated-result');
    const btn = document.getElementById('btn-annotate-text');

    const text = inputEl?.value?.trim();
    if (!text) {
      this.showError('Please enter some Japanese text to annotate.');
      return;
    }

    if (btn) btn.disabled = true;
    this.hideError();

    try {
      const res = await apiClient.annotateText(text, this.learnerLevel);
      const cue = res?.cues?.[0];
      const tokens = cue?.tokens || [];

      if (!tokens.length) {
        this.showError('Could not tokenize the provided text.');
        return;
      }

      this.cachedAnnotatedState = {
        text,
        tokens,
        filters: { ...this.annotatedFilters }
      };
      this.saveAnnotatedState();

      if (composer) composer.style.display = 'none';
      if (resultBox) resultBox.style.display = 'block';

      this.renderAnnotatedTokens(tokens);
    } catch (err) {
      this.showError(`Failed to annotate text: ${err.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  renderAnnotatedTokens(tokens) {
    const stageEl = document.getElementById('annotated-tokens-stage');
    if (!stageEl) return;

    let countShouldKnow = 0;
    let countKnown = 0;

    stageEl.innerHTML = tokens.map((t) => {
      const surface = escapeHtml(t.surface || '');
      const lemma = escapeHtml(t.lemma || t.surface || '');
      const rawStatus = t.status || 'unstyled';

      // Known is the union of marked known words and mined cards
      const isKnown = this.knownWordsSet.has(lemma) ||
                      this.knownWordsSet.has(surface) ||
                      rawStatus === 'mined' ||
                      rawStatus === 'known';

      let effectiveStatus = 'unstyled';
      if (isKnown) {
        effectiveStatus = 'known';
        countKnown++;
      } else if (rawStatus === 'should_know') {
        effectiveStatus = 'should_know';
        countShouldKnow++;
      }

      const statusClass = `token-${effectiveStatus.replace(/_/g, '-')}`;
      const level = t.jlpt_level ? escapeHtml(t.jlpt_level) : '';

      return `
        <span
          class="vocab-annotated-token ${statusClass}"
          data-lemma="${lemma}"
          data-surface="${surface}"
          data-status="${effectiveStatus}"
          data-level="${level}"
          tabindex="0"
          role="button"
          title="${lemma} (${effectiveStatus === 'should_know' ? 'Should know' : effectiveStatus === 'known' ? 'Known' : 'Other'}${level ? ` · ${level}` : ''}) — Click to inspect"
        >${surface}</span>
      `;
    }).join('');

    // Update filter counts and active states
    const countShouldKnowEl = document.getElementById('count-should-know');
    const countKnownEl = document.getElementById('count-known');
    if (countShouldKnowEl) countShouldKnowEl.textContent = countShouldKnow;
    if (countKnownEl) countKnownEl.textContent = countKnown;

    const btnShouldKnow = document.getElementById('btn-filter-should-know');
    const btnKnown = document.getElementById('btn-filter-known');
    if (btnShouldKnow) btnShouldKnow.classList.toggle('is-active', this.annotatedFilters.shouldKnow);
    if (btnKnown) btnKnown.classList.toggle('is-active', this.annotatedFilters.known);

    stageEl.classList.toggle('hide-should-know', !this.annotatedFilters.shouldKnow);
    stageEl.classList.toggle('hide-known', !this.annotatedFilters.known);

    stageEl.querySelectorAll('.vocab-annotated-token').forEach(tokenEl => {
      const onSelect = () => {
        const lemma = tokenEl.dataset.lemma || tokenEl.dataset.surface;
        if (lemma) this.handleSearchDirect(lemma);
      };

      tokenEl.addEventListener('click', onSelect);
      tokenEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      });
    });
  }

  saveAnnotatedState() {
    try {
      if (this.cachedAnnotatedState && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(ANNOTATED_STORAGE_KEY, JSON.stringify(this.cachedAnnotatedState));
      }
    } catch (err) {
      console.debug('[VocabMain] Failed to save annotated state:', err);
    }
  }

  restoreAnnotatedState() {
    try {
      let saved = this.cachedAnnotatedState;
      if (!saved && typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(ANNOTATED_STORAGE_KEY);
        if (raw) saved = JSON.parse(raw);
      }
      if (!saved || !Array.isArray(saved.tokens) || saved.tokens.length === 0) return;

      this.cachedAnnotatedState = saved;
      const composer = document.getElementById('text-annotate-composer');
      const resultBox = document.getElementById('vocab-text-annotated-result');
      const inputEl = document.getElementById('vocab-text-input');
      if (inputEl && saved.text) inputEl.value = saved.text;

      if (saved.filters) {
        this.annotatedFilters = { ...saved.filters };
      }

      this.setAnnotatorOpen(true);
      this.renderAnnotatedTokens(saved.tokens);
      if (composer) composer.style.display = 'none';
      if (resultBox) resultBox.style.display = 'block';
    } catch (err) {
      console.debug('[VocabMain] Failed to restore annotated state:', err);
    }
  }

  clearAnnotatedState() {
    this.cachedAnnotatedState = null;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(ANNOTATED_STORAGE_KEY);
      }
    } catch (err) {
      console.debug('[VocabMain] Failed to clear annotated state:', err);
    }

    const composer = document.getElementById('text-annotate-composer');
    const resultBox = document.getElementById('vocab-text-annotated-result');
    const stageEl = document.getElementById('annotated-tokens-stage');
    const inputEl = document.getElementById('vocab-text-input');

    if (stageEl) stageEl.innerHTML = '';
    if (resultBox) resultBox.style.display = 'none';
    if (composer) composer.style.display = 'block';
    if (inputEl) {
      inputEl.value = '';
      inputEl.focus();
    }
  }

  async handleSearchDirect(word) {
    if (!word) return;
    const input = document.getElementById('vocab-search-input');
    if (input) input.value = word;
    this.isLoading = true;
    this.hideError();

    try {
      // Kiroku's local dictionary path; no Yomitan API fallback.
      const captureRes = await apiClient.captureText(word);

      if (captureRes && (captureRes.expression || captureRes.reading)) {
        this.displayTerm(captureRes);
      } else {
        this.showError('No definition found for this expression.');
      }
    } catch (err) {
      this.showError(`Search failed: ${err.message || 'Dictionary lookup error'}`);
    } finally {
      this.isLoading = false;
    }
  }

  updateKnownBadge(word) {
    const btnKnown = document.getElementById('btn-toggle-known');
    if (!btnKnown) return;

    const isKnown = this.knownWordsSet.has(word);
    if (isKnown) {
      btnKnown.textContent = 'Known Word';
      btnKnown.classList.add('tactile-pill-jade');
    } else {
      btnKnown.textContent = 'Mark Known';
      btnKnown.classList.remove('tactile-pill-jade');
    }
  }

  handleSearchDebounced(query) {
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    const trimmed = query.trim();
    if (!trimmed) {
      this.hideCandidateDropdown();
      this.hideError();
      return;
    }

    this.searchDebounceTimer = setTimeout(async () => {
      this.isLoading = true;
      this.hideError();

      try {
        const isEnglish = /^[a-zA-Z0-9\s.,'?!-]+$/.test(trimmed);
        if (isEnglish) {
          const res = await apiClient.searchEnglishDictionary(trimmed);
          const entries = res?.entries || (Array.isArray(res) ? res : []);
          this.renderCandidates(entries);
        } else {
          // Kiroku's local dictionary path; no Yomitan API fallback.
          const captureRes = await apiClient.captureText(trimmed);

          if (captureRes && (captureRes.expression || captureRes.reading)) {
            this.displayTerm(captureRes);
            this.hideCandidateDropdown();
          } else {
            this.showError('No definition found for this expression.');
          }
        }
      } catch (err) {
        this.showError(`Search failed: ${err.message || 'Dictionary lookup error'}`);
      } finally {
        this.isLoading = false;
      }
    }, 250);
  }

  renderCandidates(results) {
    const dropdown = document.getElementById('candidate-dropdown');
    if (!dropdown) return;

    if (!Array.isArray(results) || results.length === 0) {
      this.hideCandidateDropdown();
      return;
    }

    dropdown.innerHTML = results.slice(0, 6).map((item, index) => {
      const expr = escapeHtml(item.expression || item.word || item.term || '');
      const read = escapeHtml(item.reading || '');
      const jlpt = item.jlpt ? escapeHtml(item.jlpt) : '';
      const gloss = escapeHtml(item.meaning || item.gloss || (item.definitions && item.definitions.join(', ')) || '');
      return `
        <div class="candidate-row" data-index="${index}" tabindex="0" role="option">
          <div class="candidate-head">
            <span class="candidate-expression font-japanese font-bold">${expr}</span>
            <span class="candidate-reading font-japanese text-muted">${read}</span>
            ${jlpt ? `<span class="tactile-pill tactile-pill-gold font-sans">${jlpt}</span>` : ''}
          </div>
          <div class="candidate-gloss font-sans text-sm text-truncate">${gloss}</div>
        </div>
      `;
    }).join('');

    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.candidate-row').forEach((row, i) => {
      row.addEventListener('click', () => {
        this.selectCandidate(results[i]);
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.selectCandidate(results[i]);
        }
      });
    });
  }

  hideCandidateDropdown() {
    const dropdown = document.getElementById('candidate-dropdown');
    if (dropdown) dropdown.style.display = 'none';
  }

  selectCandidate(item) {
    this.hideCandidateDropdown();
    if (!item) return;
    this.displayTerm(item);
  }

  displayTerm(term) {
    this.currentTerm = term;

    // 1. Populate Headword Hero
    const heroExpr = document.getElementById('hero-expression');
    const heroPitch = document.getElementById('hero-pitch');
    const heroMeta = document.getElementById('headword-meta-row');
    const heroJlpt = document.getElementById('hero-jlpt');
    const heroPos = document.getElementById('hero-pos');
    const btnAudio = document.getElementById('btn-play-audio');

    const expr = term.expression || term.word || term.term || '';
    const reading = term.reading || '';

    if (heroExpr) {
      heroExpr.innerHTML = `${escapeHtml(expr)}<rt id="hero-reading" class="font-japanese">${escapeHtml(reading)}</rt>`;
    }

    if (heroPitch) {
      heroPitch.textContent = term.pitch || '[0] 平板';
      heroPitch.style.display = 'inline-block';
    }

    if (heroMeta) heroMeta.style.display = 'flex';
    if (heroJlpt) heroJlpt.textContent = term.jlpt || 'JLPT N/A';
    if (heroPos) heroPos.textContent = term.pos || 'Vocabulary';
    if (btnAudio) btnAudio.style.display = 'inline-flex';

    this.updateKnownBadge(expr);

    // 2. Populate JMdict Senses
    const sensesContainer = document.getElementById('jmdict-senses');
    if (sensesContainer) {
      let sensesHtml = '';
      if (Array.isArray(term.senses) && term.senses.length > 0) {
        sensesHtml = term.senses.map((s, idx) => `
          <div class="sense-item">
            <span class="sense-num font-mono">${idx + 1}.</span>
            <span class="sense-pos font-mono text-gold">${s.pos ? `[${escapeHtml(s.pos)}]` : ''}</span>
            <span class="sense-gloss font-japanese">${escapeHtml(s.gloss || s.definition || '')}</span>
          </div>
        `).join('');
      } else if (term.meaning) {
        const lines = term.meaning.split('\n').filter(l => l.trim());
        sensesHtml = lines.map((l, idx) => `
          <div class="sense-item">
            <span class="sense-num font-mono">${idx + 1}.</span>
            <span class="sense-gloss font-japanese">${escapeHtml(l)}</span>
          </div>
        `).join('');
      } else {
        sensesHtml = `<p class="text-muted py-2 font-sans">No detailed definitions found.</p>`;
      }
      sensesContainer.innerHTML = sensesHtml;
    }

    // 3. Populate Mining Form Fields
    const inputExpr = document.getElementById('input-expression');
    const inputReading = document.getElementById('input-reading');
    const inputMeaning = document.getElementById('input-meaning');
    const inputHint = document.getElementById('input-hint');
    const inputSentence = document.getElementById('input-sentence');
    const inputTranslation = document.getElementById('input-translation');
    const inputNotes = document.getElementById('input-notes');

    if (inputExpr) inputExpr.value = expr;
    if (inputReading) inputReading.value = reading;
    if (inputMeaning) inputMeaning.value = term.meaning || term.gloss || '';
    if (inputHint) inputHint.value = term.hint || '';
    if (inputSentence) inputSentence.value = term.example_sentence || term.sentence || '';
    if (inputTranslation) inputTranslation.value = term.example_translation || term.sentence_translation || '';
    if (inputNotes) inputNotes.value = term.notes || '';

    // Freshly loaded dictionary term is pristine
    this.setDirty(false);
    this.saveDraft();
  }

  async handleSaveCard() {
    const btn = document.getElementById('btn-save-card');
    const statusPill = document.getElementById('anki-sync-status');

    const cardPayload = {
      expression: document.getElementById('input-expression')?.value?.trim() || '',
      reading: document.getElementById('input-reading')?.value?.trim() || '',
      meaning: document.getElementById('input-meaning')?.value?.trim() || '',
      hint: document.getElementById('input-hint')?.value?.trim() || '',
      example_sentence: document.getElementById('input-sentence')?.value?.trim() || '',
      example_translation: document.getElementById('input-translation')?.value?.trim() || '',
      notes: document.getElementById('input-notes')?.value?.trim() || '',
      deck_name: document.getElementById('select-deck')?.value || 'Default',
      tags: document.getElementById('input-tags')?.value?.trim() || 'kiroku'
    };

    if (!cardPayload.expression || !cardPayload.reading) {
      this.showError('Expression and reading are required to save a card.');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-stamping');
    }

    try {
      const result = await apiClient.saveCard(cardPayload);
      if (statusPill) {
        statusPill.style.display = 'inline-flex';
        statusPill.innerHTML = `
          <span class="anki-status-dot" style="background: var(--status-green);"></span>
          <span class="anki-status-text text-green">Saved (${escapeHtml(result?.expression || cardPayload.expression)})</span>
        `;
      }
      this.clearDraft();
    } catch (err) {
      this.showError(`Save Failed: ${err.message}`);
      if (statusPill) {
        statusPill.style.display = 'inline-flex';
        statusPill.innerHTML = `
          <span class="anki-status-dot" style="background: var(--status-red);"></span>
          <span class="anki-status-text text-red">Save Failed</span>
        `;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-stamping');
      }
    }
  }

  playWordAudio(text) {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ja-JP';
      speechSynthesis.speak(utterance);
    }
  }

  unmount() {
    this.saveDraft();
    this.onHide();
    this._levelListener = null;
    this._outsideClickListener = null;
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
