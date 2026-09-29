const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Quick Add Tab Persistence: selectQuickAddCandidate does NOT call switchMiningTab('text')", () => {
  const js = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.js"), "utf8");
  
  // Find selectQuickAddCandidate function
  const fnStart = js.indexOf("function selectQuickAddCandidate(");
  assert.ok(fnStart !== -1, "selectQuickAddCandidate must exist in sidepanel.js");
  const fnEnd = js.indexOf("function renderQuickAddSuggestions(", fnStart);
  assert.ok(fnEnd !== -1, "renderQuickAddSuggestions must follow selectQuickAddCandidate");
  
  const fnBody = js.slice(fnStart, fnEnd);
  assert.equal(
    fnBody.includes("switchMiningTab"),
    false,
    "selectQuickAddCandidate must NOT call switchMiningTab; user must remain on Quick Add tab"
  );
});
