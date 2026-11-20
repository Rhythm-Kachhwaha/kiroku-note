/**
 * Kiroku Note — Web Platform Shim
 * Drop-in replacement for window.desktopAPI in Progressive Web App (PWA) mode.
 * Standardizes browser fetch, localStorage chrome.storage shim, and on-device capabilities.
 */

const messageListeners = new Set();

const chromeWebShim = {
  storage: {
    local: {
      get: (keys, callback) => {
        return new Promise((resolve) => {
          const result = {};
          if (keys === null || keys === undefined) {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              try {
                result[k] = JSON.parse(localStorage.getItem(k));
              } catch {
                result[k] = localStorage.getItem(k);
              }
            }
          } else if (Array.isArray(keys)) {
            for (const k of keys) {
              const val = localStorage.getItem(k);
              try {
                result[k] = JSON.parse(val);
              } catch {
                result[k] = val;
              }
            }
          } else if (typeof keys === 'object') {
            for (const [k, defaultVal] of Object.entries(keys)) {
              const val = localStorage.getItem(k);
              if (val === null) {
                result[k] = defaultVal;
              } else {
                try {
                  result[k] = JSON.parse(val);
                } catch {
                  result[k] = val;
                }
              }
            }
          } else if (typeof keys === 'string') {
            const val = localStorage.getItem(keys);
            try {
              result[keys] = JSON.parse(val);
            } catch {
              result[keys] = val;
            }
          }
          if (typeof callback === 'function') callback(result);
          resolve(result);
        });
      },
      set: (items, callback) => {
        return new Promise((resolve) => {
          if (items && typeof items === 'object') {
            for (const [k, v] of Object.entries(items)) {
              localStorage.setItem(k, JSON.stringify(v));
            }
          }
          if (typeof callback === 'function') callback();
          resolve();
        });
      },
      remove: (keys, callback) => {
        return new Promise((resolve) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) {
            localStorage.removeItem(k);
          }
          if (typeof callback === 'function') callback();
          resolve();
        });
      },
      clear: (callback) => {
        return new Promise((resolve) => {
          localStorage.clear();
          if (typeof callback === 'function') callback();
          resolve();
        });
      }
    }
  },
  runtime: {
    sendMessage: (msg, callback) => {
      return new Promise((resolve) => {
        for (const listener of messageListeners) {
          try {
            listener(msg, {}, (response) => {
              if (typeof callback === 'function') callback(response);
              resolve(response);
            });
          } catch (err) {
            console.warn('[WebShim] Error in listener:', err);
          }
        }
        if (typeof callback === 'function') callback(undefined);
        resolve(undefined);
      });
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
      const p = Promise.resolve([]);
      if (typeof callback === 'function') callback([]);
      return p;
    },
    sendMessage: (tabId, msg, options, callback) => {
      const cb = typeof options === 'function' ? options : callback;
      const p = Promise.resolve(null);
      if (typeof cb === 'function') cb(null);
      return p;
    }
  }
};

export async function dispatchFetch(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  let url = path.startsWith('http') ? path : (path.startsWith('/') ? path : `/${path}`);

  if (options.query && typeof options.query === 'object') {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null) params.append(k, String(v));
    }
    const qs = params.toString();
    if (qs) {
      url += (url.includes('?') ? '&' : '?') + qs;
    }
  }

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Attach saved Bearer token if not explicitly provided
  if (!headers.has('Authorization') && typeof localStorage !== 'undefined') {
    try {
      const savedToken = (localStorage.getItem('kiroku_auth_token') || localStorage.getItem('token') || '').replace(/^"|"$/g, '').trim();
      if (savedToken) {
        headers.set('Authorization', `Bearer ${savedToken}`);
      }
    } catch (_) {}
  }

  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
    body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : body,
      credentials: 'same-origin'
    });

    const contentType = res.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    if (!res.ok) {
      if (res.status === 401 && typeof localStorage !== 'undefined') {
        try {
          localStorage.removeItem('kiroku_auth_token');
          localStorage.removeItem('token');
        } catch (_) {}
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('kiroku:auth-unauthorized'));
        }
      }
      const errMsg = (data && (data.detail || data.error || data.message)) || (typeof data === 'string' ? data : res.statusText) || `HTTP ${res.status}`;
      return { success: false, ok: false, status: res.status, error: { message: errMsg, detail: errMsg }, data };
    }
    return { success: true, ok: true, status: res.status, data };
  } catch (err) {
    console.warn('[WebShim] Fetch failure:', url, err);
    return { success: false, ok: false, status: 0, error: { code: 'NETWORK_ERROR', message: String(err), detail: String(err) } };
  }
}

