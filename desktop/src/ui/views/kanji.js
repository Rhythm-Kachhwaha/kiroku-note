/**
 * Kiroku Note Desktop — Kanji Studio View Controller
 * Kanji search, real KanjiVG stroke order player, On/Kun readings matrix,
 * radical breakdowns, level browsing and common compounds with 1-click card mining.
 */

import { apiClient } from '../services/api_client.js';
import { renderAssetSlot } from '../assets_map.js';

export class KanjiView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.currentChar = '静';
    this.currentStrokes = 0;
    this.isPlaying = false;
    this.playTimer = null;
    this.currentStrokeIndex = 0;
    this.strokePaths = [];
    this.activeLevel = 'N3';
  }

  mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
    this.loadKanji(this.currentChar);
    this.loadLevelBrowse(this.activeLevel);
  }

  render() {
    this.container.innerHTML = `
      <div class="kanji-view-wrapper">
        <div class="kanji-view-container">
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
              <button class="level-pill" data-level="N5">N5</button>
              <button class="level-pill" data-level="N4">N4</button>
              <button class="level-pill is-active" data-level="N3">N3</button>
              <button class="level-pill" data-level="N2">N2</button>
              <button class="level-pill" data-level="N1">N1</button>
              <button class="level-pill" data-level="joyo">Joyo (常用)</button>
            </div>

            <!-- Kanji Quick Browse Row -->
            <div class="kanji-browse-row" id="kanji-browse-chips">
              <span class="text-xs text-muted">Loading kanji browse list...</span>
            </div>
          </div>

          <!-- Visible Error Banner -->
          <div class="kanji-error-banner" id="kanji-error-banner" style="display: none;">
            <span class="error-msg" id="kanji-error-msg"></span>
            <button type="button" class="btn-dismiss-error" id="btn-dismiss-kanji-error">✕</button>
          </div>

          <!-- Main Layout Grid: Stroke Canvas & Hero (Left) + Readings & Compounds (Right) -->
          <div class="kanji-content-grid">
            <!-- Left Column: Hero Glyph & KanjiVG Stroke Canvas -->
            <div class="kanji-left-column">
              <!-- Mandatory Pitch-Black Stroke Player Surface (#000000) -->
              <div class="kanji-stroke-card surface-pitch-black tactile-card">
                <div class="stroke-header-row">
                  <span class="stroke-title">KanjiVG Stroke Order Engine · 筆順</span>
                  <span class="stroke-counter-tag font-mono text-gold" id="stroke-counter">Stroke -- of --</span>
                </div>

                <!-- Vector SVG Canvas Container -->
                <div class="stroke-canvas-container" id="stroke-canvas">
                  <div class="text-muted text-sm py-8 text-center" id="stroke-loading">Loading stroke vector...</div>
                </div>

                <!-- Stroke Player Controls Bar -->
                <div class="stroke-controls-bar">
                  <button class="tactile-btn tactile-btn-sm" id="btn-stroke-replay" title="Replay from start">Replay</button>
                  <button class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-stroke-play" title="Play animation">Play</button>
                  <input type="range" id="stroke-slider" min="1" max="1" value="1" class="stroke-scrubber" />
                </div>
              </div>

              <!-- Observing Mascot Slot -->
              ${renderAssetSlot('kanji-stroke-observing', 'kanji-mascot-box')}
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
                        <th class="reading-type">On'yomi (音読み)</th>
                        <td class="reading-value font-bold text-gold" id="kanji-onyomi">--</td>
                      </tr>
                      <tr>
                        <th class="reading-type">Kun'yomi (訓読み)</th>
                        <td class="reading-value text-warm-paper" id="kanji-kunyomi">--</td>
                      </tr>
                      <tr>
                        <th class="reading-type">Radical (部首)</th>
                        <td class="reading-value text-secondary" id="kanji-radical">--</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- High-Frequency Compounds Table with 1-Click Mine Stamp -->
              <div class="compounds-card tactile-card">
                <div class="compounds-header-row">
                  <span class="compounds-title">Common Compounds · 熟語</span>
                  <span class="text-xs text-muted">1-Click Mine to Local &amp; Anki</span>
                </div>
                <div class="compounds-list" id="compounds-list">
                  <div class="text-muted text-sm py-4 text-center">Loading compounds...</div>
                </div>
              </div>
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
    levelPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        levelPills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.activeLevel = pill.dataset.level;
        this.loadLevelBrowse(this.activeLevel);
      });
    });

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
    const grade = details.grade ? `Grade ${details.grade} (小学校)` : 'Non-Joyo';
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

    // Extract stroke paths
    this.strokePaths = Array.from(canvas.querySelectorAll('path'));
    this.currentStrokes = this.strokePaths.length;
    this.currentStrokeIndex = 0;

    const slider = document.getElementById('stroke-slider');
    if (slider) {
      slider.min = '1';
      slider.max = String(this.currentStrokes || 1);
      slider.value = '1';
    }

    this.renderStrokeStep(0);
  }

  renderStrokeStep(index) {
    this.currentStrokeIndex = Math.max(0, Math.min(index, this.strokePaths.length - 1));

    this.strokePaths.forEach((path, i) => {
      if (i < this.currentStrokeIndex) {
        path.style.stroke = '#F5F1E8';
        path.style.opacity = '1';
        path.style.strokeWidth = '3';
      } else if (i === this.currentStrokeIndex) {
        path.style.stroke = '#C8A94A'; // Gold accent for active stroke
        path.style.opacity = '1';
        path.style.strokeWidth = '4.5';
      } else {
        path.style.stroke = '#444444';
        path.style.opacity = '0.2';
        path.style.strokeWidth = '2';
      }
    });

    const counter = document.getElementById('stroke-counter');
    if (counter) {
      counter.textContent = `Stroke ${this.currentStrokeIndex + 1} of ${this.currentStrokes}`;
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
    this.isPlaying = true;
    const btn = document.getElementById('btn-stroke-play');
    if (btn) btn.textContent = 'Pause';

    if (this.currentStrokeIndex >= this.strokePaths.length - 1) {
      this.currentStrokeIndex = 0;
    }

    this.playTimer = setInterval(() => {
      if (this.currentStrokeIndex < this.strokePaths.length - 1) {
        this.renderStrokeStep(this.currentStrokeIndex + 1);
      } else {
        this.pauseStrokes();
      }
    }, 450);
  }

  pauseStrokes() {
    this.isPlaying = false;
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
    const btn = document.getElementById('btn-stroke-play');
    if (btn) btn.textContent = 'Play';
  }

  replayStrokes() {
    this.pauseStrokes();
    this.renderStrokeStep(0);
    this.startStrokePlay();
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
          await apiClient.saveCard({
            expression: expr,
            reading: read,
            meaning: gloss,
            deck: 'Japanese::Vocab',
            tags: 'kanji-compound'
          });
          btn.textContent = 'Mined ✓';
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

  async loadLevelBrowse(level) {
    const container = document.getElementById('kanji-browse-chips');
    if (!container) return;

    container.innerHTML = `<span class="text-xs text-muted">Loading ${level} kanji...</span>`;

    try {
      const res = await apiClient.browseKanji({ level, limit: 18 });
      const kanjiList = res?.kanji || [];

      if (kanjiList.length === 0) {
        container.innerHTML = `<span class="text-xs text-muted">No kanji listed for ${level}.</span>`;
        return;
      }

      container.innerHTML = kanjiList.map((k) => `
        <button type="button" class="kanji-browse-chip" data-char="${escapeHtml(k.character)}">
          ${escapeHtml(k.character)}
        </button>
      `).join('');

      container.querySelectorAll('.kanji-browse-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          container.querySelectorAll('.kanji-browse-chip').forEach((c) => c.classList.remove('is-active'));
          chip.classList.add('is-active');
          this.loadKanji(chip.dataset.char);
        });
      });
    } catch (err) {
      console.warn('[Kanji] Browse kanji error:', err);
      container.innerHTML = `<span class="text-xs text-error">Browse error: ${escapeHtml(err.message || 'Offline')}</span>`;
    }
  }

  unmount() {
    this.pauseStrokes();
    if (this.container) {
      this.container.innerHTML = '';
    }
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
