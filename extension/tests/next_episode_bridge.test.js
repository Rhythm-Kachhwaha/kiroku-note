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

test('next_episode_bridge: LinkBridge executes cmd.next_episode', () => {
  const { LinkBridge } = require('../content/link-bridge.js');
  let clicked = false;
  const mockDetector = {
    hasNextEpisode: () => true,
    triggerNextEpisode: () => {
      clicked = true;
      return true;
    }
  };

  const bridge = new LinkBridge({
    chromeRuntime: { onMessage: { addListener: () => {} } }
  });
  bridge.nextEpisodeDetector = mockDetector;

  const handled = bridge.executeCommand('cmd.next_episode', {});
  assert.equal(handled, true);
  assert.equal(clicked, true);
});

test('next_episode_bridge: LinkBridge resolves NextEpisodeDetector from globalThis', () => {
  const { KirokuVideoController } = require('../content/video-mining/controller.js');
  globalThis.KirokuVideoController = KirokuVideoController;
  const { LinkBridge } = require('../content/link-bridge.js');
  const bridge = new LinkBridge({
    chromeRuntime: { onMessage: { addListener: () => {} } }
  });
  assert.ok(bridge.nextEpisodeDetector, "Must instantiate NextEpisodeDetector from global");
  delete globalThis.KirokuVideoController;
});

test('next_episode_bridge: LinkBridge cleans raw video title using TitleParser', () => {
  const TitleParser = require('../lib/title-parser.js');
  globalThis.TitleParser = TitleParser;
  const { LinkBridge } = require('../content/link-bridge.js');
  const bridge = new LinkBridge({
    chromeRuntime: { onMessage: { addListener: () => {} } }
  });
  globalThis.document = { title: 'Watch Attack on Titan Episode 15 Online Free - Crunchyroll', querySelector: () => null };
  const cleaned = bridge._getVideoTitle();
  assert.equal(cleaned, 'Attack on Titan - Ep 15');
  delete globalThis.document;
  delete globalThis.TitleParser;
});

