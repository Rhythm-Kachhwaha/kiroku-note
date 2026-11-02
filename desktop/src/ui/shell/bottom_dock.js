/**
 * Kiroku Note Desktop — Floating Tactile Bottom Navigation Dock
 * Tactile pill dock with flowing spring-indicator pill, accessible vector SVGs, and keyboard navigation.
 */

function springValue(t, omega, zeta) {
  if (zeta >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t);
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) *
    (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t));
}

function buildPillKeyframes(from, to, duration = 650, steps = 36) {
  const movingRight = to.left >= from.left;
  const lead  = { omega: 20, zeta: 0.72 };
  const trail = { omega: 13, zeta: 0.88 };
  const L = movingRight ? trail : lead;
  const R = movingRight ? lead  : trail;
  const fromR = from.left + from.width;
  const toR = to.left + to.width;
  const frames = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (duration / 1000);
    const last = i === steps;
    const left  = last ? to.left : from.left + (to.left - from.left) * springValue(t, L.omega, L.zeta);
    const right = last ? toR     : fromR + (toR - fromR) * springValue(t, R.omega, R.zeta);
    frames.push({
      transform: `translateX(${left}px)`,
      width: `${Math.max(24, right - left)}px`,
      offset: i / steps
    });
  }
  return frames;
}

export class BottomDock {
  constructor(options = {}) {
    this.container = options.container || document.getElementById('bottom-dock-container');
    this.onTabChange = options.onTabChange || (() => {});
    this.activeTab = 'home';
    this._pillX = null;
    this._pillW = null;
    this._currentAnimation = null;
    this._pillAnim = null;
    this._rendered = false;
    this.tabs = [
      {
        id: 'home',
        label: 'Home',
        sublabel: 'ホーム',
        iconSvg: `<svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>`
      },
      {
        id: 'vocab',
        label: 'Vocab',
        sublabel: '語彙',
        iconSvg: `<svg viewBox="0 0 24 24"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>`
      },
      {
        id: 'grammar',
        label: 'Grammar',
        sublabel: '文法',
        iconSvg: `<svg viewBox="0 0 24 24"><path d="M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3h7zM4 5h3v4H4V5zm13 0h3v4h-3V5zm3 14h-3v-4h3v4z"/></svg>`
      },
      {
        id: 'kanji',
        label: 'Kanji',
        sublabel: '漢字',
        iconSvg: `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`
      },
      {
        id: 'test',
        label: 'Test',
        sublabel: '試験',
        iconSvg: `<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z"/></svg>`
      },
      {
        id: 'study',
        label: 'Study',
        sublabel: '自習',
        iconSvg: `<svg viewBox="0 0 24 24"><path d="M19 2H6c-1.2 0-2 .8-2 2v16c0 1.2.8 2 2 2h13c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h12v12H6V4zm0 16v-2h12v2H6z"/></svg>`
      }
    ];

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleResize = this.handleResize.bind(this);
  }

  init() {
    this.render();
    this.setupEvents();
    this.updatePillPosition(false);
  }

  render() {
    if (!this.container) return;
    if (this._rendered && this.container.querySelector('#bottom-dock')) return;

    const tabsHtml = this.tabs.map((tab) => `
      <a href="#${tab.id}"
         class="nav-tab-item ${tab.id === this.activeTab ? 'is-active' : ''}"
         id="nav-tab-${tab.id}"
         data-tab="${tab.id}"
         role="tab"
         aria-selected="${tab.id === this.activeTab ? 'true' : 'false'}"
         aria-label="${tab.label} (${tab.sublabel})"
         tabindex="${tab.id === this.activeTab ? '0' : '-1'}">
        ${tab.iconSvg}
        <span class="nav-tab-label">${tab.label}</span>
      </a>
    `).join('');

    this.container.innerHTML = `
      <div class="bottom-dock-wrapper" role="navigation" aria-label="Main Application Navigation">
        <nav class="bottom-dock" id="bottom-dock" role="tablist" aria-label="Views">
          <div class="nav-spring-pill" id="nav-spring-pill" data-indicator="nav-pill"></div>
          ${tabsHtml}
        </nav>
      </div>
    `;
    this._rendered = true;
  }

