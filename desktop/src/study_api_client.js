/**
 * Kiroku Note - Desktop Study HTTP API Client
 * -------------------------------------------
 * Provides authenticated, robust HTTP communication with the local backend's
 * versioned Study API (/api/study/v1) and system health endpoints.
 *
 * Security & Reliability:
 * - Ephemeral Bearer token injection (token kept in-memory, never persisted).
 * - Bounded request timeouts with AbortController.
 * - Safe retries for transient connection errors and 5xx responses (idempotency aware).
 * - Mutation idempotency via client_request_id (UUID).
 * - Structured error deserialization matching FastAPI StudyAPIError schema.
 * - Media byte-range requests (RFC 7233 partial content).
 */

const crypto = require('crypto');

class StudyApiError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'StudyApiError';
    this.code = code || 'UNKNOWN_ERROR';
    this.statusCode = statusCode;
    this.details = details || {};
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details
      },
      statusCode: this.statusCode
    };
  }
}

class StudyApiClient {
  /**
   * @param {Object} options
   * @param {string} [options.host='127.0.0.1']
   * @param {number} [options.port=21828]
   * @param {string|Function} [options.getToken] - Ephemeral token or token accessor function
   * @param {number} [options.timeoutMs=10000] - Default request timeout
   * @param {number} [options.maxRetries=2] - Max retries for transient failures
   * @param {number} [options.retryDelayMs=200] - Base retry delay
   */
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port || (process.env.KIROKU_PORT ? parseInt(process.env.KIROKU_PORT, 10) : 21828);
    this.getToken = typeof options.getToken === 'function' ? options.getToken : () => options.token || null;
    this.timeoutMs = options.timeoutMs || 10000;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
    this.retryDelayMs = options.retryDelayMs || 200;
  }

  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  }

  /**
   * Helper to ensure valid client_request_id (UUID v4 format).
   */
  generateRequestId() {
    return crypto.randomUUID();
  }

  /**
   * Core request dispatcher with auth injection, timeouts, and safe retries.
   */
  async request({
    method = 'GET',
    path: requestPath,
    query,
    body,
    headers = {},
    timeoutMs,
    maxRetries,
    clientRequestId,
    range
  }) {
    if (!requestPath || typeof requestPath !== 'string') {
      throw new StudyApiError('INVALID_PATH', 'Request path must be a non-empty string', 400);
    }

    // Security check: Only permit /api/study/v1 or /api/health paths
    const normalizedPath = requestPath.startsWith('/') ? requestPath : `/${requestPath}`;
    if (normalizedPath.includes('..') || normalizedPath.includes('://')) {
      throw new StudyApiError('INVALID_PATH', 'Path traversal or arbitrary URL not allowed', 400);
    }
    if (!normalizedPath.startsWith('/api/study/v1') && normalizedPath !== '/api/health') {
      throw new StudyApiError('UNAUTHORIZED_PATH', `Path ${normalizedPath} is not a permitted Study API endpoint`, 403);
    }

    let url = `${this.baseUrl}${normalizedPath}`;
    if (query && typeof query === 'object') {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) {
          searchParams.append(k, String(v));
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        url += (url.includes('?') ? '&' : '?') + qs;
      }
    }

    const upperMethod = method.toUpperCase();
    const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(upperMethod);
    const effectiveTimeout = timeoutMs !== undefined ? timeoutMs : this.timeoutMs;
    const effectiveRetries = maxRetries !== undefined ? maxRetries : this.maxRetries;

    const reqHeaders = {
      ...headers
    };

    // Attach Bearer token for protected Study endpoints
    if (normalizedPath.startsWith('/api/study/v1')) {
      const token = this.getToken();
      if (token) {
        reqHeaders['Authorization'] = `Bearer ${token}`;
      }
    }

    // Attach client_request_id if specified or present
    if (clientRequestId) {
      reqHeaders['X-Client-Request-Id'] = clientRequestId;
    }

    // Range header for media byte-ranges
    if (range) {
      reqHeaders['Range'] = range;
    }

    let serializedBody = undefined;
    if (body !== undefined && body !== null) {
      if (typeof body === 'object') {
        serializedBody = JSON.stringify(body);
        if (!reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/json';
        }
      } else {
        serializedBody = String(body);
      }
    }

    let lastError = null;
    const attempts = 1 + effectiveRetries;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      let controller = new AbortController();
      let timer = setTimeout(() => controller.abort(), effectiveTimeout);

      try {
        const response = await fetch(url, {
          method: upperMethod,
          headers: reqHeaders,
          body: serializedBody,
          signal: controller.signal
        });

        clearTimeout(timer);

        // Check if retry is appropriate for 502/503/504 server errors
        if ([502, 503, 504].includes(response.status) && attempt < attempts) {
          // Only retry mutations if clientRequestId is provided (safe idempotency)
          if (!isMutation || clientRequestId) {
            const delay = this.retryDelayMs * Math.pow(2, attempt - 1) + Math.random() * 50;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }

        // Handle successful 2xx responses
        if (response.ok) {
          // If media / range request returned binary or partial content
          const contentType = response.headers.get('content-type') || '';
          if (range || contentType.startsWith('audio/') || contentType.startsWith('image/')) {
            const arrayBuffer = await response.arrayBuffer();
            return {
              status: response.status,
              headers: Object.fromEntries(response.headers.entries()),
              data: Buffer.from(arrayBuffer)
            };
          }

          // Otherwise JSON or text response
          const text = await response.text();
          let data = null;
          if (text) {
            try {
              data = JSON.parse(text);
            } catch (_) {
              data = text;
            }
          }
          return {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            data
          };
        }

        // Handle error responses (parse structured error if present)
        const errText = await response.text();
        let errorPayload = null;
        try {
          errorPayload = JSON.parse(errText);
        } catch (_) {}

        if (errorPayload && errorPayload.error) {
          throw new StudyApiError(
            errorPayload.error.code || 'API_ERROR',
            errorPayload.error.message || `API Error (${response.status})`,
            response.status,
            errorPayload.error.details || {}
          );
        }

        throw new StudyApiError(
          'HTTP_ERROR',
          errorPayload?.detail || response.statusText || `Request failed with status ${response.status}`,
          response.status
        );

      } catch (err) {
        clearTimeout(timer);
        lastError = err;

        // Do not retry on client errors (4xx) or explicitly thrown StudyApiError
        if (err instanceof StudyApiError) {
          throw err;
        }

        // Check abort / timeout
        if (err.name === 'AbortError') {
          lastError = new StudyApiError(
            'REQUEST_TIMEOUT',
            `Request to ${normalizedPath} timed out after ${effectiveTimeout}ms`,
            408
          );
        }

        // Network transient error retry check
        if (attempt < attempts) {
          const isNetworkError = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(err.code)
            || err.name === 'AbortError'
            || err.message?.includes('fetch failed');

          if (isNetworkError && (!isMutation || clientRequestId)) {
            const delay = this.retryDelayMs * Math.pow(2, attempt - 1) + Math.random() * 50;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }

        break;
      }
    }

    throw lastError || new StudyApiError('NETWORK_ERROR', 'Network request failed', 500);
  }

  // --- High-Level Endpoints (M11 OpenAPI Contract) ---

  /** Check unauthenticated health endpoint */
  async checkHealth() {
    const res = await this.request({ method: 'GET', path: '/api/health' });
    return res.data;
  }

  /** Bank summary (level: optional N1-N5 filter) */
  async getBankSummary(level = null) {
    const query = level ? { level } : undefined;
    const res = await this.request({ method: 'GET', path: '/api/study/v1/bank/summary', query });
    return res.data;
  }

  /** Exam readiness */
  async getExamReadiness() {
    const res = await this.request({ method: 'GET', path: '/api/study/v1/exam/readiness' });
    return res.data;
  }

  /** Official blueprint for level */
  async getExamBlueprint(level) {
    const res = await this.request({ method: 'GET', path: `/api/study/v1/exam/blueprints/${level}` });
    return res.data;
  }

  /** Learning overview */
  async getLearningOverview() {
    const res = await this.request({ method: 'GET', path: '/api/study/v1/dashboard/overview' });
    return res.data;
  }

  /** Weak areas analytics */
  async getWeakAreas() {
    const res = await this.request({ method: 'GET', path: '/api/study/v1/analytics/weak-areas' });
    return res.data;
  }

  /** Trouble questions */
  async getTroubleQuestions(limit = 10) {
    const res = await this.request({ method: 'GET', path: '/api/study/v1/analytics/trouble-questions', query: { limit } });
    return res.data;
  }

  /** Incorrect questions history */
  async getIncorrectHistory({ level, limit = 20, offset = 0 } = {}) {
    const query = { limit, offset };
    if (level) query.level = level;
    const res = await this.request({ method: 'GET', path: '/api/study/v1/history/incorrect', query });
    return res.data;
  }

  /** Read-only comprehensive diagnostics */
  async getDiagnostics() {
    const res = await this.request({ method: 'GET', path: '/api/study/v1/diagnostics' });
    return res.data;
  }

  /** Study settings */
  async getSettings() {
    const res = await this.request({ method: 'GET', path: '/api/study/v1/settings' });
    return res.data;
  }

  /** Update study settings */
  async updateSettings(updates) {
    const res = await this.request({ method: 'PATCH', path: '/api/study/v1/settings', body: updates });
    return res.data;
  }

  /** Create practice session */
  async createPracticeSession(payload, clientRequestId = null) {
    const reqId = clientRequestId || this.generateRequestId();
    const res = await this.request({
      method: 'POST',
      path: '/api/study/v1/practice/sessions',
      body: payload,
      clientRequestId: reqId
    });
    return res.data;
  }

  /** Get practice session */
  async getPracticeSession(sessionId) {
    const res = await this.request({ method: 'GET', path: `/api/study/v1/practice/sessions/${sessionId}` });
    return res.data;
  }

  /** Submit practice answer */
  async submitPracticeAnswer(sessionId, payload, clientRequestId = null) {
    const reqId = clientRequestId || this.generateRequestId();
    const res = await this.request({
      method: 'POST',
      path: `/api/study/v1/practice/sessions/${sessionId}/answer`,
      body: payload,
      clientRequestId: reqId
    });
    return res.data;
  }

  /** Submit practice feedback */
  async submitPracticeFeedback(sessionId, payload, clientRequestId = null) {
    const reqId = clientRequestId || this.generateRequestId();
    const res = await this.request({
      method: 'POST',
      path: `/api/study/v1/practice/sessions/${sessionId}/feedback`,
      body: payload,
      clientRequestId: reqId
    });
    return res.data;
  }

  /** Abandon practice session */
  async abandonPracticeSession(sessionId, clientRequestId = null) {
    const reqId = clientRequestId || this.generateRequestId();
    const res = await this.request({
      method: 'POST',
      path: `/api/study/v1/practice/sessions/${sessionId}/abandon`,
      clientRequestId: reqId
    });
    return res.data;
  }

  /** Create exam session */
  async createExamSession(payload, clientRequestId = null) {
    const reqId = clientRequestId || this.generateRequestId();
    const res = await this.request({
      method: 'POST',
      path: '/api/study/v1/exam/sessions',
      body: payload,
      clientRequestId: reqId
    });
    return res.data;
  }

  /** Get exam session */
  async getExamSession(sessionId) {
    const res = await this.request({ method: 'GET', path: `/api/study/v1/exam/sessions/${sessionId}` });
    return res.data;
  }

  /** Start exam section */
  async startExamSection(sessionId, sectionIdx, clientRequestId = null) {
    const reqId = clientRequestId || this.generateRequestId();
    const res = await this.request({
      method: 'POST',
      path: `/api/study/v1/exam/sessions/${sessionId}/section/${sectionIdx}/start`,
      clientRequestId: reqId
    });
    return res.data;
  }

  /** Submit exam answer */
  async submitExamAnswer(sessionId, payload, clientRequestId = null) {
    const reqId = clientRequestId || this.generateRequestId();
    const res = await this.request({
      method: 'POST',
      path: `/api/study/v1/exam/sessions/${sessionId}/answer`,
      body: payload,
      clientRequestId: reqId
    });
    return res.data;
  }

  /** Mark exam item for review */
  async markExamReview(sessionId, payload, clientRequestId = null) {
    const reqId = clientRequestId || this.generateRequestId();
    const res = await this.request({
      method: 'POST',
      path: `/api/study/v1/exam/sessions/${sessionId}/mark-review`,
      body: payload,
      clientRequestId: reqId
    });
    return res.data;
  }

  /** Finish exam section */
  async finishExamSection(sessionId, sectionIdx, clientRequestId = null) {
    const reqId = clientRequestId || this.generateRequestId();
    const res = await this.request({
      method: 'POST',
      path: `/api/study/v1/exam/sessions/${sessionId}/section/${sectionIdx}/finish`,
      clientRequestId: reqId
    });
    return res.data;
  }

  /** Abandon exam session */
  async abandonExamSession(sessionId, clientRequestId = null) {
    const reqId = clientRequestId || this.generateRequestId();
    const res = await this.request({
      method: 'POST',
      path: `/api/study/v1/exam/sessions/${sessionId}/abandon`,
      clientRequestId: reqId
    });
    return res.data;
  }

  /** Get exam result snapshot */
  async getExamResult(sessionId) {
    const res = await this.request({ method: 'GET', path: `/api/study/v1/exam/sessions/${sessionId}/result` });
    return res.data;
  }

  /** Get exam history */
  async getExamHistory(limit = 20, offset = 0) {
    const res = await this.request({
      method: 'GET',
      path: '/api/study/v1/exam/history',
      query: { limit, offset }
    });
    return res.data;
  }

  /** Stream or fetch media content (supports Range) */
  async getMedia(mediaRef, range = null) {
    const res = await this.request({
      method: 'GET',
      path: `/api/study/v1/media/${encodeURIComponent(mediaRef)}`,
      range
    });
    return res;
  }
}

module.exports = {
  StudyApiClient,
  StudyApiError
};