class OcrWorkerBridge {
  constructor() {
    this.worker = null;
    this.requestId = 1;
    this.pending = new Map();
    this.isSupported = typeof window !== 'undefined' && typeof Worker !== 'undefined';
  }

  ensureWorker() {
    if (!this.isSupported) return null;
    if (!this.worker) {
      try {
        this.worker = new Worker('/ocr/ocr_worker.js');
        this.worker.onmessage = (event) => {
          const { id, fallback, error, text, bubbles } = event.data || {};
          const resolver = this.pending.get(id);
          if (resolver) {
            this.pending.delete(id);
            resolver({ fallback: fallback ?? false, error, text: text || '', bubbles: bubbles || [] });
          }
        };
      } catch (err) {
        console.warn('[OcrBridge] Could not initialize OCR Worker:', err);
      }
    }
    return this.worker;
  }

  async detect(imageData) {
    const worker = this.ensureWorker();
    if (!worker) return { fallback: true, bubbles: [] };
    const id = this.requestId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      worker.postMessage({ id, type: 'detect', payload: imageData });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve({ fallback: true, bubbles: [] });
        }
      }, 5000);
    });
  }

  async recognize(imageData) {
    const worker = this.ensureWorker();
    if (!worker) return { fallback: true, text: '' };
    const id = this.requestId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      worker.postMessage({ id, type: 'recognize', payload: imageData });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve({ fallback: true, text: '' });
        }
      }, 5000);
    });
  }
}

const ocrBridge = new OcrWorkerBridge();

const sessionTokenizeCache = new Map();

