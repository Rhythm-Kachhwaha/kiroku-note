const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockEnvironment } = require("./env.js");

test("S05: Subtitle opacity slider & persistence", async () => {
  const env = createMockEnvironment();
  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__ || env.vmContext.window.__KIROKU_VIDEO_POC__;

  const video = new env.MockVideoElement("opacity-test-video");
  env.rootBody.appendChild(video);
  poc.instance.detector.checkVideos();
  poc.instance.setSubtitlesDisplay(true);
  poc.instance.syncEngine.setCues([
    { startTime: 0, endTime: 5, text: "透明度テスト1" },
    { startTime: 5, endTime: 10, text: "透明度テスト2" }
  ]);
  video.seek(2.0);

  const box = env.mockDoc.getElementById("ankiminer-video-subtitle-box");
  assert.ok(box);

  // Send message to set opacity to 0.4
  await env.sendRuntimeMessage({ type: "SET_SUBTITLE_OPACITY", opacity: 0.4 });
  assert.ok(box.style.background.includes("0.4"), "Box background opacity must reflect 0.4");

  // Advance to next cue: opacity must persist
  video.seek(6.0);
  assert.ok(box.style.background.includes("0.4"), "Box background opacity must persist on new cues");
});

