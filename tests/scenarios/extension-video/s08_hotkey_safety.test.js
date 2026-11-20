const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockEnvironment } = require("./env.js");

test("S08: Hotkey safety & form element protection", async () => {
  const env = createMockEnvironment();
  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__ || env.vmContext.window.__KIROKU_VIDEO_POC__;

  const video = new env.MockVideoElement("hotkey-video");
  env.rootBody.appendChild(video);
  poc.instance.detector.checkVideos();
  poc.instance.syncEngine.setCues([
    { startTime: 0, endTime: 5, text: "Line 1" },
    { startTime: 5, endTime: 10, text: "Line 2" },
    { startTime: 10, endTime: 15, text: "Line 3" }
  ]);
  video.seek(7.0);

  // 1. SELECT element
  const select = new env.MockElement("SELECT");
  env.rootBody.appendChild(select);
  let res = env.dispatchKeyEvent({ key: "d", target: select });
  assert.equal(res.defaultPrevented, false, "Key 'd' in SELECT must not be intercepted");
  assert.equal(video.currentTime, 7.0, "Video must not seek when pressing 'd' in select");

  // 2. INPUT element
  const input = new env.MockElement("INPUT");
  env.rootBody.appendChild(input);
  res = env.dispatchKeyEvent({ key: "a", target: input });
  assert.equal(res.defaultPrevented, false, "Key 'a' in INPUT must not be intercepted");
  assert.equal(video.currentTime, 7.0);

  // 3. TEXTAREA element
  const textarea = new env.MockElement("TEXTAREA");
  env.rootBody.appendChild(textarea);
  res = env.dispatchKeyEvent({ key: "s", target: textarea });
  assert.equal(res.defaultPrevented, false, "Key 's' in TEXTAREA must not be intercepted");
  assert.equal(video.currentTime, 7.0);

  // 4. Contenteditable element
  const editable = new env.MockElement("DIV");
  editable.isContentEditable = true;
  env.rootBody.appendChild(editable);
  res = env.dispatchKeyEvent({ key: " ", code: "Space", target: editable });
  assert.equal(res.defaultPrevented, false, "Space in contenteditable must not be intercepted");
  assert.equal(video.paused, true);
});

