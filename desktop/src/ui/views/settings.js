/**
 * Kiroku Note Desktop — Global Settings & Telemetry View Controller
 * Universal JLPT level curriculum, service integrations (AnkiConnect, Yomitan, OCR, LLM),
 * encrypted DPAPI keys, doctor diagnostics report, app data affordances, and backend supervisor controls.
 * Slice 24: Regrouped with Left Rail navigation, Language engine status card, and legacy Yomitan section.
 */

import { apiClient } from '../services/api_client.js';
import { studyClient } from '../services/study_client.js';
import { renderAssetSlot } from '../assets_map.js';
import { getUniversalJlptLevel, setUniversalJlptLevel } from '../utils/learner.js';
import { escapeHtml } from '../utils/sanitizer.js';
import { renderStudyImport } from './study_import.js';

export class SettingsView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.ocrRunning = false;
    this._scrollObserver = null;
  }

  async mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
    this.setupScrollspy();
    await this.loadInitialSettings();
  }

  render() {
    this.container.innerHTML = `
      <div class="settings-view-wrapper">
        <div class="settings-view-container">
          <!-- Page Header -->
          <div class="settings-header-row">
            <div>
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-gold-eye"></span>
                <span class="font-mono text-sm text-gold">Settings</span>
              </div>
              <h1 class="settings-title">Preferences &amp; System Health</h1>
              <p class="settings-subtitle">Manage study curriculum, connection endpoints, language engine, and system diagnostics.</p>
            </div>
          </div>

          <!-- Visible Error Banner -->
          <div class="settings-error-banner" id="settings-error-banner" style="display: none;">
            <span class="error-msg" id="settings-error-msg"></span>
            <button type="button" class="btn-dismiss-error" id="btn-dismiss-settings-error" aria-label="Dismiss error"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>
          </div>

          <!-- Two-column Regrouped Layout: Left Rail + Content Pane -->
          <div class="settings-layout mt-4">
            <!-- Left Rail Anchor Nav -->
            <nav class="settings-rail" id="settings-nav-rail" aria-label="Settings Sections">
              <span class="settings-rail-title">Navigation</span>
              <a href="#settings-section-level" class="settings-rail-link is-active" data-target="settings-section-level">
                <span>Level</span>
              </a>
              <a href="#settings-section-dictionary-anki" class="settings-rail-link" data-target="settings-section-dictionary-anki">
                <span>Dictionary &amp; Anki</span>
              </a>
              <a href="#settings-section-language-engine" class="settings-rail-link" data-target="settings-section-language-engine">
                <span>Language engine</span>
              </a>
              <a href="#settings-section-link" class="settings-rail-link" data-target="settings-section-link">
                <span>Link</span>
                <span class="rail-badge">Soon</span>
              </a>
              <a href="#settings-section-rewards" class="settings-rail-link" data-target="settings-section-rewards">
                <span>Rewards</span>
                <span class="rail-badge">Soon</span>
              </a>
              <a href="#settings-section-diagnostics" class="settings-rail-link" data-target="settings-section-diagnostics">
                <span>Diagnostics</span>
              </a>
            </nav>

            <!-- Right Content Pane -->
            <div class="settings-content-pane">
              <!-- Section 1: Level -->
              <section class="settings-section" id="settings-section-level">
                <div class="settings-group-header">
                  <span class="font-mono text-xs text-gold">Curriculum</span>
                  <h2 class="text-base font-bold text-warm-paper">Universal JLPT Study Level</h2>
                </div>
                <div class="settings-cards-grid mt-2">
                  <div class="settings-card tactile-card">
                    <div class="card-header-row">
                      <h3 class="card-title">Target JLPT Level</h3>
                    </div>
                    <p class="card-desc">
                      Sets your universal study level across all tabs (Vocabulary, Grammar, Kanji, Practice drills, and Exam simulations) so you don't have to select it repeatedly.
                    </p>
                    <div class="syllabus-controls-row mt-3">
                      <div class="syllabus-level-pills" id="settings-level-pills" role="radiogroup" aria-label="Universal JLPT Level">
                        <button type="button" class="tactile-pill learner-level-pill" data-level="N5">N5</button>
                        <button type="button" class="tactile-pill learner-level-pill" data-level="N4">N4</button>
                        <button type="button" class="tactile-pill learner-level-pill" data-level="N3">N3</button>
                        <button type="button" class="tactile-pill learner-level-pill" data-level="N2">N2</button>
                        <button type="button" class="tactile-pill learner-level-pill" data-level="N1">N1</button>
                      </div>
                    </div>
                    <p class="text-xs text-muted mt-2">
                      Note: Selecting a level sets your active study focus. It does not automatically mark prior grammar points or kanji as mastered; your progress honestly reflects your real study history.
                    </p>
                  </div>

                  <!-- Upload Questions Card (PDF & Questions Ingestion) -->
                  <div class="settings-card tactile-card" id="settings-upload-questions-card">
                    <div class="card-header-row">
                      <h3 class="card-title">Upload Questions</h3>
                    </div>
                    <p class="card-desc">
                      Upload mock test PDFs, pasted practice sentences, or JSON question sets to extract and preview questions directly into your Study Bank.
                    </p>
                    <div id="settings-upload-questions-mount" class="mt-3"></div>
                  </div>
                </div>
              </section>

              <!-- Section 2: Dictionary & Anki -->
              <section class="settings-section" id="settings-section-dictionary-anki">
                <div class="settings-group-header">
                  <span class="font-mono text-xs text-gold">Integrations</span>
                  <h2 class="text-base font-bold text-warm-paper">Dictionary &amp; Anki Integration</h2>
                </div>
                <div class="settings-cards-grid mt-2">
                  <!-- Kiroku Dictionary Card -->
                  <div class="settings-card tactile-card" id="card-kiroku-dictionary">
                    <div class="card-header-row">
                      <h3 class="card-title">Kiroku Dictionary</h3>
                      <span class="status-dot" id="dict-status-tag" data-state="checking" title="Checking..."></span>
                    </div>
                    <p class="card-desc">Local Japanese vocabulary (Jitendex) &amp; kanji (KANJIDIC) dictionary engine.</p>

                    <div class="mt-2 text-xs font-mono text-muted" id="dict-info-row">
                      <span id="dict-db-path-label">Database: checking...</span>
                    </div>

                    <!-- Progress container (hidden when idle) -->
                    <div class="mt-3" id="dict-provision-container" style="display: none;">
                      <div class="flex items-center justify-between text-xs font-mono mb-1">
                        <span id="dict-provision-label">Provisioning dictionary...</span>
                        <span id="dict-provision-pct">0%</span>
                      </div>
                      <div class="progress-bar-track">
                        <div class="progress-bar-fill" id="dict-provision-bar" style="width: 0%;"></div>
                      </div>
                    </div>

                    <div class="card-actions-row mt-3">
                      <button type="button" class="tactile-btn tactile-btn-primary" id="btn-provision-dict">Provision Dictionary</button>
                    </div>

                    <!-- Secondary Yomitan Toggle Placeholder (wired in slice 9) -->
                    <div class="mt-3 pt-3 border-t border-glass flex items-center justify-between">
                      <div>
                        <span class="text-xs font-medium text-warm-paper block">Yomitan Secondary Source</span>
                        <span class="text-xs text-muted block">Query Yomitan as fallback to enrich entries.</span>
                      </div>
                      <label class="toggle-switch">
                        <input type="checkbox" id="toggle-yomitan-secondary" />
                        <span class="toggle-slider"></span>
                      </label>
                    </div>

                    <!-- Attribution Text -->
                    <div class="mt-3 text-xs text-muted font-mono leading-relaxed">
                      Datasets licensed under CC BY-SA 4.0: Jitendex (&copy; Stephen Kraus, EDRDG, Tatoeba) &amp; KANJIDIC (&copy; EDRDG).
                    </div>
                  </div>

                  <!-- AnkiConnect Sync Card -->
                  <div class="settings-card tactile-card">
                    <div class="card-header-row">
                      <h3 class="card-title">AnkiConnect Sync</h3>
                      <span class="status-dot" id="anki-status-tag" data-state="checking" title="Checking..."></span>
                    </div>
                    <p class="card-desc">Direct local HTTP synchronization to Anki desktop client.</p>

                    <div class="form-field mt-3">
                      <label for="anki-url-input">AnkiConnect Endpoint URL</label>
                      <input type="text" id="anki-url-input" class="tactile-input font-mono text-sm" value="http://127.0.0.1:8765" />
                    </div>

                    <div class="form-field mt-3">
                      <label for="select-settings-deck">Target Mining Deck</label>
                      <select id="select-settings-deck" class="tactile-input font-mono text-sm">
                        <option value="">(Checking available Anki decks...)</option>
                      </select>
                    </div>

                    <div class="card-actions-row mt-3">
                      <button type="button" class="tactile-btn tactile-btn-primary" id="btn-test-anki">Test Connection</button>
                    </div>
                  </div>
                </div>

                <!-- Collapsed Legacy dictionary provider at bottom of Dictionary & Anki -->
                <details class="settings-legacy-details mt-3" id="settings-legacy-yomitan-details">
                  <summary>
                    <div class="flex items-center gap-2">
                      <span class="font-mono text-xs text-muted uppercase">Legacy dictionary provider</span>
                      <span class="status-dot" id="yomitan-status-tag" data-state="checking" title="Checking..."></span>
                    </div>
                    <span class="text-xs text-muted font-mono">Show / Hide</span>
                  </summary>
                  <div class="settings-legacy-content">
                    <div class="card-header-row">
                      <h4 class="card-title text-sm">Yomitan Provider (Deprecated)</h4>
                    </div>
                    <p class="card-desc text-xs">Local Yomitan dictionary server integration for fast bilingual definition lookup. Kiroku Note now prioritizes local offline dictionaries.</p>
                    <div class="mt-2">
                      <span class="font-mono text-xs text-muted">Endpoint: loopback /api/yomitan/dictionaries</span>
                    </div>
                  </div>
                </details>
              </section>

              <!-- Section 3: Language engine -->
              <section class="settings-section" id="settings-section-language-engine">
                <div class="settings-group-header">
                  <span class="font-mono text-xs text-gold">Engine</span>
                  <h2 class="text-base font-bold text-warm-paper">Language Engine</h2>
                </div>
                <div class="settings-cards-grid mt-2">
                  <div class="settings-card tactile-card" id="settings-language-engine-card">
                    <div class="card-header-row">
                      <h3 class="card-title">Japanese Language Engine</h3>
                      <span class="status-dot" id="tokenizer-status-tag" data-state="checking" title="Checking..."></span>
                    </div>
                    <p class="card-desc">Morphological tokenization and part-of-speech segmentation powering subtitle sync and grammar analysis.</p>

                    <div class="form-row-pair mt-3">
                      <div class="form-field">
                        <label for="select-tokenizer-mode">Tokenizer Mode</label>
                        <select id="select-tokenizer-mode" class="tactile-input font-mono text-sm">
                          <option value="auto">Automatic (Recommended)</option>
                          <option value="sudachi">SudachiPy (Deep Morphological)</option>
                          <option value="legacy">Legacy Heuristic / Regex</option>
                        </select>
                      </div>
                      <div class="form-field">
                        <label>Lexicon Dictionary</label>
                        <div class="tactile-card p-2 flex items-center justify-between" style="background-color: var(--surface-container-low); height: 38px;">
                          <span class="font-mono text-xs text-warm-paper" id="tokenizer-dict-display">Dictionary: Core</span>
                          <span class="status-dot" id="tokenizer-dict-dot" data-state="ready" title="Dictionary active"></span>
                        </div>
                      </div>
                    </div>

                    <div class="mt-3 flex items-center justify-between p-3 tactile-card" style="background-color: var(--surface-container-low);">
                      <div>
                        <span class="font-mono text-xs text-muted block uppercase">Engine State</span>
                        <span class="font-mono text-sm text-warm-paper" id="tokenizer-ready-label">Checking runtime status...</span>
                      </div>
                      <button type="button" class="tactile-btn tactile-btn-sm" id="btn-probe-tokenizer">Verify Engine</button>
                    </div>
                  </div>
                </div>
              </section>

              <!-- Section 4: Link (Coming empty) -->
              <section class="settings-section" id="settings-section-link">
                <div class="settings-group-header">
                  <span class="font-mono text-xs text-gold">Companion Sync</span>
                  <h2 class="text-base font-bold text-warm-paper">Kiroku Link</h2>
                </div>
                <div class="settings-cards-grid mt-2">
                  <div class="settings-card tactile-card">
                    <div class="card-header-row">
                      <h3 class="card-title">Browser Link Companion</h3>
                      <span class="tactile-pill text-xs font-mono px-2 py-0.5 text-muted">Coming in Slice 38</span>
                    </div>
                    <p class="card-desc">
                      Bi-directional companion bridge connecting Chrome/Chromium video players directly to Kiroku Note desktop.
                    </p>
                    <div class="p-4 mt-3 rounded border border-tactile text-center bg-surface-lowest">
                      <span class="font-mono text-xs text-muted">Link companion integration will be unlocked in Slice 38.</span>
                    </div>
                  </div>

                  <!-- Global Hotkeys Card (Slice 45) -->
                  <div class="settings-card tactile-card" id="settings-hotkeys-card">
                    <div class="card-header-row">
                      <h3 class="card-title">Global Hotkeys</h3>
                      <span class="tactile-pill text-xs font-mono px-2 py-0.5 text-muted">Default: Off</span>
                    </div>
                    <p class="card-desc">
                      Optional global shortcut map sending commands to video players (Link companion and Theater): pause/play, prev/next cue, replay cue, loop.
                    </p>
                    <div class="settings-form-row mt-3">
                      <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" id="setting-global-hotkeys-enabled" class="tactile-checkbox" />
                        <span class="text-sm text-warm-paper">Enable global playback shortcuts</span>
                      </label>
                    </div>
                    <div class="hotkeys-table-wrapper mt-3 p-3 rounded border border-tactile bg-surface-lowest">
                      <table class="w-full text-xs font-mono text-muted">
                        <tbody>
                          <tr class="border-b border-tactile"><td class="py-1 text-warm-paper">Pause / Play</td><td class="text-right">CmdOrCtrl+Alt+Space</td></tr>
                          <tr class="border-b border-tactile"><td class="py-1 text-warm-paper">Previous Cue</td><td class="text-right">CmdOrCtrl+Alt+Left</td></tr>
                          <tr class="border-b border-tactile"><td class="py-1 text-warm-paper">Next Cue</td><td class="text-right">CmdOrCtrl+Alt+Right</td></tr>
                          <tr class="border-b border-tactile"><td class="py-1 text-warm-paper">Replay Cue</td><td class="text-right">CmdOrCtrl+Alt+R</td></tr>
                          <tr><td class="py-1 text-warm-paper">Loop Cue</td><td class="text-right">CmdOrCtrl+Alt+L</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <!-- Study-Pause Card (Slice 45) -->
                  <div class="settings-card tactile-card" id="settings-study-pause-card">
                    <div class="card-header-row">
                      <h3 class="card-title">Study-Pause</h3>
                      <span class="tactile-pill text-xs font-mono px-2 py-0.5 text-muted">Default: Off</span>
                    </div>
                    <p class="card-desc">
                      Automatically pauses playback when a line has multiple unknown gap words so you can inspect furigana or mine without missing dialogue.
                    </p>
                    <div class="settings-form-row mt-3 flex items-center justify-between gap-4">
                      <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" id="setting-study-pause-enabled" class="tactile-checkbox" />
                        <span class="text-sm text-warm-paper">Pause when line has &gt;= N gap words</span>
                      </label>
                      <div class="flex items-center gap-2">
                        <label for="setting-study-pause-threshold" class="text-xs text-muted">N =</label>
                        <select id="setting-study-pause-threshold" class="tactile-input font-mono text-xs w-16">
                          <option value="1">1</option>
                          <option value="2" selected>2</option>
                          <option value="3">3</option>
                          <option value="4">4</option>
                          <option value="5">5</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <!-- Section 5: Rewards (Coming empty) -->
              <section class="settings-section" id="settings-section-rewards">
                <div class="settings-group-header">
                  <span class="font-mono text-xs text-gold">Gamification &amp; Records</span>
                  <h2 class="text-base font-bold text-warm-paper">Study Rewards &amp; Stamps</h2>
                </div>
                <div class="settings-cards-grid mt-2">
                  <div class="settings-card tactile-card">
                    <div class="card-header-row">
                      <h3 class="card-title">Ink &amp; Stamp Ledger</h3>
                      <span class="tactile-pill text-xs font-mono px-2 py-0.5 text-muted">Coming in Slice 33</span>
                    </div>
                    <p class="card-desc">
                      Effort-based ink ledger, adaptive daily ritual quests, and non-punitive stamp collection book.
                    </p>
                    <div class="p-4 mt-3 rounded border border-tactile text-center bg-surface-lowest">
                      <span class="font-mono text-xs text-muted">Gamification and rewards ledger will be unlocked in Slice 33.</span>
                    </div>
                  </div>
                </div>
              </section>

              <!-- Section 6: Diagnostics -->
              <section class="settings-section" id="settings-section-diagnostics">
                <div class="settings-group-header">
                  <span class="font-mono text-xs text-gold">Diagnostics &amp; System</span>
                  <h2 class="text-base font-bold text-warm-paper">Database Diagnostics &amp; Process Lifecycle</h2>
                </div>
                <div class="settings-cards-grid mt-2">
                  <!-- Manga-OCR Daemon -->
                  <div class="settings-card tactile-card">
                    <div class="card-header-row">
                      <h3 class="card-title">Manga-OCR Daemon</h3>
                      <span class="status-dot" id="ocr-status-tag" data-state="stopped" title="Stopped"></span>
                    </div>
                    <p class="card-desc">Isolated, optional CPU-only manga-ocr background server on loopback port 21829.</p>

                    <div class="card-actions-row mt-3">
                      <button type="button" class="tactile-btn" id="btn-toggle-ocr">Start OCR Server</button>
                    </div>
                  </div>

                  <!-- AI Explanation Provider -->
                  <div class="settings-card tactile-card">
                    <div class="card-header-row">
                      <h3 class="card-title">AI Explanation Provider</h3>
                      <span class="status-dot" id="llm-status-tag" data-state="ready" title="Key Protected"></span>
                    </div>
                    <p class="card-desc">Generates nuanced pedagogical grammar explanations and disambiguation advice.</p>

                    <div class="form-row-pair mt-3">
                      <div class="form-field">
                        <label for="llm-provider-select">Provider</label>
                        <select id="llm-provider-select" class="tactile-input">
                          <option value="none">None (Offline Pure Rule-Based)</option>
                          <option value="groq">Groq (Ultra-Fast Llama-3)</option>
                          <option value="gemini">Google Gemini</option>
                          <option value="ollama">Ollama (Local Offline)</option>
                        </select>
                      </div>
                      <div class="form-field">
                        <label for="llm-model-input">Model Name</label>
                        <input type="text" id="llm-model-input" class="tactile-input font-mono text-sm" placeholder="e.g. llama-3.3-70b-versatile" />
                      </div>
                    </div>

                    <div class="form-field mt-3">
                      <label for="llm-key-input">API Key (Protected by Windows DPAPI)</label>
                      <div style="position: relative; display: flex; align-items: center;">
                        <input type="password" id="llm-key-input" class="tactile-input font-mono text-sm" style="padding-right: 2.2rem; width: 100%;" placeholder="Enter API key to update..." />
                        <button type="button" class="btn-toggle-key-visibility" id="btn-toggle-key-visibility" title="Toggle visibility" aria-label="Toggle key visibility" style="position: absolute; right: 8px; background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; display: flex; align-items: center;">
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div class="card-actions-row mt-3">
                      <button type="button" class="tactile-btn tactile-btn-primary" id="btn-save-llm">Save Settings</button>
                      <button type="button" class="tactile-btn" id="btn-test-llm">Test LLM Connection</button>
                    </div>

                    <div class="llm-test-result-box mt-3" id="llm-test-result" style="display: none;">
                      <span class="font-mono text-xs text-muted" id="llm-test-output"></span>
                    </div>
                  </div>

                  <!-- System Doctor Diagnostics -->
                  <div class="settings-card tactile-card">
                    <div class="card-header-row">
                      <h3 class="card-title">System Doctor Diagnostics</h3>
                      <span class="status-dot" data-state="ready" title="Read-Only"></span>
                    </div>
                    <p class="card-desc">Non-mutating verification of SQLite database integrity, sealed triggers, and media assets.</p>

                    <div class="doctor-summary-box mt-3" id="doctor-summary" style="display: none;">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="tactile-pill tactile-pill-gold" id="doctor-status-badge">Integrity Verified</span>
                        <span class="font-mono text-xs text-secondary" id="doctor-db-path">--</span>
                      </div>
                    </div>

                    <div class="doctor-results-box mt-2" id="doctor-results" style="display: none;">
                      <pre class="doctor-pre font-mono text-xs" id="doctor-output"></pre>
                    </div>

                    <div class="card-actions-row mt-3">
                      <button type="button" class="tactile-btn tactile-btn-primary" id="btn-run-doctor">Run Doctor Check</button>
                      <button type="button" class="tactile-btn" id="btn-open-appdata">Open App Data</button>
                    </div>
                  </div>

                  <!-- Backend Process Supervisor -->
                  <div class="settings-card tactile-card">
                    <div class="card-header-row">
                      <h3 class="card-title">FastAPI Backend Service</h3>
                      <span class="status-dot" data-state="ready" title="Supervisor Managed"></span>
                    </div>
                    <p class="card-desc">Local desktop process supervisor maintaining kiroku.db, SQLite WAL transactions, and port bindings.</p>

                    <div class="card-actions-row mt-3">
                      <button type="button" class="tactile-btn" id="btn-restart-backend">Restart Backend Service</button>
                    </div>
                  </div>

                  <!-- Hardware Acceleration (GPU) -->
                  <div class="settings-card tactile-card" id="card-hardware-acceleration">
                    <div class="card-header-row">
                      <h3 class="card-title">Hardware Acceleration</h3>
                      <span class="status-dot" id="gpu-status-dot" data-state="ready" title="Graphics Pipeline"></span>
                    </div>
                    <p class="card-desc">Toggles GPU rasterization. Disable if experiencing blank windows or black screen captures when streaming DRM video.</p>
                    <div class="flex items-center justify-between mt-3">
                      <label class="tactile-toggle-label flex items-center gap-2 cursor-pointer" for="toggle-hardware-acceleration">
                        <input type="checkbox" id="toggle-hardware-acceleration" class="tactile-checkbox" checked />
                        <span class="text-sm font-medium text-warm-paper">Enable GPU Hardware Acceleration</span>
                      </label>
                      <button type="button" class="tactile-btn tactile-btn-primary" id="btn-restart-app" style="display: none;">Restart App</button>
                    </div>
                    <div class="mt-2 text-xs text-secondary" id="gpu-restart-notice" style="display: none;">
                      Restart required for graphics acceleration changes to take effect.
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  showError(message) {
    const banner = document.getElementById('settings-error-banner');
    const msg = document.getElementById('settings-error-msg');
    if (banner && msg) {
      msg.textContent = message;
      banner.style.display = 'flex';
    }
  }

  clearError() {
    const banner = document.getElementById('settings-error-banner');
    if (banner) {
      banner.style.display = 'none';
    }
  }

  setupScrollspy() {
    const railLinks = this.container.querySelectorAll('.settings-rail-link');
    const sections = this.container.querySelectorAll('.settings-section');

    railLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('data-target');
        const targetSection = document.getElementById(targetId);
        if (targetSection) {
          targetSection.scrollIntoView({ behavior: 'smooth' });
          railLinks.forEach(l => l.classList.remove('is-active'));
          link.classList.add('is-active');
        }
      });
    });

    if (typeof window !== 'undefined' && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            railLinks.forEach(link => {
              if (link.getAttribute('data-target') === id) {
                link.classList.add('is-active');
              } else {
                link.classList.remove('is-active');
              }
            });
          }
        });
      }, { rootMargin: '-10% 0px -70% 0px', threshold: 0 });

      sections.forEach(sec => observer.observe(sec));
      this._scrollObserver = observer;
    }
  }

  setupEvents() {
    const uploadMount = document.getElementById('settings-upload-questions-mount');
    if (uploadMount && !uploadMount.hasChildNodes()) {
      renderStudyImport(uploadMount);
    }

    const btnDismiss = document.getElementById('btn-dismiss-settings-error');
    if (btnDismiss) {
      btnDismiss.addEventListener('click', () => this.clearError());
    }

    // Universal JLPT Level pills
    const levelPills = this.container.querySelectorAll('.learner-level-pill');
    levelPills.forEach((pill) => {
      pill.addEventListener('click', async () => {
        const lvl = pill.dataset.level;
        if (!lvl) return;
        levelPills.forEach(p => p.classList.remove('is-active', 'tactile-pill-gold'));
        pill.classList.add('is-active', 'tactile-pill-gold');
        const tag = document.getElementById('current-universal-level-tag');
        if (tag) tag.textContent = `Active (${lvl})`;
        await setUniversalJlptLevel(lvl);
      });
    });

    // Tokenizer Mode Selector
    const selectTokMode = document.getElementById('select-tokenizer-mode');
    if (selectTokMode) {
      selectTokMode.addEventListener('change', (e) => {
        const val = e.target.value;
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('kiroku.tokenizer.mode', val);
        }
      });
    }

    // Probe Tokenizer button
    const btnProbeTok = document.getElementById('btn-probe-tokenizer');
    if (btnProbeTok) {
      btnProbeTok.addEventListener('click', async () => {
        btnProbeTok.disabled = true;
        btnProbeTok.textContent = 'Probing...';
        try {
          await this.loadTokenizerStatus();
        } finally {
          btnProbeTok.disabled = false;
          btnProbeTok.textContent = 'Verify Engine';
        }
      });
    }

    // Anki Mining Deck Selector
    const selectDeck = document.getElementById('select-settings-deck');
    if (selectDeck) {
      selectDeck.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val && typeof window !== 'undefined' && window.chrome?.storage?.local) {
          window.chrome.storage.local.set({
            anki_deck: val,
            'vocab.selectedDeck': val
          });
        }
      });
    }

    // Test Anki button
    const btnAnki = document.getElementById('btn-test-anki');
    if (btnAnki) {
      btnAnki.addEventListener('click', async () => {
        btnAnki.disabled = true;
        btnAnki.textContent = 'Testing...';
        this.clearError();

        try {
          const customUrl = document.getElementById('anki-url-input')?.value?.trim();
          if (customUrl && typeof window !== 'undefined' && window.chrome?.storage?.local) {
            window.chrome.storage.local.set({ 'anki.url': customUrl });
          }
          const res = await apiClient.getAnkiStatus(customUrl);
          const tag = document.getElementById('anki-status-tag');
          if (tag) {
            const connected = Boolean(res?.connected);
            tag.textContent = connected ? `Connected (v${res.version || '?'})` : 'Unavailable';
            tag.className = `tactile-pill ${connected ? 'tactile-pill-gold' : ''}`;
            if (connected) {
              await this.loadAnkiDecks();
            }
          }
        } catch (err) {
          console.warn('[Settings] Anki status test failed:', err);
          const tag = document.getElementById('anki-status-tag');
          if (tag) {
            tag.textContent = 'Connection Failed';
            tag.className = 'tactile-pill';
          }
          this.showError('AnkiConnect test failed: ' + (err.message || 'Make sure Anki is running with AnkiConnect'));
        } finally {
          btnAnki.disabled = false;
          btnAnki.textContent = 'Test Connection';
        }
      });
    }

    // Provision Dictionary button
    const btnProvDict = document.getElementById('btn-provision-dict');
    if (btnProvDict) {
      btnProvDict.addEventListener('click', async () => {
        btnProvDict.disabled = true;
        btnProvDict.textContent = 'Starting...';
        this.clearError();

        try {
          await apiClient.request('/api/dictionary/provision', { method: 'POST' });
          await this.loadDictionaryStatus();
        } catch (err) {
          console.warn('[Settings] Dictionary provision start failed:', err);
          this.showError('Provision failed: ' + (err.message || 'API error'));
          btnProvDict.disabled = false;
          btnProvDict.textContent = 'Provision Dictionary';
        }
      });
    }

    // Yomitan Secondary Toggle
    const toggleYomiSec = document.getElementById('toggle-yomitan-secondary');
    if (toggleYomiSec) {
      toggleYomiSec.addEventListener('change', async () => {
        try {
          const enabled = toggleYomiSec.checked;
          await apiClient.request('/api/dictionary/settings', {
            method: 'PUT',
            body: JSON.stringify({ yomitan_secondary: enabled }),
            headers: { 'Content-Type': 'application/json' },
          });
          await this.loadDictionaryStatus();
        } catch (err) {
          console.warn('[Settings] Failed to save Yomitan secondary setting:', err);
          this.showError('Failed to update Yomitan secondary setting: ' + (err.message || 'Network error'));
          toggleYomiSec.checked = !toggleYomiSec.checked;
        }
      });
    }

    // Toggle OCR
    const btnOcr = document.getElementById('btn-toggle-ocr');
    if (btnOcr) {
      btnOcr.addEventListener('click', async () => {
        btnOcr.disabled = true;
        this.clearError();

        try {
          if (this.ocrRunning) {
            await apiClient.stopOcr();
            this.ocrRunning = false;
          } else {
            await apiClient.startOcr();
            this.ocrRunning = true;
          }
          this.updateOcrStatus();
        } catch (err) {
          console.warn('[Settings] OCR toggle failed:', err);
          this.showError('OCR daemon error: ' + (err.message || 'Unable to communicate with OCR process'));
        } finally {
          btnOcr.disabled = false;
        }
      });
    }

    // Save LLM Config
    const btnSaveLlm = document.getElementById('btn-save-llm');
    if (btnSaveLlm) {
      btnSaveLlm.addEventListener('click', async () => {
        btnSaveLlm.disabled = true;
        btnSaveLlm.textContent = 'Saving...';
        this.clearError();

        try {
          const provider = document.getElementById('llm-provider-select')?.value || 'none';
          const model = document.getElementById('llm-model-input')?.value?.trim() || '';
          const keyInput = document.getElementById('llm-key-input');
          const apiKey = keyInput?.value?.trim() || undefined;

          const payload = { provider, model };
          if (apiKey) payload.api_key = apiKey;

          await apiClient.updateLlmConfig(payload);
          const tag = document.getElementById('llm-status-tag');
          if (tag) {
            tag.textContent = 'Config Saved';
            tag.className = 'tactile-pill tactile-pill-gold';
          }
          if (keyInput && apiKey) {
            keyInput.value = '';
            keyInput.placeholder = '•••••••• (Configured in Windows DPAPI)';
          }
        } catch (err) {
          console.warn('[Settings] Save LLM config failed:', err);
          this.showError('Failed to save LLM settings: ' + (err.message || 'API error'));
        } finally {
          btnSaveLlm.disabled = false;
          btnSaveLlm.textContent = 'Save Settings';
        }
      });
    }

    // Test LLM Connection
    const btnTestLlm = document.getElementById('btn-test-llm');
    if (btnTestLlm) {
      btnTestLlm.addEventListener('click', async () => {
        btnTestLlm.disabled = true;
        btnTestLlm.textContent = 'Testing...';
        this.clearError();

        const resultBox = document.getElementById('llm-test-result');
        const outputEl = document.getElementById('llm-test-output');
        if (resultBox) resultBox.style.display = 'block';
        if (outputEl) outputEl.textContent = 'Sending latency ping to configured provider...';

        try {
          const res = await apiClient.testLlm();
          if (outputEl) {
            const ms = res?.latency_ms !== undefined ? `${Math.round(res.latency_ms)}ms` : 'ok';
            outputEl.textContent = `Provider status: ${res?.status || 'OK'} (${ms}). Model response verified.`;
          }
        } catch (err) {
          console.warn('[Settings] Test LLM failed:', err);
          if (outputEl) {
            outputEl.textContent = `Connection test failed: ${err.message}`;
          }
          this.showError('LLM connection test failed: ' + (err.message || 'Check provider API key or network'));
        } finally {
          btnTestLlm.disabled = false;
          btnTestLlm.textContent = 'Test LLM Connection';
        }
      });
    }

    // Toggle API Key visibility
    const btnToggleVis = document.getElementById('btn-toggle-key-visibility');
    if (btnToggleVis) {
      btnToggleVis.addEventListener('click', () => {
        const keyInput = document.getElementById('llm-key-input');
        if (!keyInput) return;
        const isPass = keyInput.type === 'password';
        keyInput.type = isPass ? 'text' : 'password';
      });
    }

    // Doctor Diagnostics Check
    const btnDoctor = document.getElementById('btn-run-doctor');
    if (btnDoctor) {
      btnDoctor.addEventListener('click', async () => {
        btnDoctor.disabled = true;
        btnDoctor.textContent = 'Checking...';
        this.clearError();

        try {
          const report = await studyClient.getDiagnostics();
          const summaryBox = document.getElementById('doctor-summary');
          const statusBadge = document.getElementById('doctor-status-badge');
          const dbPathEl = document.getElementById('doctor-db-path');
          const box = document.getElementById('doctor-results');
          const out = document.getElementById('doctor-output');

          if (summaryBox && statusBadge && dbPathEl) {
            summaryBox.style.display = 'block';
            statusBadge.textContent = report?.status === 'ok' ? 'Integrity Verified' : 'Check Complete';
            dbPathEl.textContent = report?.database_path || report?.path || 'study.db';
          }

          if (box && out) {
            box.style.display = 'block';
            out.textContent = JSON.stringify(report, null, 2);
          }
        } catch (err) {
          console.warn('[Settings] Run doctor failed:', err);
          const box = document.getElementById('doctor-results');
          const out = document.getElementById('doctor-output');
          if (box && out) {
            box.style.display = 'block';
            out.textContent = `Doctor Check Error: ${err.message}`;
          }
          this.showError('Doctor check error: ' + (err.message || 'Diagnostics failed'));
        } finally {
          btnDoctor.disabled = false;
          btnDoctor.textContent = 'Run Doctor Check';
        }
      });
    }

    // Open AppData Folder
    const btnAppData = document.getElementById('btn-open-appdata');
    if (btnAppData) {
      btnAppData.addEventListener('click', () => {
        if (window.desktopAPI?.openUserDataFolder) {
          window.desktopAPI.openUserDataFolder();
        }
      });
    }

    // Restart Backend
    const btnRestart = document.getElementById('btn-restart-backend');
    if (btnRestart) {
      btnRestart.addEventListener('click', () => {
        if (btnRestart.dataset.confirming !== 'true') {
          btnRestart.dataset.confirming = 'true';
          btnRestart.textContent = 'Confirm Restart?';
          btnRestart.classList.add('tactile-btn-primary');
          setTimeout(() => {
            if (btnRestart && btnRestart.dataset.confirming === 'true') {
              btnRestart.dataset.confirming = 'false';
              btnRestart.textContent = 'Restart Backend Service';
              btnRestart.classList.remove('tactile-btn-primary');
            }
          }, 4000);
          return;
        }

        btnRestart.disabled = true;
        btnRestart.textContent = 'Restarting...';
        if (window.desktopAPI?.retryBackend) {
          window.desktopAPI.retryBackend();
        }
      });
    }

    // Hardware Acceleration Switch
    const toggleHwAccel = document.getElementById('toggle-hardware-acceleration');
    const btnRestartApp = document.getElementById('btn-restart-app');
    const noticeRestart = document.getElementById('gpu-restart-notice');

    if (toggleHwAccel) {
      toggleHwAccel.addEventListener('change', async () => {
        const enabled = toggleHwAccel.checked;
        if (window.chrome?.storage?.local?.set) {
          await window.chrome.storage.local.set({ hardware_acceleration: enabled });
        } else if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('hardware_acceleration', String(enabled));
        }

        if (btnRestartApp) btnRestartApp.style.display = 'inline-block';
        if (noticeRestart) noticeRestart.style.display = 'block';
      });
    }

    if (btnRestartApp) {
      btnRestartApp.addEventListener('click', async () => {
        btnRestartApp.disabled = true;
        btnRestartApp.textContent = 'Restarting...';
        if (window.desktopAPI?.restartApp) {
          await window.desktopAPI.restartApp();
        } else if (window.desktopAPI?.api?.request) {
          await window.desktopAPI.api.request({ channel: 'settings:restart-app' });
        }
      });
    }
  }

  async loadInitialSettings() {
    // 0. Universal JLPT Study Level
    try {
      const activeLvl = await getUniversalJlptLevel();
      const levelPills = this.container.querySelectorAll('.learner-level-pill');
      levelPills.forEach((p) => {
        if (p.dataset.level === activeLvl) {
          p.classList.add('is-active', 'tactile-pill-gold');
        } else {
          p.classList.remove('is-active', 'tactile-pill-gold');
        }
      });
      const tag = document.getElementById('current-universal-level-tag');
      if (tag && activeLvl) tag.textContent = `Active (${activeLvl})`;
    } catch (err) {
      console.debug('[Settings] Restore learner level error:', err);
    }

    // Load hardware acceleration setting
    try {
      let hwEnabled = true;
      if (window.chrome?.storage?.local?.get) {
        const stored = await window.chrome.storage.local.get(['hardware_acceleration']);
        if (stored && typeof stored.hardware_acceleration === 'boolean') {
          hwEnabled = stored.hardware_acceleration;
        }
      } else if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem('hardware_acceleration');
        if (stored !== null) hwEnabled = stored === 'true';
      }
      const toggle = document.getElementById('toggle-hardware-acceleration');
      if (toggle) {
        toggle.checked = hwEnabled;
      }
    } catch (_) {}

    // Language engine status & stored mode
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const storedMode = window.localStorage.getItem('kiroku.tokenizer.mode') || 'auto';
        const sel = document.getElementById('select-tokenizer-mode');
        if (sel) sel.value = storedMode;
      }
      await this.loadTokenizerStatus();
    } catch (err) {
      console.debug('[Settings] Initial tokenizer status error:', err);
    }

    // Local Dictionary status
    try {
      await this.loadDictionaryStatus();
    } catch (err) {
      console.debug('[Settings] Initial dictionary status error:', err);
    }

    // 1. OCR status
    try {
      const ocrRes = await apiClient.getOcrStatus();
      if (ocrRes) {
        this.ocrRunning = Boolean(ocrRes.running);
        this.updateOcrStatus();
      }
    } catch (err) {
      console.warn('[Settings] Initial OCR status error:', err);
    }

    // Yomitan status
    try {
      const yomiRes = await apiClient.getYomitanStatus();
      const yomiTag = document.getElementById('yomitan-status-tag');
      if (yomiTag) {
        const isOnline = Boolean(yomiRes && (yomiRes.available_dictionaries?.length > 0 || yomiRes.enabled));
        yomiTag.textContent = isOnline ? 'Ready' : 'Not Connected';
        yomiTag.className = `tactile-pill ${isOnline ? 'tactile-pill-gold' : ''}`;
      }
    } catch (err) {
      console.debug('[Settings] Initial Yomitan status error:', err);
    }

    // 2. Restore custom Anki URL and check status
    let savedAnkiUrl = null;
    if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
      try {
        const stored = await new Promise((res) => window.chrome.storage.local.get(['anki.url'], res));
        if (stored?.['anki.url']) {
          savedAnkiUrl = stored['anki.url'];
          const urlInput = document.getElementById('anki-url-input');
          if (urlInput) urlInput.value = savedAnkiUrl;
        }
      } catch (err) {
        console.debug('[Settings] Restore Anki URL error:', err);
      }
    }

    try {
      const ankiRes = await apiClient.getAnkiStatus(savedAnkiUrl);
      const tag = document.getElementById('anki-status-tag');
      if (tag && ankiRes) {
        const connected = Boolean(ankiRes.connected);
        tag.textContent = connected ? `Connected (v${ankiRes.version || '?'})` : 'Unavailable';
        tag.className = `tactile-pill ${connected ? 'tactile-pill-gold' : ''}`;
        if (connected) {
          await this.loadAnkiDecks();
        }
      }
    } catch (err) {
      console.warn('[Settings] Initial Anki status error:', err);
    }

    try {
      await this.loadAnkiDecks();
    } catch (err) {
      console.debug('[Settings] Initial loadAnkiDecks error:', err);
    }

    // 3. LLM config
    try {
      const llmConf = await apiClient.getLlmConfig();
      if (llmConf) {
        const provSelect = document.getElementById('llm-provider-select');
        const modelInput = document.getElementById('llm-model-input');
        const keyInput = document.getElementById('llm-key-input');

        if (provSelect && llmConf.provider) {
          provSelect.value = llmConf.provider;
        }
        if (modelInput && llmConf.model) {
          modelInput.value = llmConf.model;
        }
        if (keyInput && llmConf.has_key) {
          keyInput.placeholder = '•••••••• (Configured in Windows DPAPI)';
        }
      }
    } catch (err) {
      console.warn('[Settings] Initial LLM config error:', err);
    }
  }

  async loadDictionaryStatus() {
    const dictTag = document.getElementById('dict-status-tag');
    const pathLabel = document.getElementById('dict-db-path-label');
    const progContainer = document.getElementById('dict-provision-container');
    const progBar = document.getElementById('dict-provision-bar');
    const progPct = document.getElementById('dict-provision-pct');
    const progLabel = document.getElementById('dict-provision-label');
    const btnProv = document.getElementById('btn-provision-dict');
    const toggleSecondary = document.getElementById('toggle-yomitan-secondary');

    try {
      const res = await apiClient.request('/api/dictionary/status');
      if (!res) return;

      const isReady = Boolean(res.db_present && res.jitendex);
      if (dictTag) {
        dictTag.textContent = isReady ? 'Ready' : (res.provisioning?.status === 'running' ? 'Provisioning' : 'Missing');
        dictTag.className = `tactile-pill ${isReady ? 'tactile-pill-gold' : ''}`;
        dictTag.dataset.state = isReady ? 'ready' : (res.provisioning?.status === 'running' ? 'checking' : 'stopped');
      }

      if (pathLabel) {
        pathLabel.textContent = `Database: ${res.db_path || 'Not found'}`;
      }

      if (toggleSecondary) {
        toggleSecondary.checked = Boolean(res.yomitan_secondary);
      }

      const prov = res.provisioning || {};
      if (prov.status === 'running') {
        if (progContainer) progContainer.style.display = 'block';
        if (progBar) progBar.style.width = `${prov.progress || 0}%`;
        if (progPct) progPct.textContent = `${Math.round(prov.progress || 0)}%`;
        if (progLabel) progLabel.textContent = prov.message || 'Provisioning...';
        if (btnProv) {
          btnProv.disabled = true;
          btnProv.textContent = 'Provisioning...';
        }
        setTimeout(() => this.loadDictionaryStatus(), 1500);
      } else {
        if (progContainer && prov.status === 'completed') {
          progContainer.style.display = 'none';
        }
        if (btnProv) {
          btnProv.disabled = false;
          btnProv.textContent = isReady ? 'Re-provision Dictionary' : 'Provision Dictionary';
        }
      }
    } catch (err) {
      console.debug('[Settings] Dictionary status error:', err);
      if (dictTag) {
        dictTag.textContent = 'Unavailable';
        dictTag.className = 'tactile-pill';
      }
    }
  }

  async loadTokenizerStatus() {
    const statusTag = document.getElementById('tokenizer-status-tag');
    const dictDisplay = document.getElementById('tokenizer-dict-display');
    const dictDot = document.getElementById('tokenizer-dict-dot');
    const readyLabel = document.getElementById('tokenizer-ready-label');
    if (!statusTag && !readyLabel) return;

    try {
      const health = await apiClient.getHealth();
      const tok = health?.tokenizer || 'legacy';
      const dict = health?.tokenizer_dictionary || 'core';
      const ready = Boolean(health?.tokenizer_ready !== false);

      if (statusTag) {
        statusTag.dataset.state = ready ? 'ready' : 'stopped';
        statusTag.title = ready ? 'Ready' : 'Standby';
      }
      if (dictDisplay) {
        dictDisplay.textContent = `Dictionary: ${dict}`;
      }
      if (dictDot) {
        dictDot.dataset.state = ready ? 'ready' : 'stopped';
      }
      if (readyLabel) {
        readyLabel.textContent = `Engine: ${tok} • Dictionary: ${dict} • ${ready ? 'Ready (Active)' : 'Standby'}`;
      }
    } catch (err) {
      console.warn('[Settings] Tokenizer health probe failed:', err);
      if (readyLabel) {
        readyLabel.textContent = 'Engine status unavailable (offline)';
      }
      if (statusTag) {
        statusTag.dataset.state = 'error';
      }
    }
  }

  async loadAnkiDecks(savedDeck = null) {
    const deckSelect = document.getElementById('select-settings-deck');
    if (!deckSelect) return;

    try {
      const res = await apiClient.getAnkiDecks();
      const decks = Array.isArray(res) ? res : (res?.decks || []);

      let currentDeck = savedDeck;
      if (!currentDeck && typeof window !== 'undefined' && window.chrome?.storage?.local) {
        try {
          const stored = await new Promise((resolve) => {
            window.chrome.storage.local.get(['anki_deck', 'vocab.selectedDeck'], resolve);
          });
          currentDeck = stored?.['anki_deck'] || stored?.['vocab.selectedDeck'] || '';
        } catch (err) {
          console.debug('[Settings] Restore stored deck error:', err);
        }
      }

      if (decks.length === 0) {
        const fallback = currentDeck || 'Default';
        deckSelect.innerHTML = `<option value="${escapeHtml(fallback)}">${escapeHtml(fallback)} (Default)</option>`;
        return;
      }

      deckSelect.innerHTML = decks.map((d) => `
        <option value="${escapeHtml(d)}" ${d === currentDeck ? 'selected' : ''}>${escapeHtml(d)}</option>
      `).join('');

      if (currentDeck && !decks.includes(currentDeck)) {
        const opt = document.createElement('option');
        opt.value = currentDeck;
        opt.textContent = `${currentDeck} (Saved)`;
        opt.selected = true;
        deckSelect.appendChild(opt);
      }
    } catch (err) {
      console.warn('[Settings] Load Anki decks error:', err);
      let fallbackDeck = savedDeck || 'Default';
      if (typeof window !== 'undefined' && window.chrome?.storage?.local) {
        try {
          const stored = await new Promise((resolve) => {
            window.chrome.storage.local.get(['anki_deck', 'vocab.selectedDeck'], resolve);
          });
          if (stored?.['anki_deck']) fallbackDeck = stored['anki_deck'];
          else if (stored?.['vocab.selectedDeck']) fallbackDeck = stored['vocab.selectedDeck'];
        } catch (storageErr) {
          console.debug('[Settings] Deck restore storage error:', storageErr);
        }
      }
      deckSelect.innerHTML = `<option value="${escapeHtml(fallbackDeck)}" selected>${escapeHtml(fallbackDeck)} (Offline Fallback)</option>`;
    }
  }

  updateOcrStatus() {
    const tag = document.getElementById('ocr-status-tag');
    const btn = document.getElementById('btn-toggle-ocr');
    if (tag) {
      tag.textContent = this.ocrRunning ? 'Running (Port 21829)' : 'Stopped';
      tag.className = `tactile-pill ${this.ocrRunning ? 'tactile-pill-gold' : ''}`;
    }
    if (btn) {
      btn.textContent = this.ocrRunning ? 'Stop OCR Server' : 'Start OCR Server';
    }
  }

  unmount() {
    if (this._scrollObserver) {
      this._scrollObserver.disconnect();
      this._scrollObserver = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
