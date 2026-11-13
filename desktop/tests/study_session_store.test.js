const test = require('node:test');
const assert = require('node:assert/strict');

test('StudySessionStore: Initializes correctly and tracks question index', async () => {
  const { StudySessionStore } = await import('../src/ui/utils/study_session_store.js');

  const items = [
    { id: 'q1', stem: 'Question 1' },
    { id: 'q2', stem: 'Question 2' },
    { id: 'q3', stem: 'Question 3' }
  ];

  const store = new StudySessionStore({
    sessionId: 'test_session_1',
    sessionType: 'practice',
    items,
    autoPersist: false
  });

  assert.equal(store.sessionId, 'test_session_1');
  assert.equal(store.totalCount, 3);
  assert.equal(store.currentIndex, 0);
  assert.equal(store.displayIndex, 1);
  assert.equal(store.currentQuestion.id, 'q1');
  assert.equal(store.isLastQuestion, false);
  assert.equal(store.isComplete, false);
  assert.equal(store.progressPercent, 33);
});

test('StudySessionStore: Answers, grades, toggles ghost flag, and advances without premature exit', async () => {
  const { StudySessionStore } = await import('../src/ui/utils/study_session_store.js');

  const items = [
    { id: 'q1', stem: 'Question 1' },
    { id: 'q2', stem: 'Question 2' }
  ];

  const store = new StudySessionStore({
    sessionId: 'test_session_2',
    items,
    autoPersist: false
  });

  // Select answer & grade
  store.selectAnswer('option_1');
  assert.equal(store.activeAnswer, 'option_1');

  store.markGraded({ is_correct: false, feedback: 'Incorrect' });
  assert.equal(store.hasAnswered, true);
  assert.equal(store.isGraded, true);
  assert.equal(store.lastGradeResult.is_correct, false);

  // Toggle ghost
  assert.equal(store.isGhost('q1'), false);
  store.toggleGhost('q1');
  assert.equal(store.isGhost('q1'), true);

  // Advance to question 2
  const advanced = store.nextQuestion();
  assert.equal(advanced, true);
  assert.equal(store.currentIndex, 1);
  assert.equal(store.displayIndex, 2);
  assert.equal(store.currentQuestion.id, 'q2');
  assert.equal(store.isLastQuestion, true);
  assert.equal(store.isComplete, false);
  assert.equal(store.hasAnswered, false);
  assert.equal(store.isGraded, false);

  // Next question on last item completes session
  const advancedAgain = store.nextQuestion();
  assert.equal(advancedAgain, false);
  assert.equal(store.isComplete, true);
  assert.equal(store.currentIndex, 2);
});

test('StudySessionStore: Serializes and restores correctly', async () => {
  const { StudySessionStore } = await import('../src/ui/utils/study_session_store.js');

  const store = new StudySessionStore({
    sessionId: 'restore_test',
    items: [{ id: 'q10' }, { id: 'q20' }],
    currentIndex: 1,
    ghostFlags: ['q10'],
    autoPersist: false
  });

  const json = store.toJSON();
  assert.equal(json.sessionId, 'restore_test');
  assert.deepEqual(json.ghostFlags, ['q10']);

  const restored = StudySessionStore.restore(json);
  assert.equal(restored.sessionId, 'restore_test');
  assert.equal(restored.currentIndex, 1);
  assert.equal(restored.isGhost('q10'), true);
});
