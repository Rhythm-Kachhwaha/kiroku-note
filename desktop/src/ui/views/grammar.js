/**
 * Kiroku Note Desktop — Grammar Studio View Controller
 * Sentence analyzer, pitch-black segmented visualizer, token hover elevation,
 * editorial grammar reference card with Zen Old Mincho pattern titles,
 * formation rules, examples with furigana/ruby markup, universal JLPT level sync,
 * and live syllabus browser by level.
 */

import { apiClient } from '../services/api_client.js';
import { renderAssetSlot } from '../assets_map.js';
import { getUniversalJlptLevel } from '../utils/learner.js';
import { escapeHtml, sanitizePromptMarkup } from '../utils/sanitizer.js';

export class GrammarView {
  constructor(router) {
    this.router = router;
    this.keepAlive = true;
    this.container = null;
    this.analyzedTokens = [];
    this.analyzedSpans = [];
    this.activeGrammarPoint = null;
    this.activeDetailTab = 'meaning';
    this.tokensDiagnosticOpen = readSessionFlag(TOKENS_DIAGNOSTIC_KEY);
    this.onlySeenInCards = false;
    this.currentSyllabusLevel = 'N4';
    this.currentSyllabusSearch = '';
    this.activeSegment = 'analyze';
    this.activeRoadmapMode = 'flow';
    this.roadmapFlowData = null;
    this.roadmapHubsData = null;
    this.roadmapLoading = false;
    this.activeRoadmapKey = null;
    this.isBreakdownOpen = false;
    this.lastRoadmapScrollY = 0;
    this.activeBreakdownPoint = null;
    this.escListener = null;
  }

