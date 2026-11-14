/**
 * Kiroku Note Desktop — Link Mining Service (Slice 41)
 *
 * Coordinates card creation from active video playback via Kiroku Link:
 * 1. Requests media clip via Link (cmd.clip) with timeout fallback.
 * 2. Saves card with sentence, source title, timestamp, and optional media.
 * 3. Immediately marks the word as known in the local database.
 * 4. Provides inline error recovery and retry.
 */

export class LinkMineService {
  constructor(options = {}) {
    this.linkStore = options.linkStore || null;
    this.apiClient = options.apiClient || null;
    this.clipTimeoutMs = options.clipTimeoutMs || 3500;
  }

  /**
   * Request media clip from paired browser extension via Link.
   * Resolves captured media or falls back to empty media on timeout/error.
   */
  async requestMediaClip(s = 0, e = 3, want = ['image', 'audio']) {
    if (!this.linkStore || this.linkStore.status !== 'connected') {
      return { image_b64: null, audio_b64: null, timedOut: false };
    }

    const reqId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return new Promise((resolve) => {
      let timer = null;

      const onClipResult = (payload) => {
        if (payload && payload.reqId === reqId) {
          if (timer) clearTimeout(timer);
          this.linkStore.off('clip:result', onClipResult);
          resolve({
            image_b64: payload.image_b64 || null,
            audio_b64: payload.audio_b64 || null,
            timedOut: false
          });
        }
      };

      this.linkStore.on('clip:result', onClipResult);

      timer = setTimeout(() => {
        this.linkStore.off('clip:result', onClipResult);
        resolve({
          image_b64: null,
          audio_b64: null,
          timedOut: true
        });
      }, this.clipTimeoutMs);

      try {
        this.linkStore.requestClip(reqId, s, e, want);
      } catch (err) {
        if (timer) clearTimeout(timer);
        this.linkStore.off('clip:result', onClipResult);
        resolve({
          image_b64: null,
          audio_b64: null,
          timedOut: false,
          error: err.message
        });
      }
    });
  }

  /**
   * Mine a word or sentence line from video playback.
   * Always persists the card, even if media capture fails.
   */
  async mineWord(params = {}) {
    const {
      expression = '',
      reading = '',
      meaning = '',
      cue = null,
      session = null,
      want = ['image', 'audio'],
      deckName = 'Default'
    } = params;

    const term = (expression || cue?.text || '').trim();
    if (!term) {
      return { ok: false, error: 'Cannot mine empty word or cue' };
    }

    // 1. Attempt media capture
    const s = typeof cue?.s === 'number' ? cue.s : 0;
    const e = typeof cue?.e === 'number' ? cue.e : s + 3;
    const media = params.media || await this.requestMediaClip(s, e, want);

    // 2. Prepare card payload matching backend schema
    const cardData = {
      expression: term,
      reading: reading || term,
      meaning: meaning || '',
      example_sentence: cue?.text || '',
      source_title: session?.title || 'Video capture',
      source_url: session?.site || 'video',
      timestamp: s,
      image_data: media.image_b64 || null,
      audio_data: media.audio_b64 || null,
      deck_name: deckName,
      tags: 'kiroku,video-link'
    };

    // 3. Save card via backend API
    try {
      let saveRes;
      if (this.apiClient && typeof this.apiClient.saveCard === 'function') {
        saveRes = await this.apiClient.saveCard(cardData);
      } else if (this.apiClient && typeof this.apiClient.request === 'function') {
        saveRes = await this.apiClient.request('/api/cards/save', {
          method: 'POST',
          body: cardData
        });
      } else {
        saveRes = { id: `local-${Date.now()}`, ...cardData };
      }

      // 4. Immediately mark word as known
      if (this.apiClient) {
        try {
          if (typeof this.apiClient.markWordKnown === 'function') {
            await this.apiClient.markWordKnown(term);
          } else if (typeof this.apiClient.request === 'function') {
            await this.apiClient.request('/api/known-words/mark', {
              method: 'POST',
              body: { word: term }
            });
          }
        } catch (knownErr) {
          console.debug('[LinkMine] Mark known fallback:', knownErr);
        }
      }

      const isDuplicate = Boolean(saveRes?.is_duplicate || saveRes?.status === 'already_saved');

      return {
        ok: true,
        card: saveRes,
        cardId: saveRes?.id || saveRes?.card_id || null,
        isDuplicate,
        mediaCaptured: Boolean(media.image_b64 || media.audio_b64),
        timedOut: media.timedOut,
        expression: term
      };
    } catch (err) {
      return {
        ok: false,
        error: err.message || 'Failed to save card',
        retry: () => this.mineWord(params)
      };
    }
  }

  /**
   * Check whether a word expression already exists as a card in the collection.
   */
  async isDuplicate(term) {
    if (!term || !this.apiClient) return false;
    try {
      if (typeof this.apiClient.checkDuplicate === 'function') {
        return await this.apiClient.checkDuplicate(term);
      }
      const res = await this.apiClient.request(`/api/cards?expression=${encodeURIComponent(term)}&limit=1`);
      if (Array.isArray(res) && res.length > 0) return true;
      if (res?.cards && Array.isArray(res.cards) && res.cards.length > 0) return true;
      return false;
    } catch (_) {
      return false;
    }
  }
}
