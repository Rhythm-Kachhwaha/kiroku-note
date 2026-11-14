/**
 * Kiroku Note Desktop — Study Import & PDF Ingestion Component (Slice 22 & Section 6 Overhaul)
 *
 * Provides drop zone for PDF uploads, pasted text, and JSON question sets.
 * Multi-page PDF flow:
 * 1. Inspect upload -> displays page list with plain-text route labels
 *    (e.g., text, ruby, table; image-only pages marked "needs OCR - not available").
 * 2. Page selection checkboxes (select text pages to convert).
 * 3. AI Question Generator: Creates copyable, strictly-typed prompts for ChatGPT/Claude
 *    to generate valid JLPT question banks matching backend schemas.
 * 4. JSON schema validator with canonical example loader and quarantine controls.
 * 5. Paginated preview with status pills (valid vs invalid) and batch commit.
 */

import { studyClient } from '../services/study_client.js';
import { escapeHtml } from '../utils/sanitizer.js';

export class StudyImportController {
  constructor() {
    this.container = null;
    this.activeMode = 'pdf'; // 'pdf' | 'paste' | 'json' | 'ai_prompt'
    this.stagedImportId = null;
    this.pdfPages = [];
    this.selectedPages = new Set();
    this.previewId = null;
    this.previewQuestions = [];
    this.isLoading = false;
    this.statusMessage = null;
    this.statusType = 'info'; // 'info' | 'error' | 'success'

    // AI Prompt Generator state
    this.aiPromptLevel = 'N4';
    this.aiPromptArea = 'grammar';
    this.aiPromptFormat = 'Sentence Fill (Particle / Form)';

    // Pagination state
    this.previewPage = 1;
    this.previewPageSize = 20;
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
        <div class="study-import-header mb-4">
          <div class="import-mode-pills" role="radiogroup" aria-label="Import format">
            <button type="button" class="tactile-pill import-mode-pill ${this.activeMode === 'pdf' ? 'is-active' : ''}" data-mode="pdf">PDF Upload</button>
            <button type="button" class="tactile-pill import-mode-pill ${this.activeMode === 'paste' ? 'is-active' : ''}" data-mode="paste">Paste Text</button>
            <button type="button" class="tactile-pill import-mode-pill ${this.activeMode === 'json' ? 'is-active' : ''}" data-mode="json">JSON Set</button>
            <button type="button" class="tactile-pill import-mode-pill ${this.activeMode === 'ai_prompt' ? 'is-active' : ''}" data-mode="ai_prompt">AI Prompt Generator</button>
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
            <div id="pdf-summary-banner" class="text-xs font-sans mb-2 font-mono text-secondary"></div>
            <div id="pdf-vertical-warning" class="text-xs font-sans p-2 mb-3 tactile-card text-gold" style="display: none; border-left: 3px solid var(--gold);"></div>
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
          <textarea id="paste-input" class="tactile-input w-full font-japanese text-sm" rows="6" placeholder="Paste JLPT questions, grammar drills, or passages here..."></textarea>
          <div class="mt-2 flex justify-end">
            <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-preview-paste">Preview Questions</button>
          </div>
        </div>

        <!-- Mode 3: JSON Set -->
        <div id="import-mode-json" class="import-mode-pane" ${this.activeMode === 'json' ? '' : 'hidden'}>
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-muted font-mono">Format: Array of JLPT question objects</span>
            <button type="button" class="tactile-btn tactile-btn-sm" id="btn-load-example-json">Load Example Schema</button>
          </div>
          <textarea id="json-input" class="tactile-input w-full font-mono text-xs" rows="8" placeholder='[
  {
    "level": "N4",
    "format_code": "grammar",
    "prompt": "これは＿＿＿です。",
    "choices": ["ほん", "ペン", "いす", "つくえ"],
    "canonical_choice": "ほん",
    "explanation": "文脈に合う語を選びます。"
  }
]'></textarea>
          <div class="mt-2 flex justify-end">
            <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-preview-json">Preview &amp; Validate JSON</button>
          </div>
        </div>

