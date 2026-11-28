const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

test('ApiClient.getKanjiStrokes handles image/svg+xml responses in cloud/PWA mode', async () => {
  const apiClientUrl = pathToFileURL(path.join(ROOT_DIR, 'desktop', 'src', 'ui', 'services', 'api_client.js')).href;
  const { ApiClient } = await import(apiClientUrl);

  const svgPayload = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 109 109"><path d="M 10 10 L 90 90"/></svg>';
  const originalFetch = global.fetch;
  const originalWindow = global.window;

  global.window = {
    location: {
      origin: 'https://kiroku-note.rhythmkach.workers.dev',
      protocol: 'https:',
      hostname: 'kiroku-note.rhythmkach.workers.dev',
    },
  };
  global.fetch = async (url, init) => {
    assert.ok(url.endsWith('/api/kanji/strokes/%E5%8C%96'));
    assert.ok(init.headers.Accept.includes('image/svg+xml'));
    return new Response(svgPayload, {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' },
    });
  };

  try {
    const client = new ApiClient();
    const res = await client.getKanjiStrokes('化');
    assert.equal(res, svgPayload);
  } finally {
    global.fetch = originalFetch;
    global.window = originalWindow;
  }
});

test('KanjiView removes grade pill and handles missing SVG cleanly', () => {
  const kanjiPath = path.join(ROOT_DIR, 'desktop', 'src', 'ui', 'views', 'kanji.js');
  const content = fs.readFileSync(kanjiPath, 'utf8');

  assert.equal(content.includes('id="kanji-grade"'), false, 'kanji-grade pill must be removed');
  assert.equal(content.includes('Grade ${details.grade}'), false, 'Grade label formatting must be removed');
  assert.ok(
    content.includes("!svgText.includes('<svg')"),
    'renderStrokeCanvas must guard against non-SVG responses'
  );
});

test('Worker kanji strokes route queries both character and padded hex codepoint', () => {
  const workerPath = path.join(ROOT_DIR, 'worker', 'index.js');
  const content = fs.readFileSync(workerPath, 'utf8');
  assert.ok(content.includes("padStart(5, '0')"), 'worker must check 5-digit KanjiVG codepoint');
  assert.ok(content.includes('codepoint = $2'), 'worker query must match codepoint = $2');
});

test('build_pwa hashes all UI source files so any UI edit bumps SW cache', () => {
  const buildPwa = require(path.join(ROOT_DIR, 'tools', 'build_pwa.js'));
  const content = fs.readFileSync(path.join(ROOT_DIR, 'tools', 'build_pwa.js'), 'utf8');
  assert.ok(content.includes('collectUiSourceFiles'), 'build_pwa must collect all UI files');
  const h = buildPwa.computeBuildHash();
  assert.equal(typeof h, 'string');
  assert.equal(h.length, 10);
});