export const webAPI = {
  isDesktop: false,
  isPWA: true,
  tokenize: async (text, mode = 'C') => {
    if (!text || typeof text !== 'string') return { tokens: [] };
    const trimmed = text.trim();
    if (!trimmed) return { tokens: [] };
    const cacheKey = `${mode}:${trimmed}`;
    if (sessionTokenizeCache.has(cacheKey)) {
      return sessionTokenizeCache.get(cacheKey);
    }
    // 1. First attempt fast client-side WASM tokenization
    try {
      const wasmMod = await import('../ui/lib/wasm/sudachi_tokenizer.js');
      if (wasmMod && typeof wasmMod.tokenize === 'function') {
        const wasmRes = await wasmMod.tokenize(trimmed, mode);
        if (wasmRes && Array.isArray(wasmRes.tokens) && wasmRes.tokens.length > 0) {
          if (sessionTokenizeCache.size > 500) {
            const firstKey = sessionTokenizeCache.keys().next().value;
            sessionTokenizeCache.delete(firstKey);
          }
          sessionTokenizeCache.set(cacheKey, wasmRes);
          return wasmRes;
        }
      }
    } catch (_) {}

    // 2. Fall back to backend /api/tokenize
    try {
      const res = await dispatchFetch('/api/tokenize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { text: trimmed, mode }
      });
      if (res && Array.isArray(res.tokens)) {
        if (sessionTokenizeCache.size > 500) {
          const firstKey = sessionTokenizeCache.keys().next().value;
          sessionTokenizeCache.delete(firstKey);
        }
        sessionTokenizeCache.set(cacheKey, res);
        return res;
      }
      return res || { tokens: [] };
    } catch (err) {
      console.warn('[WebAPI] Tokenize request failed:', err);
      return { tokens: [] };
    }
  },
  minimize: () => Promise.resolve(),
  toggleMaximize: () => Promise.resolve(),
  close: () => Promise.resolve(),
  setFullScreen: async (flag) => {
    try {
      if (typeof document !== 'undefined') {
        const isFull = Boolean(document.fullscreenElement);
        const target = typeof flag === 'boolean' ? flag : !isFull;
        if (target && !isFull) {
          await document.documentElement.requestFullscreen?.();
        } else if (!target && isFull) {
          await document.exitFullscreen?.();
        }
        return Boolean(document.fullscreenElement);
      }
    } catch (_) {}
    return false;
  },
  isFullScreen: () => typeof document !== 'undefined' && Boolean(document.fullscreenElement),
  onFullScreenChange: (cb) => {
    if (typeof cb === 'function' && typeof document !== 'undefined') {
      const handler = () => cb(Boolean(document.fullscreenElement));
      document.addEventListener('fullscreenchange', handler);
      return () => document.removeEventListener('fullscreenchange', handler);
    }
  },
  quit: () => Promise.resolve(),
  getBackendInfo: () => Promise.resolve({ status: 'ok', mode: 'pwa', backend_url: '/api' }),
  retryBackend: () => Promise.resolve(true),
  openUserDataFolder: () => Promise.resolve(),
  openInstructions: () => Promise.resolve(),
  restartApp: () => { window.location.reload(); },
  onBackendReady: (cb) => {
    if (typeof cb === 'function') setTimeout(() => cb({ status: 'ready' }), 0);
  },
  getRiveAssetUrl: (assetName) => Promise.resolve(`./ui/assets/riv/${assetName}`),
  getServicesStatus: () => Promise.resolve({ status: 'ok', worker: 'active' }),
  toggleOcr: () => Promise.resolve(false),
  chrome: chromeWebShim,

  auth: {
    startOAuth: (provider) => {
      const authUrl = `/auth/${encodeURIComponent(provider)}`;
      window.location.href = authUrl;
      return Promise.resolve({ ok: true });
    },
    getSession: async () => {
      // 0. Check URL query params for OAuth redirect landing
      if (typeof window !== 'undefined' && window.location?.search) {
        try {
          const params = new URLSearchParams(window.location.search);
          if (params.get('login') === 'success') {
            const token = params.get('token');
            const sub = params.get('sub');
            const email = params.get('email');
            const name = params.get('name');
            if (token || sub) {
              const sessionUser = {
                id: sub || 'user_cloud',
                sub: sub || 'user_cloud',
                email: email || '',
                name: name || 'Learner',
                authenticated: true
              };
              const newSession = { user: sessionUser, token: token || null, timestamp: Date.now() };
              try {
                localStorage.setItem('kiroku_auth_session', JSON.stringify(newSession));
                localStorage.setItem('kiroku:auth-user', JSON.stringify(sessionUser));
                if (token) localStorage.setItem('kiroku_auth_token', token);
              } catch (_) {}
              const cleanUrl = window.location.pathname + (window.location.hash || '');
              window.history.replaceState({}, document.title, cleanUrl);
              return newSession;
            }
          }
        } catch (_) {}
      }
      try {
        const raw = localStorage.getItem('kiroku_auth_session') || localStorage.getItem('kiroku:auth-user');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && (parsed.token || parsed.user)) return parsed;
        }
      } catch (_) {}
      try {
        const res = await fetch('/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (data && data.authenticated && data.user) {
            const session = { user: data.user, token: data.token || null };
            try {
              localStorage.setItem('kiroku_auth_session', JSON.stringify(session));
              localStorage.setItem('kiroku:auth-user', JSON.stringify(data.user));
              if (data.token) localStorage.setItem('kiroku_auth_token', data.token);
            } catch (_) {}
            return session;
          }
        }
      } catch (_) {}
      return null;
    },
    saveSession: (session) => {
      try {
        localStorage.setItem('kiroku_auth_session', JSON.stringify(session));
        if (session?.user) {
          localStorage.setItem('kiroku:auth-user', JSON.stringify(session.user));
        }
      } catch (_) {}
      return Promise.resolve({ ok: true });
    },
    clearSession: async () => {
      try {
        localStorage.removeItem('kiroku_auth_session');
        localStorage.removeItem('kiroku:auth-user');
        await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
      } catch (_) {}
      return { ok: true };
    },
    verifyToken: async (token) => {
      try {
        const res = await fetch('/auth/me', {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        return res.ok ? await res.json() : { authenticated: false };
      } catch (_) {
        return { authenticated: false };
      }
    },
    onAuthSuccess: (callback) => {
      if (typeof window !== 'undefined' && typeof callback === 'function') {
        const handler = (e) => callback(e.detail);
        window.addEventListener('kiroku:auth-changed', handler);
        return () => window.removeEventListener('kiroku:auth-changed', handler);
      }
      return () => {};
    }
  },

  api: {
    request: (options = {}) => {
      const p = typeof options.path === 'string' ? options.path : '';
      const normPath = p.startsWith('/api') ? p : `/api${p.startsWith('/') ? '' : '/'}${p}`;
      return dispatchFetch(normPath, options);
    }
  },

  journeyApi: {
    request: (options = {}) => {
      const p = typeof options.path === 'string' ? options.path : '';
      const normPath = p.startsWith('/api/journey') ? p : `/api/journey${p.startsWith('/') ? '' : '/'}${p}`;
      return dispatchFetch(normPath, options);
    }
  },

  studyApi: {
    request: (options = {}) => {
      const p = typeof options.path === 'string' ? options.path : '';
      const normPath = p.startsWith('/') ? p : `/${p}`;
      return dispatchFetch(normPath, options);
    },
    checkHealth: () => dispatchFetch('/api/health'),
    getBankSummary: (level) => dispatchFetch('/api/study/v1/bank/summary', { query: level ? { level } : undefined }),
    getExamReadiness: () => dispatchFetch('/api/study/v1/exam/readiness'),
    getLearningOverview: () => dispatchFetch('/api/study/v1/dashboard/overview'),
    getDiagnostics: () => dispatchFetch('/api/study/v1/diagnostics'),
    getSettings: () => dispatchFetch('/api/study/v1/settings'),
    updateSettings: (updates) => dispatchFetch('/api/study/v1/settings', { method: 'PATCH', body: updates }),
    getMedia: (mediaRef, range) => dispatchFetch(`/api/study/v1/media/${encodeURIComponent(mediaRef)}`, { headers: range ? { Range: range } : undefined }),
    searchQuestions: (query) => dispatchFetch('/api/study/v1/bank/questions', { query }),
    getQuestion: (questionId) => dispatchFetch(`/api/study/v1/bank/questions/${encodeURIComponent(questionId)}`),
    getQuestionProvenance: (questionId) => dispatchFetch(`/api/study/v1/bank/questions/${encodeURIComponent(questionId)}/provenance`),
    reportQuestion: (questionId, payload) => dispatchFetch(`/api/study/v1/bank/questions/${encodeURIComponent(questionId)}/reports`, { method: 'POST', body: payload }),
    getBookmarks: (query) => dispatchFetch('/api/study/v1/bookmarks', { query })
  },

  ocr: {
    detect: (imageData) => ocrBridge.detect(imageData),
    recognize: (imageData) => ocrBridge.recognize(imageData)
  },

  haptic: {
    tap: () => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(15); } catch {}
      }
    },
    notification: () => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate([25, 20, 25]); } catch {}
      }
    }
  },

  pwa: {
    isInstallable: () => !!deferredInstallPrompt,
    promptInstall: async () => {
      if (!deferredInstallPrompt) return { outcome: 'unavailable' };
      try {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        return choice;
      } catch (err) {
        console.warn('[PWA] Prompt install error:', err);
        return { outcome: 'dismissed', error: String(err) };
      }
    }
  }
};

