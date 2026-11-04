/**
 * Kiroku Note Desktop — Study Import & PDF Ingestion Component (Slice 22)
 *
 * Provides drop zone for PDF uploads, pasted text, and JSON question sets.
 * Multi-page PDF flow:
 * 1. Inspect upload -> displays page list with plain-text route labels
 *    (e.g., text, ruby, table; image-only pages marked "needs OCR - not available").
 * 2. Page selection checkboxes (select text pages to convert).
 * 3. Preview questions generation via /bank/import/pdf/{id}/preview.
 * 4. Commit questions to Study Bank via /bank/import/commit.
 */

import { studyClient } from '../services/study_client.js';
import { escapeHtml } from '../utils/sanitizer.js';

export class StudyImportController {
  constructor() {
    this.container = null;
    this.activeMode = 'pdf'; // 'pdf' | 'paste' | 'json'
    this.stagedImportId = null;
    this.pdfPages = [];
    this.selectedPages = new Set();
    this.previewId = null;
    this.previewQuestions = [];
    this.isLoading = false;
    this.statusMessage = null;
    this.statusType = 'info'; // 'info' | 'error' | 'success'
  }

  mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="study-import-panel tactile-card">
        <div class="study-import-header">
          <div class="import-mode-pills" role="radiogroup" aria-label="Import format">
            <button type="button" class="tactile-pill import-mode-pill ${this.activeMode === 'pdf' ? 'is-active' : ''}" data-mode="pdf">PDF Upload</button>
            <button type="button" class="tactile-pill import-mode-pill ${this.activeMode === 'paste' ? 'is-active' : ''}" data-mode="paste">Paste Text</button>
            <button type="button" class="tactile-pill import-mode-pill ${this.activeMode === 'json' ? 'is-active' : ''}" data-mode="json">JSON Set</button>
          </div>
          <span class="text-xs text-muted font-mono">Study Ingestion</span>
        </div>

        ${this.statusMessage ? `
          <div class="import-status-banner ${this.statusType === 'error' ? 'text-red' : (this.statusType === 'success' ? 'text-green' : 'text-gold')} text-xs font-sans p-2 mb-3 tactile-card">
            ${escapeHtml(this.statusMessage)}
          </div>
        ` : ''}

        <!-- Mode 1: PDF Drop Zone & Staging -->
        <div id="import-mode-pdf" class="import-mode-pane" ${this.activeMode === 'pdf' ? '' : 'hidden'}>
          <div class="import-drop-zone tactile-card" id="pdf-drop-zone">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" class="text-muted mb-2">
              <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/>
            </svg>
            <p class="font-sans font-bold text-sm text-warm-paper">Drag &amp; drop test PDF here, or click to browse</p>
            <p class="text-xs text-muted font-sans mt-1">Extracts JLPT questions and passages directly without external servers.</p>
            <input type="file" id="pdf-file-input" accept=".pdf,application/pdf" style="display: none;" />
          </div>

          <!-- Staged PDF Page List Container -->
          <div id="pdf-pages-section" class="mt-4" style="display: none;">
            <div class="flex items-center justify-between mb-2">
              <h4 class="font-sans font-bold text-xs uppercase text-secondary">Select Pages to Extract</h4>
              <button type="button" class="tactile-btn tactile-btn-sm" id="btn-select-all-pages">Select all text pages</button>
            </div>
            <div class="pdf-pages-grid" id="pdf-pages-grid"></div>

            <div class="mt-3 flex items-center justify-end gap-2">
              <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-preview-pdf-pages">
                Preview Questions
              </button>
            </div>
          </div>
        </div>

        <!-- Mode 2: Paste Japanese Text -->
        <div id="import-mode-paste" class="import-mode-pane" ${this.activeMode === 'paste' ? '' : 'hidden'}>
          <textarea id="paste-input" class="tactile-input w-full font-japanese text-sm" rows="5" placeholder="Paste JLPT questions, grammar drills, or passages here..."></textarea>
          <div class="mt-2 flex justify-end">
            <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-preview-paste">Preview Questions</button>
          </div>
        </div>

