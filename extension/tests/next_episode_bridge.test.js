const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Test NextEpisodeDetector
test('next_episode_bridge: NextEpisodeDetector identifies selectors and triggers click', () => {
  const { NextEpisodeDetector } = require('../content/video-mining/controller.js');
  const detector = new NextEpisodeDetector();

  // Mock DOM without next button
  const emptyDoc = {
    querySelector: () => null
  };
  assert.equal(detector.hasNextEpisode(emptyDoc), false);
  assert.equal(detector.triggerNextEpisode(emptyDoc), false);

  // Mock DOM with Netflix next button
  let clicked = false;
  const mockBtn = {
    click: () => { clicked = true; }
  };
  const netflixDoc = {
    querySelector: (selector) => {
      if (selector.includes('data-uia="next-episode-seamless-button"') || selector.includes('ytp-next-button')) {
        return mockBtn;
      }
      return null;
    }
  };

  assert.equal(detector.hasNextEpisode(netflixDoc), true);
  const result = detector.triggerNextEpisode(netflixDoc);
  assert.equal(result, true);
  assert.equal(clicked, true);
});


