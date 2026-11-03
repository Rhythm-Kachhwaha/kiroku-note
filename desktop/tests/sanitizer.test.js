import test from 'node:test';
import assert from 'node:assert/strict';

import { renderStudyText, sanitizePromptMarkup } from '../src/ui/utils/sanitizer.js';

test('study target classes survive sanitizer while scripts are stripped', () => {
  const rendered = sanitizePromptMarkup(
    '<span class="study-target-blank">（ 35 ）</span><script>alert(1)</script>'
  );

  assert.match(rendered, /study-target-blank/);
  assert.doesNotMatch(rendered, /script|alert\(1\)/i);
});

test('renderStudyText prefers rendered HTML and escapes legacy raw markup', () => {
  assert.match(
    renderStudyText({ text_markup: '{blank|35}', text_html: '<span class="study-target-blank">（ 35 ）</span>' }),
    /study-target-blank/
  );
  assert.equal(renderStudyText({ text_markup: '<img src=x>' }), '&lt;img src=x&gt;');
});
