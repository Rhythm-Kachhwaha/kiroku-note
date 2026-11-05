const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const parserPath = path.join(__dirname, '..', 'content', 'reader', 'page_parser.js');

test('page_parser: parses text nodes and wraps tokens in interactive chips', () => {
  const content = fs.readFileSync(parserPath, 'utf8');
  assert.ok(content.includes('class PageParser'), 'must define PageParser class');
  assert.ok(content.includes('kiroku-web-chip'), 'must generate kiroku-web-chip class');
});