        <!-- Mode 3: JSON Set -->
        <div id="import-mode-json" class="import-mode-pane" ${this.activeMode === 'json' ? '' : 'hidden'}>
          <textarea id="json-input" class="tactile-input w-full font-mono text-xs" rows="5" placeholder='[{"prompt": "...", "target": "...", "choices": ["A", "B", "C", "D"], "answer_index": 0}]'></textarea>
          <div class="mt-2 flex justify-end">
            <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-preview-json">Preview Questions</button>
          </div>
        </div>

        <!-- Question Preview & Commit Stage -->
        <div id="import-preview-stage" class="mt-4 pt-3 border-t border-ink" style="display: none;">
          <div class="flex items-center justify-between mb-2">
            <div>
              <h4 class="font-sans font-bold text-sm text-warm-paper">Question Preview</h4>
              <span class="text-xs text-muted font-mono" id="preview-count-label">0 questions ready</span>
            </div>
            <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-commit-import">
              Commit to Bank
            </button>
          </div>
          <div class="import-preview-list" id="import-preview-list"></div>
        </div>
      </div>
    `;
  }

  setupEvents() {
    if (!this.container) return;

    // Mode pills
    this.container.querySelectorAll('.import-mode-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        this.activeMode = pill.dataset.mode;
        this.statusMessage = null;
        this.render();
        this.setupEvents();
      });
    });

    // PDF Drop zone & file input
    const dropZone = this.container.querySelector('#pdf-drop-zone');
    const fileInput = this.container.querySelector('#pdf-file-input');

    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('is-dragover');
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('is-dragover');
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('is-dragover');
        if (e.dataTransfer?.files?.length) {
          this.handleFileSelected(e.dataTransfer.files[0]);
        }
      });

      fileInput.addEventListener('change', () => {
        if (fileInput.files?.length) {
          this.handleFileSelected(fileInput.files[0]);
        }
      });
    }

    // Select all pages button
    const btnSelectAll = this.container.querySelector('#btn-select-all-pages');
    if (btnSelectAll) {
      btnSelectAll.addEventListener('click', () => {
        this.pdfPages.forEach((p) => {
          if (p.route !== 'image_only' && !p.skipped_ocr) {
            this.selectedPages.add(p.page_number);
          }
        });
        this.renderPageList();
      });
    }

    // Preview PDF pages button
    const btnPreviewPdf = this.container.querySelector('#btn-preview-pdf-pages');
    if (btnPreviewPdf) {
      btnPreviewPdf.addEventListener('click', () => this.handlePreviewPdf());
    }

    // Preview Paste button
    const btnPreviewPaste = this.container.querySelector('#btn-preview-paste');
    if (btnPreviewPaste) {
      btnPreviewPaste.addEventListener('click', () => this.handlePreviewPaste());
    }

    // Preview JSON button
    const btnPreviewJson = this.container.querySelector('#btn-preview-json');
    if (btnPreviewJson) {
      btnPreviewJson.addEventListener('click', () => this.handlePreviewJson());
    }

    // Commit import button
    const btnCommit = this.container.querySelector('#btn-commit-import');
    if (btnCommit) {
      btnCommit.addEventListener('click', () => this.handleCommitImport());
    }
  }

  async handleFileSelected(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      this.setStatus('Please select a valid PDF file (.pdf).', 'error');
      return;
    }

    this.setStatus(`Staging "${file.name}"...`, 'info');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      const base64 = btoa(binary);

      const inspection = await studyClient.inspectPdfImport(base64, file.name);
      this.stagedImportId = inspection.import_id;
      this.pdfPages = inspection.pages || [];
      this.selectedPages.clear();

      // Automatically select text pages by default
      this.pdfPages.forEach((p) => {
        if (p.route !== 'image_only' && !p.skipped_ocr) {
          this.selectedPages.add(p.page_number);
        }
      });

      this.setStatus(`Staged "${file.name}" (${this.pdfPages.length} pages).`, 'success');
      const pagesSec = this.container.querySelector('#pdf-pages-section');
      if (pagesSec) pagesSec.style.display = 'block';
      this.renderPageList();
    } catch (err) {
      this.setStatus(`Failed to inspect PDF: ${err.message}`, 'error');
    }
  }

  renderPageList() {
    const grid = this.container.querySelector('#pdf-pages-grid');
    if (!grid) return;

    if (this.pdfPages.length === 0) {
      grid.innerHTML = '<span class="text-xs text-muted">No pages detected.</span>';
      return;
    }

    grid.innerHTML = this.pdfPages.map((p) => {
      const isImageOnly = p.route === 'image_only' || p.skipped_ocr;
      const routeText = isImageOnly ? 'needs OCR - not available' : (p.route || 'text');
      const isChecked = this.selectedPages.has(p.page_number);

      return `
        <label class="pdf-page-chip tactile-card ${isImageOnly ? 'is-disabled' : ''} ${isChecked ? 'is-selected' : ''}" style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; margin-bottom: 0.35rem; cursor: ${isImageOnly ? 'not-allowed' : 'pointer'};">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <input
              type="checkbox"
              class="page-select-checkbox"
              data-page="${p.page_number}"
              ${isChecked ? 'checked' : ''}
              ${isImageOnly ? 'disabled' : ''}
            />
            <span class="font-mono text-xs font-bold text-warm-paper">Page ${p.page_number}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span class="text-xs ${isImageOnly ? 'text-red' : 'text-muted'} font-sans">${escapeHtml(routeText)}</span>
            <span class="text-xs text-muted font-mono">${p.char_count || 0} chars</span>
          </div>
        </label>
      `;
    }).join('');

    grid.querySelectorAll('.page-select-checkbox').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const pageNum = Number(e.target.dataset.page);
        if (e.target.checked) {
          this.selectedPages.add(pageNum);
        } else {
          this.selectedPages.delete(pageNum);
        }
        this.renderPageList();
      });
    });
  }

  async handlePreviewPdf() {
    if (!this.stagedImportId) {
      this.setStatus('No staged PDF found. Please upload a PDF first.', 'error');
      return;
    }

    const pages = Array.from(this.selectedPages).sort((a, b) => a - b);
    if (pages.length === 0) {
      this.setStatus('Please select at least one page with text to preview.', 'error');
      return;
    }

    this.setStatus('Generating questions preview from selected PDF pages...', 'info');
    try {
      const res = await studyClient.previewPdfImport(this.stagedImportId, {
        pages,
        default_level: 'N5',
        source_name: 'PDF Test Import'
      });

      this.previewId = res.preview_id;
      this.previewQuestions = res.questions || [];
      this.setStatus(`Extracted ${this.previewQuestions.length} questions from PDF.`, 'success');
      this.renderPreviewStage();
    } catch (err) {
      this.setStatus(`PDF Preview failed: ${err.message}`, 'error');
    }
  }

  async handlePreviewPaste() {
    const text = this.container.querySelector('#paste-input')?.value?.trim();
    if (!text) {
      this.setStatus('Please paste some text to extract questions.', 'error');
      return;
    }

    this.setStatus('Parsing pasted text...', 'info');
    try {
      const res = await studyClient.previewImport({
        content: text,
        default_level: 'N5',
        source_type: 'pasted_text'
      });

      this.previewId = res.preview_id;
      this.previewQuestions = res.questions || [];
      this.setStatus(`Extracted ${this.previewQuestions.length} questions from text.`, 'success');
      this.renderPreviewStage();
    } catch (err) {
      this.setStatus(`Preview failed: ${err.message}`, 'error');
    }
  }

  async handlePreviewJson() {
    const raw = this.container.querySelector('#json-input')?.value?.trim();
    if (!raw) {
      this.setStatus('Please enter valid JSON question data.', 'error');
      return;
    }

    this.setStatus('Validating JSON...', 'info');
    try {
      const res = await studyClient.previewImport({
        content: raw,
        source_type: 'json_batch'
      });

      this.previewId = res.preview_id;
      this.previewQuestions = res.questions || [];
      this.setStatus(`Validated ${this.previewQuestions.length} questions from JSON.`, 'success');
      this.renderPreviewStage();
    } catch (err) {
      this.setStatus(`JSON preview failed: ${err.message}`, 'error');
    }
  }

  renderPreviewStage() {
    const stage = this.container.querySelector('#import-preview-stage');
    const countLabel = this.container.querySelector('#preview-count-label');
    const list = this.container.querySelector('#import-preview-list');

    if (!stage || !list) return;

    stage.style.display = 'block';
    if (countLabel) countLabel.textContent = `${this.previewQuestions.length} questions ready to commit`;

    if (this.previewQuestions.length === 0) {
      list.innerHTML = '<div class="text-xs text-muted py-4 text-center">No questions detected in the selected input.</div>';
      return;
    }

    list.innerHTML = this.previewQuestions.slice(0, 10).map((q, idx) => `
      <div class="import-preview-item tactile-card p-2 mb-2" style="border: 1px solid var(--tactile-stroke);">
        <div class="flex items-center justify-between">
          <span class="font-mono text-xs text-gold">Q${idx + 1} · ${escapeHtml(q.level || 'JLPT')} · ${escapeHtml(q.format_code || 'vocab')}</span>
        </div>
        <div class="font-japanese text-sm text-warm-paper mt-1">${escapeHtml(q.prompt || q.expression || '')}</div>
        ${q.choices ? `
          <div class="text-xs text-secondary mt-1">Choices: ${q.choices.map((c) => escapeHtml(c)).join(' | ')}</div>
        ` : ''}
      </div>
    `).join('') + (this.previewQuestions.length > 10 ? `<div class="text-xs text-muted text-center">+${this.previewQuestions.length - 10} more questions</div>` : '');
  }

  async handleCommitImport() {
    if (!this.previewId) {
      this.setStatus('No active preview to commit.', 'error');
      return;
    }

    this.setStatus('Committing questions to Study Bank...', 'info');
    const btnCommit = this.container.querySelector('#btn-commit-import');
    if (btnCommit) btnCommit.disabled = true;

    try {
      const result = await studyClient.commitImport({
        preview_id: this.previewId,
        approved: true
      });

      const count = result.imported_count || result.count || this.previewQuestions.length;
      const dupes = result.duplicate_count || 0;
      this.setStatus(`Successfully imported ${count} question(s) into your Study Bank (${dupes} duplicates skipped).`, 'success');

      // Clear preview
      this.previewId = null;
      this.previewQuestions = [];
      const stage = this.container.querySelector('#import-preview-stage');
      if (stage) stage.style.display = 'none';

      // Dispatch event to refresh bank summary
      window.dispatchEvent(new CustomEvent('kiroku:study-bank-updated'));
    } catch (err) {
      this.setStatus(`Failed to commit import: ${err.message}`, 'error');
    } finally {
      if (btnCommit) btnCommit.disabled = false;
    }
  }

  setStatus(msg, type = 'info') {
    this.statusMessage = msg;
    this.statusType = type;
    const banner = this.container?.querySelector('.import-status-banner');
    if (banner) {
      banner.textContent = msg;
      banner.className = `import-status-banner ${type === 'error' ? 'text-red' : (type === 'success' ? 'text-green' : 'text-gold')} text-xs font-sans p-2 mb-3 tactile-card`;
    } else {
      this.render();
      this.setupEvents();
    }
  }
}

export function renderStudyImport(container, options = {}) {
  const controller = new StudyImportController();
  controller.mount(container);
  return controller;
}
