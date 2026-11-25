import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import workerApp from '../index.js';

function signHs256Jwt(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

test('Worker edge anime routes serve series cards, episode inspect, and anime progress from Turso', async () => {
  const secret = 'test_jwt_secret_123456';
  const token = signHs256Jwt(
    { sub: 'user_kon_1', email: 'rhythm@example.com', exp: Math.floor(Date.now() / 1000) + 3600 },
    secret
  );
  const env = {
    ENVIRONMENT: 'production',
    JWT_SECRET: secret,
    TURSO_DATABASE_URL: 'libsql://test-db.turso.io',
    TURSO_AUTH_TOKEN: 'turso_token',
    RENDER_BACKEND_URL: 'https://invalid-render-host.example.invalid',
  };

  const tursoQueries = [];
  const originalFetch = globalThis.fetch;

  const sampleCues = [
    {
      i: 0,
      s: 1.0,
      e: 3.5,
      text: '軽音部に入部したいです。',
      image: 'data:image/jpeg;base64,/9j/4AAQ',
      tokens: [
        { surface: '軽音部', lemma: '軽音部', reading: 'けいおんぶ', pos: '名詞', jlpt_level: 'N2', meaning: 'light music club', status: 'gap' },
        { surface: 'に', lemma: 'に', reading: 'に', pos: '助詞' },
        { surface: '入部', lemma: '入部', reading: 'にゅうぶ', pos: '名詞', jlpt_level: 'N3', meaning: 'joining a club', status: 'gap' },
        { surface: 'し', lemma: 'する', reading: 'する', pos: '動詞', jlpt_level: 'N5', status: 'known' },
      ],
    },
  ];

  const sampleCardPayload = {
    id: 'card_kon_1',
    expression: '軽音部',
    reading: 'けいおんぶ',
    meaning: 'light music club',
    image: 'data:image/jpeg;base64,/9j/FRAME1',
    example_sentence: '軽音部に入部したいです。',
    source_text: 'K-ON! Episode 1',
    source_url: 'https://anime.example/k-on-episode-1',
    tags: 'anime, K-ON!',
    deck_name: 'Japanese::Anime',
    created_at: '2026-11-25T10:00:00Z',
  };

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('invalid-render-host.example.invalid')) {
      throw new Error('Should NOT proxy edge-handled anime routes to Render');
    }
    if (u.includes('/v2/pipeline')) {
      const body = JSON.parse(init.body || '{}');
      const requests = body.requests || [];
      const results = requests.map((req) => {
        const sql = req?.stmt?.sql || '';
        const args = (req?.stmt?.args || []).map((a) => a?.value ?? null);
        tursoQueries.push({ sql, args });

        if (sql.includes('FROM user_episode_cues') && sql.includes('cue_hash = ?')) {
          return {
            type: 'ok',
            response: {
              type: 'execute',
              result: {
                rows: [[
                  { value: 'kon_ep1_hash' },
                  { value: 'K-ON! Episode 1' },
                  { value: 'K-ON!' },
                  { value: '1' },
                  { value: 'kon-1' },
                  { value: 'generic' },
                  { value: 'anime' },
                  { value: JSON.stringify(sampleCues) },
                  { value: '1440000' },
                  { value: JSON.stringify(['部活']) },
                  { value: '42.5' },
                  { value: '1' },
                  { value: '1700000000000' },
                ]],
              },
            },
          };
        }

        if (sql.includes('FROM user_episode_cues') && sql.includes('series = ?')) {
          return {
            type: 'ok',
            response: {
              type: 'execute',
              result: {
                rows: [[{ value: 'kon_ep1_hash' }]],
              },
            },
          };
        }

        if (sql.includes('FROM user_anime_progress') && sql.includes('ORDER BY')) {
          return {
            type: 'ok',
            response: {
              type: 'execute',
              result: {
                rows: [[
                  { value: 'K-ON!' },
                  { value: '1' },
                  { value: '600000' },
                  { value: '1440000' },
                  { value: '0' },
                  { value: '71' },
                  { value: '1700000000000' },
                  { value: 'https://img.example/kon.jpg' },
                  { value: 'K-ON!' },
                  { value: 'けいおん!' },
                  { value: 'K-ON!' },
                  { value: 'Music club anime' },
                  { value: 'anime' },
                  { value: 'kon_ep1_hash' },
                ]],
              },
            },
          };
        }

        if (sql.includes('FROM user_op_log')) {
          return {
            type: 'ok',
            response: {
              type: 'execute',
              result: {
                rows: [[{ value: JSON.stringify(sampleCardPayload) }]],
              },
            },
          };
        }

        return { type: 'ok', response: { type: 'execute', result: { rows: [] } } };
      });

      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    return originalFetch(url, init);
  };

  try {
    // 1. Series mined cards with frames
    const cardsRes = await workerApp.fetch(
      new Request('https://kiroku-note.rhythmkach.workers.dev/api/link/series/K-ON!/cards', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env
    );
    assert.equal(cardsRes.status, 200);
    const cards = await cardsRes.json();
    assert.equal(Array.isArray(cards), true);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].expression, '軽音部');
    assert.equal(cards[0].image, 'data:image/jpeg;base64,/9j/FRAME1');

    // 2. Episode inspector analytics
    const inspectRes = await workerApp.fetch(
      new Request('https://kiroku-note.rhythmkach.workers.dev/api/link/episodes/kon_ep1_hash/inspect?learner_level=N4', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env
    );
    assert.equal(inspectRes.status, 200);
    const inspect = await inspectRes.json();
    assert.equal(inspect.cues_available, true);
    assert.equal(inspect.cue_count, 1);
    assert.ok(inspect.difficulty);
    assert.equal(inspect.difficulty.unique_words_count, 2);
    assert.ok(inspect.missed_words.some((w) => w.word === '入部'));
    assert.ok(!inspect.missed_words.some((w) => w.word === '軽音部'));
    assert.equal(inspect.mined_cards.length, 1);

    // 3. Anime progress batch + get
    const batchRes = await workerApp.fetch(
      new Request('https://kiroku-note.rhythmkach.workers.dev/api/user/progress/anime/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          progress: [{
            series_id: 'K-ON!',
            episode_number: 1,
            last_position_ms: 600000,
            duration_ms: 1440000,
            completed: 0,
            mined_card_count: 71,
            cue_hash: 'kon_ep1_hash',
          }],
        }),
      }),
      env
    );
    assert.equal(batchRes.status, 200);
    const batchBody = await batchRes.json();
    assert.equal(batchBody.ok, true);
    assert.equal(batchBody.count, 1);

    const progRes = await workerApp.fetch(
      new Request('https://kiroku-note.rhythmkach.workers.dev/api/user/progress/anime', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env
    );
    assert.equal(progRes.status, 200);
    const progBody = await progRes.json();
    assert.equal(Array.isArray(progBody.progress), true);
    assert.equal(progBody.progress.length, 1);
    assert.equal(progBody.progress[0].series_id, 'K-ON!');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
