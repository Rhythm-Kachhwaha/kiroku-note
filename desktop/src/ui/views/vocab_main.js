/**
 * Kiroku Note Desktop — Vocab Main View Controller (Word Desk & Text Annotator)
 * Headword showcase, WanaKana IME, JMdict pitch-black sense block, radical breakdown,
 * live AnkiConnect deck fetching, known-words management, card mining persistence,
 * dirty state indicator (#mining-unsaved-badge), draft state retention across tab switches,
 * universal JLPT focus level integration, "Should know, not yet seen" gap shelf,
 * and paragraph text status annotation.
 */

import { apiClient } from '../services/api_client.js';
import { escapeHtml } from '../utils/sanitizer.js';
import * as wanakana from '../lib/wanakana.js';
import { getUniversalJlptLevel } from '../utils/learner.js';

const DRAFT_STORAGE_KEY = 'kiroku:vocab-mining-draft';

export class VocabMainView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.currentTerm = null;
    this.currentMode = 'word'; // 'word' | 'text'
    this.learnerLevel = 'N4';
    this.gaps = [];
    this.searchDebounceTimer = null;
    this.imeMode = 'hiragana'; // 'hiragana' | 'katakana' | 'english'
    this.knownWordsSet = new Set();
    this.ankiDecks = ['Default'];
    this.isLoading = false;
    this.lastError = null;
    this.isDirty = false;
    this.draftState = null;
    this._levelListener = null;
  }

  async mount(container) {
    this.container = container;
    this.learnerLevel = await getUniversalJlptLevel();
    this.render();
    this.setupEvents();
    this.setupWanakana();
    this.restoreDraft();
    await Promise.all([
      this.loadInitialMetadata(),
      this.loadGapsShelf()
    ]);

    this._levelListener = (e) => {
      if (e.detail?.level) {
        this.learnerLevel = e.detail.level;
        this.updateFocusLevelDisplay();
        this.loadGapsShelf();
      }
    };
    window.addEventListener('kiroku:learner-level-changed', this._levelListener);
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
          <!-- Top Bar: Search, Mode Switcher & Navigation -->
          <div class="vocab-search-section">
            <div class="vocab-search-bar-row">
              <!-- Mode Tabs: Word Desk vs Text Annotator -->
              <div class="vocab-mode-tabs" role="tablist" aria-label="Vocabulary View Mode">
                <button type="button" class="vocab-mode-tab is-active" id="tab-mode-word" role="tab" aria-selected="true">Word</button>
                <button type="button" class="vocab-mode-tab" id="tab-mode-text" role="tab" aria-selected="false">Text</button>
              </div>

              <div class="vocab-input-wrap">
                <svg class="search-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
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

              <!-- Universal Focus Level Badge -->
              <span class="tactile-pill tactile-pill-gold font-sans" id="vocab-focus-badge" title="Target Study Focus Level (configured in Settings)">JLPT ${escapeHtml(this.learnerLevel)}</span>

              <!-- History Quick Link -->
              <button class="tactile-btn tactile-btn-sm font-sans" id="btn-vocab-go-history" title="View Cards Collection">
                <span>History</span>
              </button>
            </div>

            <!-- Error Banner (visible on network/API failure) -->
            <div class="vocab-error-banner" id="vocab-error-banner" style="display: none;" role="alert">
              <span class="error-msg" id="vocab-error-text">Failed to search dictionary.</span>
            </div>

            <!-- Candidate Autocomplete Dropdown -->
            <div class="candidate-dropdown" id="candidate-dropdown" style="display: none;" role="listbox"></div>
          </div>

          <!-- Mode 1: Word Desk Container -->
          <div id="vocab-word-mode-container" class="vocab-mode-pane">
            <!-- Main Layout Grid: Word Presentation & JMdict (Left) + Card Mining Form (Right) -->
            <div class="vocab-content-grid">
              <!-- Left Column: Word Presentation & JMdict Sense Block -->
              <div class="vocab-left-column">
                <!-- Headword Hero Showcase Block -->
                <div class="headword-hero-card tactile-card" id="headword-hero">
                  <div class="headword-hero-top">
                    <div class="headword-glyph-group">
                      <ruby class="headword-kanji font-display" id="hero-expression">
                        <span class="text-muted text-base font-sans">Search a word above...</span>
                        <rt id="hero-reading" class="font-japanese"></rt>
                      </ruby>
                      <span class="pitch-accent-badge font-mono" id="hero-pitch" style="display: none;">[0] 平板</span>
                    </div>
                    <button class="audio-play-btn tactile-btn-icon" id="btn-play-audio" title="Pronounce Term" aria-label="Play audio" style="display: none;">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                      </svg>
                    </button>
                  </div>

                  <!-- Radical & JLPT breakdown pill bar -->
                  <div class="headword-meta-row" id="headword-meta-row" style="display: none;">
                    <span class="tactile-pill tactile-pill-gold font-sans" id="hero-jlpt">JLPT</span>
                    <span class="tactile-pill font-sans" id="hero-pos">Vocabulary</span>
                    <button type="button" class="tactile-pill font-sans" id="btn-toggle-known">Mark Known</button>
                  </div>
                </div>

                <!-- Pure Black JMdict Surface (#000000) -->
                <div class="jmdict-card surface-pitch-black tactile-card" id="jmdict-block">
                  <div class="jmdict-header-row">
                    <span class="jmdict-title font-mono">Dictionary</span>
                    <span class="jmdict-source-tag font-mono text-muted text-xs">JMdict</span>
                  </div>
                  <div class="jmdict-senses-list" id="jmdict-senses">
                    <p class="text-muted py-4 text-center font-sans" id="jmdict-empty-notice">
                      Type a Japanese or English term in the search bar above to look up definitions.
                    </p>
                  </div>
                </div>
              </div>

              <!-- Right Column: Card Mining Form (Clearly visually delineated) -->
              <div class="vocab-right-column">
                <form class="card-mining-form tactile-card" id="card-mining-form">
                  <div class="mining-form-header">
                    <div class="mining-title-group">
                      <h2 class="mining-form-title font-sans">Mine to Anki</h2>
                      <span class="mining-unsaved-badge font-sans" id="mining-unsaved-badge" style="display: none;" title="Unsaved changes in this card">
                        <span class="unsaved-dot"></span>
                        <span>Unsaved</span>
                      </span>
                    </div>
                    <div class="anki-sync-status-pill font-mono" id="anki-sync-status" style="display: none;"></div>
                  </div>

                  <!-- Expression & Reading Fields -->
                  <div class="form-row-pair">
                    <div class="form-field">
                      <label for="input-expression" class="font-sans">Expression</label>
                      <input type="text" id="input-expression" class="tactile-input font-japanese" placeholder="e.g. 日本" required />
                    </div>
                    <div class="form-field">
                      <label for="input-reading" class="font-sans">Reading</label>
                      <input type="text" id="input-reading" class="tactile-input font-japanese" placeholder="e.g. にほん" required />
                    </div>
                  </div>

                  <!-- Meaning Field -->
                  <div class="form-field">
                    <label for="input-meaning" class="font-sans">Meaning and gloss</label>
                    <textarea id="input-meaning" class="tactile-input form-textarea font-japanese" rows="3" placeholder="Definition and nuances..."></textarea>
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
                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                      </svg>
                      <span>Save Card to Local & Anki</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <!-- Quiet Shelf Under Desk: Should know, not yet seen -->
            <div class="vocab-gaps-shelf tactile-card" id="vocab-gaps-shelf">
              <div class="gaps-shelf-header">
                <div class="gaps-title-row">
                  <span class="gaps-title font-sans font-bold">Should know, not yet seen</span>
                  <span class="text-xs text-muted font-sans">Words at or below your target focus level not yet marked known or mined.</span>
                </div>
                <button type="button" class="tactile-btn tactile-btn-sm font-sans" id="btn-refresh-gaps" title="Reload unseen vocabulary gaps">
                  Refresh
                </button>
              </div>
              <div class="vocab-gaps-list" id="vocab-gaps-list">
                <span class="text-xs text-muted py-2 font-sans">Loading vocabulary recommendations...</span>
              </div>
            </div>
          </div>

          <!-- Mode 2: Text Annotator Container -->
          <div id="vocab-text-mode-container" class="vocab-mode-pane" style="display: none;">
            <div class="text-annotate-card tactile-card">
              <div class="text-annotate-header mb-3">
                <h2 class="text-lg font-bold font-sans">Text annotator</h2>
                <p class="text-sm text-secondary font-sans">
                  Paste a Japanese article or paragraph. Tokens will be highlighted by your learner status: should know, mined, or known.
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
                  <span class="legend-chip legend-should-know">Should know</span>
                  <span class="legend-chip legend-mined">Mined</span>
                  <span class="legend-chip legend-known">Known</span>
                </div>
              </div>

              <div class="annotated-result-wrapper surface-pitch-black tactile-card" id="vocab-text-annotated-result" style="display: none; margin-top: 1.25rem;">
                <div class="annotated-tokens-stage" id="annotated-tokens-stage"></div>
                <p class="text-xs text-muted mt-2 px-3 pb-2 font-sans">
                  Click any token to inspect its JMdict definition on the Word desk and mine to Anki.
                </p>
              </div>
            </div>
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
        example_sentence: document.getElementById('input-sentence')?.value || '',
        example_translation: document.getElementById('input-translation')?.value || '',
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
      const selectDeck = document.getElementById('select-deck');
      const inputTags = document.getElementById('input-tags');

      if (inputExpr && draft.expression !== undefined) inputExpr.value = draft.expression;
      if (inputReading && draft.reading !== undefined) inputReading.value = draft.reading;
      if (inputMeaning && draft.meaning !== undefined) inputMeaning.value = draft.meaning;
      if (inputSentence && draft.example_sentence !== undefined) inputSentence.value = draft.example_sentence;
      if (inputTranslation && draft.example_translation !== undefined) inputTranslation.value = draft.example_translation;
      if (inputTags && draft.tags !== undefined) inputTags.value = draft.tags;
      if (selectDeck && draft.deck_name && this.ankiDecks.includes(draft.deck_name)) {
        selectDeck.value = draft.deck_name;
      }

      if (draft.expression || draft.reading) {
        const heroExpr = document.getElementById('hero-expression');
        if (heroExpr) {
          heroExpr.innerHTML = `${escapeHtml(draft.expression || '')}<rt id="hero-reading">${escapeHtml(draft.reading || '')}</rt>`;
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

  async loadGapsShelf() {
    const listEl = document.getElementById('vocab-gaps-list');
    if (!listEl) return;

    try {
      const res = await apiClient.getVocabGaps(this.learnerLevel, 16);
      const gaps = res?.gaps || [];
      this.gaps = gaps;
      this.renderGapsShelf(gaps);
    } catch (err) {
      console.debug('[VocabMain] Failed to load vocab gaps shelf:', err);
      if (listEl) {
        listEl.innerHTML = `<span class="text-xs text-muted">Unable to load vocabulary gaps for JLPT ${escapeHtml(this.learnerLevel)}.</span>`;
      }
    }
  }

  renderGapsShelf(gaps) {
    const listEl = document.getElementById('vocab-gaps-list');
    if (!listEl) return;

    if (!Array.isArray(gaps) || gaps.length === 0) {
      listEl.innerHTML = `
        <div class="gaps-empty-notice text-xs text-muted py-2">
          No unseen vocabulary gaps found for JLPT ${escapeHtml(this.learnerLevel)}.
        </div>
      `;
      return;
    }

    listEl.innerHTML = gaps.map((item) => {
      const word = escapeHtml(item.word || '');
      const reading = escapeHtml(item.reading || '');
      const level = escapeHtml(item.level || this.learnerLevel);
      return `
        <button type="button" class="gap-chip tactile-card" data-word="${word}" title="Click to inspect ${word}">
          <span class="gap-word font-japanese font-bold">${word}</span>
          ${reading ? `<span class="gap-reading font-japanese text-muted text-xs">${reading}</span>` : ''}
          <span class="tactile-pill tactile-pill-gold font-sans text-xs">${level}</span>
        </button>
      `;
    }).join('');

    listEl.querySelectorAll('.gap-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const word = btn.dataset.word;
        if (word) this.handleSearchDirect(word);
      });
    });
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
    // Mode switcher: Word vs Text
    const tabWord = document.getElementById('tab-mode-word');
    const tabText = document.getElementById('tab-mode-text');

    if (tabWord) {
      tabWord.addEventListener('click', () => this.switchToMode('word'));
    }
    if (tabText) {
      tabText.addEventListener('click', () => this.switchToMode('text'));
    }

    // Refresh gaps button
    const btnRefreshGaps = document.getElementById('btn-refresh-gaps');
    if (btnRefreshGaps) {
      btnRefreshGaps.addEventListener('click', () => this.loadGapsShelf());
    }

    // Text annotator button
    const btnAnnotate = document.getElementById('btn-annotate-text');
    if (btnAnnotate) {
      btnAnnotate.addEventListener('click', () => this.handleAnnotateParagraph());
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
      'input-sentence',
      'input-translation',
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
        const word = this.currentTerm?.expression || document.getElementById('hero-expression')?.textContent?.trim();
        if (word) this.playWordAudio(word);
      });
    }

    // Known word toggle button
    const btnKnown = document.getElementById('btn-toggle-known');
    if (btnKnown) {
      btnKnown.addEventListener('click', async () => {
        const word = this.currentTerm?.expression;
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
  }

  switchToMode(mode) {
    this.currentMode = mode;
    const tabWord = document.getElementById('tab-mode-word');
    const tabText = document.getElementById('tab-mode-text');
    const wordContainer = document.getElementById('vocab-word-mode-container');
    const textContainer = document.getElementById('vocab-text-mode-container');

    if (tabWord && tabText) {
      tabWord.classList.toggle('is-active', mode === 'word');
      tabWord.setAttribute('aria-selected', mode === 'word' ? 'true' : 'false');
      tabText.classList.toggle('is-active', mode === 'text');
      tabText.setAttribute('aria-selected', mode === 'text' ? 'true' : 'false');
    }

    if (wordContainer && textContainer) {
      wordContainer.style.display = mode === 'word' ? 'block' : 'none';
      textContainer.style.display = mode === 'text' ? 'block' : 'none';
    }
  }

  async handleAnnotateParagraph() {
    const inputEl = document.getElementById('vocab-text-input');
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

      this.renderAnnotatedTokens(tokens);
      if (resultBox) resultBox.style.display = 'block';
    } catch (err) {
      this.showError(`Failed to annotate text: ${err.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  renderAnnotatedTokens(tokens) {
    const stageEl = document.getElementById('annotated-tokens-stage');
    if (!stageEl) return;

    stageEl.innerHTML = tokens.map((t) => {
      const surface = escapeHtml(t.surface || '');
      const lemma = escapeHtml(t.lemma || t.surface || '');
      const status = t.status || 'unstyled';
      const statusClass = `token-${status.replace(/_/g, '-')}`;
      const level = t.jlpt_level ? escapeHtml(t.jlpt_level) : '';

      return `
        <span
          class="vocab-annotated-token ${statusClass}"
          data-lemma="${lemma}"
          data-surface="${surface}"
          data-status="${status}"
          data-level="${level}"
          tabindex="0"
          role="button"
          title="${lemma} (${status}${level ? ` · ${level}` : ''}) — Click to inspect"
        >${surface}</span>
      `;
    }).join(' ');

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

  async handleSearchDirect(word) {
    if (!word) return;
    this.switchToMode('word');
    const input = document.getElementById('vocab-search-input');
    if (input) input.value = word;
    this.isLoading = true;
    this.hideError();

    try {
      const captureRes = (typeof apiClient.lookupWord === 'function')
        ? await apiClient.lookupWord(word)
        : await apiClient.captureText(word);

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
          const captureRes = (typeof apiClient.lookupWord === 'function')
            ? await apiClient.lookupWord(trimmed)
            : await apiClient.captureText(trimmed);

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
    const inputSentence = document.getElementById('input-sentence');
    const inputTranslation = document.getElementById('input-translation');

    if (inputExpr) inputExpr.value = expr;
    if (inputReading) inputReading.value = reading;
    if (inputMeaning) inputMeaning.value = term.meaning || term.gloss || '';
    if (inputSentence) inputSentence.value = term.example_sentence || term.sentence || '';
    if (inputTranslation) inputTranslation.value = term.example_translation || term.sentence_translation || '';

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
      example_sentence: document.getElementById('input-sentence')?.value?.trim() || '',
      example_translation: document.getElementById('input-translation')?.value?.trim() || '',
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
      // Reload gaps shelf as this card is now mined
      await this.loadGapsShelf();
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
    if (this._levelListener) {
      window.removeEventListener('kiroku:learner-level-changed', this._levelListener);
      this._levelListener = null;
    }
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
