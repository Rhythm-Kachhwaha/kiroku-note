/**
 * Kiroku Note Desktop — API Client
 * Centralized communication with local FastAPI backend via IPC proxy (kiroku:api:request)
 * eliminating browser CORS restrictions under file:// protocol.
 */

export class ApiClient {
  constructor() {
    this._backendInfo = null;
    this._dictLookupCache = new Map();
    this._conjugationsCache = new Map();
    this._pendingLookups = new Map();
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
    if (typeof endpoint === 'object' && endpoint !== null) {
      options = endpoint;
      endpoint = options.path || options.url || '';
    }
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

      this._notifyMutation(method, endpoint);
      return res.data;
    }

    // Direct HTTP fallback (e.g. Node tests / standalone browser fallback)
    const isRemoteWeb = typeof window !== 'undefined' &&
      window.location?.origin &&
      window.location.protocol.startsWith('http') &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1';

    let url;
    if (isRemoteWeb) {
      // Remote web / PWA origin: use same-origin URL to prevent Private Network Access (localhost) prompt
      url = `${window.location.origin}${endpoint}`;
    } else {
      const info = await this.getBackendInfo();
      const port = info.port || 21828;
      const host = info.host || '127.0.0.1';
      url = `http://${host}:${port}${endpoint}`;
    }
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

    if (!headers['Authorization'] && !headers['authorization'] && typeof localStorage !== 'undefined') {
      try {
        let savedToken = (localStorage.getItem('kiroku_auth_token') || localStorage.getItem('token') || '').replace(/^"|"$/g, '').trim();
        if (!savedToken) {
          const sessionRaw = localStorage.getItem('kiroku_auth_session');
          if (sessionRaw) {
            const session = JSON.parse(sessionRaw);
            if (session?.token) savedToken = String(session.token).trim();
          }
        }
        if (savedToken) {
          headers['Authorization'] = `Bearer ${savedToken}`;
        }
      } catch (_) {}
    }

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

