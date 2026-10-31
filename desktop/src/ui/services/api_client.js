/**
 * Kiroku Note Desktop — API Client
 * Centralized HTTP communication with local FastAPI backend (port 21828).
 */

class ApiClient {
  constructor(baseUrl = 'http://127.0.0.1:21828') {
    this.baseUrl = baseUrl;
  }

  async fetchJson(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        let errorData = {};
        try {
          errorData = await response.json();
        } catch (_) {}
        const error = new Error(errorData.detail || errorData.message || `HTTP ${response.status} ${response.statusText}`);
        error.status = response.status;
        error.data = errorData;
        throw error;
      }

      return await response.json();
    } catch (err) {
      console.warn(`[ApiClient] Request to ${endpoint} failed:`, err.message);
      throw err;
    }
  }

  // System Health
  async getHealth() {
    return this.fetchJson('/api/health');
  }

  // Vocabulary & Card Persistence
  async getCardStats() {
    return this.fetchJson('/api/cards/stats');
  }

  async getCards(params = {}) {
    const query = new URLSearchParams(params).toString();
    const endpoint = query ? `/api/cards?${query}` : '/api/cards';
    return this.fetchJson(endpoint);
  }

  async getCard(id) {
    return this.fetchJson(`/api/cards/${encodeURIComponent(id)}`);
  }

  async createCard(cardData) {
    return this.fetchJson('/api/cards', {
      method: 'POST',
      body: JSON.stringify(cardData)
    });
  }

  async deleteCard(id) {
    return this.fetchJson(`/api/cards/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  }

  async syncAllPendingCards() {
    return this.fetchJson('/api/cards/sync', {
      method: 'POST'
    });
  }

  // Dictionary Search
  async searchDictionary(query) {
    if (!query || !query.trim()) return [];
    return this.fetchJson(`/api/dictionary/search?q=${encodeURIComponent(query.trim())}`);
  }

  // Grammar Studio
  async analyzeGrammar(sentence) {
    return this.fetchJson('/api/grammar/analyze', {
      method: 'POST',
      body: JSON.stringify({ sentence })
    });
  }

  async getGrammarStats() {
    return this.fetchJson('/api/grammar/stats');
  }

  async getGrammarPoints(level = '') {
    const endpoint = level ? `/api/grammar/points?level=${encodeURIComponent(level)}` : '/api/grammar/points';
    return this.fetchJson(endpoint);
  }

  async updateGrammarPointStatus(pointId, status) {
    return this.fetchJson(`/api/grammar/points/${encodeURIComponent(pointId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status })
    });
  }

  // Kanji Studio
  async searchKanji(query) {
    return this.fetchJson(`/api/kanji/search?q=${encodeURIComponent(query.trim())}`);
  }

  async getKanjiDetails(character) {
    return this.fetchJson(`/api/kanji/${encodeURIComponent(character)}`);
  }

  async getKanjiSvg(character) {
    const response = await fetch(`${this.baseUrl}/api/kanji/${encodeURIComponent(character)}/svg`);
    if (!response.ok) throw new Error(`Failed to load SVG for ${character}`);
    return await response.text();
  }

  // OCR Daemon Controls
  async getOcrStatus() {
    return this.fetchJson('/api/ocr/status');
  }

  async startOcr() {
    return this.fetchJson('/api/ocr/start', { method: 'POST' });
  }

  async stopOcr() {
    return this.fetchJson('/api/ocr/stop', { method: 'POST' });
  }

  // Anki Integration
  async getAnkiStatus() {
    return this.fetchJson('/api/anki/status');
  }

  async testAnki(url) {
    return this.fetchJson('/api/anki/test', {
      method: 'POST',
      body: JSON.stringify({ url })
    });
  }

  // LLM Configuration
  async getLlmSettings() {
    return this.fetchJson('/api/llm/settings');
  }

  async updateLlmSettings(settings) {
    return this.fetchJson('/api/llm/settings', {
      method: 'POST',
      body: JSON.stringify(settings)
    });
  }

  async testLlm() {
    return this.fetchJson('/api/llm/test', { method: 'POST' });
  }
}

export const apiClient = new ApiClient();