        <!-- Mode 4: AI Prompt Generator -->
        <div id="import-mode-ai_prompt" class="import-mode-pane" ${this.activeMode === 'ai_prompt' ? '' : 'hidden'}>
          <div class="tactile-card surface-pitch-black p-4 mb-3 border border-ink">
            <div class="flex items-center justify-between mb-2">
              <span class="font-mono text-xs text-gold uppercase tracking-wider">AI Question Generator</span>
              <span class="text-xs text-muted font-mono">Claude / ChatGPT Prompt</span>
            </div>
            <p class="text-secondary text-xs mb-3">
              Configure parameters to generate a strictly-typed prompt. Copy and paste into an LLM, then paste the resulting JSON back into the JSON Set tab.
            </p>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div>
                <label class="text-xs font-mono text-muted uppercase block mb-1">Target JLPT Level</label>
                <select class="tactile-input w-full" id="ai-prompt-level">
                  ${['N5', 'N4', 'N3', 'N2', 'N1'].map(lvl => `<option value="${lvl}" ${lvl === this.aiPromptLevel ? 'selected' : ''}>${lvl}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="text-xs font-mono text-muted uppercase block mb-1">Area</label>
                <select class="tactile-input w-full" id="ai-prompt-area">
                  <option value="grammar" ${this.aiPromptArea === 'grammar' ? 'selected' : ''}>Grammar (文法)</option>
                  <option value="vocab" ${this.aiPromptArea === 'vocab' ? 'selected' : ''}>Vocabulary (文字・語彙)</option>
                  <option value="reading" ${this.aiPromptArea === 'reading' ? 'selected' : ''}>Reading (読解)</option>
                  <option value="kanji" ${this.aiPromptArea === 'kanji' ? 'selected' : ''}>Kanji Reading (漢字読み)</option>
                </select>
              </div>
              <div>
                <label class="text-xs font-mono text-muted uppercase block mb-1">Format / Drill Type</label>
                <select class="tactile-input w-full" id="ai-prompt-format">
                  <option value="Sentence Fill (Particles & Forms)">Sentence Fill (Particles &amp; Forms)</option>
                  <option value="Contextual MCQ">Contextual MCQ</option>
                  <option value="Paraphrase & Synonym">Paraphrase &amp; Synonym</option>
                  <option value="Sentence Composition (Star Puzzle)">Sentence Composition (Star Puzzle)</option>
                </select>
              </div>
            </div>

            <label class="text-xs font-mono text-muted uppercase block mb-1">Generated System &amp; Task Prompt:</label>
            <textarea id="ai-generated-prompt" class="tactile-input w-full font-mono text-xs mb-3" rows="6" readonly></textarea>

            <div class="flex items-center justify-between">
              <span class="text-xs text-gold font-mono" id="ai-prompt-status"></span>
              <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-copy-ai-prompt">
                Copy LLM Prompt
              </button>
            </div>
          </div>
        </div>

        <!-- Question Preview & Commit Stage -->
        <div id="import-preview-stage" class="mt-4 pt-3 border-t border-ink" style="display: none;">
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h4 class="font-sans font-bold text-sm text-warm-paper">Question Preview &amp; Validation</h4>
              <span class="text-xs text-muted font-mono" id="preview-count-label">0 questions ready</span>
            </div>
            <div class="flex gap-2">
              <button type="button" class="tactile-btn tactile-btn-sm text-red" id="btn-quarantine-invalid">
                Quarantine Invalid
              </button>
              <button type="button" class="tactile-btn tactile-btn-sm tactile-btn-primary" id="btn-commit-import">
                Commit to Bank
              </button>
            </div>
          </div>

          <!-- Paginated Preview Table / List -->
          <div class="import-preview-list" id="import-preview-list"></div>

          <!-- Pagination Controls -->
          <div class="flex items-center justify-between mt-3 pt-2 border-t border-ink text-xs font-mono" id="preview-pagination-bar">
            <span class="text-muted" id="preview-page-info">Page 1 of 1</span>
            <div class="flex gap-2">
              <button type="button" class="tactile-btn tactile-btn-sm" id="btn-preview-prev">Previous</button>
              <button type="button" class="tactile-btn tactile-btn-sm" id="btn-preview-next">Next</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.updateGeneratedAiPrompt();
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
          if (this.isPageReadable(p)) {
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

    // Example JSON schema button
    const btnExampleJson = this.container.querySelector('#btn-load-example-json');
    if (btnExampleJson) {
      btnExampleJson.addEventListener('click', () => {
        const jsonArea = this.container.querySelector('#json-input');
        if (jsonArea) {
          jsonArea.value = JSON.stringify([
            {
              level: 'N4',
              format_code: 'grammar',
              prompt: 'あしたは 雨が ＿＿＿でしょう。',
              choices: ['ふる', 'ふって', 'ふった', 'ふり'],
              canonical_choice: 'ふる',
              explanation: '「でしょう」の前には動詞の普通形（辞書形）が接続します。'
            },
            {
              level: 'N4',
              format_code: 'vocab',
              prompt: 'この 漢字の ＿＿＿を 教えてください。',
              choices: ['いみ', 'わけ', 'こと', 'もの'],
              canonical_choice: 'いみ',
              explanation: '言葉や漢字の持っている内容・意義を尋ねるときは「意味（いみ）」を用います。'
            }
          ], null, 2);
        }
      });
    }

    // AI Prompt Generator controls
    const levelSelect = this.container.querySelector('#ai-prompt-level');
    const areaSelect = this.container.querySelector('#ai-prompt-area');
    const formatSelect = this.container.querySelector('#ai-prompt-format');
    const btnCopyPrompt = this.container.querySelector('#btn-copy-ai-prompt');

    const onAiChange = () => {
      if (levelSelect) this.aiPromptLevel = levelSelect.value;
      if (areaSelect) this.aiPromptArea = areaSelect.value;
      if (formatSelect) this.aiPromptFormat = formatSelect.value;
      this.updateGeneratedAiPrompt();
    };

    levelSelect?.addEventListener('change', onAiChange);
    areaSelect?.addEventListener('change', onAiChange);
    formatSelect?.addEventListener('change', onAiChange);

    btnCopyPrompt?.addEventListener('click', () => {
      const promptEl = this.container.querySelector('#ai-generated-prompt');
      const statusEl = this.container.querySelector('#ai-prompt-status');
      if (promptEl) {
        navigator.clipboard?.writeText(promptEl.value).then(() => {
          if (statusEl) statusEl.textContent = 'Prompt copied to clipboard!';
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
        }).catch(() => {
          promptEl.select();
          document.execCommand('copy');
          if (statusEl) statusEl.textContent = 'Prompt copied!';
        });
      }
    });

    // Commit import button
    const btnCommit = this.container.querySelector('#btn-commit-import');
    if (btnCommit) {
      btnCommit.addEventListener('click', () => this.handleCommitImport());
    }

    // Quarantine button
    const btnQuarantine = this.container.querySelector('#btn-quarantine-invalid');
    if (btnQuarantine) {
      btnQuarantine.addEventListener('click', () => this.handleQuarantineInvalid());
    }

    // Pagination buttons
    const btnPrev = this.container.querySelector('#btn-preview-prev');
    const btnNext = this.container.querySelector('#btn-preview-next');
    btnPrev?.addEventListener('click', () => {
      if (this.previewPage > 1) {
        this.previewPage -= 1;
        this.renderPreviewStage();
      }
    });
    btnNext?.addEventListener('click', () => {
      const maxPage = Math.max(1, Math.ceil(this.previewQuestions.length / this.previewPageSize));
      if (this.previewPage < maxPage) {
        this.previewPage += 1;
        this.renderPreviewStage();
      }
    });
  }

  updateGeneratedAiPrompt() {
    const promptEl = this.container?.querySelector('#ai-generated-prompt');
    if (!promptEl) return;

    promptEl.value = `You are a professional JLPT test question designer.
Generate 10 official-style ${this.aiPromptLevel} questions for the ${this.aiPromptArea} section (${this.aiPromptFormat}).
Return ONLY a valid JSON array matching this exact schema:

[
  {
    "level": "${this.aiPromptLevel}",
    "format_code": "${this.aiPromptArea}",
    "prompt": "Japanese sentence with ＿＿＿ blank or underline",
    "choices": ["Choice 1", "Choice 2", "Choice 3", "Choice 4"],
    "canonical_choice": "Exact match to one choice above",
    "explanation": "Brief explanation in Japanese or English detailing why the canonical choice is correct and others incorrect."
  }
]

Requirements:
- Level accuracy: strictly strictly adhere to JLPT ${this.aiPromptLevel} vocabulary and grammar constraints.
- Exactly 4 unique choices for each item.
- Provide clear, pedagogical explanations.
- Output ONLY the raw JSON array without markdown backticks or commentary.`;
  }

  isPageReadable(p) {
    if (!p) return false;
    if (p.has_text === false) return false;
    if (p.route === 'image_only' || p.route === 'garbled_text_layer' || p.route === 'poor_text_layer') return false;
    if (p.skipped_ocr) return false;
    return true;
  }

  getPageSkipReason(p) {
    if (!p) return 'unknown';
    if (p.route === 'image_only') return 'image-only';
    if (p.route === 'garbled_text_layer') return 'garbled';
    if (p.route === 'poor_text_layer') return 'no text';
    return p.route || 'unreadable';
  }

  getPageBadge(p) {
    if (!this.isPageReadable(p)) {
      const reason = this.getPageSkipReason(p);
      return { label: `skipped (${reason})`, className: 'text-red' };
    }
    if (p.flags && p.flags.includes('non_japanese')) {
      return { label: 'flagged (non-Japanese)', className: 'text-gold' };
    }
    if (p.flags && p.flags.includes('ocr_requested_unavailable')) {
      return { label: 'flagged (OCR unavailable)', className: 'text-gold' };
    }
    if ((p.flags && p.flags.includes('vertical_text_suspected')) || p.vertical_text_suspected) {
      return { label: 'vertical', className: 'text-gold' };
    }
    if (p.route === 'short_text') {
      return { label: 'short', className: 'text-secondary' };
    }
    return { label: 'text', className: 'text-muted' };
  }

  async handleFileSelected(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      this.setStatus('Please select a valid PDF file (.pdf).', 'error');
      return;
    }

    if (file.size && file.size > 25 * 1024 * 1024) {
      this.setStatus('File exceeds the maximum limit of 25MB. Please upload a smaller PDF.', 'error');
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

      // Automatically select only readable text pages by default
      this.pdfPages.forEach((p) => {
        if (this.isPageReadable(p)) {
          this.selectedPages.add(p.page_number);
        }
      });

      this.setStatus(`Staged "${file.name}" (${this.pdfPages.length} pages).`, 'success');
      const pagesSec = this.container.querySelector('#pdf-pages-section');
      if (pagesSec) pagesSec.style.display = 'block';
      this.renderPageList();
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('maximum page count') || msg.includes('200')) {
        this.setStatus('PDF exceeds the maximum limit of 200 pages. Please split your document.', 'error');
      } else if (msg.includes('maximum upload size') || msg.includes('25MB')) {
        this.setStatus('File exceeds the maximum limit of 25MB. Please upload a smaller PDF.', 'error');
      } else if (msg.includes('PDF_EXTRACTION_FAILED') || msg.includes('extract PDF text') || msg.includes('EXTRACTION_FAILED')) {
        this.setStatus('Unable to extract text from this PDF. The document may be damaged, encrypted, or contain unsupported font encoding.', 'error');
      } else {
        this.setStatus(`Failed to inspect PDF: ${msg}`, 'error');
      }
    }
  }

  renderPageList() {
    const grid = this.container.querySelector('#pdf-pages-grid');
    if (!grid) return;

    if (this.pdfPages.length === 0) {
      grid.innerHTML = '<span class="text-xs text-muted">No pages detected.</span>';
      return;
    }

    const summaryEl = this.container.querySelector('#pdf-summary-banner');
    const warningEl = this.container.querySelector('#pdf-vertical-warning');

    const readable = this.pdfPages.filter((p) => this.isPageReadable(p));
    const skipped = this.pdfPages.filter((p) => !this.isPageReadable(p));

    if (summaryEl) {
      if (skipped.length > 0) {
        const counts = {};
        skipped.forEach((p) => {
          const r = this.getPageSkipReason(p);
          counts[r] = (counts[r] || 0) + 1;
        });
        const breakdown = Object.entries(counts).map(([r, c]) => `${r}: ${c}`).join(', ');
        summaryEl.textContent = `${readable.length} page${readable.length === 1 ? '' : 's'} readable, ${skipped.length} skipped (${breakdown})`;
      } else {
        summaryEl.textContent = `${readable.length} page${readable.length === 1 ? '' : 's'} readable, 0 skipped`;
      }
    }

    if (warningEl) {
      const verticalPages = this.pdfPages
        .filter((p) => (p.flags && p.flags.includes('vertical_text_suspected')) || p.vertical_text_suspected)
        .map((p) => p.page_number);
      if (verticalPages.length > 0) {
        warningEl.style.display = 'block';
        warningEl.textContent = `Vertical text detected on page ${verticalPages.join(', ')}. Japanese vertical layout extraction may have incomplete reading order.`;
      } else {
        warningEl.style.display = 'none';
      }
    }

    grid.innerHTML = this.pdfPages.map((p) => {
      const readable = this.isPageReadable(p);
      const badge = this.getPageBadge(p);
      const isChecked = this.selectedPages.has(p.page_number);
      const charCount = p.text_char_count || p.char_count || 0;

      return `
        <label class="pdf-page-chip tactile-card ${!readable ? 'is-disabled' : ''} ${isChecked ? 'is-selected' : ''}" style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; margin-bottom: 0.35rem; cursor: ${!readable ? 'not-allowed' : 'pointer'};">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <input
              type="checkbox"
              class="page-select-checkbox"
              data-page="${p.page_number}"
              ${isChecked ? 'checked' : ''}
              ${!readable ? 'disabled' : ''}
            />
            <span class="font-mono text-xs font-bold text-warm-paper">Page ${p.page_number}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span class="route-badge text-xs ${badge.className} font-sans font-bold">${escapeHtml(badge.label)}</span>
            <span class="text-xs text-muted font-mono">${charCount} chars</span>
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
      this.previewPage = 1;
      this.setStatus(`Extracted ${this.previewQuestions.length} questions from PDF.`, 'success');
      this.renderPreviewStage();
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('IMPORT_EXPIRED') || msg.includes('expired')) {
        this.setStatus('This import session has expired. Please re-upload your PDF to continue.', 'error');
      } else if (msg.includes('PDF_EXTRACTION_FAILED') || msg.includes('extract PDF text') || msg.includes('EXTRACTION_FAILED')) {
        this.setStatus('Unable to extract text from this PDF. The document may be damaged, encrypted, or contain unsupported font encoding.', 'error');
      } else {
        this.setStatus(`PDF Preview failed: ${msg}`, 'error');
      }
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
      this.previewPage = 1;
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
      this.previewPage = 1;
      this.setStatus(`Validated ${this.previewQuestions.length} questions from JSON.`, 'success');
      this.renderPreviewStage();
    } catch (err) {
      this.setStatus(`JSON preview failed: ${err.message}`, 'error');
    }
  }

  validateQuestionItem(q) {
    const errors = [];
    if (!q) {
      return { isValid: false, reason: 'Empty question object' };
    }
    const prompt = q.prompt || q.prompt_markup || q.expression || q.stem;
    if (!prompt) {
      errors.push('Missing prompt/stem');
    }
    const choices = q.choices;
    if (!Array.isArray(choices) || choices.length < 2) {
      errors.push('Requires at least 2 choices');
    }
    return {
      isValid: errors.length === 0,
      reason: errors.join(', ')
    };
  }

  handleQuarantineInvalid() {
    const initialCount = this.previewQuestions.length;
    this.previewQuestions = this.previewQuestions.filter(q => this.validateQuestionItem(q).isValid);
    const removed = initialCount - this.previewQuestions.length;
    this.previewPage = 1;
    this.setStatus(`Quarantined ${removed} invalid question(s). ${this.previewQuestions.length} valid questions remain.`, 'info');
    this.renderPreviewStage();
  }

  renderPreviewStage() {
    const stage = this.container.querySelector('#import-preview-stage');
    const countLabel = this.container.querySelector('#preview-count-label');
    const list = this.container.querySelector('#import-preview-list');
    const pageInfo = this.container.querySelector('#preview-page-info');
    const btnPrev = this.container.querySelector('#btn-preview-prev');
    const btnNext = this.container.querySelector('#btn-preview-next');

    if (!stage || !list) return;

    stage.style.display = 'block';
    const total = this.previewQuestions.length;
    const maxPage = Math.max(1, Math.ceil(total / this.previewPageSize));
    this.previewPage = Math.min(Math.max(1, this.previewPage), maxPage);

    if (countLabel) countLabel.textContent = `${total} question${total === 1 ? '' : 's'} ready to commit`;
    if (pageInfo) pageInfo.textContent = `Page ${this.previewPage} of ${maxPage} (${total} total)`;
    if (btnPrev) btnPrev.disabled = this.previewPage <= 1;
    if (btnNext) btnNext.disabled = this.previewPage >= maxPage;

    if (total === 0) {
      list.innerHTML = '<div class="text-xs text-muted py-4 text-center">No questions detected in the selected input.</div>';
      return;
    }

    const startIdx = (this.previewPage - 1) * this.previewPageSize;
    const pageItems = this.previewQuestions.slice(startIdx, startIdx + this.previewPageSize);

    list.innerHTML = pageItems.map((q, idx) => {
      const overallIdx = startIdx + idx + 1;
      const validation = this.validateQuestionItem(q);
      const promptText = q.prompt || q.prompt_markup || q.expression || q.stem || '';
      const choices = Array.isArray(q.choices) ? q.choices : [];

      return `
        <div class="import-preview-item tactile-card p-3 mb-2" style="border: 1px solid var(--tactile-stroke);">
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-xs text-gold">Q${overallIdx} · ${escapeHtml(q.level || 'JLPT')} · ${escapeHtml(q.format_code || 'objective')}</span>
            <span class="text-xs font-mono font-bold ${validation.isValid ? 'text-green' : 'text-red'}">
              ${validation.isValid ? 'Valid' : `Invalid (${escapeHtml(validation.reason)})`}
            </span>
          </div>
          <div class="font-japanese text-sm text-warm-paper mt-1">${escapeHtml(promptText)}</div>
          ${choices.length > 0 ? `
            <div class="text-xs text-secondary mt-1">
              Choices: ${choices.map((c) => escapeHtml(typeof c === 'object' ? (c.text || c.choice_text || JSON.stringify(c)) : String(c))).join(' | ')}
            </div>
          ` : ''}
          ${q.explanation ? `
            <div class="text-xs text-muted mt-1 italic">${escapeHtml(q.explanation)}</div>
          ` : ''}
        </div>
      `;
    }).join('');
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
