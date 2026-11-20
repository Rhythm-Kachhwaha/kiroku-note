const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockEnvironment } = require("./env.js");

test("S11: Hotkey safety for combobox and searchbox ancestors", async () => {
  const env = createMockEnvironment();
  const poc = env.vmContext.window.__ANKIMINER_VIDEO_POC__ || env.vmContext.window.__KIROKU_VIDEO_POC__;

  const video = new env.MockVideoElement("combobox-test-video");
  env.rootBody.appendChild(video);
  poc.instance.detector.checkVideos();
  poc.instance.syncEngine.setCues([{ startTime: 0, endTime: 10, text: "テスト" }]);
  video.seek(5.0);

  // Combobox container with inner span/button
  const combobox = new env.MockElement("DIV");
  combobox.setAttribute("role", "combobox");
  const innerSpan = new env.MockElement("SPAN");
  combobox.appendChild(innerSpan);
  env.rootBody.appendChild(combobox);

  // Searchbox container with inner input/div
  const searchbox = new env.MockElement("DIV");
  searchbox.setAttribute("role", "searchbox");
  const innerSearch = new env.MockElement("DIV");
  searchbox.appendChild(innerSearch);
  env.rootBody.appendChild(searchbox);

  // Keystroke on child of combobox must not be intercepted
  const res1 = env.dispatchKeyEvent({ key: "a", target: innerSpan });
  assert.equal(res1.defaultPrevented, false, "Hotkey 'a' in combobox child must not be intercepted");
  assert.equal(video.currentTime, 5.0, "Video must not seek");

  // Keystroke on child of searchbox must not be intercepted
  const res2 = env.dispatchKeyEvent({ key: "d", target: innerSearch });
  assert.equal(res2.defaultPrevented, false, "Hotkey 'd' in searchbox child must not be intercepted");
  assert.equal(video.currentTime, 5.0, "Video must not seek");
});

