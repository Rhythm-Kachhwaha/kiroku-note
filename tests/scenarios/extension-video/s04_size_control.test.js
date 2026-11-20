const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockEnvironment } = require("./env.js");

test("S04: Subtitle size control & persistence", async () => {
  const env = createMockEnvironment();
  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__ || env.vmContext.window.__KIROKU_VIDEO_POC__;

  const video = new env.MockVideoElement("size-test-video");
  env.rootBody.appendChild(video);
  poc.instance.detector.checkVideos();
  poc.instance.setSubtitlesDisplay(true);
  poc.instance.syncEngine.setCues([
    { startTime: 0, endTime: 5, text: "サイズテスト1" },
    { startTime: 5, endTime: 10, text: "サイズテスト2" }
  ]);
  video.seek(2.0);

  const subtitle = env.mockDoc.getElementById("ankiminer-video-subtitle");
  assert.ok(subtitle);

  // Send message to update size to 32px
  await env.sendRuntimeMessage({ type: "SET_SUBTITLE_SIZE", size: 32 });
  assert.equal(subtitle.style.fontSize, "32px", "Font size must be 32px after message");

  // Advance to next cue: size must persist at 32px
  video.seek(6.0);
  assert.equal(subtitle.textContent, "サイズテスト2");
  assert.equal(subtitle.style.fontSize, "32px", "Font size must persist across cue transitions");
});

