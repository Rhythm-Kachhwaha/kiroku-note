/**
 * Kiroku Note Desktop — Grammar Studio View Controller
 * Sentence analyzer, pitch-black segmented visualizer, token hover elevation,
 * grammar point detail card with JLPT level, formations, and mastery toggles.
 */

import { apiClient } from '../services/api_client.js';
import { renderAssetSlot } from '../assets_map.js';

export class GrammarView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.analyzedTokens = [];
    this.activeGrammarPoint = null;
  }

  mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
    this.loadInitialGrammarStats();
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
              <p class="grammar-subtitle">Morphological tokenization with 848 audited JLPT grammar patterns (N5–N1).</p>
            </div>
            <!-- Labeled Mascot Slot -->
            ${renderAssetSlot('grammar-attentive-study', 'grammar-mascot-box')}
          </div>

          <!-- Sentence Analyzer Input Card -->
          <div class="grammar-analyzer-card tactile-card">
            <label for="sentence-input" class="grammar-input-label">Enter Japanese Sentence (文を入力)</label>
            <div class="analyzer-textarea-wrap">
              <textarea
                id="sentence-input"
                class="tactile-input analyzer-textarea"
                rows="3"
                placeholder="Paste Japanese sentence here..."
              >雨が降っているから、傘を持って行ったほうがいい。</textarea>
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
              <!-- Rendered Tokens with Hover Elevation -->
              <span class="token-chip token-grammar is-highlighted" data-token="雨">雨<rt>あめ</rt></span>
              <span class="token-chip token-particle" data-token="が">が</span>
              <span class="token-chip token-grammar" data-token="降っている">降っている<rt>ふっている</rt></span>
              <span class="token-chip token-grammar token-pattern" data-token="から" data-point="kara">から</span>
              <span class="token-punctuation">、</span>
              <span class="token-chip token-grammar" data-token="傘">傘<rt>かさ</rt></span>
              <span class="token-chip token-particle" data-token="を">を</span>
              <span class="token-chip token-grammar" data-token="持って行った">持って行った<rt>もっていった</rt></span>
              <span class="token-chip token-grammar token-pattern is-active-point" data-token="ほうがいい" data-point="hou-ga-ii">ほうがいい</span>
              <span class="token-punctuation">。</span>
            </div>
          </div>

          <!-- Grammar Point Detail Card -->
          <div class="grammar-point-card tactile-card" id="grammar-point-card">
            <div class="point-top-row">
              <div class="point-title-group">
                <div class="flex items-center gap-2">
                  <span class="tactile-pill tactile-pill-gold" id="point-jlpt-tag">JLPT N4</span>
                  <span class="tactile-pill" id="point-status-tag">LEARNING</span>
                </div>
                <h2 class="point-title" id="point-title">〜ほうがいい (hou ga ii)</h2>
                <p class="point-meaning" id="point-meaning">Had better; should (advising or recommending an action)</p>
              </div>

              <!-- Mastery Status Selector -->
              <div class="mastery-status-group" role="radiogroup" aria-label="Grammar Point Mastery">
                <button type="button" class="mastery-pill" data-status="new">New (新規)</button>
                <button type="button" class="mastery-pill is-active" data-status="learning">Learning (学習中)</button>
                <button type="button" class="mastery-pill" data-status="known">Known (習得済み)</button>
              </div>
            </div>

            <!-- Formation Rules -->
            <div class="point-formation-box">
              <h4 class="formation-label">Structure &amp; Formations (接続)</h4>
              <div class="formation-list" id="point-formations">
                <span class="formation-item">Verb [た-form] + ほうがいい (better to do)</span>
                <span class="formation-item">Verb [ない-form] + ほうがいい (better NOT to do)</span>
              </div>
            </div>

            <!-- Curated Example Sentences -->
            <div class="point-examples-section">
              <h4 class="examples-label">Curated Sentences (例文)</h4>
              <div class="examples-list" id="point-examples">
                <div class="example-item">
                  <p class="example-ja">風邪を引いたなら、早く寝た<strong>ほうがいい</strong>ですよ。</p>
                  <p class="example-en text-muted">If you caught a cold, you had better go to sleep early.</p>
                </div>
                <div class="example-item">
                  <p class="example-ja">あまり無理をしない<strong>ほうがいい</strong>。</p>
                  <p class="example-en text-muted">It's better not to push yourself too hard.</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Grammar Level Distribution Bar (N5–N1) -->
          <div class="grammar-distribution-card tactile-card">
            <div class="distribution-header-row">
              <span class="distribution-title">848 AUDITED JLPT GRAMMAR POINTS</span>
              <span class="distribution-ratio">214 / 848 MASTERED</span>
            </div>
            <div class="distribution-bar-row">
              <div class="level-bar-segment segment-n5" style="flex: 98" title="N5 (98 points)">N5</div>
              <div class="level-bar-segment segment-n4" style="flex: 142" title="N4 (142 points)">N4</div>
              <div class="level-bar-segment segment-n3" style="flex: 220" title="N3 (220 points)">N3</div>
              <div class="level-bar-segment segment-n2" style="flex: 212" title="N2 (212 points)">N2</div>
              <div class="level-bar-segment segment-n1" style="flex: 176" title="N1 (176 points)">N1</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  setupEvents() {
    const btnAnalyze = document.getElementById('btn-analyze-sentence');
    const inputSentence = document.getElementById('sentence-input');

    if (btnAnalyze && inputSentence) {
      btnAnalyze.addEventListener('click', async () => {
        const text = inputSentence.value.trim();
        if (!text) return;

        btnAnalyze.disabled = true;
        try {
          const result = await apiClient.analyzeGrammar(text);
          if (result && Array.isArray(result.tokens)) {
            this.renderTokens(result.tokens);
          }
        } catch (err) {
          console.warn('[Grammar] Analyze failed:', err);
        } finally {
          btnAnalyze.disabled = false;
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
    const masteryPills = this.container.querySelectorAll('.mastery-pill');
    masteryPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        masteryPills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
      });
    });
  }

  renderTokens(tokens) {
    const container = document.getElementById('tokens-flow');
    if (!container) return;

    container.innerHTML = tokens.map((t) => {
      const isPattern = Boolean(t.grammar_point || t.is_grammar);
      const chipClass = isPattern ? 'token-chip token-grammar token-pattern is-active-point' : 'token-chip token-grammar';
      return `
        <span class="${chipClass}" data-token="${t.surface || t.token}">
          ${t.surface || t.token}
          ${t.reading ? `<rt>${t.reading}</rt>` : ''}
        </span>
      `;
    }).join('');
  }

  async loadInitialGrammarStats() {
    try {
      const stats = await apiClient.getGrammarStats();
      if (stats) {
        // Update distribution numbers if available
      }
    } catch (_) {}
  }

  unmount() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

