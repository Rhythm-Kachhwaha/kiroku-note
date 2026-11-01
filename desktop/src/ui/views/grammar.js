/**
 * Kiroku Note Desktop — Grammar Studio View Controller
 * Sentence analyzer, pitch-black segmented visualizer, token hover elevation,
 * grammar point detail card with JLPT level, formations, mastery toggles,
 * universal JLPT level sync, and live syllabus browser by level.
 */

import { apiClient } from '../services/api_client.js';
import { renderAssetSlot } from '../assets_map.js';
import { getUniversalJlptLevel } from '../utils/learner.js';

export class GrammarView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.analyzedTokens = [];
    this.activeGrammarPoint = null;
    this.currentSyllabusLevel = 'N4';
    this.currentSyllabusSearch = '';
  }

  async mount(container) {
    this.container = container;
    try {
      const univLevel = await getUniversalJlptLevel();
      if (univLevel) {
        this.currentSyllabusLevel = univLevel;
      }
    } catch (err) {
      console.debug('[Grammar] Resolve universal level error:', err);
    }

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
                <span class="font-mono text-sm text-primary">Grammar Studio</span>
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
            <button type="button" class="btn-dismiss-error" id="btn-dismiss-grammar-error" aria-label="Dismiss error"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>
          </div>

          <!-- Sentence Analyzer Input Card -->
          <div class="grammar-analyzer-card tactile-card">
            <label for="sentence-input" class="grammar-input-label">Enter Japanese Sentence</label>
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
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <span>Analyze Sentence</span>
              </button>
            </div>
          </div>

          <!-- Mandatory Pitch-Black Segmented Visualizer (#000000) -->
          <div class="grammar-visualizer-card surface-pitch-black tactile-card">
            <div class="visualizer-header-row">
              <span class="visualizer-title">Tokenized Structure</span>
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
                  <button type="button" class="mastery-pill" data-status="new">New</button>
                  <button type="button" class="mastery-pill" data-status="learning">Learning</button>
                  <button type="button" class="mastery-pill" data-status="known">Known</button>
                </div>
              </div>

              <!-- Formation Rules -->
              <div class="point-formation-box">
                <h4 class="formation-label">Formations</h4>
                <div class="formation-list" id="point-formations">
                  <span class="text-sm text-muted">No formation rules listed.</span>
                </div>
              </div>

              <!-- Curated Example Sentences -->
              <div class="point-examples-section">
                <h4 class="examples-label">Curated Examples</h4>
                <div class="examples-list" id="point-examples">
                  <span class="text-sm text-muted">No example sentences available.</span>
                </div>
              </div>

              <!-- Sentence Encounters (Mining History Context) -->
              <div class="point-encounters-section mt-4">
                <h4 class="examples-label">Prior Sentence Encounters</h4>
                <div class="encounters-list" id="point-encounters">
                  <span class="text-sm text-muted">Select a grammar point to inspect encounters.</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Syllabus Browser by Level -->
          <div class="grammar-syllabus-card tactile-card">
            <div class="visualizer-header-row">
              <span class="visualizer-title">JLPT Grammar Syllabus</span>
              <span class="text-xs text-muted" id="syllabus-count-label">Loading syllabus...</span>
            </div>
            <div class="syllabus-controls-row">
              <div class="syllabus-level-pills" id="syllabus-level-pills">
                <button type="button" class="syllabus-level-pill ${this.currentSyllabusLevel === '' ? 'is-active' : ''}" data-level="">All</button>
                <button type="button" class="syllabus-level-pill ${this.currentSyllabusLevel === 'N5' ? 'is-active' : ''}" data-level="N5">N5</button>
                <button type="button" class="syllabus-level-pill ${this.currentSyllabusLevel === 'N4' ? 'is-active' : ''}" data-level="N4">N4</button>
                <button type="button" class="syllabus-level-pill ${this.currentSyllabusLevel === 'N3' ? 'is-active' : ''}" data-level="N3">N3</button>
                <button type="button" class="syllabus-level-pill ${this.currentSyllabusLevel === 'N2' ? 'is-active' : ''}" data-level="N2">N2</button>
                <button type="button" class="syllabus-level-pill ${this.currentSyllabusLevel === 'N1' ? 'is-active' : ''}" data-level="N1">N1</button>
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
          if (tag) {
            tag.textContent = newStatus.toUpperCase();
            tag.className = `tactile-pill ${newStatus === 'known' ? 'tactile-pill-gold' : ''}`;
          }

          masteryPills.forEach((p) => p.classList.toggle('is-active', p.dataset.status === newStatus));
          this.updateSyllabusItemStatus(this.activeGrammarPoint.pattern_key, newStatus);
          this.loadInitialGrammarStats();
        } catch (err) {
          console.error('[Grammar] Update mastery failed:', err);
          this.showError('Failed to update status: ' + (err.message || 'Network error'));
        }
      });
    });

    // Syllabus level filter pills
    const levelPills = this.container.querySelectorAll('#syllabus-level-pills .syllabus-level-pill');
    levelPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        levelPills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        this.currentSyllabusLevel = pill.dataset.level;

        if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
          window.chrome.storage.local.set({ 'grammar.currentSyllabusLevel': this.currentSyllabusLevel });
        }

        this.loadSyllabus({
          level: this.currentSyllabusLevel,
          search: this.currentSyllabusSearch
        });
      });
    });

    // Syllabus search input
    const searchInput = document.getElementById('syllabus-search');
    let searchDebounce = null;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
          this.currentSyllabusSearch = searchInput.value.trim();
          this.loadSyllabus({
            level: this.currentSyllabusLevel,
            search: this.currentSyllabusSearch
          });
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

  renderAnalyzedSentence(sentenceText, points) {
    const container = document.getElementById('tokens-flow');
    if (!container) return;

    if (!points || points.length === 0) {
      this.renderTokensFlow([sentenceText]);
      return;
    }

    const segments = [];
    let lastIdx = 0;

    const sortedPoints = [...points].sort((a, b) => {
      const idxA = a.position !== undefined ? a.position : sentenceText.indexOf(a.pattern_display || a.pattern_key);
      const idxB = b.position !== undefined ? b.position : sentenceText.indexOf(b.pattern_display || b.pattern_key);
      return idxA - idxB;
    });

    for (const pt of sortedPoints) {
      const display = pt.pattern_display || pt.pattern_key;
      const idx = pt.position !== undefined ? pt.position : sentenceText.indexOf(display, lastIdx);

      if (idx > lastIdx) {
        segments.push({ text: sentenceText.substring(lastIdx, idx), isGrammar: false });
      }

      if (idx !== -1) {
        segments.push({ text: display, isGrammar: true, point: pt });
        lastIdx = idx + display.length;
      }
    }

    if (lastIdx < sentenceText.length) {
      segments.push({ text: sentenceText.substring(lastIdx), isGrammar: false });
    }

    container.innerHTML = segments.map((seg, i) => {
      if (seg.isGrammar) {
        const lvl = seg.point?.level || 'JLPT';
        return `
          <button
            type="button"
            class="grammar-token-chip is-active-point tactile-card-interactive"
            data-index="${i}"
            data-key="${escapeHtml(seg.point.pattern_key)}"
          >
            <span class="token-text font-japanese font-bold text-warm-paper">${escapeHtml(seg.text)}</span>
            <span class="token-level-tag tactile-pill tactile-pill-gold text-xs">${escapeHtml(lvl)}</span>
          </button>
        `;
      }
      return `<span class="plain-token font-japanese text-secondary">${escapeHtml(seg.text)}</span>`;
    }).join('');

    container.querySelectorAll('.grammar-token-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        container.querySelectorAll('.grammar-token-chip').forEach((c) => c.classList.remove('is-selected-token'));
        chip.classList.add('is-selected-token');

        const key = chip.dataset.key;
        const pt = points.find((p) => p.pattern_key === key);
        if (pt) {
          this.displayGrammarDetail(pt);
        }
      });
    });

    if (sortedPoints.length > 0) {
      this.displayGrammarDetail(sortedPoints[0]);
      container.querySelector('.grammar-token-chip')?.classList.add('is-selected-token');
    }
  }

  renderTokensFlow(tokens) {
    const container = document.getElementById('tokens-flow');
    if (!container) return;

    if (!tokens || tokens.length === 0) {
      container.innerHTML = `<div class="empty-tokens text-muted text-sm py-4 text-center">No tokens generated.</div>`;
      return;
    }

    container.innerHTML = tokens.map((tok) => `
      <span class="plain-token font-japanese text-warm-paper">${escapeHtml(tok)}</span>
    `).join(' ');
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
    const formationsBox = document.getElementById('point-formations');
    const examplesBox = document.getElementById('point-examples');
    const encountersBox = document.getElementById('point-encounters');

    if (jlptTag) jlptTag.textContent = point.level ? `JLPT ${point.level}` : 'JLPT';
    const status = point.status || 'new';
    if (statusTag) {
      statusTag.textContent = status.toUpperCase();
      statusTag.className = `tactile-pill ${status === 'known' ? 'tactile-pill-gold' : ''}`;
    }

    if (title) title.textContent = point.pattern_display || point.pattern_key;
    if (meaning) meaning.textContent = point.meaning_short || point.english_breakdown || '--';

    const masteryPills = this.container.querySelectorAll('#mastery-status-group .mastery-pill');
    masteryPills.forEach((pill) => {
      pill.classList.toggle('is-active', pill.dataset.status === status);
    });

    // Formations
    if (formationsBox) {
      const formations = point.formation_rules || point.formations || [];
      if (Array.isArray(formations) && formations.length > 0) {
        formationsBox.innerHTML = formations.map((f) => `
          <div class="formation-item font-mono text-sm text-secondary">${escapeHtml(f)}</div>
        `).join('');
      } else {
        formationsBox.innerHTML = `<span class="text-sm text-muted">No formation rules listed.</span>`;
      }
    }

    // Examples
    if (examplesBox) {
      const examples = point.curated_examples || point.examples || [];
      if (Array.isArray(examples) && examples.length > 0) {
        examplesBox.innerHTML = examples.map((ex) => `
          <div class="example-item tactile-card surface-pitch-black p-3 mb-2">
            <p class="example-ja font-japanese text-warm-paper font-semibold">${escapeHtml(ex.japanese || ex.sentence || ex)}</p>
            ${ex.english ? `<p class="example-en text-secondary text-xs mt-1">${escapeHtml(ex.english)}</p>` : ''}
          </div>
        `).join('');
      } else {
        examplesBox.innerHTML = `<span class="text-sm text-muted">No example sentences available.</span>`;
      }
    }

    // Encounters
    if (encountersBox) {
      const encounters = point.encounters || [];
      if (Array.isArray(encounters) && encounters.length > 0) {
        encountersBox.innerHTML = encounters.map((enc) => `
          <div class="encounter-item text-xs text-secondary py-1">
            <span class="font-japanese text-warm-paper">${escapeHtml(enc.sentence || enc)}</span>
            ${enc.created_at ? `<span class="text-muted ml-2 font-mono">${escapeHtml(enc.created_at.slice(0, 10))}</span>` : ''}
          </div>
        `).join('');
      } else {
        encountersBox.innerHTML = `<span class="text-sm text-muted">No recorded sentence encounters yet.</span>`;
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
    .replace(/'/g, '&#039;');
}
