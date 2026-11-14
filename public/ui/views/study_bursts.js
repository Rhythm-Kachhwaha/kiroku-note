/**
 * Kiroku Note Desktop — Phase 5 Study Burst Modes UI Helpers
 * Renders zero-clutter entry mode cards, Rolling Weekly Consistency,
 * Interactive Sentence Scramble, Audio-First Shadowing, and Burst Summary.
 */

import { escapeHtml } from '../utils/sanitizer.js';

const ICON_BACK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>';
const ICON_AUDIO = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

export function resolveBurstMediaUrl(audioUrl, backendInfo = null) {
  const raw = String(audioUrl || '').trim();
  if (!raw) return '';
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  const host = backendInfo?.host || '127.0.0.1';
  const port = backendInfo?.port || 21828;
  const normalized = raw.startsWith('/') ? raw : `/${raw}`;
  return `http://${host}:${port}${normalized}`;
}

function formatDayShort(dateStr) {
  const clean = String(dateStr || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const parsed = new Date(`${clean}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return clean.slice(5);
  return parsed.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

export function renderWeeklyConsistencyBar(consistency = null) {
  if (!consistency) {
    return `
      <div class="study-consistency-bar tactile-card surface-pitch-black" id="study-consistency-bar">
        <div class="study-consistency-head">
          <span class="font-mono text-xs text-gold uppercase tracking-wider">Rolling Weekly Consistency</span>
          <span class="font-mono text-xs text-muted">Loading...</span>
        </div>
      </div>
    `;
  }

  const days = Array.isArray(consistency.days) ? consistency.days : [];
  const activeDays = Number(consistency.active_days || 0);
  const windowDays = Number(consistency.window_days || 7);
  const totalBursts = Number(consistency.total_bursts_7d || 0);

  return `
    <div class="study-consistency-bar tactile-card surface-pitch-black" id="study-consistency-bar">
      <div class="study-consistency-head">
        <div>
          <span class="font-mono text-xs text-gold uppercase tracking-wider">Rolling Weekly Consistency</span>
          <div class="study-consistency-summary text-sm font-bold text-warm-paper" id="study-consistency-summary">
            ${activeDays} of ${windowDays} days active
          </div>
        </div>
        <span class="tactile-pill tactile-pill-gold">${totalBursts} burst${totalBursts === 1 ? '' : 's'} this week</span>
      </div>
      <div class="study-consistency-days" role="list" aria-label="Last 7 days activity">
        ${days.map((day) => {
          const count = Number(day.sessions_completed || 0);
          const isActive = count > 0;
          return `
            <div
              class="study-consistency-day ${isActive ? 'is-active' : ''}"
              role="listitem"
              title="${escapeHtml(day.date)}: ${count} burst(s), ${Number(day.items_reviewed || 0)} item(s)"
            >
              <span class="consistency-day-dot" aria-hidden="true"></span>
              <span class="consistency-day-label font-mono">${escapeHtml(formatDayShort(day.date))}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

export function renderStudyModeCards({
  scrambleSize = 5,
  shadowingSize = 5,
  showJlptPanel = false,
  bankSummary = null,
  activeLevel = 'N4'
} = {}) {
  const totalBank = bankSummary?.total_questions ?? null;
  const bankMeta = totalBank !== null ? `${totalBank} bank questions` : `Level ${activeLevel}`;

  return `
    <div class="study-modes-grid" id="study-mode-cards">
      <section class="study-mode-card tactile-card" data-study-mode="sentence_scramble">
        <div class="study-mode-card-top">
          <span class="tactile-pill tactile-pill-gold">Burst Mode</span>
          <span class="font-mono text-xs text-muted">Particles & Order</span>
        </div>
        <h2 class="study-mode-title">Sentence Scramble</h2>
        <p class="study-mode-desc text-secondary text-sm">
          Rebuild captured sentences from semantic blocks with keys 1-9 and Enter.
        </p>
        <div class="study-burst-size-row" role="group" aria-label="Sentence Scramble burst size">
          ${[5, 10].map((size) => `
            <button
              type="button"
              class="tactile-pill burst-size-pill ${scrambleSize === size ? 'is-active tactile-pill-gold' : ''}"
              data-burst-mode="sentence_scramble"
              data-burst-size="${size}"
              aria-pressed="${scrambleSize === size}"
            >${size} Items</button>
          `).join('')}
        </div>
        <button type="button" class="tactile-btn tactile-btn-primary w-full" id="btn-start-scramble-burst">
          Start ${scrambleSize}-Item Burst
        </button>
      </section>

      <section class="study-mode-card tactile-card" data-study-mode="audio_shadowing">
        <div class="study-mode-card-top">
          <span class="tactile-pill tactile-pill-gold">Burst Mode</span>
          <span class="font-mono text-xs text-muted">Listening First</span>
        </div>
        <h2 class="study-mode-title">Audio Shadowing</h2>
        <p class="study-mode-desc text-secondary text-sm">
          Hear captured audio first, shadow aloud, then press Space to reveal kanji and gloss.
        </p>
        <div class="study-burst-size-row" role="group" aria-label="Audio Shadowing burst size">
          ${[5, 10].map((size) => `
            <button
              type="button"
              class="tactile-pill burst-size-pill ${shadowingSize === size ? 'is-active tactile-pill-gold' : ''}"
              data-burst-mode="audio_shadowing"
              data-burst-size="${size}"
              aria-pressed="${shadowingSize === size}"
            >${size} Items</button>
          `).join('')}
        </div>
        <button type="button" class="tactile-btn tactile-btn-primary w-full" id="btn-start-shadowing-burst">
          Start ${shadowingSize}-Item Burst
        </button>
      </section>

      <section class="study-mode-card tactile-card ${showJlptPanel ? 'is-selected' : ''}" data-study-mode="jlpt_bank">
        <div class="study-mode-card-top">
          <span class="tactile-pill">Tiered Bank</span>
          <span class="font-mono text-xs text-muted">${escapeHtml(bankMeta)}</span>
        </div>
        <h2 class="study-mode-title">JLPT Practice Bank</h2>
        <p class="study-mode-desc text-secondary text-sm">
          Targeted N5-N1 multiple-choice drills with adaptive repetition and explanations.
        </p>
        <div class="study-mode-spacer"></div>
        <button type="button" class="tactile-btn w-full" id="btn-open-jlpt-bank-mode" aria-expanded="${showJlptPanel}">
          ${showJlptPanel ? 'Hide JLPT Drill Setup' : 'Configure JLPT Drill'}
        </button>
      </section>
    </div>
  `;
}

export function renderBurstHeader({ mode, currentIndex, totalCount }) {
  const modeLabel = mode === 'sentence_scramble' ? 'Sentence Scramble' : 'Audio Shadowing';
  return `
    <div class="study-header-bar tactile-card">
      <div class="study-header-left">
        <button type="button" class="tactile-btn tactile-btn-sm" id="btn-exit-burst">
          ${ICON_BACK}
          <span>Exit / Back to Study</span>
        </button>
        <span class="tactile-pill tactile-pill-gold">${escapeHtml(modeLabel)}</span>
      </div>
      <span class="study-question-count font-mono" id="burst-progress-indicator">
        Card ${currentIndex + 1} of ${totalCount}
      </span>
    </div>
  `;
}

export function renderBurstEmptyState({ mode }) {
  const isShadowing = mode === 'audio_shadowing';
  const title = isShadowing ? 'No Captured Cards Ready for Shadowing' : 'No Captured Sentences Ready to Scramble';
  const detail = isShadowing
    ? 'Capture vocabulary cards with audio or example sentences first, then return for a 5- or 10-card burst.'
    : 'Capture cards or encounters with multi-word Japanese sentences first, then return for a 5- or 10-card burst.';

  return `
    <div class="study-empty-state tactile-card text-center py-10" id="study-burst-empty">
      <h2 class="study-empty-title">${escapeHtml(title)}</h2>
      <p class="text-secondary text-sm max-w-md mx-auto mb-5">${escapeHtml(detail)}</p>
      <button type="button" class="tactile-btn tactile-btn-primary" id="btn-empty-back-to-study">
        Back to Study
      </button>
    </div>
  `;
}

export function renderScrambleDrill({
  item,
  currentIndex,
  totalCount,
  selectedTileIds = [],
  feedback = null,
  isSubmitting = false
}) {
  const tiles = Array.isArray(item?.tiles) ? item.tiles : [];
  const tileById = new Map(tiles.map((t) => [String(t.tile_id), t]));
  const selectedSet = new Set(selectedTileIds.map(String));
  const isSubmitted = Boolean(feedback);
  const isLast = currentIndex + 1 >= totalCount;

  return `
    ${renderBurstHeader({ mode: 'sentence_scramble', currentIndex, totalCount })}

    <div class="study-prompt-card surface-pitch-black tactile-card">
      <div class="study-prompt-header">
        <span class="font-mono text-xs text-gold uppercase tracking-wider">Rebuild Sentence Order</span>
        <span class="font-mono text-xs text-muted">${tiles.length} blocks</span>
      </div>
      ${item.english_gloss
        ? `<p class="scramble-gloss text-warm-paper text-base font-medium mb-2">${escapeHtml(item.english_gloss)}</p>`
        : '<p class="scramble-gloss text-secondary text-sm mb-2">Arrange the blocks into natural Japanese order.</p>'}
      <p class="text-xs text-muted font-mono">Keys 1-${tiles.length}: pick block · Backspace: undo · Enter: ${isSubmitted ? 'next' : 'submit'}</p>
    </div>

    <div class="scramble-answer-card tactile-card">
      <div class="scramble-tray-head">
        <span class="font-mono text-xs text-gold uppercase tracking-wider">Your Order</span>
        ${!isSubmitted ? `
          <div class="flex gap-2">
            <button type="button" class="tactile-btn tactile-btn-sm" id="btn-scramble-undo" ${selectedTileIds.length === 0 ? 'disabled' : ''}>Undo [Backspace]</button>
            <button type="button" class="tactile-btn tactile-btn-sm" id="btn-scramble-clear" ${selectedTileIds.length === 0 ? 'disabled' : ''}>Clear</button>
          </div>
        ` : ''}
      </div>
      <div class="scramble-answer-tray" id="scramble-answer-tray">
        ${selectedTileIds.length === 0
          ? '<span class="scramble-tray-placeholder text-sm text-muted">Select blocks below in order...</span>'
          : selectedTileIds.map((tid, pos) => {
              const tile = tileById.get(String(tid));
              if (!tile) return '';
              return `
                <button
                  type="button"
                  class="scramble-placed-chip tactile-btn"
                  data-placed-pos="${pos}"
                  data-tile-id="${escapeHtml(String(tile.tile_id))}"
                  ${isSubmitted ? 'disabled' : ''}
                >
                  <span class="font-japanese text-base">${escapeHtml(tile.surface)}</span>
                </button>
              `;
            }).join('')}
      </div>
    </div>

    <div class="scramble-tile-bank" id="scramble-tile-bank">
      ${tiles.map((tile, slotIndex) => {
        const isUsed = selectedSet.has(String(tile.tile_id));
        const roleClass = tile.role === 'particle' ? 'is-particle-tile' : '';
        return `
          <button
            type="button"
            class="scramble-tile-btn tactile-btn tactile-card-interactive ${roleClass} ${isUsed ? 'is-used' : ''}"
            data-tile-id="${escapeHtml(String(tile.tile_id))}"
            data-slot-index="${slotIndex}"
            ${isUsed || isSubmitted ? 'disabled' : ''}
          >
            <span class="choice-num font-mono">${slotIndex + 1}</span>
            <span class="scramble-tile-body">
              <span class="scramble-tile-surface font-japanese">${escapeHtml(tile.surface)}</span>
              ${tile.reading ? `<span class="scramble-tile-reading font-japanese text-xs text-muted">${escapeHtml(tile.reading)}</span>` : ''}
            </span>
            ${tile.hint ? `<span class="scramble-tile-hint font-mono text-xs">${escapeHtml(tile.hint)}</span>` : ''}
          </button>
        `;
      }).join('')}
    </div>

    ${!isSubmitted ? `
      <div class="mt-2">
        <button
          type="button"
          class="tactile-btn tactile-btn-primary w-full"
          id="btn-submit-scramble"
          ${selectedTileIds.length === 0 || isSubmitting ? 'disabled' : ''}
        >${isSubmitting ? 'Checking...' : 'Check Order [Enter]'}</button>
      </div>
    ` : `
      <div class="grading-feedback-banner tactile-card ${feedback.is_correct ? 'banner-correct' : 'banner-incorrect'}" id="burst-feedback-banner">
        <div class="grading-feedback-content">
          <span class="grading-status-icon">${feedback.is_correct ? ICON_CHECK : ICON_CLOSE}</span>
          <div class="grading-text-block">
            <span class="grading-verdict">${feedback.is_correct ? 'Correct Order' : 'Review Particle & Word Order'}</span>
            <span class="font-japanese text-base text-warm-paper mt-1">${escapeHtml(feedback.expected_sentence || '')}</span>
            ${feedback.english_gloss ? `<span class="text-xs text-secondary mt-1">${escapeHtml(feedback.english_gloss)}</span>` : ''}
          </div>
        </div>
      </div>

      ${Array.isArray(feedback.tile_feedback) && feedback.tile_feedback.length > 0 ? `
        <div class="scramble-diff-row tactile-card surface-pitch-black">
          <span class="font-mono text-xs text-muted uppercase block mb-2">Block Diff</span>
          <div class="scramble-diff-chips">
            ${feedback.tile_feedback.map((entry) => `
              <div class="scramble-diff-chip ${entry.is_match ? 'is-match' : 'is-mismatch'}">
                <span class="font-japanese text-sm">${escapeHtml(entry.expected_surface || entry.submitted_surface || '')}</span>
                ${!entry.is_match && entry.submitted_surface ? `<span class="font-mono text-xs text-muted">got: ${escapeHtml(entry.submitted_surface)}</span>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="mt-2">
        <button type="button" class="tactile-btn tactile-btn-primary w-full" id="btn-next-burst-item">
          ${isLast ? 'Finish Burst [Enter]' : 'Next Card [Enter]'}
        </button>
      </div>
    `}
  `;
}

export function renderShadowingRevealSection({
  revealedData = null,
  isRevealing = false,
  isSubmitting = false
} = {}) {
  const isRevealed = Boolean(revealedData);
  const kanjiList = Array.isArray(revealedData?.kanji_breakdown) ? revealedData.kanji_breakdown : [];

  if (!isRevealed) {
    return `
      <div class="shadowing-concealed-card tactile-card" id="shadowing-concealed-veil">
        <p class="text-warm-paper font-bold mb-1">Transcript Concealed</p>
        <p class="text-secondary text-sm mb-4">
          Listen to the clip and repeat aloud before revealing the Japanese text, kanji breakdown, and gloss.
        </p>
        <button
          type="button"
          class="tactile-btn tactile-btn-primary w-full"
          id="btn-reveal-shadowing"
          ${isRevealing ? 'disabled' : ''}
        >${isRevealing ? 'Revealing...' : 'Reveal Transcript [Space]'}</button>
      </div>
    `;
  }

  return `
    <div class="shadowing-revealed-card tactile-card" id="shadowing-revealed-card">
      <span class="font-mono text-xs text-gold uppercase tracking-wider block mb-2">Transcript & Meaning</span>
      <div class="shadowing-transcript font-japanese text-warm-paper" id="shadowing-transcript-text">
        ${escapeHtml(revealedData.transcript || '')}
      </div>
      ${revealedData.reading ? `
        <div class="shadowing-reading font-japanese text-sm text-gold mt-1" id="shadowing-reading-text">
          ${escapeHtml(revealedData.reading)}
        </div>
      ` : ''}
      ${revealedData.english_gloss ? `
        <div class="shadowing-gloss text-sm text-secondary mt-2" id="shadowing-gloss-text">
          ${escapeHtml(revealedData.english_gloss)}
        </div>
      ` : ''}

      ${kanjiList.length > 0 ? `
        <div class="shadowing-kanji-section mt-4 pt-3 border-t border-subtle">
          <span class="font-mono text-xs text-muted uppercase block mb-2">Kanji Breakdown</span>
          <div class="shadowing-kanji-grid" id="shadowing-kanji-grid">
            ${kanjiList.map((k) => {
              const readings = [...(k.onyomi || []), ...(k.kunyomi || [])].slice(0, 3).join(', ');
              const meanings = (k.meanings || []).slice(0, 3).join(', ');
              return `
                <div class="shadowing-kanji-chip surface-pitch-black tactile-card">
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-japanese text-lg font-bold text-warm-paper">${escapeHtml(k.character)}</span>
                    ${k.level ? `<span class="font-mono text-xs text-gold">${escapeHtml(k.level)}</span>` : ''}
                  </div>
                  ${meanings ? `<div class="text-xs text-secondary mt-1">${escapeHtml(meanings)}</div>` : ''}
                  ${readings ? `<div class="font-japanese text-xs text-muted mt-1">${escapeHtml(readings)}</div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      <div class="shadowing-grade-row mt-4 pt-3 border-t border-subtle">
        <button
          type="button"
          class="tactile-btn btn-shadow-grade"
          id="btn-shadow-missed"
          data-grade="missed"
          ${isSubmitting ? 'disabled' : ''}
        >Missed [1]</button>
        <button
          type="button"
          class="tactile-btn tactile-btn-primary btn-shadow-grade"
          id="btn-shadow-got-it"
          data-grade="got_it"
          ${isSubmitting ? 'disabled' : ''}
        >Got It [2]</button>
      </div>
    </div>
  `;
}

export function renderShadowingDrill({
  item,
  currentIndex,
  totalCount,
  revealedData = null,
  resolvedAudioUrl = '',
  isRevealing = false,
  isSubmitting = false
}) {
  return `
    ${renderBurstHeader({ mode: 'audio_shadowing', currentIndex, totalCount })}

    <div class="study-prompt-card surface-pitch-black tactile-card">
      <div class="study-prompt-header">
        <span class="font-mono text-xs text-gold uppercase tracking-wider">Audio-First Shadowing</span>
        ${item?.jlpt_level ? `<span class="tactile-pill tactile-pill-gold">${escapeHtml(item.jlpt_level)}</span>` : ''}
      </div>

      ${resolvedAudioUrl ? `
        <div class="shadowing-audio-panel">
          <audio id="shadowing-audio-el" controls preload="auto" src="${escapeHtml(resolvedAudioUrl)}" class="w-full"></audio>
          <button type="button" class="tactile-btn tactile-btn-sm mt-2" id="btn-replay-shadow-audio">
            ${ICON_AUDIO}
            <span>Replay Audio [R]</span>
          </button>
        </div>
      ` : `
        <div class="shadowing-no-audio text-sm text-secondary" id="shadowing-no-audio">
          No audio clip attached to this card. Shadow the sentence aloud once revealed.
        </div>
      `}
    </div>

    <div id="shadowing-reveal-slot">
      ${renderShadowingRevealSection({ revealedData, isRevealing, isSubmitting })}
    </div>
  `;
}

export function renderBurstCompleteState({ summary }) {
  const modeLabel = summary?.mode === 'sentence_scramble' ? 'Sentence Scramble' : 'Audio Shadowing';
  const correct = Number(summary?.correct_count || 0);
  const total = Number(summary?.attempted_count || summary?.total_count || 0);
  const accuracy = Number(summary?.accuracy_percent ?? (total > 0 ? Math.round((correct / total) * 100) : 0));

  return `
    <div class="study-complete-card tactile-card text-center py-10" id="study-burst-complete">
      <span class="font-mono text-xs text-gold uppercase tracking-wider">${escapeHtml(modeLabel)}</span>
      <h2 class="study-complete-title font-display text-2xl font-bold mt-1 mb-2">Burst Complete</h2>
      <p class="text-secondary text-sm mb-6 max-w-lg mx-auto">
        Short, focused bursts protect retention without grind fatigue.
      </p>

      <div class="flex justify-center gap-4 my-6 flex-wrap">
        <div class="tactile-card surface-pitch-black p-4 min-w-[120px]">
          <span class="text-xs text-muted block uppercase font-mono">Completed</span>
          <span class="font-mono text-2xl font-bold text-warm-paper">${total}</span>
        </div>
        <div class="tactile-card surface-pitch-black p-4 min-w-[120px]">
          <span class="text-xs text-muted block uppercase font-mono">Score</span>
          <span class="font-mono text-2xl font-bold text-gold">${correct} / ${total}</span>
        </div>
        <div class="tactile-card surface-pitch-black p-4 min-w-[120px]">
          <span class="text-xs text-muted block uppercase font-mono">Accuracy</span>
          <span class="font-mono text-2xl font-bold text-warm-paper">${accuracy}%</span>
        </div>
      </div>

      ${renderWeeklyConsistencyBar(summary?.consistency || null)}

      <div class="study-level-picker mt-6">
        <button type="button" class="tactile-btn" id="btn-burst-back-to-study">Back to Study</button>
        <button type="button" class="tactile-btn tactile-btn-primary" id="btn-burst-start-another">Start Another Burst</button>
      </div>
    </div>
  `;
}
