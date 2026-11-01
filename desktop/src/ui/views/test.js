/**
 * Kiroku Note Desktop — Test Engine (JLPT Simulation) View Controller
 * Timed JLPT examination simulation backed by live study.db question bank,
 * anti-cheat countdown timer, split-view reading passage, 4-choice tactile cards,
 * section question palette bar, universal JLPT level sync, customizable exam setup,
 * real backend diagnostic scoring report, and strictly serious distraction-free stage
 * with ZERO mascot elements.
 */

import { studyClient } from '../services/study_client.js';
import { escapeHtml, sanitizePromptMarkup } from '../utils/sanitizer.js';
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

export class TestView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.sessionId = null;
    this.activeLevel = 'N4';
    this.selectedScope = 'full'; // 'full' | 'knowledge' | 'reading' | 'listening'
    this.selectedFormatFilter = 'all'; // 'all' | 'F1' | 'F2' | 'F3_F4' | 'F5_F6'
    this.sections = [];
    this.currentSectionIndex = 0;
    this.questions = [];
    this.currentIndex = 0;
    this.remainingSeconds = 45 * 60;
    this.timerInterval = null;
    this.answers = new Map(); // questionIndex -> selectedChoiceId
    this.flagged = new Set();
    this.activeBlobUrls = [];
    this._noticeTimeout = null;
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  async mount(container) {
    this.container = container;
    this.renderShell();
    this.setupGlobalEvents();

    try {
      this.activeLevel = await getUniversalJlptLevel();
    } catch (err) {
      console.debug('[Test] Resolve universal level error:', err);
    }
    this.renderExamSetup();
  }

  renderShell() {
    this.container.innerHTML = `
      <div class="test-view-wrapper">
        <div class="test-view-container" id="test-main-container">
          <!-- Visible Error Banner -->
          <div class="test-error-banner" id="test-error-banner" style="display: none;">
            <span class="error-msg" id="test-error-msg"></span>
            <button type="button" class="btn-dismiss-error" id="btn-dismiss-test-error" aria-label="Dismiss error">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>

          <!-- Main Stage Slot -->
          <div id="test-stage-area">
            <div class="tactile-card text-center py-12 text-muted">
              <span class="font-mono text-sm">Preparing exam simulation...</span>
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

  showNotice(message) {
    let notice = document.getElementById('test-notice-toast');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'test-notice-toast';
      notice.className = 'tactile-card test-notice-toast';
      notice.setAttribute('role', 'status');
      notice.style.position = 'fixed';
      notice.style.bottom = '80px';
      notice.style.right = '24px';
      notice.style.zIndex = '9999';
      notice.style.backgroundColor = 'var(--surface-container-high, #2A2926)';
      notice.style.color = 'var(--warm-paper, #F5F1E8)';
      notice.style.border = '1.5px solid var(--gold, #C8A94A)';
      notice.style.padding = '0.75rem 1.25rem';
      notice.style.borderRadius = 'var(--radius-md, 12px)';
      notice.style.boxShadow = 'var(--shadow-md)';
      notice.style.fontSize = '0.85rem';
      notice.style.maxWidth = '380px';
      notice.style.transition = 'opacity 0.25s ease';
      document.body.appendChild(notice);
    }
    notice.textContent = message;
    notice.style.display = 'block';
    notice.style.opacity = '1';
    if (this._noticeTimeout) clearTimeout(this._noticeTimeout);
    this._noticeTimeout = setTimeout(() => {
      const el = document.getElementById('test-notice-toast');
      if (el) {
        el.style.opacity = '0';
        setTimeout(() => {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        }, 250);
      }
    }, 4500);
  }

  renderExamSetup() {
    this.clearError();
    this.stopTimer();
    const stage = document.getElementById('test-stage-area');
    if (!stage) return;

    stage.innerHTML = `
      <div class="test-setup-card tactile-card">
        <div class="setup-header-row mb-4">
          <div>
            <span class="font-mono text-xs text-gold uppercase tracking-wider">Examination Simulation</span>
            <h2 class="text-xl font-bold text-warm-paper mt-1">Official Format JLPT Simulation</h2>
            <p class="text-secondary text-sm">
              Timed, authentic simulation adhering to official JLPT section structure and item scoring models.
            </p>
          </div>
        </div>

        <!-- Target JLPT Level -->
        <div class="setup-field-group mb-5">
          <label class="text-xs font-mono text-muted uppercase block mb-2">Target JLPT Level</label>
          <div class="syllabus-level-pills" id="exam-setup-level-pills" role="radiogroup" aria-label="Exam Level">
            ${['N5', 'N4', 'N3', 'N2', 'N1'].map(lvl => `
              <button
                type="button"
                class="tactile-pill exam-level-pill ${lvl === this.activeLevel ? 'is-active tactile-pill-gold' : ''}"
                data-level="${lvl}"
              >${lvl}</button>
            `).join('')}
          </div>
        </div>

        <!-- Scope Selection -->
        <div class="setup-field-group mb-5">
          <label class="text-xs font-mono text-muted uppercase block mb-2">Simulation Scope</label>
          <div class="exam-scope-pills flex gap-2 flex-wrap" id="exam-scope-pills">
            <button type="button" class="tactile-pill exam-scope-pill ${this.selectedScope === 'full' ? 'is-active tactile-pill-gold' : ''}" data-scope="full">
              Full Official Exam
            </button>
            <button type="button" class="tactile-pill exam-scope-pill ${this.selectedScope === 'knowledge' ? 'is-active tactile-pill-gold' : ''}" data-scope="knowledge">
              Language Knowledge
            </button>
            <button type="button" class="tactile-pill exam-scope-pill ${this.selectedScope === 'reading' ? 'is-active tactile-pill-gold' : ''}" data-scope="reading">
              Reading Comprehension
            </button>
            <button type="button" class="tactile-pill exam-scope-pill ${this.selectedScope === 'listening' ? 'is-active tactile-pill-gold' : ''}" data-scope="listening">
              Listening Comprehension
            </button>
          </div>
        </div>

        <!-- Question Types Filter (F1-F6) -->
        <div class="setup-field-group mb-5">
          <label class="text-xs font-mono text-muted uppercase block mb-2">Question Types Filter</label>
          <div class="exam-format-pills flex gap-2 flex-wrap" id="exam-format-pills">
            <button type="button" class="tactile-pill exam-format-pill ${this.selectedFormatFilter === 'all' ? 'is-active tactile-pill-gold' : ''}" data-format="all">
              All Formats
            </button>
            <button type="button" class="tactile-pill exam-format-pill ${this.selectedFormatFilter === 'F1' ? 'is-active tactile-pill-gold' : ''}" data-format="F1">
              Kanji & Orthography (F1)
            </button>
            <button type="button" class="tactile-pill exam-format-pill ${this.selectedFormatFilter === 'F2' ? 'is-active tactile-pill-gold' : ''}" data-format="F2">
              Grammar & Order (F2)
            </button>
            <button type="button" class="tactile-pill exam-format-pill ${this.selectedFormatFilter === 'F3_F4' ? 'is-active tactile-pill-gold' : ''}" data-format="F3_F4">
              Reading Passages (F3/F4)
            </button>
            <button type="button" class="tactile-pill exam-format-pill ${this.selectedFormatFilter === 'F5_F6' ? 'is-active tactile-pill-gold' : ''}" data-format="F5_F6">
              Listening (F5/F6)
            </button>
          </div>
        </div>

        <!-- Serious Anti-Cheat & Diagnostic Rules Notice -->
        <div class="test-info-box tactile-card surface-pitch-black p-4 mb-6">
          <span class="font-mono text-xs text-gold uppercase tracking-wider block mb-1">Diagnostic Simulation Rules</span>
          <p class="text-xs text-secondary leading-relaxed">
            Disclaimer: This provisional scaled score is calculated locally for diagnostic purposes and does not represent an official score report from the Japan Foundation or JEES. Once started, a persistent countdown timer enforces section constraints. Answers cannot be changed after section submission.
          </p>
        </div>

        <div class="setup-action-row pt-2">
          <button type="button" class="tactile-btn tactile-btn-primary w-full" id="btn-start-exam">
            <span>Begin Examination (${escapeHtml(this.activeLevel)})</span>
          </button>
        </div>
      </div>
    `;

    // Wire level pill selectors
    stage.querySelectorAll('.exam-level-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        stage.querySelectorAll('.exam-level-pill').forEach(b => b.classList.remove('is-active', 'tactile-pill-gold'));
        btn.classList.add('is-active', 'tactile-pill-gold');
        this.activeLevel = btn.dataset.level;
        const btnStart = document.getElementById('btn-start-exam');
        if (btnStart) {
          btnStart.querySelector('span').textContent = `Begin Examination (${this.activeLevel})`;
        }
      });
    });

    // Wire scope pills
    stage.querySelectorAll('.exam-scope-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        stage.querySelectorAll('.exam-scope-pill').forEach(b => b.classList.remove('is-active', 'tactile-pill-gold'));
        btn.classList.add('is-active', 'tactile-pill-gold');
        this.selectedScope = btn.dataset.scope;
      });
    });

    // Wire format filter pills
    stage.querySelectorAll('.exam-format-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        stage.querySelectorAll('.exam-format-pill').forEach(b => b.classList.remove('is-active', 'tactile-pill-gold'));
        btn.classList.add('is-active', 'tactile-pill-gold');
        this.selectedFormatFilter = btn.dataset.format;
      });
    });

    // Wire start exam button
    const btnStart = document.getElementById('btn-start-exam');
    if (btnStart) {
      btnStart.addEventListener('click', () => {
        this.loadExamSession(this.activeLevel);
      });
    }
  }

  async loadExamSession(level = 'N4') {
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

      this.sections = session?.sections || [];
      this.currentSectionIndex = 0;

      // Select section based on chosen scope if specific section was requested
      if (this.selectedScope !== 'full' && this.sections.length > 0) {
        const matchIdx = this.sections.findIndex(s => {
          const code = (s.section_code || '').toLowerCase();
          const lbl = (s.label || '').toLowerCase();
          if (this.selectedScope === 'knowledge') return code.includes('vocab') || code.includes('grammar') || code.includes('knowledge') || lbl.includes('knowledge') || lbl.includes('vocab');
          if (this.selectedScope === 'reading') return code.includes('reading') || lbl.includes('reading');
          if (this.selectedScope === 'listening') return code.includes('listening') || lbl.includes('listening');
          return false;
        });
        if (matchIdx >= 0) {
          this.currentSectionIndex = matchIdx;
        }
      }

      const currentSection = this.sections[this.currentSectionIndex] || {};
      let items = currentSection.items || session?.current_section_items || session?.items || [];

      // Apply question types filter if specific format requested
      if (this.selectedFormatFilter !== 'all' && items.length > 0) {
        const filtered = items.filter(q => {
          const fc = (q.format_code || '').toUpperCase();
          const sf = (q.structural_family || '').toUpperCase();
          if (this.selectedFormatFilter === 'F1') return fc.startsWith('F1') || sf.includes('F1') || q.category === 'vocabulary';
          if (this.selectedFormatFilter === 'F2') return fc.startsWith('F2') || sf.includes('F2') || q.category === 'grammar';
          if (this.selectedFormatFilter === 'F3_F4') return fc.startsWith('F3') || fc.startsWith('F4') || sf.includes('F3') || sf.includes('F4') || q.category === 'reading';
          if (this.selectedFormatFilter === 'F5_F6') return fc.startsWith('F5') || fc.startsWith('F6') || sf.includes('F5') || sf.includes('F6') || q.category === 'listening';
          return true;
        });
        if (filtered.length > 0) {
          items = filtered;
        } else {
          this.showNotice(`No questions match the "${this.selectedFormatFilter}" format filter. Falling back to all ${items.length} section questions.`);
        }
      }

      this.questions = items;

      if (!this.questions || this.questions.length === 0) {
        this.renderEmptyState(level, `No eligible examination questions found in study.db for level ${level}.`);
        return;
      }

      this.remainingSeconds = currentSection.remaining_time_seconds || (currentSection.allocated_time_seconds || (45 * 60));
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
        <h2 class="test-empty-title font-display text-2xl font-bold mb-2">Question Bank Incomplete for Simulation</h2>
        <p class="text-secondary text-sm max-w-md mx-auto mb-4">
          ${escapeHtml(message)}
        </p>
        <div class="text-xs text-muted mb-4 font-mono">
          A full JLPT simulation requires questions for all exam sections. Select a level with questions available:
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
    const isLastSection = this.currentSectionIndex >= this.sections.length - 1;
    const sectionLabel = currentSection.label || `Section ${this.currentSectionIndex + 1}: Language Knowledge and Reading`;

    stage.innerHTML = `
      <!-- Exam Header Strip: Timer & Section Info (Strictly No Mascot) -->
      <div class="test-header-bar tactile-card">
        <div class="test-header-left">
          <span class="tactile-pill tactile-pill-vermilion">JLPT ${escapeHtml(this.activeLevel)} SIMULATION</span>
          <span class="test-section-name font-mono text-sm">${escapeHtml(sectionLabel)}</span>
        </div>

        <!-- Anti-Cheat Persistent Countdown Timer in Inter font -->
        <div class="test-timer-group" id="test-timer-group">
          <span class="timer-label font-mono text-xs">TIME REMAINING:</span>
          <span class="timer-countdown font-mono font-bold" id="exam-countdown">${this.formatCountdown(this.remainingSeconds)}</span>
        </div>
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
          <button type="button" class="tactile-btn tactile-btn-primary" id="btn-finish-exam">
            <span>${isLastSection ? 'Finish Exam' : 'Finish Section and Next'}</span>
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
    const passageText = extractPassageContent(item);

    let contentHtml = '';

    if (passageText) {
      contentHtml = `
        <div class="test-stage-grid">
          <!-- Left Pane: Reading Passage -->
          <div class="test-passage-pane surface-pitch-black tactile-card">
            <div class="passage-header-row mb-2">
              <span class="passage-title font-mono text-xs text-gold uppercase tracking-wider">Reading Passage</span>
            </div>
            <div class="passage-body-content font-japanese text-sm leading-relaxed text-warm-paper">
              ${sanitizePromptMarkup(passageText)}
            </div>
          </div>

          <!-- Right Pane: Question & Choices -->
          <div class="test-question-pane">
            ${this.buildPromptAndChoicesHtml(item, total, isFlagged, choices, selectedChoiceId)}
          </div>
        </div>
      `;
    } else {
      contentHtml = `
        <div class="test-single-pane">
          ${this.buildPromptAndChoicesHtml(item, total, isFlagged, choices, selectedChoiceId)}
        </div>
      `;
    }

    // Revoke previous blob URLs
    this.activeBlobUrls.forEach(url => studyClient.revokeMediaBlobUrl(url));
    this.activeBlobUrls = [];

    container.innerHTML = contentHtml;

    const audioAssetId = item.audio_asset_id || item.media_asset_id || item.listening_audio_asset_id || (item.assets?.find(a => a.role === 'audio' || a.asset_type === 'audio')?.asset_id);
    const diagramAssetId = item.diagram_asset_id || item.image_asset_id || (item.assets?.find(a => a.role === 'diagram' || a.asset_type === 'image')?.asset_id);

    if (audioAssetId) {
      studyClient.getMediaBlobUrl(audioAssetId).then((audioUrl) => {
        if (!audioUrl) return;
        this.activeBlobUrls.push(audioUrl);
        const audioBox = container.querySelector('#test-audio-container');
        if (audioBox) {
          audioBox.style.display = 'block';
          audioBox.innerHTML = `
            <div class="choukai-audio-box tactile-card surface-pitch-black p-2">
              <span class="text-xs font-mono text-gold">Listening Track</span>
              <audio controls class="w-full mt-1" src="${audioUrl}"></audio>
            </div>
          `;
        }
      }).catch((e) => console.debug('[Test] Audio stream error:', e.message));
    }

    if (diagramAssetId) {
      studyClient.getMediaBlobUrl(diagramAssetId).then((diagramUrl) => {
        if (!diagramUrl) return;
        this.activeBlobUrls.push(diagramUrl);
        const diagramBox = container.querySelector('#test-diagram-container');
        if (diagramBox) {
          diagramBox.style.display = 'block';
          diagramBox.innerHTML = `<img src="${diagramUrl}" alt="Question diagram" class="max-w-full rounded border border-ink-border" />`;
        }
      }).catch((e) => console.debug('[Test] Diagram stream error:', e.message));
    }

    // Wire choices
    container.querySelectorAll('.test-choice-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choiceId = btn.dataset.choiceId;
        this.selectChoice(choiceId);
      });
    });

    // Wire review flag button
    const btnFlag = container.querySelector('#btn-toggle-flag');
    if (btnFlag) {
      btnFlag.addEventListener('click', () => {
        this.toggleFlag(this.currentIndex);
      });
    }
  }

  buildPromptAndChoicesHtml(item, total, isFlagged, choices, selectedChoiceId) {
    const promptText = item.prompt_markup || item.instruction_text || 'Select the correct choice:';
    const format = item.format_code || item.structural_family || 'Objective';

    return `
      <!-- Question Prompt Box -->
      <div class="test-prompt-card surface-pitch-black tactile-card">
        <div class="test-prompt-meta">
          <span class="font-mono text-xs text-gold">${escapeHtml(format)} · Q${this.currentIndex + 1} of ${total}</span>
          <button type="button" class="btn-flag-review ${isFlagged ? 'is-flagged' : ''}" id="btn-toggle-flag" title="Mark for Review">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>
            <span>${isFlagged ? 'Marked for Review' : 'Mark for Review'}</span>
          </button>
        </div>
        <h2 class="test-prompt-body font-japanese">
          ${sanitizePromptMarkup(promptText)}
        </h2>

        <!-- Choukai Media Streaming Containers -->
        <div id="test-audio-container" class="mt-3" style="display: none;"></div>
        <div id="test-diagram-container" class="mt-3" style="display: none;"></div>
      </div>

      <!-- 4-Choice Tactile Cards (1-4) -->
      <div class="test-choices-grid" role="radiogroup" aria-label="Exam Question Choices">
        ${choices.map((choice, i) => {
          const cid = choice.choice_id || choice.id || String(i + 1);
          const isSelected = String(selectedChoiceId) === String(cid);
          const choiceText = choice.text_markup || choice.text || String(choice);

          return `
            <button
              type="button"
              class="test-choice-card tactile-btn tactile-card-interactive ${isSelected ? 'is-selected-choice' : ''}"
              data-choice-id="${escapeHtml(String(cid))}"
              data-index="${i}"
              role="radio"
              aria-checked="${isSelected ? 'true' : 'false'}"
              tabindex="0"
            >
              <span class="choice-num font-mono">${i + 1}</span>
              <span class="choice-text font-japanese">${sanitizePromptMarkup(choiceText)}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  async selectChoice(choiceId) {
    const item = this.questions[this.currentIndex];
    if (!item) return;

    this.answers.set(this.currentIndex, choiceId);

    // Draft answer to backend
    try {
      await studyClient.answerExamItem(this.sessionId, item.attempt_item_id || (this.currentIndex + 1), choiceId);
    } catch (err) {
      console.warn('[Test] Draft choice sync error:', err.message);
    }

    // Update choices UI
    const container = document.getElementById('test-question-content');
    if (container) {
      container.querySelectorAll('.test-choice-card').forEach((btn) => {
        const cid = btn.dataset.choiceId;
        const isMatch = String(cid) === String(choiceId);
        btn.classList.toggle('is-selected-choice', isMatch);
        btn.setAttribute('aria-checked', isMatch ? 'true' : 'false');
      });
    }

    // Update palette UI
    const paletteBtn = document.querySelector(`.palette-item[data-index="${this.currentIndex}"]`);
    if (paletteBtn) {
      paletteBtn.classList.add('is-answered');
    }
  }

  async toggleFlag(index) {
    const item = this.questions[index];
    if (!item) return;

    const currentlyFlagged = this.flagged.has(index);
    if (currentlyFlagged) {
      this.flagged.delete(index);
    } else {
      this.flagged.add(index);
    }

    try {
      await studyClient.flagExamItem(this.sessionId, item.attempt_item_id || (index + 1), !currentlyFlagged);
    } catch (err) {
      console.warn('[Test] Toggle flag sync error:', err.message);
    }

    // Update Flag button state
    const btnFlag = document.getElementById('btn-toggle-flag');
    if (btnFlag) {
      const isNowFlagged = this.flagged.has(index);
      btnFlag.classList.toggle('is-flagged', isNowFlagged);
      btnFlag.querySelector('span').textContent = isNowFlagged ? 'Marked for Review' : 'Mark for Review';
    }

    // Update palette item
    const pal = document.querySelector(`.palette-item[data-index="${index}"]`);
    if (pal) {
      pal.classList.toggle('is-flagged', this.flagged.has(index));
    }
  }

  goToQuestion(idx) {
    if (idx < 0 || idx >= this.questions.length) return;
    this.currentIndex = idx;

    // Update palette active highlight
    document.querySelectorAll('.palette-item').forEach((btn, i) => {
      btn.classList.toggle('is-current', i === idx);
    });

    this.renderQuestionDetails();
  }

  confirmSubmitSection() {
    const total = this.questions.length;
    const answered = this.answers.size;
    const unAnswered = total - answered;

    const btnFinish = document.getElementById('btn-finish-exam');
    if (btnFinish && btnFinish.dataset.confirming !== 'true') {
      btnFinish.dataset.confirming = 'true';
      const label = unAnswered > 0 ? `Submit (${unAnswered} left)? Click to Confirm` : 'Confirm Section Submit';
      const span = btnFinish.querySelector('span');
      if (span) {
        span.textContent = label;
      } else {
        btnFinish.innerHTML = `<span>${label}</span>`;
      }
      setTimeout(() => {
        if (btnFinish && btnFinish.dataset.confirming === 'true') {
          btnFinish.dataset.confirming = 'false';
          const isLast = this.currentSectionIndex >= this.sections.length - 1;
          const resetLabel = isLast ? 'Finish Exam' : 'Finish Section and Next';
          const innerSpan = btnFinish.querySelector('span');
          if (innerSpan) {
            innerSpan.textContent = resetLabel;
          } else {
            btnFinish.innerHTML = `<span>${resetLabel}</span>`;
          }
        }
      }, 5000);
      return;
    }

    this.submitSection();
  }

  async submitSection() {
    this.stopTimer();

    try {
      const currentSection = this.sections[this.currentSectionIndex] || {};
      const blockOrder = currentSection.block_order || (this.currentSectionIndex + 1);

      if (this.sessionId) {
        await studyClient.submitExamSection(this.sessionId, blockOrder);

        // Check if there are more sections in this exam
        if (this.currentSectionIndex < this.sections.length - 1) {
          this.currentSectionIndex++;
          const nextSection = this.sections[this.currentSectionIndex] || {};
          const nextBlockOrder = nextSection.block_order || (this.currentSectionIndex + 1);
          await studyClient.startExamSection(this.sessionId, nextBlockOrder);
          this.questions = nextSection.items || [];
          this.remainingSeconds = nextSection.remaining_time_seconds || (nextSection.allocated_time_seconds || (45 * 60));
          this.currentIndex = 0;
          this.answers.clear();
          this.flagged.clear();
          this.startTimer();
          this.renderExamStage();
          return;
        }

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

    // Real backend diagnostic values
    const scaledScore = result?.estimated_total_score !== undefined
      ? `${result.estimated_total_score} / ${result.overall_max_score || 180}`
      : `${totalAnswered} / ${totalQuestions}`;

    const isPassed = Boolean(result?.passed_overall && result?.passed_sectional);
    const statusLabel = isPassed ? 'Pass (Provisional Estimate)' : 'Did Not Meet Passing Threshold';
    const statusClass = isPassed ? 'tactile-pill-jade' : 'tactile-pill-vermilion';

    const sections = Array.isArray(result?.scoring_sections) ? result.scoring_sections : [];

    stage.innerHTML = `
      <div class="test-result-card tactile-card text-center py-10">
        <h2 class="test-result-title font-display text-2xl font-bold mb-2">
          JLPT ${escapeHtml(this.activeLevel)} Simulation Diagnostic Result
        </h2>
        <div class="tactile-pill ${statusClass} my-2 inline-block">
          ${escapeHtml(statusLabel)}
        </div>

        <p class="text-secondary text-sm max-w-lg mx-auto my-4 leading-relaxed">
          Disclaimer: This provisional scaled score is calculated locally for diagnostic purposes and does not represent an official score report from the Japan Foundation or JEES.
        </p>

        <!-- Primary Scaled Score Overview -->
        <div class="flex justify-center gap-6 my-6 flex-wrap">
          <div class="tactile-card p-4 min-w-[140px]">
            <span class="text-xs text-muted block uppercase font-mono">Estimated Scaled Score</span>
            <span class="font-mono text-2xl font-bold text-gold">${escapeHtml(String(scaledScore))}</span>
          </div>
          <div class="tactile-card p-4 min-w-[140px]">
            <span class="text-xs text-muted block uppercase font-mono">Questions Answered</span>
            <span class="font-mono text-2xl font-bold text-warm-paper">${totalAnswered} / ${totalQuestions}</span>
          </div>
          ${result?.raw_accuracy !== undefined ? `
            <div class="tactile-card p-4 min-w-[140px]">
              <span class="text-xs text-muted block uppercase font-mono">Raw Accuracy</span>
              <span class="font-mono text-2xl font-bold text-warm-paper">${Math.round(result.raw_accuracy * 100)}%</span>
            </div>
          ` : ''}
        </div>

        <!-- Sectional Breakdown Grid -->
        ${sections.length > 0 ? `
          <div class="test-sections-breakdown mt-6 text-left max-w-2xl mx-auto">
            <h3 class="text-sm font-mono text-gold uppercase tracking-wider mb-3">Sectional Breakdown</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              ${sections.map(sec => `
                <div class="tactile-card p-3 bg-surface">
                  <div class="flex justify-between items-center mb-1">
                    <span class="font-bold text-sm text-warm-paper">${escapeHtml(sec.section_name || 'Section')}</span>
                    <span class="text-xs font-mono ${sec.passed_threshold ? 'text-green' : 'text-red'}">
                      ${sec.passed_threshold ? 'Passed' : 'Below Minimum'}
                    </span>
                  </div>
                  <div class="flex justify-between items-center text-xs text-muted font-mono">
                    <span>Score: ${sec.estimated_score} / ${sec.max_score}</span>
                    <span>Min: ${sec.pass_threshold}</span>
                  </div>
                  <div class="text-xs text-secondary mt-1 font-mono">
                    Accuracy: ${Math.round((sec.raw_accuracy || 0) * 100)}% (${sec.correct_count || 0}/${sec.total_questions || 0})
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="study-level-picker mt-8">
          <button type="button" class="tactile-btn tactile-btn-primary" id="btn-return-home">
            <span>Return to Dashboard</span>
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

  handleKeyDown(e) {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const item = this.questions[this.currentIndex];
    if (!item) return;

    const choiceNum = parseInt(e.key, 10);
    const choices = Array.isArray(item.choices) ? item.choices : [];
    if (!isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= choices.length) {
      e.preventDefault();
      const choice = choices[choiceNum - 1];
      const cid = choice.choice_id || choice.id || String(choiceNum);
      this.selectChoice(cid);
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      this.toggleFlag(this.currentIndex);
    } else if (e.key === 'ArrowRight' || e.key === 'j') {
      e.preventDefault();
      this.goToQuestion(this.currentIndex + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'k') {
      e.preventDefault();
      this.goToQuestion(this.currentIndex - 1);
    }
  }

  unmount() {
    this.stopTimer();
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this._noticeTimeout) {
      clearTimeout(this._noticeTimeout);
      this._noticeTimeout = null;
    }
    const notice = document.getElementById('test-notice-toast');
    if (notice && notice.parentNode) {
      notice.parentNode.removeChild(notice);
    }
    if (this.activeBlobUrls && this.activeBlobUrls.length > 0) {
      this.activeBlobUrls.forEach(url => studyClient.revokeMediaBlobUrl(url));
      this.activeBlobUrls = [];
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
