const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const viewsStylesDir = path.join(repoRoot, 'desktop', 'src', 'ui', 'styles', 'views');
const sharedCssPath = path.join(viewsStylesDir, 'shared.css');

test('Shell View Containment: shared.css establishes centralized safe-area bounds on #view-container', () => {
  const sharedCss = fs.readFileSync(sharedCssPath, 'utf8');

  // #view-container must bound height, safe-area padding, and internal scrolling
  assert.match(
    sharedCss,
    /#view-container\s*\{[^}]*height:\s*100vh;/s,
    '#view-container must have height: 100vh'
  );
  assert.match(
    sharedCss,
    /#view-container\s*\{[^}]*padding-top:\s*var\(--chrome-top-height[^}]*padding-bottom:\s*var\(--content-padding-bottom/s,
    '#view-container must reserve safe areas for both top chrome and bottom dock'
  );
  assert.match(
    sharedCss,
    /#view-container\s*\{[^}]*overflow-y:\s*auto;/s,
    '#view-container must own vertical scrolling'
  );

  // Transition clip path must inset for both top chrome and bottom dock
  assert.match(
    sharedCss,
    /::view-transition-group\(view-content\)\s*\{[^}]*clip-path:\s*inset\(\s*var\(--chrome-top-height[^)]*\)\s+0\s+var\(--content-padding-bottom[^)]*\)\s+0\s*\);/s,
    'view-transition-group clip-path must cleanly inset for top chrome and bottom dock'
  );
});

test('Shell View Containment: individual view stylesheets have no redundant top safe-area padding hacks', () => {
  const viewFiles = fs.readdirSync(viewsStylesDir).filter(f => f.endsWith('.css') && f !== 'shared.css');

  for (const file of viewFiles) {
    const filePath = path.join(viewsStylesDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    // Ensure no view wrapper manually adds --content-padding-top or calc(var(--chrome-top-height))
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('padding') && (line.includes('--content-padding-top') || line.includes('calc(var(--chrome-top-height'))) {
        assert.fail(`Redundant safe-area top padding hack found in ${file}:${i + 1}: "${line.trim()}"`);
      }
    }
  }
});

test('Shell View Containment: view CSS does not use bare 100vh without safe-area offsets or explicit lint ignore', () => {
  const viewFiles = fs.readdirSync(viewsStylesDir).filter(f => f.endsWith('.css') && f !== 'shared.css');

  for (const file of viewFiles) {
    const filePath = path.join(viewsStylesDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('100vh')) {
        // Allowed if preceded within 8 lines by lint-ignore or offset by chrome variables
        let hasIgnore = false;
        for (let j = Math.max(0, i - 8); j <= i; j++) {
          if (lines[j].includes('lint-ignore')) {
            hasIgnore = true;
            break;
          }
        }
        const hasChromeOffset = line.includes('--chrome-top-height') || line.includes('--content-padding-bottom');

        assert.ok(
          hasIgnore || hasChromeOffset,
          `Forbidden bare 100vh without safe-area offset or lint-ignore in ${file}:${i + 1}: "${line.trim()}"`
        );
      }
    }
  }
});

test('Shell View Containment: drawers and fixed overlays in views respect top-chrome clearance', () => {
  const viewFiles = fs.readdirSync(viewsStylesDir).filter(f => f.endsWith('.css'));

  for (const file of viewFiles) {
    const filePath = path.join(viewsStylesDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const blocks = content.split('}');

    for (const block of blocks) {
      if (block.includes('position: fixed') && (block.includes('top: 0') || block.includes('inset: 0'))) {
        const hasIgnore = block.includes('lint-ignore');
        const hasChromeOffset = block.includes('--chrome-top-height');

        assert.ok(
          hasIgnore || hasChromeOffset,
          `Fixed overlay with top: 0 / inset: 0 found in ${file} without --chrome-top-height clearance or lint-ignore`
        );
      }
    }
  }
});
