const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Side Panel Audio Status UI & Cue Triggering Contracts", async (t) => {
  const html = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.html"), "utf8");
  const css = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.css"), "utf8");
  const js = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.js"), "utf8");

  await t.test("DOM and CSS declaration contracts", () => {
    assert.ok(html.includes('id="indicator-tab-audio"'), "HTML must include #indicator-tab-audio status pill");
    assert.ok(css.includes(".indicator-tab-audio"), "CSS must style .indicator-tab-audio");
    assert.ok(css.includes(".tab-audio-connected"), "CSS must style connected state");
    assert.ok(js.includes("AUDIO_CAPTURE_STATE_CHANGED"), "JS must listen to AUDIO_CAPTURE_STATE_CHANGED");
  });

  await t.test("updateTabAudioIndicator toggles connected state and text", () => {
    const indicator = {
      className: "indicator-pill indicator-tab-audio",
      classList: {
        classes: new Set(["indicator-pill", "indicator-tab-audio"]),
        add(cls) { this.classes.add(cls); indicator.className = Array.from(this.classes).join(" "); },
        remove(cls) { this.classes.delete(cls); indicator.className = Array.from(this.classes).join(" "); },
        contains(cls) { return this.classes.has(cls); }
      },
      title: "",
      querySelector(selector) {
        if (selector === ".system-status-value" || selector === ".indicator-label") {
          return this._labelEl;
        }
        return null;
      },
      _labelEl: { textContent: "Inactive" }
    };

    const sandbox = {
      indicatorTabAudio: indicator,
      document: {
        querySelector: (sel) => (sel === "#indicator-tab-audio" ? indicator : null)
      },
      module: { exports: {} }
    };

    // Verify indicator update logic extracted or run in context
    const fnMatch = js.match(/function\s+updateTabAudioIndicator\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    assert.ok(fnMatch, "updateTabAudioIndicator function must be defined");

    vm.runInNewContext(`${fnMatch[0]}; module.exports = { updateTabAudioIndicator };`, sandbox);
    const { updateTabAudioIndicator } = sandbox.module.exports;

    // Test active capture state
    updateTabAudioIndicator(true);
    assert.ok(indicator.classList.contains("tab-audio-connected"), "Must have tab-audio-connected class when capturing");
    assert.match(indicator.title, /active/i, "Title must indicate active audio capture");
    assert.equal(indicator._labelEl.textContent, "Active", "Label must display Active");

    // Test inactive capture state
    updateTabAudioIndicator(false);
    assert.ok(!indicator.classList.contains("tab-audio-connected"), "Must remove tab-audio-connected class when stopped");
    assert.match(indicator.title, /inactive/i, "Title must indicate inactive audio capture");
    assert.equal(indicator._labelEl.textContent, "Inactive", "Label must display Inactive");
  });

  await t.test("retakeAudio broadcasts TRIGGER_AUDIO_RECORDING with audio/wav mimeType and cue", () => {
    let broadcastMsg = null;
    const testCue = { startTime: 15.2, endTime: 18.4, text: "テスト字幕音声" };

    const sandbox = {
      currentCaptureId: "cap_123",
      currentActiveCue: testCue,
      lastCaptureSource: { timelineId: "tl_xyz789" },
      setStatus: () => {},
      broadcastToActiveVideo: (msg) => { broadcastMsg = msg; },
      module: { exports: {} }
    };

    const retakeAudioMatch = js.match(/function\s+retakeAudio\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    assert.ok(retakeAudioMatch, "retakeAudio function must be defined");

    vm.runInNewContext(`${retakeAudioMatch[0]}; module.exports = { retakeAudio };`, sandbox);
    const { retakeAudio } = sandbox.module.exports;

    retakeAudio("cap_123", testCue);
    assert.ok(broadcastMsg, "broadcastToActiveVideo must be called");
    assert.equal(broadcastMsg.type, "TRIGGER_AUDIO_RECORDING");
    assert.deepEqual(broadcastMsg.cue, testCue);
    assert.equal(broadcastMsg.options?.mimeType, "audio/wav", "Must use audio/wav format");
    assert.equal(broadcastMsg.options?.allowFallbackRecording, false, "Must not use fallback microphone recording");
  });
});
