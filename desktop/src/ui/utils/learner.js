/**
 * Kiroku Note Desktop — Unified Learner JLPT Level State & Dispatcher
 * Provides universal study level synchronization across all tabs (Settings, Vocab,
 * Grammar, Kanji, Practice, and Exam Simulation).
 */

import { apiClient } from '../services/api_client.js';

let cachedLevel = null;

export async function getUniversalJlptLevel() {
  if (cachedLevel) return cachedLevel;

  // 1. Try local storage
  if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
    try {
      const stored = await new Promise((resolve) => {
        window.chrome.storage.local.get(['learner.jlptLevel', 'learner_jlpt_level'], resolve);
      });
      const lvl = stored?.['learner.jlptLevel'] || stored?.['learner_jlpt_level'];
      if (lvl) {
        cachedLevel = lvl;
        return lvl;
      }
    } catch (err) {
      console.debug('[Learner] Read stored level error:', err);
    }
  }

  // 2. Try backend
  try {
    const res = await apiClient.getLearnerSettings();
    if (res?.learner_level) {
      cachedLevel = res.learner_level;
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

  cachedLevel = 'N4';
  return cachedLevel;
}

export async function setUniversalJlptLevel(level) {
  const normalized = (level || 'N4').toUpperCase();
  cachedLevel = normalized;

  // 1. Persist to desktop local storage
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

