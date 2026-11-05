const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const studyImportPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'study_import.js');

test('StudyImportController: Source file exists and exports controller', () => {
  const content = fs.readFileSync(studyImportPath, 'utf8');
  assert.ok(content.includes('class StudyImportController'), 'Must define StudyImportController');
  assert.ok(content.includes('export function renderStudyImport'), 'Must export renderStudyImport');
});

test('StudyImportController: Route badges for text, short, flagged, and skipped pages', () => {
  const content = fs.readFileSync(studyImportPath, 'utf8');

  // Badge classification methods exist
  assert.ok(content.includes('getPageBadge('), 'Must define getPageBadge');
  assert.ok(content.includes('isPageReadable('), 'Must define isPageReadable');
  assert.ok(content.includes('getPageSkipReason('), 'Must define getPageSkipReason');

  // Verify badge logic handles short, flagged, and skipped reasons
  assert.ok(content.includes('short'), 'Must support short route badge');
  assert.ok(content.includes('flagged'), 'Must support flagged route badge');
  assert.ok(content.includes('skipped'), 'Must support skipped route badge');
  assert.ok(content.includes('image-only'), 'Must support image-only skip reason');
  assert.ok(content.includes('garbled'), 'Must support garbled skip reason');
});

test('StudyImportController: Summary shows readable count and skipped breakdown with vertical warning', () => {
  const content = fs.readFileSync(studyImportPath, 'utf8');

  assert.ok(content.includes('pdf-summary-banner'), 'Must include summary banner');
  assert.ok(content.includes('readable'), 'Must indicate readable page count in summary');
  assert.ok(content.includes('skipped'), 'Must indicate skipped page count in summary');
  assert.ok(content.includes('pdf-vertical-warning'), 'Must include vertical text warning element');
  assert.ok(content.includes('vertical_text_suspected'), 'Must check vertical_text_suspected flag');
});

test('StudyImportController: Page selection defaults to readable pages only', () => {
  const content = fs.readFileSync(studyImportPath, 'utf8');

  // Inspect upload default selection
  assert.ok(
    content.includes('this.isPageReadable(p)'),
    'Selection logic must check isPageReadable before adding to selectedPages'
  );
  assert.ok(
    content.includes('!readable ? \'disabled\' : \'\''),
    'Unreadable pages must have disabled checkbox'
  );
  assert.ok(
    content.includes('!readable ? \'is-disabled\' : \'\''),
    'Unreadable page chips must have is-disabled class'
  );
});

test('StudyImportController: Actionable error states for expiration, extraction failure, and limits', () => {
  const content = fs.readFileSync(studyImportPath, 'utf8');

  // IMPORT_EXPIRED
  assert.ok(
    content.includes('IMPORT_EXPIRED'),
    'Must handle IMPORT_EXPIRED code'
  );
  assert.ok(
    content.includes('re-upload your PDF'),
    'Must prompt user to re-upload when expired'
  );

  // PDF_EXTRACTION_FAILED
  assert.ok(
    content.includes('PDF_EXTRACTION_FAILED'),
    'Must handle PDF_EXTRACTION_FAILED code'
  );
  assert.ok(
    content.includes('Unable to extract text from this PDF'),
    'Must provide clear message for extraction failure'
  );

  // Size limit (25MB) and page limit (200)
  assert.ok(
    content.includes('25MB'),
    'Must specify 25MB upload limit'
  );
  assert.ok(
    content.includes('200 pages'),
    'Must specify 200 page limit'
  );
});

test('StudyImportController: Unit logic tests for page classification and summary formatting', async () => {
  // Dynamically import or evaluate controller methods
  const { StudyImportController } = await import(`file://${studyImportPath.replace(/\\/g, '/')}`);
  const ctrl = new StudyImportController();

  // Test isPageReadable
  assert.equal(ctrl.isPageReadable({ route: 'selectable_text', has_text: true }), true);
  assert.equal(ctrl.isPageReadable({ route: 'short_text', has_text: true }), true);
  assert.equal(ctrl.isPageReadable({ route: 'image_only', has_text: false }), false);
  assert.equal(ctrl.isPageReadable({ route: 'garbled_text_layer', has_text: true }), false);
  assert.equal(ctrl.isPageReadable({ route: 'poor_text_layer', has_text: false }), false);
  assert.equal(ctrl.isPageReadable({ route: 'selectable_text', has_text: true, skipped_ocr: true }), false);

  // Test getPageBadge
  assert.deepEqual(ctrl.getPageBadge({ route: 'selectable_text', has_text: true }), { label: 'text', className: 'text-muted' });
  assert.deepEqual(ctrl.getPageBadge({ route: 'short_text', has_text: true }), { label: 'short', className: 'text-secondary' });
  assert.deepEqual(ctrl.getPageBadge({ route: 'selectable_text', has_text: true, flags: ['non_japanese'] }), { label: 'flagged (non-Japanese)', className: 'text-gold' });
  assert.deepEqual(ctrl.getPageBadge({ route: 'selectable_text', has_text: true, flags: ['ocr_requested_unavailable'] }), { label: 'flagged (OCR unavailable)', className: 'text-gold' });
  assert.deepEqual(ctrl.getPageBadge({ route: 'selectable_text', has_text: true, flags: ['vertical_text_suspected'] }), { label: 'vertical', className: 'text-gold' });
  assert.deepEqual(ctrl.getPageBadge({ route: 'image_only', has_text: false }), { label: 'skipped (image-only)', className: 'text-red' });
  assert.deepEqual(ctrl.getPageBadge({ route: 'garbled_text_layer', has_text: true }), { label: 'skipped (garbled)', className: 'text-red' });
  assert.deepEqual(ctrl.getPageBadge({ route: 'poor_text_layer', has_text: false }), { label: 'skipped (no text)', className: 'text-red' });
});
