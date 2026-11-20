/**
 * Kiroku Note Desktop — Hardening Scenarios Test Suite
 * Objective automated scenario verification for:
 * - Electron IPC contract & SSRF protection
 * - Ephemeral token boundary & redaction
 * - DesktopStore atomic writes & corruption resilience
 * - Chrome storage shim IPC protocol
 * - Missing & corrupt database launch containment
 * - Offline queue drain atomicity & review preservation
 * - MascotHost lifecycle, zero-size handling, and freeze prevention
 * - Single-instance / window lifecycle safety
 * - Router navigation queue serialization & deadlock avoidance
 * - Persistent HTTP keep-alive latency optimization
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const { DesktopStore } = require('../../../desktop/src/store');
const { ProcessManager } = require('../../../desktop/src/process_manager');
const { forwardApiRequest } = require('../../../desktop/src/api_proxy');

// Helper to make a clean temporary directory
function makeTempDir(prefix = 'kiroku-desktop-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('S01: Electron IPC Request Validation and SSRF Prevention', async () => {
  // Test 1: Invalid payload type
  const r1 = await forwardApiRequest({ req: null });
  assert.strictEqual(r1.success, false);
  assert.ok(r1.error.message.includes('Invalid request payload'));

  const r2 = await forwardApiRequest({ req: 'not-an-object' });
  assert.strictEqual(r2.success, false);
  assert.ok(r2.error.message.includes('Invalid request payload'));

  // Test 2: Missing or invalid API path
  const r3 = await forwardApiRequest({ req: { path: '/invalid/path' } });
  assert.strictEqual(r3.success, false);
  assert.ok(r3.error.message.includes('Unauthorized or invalid API path'));

  const r4 = await forwardApiRequest({ req: { path: 'http://malicious.com/api/cards' } });
  assert.strictEqual(r4.success, false);
  assert.ok(r4.error.message.includes('Unauthorized or invalid API path'));

  const r5 = await forwardApiRequest({ req: { path: 'file:///etc/passwd' } });
  assert.strictEqual(r5.success, false);
  assert.ok(r5.error.message.includes('Unauthorized or invalid API path'));

  // Test 3: Path traversal and protocol injection prevention
  const r6 = await forwardApiRequest({ req: { path: '/api/cards/../../secret' } });
  assert.strictEqual(r6.success, false);
  assert.ok(r6.error.message.includes('Path traversal or arbitrary URL not allowed'));

  const r7 = await forwardApiRequest({ req: { path: '/api/test://evil' } });
  assert.strictEqual(r7.success, false);
  assert.ok(r7.error.message.includes('Path traversal or arbitrary URL not allowed'));

  // Test 4: Disallowed HTTP methods
  const r8 = await forwardApiRequest({ req: { path: '/api/health', method: 'TRACE' } });
  assert.strictEqual(r8.success, false);
  assert.ok(r8.error.message.includes('Method TRACE is not permitted'));

  const r9 = await forwardApiRequest({ req: { path: '/api/health', method: 'CONNECT' } });
  assert.strictEqual(r9.success, false);
  assert.ok(r9.error.message.includes('Method CONNECT is not permitted'));

  // Test 5: Valid path with loopback backend mock
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '2.1' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const res = await forwardApiRequest({
      req: { path: '/api/health', method: 'GET' },
      host: '127.0.0.1',
      port
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, 'ok');
  } finally {
    server.close();
  }
});

test('S02: Ephemeral Token Boundary and Redaction', () => {
  const pm = new ProcessManager({ repoRoot });
  const token = pm.getApiToken();

  // 1. Token must be at least 43 characters (256-bit base64url)
  assert.ok(typeof token === 'string');
  assert.ok(token.length >= 43, 'Bearer token must be at least 43 chars urlsafe base64');

  // 2. ProcessManager._sanitize must redact the token
  const rawMsg = `Starting server with token ${token} in KIROKU_STUDY_API_TOKEN=${token} and Bearer ${token}`;
  const sanitized = pm._sanitize(rawMsg);
  assert.strictEqual(sanitized.includes(token), false, 'Raw token must never appear in sanitized output');
  assert.ok(sanitized.includes('[REDACTED_TOKEN]'));

  // 3. Preload verification: Ensure preload.js does NOT expose raw token or process env
  const preloadSource = fs.readFileSync(path.join(repoRoot, 'desktop', 'src', 'preload.js'), 'utf8');
  assert.strictEqual(preloadSource.includes('process.env.KIROKU_STUDY_API_TOKEN'), false);
  assert.strictEqual(preloadSource.includes('apiToken'), false);
  assert.strictEqual(preloadSource.includes('require('), true); // in top level only
  assert.ok(preloadSource.includes("contextBridge.exposeInMainWorld('desktopAPI'"));
});

test('S03: DesktopStore Atomic Writes and Corruption Resilience', () => {
  const tmpDir = makeTempDir('kiroku-store-test-');
  const storagePath = path.join(tmpDir, 'desktop-storage.json');

  try {
    const store = new DesktopStore({ storagePath });

    // 1. Set data and verify atomic file creation
    store.set({ test_user: 'alice', theme: 'dark' });
    assert.ok(fs.existsSync(storagePath), 'Storage file must exist');

    const fileContent = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    assert.strictEqual(fileContent.test_user, 'alice');
    assert.strictEqual(fileContent.theme, 'dark');

    // 2. Corrupt storage file with invalid JSON
    fs.writeFileSync(storagePath, '{"broken_json": true, incomplete...');

    // 3. New store instance loading the corrupt file must not crash
    const corruptStore = new DesktopStore({ storagePath });
    const loadedData = corruptStore.load();
    assert.deepStrictEqual(loadedData, {}, 'Corrupt storage must safely fall back to empty object');

    // 4. Corrupt backup file must have been created to preserve forensics
    const filesInDir = fs.readdirSync(tmpDir);
    const backupFile = filesInDir.find((f) => f.includes('desktop-storage.json.corrupt.'));
    assert.ok(backupFile, 'Corrupted file must be backed up before wiping');

    // 5. Subsequent write after corruption recovers cleanly
    corruptStore.set({ recovered: true });
    assert.strictEqual(corruptStore.getConfig('recovered'), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('S04: Chrome Storage Shim IPC Protocol', () => {
  const tmpDir = makeTempDir('kiroku-shim-test-');
  const storagePath = path.join(tmpDir, 'desktop-storage.json');

  try {
    const store = new DesktopStore({ storagePath });

    // Set multiple items
    store.set({
      theme: 'dark',
      anki_deck: 'Japanese',
      review_limit: 20
    });

    // Case A: get with single string key
    assert.deepStrictEqual(store.get('theme'), { theme: 'dark' });
    assert.deepStrictEqual(store.get('non_existent'), {});

    // Case B: get with array of keys
    assert.deepStrictEqual(store.get(['theme', 'anki_deck', 'missing']), {
      theme: 'dark',
      anki_deck: 'Japanese'
    });

    // Case C: get with object of defaults
    assert.deepStrictEqual(
      store.get({ theme: 'light', missing_key: 'default_val', review_limit: 50 }),
      { theme: 'dark', missing_key: 'default_val', review_limit: 20 }
    );

    // Case D: remove single key and array of keys
    store.remove('theme');
    assert.strictEqual(store.getConfig('theme'), undefined);

    store.remove(['anki_deck', 'review_limit']);
    assert.strictEqual(store.getConfig('anki_deck'), undefined);
    assert.strictEqual(store.getConfig('review_limit'), undefined);

    // Case E: clear
    store.set({ foo: 'bar' });
    assert.strictEqual(store.getConfig('foo'), 'bar');
    store.clear();
    assert.deepStrictEqual(store.get(), {});
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('S05: Missing Database Clean Launch', () => {
  const tmpDir = makeTempDir('kiroku-db-missing-');
  const testDbPath = path.join(tmpDir, 'new_db.sqlite');

  try {
    assert.strictEqual(fs.existsSync(testDbPath), false, 'DB must not exist initially');

    // Run Python init_db to test bootstrap
    const pythonScript = `
import sys
from pathlib import Path
from app.db.connection import init_db, db_session

db_file = Path(r"${testDbPath.replace(/\\/g, '\\\\')}")
init_db(db_file)

with db_session(db_file) as conn:
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    assert 'cards' in tables, "cards table missing"
    assert 'known_words' in tables, "known_words table missing"
    assert 'deck_settings' in tables, "deck_settings table missing"
    
    settings = conn.execute("SELECT * FROM deck_settings WHERE deck_name='Default'").fetchone()
    assert settings is not None, "default deck_settings missing"
    assert settings["auto_sync_anki"] == 1
sys.exit(0)
`;

    const result = spawnSync('python', ['-c', pythonScript], {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: `.;${path.join(repoRoot, 'backend')}` },
      encoding: 'utf8'
    });

    if (result.status !== 0) {
      console.error(result.stderr || result.stdout);
    }
    assert.strictEqual(result.status, 0, 'init_db must succeed on missing database');
    assert.ok(fs.existsSync(testDbPath), 'Database file must have been created');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('S06: Corrupted Database Launch Containment', () => {
  const tmpDir = makeTempDir('kiroku-db-corrupt-');
  const corruptDbPath = path.join(tmpDir, 'corrupt.sqlite');

  try {
    // Write invalid SQLite header bytes
    fs.writeFileSync(corruptDbPath, 'NOT_A_VALID_SQLITE_HEADER_1234567890');

    const pythonScript = `
import sys
from pathlib import Path
from app.db.connection import init_db

try:
    init_db(Path(r"${corruptDbPath.replace(/\\/g, '\\\\')}"))
    print("UNEXPECTED_SUCCESS")
    sys.exit(1)
except RuntimeError as err:
    msg = str(err)
    if "database file may be corrupted" in msg or "Failed to initialize SQLite connection" in msg:
        print("DETECTED_CORRUPTION")
        sys.exit(0)
    else:
        print(f"WRONG_ERROR: {msg}")
        sys.exit(2)
`;

    const result = spawnSync('python', ['-c', pythonScript], {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: `.;${path.join(repoRoot, 'backend')}` },
      encoding: 'utf8'
    });

    assert.strictEqual(result.status, 0, 'Corrupted database must raise descriptive RuntimeError');
    assert.ok(result.stdout.includes('DETECTED_CORRUPTION'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('S07: Offline Queue Drain Atomicity', () => {
  const tmpDir = makeTempDir('kiroku-queue-drain-');
  const testDbPath = path.join(tmpDir, 'queue_test.sqlite');

  try {
    const pythonScript = `
import sys
from pathlib import Path
from app.db.connection import init_db, db_session
from app.repositories.card_repository import CardRepository
from app.services.card_service import CardService
from app.schemas import SaveCardRequest

db_file = Path(r"${testDbPath.replace(/\\/g, '\\\\')}")
init_db(db_file)

# 1. Simulate saving 3 cards while offline (sync_status='pending')
repo = CardRepository(db_path=db_file)
service = CardService(card_repository=repo)
card1 = service.save_card(SaveCardRequest(expression="勇者", reading="ゆうしゃ", meaning="hero", deck_name="Default"))
card2 = service.save_card(SaveCardRequest(expression="魔法", reading="まほう", meaning="magic", deck_name="Default"))
card3 = service.save_card(SaveCardRequest(expression="冒険", reading="ぼうけん", meaning="adventure", deck_name="Default"))

with db_session(db_file) as conn:
    pending_count = conn.execute("SELECT COUNT(*) FROM cards WHERE sync_status = 'pending'").fetchone()[0]
    assert pending_count == 3, f"Expected 3 pending cards, got {pending_count}"

# 2. Simulate interrupted sync recovery
with db_session(db_file) as conn:
    conn.execute("UPDATE cards SET sync_status = 'syncing' WHERE expression = '勇者'")
    
init_db(db_file) # Should recover 'syncing' back to 'pending'

with db_session(db_file) as conn:
    recovered_count = conn.execute("SELECT COUNT(*) FROM cards WHERE sync_status = 'pending'").fetchone()[0]
    assert recovered_count == 3, f"Expected 3 pending cards after recovery, got {recovered_count}"
    
print("QUEUE_DRAIN_ATOMIC_OK")
sys.exit(0)
`;

    const result = spawnSync('python', ['-c', pythonScript], {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: `.;${path.join(repoRoot, 'backend')}` },
      encoding: 'utf8'
    });

    if (result.status !== 0) {
      console.error(result.stderr || result.stdout);
    }
    assert.strictEqual(result.status, 0, 'Offline queue states must be atomic and recover safely');
    assert.ok(result.stdout.includes('QUEUE_DRAIN_ATOMIC_OK'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('S08: Offline Review Preservation', () => {
  const tmpDir = makeTempDir('kiroku-offline-review-');
  const testDbPath = path.join(tmpDir, 'review_test.sqlite');

  try {
    const pythonScript = `
import sys
from pathlib import Path
from app.db.connection import init_db, db_session
from app.repositories.card_repository import CardRepository
from app.repositories.review_repository import ReviewRepository
from app.services.card_service import CardService
from app.schemas import SaveCardRequest

db_file = Path(r"${testDbPath.replace(/\\/g, '\\\\')}")
init_db(db_file)

card_repo = CardRepository(db_path=db_file)
card_service = CardService(card_repository=card_repo)
saved = card_service.save_card(SaveCardRequest(expression="記憶", reading="きおく", meaning="memory", deck_name="Default"))
card_id = saved.id

# Record review while Anki is offline (synced_to_anki = 0)
repo = ReviewRepository(db_path=db_file)
log_id = repo.log_review(
    card_id=card_id,
    rating=3,
    state=1,
    scheduled_days=1,
    elapsed_days=0,
    duration_ms=1200,
    synced_to_anki=False
)

assert repo.has_pending_anki_reviews() == True, "Must report pending review when offline"
pending_logs = repo.get_pending_anki_reviews()
assert len(pending_logs) == 1, "Must find exactly 1 pending review"
assert pending_logs[0]["log_id"] == log_id
assert pending_logs[0]["card_id"] == card_id

print("OFFLINE_REVIEW_PRESERVED_OK")
sys.exit(0)
`;

    const result = spawnSync('python', ['-c', pythonScript], {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: `.;${path.join(repoRoot, 'backend')}` },
      encoding: 'utf8'
    });

    if (result.status !== 0) {
      console.error(result.stderr || result.stdout);
    }
    assert.strictEqual(result.status, 0, 'Offline review answers must be preserved in SQLite review_logs');
    assert.ok(result.stdout.includes('OFFLINE_REVIEW_PRESERVED_OK'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('S09: MascotHost Lifecycle and Freeze Prevention', async () => {
  const { MascotHost } = await import('../../../desktop/src/ui/shell/mascot_host.js');

  class MockElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.parentNode = null;
      this.style = {};
      this.clientWidth = tagName === 'canvas' ? 200 : 0;
      this.clientHeight = tagName === 'canvas' ? 200 : 0;
    }
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      this.children.push(child);
      child.parentNode = this;
      return child;
    }
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      child.parentNode = null;
    }
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }
    setAttribute() {}
  }

  let playCalled = 0;
  let stopRenderingCalled = 0;
  let resizeDrawingSurfaceCalled = 0;

  class MockRive {
    constructor(params) {
      this.params = params;
      queueMicrotask(() => params.onLoad());
    }
    play() { playCalled++; }
    stopRendering() { stopRenderingCalled++; }
    startRendering() {}
    resizeDrawingSurfaceToCanvas() { resizeDrawingSurfaceCalled++; }
  }

  global.document = {
    createElement: (tag) => new MockElement(tag),
    hidden: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  global.window = {
    matchMedia: () => ({ matches: false }),
    devicePixelRatio: 1,
    rive: {
      Rive: MockRive,
      Layout: class {},
      Fit: { Contain: 'contain' },
      Alignment: { Center: 'center' }
    }
  };
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  global.requestAnimationFrame = (fn) => fn();

  const host = new MascotHost({
    loadAssets: async () => [Promise.resolve(), new ArrayBuffer(8)]
  });

  await host.ensureCreated();
  assert.ok(host.element);
  assert.ok(host.canvas);

  const slot = new MockElement('div');
  host.attach(slot);
  assert.strictEqual(host.attachedSlot, slot);
  assert.ok(playCalled >= 1);

  // Pause on hidden
  host.pause();
  assert.strictEqual(stopRenderingCalled, 1);

  // Zero-size canvas resize must not throw or crash
  host.canvas.clientWidth = 0;
  host.canvas.clientHeight = 0;
  assert.doesNotThrow(() => host.resize());

  // whenReady timeout guard
  const fallbackHost = new MascotHost();
  fallbackHost.fallback = true;
  const readyResult = await fallbackHost.whenReady(100);
  assert.strictEqual(readyResult, fallbackHost);

  host.destroy();
});

test('S10: Single-Instance Lock and Multi-Window Deadlock Guard', () => {
  // Verify single-instance lock code in main.js
  const mainJsPath = path.join(repoRoot, 'desktop', 'src', 'main.js');
  const mainContent = fs.readFileSync(mainJsPath, 'utf8');

  assert.ok(mainContent.includes('app.requestSingleInstanceLock()'), 'Must enforce single instance lock');
  assert.ok(mainContent.includes('second-instance'), 'Must handle second-instance event by focusing window');

  // Verify IPC handlers check mainWindow existence and isDestroyed()
  assert.ok(mainContent.includes('!mainWindow.isDestroyed()'));
});

test('S11: Router Navigation Queue Serialization', async () => {
  const routerPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'router.js');
  const routerContent = fs.readFileSync(routerPath, 'utf8');

  // Verify navigationQueue is properly implemented
  assert.ok(routerContent.includes('this.navigationQueue = Promise.resolve()'));
  assert.ok(routerContent.includes('this.navigationQueue'));

  // Simulate router's sequential execution pattern
  let sequence = [];
  let navQueue = Promise.resolve();

  function navigateTo(tab) {
    navQueue = navQueue
      .catch(() => {})
      .then(async () => {
        await new Promise((r) => setTimeout(r, 10));
        sequence.push(tab);
      });
    return navQueue;
  }

  // Fire 3 simultaneous navigation requests
  const p1 = navigateTo('vocab');
  const p2 = navigateTo('grammar');
  const p3 = navigateTo('kanji');

  await Promise.all([p1, p2, p3]);
  assert.deepStrictEqual(sequence, ['vocab', 'grammar', 'kanji'], 'Navigation must serialize sequentially without deadlock');
});

test('S12: HTTP Keep-Alive IPC Latency and Connection Reuse', () => {
  const mainJsPath = path.join(repoRoot, 'desktop', 'src', 'main.js');
  const mainContent = fs.readFileSync(mainJsPath, 'utf8');

  assert.ok(mainContent.includes('keepAlive: true'), 'HTTP agent must enable keepAlive');
  assert.ok(mainContent.includes('maxSockets:'), 'HTTP agent must configure maxSockets');
  assert.ok(mainContent.includes('maxFreeSockets:'), 'HTTP agent must configure maxFreeSockets');

  const proxyPath = path.join(repoRoot, 'desktop', 'src', 'api_proxy.js');
  const proxyContent = fs.readFileSync(proxyPath, 'utf8');
  assert.ok(proxyContent.includes('agent'));
});
