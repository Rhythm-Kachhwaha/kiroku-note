const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockEnvironment } = require("./env.js");

test("S09: Timestamp extraction & card-from-clip capture dispatch", async () => {
  const env = createMockEnvironment();
  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__ || env.vmContext.window.__KIROKU_VIDEO_POC__;

  const video = new env.MockVideoElement("clip-video");
  env.rootBody.appendChild(video);
  poc.instance.detector.checkVideos();
  poc.instance.setSubtitlesDisplay(true);

  poc.instance.syncEngine.setCues([
    { startTime: 12.5, endTime: 17.2, text: "これが真実だ" }
  ]);
  video.seek(14.0);

  // Simulate selecting Japanese subtitle text on the overlay
  env.setSelection("真実");
  const subtitle = env.mockDoc.getElementById("ankiminer-video-subtitle");
  subtitle.dispatchEvent({ type: "mouseup", stopPropagation: () => {} });

  await new Promise((r) => setTimeout(r, 20));

  const captureMsg = env.sentMessages.find((m) => m.type === "JAPANESE_TEXT_CAPTURED");
  assert.ok(captureMsg, "Must dispatch JAPANESE_TEXT_CAPTURED");
  assert.equal(captureMsg.text, "真実");
  assert.equal(captureMsg.sourceType, "video");
  assert.equal(captureMsg.videoTimestamp, 14.0, "Must extract and include exact video timestamp");
  assert.ok(captureMsg.cue, "Must include cue metadata");
  assert.equal(captureMsg.cue.text, "これが真実だ");
});

