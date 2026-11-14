/**
 * Kiroku Note Desktop — Episode Primer & Recap (Slice 44)
 *
 * Pre-watch Primer:
 * - Top 20 gap words (frequency x unlearned x level <= learner + 1)
 * - Top 5 grammar points
 * - "Mine all" shortcut calling capture API sequentially
 * - 5-question interactive mini quiz from dictionary glosses (no LLM)
 *
 * Post-watch Recap:
 * - Lines watched, % known before/after mining, words mined
 * - Gap words still unseen
 * - Deep link to Study Practice ("Review mined words")
 */

import { escapeHtml } from '../utils/sanitizer.js';
import { apiClient } from '../services/api_client.js';

export class WatchPrimerView {
  constructor(options = {}) {
    this.router = options.router || null;
    this.apiClient = options.apiClient || apiClient;
    this.container = options.container || null;

    this.primerData = null;
    this.recapData = null;
    this.quizState = {
      currentIndex: 0,
      score: 0,
      answered: false,
      answers: []
    };
    this.isMiningAll = false;
  }

  /**
   * Fetch pre-watch primer data from backend API.
   */
  async fetchPrimer(cueHash, cues = null, learnerLevel = null) {
    const payload = {
      hash: cueHash,
      cues: cues,
      learner_level: learnerLevel
    };
    const res = await this.apiClient.request('/api/link/primer', {
      method: 'POST',
      body: payload
    });
    this.primerData = res;
    return res;
  }

  /**
   * Fetch post-session recap data from backend API.
   */
  async fetchRecap(payload) {
    const res = await this.apiClient.request('/api/link/recap', {
      method: 'POST',
      body: payload
    });
    this.recapData = res;
    return res;
  }

  /**
   * Sequentially mine a list of words using the existing capture API.
   */
  async mineAllSequentially(words, onProgress = null) {
    if (!words || !words.length) return [];
    this.isMiningAll = true;
    const results = [];

    for (let i = 0; i < words.length; i++) {
      const item = words[i];
      const wordText = typeof item === 'string' ? item : item.word;
      try {
        const res = await this.apiClient.request('/api/capture', {
          method: 'POST',
          body: {
            text: wordText,
            auto_save: true,
            deck_name: 'Default'
          }
        });
        results.push({ word: wordText, success: true, data: res });
      } catch (err) {
        results.push({ word: wordText, success: false, error: err.message });
      }
      if (typeof onProgress === 'function') {
        onProgress(i + 1, words.length, wordText);
      }
    }

    this.isMiningAll = false;
    return results;
  }

