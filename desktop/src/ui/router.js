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
import { AnimeView } from './views/anime.js';
import { MangaView } from './views/manga.js';

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
    this.navigationQueue = Promise.resolve();
    this.navigationToken = 0;
    this.expectedHash = null;
    this.errorState = null;
    this.pendingTab = null;

    this.tabOrder = ['home', 'vocab', 'grammar', 'kanji', 'test', 'anime', 'study', 'manga'];

    this.routes = {
      'home': HomeView,
      'vocab': VocabMainView,
      'vocab-history': VocabHistoryView,
      'grammar': GrammarView,
      'kanji': KanjiView,
      'test': TestView,
      'anime': AnimeView,
      'manga': MangaView,
      'study': StudyView,
      'settings': SettingsView
    };

    this.handlePopState = this.handlePopState.bind(this);
    this.handleHashChange = this.handleHashChange.bind(this);
  }

  init() {
    window.addEventListener('popstate', this.handlePopState);
    window.addEventListener('hashchange', this.handleHashChange);

    // Initial navigation based on URL hash or default to 'home'
    const initialHash = window.location.hash.replace('#', '') || 'home';
    this.navigateToTab(initialHash, false).then(() => {
      this.prewarmViews();
    });
  }

  prewarmViews() {
    if (typeof window === 'undefined') return;
    const idleFn = typeof window.requestIdleCallback === 'function'
      ? (cb) => window.requestIdleCallback(cb, { timeout: 1500 })
      : (cb) => setTimeout(cb, 120);

    idleFn(async () => {
      // Pre-warm keepAlive views in background (especially vocab) so subsequent clicks are 0ms
      const warmTargets = ['vocab', 'grammar', 'kanji', 'test', 'study'];
      for (const tabId of warmTargets) {
        if (this.viewInstances.has(tabId) || !this.routes[tabId] || this.currentTab === tabId) {
          continue;
        }
        try {
          const ViewClass = this.routes[tabId];
          const view = new ViewClass(this);
          if (!view.keepAlive) continue;

          // Yield between each prewarmed view to prevent home frame freeze
          await new Promise((r) => setTimeout(r, 150));

          const host = document.createElement('div');
          host.className = 'router-view-host';
          host.hidden = true;
          this.viewContainer.appendChild(host);
          await view.mount(host);

          this.viewInstances.set(tabId, view);
          this.viewHosts.set(tabId, host);
        } catch (err) {
          console.debug(`[Router] Prewarm view "${tabId}" skipped:`, err);
        }
      }
    });
  }

  handlePopState() {
    const hash = window.location.hash.replace('#', '') || 'home';
    if (this.currentTab === hash || this.pendingTab === hash || this.expectedHash === hash) {
      return;
    }
    this.navigateToTab(hash, false);
  }

  handleHashChange() {
    const hash = window.location.hash.replace('#', '') || 'home';
    if (this.expectedHash === hash || this.currentTab === hash || this.pendingTab === hash) {
      this.expectedHash = null;
      return;
    }
    this.navigateToTab(hash, false);
  }

  navigateToTab(tabId, updateHistory = true) {
    if (this.currentTab === tabId && this.currentViewInstance) {
      return Promise.resolve();
    }
    if (this.pendingTab === tabId) {
      return this.navigationQueue;
    }
    this.pendingTab = tabId;
    const requestToken = ++this.navigationToken;
    this.navigationQueue = this.navigationQueue
      .catch((error) => {
        console.error('[Router] Navigation failed:', error);
      })
      .then(async () => {
        try {
          await this.performNavigation(tabId, updateHistory, requestToken);
        } finally {
          if (this.pendingTab === tabId) {
            this.pendingTab = null;
          }
        }
      });
    return this.navigationQueue;
  }

  async performNavigation(tabId, updateHistory, requestToken) {
    if (!this.routes[tabId]) {
      console.warn(`[Router] Route not found: ${tabId}, falling back to home`);
      tabId = 'home';
    }

    if (requestToken !== this.navigationToken) return;
    if (this.currentTab === tabId && this.currentViewInstance) {
      return;
    }

    this.clearErrorState();
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

    // Pre-mount view outside transition callback so startViewTransition isn't blocked by async mounting
    const previousView = this.currentViewInstance;
    const ViewClass = this.routes[tabId];
    let view = this.viewInstances.get(tabId);
    let host = this.viewHosts.get(tabId);
    let createdView = false;
    let createdHost = false;

    if (!view || !view.keepAlive) {
      view = new ViewClass(this);
      host = document.createElement('div');
      host.className = 'router-view-host';
      host.hidden = true;
      this.viewContainer.appendChild(host);
      createdView = true;
      createdHost = true;
      try {
        await view.mount(host);
      } catch (error) {
        this.cleanupFailedMount(view, host, createdHost);
        this.showErrorState(previousView, error, tabId);
        return;
      }
    }

    if (requestToken !== this.navigationToken) {
      this.cleanupFailedMount(createdView ? view : null, createdHost ? host : null);
      return;
    }

    // Modern View Transition execution
    const updateDOM = () => {
      if (previousView && previousView !== view) {
        if (previousView.keepAlive) {
          previousView.onHide?.();
          const previousHost = this.viewHosts.get(this.currentTab);
          if (previousHost) previousHost.hidden = true;
        } else {
          previousView.unmount?.();
          this.currentViewHost?.remove();
        }
      } else {
        host.hidden = false;
      }

      this.currentTab = tabId;
      this.currentViewInstance = view;
      this.currentViewHost = host;
      host.hidden = false;
      if (view.keepAlive) {
        this.viewInstances.set(tabId, view);
        this.viewHosts.set(tabId, host);
      }
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
          const currentHash = window.location.hash.replace('#', '');
          if (currentHash !== tabId) {
            this.expectedHash = tabId;
            window.location.hash = tabId;
          }
        }
        if (transition && transition.finished) {
          await transition.finished;
        }
      } catch (err) {
        console.debug('[Router] View transition fallback:', err);
        await safeUpdateDOM();
        if (updateHistory) {
          const currentHash = window.location.hash.replace('#', '');
          if (currentHash !== tabId) {
            this.expectedHash = tabId;
            window.location.hash = tabId;
          }
        }
      }
    } else {
      await safeUpdateDOM();
      if (updateHistory) {
        this.expectedHash = tabId;
        window.location.hash = tabId;
      }
    }
  }

  cleanupFailedMount(view, host, removeHost = Boolean(host)) {
    if (view) {
      try {
        view.unmount?.();
      } catch (cleanupError) {
        console.error('[Router] Failed to clean up view after mount error:', cleanupError);
      }
    }
    if (removeHost) host?.remove();
  }

  showErrorState(previousView, error, tabId) {
    console.error(`[Router] Failed to mount view "${tabId}":`, error);
    const host = previousView && this.currentViewHost
      ? this.currentViewHost
      : this.viewContainer;
    const errorElement = document.createElement('div');
    errorElement.className = 'grammar-error-banner router-error-state';
    errorElement.setAttribute?.('role', 'alert');
    const message = document.createElement('span');
    message.textContent = 'This view could not be loaded.';
    const retry = document.createElement('button');
    retry.className = 'tactile-btn tactile-btn-sm';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => this.navigateToTab(tabId));
    errorElement.appendChild(message);
    errorElement.appendChild(retry);
    host.appendChild(errorElement);
    this.errorState = { element: errorElement };
  }

  clearErrorState() {
    this.errorState?.element?.remove();
    this.errorState = null;
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
    window.removeEventListener('hashchange', this.handleHashChange);
    this.navigationToken += 1;
    this.clearErrorState();
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
