/**
 * Kiroku Note Desktop — Floating Tactile Bottom Navigation Dock
 * Tactile pill dock with flowing spring-indicator pill, accessible vector SVGs, and keyboard navigation.
 */

export class BottomDock {
  constructor(options = {}) {
    this.container = options.container || document.getElementById('bottom-dock-container');
    this.onTabChange = options.onTabChange || (() => {});
    this.activeTab = 'home';
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

    const tabsHtml = this.tabs.map((tab) => `
      <a href="#${tab.id}"
         class="nav-tab-item ${tab.id === this.activeTab ? 'is-active' : ''}"
         data-tab="${tab.id}"
         role="tab"
         aria-selected="${tab.id === this.activeTab ? 'true' : 'false'}"
         aria-label="${tab.label} (${tab.sublabel})"
         tabindex="0">
        ${tab.iconSvg}
        <span class="nav-tab-label">${tab.label}</span>
      </a>
    `).join('');

    this.container.innerHTML = `
      <div class="bottom-dock-wrapper" role="navigation" aria-label="Main Application Navigation">
        <nav class="bottom-dock" id="bottom-dock">
          <div class="nav-spring-pill" id="nav-spring-pill"></div>
          ${tabsHtml}
        </nav>
      </div>
    `;
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
  }

  handleKeyDown(e) {
    // Number keys 1-6 switch tabs directly when not in an input/textarea
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

    const key = parseInt(e.key, 10);
    if (!isNaN(key) && key >= 1 && key <= this.tabs.length) {
      e.preventDefault();
      const tab = this.tabs[key - 1];
      if (tab) this.setActiveTab(tab.id, true);
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const currentIndex = this.tabs.findIndex((t) => t.id === this.activeTab);
      if (currentIndex === -1) return;

      const nextIndex = e.key === 'ArrowRight'
        ? (currentIndex + 1) % this.tabs.length
        : (currentIndex - 1 + this.tabs.length) % this.tabs.length;

      this.setActiveTab(this.tabs[nextIndex].id, true);
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
      });
    }

    this.updatePillPosition(true);

    if (triggerCallback) {
      this.onTabChange(tabId);
    }
  }

  updatePillPosition(animated = true) {
    const dock = document.getElementById('bottom-dock');
    const pill = document.getElementById('nav-spring-pill');
    if (!dock || !pill) return;

    const activeItem = dock.querySelector(`.nav-tab-item[data-tab="${this.activeTab}"]`);
    if (!activeItem) return;

    const dockRect = dock.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();

    const left = itemRect.left - dockRect.left;
    const width = itemRect.width;

    if (!animated) {
      pill.style.transition = 'none';
      pill.style.transform = `translateX(${left}px)`;
      pill.style.width = `${width}px`;
      requestAnimationFrame(() => {
        pill.style.transition = '';
      });
    } else {
      pill.style.transform = `translateX(${left}px)`;
      pill.style.width = `${width}px`;
    }
  }

  destroy() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('resize', this.handleResize);
  }
}

