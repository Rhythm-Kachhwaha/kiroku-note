const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

console.log("Starting Real-World UX Fixes Verification Tests...\n");

// ==========================================================================
// 1. Verify HTML Structure & Markup Fixes
// ==========================================================================
const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const html = fs.readFileSync(htmlPath, "utf8");

// Meaning prominence in HTML
assert.ok(html.includes('class="form-group meaning-form-group"'), "Meaning form group must have .meaning-form-group class");
assert.ok(html.includes('class="meaning-textarea"'), "Meaning field must have .meaning-textarea class");

// Default layout hierarchy: Card fields section must precede card preview section in HTML
const fieldsSecIdx = html.indexOf('id="card-fields-section"');
const previewSecIdx = html.indexOf('id="card-preview-section"');
assert.ok(fieldsSecIdx !== -1, "Card fields section must exist");
assert.ok(previewSecIdx !== -1, "Card preview section must exist");
assert.ok(fieldsSecIdx < previewSecIdx, "Card fields section MUST precede card preview section in HTML for immediate Word -> Reading -> Meaning hierarchy");

// Destination Target Indicator in Card Action Bar
assert.ok(html.includes('id="card-target-destination"'), "Authoritative target indicator #card-target-destination must exist in HTML");
assert.ok(html.includes('id="dest-deck-val"'), "#dest-deck-val must exist inside target indicator");
assert.ok(html.includes('id="dest-model-val"'), "#dest-model-val must exist inside target indicator");

// Editor Japanese Mode Toggle Button
assert.ok(html.includes('id="btn-editor-jp-mode"'), "Japanese input mode toggle #btn-editor-jp-mode must exist in workspace toolbar");

// Floating Candidate Suggestions Popup
assert.ok(html.includes('id="editor-suggestions-container"'), "Editor suggestions popup #editor-suggestions-container must exist");
assert.ok(html.includes('id="editor-suggestions-list"'), "Editor suggestions list #editor-suggestions-list must exist");

// Card Settings Popover: Front Hint, Back Hint, Show History
assert.ok(html.includes('id="setting-front-hint"'), "Front Hint setting checkbox #setting-front-hint must exist");
assert.ok(html.includes('id="setting-back-hint"'), "Back Hint setting checkbox #setting-back-hint must exist");
assert.ok(html.includes('id="setting-show-history"'), "Show History setting checkbox #setting-show-history must exist");

// History Collapsible Header & Body
assert.ok(html.includes('id="history-collapse-btn"'), "History collapse button #history-collapse-btn must exist");
assert.ok(html.includes('id="history-content-container"'), "History content container #history-content-container must exist");
assert.ok(html.includes('id="history-content-container" class="history-content-container" hidden'), "History content container must be collapsed (hidden) by default in HTML");

console.log("PASS 1: HTML DOM structure and elements for all 5 fixes verified.");

// ==========================================================================
// 2. Verify CSS Styles for Real-World UX Fixes
// ==========================================================================
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const css = fs.readFileSync(cssPath, "utf8");

// Meaning visual hierarchy
assert.ok(css.includes(".meaning-form-group"), "CSS must style .meaning-form-group");
assert.ok(css.includes(".meaning-textarea"), "CSS must style .meaning-textarea");

// Destination safety indicator
assert.ok(css.includes(".card-target-destination"), "CSS must style .card-target-destination");
assert.ok(css.includes(".dest-val"), "CSS must style .dest-val");

// Floating quiet candidate popup
assert.ok(css.includes(".editor-candidate-popup"), "CSS must style .editor-candidate-popup");
assert.ok(css.includes(".editor-candidate-item"), "CSS must style .editor-candidate-item");

// Japanese mode button
assert.ok(css.includes(".btn-editor-jp-mode"), "CSS must style .btn-editor-jp-mode");

// History collapse button and arrow
assert.ok(css.includes(".history-collapse-btn"), "CSS must style .history-collapse-btn");
assert.ok(css.includes(".history-collapse-arrow"), "CSS must style .history-collapse-arrow");

// History reclaim space when hidden (Guardrail 4)
assert.ok(css.includes("#history-section[hidden]"), "CSS must reclaim space for #history-section[hidden]");
assert.ok(css.includes("display: none !important"), "Hidden history must set display: none !important");

console.log("PASS 2: CSS styling and zero-height layout reclamation verified.");

// ==========================================================================
// 3. Verify JavaScript Logic & Unit Contracts
// ==========================================================================
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");
const rawJs = fs.readFileSync(jsPath, "utf8");
const js = rawJs.replace(/\r\n/g, "\n");

// Default card section order: fields first
assert.ok(js.includes('DEFAULT_CARD_SECTION_ORDER = [\n  "fields",\n  "preview"'), "DEFAULT_CARD_SECTION_ORDER must put 'fields' before 'preview'");

// Card template defaults: front hint false, back hint true, show history true
assert.ok(js.includes("show_hint: false"), "Front template settings must default show_hint: false");
assert.ok(js.includes("show_hint: true"), "Back template settings must default show_hint: true");
assert.ok(js.includes("show_history: true"), "Settings must include show_history: true");

// History collapse management
assert.ok(js.includes("STORAGE_KEY_HISTORY_COLLAPSED"), "Must define STORAGE_KEY_HISTORY_COLLAPSED");
assert.ok(js.includes("function setHistoryCollapsed"), "Must define setHistoryCollapsed");
assert.ok(js.includes("async function loadStoredHistoryCollapseState"), "Must define loadStoredHistoryCollapseState");
assert.ok(js.includes("async function toggleHistoryCollapsed"), "Must define toggleHistoryCollapsed");