  /**
   * Render the Pre-watch Primer interface.
   */
  renderPrimer(container, primerData = null) {
    if (primerData) this.primerData = primerData;
    const data = this.primerData || { gap_words: [], grammar_points: [], quiz: [] };
    this.container = container;

    const gapWords = data.gap_words || [];
    const grammarPoints = data.grammar_points || [];
    const quizQuestions = data.quiz || [];
    this.quizState = { currentIndex: 0, score: 0, answered: false, answers: [] };

    const markup = `
      <div class="watch-primer-container" style="padding: 1.5rem; max-width: 900px; margin: 0 auto; font-family: var(--font-sans);">
        <header class="primer-header" style="margin-bottom: 2rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 1rem;">
          <h2 style="font-family: var(--font-display); font-size: 1.75rem; color: var(--text-primary); margin: 0 0 0.5rem 0;">
            Episode Primer
          </h2>
          <div style="font-size: 0.875rem; color: var(--text-muted); display: flex; gap: 1rem;">
            <span>Learner Level: <strong>${escapeHtml(data.learner_level || 'N4')}</strong></span>
            <span>Total Cues: <strong>${escapeHtml(data.total_cues || 0)}</strong></span>
            <span>Gap Words: <strong>${gapWords.length}</strong></span>
          </div>
        </header>

        <!-- Top Gap Words Section -->
        <section class="primer-gap-words" style="margin-bottom: 2.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h3 style="font-size: 1.25rem; color: var(--text-primary); margin: 0;">
              Key Vocabulary Gaps (Top ${gapWords.length})
            </h3>
            <button id="primer-mine-all-btn" class="btn btn-primary" style="padding: 0.5rem 1rem; border-radius: 6px; background: var(--color-brand); color: var(--pure-white); border: none; cursor: pointer; font-weight: 500;">
              Mine All
            </button>
          </div>
          <div id="primer-mine-status" style="font-size: 0.85rem; color: var(--text-accent); margin-bottom: 0.75rem; min-height: 1.2rem;"></div>

          <div class="primer-table-wrapper" style="border: 1px solid var(--border-subtle); border-radius: 8px; overflow: hidden; background: var(--surface-card);">
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
              <thead>
                <tr style="background: var(--surface-header); color: var(--text-muted); border-bottom: 1px solid var(--border-subtle);">
                  <th style="padding: 0.75rem 1rem;">Word</th>
                  <th style="padding: 0.75rem 1rem;">Reading</th>
                  <th style="padding: 0.75rem 1rem;">Meaning</th>
                  <th style="padding: 0.75rem 1rem;">Level</th>
                  <th style="padding: 0.75rem 1rem;">Freq</th>
                  <th style="padding: 0.75rem 1rem; text-align: right;">Action</th>
                </tr>
              </thead>
              <tbody id="primer-gap-words-tbody">
                ${gapWords.length === 0 ? `
                  <tr><td colspan="6" style="padding: 1.5rem; text-align: center; color: var(--text-muted);">No vocabulary gaps detected for your level.</td></tr>
                ` : gapWords.map((item, idx) => `
                  <tr class="gap-word-row" data-word="${escapeHtml(item.word)}" style="border-bottom: 1px solid var(--border-subtle);">
                    <td style="padding: 0.75rem 1rem; font-family: var(--font-japanese); font-weight: 600; color: var(--text-primary); font-size: 1.05rem;">
                      ${escapeHtml(item.word)}
                    </td>
                    <td style="padding: 0.75rem 1rem; font-family: var(--font-japanese); color: var(--text-secondary);">
                      ${escapeHtml(item.reading)}
                    </td>
                    <td style="padding: 0.75rem 1rem; color: var(--text-muted); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                      ${escapeHtml(item.meaning)}
                    </td>
                    <td style="padding: 0.75rem 1rem;">
                      <span class="badge" style="padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; background: var(--surface-well); color: var(--text-accent);">
                        ${escapeHtml(item.level || 'Vocab')}
                      </span>
                    </td>
                    <td style="padding: 0.75rem 1rem; color: var(--text-muted); font-variant-numeric: tabular-nums;">
                      ${item.frequency}x
                    </td>
                    <td style="padding: 0.75rem 1rem; text-align: right;">
                      <button class="mine-single-btn" data-word="${escapeHtml(item.word)}" style="padding: 0.3rem 0.6rem; border-radius: 4px; font-size: 0.75rem; background: transparent; border: 1px solid var(--border-subtle); color: var(--text-primary); cursor: pointer;">
                        Mine
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>

        <!-- Top Grammar Points Section -->
        <section class="primer-grammar-section" style="margin-bottom: 2.5rem;">
          <h3 style="font-size: 1.25rem; color: var(--text-primary); margin: 0 0 1rem 0;">
            Key Grammar Points (Top ${grammarPoints.length})
          </h3>
          <div class="grammar-points-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem;">
            ${grammarPoints.length === 0 ? `
              <div style="grid-column: 1 / -1; padding: 1rem; background: var(--surface-card); border-radius: 8px; color: var(--text-muted); text-align: center;">
                No grammar points isolated for this segment.
              </div>
            ` : grammarPoints.map(g => `
              <div class="grammar-card" style="background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                  <span style="font-family: var(--font-japanese); font-weight: 600; color: var(--color-grammar); font-size: 1rem;">
                    ${escapeHtml(g.display || g.pattern_key)}
                  </span>
                  <span class="badge" style="padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.7rem; background: var(--surface-well); color: var(--text-muted);">
                    ${escapeHtml(g.level || 'Grammar')}
                  </span>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-muted);">
                  Frequency: ${g.frequency}x in episode
                </div>
              </div>
            `).join('')}
          </div>
        </section>

        <!-- 5-Question Mini Quiz Section -->
        <section class="primer-quiz-section" style="margin-bottom: 2rem;">
          <h3 style="font-size: 1.25rem; color: var(--text-primary); margin: 0 0 1rem 0;">
            5-Question Primer Mini Quiz
          </h3>
          <div id="primer-quiz-mount" style="background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.5rem;">
            <!-- Quiz mounted dynamically -->
          </div>
        </section>
      </div>
    `;

    container.innerHTML = markup;
    this._attachPrimerListeners(container, gapWords, quizQuestions);
    this._renderQuizQuestion(container, quizQuestions);
  }

  _attachPrimerListeners(container, gapWords, quizQuestions) {
    const mineAllBtn = container.querySelector('#primer-mine-all-btn');
    const mineStatus = container.querySelector('#primer-mine-status');

    if (mineAllBtn) {
      mineAllBtn.addEventListener('click', async () => {
        if (this.isMiningAll || !gapWords.length) return;
        mineAllBtn.disabled = true;
        mineAllBtn.textContent = 'Mining...';
        if (mineStatus) mineStatus.textContent = `Mining 1 of ${gapWords.length}...`;

        await this.mineAllSequentially(gapWords, (done, total, word) => {
          if (mineStatus) mineStatus.textContent = `Mined ${done} of ${total}: ${word}`;
          const rowBtn = container.querySelector(`.mine-single-btn[data-word="${word}"]`);
          if (rowBtn) {
            rowBtn.disabled = true;
            rowBtn.textContent = 'Mined';
            rowBtn.style.color = '#34d399';
          }
        });

        mineAllBtn.textContent = 'Mined All';
        if (mineStatus) mineStatus.textContent = `All ${gapWords.length} gap words successfully mined into deck!`;
      });
    }

    // Individual mine buttons
    const singleBtns = container.querySelectorAll('.mine-single-btn');
    singleBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const word = btn.getAttribute('data-word');
        if (!word) return;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await this.apiClient.request('/api/capture', {
            method: 'POST',
            body: { text: word, auto_save: true, deck_name: 'Default' }
          });
          btn.textContent = 'Mined';
          btn.style.color = '#34d399';
        } catch (err) {
          btn.textContent = 'Error';
          btn.style.color = '#f87171';
        }
      });
    });
  }

  _renderQuizQuestion(container, quizQuestions) {
    const quizMount = container.querySelector('#primer-quiz-mount');
    if (!quizMount) return;

    if (!quizQuestions || quizQuestions.length === 0) {
      quizMount.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 1rem;">
          No vocabulary available for quiz in this episode.
        </div>
      `;
      return;
    }

