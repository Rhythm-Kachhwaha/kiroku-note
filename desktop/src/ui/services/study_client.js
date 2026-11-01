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
  async createPracticeSession(level = 'N3', count = 10, formatId = null, sessionType = 'practice') {
    let body;
    if (typeof level === 'object' && level !== null) {
      body = level;
    } else {
      body = {
        level: typeof level === 'string' ? level : 'N3',
        question_count: count,
        format_code: formatId,
        session_type: sessionType
      };
      if (sessionType === 'weak_area') body.target_weak_areas = true;
      if (sessionType === 'bookmarked') body.bookmarked_only = true;
      if (sessionType === 'trouble' || sessionType === 'review') body.incorrect_only = true;
    }
    return this.request({
      method: 'POST',
      path: '/api/study/v1/practice/sessions',
      body
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
    let itemId = itemNumber;
    let choiceId = selectedChoiceId;
    if (typeof itemNumber === 'object' && itemNumber !== null) {
      itemId = itemNumber.attempt_item_id || itemNumber.position || itemNumber.id;
      choiceId = itemNumber.selected_choice_id !== undefined ? itemNumber.selected_choice_id : selectedChoiceId;
    }
    return this.request({
      method: 'PUT',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}/answer`,
      body: { selected_choice_id: choiceId }
    });
  }

  async flagExamItem(sessionId, itemNumber, flagged) {
    let itemId = itemNumber;
    let isFlagged = flagged;
    if (typeof itemNumber === 'object' && itemNumber !== null) {
      itemId = itemNumber.attempt_item_id || itemNumber.position || itemNumber.id;
      isFlagged = itemNumber.flagged !== undefined ? itemNumber.flagged : itemNumber.is_flagged;
    }
    return this.request({
      method: 'PUT',
      path: `/api/study/v1/exam/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}/flag`,
      body: { flagged: Boolean(isFlagged) }
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

  /**
   * Fetches a Bearer-authenticated media asset (MP3 audio track or diagram image)
   * from /api/study/v1/media/{assetId} and creates a local blob URL for inline media playback.
   *
   * @param {string} assetId Content-addressed media hash or asset identifier
   * @returns {Promise<string|null>} Blob object URL or null
   */
  async getMediaBlobUrl(assetId) {
    if (!assetId) return null;
    if (!this.isAvailable) {
      throw new Error('Study API bridge is not available');
    }

    const result = await window.desktopAPI.studyApi.request({
      method: 'GET',
      path: `/api/study/v1/media/${encodeURIComponent(assetId)}`
    });

    if (!result.success) {
      throw new Error(result.error?.message || `Failed to fetch media asset: ${assetId}`);
    }

    const contentType = result.headers?.['content-type'] || 'application/octet-stream';

    // Handle base64 encoded buffer from IPC serialization in main process
    if (result.isBuffer && typeof result.data === 'string') {
      const binaryString = atob(result.data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: contentType });
      return URL.createObjectURL(blob);
    }

    if (result.data instanceof Blob) {
      return URL.createObjectURL(result.data);
    }

    const blob = new Blob([result.data], { type: contentType });
    return URL.createObjectURL(blob);
  }

  /**
   * Revokes a media blob URL to prevent memory leaks when navigating between questions.
   * @param {string} url
   */
  revokeMediaBlobUrl(url) {
    if (url && typeof url === 'string' && url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url);
      } catch (err) {
        console.debug('[StudyClient] URL.revokeObjectURL error:', err);
      }
    }
  }
}

export const studyClient = new StudyClient();
