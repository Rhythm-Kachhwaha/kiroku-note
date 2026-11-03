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
    this.currentViewHost = null;
    this.viewInstances = new Map();
    this.viewHosts = new Map();
    this.activeListenerCount = 0;
    this.debugCounters = { activeListeners: 0 };

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
    const updateDOM = async () => {
      const previousView = this.currentViewInstance;
      if (previousView) {
        if (previousView.keepAlive) {
          previousView.onHide?.();
          const previousHost = this.viewHosts.get(this.currentTab);
          if (previousHost) previousHost.hidden = true;
        } else {
          previousView.unmount?.();
          this.currentViewHost?.remove();
        }
      }

      this.currentTab = tabId;
      const ViewClass = this.routes[tabId];
      let view = this.viewInstances.get(tabId);
      let host = this.viewHosts.get(tabId);

      if (!view || !view.keepAlive) {
        view = new ViewClass(this);
        host = document.createElement('div');
        host.className = 'router-view-host';
        host.hidden = false;
        this.viewContainer.appendChild(host);
        if (view.keepAlive) {
          this.viewInstances.set(tabId, view);
          this.viewHosts.set(tabId, host);
        }
        await view.mount(host);
      } else {
        host.hidden = false;
      }

      this.currentViewInstance = view;
      this.currentViewHost = host;
      if (view.keepAlive) view.onShow?.();
      this.updateListenerDebugCounter();

      window.scrollTo(0, 0);
    };

    let domUpdated = false;
    const safeUpdateDOM = () => {
      if (domUpdated) return;
      domUpdated = true;
      return updateDOM();
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

        if (updateHistory) {
          window.location.hash = tabId;
        }
        if (transition && transition.finished) {
          await transition.finished;
        }
      } catch (err) {
        console.debug('[Router] View transition fallback:', err);
        await safeUpdateDOM();
        if (updateHistory) {
          window.location.hash = tabId;
        }
      }
    } else {
      await safeUpdateDOM();
      if (updateHistory) {
        window.location.hash = tabId;
      }
    }
  }

  updateListenerDebugCounter() {
    let count = 0;
    for (const [tabId, view] of this.viewInstances) {
      if (!this.viewHosts.get(tabId)?.hidden) {
        count += Number(view.activeListenerCount || 0);
      }
    }
    this.activeListenerCount = count;
    this.debugCounters.activeListeners = count;
  }

  destroy() {
    window.removeEventListener('popstate', this.handlePopState);
    for (const [tabId, view] of this.viewInstances) {
      view.unmount?.();
      this.viewHosts.get(tabId)?.remove();
    }
    if (this.currentViewInstance && !this.currentViewInstance.keepAlive) {
      this.currentViewInstance.unmount?.();
    }
    this.viewInstances.clear();
    this.viewHosts.clear();
    this.currentViewHost = null;
    this.activeListenerCount = 0;
    this.debugCounters.activeListeners = 0;
  }
}
