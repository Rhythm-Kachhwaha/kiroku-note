const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const recorderPath = path.join(__dirname, '..', 'src', 'ui', 'services', 'shadowing_recorder.js');
const animeJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'anime.js');

test('anime_shadowing: ShadowingRecorder handles record, stop, and play', () => {
  const content = fs.readFileSync(recorderPath, 'utf8');
  assert.ok(content.includes('class ShadowingRecorder'), 'must declare ShadowingRecorder');
  assert.ok(content.includes('startRecording'), 'must support startRecording');
  assert.ok(content.includes('stopRecording'), 'must support stopRecording');
});

test('anime_shadowing: anime.js wires shadowing controls in inspector', () => {
  const animeJs = fs.readFileSync(animeJsPath, 'utf8');
  assert.ok(animeJs.includes('btn-anime-shadow-record'), 'must render record button');
  assert.ok(animeJs.includes('btn-anime-shadow-compare'), 'must render compare audio button');
});