  async mount(container) {
    this.container = container;
    this.tokensDiagnosticOpen = readSessionFlag(TOKENS_DIAGNOSTIC_KEY);
    try {
      let storedLevel = null;
      if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
        const stored = await window.chrome.storage.local.get('grammar.currentSyllabusLevel');
        if (stored && stored['grammar.currentSyllabusLevel']) {
          storedLevel = stored['grammar.currentSyllabusLevel'];
        }
      }
      if (storedLevel) {
        this.currentSyllabusLevel = storedLevel;
      } else {
        const univLevel = await getUniversalJlptLevel();
        if (univLevel) {
          this.currentSyllabusLevel = univLevel;
        }
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
              <div class="grammar-brand-header" aria-label="Grammar 文法">
                <h1 class="grammar-word-title">
                  <span class="hero-letter">G</span><span class="hero-letter">R</span><span class="hero-letter">A</span><span class="hero-letter">M</span><span class="hero-letter">M</span><span class="hero-letter">A</span><span class="hero-letter">R</span>
                </h1>
                <span class="grammar-word-kanji">
                  <span class="hero-letter">文</span><span class="hero-letter">法</span>
                </span>
              </div>
            </div>
          </div>

          <!-- Visible Error Banner -->
          <div class="grammar-error-banner" id="grammar-error-banner" style="display: none;">
            <span class="error-msg" id="grammar-error-msg"></span>
            <button type="button" class="btn-dismiss-error" id="btn-dismiss-grammar-error" aria-label="Dismiss error">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>

          <!-- Segments: Analyze | Roadmap | Syllabus | Seen -->
          <div class="grammar-top-controls">
            <div class="grammar-segments" role="tablist" aria-label="Grammar sections">
              <button type="button" class="grammar-segment-tab is-active" id="grammar-tab-analyze" data-segment="analyze" role="tab" aria-selected="true">Analyze</button>
              <button type="button" class="grammar-segment-tab" id="grammar-tab-roadmap" data-segment="roadmap" role="tab" aria-selected="false">Roadmap</button>
              <button type="button" class="grammar-segment-tab" id="grammar-tab-syllabus" data-segment="syllabus" role="tab" aria-selected="false">Syllabus</button>
              <button type="button" class="grammar-segment-tab" id="grammar-tab-seen" data-segment="seen" role="tab" aria-selected="false">Seen</button>
            </div>
          </div>

          <!-- Responsive Layout Grid: Left (Analyzer + Visualizer + Syllabus) + Right (Editorial Reference Card + Stats) -->
          <div class="grammar-layout-grid">
            <!-- Left Column: Input + Visualizer + Syllabus Browser -->
            <div class="grammar-col-main">
              <!-- Sentence Analyzer Input Card -->
              <div class="grammar-analyzer-card tactile-card">
                <div class="analyzer-header">
                  <label for="sentence-input" class="grammar-input-label">Enter Japanese Sentence</label>
                  <div class="analyzer-meta">
                    <span id="char-counter" class="char-counter">0 chars</span>
                    <button type="button" id="btn-clear-sentence" class="btn-clear-text" title="Clear text">Clear</button>
                  </div>
                </div>
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
                    <span class="quick-examples-label">Try:</span>
                    <button type="button" class="btn-example-chip" data-example="雨が降っているから、傘を持って行ったほうがいい。">〜ほうがいい (N4)</button>
                    <button type="button" class="btn-example-chip" data-example="いくら高くても、買わなければならない。">〜なければならない (N5)</button>
                    <button type="button" class="btn-example-chip" data-example="彼女は嬉しさのあまり、涙を流した。">〜あまり (N2)</button>
                    <button type="button" class="btn-example-chip" data-example="毎日日本語を勉強しているのに、なかなか上手にならない。">〜のに (N3)</button>
                  </div>
                  <button class="tactile-btn tactile-btn-primary" id="btn-analyze-sentence">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                    </svg>
                    <span>Analyze Sentence</span>
                  </button>
                </div>
              </div>

              <!-- Centerpiece Pitch-Black Sentence Highlight + Diagnostic Token Flow -->
              <div class="grammar-visualizer-card surface-pitch-black tactile-card">
                <div class="visualizer-ambient-glow"></div>
                <div class="visualizer-header-row">
                  <div class="visualizer-header-left">
                    <span class="visualizer-pulse-dot"></span>
                    <span class="visualizer-title">Sentence Structure</span>
                  </div>
                  <button
                    type="button"
                    class="tokens-toggle"
                    id="btn-toggle-tokens"
                    aria-pressed="${this.tokensDiagnosticOpen ? 'true' : 'false'}"
                    aria-controls="tokens-flow"
                  >Tokens</button>
                </div>
                <div class="sentence-highlight" id="sentence-highlight" aria-live="polite">
                  <span class="sentence-highlight-empty">Analyze a sentence to highlight grammar spans.</span>
                </div>
                <div class="tokens-flow-container" id="tokens-flow" ${this.tokensDiagnosticOpen ? '' : 'hidden'}>
                  <div class="empty-tokens text-muted text-sm py-4 text-center" id="tokens-empty-msg">
                    Enter a Japanese sentence above and click "Analyze Sentence" to inspect tokenized structure.
                  </div>
                </div>
              </div>

              <!-- Syllabus Browser by Level -->
              <div class="grammar-syllabus-card tactile-card">
                <div class="visualizer-header-row">
                  <div class="visualizer-header-left">
                    <span class="visualizer-title">JLPT Grammar Syllabus</span>
                  </div>
                  <span class="text-xs text-muted font-mono" id="syllabus-count-label">Loading syllabus...</span>
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
                  <div class="syllabus-filter-actions">
                    <button
                      type="button"
                      class="syllabus-filter-chip ${this.onlySeenInCards ? 'is-active' : ''}"
                      id="syllabus-seen-filter"
                      aria-pressed="${this.onlySeenInCards ? 'true' : 'false'}"
                    >Seen in your cards</button>
                    <input
                      type="text"
                      class="tactile-input syllabus-search-input"
                      id="syllabus-search"
                      placeholder="Search grammar patterns..."
                    />
                  </div>
                </div>
                <div class="syllabus-list" id="syllabus-list">
                  <div class="syllabus-empty-state text-sm text-muted py-4 text-center">Loading syllabus points...</div>
                </div>
              </div>

              <!-- Grammar Roadmap Segment Card -->
              <div class="grammar-roadmap-card tactile-card" id="grammar-roadmap-card" style="display: none;">
                <div class="visualizer-header-row">
                  <div class="visualizer-header-left">
                    <span class="visualizer-title">Grammar Roadmap</span>
                  </div>
                  <span class="text-xs text-muted font-mono" id="roadmap-summary-label">Loading roadmap...</span>
                </div>
                <div class="roadmap-controls-row">
                  <div class="roadmap-mode-pills" id="roadmap-mode-pills" role="tablist" aria-label="Roadmap view mode">
                    <button type="button" class="roadmap-mode-pill is-active" data-roadmap-mode="flow" role="tab" aria-selected="true">Chapter Flow</button>
                    <button type="button" class="roadmap-mode-pill" data-roadmap-mode="hubs" role="tab" aria-selected="false">Conceptual Hubs</button>
                  </div>
                  <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary roadmap-continue-btn font-sans" id="btn-roadmap-continue" title="Continue to next unfinished grammar point">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    <span>Continue next</span>
                  </button>
                  <span class="text-xs text-muted font-sans roadmap-tagline">Tofugu-enriched progression &amp; functional clusters</span>
                </div>
                <div class="roadmap-content" id="roadmap-content">
                  <div class="syllabus-empty-state text-sm text-muted py-6 text-center">Loading grammar roadmap...</div>
                </div>
              </div>

              <!-- Seen in Cards Segment Card -->
              <div class="grammar-seen-card tactile-card" id="grammar-seen-card" style="display: none;">
                <div class="visualizer-header-row">
                  <div class="visualizer-header-left">
                    <span class="visualizer-title">Seen in your cards</span>
                  </div>
                  <span class="text-xs text-muted font-mono" id="seen-count-summary">0 points recorded</span>
                </div>
                <p class="text-sm text-secondary font-sans mb-3">Grammar encounters discovered across your saved Anki cards and study bank, sorted by frequency.</p>
                <div class="seen-encounters-list" id="seen-encounters-list">
                  <div class="text-sm text-muted py-4 text-center">Loading card encounters...</div>
                </div>
              </div>
            </div>

            <!-- Right Column: Editorial Reference Card -->
            <div class="grammar-col-side">
              <!-- Grammar Point Detail Card -->
              <div class="grammar-point-card tactile-card" id="grammar-point-card">
                <div id="detail-placeholder" class="detail-placeholder text-muted text-sm py-8 text-center">
                  Select any grammar token or browse the syllabus below
                </div>
                <div id="detail-content" style="display: none;">
                  <div class="point-top-row">
                    <div class="point-title-group">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="tactile-pill tactile-pill-vermilion font-mono" id="point-jlpt-tag">JLPT --</span>
                        <span class="tactile-pill" id="point-status-tag">NEW</span>
                      </div>
                      <h2 class="point-title font-display" id="point-title">--</h2>
                    </div>

                    <!-- Mastery Status & Practice Action -->
                    <div class="point-action-cluster" style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                      <div class="mastery-status-group" id="mastery-status-group" role="radiogroup" aria-label="Grammar Point Mastery">
                        <button type="button" class="mastery-pill" data-status="new">New</button>
                        <button type="button" class="mastery-pill" data-status="learning">Learning</button>
                        <button type="button" class="mastery-pill" data-status="known">Known</button>
                      </div>
                      <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary font-sans" id="btn-practice-grammar" title="Practice this grammar point">
                        Practice this
                      </button>
                    </div>
                  </div>

                  <!-- Focused detail tabs: Meaning | Formation | Contrasts | Pitfalls | Examples & Encounters -->
                  <div class="point-tabs" role="tablist" aria-label="Grammar point details">
                    <button type="button" class="point-tab is-active" data-tab="meaning" role="tab" aria-selected="true">Meaning</button>
                    <button type="button" class="point-tab" data-tab="formation" role="tab" aria-selected="false" tabindex="-1">Formation</button>
                    <button type="button" class="point-tab" data-tab="contrasts" role="tab" aria-selected="false" tabindex="-1">Nuance Battle</button>
                    <button type="button" class="point-tab" data-tab="pitfalls" role="tab" aria-selected="false" tabindex="-1">Pitfalls</button>
                    <button type="button" class="point-tab" data-tab="examples" role="tab" aria-selected="false" tabindex="-1">Examples</button>
                    <button type="button" class="point-tab" data-tab="cards" role="tab" aria-selected="false" tabindex="-1" style="display: none;">Seen in your cards</button>
                  </div>

                  <!-- Meaning & Mental Model Tab -->
                  <div class="point-panel is-active" data-panel="meaning" role="tabpanel">
                    <!-- Tofugu Big Picture Mental Model Banner -->
                    <div class="tofugu-concept-banner" id="tofugu-concept-banner">
                      <div class="concept-banner-header">
                        <span class="concept-anchor-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                        </span>
                        <span class="concept-banner-tag">Mental Model</span>
                      </div>
                      <p class="concept-banner-text font-serif" id="concept-banner-text">--</p>
                    </div>

                    <div class="point-meaning-box">
                      <div class="flex items-center justify-between mb-2">
                        <h4 class="meaning-label">Explanation</h4>
                        <span class="text-xs text-muted font-mono">Core Nuance</span>
                      </div>
                      <p class="point-meaning" id="point-meaning">--</p>
                      <p class="point-meaning-secondary" id="point-meaning-secondary" hidden></p>
                    </div>

                    <!-- Duolingo-inspired Mastery Status Bar -->
                    <div class="grammar-mastery-progress-card tactile-card" id="grammar-mastery-card">
                      <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2">
                          <span class="mastery-track-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                          </span>
                          <span class="text-xs font-bold text-warm-paper uppercase tracking-wider font-mono">Dual-Track Mastery</span>
                        </div>
                        <span class="text-xs font-mono font-bold text-industrial-aqua" id="mastery-pct-label">0% Mastered</span>
                      </div>
                      <div class="mastery-bar-container">
                        <div class="mastery-bar-fill" id="mastery-bar-fill" style="width: 0%;"></div>
                      </div>
                      <div class="mastery-badges-row mt-2 flex items-center justify-between text-xs text-muted">
                        <span id="seen-track-badge" class="dual-track-badge"><span class="badge-dot"></span> Seen 0x in cards</span>
                        <span id="drill-track-badge" class="dual-track-badge"><span class="badge-dot"></span> 0 drills verified</span>
                      </div>
                    </div>
                  </div>

                  <!-- Formation Rules -->
                  <div class="point-panel" data-panel="formation" role="tabpanel" hidden>
                    <div class="point-formation-box">
                      <div class="flex items-center justify-between mb-2">
                        <h4 class="formation-label">Formation Rules</h4>
                        <span class="text-xs text-muted font-mono">Interactive Formula</span>
                      </div>
                      <div class="formation-list" id="point-formations">
                        <span class="text-sm text-muted">No formation rules listed.</span>
                      </div>
                    </div>
                  </div>

                  <!-- Nuance Battle / Contrasts (Tofugu style vs side-by-side) -->
                  <div class="point-panel" data-panel="contrasts" role="tabpanel" hidden>
                    <div class="point-contrasts-box">
                      <div class="flex items-center justify-between mb-2">
                        <h4 class="contrasts-label">Nuance Battle</h4>
                        <span class="text-xs text-muted font-mono">Side-by-side versus</span>
                      </div>
                      <div class="contrasts-list" id="point-contrasts">
                        <span class="text-sm text-muted">No nuance contrasts available for this pattern.</span>
                      </div>
                    </div>
                  </div>

                  <!-- Common Pitfalls & Traps -->
                  <div class="point-panel" data-panel="pitfalls" role="tabpanel" hidden>
                    <div class="point-pitfalls-box">
                      <div class="flex items-center justify-between mb-2">
                        <h4 class="pitfalls-label">Common Pitfalls & Traps</h4>
                        <span class="text-xs text-muted font-mono">Misconceptions</span>
                      </div>
                      <div class="pitfalls-list" id="point-pitfalls">
                        <span class="text-sm text-muted">No common pitfalls recorded for this pattern.</span>
                      </div>
                    </div>
                  </div>

                  <!-- Curated Example Sentences & Card Encounters -->
                  <div class="point-panel" data-panel="examples" role="tabpanel" hidden>
                    <div class="point-examples-section">
                      <div class="flex items-center justify-between mb-2">
                        <h4 class="examples-label">Curated Examples</h4>
                        <span class="text-xs text-muted font-mono">Context & Ruby</span>
                      </div>
                      <div class="examples-list" id="point-examples">
                        <span class="text-sm text-muted">No example sentences available.</span>
                      </div>
                    </div>

                    <!-- Mined anime context & cards linking -->
                    <div class="point-encounters-section mt-4">
                      <div class="flex items-center justify-between mb-2">
                        <h4 class="encounters-label">Seen in your cards & media</h4>
                        <span class="text-xs text-muted font-mono" id="encounters-count-badge">0 recorded</span>
                      </div>
                      <div class="encounters-list" id="point-encounters">
                        <span class="text-sm text-muted">Select a grammar point to inspect card encounters.</span>
                      </div>
                    </div>
                  </div>

                  <!-- Backwards-compatible cards panel -->
                  <div class="point-panel" data-panel="cards" role="tabpanel" hidden>
                    <div class="point-encounters-section">
                      <div class="flex items-center justify-between mb-2">
                        <h4 class="encounters-label">Seen in your cards</h4>
                        <span class="text-xs text-muted font-mono" id="encounters-count-badge-legacy">0 recorded</span>
                      </div>
                      <div class="encounters-list" id="point-encounters-legacy">
                        <span class="text-sm text-muted">Select a grammar point to inspect card encounters.</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>


            </div>
          </div>

          <!-- Full-Screen Editorial Breakdown View (Continuous Tofugu Reader) -->
          <div class="grammar-full-breakdown-view" id="grammar-full-breakdown-view" style="display: none;">
            <div class="breakdown-reader-container">
              <!-- Top Sticky / Header Bar -->
              <div class="breakdown-nav-bar">
                <button type="button" class="tactile-btn tactile-btn-secondary breakdown-back-btn" id="btn-breakdown-back" aria-label="Back to roadmap">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                  <span>Back to Roadmap</span>
                </button>
                <div class="breakdown-header-actions">
                  <span class="tactile-pill tactile-pill-vermilion font-mono" id="breakdown-jlpt-badge">JLPT --</span>
                  <span class="tactile-pill" id="breakdown-status-tag">NEW</span>
                  <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-secondary" id="btn-breakdown-revise">Revise</button>
                  <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-jade" id="btn-breakdown-mastered">Mastered</button>
                  <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-breakdown-practice">Practice this</button>
                </div>
              </div>

              <!-- Editorial Header: Pattern Display & Meaning -->
              <header class="breakdown-editorial-header">
                <h1 class="breakdown-pattern-title font-display" id="breakdown-pattern-title">--</h1>
                <p class="breakdown-pattern-meaning font-sans" id="breakdown-pattern-meaning">--</p>
              </header>

              <!-- Section 1: Mental Model / Big Picture -->
              <section class="breakdown-section breakdown-section-concept">
                <h3 class="breakdown-section-heading font-sans">
                  <span class="breakdown-heading-num font-mono">01</span>
                  <span>The Big Picture Mental Model</span>
                </h3>
                <div class="breakdown-concept-banner tactile-card" id="breakdown-concept-content">
                  <span class="text-sm text-muted">Loading mental model...</span>
                </div>
              </section>

              <!-- Section 2: Formation Rules -->
              <section class="breakdown-section breakdown-section-formation">
                <h3 class="breakdown-section-heading font-sans">
                  <span class="breakdown-heading-num font-mono">02</span>
                  <span>Formation &amp; Structure Formulas</span>
                </h3>
                <div class="breakdown-formations-list" id="breakdown-formations-content">
                  <span class="text-sm text-muted">Loading formation formulas...</span>
                </div>
              </section>

              <!-- Section 3: Nuance Battles & Contrasts -->
              <section class="breakdown-section breakdown-section-nuance" id="breakdown-section-nuance">
                <h3 class="breakdown-section-heading font-sans">
                  <span class="breakdown-heading-num font-mono">03</span>
                  <span>Nuance Battles &amp; Contrasts</span>
                </h3>
                <div class="breakdown-contrasts-list" id="breakdown-contrasts-content">
                  <span class="text-sm text-muted">No nuance contrasts recorded for this pattern.</span>
                </div>
              </section>

              <!-- Section 4: Common Pitfalls & Traps -->
              <section class="breakdown-section breakdown-section-pitfalls" id="breakdown-section-pitfalls">
                <h3 class="breakdown-section-heading font-sans">
                  <span class="breakdown-heading-num font-mono">04</span>
                  <span>Common Traps &amp; Fixes</span>
                </h3>
                <div class="breakdown-pitfalls-list" id="breakdown-pitfalls-content">
                  <span class="text-sm text-muted">No common pitfalls recorded for this pattern.</span>
                </div>
              </section>

              <!-- Section 5: Natural Example Sentences -->
              <section class="breakdown-section breakdown-section-examples">
                <h3 class="breakdown-section-heading font-sans">
                  <span class="breakdown-heading-num font-mono">05</span>
                  <span>Natural Examples</span>
                </h3>
                <div class="breakdown-examples-list" id="breakdown-examples-content">
                  <span class="text-sm text-muted">Loading example sentences...</span>
                </div>
              </section>

              <!-- Section 6: Seen in your Cards / Encounters -->
              <section class="breakdown-section breakdown-section-encounters">
                <h3 class="breakdown-section-heading font-sans">
                  <span class="breakdown-heading-num font-mono">06</span>
                  <span>Seen in Your Cards &amp; Anime</span>
                </h3>
                <div class="breakdown-encounters-list" id="breakdown-encounters-content">
                  <span class="text-sm text-muted">No card encounters recorded yet.</span>
                </div>
              </section>

              <!-- Bottom return bar -->
              <div class="breakdown-bottom-bar">
                <button type="button" class="tactile-btn tactile-btn-secondary breakdown-back-btn" id="btn-breakdown-back-bottom">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
                  <span>Back to Roadmap</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  setupEvents() {
    // Segments: Analyze | Syllabus | Seen
    const segButtons = this.container?.querySelectorAll('.grammar-segment-tab');
    segButtons?.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectSegment(btn.dataset.segment);
      });
    });

    // Practice button
    const btnPractice = document.getElementById('btn-practice-grammar');
    if (btnPractice) {
      btnPractice.addEventListener('click', () => {
        if (!this.activeGrammarPoint || !this.activeGrammarPoint.pattern_key) return;
        this.router.navigateToTab('study', { query: `pattern_key=${encodeURIComponent(this.activeGrammarPoint.pattern_key)}` });
      });
    }

    const btnAnalyze = document.getElementById('btn-analyze-sentence');
    const inputSentence = document.getElementById('sentence-input');
    const btnDismiss = document.getElementById('btn-dismiss-grammar-error');
    const btnClear = document.getElementById('btn-clear-sentence');
    const charCounter = document.getElementById('char-counter');

    if (btnDismiss) {
      btnDismiss.addEventListener('click', () => this.clearError());
    }

    // Token flow diagnostic toggle (session-persistent)
    const btnTokens = document.getElementById('btn-toggle-tokens');
    if (btnTokens) {
      btnTokens.addEventListener('click', () => {
        this.toggleTokensDiagnostic();
      });
    }
    this.applyTokensDiagnosticState();

    // Focused grammar detail tabs
    this.container.querySelectorAll('.point-tab').forEach((tab) => {
      tab.addEventListener('click', () => this.selectDetailTab(tab.dataset.tab));
      tab.addEventListener('keydown', (event) => {
        const tabs = Array.from(this.container.querySelectorAll('.point-tab'));
        const index = tabs.indexOf(tab);
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const next = event.key === 'ArrowRight'
            ? tabs[(index + 1) % tabs.length]
            : tabs[(index - 1 + tabs.length) % tabs.length];
          this.selectDetailTab(next.dataset.tab, { focus: true });
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          const target = event.key === 'Home' ? tabs[0] : tabs[tabs.length - 1];
          this.selectDetailTab(target.dataset.tab, { focus: true });
        }
      });
    });

    if (inputSentence && charCounter) {
      inputSentence.addEventListener('input', () => {
        charCounter.textContent = `${inputSentence.value.length} chars`;
      });
    }

    if (btnClear && inputSentence) {
      btnClear.addEventListener('click', () => {
        inputSentence.value = '';
        if (charCounter) charCounter.textContent = '0 chars';
        inputSentence.focus();
      });
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
            this.renderAnalyzedSentence(text, result.points, result.tokens);
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
          if (charCounter) {
            charCounter.textContent = `${inputSentence.value.length} chars`;
          }
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
            tag.className = `tactile-pill ${newStatus === 'known' ? 'tactile-pill-jade' : (newStatus === 'learning' ? 'tactile-pill-vermilion' : '')}`;
          }

          masteryPills.forEach((p) => p.classList.toggle('is-active', p.dataset.status === newStatus));
          this.updateSyllabusItemStatus(this.activeGrammarPoint.pattern_key, newStatus);
          this.updateRoadmapChipStatus(this.activeGrammarPoint.pattern_key, newStatus);
          this.loadInitialGrammarStats();
        } catch (err) {
          console.error('[Grammar] Update mastery failed:', err);
          this.showError('Failed to update status: ' + (err.message || 'Network error'));
        }
      });
    });

    // Roadmap mode toggle pills (Chapter Flow / Conceptual Hubs)
    const roadmapModePills = this.container.querySelectorAll('#roadmap-mode-pills .roadmap-mode-pill');
    roadmapModePills.forEach((pill) => {
      pill.addEventListener('click', () => {
        const mode = pill.dataset.roadmapMode;
        if (!mode || mode === this.activeRoadmapMode) return;
        this.activeRoadmapMode = mode;
        roadmapModePills.forEach((p) => {
          const isActive = p.dataset.roadmapMode === mode;
          p.classList.toggle('is-active', isActive);
          p.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        this.renderRoadmap();
      });
    });

    // Continue next button in roadmap toolbar
    const continueBtn = this.container.querySelector('#btn-roadmap-continue');
    if (continueBtn) {
      continueBtn.addEventListener('click', () => this.continueNextRoadmapPoint());
    }

    // Breakdown reader back buttons
    const backBtns = this.container.querySelectorAll('.breakdown-back-btn');
    backBtns.forEach((btn) => {
      btn.addEventListener('click', () => this.closeFullBreakdown());
    });

    // Breakdown revise button
    const reviseBtn = this.container.querySelector('#btn-breakdown-revise');
    if (reviseBtn) {
      reviseBtn.addEventListener('click', () => this.handleBreakdownStatusUpdate('learning'));
    }

    // Breakdown mastered button
    const masteredBtn = this.container.querySelector('#btn-breakdown-mastered');
    if (masteredBtn) {
      masteredBtn.addEventListener('click', () => this.handleBreakdownStatusUpdate('known'));
    }

    // Breakdown practice button
    const practiceBtn = this.container.querySelector('#btn-breakdown-practice');
    if (practiceBtn) {
      practiceBtn.addEventListener('click', () => {
        if (this.activeBreakdownPoint?.pattern_key && this.router && typeof this.router.navigate === 'function') {
          this.router.navigate(`study?grammar=${encodeURIComponent(this.activeBreakdownPoint.pattern_key)}`);
        }
      });
    }

    // ESC key listener for breakdown reader
    if (this.escListener) {
      window.removeEventListener('keydown', this.escListener);
    }
    this.escListener = (e) => {
      if (e.key === 'Escape' && this.isBreakdownOpen) {
        this.closeFullBreakdown();
      }
    };
    window.addEventListener('keydown', this.escListener);

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

    // Seen-in-cards index filter
    const seenFilter = document.getElementById('syllabus-seen-filter');
    if (seenFilter) {
      seenFilter.addEventListener('click', () => {
        this.onlySeenInCards = !this.onlySeenInCards;
        seenFilter.classList.toggle('is-active', this.onlySeenInCards);
        seenFilter.setAttribute('aria-pressed', this.onlySeenInCards ? 'true' : 'false');
        this.loadSyllabus({
          level: this.currentSyllabusLevel,
          search: this.currentSyllabusSearch
        });
      });
    }

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

  toggleTokensDiagnostic(force) {
    this.tokensDiagnosticOpen = typeof force === 'boolean' ? force : !this.tokensDiagnosticOpen;
    writeSessionFlag(TOKENS_DIAGNOSTIC_KEY, this.tokensDiagnosticOpen);
    this.applyTokensDiagnosticState();
  }

  applyTokensDiagnosticState() {
    const flow = document.getElementById('tokens-flow');
    const btn = document.getElementById('btn-toggle-tokens');
    if (flow) flow.hidden = !this.tokensDiagnosticOpen;
    if (btn) {
      btn.classList.toggle('is-active', this.tokensDiagnosticOpen);
      btn.setAttribute('aria-pressed', this.tokensDiagnosticOpen ? 'true' : 'false');
    }
  }

  selectSegment(segment) {
    this.activeSegment = segment;
    const tabAnalyze = document.getElementById('grammar-tab-analyze');
    const tabRoadmap = document.getElementById('grammar-tab-roadmap');
    const tabSyllabus = document.getElementById('grammar-tab-syllabus');
    const tabSeen = document.getElementById('grammar-tab-seen');
    const analyzerCard = this.container?.querySelector('.grammar-analyzer-card');
    const visualizerCard = this.container?.querySelector('.grammar-visualizer-card');
    const roadmapCard = document.getElementById('grammar-roadmap-card');
    const syllabusCard = this.container?.querySelector('.grammar-syllabus-card');
    const seenCard = document.getElementById('grammar-seen-card');

    [tabAnalyze, tabRoadmap, tabSyllabus, tabSeen].forEach((tab) => {
      if (tab) {
        const isActive = tab.dataset.segment === segment;
        tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      }
    });

    if (segment === 'analyze') {
      if (analyzerCard) analyzerCard.style.display = '';
      if (visualizerCard) visualizerCard.style.display = '';
      if (roadmapCard) roadmapCard.style.display = 'none';
      if (syllabusCard) syllabusCard.style.display = 'none';
      if (seenCard) seenCard.style.display = 'none';
    } else if (segment === 'roadmap') {
      if (analyzerCard) analyzerCard.style.display = 'none';
      if (visualizerCard) visualizerCard.style.display = 'none';
      if (roadmapCard) roadmapCard.style.display = '';
      if (syllabusCard) syllabusCard.style.display = 'none';
      if (seenCard) seenCard.style.display = 'none';
      this.loadRoadmap();
    } else if (segment === 'syllabus') {
      if (analyzerCard) analyzerCard.style.display = 'none';
      if (visualizerCard) visualizerCard.style.display = 'none';
      if (roadmapCard) roadmapCard.style.display = 'none';
      if (syllabusCard) syllabusCard.style.display = '';
      if (seenCard) seenCard.style.display = 'none';
    } else if (segment === 'seen') {
      if (analyzerCard) analyzerCard.style.display = 'none';
      if (visualizerCard) visualizerCard.style.display = 'none';
      if (roadmapCard) roadmapCard.style.display = 'none';
      if (syllabusCard) syllabusCard.style.display = 'none';
      if (seenCard) seenCard.style.display = '';
      this.loadSeenEncounters();
    }
  }

  async loadSeenEncounters() {
    const listEl = document.getElementById('seen-encounters-list');
    const summaryEl = document.getElementById('seen-count-summary');
    if (!listEl) return;

    try {
      const data = await apiClient.getGrammarSyllabus({ level: '' });
      const points = Array.isArray(data) ? data : (data.points || data.items || []);
      const seenPoints = points
        .filter((p) => (p.seen_count || 0) > 0)
        .sort((a, b) => (b.seen_count || 0) - (a.seen_count || 0));

      if (summaryEl) summaryEl.textContent = `${seenPoints.length} points recorded`;

      if (seenPoints.length === 0) {
        listEl.innerHTML = '<div class="text-sm text-muted py-6 text-center">No card encounters recorded yet. Save cards containing grammar points to view them here.</div>';
        return;
      }

      listEl.innerHTML = seenPoints.map((p) => `
        <div class="seen-list-item tactile-card" data-key="${escapeHtml(p.pattern_key)}" role="button" tabindex="0">
          <div style="display: flex; align-items: baseline; gap: 0.5rem;">
            <span class="tactile-pill tactile-pill-vermilion text-xs font-mono">${escapeHtml(p.level || 'JLPT')}</span>
            <span class="font-display font-bold text-warm-paper">${escapeHtml(p.pattern_display || p.pattern_key)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span class="text-xs text-muted font-mono">${p.seen_count} encounter${p.seen_count === 1 ? '' : 's'}</span>
            <span class="text-xs text-primary font-sans">View detail &rarr;</span>
          </div>
        </div>
      `).join('');

      listEl.querySelectorAll('.seen-list-item').forEach((item) => {
        item.addEventListener('click', () => {
          const key = item.dataset.key;
          const target = seenPoints.find((p) => p.pattern_key === key);
          if (target) this.displayGrammarDetail(target);
        });
      });
    } catch (err) {
      listEl.innerHTML = `<div class="text-sm text-red py-4 text-center">Failed to load card encounters: ${escapeHtml(err.message)}</div>`;
    }
  }

  renderAnalyzedSentence(sentenceText, points, tokens) {
    const flow = document.getElementById('tokens-flow');
    const highlight = document.getElementById('sentence-highlight');
    const spans = normalizeGrammarSpans(sentenceText, points);
    this.analyzedSpans = spans;

    const segments = buildSentenceSegments(sentenceText, spans);

    if (highlight) {
      highlight.innerHTML = segments.map((seg, i) => {
        if (!seg.isGrammar) {
          return `<span class="sentence-plain">${escapeHtml(seg.text)}</span>`;
        }
        const point = seg.point;
        return `<span
          class="grammar-span"
          role="button"
          tabindex="0"
          data-span-index="${i}"
          title="${escapeHtml(point.meaning_short || point.pattern_display || point.pattern_key)}"
        >${escapeHtml(seg.text)}</span>`;
      }).join('');
    }

    if (!flow) return;

    if (spans.length === 0) {
      flow.innerHTML = `<div class="empty-tokens text-muted text-sm py-4 text-center">No grammar points detected in this sentence.</div>`;
      return;
    }

    if (tokens && Array.isArray(tokens) && tokens.length > 0) {
      flow.innerHTML = tokens.map((t, i) => {
        const isParticle = Boolean(t.pos && (t.pos.includes('助詞') || t.pos.includes('助動詞') || t.pos.includes('particle')));
        const isClause = Boolean(t.pos && (t.pos.includes('接続') || t.pos.includes('clause')));
        const isAqua = isParticle || isClause || t.level === 'N3';
        const levelTag = t.level || '';
        const levelClass = isAqua ? 'token-aqua-badge' : '';
        const chipClass = isAqua ? 'token-chip-particle' : '';

        return `
          <button
            type="button"
            class="grammar-token-chip tactile-card-interactive ${chipClass}"
            data-token-index="${i}"
            data-lemma="${escapeHtml(t.lemma || t.surface || '')}"
            title="${escapeHtml(t.surface)} (${escapeHtml(t.reading || '')}) · ${escapeHtml(t.pos || '')}"
          >
            <span class="token-text font-japanese font-bold">${escapeHtml(t.surface)}</span>
            ${levelTag ? `<span class="token-level-tag tactile-pill text-xs ${levelClass}">${escapeHtml(levelTag)}</span>` : ''}
          </button>
        `;
      }).join('');
    } else {
      flow.innerHTML = segments.map((seg, i) => {
        if (seg.isGrammar) {
          const point = seg.point;
          const level = point.level || 'JLPT';
          return `
            <button
              type="button"
              class="grammar-token-chip tactile-card-interactive"
              data-span-index="${i}"
              data-key="${escapeHtml(point.pattern_key)}"
              title="${escapeHtml(point.meaning_short || point.pattern_display || point.pattern_key)}"
            >
              <span class="token-text font-japanese font-bold">${escapeHtml(seg.text)}</span>
              <span class="token-level-tag tactile-pill text-xs">${escapeHtml(level)}</span>
            </button>
          `;
        }
        return `<span class="plain-token font-japanese text-secondary">${escapeHtml(seg.text)}</span>`;
      }).join('');
    }

    this.bindGrammarSpanSelection(segments);

    if (spans.length > 0) {
      this.displayGrammarDetail(spans[0].point);
      const firstGrammarIndex = segments.findIndex((seg) => seg.isGrammar);
      if (firstGrammarIndex >= 0) this.markSelectedSpan(firstGrammarIndex, segments);
    }
  }

  bindGrammarSpanSelection(segments) {
    const select = (element) => {
      const index = Number(element.dataset.spanIndex);
      const seg = segments[index];
      if (!seg || !seg.isGrammar) return;
      this.markSelectedSpan(index, segments);
      this.displayGrammarDetail(seg.point);
    };

    this.container.querySelectorAll('#sentence-highlight .grammar-span').forEach((span) => {
      span.addEventListener('click', () => select(span));
      span.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select(span);
        }
      });
    });

    this.container.querySelectorAll('#tokens-flow .grammar-token-chip').forEach((chip) => {
      chip.addEventListener('click', () => select(chip));
    });
  }

  markSelectedSpan(index, segments) {
    this.container.querySelectorAll('.grammar-span, .grammar-token-chip').forEach((element) => {
      element.classList.remove('is-selected-span', 'is-selected-token');
    });

    this.container.querySelectorAll(`[data-span-index="${index}"]`).forEach((element) => {
      if (element.classList.contains('grammar-span')) {
        element.classList.add('is-selected-span');
      } else {
        element.classList.add('is-selected-token');
      }
    });

    const seg = segments[index];
    if (seg && seg.isGrammar) {
      this.container.querySelectorAll('#sentence-highlight .grammar-span').forEach((element) => {
        element.classList.toggle('is-active-point', element.dataset.spanIndex === String(index));
      });
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

  async displayGrammarDetail(point) {
    this.activeGrammarPoint = point;

    const placeholder = document.getElementById('detail-placeholder');
    const content = document.getElementById('detail-content');
    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = 'block';

    const jlptTag = document.getElementById('point-jlpt-tag');
    const statusTag = document.getElementById('point-status-tag');
    const title = document.getElementById('point-title');
    const meaning = document.getElementById('point-meaning');
    const meaningSecondary = document.getElementById('point-meaning-secondary');
    const conceptBannerText = document.getElementById('concept-banner-text');
    const formationsBox = document.getElementById('point-formations');
    const contrastsBox = document.getElementById('point-contrasts');
    const pitfallsBox = document.getElementById('point-pitfalls');
    const examplesBox = document.getElementById('point-examples');
    const encountersBox = document.getElementById('point-encounters');
    const encountersBadge = document.getElementById('encounters-count-badge');
    const masteryPctLabel = document.getElementById('mastery-pct-label');
    const masteryBarFill = document.getElementById('mastery-bar-fill');
    const seenTrackBadge = document.getElementById('seen-track-badge');
    const drillTrackBadge = document.getElementById('drill-track-badge');

    if (jlptTag) jlptTag.textContent = point.level ? `JLPT ${point.level}` : 'JLPT';
    const status = point.status || 'new';
    if (statusTag) {
      statusTag.textContent = status.toUpperCase();
      statusTag.className = `tactile-pill ${status === 'known' ? 'tactile-pill-jade' : (status === 'learning' ? 'tactile-pill-vermilion' : '')}`;
    }

    if (title) title.textContent = point.pattern_display || point.pattern_key;

    const shortMeaning = point.meaning_short || '';
    const breakdown = point.english_breakdown || '';
    if (meaning) meaning.textContent = shortMeaning || breakdown || '--';
    if (meaningSecondary) {
      const showBreakdown = breakdown && breakdown !== shortMeaning;
      meaningSecondary.textContent = showBreakdown ? breakdown : '';
      meaningSecondary.hidden = !showBreakdown;
    }
    if (conceptBannerText) {
      conceptBannerText.textContent = point.big_picture_banner || breakdown || shortMeaning || '--';
    }

    this.selectDetailTab(this.activeDetailTab);

    const masteryPills = this.container.querySelectorAll('#mastery-status-group .mastery-pill');
    masteryPills.forEach((pill) => {
      pill.classList.toggle('is-active', pill.dataset.status === status);
    });

    // Attempt to load rich Tofugu Point Mastery Card from API
    let cardData = null;
    try {
      if (point.pattern_key) {
        cardData = await apiClient.getGrammarPointCard(point.pattern_key);
      }
    } catch (err) {
      console.debug('[Grammar] getGrammarPointCard error, fallback to point:', err);
    }

    const activePt = cardData || point;

    // Mental Model Big Picture Banner
    const mentalModel = cardData?.big_picture_banner || point.big_picture_banner || point.english_breakdown || point.meaning_short || '--';
    if (conceptBannerText) {
      conceptBannerText.textContent = mentalModel;
    }

    // Dual-track mastery progress bar (Duolingo style)
    const statusBadges = cardData?.status_badges;
    const masteryPct = statusBadges ? (statusBadges.mastery_pct ?? Math.round(statusBadges.mastery_score || 0)) : (point.status === 'known' ? 100 : (point.status === 'learning' ? 50 : 0));
    const seenCount = statusBadges?.seen_count ?? (point.seen_count || 0);
    const drillCount = statusBadges?.drill_count ?? 0;

    if (masteryPctLabel) {
      masteryPctLabel.textContent = `${masteryPct}% Mastered`;
    }
    if (masteryBarFill) {
      masteryBarFill.style.width = `${Math.min(100, Math.max(0, masteryPct))}%`;
    }
    if (seenTrackBadge) {
      seenTrackBadge.innerHTML = `<span class="badge-dot ${seenCount > 0 ? 'is-active' : ''}"></span> Seen ${seenCount}x in cards`;
    }
    if (drillTrackBadge) {
      drillTrackBadge.innerHTML = `<span class="badge-dot ${drillCount > 0 ? 'is-active' : ''}"></span> ${drillCount} drill${drillCount === 1 ? '' : 's'} verified`;
    }

    // Formations (interactive pills / step formulas with structure + description)
    if (formationsBox) {
      let formations = activePt.formation_rules || point.formation_rules || point.formations || point.formation || [];
      if (typeof formations === 'string') {
        if (formations.includes('·')) {
          formations = formations.split('·').map((s) => ({ structure: s.trim(), description: 'Structure' }));
        } else if (formations.includes('\n')) {
          formations = formations.split('\n').map((s) => ({ structure: s.trim(), description: 'Structure' }));
        } else {
          formations = [{ structure: formations.trim(), description: 'Structure' }];
        }
      }

      if (Array.isArray(formations) && formations.length > 0) {
        formationsBox.innerHTML = formations.map((f) => {
          const struct = typeof f === 'object' ? (f.structure || f.rule || '') : String(f);
          const desc = typeof f === 'object' ? (f.description || '') : '';
          const ex = typeof f === 'object' ? (f.example || '') : '';
          return `
            <div class="formation-item tactile-card surface-pitch-black p-3 mb-2">
              <div class="formation-structure-row flex items-center gap-2 mb-1">
                <span class="formation-bullet"></span>
                <span class="formation-text font-mono font-bold text-industrial-aqua">${escapeHtml(struct)}</span>
              </div>
              ${desc ? `<p class="formation-desc text-secondary text-xs mt-1 font-sans">${escapeHtml(desc)}</p>` : ''}
              ${ex ? `<div class="formation-example-pill mt-2 font-japanese text-xs text-warm-paper">${escapeHtml(ex)}</div>` : ''}
            </div>
          `;
        }).join('');
      } else {
        formationsBox.innerHTML = `<span class="text-sm text-muted">No formation rules listed.</span>`;
      }
    }

    // Nuance Battle / Contrasts (side-by-side or versus cards)
    if (contrastsBox) {
      const contrasts = activePt.nuance_contrasts || [];
      if (Array.isArray(contrasts) && contrasts.length > 0) {
        contrastsBox.innerHTML = contrasts.map((c) => {
          const vsPattern = c.target_pattern || 'Alternative';
          const diff = c.difference || '';
          const whenThis = c.when_to_use_this || '';
          const whenTarget = c.when_to_use_target || '';

          return `
            <div class="contrast-battle-card tactile-card surface-pitch-black p-3 mb-3">
              <div class="contrast-header-row flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <span class="contrast-badge-this font-japanese font-bold text-warm-paper">${escapeHtml(point.pattern_display || point.pattern_key)}</span>
                  <span class="contrast-vs-tag font-mono font-bold">VS</span>
                  <span class="contrast-badge-target font-japanese font-bold text-industrial-aqua">${escapeHtml(vsPattern)}</span>
                </div>
              </div>
              ${diff ? `<p class="contrast-diff-text text-sm text-warm-paper font-sans mb-3">${escapeHtml(diff)}</p>` : ''}
              <div class="contrast-usage-grid">
                <div class="usage-col usage-this">
                  <span class="usage-col-label">When to use ${escapeHtml(point.pattern_display || point.pattern_key)}:</span>
                  <p class="usage-col-text">${escapeHtml(whenThis || '--')}</p>
                </div>
                <div class="usage-col usage-target">
                  <span class="usage-col-label">When to use ${escapeHtml(vsPattern)}:</span>
                  <p class="usage-col-text">${escapeHtml(whenTarget || '--')}</p>
                </div>
              </div>
            </div>
          `;
        }).join('');
      } else {
        contrastsBox.innerHTML = `<span class="text-sm text-muted">No nuance contrasts recorded for this pattern.</span>`;
      }
    }

    // Common Pitfalls & Traps (misconception vs correction)
    if (pitfallsBox) {
      const pitfalls = activePt.common_pitfalls || [];
      if (Array.isArray(pitfalls) && pitfalls.length > 0) {
        pitfallsBox.innerHTML = pitfalls.map((p) => {
          const misc = p.misconception || '';
          const corr = p.correction || '';
          const expl = p.explanation || '';

          return `
            <div class="pitfall-trap-card tactile-card surface-pitch-black p-3 mb-3">
              <div class="pitfall-misconception-row flex items-start gap-2 mb-2">
                <span class="pitfall-tag pitfall-tag-trap font-mono text-xs font-bold uppercase">Trap</span>
                <p class="pitfall-text-trap text-sm text-warm-paper font-sans">${escapeHtml(misc)}</p>
              </div>
              <div class="pitfall-correction-row flex items-start gap-2 mb-2">
                <span class="pitfall-tag pitfall-tag-fix font-mono text-xs font-bold uppercase">Fix</span>
                <p class="pitfall-text-fix text-sm text-jade font-sans font-medium">${escapeHtml(corr)}</p>
              </div>
              ${expl ? `<p class="pitfall-explanation text-xs text-secondary font-sans mt-2">${escapeHtml(expl)}</p>` : ''}
            </div>
          `;
        }).join('');
      } else {
        pitfallsBox.innerHTML = `<span class="text-sm text-muted">No common pitfalls recorded for this pattern.</span>`;
      }
    }

    // Curated Examples with furigana/ruby
    if (examplesBox) {
      let examples = activePt.reference_examples || point.curated_examples || point.examples || [];
      if (typeof examples === 'string') {
        try {
          examples = JSON.parse(examples);
        } catch (e) {
          console.debug('[Grammar] Parse examples JSON error:', e);
          examples = [{ ja: examples }];
        }
      }

      if (Array.isArray(examples) && examples.length > 0) {
        examplesBox.innerHTML = examples.map((ex) => {
          const ja = ex.japanese || ex.ja || ex.sentence || (typeof ex === 'string' ? ex : '');
          const en = ex.english || ex.en || ex.translation || '';
          return `
            <div class="example-item tactile-card surface-pitch-black p-3 mb-2">
              <p class="example-ja font-japanese text-warm-paper font-semibold">${formatExampleJapanese(ja)}</p>
              ${en ? `<p class="example-en text-secondary text-xs mt-1">${escapeHtml(en)}</p>` : ''}
            </div>
          `;
        }).join('');
      } else {
        examplesBox.innerHTML = `<span class="text-sm text-muted">No example sentences available.</span>`;
      }
    }

    // Encounters (grammar seen in user's cards & anime context)
    if (encountersBox) {
      const minedCards = cardData?.encounters?.mined_cards || [];
      const trackerEncounters = cardData?.encounters?.tracker_encounters || [];
      const totalEnc = minedCards.length + trackerEncounters.length;

      if (encountersBadge) {
        encountersBadge.textContent = `${totalEnc} recorded`;
      }

      const legacyBadge = document.getElementById('encounters-count-badge-legacy');
      if (legacyBadge) {
        legacyBadge.textContent = `${totalEnc} recorded`;
      }

      if (totalEnc > 0) {
        const minedHtml = minedCards.map((c) => `
          <div class="encounter-item text-xs text-secondary py-2 border-b border-ink-border">
            <div class="flex items-center justify-between mb-1">
              <span class="encounter-source-badge font-mono text-xs">${escapeHtml(c.source || 'card')}</span>
              ${c.expression ? `<span class="font-japanese text-xs text-industrial-aqua font-bold">${escapeHtml(c.expression)}</span>` : ''}
            </div>
            <p class="font-japanese text-warm-paper font-medium">${formatExampleJapanese(c.sentence || '')}</p>
            ${c.translation ? `<p class="text-muted text-xs mt-0.5">${escapeHtml(c.translation)}</p>` : ''}
          </div>
        `).join('');

        const trackerHtml = trackerEncounters.map((enc) => `
          <div class="encounter-item text-xs text-secondary py-1.5 border-b border-ink-border">
            <span class="font-japanese text-warm-paper font-medium">${formatExampleJapanese(enc.sentence || enc)}</span>
            ${enc.created_at ? `<span class="text-muted ml-2 font-mono">${escapeHtml(enc.created_at.slice(0, 10))}</span>` : ''}
          </div>
        `).join('');

        const combinedHtml = minedHtml + trackerHtml;
        encountersBox.innerHTML = combinedHtml;
        const legacyBox = document.getElementById('point-encounters-legacy');
        if (legacyBox) legacyBox.innerHTML = combinedHtml;
      } else {
        encountersBox.innerHTML = `<span class="text-sm text-muted">No card encounters recorded yet.</span>`;
        const legacyBox = document.getElementById('point-encounters-legacy');
        if (legacyBox) legacyBox.innerHTML = `<span class="text-sm text-muted">No card encounters recorded yet.</span>`;
      }
    }
  }

  selectDetailTab(tab, options = {}) {
    const tabs = ['meaning', 'formation', 'contrasts', 'pitfalls', 'examples', 'cards'];
    const nextTab = tabs.includes(tab) ? tab : 'meaning';
    this.activeDetailTab = nextTab;

    this.container.querySelectorAll('.point-tab').forEach((button) => {
      const active = button.dataset.tab === nextTab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.setAttribute('tabindex', active ? '0' : '-1');
      if (active && options.focus) button.focus();
    });

    this.container.querySelectorAll('.point-panel').forEach((panel) => {
      const active = panel.dataset.panel === nextTab;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
  }

  async loadSyllabus(params = {}) {
    const listContainer = document.getElementById('syllabus-list');
    const countLabel = document.getElementById('syllabus-count-label');
    if (!listContainer) return;

    listContainer.innerHTML = `<div class="syllabus-empty-state text-sm text-muted py-6 text-center">Loading syllabus points...</div>`;

    try {
      const query = {
        level: params.level || '',
        search: params.search || ''
      };
      let points;
      let total;
      if (this.onlySeenInCards) {
        points = await this.fetchSeenSyllabusPoints(query);
        total = points.length;
      } else {
        const result = await apiClient.getGrammarSyllabus({ ...query, limit: 100, offset: 0 });
        points = result?.points || [];
        total = result?.total || points.length;
      }

      if (countLabel) {
        countLabel.textContent = this.onlySeenInCards
          ? `${total} seen points`
          : `${total} points found`;
      }

      if (points.length === 0) {
        const queryText = (params.search || params.level) ? ` matching "${escapeHtml(params.search || params.level)}"` : '';
        const emptyText = this.onlySeenInCards
          ? `No grammar patterns seen in your cards${queryText} yet.`
          : `No grammar patterns found${queryText}.`;
        listContainer.innerHTML = `<div class="syllabus-empty-state text-sm text-muted py-6 text-center">${emptyText}</div>`;
        return;
      }

      listContainer.innerHTML = points.map((pt) => `
        <div class="syllabus-item" data-key="${escapeHtml(pt.pattern_key)}">
          <div class="syllabus-item-main">
            <span class="tactile-pill tactile-pill-vermilion text-xs">${escapeHtml(pt.level || 'JLPT')}</span>
            <span class="syllabus-item-title font-japanese">${escapeHtml(pt.pattern_display || pt.pattern_key)}</span>
            <span class="syllabus-item-meaning">${escapeHtml(pt.meaning_short || pt.english_breakdown || '')}</span>
          </div>
          <span class="tactile-pill text-xs syllabus-status-pill ${pt.status === 'known' ? 'tactile-pill-jade' : (pt.status === 'learning' ? 'tactile-pill-vermilion' : '')}">${escapeHtml((pt.status || 'new').toUpperCase())}</span>
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
      listContainer.innerHTML = `<div class="syllabus-empty-state text-sm text-error py-6 text-center">Failed to load syllabus points.</div>`;
      this.showError('Syllabus error: ' + (err.message || 'Network error'));
    }
  }

  async fetchSeenSyllabusPoints(query) {
    const pageSize = 100;
    const seen = [];
    let offset = 0;
    let total = Infinity;

    while (offset < total && offset < 2000) {
      const page = await apiClient.getGrammarSyllabus({
        ...query,
        limit: pageSize,
        offset
      });
      const pagePoints = page?.points || [];
      total = page?.total ?? pagePoints.length;
      seen.push(...pagePoints.filter((pt) => Number(pt.seen_count) > 0));
      offset += pagePoints.length;
      if (pagePoints.length === 0) break;
    }

    return seen;
  }

  updateSyllabusItemStatus(patternKey, newStatus) {
    const listContainer = document.getElementById('syllabus-list');
    if (!listContainer) return;

    const item = listContainer.querySelector(`[data-key="${patternKey}"]`);
    if (item) {
      const pill = item.querySelector('.syllabus-status-pill');
      if (pill) {
        pill.textContent = newStatus.toUpperCase();
        pill.className = `tactile-pill text-xs syllabus-status-pill ${newStatus === 'known' ? 'tactile-pill-jade' : (newStatus === 'learning' ? 'tactile-pill-vermilion' : '')}`;
      }
    }
  }

  async loadRoadmap(forceRefresh = false) {
    const contentEl = document.getElementById('roadmap-content');
    const summaryEl = document.getElementById('roadmap-summary-label');
    if (!contentEl) return;

    if (!forceRefresh && (this.roadmapFlowData || this.roadmapHubsData)) {
      this.renderRoadmap();
      return;
    }

    if (this.roadmapLoading) return;
    this.roadmapLoading = true;
    contentEl.innerHTML = '<div class="syllabus-empty-state text-sm text-muted py-6 text-center">Loading grammar roadmap...</div>';

    try {
      const results = await Promise.allSettled([
        apiClient.getGrammarRoadmapFlow(),
        apiClient.getGrammarConceptualHubs()
      ]);
      const flowRes = results[0];
      const hubsRes = results[1];

      if (flowRes.status === 'fulfilled') {
        this.roadmapFlowData = flowRes.value || { chapters: [] };
      }
      if (hubsRes.status === 'fulfilled') {
        this.roadmapHubsData = hubsRes.value || { hubs: [] };
      }

      if (flowRes.status === 'rejected' && hubsRes.status === 'rejected') {
        throw new Error('Failed to load roadmap data');
      }
      this.renderRoadmap();
    } catch (err) {
      console.error('[Grammar] Load roadmap failed:', err);
      if (summaryEl) summaryEl.textContent = 'Unavailable';
      contentEl.innerHTML = '<div class="syllabus-empty-state text-sm text-error py-6 text-center">Failed to load grammar roadmap.</div>';
      this.showError('Roadmap error: ' + (err.message || 'Network error'));
    } finally {
      this.roadmapLoading = false;
    }
  }

  renderRoadmap() {
    const contentEl = document.getElementById('roadmap-content');
    const summaryEl = document.getElementById('roadmap-summary-label');
    if (!contentEl) return;

    const isFlow = this.activeRoadmapMode === 'flow';
    const groups = isFlow
      ? (this.roadmapFlowData?.chapters || [])
      : (this.roadmapHubsData?.hubs || []);

    if (groups.length === 0) {
      if (summaryEl) summaryEl.textContent = '0 items';
      contentEl.innerHTML = '<div class="syllabus-empty-state text-sm text-muted py-6 text-center">No roadmap data available yet.</div>';
      return;
    }

    const totalPoints = groups.reduce((acc, g) => acc + (g.stats?.total_points || g.points?.length || 0), 0);
    const masteredPoints = groups.reduce((acc, g) => acc + (g.stats?.mastered_points || 0), 0);
    const encounteredPoints = groups.reduce((acc, g) => acc + (g.stats?.encountered_points || 0), 0);
    if (summaryEl) {
      summaryEl.textContent = `${groups.length} ${isFlow ? 'stages' : 'hubs'} · ${encounteredPoints}/${totalPoints} seen · ${masteredPoints} mastered`;
    }

    const pointMap = new Map();
    const cardsHtml = groups.map((group, idx) => {
      const stats = group.stats || {};
      const pts = group.points || [];
      const total = stats.total_points ?? pts.length;
      const encountered = stats.encountered_points ?? 0;
      const mastered = stats.mastered_points ?? 0;
      const avgMastery = Math.min(100, Math.max(0, Math.round(stats.average_mastery || 0)));
      const badgeLabel = isFlow
        ? `${String(group.order || idx + 1).padStart(2, '0')} · ${group.level_bracket || 'N5'}`
        : (group.icon ? String(group.icon).toUpperCase() : `HUB ${idx + 1}`);
      const descText = isFlow ? (group.subtitle || '') : (group.description || '');

      const chipsHtml = pts.map((pt) => {
        pointMap.set(pt.pattern_key, pt);
        const isMastered = pt.pipeline_status === 'mastered';
        const isEncountered = !isMastered && ((pt.seen_count || 0) > 0 || (pt.drill_count || 0) > 0);
        const stateClass = isMastered ? 'is-mastered' : (isEncountered ? 'is-encountered' : '');
        const selectedClass = this.activeRoadmapKey === pt.pattern_key ? 'is-selected' : '';
        const metaText = isMastered
          ? `${pt.mastery_pct ?? 100}%`
          : ((pt.seen_count || 0) > 0 ? `${pt.seen_count}x` : (pt.level || ''));

        return `
          <button
            type="button"
            class="roadmap-point-chip ${stateClass} ${selectedClass}"
            data-pattern-key="${escapeHtml(pt.pattern_key)}"
            title="${escapeHtml(pt.meaning_short || pt.display || pt.pattern_key)}"
          >
            <span class="roadmap-chip-dot" data-action="cycle-status" title="Click to cycle status" aria-label="Cycle status"></span>
            <span class="roadmap-chip-label font-japanese">${escapeHtml(pt.display || pt.pattern_key)}</span>
            ${metaText ? `<span class="roadmap-chip-meta font-mono">${escapeHtml(metaText)}</span>` : ''}
          </button>
        `;
      }).join('');

      return `
        <div class="roadmap-stage-card">
          <div class="roadmap-stage-header">
            <div class="roadmap-stage-title-group">
              <span class="tactile-pill text-xs font-mono roadmap-stage-badge">${escapeHtml(badgeLabel)}</span>
              <h3 class="roadmap-stage-title">${escapeHtml(group.title || '')}</h3>
            </div>
            <span class="roadmap-stage-metrics font-mono text-xs">${encountered}/${total} seen · ${mastered} mastered · ${avgMastery}%</span>
          </div>
          ${descText ? `<p class="roadmap-stage-desc">${escapeHtml(descText)}</p>` : ''}
          <div class="roadmap-progress-bar" aria-hidden="true">
            <div class="roadmap-progress-fill" style="width: ${avgMastery}%"></div>
          </div>
          <div class="roadmap-chips-grid">
            ${chipsHtml}
          </div>
        </div>
      `;
    }).join('');

    contentEl.innerHTML = `<div class="roadmap-stages-list">${cardsHtml}</div>`;

    contentEl.querySelectorAll('.roadmap-point-chip').forEach((chip) => {
      const key = chip.dataset.patternKey;
      const pt = pointMap.get(key);
      if (!pt) return;

      const dot = chip.querySelector('.roadmap-chip-dot');
      if (dot) {
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          this.cycleChipStatus(chip, pt);
        });
      }

      chip.addEventListener('click', () => {
        this.activeRoadmapKey = key;
        contentEl.querySelectorAll('.roadmap-point-chip').forEach((c) => {
          c.classList.toggle('is-selected', c.dataset.patternKey === key);
        });
        this.openFullBreakdown(key, pt);
      });
    });
  }

  async cycleChipStatus(chipEl, pt) {
    if (!chipEl || !pt) return;
    const key = pt.pattern_key;

    let currentStatus = 'new';
    if (chipEl.classList.contains('is-mastered') || pt.pipeline_status === 'mastered') {
      currentStatus = 'known';
    } else if (chipEl.classList.contains('is-encountered') || (pt.seen_count || 0) > 0 || pt.status === 'learning') {
      currentStatus = 'learning';
    }

    const nextStatus = currentStatus === 'new'
      ? 'learning'
      : (currentStatus === 'learning' ? 'known' : 'new');

    const prevClass = chipEl.className;
    const metaEl = chipEl.querySelector('.roadmap-chip-meta');
    const prevMeta = metaEl ? metaEl.textContent : '';
    const prevPtState = {
      pipeline_status: pt.pipeline_status,
      seen_count: pt.seen_count,
      mastery_score: pt.mastery_score,
      mastery_pct: pt.mastery_pct,
      status: pt.status
    };

    this.applyStatusToChip(chipEl, pt, nextStatus);
    const stageCard = chipEl.closest('.roadmap-stage-card');
    if (stageCard) this.updateStageStatsInDom(stageCard);

    try {
      await apiClient.updateGrammarPoint(key, { status: nextStatus });
      if (this.activeGrammarPoint && this.activeGrammarPoint.pattern_key === key) {
        this.activeGrammarPoint.status = nextStatus;
        const statusTag = document.getElementById('point-status-tag');
        if (statusTag) {
          statusTag.textContent = nextStatus.toUpperCase();
          statusTag.className = `tactile-pill ${nextStatus === 'known' ? 'tactile-pill-jade' : (nextStatus === 'learning' ? 'tactile-pill-vermilion' : '')}`;
        }
        const masteryPills = this.container.querySelectorAll('#mastery-status-group .mastery-pill');
        masteryPills.forEach((p) => p.classList.toggle('is-active', p.dataset.status === nextStatus));
      }
    } catch (err) {
      console.error('[Grammar] cycleChipStatus network error:', err);
      chipEl.className = prevClass;
      if (metaEl) metaEl.textContent = prevMeta;
      Object.assign(pt, prevPtState);
      if (stageCard) this.updateStageStatsInDom(stageCard);

      chipEl.classList.add('is-save-failed');
      setTimeout(() => chipEl.classList.remove('is-save-failed'), 1200);

      this.showError(`Failed to update '${key}': ${err.message || 'Network error'}`);
    }
  }

  applyStatusToChip(chipEl, pt, status) {
    const metaEl = chipEl.querySelector('.roadmap-chip-meta');
    if (status === 'known') {
      chipEl.classList.remove('is-encountered');
      chipEl.classList.add('is-mastered');
      pt.pipeline_status = 'mastered';
      pt.status = 'known';
      pt.seen_count = Math.max(1, pt.seen_count || 1);
      pt.mastery_score = 100.0;
      pt.mastery_pct = 100;
      if (metaEl) metaEl.textContent = '100%';
    } else if (status === 'learning') {
      chipEl.classList.remove('is-mastered');
      chipEl.classList.add('is-encountered');
      pt.pipeline_status = 'encountered';
      pt.status = 'learning';
      pt.seen_count = Math.max(1, pt.seen_count || 1);
      pt.mastery_score = 50.0;
      pt.mastery_pct = 50;
      if (metaEl) metaEl.textContent = `${pt.seen_count}x`;
    } else {
      chipEl.classList.remove('is-mastered', 'is-encountered');
      pt.pipeline_status = 'unseen';
      pt.status = 'new';
      pt.seen_count = 0;
      pt.mastery_score = 0.0;
      pt.mastery_pct = 0;
      if (metaEl) metaEl.textContent = pt.level || 'N5';
    }
  }

  updateStageStatsInDom(stageCard) {
    if (!stageCard) return;
    const chips = stageCard.querySelectorAll('.roadmap-point-chip');
    const total = chips.length;
    let encountered = 0;
    let mastered = 0;
    let totalScore = 0;

    chips.forEach((c) => {
      if (c.classList.contains('is-mastered')) {
        mastered++;
        encountered++;
        totalScore += 100;
      } else if (c.classList.contains('is-encountered')) {
        encountered++;
        totalScore += 50;
      }
    });

    const avgMastery = total > 0 ? Math.min(100, Math.max(0, Math.round(totalScore / total))) : 0;
    const metricsEl = stageCard.querySelector('.roadmap-stage-metrics');
    if (metricsEl) {
      metricsEl.textContent = `${encountered}/${total} seen · ${mastered} mastered · ${avgMastery}%`;
    }
    const fillEl = stageCard.querySelector('.roadmap-progress-fill');
    if (fillEl) {
      fillEl.style.width = `${avgMastery}%`;
    }
    this.updateTotalSummaryInDom();
  }

  updateTotalSummaryInDom() {
    const summaryEl = document.getElementById('roadmap-summary-label');
    const stageCards = this.container.querySelectorAll('.roadmap-stage-card');
    if (!summaryEl || stageCards.length === 0) return;

    const isFlow = this.activeRoadmapMode === 'flow';
    let totalPoints = 0;
    let encounteredPoints = 0;
    let masteredPoints = 0;

    stageCards.forEach((sc) => {
      const chips = sc.querySelectorAll('.roadmap-point-chip');
      totalPoints += chips.length;
      chips.forEach((c) => {
        if (c.classList.contains('is-mastered')) {
          masteredPoints++;
          encounteredPoints++;
        } else if (c.classList.contains('is-encountered')) {
          encounteredPoints++;
        }
      });
    });

    summaryEl.textContent = `${stageCards.length} ${isFlow ? 'stages' : 'hubs'} · ${encounteredPoints}/${totalPoints} seen · ${masteredPoints} mastered`;
  }

  updateRoadmapChipStatus(patternKey, newStatus) {
    if (!this.container) return;
    const chips = this.container.querySelectorAll(`.roadmap-point-chip[data-pattern-key="${patternKey}"]`);
    chips.forEach((chip) => {
      let matchedPt = null;
      const groups = (this.roadmapFlowData?.chapters || []).concat(this.roadmapHubsData?.hubs || []);
      for (const g of groups) {
        if (Array.isArray(g.points)) {
          const found = g.points.find((p) => p.pattern_key === patternKey);
          if (found) {
            matchedPt = found;
            break;
          }
        }
      }
      const ptObj = matchedPt || { pattern_key: patternKey };
      this.applyStatusToChip(chip, ptObj, newStatus);
      const stageCard = chip.closest('.roadmap-stage-card');
      if (stageCard) {
        this.updateStageStatsInDom(stageCard);
      }
    });
  }

  continueNextRoadmapPoint() {
    const isFlow = this.activeRoadmapMode === 'flow';
    const groups = isFlow
      ? (this.roadmapFlowData?.chapters || [])
      : (this.roadmapHubsData?.hubs || []);

    const allPoints = [];
    for (const g of groups) {
      if (Array.isArray(g.points)) {
        for (const pt of g.points) {
          allPoints.push(pt);
        }
      }
    }

    if (allPoints.length === 0) return;

    const inLearning = allPoints.find((p) => p.pipeline_status !== 'mastered' && (p.status === 'learning' || (p.seen_count || 0) > 0));
    const nextUnfinished = inLearning || allPoints.find((p) => p.pipeline_status !== 'mastered' && p.status !== 'known') || allPoints[0];

    if (nextUnfinished) {
      const chipEl = this.container.querySelector(`.roadmap-point-chip[data-pattern-key="${nextUnfinished.pattern_key}"]`);
      if (chipEl) {
        chipEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      this.openFullBreakdown(nextUnfinished.pattern_key, nextUnfinished);
    }
  }

  async openFullBreakdown(patternKey, initialPt = null) {
    const layoutGrid = this.container.querySelector('.grammar-layout-grid');
    const topControls = this.container.querySelector('.grammar-top-controls');
    const breakdownView = this.container.querySelector('#grammar-full-breakdown-view');
    if (!breakdownView) return;

    this.lastRoadmapScrollY = window.scrollY || document.documentElement.scrollTop;
    this.isBreakdownOpen = true;

    if (layoutGrid) layoutGrid.style.display = 'none';
    if (topControls) topControls.style.display = 'none';
    breakdownView.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'instant' });

    const titleEl = breakdownView.querySelector('#breakdown-pattern-title');
    const meaningEl = breakdownView.querySelector('#breakdown-pattern-meaning');
    const jlptBadge = breakdownView.querySelector('#breakdown-jlpt-badge');

    const display = initialPt?.display || patternKey;
    const level = initialPt?.level || 'N5';
    const meaning = initialPt?.meaning_short || '';
    const status = initialPt?.pipeline_status === 'mastered' ? 'known' : ((initialPt?.seen_count || 0) > 0 ? 'learning' : 'new');

    if (titleEl) titleEl.textContent = display;
    if (meaningEl) meaningEl.textContent = meaning || '--';
    if (jlptBadge) jlptBadge.textContent = `JLPT ${level}`;
    this.updateBreakdownStatusUi(status);

    this.activeBreakdownPoint = { pattern_key: patternKey, level, display, status };

    try {
      const cardData = await apiClient.getGrammarPointCard(patternKey);
      this.renderBreakdownContent(cardData || initialPt || { pattern_key: patternKey });
    } catch (err) {
      console.error('[Grammar] Load point mastery card error:', err);
      this.renderBreakdownContent(initialPt || { pattern_key: patternKey });
    }
  }

  closeFullBreakdown() {
    const layoutGrid = this.container.querySelector('.grammar-layout-grid');
    const topControls = this.container.querySelector('.grammar-top-controls');
    const breakdownView = this.container.querySelector('#grammar-full-breakdown-view');
    if (!breakdownView) return;

    breakdownView.style.display = 'none';
    if (layoutGrid) layoutGrid.style.display = 'grid';
    if (topControls) topControls.style.display = 'block';
    this.isBreakdownOpen = false;

    if (typeof this.lastRoadmapScrollY === 'number') {
      window.scrollTo({ top: this.lastRoadmapScrollY, behavior: 'instant' });
    }
  }

  updateBreakdownStatusUi(status) {
    const breakdownView = this.container.querySelector('#grammar-full-breakdown-view');
    if (!breakdownView) return;

    const statusTag = breakdownView.querySelector('#breakdown-status-tag');
    if (statusTag) {
      statusTag.textContent = status.toUpperCase();
      statusTag.className = `tactile-pill ${status === 'known' ? 'tactile-pill-jade' : (status === 'learning' ? 'tactile-pill-vermilion' : '')}`;
    }

    const reviseBtn = breakdownView.querySelector('#btn-breakdown-revise');
    const masteredBtn = breakdownView.querySelector('#btn-breakdown-mastered');
    if (reviseBtn) {
      reviseBtn.classList.toggle('is-active', status === 'learning');
    }
    if (masteredBtn) {
      masteredBtn.classList.toggle('is-active', status === 'known');
    }
  }

  async handleBreakdownStatusUpdate(newStatus) {
    if (!this.activeBreakdownPoint?.pattern_key) return;
    const key = this.activeBreakdownPoint.pattern_key;
    try {
      this.updateBreakdownStatusUi(newStatus);
      await apiClient.updateGrammarPoint(key, { status: newStatus });
      this.activeBreakdownPoint.status = newStatus;
      this.updateRoadmapChipStatus(key, newStatus);
    } catch (err) {
      console.error('[Grammar] Breakdown status update error:', err);
      this.showError(`Failed to update status: ${err.message || 'Network error'}`);
    }
  }

  renderBreakdownContent(cardData) {
    const breakdownView = this.container.querySelector('#grammar-full-breakdown-view');
    if (!breakdownView || !cardData) return;

    const titleEl = breakdownView.querySelector('#breakdown-pattern-title');
    const meaningEl = breakdownView.querySelector('#breakdown-pattern-meaning');
    const jlptBadge = breakdownView.querySelector('#breakdown-jlpt-badge');

    if (titleEl && cardData.display) titleEl.textContent = cardData.display;
    if (meaningEl && cardData.meaning_short) meaningEl.textContent = cardData.meaning_short;
    if (jlptBadge && cardData.level) jlptBadge.textContent = `JLPT ${cardData.level}`;

    // Section 1: Concept Banner
    const conceptBox = breakdownView.querySelector('#breakdown-concept-content');
    if (conceptBox) {
      const bannerText = cardData.big_picture_banner || cardData.english_breakdown || cardData.meaning_short || 'Standard grammar pattern';
      conceptBox.textContent = bannerText;
    }

    // Section 2: Formation Rules
    const formationsBox = breakdownView.querySelector('#breakdown-formations-content');
    if (formationsBox) {
      let formations = cardData.formation_rules || cardData.formations || cardData.formation || [];
      if (typeof formations === 'string') {
        formations = [{ structure: formations.trim(), description: 'Structure' }];
      }
      if (Array.isArray(formations) && formations.length > 0) {
        formationsBox.innerHTML = formations.map((f) => {
          const struct = typeof f === 'object' ? (f.structure || f.rule || '') : String(f);
          const desc = typeof f === 'object' ? (f.description || '') : '';
          const ex = typeof f === 'object' ? (f.example || '') : '';
          return `
            <div class="formation-item tactile-card surface-pitch-black p-3 mb-2">
              <div class="formation-structure-row flex items-center gap-2 mb-1">
                <span class="formation-bullet"></span>
                <span class="formation-text font-mono font-bold text-industrial-aqua">${escapeHtml(struct)}</span>
              </div>
              ${desc ? `<p class="formation-desc text-secondary text-xs mt-1 font-sans">${escapeHtml(desc)}</p>` : ''}
              ${ex ? `<div class="formation-example-pill mt-2 font-japanese text-xs text-warm-paper">${escapeHtml(ex)}</div>` : ''}
            </div>
          `;
        }).join('');
      } else {
        formationsBox.innerHTML = '<span class="text-sm text-muted">No formation rules listed.</span>';
      }
    }

    // Section 3: Nuance Contrasts
    const contrastsBox = breakdownView.querySelector('#breakdown-contrasts-content');
    if (contrastsBox) {
      const contrasts = cardData.nuance_contrasts || [];
      if (Array.isArray(contrasts) && contrasts.length > 0) {
        contrastsBox.innerHTML = contrasts.map((c) => {
          const vsPattern = c.target_pattern || 'Alternative';
          const diff = c.difference || '';
          const whenThis = c.when_to_use_this || '';
          const whenTarget = c.when_to_use_target || '';
          return `
            <div class="contrast-battle-card tactile-card surface-pitch-black p-3 mb-3">
              <div class="contrast-header-row flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <span class="contrast-badge-this font-japanese font-bold text-warm-paper">${escapeHtml(cardData.display || cardData.pattern_key)}</span>
                  <span class="contrast-vs-tag font-mono font-bold">VS</span>
                  <span class="contrast-badge-target font-japanese font-bold text-industrial-aqua">${escapeHtml(vsPattern)}</span>
                </div>
              </div>
              ${diff ? `<p class="contrast-diff-text text-sm text-warm-paper font-sans mb-3">${escapeHtml(diff)}</p>` : ''}
              <div class="contrast-usage-grid">
                <div class="usage-col usage-this">
                  <span class="usage-col-label">When to use ${escapeHtml(cardData.display || cardData.pattern_key)}:</span>
                  <p class="usage-col-text">${escapeHtml(whenThis || '--')}</p>
                </div>
                <div class="usage-col usage-target">
                  <span class="usage-col-label">When to use ${escapeHtml(vsPattern)}:</span>
                  <p class="usage-col-text">${escapeHtml(whenTarget || '--')}</p>
                </div>
              </div>
            </div>
          `;
        }).join('');
      } else {
        contrastsBox.innerHTML = '<span class="text-sm text-muted">No nuance contrasts recorded for this pattern.</span>';
      }
    }

    // Section 4: Pitfalls
    const pitfallsBox = breakdownView.querySelector('#breakdown-pitfalls-content');
    if (pitfallsBox) {
      const pitfalls = cardData.common_pitfalls || [];
      if (Array.isArray(pitfalls) && pitfalls.length > 0) {
        pitfallsBox.innerHTML = pitfalls.map((p) => {
          const misc = p.misconception || '';
          const corr = p.correction || '';
          const expl = p.explanation || '';
          return `
            <div class="pitfall-trap-card tactile-card surface-pitch-black p-3 mb-3">
              <div class="pitfall-misconception-row flex items-start gap-2 mb-2">
                <span class="pitfall-tag pitfall-tag-trap font-mono text-xs font-bold uppercase">Trap</span>
                <p class="pitfall-text-trap text-sm text-warm-paper font-sans">${escapeHtml(misc)}</p>
              </div>
              <div class="pitfall-correction-row flex items-start gap-2 mb-2">
                <span class="pitfall-tag pitfall-tag-fix font-mono text-xs font-bold uppercase">Fix</span>
                <p class="pitfall-text-fix text-sm text-jade font-sans font-medium">${escapeHtml(corr)}</p>
              </div>
              ${expl ? `<p class="pitfall-explanation text-xs text-secondary font-sans mt-2">${escapeHtml(expl)}</p>` : ''}
            </div>
          `;
        }).join('');
      } else {
        pitfallsBox.innerHTML = '<span class="text-sm text-muted">No common pitfalls recorded for this pattern.</span>';
      }
    }

    // Section 5: Examples
    const examplesBox = breakdownView.querySelector('#breakdown-examples-content');
    if (examplesBox) {
      let examples = cardData.reference_examples || cardData.examples || [];
      if (typeof examples === 'string') {
        try {
          examples = JSON.parse(examples);
        } catch (e) {
          examples = [{ ja: examples }];
        }
      }
      if (Array.isArray(examples) && examples.length > 0) {
        examplesBox.innerHTML = examples.map((ex) => {
          const ja = ex.japanese || ex.ja || ex.sentence || (typeof ex === 'string' ? ex : '');
          const en = ex.english || ex.en || ex.translation || '';
          return `
            <div class="example-item tactile-card surface-pitch-black p-3 mb-2">
              <p class="example-ja font-japanese text-warm-paper font-semibold">${formatExampleJapanese(ja)}</p>
              ${en ? `<p class="example-en text-secondary text-xs mt-1 font-sans">${escapeHtml(en)}</p>` : ''}
            </div>
          `;
        }).join('');
      } else {
        examplesBox.innerHTML = '<span class="text-sm text-muted">No example sentences available.</span>';
      }
    }

    // Section 6: Encounters
    const encountersBox = breakdownView.querySelector('#breakdown-encounters-content');
    if (encountersBox) {
      const minedCards = cardData?.encounters?.mined_cards || [];
      const trackerEncounters = cardData?.encounters?.tracker_encounters || [];
      const totalEnc = minedCards.length + trackerEncounters.length;

      if (totalEnc > 0) {
        const minedHtml = minedCards.map((c) => `
          <div class="encounter-item text-xs text-secondary py-2 border-b border-ink-border">
            <div class="flex items-center justify-between mb-1">
              <span class="encounter-source-badge font-mono text-xs">${escapeHtml(c.source || 'card')}</span>
              ${c.expression ? `<span class="font-japanese text-xs text-industrial-aqua font-bold">${escapeHtml(c.expression)}</span>` : ''}
            </div>
            <p class="font-japanese text-warm-paper font-medium">${formatExampleJapanese(c.sentence || '')}</p>
            ${c.translation ? `<p class="text-muted text-xs mt-0.5">${escapeHtml(c.translation)}</p>` : ''}
          </div>
        `).join('');

        const trackerHtml = trackerEncounters.map((enc) => `
          <div class="encounter-item text-xs text-secondary py-1.5 border-b border-ink-border">
            <span class="font-japanese text-warm-paper font-medium">${formatExampleJapanese(enc.sentence || enc)}</span>
            ${enc.created_at ? `<span class="text-muted ml-2 font-mono">${escapeHtml(enc.created_at.slice(0, 10))}</span>` : ''}
          </div>
        `).join('');

        encountersBox.innerHTML = minedHtml + trackerHtml;
      } else {
        encountersBox.innerHTML = '<span class="text-sm text-muted">No card encounters recorded yet.</span>';
      }
    }
  }

  async loadInitialGrammarStats() {
    // Distribution stats card removed
  }

  unmount() {
    this.analyzedSpans = [];
    if (this.escListener) {
      window.removeEventListener('keydown', this.escListener);
      this.escListener = null;
    }
    this.isBreakdownOpen = false;
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

const TOKENS_DIAGNOSTIC_KEY = 'grammar.tokensDiagnosticOpen';

function readSessionFlag(key) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return false;
    return window.sessionStorage.getItem(key) === 'true';
  } catch (err) {
    console.debug('[Grammar] Read session flag error:', err);
    return false;
  }
}

function writeSessionFlag(key, value) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    window.sessionStorage.setItem(key, value ? 'true' : 'false');
  } catch (err) {
    console.debug('[Grammar] Write session flag error:', err);
  }
}

function normalizeGrammarSpans(sentenceText, points) {
  if (!Array.isArray(points) || points.length === 0) return [];

  const candidates = points.map((point) => {
    const display = point.text || point.pattern_display || point.pattern_key || '';
    const fallbackStart = Number.isInteger(point.position) ? point.position : sentenceText.indexOf(display);
    const start = Number.isInteger(point.start) ? point.start : fallbackStart;
    if (start < 0 || start >= sentenceText.length) return null;

    let end = Number.isInteger(point.end) ? point.end : start + display.length;
    if (end <= start) end = start + Math.max(display.length, 1);
    end = Math.min(end, sentenceText.length);
    if (end <= start) return null;

    return {
      point,
      start,
      end,
      text: point.text || sentenceText.slice(start, end)
    };
  }).filter(Boolean);

  candidates.sort((a, b) => a.start - b.start || b.end - a.end);

  const spans = [];
  let cursor = 0;
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue;
    spans.push(candidate);
    cursor = candidate.end;
  }
  return spans;
}

function buildSentenceSegments(sentenceText, spans) {
  const segments = [];
  let lastIndex = 0;

  for (const span of spans) {
    if (span.start > lastIndex) {
      segments.push({ text: sentenceText.slice(lastIndex, span.start), isGrammar: false });
    }
    segments.push({
      text: sentenceText.slice(span.start, span.end),
      isGrammar: true,
      point: span.point
    });
    lastIndex = span.end;
  }

  if (lastIndex < sentenceText.length) {
    segments.push({ text: sentenceText.slice(lastIndex), isGrammar: false });
  }

  return segments;
}

function formatExampleJapanese(raw) {
  if (!raw) return '';
  let html = String(raw);
  // Convert [kanji|reading] or kanji[reading] to <ruby>kanji<rt>reading</rt></ruby>
  if (!html.includes('<ruby')) {
    html = html.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '<ruby>$1<rt>$2</rt></ruby>');
    html = html.replace(/([\u4e00-\u9faf\u3400-\u4dbf]+)\[([^\s\]]+)\]/g, '<ruby>$1<rt>$2</rt></ruby>');
  }
  return sanitizePromptMarkup(html);
}
