/**
 * Kiroku Note Desktop — Study Practice Drill Engine View Controller
 * Practice drill lifecycle, objective grader feedback pop, pedagogical nuance explanation,
 * adaptive repetition difficulty rating (Easy/Normal/Hard), and next question advance.
 */

import { studyClient } from '../services/study_client.js';
import { renderAssetSlot } from '../assets_map.js';

export class StudyView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.currentQuestionIndex = 0;
    this.hasAnswered = false;
    this.elapsedSeconds = 0;
    this.timerInterval = null;
    this.selectedChoice = null;
    this.isCorrect = false;

    // Sample question pool matching study.db F1-F4 contracts
    this.practiceItems = [
      {
        level: 'N3',
        category: 'Grammar',
        format: 'F1 Single Select',
        promptJa: 'いくら頼まれても、引き受ける＿＿＿にはいかない。',
        choices: [
          'こと',
          'わけ',
          'はず',
          'もの'
        ],
        correctIndex: 1, // 'わけ' -> 〜わけにはいかない
        explanation: '「〜わけにはいかない」は、社会的・道徳的・心理的な理由から「そうすることはできない」と強く表す文法です。「ことにはいかない」という表現は文法的に誤りです。',
        translation: 'No matter how much they ask, I cannot possibly accept.'
      },
      {
        level: 'N3',
        category: 'Vocabulary',
        format: 'F1 Single Select',
        promptJa: '夜遅くまで本を読んでいたので、＿＿＿が痛くなった。',
        choices: [
          '鼻',
          '目',
          '耳',
          '足'
        ],
        correctIndex: 1, // '目'
        explanation: '本を読む行為と直接関係する感覚器官は「目」です。長時間の読書による眼精疲労の文脈です。',
        translation: 'Because I was reading a book until late at night, my eyes started to hurt.'
      }
    ];
  }

  mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
    this.startActiveTimer();
  }

  render() {
    const item = this.practiceItems[this.currentQuestionIndex] || this.practiceItems[0];

    this.container.innerHTML = `
      <div class="study-view-wrapper">
        <div class="study-view-container">
          <!-- Drill Session Header Bar -->
          <div class="study-header-bar tactile-card">
            <div class="study-header-left">
              <span class="tactile-pill tactile-pill-gold">${item.level} ${item.category}</span>
              <span class="study-question-count font-mono">Item ${this.currentQuestionIndex + 1} of ${this.practiceItems.length}</span>
            </div>
            <div class="study-timer font-mono text-sm" id="study-active-timer">
              ⏱ Active: 00:00
            </div>
          </div>

          <!-- Question Prompt Card (Mandatory Pitch-Black #000000) -->
          <div class="study-prompt-card surface-pitch-black tactile-card">
            <div class="study-prompt-header">
              <span class="font-mono text-xs text-gold">${item.format}</span>
              <span class="text-xs text-muted">Objective Grading</span>
            </div>
            <h2 class="study-prompt-text font-japanese" id="study-prompt-ja">
              ${item.promptJa}
            </h2>
          </div>

          <!-- 4 Interactive Tactile Choice Buttons -->
          <div class="study-choices-grid" id="study-choices-grid" role="radiogroup">
            ${item.choices.map((choice, i) => `
              <button
                type="button"
                class="study-choice-btn tactile-btn tactile-card-interactive"
                data-index="${i}"
                tabindex="0"
              >
                <span class="choice-num font-mono">${i + 1}</span>
                <span class="choice-text font-japanese">${choice}</span>
              </button>
            `).join('')}
          </div>

          <!-- Objective Grading Feedback Banner (Hidden until answered) -->
          <div class="grading-feedback-banner tactile-card" id="grading-banner" style="display: none;">
            <div class="grading-feedback-content">
              <span class="grading-status-icon" id="grading-icon">✓</span>
              <div class="grading-text-block">
                <span class="grading-verdict" id="grading-verdict">正解 · CORRECT</span>
                <span class="grading-points text-xs font-mono">+10 Points Added</span>
              </div>
            </div>
          </div>

          <!-- Pedagogical Explanation Card (Reveals on answer) -->
          <div class="pedagogical-explanation-card tactile-card" id="explanation-card" style="display: none;">
            <div class="explanation-header">
              <span class="explanation-title font-bold text-gold">Pedagogical Breakdown · 解説</span>
            </div>
            <p class="explanation-text" id="explanation-text">
              ${item.explanation}
            </p>
            <p class="explanation-trans text-sm text-secondary mt-2" id="explanation-trans">
              Translation: ${item.translation}
            </p>

            <!-- Adaptive Repetition Rating Bar (Easy, Normal, Hard) -->
            <div class="adaptive-rating-section">
              <span class="rating-label text-xs text-muted uppercase">Rate Difficulty for Spaced Repetition:</span>
              <div class="rating-buttons-row">
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

          <!-- Mascot Cheer Slot -->
          ${renderAssetSlot('study-drill-cheer', 'study-mascot-box')}
        </div>
      </div>
    `;
  }

  setupEvents() {
    const choices = this.container.querySelectorAll('.study-choice-btn');
    choices.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.hasAnswered) return;
        const index = parseInt(btn.dataset.index, 10);
        this.gradeAnswer(index);
      });
    });

    const btnNext = document.getElementById('btn-next-question');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        this.advanceNextQuestion();
      });
    }

    // Rating buttons
    this.container.querySelectorAll('.btn-rate-difficulty').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const rating = e.currentTarget.dataset.rating;
        this.container.querySelectorAll('.btn-rate-difficulty').forEach((b) => b.classList.remove('is-selected-rating'));
        e.currentTarget.classList.add('is-selected-rating');
        console.log(`[Study] Recorded feedback rating: ${rating}`);
      });
    });
  }

  gradeAnswer(selectedIndex) {
    this.hasAnswered = true;
    this.selectedChoice = selectedIndex;
    const currentItem = this.practiceItems[this.currentQuestionIndex];
    this.isCorrect = selectedIndex === currentItem.correctIndex;

    // Highlight chosen button
    const choices = this.container.querySelectorAll('.study-choice-btn');
    choices.forEach((btn, i) => {
      btn.disabled = true;
      if (i === currentItem.correctIndex) {
        btn.classList.add('is-choice-correct');
      } else if (i === selectedIndex && !this.isCorrect) {
        btn.classList.add('is-choice-incorrect');
      }
    });

    // Reveal grading banner
    const banner = document.getElementById('grading-banner');
    const icon = document.getElementById('grading-icon');
    const verdict = document.getElementById('grading-verdict');

    if (banner && icon && verdict) {
      banner.style.display = 'block';
      banner.className = `grading-feedback-banner tactile-card ${this.isCorrect ? 'banner-correct' : 'banner-incorrect'}`;
      icon.textContent = this.isCorrect ? '✓' : '✗';
      verdict.textContent = this.isCorrect ? '正解 · CORRECT' : '不正解 · INCORRECT';
    }

    // Reveal explanation card
    const expCard = document.getElementById('explanation-card');
    if (expCard) {
      expCard.style.display = 'block';
    }
  }

  advanceNextQuestion() {
    this.currentQuestionIndex = (this.currentQuestionIndex + 1) % this.practiceItems.length;
    this.hasAnswered = false;
    this.render();
    this.setupEvents();
  }

  startActiveTimer() {
    const timerEl = document.getElementById('study-active-timer');
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds += 1;
      const mins = Math.floor(this.elapsedSeconds / 60);
      const secs = this.elapsedSeconds % 60;
      if (timerEl) {
        timerEl.textContent = `⏱ Active: ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      }
    }, 1000);
  }

  unmount() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.container) this.container.innerHTML = '';
  }
}

