const test = require('node:test');
const assert = require('node:assert/strict');

test('StudyImportController: AI Prompt Generator generates valid prompt structure', async () => {
  const { StudyImportController } = await import('../src/ui/views/study_import.js');
  const ctrl = new StudyImportController();

  ctrl.aiPromptLevel = 'N3';
  ctrl.aiPromptArea = 'grammar';
  ctrl.aiPromptFormat = 'Sentence Fill (Particles & Forms)';

  // Mock a minimal container
  const dummyEl = {
    value: '',
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {}
  };
  ctrl.container = {
    querySelector: (selector) => {
      if (selector === '#ai-generated-prompt') return dummyEl;
      return null;
    },
    querySelectorAll: () => []
  };

  ctrl.updateGeneratedAiPrompt();
  assert.ok(dummyEl.value.includes('N3'), 'Prompt includes N3 level');
  assert.ok(dummyEl.value.includes('grammar'), 'Prompt includes grammar area');
  assert.ok(dummyEl.value.includes('canonical_choice'), 'Prompt specifies canonical_choice schema');
});

test('StudyImportController: Question validation and quarantine logic', async () => {
  const { StudyImportController } = await import('../src/ui/views/study_import.js');
  const ctrl = new StudyImportController();

  const validQ = {
    level: 'N4',
    prompt: 'これはテストです。',
    choices: ['A', 'B', 'C', 'D'],
    canonical_choice: 'A'
  };

  const invalidQNoChoices = {
    level: 'N4',
    prompt: 'これはテストです。'
  };

  const invalidQNoPrompt = {
    level: 'N4',
    choices: ['A', 'B']
  };

  assert.equal(ctrl.validateQuestionItem(validQ).isValid, true);
  assert.equal(ctrl.validateQuestionItem(invalidQNoChoices).isValid, false);
  assert.equal(ctrl.validateQuestionItem(invalidQNoPrompt).isValid, false);

  // Test quarantine
  ctrl.previewQuestions = [validQ, invalidQNoChoices, invalidQNoPrompt];
  ctrl.container = {
    querySelector: () => null,
    querySelectorAll: () => []
  };
  // Quarantine
  ctrl.handleQuarantineInvalid();
  assert.equal(ctrl.previewQuestions.length, 1);
  assert.equal(ctrl.previewQuestions[0], validQ);
});