    const { currentIndex, score } = this.quizState;
    if (currentIndex >= quizQuestions.length) {
      // Quiz completed summary
      quizMount.innerHTML = `
        <div style="text-align: center; padding: 1.5rem;">
          <h4 style="font-size: 1.25rem; color: var(--text-primary); margin: 0 0 0.5rem 0;">Quiz Complete!</h4>
          <p style="font-size: 1.1rem; color: var(--text-accent); margin: 0 0 1.5rem 0;">
            Your Score: <strong>${score} / ${quizQuestions.length}</strong>
          </p>
          <button id="primer-quiz-restart-btn" class="btn" style="padding: 0.5rem 1.25rem; border-radius: 6px; background: var(--surface-well); color: var(--text-primary); border: 1px solid var(--border-subtle); cursor: pointer;">
            Restart Quiz
          </button>
        </div>
      `;
      const restartBtn = quizMount.querySelector('#primer-quiz-restart-btn');
      if (restartBtn) {
        restartBtn.addEventListener('click', () => {
          this.quizState = { currentIndex: 0, score: 0, answered: false, answers: [] };
          this._renderQuizQuestion(container, quizQuestions);
        });
      }
      return;
    }

    const q = quizQuestions[currentIndex];
    const options = q.options || [];

    quizMount.innerHTML = `
      <div class="quiz-question-card">
        <div style="display: flex; justify-content: space-between; margin-bottom: 1rem; font-size: 0.85rem; color: var(--text-muted);">
          <span>Question ${currentIndex + 1} of ${quizQuestions.length}</span>
          <span>Score: ${score}</span>
        </div>

        <div style="margin-bottom: 1.25rem;">
          <div style="font-family: var(--font-japanese); font-size: 1.4rem; font-weight: bold; color: var(--text-primary); margin-bottom: 0.3rem;">
            ${escapeHtml(q.word)} <span style="font-size: 1rem; color: var(--text-muted); font-weight: normal;">(${escapeHtml(q.reading)})</span>
          </div>
          <div style="font-size: 0.95rem; color: var(--text-secondary);">
            ${escapeHtml(q.prompt)}
          </div>
        </div>

        <div class="quiz-options-grid" style="display: grid; grid-template-columns: 1fr; gap: 0.6rem; margin-bottom: 1.25rem;">
          ${options.map((opt, oIdx) => `
            <button class="quiz-option-btn" data-index="${oIdx}" style="text-align: left; padding: 0.75rem 1rem; border-radius: 6px; background: var(--surface-well); border: 1px solid var(--border-subtle); color: var(--text-primary); cursor: pointer; transition: background 0.15s ease;">
              ${escapeHtml(opt)}
            </button>
          `).join('')}
        </div>

        <div id="quiz-feedback-box" style="display: none; padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.9rem;"></div>

        <div style="display: flex; justify-content: flex-end;">
          <button id="quiz-next-btn" style="display: none; padding: 0.5rem 1.25rem; border-radius: 6px; background: var(--color-brand); color: var(--pure-white); border: none; cursor: pointer;">
            ${currentIndex + 1 === quizQuestions.length ? 'Finish Quiz' : 'Next Question'}
          </button>
        </div>
      </div>
    `;

