/**
 * Kiroku Note Desktop — Study Practice Drill Engine View Controller
 * Practice drill lifecycle backed by live study.db question bank,
 * objective deterministic grading, pedagogical explanation, adaptive
 * repetition difficulty rating (Easy/Normal/Hard), and honest empty states.
 */

import { studyClient } from '../services/study_client.js';
import { renderAssetSlot } from '../assets_map.js';

export class StudyView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.sessionId = null;
    this.practiceItems = [];
    this.currentQuestionIndex = 0;
    this.hasAnswered = false;
    this.activeLevel = 'N3';
    this.elapsedSeconds = 0;
    this.timerInterval = null;
    this.questionStartTime = 0;
    this.sessionSummary = { correct: 0, total: 0 };
    this.isLoading = false;
  }

  mount(container) {
    this.container = container;
    this.renderShell();
    this.loadPracticeSession(this.activeLevel);
  }

  renderShell() {
    this.container.innerHTML = `
      <div class="study-view-wrapper">
        <div class="study-view-container" id="study-main-container">
          <!-- Visible Error Banner -->
          <div class="study-error-banner" id="study-error-banner" style="display: none;">
            <span class="error-msg" id="study-error-msg"></span>
            <button type="button" class="btn-dismiss-error" id="btn-dismiss-study-error">✕</button>
          </div>

          <!-- Dynamic Question Drill View Slot -->
          <div id="study-content-area">
            <div class="tactile-card text-center py-12 text-muted">
              <span class="font-mono text-sm">Preparing practice session...</span>
            </div>
          </div>

          <!-- Mascot Cheer Slot -->
          ${renderAssetSlot('study-drill-cheer', 'study-mascot-box')}
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

  async loadPracticeSession(level = 'N3') {
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
      const session = await studyClient.createPracticeSession(level, 10);
      const items = session?.items || [];

      if (!items || items.length === 0) {
        this.renderEmptyState(level, `No eligible questions found in study.db for level ${level}.`);
        return;
      }

      this.sessionId = session.session_id || session.external_id;
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

  renderEmptyState(level, message) {
    const area = document.getElementById('study-content-area');
    if (!area) return;

    area.innerHTML = `
      <div class="study-empty-state tactile-card text-center py-10">
        <h2 class="study-empty-title">Question Bank Offline or Empty · 練習問題なし</h2>
        <p class="text-secondary text-sm max-w-md mx-auto mb-4">
          ${escapeHtml(message)}
        </p>
        <div class="text-xs text-muted mb-4">
          Select a JLPT level to start drilling or ingest question sets into local study.db:
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
    const promptText = item.prompt_markup || item.instruction_text || 'Select the correct answer:';
    const choices = Array.isArray(item.choices) ? item.choices : [];

    area.innerHTML = `
      <!-- Drill Session Header Bar -->
      <div class="study-header-bar tactile-card">
        <div class="study-header-left">
          <span class="tactile-pill tactile-pill-gold">${escapeHtml(level)} ${escapeHtml(category)}</span>
          <span class="study-question-count font-mono">Item ${this.currentQuestionIndex + 1} of ${this.practiceItems.length}</span>
        </div>
        <div class="study-timer font-mono text-sm" id="study-active-timer">
          ⏱ Active: ${this.formatTimer(this.elapsedSeconds)}
        </div>
      </div>

      <!-- Question Prompt Card (Mandatory Pitch-Black #000000) -->
      <div class="study-prompt-card surface-pitch-black tactile-card">
        <div class="study-prompt-header">
          <span class="font-mono text-xs text-gold">${escapeHtml(format)}</span>
          <span class="text-xs text-muted">Objective Grader</span>
        </div>
        <h2 class="study-prompt-text font-japanese" id="study-prompt-ja">
          ${promptText}
        </h2>
      </div>

      <!-- Interactive Tactile Choice Buttons -->
      <div class="study-choices-grid" id="study-choices-grid" role="radiogroup">
        ${choices.map((choice, i) => `
          <button
            type="button"
            class="study-choice-btn tactile-btn tactile-card-interactive"
            data-choice-id="${escapeHtml(choice.choice_id || choice.id || String(i + 1))}"
            data-index="${i}"
            tabindex="0"
          >
            <span class="choice-num font-mono">${i + 1}</span>
            <span class="choice-text font-japanese">${escapeHtml(choice.text_markup || choice.text || String(choice))}</span>
          </button>
        `).join('')}
      </div>

      <!-- Objective Grading Feedback Banner (Hidden until answered) -->
      <div class="grading-feedback-banner tactile-card" id="grading-banner" style="display: none;">
        <div class="grading-feedback-content">
          <span class="grading-status-icon" id="grading-icon">✓</span>
          <div class="grading-text-block">
            <span class="grading-verdict" id="grading-verdict">--</span>
            <span class="grading-points text-xs font-mono" id="grading-time-spent">--</span>
          </div>
        </div>
      </div>

      <!-- Pedagogical Explanation Card (Reveals on answer) -->
      <div class="pedagogical-explanation-card tactile-card" id="explanation-card" style="display: none;">
        <div class="explanation-header">
          <span class="explanation-title font-bold text-gold">Pedagogical Breakdown · 解説</span>
        </div>
        <p class="explanation-text" id="explanation-text">
          --
        </p>

        <!-- Adaptive Repetition Rating Bar (Easy, Normal, Hard) -->
        <div class="adaptive-rating-section">
          <span class="rating-label text-xs text-muted uppercase">Rate Difficulty for Spaced Repetition:</span>
          <div class="rating-buttons-row" id="rating-buttons-row">
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
        <div class="next-question-row mt-4">
          <button class="tactile-btn tactile-btn-primary" id="btn-next-question">
            <span>Next Question →</span>
          </button>
        </div>
      </div>
    `;

    // Attach choice button handlers
    const choiceButtons = area.querySelectorAll('.study-choice-btn');
    choiceButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.hasAnswered) return;
        const choiceId = btn.dataset.choiceId;
        this.submitAnswer(item, choiceId, btn);
      });
    });

    // Next question handler
    const btnNext = document.getElementById('btn-next-question');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        this.advanceNextQuestion();
      });
    }

    // Difficulty rating handlers
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
          console.warn('[Study] Record feedback error:', err);
        }
      });
    });
  }

  async submitAnswer(item, choiceId, selectedBtn) {
    this.hasAnswered = true;
    const timeSpentMs = Math.max(500, Date.now() - this.questionStartTime);

    // Disable choices
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
      const canonicalId = result?.canonical_choice_id;
      const explanation = result?.explanation_markup || 'Explanation recorded in study database.';

      if (isCorrect) {
        this.sessionSummary.correct += 1;
      }
      this.sessionSummary.total += 1;

      // Update button highlights
      choices.forEach((btn) => {
        const cid = btn.dataset.choiceId;
        if (canonicalId && cid === canonicalId) {
          btn.classList.add('is-choice-correct');
        } else if (cid === choiceId) {
          btn.classList.add(isCorrect ? 'is-choice-correct' : 'is-choice-incorrect');
        }
      });

      // Reveal grading feedback banner
      const banner = document.getElementById('grading-banner');
      const icon = document.getElementById('grading-icon');
      const verdict = document.getElementById('grading-verdict');
      const timeTag = document.getElementById('grading-time-spent');

      if (banner && icon && verdict) {
        banner.style.display = 'block';
        banner.className = `grading-feedback-banner tactile-card ${isCorrect ? 'banner-correct' : 'banner-incorrect'}`;
        icon.textContent = isCorrect ? '✓' : '✗';
        verdict.textContent = isCorrect ? '正解 · CORRECT' : '不正解 · INCORRECT';
        if (timeTag) {
          timeTag.textContent = `${(timeSpentMs / 1000).toFixed(1)}s response time`;
        }
      }

      // Reveal explanation card
      const expCard = document.getElementById('explanation-card');
      const expText = document.getElementById('explanation-text');
      if (expCard && expText) {
        expText.innerHTML = escapeHtml(explanation);
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
        console.warn('[Study] Complete session error:', err);
      }
    }

    const { correct, total } = this.sessionSummary;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

    area.innerHTML = `
      <div class="study-complete-card tactile-card text-center py-10">
        <h2 class="study-complete-title font-display text-2xl font-bold mb-2">Practice Drill Complete! · 練習完了</h2>
        <p class="text-secondary text-sm mb-6">
          Honest diagnostic practice result. Your responses have been scheduled for adaptive spaced repetition.
        </p>

        <div class="flex justify-center gap-6 my-6">
          <div class="tactile-card p-4">
            <span class="text-xs text-muted block uppercase">Questions</span>
            <span class="font-mono text-xl font-bold text-warm-paper">${total}</span>
          </div>
          <div class="tactile-card p-4">
            <span class="text-xs text-muted block uppercase">Score</span>
            <span class="font-mono text-xl font-bold text-gold">${correct} / ${total}</span>
          </div>
          <div class="tactile-card p-4">
            <span class="text-xs text-muted block uppercase">Accuracy</span>
            <span class="font-mono text-xl font-bold text-warm-paper">${accuracy}%</span>
          </div>
        </div>

        <div class="study-level-picker mt-8">
          <button type="button" class="tactile-btn tactile-btn-primary" id="btn-restart-study">
            Start New Drill (${escapeHtml(this.activeLevel)})
          </button>
        </div>
      </div>
    `;

    const btnRestart = document.getElementById('btn-restart-study');
    if (btnRestart) {
      btnRestart.addEventListener('click', () => {
        this.loadPracticeSession(this.activeLevel);
      });
    }
  }

  startActiveTimer() {
    this.stopActiveTimer();
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds += 1;
      const timerEl = document.getElementById('study-active-timer');
      if (timerEl) {
        timerEl.textContent = `⏱ Active: ${this.formatTimer(this.elapsedSeconds)}`;
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

  unmount() {
    this.stopActiveTimer();
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
