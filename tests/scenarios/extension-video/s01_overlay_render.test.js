const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockEnvironment } = require("./env.js");

test("S01: Video overlay render & tokenization display", async () => {
  const env = createMockEnvironment();
  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__ || env.vmContext.window.__KIROKU_VIDEO_POC__;
  assert.ok(poc, "Video mining POC must be initialized in window context");

  const video = new env.MockVideoElement("test-player-video");
  env.rootBody.appendChild(video);
  poc.instance.detector.checkVideos();
  assert.equal(poc.instance.activeVideo, video);

  // Enable subtitle display and load test cue with tokens
  poc.instance.setSubtitlesDisplay(true);
  poc.instance.syncEngine.setCues([
    {
      startTime: 5,
      endTime: 10,
      text: "俺は見間違えた",
      tokens: [
        { surface: "俺", status: "should-know" },
        { surface: "は", status: "unstyled" },
        { surface: "見間違えた", status: "mined" }
      ]
    }
  ]);

  video.seek(6.0);

  const container = env.mockDoc.getElementById("ankiminer-video-overlay-container");
  const subtitle = env.mockDoc.getElementById("ankiminer-video-subtitle");
  assert.ok(container, "Overlay container must exist in DOM");
  assert.ok(subtitle, "Subtitle element must exist in DOM");
  assert.equal(container.style.display, "flex");
  assert.equal(subtitle.textContent, "俺は見間違えた");

  const tokens = subtitle.querySelectorAll(".video-sub-token");
  assert.equal(tokens.length, 3, "All 3 tokens must be rendered as spans");
  assert.ok(tokens[0].className.includes("should-know"));
  assert.ok(tokens[2].className.includes("mined"));

  // Check no continuous RAF loop
  let rafCount = 0;
  env.mockWindow.requestAnimationFrame = () => { rafCount++; return 1; };
  video.play();
  video.seek(7.0);
  assert.equal(rafCount, 0, "No continuous RAF animation loop during playback");
});

