/**
 * Kiroku Note Desktop — Unified Learner JLPT Level State & Dispatcher
 * Provides universal study level synchronization across all tabs (Settings, Vocab,
 * Grammar, Kanji, Practice, and Exam Simulation).
 */

import { apiClient } from '../services/api_client.js';

// 0. Synchronous fast cache initialization from local storage
let cachedLevel = (typeof localStorage !== 'undefined' &&
  (localStorage.getItem('learner_jlpt_level') || localStorage.getItem('learner.jlptLevel'))) || null;

export async function getUniversalJlptLevel() {
  if (cachedLevel) return cachedLevel;

  // 1. Try fast synchronous localStorage
  if (typeof localStorage !== 'undefined') {
    try {
      const local = localStorage.getItem('learner_jlpt_level') || localStorage.getItem('learner.jlptLevel');
      if (local) {
        cachedLevel = local;
        return local;
      }
    } catch (err) {
      console.debug('[Learner] Fast localStorage read error:', err);
    }
  }

  // 2. Try chrome storage local (extension / shim)
  if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
    try {
      const stored = await new Promise((resolve) => {
        window.chrome.storage.local.get(['learner.jlptLevel', 'learner_jlpt_level'], resolve);
      });
      const lvl = stored?.['learner.jlptLevel'] || stored?.['learner_jlpt_level'];
      if (lvl) {
        cachedLevel = lvl;
        if (typeof localStorage !== 'undefined') {
          try { localStorage.setItem('learner_jlpt_level', lvl); } catch (e) { console.debug('[Learner] sync err:', e); }
        }
        return lvl;
      }
    } catch (err) {
      console.debug('[Learner] Read stored level error:', err);
    }
  }

  // 3. Try backend
  try {
    const res = await apiClient.getLearnerSettings();
    if (res?.learner_level) {
      cachedLevel = res.learner_level;
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem('learner_jlpt_level', cachedLevel); } catch (e) { console.debug('[Learner] sync err:', e); }
      }
      if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
        window.chrome.storage.local.set({
          'learner.jlptLevel': cachedLevel,
          'learner_jlpt_level': cachedLevel
        });
      }
      return cachedLevel;
    }
  } catch (err) {
    console.debug('[Learner] Backend level fallback:', err);
  }

  cachedLevel = cachedLevel || 'N3';
  return cachedLevel;
}

export async function setUniversalJlptLevel(level) {
  const normalized = (level || cachedLevel || 'N3').toUpperCase();
  cachedLevel = normalized;

  // 1. Fast synchronous localStorage
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('learner_jlpt_level', normalized);
      localStorage.setItem('learner.jlptLevel', normalized);
    } catch (err) {
      console.debug('[Learner] Fast localStorage write error:', err);
    }
  }

  // 2. Persist to desktop local storage
  if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
    try {
      await new Promise((resolve) => {
        window.chrome.storage.local.set({
          'learner.jlptLevel': normalized,
          'learner_jlpt_level': normalized
        }, resolve);
      });
    } catch (err) {
      console.debug('[Learner] Save storage error:', err);
    }
  }

  // 2. Persist to backend settings
  try {
    await apiClient.updateLearnerSettings({ learner_level: normalized });
  } catch (err) {
    console.debug('[Learner] Save backend level error:', err);
  }

  // 3. Broadcast to all mounted views
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('kiroku:learner-level-changed', { detail: { level: normalized } })
    );
  }

  return normalized;
}

let cachedAnkiDeck = (typeof localStorage !== 'undefined' &&
  (localStorage.getItem('kiroku:selected-deck') ||
   localStorage.getItem('anki_deck') ||
   localStorage.getItem('vocab.selectedDeck'))) || null;

