const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const testViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'test.js');

test('Test View: No hardcoded mock reading passage or fake exam results', () => {
  const content = fs.readFileSync(testViewPath, 'utf8');

  // Forbidden placeholder mock text
  const forbidden = [
    '近年、都市部においてシェアハウスを選択する若者が急速に増加している。',
    'かつては家賃を低く抑えるための手段と見なされる傾向が強かったが',
    '筆者によると、最近シェアハウスを選ぶ若者が増えている最も大きな理由は何ですか。',
    'Scaled estimated score: 142/180 (Pass)',
    'catch (_) {}'
  ];

  for (const str of forbidden) {
    assert.equal(
      content.includes(str),
      false,
      `TestView must not contain placeholder string: "${str}"`
    );
  }

  // Renders dynamic containers
  assert.ok(
    content.includes('id="test-stage-area"'),
    'TestView must include test-stage-area container'
  );
  assert.ok(
    content.includes('test-empty-state'),
    'TestView must support honest empty state when question bank is incomplete'
  );
});

test('Test View: Wires real examination session lifecycle via studyClient', () => {
  const content = fs.readFileSync(testViewPath, 'utf8');

  assert.ok(
    content.includes('studyClient.createExamSession('),
    'TestView must call studyClient.createExamSession'
  );
  assert.ok(
    content.includes('studyClient.answerExamItem('),
    'TestView must call studyClient.answerExamItem when drafting choices'
  );
  assert.ok(
    content.includes('studyClient.flagExamItem('),
    'TestView must call studyClient.flagExamItem when toggling review mark'
  );
  assert.ok(
    content.includes('studyClient.submitExamSection('),
    'TestView must call studyClient.submitExamSection upon section finish'
  );
  assert.ok(
    content.includes('studyClient.getExamResult('),
    'TestView must call studyClient.getExamResult to fetch score breakdown'
  );
});

test('Test View: Honest diagnostic wording without claiming official certificate', () => {
  const content = fs.readFileSync(testViewPath, 'utf8');

  assert.ok(
    content.includes('Disclaimer: This provisional scaled score is calculated locally'),
    'TestView must clearly state provisional diagnostic status and disclaim official certification'
  );
  assert.ok(
    content.includes('renderResultState('),
    'TestView must implement result state rendering'
  );
});

test('Test View: Error handling is visible with banner (no silent catches)', () => {
  const content = fs.readFileSync(testViewPath, 'utf8');

  assert.ok(
    content.includes('showError('),
    'TestView must implement visible showError method'
  );
  assert.ok(
    content.includes('test-error-banner'),
    'TestView must include visible test-error-banner element'
  );
  assert.ok(
    !content.includes('catch (_) {}'),
    'TestView must not contain empty silent catch blocks'
  );
});

