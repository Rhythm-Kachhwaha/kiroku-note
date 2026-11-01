/**
 * Kiroku Note Desktop — Global Settings & Telemetry View Controller
 * Universal JLPT level curriculum, service integrations (AnkiConnect, Yomitan, OCR, LLM),
 * encrypted DPAPI keys, doctor diagnostics report, app data affordances, and backend supervisor controls.
 */

import { apiClient } from '../services/api_client.js';
import { studyClient } from '../services/study_client.js';
import { renderAssetSlot } from '../assets_map.js';
import { getUniversalJlptLevel, setUniversalJlptLevel } from '../utils/learner.js';

export class SettingsView {
  constructor(router) {
    this.router = router;
    this.container = null;
    this.ocrRunning = false;
  }

  async mount(container) {
    this.container = container;
    this.render();
    this.setupEvents();
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
              <p class="settings-subtitle">Manage study curriculum, connection endpoints, encrypted credentials, and system diagnostics.</p>
            </div>
            ${renderAssetSlot('settings-mechanic-cat', 'settings-mascot-box')}
          </div>

          <!-- Visible Error Banner -->
          <div class="settings-error-banner" id="settings-error-banner" style="display: none;">
            <span class="error-msg" id="settings-error-msg"></span>
            <button type="button" class="btn-dismiss-error" id="btn-dismiss-settings-error" aria-label="Dismiss error"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>
          </div>

          <!-- Section 0: Universal Study Level Curriculum -->
          <div class="settings-group-header mt-4">
            <span class="font-mono text-xs text-gold">Curriculum</span>
            <h2 class="text-base font-bold text-warm-paper">Universal JLPT Study Level</h2>
          </div>
          <div class="settings-cards-grid mt-2">
            <div class="settings-card tactile-card">
              <div class="card-header-row">
                <h3 class="card-title">Target JLPT Level</h3>
                <span class="tactile-pill tactile-pill-gold" id="current-universal-level-tag">Active</span>
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
          </div>

          <!-- Section 1: Integrations -->
          <div class="settings-group-header mt-6">
            <span class="font-mono text-xs text-gold">Integrations</span>
            <h2 class="text-base font-bold text-warm-paper">External Mining &amp; Dictionary Providers</h2>
          </div>
          <div class="settings-cards-grid mt-2">
            <!-- Card 1: AnkiConnect Integration -->
            <div class="settings-card tactile-card">
              <div class="card-header-row">
                <h3 class="card-title">AnkiConnect Sync</h3>
                <span class="tactile-pill" id="anki-status-tag">Checking...</span>
              </div>
              <p class="card-desc">Direct local HTTP synchronization to Anki desktop client.</p>

              <div class="form-field mt-3">
                <label for="anki-url-input">AnkiConnect Endpoint URL</label>
                <input type="text" id="anki-url-input" class="tactile-input font-mono text-sm" value="http://127.0.0.1:8765" />
              </div>

              <div class="card-actions-row mt-3">
                <button type="button" class="tactile-btn tactile-btn-primary" id="btn-test-anki">Test Connection</button>
              </div>
            </div>

            <!-- Card: Yomitan Status -->
            <div class="settings-card tactile-card">
              <div class="card-header-row">
                <h3 class="card-title">Yomitan Provider</h3>
                <span class="tactile-pill" id="yomitan-status-tag">Checking...</span>
              </div>
              <p class="card-desc">Local Yomitan dictionary server integration for fast bilingual definition lookup.</p>
              <div class="mt-3">
                <span class="font-mono text-xs text-muted">Endpoint: loopback /api/yomitan/dictionaries</span>
              </div>
            </div>
          </div>

          <!-- Section 2: Optional Services -->
          <div class="settings-group-header mt-6">
            <span class="font-mono text-xs text-gold">Optional Services</span>
            <h2 class="text-base font-bold text-warm-paper">Local OCR &amp; AI Explanations</h2>
          </div>
          <div class="settings-cards-grid mt-2">
            <!-- Card 2: OCR Daemon Controls (Port 21829) -->
            <div class="settings-card tactile-card">
              <div class="card-header-row">
                <h3 class="card-title">Manga-OCR Daemon</h3>
                <span class="tactile-pill" id="ocr-status-tag">Stopped</span>
              </div>
              <p class="card-desc">Isolated, optional CPU-only manga-ocr background server on loopback port 21829.</p>

              <div class="card-actions-row mt-3">
                <button type="button" class="tactile-btn" id="btn-toggle-ocr">Start OCR Server</button>
              </div>
            </div>

            <!-- Card 3: LLM Provider Configuration -->
            <div class="settings-card tactile-card">
              <div class="card-header-row">
                <h3 class="card-title">AI Explanation Provider</h3>
                <span class="tactile-pill tactile-pill-gold" id="llm-status-tag">Key Protected</span>
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
                <input type="password" id="llm-key-input" class="tactile-input font-mono text-sm" placeholder="Enter API key to update..." />
              </div>

              <div class="card-actions-row mt-3">
                <button type="button" class="tactile-btn tactile-btn-primary" id="btn-save-llm">Save Settings</button>
                <button type="button" class="tactile-btn" id="btn-test-llm">Test LLM Connection</button>
              </div>

              <div class="llm-test-result-box mt-3" id="llm-test-result" style="display: none;">
                <span class="font-mono text-xs text-muted" id="llm-test-output"></span>
              </div>
            </div>
          </div>

          <!-- Section 3 & 4: Diagnostics & Process Control -->
          <div class="settings-group-header mt-6">
            <span class="font-mono text-xs text-gold">Diagnostics &amp; System</span>
            <h2 class="text-base font-bold text-warm-paper">Database Diagnostics &amp; Process Lifecycle</h2>
          </div>
          <div class="settings-cards-grid mt-2">
            <!-- Card 4: Doctor Diagnostics & Maintenance -->
            <div class="settings-card tactile-card">
              <div class="card-header-row">
                <h3 class="card-title">System Doctor Diagnostics</h3>
                <span class="tactile-pill tactile-pill-gold">Read-Only</span>
              </div>
              <p class="card-desc">Non-mutating verification of SQLite database integrity, sealed triggers, and media assets.</p>

              <div class="doctor-results-box mt-3" id="doctor-results" style="display: none;">
                <pre class="doctor-pre font-mono text-xs" id="doctor-output"></pre>
              </div>

              <div class="card-actions-row mt-3">
                <button type="button" class="tactile-btn tactile-btn-primary" id="btn-run-doctor">Run Doctor Check</button>
                <button type="button" class="tactile-btn" id="btn-open-appdata">Open App Data</button>
              </div>
            </div>

            <!-- Card 5: Backend Process Supervisor -->
            <div class="settings-card tactile-card">
              <div class="card-header-row">
                <h3 class="card-title">FastAPI Backend Service</h3>
                <span class="tactile-pill tactile-pill-gold">Supervisor Managed</span>
              </div>
              <p class="card-desc">Local desktop process supervisor maintaining kiroku.db, SQLite WAL transactions, and port bindings.</p>

              <div class="card-actions-row mt-3">
                <button type="button" class="tactile-btn" id="btn-restart-backend">Restart Backend Service</button>
              </div>
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

  setupEvents() {
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
          const provider = document.getElementById('llm-provider-select')?.value;
          const model = document.getElementById('llm-model-input')?.value?.trim();
          const apiKey = document.getElementById('llm-key-input')?.value?.trim();

          const payload = { provider };
          if (model) payload.model = model;
          if (apiKey) payload.api_key = apiKey;

          await apiClient.updateLlmConfig(payload);
          const keyInput = document.getElementById('llm-key-input');
          if (keyInput) {
            keyInput.value = '';
            keyInput.placeholder = '•••••••• (Saved in Windows DPAPI)';
          }
          const tag = document.getElementById('llm-status-tag');
          if (tag) {
            tag.textContent = provider === 'none' ? 'Offline Mode' : 'Configured';
            tag.className = `tactile-pill ${provider !== 'none' ? 'tactile-pill-gold' : ''}`;
          }
        } catch (err) {
          console.error('[Settings] Save LLM config failed:', err);
          this.showError('Failed to save LLM settings: ' + (err.message || 'Validation error'));
        } finally {
          btnSaveLlm.disabled = false;
          btnSaveLlm.textContent = 'Save Settings';
        }
      });
    }

    // Test LLM Latency
    const btnTestLlm = document.getElementById('btn-test-llm');
    if (btnTestLlm) {
      btnTestLlm.addEventListener('click', async () => {
        btnTestLlm.disabled = true;
        btnTestLlm.textContent = 'Testing...';
        this.clearError();

        const resultBox = document.getElementById('llm-test-result');
        const outputEl = document.getElementById('llm-test-output');
        if (resultBox && outputEl) {
          resultBox.style.display = 'block';
          outputEl.textContent = 'Testing model latency...';
        }

        const startTime = Date.now();
        try {
          const res = await apiClient.testLlm('Hello, test connection.');
          const latencyMs = Date.now() - startTime;
          if (outputEl) {
            outputEl.textContent = `Latency: ${latencyMs}ms · Response: ${res?.result || JSON.stringify(res)}`;
          }
        } catch (err) {
          console.warn('[Settings] Test LLM failed:', err);
          if (outputEl) {
            outputEl.textContent = `Error (${Date.now() - startTime}ms): ${err.message || 'Request failed'}`;
          }
          this.showError('LLM test failed: ' + (err.message || 'Check provider key and network'));
        } finally {
          btnTestLlm.disabled = false;
          btnTestLlm.textContent = 'Test LLM Connection';
        }
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
          const box = document.getElementById('doctor-results');
          const out = document.getElementById('doctor-output');
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
      }
    } catch (err) {
      console.warn('[Settings] Initial Anki status error:', err);
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
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
