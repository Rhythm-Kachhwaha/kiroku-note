const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixturePath = path.join(__dirname, 'fixtures', 'openapi.json');

function normalizeTemplatePath(rawPath) {
  let p = rawPath;
  if (p.includes('?')) {
    p = p.split('?')[0];
  }
  p = p.replace(/\/api\/study\/v1\/bank\/questions\/\$\{[^}]+\}\/provenance/g, '/api/study/v1/bank/questions/{id}/provenance');
  p = p.replace(/\/api\/study\/v1\/bank\/questions\/\$\{[^}]+\}\/reports/g, '/api/study/v1/bank/questions/{id}/reports');
  p = p.replace(/\/api\/study\/v1\/bank\/questions\/\$\{[^}]+\}/g, '/api/study/v1/bank/questions/{id}');
  p = p.replace(/\/api\/study\/v1\/bank\/reports\/\$\{[^}]+\}/g, '/api/study/v1/bank/reports/{report_id}');
  p = p.replace(/\/api\/study\/v1\/bank\/import\/pdf\/\$\{[^}]+\}\/pages/g, '/api/study/v1/bank/import/pdf/{import_id}/pages');
  p = p.replace(/\/api\/study\/v1\/bank\/import\/pdf\/\$\{[^}]+\}\/preview/g, '/api/study/v1/bank/import/pdf/{import_id}/preview');
  p = p.replace(/\/api\/study\/v1\/bookmarks\/\$\{[^}]+\}/g, '/api/study/v1/bookmarks/{question_id}');
  p = p.replace(/\/api\/study\/v1\/exam\/blueprints\/\$\{[^}]+\}/g, '/api/study/v1/exam/blueprints/{level}');
  p = p.replace(/\/api\/study\/v1\/exam\/sessions\/\$\{[^}]+\}\/result/g, '/api/study/v1/exam/sessions/{id}/result');
  p = p.replace(/\/api\/study\/v1\/exam\/sessions\/\$\{[^}]+\}\/complete/g, '/api/study/v1/exam/sessions/{id}/complete');
  p = p.replace(/\/api\/study\/v1\/exam\/sessions\/\$\{[^}]+\}\/items\/\$\{[^}]+\}\/answer/g, '/api/study/v1/exam/sessions/{id}/items/{item}/answer');
  p = p.replace(/\/api\/study\/v1\/exam\/sessions\/\$\{[^}]+\}\/items\/\$\{[^}]+\}\/flag/g, '/api/study/v1/exam/sessions/{id}/items/{item}/flag');
  p = p.replace(/\/api\/study\/v1\/exam\/sessions\/\$\{[^}]+\}\/items\/\$\{[^}]+\}/g, '/api/study/v1/exam/sessions/{id}/items/{item}');
  p = p.replace(/\/api\/study\/v1\/exam\/sessions\/\$\{[^}]+\}\/sections\/\$\{[^}]+\}\/pause/g, '/api/study/v1/exam/sessions/{id}/sections/{section}/pause');
  p = p.replace(/\/api\/study\/v1\/exam\/sessions\/\$\{[^}]+\}\/sections\/\$\{[^}]+\}\/resume/g, '/api/study/v1/exam/sessions/{id}/sections/{section}/resume');
  p = p.replace(/\/api\/study\/v1\/exam\/sessions\/\$\{[^}]+\}\/sections\/\$\{[^}]+\}\/start/g, '/api/study/v1/exam/sessions/{id}/sections/{section}/start');
  p = p.replace(/\/api\/study\/v1\/exam\/sessions\/\$\{[^}]+\}\/sections\/\$\{[^}]+\}\/submit/g, '/api/study/v1/exam/sessions/{id}/sections/{section}/submit');
  p = p.replace(/\/api\/study\/v1\/exam\/sessions\/\$\{[^}]+\}/g, '/api/study/v1/exam/sessions/{id}');
  p = p.replace(/\/api\/study\/v1\/history\/incorrect\/\$\{[^}]+\}/g, '/api/study/v1/history/incorrect/{question_id}');
  p = p.replace(/\/api\/study\/v1\/media\/\$\{[^}]+\}/g, '/api/study/v1/media/{asset_id_or_sha256}');
  p = p.replace(/\/api\/study\/v1\/practice\/sessions\/\$\{[^}]+\}\/next/g, '/api/study/v1/practice/sessions/{id}/next');
  p = p.replace(/\/api\/study\/v1\/practice\/sessions\/\$\{[^}]+\}\/results/g, '/api/study/v1/practice/sessions/{id}/results');
  p = p.replace(/\/api\/study\/v1\/practice\/sessions\/\$\{[^}]+\}\/answer/g, '/api/study/v1/practice/sessions/{id}/answer');
  p = p.replace(/\/api\/study\/v1\/practice\/sessions\/\$\{[^}]+\}\/answers/g, '/api/study/v1/practice/sessions/{id}/answers');
  p = p.replace(/\/api\/study\/v1\/practice\/sessions\/\$\{[^}]+\}\/abandon/g, '/api/study/v1/practice/sessions/{id}/abandon');
  p = p.replace(/\/api\/study\/v1\/practice\/sessions\/\$\{[^}]+\}\/complete/g, '/api/study/v1/practice/sessions/{id}/complete');
  p = p.replace(/\/api\/study\/v1\/practice\/sessions\/\$\{[^}]+\}\/feedback/g, '/api/study/v1/practice/sessions/{id}/feedback');
  p = p.replace(/\/api\/study\/v1\/practice\/sessions\/\$\{[^}]+\}/g, '/api/study/v1/practice/sessions/{id}');

  p = p.replace(/\/api\/cards\/\$\{[^}]+\}\/sync/g, '/api/cards/{card_id}/sync');
  p = p.replace(/\/api\/cards\/\$\{[^}]+\}/g, '/api/cards/{card_id}');
  p = p.replace(/\/api\/grammar\/points\/\$\{[^}]+\}\/encounters/g, '/api/grammar/points/{pattern_key}/encounters');
  p = p.replace(/\/api\/grammar\/points\/\$\{[^}]+\}/g, '/api/grammar/points/{pattern_key}');
  p = p.replace(/\/api\/kanji\/strokes\/\$\{[^}]+\}/g, '/api/kanji/strokes/{character}');
  p = p.replace(/\/api\/kanji\/details\/\$\{[^}]+\}/g, '/api/kanji/details/{character}');
  p = p.replace(/\/api\/kanji\/compounds\/\$\{[^}]+\}/g, '/api/kanji/compounds/{character}');
  p = p.replace(/\/api\/known-words\/mark\/\$\{[^}]+\}/g, '/api/known-words/mark/{word}');
  p = p.replace(/\/api\/link\/cues\/\$\{[^}]+\}/g, '/api/link/cues/{cue_hash}');
  p = p.replace(/\/api\/link\/episodes\/\$\{[^}]+\}/g, '/api/link/episodes/{cue_hash}');
  p = p.replace(/\/api\/link\/primer\/\$\{[^}]+\}/g, '/api/link/primer/{cue_hash}');
  p = p.replace(/\/api\/media\/\$\{[^}]+\}/g, '/api/media/{filename}');

  return p;
}

function scanFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(scanFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.html'))) {
      files.push(full);
    }
  }
  return files;
}

test('desktop endpoints audit: all desktop-used paths exist in openapi.json fixture', () => {
  assert.equal(fs.existsSync(fixturePath), true, 'OpenAPI fixture missing: ' + fixturePath);
  const openapi = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const openapiPaths = new Set(Object.keys(openapi.paths || {}));

  const uiDir = path.join(repoRoot, 'desktop', 'src', 'ui');
  const files = scanFiles(uiDir);
  assert.ok(files.length > 0, 'No UI files found');

  const usedPaths = new Set();
  const pathRegex = /[`'"](\/api\/[a-zA-Z0-9_\-\$\{}/]+)[`'"]/g;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = pathRegex.exec(content)) !== null) {
      const normalized = normalizeTemplatePath(match[1]);
      usedPaths.add(normalized);
    }
  }

  assert.ok(usedPaths.size > 0, 'No desktop API paths extracted');

  const missing = [];
  for (const p of usedPaths) {
    if (!openapiPaths.has(p)) {
      missing.push(p);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `Found desktop UI paths missing from OpenAPI fixture:\n${missing.join('\n')}`
  );
});