    const data = await response.json();
    this._notifyMutation(method, endpoint);
    return data;
  }

  _notifyMutation(method, endpoint) {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
      const nonMutatingEndpoints = [
        '/cloud/sync',
        '/cloud/pull',
        '/api/tokenize',
        '/api/grammar/analyze',
        '/api/subtitle/annotate',
        '/api/llm/test',
        '/api/link/primer'
      ];
      const isSyncOp = nonMutatingEndpoints.some(ep => endpoint.includes(ep));
      if (isMutation && !isSyncOp) {
        window.dispatchEvent(new CustomEvent('kiroku:data-changed', {
          detail: { method, endpoint }
        }));
      }
    }
  }

  // Link & Anime Media Endpoints
  async getLinkSeries(mediaType = null) {
    const query = mediaType ? { media_type: mediaType } : undefined;
    return this.request('/api/link/series', { query });
  }

  async getSeriesCards(seriesName) {
    return this.request(`/api/link/series/${encodeURIComponent(seriesName)}/cards`);
  }

  async updateSeriesCategory(seriesName, mediaType) {
    return this.request(`/api/link/series/${encodeURIComponent(seriesName)}/category`, {
      method: 'PUT',
      body: { media_type: mediaType }
    });
  }

  async getEpisodePrimer(cueHash, learnerLevel = null) {
    const query = learnerLevel ? { learner_level: learnerLevel } : undefined;
    return this.request(`/api/link/primer/${encodeURIComponent(cueHash)}`, { query });
  }

  async getEpisodeInspector(cueHash, learnerLevel = null) {
    const query = learnerLevel ? { learner_level: learnerLevel } : undefined;
    return this.request(`/api/link/episodes/${encodeURIComponent(cueHash)}/inspect`, { query });
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
  async lookupDictionary(term) {
    if (!term || !term.trim()) return { query: term, entries: [] };
    const cleanTerm = term.trim();
    if (this._dictLookupCache.has(cleanTerm)) {
      return this._dictLookupCache.get(cleanTerm);
    }
    if (this._pendingLookups.has(cleanTerm)) {
      return this._pendingLookups.get(cleanTerm);
    }
    const promise = (async () => {
      try {
        const res = await this.request('/api/dictionary/lookup', {
          query: { term: cleanTerm }
        });
        if (res && (res.entries?.length || res.meaning)) {
          if (this._dictLookupCache.size > 500) {
            const firstKey = this._dictLookupCache.keys().next().value;
            this._dictLookupCache.delete(firstKey);
          }
          this._dictLookupCache.set(cleanTerm, res);
        }
        return res;
      } finally {
        this._pendingLookups.delete(cleanTerm);
      }
    })();
    this._pendingLookups.set(cleanTerm, promise);
    return promise;
  }

  async captureText(text, options = {}) {
    try {
      const res = await this.request('/api/capture', {
        method: 'POST',
        body: { text, ...options }
      });
      if (res && (res.meaning || (res.entries && res.entries.length) || (res.dictionary_entries && res.dictionary_entries.length))) {
        return res;
      }
      const lookup = await this.lookupDictionary(text).catch(() => null);
      if (lookup && Array.isArray(lookup.entries) && lookup.entries.length > 0) {
        return {
          ...res,
          expression: lookup.query || text,
          reading: lookup.reading || res?.reading || '',
          meaning: lookup.meaning || res?.meaning || '',
          entries: lookup.entries,
          dictionary_entries: lookup.entries,
          kanji_entries: lookup.kanji || res?.kanji_entries || []
        };
      }
      return res;
    } catch (err) {
      try {
        const lookup = await this.lookupDictionary(text);
        if (lookup && Array.isArray(lookup.entries) && lookup.entries.length > 0) {
          return {
            expression: lookup.query || text,
            reading: lookup.reading || '',
            meaning: lookup.meaning || '',
            entries: lookup.entries,
            dictionary_entries: lookup.entries,
            kanji_entries: lookup.kanji || []
          };
        }
      } catch (_) {}
      throw err;
    }
  }

  async searchEnglishDictionary(query) {
    if (!query || !query.trim()) return [];
    return this.request('/api/dictionary/search-english', {
      query: { query: query.trim() }
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

  // Vocab Inventory
  async getVocabInventory(params = {}) {
    return this.request('/api/vocab/inventory', { query: params });
  }

  async getVerbConjugations(expression, reading = '', categories = []) {
    const key = `${expression}_${reading}_${Array.isArray(categories) ? categories.join(',') : ''}`;
    if (this._conjugationsCache.has(key)) {
      return this._conjugationsCache.get(key);
    }
    const query = { expression };
    if (reading) query.reading = reading;
    if (Array.isArray(categories) && categories.length > 0) {
      query.categories = categories.join(',');
    }
    const res = await this.request('/api/vocab/conjugations', { query });
    if (res && res.is_verb) {
      if (this._conjugationsCache.size > 500) {
        const firstKey = this._conjugationsCache.keys().next().value;
        this._conjugationsCache.delete(firstKey);
      }
      this._conjugationsCache.set(key, res);
    }
    return res;
  }

  async bulkSetWordStates(expressions, state) {
    return this.request('/api/vocab/inventory/bulk-state', {
      method: 'POST',
      body: { expressions, state }
    });
  }

  async createWordSet(payload) {
    return this.request('/api/vocab-practice/word-sets', {
      method: 'POST',
      body: payload
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

  async getGrammarPointCard(patternKey) {
    return this.request(`/api/grammar/points/${encodeURIComponent(patternKey)}/card`);
  }

  async getGrammarRoadmapFlow() {
    return this.request('/api/grammar/roadmap/flow');
  }

  async getGrammarConceptualHubs() {
    return this.request('/api/grammar/roadmap/hubs');
  }

  async getGrammarDrillSession(params = {}) {
    return this.request('/api/grammar/drills/session', { query: params });
  }

  async verifyGrammarDrill(body) {
    return this.request('/api/grammar/drills/verify', {
      method: 'POST',
      body
    });
  }

  // Kanji
  async searchKanji(query) {
    return this.request('/api/kanji/search', { query: { q: query } });
  }

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

  async getKanjiStudyList(params = {}) {
    return this.request('/api/kanji/study-list', { query: params });
  }

  async addCustomCompound(payload) {
    return this.request('/api/kanji/compounds/custom', {
      method: 'POST',
      body: payload
    });
  }

  async deleteCustomCompound(compoundId) {
    return this.request(`/api/kanji/compounds/custom/${encodeURIComponent(compoundId)}`, {
      method: 'DELETE'
    });
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

  async getTransitivePairs(params = {}) {
    return this.request('/api/vocab-practice/transitive-pairs', { query: params });
  }

  async getGapBreakdown(level = 'N4', limitPerCategory = 40) {
    return this.request('/api/vocab-practice/gap-breakdown', {
      query: { level, limit_per_category: limitPerCategory }
    });
  }

  async getKeigo(params = {}) {
    return this.request('/api/vocab-practice/keigo', { query: params });
  }

  async getDailyWord(params = {}) {
    return this.request('/api/vocab/daily-word', { query: params });
  }

  async getSeenKanji() {
    return this.request('/api/kanji/seen');
  }

  // Phase 5 Anti-Grind Study Modes (Sentence Scramble & Audio Shadowing)
  async startStudyModeSession(mode, targetCount = 5) {
    return this.request('/api/study-modes/sessions', {
      method: 'POST',
      body: { mode, target_count: targetCount }
    });
  }

  async getStudyModeSession(sessionId) {
    return this.request(`/api/study-modes/sessions/${encodeURIComponent(sessionId)}`);
  }

  async revealStudyModeItem(sessionId, itemIndex) {
    return this.request(`/api/study-modes/sessions/${encodeURIComponent(sessionId)}/reveal`, {
      method: 'POST',
      body: { item_index: itemIndex }
    });
  }

  async submitStudyModeAnswer(sessionId, itemIndex, userAnswer) {
    return this.request(`/api/study-modes/sessions/${encodeURIComponent(sessionId)}/answer`, {
      method: 'POST',
      body: { item_index: itemIndex, user_answer: userAnswer }
    });
  }

  async completeStudyModeSession(sessionId) {
    return this.request(`/api/study-modes/sessions/${encodeURIComponent(sessionId)}/complete`, {
      method: 'POST'
    });
  }

  async getStudyModesConsistency() {
    return this.request('/api/study-modes/consistency');
  }

  // Japanese Morphological Tokenization (Offline WASM First, Backend Fallback)
  async tokenize(text, mode = 'C') {
    if (!text || typeof text !== 'string') return { tokens: [] };
    const trimmed = text.trim();
    if (!trimmed) return { tokens: [] };

    // 1. Try desktopAPI or webAPI tokenize if platform defines it
    if (typeof window !== 'undefined' && window.desktopAPI?.tokenize) {
      try {
        const res = await window.desktopAPI.tokenize(trimmed, mode);
        if (res && Array.isArray(res.tokens)) return res;
      } catch (_) {}
    }

    // 2. Try client-side WASM tokenizer
    try {
      const wasmMod = await import('../lib/wasm/sudachi_tokenizer.js');
      if (wasmMod && typeof wasmMod.tokenize === 'function') {
        const wasmRes = await wasmMod.tokenize(trimmed, mode);
        if (wasmRes && Array.isArray(wasmRes.tokens) && wasmRes.tokens.length > 0) {
          return wasmRes;
        }
      }
    } catch (_) {}

    // 3. Fallback to local / remote backend
    return this.request('/api/tokenize', {
      method: 'POST',
      body: { text: trimmed, mode }
    });
  }

  // Smart Cloud Progress Sync (Turso pure references)
  async syncUserProgress(batchPayload = {}) {
    return this.request('/api/user/progress/sync', {
      method: 'POST',
      body: batchPayload
    });
  }

  async getUserProgressSummary() {
    return this.request('/api/user/progress/summary');
  }

  async getDueVocabCards(limit = 50, hydrate = true) {
    return this.request('/api/user/progress/vocab/due', {
      query: { limit, hydrate: String(hydrate) }
    });
  }

  async syncAnimePlayback(seriesId, episodeNumber, positionMs, durationMs, completed = false, minedCount = 0) {
    return this.request('/api/user/progress/anime', {
      method: 'POST',
      body: {
        series_id: seriesId,
        episode_number: episodeNumber,
        last_position_ms: positionMs,
        duration_ms: durationMs,
        completed: Boolean(completed),
        mined_card_count: minedCount
      }
    });
  }

  async getAnimeProgress(seriesId) {
    return this.request(`/api/user/progress/anime/${encodeURIComponent(seriesId)}`);
  }
}

export const apiClient = new ApiClient();
