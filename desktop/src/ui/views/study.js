/**
 * Kiroku Note Desktop — Study Practice Drill Engine View Controller
 * Practice drill lifecycle backed by live study.db question bank,
 * objective deterministic grading, pedagogical explanation, adaptive
 * repetition difficulty rating (Easy/Normal/Hard), universal JLPT level sync,
 * setup chooser with live question bank count, and honest diagnostic reports.
 */

import { studyClient } from '../services/study_client.js';
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
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  async mount(container) {
    this.container = container;
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
    this.stopActiveTimer();
    this.activeListenerCount = 0;
  }

  renderShell() {
    this.container.innerHTML = `
      <div class="study-view-wrapper">
        <div class="study-view-container" id="study-main-container">
          <!-- Visible Error Banner -->
          <div class="study-error-banner" id="study-error-banner" style="display: none;">
            <span class="error-msg" id="study-error-msg"></span>
            <button type="button" class="btn-dismiss-error" id="btn-dismiss-study-error" aria-label="Dismiss error">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>

          <!-- Dynamic Question Drill View Slot -->
          <div id="study-content-area">
            <div class="tactile-card text-center py-12 text-muted">
              <span class="font-mono text-sm">Loading practice setup...</span>
            </div>
          </div>

        </div>
      </div>
    `;

    const btnDismiss = document.getElementById('btn-dismiss-study-error');
    if (btnDismiss) {
      btnDismiss.addEventListener('click', () => this.clearError());
    }
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

  renderSetupChooser() {
    this.clearError();
    this.stopActiveTimer();
    const area = document.getElementById('study-content-area');
    if (!area) return;

    area.innerHTML = `
      <div class="study-setup-card tactile-card">
        <div class="setup-header-row mb-4">
          <div>
            <span class="font-mono text-xs text-gold uppercase tracking-wider">Practice Hub</span>
            <h2 class="text-xl font-bold text-warm-paper mt-1">Adaptive Drill Setup</h2>
            <p class="text-secondary text-sm">
              Custom targeted drills with objective grading, spaced repetition ratings, and pedagogical explanations.
            </p>
          </div>
        </div>

        <!-- Question Bank Live Status -->
        <div class="study-bank-info tactile-card surface-pitch-black p-3 mb-5">
          <div class="flex items-center justify-between">
            <span class="font-mono text-xs text-gold uppercase tracking-wider">Question Bank Status</span>
            <span class="font-mono text-xs text-muted" id="study-bank-stat">Querying bank readiness...</span>
          </div>
        </div>

        <!-- Target JLPT Level -->
        <div class="setup-field-group mb-5">
          <label class="text-xs font-mono text-muted uppercase block mb-2">Target JLPT Level</label>
          <div class="syllabus-level-pills" id="drill-level-pills" role="radiogroup" aria-label="Drill Level">
            ${['N5', 'N4', 'N3', 'N2', 'N1'].map(lvl => `
              <button
                type="button"
                class="tactile-pill drill-level-pill ${lvl === this.activeLevel ? 'is-active tactile-pill-gold' : ''}"
                data-level="${lvl}"
              >${lvl}</button>
            `).join('')}
          </div>
        </div>

        <!-- Drill Mode -->
        <div class="setup-field-group mb-5">
          <label class="text-xs font-mono text-muted uppercase block mb-2">Drill Mode</label>
          <div class="drill-mode-pills flex gap-2 flex-wrap" id="drill-mode-pills">
            <button type="button" class="tactile-pill drill-mode-pill ${this.selectedSessionType === 'practice' ? 'is-active tactile-pill-gold' : ''}" data-mode="practice">Fresh Questions</button>
            <button type="button" class="tactile-pill drill-mode-pill ${this.selectedSessionType === 'weak_area' ? 'is-active tactile-pill-gold' : ''}" data-mode="weak_area">Weak Spots</button>
            <button type="button" class="tactile-pill drill-mode-pill ${this.selectedSessionType === 'bookmarked' ? 'is-active tactile-pill-gold' : ''}" data-mode="bookmarked">Bookmarked</button>
            <button type="button" class="tactile-pill drill-mode-pill ${this.selectedSessionType === 'trouble' ? 'is-active tactile-pill-gold' : ''}" data-mode="trouble">Mistakes Review</button>
          </div>
        </div>

        <div class="setup-field-group mb-5">
          <label class="text-xs font-mono text-muted uppercase block mb-2">Category</label>
          <div class="drill-category-pills flex gap-2 flex-wrap" id="drill-category-pills">
            ${this.getPracticeCategories().map(category => `
              <button type="button" class="tactile-pill drill-category-pill ${this.selectedCategory === category ? 'is-active tactile-pill-gold' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category === 'all' ? 'All Categories' : category)}</button>
            `).join('')}
          </div>
        </div>

        <div class="setup-field-group mb-5">
          <label class="text-xs font-mono text-muted uppercase block mb-2">Format</label>
          <div class="drill-format-pills flex gap-2 flex-wrap" id="drill-format-pills">
            ${this.getPracticeFormats().map(format => `
              <button type="button" class="tactile-pill drill-format-pill ${this.selectedFormatCode === format ? 'is-active tactile-pill-gold' : ''}" data-format="${escapeHtml(format)}">${escapeHtml(format === 'all' ? 'All Formats' : format)}</button>
            `).join('')}
          </div>
          <div class="text-xs text-muted mt-2" id="study-eligible-count"></div>
        </div>

        <!-- Question Count -->
        <div class="setup-field-group mb-6">
          <label class="text-xs font-mono text-muted uppercase block mb-2">Question Count</label>
          <div class="drill-count-pills flex gap-2" id="drill-count-pills">
            ${[5, 10, 20].map(cnt => `
              <button
                type="button"
                class="tactile-pill drill-count-pill ${cnt === this.selectedCount ? 'is-active tactile-pill-gold' : ''}"
                data-count="${cnt}"
              >${cnt} Questions</button>
            `).join('')}
          </div>
        </div>

        <!-- Start Action -->
        <div class="setup-action-row pt-2">
          <button type="button" class="tactile-btn tactile-btn-primary w-full" id="btn-start-practice">
            <span>Start Practice Drill (${escapeHtml(this.activeLevel)})</span>
          </button>
          <button type="button" class="tactile-btn w-full mt-2" id="btn-open-mistakes">
            Open Mistakes Notebook
          </button>
          <button type="button" class="tactile-btn w-full mt-2" id="btn-open-bank">
            Browse Question Bank
          </button>
        </div>
      </div>
    `;

    // Query live bank count
    this.updateBankSummaryDisplay();

    // Wire level pill selectors
    area.querySelectorAll('.drill-level-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        area.querySelectorAll('.drill-level-pill').forEach(b => b.classList.remove('is-active', 'tactile-pill-gold'));
        btn.classList.add('is-active', 'tactile-pill-gold');
        this.activeLevel = btn.dataset.level;
        const btnStart = document.getElementById('btn-start-practice');
        if (btnStart) {
          btnStart.querySelector('span').textContent = `Start Practice Drill (${this.activeLevel})`;
        }
        this.updateBankSummaryDisplay();
      });
    });

    // Wire mode pills
    area.querySelectorAll('.drill-mode-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        area.querySelectorAll('.drill-mode-pill').forEach(b => b.classList.remove('is-active', 'tactile-pill-gold'));
        btn.classList.add('is-active', 'tactile-pill-gold');
        this.selectedSessionType = btn.dataset.mode;
      });
    });

    // Wire count pills
    area.querySelectorAll('.drill-count-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        area.querySelectorAll('.drill-count-pill').forEach(b => b.classList.remove('is-active', 'tactile-pill-gold'));
        btn.classList.add('is-active', 'tactile-pill-gold');
        this.selectedCount = parseInt(btn.dataset.count, 10) || 10;
      });
    });

    area.querySelectorAll('.drill-category-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        area.querySelectorAll('.drill-category-pill').forEach(b => b.classList.remove('is-active', 'tactile-pill-gold'));
        btn.classList.add('is-active', 'tactile-pill-gold');
        this.selectedCategory = btn.dataset.category;
        this.updateBankSummaryDisplay();
      });
    });

    area.querySelectorAll('.drill-format-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        area.querySelectorAll('.drill-format-pill').forEach(b => b.classList.remove('is-active', 'tactile-pill-gold'));
        btn.classList.add('is-active', 'tactile-pill-gold');
        this.selectedFormatCode = btn.dataset.format;
        this.updateBankSummaryDisplay();
      });
    });

    // Start practice button
    const btnStart = document.getElementById('btn-start-practice');
    if (btnStart) {
      btnStart.addEventListener('click', () => {
        this.loadPracticeSession(
          this.activeLevel,
          this.selectedCount,
          this.selectedFormatCode === 'all' ? null : this.selectedFormatCode,
          this.selectedCategory === 'all' ? null : this.selectedCategory
        );
      });
    }
    const btnMistakes = document.getElementById('btn-open-mistakes');
    if (btnMistakes) {
      btnMistakes.addEventListener('click', () => this.loadMistakesNotebook());
    }
    document.getElementById('btn-open-bank')?.addEventListener('click', () => this.loadQuestionBank());
  }

  async loadQuestionBank(filters = {}, page = 1) {
    const area = document.getElementById('study-content-area');
    if (!area) return;
    area.innerHTML = '<div class="tactile-card text-center py-12 text-muted"><span class="font-mono text-sm">Loading question bank...</span></div>';
    try {
      const response = await studyClient.searchQuestions({
        level: filters.level || undefined,
        format_code: filters.format || undefined,
        verification_status: filters.status || undefined,
        limit: 10,
        offset: (Math.max(1, page) - 1) * 10
      });
      this.renderQuestionBank(response?.items || [], filters, response?.total, page);
    } catch (err) {
      console.error('[Study] Question bank error:', err);
      this.showError('Question bank failed: ' + (err.message || 'Unable to load questions'));
      this.renderSetupChooser();
    }
  }

  renderQuestionBank(items, filters = {}, totalFromApi = null, page = 1) {
    const area = document.getElementById('study-content-area');
    if (!area) return;
    const formats = [...new Set(items.map((item) => item.format_code).filter(Boolean))].sort();
    const statuses = [...new Set(items.map((item) => item.verification_status).filter(Boolean))].sort();
    const filtered = filterBankQuestions(items, filters);
    const pageData = getBankPage(filtered, 1, 10);
    const total = Number.isFinite(Number(totalFromApi)) ? Number(totalFromApi) : pageData.total;
    const pageCount = Math.max(1, Math.ceil(total / 10));
    const currentPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
    area.innerHTML = `
      <div class="study-bank-card tactile-card">
        <div class="flex items-center justify-between gap-3 mb-4">
          <div>
            <span class="font-mono text-xs text-gold uppercase tracking-wider">Study</span>
            <h2 class="text-xl font-bold text-warm-paper mt-1">Question Bank</h2>
            <p class="text-secondary text-sm">Find questions and report defective content. Revisions remain sealed.</p>
          </div>
          <button type="button" class="tactile-btn tactile-btn-sm" id="btn-back-from-bank">Back</button>
        </div>
        <div class="flex gap-2 mb-4 flex-wrap">
          <select class="tactile-input" id="bank-level-filter" aria-label="Filter by level">
            <option value="">All levels</option>
            ${['N5', 'N4', 'N3', 'N2', 'N1'].map((level) => `<option value="${level}" ${filters.level === level ? 'selected' : ''}>${level}</option>`).join('')}
          </select>
          <select class="tactile-input" id="bank-format-filter" aria-label="Filter by format">
            <option value="">All formats</option>
            ${formats.map((format) => `<option value="${escapeHtml(format)}" ${filters.format === format ? 'selected' : ''}>${escapeHtml(format)}</option>`).join('')}
          </select>
          <select class="tactile-input" id="bank-status-filter" aria-label="Filter by verification status">
            <option value="">All statuses</option>
            ${statuses.map((status) => `<option value="${escapeHtml(status)}" ${filters.status === status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}
          </select>
        </div>
        <div id="bank-list">
          ${pageData.items.length ? pageData.items.map((item) => `
            <button type="button" class="tactile-card-interactive w-full text-left p-3 mb-2 bank-list-item" data-question-id="${escapeHtml(String(item.question_id))}">
              <div class="flex items-center justify-between gap-2">
                <span class="font-mono text-xs text-gold">${escapeHtml(item.level || '')} · ${escapeHtml(item.format_code || '')}</span>
                <span class="text-xs text-muted">${escapeHtml(item.verification_status || 'unverified')}</span>
              </div>
              <div class="font-japanese text-warm-paper mt-1">${item.prompt_html || escapeHtml(item.prompt_markup || '')}</div>
            </button>
          `).join('') : '<div class="study-empty-state text-center py-8 text-secondary">No questions match these filters.</div>'}
        </div>
        <div class="flex items-center justify-between mt-4">
          <span class="text-xs text-muted">Showing ${pageData.items.length} of ${total}</span>
          <div class="flex gap-2">
            <button type="button" class="tactile-btn tactile-btn-sm" id="btn-bank-prev" ${currentPage <= 1 ? 'disabled' : ''}>Previous</button>
            <span class="text-xs text-muted py-2">${currentPage} / ${pageCount}</span>
            <button type="button" class="tactile-btn tactile-btn-sm" id="btn-bank-next" ${currentPage >= pageCount ? 'disabled' : ''}>Next</button>
          </div>
        </div>
        <div id="bank-detail" class="mt-4"></div>
      </div>
    `;

    document.getElementById('btn-back-from-bank')?.addEventListener('click', () => this.renderSetupChooser());
    const applyFilters = () => this.loadQuestionBank({
      level: document.getElementById('bank-level-filter')?.value || '',
      format: document.getElementById('bank-format-filter')?.value || '',
      status: document.getElementById('bank-status-filter')?.value || ''
    });
    document.getElementById('bank-level-filter')?.addEventListener('change', applyFilters);
    document.getElementById('bank-format-filter')?.addEventListener('change', applyFilters);
    document.getElementById('bank-status-filter')?.addEventListener('change', applyFilters);
    document.getElementById('btn-bank-prev')?.addEventListener('click', () => this.loadQuestionBank(filters, currentPage - 1));
    document.getElementById('btn-bank-next')?.addEventListener('click', () => this.loadQuestionBank(filters, currentPage + 1));
    area.querySelectorAll('.bank-list-item').forEach((button) => {
      button.addEventListener('click', () => this.loadQuestionDetail(button.dataset.questionId));
    });
  }

  async loadQuestionDetail(questionId) {
    const detail = document.getElementById('bank-detail');
    if (!detail) return;
    detail.innerHTML = '<div class="text-muted text-sm">Loading question detail...</div>';
    try {
      const [question, provenance] = await Promise.all([
        studyClient.getQuestion(questionId),
        studyClient.getQuestionProvenance(questionId)
      ]);
      const choices = Array.isArray(question?.choices) ? question.choices : [];
      detail.innerHTML = `
        <div class="tactile-card surface-pitch-black p-4">
          <h3 class="font-bold text-warm-paper mb-2">Question ${escapeHtml(String(question?.external_id || questionId))}</h3>
          <div class="font-japanese text-warm-paper mb-3">${question?.prompt_html || sanitizePromptMarkup(question?.prompt_markup || '')}</div>
          <div class="text-sm text-secondary mb-3">${choices.map((choice) => `<div>${escapeHtml(choice.choice_key || choice.id || '')}: ${choice.text_html || escapeHtml(choice.text || choice.text_markup || '')}</div>`).join('')}</div>
          <div class="text-xs text-muted mb-3">Answer: ${escapeHtml(question?.canonical_choice_key || 'Not recorded')} · Verification: ${escapeHtml(provenance?.verification?.status || 'unverified')}</div>
          <div class="text-xs text-secondary mb-3">Provenance: ${escapeHtml((provenance?.sources || []).map((source) => source.citation || source.name).filter(Boolean).join('; ') || 'No source recorded')}</div>
          <button type="button" class="tactile-btn tactile-btn-primary" id="btn-report-question">Report a defect</button>
          <div id="bank-report-form" class="mt-3"></div>
        </div>
      `;
      document.getElementById('btn-report-question')?.addEventListener('click', () => this.renderQuestionReportForm(questionId));
    } catch (err) {
      console.error('[Study] Question detail error:', err);
      detail.innerHTML = `<div class="text-secondary text-sm">${escapeHtml(err.message || 'Unable to load question detail.')}</div>`;
    }
  }

  renderQuestionReportForm(questionId) {
    const form = document.getElementById('bank-report-form');
    if (!form) return;
    form.innerHTML = `
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

  async loadMistakesNotebook(filters = {}) {
    const area = document.getElementById('study-content-area');
    if (!area) return;
    area.innerHTML = '<div class="tactile-card text-center py-12 text-muted"><span class="font-mono text-sm">Loading mistakes...</span></div>';
    try {
      const response = await studyClient.getIncorrectHistory({ limit: 100, ...filters });
      this.renderMistakesNotebook(response?.items || [], filters);
    } catch (err) {
      console.error('[Study] Mistakes history error:', err);
      this.showError('Mistakes notebook failed: ' + (err.message || 'Unable to load history'));
      this.renderSetupChooser();
    }
  }

  renderMistakesNotebook(items, filters = {}) {
    const area = document.getElementById('study-content-area');
    if (!area) return;
    const formats = [...new Set(items.map((item) => item.format_code).filter(Boolean))].sort();
    const visibleItems = filterMistakes(items, filters);
    area.innerHTML = `
      <div class="study-mistakes-card tactile-card">
        <div class="flex items-center justify-between gap-3 mb-4">
          <div>
            <span class="font-mono text-xs text-gold uppercase tracking-wider">Study</span>
            <h2 class="text-xl font-bold text-warm-paper mt-1">Mistakes Notebook</h2>
          </div>
          <button type="button" class="tactile-btn tactile-btn-sm" id="btn-back-to-study">Back</button>
        </div>
        <div class="flex gap-2 mb-4 flex-wrap">
          <select class="tactile-input" id="mistakes-level-filter" aria-label="Filter by level">
            <option value="">All levels</option>
            ${['N5', 'N4', 'N3', 'N2', 'N1'].map((level) => `<option value="${level}" ${filters.level === level ? 'selected' : ''}>${level}</option>`).join('')}
          </select>
          <select class="tactile-input" id="mistakes-format-filter" aria-label="Filter by format">
            <option value="">All formats</option>
            ${formats.map((format) => `<option value="${escapeHtml(format)}" ${filters.format === format ? 'selected' : ''}>${escapeHtml(format)}</option>`).join('')}
          </select>
          <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-practice-mistakes">Practice Mistakes</button>
        </div>
        <div id="mistakes-list">
          ${visibleItems.length ? visibleItems.map((item) => `
            <button type="button" class="tactile-card-interactive w-full text-left p-3 mb-2 mistake-list-item" data-question-id="${item.question_id}">
              <div class="flex items-center justify-between gap-2">
                <span class="font-mono text-xs text-gold">${escapeHtml(item.level)} · ${escapeHtml(item.format_code)}</span>
                <span class="text-xs text-muted">${item.incorrect_count} mistakes</span>
              </div>
              <div class="font-japanese text-warm-paper mt-1">${item.prompt_html || escapeHtml(item.prompt_markup || '')}</div>
            </button>
          `).join('') : '<div class="study-empty-state text-center py-8 text-secondary">No mistakes match these filters.</div>'}
        </div>
        <div id="mistake-detail" class="mt-4"></div>
      </div>
    `;

    document.getElementById('btn-back-to-study')?.addEventListener('click', () => this.renderSetupChooser());
    const levelFilter = document.getElementById('mistakes-level-filter');
    const formatFilter = document.getElementById('mistakes-format-filter');
    const applyFilters = () => this.loadMistakesNotebook({
      level: levelFilter?.value || '',
      format_code: formatFilter?.value || ''
    });
    levelFilter?.addEventListener('change', applyFilters);
    formatFilter?.addEventListener('change', applyFilters);
    document.getElementById('btn-practice-mistakes')?.addEventListener('click', () => {
      this.selectedSessionType = 'trouble';
      this.loadPracticeSession(filters.level || this.activeLevel, this.selectedCount, filters.format_code || null);
    });
    area.querySelectorAll('.mistake-list-item').forEach((button) => {
      button.addEventListener('click', () => this.loadMistakeDetail(button.dataset.questionId));
    });
  }

  async loadMistakeDetail(questionId) {
    const detail = document.getElementById('mistake-detail');
    if (!detail) return;
    detail.innerHTML = '<div class="text-muted text-sm">Loading detail...</div>';
    try {
      const item = await studyClient.getIncorrectQuestionDetail(questionId);
      const latest = item?.timeline?.[item.timeline.length - 1];
      detail.innerHTML = `
        <div class="tactile-card surface-pitch-black p-4">
          <h3 class="font-bold text-warm-paper mb-2">Review detail</h3>
          <p class="text-secondary text-sm mb-3">${latest?.explanation_markup ? sanitizePromptMarkup(latest.explanation_markup) : 'No explanation was recorded.'}</p>
          <div class="text-xs text-muted mb-3">
            Your answer: ${escapeHtml(latest?.selected_choice_key || 'Unknown')}
            · Correct answer: ${escapeHtml(latest?.canonical_choice_key || 'Unknown')}
            · Time: ${latest?.time_spent_ms ?? 0} ms
          </div>
          <button type="button" class="tactile-btn tactile-btn-primary" id="btn-practice-selected-mistake">Practice this mistake</button>
        </div>
      `;
      document.getElementById('btn-practice-selected-mistake')?.addEventListener('click', () => {
        this.selectedSessionType = 'trouble';
        this.loadPracticeSession(item.level, 1, item.format_code || null);
      });
    } catch (err) {
      console.error('[Study] Mistake detail error:', err);
      detail.innerHTML = `<div class="text-secondary text-sm">${escapeHtml(err.message || 'Unable to load mistake detail.')}</div>`;
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

    const area = document.getElementById('study-content-area');
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
        ...(this.selectedSessionType === 'bookmarked' ? { bookmarked_only: true } : {}),
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
    return ['all', ...new Set(formats.map(item => item.format_code).filter(Boolean))];
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

    const area = document.getElementById('study-content-area');
    if (!area) return;
    const label = recovery.type === 'exam' ? 'exam' : 'practice drill';
    area.innerHTML = `
      <div class="tactile-card text-center py-8">
        <h2 class="text-xl font-bold text-warm-paper mb-2">Resume ${label}?</h2>
        <p class="text-secondary text-sm mb-5">An active ${label} was found.</p>
        <div class="flex justify-center gap-3">
          <button type="button" class="tactile-btn tactile-btn-primary" id="btn-resume-session">Resume</button>
          <button type="button" class="tactile-btn" id="btn-abandon-session">Abandon</button>
        </div>
      </div>
    `;
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
      this.startActiveTimer();
      this.renderQuestion();
    } catch (err) {
      clearStoredSession('kiroku.active.practice');
      this.showError(`Unable to resume practice session: ${err.message || 'Study API error'}`);
      this.renderSetupChooser();
    }
  }

  renderEmptyState(level, message) {
    const area = document.getElementById('study-content-area');
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
      </div>
    `;

    area.querySelectorAll('.btn-select-study-level').forEach((btn) => {
      btn.addEventListener('click', () => {
        const selectedLevel = btn.dataset.level;
        this.loadPracticeSession(selectedLevel);
      });
    });
  }

  renderQuestion() {
    const area = document.getElementById('study-content-area');
    if (!area) return;

    const item = this.practiceItems[this.currentQuestionIndex];
    if (!item) {
      this.renderCompleteState();
      return;
    }

    this.hasAnswered = false;
    this.questionStartTime = Date.now();

    const level = item.level || this.activeLevel;
    const category = item.category || 'Practice';
    const format = item.format_code || item.structural_family || 'Objective';
    const passageText = extractPassageContent(item);

    // Revoke previous blob URLs
    this.activeBlobUrls.forEach(url => studyClient.revokeMediaBlobUrl(url));
    this.activeBlobUrls = [];

    const promptText = item.prompt_markup || item.instruction_text || 'Select the correct answer:';
    const choices = Array.isArray(item.choices) ? item.choices : [];

    const audioAssetId = item.audio_asset_id || item.media_asset_id || item.listening_audio_asset_id || (item.assets?.find(a => a.role === 'audio' || a.asset_type === 'audio')?.asset_id);
    const diagramAssetId = item.diagram_asset_id || item.image_asset_id || (item.assets?.find(a => a.role === 'diagram' || a.asset_type === 'image')?.asset_id);

    area.innerHTML = `
      <!-- Drill Session Header Bar -->
      <div class="study-header-bar tactile-card">
        <div class="study-header-left">
          <span class="tactile-pill tactile-pill-gold">${escapeHtml(level)} · ${escapeHtml(category)}</span>
          <span class="study-question-count font-mono">Item ${this.currentQuestionIndex + 1} of ${this.practiceItems.length}</span>
        </div>
        <div class="study-timer font-mono text-sm" id="study-active-timer">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="vertical-align: -2px; margin-right: 4px;"><path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.962 8.962 0 0 0 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9a8.994 8.994 0 0 0 7.03-14.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>Active: <span id="study-timer-val">${this.formatTimer(this.elapsedSeconds)}</span>
        </div>
      </div>

      <!-- Reading Passage Pane if question belongs to a passage group -->
      ${passageText ? `
        <div class="study-passage-pane surface-pitch-black tactile-card mb-4 p-4">
          <div class="passage-header-row mb-2">
            <span class="passage-title font-mono text-xs text-gold uppercase tracking-wider">Reading Passage</span>
          </div>
          <div class="passage-body-content text-sm leading-relaxed font-japanese text-warm-paper">
            ${passageText}
          </div>
        </div>
      ` : ''}

      <!-- Question Prompt Card (Pitch-Black #000000) -->
      <div class="study-prompt-card surface-pitch-black tactile-card">
        <div class="study-prompt-header">
          <span class="font-mono text-xs text-gold">${escapeHtml(format)}</span>
          <span class="text-xs text-muted font-mono">Q${this.currentQuestionIndex + 1}</span>
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
      <div class="grading-feedback-banner tactile-card" id="grading-banner" style="display: none;">
        <div class="grading-feedback-content">
          <span class="grading-status-icon" id="grading-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>
          <div class="grading-text-block">
            <span class="grading-verdict" id="grading-verdict">--</span>
            <span class="grading-points text-xs font-mono" id="grading-time-spent">--</span>
          </div>
        </div>
      </div>

      <!-- Pedagogical Explanation Card (Reveals on answer) -->
      <div class="pedagogical-explanation-card tactile-card" id="explanation-card" style="display: none;">
        <div class="explanation-header mb-2">
          <span class="explanation-title font-bold text-gold">Pedagogical Explanation</span>
        </div>
        <div class="explanation-text text-sm leading-relaxed text-secondary mb-4" id="explanation-text">
          --
        </div>

        <!-- Adaptive Repetition Rating Bar (Easy, Normal, Hard) -->
        <div class="adaptive-rating-section pt-3 border-t border-subtle">
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
        <div class="next-question-row mt-4 pt-2">
          <button class="tactile-btn tactile-btn-primary w-full" id="btn-next-question">
            <span>Next Question [Enter]</span>
          </button>
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
            <div class="choukai-audio-box tactile-card surface-pitch-black p-2">
              <span class="text-xs font-mono text-gold">Listening Track</span>
              <audio controls class="w-full mt-1" src="${audioUrl}"></audio>
            </div>
          `;
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
          container.innerHTML = `<img src="${diagramUrl}" alt="Question diagram" class="max-w-full rounded border border-ink-border" />`;
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
      const explanation = result?.explanation_markup || 'Explanation recorded in study database.';

      if (isCorrect) {
        this.sessionSummary.correct += 1;
      }
      this.sessionSummary.total += 1;

      choices.forEach((btn) => {
        const cid = String(btn.dataset.choiceId);
        if (canonicalId && cid === canonicalId) {
          btn.classList.add('is-choice-correct');
        } else if (cid === String(choiceId)) {
          btn.classList.add(isCorrect ? 'is-choice-correct' : 'is-choice-incorrect');
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
      const expText = document.getElementById('explanation-text');
      if (expCard && expText) {
        expText.innerHTML = sanitizePromptMarkup(explanation);
        expCard.style.display = 'block';
      }
    } catch (err) {
      console.error('[Study] Submit answer error:', err);
      this.showError('Grading failed: ' + (err.message || 'Network error'));
    }
  }

  advanceNextQuestion() {
    this.currentQuestionIndex += 1;
    if (this.currentQuestionIndex >= this.practiceItems.length) {
      this.renderCompleteState();
    } else {
      this.renderQuestion();
    }
  }

  async renderCompleteState() {
    this.stopActiveTimer();
    const area = document.getElementById('study-content-area');
    if (!area) return;

    if (this.sessionId) {
      try {
        await studyClient.completePracticeSession(this.sessionId);
      } catch (err) {
        console.warn('[Study] Complete session error:', err.message);
      }
      clearStoredSession('kiroku.active.practice');
    }

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
          <button type="button" class="tactile-btn tactile-btn-primary" id="btn-restart-study">
            <span>Start New Drill (${escapeHtml(this.activeLevel)})</span>
          </button>
        </div>
      </div>
    `;

    const btnRestart = document.getElementById('btn-restart-study');
    if (btnRestart) {
      btnRestart.addEventListener('click', () => {
        this.renderSetupChooser();
      });
    }
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

  handleKeyDown(e) {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const item = this.practiceItems[this.currentQuestionIndex];
    if (!item) return;

    if (this.hasAnswered) {
      if (['1', '2', '3'].includes(e.key)) {
        e.preventDefault();
        const ratingMap = { '1': 'Easy', '2': 'Normal', '3': 'Hard' };
        const btn = this.container?.querySelector(`.btn-rate-difficulty[data-rating="${ratingMap[e.key]}"]`);
        if (btn) btn.click();
      } else if (e.key === 'Enter') {
        const btnNext = document.getElementById('btn-next-question');
        if (btnNext) {
          e.preventDefault();
          this.advanceNextQuestion();
        }
      }
    } else {
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
    if (this.activeBlobUrls && this.activeBlobUrls.length > 0) {
      this.activeBlobUrls.forEach(url => studyClient.revokeMediaBlobUrl(url));
      this.activeBlobUrls = [];
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
