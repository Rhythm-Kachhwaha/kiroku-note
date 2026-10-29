const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DesktopStore } = require('../src/store');

test('DesktopStore: load, set, get, remove, and clear operations', () => {
  const tmpFile = path.join(os.tmpdir(), `kiroku_store_test_${Date.now()}.json`);

  try {
    const store = new DesktopStore({ storagePath: tmpFile });
    assert.deepEqual(store.get(), {});

    // Set items
    store.set({ 'theme': 'dark', 'font': 'Noto Sans JP', 'count': 42 });

    // Get single key
    assert.deepEqual(store.get('theme'), { theme: 'dark' });

    // Get array of keys
    assert.deepEqual(store.get(['theme', 'count']), { theme: 'dark', count: 42 });

    // Get object with defaults
    assert.deepEqual(store.get({ theme: 'light', missing: 'default_val' }), {
      theme: 'dark',
      missing: 'default_val'
    });

    // Check persistence to disk
    const raw = fs.readFileSync(tmpFile, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.theme, 'dark');
    assert.equal(parsed.count, 42);

    // Remove key
    store.remove('font');
    assert.equal(store.get('font').font, undefined);

    // Clear store
    store.clear();
    assert.deepEqual(store.get(), {});
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }
});

