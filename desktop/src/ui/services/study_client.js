/**
 * Kiroku Note Desktop — Study API Client Bridge
 * Bridges renderer requests to the authenticated Study database API (/api/study/v1)
 * via window.desktopAPI.studyApi (Bearer token stays securely in main process).
 */

export class StudyClient {
  get isAvailable() {
    return typeof window !== 'undefined' && Boolean(window.desktopAPI?.studyApi);
  }

  async request(options) {
    if (!this.isAvailable) {
      console.warn('[StudyClient] desktopAPI.studyApi is not available in this context');
      throw new Error('Study API bridge is not available');
    }
    const result = await window.desktopAPI.studyApi.request(options);
    if (!result.success) {
      const err = new Error(result.error?.message || 'Study API request failed');
      err.code = result.error?.code || 'STUDY_API_ERROR';
      err.details = result.error?.details;
      err.status = result.statusCode || 400;
      throw err;
    }
    return result.data;
  }

  // Question Bank & Summary
  async getBankSummary(level = null) {
    return this.request({
      method: 'GET',
      path: '/api/study/v1/bank/summary',
      query: level ? { level } : undefined
    });
  }

  async getExamReadiness() {
    return this.request({
      method: 'GET',
      path: '/api/study/v1/exam/readiness'
    });
  }

  async getLearningOverview() {
    return this.request({
      method: 'GET',
      path: '/api/study/v1/dashboard/overview'
    });
  }

  async getDiagnostics() {
    return this.request({
      method: 'GET',
      path: '/api/study/v1/diagnostics'
    });
  }

  async getSettings() {
    return this.request({
      method: 'GET',
      path: '/api/study/v1/settings'
    });
  }

  async updateSettings(updates) {
    return this.request({
      method: 'PATCH',
      path: '/api/study/v1/settings',
      body: updates
    });
  }

  async searchQuestions(query = {}) {
    return this.request({
      method: 'GET',
      path: '/api/study/v1/bank/questions',
      query
    });
  }

  async getQuestion(id) {
    return this.request({
      method: 'GET',
      path: `/api/study/v1/bank/questions/${encodeURIComponent(id)}`
    });
  }

  async getQuestionProvenance(id) {
    return this.request({
      method: 'GET',
      path: `/api/study/v1/bank/questions/${encodeURIComponent(id)}/provenance`
    });
  }

  // Practice Engine (Milestone 6)
  async createPracticeSession(level = 'N3', count = 10, formatId = null) {
    return this.request({
      method: 'POST',
      path: '/api/study/v1/practice/sessions',
      body: {
        level,
        item_count: count,
        format_id: formatId
      }
    });
  }

  async getPracticeSession(sessionId) {
    return this.request({
      method: 'GET',
      path: `/api/study/v1/practice/sessions/${encodeURIComponent(sessionId)}`
    });
  }

  async submitPracticeAnswer(sessionId, payload) {
    return this.request({
      method: 'POST',
      path: `/api/study/v1/practice/sessions/${encodeURIComponent(sessionId)}/answer`,
      body: payload
    });
  }

  async recordPracticeFeedback(sessionId, payload) {
    return this.request({
      method: 'POST',
      path: `/api/study/v1/practice/sessions/${encodeURIComponent(sessionId)}/feedback`,
      body: payload
    });
  }

  async completePracticeSession(sessionId) {
    return this.request({
      method: 'POST',
      path: `/api/study/v1/practice/sessions/${encodeURIComponent(sessionId)}/complete`
    });
  }

  async abandonPracticeSession(sessionId) {
    return this.request({
      method: 'POST',
      path: `/api/study/v1/practice/sessions/${encodeURIComponent(sessionId)}/abandon`
    });
  }

  // Examination Engine (Milestone 7)
  async createExamSession(level = 'N3') {
    return this.request({
      method: 'POST',
      path: '/api/study/v1/exam/sessions',
      body: { level }
    });
  }

  async getExamSession(sessionId) {
    return this.request({
      method: 'GET',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}`
    });
  }

  async answerExamItem(sessionId, itemNumber, selectedChoiceId) {
    return this.request({
      method: 'PUT',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemNumber)}/answer`,
      body: { selected_choice_id: selectedChoiceId }
    });
  }

  async flagExamItem(sessionId, itemNumber, flagged) {
    return this.request({
      method: 'PUT',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemNumber)}/flag`,
      body: { flagged: Boolean(flagged) }
    });
  }

  async startExamSection(sessionId, sectionNumber) {
    return this.request({
      method: 'POST',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}/sections/${encodeURIComponent(sectionNumber)}/start`
    });
  }

  async pauseExamSection(sessionId, sectionNumber) {
    return this.request({
      method: 'POST',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}/sections/${encodeURIComponent(sectionNumber)}/pause`
    });
  }

  async resumeExamSection(sessionId, sectionNumber) {
    return this.request({
      method: 'POST',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}/sections/${encodeURIComponent(sectionNumber)}/resume`
    });
  }

  async submitExamSection(sessionId, sectionNumber) {
    return this.request({
      method: 'POST',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}/sections/${encodeURIComponent(sectionNumber)}/submit`
    });
  }

  async completeExamSession(sessionId) {
    return this.request({
      method: 'POST',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}/complete`
    });
  }

  async getExamResult(sessionId) {
    return this.request({
      method: 'GET',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}/result`
    });
  }
}

export const studyClient = new StudyClient();
