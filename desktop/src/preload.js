/**
 * Kiroku Note - Electron Preload Bridge
 * Establishes secure IPC communication and chrome.* compatibility shim for the renderer.
 * Context isolation is enabled; Node integration is disabled.
 */

const { contextBridge, ipcRenderer } = require('electron');

const messageListeners = new Set();

// Listen for messages from main process to relay to chrome.runtime.onMessage listeners
ipcRenderer.on('extension:message', (event, message) => {
  for (const listener of messageListeners) {
    try {
      listener(message, {}, () => {});
    } catch (err) {
      console.warn('[Preload] Error in onMessage listener:', err);
    }
  }
});

// Expose safe Desktop APIs
contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  quit: () => ipcRenderer.invoke('app:quit'),
  getBackendInfo: () => ipcRenderer.invoke('backend:info'),
  retryBackend: () => ipcRenderer.invoke('backend:retry')
});

// Expose Chrome Extension compatibility shim
contextBridge.exposeInMainWorld('chrome', {
  storage: {
    local: {
      get: (keys, callback) => {
        const promise = ipcRenderer.invoke('chrome:storage:get', keys);
        if (typeof callback === 'function') {
          promise.then((res) => callback(res)).catch(() => callback({}));
        }
        return promise;
      },
      set: (items, callback) => {
        const promise = ipcRenderer.invoke('chrome:storage:set', items);
        if (typeof callback === 'function') {
          promise.then(() => callback()).catch(() => callback());
        }
        return promise;
      },
      remove: (keys, callback) => {
        const promise = ipcRenderer.invoke('chrome:storage:remove', keys);
        if (typeof callback === 'function') {
          promise.then(() => callback()).catch(() => callback());
        }
        return promise;
      },
      clear: (callback) => {
        const promise = ipcRenderer.invoke('chrome:storage:clear');
        if (typeof callback === 'function') {
          promise.then(() => callback()).catch(() => callback());
        }
        return promise;
      }
    }
  },
  runtime: {
    sendMessage: (msg, callback) => {
      const promise = ipcRenderer.invoke('chrome:runtime:sendMessage', msg);
      if (typeof callback === 'function') {
        promise.then((res) => callback(res)).catch(() => callback(undefined));
      }
      return promise;
    },
    onMessage: {
      addListener: (fn) => {
        if (typeof fn === 'function') messageListeners.add(fn);
      },
      removeListener: (fn) => {
        messageListeners.delete(fn);
      },
      hasListener: (fn) => messageListeners.has(fn)
    },
    getURL: (assetPath) => assetPath
  },
  tabs: {
    query: (queryInfo, callback) => {
      const promise = Promise.resolve([]);
      if (typeof callback === 'function') callback([]);
      return promise;
    },
    sendMessage: (tabId, message, options, callback) => {
      const cb = typeof options === 'function' ? options : callback;
      const promise = Promise.resolve(null);
      if (typeof cb === 'function') cb(null);
      return promise;
    }
  }
});

// Inject Desktop Shell Overrides for Side Panel UI (Phase 1: Quick Add & History modes)
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('desktop-shell');
  if (document.body) {
    document.body.classList.add('desktop-shell');
  }

  // Inject desktop styles to constrain modes to Quick Add & History for Phase 1
  const style = document.createElement('style');
  style.id = 'kiroku-desktop-style';
  style.textContent = `
    /* Desktop Shell: Hide Text, Video, and Ask tabs/views for Phase 1 */
    #tab-btn-text,
    #tab-btn-video,
    #tab-btn-ask,
    #text-mining-view,
    #video-mining-view,
    #ask-mining-view,
    #ocr-capture-btn,
    #btn-nav-collapse-toggle,
    #first-run-guide {
      display: none !important;
    }

    /* Clean navigation layout matching cloud dashboard style */
    .mode-nav-tabs {
      display: flex !important;
      gap: 6px !important;
      background: var(--surface, #181715) !important;
      padding: 3px !important;
      border-radius: 8px !important;
      border: 1px solid var(--border-subtle, #25211e) !important;
    }

    .mode-tab-btn {
      padding: 5px 14px !important;
      font-size: 0.84rem !important;
      border-radius: 6px !important;
      font-weight: 500 !important;
      transition: background 0.15s, color 0.15s !important;
    }

    .mode-tab-btn.active {
      background: var(--surface-elevated, #211e1b) !important;
      color: #ffffff !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3) !important;
    }

    /* Companion window styling */
    body {
      user-select: text;
      overflow-x: hidden;
      min-width: 360px;
    }

    /* Ensure Quick Add input has immediate focus feel */
    #quickadd-mining-view {
      padding-top: 0.25rem;
    }
  `;
  document.head.appendChild(style);

  // Switch to Quick Add tab on initial launch if current tab is Text or Video
  setTimeout(() => {
    const quickTab = document.querySelector('#tab-btn-quickadd');
    const textTab = document.querySelector('#tab-btn-text');
    const videoTab = document.querySelector('#tab-btn-video');
    if (quickTab && (textTab?.classList.contains('active') || videoTab?.classList.contains('active') || !document.querySelector('.mode-tab-btn.active'))) {
      quickTab.click();
    }
  }, 100);
});
