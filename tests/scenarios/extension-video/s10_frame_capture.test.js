const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockEnvironment } = require("./env.js");

test("S10: Frame screenshot capture flow", async () => {
  const env = createMockEnvironment();
  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__ || env.vmContext.window.__KIROKU_VIDEO_POC__;

  const video = new env.MockVideoElement("capture-video");
  env.rootBody.appendChild(video);
  poc.instance.detector.checkVideos();

  video.seek(25.5);

  const result = await poc.instance.captureCurrentFrame();
  assert.ok(result.ok, "Screenshot capture must succeed");
  assert.ok(result.dataUrl.startsWith("data:image/jpeg"), "Must return image dataUrl");

  const capturedMsg = env.sentMessages.find((m) => m.type === "SCREENSHOT_CAPTURED");
  assert.ok(capturedMsg, "Must dispatch SCREENSHOT_CAPTURED message");
  assert.equal(capturedMsg.timestamp, 25.5, "Must carry video timestamp in captured screenshot");
});

