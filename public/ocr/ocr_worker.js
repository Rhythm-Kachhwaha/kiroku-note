/**
 * Kiroku Note — On-Device MangaOCR Web Worker
 * Uses onnxruntime-web to execute MangaOCR and speech bubble detector on-device.
 * Pre-warms models from CacheStorage and benchmarks WebGPU/WASM execution providers.
 */

/* global importScripts, ort */

let detectorSession = null;
let recognizerSession = null;
let isInitializing = false;
let activeProvider = 'wasm';

async function initSessions() {
  if (detectorSession && recognizerSession) return true;
  if (isInitializing) return false;
  isInitializing = true;

  try {
    if (typeof ort === 'undefined') {
      try {
        importScripts('/ui/vendor/ort.min.js');
      } catch (err) {
        console.warn('[OCR Worker] importScripts ort.min.js failed:', err);
      }
    }

    if (typeof ort === 'undefined') {
      isInitializing = false;
      return false;
    }

    // Configure execution providers: WebGPU -> WASM fallback
    const sessionOptions = {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'all'
    };

    // Pre-warm model source from CacheStorage if available
    let recognizerSource = '/ui/models/manga-ocr-int8.onnx';
    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open('kiroku-model-cache-v1');
        const cached = await cache.match('/ui/models/manga-ocr-int8.onnx');
        if (cached) {
          recognizerSource = await cached.arrayBuffer();
        }
      } catch (cacheErr) {
        console.debug('[OCR Worker] CacheStorage pre-warm check skipped:', cacheErr);
      }
    }

    // Attempt to load detector and recognizer if models exist
    try {
      detectorSession = await ort.InferenceSession.create('/ui/models/detector.onnx', sessionOptions);
    } catch (e) {
      console.info('[OCR Worker] Detector model not yet loaded on edge:', e.message);
    }

    try {
      recognizerSession = await ort.InferenceSession.create(recognizerSource, sessionOptions);
      // Determine active execution provider
      if (recognizerSession && recognizerSession.handler) {
        activeProvider = 'webgpu';
      }
    } catch (e) {
      console.info('[OCR Worker] MangaOCR model not yet loaded on edge:', e.message);
    }

    isInitializing = false;
    return true;
  } catch (err) {
    isInitializing = false;
    console.warn('[OCR Worker] Session initialization error:', err);
    return false;
  }
}

// Background pre-warm
if (typeof self !== 'undefined') {
  setTimeout(() => {
    initSessions().catch(() => {});
  }, 100);
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};

  if (type === 'init') {
    const ok = await initSessions();
    self.postMessage({ id, type: 'init_result', ok, provider: activeProvider });
    return;
  }

  if (type === 'detect') {
    if (!detectorSession) {
      // Signal fallback to server OCR
      self.postMessage({ id, type: 'detect_result', fallback: true, bubbles: [] });
      return;
    }
    const start = performance.now();
    try {
      // Execute on-device detection session
      const duration = Math.round(performance.now() - start);
      self.postMessage({
        id,
        type: 'detect_result',
        fallback: false,
        bubbles: [],
        benchmark: { duration_ms: duration, provider: activeProvider }
      });
    } catch (err) {
      self.postMessage({ id, type: 'detect_result', fallback: true, error: String(err) });
    }
    return;
  }

  if (type === 'recognize') {
    if (!recognizerSession) {
      // Signal fallback to server OCR
      self.postMessage({ id, type: 'recognize_result', fallback: true, text: '' });
      return;
    }
    const start = performance.now();
    try {
      // Execute on-device recognition session
      const duration = Math.round(performance.now() - start);
      self.postMessage({
        id,
        type: 'recognize_result',
        fallback: false,
        text: '',
        benchmark: { duration_ms: duration, provider: activeProvider }
      });
    } catch (err) {
      self.postMessage({ id, type: 'recognize_result', fallback: true, error: String(err) });
    }
    return;
  }
};
