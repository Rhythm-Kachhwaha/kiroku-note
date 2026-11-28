/**
 * Kiroku Note Desktop — Study Practice Drill Engine View Controller
 * Practice drill lifecycle backed by live study.db question bank,
 * objective deterministic grading, pedagogical explanation, adaptive
 * repetition difficulty rating (Easy/Normal/Hard), universal JLPT level sync,
 * setup chooser with live question bank count, and honest diagnostic reports.
 */

import { apiClient } from '../services/api_client.js';
import { studyClient } from '../services/study_client.js';
import { renderStudyImport } from './study_import.js';
import {
  renderBurstCompleteState,
  renderBurstEmptyState,
  renderScrambleDrill,
  renderShadowingDrill,
  renderShadowingRevealSection,
  renderStudyModeCards,
  renderWeeklyConsistencyBar,
  resolveBurstMediaUrl
} from './study_bursts.js';
import { escapeHtml, renderStudyText, sanitizePromptMarkup } from '../utils/sanitizer.js';
import { renderAssetSlot } from '../assets_map.js';
import { getUniversalJlptLevel } from '../utils/learner.js';
import {
  clearStoredSession,
  decideSessionRecovery,
  readStoredSession,
  writeStoredSession
} from '../utils/session_recovery.js';
import { getEligibleQuestionCount } from '../utils/practice_setup.js';
import {
  formatDuration,
  formatMetricLabel,
  formatPercent,
  getProgressMetrics,
  hasProgressHistory
} from '../utils/progress_formatters.js';
import { StudySessionStore } from '../utils/study_session_store.js';

export const STUDY_SEGMENTS = [
  { id: 'practice', label: 'Practice' },
  { id: 'bank', label: 'Bank' },
  { id: 'mistakes', label: 'Mistakes' },
  { id: 'progress', label: 'Progress' }
];

