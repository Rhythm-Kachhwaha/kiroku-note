/**
 * Kiroku Note Desktop — Cloud Sync Coordinator
 * Orchestrates bidirectional synchronization between local SQLite and Kiroku Cloud (Turso).
 * Drives the tactile Pacman progress overlay and ensures crash-resilient atomic commits.
 */

import { SyncLoaderOverlay } from '../components/sync_loader.js';
import { AuthModal } from '../components/auth_modal.js';
import { ApiClient } from './api_client.js';

export class SyncCoordinator {
  constructor(options = {}) {
    this.api = options.apiClient || new ApiClient();
    this.overlay = new SyncLoaderOverlay();
    this.isSyncing = false;
  }

  async getAuthToken() {
    // 1. Try Desktop Electron Store
    if (typeof window !== 'undefined' && window.desktopAPI?.auth?.getSession) {
      try {
        const session = await window.desktopAPI.auth.getSession();
        if (session?.token) return session.token;
      } catch (_) {}
    }

    // 2. Try localStorage cached user
    const stored = AuthModal.getStoredUser();
    if (stored?.token) return stored.token;

    // 3. Try chrome.storage.local
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const data = await chrome.storage.local.get(['kiroku_auth_token', 'kiroku.cloud.auth_token']);
        const t = data?.kiroku_auth_token || data?.['kiroku.cloud.auth_token'];
        if (t) return t;
      } catch (_) {}
    }

    return null;
  }

  isCloudWebMode() {
    if (typeof window === 'undefined') return false;
    if (window.desktopAPI) return false;
    const host = window.location?.hostname || '';
    return Boolean(host && host !== '127.0.0.1' && host !== 'localhost');
  }

  async runCloudRefreshSync({ showOverlay = true, onProgress = null } = {}) {
    if (showOverlay) {
      this.overlay.show('Syncing with Kiroku Cloud...', 'Refreshing settings, kanji & vocab states...', 1, 2);
    }
    try {
      await Promise.allSettled([
        this.api.request('/api/learner/settings'),
        this.api.request('/api/kanji/seen'),
        this.api.request('/api/known-words'),
      ]);
      if (showOverlay) {
        this.overlay.updateProgress(2, 2, 'Cloud state up to date!');
        if (typeof onProgress === 'function') onProgress(2, 2, 'Cloud state up to date!');
        setTimeout(() => this.overlay.hide(), 900);
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kiroku:cards-synced', { detail: { cloud_refresh: true } }));
        window.dispatchEvent(new CustomEvent('kiroku:settings-updated', { detail: { cloud_refresh: true } }));
      }
      return { ok: true, mode: 'cloud_web' };
    } catch (err) {
      if (showOverlay) {
        this.overlay.updateProgress(0, 0, `Refresh paused: ${err?.message || 'Network error'}`);
        setTimeout(() => this.overlay.hide(), 1400);
      }
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async runSync({ showOverlay = true, onProgress = null } = {}) {
    if (this.isSyncing) {
      console.debug('[SyncCoordinator] Sync already in progress, skipping duplicate call.');
      return { ok: false, reason: 'already_syncing' };
    }

    const now = Date.now();
    if (!showOverlay && this._lastFailedAt && (now - this._lastFailedAt < 60000)) {
      return { ok: false, reason: 'cooldown' };
    }

    this.isSyncing = true;
    const token = await this.getAuthToken();
    if (!token) {
      this.isSyncing = false;
      return { ok: false, reason: 'unauthenticated' };
    }

    try {
      if (this.isCloudWebMode()) {
        return await this.runCloudRefreshSync({ showOverlay, onProgress });
      }

      // 1. Check initial status
      let status = null;
      try {
        status = await this.api.request('/api/cloud/sync/status');
      } catch (e) {
        console.warn('[SyncCoordinator] Could not get sync status from backend:', e);
        return { ok: false, reason: 'backend_offline' };
      }

      const pendingPush = Number(status?.pending_push || 0);
      const totalLocal = Number(status?.total_local || 0);

      // Show full overlay whenever explicitly requested
      if (showOverlay) {
        const desc = pendingPush > 0 ? `Preparing to sync ${pendingPush} cards...` : 'Checking for cloud updates...';
        this.overlay.show('Syncing with Kiroku Cloud...', desc, 0, Math.max(1, pendingPush));
      }

      let totalPushed = 0;
      let totalPulled = 0;
      let totalImported = 0;

      // 2. Push unsynced cards in optimal batches of 35 (safe against 512KB limit)
      let remaining = pendingPush;
      let pushBatches = 0;
      const PUSH_BATCH_SIZE = 35;
      const maxPushBatches = Math.ceil(pendingPush / PUSH_BATCH_SIZE) + 5;
      while (remaining > 0 && pushBatches < maxPushBatches) {
        pushBatches++;
        const pushRes = await this.api.request('/api/cloud/sync/push-batch', {
          method: 'POST',
          body: { batch_size: PUSH_BATCH_SIZE, token }
        });

        if (pushRes?.error) {
          throw new Error(pushRes.error);
        }

        const pushed = pushRes?.pushed || 0;
        totalPushed += pushed;
        remaining = pushRes?.remaining !== undefined ? pushRes.remaining : Math.max(0, remaining - pushed);

        if (showOverlay && pendingPush > 0) {
          const detail = `Syncing ${totalPushed} of ${pendingPush} cards...`;
          this.overlay.updateProgress(totalPushed, pendingPush, detail);
          if (typeof onProgress === 'function') onProgress(totalPushed, pendingPush, detail);
        }

        if (pushed === 0 || remaining === 0) break;
      }

      // 3. Pull pending cloud cards in optimal batches of 50
      let hasMore = true;
      const PULL_LIMIT = 50;
      while (hasMore) {
        const pullRes = await this.api.request('/api/cloud/sync/pull-batch', {
          method: 'POST',
          body: { limit: PULL_LIMIT, token }
        });

        if (pullRes?.error) {
          console.warn('[SyncCoordinator] Pull warning:', pullRes.error);
          throw new Error(`Cloud pull error: ${pullRes.error}`);
        }

        const pulled = pullRes?.pulled || 0;
        const newlyImported = pullRes?.imported_new || 0;
        totalPulled += pulled;
        totalImported += newlyImported;
        hasMore = Boolean(pullRes?.has_more);

        if (showOverlay && pulled > 0) {
          const detail = totalImported > 0
            ? `Imported ${totalImported} new cards from cloud...`
            : `Syncing cloud updates...`;
          const currentVal = totalImported > 0 ? totalImported : totalPushed;
          const maxVal = totalImported > 0 ? Math.max(totalImported, totalPulled) : Math.max(1, pendingPush);
          this.overlay.updateProgress(currentVal, maxVal, detail);
          if (typeof onProgress === 'function') onProgress(currentVal, maxVal, detail);
        }

        if (pulled === 0) break;
      }

      // 4. Synchronize study progress, settings (JLPT/deck), kanji mastery & vocab states
      let progressRes = null;
      if (showOverlay) {
        const detail = 'Syncing settings, kanji mastery & vocab states...';
        this.overlay.updateProgress(90, 100, detail);
        if (typeof onProgress === 'function') onProgress(90, 100, detail);
      }
      try {
        progressRes = await this.api.request('/api/cloud/sync/progress', {
          method: 'POST',
          body: { token }
        });
      } catch (progErr) {
        console.warn('[SyncCoordinator] Progress/settings sync warning:', progErr?.message || progErr);
      }

      const knownPulled = Number(progressRes?.known_words_pulled || 0);
      const knownPushed = Number(progressRes?.known_words_pushed || 0);

      if (showOverlay) {
        const parts = [];
        if (totalPushed > 0) parts.push(`${totalPushed} pushed`);
        if (totalImported > 0) parts.push(`${totalImported} imported`);
        if (knownPulled > 0 || knownPushed > 0) parts.push(`${knownPulled + knownPushed} vocab synced`);
        const summary = parts.length > 0
          ? `Sync complete! (${parts.join(', ')})`
          : 'All tabs up to date!';
        this.overlay.updateProgress(100, 100, summary);
        setTimeout(() => this.overlay.hide(), 1000);
      }

      // Notify other views that cards/reviews/settings synced
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kiroku:cards-synced', {
          detail: {
            pushed: totalPushed,
            pulled: totalPulled,
            imported: totalImported,
            known_words_pulled: knownPulled,
            known_words_pushed: knownPushed,
            learner_level: progressRes?.learner_level || null,
          }
        }));
        if (progressRes?.learner_level) {
          window.dispatchEvent(new CustomEvent('kiroku:settings-updated', {
            detail: { learner_level: progressRes.learner_level }
          }));
        }
      }

      return {
        ok: true,
        pushed: totalPushed,
        pulled: totalPulled,
        imported_new: totalImported
      };
    } catch (err) {
      this._lastFailedAt = Date.now();
      console.debug('[SyncCoordinator] Cloud sync failed:', err?.message || err);
      if (showOverlay) {
        this.overlay.updateProgress(0, 0, `Sync paused: ${err?.message || 'Check network connection.'}`);
        setTimeout(() => this.overlay.hide(), 1600);
      }
      return { ok: false, error: err?.message || String(err) };
    } finally {
      this.isSyncing = false;
    }
  }
}

