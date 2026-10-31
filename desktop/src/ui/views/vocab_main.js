/**
 * Kiroku Note Desktop — Vocab Main View Controller
 * Headword showcase, WanaKana IME, JMdict pitch-black sense block, radical breakdown,
 * live AnkiConnect deck fetching, known-words management, and card mining persistence.
 */

import { apiClient } from '../services/api_client.js';
import { escapeHtml } from '../utils/sanitizer.js';
import * as wanakana from '../lib/wanakana.js';

export class VocabMainView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.currentTerm = null;
    this.searchDebounceTimer = null;
    this.imeMode = 'hiragana'; // 'hiragana' | 'katakana' | 'english'
    this.knownWordsSet = new Set();
    this.ankiDecks = ['Default'];
    this.isLoading = false;
    this.lastError = null;
  }

  async mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
    this.setupWanakana();
    await this.loadInitialMetadata();
  }

  render() {
    this.container.innerHTML = `
      <div class="vocab-main-wrapper">
        <div class="vocab-main-container">
          <!-- Top Bar: Search & IME Mode Switcher -->
          <div class="vocab-search-section">
            <div class="vocab-search-bar-row">
              <div class="vocab-input-wrap">
                <svg class="search-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <input
                  type="text"
                  id="vocab-search-input"
                  class="tactile-input vocab-search-input"
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

              <!-- History Quick Link -->
              <button class="tactile-btn tactile-btn-sm" id="btn-vocab-go-history" title="View Cards Collection">
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

          <!-- Main Layout Grid: Headword Showcase (Left) + Mining Form (Right) -->
          <div class="vocab-content-grid">
            <!-- Left Column: Term Showcase & JMdict Definition -->
            <div class="vocab-left-column">
              <!-- Headword Hero Showcase Block -->
              <div class="headword-hero-card tactile-card" id="headword-hero">
                <div class="headword-hero-top">
                  <div class="headword-glyph-group">
                    <ruby class="headword-kanji" id="hero-expression">
                      <span class="text-muted text-base">Search a word above...</span>
                      <rt id="hero-reading"></rt>
                    </ruby>
                    <span class="pitch-accent-badge" id="hero-pitch" style="display: none;">[0] 平板</span>
                  </div>
                  <button class="audio-play-btn tactile-btn-icon" id="btn-play-audio" title="Pronounce Term" aria-label="Play audio" style="display: none;">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                  </button>
                </div>

                <!-- Radical & JLPT breakdown pill bar -->
                <div class="headword-meta-row" id="headword-meta-row" style="display: none;">
                  <span class="tactile-pill tactile-pill-gold" id="hero-jlpt">JLPT</span>
                  <span class="tactile-pill" id="hero-pos">Vocabulary</span>
                  <button type="button" class="tactile-pill" id="btn-toggle-known">Mark Known</button>
                </div>
              </div>

              <!-- Mandatory Pitch-Black JMdict Card (#000000) -->
              <div class="jmdict-card surface-pitch-black tactile-card" id="jmdict-block">
                <div class="jmdict-header-row">
                  <span class="jmdict-title">Dictionary · 辞書</span>

                </div>
                <div class="jmdict-senses-list" id="jmdict-senses">
                  <p class="text-muted py-4 text-center" id="jmdict-empty-notice">
                    Type a Japanese or English term in the search bar above to look up definitions.
                  </p>
                </div>
              </div>
            </div>

            <!-- Right Column: Anki Card Mining Editor -->
            <div class="vocab-right-column">
              <form class="card-mining-form tactile-card" id="card-mining-form">
                <div class="mining-form-header">
                  <h2 class="mining-form-title">Mine to Anki (新規単語)</h2>
                  <div class="anki-sync-status-pill" id="anki-sync-status">
                    <span class="anki-status-dot"></span>
                    <span class="anki-status-text">Ready to Save</span>
                  </div>
                </div>

                <!-- Expression & Reading Fields -->
                <div class="form-row-pair">
                  <div class="form-field">
                    <label for="input-expression">Expression (表記)</label>
                    <input type="text" id="input-expression" class="tactile-input" placeholder="e.g. 日本" required />
                  </div>
                  <div class="form-field">
                    <label for="input-reading">Reading (読み)</label>
                    <input type="text" id="input-reading" class="tactile-input" placeholder="e.g. にほん" required />
                  </div>
                </div>

                <!-- Meaning Field -->
                <div class="form-field">
                  <label for="input-meaning">Meaning & Gloss (意味)</label>
                  <textarea id="input-meaning" class="tactile-input form-textarea" rows="3" placeholder="Definition and nuances..."></textarea>
                </div>

                <!-- Sentence Context & Translation -->
                <div class="form-field">
                  <label for="input-sentence">Context Sentence (例文)</label>
                  <textarea id="input-sentence" class="tactile-input form-textarea-sm" rows="2" placeholder="Example Japanese sentence..."></textarea>
                </div>
                <div class="form-field">
                  <label for="input-translation">Translation (和訳)</label>
                  <input type="text" id="input-translation" class="tactile-input" placeholder="English translation..." />
                </div>

                <!-- Deck Selector & Tags -->
                <div class="form-row-pair">
                  <div class="form-field">
                    <label for="select-deck">Target Deck (デッキ)</label>
                    <select id="select-deck" class="tactile-input">
                      <option value="Default">Default</option>
                    </select>
                  </div>
                  <div class="form-field">
                    <label for="input-tags">Tags (タグ)</label>
                    <input type="text" id="input-tags" class="tactile-input" value="kiroku" />
                  </div>
                </div>

                <!-- Action Button Row -->
                <div class="form-actions-row">
                  <button type="submit" class="tactile-btn tactile-btn-primary card-save-stamp-btn" id="btn-save-card">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                    </svg>
                    <span>Save Card to Local & Anki</span>
                  </button>
                </div>
              </form>
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
          select.innerHTML = this.ankiDecks.map(d => `<option value="${d}">${d}</option>`).join('');
          if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
            try {
              const stored = await window.chrome.storage.local.get('vocab.selectedDeck');
              if (stored?.['vocab.selectedDeck'] && this.ankiDecks.includes(stored['vocab.selectedDeck'])) {
                select.value = stored['vocab.selectedDeck'];
              }
            } catch (err) {
              console.debug('[VocabMain] Failed to restore deck preference:', err);
            }
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
      console.warn('[VocabMain] Failed to load known words:', err);
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
        if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
          window.chrome.storage.local.set({ 'vocab.selectedDeck': selectDeckEl.value });
        }
      });
    }

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

  updateKnownBadge(word) {
    const btnKnown = document.getElementById('btn-toggle-known');
    if (!btnKnown) return;

    const isKnown = this.knownWordsSet.has(word);
    if (isKnown) {
      btnKnown.textContent = 'Known Word';
      btnKnown.classList.add('tactile-pill-green');
    } else {
      btnKnown.textContent = 'Mark Known';
      btnKnown.classList.remove('tactile-pill-green');
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
            <span class="candidate-expression font-bold">${expr}</span>
            <span class="candidate-reading text-muted">${read}</span>
            ${jlpt ? `<span class="tactile-pill tactile-pill-gold">${jlpt}</span>` : ''}
          </div>
          <div class="candidate-gloss text-sm text-truncate">${gloss}</div>
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
      heroExpr.innerHTML = `${escapeHtml(expr)}<rt id="hero-reading">${escapeHtml(reading)}</rt>`;
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
            <span class="sense-num">${idx + 1}.</span>
            <span class="sense-pos text-gold">${s.pos ? `[${escapeHtml(s.pos)}]` : ''}</span>
            <span class="sense-gloss">${escapeHtml(s.gloss || s.definition || '')}</span>
          </div>
        `).join('');
      } else if (term.meaning) {
        const lines = term.meaning.split('\n').filter(l => l.trim());
        sensesHtml = lines.map((l, idx) => `
          <div class="sense-item">
            <span class="sense-num">${idx + 1}.</span>
            <span class="sense-gloss">${escapeHtml(l)}</span>
          </div>
        `).join('');
      } else {
        sensesHtml = `<p class="text-muted py-2">No detailed definitions found.</p>`;
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
        statusPill.innerHTML = `
          <span class="anki-status-dot" style="background: var(--status-green);"></span>
          <span class="anki-status-text text-green">Saved (${result.expression})</span>
        `;
      }
    } catch (err) {
      this.showError(`Save Failed: ${err.message}`);
      if (statusPill) {
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
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
