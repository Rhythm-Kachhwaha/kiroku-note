/**
 * Kiroku Note Desktop — Vocab Main View Controller
 * Headword showcase, WanaKana IME, JMdict pitch-black sense block, radical breakdown,
 * and AnkiConnect-integrated card mining persistence form.
 */

import { apiClient } from '../services/api_client.js';
import { renderAssetSlot } from '../assets_map.js';
import * as wanakana from '../lib/wanakana.js';

export class VocabMainView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.currentTerm = null;
    this.searchDebounceTimer = null;
    this.imeMode = 'hiragana'; // 'hiragana' | 'katakana' | 'english'
  }

  mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
    this.setupWanakana();
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
                  placeholder="Type romaji or Japanese to search (e.g. taberu / 食べる)..."
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
                      食べる<rt id="hero-reading">たべる</rt>
                    </ruby>
                    <span class="pitch-accent-badge" id="hero-pitch">[2] 中高型</span>
                  </div>
                  <button class="audio-play-btn tactile-btn-icon" id="btn-play-audio" title="Pronounce Term" aria-label="Play audio">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                  </button>
                </div>

                <!-- Radical & JLPT breakdown pill bar -->
                <div class="headword-meta-row">
                  <span class="tactile-pill tactile-pill-gold" id="hero-jlpt">JLPT N5</span>
                  <span class="tactile-pill" id="hero-pos">Ichidan verb (一段)</span>
                  <span class="tactile-pill" id="hero-common">Common Word</span>
                </div>
              </div>

              <!-- Mandatory Pitch-Black JMdict Card (#000000) -->
              <div class="jmdict-card surface-pitch-black tactile-card" id="jmdict-block">
                <div class="jmdict-header-row">
                  <span class="jmdict-title">JMdict · 辞書項目</span>
                  <span class="jmdict-source-tag">LOCAL PROVIDER</span>
                </div>
                <div class="jmdict-senses-list" id="jmdict-senses">
                  <div class="sense-item">
                    <span class="sense-number">1.</span>
                    <div class="sense-body">
                      <span class="sense-pos text-gold">[v1, vt]</span>
                      <p class="sense-gloss">to eat</p>
                      <p class="sense-example text-muted">朝ごはんを食べる (to eat breakfast)</p>
                    </div>
                  </div>
                  <div class="sense-item">
                    <span class="sense-number">2.</span>
                    <div class="sense-body">
                      <span class="sense-pos text-gold">[v1, vt]</span>
                      <p class="sense-gloss">to live on (e.g. a salary); to make a living by</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Mascot Slot Placeholder -->
              ${renderAssetSlot('vocab-idle-reading', 'vocab-mascot-container')}
            </div>

            <!-- Right Column: Card Mining Persistence Form -->
            <div class="vocab-right-column">
              <form class="card-mining-form tactile-card" id="card-mining-form">
                <div class="form-header-row">
                  <h3 class="form-title">Mine Anki Card · 単語登録</h3>
                  <div class="anki-sync-pill" id="anki-sync-status">
                    <span class="anki-status-dot is-pending"></span>
                    <span class="anki-status-text">Ready to Save</span>
                  </div>
                </div>

                <!-- Expression & Reading Fields -->
                <div class="form-row-pair">
                  <div class="form-field">
                    <label for="input-expression">Expression (表記)</label>
                    <input type="text" id="input-expression" class="tactile-input" value="食べる" required />
                  </div>
                  <div class="form-field">
                    <label for="input-reading">Reading (読み)</label>
                    <input type="text" id="input-reading" class="tactile-input" value="たべる" required />
                  </div>
                </div>

                <!-- Meaning / Definition -->
                <div class="form-field">
                  <label for="input-meaning">Meaning & Gloss (意味)</label>
                  <textarea id="input-meaning" class="tactile-input form-textarea-sm" rows="2" required>to eat; to consume</textarea>
                </div>

                <!-- Sentence Context & Translation -->
                <div class="form-field">
                  <label for="input-sentence">Context Sentence (例文)</label>
                  <textarea id="input-sentence" class="tactile-input form-textarea-sm" rows="2">毎日りんごを一つ食べます。</textarea>
                </div>
                <div class="form-field">
                  <label for="input-translation">Translation (和訳)</label>
                  <input type="text" id="input-translation" class="tactile-input" value="I eat one apple every day." />
                </div>

                <!-- Deck Selector & Tags -->
                <div class="form-row-pair">
                  <div class="form-field">
                    <label for="select-deck">Target Deck (デッキ)</label>
                    <select id="select-deck" class="tactile-input">
                      <option value="Japanese::Vocab" selected>Japanese::Vocab</option>
                      <option value="Japanese::Mining">Japanese::Mining</option>
                      <option value="Default">Default</option>
                    </select>
                  </div>
                  <div class="form-field">
                    <label for="input-tags">Tags (タグ)</label>
                    <input type="text" id="input-tags" class="tactile-input" value="kiroku, n5" />
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
    pills.forEach((pill) => {
      pill.addEventListener('click', () => {
        pills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.imeMode = pill.dataset.mode;
        const input = document.getElementById('vocab-search-input');
        if (input) input.focus();
      });
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
        const word = document.getElementById('hero-expression')?.textContent?.trim() || '食べる';
        this.playWordAudio(word);
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

  handleSearchDebounced(query) {
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    if (!query || query.trim().length === 0) {
      this.hideCandidateDropdown();
      return;
    }

    this.searchDebounceTimer = setTimeout(async () => {
      try {
        const results = await apiClient.searchDictionary(query);
        this.renderCandidates(results);
      } catch (err) {
        console.warn('[Vocab] Search failed:', err);
      }
    }, 200);
  }

  renderCandidates(results) {
    const dropdown = document.getElementById('candidate-dropdown');
    if (!dropdown) return;

    if (!Array.isArray(results) || results.length === 0) {
      this.hideCandidateDropdown();
      return;
    }

    dropdown.innerHTML = results.slice(0, 6).map((item, index) => `
      <div class="candidate-row" data-index="${index}" tabindex="0" role="option">
        <div class="candidate-head">
          <span class="candidate-expression">${item.expression || item.word || ''}</span>
          <span class="candidate-reading">${item.reading || ''}</span>
          ${item.jlpt ? `<span class="tactile-pill tactile-pill-gold">${item.jlpt}</span>` : ''}
        </div>
        <div class="candidate-gloss">${item.gloss || item.meaning || ''}</div>
      </div>
    `).join('');

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

    // Populate Headword Showcase
    const heroExpr = document.getElementById('hero-expression');
    const heroReading = document.getElementById('hero-reading');
    const heroPitch = document.getElementById('hero-pitch');
    const heroJlpt = document.getElementById('hero-jlpt');
    const heroPos = document.getElementById('hero-pos');

    if (heroExpr) {
      heroExpr.innerHTML = `${item.expression || item.word}<rt id="hero-reading">${item.reading || ''}</rt>`;
    }
    if (heroPitch) heroPitch.textContent = item.pitch || '[0] 平板';
    if (heroJlpt) heroJlpt.textContent = item.jlpt || 'JLPT N/A';
    if (heroPos) heroPos.textContent = item.pos || 'Expression';

    // Populate Mining Form
    const inputExpr = document.getElementById('input-expression');
    const inputReading = document.getElementById('input-reading');
    const inputMeaning = document.getElementById('input-meaning');

    if (inputExpr) inputExpr.value = item.expression || item.word || '';
    if (inputReading) inputReading.value = item.reading || '';
    if (inputMeaning) inputMeaning.value = item.gloss || item.meaning || '';

    // Populate JMdict senses
    const sensesContainer = document.getElementById('jmdict-senses');
    if (sensesContainer && Array.isArray(item.senses)) {
      sensesContainer.innerHTML = item.senses.map((s, idx) => `
        <div class="sense-item">
          <span class="sense-number">${idx + 1}.</span>
          <div class="sense-body">
            <span class="sense-pos text-gold">${s.pos || ''}</span>
            <p class="sense-gloss">${s.gloss || ''}</p>
          </div>
        </div>
      `).join('');
    }
  }

  async handleSaveCard() {
    const btn = document.getElementById('btn-save-card');
    const statusPill = document.getElementById('anki-sync-status');

    const cardPayload = {
      expression: document.getElementById('input-expression')?.value || '',
      reading: document.getElementById('input-reading')?.value || '',
      meaning: document.getElementById('input-meaning')?.value || '',
      sentence: document.getElementById('input-sentence')?.value || '',
      sentence_translation: document.getElementById('input-translation')?.value || '',
      deck: document.getElementById('select-deck')?.value || 'Japanese::Vocab',
      tags: document.getElementById('input-tags')?.value || 'kiroku'
    };

    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-stamping');
    }

    try {
      const result = await apiClient.createCard(cardPayload);
      if (statusPill) {
        statusPill.innerHTML = `
          <span class="anki-status-dot is-synced"></span>
          <span class="anki-status-text">Saved to Local & Anki</span>
        `;
      }
    } catch (err) {
      if (statusPill) {
        statusPill.innerHTML = `
          <span class="anki-status-dot is-failed"></span>
          <span class="anki-status-text">Save Failed: ${err.message}</span>
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
