/**
 * Kiroku Note Desktop — Manga Reader View
 * Drag-and-drop manga page viewer with local MangaOCR box selection and instant Yomitan dictionary lookups.
 */

import { apiClient } from '../services/api_client.js';
import { escapeHtml } from '../utils/sanitizer.js';

export class MangaView {
  constructor(router, options = {}) {
    this.router = router;
    this.options = options;
    this.apiClient = options.apiClient || apiClient;
    this.container = null;
    this.currentImage = null;
    this.ocrBoxSelection = null;
    this.isSelecting = false;
    this.selectionStart = null;
    this.recognizedText = '';
  }

  async mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="manga-viewer-container">
        <div class="manga-header-row">
          <div class="flex items-center gap-2">
            <h1 class="manga-title">MANGA READER</h1>
            <span class="text-xs font-mono text-muted">MangaOCR Engine</span>
          </div>
          <div class="manga-toolbar">
            <label class="anime-control-btn btn-sm cursor-pointer" for="manga-file-input">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              <span>Open Page</span>
            </label>
            <input type="file" id="manga-file-input" accept="image/*,.cbz" style="display: none;" />
          </div>
        </div>

        <div class="manga-viewer-layout">
          <div class="manga-stage-card" id="manga-stage-card">
            <div class="manga-canvas-wrapper" id="manga-canvas-wrapper">
              <canvas class="manga-canvas" id="manga-canvas"></canvas>
              <div class="manga-selection-box" id="manga-selection-box" style="display: none;"></div>
            </div>
          </div>

          <div class="manga-side-panel">
            <div class="text-xs font-mono text-gold">OCR Recognition</div>
            <div class="manga-ocr-result-card" id="manga-ocr-result-card">
              <div class="manga-ocr-text" id="manga-ocr-text">
                <span class="manga-ocr-empty">Drag a rectangle over speech bubbles to recognize Japanese text</span>
              </div>
            </div>

