/**
 * Kiroku Note Desktop — Test Engine (JLPT Simulation) View Controller
 * Timed JLPT examination simulation backed by live study.db question bank,
 * anti-cheat countdown timer, split-view reading passage, 4-choice tactile cards,
 * section question palette bar, and honest diagnostic results without fake official claims.
 */

import { studyClient } from '../services/study_client.js';
import { renderAssetSlot } from '../assets_map.js';

export class TestView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.sessionId = null;
    this.activeLevel = 'N3';
    this.sections = [];
    this.currentSectionIndex = 0;
    this.questions = [];
    this.currentIndex = 0;
    this.remainingSeconds = 45 * 60;
    this.timerInterval = null;
    this.answers = new Map(); // questionIndex -> selectedChoiceId
    this.flagged = new Set();
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  mount(container) {
    this.container = container;
    this.renderShell();
    this.setupGlobalEvents();
    this.loadExamSession(this.activeLevel);
  }

  renderShell() {
    this.container.innerHTML = `
      <div class="test-view-wrapper">
        <div class="test-view-container" id="test-main-container">
          <!-- Visible Error Banner -->
          <div class="test-error-banner" id="test-error-banner" style="display: none;">
            <span class="error-msg" id="test-error-msg"></span>
            <button type="button" class="btn-dismiss-error" id="btn-dismiss-test-error">✕</button>
          </div>

          <!-- Main Stage Slot -->
          <div id="test-stage-area">
            <div class="tactile-card text-center py-12 text-muted">
              <span class="font-mono text-sm">Initializing JLPT examination simulation...</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const btnDismiss = document.getElementById('btn-dismiss-test-error');
    if (btnDismiss) {
      btnDismiss.addEventListener('click', () => this.clearError());
    }
  }

  setupGlobalEvents() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  showError(message) {
    const banner = document.getElementById('test-error-banner');
    const msg = document.getElementById('test-error-msg');
    if (banner && msg) {
      msg.textContent = message;
      banner.style.display = 'flex';
    }
  }

  clearError() {
    const banner = document.getElementById('test-error-banner');
    if (banner) {
      banner.style.display = 'none';
    }
  }

  async loadExamSession(level = 'N3') {
    this.activeLevel = level;
    this.clearError();
    this.stopTimer();
    this.answers.clear();
    this.flagged.clear();

    const stage = document.getElementById('test-stage-area');
    if (stage) {
      stage.innerHTML = `
        <div class="tactile-card text-center py-12 text-muted">
          <span class="font-mono text-sm">Preparing JLPT ${escapeHtml(level)} simulation from question bank...</span>
        </div>
      `;
    }

    try {
      const session = await studyClient.createExamSession(level);
      this.sessionId = session?.session_id || session?.external_id;

      // Extract sections and questions
      this.sections = session?.sections || [];
      const currentSection = this.sections[0] || {};
      this.questions = currentSection.items || session?.items || [];

      if (!this.questions || this.questions.length === 0) {
        this.renderEmptyState(level, `No eligible examination questions found in study.db for level ${level}.`);
        return;
      }

      this.remainingSeconds = currentSection.remaining_time_seconds || (45 * 60);
      this.currentIndex = 0;
      this.startTimer();
      this.renderExamStage();
    } catch (err) {
      console.warn('[Test] Launch exam simulation failed:', err);
      this.renderEmptyState(level, err.message || 'Unable to start JLPT simulation.');
      this.showError('Exam simulation error: ' + (err.message || 'Check question bank readiness'));
    }
  }

  renderEmptyState(level, message) {
    const stage = document.getElementById('test-stage-area');
    if (!stage) return;

    stage.innerHTML = `
      <div class="test-empty-state tactile-card text-center py-10">
        <h2 class="test-empty-title font-display text-2xl font-bold mb-2">Question Bank Incomplete for Simulation · 模擬試験未準備</h2>
        <p class="text-secondary text-sm max-w-md mx-auto mb-4">
          ${escapeHtml(message)}
        </p>
        <div class="text-xs text-muted mb-4">
          A full JLPT simulation requires audited questions for all sections. Select another level or ingest official exam materials:
        </div>
        <div class="study-level-picker" id="exam-level-picker">
          ${['N5', 'N4', 'N3', 'N2', 'N1'].map((lvl) => `
            <button
              type="button"
              class="tactile-btn tactile-btn-sm ${lvl === level ? 'tactile-btn-primary' : ''} btn-select-exam-level"
              data-level="${lvl}"
            >${lvl}</button>
          `).join('')}
        </div>
      </div>
    `;

    stage.querySelectorAll('.btn-select-exam-level').forEach((btn) => {
      btn.addEventListener('click', () => {
        const selected = btn.dataset.level;
        this.loadExamSession(selected);
      });
    });
  }

  renderExamStage() {
    const stage = document.getElementById('test-stage-area');
    if (!stage) return;

    const currentSection = this.sections[this.currentSectionIndex] || {};
    const sectionLabel = currentSection.label || `Section ${this.currentSectionIndex + 1}: Language Knowledge & Reading`;

    stage.innerHTML = `
      <!-- Exam Header Strip: Timer & Section Info -->
      <div class="test-header-bar tactile-card">
        <div class="test-header-left">
          <span class="tactile-pill tactile-pill-vermilion">JLPT ${escapeHtml(this.activeLevel)} SIMULATION</span>
          <span class="test-section-name">${escapeHtml(sectionLabel)}</span>
        </div>

        <!-- Anti-Cheat Persistent Countdown Timer -->
        <div class="test-timer-group" id="test-timer-group">
          <span class="timer-label">TIME REMAINING:</span>
          <span class="timer-countdown font-mono font-bold" id="exam-countdown">${this.formatCountdown(this.remainingSeconds)}</span>
        </div>

        <!-- Proctor Mascot Slot -->
        ${renderAssetSlot('test-exam-proctor', 'test-proctor-slot')}
      </div>

      <!-- Question Content Area -->
      <div id="test-question-content"></div>

      <!-- Bottom: Question Palette Bar & Submit Button -->
      <div class="test-palette-bar tactile-card">
        <div class="palette-scroll-wrap" id="palette-wrap">
          ${this.questions.map((q, i) => `
            <button
              type="button"
              class="palette-item ${i === this.currentIndex ? 'is-current' : ''} ${this.answers.has(i) ? 'is-answered' : ''} ${this.flagged.has(i) ? 'is-flagged' : ''}"
              data-index="${i}"
              title="Question ${i + 1}"
            >${i + 1}</button>
          `).join('')}
        </div>

        <div class="palette-actions">
          <button class="tactile-btn tactile-btn-primary" id="btn-finish-exam">
            <span>Finish Section</span>
          </button>
        </div>
      </div>
    `;

    this.renderQuestionDetails();

    // Palette item clicks
    stage.querySelectorAll('.palette-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        this.goToQuestion(idx);
      });
    });

    // Finish section button
    const btnFinish = document.getElementById('btn-finish-exam');
    if (btnFinish) {
      btnFinish.addEventListener('click', () => this.confirmSubmitSection());
    }
  }

  renderQuestionDetails() {
    const container = document.getElementById('test-question-content');
    if (!container) return;

    const item = this.questions[this.currentIndex];
    if (!item) return;

    const total = this.questions.length;
    const isFlagged = this.flagged.has(this.currentIndex);
    const selectedChoiceId = this.answers.get(this.currentIndex);
    const choices = Array.isArray(item.choices) ? item.choices : [];
    const hasPassage = Boolean(item.group_context || item.group_text || item.passage_text);
    const passageText = item.group_context || item.group_text || item.passage_text || '';

    let contentHtml = '';

    if (hasPassage) {
      // Split view layout for reading passage
      contentHtml = `
        <div class="test-stage-grid">
          <!-- Left Pane: Reading Passage -->
          <div class="test-passage-pane surface-pitch-black tactile-card">
            <div class="passage-header-row">
              <span class="passage-title font-mono text-gold">READING PASSAGE · 読解文</span>
            </div>
            <div class="passage-body-content">
              <p class="passage-paragraph">${escapeHtml(passageText)}</p>
            </div>
          </div>

          <!-- Right Pane: Question & Choices -->
          <div class="test-question-pane">
            ${this.buildPromptAndChoicesHtml(item, total, isFlagged, choices, selectedChoiceId)}
          </div>
        </div>
      `;
    } else {
      // Single pane layout for vocab / grammar
      contentHtml = `
        <div class="test-single-pane">
          ${this.buildPromptAndChoicesHtml(item, total, isFlagged, choices, selectedChoiceId)}
        </div>
      `;
    }

    container.innerHTML = contentHtml;

    // Attach choice listeners
    container.querySelectorAll('.test-option-card').forEach((opt) => {
      opt.addEventListener('click', () => {
        const choiceId = opt.dataset.choiceId;
        this.selectChoice(choiceId);
      });
    });

    // Attach flag listener
    const btnFlag = container.querySelector('#btn-toggle-flag');
    if (btnFlag) {
      btnFlag.addEventListener('click', () => {
        this.toggleFlag(this.currentIndex);
      });
    }
  }

  buildPromptAndChoicesHtml(item, total, isFlagged, choices, selectedChoiceId) {
    const promptText = item.prompt_markup || item.instruction_text || 'Choose the best answer:';

    return `
      <div class="test-prompt-card surface-pitch-black tactile-card">
        <div class="prompt-header-row">
          <span class="prompt-item-badge font-mono text-gold" id="prompt-item-num">QUESTION ${this.currentIndex + 1} OF ${total}</span>
          <button class="btn-flag-review tactile-btn tactile-btn-sm" id="btn-toggle-flag" title="Mark this question for review">
            <span id="flag-icon">${isFlagged ? '★' : '☆'}</span>
            <span id="flag-text">${isFlagged ? 'Flagged for Review' : 'Mark for Review'}</span>
          </button>
        </div>
        <div class="prompt-text-content" id="prompt-text">
          ${promptText}
        </div>
      </div>

      <div class="test-options-list" role="radiogroup" aria-label="Answer Choices">
        ${choices.map((choice, i) => {
          const cid = choice.choice_id || choice.id || String(i + 1);
          const isSelected = selectedChoiceId && String(selectedChoiceId) === String(cid);
          const choiceText = choice.text_markup || choice.text || String(choice);
          return `
            <div
              class="test-option-card tactile-card tactile-card-interactive ${isSelected ? 'is-selected' : ''}"
              data-choice-id="${escapeHtml(String(cid))}"
              data-choice="${i + 1}"
              tabindex="0"
            >
              <span class="option-shortcut font-mono">${i + 1}</span>
              <p class="option-text">${escapeHtml(choiceText)}</p>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  handleKeyDown(e) {
    if (['1', '2', '3', '4'].includes(e.key)) {
      const idx = parseInt(e.key, 10) - 1;
      const opt = this.container?.querySelectorAll('.test-option-card')?.[idx];
      if (opt) {
        const choiceId = opt.dataset.choiceId;
        this.selectChoice(choiceId);
      }
    }
  }

  async selectChoice(choiceId) {
    this.answers.set(this.currentIndex, choiceId);

    // Visual selection update
    const options = this.container.querySelectorAll('.test-option-card');
    options.forEach((opt) => {
      opt.classList.toggle('is-selected', opt.dataset.choiceId === String(choiceId));
    });

    this.updatePaletteButton(this.currentIndex);

    // Save draft choice to backend
    if (this.sessionId) {
      const item = this.questions[this.currentIndex];
      const pos = item?.position || (this.currentIndex + 1);
      try {
        await studyClient.answerExamItem(this.sessionId, pos, choiceId);
      } catch (err) {
        console.warn('[Test] Draft choice save error:', err);
      }
    }
  }

  async toggleFlag(index) {
    const isNowFlagged = !this.flagged.has(index);
    if (isNowFlagged) {
      this.flagged.add(index);
    } else {
      this.flagged.delete(index);
    }

    const flagIcon = document.getElementById('flag-icon');
    const flagText = document.getElementById('flag-text');
    if (flagIcon) flagIcon.textContent = isNowFlagged ? '★' : '☆';
    if (flagText) flagText.textContent = isNowFlagged ? 'Flagged for Review' : 'Mark for Review';

    this.updatePaletteButton(index);

    if (this.sessionId) {
      const item = this.questions[index];
      const pos = item?.position || (index + 1);
      try {
        await studyClient.flagExamItem(this.sessionId, pos, isNowFlagged);
      } catch (err) {
        console.warn('[Test] Flag item error:', err);
      }
    }
  }

  updatePaletteButton(index) {
    const btn = this.container.querySelector(`.palette-item[data-index="${index}"]`);
    if (!btn) return;

    btn.classList.toggle('is-answered', this.answers.has(index));
    btn.classList.toggle('is-flagged', this.flagged.has(index));
  }

  goToQuestion(index) {
    if (index < 0 || index >= this.questions.length) return;
    this.currentIndex = index;

    // Update active palette indicator
    this.container.querySelectorAll('.palette-item').forEach((b) => {
      b.classList.toggle('is-current', parseInt(b.dataset.index, 10) === index);
    });

    this.renderQuestionDetails();
  }

  async confirmSubmitSection() {
    const answeredCount = this.answers.size;
    const totalCount = this.questions.length;

    // Custom confirm dialog or direct submission
    await this.submitSection();
  }

  async submitSection() {
    this.stopTimer();
    const stage = document.getElementById('test-stage-area');
    if (stage) {
      stage.innerHTML = `
        <div class="tactile-card text-center py-12 text-muted">
          <span class="font-mono text-sm">Grading exam section responses...</span>
        </div>
      `;
    }

    try {
      const currentSection = this.sections[this.currentSectionIndex] || {};
      const blockOrder = currentSection.block_order || 1;

      if (this.sessionId) {
        await studyClient.submitExamSection(this.sessionId, blockOrder);
        await studyClient.completeExamSession(this.sessionId);
        const result = await studyClient.getExamResult(this.sessionId);
        this.renderResultState(result);
      } else {
        this.renderResultState(null);
      }
    } catch (err) {
      console.error('[Test] Submit section failed:', err);
      this.showError('Section submission error: ' + (err.message || 'Network error'));
      this.renderResultState(null);
    }
  }

  renderResultState(result) {
    const stage = document.getElementById('test-stage-area');
    if (!stage) return;

    const totalAnswered = this.answers.size;
    const totalQuestions = this.questions.length;
    const score = result?.total_scaled_score || result?.total_score || `${totalAnswered} / ${totalQuestions}`;
    const isPassed = result?.is_passed || false;
    const statusLabel = isPassed ? 'Pass (基準点到達)' : 'Provisional Score Completed';

    stage.innerHTML = `
      <div class="test-result-card tactile-card text-center py-10">
        <h2 class="test-result-title font-display text-2xl font-bold mb-2">
          JLPT ${escapeHtml(this.activeLevel)} Simulation Diagnostic Result · 試験判定
        </h2>
        <div class="tactile-pill tactile-pill-gold my-2 inline-block">
          ${escapeHtml(statusLabel)}
        </div>
        <p class="text-secondary text-sm max-w-lg mx-auto my-4">
          Disclaimer: This provisional scaled score is calculated locally for diagnostic purposes and does not represent an official score report from the Japan Foundation or JEES.
        </p>

        <div class="flex justify-center gap-6 my-6">
          <div class="tactile-card p-4">
            <span class="text-xs text-muted block uppercase">Estimated Score</span>
            <span class="font-mono text-2xl font-bold text-gold">${escapeHtml(String(score))}</span>
          </div>
          <div class="tactile-card p-4">
            <span class="text-xs text-muted block uppercase">Items Answered</span>
            <span class="font-mono text-2xl font-bold text-warm-paper">${totalAnswered} / ${totalQuestions}</span>
          </div>
        </div>

        <div class="study-level-picker mt-8">
          <button type="button" class="tactile-btn tactile-btn-primary" id="btn-return-home">
            Return to Dashboard
          </button>
        </div>
      </div>
    `;

    const btnHome = document.getElementById('btn-return-home');
    if (btnHome) {
      btnHome.addEventListener('click', () => {
        this.router?.navigateToTab('home');
      });
    }
  }

  startTimer() {
    this.stopTimer();
    const timerDisplay = document.getElementById('exam-countdown');
    const timerGroup = document.getElementById('test-timer-group');

    this.timerInterval = setInterval(() => {
      if (this.remainingSeconds <= 0) {
        this.stopTimer();
        this.submitSection();
        return;
      }

      this.remainingSeconds -= 1;

      if (timerDisplay) {
        timerDisplay.textContent = this.formatCountdown(this.remainingSeconds);
      }

      if (this.remainingSeconds < 300 && timerGroup) {
        timerGroup.classList.add('is-urgent-pulse');
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  formatCountdown(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  unmount() {
    this.stopTimer();
    window.removeEventListener('keydown', this.handleKeyDown);
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