  setupEvents() {
    const dock = document.getElementById('bottom-dock');
    if (!dock) return;

    dock.addEventListener('click', (e) => {
      const tabLink = e.target.closest('.nav-tab-item');
      if (tabLink) {
        e.preventDefault();
        const tabId = tabLink.dataset.tab;
        this.setActiveTab(tabId, true);
      }
    });

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('resize', this.handleResize);

    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        this.updatePillPosition(false);
      }).catch((err) => {
        console.debug('[BottomDock] fonts.ready error:', err);
      });
    }

    // Call once after mount to ensure accurate initial position
    setTimeout(() => this.updatePillPosition(false), 50);
  }

  handleKeyDown(e) {
    // Number keys 1-6 switch tabs directly when not in an input/textarea/select/editable
    if (
      e.defaultPrevented ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) ||
      document.activeElement?.isContentEditable
    ) {
      return;
    }

    // Must bypass keys during test and study modes (Preserve Fix 1 contract!)
    if (this.activeTab === 'test' || this.activeTab === 'study') return;

    const key = parseInt(e.key, 10);
    if (!isNaN(key) && key >= 1 && key <= this.tabs.length) {
      e.preventDefault();
      const tab = this.tabs[key - 1];
      if (tab) {
        this.setActiveTab(tab.id, true);
        const el = document.querySelector(`.nav-tab-item[data-tab="${tab.id}"]`);
        el?.focus?.();
      }
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const isDockFocused = Boolean(
        document.activeElement?.closest('#bottom-dock') ||
        document.activeElement?.closest('.nav-tab-item')
      );
      if (!isDockFocused) return;

      const currentIndex = this.tabs.findIndex((t) => t.id === this.activeTab);
      if (currentIndex === -1) return;

      e.preventDefault();
      const nextIndex = e.key === 'ArrowRight'
        ? (currentIndex + 1) % this.tabs.length
        : (currentIndex - 1 + this.tabs.length) % this.tabs.length;

      const nextTab = this.tabs[nextIndex];
      if (nextTab) {
        this.setActiveTab(nextTab.id, true);
        const el = document.querySelector(`.nav-tab-item[data-tab="${nextTab.id}"]`);
        el?.focus?.();
      }
      return;
    }

    if (e.key === 'Home') {
      if (document.activeElement?.classList?.contains('nav-tab-item')) {
        e.preventDefault();
        const firstTab = this.tabs[0];
        this.setActiveTab(firstTab.id, true);
        document.querySelector(`.nav-tab-item[data-tab="${firstTab.id}"]`)?.focus?.();
        return;
      }
    }

    if (e.key === 'End') {
      if (document.activeElement?.classList?.contains('nav-tab-item')) {
        e.preventDefault();
        const lastTab = this.tabs[this.tabs.length - 1];
        this.setActiveTab(lastTab.id, true);
        document.querySelector(`.nav-tab-item[data-tab="${lastTab.id}"]`)?.focus?.();
        return;
      }
    }

    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.classList?.contains('nav-tab-item')) {
      const tabId = document.activeElement.dataset?.tab;
      if (tabId) {
        e.preventDefault();
        this.setActiveTab(tabId, true);
      }
    }
  }

  handleResize() {
    this.updatePillPosition(false);
  }

  setActiveTab(tabId, triggerCallback = true) {
    if (this.activeTab === tabId && !triggerCallback) return;

    this.activeTab = tabId;

    const dock = document.getElementById('bottom-dock');
    if (dock) {
      dock.querySelectorAll('.nav-tab-item').forEach((item) => {
        const isActive = item.dataset.tab === tabId;
        item.classList.toggle('is-active', isActive);
        item.setAttribute('aria-selected', isActive ? 'true' : 'false');
        item.setAttribute('tabindex', isActive ? '0' : '-1');
      });
    }

    this.updatePillPosition(true);

    if (triggerCallback) {
      this.onTabChange(tabId);
    }
  }

  movePillTo(element, animated = true) {
    const dock = document.getElementById('bottom-dock');
    const pill = document.getElementById('nav-spring-pill') || document.getElementById('nav-pill-indicator');
    if (!dock || !pill || !element) return;

    const targetX = element.offsetLeft;
    const targetW = element.offsetWidth;
    if (targetW === 0) return;

    let fromX = this._pillX !== null ? this._pillX : targetX;
    let fromW = this._pillW !== null ? this._pillW : targetW;

    if (this._currentAnimation) {
      try {
        const computedStyle = window.getComputedStyle(pill);
        const transformStr = computedStyle.transform;
        if (transformStr && transformStr !== 'none') {
          if (typeof DOMMatrixReadOnly === 'function') {
            const matrix = new DOMMatrixReadOnly(transformStr);
            if (!isNaN(matrix.m41)) {
              fromX = matrix.m41;
            }
          } else {
            const match = transformStr.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([^,]+),/);
            if (match) {
              const parsed = parseFloat(match[1]);
              if (!isNaN(parsed)) fromX = parsed;
            }
          }
        }
        const computedWidth = parseFloat(computedStyle.width);
        if (!isNaN(computedWidth) && computedWidth > 0) {
          fromW = computedWidth;
        }
      } catch (err) {
        console.debug('[BottomDock] Error reading computed style during cancel:', err);
      }
      this._currentAnimation.cancel();
      this._currentAnimation = null;
      this._pillAnim = null;
    }

    // Write final values to inline styles
    pill.style.transform = `translateX(${targetX}px)`;
    pill.style.width = `${targetW}px`;

    const hasChanged = Math.abs(fromX - targetX) > 0.5 || Math.abs(fromW - targetW) > 0.5;

    if (animated && hasChanged && typeof pill.animate === 'function') {
      const prefersReduced = Boolean(
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      );

      let animation;
      if (prefersReduced) {
        const duration = 220;
        const easing = 'ease-out';
        animation = pill.animate(
          [
            { transform: `translateX(${fromX}px)`, width: `${fromW}px` },
            { transform: `translateX(${targetX}px)`, width: `${targetW}px` }
          ],
          {
            duration: duration,
            easing: easing
          }
        );
      } else {
        const from = { left: fromX, width: fromW };
        const to = { left: targetX, width: targetW };
        const duration = Math.round(450 + Math.min(300, Math.abs(targetX - fromX) * 0.4));
        const keyframes = buildPillKeyframes(from, to, duration);
        animation = pill.animate(keyframes, {
          duration: duration,
          easing: 'linear',
          fill: 'none'
        });
      }

      this._currentAnimation = animation;
      this._pillAnim = animation;
      animation.onfinish = () => {
        if (this._currentAnimation === animation) {
          this._currentAnimation = null;
          this._pillAnim = null;
        }
      };
    }

    this._pillX = targetX;
    this._pillW = targetW;
  }

  updatePillPosition(animated = true, retryCount = 0) {
    const dock = document.getElementById('bottom-dock');
    if (!dock) return;

    const activeItem = dock.querySelector(`.nav-tab-item[data-tab="${this.activeTab}"]`);
    if (!activeItem) return;

    const itemRect = activeItem.getBoundingClientRect();
    if (itemRect.width === 0 && retryCount < 5) {
      requestAnimationFrame(() => this.updatePillPosition(false, retryCount + 1));
      return;
    }

    if (!animated && this._currentAnimation) {
      if (
        this._pillX !== null &&
        Math.abs(activeItem.offsetLeft - this._pillX) < 1 &&
        Math.abs(activeItem.offsetWidth - this._pillW) < 1
      ) {
        return;
      }
    }

    this.movePillTo(activeItem, animated);
  }

  destroy() {
    if (this._currentAnimation) {
      this._currentAnimation.cancel();
      this._currentAnimation = null;
      this._pillAnim = null;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('resize', this.handleResize);
  }
}
