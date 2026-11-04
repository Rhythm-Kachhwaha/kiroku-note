const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const studyViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'study.js');

function readStudyView() {
  return fs.readFileSync(studyViewPath, 'utf8');
}

test('Study segments are Practice, Bank, Mistakes, Progress in order', async () => {
  const { STUDY_SEGMENTS } = await import('../src/ui/views/study.js');

  assert.deepEqual(STUDY_SEGMENTS.map((segment) => segment.id), [
    'practice',
    'bank',
    'mistakes',
    'progress'
  ]);
  assert.deepEqual(STUDY_SEGMENTS.map((segment) => segment.label), [
    'Practice',
    'Bank',
    'Mistakes',
    'Progress'
  ]);
});

test('Study shell exposes a segmented control and one pane per segment', () => {
  const content = readStudyView();

  assert.ok(content.includes('role="tablist"'), 'Study view needs a tablist segmented control');
  for (const id of ['practice', 'bank', 'mistakes', 'progress']) {
    assert.ok(content.includes(`data-segment="${id}"`), `Study view needs a ${id} segment`);
  }
  assert.ok(content.includes('id="study-content-area"'), 'Practice keeps the existing content area id');
  assert.ok(content.includes('id="study-segment-bank"'), 'Bank segment pane must exist');
  assert.ok(content.includes('id="study-segment-mistakes"'), 'Mistakes segment pane must exist');
  assert.ok(content.includes('id="study-segment-progress"'), 'Progress segment pane must exist');
});

test('Question report form opens in a drawer from a bank row or drill flag', () => {
  const content = readStudyView();

  assert.ok(content.includes('id="study-report-drawer"'), 'Report drawer must exist');
  assert.ok(content.includes('openReportDrawer('), 'Bank rows and drill flags open the report drawer');
  assert.ok(content.includes('bank-row-report'), 'Bank rows expose a report action that opens the drawer');
  assert.ok(content.includes('id="btn-flag-question"'), 'In-drill flag opens the report drawer');
  assert.equal(content.includes('id="bank-report-form"'), false, 'Report form must not stay inline in the bank detail');
});

test('Bookmarked is a filter chip in Practice and Bank', () => {
  const content = readStudyView();

  assert.ok(content.includes('id="drill-filter-chips"'), 'Practice needs filter chips');
  assert.ok(content.includes('id="bank-bookmarked-filter"'), 'Bank needs a bookmarked filter chip');
  assert.ok(content.includes('is_bookmarked'), 'Bank search forwards the bookmarked filter');
  assert.equal(content.includes('data-mode="bookmarked"'), false, 'Bookmarked must not remain a drill mode');
});

test('Weak-area rows can start the trouble practice preset', () => {
  const content = readStudyView();

  assert.ok(content.includes('btn-practice-weak-area'), 'Weak-area rows need a Practice these action');
  assert.ok(content.includes("this.selectedSessionType = 'trouble'"), 'Practice these uses the trouble preset');
  assert.ok(content.includes("this.switchSegment('practice')"), 'Practice these navigates to the Practice segment');
});

test('Segment switching preserves mounted pane state', () => {
  const content = readStudyView();

  assert.ok(content.includes('segmentMounted'), 'Segments track whether they are already mounted');
  assert.ok(content.includes('switchSegment('), 'Study view must implement segment switching');
  assert.ok(content.includes('pane.hidden = entry.id !== target'), 'Inactive segments are hidden, not destroyed');
});
