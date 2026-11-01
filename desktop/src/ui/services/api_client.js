/**
 * Kiroku Note Desktop — API Client
 * Centralized communication with local FastAPI backend via IPC proxy (kiroku:api:request)
 * eliminating browser CORS restrictions under file:// protocol.
 */

export class ApiClient {
  constructor() {
    this._backendInfo = null;
  }

  async getBackendInfo() {
    if (this._backendInfo) return this._backendInfo;
    if (typeof window !== 'undefined' && window.desktopAPI?.getBackendInfo) {
      try {
        this._backendInfo = await window.desktopAPI.getBackendInfo();
        return this._backendInfo;
      } catch (err) {
        console.debug('[ApiClient] getBackendInfo fallback:', err);
      }
    }
    return { host: '127.0.0.1', port: 21828 };
  }

  async request(endpoint, options = {}) {
    const method = (options.method || 'GET').toUpperCase();

    // In Electron Desktop runtime, always route through main process IPC proxy:
    if (typeof window !== 'undefined' && window.desktopAPI?.api?.request) {
      const res = await window.desktopAPI.api.request({
        method,
        path: endpoint,
        query: options.query,
        body: options.body,
        headers: options.headers,
        timeoutMs: options.timeoutMs
      });

      if (!res.success) {
        const errorData = res.data || res.error || {};
        const message = errorData.detail || errorData.message || res.error?.message || `HTTP ${res.status || 500}`;
        const err = new Error(message);
        err.status = res.status || 500;
        err.data = errorData;
        throw err;
      }

      return res.data;
    }

    // Direct HTTP fallback (e.g. Node tests / standalone browser fallback)
    const info = await this.getBackendInfo();
    const port = info.port || 21828;
    const host = info.host || '127.0.0.1';
    
    let url = `http://${host}:${port}${endpoint}`;
    if (options.query) {
      const qs = new URLSearchParams(options.query).toString();
      if (qs) {
        url += (url.includes('?') ? '&' : '?') + qs;
      }
    }

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    let fetchBody = undefined;
    if (options.body !== undefined && options.body !== null) {
      fetchBody = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const response = await fetch(url, {
      method,
      headers,
      body: fetchBody
    });

    if (!response.ok) {
      let errorData = {};
      try {
        errorData = await response.json();
      } catch (err) {
        console.debug('[ApiClient] getBackendInfo fallback:', err);
      }
      const message = errorData.detail || errorData.message || `HTTP ${response.status} ${response.statusText}`;
      const err = new Error(message);
      err.status = response.status;
      err.data = errorData;
      throw err;
    }

    return await response.json();
  }

  // System Health
  async getHealth() {
    return this.request('/api/health');
  }

  // Cards & Stats
  async getCardStats() {
    return this.request('/api/cards/stats');
  }

  async getCardsMetrics() {
    return this.getCardStats();
  }

  async getCards(params = {}) {
    return this.request('/api/cards', { query: params });
  }

  async getCard(id) {
    return this.request(`/api/cards/${encodeURIComponent(id)}`);
  }

  async saveCard(cardData) {
    return this.request('/api/cards/save', {
      method: 'POST',
      body: cardData
    });
  }

  // Backward compatibility alias for saveCard
  async createCard(cardData) {
    return this.saveCard(cardData);
  }

  async deleteCard(id) {
    return this.request(`/api/cards/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  }

  async syncCard(id) {
    return this.request(`/api/cards/${encodeURIComponent(id)}/sync`, {
      method: 'POST'
    });
  }

  async syncAllPendingCards() {
    return this.request('/api/cards/sync-all', {
      method: 'POST'
    });
  }

  async bulkSyncCards(cardIds) {
    return this.request('/api/cards/bulk-sync', {
      method: 'POST',
      body: { card_ids: cardIds }
    });
  }

  async bulkDeleteCards(cardIds) {
    return this.request('/api/cards/bulk', {
      method: 'DELETE',
      body: { card_ids: cardIds }
    });
  }

  async exportCards(format = 'csv') {
    return this.request('/api/cards/export', { query: { format } });
  }

  // AnkiConnect Integration
  async getAnkiDecks() {
    return this.request('/api/anki/decks');
  }

  async getAnkiModels() {
    return this.request('/api/anki/models');
  }

  async getAnkiStatus(url = null) {
    const query = url ? { url } : undefined;
    return this.request('/api/anki/status', { query });
  }

  async getYomitanStatus() {
    return this.request('/api/yomitan/dictionaries');
  }

  // Dictionary & Capture
  async captureText(text, options = {}) {
    return this.request('/api/capture', {
      method: 'POST',
      body: { text, ...options }
    });
  }

  async searchEnglishDictionary(query) {
    if (!query || !query.trim()) return [];
    return this.request('/api/dictionary/search-english', {
      query: { q: query.trim() }
    });
  }

  async annotateText(text, learnerLevel = null) {
    return this.request('/api/subtitle/annotate', {
      method: 'POST',
      body: {
        cues: [{ id: 1, text: text || '' }],
        learner_level: learnerLevel
      }
    });
  }

  // Known Words
  async getKnownWords() {
    return this.request('/api/known-words');
  }

  async markKnownWord(word) {
    return this.request('/api/known-words/mark', {
      method: 'POST',
      body: { word }
    });
  }

  async unmarkKnownWord(word) {
    return this.request(`/api/known-words/mark/${encodeURIComponent(word)}`, {
      method: 'DELETE'
    });
  }

  // Grammar Studio
  async analyzeGrammar(sentence) {
    return this.request('/api/grammar/analyze', {
      method: 'POST',
      body: { sentence }
    });
  }

  async getGrammarStats() {
    return this.request('/api/grammar/stats');
  }

  async getGrammarPoints(level = '') {
    const query = level ? { level } : {};
    return this.request('/api/grammar/points', { query });
  }

  async getGrammarSyllabus(params = {}) {
    return this.request('/api/grammar/syllabus', { query: params });
  }

  async updateGrammarPoint(patternKey, data) {
    return this.request(`/api/grammar/points/${encodeURIComponent(patternKey)}`, {
      method: 'PATCH',
      body: data
    });
  }

  async getGrammarEncounters(patternKey) {
    return this.request(`/api/grammar/points/${encodeURIComponent(patternKey)}/encounters`);
  }

  // Kanji
  async getKanjiStrokes(character) {
    return this.request(`/api/kanji/strokes/${encodeURIComponent(character)}`);
  }

  async getKanjiDetails(character) {
    return this.request(`/api/kanji/details/${encodeURIComponent(character)}`);
  }

  async getKanjiCompounds(character, params = {}) {
    return this.request(`/api/kanji/compounds/${encodeURIComponent(character)}`, { query: params });
  }

  async browseKanji(params = {}) {
    return this.request('/api/kanji/browse', { query: params });
  }

  // LLM
  async getLlmConfig() {
    return this.request('/api/llm/config');
  }

  async updateLlmConfig(config) {
    return this.request('/api/llm/config', {
      method: 'PUT',
      body: config
    });
  }

  async testLlm(prompt) {
    return this.request('/api/llm/test', {
      method: 'POST',
      body: { prompt }
    });
  }

  async getLlmStatus() {
    return this.request('/api/llm/status');
  }

  // OCR
  async getOcrStatus() {
    return this.request('/api/ocr/status');
  }

  async startOcr() {
    return this.request('/api/ocr/start', { method: 'POST' });
  }

  async stopOcr() {
    return this.request('/api/ocr/stop', { method: 'POST' });
  }

  // Learner Settings & Study Progress
  async getLearnerSettings() {
    return this.request('/api/learner');
  }

  async updateLearnerSettings(data) {
    return this.request('/api/learner', {
      method: 'PUT',
      body: data
    });
  }

  async getVocabCoverage() {
    return this.request('/api/vocab/coverage');
  }

  async getVocabGaps(level = null, limit = 50) {
    const query = {};
    if (level) query.level = level;
    if (limit) query.limit = limit;
    return this.request('/api/vocab/gaps', { query });
  }

  async getSeenKanji() {
    return this.request('/api/kanji/seen');
  }
}

export const apiClient = new ApiClient();
