/**
 * Kiroku Note Desktop — Client-Side Tab View Router
 * Orchestrates tab navigation, directional view transitions, and view controller lifecycles.
 */

import { HomeView } from './views/home.js';
import { VocabMainView } from './views/vocab_main.js';
import { VocabHistoryView } from './views/vocab_history.js';
import { GrammarView } from './views/grammar.js';
import { KanjiView } from './views/kanji.js';
import { TestView } from './views/test.js';
import { StudyView } from './views/study.js';
import { SettingsView } from './views/settings.js';

export class AppRouter {
  constructor(options = {}) {
    this.viewContainer = options.viewContainer || document.getElementById('view-container');
    this.bottomDock = options.bottomDock || null;
    this.currentTab = null;
    this.currentViewInstance = null;

    this.tabOrder = ['home', 'vocab', 'grammar', 'kanji', 'test', 'study'];

    this.routes = {
      'home': HomeView,
      'vocab': VocabMainView,
      'vocab-history': VocabHistoryView,
      'grammar': GrammarView,
      'kanji': KanjiView,
      'test': TestView,
      'study': StudyView,
      'settings': SettingsView
    };

    this.handlePopState = this.handlePopState.bind(this);
  }

  init() {
    window.addEventListener('popstate', this.handlePopState);

    // Initial navigation based on URL hash or default to 'home'
    const initialHash = window.location.hash.replace('#', '') || 'home';
    this.navigateToTab(initialHash, false);
  }

  handlePopState() {
    const hash = window.location.hash.replace('#', '') || 'home';
    this.navigateToTab(hash, false);
  }

  async navigateToTab(tabId, updateHistory = true) {
    if (!this.routes[tabId]) {
      console.warn(`[Router] Route not found: ${tabId}, falling back to home`);
      tabId = 'home';
    }

    if (this.currentTab === tabId && this.currentViewInstance) {
      return;
    }

    const prevIndex = this.tabOrder.indexOf(this.currentTab);
    const nextIndex = this.tabOrder.indexOf(tabId);
    const direction = nextIndex >= prevIndex ? 'forward' : 'backward';

    // Update Bottom Dock active state (maps 'vocab-history' to 'vocab' tab)
    if (this.bottomDock) {
      const parentTab = tabId === 'vocab-history' ? 'vocab' : tabId;
      if (this.tabOrder.includes(parentTab)) {
        this.bottomDock.setActiveTab(parentTab, false);
      }
    }

    // Modern View Transition execution
    const updateDOM = () => {
      // Unmount previous view
      if (this.currentViewInstance && typeof this.currentViewInstance.unmount === 'function') {
        this.currentViewInstance.unmount();
      }

      this.currentTab = tabId;
      const ViewClass = this.routes[tabId];
      this.currentViewInstance = new ViewClass(this);
      this.currentViewInstance.mount(this.viewContainer);

      // Scroll view back to top
      window.scrollTo(0, 0);
    };

    let domUpdated = false;
    const safeUpdateDOM = () => {
      if (domUpdated) return;
      domUpdated = true;
      updateDOM();
    };

    if (typeof document.startViewTransition === 'function') {
      try {
        let transition;
        try {
          transition = document.startViewTransition({
            update: safeUpdateDOM,
            types: [direction]
          });
        } catch (typesErr) {
          console.debug('[Router] Transition types unsupported, using callback:', typesErr);
          transition = document.startViewTransition(() => safeUpdateDOM());
        }
        if (transition && transition.finished) {
          await transition.finished;
        }
      } catch (err) {
        console.debug('[Router] View transition fallback:', err);
        safeUpdateDOM();
      }
    } else {
      safeUpdateDOM();
    }

    if (updateHistory) {
      window.location.hash = tabId;
    }
  }

  destroy() {
    window.removeEventListener('popstate', this.handlePopState);
    if (this.currentViewInstance && typeof this.currentViewInstance.unmount === 'function') {
      this.currentViewInstance.unmount();
    }
  }
}

