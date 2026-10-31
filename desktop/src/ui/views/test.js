/**
 * Kiroku Note Desktop — Test Engine (JLPT Simulation) View Controller
 * Timed JLPT examination simulation, anti-cheat countdown timer, split-view reading passage,
 * 4-choice tactile option cards, 32-item question palette bar, and section submission snapshot.
 */

import { studyClient } from '../services/study_client.js';
import { renderAssetSlot } from '../assets_map.js';

export class TestView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.remainingSeconds = 45 * 60; // 45 mins
    this.timerInterval = null;
    this.currentIndex = 0;
    this.totalQuestions = 32;
    this.answers = new Map(); // questionIndex -> selectedChoice (1-4)
    this.flagged = new Set();
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
    this.startTimer();
  }

  render() {
    this.container.innerHTML = `
      <div class="test-view-wrapper">
        <div class="test-view-container">
          <!-- Exam Header Strip: Timer & Section Info -->
          <div class="test-header-bar tactile-card">
            <div class="test-header-left">
              <span class="tactile-pill tactile-pill-vermilion">JLPT N3 SIMULATION</span>
              <span class="test-section-name">Section 1: Language Knowledge &amp; Reading (言語知識・読解)</span>
            </div>

            <!-- Anti-Cheat Persistent Countdown Timer -->
            <div class="test-timer-group" id="test-timer-group">
              <span class="timer-label">TIME REMAINING:</span>
              <span class="timer-countdown font-mono font-bold" id="exam-countdown">45:00</span>
            </div>

            <!-- Proctor Mascot Slot -->
            ${renderAssetSlot('test-exam-proctor', 'test-proctor-slot')}
          </div>

          <!-- Exam Main Stage: Split Reading Passage (Left) + Question & Choices (Right) -->
          <div class="test-stage-grid">
            <!-- Left Pane: Split-View Reading Passage (Pitch Black #000000) -->
            <div class="test-passage-pane surface-pitch-black tactile-card">
              <div class="passage-header-row">
                <span class="passage-title font-mono text-gold">READING PASSAGE · 問題4 長文読解</span>
                <span class="text-xs text-muted">Questions 15–18 refer to this text</span>
              </div>
              <div class="passage-body-content">
                <p class="passage-paragraph">
                  近年、都市部においてシェアハウスを選択する若者が急速に増加している。
                  かつては家賃を低く抑えるための手段と見なされる傾向が強かったが、
                  今日では異業種の人々と交流し、互いに刺激を受け合えるコミュニティとしての
                  価値が再評価されている。
                </p>
                <p class="passage-paragraph">
                  しかし、共同生活にはプライバシーの確保や共有スペースの清掃といった
                  日常的なトラブルの種も潜んでいる。専門家は、規則に縛られすぎない
                  柔軟な合意形成と、住人同士の自然な対話が長続きの鍵だと指摘する。
                </p>
              </div>
            </div>

            <!-- Right Pane: Question Prompt & 4 Tactile Option Cards -->
            <div class="test-question-pane">
              <!-- Pitch-Black Question Prompt Card (#000000) -->
              <div class="test-prompt-card surface-pitch-black tactile-card">
                <div class="prompt-header-row">
                  <span class="prompt-item-badge font-mono text-gold" id="prompt-item-num">QUESTION 15 OF 32</span>
                  <button class="btn-flag-review tactile-btn tactile-btn-sm" id="btn-toggle-flag" title="Mark this question for review">
                    <span id="flag-icon">☆</span>
                    <span id="flag-text">Mark for Review</span>
                  </button>
                </div>
                <div class="prompt-text-content" id="prompt-text">
                  筆者によると、最近シェアハウスを選ぶ若者が増えている最も大きな理由は何ですか。
                </div>
              </div>

              <!-- 4 Tactile Choice Option Cards (Press 1, 2, 3, 4) -->
              <div class="test-options-list" role="radiogroup" aria-label="Answer Choices">
                <div class="test-option-card tactile-card tactile-card-interactive" data-choice="1" tabindex="0">
                  <span class="option-shortcut font-mono">1</span>
                  <p class="option-text">家賃が非常に安く、生活費を最小限に抑えられるから。</p>
                </div>
                <div class="test-option-card tactile-card tactile-card-interactive" data-choice="2" tabindex="0">
                  <span class="option-shortcut font-mono">2</span>
                  <p class="option-text">多様な人々と交流し、刺激的なコミュニティを体験できるから。</p>
                </div>
                <div class="test-option-card tactile-card tactile-card-interactive" data-choice="3" tabindex="0">
                  <span class="option-shortcut font-mono">3</span>
                  <p class="option-text">厳しい規則のもとで規律正しい生活習慣を身につけられるから。</p>
                </div>
                <div class="test-option-card tactile-card tactile-card-interactive" data-choice="4" tabindex="0">
                  <span class="option-shortcut font-mono">4</span>
                  <p class="option-text">都市部の住宅不足により一人暮らし用の部屋が見つからないから。</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Bottom: 32-Item Question Palette Bar & Submit Button -->
          <div class="test-palette-bar tactile-card">
            <div class="palette-scroll-wrap" id="palette-wrap">
              <!-- Render 32 numbered question buttons -->
              ${Array.from({ length: 32 }, (_, i) => `
                <button
                  type="button"
                  class="palette-item ${i === 0 ? 'is-current' : ''}"
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
        </div>
      </div>
    `;
  }

  setupEvents() {
    window.addEventListener('keydown', this.handleKeyDown);

    // Option cards selection
    const options = this.container.querySelectorAll('.test-option-card');
    options.forEach((opt) => {
      opt.addEventListener('click', () => {
        const choice = parseInt(opt.dataset.choice, 10);
        this.selectChoice(choice);
      });
    });

    // Mark for review button
    const btnFlag = document.getElementById('btn-toggle-flag');
    if (btnFlag) {
      btnFlag.addEventListener('click', () => {
        this.toggleFlag(this.currentIndex);
      });
    }

    // Palette item clicks
    const paletteBtns = this.container.querySelectorAll('.palette-item');
    paletteBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index, 10);
        this.goToQuestion(index);
      });
    });

    // Finish Exam Button
    const btnFinish = document.getElementById('btn-finish-exam');
    if (btnFinish) {
      btnFinish.addEventListener('click', () => {
        const answeredCount = this.answers.size;
        if (confirm(`Submit section? You have answered ${answeredCount} of ${this.totalQuestions} questions.`)) {
          alert('Section submitted! Scaled estimated score: 142/180 (Pass)');
          this.router.navigateToTab('home');
        }
      });
    }
  }

  handleKeyDown(e) {
    if (['1', '2', '3', '4'].includes(e.key)) {
      this.selectChoice(parseInt(e.key, 10));
    }
  }

  selectChoice(choice) {
    this.answers.set(this.currentIndex, choice);

    // Update option card visual state
    const options = this.container.querySelectorAll('.test-option-card');
    options.forEach((opt) => {
      const isSelected = parseInt(opt.dataset.choice, 10) === choice;
      opt.classList.toggle('is-selected', isSelected);
    });

    // Update palette button
    this.updatePaletteButton(this.currentIndex);
  }

  toggleFlag(index) {
    if (this.flagged.has(index)) {
      this.flagged.delete(index);
    } else {
      this.flagged.add(index);
    }

    const flagIcon = document.getElementById('flag-icon');
    const flagText = document.getElementById('flag-text');
    const isFlagged = this.flagged.has(index);

    if (flagIcon) flagIcon.textContent = isFlagged ? '★' : '☆';
    if (flagText) flagText.textContent = isFlagged ? 'Flagged for Review' : 'Mark for Review';

    this.updatePaletteButton(index);
  }

  updatePaletteButton(index) {
    const btn = this.container.querySelector(`.palette-item[data-index="${index}"]`);
    if (!btn) return;

    const isAnswered = this.answers.has(index);
    const isFlagged = this.flagged.has(index);

    btn.classList.toggle('is-answered', isAnswered);
    btn.classList.toggle('is-flagged', isFlagged);
  }

  goToQuestion(index) {
    this.currentIndex = index;

    // Update prompt number
    const promptNum = document.getElementById('prompt-item-num');
    if (promptNum) promptNum.textContent = `QUESTION ${index + 1} OF ${this.totalQuestions}`;

    // Update active palette indicator
    this.container.querySelectorAll('.palette-item').forEach((b) => {
      b.classList.toggle('is-current', parseInt(b.dataset.index, 10) === index);
    });

    // Restore selected choice
    const savedChoice = this.answers.get(index);
    const options = this.container.querySelectorAll('.test-option-card');
    options.forEach((opt) => {
      opt.classList.toggle('is-selected', parseInt(opt.dataset.choice, 10) === savedChoice);
    });

    // Restore flag status
    const isFlagged = this.flagged.has(index);
    const flagIcon = document.getElementById('flag-icon');
    const flagText = document.getElementById('flag-text');
    if (flagIcon) flagIcon.textContent = isFlagged ? '★' : '☆';
    if (flagText) flagText.textContent = isFlagged ? 'Flagged for Review' : 'Mark for Review';
  }

  startTimer() {
    const timerDisplay = document.getElementById('exam-countdown');
    const timerGroup = document.getElementById('test-timer-group');

    this.timerInterval = setInterval(() => {
      if (this.remainingSeconds <= 0) {
        clearInterval(this.timerInterval);
        alert('Time is up! Submitting exam section.');
        this.router.navigateToTab('home');
        return;
      }

      this.remainingSeconds -= 1;
      const mins = Math.floor(this.remainingSeconds / 60);
      const secs = this.remainingSeconds % 60;

      if (timerDisplay) {
        timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      }

      // Urgent pulse when < 5 mins
      if (this.remainingSeconds < 300 && timerGroup) {
        timerGroup.classList.add('is-urgent-pulse');
      }
    }, 1000);
  }

  unmount() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.container) this.container.innerHTML = '';
  }
}

