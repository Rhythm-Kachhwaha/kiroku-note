const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockEnvironment } = require("./env.js");

test("S03: Fullscreen exit restoration", async () => {
  const env = createMockEnvironment();
  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__ || env.vmContext.window.__KIROKU_VIDEO_POC__;

  const playerContainer = new env.MockElement("DIV", "player-container");
  const video = new env.MockVideoElement("exit-fs-video");
  playerContainer.appendChild(video);
  env.rootBody.appendChild(playerContainer);

  poc.instance.detector.checkVideos();
  poc.instance.setSubtitlesDisplay(true);
  poc.instance.syncEngine.setCues([{ startTime: 0, endTime: 10, text: "フルスクリーン復帰" }]);
  video.seek(2.0);

  const overlayContainer = env.mockDoc.getElementById("ankiminer-video-overlay-container");

  // Enter then exit fullscreen
  env.mockDoc.fullscreenElement = playerContainer;
  for (const fn of env.docEventListeners["fullscreenchange"] || []) fn();

  env.mockDoc.fullscreenElement = null;
  for (const fn of env.docEventListeners["fullscreenchange"] || []) fn();

  // Overlay must be restored to player wrapper or body, cue text intact
  assert.ok(overlayContainer.isConnected);
  assert.equal(overlayContainer.parentElement, playerContainer);
  assert.equal(overlayContainer.style.display, "flex");
  assert.equal(env.mockDoc.getElementById("ankiminer-video-subtitle").textContent, "フルスクリーン復帰");
});

