const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockEnvironment } = require("./env.js");

test("S02: Fullscreen mode overlay attachment & visibility", async () => {
  const env = createMockEnvironment();
  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__ || env.vmContext.window.__KIROKU_VIDEO_POC__;

  const playerContainer = new env.MockElement("DIV", "player-container");
  const video = new env.MockVideoElement("fullscreen-video");
  playerContainer.appendChild(video);
  env.rootBody.appendChild(playerContainer);

  poc.instance.detector.checkVideos();
  poc.instance.setSubtitlesDisplay(true);
  poc.instance.syncEngine.setCues([{ startTime: 0, endTime: 10, text: "全画面テスト" }]);
  video.seek(2.0);

  const overlayContainer = env.mockDoc.getElementById("ankiminer-video-overlay-container");
  assert.ok(overlayContainer);

  // Enter Fullscreen on player container
  env.mockDoc.fullscreenElement = playerContainer;
  for (const fn of env.docEventListeners["fullscreenchange"] || []) {
    fn();
  }

  // Overlay container must be attached inside playerContainer (top layer)
  assert.equal(overlayContainer.parentElement, playerContainer, "Overlay must reparent into fullscreen element");
  assert.equal(overlayContainer.style.display, "flex", "Overlay must remain visible in fullscreen");
  assert.equal(env.mockDoc.getElementById("ankiminer-video-subtitle").textContent, "全画面テスト");
});

