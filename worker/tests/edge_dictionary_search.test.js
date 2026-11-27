import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

const { default: worker } = await import('../index.js');

function makeZlibHex(obj) {
  const buf = zlib.deflateSync(Buffer.from(JSON.stringify(obj), 'utf8'));
  return '\\x' + buf.toString('hex');
}

function withMockedFetch(handler, fn) {
  const origFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = origFetch;
    });
}

const BASE_ENV = {
  ENVIRONMENT: 'production',
  NEON_SQL_URL: 'https://mock.neon.tech/sql',
  NEON_DATABASE_URL: 'postgresql://mock:mock@mock.neon.tech/neondb',
  RENDER_BACKEND_URL: 'https://mock-render.invalid',
};

test('GET /api/dictionary/search-english resolves Japanese query from Neon terms without Render', async () => {
  let renderCalled = false;
  const blobHex = makeZlibHex([
    { tag: 'ul', content: [{ tag: 'li', content: 'no eating or drinking' }] },
  ]);

  await withMockedFetch(async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes('mock-render.invalid')) {
      renderCalled = true;
      return new Response('should not hit render', { status: 500 });
    }
    if (urlStr.includes('mock.neon.tech/sql')) {
      const body = JSON.parse(opts.body);
      if (body.query.includes('FROM jlpt_vocab')) {
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }
      if (body.query.includes('FROM terms')) {
        return new Response(JSON.stringify({
          rows: [{
            term: '飲食禁止',
            reading: 'いんしょくきんし',
            score: 100,
            content_blob: blobHex,
          }],
        }), { status: 200 });
      }
    }
    return new Response('{}', { status: 404 });
  }, async () => {
    const req = new Request('https://kiroku-note.test/api/dictionary/search-english?query=' + encodeURIComponent('いんしょくきんし'));
    const res = await worker.fetch(req, BASE_ENV);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(renderCalled, false);
    assert.equal(data.count, 1);
    assert.equal(data.entries[0].term, '飲食禁止');
    assert.equal(data.entries[0].reading, 'いんしょくきんし');
    assert.match(data.entries[0].meaning, /no eating or drinking/);
  });
});

test('GET /api/dictionary/search-english resolves English query from Neon jlpt_vocab without Render', async () => {
  let renderCalled = false;

  await withMockedFetch(async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes('mock-render.invalid')) {
      renderCalled = true;
      return new Response('should not hit render', { status: 500 });
    }
    if (urlStr.includes('mock.neon.tech/sql')) {
      return new Response(JSON.stringify({
        rows: [{
          word: '食べる',
          reading: 'たべる',
          meanings: JSON.stringify(['to eat']),
          level: 'N5',
        }],
      }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }, async () => {
    const req = new Request('https://kiroku-note.test/api/dictionary/search-english?query=eat');
    const res = await worker.fetch(req, BASE_ENV);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(renderCalled, false);
    assert.equal(data.entries[0].term, '食べる');
    assert.equal(data.entries[0].jlpt_level, 'N5');
  });
});

test('GET /api/dictionary/lookup and POST /api/capture (preview) resolve from Neon without Render', async () => {
  let renderCalls = 0;
  const blobHex = makeZlibHex([
    { tag: 'ul', content: [{ tag: 'li', content: 'no eating or drinking' }] },
  ]);

  await withMockedFetch(async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes('mock-render.invalid')) {
      renderCalls++;
      return new Response(JSON.stringify({ status: 'render-saved' }), { status: 200 });
    }
    if (urlStr.includes('mock.neon.tech/sql')) {
      const body = JSON.parse(opts.body);
      if (body.query.includes('FROM terms')) {
        return new Response(JSON.stringify({
          rows: [{
            term: '飲食禁止',
            reading: 'いんしょくきんし',
            dictionary: 'Jitendex.org',
            score: 100,
            def_tags: '',
            term_tags: '',
            content_blob: blobHex,
          }],
        }), { status: 200 });
      }
      if (body.query.includes('FROM jlpt_vocab')) {
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }
      if (body.query.includes('FROM kanji')) {
        return new Response(JSON.stringify({
          rows: [{ character: '飲', onyomi: 'イン', kunyomi: 'の.む', meanings_json: '["drink"]' }],
        }), { status: 200 });
      }
    }
    return new Response('{}', { status: 404 });
  }, async () => {
    // 1. GET /api/dictionary/lookup
    const lookupRes = await worker.fetch(
      new Request('https://kiroku-note.test/api/dictionary/lookup?term=' + encodeURIComponent('いんしょくきんし')),
      BASE_ENV
    );
    assert.equal(lookupRes.status, 200);
    const lookupData = await lookupRes.json();
    assert.equal(lookupData.expression, '飲食禁止');
    assert.equal(lookupData.entries.length, 1);
    assert.equal(lookupData.kanji[0].character, '飲');
    assert.equal(renderCalls, 0);

    // 2. POST /api/capture without auto_save -> Edge Neon
    const previewRes = await worker.fetch(
      new Request('https://kiroku-note.test/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'いんしょくきんし', auto_save: false }),
      }),
      BASE_ENV
    );
    assert.equal(previewRes.status, 200);
    const previewData = await previewRes.json();
    assert.equal(previewData.expression, '飲食禁止');
    assert.equal(renderCalls, 0);

    // 3. POST /api/capture with auto_save: true -> Render
    const saveRes = await worker.fetch(
      new Request('https://kiroku-note.test/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'いんしょくきんし', auto_save: true }),
      }),
      BASE_ENV
    );
    assert.equal(saveRes.status, 200);
    assert.equal(renderCalls, 1);
  });
});
