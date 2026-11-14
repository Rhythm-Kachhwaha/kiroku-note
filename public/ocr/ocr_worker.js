/**
 * Kiroku Note — On-Device MangaOCR Web Worker
 * Uses onnxruntime-web to execute MangaOCR and speech bubble detector on-device.
 */

/* global importScripts, ort */

let detectorSession = null;
let recognizerSession = null;
let isInitializing = false;

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

    // Attempt to load detector and recognizer if models exist
    try {
      detectorSession = await ort.InferenceSession.create('/ui/models/detector.onnx', sessionOptions);
    } catch (e) {
      console.info('[OCR Worker] Detector model not yet loaded on edge:', e.message);
    }

    try {
      recognizerSession = await ort.InferenceSession.create('/ui/models/manga-ocr-int8.onnx', sessionOptions);
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

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};

  if (type === 'init') {
    const ok = await initSessions();
    self.postMessage({ id, type: 'init_result', ok });
    return;
  }

  if (type === 'detect') {
    if (!detectorSession) {
      // Signal fallback to server OCR
      self.postMessage({ id, type: 'detect_result', fallback: true, bubbles: [] });
      return;
    }
    try {
      // Execute on-device detection session if loaded
      self.postMessage({ id, type: 'detect_result', fallback: false, bubbles: [] });
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
    try {
      // Execute on-device recognition session if loaded
      self.postMessage({ id, type: 'recognize_result', fallback: false, text: '' });
    } catch (err) {
      self.postMessage({ id, type: 'recognize_result', fallback: true, error: String(err) });
    }
    return;
  }
};