let deferredInstallPrompt = null;

if (typeof window !== 'undefined') {
  // PWA File Handling API (launchQueue for mobile & modern browsers)
  if ('launchQueue' in window && typeof window.launchQueue.setConsumer === 'function') {
    window.launchQueue.setConsumer(async (launchParams) => {
      if (!launchParams || !launchParams.files || !launchParams.files.length) return;
      try {
        const files = [];
        for (const handle of launchParams.files) {
          const file = await handle.getFile();
          files.push(file);
        }
        if (files.length > 0) {
          window.dispatchEvent(new CustomEvent('kiroku:pwa-manga-import', { detail: { files } }));
        }
      } catch (err) {
        console.warn('[PWA] launchQueue file import error:', err);
      }
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    window.dispatchEvent(new CustomEvent('pwa-installable', { detail: { prompt: e } }));
  });

  const initSwipeToDismiss = () => {
    if (typeof document === 'undefined') return;
    let startX = 0;
    let startY = 0;
    let currentTarget = null;

    document.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dismissable = touch.target.closest(
        '.toast, .toast-pill, .settings-error-banner, [class*="error-banner"], .grading-feedback-banner, .notification'
      );
      if (!dismissable) {
        currentTarget = null;
        return;
      }
      currentTarget = dismissable;
      startX = touch.clientX;
      startY = touch.clientY;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!currentTarget || !e.touches || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        currentTarget.style.transform = `translateX(${dx}px)`;
        currentTarget.style.opacity = `${Math.max(0.2, 1 - Math.abs(dx) / 200)}`;
      }
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (!currentTarget) return;
      const touch = e.changedTouches ? e.changedTouches[0] : null;
      if (!touch) {
        currentTarget.style.transform = '';
        currentTarget.style.opacity = '';
        currentTarget = null;
        return;
      }
      const dx = touch.clientX - startX;
      if (Math.abs(dx) > 75) {
        const dir = dx > 0 ? '120%' : '-120%';
        currentTarget.style.transition = 'transform 200ms ease, opacity 200ms ease';
        currentTarget.style.transform = `translateX(${dir})`;
        currentTarget.style.opacity = '0';
        const el = currentTarget;
        setTimeout(() => {
          if (el && el.parentNode) {
            if (el.id === 'settings-error-banner' || el.style.display !== undefined) {
              el.style.display = 'none';
              el.style.transform = '';
              el.style.opacity = '';
            } else {
              el.remove();
            }
          }
        }, 200);
        webAPI.haptic.tap();
      } else {
        currentTarget.style.transition = 'transform 150ms ease, opacity 150ms ease';
        currentTarget.style.transform = '';
        currentTarget.style.opacity = '';
      }
      currentTarget = null;
    }, { passive: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSwipeToDismiss);
  } else {
    initSwipeToDismiss();
  }
}


