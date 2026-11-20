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

  async runSync({ showOverlay = true, onProgress = null } = {}) {
    if (this.isSyncing) {
      console.debug('[SyncCoordinator] Sync already in progress, skipping duplicate call.');
      return { ok: false, reason: 'already_syncing' };
    }

    this.isSyncing = true;
    const token = await this.getAuthToken();
    if (!token) {
      this.isSyncing = false;
      return { ok: false, reason: 'unauthenticated' };
    }

    try {
      // 1. Check initial status
      let status = null;
      try {
        status = await this.api.request('/api/cloud/sync/status');
      } catch (e) {
        console.warn('[SyncCoordinator] Could not get sync status from backend:', e);
        // Backend might be offline: if in PWA mode, fallback to online queue sync
        this.isSyncing = false;
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

      // 2. Push unsynced cards in high-speed batches of 100
      let remaining = pendingPush;
      let pushBatches = 0;
      const PUSH_BATCH_SIZE = 100;
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

      // 3. Pull pending cloud cards in high-speed batches of 100
      let hasMore = true;
      const PULL_LIMIT = 100;
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

      // 4. Synchronize study progress & activity
      try {
        await this.api.request('/api/cloud/sync/progress', {
          method: 'POST',
          body: { token }
        });
      } catch (_) {}

      if (showOverlay) {
        const summary = (totalPushed > 0 || totalImported > 0)
          ? `Sync complete! (${totalPushed} synced, ${totalImported} imported)`
          : 'All cards up to date!';
        this.overlay.updateProgress(100, 100, summary);
        setTimeout(() => this.overlay.hide(), 1000);
      }

      // Notify other views that cards/reviews synced
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kiroku:cards-synced', {
          detail: { pushed: totalPushed, pulled: totalPulled, imported: totalImported }
        }));
      }

      return {
        ok: true,
        pushed: totalPushed,
        pulled: totalPulled,
        imported_new: totalImported
      };
    } catch (err) {
      console.warn('[SyncCoordinator] Cloud sync failed:', err);
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

