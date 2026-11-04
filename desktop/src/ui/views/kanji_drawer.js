/**
 * Kiroku Note Desktop — Kanji Drawer Controller (Slice 21)
 *
 * Slide-out kanji inspector accessible outside the locked Kanji tab.
 * Provides strokes animation (KanjiVG vector player), On/Kun readings,
 * meanings, JLPT level, common compounds, and "Weak kanji" row sourced
 * from Study mistakes notebook telemetry.
 *
 * Exposes window.kirokuUi.openKanji for Vocab, Grammar, and Study tabs.
 */

import { apiClient } from '../services/api_client.js';
import { studyClient } from '../services/study_client.js';
import { escapeHtml } from '../utils/sanitizer.js';

class KanjiDrawerController {
  constructor() {
    this.isOpen = false;
    this.currentChar = null;
    this.strokePaths = [];
    this.strokeNumbers = [];
    this.currentStrokeIndex = 0;
    this.isPlaying = false;
    this.strokePlayToken = 0;
    this.strokeAnimations = new Set();
    this.backdropEl = null;
    this.drawerEl = null;
    this.cachedWeakKanji = null;
  }

  ensureDom() {
    if (this.backdropEl && document.body.contains(this.backdropEl)) return;

    // Inject stylesheet if not present
    if (!document.getElementById('kanji-drawer-style')) {
      const link = document.createElement('link');
      link.id = 'kanji-drawer-style';
      link.rel = 'stylesheet';
      link.href = './ui/styles/views/kanji-drawer.css';
      document.head.appendChild(link);
    }

    const backdrop = document.createElement('div');
    backdrop.id = 'kanji-drawer-backdrop';
    backdrop.className = 'kanji-drawer-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    backdrop.innerHTML = `
      <aside class="kanji-drawer tactile-card" id="kanji-drawer" role="dialog" aria-modal="true" aria-label="Kanji Inspector">
        <div class="kanji-drawer-header">
          <div class="kanji-drawer-title-group">
            <span class="kanji-drawer-char font-display" id="drawer-char">--</span>
            <span class="tactile-pill tactile-pill-vermilion font-mono text-xs" id="drawer-level">JLPT --</span>
            <span class="text-xs text-muted font-mono" id="drawer-stroke-count">-- strokes</span>
          </div>
          <button type="button" class="kanji-drawer-close-btn" id="btn-close-kanji-drawer" title="Close inspector" aria-label="Close kanji drawer">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>

        <!-- Stroke Player Vector Canvas -->
        <div class="kanji-drawer-stroke-box">
          <div class="kanji-drawer-canvas-wrap" id="drawer-canvas">
            <span class="text-xs text-muted">Loading stroke vector...</span>
          </div>
          <div class="kanji-drawer-stroke-controls">
            <span class="text-xs text-muted font-mono" id="drawer-stroke-progress">Stroke 0 of 0</span>
            <div style="display: flex; gap: 0.35rem;">
              <button type="button" class="tactile-btn tactile-btn-sm" id="btn-drawer-stroke-replay">Replay</button>
              <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-drawer-stroke-play">Play</button>
            </div>
          </div>
        </div>

        <!-- Readings & Meanings -->
        <div class="kanji-drawer-section">
          <h3 class="kanji-drawer-section-title font-sans">Readings & Meanings</h3>
          <div class="kanji-readings-row">
            <div>
              <span class="kanji-reading-label">On:</span>
              <span class="kanji-reading-val" id="drawer-onyomi">--</span>
            </div>
            <div>
              <span class="kanji-reading-label">Kun:</span>
              <span class="kanji-reading-val" id="drawer-kunyomi">--</span>
            </div>
          </div>
          <div>
            <span class="kanji-reading-label">English:</span>
            <p class="kanji-meanings-val" id="drawer-meanings">--</p>
          </div>
        </div>

        <!-- Weak Kanji Row: Kanji appearing in Study Mistakes notebook -->
        <div class="kanji-drawer-section" id="drawer-weak-section">
          <h3 class="kanji-drawer-section-title font-sans">Weak Kanji in Mistakes</h3>
          <p class="text-xs text-secondary font-sans mb-1">Kanji frequently missed in Study questions:</p>
          <div class="kanji-weak-row" id="drawer-weak-list">
            <span class="text-xs text-muted">Loading mistakes history...</span>
          </div>
        </div>

        <!-- Common Compounds -->
        <div class="kanji-drawer-section">
          <h3 class="kanji-drawer-section-title font-sans">Compounds</h3>
          <div class="kanji-drawer-compounds-list" id="drawer-compounds-list">
            <span class="text-xs text-muted">Loading compounds...</span>
          </div>
        </div>
      </aside>
    `;

    document.body.appendChild(backdrop);
    this.backdropEl = backdrop;
    this.drawerEl = backdrop.querySelector('.kanji-drawer');

    // Event listeners
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.close();
    });

    backdrop.querySelector('#btn-close-kanji-drawer')?.addEventListener('click', () => {
      this.close();
    });

    backdrop.querySelector('#btn-drawer-stroke-play')?.addEventListener('click', () => {
      this.toggleStrokePlay();
    });

    backdrop.querySelector('#btn-drawer-stroke-replay')?.addEventListener('click', () => {
      this.replayStrokes();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  async open(character) {
    if (!character || typeof character !== 'string') return;
    const char = character.trim().charAt(0);
    if (!char) return;

    this.ensureDom();
    this.currentChar = char;
    this.isOpen = true;
    this.backdropEl?.classList.add('is-open');
    this.backdropEl?.setAttribute('aria-hidden', 'false');

    // Populate placeholder
    const charEl = document.getElementById('drawer-char');
    if (charEl) charEl.textContent = char;

    await Promise.allSettled([
      this.loadDetails(char),
      this.loadStrokes(char),
      this.loadCompounds(char),
      this.loadWeakKanji()
    ]);
  }

  close() {
    this.isOpen = false;
    this.pauseStrokes();
    this.cancelStrokeAnimations();
    this.backdropEl?.classList.remove('is-open');
    this.backdropEl?.setAttribute('aria-hidden', 'true');
  }

  async loadDetails(char) {
    try {
      const details = await apiClient.getKanjiDetails(char);
      if (!details) return;

      const levelEl = document.getElementById('drawer-level');
      const strokeCountEl = document.getElementById('drawer-stroke-count');
      const onyomiEl = document.getElementById('drawer-onyomi');
      const kunyomiEl = document.getElementById('drawer-kunyomi');
      const meaningsEl = document.getElementById('drawer-meanings');

      if (levelEl) levelEl.textContent = `JLPT ${details.jlpt_level || 'N?'}`;
      if (strokeCountEl) strokeCountEl.textContent = `${details.stroke_count || '--'} strokes`;
      if (onyomiEl) onyomiEl.textContent = Array.isArray(details.onyomi) ? details.onyomi.join('、 ') : (details.onyomi || 'None');
      if (kunyomiEl) kunyomiEl.textContent = Array.isArray(details.kunyomi) ? details.kunyomi.join('、 ') : (details.kunyomi || 'None');
      if (meaningsEl) meaningsEl.textContent = Array.isArray(details.meanings) ? details.meanings.join(', ') : (details.meanings || 'No gloss available');
    } catch (err) {
      console.debug('[KanjiDrawer] Details error:', err);
    }
  }

  async loadStrokes(char) {
    const canvas = document.getElementById('drawer-canvas');
    if (!canvas) return;

    canvas.innerHTML = '<span class="text-xs text-muted">Loading vector...</span>';
    try {
      const svgText = await apiClient.getKanjiStrokes(char);
      if (!svgText || typeof svgText !== 'string' || !svgText.includes('<svg')) {
        canvas.innerHTML = `<span class="font-display text-4xl text-warm-paper">${escapeHtml(char)}</span>`;
        return;
      }

      canvas.innerHTML = svgText;
      const svgEl = canvas.querySelector('svg');
      if (svgEl) {
        svgEl.setAttribute('width', '180');
        svgEl.setAttribute('height', '180');
      }

      this.strokePaths = Array.from(canvas.querySelectorAll('path'));
      this.strokeNumbers = Array.from(canvas.querySelectorAll('text'));
      this.currentStrokeIndex = 0;

      this.strokeNumbers.forEach((t) => {
        t.style.fontFamily = 'var(--font-mono)';
        t.style.fontSize = '10px';
        t.style.fill = 'var(--text-muted)';
        t.style.userSelect = 'none';
      });

      this.renderStrokeStep(0);
    } catch (err) {
      canvas.innerHTML = `<span class="font-display text-4xl text-warm-paper">${escapeHtml(char)}</span>`;
    }
  }

  renderStrokeStep(index) {
    this.currentStrokeIndex = Math.max(0, Math.min(index, this.strokePaths.length - 1));

    this.strokePaths.forEach((path, i) => {
      const length = path.getTotalLength ? path.getTotalLength() : 100;
      path.style.strokeDasharray = `${length}px ${length}px`;
      path.style.fill = 'none';

      if (i < this.currentStrokeIndex) {
        path.style.stroke = 'var(--warm-paper)';
        path.style.opacity = '1';
        path.style.strokeWidth = '3';
        path.style.strokeDashoffset = '0px';
      } else if (i === this.currentStrokeIndex) {
        path.style.stroke = 'var(--accent-gold)';
        path.style.opacity = '1';
        path.style.strokeWidth = '4.5';
        path.style.strokeDashoffset = `${length}px`;
      } else {
        path.style.stroke = 'var(--tactile-stroke)';
        path.style.opacity = '0.3';
        path.style.strokeWidth = '2';
        path.style.strokeDashoffset = `${length}px`;
      }
    });

    this.strokeNumbers.forEach((numEl, i) => {
      numEl.style.display = (i <= this.currentStrokeIndex) ? 'block' : 'none';
    });

    const progressEl = document.getElementById('drawer-stroke-progress');
    if (progressEl) {
      progressEl.textContent = `Stroke ${this.currentStrokeIndex + 1} of ${this.strokePaths.length}`;
    }
  }

  toggleStrokePlay() {
    if (this.isPlaying) {
      this.pauseStrokes();
    } else {
      this.startStrokePlay();
    }
  }

  startStrokePlay() {
    if (!this.strokePaths.length) return;
    this.cancelStrokeAnimations();
    this.isPlaying = true;
    const btn = document.getElementById('btn-drawer-stroke-play');
    if (btn) btn.textContent = 'Pause';

    if (this.currentStrokeIndex >= this.strokePaths.length - 1) {
      this.currentStrokeIndex = 0;
      this.renderStrokeStep(0);
    }

    this.animateCurrentStroke(this.strokePlayToken);
  }

  pauseStrokes() {
    this.isPlaying = false;
    this.cancelStrokeAnimations();
    const btn = document.getElementById('btn-drawer-stroke-play');
    if (btn) btn.textContent = 'Play';
  }

  replayStrokes() {
    this.pauseStrokes();
    this.renderStrokeStep(0);
    this.startStrokePlay();
  }

  cancelStrokeAnimations() {
    this.strokePlayToken += 1;
    this.strokeAnimations.forEach((a) => a.cancel?.());
    this.strokeAnimations.clear();
  }

  animateCurrentStroke(playToken) {
    if (!this.isPlaying || playToken !== this.strokePlayToken) return;
    const path = this.strokePaths[this.currentStrokeIndex];
    if (!path) {
      this.pauseStrokes();
      return;
    }

    const length = path.getTotalLength ? path.getTotalLength() : 100;
    path.style.strokeDasharray = `${length}px ${length}px`;
    path.style.strokeDashoffset = `${length}px`;

    const easing = typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim() || 'ease-out'
      : 'ease-out';

    if (path.animate) {
      const anim = path.animate(
        [{ strokeDashoffset: `${length}px` }, { strokeDashoffset: '0px' }],
        { duration: 260, easing, fill: 'forwards' }
      );
      this.strokeAnimations.add(anim);
      anim.onfinish = () => {
        this.strokeAnimations.delete(anim);
        if (this.currentStrokeIndex < this.strokePaths.length - 1) {
          this.renderStrokeStep(this.currentStrokeIndex + 1);
          this.animateCurrentStroke(playToken);
        } else {
          this.pauseStrokes();
        }
      };
      anim.oncancel = () => {
        this.strokeAnimations.delete(anim);
      };
    } else {
      path.style.strokeDashoffset = '0px';
      if (this.currentStrokeIndex < this.strokePaths.length - 1) {
        this.renderStrokeStep(this.currentStrokeIndex + 1);
      } else {
        this.pauseStrokes();
      }
    }
  }

  async loadCompounds(char) {
    const listEl = document.getElementById('drawer-compounds-list');
    if (!listEl) return;

    try {
      const compounds = await apiClient.getKanjiCompounds(char);
      const items = Array.isArray(compounds) ? compounds : (compounds?.compounds || []);

      if (items.length === 0) {
        listEl.innerHTML = '<span class="text-xs text-muted">No common compounds found.</span>';
        return;
      }

      listEl.innerHTML = items.slice(0, 10).map((c) => `
        <div class="kanji-drawer-compound-item">
          <span class="font-japanese font-bold text-warm-paper">${escapeHtml(c.expression || c.compound || '')}</span>
          <span class="font-japanese text-xs text-secondary">${escapeHtml(c.reading || '')}</span>
          <span class="text-xs text-muted font-sans">${escapeHtml(c.meaning || c.gloss || '')}</span>
        </div>
      `).join('');
    } catch (err) {
      listEl.innerHTML = '<span class="text-xs text-muted">Compounds unavailable.</span>';
    }
  }

  async loadWeakKanji() {
    const listEl = document.getElementById('drawer-weak-list');
    if (!listEl) return;

    try {
      let mistakes = [];
      try {
        const res = await studyClient.getIncorrectHistory({ limit: 100 });
        mistakes = res?.items || [];
      } catch (e) {
        mistakes = [];
      }

      // Count kanji character frequencies across mistake questions
      const counts = new Map();
      const kanjiRegex = /[\u4e00-\u9faf]/g;

      mistakes.forEach((item) => {
        const text = `${item.prompt || ''} ${item.target || ''} ${item.expression || ''} ${item.question || ''}`;
        const matches = text.match(kanjiRegex) || [];
        matches.forEach((k) => {
          counts.set(k, (counts.get(k) || 0) + 1);
        });
      });

      const sorted = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

      if (sorted.length === 0) {
        listEl.innerHTML = '<span class="text-xs text-muted font-sans">No mistake history recorded yet.</span>';
        return;
      }

      listEl.innerHTML = sorted.map(([k, count]) => `
        <button type="button" class="kanji-weak-pill" data-char="${escapeHtml(k)}" title="Inspect ${escapeHtml(k)} (${count} mistakes)">
          <span>${escapeHtml(k)}</span>
          <span class="kanji-weak-count font-mono">${count}</span>
        </button>
      `).join('');

      listEl.querySelectorAll('.kanji-weak-pill').forEach((btn) => {
        btn.addEventListener('click', () => {
          const c = btn.dataset.char;
          if (c) this.open(c);
        });
      });
    } catch (err) {
      listEl.innerHTML = '<span class="text-xs text-muted">Weak kanji unavailable.</span>';
    }
  }
}

export const kanjiDrawer = new KanjiDrawerController();

export function openKanjiDrawer(char) {
  return kanjiDrawer.open(char);
}

export function closeKanjiDrawer() {
  return kanjiDrawer.close();
}

// Expose on global window object per Slice 21 contract
if (typeof window !== 'undefined') {
  window.kirokuUi = window.kirokuUi || {};
  window.kirokuUi.openKanji = openKanjiDrawer;
  window.kirokuUi.closeKanji = closeKanjiDrawer;
}