// Expose globally on window if not already defined (i.e. web / PWA runtime)
if (typeof window !== 'undefined' && !window.desktopAPI) {
  window.desktopAPI = webAPI;
  if (!window.chrome) {
    window.chrome = chromeWebShim;
  }
}

// Active-Only Foreground Ping for Render Tokenizer
(function initRenderKeepAlive() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const RENDER_HEALTH_URL = 'https://kiroku-cloud-queue.onrender.com/health';
  const PING_INTERVAL_MS = 9 * 60 * 1000; // 9 minutes
  const MAX_IDLE_MS = 15 * 60 * 1000; // 15 minutes of inactivity pauses keep-alive
  let pingTimer = null;
  let lastUserActivity = Date.now();

  function markActivity() {
    lastUserActivity = Date.now();
    if (document.visibilityState === 'visible' && !pingTimer) {
      startKeepAlive();
    }
  }

  ['mousemove', 'keydown', 'touchstart', 'scroll', 'pointerdown'].forEach((evt) => {
    window.addEventListener(evt, markActivity, { passive: true });
  });

  async function pingRender() {
    if (document.visibilityState === 'hidden') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (Date.now() - lastUserActivity > MAX_IDLE_MS) {
      stopKeepAlive();
      return;
    }

    try {
      await fetch(RENDER_HEALTH_URL, {
        method: 'GET',
        cache: 'no-store',
        mode: 'no-cors'
      });
    } catch (err) {
      // Non-blocking keep-alive ping
    }
  }

  function startKeepAlive() {
    if (pingTimer) return;
    pingRender();
    pingTimer = setInterval(pingRender, PING_INTERVAL_MS);
  }

  function stopKeepAlive() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      lastUserActivity = Date.now();
      startKeepAlive();
    } else {
      stopKeepAlive();
    }
  });

  window.addEventListener('focus', () => {
    if (document.visibilityState === 'visible') {
      lastUserActivity = Date.now();
      startKeepAlive();
    }
  });

  window.addEventListener('online', () => {
    if (document.visibilityState === 'visible') {
      startKeepAlive();
    }
  });

  window.addEventListener('offline', () => {
    stopKeepAlive();
  });

  if (document.visibilityState === 'visible') {
    startKeepAlive();
  }
})();

