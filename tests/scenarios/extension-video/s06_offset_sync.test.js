const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockEnvironment } = require("./env.js");

test("S06: Subtitle offset adjustment & sync without delay", async () => {
  const env = createMockEnvironment();
  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__ || env.vmContext.window.__KIROKU_VIDEO_POC__;

  const video = new env.MockVideoElement("offset-test-video");
  env.rootBody.appendChild(video);
  poc.instance.detector.checkVideos();
  poc.instance.setSubtitlesDisplay(true);
  poc.instance.syncEngine.setCues([
    { startTime: 10, endTime: 15, text: "同期テスト" }
  ]);

  // At video.currentTime = 9.8s, with 0 offset, cue is not yet active
  video.seek(9.8);
  const subtitle = env.mockDoc.getElementById("ankiminer-video-subtitle");
  assert.equal(subtitle.textContent, "");

  // Shift offset by -300ms (subtitles appear 300ms earlier, at 9.7s)
  await env.sendRuntimeMessage({ type: "SET_SUBTITLE_OFFSET", offsetMs: -300 });
  assert.equal(poc.instance.syncEngine.offsetMs, -300);

  // At 9.8s with offset -300ms (effective 10.1s unshifted), cue must now be active!
  video.seek(9.8);
  assert.equal(subtitle.textContent, "同期テスト", "Cue must become active after offset shift");
});