export function formatQuestionType(code) {
  if (!code) return 'Objective';
  const MAP = {
    kanji_reading: 'Kanji Reading',
    orthography_writing: 'Orthography (Writing)',
    word_formation: 'Word Formation',
    context_defined_expressions: 'Context Defined Expressions',
    contextual_expressions: 'Contextual Expressions',
    paraphrase_expressions: 'Paraphrase Expressions',
    usage_in_context: 'Usage in Context',
    grammar_sentence_form: 'Sentence Grammar',
    sentence_composition_star: 'Sentence Composition (Star)',
    sentence_composition: 'Sentence Composition',
    text_grammar: 'Text Grammar',
    short_passage: 'Short Passage Reading',
    medium_passage: 'Medium Passage Reading',
    integrated_comprehension: 'Integrated Comprehension',
    thematic_comprehension: 'Thematic Comprehension',
    information_retrieval: 'Information Retrieval',
    task_based_comprehension: 'Task-Based Comprehension',
    key_point_comprehension: 'Key Point Comprehension',
    summary_comprehension: 'Summary Comprehension',
    quick_response: 'Quick Response',
    integrated_listening: 'Integrated Listening',
    sentence_scramble: 'Sentence Scramble',
    audio_shadowing: 'Audio Shadowing',
    vocab: 'Vocabulary',
    grammar: 'Grammar',
    reading: 'Reading',
    listening: 'Listening'
  };
  if (MAP[code]) return MAP[code];
  return String(code)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function filterMistakes(items, { level = '', format = '', format_code: formatCode = '' } = {}) {
  return (Array.isArray(items) ? items : []).filter((item) => (
    (!level || item.level === level) &&
    (!(format || formatCode) || item.format_code === (format || formatCode))
  ));
}

export function filterBankQuestions(items, { level = '', format = '', status = '' } = {}) {
  return (Array.isArray(items) ? items : []).filter((item) => (
    (!level || item.level === level) &&
    (!format || item.format_code === format) &&
    (!status || item.verification_status === status)
  ));
}

export function getBankPage(items, page = 1, pageSize = 20) {
  const safePageSize = Math.max(1, Number(pageSize) || 20);
  const safePage = Math.max(1, Number(page) || 1);
  const total = Array.isArray(items) ? items.length : 0;
  const pageCount = Math.max(1, Math.ceil(total / safePageSize));
  const currentPage = Math.min(safePage, pageCount);
  const start = (currentPage - 1) * safePageSize;
  return {
    items: (Array.isArray(items) ? items : []).slice(start, start + safePageSize),
    page: currentPage,
    pageCount,
    total
  };
}

function extractPassageContent(item) {
  if (!item) return null;
  if (item.group_context && Array.isArray(item.group_context.parts) && item.group_context.parts.length > 0) {
    return item.group_context.parts
      .map(p => (p.title ? `${escapeHtml(p.title)}\n` : '') + renderStudyText(p, 'markup', 'text_html'))
      .join('\n\n');
  }
  if (typeof item.group_context === 'string') return escapeHtml(item.group_context);
  return item.group_text || item.passage_text ? escapeHtml(item.group_text || item.passage_text) : null;
}

export class StudyView {
  constructor(router) {
    this.router = router;
    this.keepAlive = true;
    this.activeListenerCount = 0;
    this.container = null;
    this.sessionId = null;
    this.sessionStore = null;
    this.practiceItems = [];
    this.currentQuestionIndex = 0;
    this.hasAnswered = false;
    this.activeLevel = 'N4';
    this.selectedCount = 10;
    this.selectedSessionType = 'practice';
    this.selectedCategory = 'all';
    this.selectedFormatCode = 'all';
    this.elapsedSeconds = 0;
    this.timerInterval = null;
    this.questionStartTime = 0;
    this.sessionSummary = { correct: 0, total: 0 };
    this.isLoading = false;
    this.activeBlobUrls = [];
    this.cachedBankSummary = null;
    this.activeSegment = 'practice';
    this.segmentMounted = { practice: false, bank: false, mistakes: false, progress: false };
    this.bankFilters = { level: '', format: '', status: '', bookmarked: false };
    this.bankPage = 1;
    this.mistakesFilters = { level: '', format_code: '' };
    this.bookmarkedOnly = false;
    this.reportQuestionId = null;
    this.burstSizes = { sentence_scramble: 5, audio_shadowing: 5 };
    this.showJlptSetup = false;
    this.cachedConsistency = null;
    this.backendInfo = null;
    this.activeBurst = null;
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  segmentArea(segment = this.activeSegment) {
    const id = segment === 'practice' ? 'study-content-area' : `study-segment-${segment}`;
    return document.getElementById(id);
  }

  switchSegment(segment) {
    const target = STUDY_SEGMENTS.some((entry) => entry.id === segment) ? segment : 'practice';
    if (target === this.activeSegment && this.segmentMounted[target]) return;
    if (target !== 'practice') {
      this.stopBurstAudio();
    }
    this.activeSegment = target;

    this.container?.querySelectorAll('.study-segment-tab').forEach((tab) => {
      const isActive = tab.dataset.segment === target;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
    });

    STUDY_SEGMENTS.forEach((entry) => {
      const pane = this.segmentArea(entry.id);
      if (pane) pane.hidden = entry.id !== target;
    });

    if (!this.segmentMounted[target] || target === 'progress') {
      this.segmentMounted[target] = true;
      this.mountSegment(target);
    }
  }

  mountSegment(segment) {
    if (segment === 'bank') return this.loadQuestionBank(this.bankFilters, this.bankPage);
    if (segment === 'mistakes') return this.loadMistakesNotebook(this.mistakesFilters);
    if (segment === 'progress') return this.loadProgress();
    this.segmentMounted.practice = true;
    return this.restoreActiveSessionOrSetup();
  }

  renderSegmentFailure(segment, title, message, retry) {
    const area = this.segmentArea(segment);
    if (!area) return;
    area.innerHTML = `
      <div class="study-empty-state tactile-card text-center py-10">
        <h2 class="study-empty-title">${escapeHtml(title)}</h2>
        <p class="text-secondary text-sm max-w-md mx-auto mb-4">${escapeHtml(message)}</p>
        <button type="button" class="tactile-btn tactile-btn-primary" id="btn-retry-${segment}">Retry</button>
      </div>
    `;
    document.getElementById(`btn-retry-${segment}`)?.addEventListener('click', retry);
  }

  renderGuestPrompt(segment, message) {
    const area = this.segmentArea(segment);
    if (!area) return;
    const title = segment === 'progress' ? 'Study Progress' : (segment === 'bank' ? 'Question Bank' : 'Mistakes Notebook');
    area.innerHTML = `
      <div class="study-empty-state tactile-card text-center py-10">
        <h2 class="study-empty-title">Sign in to sync ${escapeHtml(title)}</h2>
        <p class="text-secondary text-sm max-w-md mx-auto mb-4">${escapeHtml(message)}</p>
        <button type="button" class="tactile-btn tactile-btn-primary" id="btn-guest-login-${segment}">Sign In</button>
      </div>
    `;
    document.getElementById(`btn-guest-login-${segment}`)?.addEventListener('click', () => {
      document.querySelector('#top-chrome-login-btn, [data-action="login"], .auth-btn')?.click();
    });
  }

  async mount(container) {
    this.container = container;
    this.activeSegment = 'practice';
    this.segmentMounted = { practice: false, bank: false, mistakes: false, progress: false };
    this.renderShell();

    try {
      this.activeLevel = await getUniversalJlptLevel();
    } catch (err) {
      console.debug('[Study] Resolve learner level error:', err);
    }

    try {
      this.cachedBankSummary = await studyClient.getBankSummary();
    } catch (err) {
      console.debug('[Study] Bank summary preload failed:', err.message);
    }

    await this.restoreActiveSessionOrSetup();
    this.segmentMounted.practice = true;
  }

  onShow() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keydown', this.handleKeyDown);
    if (this.sessionId && !this.timerInterval && this.practiceItems.length > 0) {
      this.startActiveTimer();
    }
    this.activeListenerCount = 1;
  }

  onHide() {
    window.removeEventListener('keydown', this.handleKeyDown);
    this.stopBurstAudio();
    this.stopActiveTimer();
    this.activeListenerCount = 0;
  }

  renderShell() {
    const segmentTabs = STUDY_SEGMENTS.map((entry) => {
      const isActive = entry.id === this.activeSegment;
      const paneId = entry.id === 'practice' ? 'study-content-area' : `study-segment-${entry.id}`;
      return `
        <button
          type="button"
          class="study-segment-tab ${isActive ? 'is-active' : ''}"
          id="study-tab-${entry.id}"
          role="tab"
          data-segment="${entry.id}"
          aria-controls="${paneId}"
          aria-selected="${isActive}"
          tabindex="${isActive ? '0' : '-1'}"
        >${escapeHtml(entry.label)}</button>
      `;
    }).join('');

    this.container.innerHTML = `
      <div class="study-view-wrapper">
        <div class="study-view-container" id="study-main-container">
          <div class="grammar-header-row">
            <div class="grammar-brand-header" aria-label="Study 勉強">
              <h1 class="grammar-word-title">
                <span class="hero-letter">S</span><span class="hero-letter">T</span><span class="hero-letter">U</span><span class="hero-letter">D</span><span class="hero-letter">Y</span>
              </h1>
              <span class="grammar-word-kanji">
                <span class="hero-letter">勉</span><span class="hero-letter">強</span>
              </span>
            </div>
            <div class="study-segment-pills" role="tablist" aria-label="Study sections">
              ${segmentTabs}
            </div>
          </div>

          <div class="study-error-banner" id="study-error-banner" role="alert" style="display: none;">
            <span id="study-error-msg"></span>
            <button type="button" class="study-error-close" id="study-error-dismiss" aria-label="Dismiss error">Dismiss</button>
          </div>

          <div id="study-content-area" class="study-segment-pane" role="tabpanel" aria-labelledby="study-tab-practice" data-segment="practice"></div>
          <div id="study-segment-bank" class="study-segment-pane" role="tabpanel" aria-labelledby="study-tab-bank" data-segment="bank" hidden></div>
          <div id="study-segment-mistakes" class="study-segment-pane" role="tabpanel" aria-labelledby="study-tab-mistakes" data-segment="mistakes" hidden></div>
          <div id="study-segment-progress" class="study-segment-pane" role="tabpanel" aria-labelledby="study-tab-progress" data-segment="progress" hidden></div>
        </div>

        <div class="study-report-backdrop" id="study-report-backdrop" style="display: none;"></div>
        <aside class="study-report-drawer" id="study-report-drawer" role="dialog" aria-modal="true" aria-hidden="true" aria-label="Report Question">
          <div id="study-report-drawer-body"></div>
        </aside>
      </div>
    `;

    const tabs = Array.from(this.container.querySelectorAll('.study-segment-tab'));
    tabs.forEach((tab, idx) => {
      tab.addEventListener('click', () => {
        if (tab.dataset.segment === 'practice' && this.activeSegment === 'practice' && !this.sessionId && !this.activeBurst) {
          this.renderSetupChooser();
          return;
        }
        this.switchSegment(tab.dataset.segment);
      });
      tab.addEventListener('keydown', (e) => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        let nextIdx = idx;
        if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') nextIdx = 0;
        else if (e.key === 'End') nextIdx = tabs.length - 1;
        const next = tabs[nextIdx];
        next?.focus();
        if (next?.dataset.segment) this.switchSegment(next.dataset.segment);
      });
    });

    document.getElementById('study-error-dismiss')?.addEventListener('click', () => this.clearError());
    document.getElementById('study-report-backdrop')?.addEventListener('click', () => this.closeReportDrawer());
  }

  openReportDrawer(questionId) {
    this._reportTriggerEl = document.activeElement;
    this.reportQuestionId = questionId;
    const drawer = document.getElementById('study-report-drawer');
    const backdrop = document.getElementById('study-report-backdrop');
    this.renderQuestionReportForm(questionId);
    drawer?.classList.add('is-open');
    drawer?.setAttribute('aria-hidden', 'false');
    if (backdrop) backdrop.style.display = 'block';
    document.getElementById('report-details')?.focus();
  }

  closeReportDrawer() {
    const drawer = document.getElementById('study-report-drawer');
    const backdrop = document.getElementById('study-report-backdrop');
    drawer?.classList.remove('is-open');
    drawer?.setAttribute('aria-hidden', 'true');
    if (backdrop) backdrop.style.display = 'none';
    if (this._reportTriggerEl && typeof this._reportTriggerEl.focus === 'function' && this._reportTriggerEl.isConnected) {
      this._reportTriggerEl.focus();
    }
    this._reportTriggerEl = null;
  }

  showError(message) {
    const banner = document.getElementById('study-error-banner');
    const msg = document.getElementById('study-error-msg');
    if (banner && msg) {
      msg.textContent = message;
      banner.style.display = 'flex';
    }
  }

  clearError() {
    const banner = document.getElementById('study-error-banner');
    if (banner) {
      banner.style.display = 'none';
    }
  }

  renderSetupChooser(recovery = null) {
    this.clearError();
    this.stopActiveTimer();
    this.activeBurst = null;
    const area = this.segmentArea('practice');
    if (!area) return;

    const totalBank = this.cachedBankSummary?.total_questions ?? null;
    const jlptMeta = totalBank !== null
      ? `${totalBank.toLocaleString()} Questions`
      : `Level ${escapeHtml(this.activeLevel || 'N4')}`;

    const recoveryHtml = recovery?.action === 'offer' ? (() => {
      const label = recovery.type === 'exam' ? 'Exam' : 'Practice Drill';
      return `
        <div class="study-recovery-bar" role="region" aria-label="Resume active session">
          <div class="study-recovery-copy">
            <span class="study-recovery-badge">IN PROGRESS</span>
            <span class="study-recovery-text">Active ${escapeHtml(label)} session found.</span>
          </div>
          <div class="study-recovery-actions">
            <button type="button" class="study-btn-primary" id="btn-resume-session">Resume</button>
            <button type="button" class="study-btn-ghost" id="btn-abandon-session">Discard</button>
          </div>
        </div>
      `;
    })() : '';

    const arrowSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;

    area.innerHTML = `
      ${recoveryHtml}
      <div class="study-landing-grid" aria-label="Study Modes">
        <button type="button" class="study-mode-card study-mode-card--jlpt" data-study-mode="jlpt">
          <span class="study-mode-accent" aria-hidden="true"></span>
          <span class="study-mode-watermark" aria-hidden="true">模</span>
          <div class="study-mode-meta">
            <span class="study-mode-tag">TARGETED DRILL</span>
            <span class="study-mode-count">${escapeHtml(jlptMeta)}</span>
          </div>
          <h2 class="study-mode-title">JLPT Practice Bank</h2>
          <p class="study-mode-desc">Targeted N5–N1 drills by category, format, and weak spots.</p>
          <div class="study-mode-cta">
            <span>Choose Level &amp; Format</span>
            ${arrowSvg}
          </div>
        </button>

        <button type="button" class="study-mode-card study-mode-card--scramble" data-study-mode="scramble">
          <span class="study-mode-accent" aria-hidden="true"></span>
          <span class="study-mode-watermark" aria-hidden="true">文</span>
          <div class="study-mode-meta">
            <span class="study-mode-tag">BURST MODE</span>
            <span class="study-mode-count">Particles &amp; Order</span>
          </div>
          <h2 class="study-mode-title">Sentence Scramble</h2>
          <p class="study-mode-desc">Rebuild captured sentences from semantic blocks with keys 1–9.</p>
          <div class="study-mode-cta">
            <span>Choose Burst Size</span>
            ${arrowSvg}
          </div>
        </button>
      </div>
    `;

    area.querySelectorAll('.study-mode-card').forEach((card) => {
      card.addEventListener('click', () => this.openModeSetup(card.dataset.studyMode));
    });
  }

  openModeSetup(mode) {
    if (mode === 'jlpt') {
      this.renderJlptSetup();
      return;
    }
    this.renderScrambleSetup();
  }

  renderScrambleSetup() {
    const area = this.segmentArea('practice');
    if (!area) return;

    const currentSize = this.burstSizes?.sentence_scramble === 10 ? 10 : 5;
    const backSvg = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>`;

    area.innerHTML = `
      <div class="study-mode-drilldown" data-mode="scramble">
        <div class="study-drilldown-header">
          <button type="button" class="study-back-btn" id="btn-study-mode-back">
            ${backSvg}
            <span>Back to Study</span>
          </button>
          <span class="study-eligible-pill">Particles &amp; Order</span>
        </div>

        <div class="study-jlpt-setup-card study-scramble-setup-card">
          <span class="study-mode-accent study-mode-accent--aqua" aria-hidden="true"></span>
          <div class="study-jlpt-setup-head">
            <div>
              <span class="study-mode-tag study-mode-tag--aqua">BURST MODE</span>
              <h2 class="study-drilldown-title">Sentence Scramble</h2>
              <p class="study-mode-desc">
                Rebuild captured sentences from semantic blocks with keys 1–9, Backspace, and Enter.
              </p>
            </div>
          </div>

          <div class="study-setup-sections">
            <div class="study-setup-group">
              <div class="study-setup-label-row">
                <span class="study-setup-label">Burst Size</span>
                <span class="study-setup-value study-setup-value--aqua">${currentSize} Items</span>
              </div>
              <div class="study-pill-group" role="group" aria-label="Sentence Scramble burst size">
                ${[5, 10].map((size) => `
                  <button
                    type="button"
                    class="study-option-pill ${currentSize === size ? 'is-active' : ''}"
                    data-scramble-size="${size}"
                    aria-pressed="${currentSize === size}"
                  >${size} Items</button>
                `).join('')}
              </div>
            </div>
          </div>

          <div class="study-setup-footer">
            <span class="study-eligible-note">Uses your captured sentences with multi-block Japanese structure.</span>
            <button type="button" class="study-start-btn study-start-btn--aqua" id="btn-start-scramble-burst">
              Start ${currentSize}-Item Burst
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-study-mode-back')?.addEventListener('click', () => {
      this.renderSetupChooser();
    });

    area.querySelectorAll('[data-scramble-size]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.burstSizes.sentence_scramble = Number(btn.dataset.scrambleSize) === 10 ? 10 : 5;
        this.renderScrambleSetup();
      });
    });

    document.getElementById('btn-start-scramble-burst')?.addEventListener('click', () => {
      this.startBurstSession('sentence_scramble', this.burstSizes.sentence_scramble);
    });
  }

  renderJlptSetup() {
    const area = this.segmentArea('practice');
    if (!area) return;

    const levels = ['N5', 'N4', 'N3', 'N2', 'N1'];
    const categories = this.getPracticeCategories();
    if (!categories.includes(this.selectedCategory)) {
      this.selectedCategory = 'all';
    }
    const formats = this.getPracticeFormats();
    if (!formats.includes(this.selectedFormatCode)) {
      this.selectedFormatCode = 'all';
    }

    const drillModes = [
      { id: 'practice', label: 'Fresh Questions' },
      { id: 'weak_area', label: 'Weak Spots' },
      { id: 'trouble', label: 'Mistakes Review' },
      { id: 'bookmarked', label: 'Bookmarked Only' }
    ];
    const counts = [5, 10, 20];

    const eligibleCount = this.cachedBankSummary
      ? getEligibleQuestionCount(this.cachedBankSummary, this.activeLevel, this.selectedCategory, this.selectedFormatCode)
      : null;
    const countBadge = eligibleCount !== null
      ? `${eligibleCount.toLocaleString()} Eligible`
      : 'Checking bank...';
    const backSvg = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>`;

    const activeModeId = this.bookmarkedOnly ? 'bookmarked' : (this.selectedSessionType || 'practice');

    area.innerHTML = `
      <div class="study-mode-drilldown" data-mode="jlpt">
        <div class="study-drilldown-header">
          <button type="button" class="study-back-btn" id="btn-study-mode-back">
            ${backSvg}
            <span>Back to Study</span>
          </button>
          <span class="study-eligible-pill" id="jlpt-eligible-count">${escapeHtml(countBadge)}</span>
        </div>

        <div class="study-jlpt-setup-card">
          <span class="study-mode-accent" aria-hidden="true"></span>
          <div class="study-jlpt-setup-head">
            <div>
              <span class="study-mode-tag">TARGETED DRILL</span>
              <h2 class="study-drilldown-title">JLPT Practice Bank</h2>
            </div>
          </div>

          <div class="study-setup-sections">
            <div class="study-setup-group">
              <div class="study-setup-label-row">
                <span class="study-setup-label">Target JLPT Level</span>
                <span class="study-setup-value">${escapeHtml(this.activeLevel)}</span>
              </div>
              <div class="study-pill-group" role="group" aria-label="Target JLPT Level">
                ${levels.map((lvl) => `
                  <button
                    type="button"
                    class="study-option-pill ${this.activeLevel === lvl ? 'is-active' : ''}"
                    data-jlpt-level="${lvl}"
                    aria-pressed="${this.activeLevel === lvl}"
                  >${lvl}</button>
                `).join('')}
              </div>
            </div>

            <div class="study-setup-group">
              <div class="study-setup-label-row">
                <span class="study-setup-label">Category / Area</span>
                <span class="study-setup-value">${escapeHtml(this.selectedCategory === 'all' ? 'All Areas' : formatQuestionType(this.selectedCategory))}</span>
              </div>
              <div class="study-pill-group" role="group" aria-label="Category">
                ${categories.map((cat) => `
                  <button
                    type="button"
                    class="study-option-pill ${this.selectedCategory === cat ? 'is-active' : ''}"
                    data-jlpt-category="${escapeHtml(cat)}"
                    aria-pressed="${this.selectedCategory === cat}"
                  >${escapeHtml(cat === 'all' ? 'All Areas' : formatQuestionType(cat))}</button>
                `).join('')}
              </div>
            </div>

            <div class="study-setup-group">
              <div class="study-setup-label-row">
                <span class="study-setup-label">Question Format</span>
                <span class="study-setup-value">${escapeHtml(this.selectedFormatCode === 'all' ? 'All Formats' : formatQuestionType(this.selectedFormatCode))}</span>
              </div>
              <div class="study-pill-group" role="group" aria-label="Question Format">
                ${formats.map((fmt) => `
                  <button
                    type="button"
                    class="study-option-pill ${this.selectedFormatCode === fmt ? 'is-active' : ''}"
                    data-jlpt-format="${escapeHtml(fmt)}"
                    aria-pressed="${this.selectedFormatCode === fmt}"
                  >${escapeHtml(fmt === 'all' ? 'All Formats' : formatQuestionType(fmt))}</button>
                `).join('')}
              </div>
            </div>

            <div class="study-setup-split">
              <div class="study-setup-group">
                <div class="study-setup-label-row">
                  <span class="study-setup-label">Drill Mode</span>
                </div>
                <div class="study-pill-group" role="group" aria-label="Drill Mode">
                  ${drillModes.map((dm) => `
                    <button
                      type="button"
                      class="study-option-pill ${activeModeId === dm.id ? 'is-active' : ''}"
                      data-jlpt-mode="${dm.id}"
                      aria-pressed="${activeModeId === dm.id}"
                    >${escapeHtml(dm.label)}</button>
                  `).join('')}
                </div>
              </div>

              <div class="study-setup-group">
                <div class="study-setup-label-row">
                  <span class="study-setup-label">Question Count</span>
                </div>
                <div class="study-pill-group" role="group" aria-label="Question Count">
                  ${counts.map((cnt) => `
                    <button
                      type="button"
                      class="study-option-pill ${this.selectedCount === cnt ? 'is-active' : ''}"
                      data-jlpt-count="${cnt}"
                      aria-pressed="${this.selectedCount === cnt}"
                    >${cnt} Questions</button>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>

          <div class="study-setup-footer">
            <span class="study-eligible-note" id="study-eligible-count">
              ${eligibleCount !== null
                ? `${eligibleCount.toLocaleString()} eligible questions for ${escapeHtml(this.activeLevel)}; session capped at ${this.selectedCount}.`
                : `Ready to drill ${escapeHtml(this.activeLevel)}.`}
            </span>
            <button type="button" class="study-start-btn" id="btn-start-jlpt-drill">
              Start Practice Drill (${escapeHtml(this.activeLevel)})
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-study-mode-back')?.addEventListener('click', () => {
      this.renderSetupChooser();
    });

    area.querySelectorAll('[data-jlpt-level]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeLevel = btn.dataset.jlptLevel;
        this.selectedCategory = 'all';
        this.selectedFormatCode = 'all';
        this.renderJlptSetup();
      });
    });

    area.querySelectorAll('[data-jlpt-category]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedCategory = btn.dataset.jlptCategory;
        this.selectedFormatCode = 'all';
        this.renderJlptSetup();
      });
    });

    area.querySelectorAll('[data-jlpt-format]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedFormatCode = btn.dataset.jlptFormat;
        this.renderJlptSetup();
      });
    });

    area.querySelectorAll('[data-jlpt-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const chosen = btn.dataset.jlptMode;
        if (chosen === 'bookmarked') {
          this.bookmarkedOnly = true;
          this.selectedSessionType = 'bookmarked';
        } else {
          this.bookmarkedOnly = false;
          this.selectedSessionType = chosen;
        }
        this.renderJlptSetup();
      });
    });

    area.querySelectorAll('[data-jlpt-count]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedCount = Number(btn.dataset.jlptCount) || 10;
        this.renderJlptSetup();
      });
    });

    document.getElementById('btn-start-jlpt-drill')?.addEventListener('click', () => {
      const formatArg = this.selectedFormatCode === 'all' ? null : this.selectedFormatCode;
      const categoryArg = this.selectedCategory === 'all' ? null : this.selectedCategory;
      this.loadPracticeSession(this.activeLevel, this.selectedCount, formatArg, categoryArg);
    });

    if (!this.cachedBankSummary) {
      studyClient.getBankSummary().then((summary) => {
        this.cachedBankSummary = summary;
        if (area.querySelector('[data-mode="jlpt"]')) {
          this.renderJlptSetup();
        }
      }).catch(() => {});
    }
  }
  renderProgress(overview = {}, weakAreas = []) {
    const area = this.segmentArea('progress');
    if (!area) return;
    if (!hasProgressHistory(overview, weakAreas)) {
      area.innerHTML = `
        <div class="study-empty-state tactile-card text-center py-10">
          <div class="flex items-center justify-between gap-3 mb-4 text-left">
            <div>
              <span class="font-mono text-xs text-gold uppercase tracking-wider">Study</span>
              <h2 class="text-xl font-bold text-warm-paper mt-1">Progress</h2>
            </div>
            <button type="button" class="tactile-btn tactile-btn-sm" id="btn-back-from-progress">Back</button>
          </div>
          <h3 class="study-empty-title">No study history yet</h3>
          <p class="text-secondary text-sm max-w-md mx-auto">Complete a practice session to see accuracy and weak areas here.</p>
        </div>
      `;
      document.getElementById('btn-back-from-progress')?.addEventListener('click', () => this.switchSegment('practice'));
      return;
    }

    const summary = overview.learning_summary || {};
    const metrics = getProgressMetrics(summary);
    const renderAccuracyRows = (items, useFormatLabel = false) => (Array.isArray(items) ? items : []).map((item) => {
      const rawLabel = item.group_name || item.level || item.family || 'Unknown';
      const label = useFormatLabel ? formatQuestionType(rawLabel) : rawLabel;
      const pct = Math.max(0, Math.min(100, Number(item.accuracy ?? item.accuracy_percent ?? 0)));
      return `
        <div class="study-progress-row">
          <div class="flex items-center justify-between gap-3">
            <span class="text-secondary text-sm">${escapeHtml(label)}</span>
            <span class="font-mono text-sm text-warm-paper font-bold">${formatPercent(item.accuracy ?? item.accuracy_percent)}</span>
          </div>
          <div class="study-progress-bar-track">
            <div class="study-progress-bar-fill" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
    const renderWeakAreas = weakAreas.map((item) => {
      const attemptsMatch = String(item.description || '').match(/(\d+\s+attempts?)/i);
      const subtext = attemptsMatch ? attemptsMatch[1] : (item.category ? formatQuestionType(item.category) : 'Needs review');
      return `
        <div class="study-weak-item">
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-xs text-gold font-bold">${escapeHtml(formatQuestionType(item.format_code || ''))} · ${escapeHtml(item.level || '')}</span>
            <span class="font-mono text-xs text-warm-paper font-bold">${formatPercent(item.accuracy)}</span>
          </div>
          <p class="text-muted text-xs font-mono mt-1">${escapeHtml(subtext)}</p>
          <button
            type="button"
            class="tactile-btn tactile-btn-sm mt-2 btn-practice-weak-area"
            data-level="${escapeHtml(item.level || '')}"
            data-format="${escapeHtml(item.format_code || '')}"
          >Practice</button>
        </div>
      `;
    }).join('');
    const sectionTimes = summary.time_per_section || summary.time_by_section;
    const renderSectionTimes = sectionTimes && typeof sectionTimes === 'object'
      ? Object.entries(sectionTimes).map(([section, duration]) => `
        <div class="flex items-center justify-between gap-3 py-1.5 border-b border-white/10 last:border-b-0">
          <span class="text-secondary text-sm">${escapeHtml(formatMetricLabel(section))}</span>
          <span class="font-mono text-sm text-warm-paper">${formatDuration(duration)}</span>
        </div>
      `).join('')
      : '';

    area.innerHTML = `
      <div class="study-progress-card tactile-card">
        <div class="flex items-center justify-between gap-3 mb-4">
          <div>
            <span class="font-mono text-xs text-gold uppercase tracking-wider">Study</span>
            <h2 class="text-xl font-bold text-warm-paper mt-0.5">Progress</h2>
          </div>
          <button type="button" class="tactile-btn tactile-btn-sm" id="btn-back-from-progress">Back</button>
        </div>
        ${metrics.length ? `<div class="study-kpi-strip mb-5">${metrics.map((metric) => `
          <div class="study-kpi-cell">
            <span class="study-kpi-label">${escapeHtml(metric.label)}</span>
            <span class="study-kpi-value">${escapeHtml(metric.value)}</span>
          </div>
        `).join('')}</div>` : ''}
        <div class="study-progress-grid">
          <section class="tactile-card surface-pitch-black p-4">
            <h3 class="text-sm font-bold text-warm-paper uppercase tracking-wider mb-3">Accuracy by Level</h3>
            <div class="space-y-2.5">${renderAccuracyRows(overview.accuracy_by_level) || '<p class="text-secondary text-sm">No level accuracy recorded.</p>'}</div>
          </section>
          <section class="tactile-card surface-pitch-black p-4">
            <h3 class="text-sm font-bold text-warm-paper uppercase tracking-wider mb-3">Accuracy by Format</h3>
            <div class="space-y-2.5">${renderAccuracyRows(overview.accuracy_by_family, true) || '<p class="text-secondary text-sm">No format accuracy recorded.</p>'}</div>
          </section>
          ${renderSectionTimes ? `<section class="tactile-card surface-pitch-black p-4">
            <h3 class="text-sm font-bold text-warm-paper uppercase tracking-wider mb-3">Time per Section</h3>
            ${renderSectionTimes}
          </section>` : ''}
          <section class="tactile-card surface-pitch-black p-4 ${renderSectionTimes ? '' : 'study-weak-section-full'}">
            <h3 class="text-sm font-bold text-warm-paper uppercase tracking-wider mb-3">Weak Areas</h3>
            <div class="study-weak-grid">${weakAreas.length ? renderWeakAreas : '<p class="text-secondary text-sm">No weak areas recorded.</p>'}</div>
          </section>
        </div>
      </div>
    `;
    document.getElementById('btn-back-from-progress')?.addEventListener('click', () => this.switchSegment('practice'));
    area.querySelectorAll('.btn-practice-weak-area').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedSessionType = 'trouble';
        this.bookmarkedOnly = false;
        this.activeLevel = btn.dataset.level || this.activeLevel;
        this.switchSegment('practice');
        this.loadPracticeSession(this.activeLevel, this.selectedCount, btn.dataset.format || null);
      });
    });
  }

  async loadQuestionBank(filters = this.bankFilters, page = 1) {
    this.bankFilters = { ...this.bankFilters, ...(filters || {}) };
    this.bankPage = page;
    const area = this.segmentArea('bank');
    if (!area) return;
    area.innerHTML = '<div class="tactile-card text-center py-12 text-muted"><span class="font-mono text-sm">Loading question bank...</span></div>';
    try {
      this.cachedBankSummary = await studyClient.getBankSummary();
      this.renderQuestionBank([], this.bankFilters, null, page);
    } catch (err) {
      if (err.isAuthError || err.status === 401) {
        this.renderGuestPrompt('bank', 'Sign in to access your cloud question bank and custom drills.');
        return;
      }
      console.warn('[Study] Question bank error:', err.message || err);
      this.renderSegmentFailure(
        'bank',
        'Question bank unavailable',
        err.message || 'Unable to load question bank summary.',
        () => this.loadQuestionBank(this.bankFilters, this.bankPage)
      );
      this.showError('Question bank failed: ' + (err.message || 'Unable to load summary'));
    }
  }

  renderQuestionBank(items = [], filters = {}) {
    const area = this.segmentArea('bank');
    if (!area) return;
    const levelsSummary = this.cachedBankSummary?.levels || {};
    const jlptLevels = ['N5', 'N4', 'N3', 'N2', 'N1'];
    const selectedLevelInfo = filters.level ? levelsSummary[filters.level] : null;
    const selectedLevelFormats = Array.isArray(selectedLevelInfo?.formats) ? selectedLevelInfo.formats : [];
    const totalBank = Number(this.cachedBankSummary?.total_questions ?? 0);

    area.innerHTML = `
      <div class="study-bank-card tactile-card">
        <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <span class="font-mono text-xs text-gold uppercase tracking-wider">Study · ${totalBank.toLocaleString()} Total</span>
            <h2 class="text-xl font-bold text-warm-paper mt-1">Question Bank</h2>
            <p class="text-secondary text-sm">Inspect question counts by JLPT level or import your own.</p>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary font-sans" id="btn-toggle-bank-import">
              Import Questions
            </button>
            <button type="button" class="tactile-btn tactile-btn-sm" id="btn-back-from-bank">Back</button>
          </div>
        </div>

        <!-- Bank Import Section (Collapsed Panel) -->
        <div class="bank-import-panel-wrapper mb-4">
          <div id="bank-import-mount" style="display: none;"></div>
        </div>

        <!-- JLPT Level Shelf Cards -->
        <div class="study-bank-level-shelf mb-4" id="bank-level-shelf">
          ${jlptLevels.map((lvl) => {
            const count = Number(levelsSummary[lvl]?.total_count ?? levelsSummary[lvl]?.eligible_count ?? 0);
            const isActive = filters.level === lvl;
            return `
              <button type="button" class="study-bank-level-card ${isActive ? 'is-active' : ''}" data-level="${lvl}">
                <span class="study-bank-level-badge">${lvl}</span>
                <span class="study-bank-level-count">${count.toLocaleString()}</span>
                <span class="study-bank-level-sub">questions</span>
              </button>
            `;
          }).join('')}
        </div>

        ${filters.level && selectedLevelFormats.length ? `
          <div class="study-bank-breakdown tactile-card surface-pitch-black p-4">
            <div class="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <span class="font-mono text-xs text-gold uppercase tracking-wider">${escapeHtml(filters.level)} Breakdown (${Number(selectedLevelInfo?.total_count ?? selectedLevelInfo?.eligible_count ?? 0).toLocaleString()} total)</span>
              <button type="button" class="tactile-btn tactile-btn-sm" id="btn-clear-bank-level">Clear Selection</button>
            </div>
            <div class="study-bank-breakdown-grid">
              ${selectedLevelFormats.map((fmt) => `
                <div class="study-bank-breakdown-item">
                  <span class="text-xs text-secondary truncate">${escapeHtml(formatQuestionType(fmt.format_code))}</span>
                  <span class="font-mono text-xs font-bold text-warm-paper">${Number(fmt.total_count ?? fmt.eligible_count ?? 0).toLocaleString()}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    document.getElementById('btn-back-from-bank')?.addEventListener('click', () => this.switchSegment('practice'));
    const btnToggleImport = document.getElementById('btn-toggle-bank-import');
    const importMount = document.getElementById('bank-import-mount');
    if (btnToggleImport && importMount) {
      btnToggleImport.addEventListener('click', () => {
        const isHidden = importMount.style.display === 'none';
        importMount.style.display = isHidden ? 'block' : 'none';
        btnToggleImport.textContent = isHidden ? 'Hide Import' : 'Import Questions';
        if (isHidden && !importMount.hasChildNodes()) {
          renderStudyImport(importMount);
        }
      });
    }
    area.querySelectorAll('.study-bank-level-card').forEach((card) => {
      card.addEventListener('click', () => {
        const lvl = card.dataset.level || '';
        const nextLevel = filters.level === lvl ? '' : lvl;
        this.bankFilters = { ...this.bankFilters, level: nextLevel, format: '' };
        this.renderQuestionBank([], this.bankFilters);
      });
    });
    document.getElementById('btn-clear-bank-level')?.addEventListener('click', () => {
      this.bankFilters = { ...this.bankFilters, level: '', format: '' };
      this.renderQuestionBank([], this.bankFilters);
    });
  }

  async loadQuestionDetail(questionId) {
    const detail = document.getElementById('bank-detail');
    if (!detail) return;
    detail.innerHTML = '<div class="tactile-card text-center py-6 text-muted"><span class="font-mono text-sm">Loading question detail...</span></div>';
    try {
      let question = null;
      let provenance = null;
      try {
        question = await studyClient.getQuestion(questionId);
      } catch (err) {
        console.warn('[Study] Question lookup failed:', err.message);
      }
      try {
        provenance = await studyClient.getQuestionProvenance(questionId);
      } catch (err) {
        console.debug('[Study] Provenance lookup failed:', err.message);
      }
      if (!question) {
        throw new Error('Question data could not be retrieved from bank');
      }
      const choices = Array.isArray(question?.choices) ? question.choices : [];
      detail.innerHTML = `
        <div class="tactile-card surface-pitch-black p-4 mt-3" style="border: 1.5px solid var(--gold);">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-bold text-warm-paper">Question ${escapeHtml(String(question?.external_id || questionId))}</h3>
            <span class="tactile-pill tactile-pill-gold font-mono text-xs">${escapeHtml(question?.level || '')} · ${escapeHtml(formatQuestionType(question?.format_code))}</span>
          </div>
          <div class="font-japanese text-warm-paper mb-3 text-base">${renderStudyText(question, 'prompt_markup', 'prompt_html')}</div>
          <div class="text-sm text-secondary mb-3 space-y-1">${choices.map((choice) => `<div class="p-2 tactile-card surface-pitch-black mb-1 border border-ink font-japanese text-warm-paper">${escapeHtml(choice.choice_key || choice.id || '')}: ${renderStudyText(choice, 'text_markup', 'text_html') || escapeHtml(choice.text || '')}</div>`).join('')}</div>
          <div class="text-xs text-gold mb-3 font-mono">Answer: ${escapeHtml(question?.canonical_choice_key || 'Not recorded')} · Verification: ${escapeHtml(provenance?.verification?.status || 'verified')}</div>
          ${provenance?.sources?.length ? `<div class="text-xs text-secondary mb-3">Provenance: ${escapeHtml((provenance.sources || []).map((source) => source.citation || source.name).filter(Boolean).join('; '))}</div>` : ''}
          <div class="flex gap-2">
            <button type="button" class="tactile-btn tactile-btn-primary" id="btn-report-question">Report a defect</button>
            <button type="button" class="tactile-btn" id="btn-close-bank-detail">Close</button>
          </div>
        </div>
      `;
      document.getElementById('btn-report-question')?.addEventListener('click', () => this.openReportDrawer(questionId));
      document.getElementById('btn-close-bank-detail')?.addEventListener('click', () => { detail.innerHTML = ''; });
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      console.error('[Study] Question detail error:', err);
      detail.innerHTML = `<div class="tactile-card p-4 text-secondary text-sm">${escapeHtml(err.message || 'Unable to load question detail.')}</div>`;
    }
  }

  renderQuestionReportForm(questionId) {
    const body = document.getElementById('study-report-drawer-body');
    if (!body) return;
    body.innerHTML = `
      <p class="text-xs text-muted font-mono">Question ${escapeHtml(String(questionId))}</p>
      <form id="question-report-form">
        <label class="text-xs font-mono text-muted uppercase block mb-1" for="report-issue-type">Issue type</label>
        <select class="tactile-input w-full mb-2" id="report-issue-type">
          <option value="incorrect_answer">Incorrect answer</option>
          <option value="bad_explanation">Bad explanation</option>
          <option value="wrong_format">Wrong format</option>
          <option value="typo_or_content">Typo or content</option>
          <option value="audio_media_issue">Audio or media issue</option>
          <option value="other">Other</option>
        </select>
        <textarea class="tactile-input w-full mb-2" id="report-details" minlength="3" maxlength="2000" required placeholder="Describe the defect"></textarea>
        <button type="submit" class="tactile-btn tactile-btn-primary">Submit report</button>
        <span class="text-sm text-secondary ml-2" id="report-status"></span>
      </form>
    `;
    document.getElementById('question-report-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = document.getElementById('report-status');
      try {
        await studyClient.reportQuestion(questionId, {
          issue_type: document.getElementById('report-issue-type')?.value,
          details: document.getElementById('report-details')?.value
        });
        if (status) status.textContent = 'Report submitted.';
      } catch (err) {
        console.error('[Study] Question report error:', err);
        if (status) status.textContent = 'Report failed: ' + (err.message || 'Unable to submit report');
      }
    });
  }

  async loadMistakesNotebook(filters = this.mistakesFilters) {
    this.mistakesFilters = { ...this.mistakesFilters, ...(filters || {}) };
    const area = this.segmentArea('mistakes');
    if (!area) return;
    area.innerHTML = '<div class="tactile-card text-center py-12 text-muted"><span class="font-mono text-sm">Loading mistakes...</span></div>';
    try {
      if (!this.cachedBankSummary?.levels) {
        try {
          this.cachedBankSummary = await studyClient.getBankSummary();
        } catch (summaryErr) {
          console.warn('[Study] Bank summary lookup failed:', summaryErr?.message || summaryErr);
        }
      }
      const query = { limit: 100 };
      if (this.mistakesFilters.level) query.level = this.mistakesFilters.level;
      if (this.mistakesFilters.format_code) query.format_code = this.mistakesFilters.format_code;
      const response = await studyClient.getIncorrectHistory(query);
      this.renderMistakesNotebook(response?.items || [], this.mistakesFilters);
    } catch (err) {
      if (err.isAuthError || err.status === 401) {
        this.renderGuestPrompt('mistakes', 'Sign in to record and review your question mistakes across sessions.');
        return;
      }
      console.warn('[Study] Mistakes history error:', err.message || err);
      this.renderSegmentFailure(
        'mistakes',
        'Mistakes unavailable',
        err.message || 'Unable to load history.',
        () => this.loadMistakesNotebook(this.mistakesFilters)
      );
      this.showError('Mistakes notebook failed: ' + (err.message || 'Unable to load history'));
    }
  }

  renderMistakesNotebook(items, filters = {}) {
    const area = this.segmentArea('mistakes');
    if (!area) return;
    this._mistakesAllItems = Array.isArray(items) ? items : [];
    const formats = [...new Set(this._mistakesAllItems.map((item) => item.format_code).filter(Boolean))].sort();
    const visibleItems = filterMistakes(this._mistakesAllItems, filters);
    this._mistakesQueue = visibleItems;
    this._mistakesDetailCache = this._mistakesDetailCache || new Map();

    const levels = ['N5', 'N4', 'N3', 'N2', 'N1'];

    area.innerHTML = `
      <div class="study-mistakes-card tactile-card">
        <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <span class="font-mono text-xs text-gold uppercase tracking-wider">Study · Review Mode</span>
            <h2 class="text-xl font-bold text-warm-paper mt-1">Mistakes Notebook</h2>
          </div>
          <button type="button" class="tactile-btn tactile-btn-sm" id="btn-back-to-study">Back</button>
        </div>

        <div class="study-mistakes-overview surface-pitch-black tactile-card">
          <div class="study-mistakes-stat-row">
            <div>
              <span class="study-setup-label">Mistakes Due for Review</span>
              <div class="study-mistakes-count">${visibleItems.length.toLocaleString()}</div>
            </div>
            <div class="study-mistakes-actions">
              <button
                type="button"
                class="study-start-btn"
                id="btn-start-mistake-review"
                ${visibleItems.length === 0 ? 'disabled' : ''}
              >Review Mistakes (${visibleItems.length})</button>
              <button
                type="button"
                class="tactile-btn tactile-btn-sm"
                id="btn-practice-mistakes"
                ${visibleItems.length === 0 ? 'disabled' : ''}
              >Drill Mode</button>
            </div>
          </div>

          <div class="study-setup-sections mt-4">
            <div class="study-setup-group">
              <span class="study-setup-label">Filter Level</span>
              <div class="study-pill-group">
                <button type="button" class="study-option-pill ${!filters.level ? 'is-active' : ''}" data-mistake-level="">All</button>
                ${levels.map((lvl) => `
                  <button type="button" class="study-option-pill ${filters.level === lvl ? 'is-active' : ''}" data-mistake-level="${lvl}">${lvl}</button>
                `).join('')}
              </div>
            </div>

            ${formats.length ? `
              <div class="study-setup-group">
                <span class="study-setup-label">Filter Format</span>
                <div class="study-pill-group">
                  <button type="button" class="study-option-pill ${!filters.format_code ? 'is-active' : ''}" data-mistake-format="">All Formats</button>
                  ${formats.map((fmt) => `
                    <button type="button" class="study-option-pill ${filters.format_code === fmt ? 'is-active' : ''}" data-mistake-format="${escapeHtml(fmt)}">${escapeHtml(formatQuestionType(fmt))}</button>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-back-to-study')?.addEventListener('click', () => this.switchSegment('practice'));

    area.querySelectorAll('[data-mistake-level]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.loadMistakesNotebook({
          level: btn.dataset.mistakeLevel || '',
          format_code: filters.format_code || ''
        });
      });
    });

    area.querySelectorAll('[data-mistake-format]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.loadMistakesNotebook({
          level: filters.level || '',
          format_code: btn.dataset.mistakeFormat || ''
        });
      });
    });

    document.getElementById('btn-start-mistake-review')?.addEventListener('click', () => {
      if (!this._mistakesQueue.length) return;
      this._mistakeReviewIndex = 0;
      this._mistakeFlipped = false;
      this.renderMistakeReviewer();
    });

    document.getElementById('btn-practice-mistakes')?.addEventListener('click', () => {
      this.selectedSessionType = 'trouble';
      this.bookmarkedOnly = false;
      this.switchSegment('practice');
      this.loadPracticeSession(filters.level || this.activeLevel, this.selectedCount, filters.format_code || null);
    });
  }

  async renderMistakeReviewer() {
    const area = this.segmentArea('mistakes');
    if (!area) return;
    const queue = this._mistakesQueue || [];
    const idx = this._mistakeReviewIndex || 0;

    if (idx >= queue.length) {
      area.innerHTML = `
        <div class="study-complete-card tactile-card text-center py-10">
          <span class="font-mono text-xs text-gold uppercase tracking-wider">Mistakes Review</span>
          <h2 class="study-complete-title font-display text-2xl font-bold mt-1 mb-2">Review Complete</h2>
          <p class="text-secondary text-sm mb-6">Reviewed ${queue.length} mistake card${queue.length === 1 ? '' : 's'}.</p>
          <div class="study-level-picker">
            <button type="button" class="tactile-btn" id="btn-mistake-done-overview">Back to Overview</button>
            <button type="button" class="tactile-btn tactile-btn-primary" id="btn-mistake-review-again">Review Again</button>
          </div>
        </div>
      `;
      document.getElementById('btn-mistake-done-overview')?.addEventListener('click', () => {
        this.renderMistakesNotebook(this._mistakesAllItems || [], this.mistakesFilters);
      });
      document.getElementById('btn-mistake-review-again')?.addEventListener('click', () => {
        this._mistakeReviewIndex = 0;
        this._mistakeFlipped = false;
        this.renderMistakeReviewer();
      });
      return;
    }

    const item = queue[idx];
    const promptText = `${item.prompt_html || ''} ${item.prompt_markup || ''} ${item.target || ''}`;
    const kanjiMatches = promptText.match(/[\u4e00-\u9faf]/g) || [];
    const firstKanji = kanjiMatches[0] || item.kanji || '';
    const grammarKey = item.grammar_point || item.pattern_key || item.grammar_key || '';

    let detail = this._mistakesDetailCache?.get(item.question_id) || null;
    if (this._mistakeFlipped && !detail) {
      try {
        detail = await studyClient.getIncorrectQuestionDetail(item.question_id);
        this._mistakesDetailCache?.set(item.question_id, detail);
      } catch (err) {
        detail = { error: err.message || 'Unable to load answer detail.' };
      }
    }
    const latest = detail?.timeline?.[detail.timeline.length - 1];
    const correctText = latest?.canonical_choice_text || latest?.canonical_choice_key || latest?.correct_choice || item?.correct_answer || 'Recorded';
    const selectedText = latest?.selected_choice_text || latest?.selected_choice_key || latest?.selected_choice || item?.user_answer || 'Recorded';
    const explanationText = detail?.explanation_markup || latest?.explanation_markup || item?.explanation || '';

    area.innerHTML = `
      <div class="study-mistake-reviewer">
        <div class="study-header-bar tactile-card">
          <div class="study-header-left">
            <button type="button" class="study-back-btn" id="btn-mistake-overview">Overview</button>
            <span class="tactile-pill tactile-pill-gold">${escapeHtml(item.level || '')} · ${escapeHtml(formatQuestionType(item.format_code || ''))}</span>
          </div>
          <span class="study-question-count font-mono">${idx + 1} / ${queue.length}</span>
        </div>

        <div class="study-mistake-flashcard surface-pitch-black tactile-card">
          <div class="study-prompt-header">
            <span class="font-mono text-xs text-gold uppercase tracking-wider">Mistake Card</span>
            <span class="font-mono text-xs text-muted">${Number(item.incorrect_count || 1)} missed</span>
          </div>

          <div class="study-mistake-prompt font-japanese text-warm-paper">
            ${renderStudyText(item, 'prompt_markup', 'prompt_html')}
          </div>

          ${!this._mistakeFlipped ? `
            <div class="study-mistake-reveal-row">
              <button type="button" class="study-start-btn" id="btn-mistake-reveal">Show Answer</button>
            </div>
          ` : `
            <div class="study-mistake-back">
              ${detail?.error ? `<p class="text-secondary text-sm">${escapeHtml(detail.error)}</p>` : `
                ${latest ? `
                  <div class="study-mistake-answer-grid">
                    <div class="study-mistake-answer-box is-correct">
                      <span class="study-setup-label">Correct Answer</span>
                      <div class="font-japanese text-warm-paper mt-1">${escapeHtml(correctText)}</div>
                    </div>
                    <div class="study-mistake-answer-box is-wrong">
                      <span class="study-setup-label">Your Previous Answer</span>
                      <div class="font-japanese text-warm-paper mt-1">${escapeHtml(selectedText)}</div>
                    </div>
                  </div>
                ` : ''}
                ${explanationText ? `
                  <div class="study-mistake-explanation">
                    <span class="study-setup-label">Explanation</span>
                    <div class="text-sm text-secondary mt-1">${escapeHtml(explanationText)}</div>
                  </div>
                ` : ''}
              `}

              <div class="mistake-crosslinks-row">
                <button type="button" class="study-crosslink-btn crosslink-grammar-btn" data-grammar="${escapeHtml(grammarKey || item.format_code || 'grammar')}">
                  Open grammar point
                </button>
                ${firstKanji ? `
                  <button type="button" class="study-crosslink-btn crosslink-kanji-btn" data-kanji="${escapeHtml(firstKanji)}">
                    Open kanji (${escapeHtml(firstKanji)})
                  </button>
                ` : ''}
              </div>

              <div class="study-mistake-nav-row">
                <button type="button" class="tactile-btn" id="btn-mistake-prev" ${idx === 0 ? 'disabled' : ''}>Previous</button>
                <button type="button" class="tactile-btn tactile-btn-primary" id="btn-mistake-next">
                  ${idx + 1 >= queue.length ? 'Finish Review' : 'Next Card'}
                </button>
              </div>
            </div>
          `}
        </div>
      </div>
    `;

    document.getElementById('btn-mistake-overview')?.addEventListener('click', () => {
      this.renderMistakesNotebook(this._mistakesAllItems || [], this.mistakesFilters);
    });

    document.getElementById('btn-mistake-reveal')?.addEventListener('click', () => {
      this._mistakeFlipped = true;
      this.renderMistakeReviewer();
    });

    document.getElementById('btn-mistake-prev')?.addEventListener('click', () => {
      if (this._mistakeReviewIndex > 0) {
        this._mistakeReviewIndex -= 1;
        this._mistakeFlipped = false;
        this.renderMistakeReviewer();
      }
    });

    document.getElementById('btn-mistake-next')?.addEventListener('click', () => {
      this._mistakeReviewIndex += 1;
      this._mistakeFlipped = false;
      this.renderMistakeReviewer();
    });

    area.querySelectorAll('.crosslink-grammar-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pt = btn.dataset.grammar;
        if (pt) this.router.navigateToTab('grammar', { query: `point=${encodeURIComponent(pt)}` });
      });
    });

    area.querySelectorAll('.crosslink-kanji-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.kanji;
        if (k && window.kirokuUi?.openKanji) {
          window.kirokuUi.openKanji(k);
        } else if (k) {
          this.router.navigateToTab('kanji', { query: `search=${encodeURIComponent(k)}` });
        }
      });
    });
  }

  async loadMistakeDetail(questionId) {
    const detail = document.getElementById('mistake-detail');
    if (!detail) return;
    detail.innerHTML = '<div class="tactile-card text-center py-6 text-muted"><span class="font-mono text-sm">Loading detail...</span></div>';
    try {
      const item = await studyClient.getIncorrectQuestionDetail(questionId);
      const latest = item?.timeline?.[item.timeline.length - 1];
      detail.innerHTML = `
        <div class="tactile-card surface-pitch-black p-4" style="border: 1.5px solid var(--gold);">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-bold text-warm-paper">Review detail</h3>
            <span class="tactile-pill tactile-pill-gold font-mono text-xs">${escapeHtml(item?.level || '')} · ${escapeHtml(formatQuestionType(item?.format_code))}</span>
          </div>
          <p class="text-secondary text-sm mb-3">${latest?.explanation_markup ? sanitizePromptMarkup(latest.explanation_markup) : 'No explanation was recorded.'}</p>
          <div class="text-xs text-muted mb-3 font-mono">
            Your answer: ${escapeHtml(latest?.selected_choice_key || 'Unknown')}
            · Correct answer: ${escapeHtml(latest?.canonical_choice_key || 'Unknown')}
            · Time: ${latest?.time_spent_ms ?? 0} ms
          </div>
          <div class="flex gap-2">
            <button type="button" class="tactile-btn tactile-btn-primary" id="btn-practice-selected-mistake">Practice this mistake</button>
            <button type="button" class="tactile-btn" id="btn-close-mistake-detail">Close</button>
          </div>
        </div>
      `;
      document.getElementById('btn-close-mistake-detail')?.addEventListener('click', () => { detail.innerHTML = ''; });
      document.getElementById('btn-practice-selected-mistake')?.addEventListener('click', () => {
        this.selectedSessionType = 'trouble';
        this.bookmarkedOnly = false;
        this.switchSegment('practice');
        this.loadPracticeSession(item.level, 1, item.format_code || null);
      });
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      console.error('[Study] Mistake detail error:', err);
      detail.innerHTML = `<div class="tactile-card p-4 text-secondary text-sm">${escapeHtml(err.message || 'Unable to load mistake detail.')}</div>`;
    }
  }

  async updateBankSummaryDisplay() {
    const statEl = document.getElementById('study-bank-stat');
    if (!statEl) return;

    try {
      if (!this.cachedBankSummary) {
        this.cachedBankSummary = await studyClient.getBankSummary();
      }
      const summary = this.cachedBankSummary;
      const eligibleCount = getEligibleQuestionCount(
        summary,
        this.activeLevel,
        this.selectedCategory,
        this.selectedFormatCode
      );
      const totalBank = summary?.total_questions ?? 0;
      statEl.textContent = `${eligibleCount} questions available for ${this.activeLevel} (${totalBank} total in bank)`;
      const countEl = document.getElementById('study-eligible-count');
      if (countEl) countEl.textContent = `${eligibleCount} eligible questions; session capped at ${this.selectedCount}.`;
    } catch (err) {
      console.debug('[Study] Bank summary lookup failed:', err.message);
      statEl.textContent = `Question bank active for ${this.activeLevel}`;
    }
  }

  async loadPracticeSession(level = 'N4', count = 10, formatCode = null, category = null) {
    this.activeLevel = level;
    this.clearError();
    this.stopActiveTimer();
    this.elapsedSeconds = 0;
    this.sessionSummary = { correct: 0, total: 0 };
    this.isLoading = true;

    const area = this.segmentArea('practice');
    if (area) {
      area.innerHTML = `
        <div class="tactile-card text-center py-12 text-muted">
          <span class="font-mono text-sm">Loading ${escapeHtml(level)} practice questions from bank...</span>
        </div>
      `;
    }

    try {
      const session = await studyClient.createPracticeSession({
        level,
        question_count: count,
        format_code: formatCode,
        category,
        session_type: this.selectedSessionType,
        ...(this.selectedSessionType === 'weak_area' ? { target_weak_areas: true } : {}),
        ...((this.bookmarkedOnly || this.selectedSessionType === 'bookmarked') ? { bookmarked_only: true } : {}),
        ...(['trouble', 'review'].includes(this.selectedSessionType) ? { incorrect_only: true } : {})
      });
      const items = session?.items || [];

      if (!items || items.length === 0) {
        this.renderEmptyState(level, `No eligible questions found in study.db for level ${level}.`);
        return;
      }

      this.sessionId = session.session_id || session.external_id;
      writeStoredSession('kiroku.active.practice', {
        session_id: this.sessionId,
        status: session.status || 'active',
        level,
        started_at: session.started_at
      });
      this.practiceItems = items;
      this.currentQuestionIndex = 0;
      this.hasAnswered = false;

      this.sessionStore = new StudySessionStore({
        sessionId: this.sessionId,
        sessionType: this.selectedSessionType,
        items: this.practiceItems,
        currentIndex: 0,
        autoPersist: true
      });

      this.startActiveTimer();
      this.renderQuestion();
    } catch (err) {
      console.warn('[Study] Create practice session failed:', err);
      this.renderEmptyState(level, err.message || 'Unable to connect to Study API.');
      this.showError('Practice session error: ' + (err.message || 'Check backend status'));
    } finally {
      this.isLoading = false;
    }
  }

  getPracticeCategories() {
    const formats = this.cachedBankSummary?.levels?.[this.activeLevel]?.formats || [];
    return ['all', ...new Set(formats.map(item => item.category).filter(Boolean))];
  }

  getPracticeFormats() {
    const formats = this.cachedBankSummary?.levels?.[this.activeLevel]?.formats || [];
    const filtered = this.selectedCategory && this.selectedCategory !== 'all'
      ? formats.filter(item => item.category === this.selectedCategory)
      : formats;
    return ['all', ...new Set(filtered.map(item => item.format_code).filter(Boolean))];
  }

  async restoreActiveSessionOrSetup() {
    const storedPractice = readStoredSession('kiroku.active.practice');
    const storedExam = readStoredSession('kiroku.active.exam');
    const recovery = decideSessionRecovery({ practice: storedPractice, exam: storedExam });
    if (recovery.action === 'ignore_stale') {
      clearStoredSession(recovery.type === 'practice' ? 'kiroku.active.practice' : 'kiroku.active.exam');
    }
    if (recovery.action !== 'offer') {
      this.renderSetupChooser();
      return;
    }

    this.renderSetupChooser(recovery);
    document.getElementById('btn-resume-session')?.addEventListener('click', () => {
      if (recovery.type === 'exam') {
        writeStoredSession('kiroku.resume.exam', recovery.session);
        this.router.navigateToTab('test');
      } else {
        this.resumePracticeSession(recovery.session);
      }
    });
    document.getElementById('btn-abandon-session')?.addEventListener('click', async () => {
      try {
        if (recovery.type === 'practice') {
          await studyClient.abandonPracticeSession(recovery.session.session_id || recovery.session.external_id);
        }
        clearStoredSession(recovery.type === 'practice' ? 'kiroku.active.practice' : 'kiroku.active.exam');
        this.renderSetupChooser();
      } catch (err) {
        this.showError(`Unable to abandon session: ${err.message || 'Study API error'}`);
      }
    });
  }

  async resumePracticeSession(stored) {
    try {
      const session = await studyClient.getPracticeSession(stored.session_id || stored.external_id);
      this.sessionId = session.session_id || session.external_id;
      this.practiceItems = session.items || [];
      this.currentQuestionIndex = Math.min(Number(session.current_position) || 0, Math.max(0, this.practiceItems.length - 1));
      this.activeLevel = session.level || stored.level || this.activeLevel;
      this.elapsedSeconds = Math.floor((Number(session.total_elapsed_ms) || 0) / 1000);

      this.sessionStore = new StudySessionStore({
        sessionId: this.sessionId,
        sessionType: stored.session_type || 'practice',
        items: this.practiceItems,
        currentIndex: this.currentQuestionIndex,
        autoPersist: true
      });

      this.startActiveTimer();
      this.renderQuestion();
    } catch (err) {
      clearStoredSession('kiroku.active.practice');
      this.showError(`Unable to resume practice session: ${err.message || 'Study API error'}`);
      this.renderSetupChooser();
    }
  }

  renderEmptyState(level, message) {
    const area = this.segmentArea('practice');
    if (!area) return;

    area.innerHTML = `
      <div class="study-empty-state tactile-card text-center py-10">
        <h2 class="study-empty-title">Question Bank Offline or Empty</h2>
        <p class="text-secondary text-sm max-w-md mx-auto mb-4">
          ${escapeHtml(message)}
        </p>
        <div class="text-xs text-muted mb-4">
          Select a JLPT level to start drilling:
        </div>
        <div class="study-level-picker" id="study-level-picker">
          ${['N5', 'N4', 'N3', 'N2', 'N1'].map((lvl) => `
            <button
              type="button"
              class="tactile-btn tactile-btn-sm ${lvl === level ? 'tactile-btn-primary' : ''} btn-select-study-level"
              data-level="${lvl}"
            >${lvl}</button>
          `).join('')}
        </div>
        <div class="mt-5">
          <button type="button" class="tactile-btn tactile-btn-sm" id="btn-empty-state-back">Back to Study</button>
        </div>
      </div>
    `;

    document.getElementById('btn-empty-state-back')?.addEventListener('click', () => {
      this.renderSetupChooser();
    });

    area.querySelectorAll('.btn-select-study-level').forEach((btn) => {
      btn.addEventListener('click', () => {
        const selectedLevel = btn.dataset.level;
        this.loadPracticeSession(selectedLevel);
      });
    });
  }

  renderQuestion() {
    const area = this.segmentArea('practice');
    if (!area) return;

    const item = this.sessionStore ? this.sessionStore.currentQuestion : this.practiceItems[this.currentQuestionIndex];
    if (!item) {
      this.renderCompleteState();
      return;
    }

    this.hasAnswered = false;
    this.questionStartTime = Date.now();

    const displayIdx = this.sessionStore ? this.sessionStore.displayIndex : (this.currentQuestionIndex + 1);
    const totalCount = this.sessionStore ? this.sessionStore.totalCount : this.practiceItems.length;
    const progressPercent = this.sessionStore ? this.sessionStore.progressPercent : Math.round((displayIdx / totalCount) * 100);
    const qId = item.id || item.ulid || item.question_id;
    const isGhost = this.sessionStore ? this.sessionStore.isGhost(qId) : false;

    const level = item.level || this.activeLevel;
    const category = item.category || 'Practice';
    const format = item.format_code || item.structural_family || 'Objective';
    const formattedCategory = formatQuestionType(category);
    const formattedFormat = formatQuestionType(format);
    const passageText = extractPassageContent(item);

    // Revoke previous blob URLs
    this.activeBlobUrls.forEach(url => studyClient.revokeMediaBlobUrl(url));
    this.activeBlobUrls = [];

    const promptText = item.prompt_markup || item.instruction_text || 'Select the correct answer:';
    const choices = Array.isArray(item.choices) ? item.choices : [];

    const audioAssetId = item.audio_url || item.group_context?.audio_url || item.audio_asset_id || item.media_asset_id || item.listening_audio_asset_id || (item.assets?.find(a => a.role === 'audio' || a.asset_type === 'audio')?.asset_id);
    const diagramAssetId = item.diagram_url || item.illustration_url || item.diagram_asset_id || item.image_asset_id || (item.assets?.find(a => a.role === 'diagram' || a.asset_type === 'image')?.asset_id);
    const reportQuestionId = item.question_id ?? item.id ?? null;

    area.innerHTML = `
      <div class="study-drill-stage">
        <!-- Drill Session Header Bar -->
        <div class="study-header-bar tactile-card">
          <div class="study-header-left">
            <button type="button" class="tactile-btn tactile-btn-sm" id="btn-exit-drill">Exit</button>
            <span class="tactile-pill tactile-pill-gold">${escapeHtml(level)} · ${escapeHtml(formattedCategory)}</span>
            <span class="study-question-count font-mono">Question ${displayIdx} of ${totalCount}</span>
            ${reportQuestionId !== null ? `<button type="button" class="tactile-btn tactile-btn-sm study-flag-question" id="btn-flag-question">Flag</button>` : ''}
          </div>
          <div class="study-timer font-mono text-sm" id="study-active-timer">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="vertical-align: -2px; margin-right: 4px;"><path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.962 8.962 0 0 0 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9a8.994 8.994 0 0 0 7.03-14.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>Active: <span id="study-timer-val">${this.formatTimer(this.elapsedSeconds)}</span>
          </div>
        </div>

        <!-- Animated Session Progress Bar -->
        <div class="study-session-progress-container" aria-hidden="true">
          <div class="study-session-progress-fill" style="width: ${progressPercent}%;"></div>
        </div>

        <div class="study-drill-workspace ${passageText ? 'has-passage' : ''}">
          <!-- Reading Passage Pane if question belongs to a passage group -->
          ${passageText ? `
            <div class="study-passage-pane surface-pitch-black tactile-card">
              <div class="passage-header-row mb-2">
                <span class="passage-title font-mono text-xs text-gold uppercase tracking-wider">Reading Passage</span>
              </div>
              <div class="passage-body-content text-base leading-relaxed font-japanese text-warm-paper">
                ${passageText}
              </div>
            </div>
          ` : ''}

          <div class="study-drill-main">
            <!-- Question Prompt Card (Pitch-Black) -->
            <div class="study-prompt-card surface-pitch-black tactile-card">
              <div class="study-prompt-header">
                <span class="font-mono text-xs text-gold uppercase tracking-wider">${escapeHtml(formattedFormat)}</span>
                <span class="text-xs text-muted font-mono">Q${displayIdx}</span>
              </div>
              <h2 class="study-prompt-text font-japanese" id="study-prompt-ja">
                ${item.prompt_markup ? renderStudyText(item, 'prompt_markup', 'prompt_html') : escapeHtml(promptText)}
              </h2>

              <!-- Media Streaming Containers -->
              <div id="study-audio-container" class="mt-3" style="display: none;"></div>
              <div id="study-diagram-container" class="mt-3" style="display: none;"></div>
            </div>

            <!-- Interactive Tactile Choice Buttons (1-4) -->
            <div class="study-choices-grid" id="study-choices-grid" role="radiogroup" aria-label="Practice Choices">
              ${choices.map((choice, i) => {
                const cid = choice.choice_id || choice.id || String(i + 1);
                const cText = choice.text_markup || choice.text || String(choice);
                return `
                  <button
                    type="button"
                    class="study-choice-btn tactile-btn tactile-card-interactive"
                    data-choice-id="${escapeHtml(String(cid))}"
                    data-index="${i}"
                    role="radio"
                    aria-checked="false"
                    tabindex="0"
                  >
                    <span class="choice-num font-mono">${i + 1}</span>
                    <span class="choice-text font-japanese">${choice.text_markup ? renderStudyText(choice) : escapeHtml(cText)}</span>
                  </button>
                `;
              }).join('')}
            </div>

            <!-- Objective Grading Feedback Banner (Hidden until answered) -->
            <div class="grading-feedback-banner tactile-card" id="grading-banner" role="status" aria-live="polite" style="display: none;">
              <div class="grading-feedback-content">
                <span class="grading-status-icon" id="grading-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>
                <div class="grading-text-block">
                  <span class="grading-verdict" id="grading-verdict">--</span>
                  <span class="grading-points text-xs font-mono" id="grading-time-spent">--</span>
                </div>
                <div class="ml-auto flex items-center gap-2">
                  <button type="button" class="tactile-btn tactile-btn-sm btn-ghost-toggle ${isGhost ? 'is-ghost-active' : ''}" id="btn-ghost-toggle" title="Shortcut: G">
                    <span>${isGhost ? 'Flagged for Drill' : 'Flag as Ghost / Mistake'} [G]</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Post-Answer Actions & Optional Explanation Card (Reveals on answer) -->
            <div class="pedagogical-explanation-card tactile-card" id="explanation-card" style="display: none;">
              <div class="explanation-header mb-2 flex items-center justify-between" id="explanation-header" style="display: none;">
                <span class="explanation-title font-bold text-gold">Explanation</span>
                <span class="text-xs font-mono text-muted">Pass/Fail Recorded</span>
              </div>
              <div class="explanation-text text-sm leading-relaxed text-secondary mb-4" id="explanation-text" style="display: none;"></div>

              <div class="study-post-answer-bar">
                <!-- Adaptive Repetition Rating Bar (Easy, Normal, Hard) -->
                <div class="adaptive-rating-section">
                  <span class="rating-label text-xs font-mono text-muted uppercase block mb-2">Rate Difficulty:</span>
                  <div class="rating-buttons-row flex gap-2" id="rating-buttons-row">
                    <button type="button" class="tactile-btn tactile-btn-sm btn-rate-difficulty" data-rating="Easy">
                      <span>Easy [1]</span>
                    </button>
                    <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary btn-rate-difficulty" data-rating="Normal">
                      <span>Normal [2]</span>
                    </button>
                    <button type="button" class="tactile-btn tactile-btn-sm btn-rate-difficulty" data-rating="Hard">
                      <span>Hard [3]</span>
                    </button>
                  </div>
                </div>

                <!-- Next Question Advance Button -->
                <div class="next-question-row">
                  <button class="tactile-btn tactile-btn-primary study-next-btn" id="btn-next-question">
                    <span>Next Question [Space / Enter]</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Stream audio track if present
    if (audioAssetId) {
      studyClient.getMediaBlobUrl(audioAssetId).then((audioUrl) => {
        if (!audioUrl) return;
        this.activeBlobUrls.push(audioUrl);
        const container = document.getElementById('study-audio-container');
        if (container) {
          container.style.display = 'block';
          container.innerHTML = `
            <div class="choukai-audio-box tactile-card surface-pitch-black p-2 flex items-center justify-between">
              <div>
                <span class="text-xs font-mono text-gold block">Listening Track</span>
                <audio id="study-audio-player" controls class="w-full mt-1" src="${audioUrl}"></audio>
              </div>
              <button type="button" class="tactile-btn tactile-btn-sm ml-3" id="btn-replay-audio" title="Shortcut: R">
                Replay [R]
              </button>
            </div>
          `;
          document.getElementById('btn-replay-audio')?.addEventListener('click', () => {
            const player = document.getElementById('study-audio-player');
            if (player) {
              player.currentTime = 0;
              player.play().catch(e => console.debug('[Study] Audio play error:', e));
            }
          });
        }
      }).catch((e) => console.debug('[Study] Audio stream error:', e.message));
    }

    if (diagramAssetId) {
      studyClient.getMediaBlobUrl(diagramAssetId).then((diagramUrl) => {
        if (!diagramUrl) return;
        this.activeBlobUrls.push(diagramUrl);
        const container = document.getElementById('study-diagram-container');
        if (container) {
          container.style.display = 'block';
          container.innerHTML = `<div class="study-diagram-frame"><img src="${diagramUrl}" alt="Question diagram" class="study-diagram-img" /></div>`;
        }
      }).catch((e) => console.debug('[Study] Diagram stream error:', e.message));
    }

    // Attach choice listeners
    const choiceButtons = area.querySelectorAll('.study-choice-btn');
    choiceButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.hasAnswered) return;
        const choiceId = btn.dataset.choiceId;
        this.submitAnswer(item, choiceId, btn);
      });
    });

    // Advance button listener
    const btnNext = document.getElementById('btn-next-question');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        this.advanceNextQuestion();
      });
    }

    // Exit drill listener
    document.getElementById('btn-exit-drill')?.addEventListener('click', () => {
      this.stopActiveTimer();
      this.activeBlobUrls.forEach(url => studyClient.revokeMediaBlobUrl(url));
      this.activeBlobUrls = [];
      clearStoredSession('kiroku.active.practice');
      this.sessionStore = null;
      this.practiceItems = [];
      this.renderSetupChooser();
    });

    // In-drill report flag
    document.getElementById('btn-flag-question')?.addEventListener('click', () => {
      this.openReportDrawer(reportQuestionId);
    });

    // Bunpro-style Ghost toggle listener
    const btnGhost = document.getElementById('btn-ghost-toggle');
    if (btnGhost) {
      btnGhost.addEventListener('click', () => {
        if (!this.sessionStore) return;
        const nowGhost = this.sessionStore.toggleGhost(qId);
        btnGhost.classList.toggle('is-ghost-active', nowGhost);
        const span = btnGhost.querySelector('span');
        if (span) span.textContent = nowGhost ? 'Flagged for Drill [G]' : 'Flag as Ghost / Mistake [G]';
      });
    }

    // Rating buttons listeners
    area.querySelectorAll('.btn-rate-difficulty').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const rating = e.currentTarget.dataset.rating;
        area.querySelectorAll('.btn-rate-difficulty').forEach((b) => b.classList.remove('is-selected-rating'));
        e.currentTarget.classList.add('is-selected-rating');

        try {
          await studyClient.recordPracticeFeedback(this.sessionId, {
            attempt_item_id: item.attempt_item_id,
            difficulty_rating: rating
          });
        } catch (err) {
          console.warn('[Study] Record feedback error:', err.message);
        }
      });
    });
  }

  async submitAnswer(item, choiceId, selectedBtn) {
    this.hasAnswered = true;
    const timeSpentMs = Math.max(500, Date.now() - this.questionStartTime);

    const choices = this.container.querySelectorAll('.study-choice-btn');
    choices.forEach((btn) => {
      btn.disabled = true;
    });

    try {
      const result = await studyClient.submitPracticeAnswer(this.sessionId, {
        attempt_item_id: item.attempt_item_id,
        selected_choice_id: choiceId,
        time_spent_ms: timeSpentMs
      });

      const isCorrect = Boolean(result?.is_correct);
      const canonicalId = result?.canonical_choice_id ? String(result.canonical_choice_id) : null;
      const explanation = result?.explanation_markup ? String(result.explanation_markup).trim() : '';

      if (isCorrect) {
        this.sessionSummary.correct += 1;
      }
      this.sessionSummary.total += 1;

      if (this.sessionStore) {
        this.sessionStore.markGraded({
          is_correct: isCorrect,
          canonical_id: canonicalId,
          explanation
        });
      }

      choices.forEach((btn) => {
        const cid = String(btn.dataset.choiceId);
        const isSelected = cid === String(choiceId);
        btn.setAttribute('aria-checked', String(isSelected));
        if (canonicalId && cid === canonicalId) {
          btn.classList.add('is-choice-correct');
        } else if (isSelected) {
          btn.classList.add(isCorrect ? 'is-choice-correct' : 'is-choice-wrong');
        }
      });

      const banner = document.getElementById('grading-banner');
      const icon = document.getElementById('grading-icon');
      const verdict = document.getElementById('grading-verdict');
      const timeTag = document.getElementById('grading-time-spent');

      if (banner && icon && verdict) {
        banner.style.display = 'block';
        banner.className = `grading-feedback-banner tactile-card ${isCorrect ? 'banner-correct' : 'banner-incorrect'}`;
        icon.innerHTML = isCorrect
          ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
          : '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
        verdict.textContent = isCorrect ? 'Correct' : 'Incorrect';
        if (timeTag) {
          timeTag.textContent = `${(timeSpentMs / 1000).toFixed(1)}s response time`;
        }
      }

      const expCard = document.getElementById('explanation-card');
      const expHeader = document.getElementById('explanation-header');
      const expText = document.getElementById('explanation-text');
      if (expCard) {
        if (expText && explanation) {
          expText.innerHTML = sanitizePromptMarkup(explanation);
          expText.style.display = 'block';
          if (expHeader) expHeader.style.display = 'flex';
        } else {
          if (expText) {
            expText.innerHTML = '';
            expText.style.display = 'none';
          }
          if (expHeader) expHeader.style.display = 'none';
        }
        expCard.style.display = 'block';
      }
    } catch (err) {
      console.error('[Study] Submit answer error:', err);
      this.showError('Grading failed: ' + (err.message || 'Network error'));
    }
  }

  advanceNextQuestion() {
    if (this.sessionStore) {
      const hasMore = this.sessionStore.nextQuestion();
      if (!hasMore) {
        this.renderCompleteState();
      } else {
        this.currentQuestionIndex = this.sessionStore.currentIndex;
        this.renderQuestion();
      }
    } else {
      this.currentQuestionIndex += 1;
      if (this.currentQuestionIndex >= this.practiceItems.length) {
        this.renderCompleteState();
      } else {
        this.renderQuestion();
      }
    }
  }

  async renderCompleteState() {
    this.stopActiveTimer();
    const area = this.segmentArea('practice');
    if (!area) return;

    if (this.sessionStore) {
      this.sessionStore.clearCheckpoint();
    }

    if (this.sessionId) {
      try {
        await studyClient.completePracticeSession(this.sessionId);
      } catch (err) {
        console.warn('[Study] Complete session error:', err.message);
      }
      clearStoredSession('kiroku.active.practice');
    }

    this.sessionId = null;
    this.practiceItems = [];
    this.sessionStore = null;
    this.hasAnswered = false;

    const { correct, total } = this.sessionSummary;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

    area.innerHTML = `
      <div class="study-complete-card tactile-card text-center py-10">
        <h2 class="study-complete-title font-display text-2xl font-bold mb-2">Practice Drill Complete!</h2>
        <p class="text-secondary text-sm mb-6 max-w-lg mx-auto">
          Honest diagnostic practice result. Your responses have been recorded for spaced repetition review.
        </p>

        <div class="flex justify-center gap-6 my-6 flex-wrap">
          <div class="tactile-card p-4 min-w-[120px]">
            <span class="text-xs text-muted block uppercase font-mono">Questions</span>
            <span class="font-mono text-2xl font-bold text-warm-paper">${total}</span>
          </div>
          <div class="tactile-card p-4 min-w-[120px]">
            <span class="text-xs text-muted block uppercase font-mono">Score</span>
            <span class="font-mono text-2xl font-bold text-gold">${correct} / ${total}</span>
          </div>
          <div class="tactile-card p-4 min-w-[120px]">
            <span class="text-xs text-muted block uppercase font-mono">Accuracy</span>
            <span class="font-mono text-2xl font-bold text-warm-paper">${accuracy}%</span>
          </div>
        </div>

        <div class="study-level-picker mt-8">
          <button type="button" class="tactile-btn" id="btn-complete-back-study">Back to Study</button>
          <button type="button" class="tactile-btn tactile-btn-primary" id="btn-restart-study">
            <span>Start New Drill (${escapeHtml(this.activeLevel)})</span>
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-complete-back-study')?.addEventListener('click', () => {
      this.renderSetupChooser();
    });
    document.getElementById('btn-restart-study')?.addEventListener('click', () => {
      this.renderJlptSetup();
    });
  }

  startActiveTimer() {
    this.stopActiveTimer();
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds += 1;
      const timerEl = document.getElementById('study-active-timer');
      if (timerEl) {
        const valEl = document.getElementById('study-timer-val');
        if (valEl) {
          valEl.textContent = this.formatTimer(this.elapsedSeconds);
        } else {
          timerEl.textContent = `Active: ${this.formatTimer(this.elapsedSeconds)}`;
        }
      }
    }, 1000);
  }

  stopActiveTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  formatTimer(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  wireModeCards() {
    const area = this.segmentArea('practice');
    if (!area) return;

    area.querySelectorAll('.burst-size-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.burstMode;
        const size = parseInt(btn.dataset.burstSize, 10) === 10 ? 10 : 5;
        if (mode) {
          this.burstSizes[mode] = size;
          const slot = document.getElementById('study-modes-slot');
          if (slot) {
            slot.innerHTML = renderStudyModeCards({
              scrambleSize: this.burstSizes.sentence_scramble,
              shadowingSize: this.burstSizes.audio_shadowing,
              showJlptPanel: this.showJlptSetup,
              bankSummary: this.cachedBankSummary,
              activeLevel: this.activeLevel
            });
            this.wireModeCards();
          }
        }
      });
    });

    document.getElementById('btn-start-scramble-burst')?.addEventListener('click', () => {
      this.startBurstSession('sentence_scramble', this.burstSizes.sentence_scramble);
    });
    document.getElementById('btn-start-shadowing-burst')?.addEventListener('click', () => {
      this.startBurstSession('audio_shadowing', this.burstSizes.audio_shadowing);
    });
    document.getElementById('btn-open-jlpt-bank-mode')?.addEventListener('click', () => {
      this.showJlptSetup = !this.showJlptSetup;
      const panel = document.getElementById('jlpt-drill-setup-panel');
      const toggleBtn = document.getElementById('btn-open-jlpt-bank-mode');
      const bankCard = area.querySelector('[data-study-mode="jlpt_bank"]');
      if (panel) panel.hidden = !this.showJlptSetup;
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', String(this.showJlptSetup));
        toggleBtn.textContent = this.showJlptSetup ? 'Hide JLPT Drill Setup' : 'Configure JLPT Drill';
      }
      if (bankCard) bankCard.classList.toggle('is-selected', this.showJlptSetup);
    });
  }

  async refreshWeeklyConsistency() {
    try {
      const data = await apiClient.getStudyModesConsistency();
      this.cachedConsistency = data;
      const slot = document.getElementById('study-consistency-slot');
      if (slot) {
        slot.innerHTML = renderWeeklyConsistencyBar(data);
      }
    } catch (err) {
      console.debug('[Study] Weekly consistency lookup failed:', err.message);
      const slot = document.getElementById('study-consistency-slot');
      if (slot && !this.cachedConsistency) {
        slot.innerHTML = renderWeeklyConsistencyBar({
          days: [],
          active_days: 0,
          window_days: 7,
          total_bursts_7d: 0
        });
      }
    }
  }

  stopBurstAudio() {
    const audioEl = this.container?.querySelector('#shadowing-audio-el') || document.getElementById('shadowing-audio-el');
    if (!audioEl) return;
    const hasSrc = Boolean(audioEl.src || (typeof audioEl.getAttribute === 'function' && audioEl.getAttribute('src')));
    if (!hasSrc) return;
    try {
      if (typeof audioEl.pause === 'function') {
        audioEl.pause();
      }
      audioEl.currentTime = 0;
      if (typeof audioEl.removeAttribute === 'function') {
        audioEl.removeAttribute('src');
      }
      audioEl.src = '';
      if (typeof audioEl.load === 'function') {
        audioEl.load();
      }
    } catch (err) {
      console.debug('[Study] Audio cleanup skipped:', err?.message || err);
    }
  }

  async startBurstSession(mode, targetCount = 5) {
    this.clearError();
    this.stopActiveTimer();
    this.stopBurstAudio();
    const area = this.segmentArea('practice');
    if (!area) return;

    area.innerHTML = `
      <div class="tactile-card text-center py-12 text-muted">
        <span class="font-mono text-sm">Preparing ${targetCount}-item burst...</span>
      </div>
    `;

    try {
      if (!this.backendInfo) {
        this.backendInfo = await apiClient.getBackendInfo();
      }
      const session = await apiClient.startStudyModeSession(mode, targetCount);
      const items = Array.isArray(session?.items) ? session.items : [];
      if (!session?.session_id || items.length === 0) {
        this.activeBurst = null;
        area.innerHTML = renderBurstEmptyState({ mode });
        document.getElementById('btn-empty-back-to-study')?.addEventListener('click', () => {
          this.exitBurstToStudy();
        });
        return;
      }

      this.activeBurst = {
        sessionId: session.session_id,
        mode,
        targetCount,
        items,
        currentIndex: 0,
        lastAutoPlayedIndex: -1,
        selectedTileIds: [],
        feedback: null,
        revealedData: null,
        isRevealing: false,
        isSubmitting: false
      };
      this.renderActiveBurst();
    } catch (err) {
      console.error('[Study] Start burst session error:', err);
      this.activeBurst = null;
      this.renderSetupChooser();
      this.showError('Burst session error: ' + (err.message || 'Unable to start burst'));
    }
  }

  renderActiveBurst() {
    const area = this.segmentArea('practice');
    const burst = this.activeBurst;
    if (!area || !burst) return;

    this.stopBurstAudio();

    const item = burst.items[burst.currentIndex];
    if (!item) {
      this.completeBurstSession();
      return;
    }

    if (burst.mode === 'sentence_scramble') {
      area.innerHTML = renderScrambleDrill({
        item,
        currentIndex: burst.currentIndex,
        totalCount: burst.items.length,
        selectedTileIds: burst.selectedTileIds,
        feedback: burst.feedback,
        isSubmitting: burst.isSubmitting
      });
      this.wireScrambleListeners();
    } else {
      const resolvedAudioUrl = resolveBurstMediaUrl(item.audio_url, this.backendInfo);
      area.innerHTML = renderShadowingDrill({
        item,
        currentIndex: burst.currentIndex,
        totalCount: burst.items.length,
        revealedData: burst.revealedData,
        resolvedAudioUrl,
        isRevealing: burst.isRevealing,
        isSubmitting: burst.isSubmitting
      });
      this.wireShadowingListeners(resolvedAudioUrl);
    }

    document.getElementById('btn-exit-burst')?.addEventListener('click', () => {
      this.exitBurstToStudy();
    });
  }

  wireScrambleListeners() {
    const burst = this.activeBurst;
    const area = this.segmentArea('practice');
    if (!burst || !area) return;

    area.querySelectorAll('.scramble-tile-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (burst.feedback || burst.isSubmitting) return;
        const tid = btn.dataset.tileId;
        if (tid && !burst.selectedTileIds.includes(tid)) {
          burst.selectedTileIds.push(tid);
          this.renderActiveBurst();
        }
      });
    });

    area.querySelectorAll('.scramble-placed-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (burst.feedback || burst.isSubmitting) return;
        const pos = parseInt(btn.dataset.placedPos, 10);
        if (!Number.isNaN(pos) && pos >= 0 && pos < burst.selectedTileIds.length) {
          burst.selectedTileIds.splice(pos, 1);
          this.renderActiveBurst();
        }
      });
    });

    document.getElementById('btn-scramble-undo')?.addEventListener('click', () => {
      if (burst.feedback || burst.selectedTileIds.length === 0) return;
      burst.selectedTileIds.pop();
      this.renderActiveBurst();
    });

    document.getElementById('btn-scramble-clear')?.addEventListener('click', () => {
      if (burst.feedback || burst.selectedTileIds.length === 0) return;
      burst.selectedTileIds = [];
      this.renderActiveBurst();
    });

    document.getElementById('btn-submit-scramble')?.addEventListener('click', () => {
      this.submitScrambleBurstAnswer();
    });

    document.getElementById('btn-next-burst-item')?.addEventListener('click', () => {
      this.advanceBurstItem();
    });
  }

  wireShadowingListeners(resolvedAudioUrl) {
    const burst = this.activeBurst;
    const audioEl = document.getElementById('shadowing-audio-el');
    if (
      audioEl &&
      resolvedAudioUrl &&
      burst &&
      !burst.revealedData &&
      burst.lastAutoPlayedIndex !== burst.currentIndex
    ) {
      burst.lastAutoPlayedIndex = burst.currentIndex;
      if (typeof audioEl.play === 'function') {
        const playResult = audioEl.play();
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch((err) => {
            console.debug('[Study] Shadowing autoplay blocked:', err?.message || err);
          });
        }
      }
    }

    document.getElementById('btn-replay-shadow-audio')?.addEventListener('click', () => {
      const el = document.getElementById('shadowing-audio-el');
      if (el && typeof el.play === 'function') {
        try {
          el.currentTime = 0;
        } catch (err) {
          console.debug('[Study] Audio reset skipped:', err?.message || err);
        }
        const res = el.play();
        if (res && typeof res.catch === 'function') {
          res.catch((err) => console.debug('[Study] Replay failed:', err?.message || err));
        }
      }
    });

    this.wireShadowingRevealListeners();
  }

  wireShadowingRevealListeners() {
    document.getElementById('btn-reveal-shadowing')?.addEventListener('click', () => {
      this.revealShadowingItem();
    });

    document.querySelectorAll('.btn-shadow-grade').forEach((btn) => {
      btn.addEventListener('click', () => {
        const grade = btn.dataset.grade;
        if (grade) this.submitShadowingBurstAnswer(grade);
      });
    });
  }

  updateShadowingRevealSlot() {
    const burst = this.activeBurst;
    const slot = document.getElementById('shadowing-reveal-slot');
    if (!burst || !slot) {
      this.renderActiveBurst();
      return;
    }
    slot.innerHTML = renderShadowingRevealSection({
      revealedData: burst.revealedData,
      isRevealing: burst.isRevealing,
      isSubmitting: burst.isSubmitting
    });
    this.wireShadowingRevealListeners();
  }

  async revealShadowingItem() {
    const burst = this.activeBurst;
    if (!burst || burst.mode !== 'audio_shadowing' || burst.revealedData || burst.isRevealing) return;
    burst.isRevealing = true;
    this.updateShadowingRevealSlot();

    try {
      const item = burst.items[burst.currentIndex];
      const revealed = await apiClient.revealStudyModeItem(burst.sessionId, item.item_index);
      burst.revealedData = revealed;
    } catch (err) {
      console.error('[Study] Reveal shadowing item error:', err);
      this.showError('Reveal failed: ' + (err.message || 'Unable to load transcript'));
    } finally {
      burst.isRevealing = false;
      this.updateShadowingRevealSlot();
    }
  }

  async submitScrambleBurstAnswer() {
    const burst = this.activeBurst;
    if (!burst || burst.mode !== 'sentence_scramble' || burst.feedback || burst.isSubmitting) return;
    if (burst.selectedTileIds.length === 0) return;

    burst.isSubmitting = true;
    this.renderActiveBurst();

    try {
      const item = burst.items[burst.currentIndex];
      const result = await apiClient.submitStudyModeAnswer(
        burst.sessionId,
        item.item_index,
        burst.selectedTileIds
      );
      burst.feedback = result;
    } catch (err) {
      console.error('[Study] Submit scramble answer error:', err);
      this.showError('Grading failed: ' + (err.message || 'Unable to submit order'));
    } finally {
      burst.isSubmitting = false;
      this.renderActiveBurst();
    }
  }

  async submitShadowingBurstAnswer(grade) {
    const burst = this.activeBurst;
    if (!burst || burst.mode !== 'audio_shadowing' || burst.isSubmitting) return;

    burst.isSubmitting = true;
    this.updateShadowingRevealSlot();

    try {
      const item = burst.items[burst.currentIndex];
      await apiClient.submitStudyModeAnswer(burst.sessionId, item.item_index, grade);
      burst.isSubmitting = false;
      await this.advanceBurstItem();
    } catch (err) {
      console.error('[Study] Submit shadowing grade error:', err);
      burst.isSubmitting = false;
      this.showError('Save grade failed: ' + (err.message || 'Unable to record self-grade'));
      this.updateShadowingRevealSlot();
    }
  }

  async advanceBurstItem() {
    const burst = this.activeBurst;
    if (!burst) return;
    this.stopBurstAudio();
    burst.currentIndex += 1;
    burst.selectedTileIds = [];
    burst.feedback = null;
    burst.revealedData = null;

    if (burst.currentIndex >= burst.items.length) {
      await this.completeBurstSession();
    } else {
      this.renderActiveBurst();
    }
  }

  async completeBurstSession() {
    const burst = this.activeBurst;
    const area = this.segmentArea('practice');
    if (!burst || !area) return;
    this.stopBurstAudio();

    try {
      const summary = await apiClient.completeStudyModeSession(burst.sessionId);
      if (summary?.consistency) {
        this.cachedConsistency = summary.consistency;
      }
      const mode = burst.mode;
      const targetCount = burst.targetCount;
      this.activeBurst = null;
      area.innerHTML = renderBurstCompleteState({ summary });
      document.getElementById('btn-burst-back-to-study')?.addEventListener('click', () => {
        this.renderSetupChooser();
      });
      document.getElementById('btn-burst-start-another')?.addEventListener('click', () => {
        this.startBurstSession(mode, targetCount);
      });
    } catch (err) {
      console.error('[Study] Complete burst session error:', err);
      this.renderSetupChooser();
      this.showError('Completion failed: ' + (err.message || 'Unable to finish burst'));
    }
  }

  exitBurstToStudy() {
    this.stopBurstAudio();
    this.activeBurst = null;
    this.renderSetupChooser();
  }

  handleBurstKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const burst = this.activeBurst;
    if (!burst || burst.isSubmitting || burst.isRevealing) return false;
    const item = burst.items[burst.currentIndex];
    if (!item) return false;

    if (burst.mode === 'sentence_scramble') {
      if (burst.feedback) {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.advanceBurstItem();
          return true;
        }
        return false;
      }

      if (/^[1-9]$/.test(e.key)) {
        const slotIndex = parseInt(e.key, 10) - 1;
        const tiles = Array.isArray(item.tiles) ? item.tiles : [];
        if (slotIndex < tiles.length) {
          e.preventDefault();
          const tileId = String(tiles[slotIndex].tile_id);
          if (!burst.selectedTileIds.includes(tileId)) {
            burst.selectedTileIds.push(tileId);
            this.renderActiveBurst();
          }
          return true;
        }
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        if (burst.selectedTileIds.length > 0) {
          burst.selectedTileIds.pop();
          this.renderActiveBurst();
        }
        return true;
      } else if (e.key === 'Enter' && burst.selectedTileIds.length > 0) {
        e.preventDefault();
        this.submitScrambleBurstAnswer();
        return true;
      }
      return false;
    }

    if (burst.mode === 'audio_shadowing') {
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        document.getElementById('btn-replay-shadow-audio')?.click();
        return true;
      }
      if (!burst.revealedData) {
        if (e.code === 'Space' || e.key === ' ') {
          e.preventDefault();
          this.revealShadowingItem();
          return true;
        }
      } else {
        if (e.key === '1') {
          e.preventDefault();
          this.submitShadowingBurstAnswer('missed');
          return true;
        }
        if (e.key === '2') {
          e.preventDefault();
          this.submitShadowingBurstAnswer('got_it');
          return true;
        }
      }
    }
    return false;
  }

  handleKeyDown(e) {
    if (e.key === 'Escape') {
      const drawer = document.getElementById('study-report-drawer');
      if (drawer?.classList.contains('is-open')) {
        e.preventDefault();
        this.closeReportDrawer();
        return;
      }
      const btnExitDrill = document.getElementById('btn-exit-drill');
      if (btnExitDrill) {
        e.preventDefault();
        btnExitDrill.click();
        return;
      }
    }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.activeSegment !== 'practice') return;
    if (this.activeBurst) {
      this.handleBurstKeyDown(e);
      return;
    }
    const item = this.practiceItems[this.currentQuestionIndex];
    if (!item) return;

    if (this.hasAnswered) {
      if (['1', '2', '3'].includes(e.key)) {
        e.preventDefault();
        const ratingMap = { '1': 'Easy', '2': 'Normal', '3': 'Hard' };
        const btn = this.container?.querySelector(`.btn-rate-difficulty[data-rating="${ratingMap[e.key]}"]`);
        if (btn) btn.click();
      } else if (e.key === 'Enter' || e.code === 'Space' || e.key === ' ') {
        const activeTag = document.activeElement?.tagName;
        const isFocusedControl = activeTag === 'BUTTON' || activeTag === 'A';
        if (isFocusedControl && document.activeElement?.id !== 'btn-next-question' && !document.activeElement?.classList.contains('study-choice-btn')) {
          return;
        }
        const btnNext = document.getElementById('btn-next-question');
        if (btnNext) {
          e.preventDefault();
          this.advanceNextQuestion();
        }
      } else if (e.key === 'g' || e.key === 'G') {
        const btnGhost = document.getElementById('btn-ghost-toggle');
        if (btnGhost) {
          e.preventDefault();
          btnGhost.click();
        }
      } else if (e.key === 'r' || e.key === 'R') {
        const btnReplay = document.getElementById('btn-replay-audio');
        if (btnReplay) {
          e.preventDefault();
          btnReplay.click();
        }
      }
    } else {
      if (e.key === 'r' || e.key === 'R') {
        const btnReplay = document.getElementById('btn-replay-audio');
        if (btnReplay) {
          e.preventDefault();
          btnReplay.click();
          return;
        }
      }
      const choiceNum = parseInt(e.key, 10);
      const choices = Array.isArray(item.choices) ? item.choices : [];
      if (!isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= choices.length) {
        e.preventDefault();
        const btn = this.container?.querySelector(`.study-choice-btn[data-index="${choiceNum - 1}"]`);
        if (btn) btn.click();
      }
    }
  }

  unmount() {
    this.onHide();
    this.stopActiveTimer();
    this.activeBurst = null;
    this.closeReportDrawer();
    if (this.activeBlobUrls && this.activeBlobUrls.length > 0) {
      this.activeBlobUrls.forEach(url => studyClient.revokeMediaBlobUrl(url));
      this.activeBlobUrls = [];
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
