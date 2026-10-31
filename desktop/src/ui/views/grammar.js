/**
 * Kiroku Note Desktop — Grammar Studio View Controller
 * Sentence analyzer, pitch-black segmented visualizer, token hover elevation,
 * grammar point detail card with JLPT level, formations, mastery toggles,
 * and live syllabus browser by level.
 */

import { apiClient } from '../services/api_client.js';
import { renderAssetSlot } from '../assets_map.js';

export class GrammarView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.analyzedTokens = [];
    this.activeGrammarPoint = null;
    this.currentSyllabusLevel = 'N4';
    this.currentSyllabusSearch = '';
  }

  mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
    this.loadInitialGrammarStats();
    this.loadSyllabus({ level: this.currentSyllabusLevel });
  }

  render() {
    this.container.innerHTML = `
      <div class="grammar-view-wrapper">
        <div class="grammar-view-container">
          <!-- Page Header -->
          <div class="grammar-header-row">
            <div>
              <div class="flex items-center gap-2">
                <span class="grammar-header-dot"></span>
                <span class="font-mono text-sm tracking-widest text-primary uppercase">GRAMMAR STUDIO · 文法分析</span>
              </div>
              <h1 class="grammar-title">Sentence Structure &amp; Grammar Reference</h1>
              <p class="grammar-subtitle">Morphological tokenization with audited JLPT grammar patterns (N5–N1).</p>
            </div>
            <!-- Labeled Mascot Slot -->
            ${renderAssetSlot('grammar-attentive-study', 'grammar-mascot-box')}
          </div>

          <!-- Visible Error Banner -->
          <div class="grammar-error-banner" id="grammar-error-banner" style="display: none;">
            <span class="error-msg" id="grammar-error-msg"></span>
            <button type="button" class="btn-dismiss-error" id="btn-dismiss-grammar-error">✕</button>
          </div>

          <!-- Sentence Analyzer Input Card -->
          <div class="grammar-analyzer-card tactile-card">
            <label for="sentence-input" class="grammar-input-label">Enter Japanese Sentence (文を入力)</label>
            <div class="analyzer-textarea-wrap">
              <textarea
                id="sentence-input"
                class="tactile-input analyzer-textarea"
                rows="3"
                placeholder="Paste or type a Japanese sentence to analyze..."
              ></textarea>
            </div>
            <div class="analyzer-actions-row">
              <div class="quick-examples">
                <span class="text-xs text-muted">Try:</span>
                <button type="button" class="btn-example-chip" data-example="雨が降っているから、傘を持って行ったほうがいい。">〜ほうがいい (N4)</button>
                <button type="button" class="btn-example-chip" data-example="いくら高くても、買わなければならない。">〜なければならない (N5)</button>
                <button type="button" class="btn-example-chip" data-example="彼女は嬉しさのあまり、涙を流した。">〜あまり (N2)</button>
              </div>
              <button class="tactile-btn tactile-btn-primary" id="btn-analyze-sentence">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                </svg>
                <span>Analyze Sentence</span>
              </button>
            </div>
          </div>

          <!-- Mandatory Pitch-Black Segmented Visualizer (#000000) -->
          <div class="grammar-visualizer-card surface-pitch-black tactile-card">
            <div class="visualizer-header-row">
              <span class="visualizer-title">Tokenized Structure · 構文解析</span>
              <span class="text-xs text-gold">Click any token to inspect grammatical rules</span>
            </div>
            <div class="tokens-flow-container" id="tokens-flow">
              <div class="empty-tokens text-muted text-sm py-4 text-center" id="tokens-empty-msg">
                Enter a Japanese sentence above and click "Analyze Sentence" to inspect tokenized structure.
              </div>
            </div>
          </div>

          <!-- Grammar Point Detail Card -->
          <div class="grammar-point-card tactile-card" id="grammar-point-card">
            <div id="detail-placeholder" class="text-muted text-sm py-6 text-center">
              Select any grammar token or browse the syllabus below to view formation rules and curated examples.
            </div>
            <div id="detail-content" style="display: none;">
              <div class="point-top-row">
                <div class="point-title-group">
                  <div class="flex items-center gap-2">
                    <span class="tactile-pill tactile-pill-gold" id="point-jlpt-tag">JLPT --</span>
                    <span class="tactile-pill" id="point-status-tag">NEW</span>
                  </div>
                  <h2 class="point-title" id="point-title">--</h2>
                  <p class="point-meaning" id="point-meaning">--</p>
                </div>

                <!-- Mastery Status Selector -->
                <div class="mastery-status-group" id="mastery-status-group" role="radiogroup" aria-label="Grammar Point Mastery">
                  <button type="button" class="mastery-pill" data-status="new">New (新規)</button>
                  <button type="button" class="mastery-pill" data-status="learning">Learning (学習中)</button>
                  <button type="button" class="mastery-pill" data-status="known">Known (習得済み)</button>
                </div>
              </div>

              <!-- Formation Rules -->
              <div class="point-formation-box">
                <h4 class="formation-label">Structure &amp; Formations (接続)</h4>
                <div class="formation-list" id="point-formations">
                  <span class="text-sm text-muted">No formation rules listed.</span>
                </div>
              </div>

              <!-- Curated Example Sentences -->
              <div class="point-examples-section">
                <h4 class="examples-label">Curated Sentences (例文)</h4>
                <div class="examples-list" id="point-examples">
                  <span class="text-sm text-muted">No example sentences available.</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Syllabus Browser by Level -->
          <div class="grammar-syllabus-card tactile-card">
            <div class="visualizer-header-row">
              <span class="visualizer-title">JLPT Grammar Syllabus · 文法一覧</span>
              <span class="text-xs text-muted" id="syllabus-count-label">Loading syllabus...</span>
            </div>
            <div class="syllabus-controls-row">
              <div class="syllabus-level-pills" id="syllabus-level-pills">
                <button type="button" class="syllabus-level-pill" data-level="">All</button>
                <button type="button" class="syllabus-level-pill" data-level="N5">N5</button>
                <button type="button" class="syllabus-level-pill is-active" data-level="N4">N4</button>
                <button type="button" class="syllabus-level-pill" data-level="N3">N3</button>
                <button type="button" class="syllabus-level-pill" data-level="N2">N2</button>
                <button type="button" class="syllabus-level-pill" data-level="N1">N1</button>
              </div>
              <input
                type="text"
                class="tactile-input syllabus-search-input"
                id="syllabus-search"
                placeholder="Search grammar patterns..."
              />
            </div>
            <div class="syllabus-list" id="syllabus-list">
              <div class="text-sm text-muted py-4 text-center">Loading syllabus points...</div>
            </div>
          </div>

          <!-- Grammar Level Distribution Bar (N5–N1) -->
          <div class="grammar-distribution-card tactile-card">
            <div class="distribution-header-row">
              <span class="distribution-title" id="distribution-title">AUDITED JLPT GRAMMAR POINTS</span>
              <span class="distribution-ratio" id="distribution-ratio">-- / -- MASTERED</span>
            </div>
            <div class="distribution-bar-row" id="distribution-bar-row">
              <div class="level-bar-segment segment-n5" id="bar-seg-n5" style="flex: 1" title="N5">N5</div>
              <div class="level-bar-segment segment-n4" id="bar-seg-n4" style="flex: 1" title="N4">N4</div>
              <div class="level-bar-segment segment-n3" id="bar-seg-n3" style="flex: 1" title="N3">N3</div>
              <div class="level-bar-segment segment-n2" id="bar-seg-n2" style="flex: 1" title="N2">N2</div>
              <div class="level-bar-segment segment-n1" id="bar-seg-n1" style="flex: 1" title="N1">N1</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  setupEvents() {
    const btnAnalyze = document.getElementById('btn-analyze-sentence');
    const inputSentence = document.getElementById('sentence-input');
    const btnDismiss = document.getElementById('btn-dismiss-grammar-error');

    if (btnDismiss) {
      btnDismiss.addEventListener('click', () => this.clearError());
    }

    if (btnAnalyze && inputSentence) {
      btnAnalyze.addEventListener('click', async () => {
        const text = inputSentence.value.trim();
        if (!text) {
          this.showError('Please enter a Japanese sentence to analyze.');
          return;
        }

        this.clearError();
        btnAnalyze.disabled = true;
        btnAnalyze.classList.add('is-loading');

        try {
          const result = await apiClient.analyzeGrammar(text);
          if (result && Array.isArray(result.points)) {
            this.renderAnalyzedSentence(text, result.points);
          } else {
            this.renderTokensFlow([text]);
          }
        } catch (err) {
          console.error('[Grammar] Analyze failed:', err);
          this.showError('Analysis failed: ' + (err.message || 'Network error'));
        } finally {
          btnAnalyze.disabled = false;
          btnAnalyze.classList.remove('is-loading');
        }
      });
    }

    // Quick example chips
    this.container.querySelectorAll('.btn-example-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (inputSentence) {
          inputSentence.value = btn.dataset.example;
          btnAnalyze?.click();
        }
      });
    });

    // Mastery status toggle pills
    const masteryPills = this.container.querySelectorAll('#mastery-status-group .mastery-pill');
    masteryPills.forEach((pill) => {
      pill.addEventListener('click', async () => {
        if (!this.activeGrammarPoint || !this.activeGrammarPoint.pattern_key) {
          return;
        }

        const newStatus = pill.dataset.status;
        try {
          await apiClient.updateGrammarPoint(this.activeGrammarPoint.pattern_key, { status: newStatus });
          this.activeGrammarPoint.status = newStatus;

          const tag = document.getElementById('point-status-tag');
          if (tag) tag.textContent = newStatus.toUpperCase();

          masteryPills.forEach((p) => p.classList.toggle('is-active', p.dataset.status === newStatus));
          await this.loadInitialGrammarStats();
          this.updateSyllabusItemStatus(this.activeGrammarPoint.pattern_key, newStatus);
        } catch (err) {
          console.error('[Grammar] Update point status failed:', err);
          this.showError('Failed to update status: ' + (err.message || 'Network error'));
        }
      });
    });

    // Syllabus level filter pills
    const levelPills = this.container.querySelectorAll('.syllabus-level-pill');
    levelPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        levelPills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.currentSyllabusLevel = pill.dataset.level;
        this.loadSyllabus({ level: this.currentSyllabusLevel, search: this.currentSyllabusSearch });
      });
    });

    // Syllabus search input
    const searchInput = document.getElementById('syllabus-search');
    let searchTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          this.currentSyllabusSearch = searchInput.value.trim();
          this.loadSyllabus({ level: this.currentSyllabusLevel, search: this.currentSyllabusSearch });
        }, 250);
      });
    }
  }

  showError(message) {
    const banner = document.getElementById('grammar-error-banner');
    const msg = document.getElementById('grammar-error-msg');
    if (banner && msg) {
      msg.textContent = message;
      banner.style.display = 'flex';
    }
  }

  clearError() {
    const banner = document.getElementById('grammar-error-banner');
    if (banner) {
      banner.style.display = 'none';
    }
  }

  renderAnalyzedSentence(sentence, points) {
    const container = document.getElementById('tokens-flow');
    if (!container) return;

    if (!points || points.length === 0) {
      container.innerHTML = `
        <span class="token-chip token-grammar">${escapeHtml(sentence)}</span>
        <span class="text-xs text-muted ml-2">No JLPT grammar patterns matched.</span>
      `;
      return;
    }

    // Sort points by start index
    const sorted = [...points].sort((a, b) => a.start - b.end);
    let html = '';
    let lastIdx = 0;

    sorted.forEach((pt, idx) => {
      if (pt.start > lastIdx) {
        const textBefore = sentence.substring(lastIdx, pt.start);
        html += `<span class="token-chip token-grammar" data-non-pattern="true">${escapeHtml(textBefore)}</span>`;
      }

      const pointText = sentence.substring(pt.start, pt.end);
      html += `
        <span class="token-chip token-grammar token-pattern" data-point-idx="${idx}" data-pattern-key="${escapeHtml(pt.pattern_key)}">
          ${escapeHtml(pointText)}
        </span>
      `;
      lastIdx = pt.end;
    });

    if (lastIdx < sentence.length) {
      const textAfter = sentence.substring(lastIdx);
      html += `<span class="token-chip token-grammar" data-non-pattern="true">${escapeHtml(textAfter)}</span>`;
    }

    container.innerHTML = html;

    // Attach click listeners to token chips
    const chips = container.querySelectorAll('.token-chip');
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => c.classList.remove('is-active-point'));
        chip.classList.add('is-active-point');

        const ptIdx = chip.dataset.pointIdx;
        if (ptIdx !== undefined && sorted[ptIdx]) {
          this.displayGrammarDetail(sorted[ptIdx]);
        }
      });
    });

    // Automatically display the first detected grammar point
    if (sorted.length > 0) {
      const firstChip = container.querySelector('.token-pattern');
      if (firstChip) firstChip.classList.add('is-active-point');
      this.displayGrammarDetail(sorted[0]);
    }
  }

  displayGrammarDetail(point) {
    this.activeGrammarPoint = point;

    const placeholder = document.getElementById('detail-placeholder');
    const content = document.getElementById('detail-content');
    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = 'block';

    const jlptTag = document.getElementById('point-jlpt-tag');
    const statusTag = document.getElementById('point-status-tag');
    const title = document.getElementById('point-title');
    const meaning = document.getElementById('point-meaning');
    const formationsList = document.getElementById('point-formations');
    const examplesList = document.getElementById('point-examples');

    const level = point.level || '--';
    const status = point.status || 'new';

    if (jlptTag) jlptTag.textContent = `JLPT ${level}`;
    if (statusTag) statusTag.textContent = status.toUpperCase();
    if (title) title.textContent = point.pattern_display || point.pattern_key || point.text || '--';
    if (meaning) meaning.textContent = point.meaning_short || point.english_breakdown || 'No description available.';

    // Active mastery pill
    const masteryPills = this.container.querySelectorAll('#mastery-status-group .mastery-pill');
    masteryPills.forEach((p) => p.classList.toggle('is-active', p.dataset.status === status));

    // Formations
    if (formationsList) {
      let formations = point.formation;
      if (typeof formations === 'string') {
        formations = [formations];
      }
      if (Array.isArray(formations) && formations.length > 0) {
        formationsList.innerHTML = formations.map((f) => `<span class="formation-item">${escapeHtml(f)}</span>`).join('');
      } else {
        formationsList.innerHTML = `<span class="text-sm text-muted">No formation rules listed.</span>`;
      }
    }

    // Examples
    if (examplesList) {
      const examples = Array.isArray(point.examples) ? point.examples : [];
      if (examples.length > 0) {
        examplesList.innerHTML = examples.map((ex) => {
          if (typeof ex === 'string') {
            return `<div class="example-item"><p class="example-ja">${escapeHtml(ex)}</p></div>`;
          }
          return `
            <div class="example-item">
              <p class="example-ja">${escapeHtml(ex.sentence || ex.ja || '')}</p>
              ${ex.translation || ex.en ? `<p class="example-en text-muted">${escapeHtml(ex.translation || ex.en)}</p>` : ''}
            </div>
          `;
        }).join('');
      } else {
        examplesList.innerHTML = `<span class="text-sm text-muted">No example sentences available.</span>`;
      }
    }
  }

  async loadSyllabus(params = {}) {
    const listContainer = document.getElementById('syllabus-list');
    const countLabel = document.getElementById('syllabus-count-label');
    if (!listContainer) return;

    listContainer.innerHTML = `<div class="text-sm text-muted py-4 text-center">Loading syllabus points...</div>`;

    try {
      const result = await apiClient.getGrammarSyllabus({
        level: params.level || '',
        search: params.search || '',
        limit: 100,
        offset: 0
      });

      const points = result?.points || [];
      const total = result?.total || points.length;

      if (countLabel) {
        countLabel.textContent = `${total} points found`;
      }

      if (points.length === 0) {
        listContainer.innerHTML = `<div class="text-sm text-muted py-4 text-center">No grammar patterns found.</div>`;
        return;
      }

      listContainer.innerHTML = points.map((pt) => `
        <div class="syllabus-item" data-key="${escapeHtml(pt.pattern_key)}">
          <div class="syllabus-item-main">
            <span class="tactile-pill tactile-pill-gold text-xs">${escapeHtml(pt.level || 'JLPT')}</span>
            <span class="syllabus-item-title">${escapeHtml(pt.pattern_display || pt.pattern_key)}</span>
            <span class="syllabus-item-meaning">${escapeHtml(pt.meaning_short || pt.english_breakdown || '')}</span>
          </div>
          <span class="tactile-pill text-xs syllabus-status-pill">${escapeHtml((pt.status || 'new').toUpperCase())}</span>
        </div>
      `).join('');

      listContainer.querySelectorAll('.syllabus-item').forEach((item) => {
        item.addEventListener('click', () => {
          listContainer.querySelectorAll('.syllabus-item').forEach((i) => i.classList.remove('is-selected'));
          item.classList.add('is-selected');

          const key = item.dataset.key;
          const found = points.find((p) => p.pattern_key === key);
          if (found) {
            this.displayGrammarDetail(found);
          }
        });
      });
    } catch (err) {
      console.error('[Grammar] Load syllabus failed:', err);
      listContainer.innerHTML = `<div class="text-sm text-error py-4 text-center">Failed to load syllabus.</div>`;
      this.showError('Syllabus error: ' + (err.message || 'Network error'));
    }
  }

  updateSyllabusItemStatus(patternKey, newStatus) {
    const listContainer = document.getElementById('syllabus-list');
    if (!listContainer) return;

    const item = listContainer.querySelector(`[data-key="${patternKey}"]`);
    if (item) {
      const pill = item.querySelector('.syllabus-status-pill');
      if (pill) {
        pill.textContent = newStatus.toUpperCase();
      }
    }
  }

  async loadInitialGrammarStats() {
    try {
      const stats = await apiClient.getGrammarStats();
      if (!stats) return;

      const coverage = stats.coverage || {};
      let totalAudited = 0;
      let totalKnown = 0;

      for (const level of ['N5', 'N4', 'N3', 'N2', 'N1']) {
        const cov = coverage[level];
        if (cov) {
          totalAudited += cov.total || 0;
          totalKnown += cov.known || 0;

          const seg = document.getElementById(`bar-seg-${level.toLowerCase()}`);
          if (seg && cov.total > 0) {
            seg.style.flex = cov.total;
            seg.title = `${level} (${cov.known} / ${cov.total} known)`;
          }
        }
      }

      const titleEl = document.getElementById('distribution-title');
      const ratioEl = document.getElementById('distribution-ratio');

      if (titleEl && totalAudited > 0) {
        titleEl.textContent = `${totalAudited} AUDITED JLPT GRAMMAR POINTS`;
      }
      if (ratioEl && totalAudited > 0) {
        ratioEl.textContent = `${totalKnown} / ${totalAudited} MASTERED`;
      }
    } catch (err) {
      console.warn('[Grammar] Load stats error:', err);
      // Non-fatal, keep honest fallback
    }
  }

  unmount() {
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
