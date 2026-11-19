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

      // Only show full overlay if there are cards to push or user requested
      if (showOverlay && pendingPush > 0) {
        this.overlay.show('Syncing with Kiroku Cloud...', `Preparing ${pendingPush} cards for upload...`, 0, pendingPush);
      }

      let totalPushed = 0;
      let totalPulled = 0;
      let totalImported = 0;

      // 2. Push unsynced cards in batches of 10
      let remaining = pendingPush;
      while (remaining > 0) {
        const pushRes = await this.api.request('/api/cloud/sync/push-batch', {
          method: 'POST',
          body: { batch_size: 10, token }
        });

        const pushed = pushRes?.pushed || 0;
        totalPushed += pushed;
        remaining = pushRes?.remaining !== undefined ? pushRes.remaining : Math.max(0, remaining - pushed);

        if (showOverlay && pendingPush > 0) {
          const detail = `Uploaded ${totalPushed} of ${pendingPush} cards...`;
          this.overlay.updateProgress(totalPushed, pendingPush, detail);
          if (typeof onProgress === 'function') onProgress(totalPushed, pendingPush, detail);
        }

        if (pushed === 0 || remaining === 0 || pushRes?.error) break;
      }

      // 3. Pull pending cloud cards in batches
      let hasMore = true;
      while (hasMore) {
        const pullRes = await this.api.request('/api/cloud/sync/pull-batch', {
          method: 'POST',
          body: { limit: 25, token }
        });

        const pulled = pullRes?.pulled || 0;
        totalPulled += pulled;
        totalImported += pullRes?.imported_new || 0;
        hasMore = Boolean(pullRes?.has_more);

        if (showOverlay && pulled > 0) {
          const detail = `Imported ${totalImported} new cards from cloud...`;
          this.overlay.updateProgress(totalImported, totalImported, detail);
          if (typeof onProgress === 'function') onProgress(totalImported, totalImported, detail);
        }

        if (pulled === 0 || pullRes?.error) break;
      }

      // 4. Synchronize study progress & activity
      try {
        await this.api.request('/api/cloud/sync/progress', {
          method: 'POST',
          body: { token }
        });
      } catch (_) {}

      if (showOverlay && (totalPushed > 0 || totalImported > 0)) {
        this.overlay.updateProgress(100, 100, 'Sync complete!');
        setTimeout(() => this.overlay.hide(), 800);
      } else if (showOverlay) {
        this.overlay.hide();
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
        this.overlay.updateProgress(0, 0, 'Sync paused. Retrying automatically.');
        setTimeout(() => this.overlay.hide(), 1200);
      }
      return { ok: false, error: err?.message || String(err) };
    } finally {
      this.isSyncing = false;
    }
  }
}

