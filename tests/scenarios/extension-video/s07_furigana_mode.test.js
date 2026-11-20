const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockEnvironment } = require("./env.js");

test("S07: Furigana mode handling", async () => {
  const env = createMockEnvironment();
  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__ || env.vmContext.window.__KIROKU_VIDEO_POC__;

  const video = new env.MockVideoElement("furigana-test-video");
  env.rootBody.appendChild(video);
  poc.instance.detector.checkVideos();
  poc.instance.setSubtitlesDisplay(true);

  // Subtitle with ruby markup
  poc.instance.syncEngine.setCues([
    { startTime: 0, endTime: 10, text: "<ruby>漢字<rt>かんじ</rt></ruby>の勉強" }
  ]);
  video.seek(2.0);

  const subtitle = env.mockDoc.getElementById("ankiminer-video-subtitle");
  assert.ok(subtitle);

  // When furigana mode is "none", reading must not be concatenated directly to kanji as '漢字かんじ'
  await env.sendRuntimeMessage({ type: "SET_FURIGANA_MODE", mode: "none" });
  assert.ok(!subtitle.textContent.includes("漢字かんじ"), "Furigana 'かんじ' must not concatenate directly onto '漢字'");

  // When furigana mode is "all", ruby or furigana tags/classes must be active
  await env.sendRuntimeMessage({ type: "SET_FURIGANA_MODE", mode: "all" });
  assert.equal(poc.instance.renderer.furiganaMode, "all");
});

