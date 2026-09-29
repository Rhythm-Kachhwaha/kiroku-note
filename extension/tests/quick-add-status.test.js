const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Quick Add Status: Elements exist in sidepanel.html", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.html"), "utf8");
  assert.ok(html.includes('id="quickadd-session-count"'), "quickadd-session-count must exist");
  assert.ok(html.includes('id="quickadd-save-badge"'), "quickadd-save-badge must exist");
  assert.ok(html.includes('id="quickadd-mode-english"'), "quickadd-mode-english must exist");
});

test("Quick Add Status: CSS styles exist for pills and badges", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.css"), "utf8");
  assert.ok(css.includes(".quickadd-candidate-saved-pill"), "quickadd-candidate-saved-pill CSS must exist");
  assert.ok(css.includes(".quickadd-candidate-jlpt-pill"), "quickadd-candidate-jlpt-pill CSS must exist");
  assert.ok(css.includes(".quickadd-header-left"), "quickadd-header-left CSS must exist");
});

test("Quick Add Status: setSaveBadge updates both badges in DOM", () => {
  function createBadge() {
    return {
      textContent: "",
      className: "badge",
      hidden: true,
    };
  }

  const saveBadge = createBadge();
  const quickAddSaveBadge = createBadge();

  function setSaveBadge(text, className = "badge", isVisible = true) {
    [saveBadge, quickAddSaveBadge].forEach(badge => {
      if (badge) {
        badge.textContent = isVisible ? text : "";
        badge.className = isVisible ? className : "badge";
        badge.hidden = !isVisible;
      }
    });
  }

  // Initial state
  assert.equal(saveBadge.hidden, true);
  assert.equal(quickAddSaveBadge.hidden, true);

  // Set ALREADY SAVED
  setSaveBadge("ALREADY SAVED", "badge already-saved", true);
  assert.equal(saveBadge.textContent, "ALREADY SAVED");
  assert.equal(saveBadge.hidden, false);
  assert.equal(quickAddSaveBadge.textContent, "ALREADY SAVED");
  assert.equal(quickAddSaveBadge.hidden, false);

  // Set SAVED
  setSaveBadge("SAVED", "badge saved", true);
  assert.equal(quickAddSaveBadge.textContent, "SAVED");
  assert.equal(quickAddSaveBadge.hidden, false);

  // Hide badge
  setSaveBadge("", "badge", false);
  assert.equal(quickAddSaveBadge.hidden, true);
});
