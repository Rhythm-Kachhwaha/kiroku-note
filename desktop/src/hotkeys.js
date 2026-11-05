/**
 * Kiroku Note Desktop — Global Hotkeys & Study-Pause Manager (Slice 45)
 *
 * Provides:
 * 1. Optional (default off) globalShortcut map:
 *    - pause/play (cmd.pause_play)
 *    - prev cue (cmd.prev_cue)
 *    - next cue (cmd.next_cue)
 *    - replay cue (cmd.replay_cue)
 *    - loop (cmd.loop)
 *    Sends cmd.* via link client / renderer IPC.
 * 2. Study-pause logic:
 *    Setting "Pause when line has >= N gap words" (default off, N=2),
 *    applying to both Link companion and Theater playback.
 */

const DEFAULT_HOTKEYS_CONFIG = {
  enabled: false, // default off
  shortcuts: {
    'cmd.pause_play': 'CommandOrControl+Alt+Space',
    'cmd.prev_cue': 'CommandOrControl+Alt+Left',
    'cmd.next_cue': 'CommandOrControl+Alt+Right',
    'cmd.replay_cue': 'CommandOrControl+Alt+R',
    'cmd.loop': 'CommandOrControl+Alt+L'
  },
  study_pause_enabled: false, // default off
  study_pause_gap_threshold: 2 // N=2
};

/**
 * Pure evaluation for study-pause condition.
 * @param {number} gapCount Number of gap words in active cue
 * @param {number} threshold Gap words threshold (default 2)
 * @param {boolean} enabled Whether study-pause is activated
 * @returns {boolean} True if video should be paused
 */
function checkStudyPause(gapCount, threshold = 2, enabled = false) {
  if (!enabled) return false;
  const count = typeof gapCount === 'number' ? gapCount : 0;
  const thresh = typeof threshold === 'number' ? threshold : 2;
  return count >= thresh;
}

class HotkeyManager {
  constructor(options = {}) {
    this.globalShortcut = options.globalShortcut || null;
    this.getMainWindow = options.getMainWindow || (() => null);
    this.store = options.store || null;
    this.ipcMain = options.ipcMain || null;

    this.config = {
      ...DEFAULT_HOTKEYS_CONFIG,
      shortcuts: { ...DEFAULT_HOTKEYS_CONFIG.shortcuts },
      ...(options.config || {})
    };
    this.registeredShortcuts = new Set();

    if (this.store) {
      this.loadConfig();
    }

    if (this.ipcMain) {
      this.setupIpc(this.ipcMain);
    }
  }

  loadConfig() {
    if (!this.store) return this.config;
    try {
      const stored = this.store.get('hotkeys_config');
      const val = stored?.hotkeys_config || stored;
      if (val && typeof val === 'object') {
        this.config = {
          ...this.config,
          ...val,
          shortcuts: {
            ...this.config.shortcuts,
            ...(val.shortcuts || {})
          }
        };
      }
    } catch (_) {}
    return this.config;
  }

  saveConfig() {
    if (!this.store) return;
    try {
      this.store.set({ hotkeys_config: this.config });
    } catch (_) {}
  }

  /**
   * Register global shortcuts if enabled.
   */
  register() {
    this.unregister();
    this.loadConfig();

    if (!this.config.enabled || !this.globalShortcut) {
      return false;
    }

    let allRegistered = true;
    for (const [cmd, accelerator] of Object.entries(this.config.shortcuts)) {
      if (!accelerator) continue;
      try {
        const success = this.globalShortcut.register(accelerator, () => {
          this.handleShortcutTrigger(cmd);
        });
        if (success !== false) {
          this.registeredShortcuts.add(accelerator);
        } else {
          allRegistered = false;
        }
      } catch (err) {
        allRegistered = false;
      }
    }

    return allRegistered;
  }

  /**
   * Unregister all registered global shortcuts.
   */
  unregister() {
    if (!this.globalShortcut) return;
    try {
      for (const accelerator of this.registeredShortcuts) {
        if (typeof this.globalShortcut.unregister === 'function') {
          this.globalShortcut.unregister(accelerator);
        }
      }
      if (typeof this.globalShortcut.unregisterAll === 'function' && this.registeredShortcuts.size > 0) {
        this.globalShortcut.unregisterAll();
      }
    } catch (_) {}
    this.registeredShortcuts.clear();
  }

  /**
   * Send command payload to renderer via IPC.
   */
  handleShortcutTrigger(command) {
    const win = typeof this.getMainWindow === 'function' ? this.getMainWindow() : null;
    if (win && win.webContents && typeof win.webContents.send === 'function') {
      // Dispatches cmd.* to renderer
      win.webContents.send('link:command', { command, type: command });
      win.webContents.send('extension:message', { type: 'link:command', command });
    }
    return command;
  }

  /**
   * Evaluates if playback should pause on the current cue.
   */
  shouldStudyPause(gapCount) {
    return checkStudyPause(
      gapCount,
      this.config.study_pause_gap_threshold,
      this.config.study_pause_enabled
    );
  }

  /**
   * Update configuration and re-register if active.
   */
  updateConfig(updates = {}) {
    this.config = {
      ...this.config,
      ...updates,
      shortcuts: {
        ...this.config.shortcuts,
        ...(updates.shortcuts || {})
      }
    };
    this.saveConfig();
    if (this.config.enabled) {
      this.register();
    } else {
      this.unregister();
    }
    return this.config;
  }

  setupIpc(ipcMain) {
    if (!ipcMain || typeof ipcMain.handle !== 'function') return;

    ipcMain.handle('hotkeys:get-config', () => {
      return this.config;
    });

    ipcMain.handle('hotkeys:update-config', (_event, updates) => {
      return this.updateConfig(updates);
    });

    ipcMain.handle('hotkeys:evaluate-study-pause', (_event, gapCount) => {
      return this.shouldStudyPause(gapCount);
    });
  }
}

module.exports = {
  HotkeyManager,
  DEFAULT_HOTKEYS_CONFIG,
  checkStudyPause
};

