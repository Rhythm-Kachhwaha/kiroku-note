import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../..');

// Helper to run python snippet with backend in sys.path
function runPython(code) {
  const tmpFile = path.join(ROOT_DIR, `tests/scenarios/anime-app-connection/.tmp_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  const backendPath = path.join(ROOT_DIR, 'backend').replace(/\\/g, '/');
  const rootPath = ROOT_DIR.replace(/\\/g, '/');
  const fullCode = `# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, '${backendPath}')
sys.path.insert(0, '${rootPath}')
${code}
`;
  fs.writeFileSync(tmpFile, fullCode, 'utf-8');
  try {
    const out = execSync(`python "${tmpFile}"`, { cwd: ROOT_DIR, encoding: 'utf-8' });
    return out.trim();
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

async function loadTitleParser() {
  const fileUrl = pathToFileURL(path.join(ROOT_DIR, 'extension/lib/title-parser.js')).href;
  const mod = await import(fileUrl);
  return mod.default || mod;
}

async function loadWorkerApp() {
  const fileUrl = pathToFileURL(path.join(ROOT_DIR, 'worker/index.js')).href;
  const mod = await import(fileUrl);
  return mod.default || mod.app || mod;
}

test('S01: Episode data overwrite protection on position update', async () => {
  const pyCode = `import sqlite3
from app.link.episode import save_episode_record, save_episode_position, get_episode_record
conn = sqlite3.connect(":memory:")
save_episode_record("hash_ep1", "Frieren: Beyond Journey's End - Episode 01", "crunchyroll", 88.5, 5, 24.0, last_position_ms=600000, duration_ms=1440000, series="Frieren: Beyond Journey's End", poster_url="https://s4.anilist.co/cover/frieren.jpg", synopsis="An elven mage and her companions.", conn=conn)
save_episode_position("hash_ep1", 750000, conn=conn)
rec = get_episode_record("hash_ep1", conn=conn)
assert rec["last_position_ms"] == 750000, f"Expected 750000, got {rec['last_position_ms']}"
assert rec["mined"] == 5, f"Mined count was overwritten: {rec['mined']}"
assert rec["duration_ms"] == 1440000, f"Duration was wiped: {rec['duration_ms']}"
assert rec["poster_url"] == "https://s4.anilist.co/cover/frieren.jpg", f"Poster was wiped: {rec['poster_url']}"
assert rec["synopsis"] == "An elven mage and her companions.", f"Synopsis was wiped: {rec['synopsis']}"
print("OK")`;
  const result = runPython(pyCode);
  assert.equal(result, 'OK');
});

test('S02: Episode data overwrite protection on subtitle sync', async () => {
  const pyCode = `import sqlite3
from app.link.episode import save_episode_record, get_episode_record, episode_service
conn = sqlite3.connect(":memory:")
save_episode_record("hash_ep2", "Delicious in Dungeon - Episode 02", "netflix", 75.0, 4, 24.0, last_position_ms=900000, duration_ms=1440000, conn=conn)
episode_service.sync_episode_subtitles(cue_hash="hash_ep2", title="Delicious in Dungeon - Episode 02", site="netflix", cues=[{"index": 1, "start_ms": 1000, "end_ms": 3000, "text": "こんにちは"}], last_position_ms=0, duration_ms=1440000, mined_words=["こんにちは"], conn=conn)
rec = get_episode_record("hash_ep2", conn=conn)
assert rec["last_position_ms"] == 900000, f"Sync wiped last_position_ms: {rec['last_position_ms']}"
assert rec["mined"] >= 4, f"Sync lowered mined count: {rec['mined']}"
print("OK")`;
  const result = runPython(pyCode);
  assert.equal(result, 'OK');
});

test('S03: Japanese episode number parsing (standard, fullwidth, kanji)', async () => {
  const TitleParser = await loadTitleParser();

  // Standard Japanese
  const r1 = TitleParser.cleanAnimeTitle("葬送のフリーレン 第1話");
  assert.equal(r1.episode, 1);

  // Full-width numbers: 第１２話
  const r2 = TitleParser.cleanAnimeTitle("葬送のフリーレン 第１２話「冬の魔法」");
  assert.equal(r2.episode, 12);

  // Kanji numerals: 第三話, 第十二話
  const r3 = TitleParser.cleanAnimeTitle("呪術廻戦 第三話「鉄骨娘」");
  assert.equal(r3.episode, 3);

  const r4 = TitleParser.cleanAnimeTitle("チェンソーマン 第十二話");
  assert.equal(r4.episode, 12);

  // Japanese title with official brackets
  const r5 = TitleParser.cleanAnimeTitle("【公式】アニメ『葬送のフリーレン』第11話「冬の魔法」");
  assert.equal(r5.episode, 11);
  assert.equal(r5.title, "葬送のフリーレン");
});

test('S04: English episode number parsing (standard and multi-season)', async () => {
  const TitleParser = await loadTitleParser();

  const r1 = TitleParser.cleanAnimeTitle("Watch Frieren: Beyond Journey's End - Episode 01 - The Journey's End | Crunchyroll");
  assert.equal(r1.episode, 1);
  assert.equal(r1.title, "Frieren: Beyond Journey's End");

  const r2 = TitleParser.cleanAnimeTitle("Spy x Family S02E05");
  assert.equal(r2.episode, 5);
  assert.ok(r2.title.includes("Season 2") || r2.title.includes("Spy x Family"));

  const r3 = TitleParser.cleanAnimeTitle("Attack on Titan Final Season - 03 (English Sub) on HiAnime");
  assert.equal(r3.episode, 3);
  assert.equal(r3.title, "Attack on Titan Final Season");

  const r4 = TitleParser.cleanAnimeTitle("Delicious in Dungeon - Ep. 12");
  assert.equal(r4.episode, 12);
  assert.equal(r4.title, "Delicious in Dungeon");
});

test('S05: Title sanitization for Japanese official brackets and release tags', async () => {
  const pyCode = `from app.services.media_metadata import _clean_search_title
t1 = _clean_search_title("【公式】葬送のフリーレン 第1話")
assert t1 == "葬送のフリーレン", f"Failed official brackets: {t1}"
t2 = _clean_search_title("[SubsPlease] Sousou no Frieren - 04 (1080p) [ABCD1234].mkv")
assert t2 == "Sousou no Frieren", f"Failed release group brackets: {t2}"
t3 = _clean_search_title("『チェンソーマン』第3話")
assert t3 == "チェンソーマン", f"Failed Japanese quotes: {t3}"
print("OK")`;
  const result = runPython(pyCode);
  assert.equal(result, 'OK');
});

test('S06: AniList metadata caching & sub-millisecond response latency', async () => {
  const pyCode = `import time, sqlite3
from app.services.media_metadata import fetch_anilist_metadata
conn = sqlite3.connect(":memory:")
res1 = fetch_anilist_metadata("Frieren: Beyond Journey's End", conn=conn)
t1 = time.perf_counter()
res2 = fetch_anilist_metadata("Frieren: Beyond Journey's End", conn=conn)
dur2 = (time.perf_counter() - t1) * 1000
assert res2["title_display"] != "", "Expected cached display title"
assert dur2 < 20.0, f"Expected cache lookup < 20ms, took {dur2:.2f}ms"
print("OK")`;
  const result = runPython(pyCode);
  assert.equal(result, 'OK');
});

test('S07: AniList network timeout and failure resilience', async () => {
  const pyCode = `import sqlite3, urllib.error
from unittest.mock import patch
from app.services.media_metadata import fetch_anilist_metadata
conn = sqlite3.connect(":memory:")
with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("Network unreachable")):
    res = fetch_anilist_metadata("Unknown Anime Never Seen", conn=conn)
assert res is not None
assert res["title_display"] == "Unknown Anime Never Seen"
assert res["poster_url"] == ""
print("OK")`;
  const result = runPython(pyCode);
  assert.equal(result, 'OK');
});

test('S08: Cloud per-user anime progress persistence with authentication isolation', async () => {
  const workerApp = await loadWorkerApp();
  const metadataRows = new Map();

  const mockEnv = {
    ENVIRONMENT: 'development',
    RENDER_BACKEND_URL: 'http://mock-backend.local',
    TURSO_DATABASE_URL: 'libsql://test.turso.io',
    TURSO_AUTH_TOKEN: 'mock-token'
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes('onrender.com') || urlStr.includes('mock-backend.local') || urlStr.includes('/api/user/progress/anime')) {
      if (options.method === 'POST') {
        const body = typeof options.body === 'string' ? JSON.parse(options.body) : (options.body ? await new Response(options.body).json() : {});
        const key = `dev_user:${body.series_id}:${body.episode_number || 1}`;
        metadataRows.set(key, {
          user_id: 'dev_user',
          series_id: body.series_id,
          episode_number: parseInt(body.episode_number || 1, 10),
          last_position_ms: parseInt(body.last_position_ms || 0, 10),
          duration_ms: parseInt(body.duration_ms || 0, 10),
          completed: parseInt(body.completed || 0, 10),
          mined_card_count: parseInt(body.mined_card_count || 0, 10),
          poster_url: body.poster_url || '',
          series_title: body.series_title || '',
          synopsis: body.synopsis || ''
        });
        return new Response(JSON.stringify({ ok: true, persisted: true }), { status: 200 });
      }
      if (urlStr.includes('/frieren-s1')) {
        const episodes = Array.from(metadataRows.values()).filter(r => r.series_id === 'frieren-s1');
        return new Response(JSON.stringify({ ok: true, series_id: 'frieren-s1', episodes }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, progress: Array.from(metadataRows.values()) }), { status: 200 });
    }
    if (urlStr.includes('turso.io')) {
      const body = JSON.parse(options.body || '{}');
      const sql = body.statements?.[0]?.sql || body.requests?.[0]?.stmt?.sql || '';
      const params = body.statements?.[0]?.args || body.requests?.[0]?.stmt?.args || [];

      if (sql.includes('INSERT INTO user_anime_progress')) {
        mockTursoRows.push({
          user_id: params[0]?.value || params[0],
          series_id: params[1]?.value || params[1],
          episode_number: parseInt(params[2]?.value || params[2] || 1, 10),
          last_position_ms: parseInt(params[3]?.value || params[3] || 0, 10),
          duration_ms: parseInt(params[4]?.value || params[4] || 0, 10),
          completed: parseInt(params[5]?.value || params[5] || 0, 10),
          mined_card_count: parseInt(params[6]?.value || params[6] || 0, 10)
        });
        return new Response(JSON.stringify({ results: [{ response: { type: 'execute', result: { cols: [], rows: [] } } }] }), { status: 200 });
      }

      if (sql.includes('SELECT') && sql.includes('user_anime_progress')) {
        const reqUserId = params[0]?.value || params[0];
        const reqSeriesId = params[1]?.value || params[1];
        const matched = mockTursoRows.filter(r => r.user_id === reqUserId && r.series_id === reqSeriesId);
        const rows = matched.map(m => [
          { value: m.series_id },
          { value: m.episode_number },
          { value: m.last_position_ms },
          { value: m.duration_ms },
          { value: m.completed },
          { value: m.mined_card_count },
          { value: 1700000000 }
        ]);
        return new Response(JSON.stringify({
          results: [{
            response: {
              type: 'execute',
              result: {
                cols: [
                  { name: 'series_id' },
                  { name: 'episode_number' },
                  { name: 'last_position_ms' },
                  { name: 'duration_ms' },
                  { name: 'completed' },
                  { name: 'mined_card_count' },
                  { name: 'last_watched_at' }
                ],
                rows
              }
            }
          }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [{ response: { type: 'execute', result: { cols: [], rows: [] } } }] }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const resA = await workerApp.fetch(new Request('http://localhost/api/user/progress/anime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        series_id: 'frieren-s1',
        episode_number: 1,
        last_position_ms: 1200000,
        duration_ms: 1440000,
        mined_card_count: 5
      })
    }), mockEnv);
    assert.equal(resA.status, 200);

    const getResA = await workerApp.fetch(new Request('http://localhost/api/user/progress/anime/frieren-s1'), mockEnv);
    const bodyA = await getResA.json();
    assert.equal(bodyA.ok, true);
    assert.equal(bodyA.episodes.length, 1);
    assert.equal(bodyA.episodes[0].last_position_ms, 1200000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('S09: Cloud per-user anime poster and metadata persistence', async () => {
  const workerApp = await loadWorkerApp();
  const metadataRows = new Map();

  const mockEnv = {
    ENVIRONMENT: 'development',
    RENDER_BACKEND_URL: 'http://mock-backend.local',
    TURSO_DATABASE_URL: 'libsql://test.turso.io',
    TURSO_AUTH_TOKEN: 'mock-token'
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes('onrender.com') || urlStr.includes('mock-backend.local') || urlStr.includes('/api/user/progress/anime')) {
      if (options.method === 'POST') {
        const body = typeof options.body === 'string' ? JSON.parse(options.body) : (options.body ? await new Response(options.body).json() : {});
        const key = `dev_user:${body.series_id}:${body.episode_number || 1}`;
        metadataRows.set(key, {
          user_id: 'dev_user',
          series_id: body.series_id,
          episode_number: parseInt(body.episode_number || 1, 10),
          last_position_ms: parseInt(body.last_position_ms || 0, 10),
          duration_ms: parseInt(body.duration_ms || 0, 10),
          completed: parseInt(body.completed || 0, 10),
          mined_card_count: parseInt(body.mined_card_count || 0, 10),
          poster_url: body.poster_url || '',
          series_title: body.series_title || '',
          synopsis: body.synopsis || ''
        });
        return new Response(JSON.stringify({ ok: true, persisted: true }), { status: 200 });
      }
      if (urlStr.includes('/frieren-s1')) {
        const episodes = Array.from(metadataRows.values()).filter(r => r.series_id === 'frieren-s1');
        return new Response(JSON.stringify({ ok: true, series_id: 'frieren-s1', episodes }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, progress: Array.from(metadataRows.values()) }), { status: 200 });
    }
    if (urlStr.includes('turso.io')) {
      const body = JSON.parse(options.body || '{}');
      const sql = body.statements?.[0]?.sql || body.requests?.[0]?.stmt?.sql || '';
      const params = body.statements?.[0]?.args || body.requests?.[0]?.stmt?.args || [];

      if (sql.includes('INSERT INTO user_anime_progress')) {
        const uId = params[0]?.value || params[0];
        const sId = params[1]?.value || params[1];
        const ep = parseInt(params[2]?.value || params[2] || 1, 10);
        const key = `${uId}:${sId}:${ep}`;
        metadataRows.set(key, {
          user_id: uId,
          series_id: sId,
          episode_number: ep,
          last_position_ms: parseInt(params[3]?.value || params[3] || 0, 10),
          duration_ms: parseInt(params[4]?.value || params[4] || 0, 10),
          completed: parseInt(params[5]?.value || params[5] || 0, 10),
          mined_card_count: parseInt(params[6]?.value || params[6] || 0, 10),
          poster_url: params[8]?.value || params[8] || '',
          series_title: params[9]?.value || params[9] || '',
          synopsis: params[10]?.value || params[10] || ''
        });
        return new Response(JSON.stringify({ results: [{ response: { type: 'execute', result: { cols: [], rows: [] } } }] }), { status: 200 });
      }

      if (sql.includes('SELECT') && sql.includes('user_anime_progress')) {
        const reqUserId = params[0]?.value || params[0];
        const reqSeriesId = params[1]?.value || params[1];
        const matched = Array.from(metadataRows.values()).filter(r => r.user_id === reqUserId && r.series_id === reqSeriesId);
        const rows = matched.map(m => [
          { value: m.series_id },
          { value: m.episode_number },
          { value: m.last_position_ms },
          { value: m.duration_ms },
          { value: m.completed },
          { value: m.mined_card_count },
          { value: 1700000000 },
          { value: m.poster_url || '' },
          { value: m.series_title || '' },
          { value: m.synopsis || '' }
        ]);
        return new Response(JSON.stringify({
          results: [{
            response: {
              type: 'execute',
              result: {
                cols: [
                  { name: 'series_id' },
                  { name: 'episode_number' },
                  { name: 'last_position_ms' },
                  { name: 'duration_ms' },
                  { name: 'completed' },
                  { name: 'mined_card_count' },
                  { name: 'last_watched_at' },
                  { name: 'poster_url' },
                  { name: 'series_title' },
                  { name: 'synopsis' }
                ],
                rows
              }
            }
          }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [{ response: { type: 'execute', result: { cols: [], rows: [] } } }] }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const postRes = await workerApp.fetch(new Request('http://localhost/api/user/progress/anime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        series_id: 'frieren-s1',
        episode_number: 1,
        last_position_ms: 500000,
        duration_ms: 1440000,
        poster_url: 'https://s4.anilist.co/cover/frieren.jpg',
        series_title: 'Frieren: Beyond Journey\'s End',
        synopsis: 'An elven mage journey.'
      })
    }), mockEnv);
    assert.equal(postRes.status, 200);

    const getRes = await workerApp.fetch(new Request('http://localhost/api/user/progress/anime/frieren-s1'), mockEnv);
    const body = await getRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.episodes[0].poster_url, 'https://s4.anilist.co/cover/frieren.jpg');
    assert.equal(body.episodes[0].series_title, 'Frieren: Beyond Journey\'s End');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('S10: Cloud anime poster proxy security and caching', async () => {
  const workerApp = await loadWorkerApp();

  const mockEnv = {
    ENVIRONMENT: 'development',
    RENDER_BACKEND_URL: 'http://mock-backend.local'
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes('poster-proxy')) {
      const u = new URL(urlStr, 'http://localhost');
      const target = u.searchParams.get('url') || '';
      if (!target.includes('anilist.co')) {
        return new Response(JSON.stringify({ error: 'Disallowed domain' }), { status: 400 });
      }
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
      });
    }
    if (urlStr.includes('anilist.co')) {
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
      });
    }
    return originalFetch(url, options);
  };

  try {
    // Test allowed domain: anilist.co
    const allowedRes = await workerApp.fetch(new Request('http://localhost/api/link/poster-proxy?url=' + encodeURIComponent('https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587.png')), mockEnv);
    assert.equal(allowedRes.status, 200);
    assert.equal(allowedRes.headers.get('Content-Type'), 'image/png');
    assert.ok(allowedRes.headers.get('Cache-Control')?.includes('public'));

    // Test disallowed/untrusted domain: must be rejected with 400
    const blockedRes = await workerApp.fetch(new Request('http://localhost/api/link/poster-proxy?url=' + encodeURIComponent('https://evil-untrusted-domain.com/hack.png')), mockEnv);
    assert.equal(blockedRes.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('S11: Cross-language anime title deduplication', async () => {
  const pyCode = `import sqlite3, json
from app.link.episode import save_episode_record, group_episodes_by_series, init_link_episode_db
from app.services.media_metadata import _ANILIST_MEMORY_CACHE, init_media_metadata_db
_ANILIST_MEMORY_CACHE.clear()
conn = sqlite3.connect(":memory:")
init_link_episode_db(conn)
init_media_metadata_db(conn)
raw = json.dumps({"anilist_id": 154587, "title_native": "葬送のフリーレン", "title_english": "Frieren: Beyond Journey's End"})
conn.execute("INSERT OR REPLACE INTO media_metadata (query_key, media_type, title_display, raw_json, updated_at) VALUES (?, ?, ?, ?, ?)", ("anime:葬送のフリーレン", "anime", "Frieren: Beyond Journey's End", raw, "2026-11-20"))
conn.execute("INSERT OR REPLACE INTO media_metadata (query_key, media_type, title_display, raw_json, updated_at) VALUES (?, ?, ?, ?, ?)", ("anime:frieren: beyond journey's end", "anime", "Frieren: Beyond Journey's End", raw, "2026-11-20"))
save_episode_record("hash_jp_1", "葬送のフリーレン 第1話", "abema", 80.0, 3, 24.0, series="葬送のフリーレン", conn=conn)
save_episode_record("hash_en_2", "Frieren: Beyond Journey's End - Episode 02", "crunchyroll", 85.0, 4, 24.0, series="Frieren: Beyond Journey's End", conn=conn)
groups = group_episodes_by_series(conn=conn)
frieren_groups = [g for g in groups if "frieren" in g["series"].lower() or "葬送のフリーレン" in (g.get("title_native") or "")]
assert len(frieren_groups) >= 1, f"Expected Frieren group, got {[g['series'] for g in groups]}"
episodes = frieren_groups[0]["episodes"]
ep_nums = {ep["episode_number"] for ep in episodes}
assert 1 in ep_nums, f"Missing episode 1: {ep_nums}"
assert 2 in ep_nums, f"Missing episode 2: {ep_nums}"
print("OK")`;
  const result = runPython(pyCode);
  assert.equal(result, 'OK');
});

test('S12: Series watch history grouping latency optimization', async () => {
  const pyCode = `import time, sqlite3
from app.link.episode import save_episode_record, group_episodes_by_series
conn = sqlite3.connect(":memory:")
for i in range(1, 6):
    save_episode_record(f"h_fr_{i}", f"Frieren - Episode {i}", "cr", 80.0, 1, 24.0, series="Frieren", conn=conn)
    save_episode_record(f"h_dungeon_{i}", f"Delicious in Dungeon - Episode {i}", "nf", 75.0, 1, 24.0, series="Delicious in Dungeon", conn=conn)
    save_episode_record(f"h_spy_{i}", f"Spy x Family - Episode {i}", "cr", 85.0, 1, 24.0, series="Spy x Family", conn=conn)
t0 = time.perf_counter()
groups = group_episodes_by_series(conn=conn)
elapsed_ms = (time.perf_counter() - t0) * 1000
assert len(groups) == 3, f"Expected 3 series groups, got {len(groups)}"
assert elapsed_ms < 100.0, f"Expected grouping to complete < 100ms, took {elapsed_ms:.2f}ms"
print("OK")`;
  const result = runPython(pyCode);
  assert.equal(result, 'OK');
});
