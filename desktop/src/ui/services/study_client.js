/**
 * Kiroku Note Desktop — Study API Client Bridge
 * Bridges renderer requests to the authenticated Study database API (/api/study/v1)
 * via window.desktopAPI.studyApi (Bearer token stays in main process).
 */

class StudyClient {
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
    if (window.desktopAPI?.studyApi?.getBankSummary) {
      const res = await window.desktopAPI.studyApi.getBankSummary(level);
      return res.data;
    }
    return this.request({
      method: 'GET',
      path: '/api/study/v1/bank/summary',
      query: level ? { level } : undefined
    });
  }

  async getExamReadiness() {
    if (window.desktopAPI?.studyApi?.getExamReadiness) {
      const res = await window.desktopAPI.studyApi.getExamReadiness();
      return res.data;
    }
    return this.request({
      method: 'GET',
      path: '/api/study/v1/exam/readiness'
    });
  }

  async getLearningOverview() {
    if (window.desktopAPI?.studyApi?.getLearningOverview) {
      const res = await window.desktopAPI.studyApi.getLearningOverview();
      return res.data;
    }
    return this.request({
      method: 'GET',
      path: '/api/study/v1/dashboard/overview'
    });
  }

  async getDiagnostics() {
    if (window.desktopAPI?.studyApi?.getDiagnostics) {
      const res = await window.desktopAPI.studyApi.getDiagnostics();
      return res.data;
    }
    return this.request({
      method: 'GET',
      path: '/api/study/v1/diagnostics'
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

  async gradePracticeItem(sessionId, itemIndex, selectedChoice, elapsedMs = 0) {
    return this.request({
      method: 'POST',
      path: `/api/study/v1/practice/sessions/${encodeURIComponent(sessionId)}/items/${itemIndex}/grade`,
      body: {
        selected_choice: selectedChoice,
        elapsed_ms: elapsedMs
      }
    });
  }

  async recordPracticeFeedback(sessionId, itemIndex, difficulty) {
    return this.request({
      method: 'POST',
      path: `/api/study/v1/practice/sessions/${encodeURIComponent(sessionId)}/items/${itemIndex}/feedback`,
      body: {
        feedback_rating: difficulty // 'Easy' | 'Normal' | 'Hard'
      }
    });
  }

  // Examination Engine (Milestone 7)
  async createExamSession(level = 'N3') {
    return this.request({
      method: 'POST',
      path: '/api/study/v1/exam/sessions',
      body: {
        level
      }
    });
  }

  async getExamSession(sessionId) {
    return this.request({
      method: 'GET',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}`
    });
  }

  async recordExamSelection(sessionId, itemIndex, selectedChoice) {
    return this.request({
      method: 'POST',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}/items/${itemIndex}/select`,
      body: {
        selected_choice: selectedChoice
      }
    });
  }

  async toggleExamFlag(sessionId, itemIndex, flagged) {
    return this.request({
      method: 'POST',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}/items/${itemIndex}/flag`,
      body: {
        flagged
      }
    });
  }

  async finishExamSection(sessionId) {
    return this.request({
      method: 'POST',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}/finish`
    });
  }
}

export const studyClient = new StudyClient();

