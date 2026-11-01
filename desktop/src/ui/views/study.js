/**
 * Kiroku Note Desktop — Study Practice Drill Engine View Controller
 * Practice drill lifecycle backed by live study.db question bank,
 * objective deterministic grading, pedagogical explanation, adaptive
 * repetition difficulty rating (Easy/Normal/Hard), universal JLPT level sync,
 * setup chooser with live question bank count, and honest diagnostic reports.
 */

import { studyClient } from '../services/study_client.js';
import { escapeHtml, sanitizePromptMarkup } from '../utils/sanitizer.js';
import { renderAssetSlot } from '../assets_map.js';
import { getUniversalJlptLevel } from '../utils/learner.js';

function extractPassageContent(item) {
  if (!item) return null;
  if (item.group_context && Array.isArray(item.group_context.parts) && item.group_context.parts.length > 0) {
    return item.group_context.parts
      .map(p => (p.title ? `${p.title}\n` : '') + (p.markup || ''))
      .join('\n\n');
  }
  if (typeof item.group_context === 'string') return item.group_context;
  return item.group_text || item.passage_text || null;
}

export class StudyView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.sessionId = null;
    this.practiceItems = [];
    this.currentQuestionIndex = 0;
    this.hasAnswered = false;
    this.activeLevel = 'N4';
    this.selectedCount = 10;
    this.selectedSessionType = 'practice';
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
    window.removeEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keydown', this.handleKeyDown);

    try {
      this.activeLevel = await getUniversalJlptLevel();
    } catch (err) {
      console.debug('[Study] Resolve learner level error:', err);
    }
    this.renderSetupChooser();
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

    // Start practice button
    const btnStart = document.getElementById('btn-start-practice');
    if (btnStart) {
      btnStart.addEventListener('click', () => {
        this.loadPracticeSession(this.activeLevel, this.selectedCount);
      });
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
      const levelData = summary?.levels?.[this.activeLevel];
      const eligibleCount = levelData?.eligible_count ?? levelData?.total_count ?? 0;
      const totalBank = summary?.total_questions ?? 0;
      statEl.textContent = `${eligibleCount} questions available for ${this.activeLevel} (${totalBank} total in bank)`;
    } catch (err) {
      console.debug('[Study] Bank summary lookup failed:', err.message);
      statEl.textContent = `Question bank active for ${this.activeLevel}`;
    }
  }

  async loadPracticeSession(level = 'N4', count = 10) {
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
      const session = await studyClient.createPracticeSession(level, count, null, this.selectedSessionType);
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
            ${sanitizePromptMarkup(passageText)}
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
          ${sanitizePromptMarkup(promptText)}
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
              <span class="choice-text font-japanese">${sanitizePromptMarkup(cText)}</span>
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
    window.removeEventListener('keydown', this.handleKeyDown);
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
