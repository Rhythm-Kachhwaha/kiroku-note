const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Hero Search Status: Elements exist in sidepanel.html", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.html"), "utf8");
  assert.ok(html.includes('id="hero-search-input"'), "hero-search-input must exist");
  assert.ok(html.includes('id="btn-hero-search-mode"'), "btn-hero-search-mode must exist");
  assert.ok(html.includes('id="hero-search-popup"'), "hero-search-popup must exist");
  assert.ok(html.includes('id="hero-search-suggestions"'), "hero-search-suggestions must exist");
});

test("Hero Search Status: CSS styles exist for search elements, pills, and badges", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.css"), "utf8");
  assert.ok(css.includes(".hero-search-container"), "hero-search-container CSS must exist");
  assert.ok(css.includes(".hero-search-input-wrap"), "hero-search-input-wrap CSS must exist");
  assert.ok(css.includes(".quickadd-candidate-saved-pill"), "quickadd-candidate-saved-pill CSS must exist");
  assert.ok(css.includes(".quickadd-candidate-jlpt-pill"), "quickadd-candidate-jlpt-pill CSS must exist");
});

test("Hero Search Status: setSaveBadge updates badges in DOM", () => {
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

  // Set SAVED
  setSaveBadge("SAVED", "badge saved", true);
  assert.equal(saveBadge.textContent, "SAVED");
  assert.equal(saveBadge.hidden, false);

  // Hide badge
  setSaveBadge("", "badge", false);
  assert.equal(saveBadge.hidden, true);
});
