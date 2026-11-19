import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncLoaderOverlay } from '../src/ui/components/sync_loader.js';
import { ReviewSettingsModal } from '../src/ui/components/review_settings_modal.js';

test('SyncLoaderOverlay generates HTML with animated book SVG', () => {
  const overlay = new SyncLoaderOverlay();
  const html = overlay.renderHtml('Syncing with Anki...', 'Importing existing reviews');
  assert.ok(html.includes('book-wrapper'));
  assert.ok(html.includes('book-page'));
  assert.ok(html.includes('Syncing with Anki...'));
});

test('SyncLoaderOverlay generates HTML with Pacman animation and progress bar', () => {
  const overlay = new SyncLoaderOverlay();
  const html = overlay.renderHtml('Syncing with Kiroku Cloud...', 'Uploading card 5 of 20', 5, 20);
  assert.ok(html.includes('pacman3351'));
  assert.ok(html.includes('pacman-loader-wrap'));
  assert.ok(html.includes('sync-progress-bar-container'));
  assert.ok(html.includes('sync-progress-bar-fill'));
  assert.ok(html.includes('5 / 20 (25%)'));
});

test('ReviewSettingsModal renders plain English explanations', () => {
  const modal = new ReviewSettingsModal({
    values: { new_cards_per_day: 20, easy_initial_cap_days: 6 },
    explanations: {
      new_cards_per_day: 'How many brand new words to learn each day.',
      easy_initial_cap_days: 'Caps the initial interval for new cards marked Easy.'
    }
  });
  const html = modal.render();
  assert.ok(html.includes('How many brand new words to learn each day.'));
  assert.ok(html.includes('Caps the initial interval'));
  assert.ok(html.includes('setting-deck-select'));
  assert.ok(html.includes('btn-create-deck-trigger'));
  assert.ok(html.includes('btn-modal-unbury'));
});