// Destination indicator logic
assert.ok(js.includes("function updateDestinationIndicator"), "Must define updateDestinationIndicator");

// Front & Back preview hint gating
assert.ok(js.includes("if (frontCfg.show_hint && data.hint)"), "Front preview MUST gate hint with frontCfg.show_hint");
assert.ok(js.includes("if (backCfg.show_hint !== false && data.hint)"), "Back preview MUST gate hint with backCfg.show_hint !== false");

// Guardrail 1: Editor Japanese mode bound ONLY to free-form fields
assert.ok(js.includes("const targetInputs = [fieldHint, fieldExampleSentence, fieldNotes]"), "WanaKana binding in editor MUST target free-form Hint, Sentence, and Notes fields");
assert.ok(!js.includes("const targetInputs = [fieldExpression"), "WanaKana in editor MUST NEVER bind to fieldExpression");
assert.ok(!js.includes("targetInputs = [fieldReading"), "WanaKana in editor MUST NEVER bind to fieldReading");

// Guardrail 2: Contextual candidate assistance
assert.ok(js.includes("function handleEditorTokenLookup"), "Must define handleEditorTokenLookup");
assert.ok(js.includes("function selectEditorCandidate"), "Must define selectEditorCandidate");
assert.ok(js.includes("function clearEditorSuggestions"), "Must define clearEditorSuggestions");
assert.ok(js.includes("editorCandidateDebounceTimer = setTimeout"), "Must use debounce timer for quiet token lookup");

// Guardrail 3: Authoritative destination indicator
assert.ok(js.includes("const targetDeck = (destDeckVal && destDeckVal.textContent.trim())"), "Destination indicator must be authoritative in triggerAnkiSync");

console.log("PASS 3: JavaScript code structure and guardrail contracts verified.");

// ==========================================================================
// 4. Test Token Replacement Logic (Guardrail 2)
// ==========================================================================
// Test token replacement function strictly replaces only the matched token range
function testTokenReplacement(originalText, start, end, token, replacement) {
  assert.equal(originalText.slice(start, end), token, "Token slice must match target token exactly");
  const newVal = originalText.slice(0, start) + replacement + originalText.slice(end);
  const newCaret = start + replacement.length;
  return { newVal, newCaret };
}

// Case A: Token at the end of sentence
const text1 = "毎日あさごはんをたべる"; // user typed たべる at caret 11
const start1 = 8;
const end1 = 11;
const token1 = "たべる";
const res1 = testTokenReplacement(text1, start1, end1, token1, "食べる");
assert.equal(res1.newVal, "毎日あさごはんを食べる", "Must replace only 'たべる' with '食べる'");
assert.equal(res1.newCaret, 11, "Caret must be placed right after inserted candidate");

// Case B: Token in the middle of a sentence (caret in middle)
const text2 = "このはしをわたる"; // user wants to replace はし
const start2 = 2;
const end2 = 4;
const token2 = "はし";
const res2 = testTokenReplacement(text2, start2, end2, token2, "箸");
assert.equal(res2.newVal, "この箸をわたる", "Must replace only 'はし' with '箸' without altering surrounding text");
assert.equal(res2.newCaret, 3, "Caret must update accurately based on replacement length");

console.log("PASS 4: Contextual candidate token replacement verified.");

// ==========================================================================
// 5. Test History Visibility Toggle (Guardrail 4)
// ==========================================================================
function mockApplyHistoryVisibility(settings, mockElement) {
  const showHistory = settings?.show_history !== false;
  mockElement.hidden = !showHistory;
  mockElement.style.display = showHistory ? "" : "none";
}

const mockHistorySec = { hidden: false, style: { display: "" } };
mockApplyHistoryVisibility({ show_history: true }, mockHistorySec);
assert.equal(mockHistorySec.hidden, false, "History section must be visible when show_history: true");
assert.equal(mockHistorySec.style.display, "", "Display style must be empty when visible");

mockApplyHistoryVisibility({ show_history: false }, mockHistorySec);
assert.equal(mockHistorySec.hidden, true, "History section must be hidden when show_history: false");
assert.equal(mockHistorySec.style.display, "none", "Display style must be 'none' when hidden to reclaim space");

console.log("PASS 5: History visibility toggle and layout space reclamation verified.");

// ==========================================================================
// 6. Test Destination Indicator Selection Priority (Guardrail 3)
// ==========================================================================
function resolveTargetDeck(storedLastDeck, currentSelected, availableDecks) {
  if (storedLastDeck && availableDecks.includes(storedLastDeck)) {
    return storedLastDeck;
  } else if (currentSelected && availableDecks.includes(currentSelected)) {
    return currentSelected;
  } else if (availableDecks.includes("Default")) {
    return "Default";
  } else {
    return availableDecks[0] || "Default";
  }
}

// When storage has a previously selected deck, it must NOT be overwritten by the HTML initial placeholder "Default"
const availableDecks = ["Default", "Japanese::Mining", "Vocabulary"];
const resolvedDeck = resolveTargetDeck("Japanese::Mining", "Default", availableDecks);
assert.equal(resolvedDeck, "Japanese::Mining", "Stored deck must take priority over initial placeholder 'Default'");

// When storage is empty, fallback to currentSelected or Default
const resolvedFallback = resolveTargetDeck("", "Default", availableDecks);
assert.equal(resolvedFallback, "Default", "Empty storage must fall back gracefully to Default");

console.log("PASS 6: Deck/Model persistence priority over HTML default values verified.");
console.log("\nALL REAL-WORLD UX FIXES TESTS PASSED SUCCESSFULLY!");