    const optionBtns = quizMount.querySelectorAll('.quiz-option-btn');
    const feedbackBox = quizMount.querySelector('#quiz-feedback-box');
    const nextBtn = quizMount.querySelector('#quiz-next-btn');

    optionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.quizState.answered) return;
        this.quizState.answered = true;
        const selectedIdx = parseInt(btn.getAttribute('data-index'), 10);
        const isCorrect = selectedIdx === q.correct_index;

        if (isCorrect) {
          this.quizState.score += 1;
          btn.style.background = '#065f46';
          btn.style.borderColor = '#10b981';
          feedbackBox.style.display = 'block';
          feedbackBox.style.background = '#064e3b';
          feedbackBox.style.color = '#a7f3d0';
          feedbackBox.textContent = `Correct! ${q.explanation || ''}`;
        } else {
          btn.style.background = '#7f1d1d';
          btn.style.borderColor = '#ef4444';
          const correctBtn = quizMount.querySelector(`.quiz-option-btn[data-index="${q.correct_index}"]`);
          if (correctBtn) {
            correctBtn.style.background = '#065f46';
            correctBtn.style.borderColor = '#10b981';
          }
          feedbackBox.style.display = 'block';
          feedbackBox.style.background = '#7f1d1d';
          feedbackBox.style.color = '#fecaca';
          feedbackBox.textContent = `Incorrect. ${q.explanation || ''}`;
        }

        if (nextBtn) {
          nextBtn.style.display = 'inline-block';
        }
      });
    });

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.quizState.currentIndex += 1;
        this.quizState.answered = false;
        this._renderQuizQuestion(container, quizQuestions);
      });
    }
  }

  /**
   * Render Post-Watch Session Recap interface.
   */
  renderRecap(container, recapData = null) {
    if (recapData) this.recapData = recapData;
    const data = this.recapData || {
      title: 'Session Recap',
      site: 'local',
      lines_watched: 0,
      known_pct_before: 0,
      known_pct_after: 0,
      words_mined: [],
      gap_words_unseen: [],
      minutes: 0,
      review_link: '#/study?mode=practice&filter=mined'
    };
    this.container = container;

    const wordsMined = data.words_mined || [];
    const unseenGaps = data.gap_words_unseen || [];
    const diff = (data.known_pct_after - data.known_pct_before).toFixed(1);

    const markup = `
      <div class="watch-recap-container" style="padding: 1.5rem; max-width: 850px; margin: 0 auto; font-family: var(--font-sans);">
        <header class="recap-header" style="margin-bottom: 2rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 1rem;">
          <h2 style="font-family: var(--font-display); font-size: 1.75rem; color: var(--text-primary); margin: 0 0 0.5rem 0;">
            Session Recap
          </h2>
          <div style="font-size: 0.875rem; color: var(--text-muted);">
            <span>${escapeHtml(data.title || 'Episode')}</span> • <span>${escapeHtml(data.site || 'Source')}</span> • <span>${data.minutes} min</span>
          </div>
        </header>

        <!-- Stat Cards -->
        <div class="recap-stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
          <div class="stat-card" style="background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.25rem;">
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">Lines Watched</div>
            <div style="font-size: 1.75rem; font-weight: bold; color: var(--text-primary);">${data.lines_watched}</div>
          </div>

          <div class="stat-card" style="background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.25rem;">
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">Comprehension</div>
            <div style="font-size: 1.75rem; font-weight: bold; color: var(--text-accent);">
              ${data.known_pct_after}%
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">
              Before: ${data.known_pct_before}% (${diff >= 0 ? '+' : ''}${diff}%)
            </div>
          </div>

          <div class="stat-card" style="background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.25rem;">
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">Words Mined</div>
            <div style="font-size: 1.75rem; font-weight: bold; color: var(--color-success, var(--jade));">${wordsMined.length}</div>
          </div>

          <div class="stat-card" style="background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.25rem;">
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">Unseen Gaps</div>
            <div style="font-size: 1.75rem; font-weight: bold; color: var(--color-warning, var(--amber));">${unseenGaps.length}</div>
          </div>
        </div>

        <!-- Mined Words Section with CTA -->
        <section class="recap-mined-section" style="margin-bottom: 2rem; background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h3 style="font-size: 1.15rem; color: var(--text-primary); margin: 0;">
              Mined in this Session (${wordsMined.length})
            </h3>
            <button id="recap-review-btn" class="btn btn-primary" style="padding: 0.5rem 1rem; border-radius: 6px; background: var(--color-brand); color: var(--pure-white); border: none; cursor: pointer; font-weight: 500;">
              Review Mined Words
            </button>
          </div>

          <div class="mined-chips-container" style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            ${wordsMined.length === 0 ? `
              <span style="font-size: 0.9rem; color: var(--text-muted);">No new words mined during this session.</span>
            ` : wordsMined.map(w => `
              <span class="word-chip" style="padding: 0.35rem 0.75rem; border-radius: 9999px; background: var(--surface-well); border: 1px solid var(--color-success, var(--jade)); color: var(--color-success, var(--jade)); font-family: var(--font-japanese); font-size: 0.9rem;">
                ${escapeHtml(w)}
              </span>
            `).join('')}
          </div>
        </section>

        <!-- Unseen Gap Words -->
        <section class="recap-unseen-section" style="margin-bottom: 2rem; background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 1.5rem;">
          <h3 style="font-size: 1.15rem; color: var(--text-primary); margin: 0 0 1rem 0;">
            Remaining Vocabulary Gaps (${unseenGaps.length})
          </h3>
          <div class="unseen-chips-container" style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            ${unseenGaps.length === 0 ? `
              <span style="font-size: 0.9rem; color: var(--text-muted);">None! You mastered all detected gaps in this episode.</span>
            ` : unseenGaps.map(g => `
              <span class="gap-chip" style="padding: 0.35rem 0.75rem; border-radius: 9999px; background: var(--surface-well); border: 1px solid var(--border-subtle); color: var(--text-muted); font-family: var(--font-japanese); font-size: 0.9rem;">
                ${escapeHtml(g)}
              </span>
            `).join('')}
          </div>
        </section>
      </div>
    `;

    container.innerHTML = markup;

    const reviewBtn = container.querySelector('#recap-review-btn');
    if (reviewBtn) {
      reviewBtn.addEventListener('click', () => {
        if (this.router && typeof this.router.navigateToTab === 'function') {
          this.router.navigateToTab('study');
        } else if (typeof window !== 'undefined') {
          window.location.hash = '#study';
        }
      });
    }
  }

  destroy() {
    this.container = null;
    this.primerData = null;
    this.recapData = null;
  }
}

