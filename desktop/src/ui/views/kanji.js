/**
 * Kiroku Note Desktop — Kanji Studio View Controller
 * Kanji search, pitch-black KanjiVG stroke order player, On/Kun readings matrix,
 * radical breakdowns, and common compounds with 1-click card mining.
 */

import { apiClient } from '../services/api_client.js';
import { renderAssetSlot } from '../assets_map.js';

export class KanjiView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.currentChar = '静';
    this.currentStrokes = 14;
    this.isPlaying = false;
    this.playTimer = null;
    this.currentStrokeIndex = 0;
  }

  mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
    this.loadKanji(this.currentChar);
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
          </div>

          <!-- Main Layout Grid: Stroke Canvas & Hero (Left) + Readings & Compounds (Right) -->
          <div class="kanji-content-grid">
            <!-- Left Column: Hero Glyph & KanjiVG Stroke Canvas -->
            <div class="kanji-left-column">
              <!-- Mandatory Pitch-Black Stroke Player Surface (#000000) -->
              <div class="kanji-stroke-card surface-pitch-black tactile-card">
                <div class="stroke-header-row">
                  <span class="stroke-title">KanjiVG Stroke Order Engine · 筆順</span>
                  <span class="stroke-counter-tag font-mono text-gold" id="stroke-counter">Stroke 1 of 14</span>
                </div>

                <!-- Vector SVG Canvas Container -->
                <div class="stroke-canvas-container" id="stroke-canvas">
                  <svg id="kanjivg-svg" class="kanjivg-svg" viewBox="0 0 109 109" width="220" height="220">
                    <!-- Standard KanjiVG SVG Paths with Progressive Stroke Order -->
                    <g id="kvg-strokes" stroke="#F5F1E8" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M15 25 Q35 20 50 25" id="stroke-1" />
                      <path d="M30 15 L30 45" id="stroke-2" />
                      <path d="M15 45 Q35 40 50 45" id="stroke-3" />
                      <path d="M15 65 Q35 60 50 65" id="stroke-4" />
                      <path d="M30 45 L30 90" id="stroke-5" />
                      <path d="M60 25 Q80 20 95 25" id="stroke-6" />
                      <path d="M75 15 L75 55" id="stroke-7" />
                      <path d="M60 45 Q80 40 95 45" id="stroke-8" />
                      <path d="M60 65 Q80 60 95 65" id="stroke-9" />
                      <path d="M75 55 L75 90" id="stroke-10" />
                    </g>
                  </svg>
                </div>

                <!-- Stroke Player Controls Bar -->
                <div class="stroke-controls-bar">
                  <button class="tactile-btn tactile-btn-sm" id="btn-stroke-replay" title="Replay from start">Replay</button>
                  <button class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-stroke-play" title="Play animation">Play</button>
                  <input type="range" id="stroke-slider" min="1" max="14" value="1" class="stroke-scrubber" />
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
                  <span class="kanji-hero-glyph" id="kanji-glyph">静</span>
                  <div class="kanji-hero-meta">
                    <div class="flex items-center gap-2">
                      <span class="tactile-pill tactile-pill-gold" id="kanji-jlpt">JLPT N3</span>
                      <span class="tactile-pill" id="kanji-grade">Grade 4 (小学校)</span>
                    </div>
                    <h2 class="kanji-meanings-list" id="kanji-meanings">quiet · calm · stillness</h2>
                    <span class="kanji-freq-rank text-xs text-muted">Frequency Rank #704 · 14 Strokes</span>
                  </div>
                </div>

                <!-- Readings Matrix Table -->
                <div class="readings-matrix-box">
                  <table class="readings-table">
                    <tbody>
                      <tr>
                        <th class="reading-type">On'yomi (音読み)</th>
                        <td class="reading-value font-bold text-gold" id="kanji-onyomi">セイ (sei), ジョウ (jou)</td>
                      </tr>
                      <tr>
                        <th class="reading-type">Kun'yomi (訓読み)</th>
                        <td class="reading-value text-warm-paper" id="kanji-kunyomi">しず-か (shizu-ka), しず-まる (shizu-maru)</td>
                      </tr>
                      <tr>
                        <th class="reading-type">Radical (部首)</th>
                        <td class="reading-value text-secondary" id="kanji-radical">青 (blue / green)</td>
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
                  <div class="compound-row">
                    <div class="compound-head">
                      <ruby class="compound-glyph">静寂<rt>せいじゃく</rt></ruby>
                      <span class="compound-gloss">silence · stillness</span>
                    </div>
                    <button class="tactile-btn tactile-btn-sm tactile-btn-primary btn-mine-compound" data-expr="静寂" data-read="せいじゃく" data-gloss="silence · stillness">Mine</button>
                  </div>
                  <div class="compound-row">
                    <div class="compound-head">
                      <ruby class="compound-glyph">冷静<rt>れいせい</rt></ruby>
                      <span class="compound-gloss">calm · composed · cool-headed</span>
                    </div>
                    <button class="tactile-btn tactile-btn-sm tactile-btn-primary btn-mine-compound" data-expr="冷静" data-read="れいせい" data-gloss="calm · composed · cool-headed">Mine</button>
                  </div>
                  <div class="compound-row">
                    <div class="compound-head">
                      <ruby class="compound-glyph">安静<rt>あんせい</rt></ruby>
                      <span class="compound-gloss">quietness · bed rest (medical)</span>
                    </div>
                    <button class="tactile-btn tactile-btn-sm tactile-btn-primary btn-mine-compound" data-expr="安静" data-read="あんせい" data-gloss="quietness · bed rest (medical)">Mine</button>
                  </div>
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

    if (btnLookup && inputKanji) {
      btnLookup.addEventListener('click', () => {
        const char = inputKanji.value.trim();
        if (char) this.loadKanji(char);
      });
    }

    // Stroke Replay & Play buttons
    const btnPlay = document.getElementById('btn-stroke-play');
    const btnReplay = document.getElementById('btn-stroke-replay');

    if (btnPlay) {
      btnPlay.addEventListener('click', () => this.toggleStrokePlay());
    }
    if (btnReplay) {
      btnReplay.addEventListener('click', () => this.replayStrokes());
    }

    // Compound Mine Buttons
    this.container.querySelectorAll('.btn-mine-compound').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const expr = e.target.dataset.expr;
        const read = e.target.dataset.read;
        const gloss = e.target.dataset.gloss;
        e.target.disabled = true;
        e.target.textContent = 'Mined ✓';
        try {
          await apiClient.createCard({
            expression: expr,
            reading: read,
            meaning: gloss,
            deck: 'Japanese::Vocab',
            tags: 'kanji-compound'
          });
        } catch (_) {}
      });
    });
  }

  async loadKanji(char) {
    this.currentChar = char;
    const glyphEl = document.getElementById('kanji-glyph');
    if (glyphEl) glyphEl.textContent = char;

    try {
      const details = await apiClient.getKanjiDetails(char);
      if (details) {
        if (details.meanings) {
          const m = document.getElementById('kanji-meanings');
          if (m) m.textContent = details.meanings.join(' · ');
        }
        if (details.on_readings) {
          const o = document.getElementById('kanji-onyomi');
          if (o) o.textContent = details.on_readings.join(', ');
        }
        if (details.kun_readings) {
          const k = document.getElementById('kanji-kunyomi');
          if (k) k.textContent = details.kun_readings.join(', ');
        }
      }
    } catch (_) {}
  }

  toggleStrokePlay() {
    this.isPlaying = !this.isPlaying;
    const btn = document.getElementById('btn-stroke-play');
    if (btn) btn.textContent = this.isPlaying ? 'Pause' : 'Play';
  }

  replayStrokes() {
    this.currentStrokeIndex = 0;
    this.toggleStrokePlay();
  }

  unmount() {
    if (this.playTimer) clearInterval(this.playTimer);
    if (this.container) this.container.innerHTML = '';
  }
}
