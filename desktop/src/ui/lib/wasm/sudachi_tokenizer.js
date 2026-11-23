/**
 * Kiroku Note — Sudachi WebAssembly Client Manager for Desktop UI
 * Manages client-side dictionary caching in CacheStorage and Web Worker communication.
 */

const CACHE_NAME = 'kiroku-sudachi-v1';
const WASM_URL = '/assets/wasm/sudachi.wasm';
const DICT_URL = '/assets/wasm/system_small.dic';

let worker = null;
let reqId = 0;
const pendingRequests = new Map();
let isInitializing = false;
let initPromise = null;

export async function getCachedOrFetch(url) {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      const matched = await cache.match(url);
      if (matched) {
        return await matched.arrayBuffer();
      }
      const resp = await fetch(url);
      if (resp.ok) {
        await cache.put(url, resp.clone());
        return await resp.arrayBuffer();
      }
      throw new Error(`Failed to load asset from ${url}: ${resp.status}`);
    } catch (err) {
      console.warn('[SudachiWasm] CacheStorage fetch warning:', err.message);
      throw err;
    }
  }

  const fallbackResp = await fetch(url);
  if (!fallbackResp.ok) throw new Error(`Failed to load asset from ${url}: ${fallbackResp.status}`);
  return await fallbackResp.arrayBuffer();
}

function resolveWorkerUrl() {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return new URL('./sudachi_worker.js', import.meta.url).href;
    }
  } catch (_) {}
  return './sudachi_worker.js';
}

export async function initSudachiWasm({ workerUrl } = {}) {
  if (worker) return true;
  if (isInitializing) return initPromise;

  const targetWorkerUrl = workerUrl || resolveWorkerUrl();

  isInitializing = true;
  initPromise = (async () => {
    try {
      if (typeof Worker === 'undefined') {
        throw new Error('Web Workers not supported in this environment');
      }

      worker = new Worker(targetWorkerUrl, { type: 'module' });
      worker.onmessage = (e) => {
        const { id, tokens, status, error, source } = e.data || {};
        if (pendingRequests.has(id)) {
          const { resolve, reject } = pendingRequests.get(id);
          pendingRequests.delete(id);
          if (error) {
            reject(new Error(error));
          } else {
            resolve({ tokens: tokens || [], source: source || 'sudachi_wasm' });
          }
        }
      };

      // Attempt to load dictionary and wasm bytes into worker
      try {
        const [wasmBytes, dictBytes] = await Promise.all([
          getCachedOrFetch(WASM_URL).catch(() => null),
          getCachedOrFetch(DICT_URL).catch(() => null)
        ]);

        const initId = ++reqId;
        const readyPromise = new Promise((resolve) => {
          pendingRequests.set(initId, {
            resolve: () => resolve(true),
            reject: () => resolve(true) // Non-fatal if fallback tokenizer in worker is used
          });
        });

        worker.postMessage({ id: initId, type: 'init', wasmBytes, dictBytes });
        await readyPromise;
      } catch (assetErr) {
        console.warn('[SudachiWasm] Offline dictionary warm-up deferred:', assetErr.message);
      }

      return true;
    } catch (err) {
      console.warn('[SudachiWasm] Initialization error, falling back:', err.message);
      worker = null;
      return false;
    } finally {
      isInitializing = false;
    }
  })();

  return initPromise;
}

export async function tokenize(text, mode = 'C') {
  if (!text || !text.trim()) {
    return { tokens: [] };
  }

  // Ensure worker is initialized
  await initSudachiWasm();

  if (worker) {
    const currentId = ++reqId;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (pendingRequests.has(currentId)) {
          pendingRequests.delete(currentId);
          resolve(fallbackTokenize(text));
        }
      }, 3000);

      pendingRequests.set(currentId, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (_err) => {
          clearTimeout(timeout);
          resolve(fallbackTokenize(text));
        }
      });

      worker.postMessage({ id: currentId, type: 'tokenize', text, mode });
    });
  }

  return fallbackTokenize(text);
}

export function fallbackTokenize(text) {
  const matches = text.match(/[\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]+|[a-zA-Z0-9]+|[^\s\w\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]+/g) || [text];
  return {
    tokens: matches.map(word => ({
      surface: word,
      dictionary_form: word,
      normalized_form: word,
      reading: '',
      part_of_speech: ['名詞', '普通名詞', '*', '*'],
      inflection_type: '*',
      inflection_form: '*'
    })),
    source: 'client_fallback'
  };
}

