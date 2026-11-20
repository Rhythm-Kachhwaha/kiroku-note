const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockEnvironment } = require("./env.js");

test("S12: Subtitle position preset string handling", async () => {
  const env = createMockEnvironment();
  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__ || env.vmContext.window.__KIROKU_VIDEO_POC__;

  const video = new env.MockVideoElement("preset-test-video");
  env.rootBody.appendChild(video);
  poc.instance.detector.checkVideos();
  poc.instance.setSubtitlesDisplay(true);
  poc.instance.syncEngine.setCues([{ startTime: 0, endTime: 10, text: "プリセット位置" }]);
  video.seek(2.0);

  // 1. Send preset "top"
  await env.sendRuntimeMessage({ type: "SET_SUBTITLE_POSITION", position: "top" });
  const posTop = poc.instance.renderer.getPosition();
  assert.equal(posTop.relY, 0.12, "Preset 'top' must set relY to top region (0.12)");

  // Verify stored in chrome.storage.local
  const stored = await env.mockChrome.storage.local.get("subtitle_overlay_position");
  assert.ok(stored.subtitle_overlay_position, "Position must be persisted to storage");
  assert.equal(stored.subtitle_overlay_position.relY, 0.12);

  // 2. Send preset "bottom"
  await env.sendRuntimeMessage({ type: "SET_SUBTITLE_POSITION", position: "bottom" });
  const posBottom = poc.instance.renderer.getPosition();
  assert.equal(posBottom.relY, 0.78, "Preset 'bottom' must restore default bottom relY (0.78)");
});