            <div class="text-xs font-mono text-gold mt-2">Dictionary Inspection</div>
            <div class="manga-inspector-lookup" id="manga-inspector-lookup">
              <span class="text-xs text-muted">Select text to look up definitions</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  setupEvents() {
    if (!this.container) return;

    const fileInput = this.container.querySelector('#manga-file-input');
    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        this.loadImageFile(file);
      }
    });

    const wrapper = this.container.querySelector('#manga-canvas-wrapper');
    wrapper?.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    wrapper?.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    wrapper?.addEventListener('mouseup', (e) => this.handleMouseUp(e));

    // Drag and drop image files directly onto stage
    wrapper?.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    wrapper?.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        this.loadImageFile(file);
      }
    });

    const lookupPanel = this.container.querySelector('#manga-inspector-lookup');
    lookupPanel?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-manga-mine-word');
      if (btn && btn.dataset.word) {
        this.mineWord(btn.dataset.word, btn);
      }
    });
  }

  loadImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        this.currentImage = img;
        this.drawCanvasImage(img);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  drawCanvasImage(img) {
    const canvas = this.container?.querySelector('#manga-canvas');
    if (!canvas) return;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
  }

  handleMouseDown(e) {
    if (!this.currentImage) return;
    const canvas = this.container?.querySelector('#manga-canvas');
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.isSelecting = true;
    this.selectionStart = { x, y };
  }

  handleMouseMove(e) {
    if (!this.isSelecting || !this.selectionStart) return;
    const canvas = this.container?.querySelector('#manga-canvas');
    const box = this.container?.querySelector('#manga-selection-box');
    if (!canvas || !box) return;

    const rect = canvas.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;

    const left = Math.min(this.selectionStart.x, curX);
    const top = Math.min(this.selectionStart.y, curY);
    const width = Math.abs(curX - this.selectionStart.x);
    const height = Math.abs(curY - this.selectionStart.y);

    box.style.display = 'block';
    box.style.left = `${left + rect.left}px`;
    box.style.top = `${top + rect.top}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
  }

  async handleMouseUp(e) {
    if (!this.isSelecting || !this.selectionStart) return;
    this.isSelecting = false;

    const canvas = this.container?.querySelector('#manga-canvas');
    const box = this.container?.querySelector('#manga-selection-box');
    if (box) box.style.display = 'none';
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const startX = Math.min(this.selectionStart.x, curX) * scaleX;
    const startY = Math.min(this.selectionStart.y, curY) * scaleY;
    const endX = Math.max(this.selectionStart.x, curX) * scaleX;
    const endY = Math.max(this.selectionStart.y, curY) * scaleY;

    if (endX - startX > 10 && endY - startY > 10) {
      await this.performOcrBoxSelection(startX, startY, endX, endY);
    }
  }

  async performOcrBoxSelection(startX, startY, endX, endY) {
    this.ocrBoxSelection = { startX, startY, endX, endY };
    const canvas = this.container?.querySelector('#manga-canvas');
    if (!canvas) return;

    const width = Math.round(endX - startX);
    const height = Math.round(endY - startY);

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = width;
    cropCanvas.height = height;
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(canvas, startX, startY, width, height, 0, 0, width, height);

    const base64Data = cropCanvas.toDataURL('image/png').split(',')[1];
    const textEl = this.container?.querySelector('#manga-ocr-text');
    if (textEl) {
      textEl.innerHTML = `<span class="text-xs text-muted">Running MangaOCR...</span>`;
    }

    try {
      const res = await this.apiClient.request('/api/ocr/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_b64: base64Data })
      });

      if (res && res.text) {
        this.recognizedText = res.text.trim();
        if (textEl) {
          textEl.innerHTML = escapeHtml(this.recognizedText);
        }
        await this.lookupDictionary(this.recognizedText);
      } else {
        if (textEl) textEl.innerHTML = `<span class="text-xs text-muted">No text detected</span>`;
      }
    } catch (err) {
      console.warn('[MangaView] OCR recognition failed:', err);
      if (textEl) textEl.innerHTML = `<span class="text-xs text-danger">OCR Error</span>`;
    }
  }

  async lookupDictionary(text) {
    const lookupEl = this.container?.querySelector('#manga-inspector-lookup');
    if (!lookupEl || !text) return;

    try {
      const res = await this.apiClient.request(`/api/dictionary/lookup?term=${encodeURIComponent(text)}`);
      if (res && Array.isArray(res.entries) && res.entries.length > 0) {
        lookupEl.innerHTML = res.entries.slice(0, 3).map((entry) => `
          <div class="manga-dict-entry mb-2">
            <div class="flex items-center justify-between">
              <span class="font-bold text-accent">${escapeHtml(entry.expression || entry.kanji || text)}</span>
              <button type="button" class="anime-control-btn btn-sm btn-manga-mine-word" data-word="${escapeHtml(entry.expression || entry.kanji || text)}">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                <span>Mine</span>
              </button>
            </div>
            <div class="text-xs text-muted">${escapeHtml(entry.reading || '')}</div>
            <div class="text-xs">${escapeHtml((entry.glossary || []).join('; '))}</div>
          </div>
        `).join('');
      } else {
        lookupEl.innerHTML = `<span class="text-xs text-muted">No dictionary entries found for "${escapeHtml(text)}"</span>`;
      }
    } catch (err) {
      console.debug('[MangaView] Dictionary lookup fallback:', err);
    }
  }

  async mineWord(word, btn = null) {
    if (!word) return;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg><span>Mined</span>`;
    }
    try {
      await this.apiClient.request('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expression: word,
          reading: '',
          meaning: '',
          source: 'manga'
        })
      });
    } catch (err) {
      console.warn('[MangaView] Mine word failed:', err);
    }
  }

  unmount() {
    this.currentImage = null;
    this.ocrBoxSelection = null;
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
  }
}