export async function getUniversalAnkiDeck() {
  if (cachedAnkiDeck) return cachedAnkiDeck;

  if (typeof localStorage !== 'undefined') {
    try {
      const local = localStorage.getItem('kiroku:selected-deck') ||
        localStorage.getItem('anki_deck') ||
        localStorage.getItem('vocab.selectedDeck') ||
        localStorage.getItem('last_used_deck');
      if (local && local.trim()) {
        cachedAnkiDeck = local.trim();
        return cachedAnkiDeck;
      }
    } catch (err) {
      console.debug('[Learner] Read local deck error:', err);
    }
  }

  if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
    try {
      const stored = await new Promise((resolve) => {
        window.chrome.storage.local.get(['anki_deck', 'vocab.selectedDeck', 'last_used_deck'], resolve);
      });
      const deck = stored?.['anki_deck'] || stored?.['vocab.selectedDeck'] || stored?.['last_used_deck'];
      if (deck && String(deck).trim()) {
        cachedAnkiDeck = String(deck).trim();
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem('kiroku:selected-deck', cachedAnkiDeck);
            localStorage.setItem('anki_deck', cachedAnkiDeck);
          } catch (_) {}
        }
        return cachedAnkiDeck;
      }
    } catch (err) {
      console.debug('[Learner] Read chrome storage deck error:', err);
    }
  }

  try {
    const res = await apiClient.getLearnerSettings();
    const backendDeck = res?.preferences?.anki_deck;
    if (backendDeck && String(backendDeck).trim()) {
      cachedAnkiDeck = String(backendDeck).trim();
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('kiroku:selected-deck', cachedAnkiDeck);
          localStorage.setItem('anki_deck', cachedAnkiDeck);
        } catch (_) {}
      }
      if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
        window.chrome.storage.local.set({
          anki_deck: cachedAnkiDeck,
          'vocab.selectedDeck': cachedAnkiDeck,
          last_used_deck: cachedAnkiDeck
        });
      }
      return cachedAnkiDeck;
    }
  } catch (err) {
    console.debug('[Learner] Backend deck fallback:', err);
  }

  return null;
}

export async function setUniversalAnkiDeck(deckName) {
  const normalized = (deckName || '').trim() || null;
  cachedAnkiDeck = normalized;

  if (typeof localStorage !== 'undefined') {
    try {
      if (normalized) {
        localStorage.setItem('kiroku:selected-deck', normalized);
        localStorage.setItem('anki_deck', normalized);
        localStorage.setItem('vocab.selectedDeck', normalized);
        localStorage.setItem('last_used_deck', normalized);
      } else {
        localStorage.removeItem('kiroku:selected-deck');
        localStorage.removeItem('anki_deck');
        localStorage.removeItem('vocab.selectedDeck');
        localStorage.removeItem('last_used_deck');
      }
    } catch (err) {
      console.debug('[Learner] Write local deck error:', err);
    }
  }

  if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
    try {
      await new Promise((resolve) => {
        window.chrome.storage.local.set({
          anki_deck: normalized || '',
          'vocab.selectedDeck': normalized || '',
          last_used_deck: normalized || ''
        }, resolve);
      });
    } catch (err) {
      console.debug('[Learner] Write chrome storage deck error:', err);
    }
  }

  try {
    await apiClient.updateLearnerSettings({ preferences: { anki_deck: normalized || '' } });
  } catch (err) {
    console.debug('[Learner] Save backend deck error:', err);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('kiroku:anki-deck-changed', { detail: { deck: normalized } })
    );
  }

  return normalized;
}

let _inFlightDeckRefresh = null;

export async function refreshAnkiDecks() {
  if (_inFlightDeckRefresh) return _inFlightDeckRefresh;

  _inFlightDeckRefresh = (async () => {
    try {
      const res = await apiClient.getAnkiDecks();
      const rawDecks = Array.isArray(res) ? res : (res?.decks || []);
      const connected = Boolean(res?.connected);

      if (connected && Array.isArray(rawDecks)) {
        const liveDecks = Array.from(new Set(rawDecks.map((d) => String(d).trim()).filter(Boolean)));
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem('kiroku:cached-anki-decks', JSON.stringify(liveDecks));
          } catch (_) {}
        }

        const currentDeck = await getUniversalAnkiDeck();
        if (liveDecks.length > 0 && (!currentDeck || !liveDecks.includes(currentDeck))) {
          const preferred = liveDecks.find((d) => d.toLowerCase() !== 'default') || liveDecks[0];
          await setUniversalAnkiDeck(preferred);
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('kiroku:anki-decks-updated', { detail: { decks: liveDecks, connected: true } })
          );
        }

        return { decks: liveDecks, connected: true };
      }

      return { decks: rawDecks, connected: false };
    } catch (err) {
      console.debug('[Learner] Refresh Anki decks error:', err);
      return { decks: [], connected: false };
    } finally {
      _inFlightDeckRefresh = null;
    }
  })();

  return _inFlightDeckRefresh;
}

