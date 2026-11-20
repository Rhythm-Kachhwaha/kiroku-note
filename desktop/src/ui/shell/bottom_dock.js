/**
 * Kiroku Note Desktop — Floating Tactile Bottom Navigation Dock
 * Tactile pill dock with a compositor-friendly spring indicator, accessible SVGs,
 * and keyboard navigation.
 */

function springValue(t, omega, zeta) {
  if (zeta >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t);
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) *
    (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t));
}

function buildPillKeyframes(from, to, duration = 280, reducedMotion = false) {
  const movingRight = to.left >= from.left;
  const lead = { omega: 24, zeta: 0.76 };
  const trail = { omega: 20, zeta: 0.84 };
  const leftSpring = movingRight ? trail : lead;
  const rightSpring = movingRight ? lead : trail;
  const fromRight = from.left + from.width;
  const toRight = to.left + to.width;
  const steps = Math.max(32, Math.ceil(duration / (1000 / 60)));
  const frames = [];

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const elapsed = progress * duration / 1000;
    const isLast = i === steps;
    const motionProgress = reducedMotion
      ? 1 - Math.pow(1 - progress, 3)
      : null;
    const left = isLast
      ? to.left
      : from.left + (to.left - from.left) * (
        reducedMotion ? motionProgress : springValue(elapsed, leftSpring.omega, leftSpring.zeta)
      );
    const right = isLast
      ? toRight
      : fromRight + (toRight - fromRight) * (
        reducedMotion ? motionProgress : springValue(elapsed, rightSpring.omega, rightSpring.zeta)
      );
    const visualWidth = Math.max(24, right - left);
    const scaleX = to.width > 0 ? visualWidth / to.width : 1;

    frames.push({
      transform: `translate3d(${left}px, 0, 0) scaleX(${scaleX})`,
      offset: progress
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
    this._pillElement = null;
    this._resizeObserver = null;
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
        id: 'anime',
        label: 'Anime',
        sublabel: 'アニメ',
        iconSvg: `<svg viewBox="0 0 24 24"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zm-11-3l6-4-6-4v8z"/></svg>`
      },
      {
        id: 'study',
        label: 'Study',
        sublabel: '自習',
        iconSvg: `<svg viewBox="0 0 24 24"><path d="M19 2H6c-1.2 0-2 .8-2 2v16c0 1.2.8 2 2 2h13c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h12v12H6V4zm0 16v-2h12v2H6z"/></svg>`
      },
      {
        id: 'manga',
        label: 'Manga',
        sublabel: '漫画',
        iconSvg: `<svg viewBox="0 0 24 24"><path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.5 1 5.6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.2 20.2 5.05 19.8 6.5 19.8c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V5.6c-.6-.35-1.3-.55-2-.6zm-1 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"/></svg>`
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

    // One delegated click handler survives tab changes without per-tab listeners.
    dock.addEventListener('click', (e) => {
      const tabLink = e.target.closest('.nav-tab-item');
      if (!tabLink) return;
      e.preventDefault();
      this.setActiveTab(tabLink.dataset.tab, true);
    });

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('resize', this.handleResize);

    if (typeof ResizeObserver === 'function') {
      this._resizeObserver = new ResizeObserver(() => this.updatePillPosition(false));
      this._resizeObserver.observe(dock);
    }

    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        this.updatePillPosition(false);
      }).catch((err) => {
        console.debug('[BottomDock] fonts.ready error:', err);
      });
    }

    // One post-mount alignment pass for fonts and initial layout.
    this._initialPositionFrame = requestAnimationFrame(() => {
      this._initialPositionFrame = null;
      this.updatePillPosition(false);
    });
  }

  handleKeyDown(e) {
    if (
      e.defaultPrevented ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) ||
      document.activeElement?.isContentEditable
    ) {
      return;
    }

    // Preserve the existing keyboard contract during test and study modes.
    if (this.activeTab === 'test' || this.activeTab === 'study') return;

    const key = parseInt(e.key, 10);
    if (!isNaN(key) && key >= 1 && key <= this.tabs.length) {
      e.preventDefault();
      const tab = this.tabs[key - 1];
      if (tab) {
        this.setActiveTab(tab.id, true);
        document.querySelector(`.nav-tab-item[data-tab="${tab.id}"]`)?.focus?.();
      }
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const isDockFocused = Boolean(
        document.activeElement?.closest('#bottom-dock') ||
        document.activeElement?.closest('.nav-tab-item')
      );
      if (!isDockFocused) return;

      const currentIndex = this.tabs.findIndex((tab) => tab.id === this.activeTab);
      if (currentIndex === -1) return;

      e.preventDefault();
      const nextIndex = e.key === 'ArrowRight'
        ? (currentIndex + 1) % this.tabs.length
        : (currentIndex - 1 + this.tabs.length) % this.tabs.length;
      const nextTab = this.tabs[nextIndex];

      if (nextTab) {
        this.setActiveTab(nextTab.id, true);
        document.querySelector(`.nav-tab-item[data-tab="${nextTab.id}"]`)?.focus?.();
      }
      return;
    }

    if (e.key === 'Home' && document.activeElement?.classList?.contains('nav-tab-item')) {
      e.preventDefault();
      const firstTab = this.tabs[0];
      this.setActiveTab(firstTab.id, true);
      document.querySelector(`.nav-tab-item[data-tab="${firstTab.id}"]`)?.focus?.();
      return;
    }

    if (e.key === 'End' && document.activeElement?.classList?.contains('nav-tab-item')) {
      e.preventDefault();
      const lastTab = this.tabs[this.tabs.length - 1];
      this.setActiveTab(lastTab.id, true);
      document.querySelector(`.nav-tab-item[data-tab="${lastTab.id}"]`)?.focus?.();
      return;
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
    if (!this.tabs.some((tab) => tab.id === tabId)) return;
    const isSameTab = this.activeTab === tabId;
    if (isSameTab && !triggerCallback) return;

    this.activeTab = tabId;
    const dock = document.getElementById('bottom-dock');
    if (dock) {
      const items = dock.querySelectorAll('.nav-tab-item');
      for (const item of items) {
        const isActive = item.dataset.tab === tabId;
        item.classList.toggle('is-active', isActive);
        item.setAttribute('aria-selected', isActive ? 'true' : 'false');
        item.setAttribute('tabindex', isActive ? '0' : '-1');
      }
    }

    // A repeated click on the selected tab still invokes navigation semantics,
    // but it never interrupts an in-flight indicator animation.
    if (!isSameTab) this.updatePillPosition(true);

    if (triggerCallback) this.onTabChange(tabId);
  }

  movePillTo(element, animated = true) {
    const dock = document.getElementById('bottom-dock');
    const pill = document.getElementById('nav-spring-pill') || document.getElementById('nav-pill-indicator');
    if (!dock || !pill || !element) return;

    // Read the target position once. offsetLeft/offsetWidth are dock-local and
    // are unaffected by the pill's own compositor transform.
    const targetX = element.offsetLeft;
    const targetW = element.offsetWidth;
    if (targetW <= 0) return;

    if (this._pillElement !== pill) {
      this._pillElement = pill;
      this._pillX = null;
      this._pillW = null;
    }

    const target = { left: targetX, width: targetW };
    const sameTarget = this._pillX !== null &&
      Math.abs(targetX - this._pillX) < 0.5 &&
      Math.abs(targetW - this._pillW) < 0.5;

    if (!animated || sameTarget) {
      this._currentAnimation?.cancel();
      this._currentAnimation = null;
      this._pillAnim = null;
      pill.style.transition = 'none';
      pill.style.width = `${targetW}px`;
      pill.style.transform = `translate3d(${targetX}px, 0, 0)`;
      // Commit only on explicit non-animated alignment, not on each click.
      if (!animated) void pill.offsetWidth;
    } else {
      // Freeze the current visual frame before retargeting to avoid jumps when
      // a second click arrives during an in-flight spring.
      let from;
      if (this._currentAnimation) {
        const currentStyles = getComputedStyle(pill);
        const matrix = new DOMMatrixReadOnly(currentStyles.transform);
        const currentScale = matrix.a || 1;
        const currentLeft = matrix.m41;
        from = {
          left: currentLeft,
          width: Math.max(24, targetW * currentScale)
        };
        this._currentAnimation.cancel();
      } else if (this._pillX !== null && this._pillW !== null) {
        from = { left: this._pillX, width: this._pillW };
      } else {
        const currentRect = pill.getBoundingClientRect();
        const dockRect = dock.getBoundingClientRect();
        from = { left: currentRect.left - dockRect.left, width: currentRect.width };
      }

      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
      const animationDuration = reducedMotion ? 160 : 280;
      const animation = pill.animate(
        buildPillKeyframes(from, target, animationDuration, reducedMotion),
        {
          duration: animationDuration,
          easing: 'linear',
          fill: 'both'
        }
      );
      this._currentAnimation = animation;
      this._pillAnim = animation;
      animation.onfinish = () => {
        if (this._currentAnimation !== animation) return;
        this._currentAnimation = null;
        this._pillAnim = null;
        pill.style.width = `${targetW}px`;
        pill.style.transform = `translate3d(${targetX}px, 0, 0)`;
        this._pillX = targetX;
        this._pillW = targetW;
        // The inline end state is identical; release the finished WAAPI effect.
        animation.cancel();
      };
    }

    this._pillX = targetX;
    this._pillW = targetW;
    this._lastPillTargetTab = element.dataset.tab;
  }

  updatePillPosition(animated = true, retryCount = 0) {
    const dock = document.getElementById('bottom-dock');
    if (!dock) return;

    const activeItem = dock.querySelector(`.nav-tab-item[data-tab="${this.activeTab}"]`);
    if (!activeItem) return;

    const targetWidth = activeItem.offsetWidth;
    if (targetWidth === 0) {
      if (retryCount < 5) {
        this._positionRetryFrame = requestAnimationFrame(() => {
          this._positionRetryFrame = null;
          this.updatePillPosition(false, retryCount + 1);
        });
      }
      return;
    }

    this.movePillTo(activeItem, animated);
  }

  destroy() {
    this._currentAnimation?.cancel();
    this._currentAnimation = null;
    this._pillAnim = null;
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._initialPositionFrame !== null && this._initialPositionFrame !== undefined) {
      cancelAnimationFrame(this._initialPositionFrame);
      this._initialPositionFrame = null;
    }
    if (this._positionRetryFrame !== null && this._positionRetryFrame !== undefined) {
      cancelAnimationFrame(this._positionRetryFrame);
      this._positionRetryFrame = null;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('resize', this.handleResize);
  }
}
