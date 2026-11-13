/**
 * StudySessionStore — Resilient, reactive session runner state store for Kiroku Note Desktop.
 * Tracks question index, answers, grading, ghost flags, and delegates checkpointing
 * to session_recovery.js to prevent premature terminations or state loss across tab switches.
 */

import {
  writeStoredSession,
  readStoredSession,
  clearStoredSession
} from './session_recovery.js';

export class StudySessionStore {
  constructor(options = {}) {
    this.sessionId = options.sessionId || null;
    this.sessionType = options.sessionType || 'practice'; // 'practice' | 'exam' | 'mistakes'
    this.items = Array.isArray(options.items) ? [...options.items] : [];
    this.currentIndex = Math.max(0, Number(options.currentIndex) || 0);
    this.activeAnswer = options.activeAnswer ?? null;
    this.hasAnswered = Boolean(options.hasAnswered);
    this.isGraded = Boolean(options.isGraded);
    this.lastGradeResult = options.lastGradeResult || null;
    this.ghostFlags = new Set(Array.isArray(options.ghostFlags) ? options.ghostFlags : []);
    this.listeners = new Set();
    this.autoPersist = options.autoPersist !== false;
  }

  /**
   * Current question item object.
   */
  get currentQuestion() {
    if (this.currentIndex >= 0 && this.currentIndex < this.items.length) {
      return this.items[this.currentIndex];
    }
    return null;
  }

  get totalCount() {
    return this.items.length;
  }

  get progressPercent() {
    if (this.totalCount === 0) return 0;
    return Math.round(((this.currentIndex + 1) / this.totalCount) * 100);
  }

  get isLastQuestion() {
    return this.totalCount > 0 && this.currentIndex >= this.totalCount - 1;
  }

  get isComplete() {
    return this.totalCount > 0 && this.currentIndex >= this.totalCount;
  }

  get displayIndex() {
    return Math.min(this.currentIndex + 1, Math.max(1, this.totalCount));
  }

  /**
   * Subscribes a listener callback to state changes.
   * @param {Function} listener
   * @returns {Function} unsubscribe function
   */
  subscribe(listener) {
    if (typeof listener === 'function') {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    return () => {};
  }

  _notify(eventName, payload) {
    if (this.autoPersist) {
      this.persistCheckpoint();
    }
    for (const listener of this.listeners) {
      try {
        listener(eventName, this, payload);
      } catch (err) {
        console.error('[StudySessionStore] Listener error:', err);
      }
    }
  }

  /**
   * Initializes a fresh session with items.
   */
  initSession({ sessionId, sessionType = 'practice', items = [] }) {
    this.sessionId = sessionId || `session_${Date.now()}`;
    this.sessionType = sessionType;
    this.items = Array.isArray(items) ? [...items] : [];
    this.currentIndex = 0;
    this.activeAnswer = null;
    this.hasAnswered = false;
    this.isGraded = false;
    this.lastGradeResult = null;
    this.ghostFlags.clear();
    this._notify('session_init', { sessionId: this.sessionId, count: this.items.length });
  }

  /**
   * Records selection of an answer option before submission.
   */
  selectAnswer(answer) {
    if (this.hasAnswered) return;
    this.activeAnswer = answer;
    this._notify('answer_selected', { answer });
  }

  /**
   * Marks current question as graded with result.
   */
  markGraded(gradeResult) {
    this.hasAnswered = true;
    this.isGraded = true;
    this.lastGradeResult = gradeResult;
    this._notify('question_graded', { gradeResult });
  }

  /**
   * Toggles Bunpro-style Ghost flag for the current question or question ID.
   */
  toggleGhost(questionId = null) {
    const targetId = questionId || (this.currentQuestion && (this.currentQuestion.id || this.currentQuestion.ulid));
    if (!targetId) return false;

    let isGhost = false;
    if (this.ghostFlags.has(targetId)) {
      this.ghostFlags.delete(targetId);
      isGhost = false;
    } else {
      this.ghostFlags.add(targetId);
      isGhost = true;
    }
    this._notify('ghost_toggled', { questionId: targetId, isGhost });
    return isGhost;
  }

  isGhost(questionId = null) {
    const targetId = questionId || (this.currentQuestion && (this.currentQuestion.id || this.currentQuestion.ulid));
    if (!targetId) return false;
    return this.ghostFlags.has(targetId);
  }

  /**
   * Advances safely to the next question.
   * Returns true if advanced, false if session complete.
   */
  nextQuestion() {
    if (this.isLastQuestion) {
      this.currentIndex = this.totalCount; // Mark complete
      this.activeAnswer = null;
      this.hasAnswered = false;
      this.isGraded = false;
      this.lastGradeResult = null;
      this._notify('session_complete', { total: this.totalCount });
      return false;
    }

    if (this.currentIndex < this.totalCount - 1) {
      this.currentIndex += 1;
      this.activeAnswer = null;
      this.hasAnswered = false;
      this.isGraded = false;
      this.lastGradeResult = null;
      this._notify('question_advanced', {
        currentIndex: this.currentIndex,
        currentQuestion: this.currentQuestion
      });
      return true;
    }

    return false;
  }

  /**
   * Serializes current state to object.
   */
  toJSON() {
    return {
      sessionId: this.sessionId,
      sessionType: this.sessionType,
      items: this.items,
      currentIndex: this.currentIndex,
      activeAnswer: this.activeAnswer,
      hasAnswered: this.hasAnswered,
      isGraded: this.isGraded,
      lastGradeResult: this.lastGradeResult,
      ghostFlags: Array.from(this.ghostFlags)
    };
  }

  /**
   * Checkpoints state to session_recovery localStorage.
   */
  persistCheckpoint() {
    if (!this.sessionId) return;
    try {
      writeStoredSession({
        sessionId: this.sessionId,
        sessionType: this.sessionType,
        currentIndex: this.currentIndex,
        totalItems: this.totalCount,
        ghostFlags: Array.from(this.ghostFlags),
        activeQuestionId: this.currentQuestion ? (this.currentQuestion.id || this.currentQuestion.ulid) : null,
        updatedAt: Date.now()
      });
    } catch (err) {
      console.warn('[StudySessionStore] Failed to write checkpoint:', err);
    }
  }

  /**
   * Clears checkpoint upon clean session completion or exit.
   */
  clearCheckpoint() {
    try {
      clearStoredSession();
    } catch (err) {
      console.warn('[StudySessionStore] Failed to clear checkpoint:', err);
    }
  }

  /**
   * Restores session state from snapshot.
   */
  static restore(snapshot) {
    if (!snapshot) return null;
    return new StudySessionStore(snapshot);
  }
}
