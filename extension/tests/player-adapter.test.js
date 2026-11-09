/**
 * Unit & Integration tests for Kiroku Player Adapters (HTML5, YouTube, Netflix)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { PlayerAdapter, PlayerAdapterRegistry, defaultPlayerRegistry } = require("../content/player/player-adapter.js");
const { HTML5PlayerAdapter } = require("../content/player/html5-adapter.js");
const { YouTubePlayerAdapter } = require("../content/player/youtube-player.js");
const { NetflixPlayerAdapter } = require("../content/player/netflix-player.js");

function createMockVideo(overrides = {}) {
  return {
    tagName: "VIDEO",
    currentTime: 12.5,
    duration: 120.0,
    paused: true,
    playbackRate: 1.0,
    videoWidth: 1920,
    videoHeight: 1080,
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
    closest(selector) {
      if (overrides.classes && overrides.classes.some(c => selector.includes(c))) {
        return { tagName: "DIV", className: overrides.classes.join(" ") };
      }
      return null;
    },
    classList: {
      contains(name) {
        return Boolean(overrides.classes && overrides.classes.includes(name));
      }
    },
    ...overrides
  };
}

test("PlayerAdapter base operations & defaults", () => {
  const video = createMockVideo();
  const adapter = new PlayerAdapter(video);

  assert.equal(adapter.getCurrentTime(), 12.5);
  assert.equal(adapter.getDuration(), 120.0);
  assert.equal(adapter.isPaused(), true);

  adapter.play();
  assert.equal(adapter.isPaused(), false);

  adapter.pause();
  assert.equal(adapter.isPaused(), true);

  adapter.seek(45.0);
  assert.equal(video.currentTime, 45.0);

  adapter.setPlaybackRate(1.5);
  assert.equal(video.playbackRate, 1.5);

  const caps = adapter.getCapabilities();
  assert.equal(caps.seek, true);
  assert.equal(caps.playbackRate, true);

  adapter.destroy();
  assert.equal(adapter.video, null);
  assert.equal(adapter.getCurrentTime(), 0);
});

test("PlayerAdapterRegistry resolves correct adapters", () => {
  const registry = new PlayerAdapterRegistry();
  registry.register(HTML5PlayerAdapter);
  registry.register(YouTubePlayerAdapter);
  registry.register(NetflixPlayerAdapter);

  const genericVideo = createMockVideo();
  const genericAdapter = registry.resolve(genericVideo);
  assert.ok(genericAdapter instanceof HTML5PlayerAdapter);

  const ytVideo = createMockVideo({ classes: ["html5-video-player"] });
  const ytAdapter = registry.resolve(ytVideo);
  assert.ok(ytAdapter instanceof YouTubePlayerAdapter);

  const netflixVideo = createMockVideo({ classes: ["watch-video"] });
  const netflixAdapter = registry.resolve(netflixVideo);
  assert.ok(netflixAdapter instanceof NetflixPlayerAdapter);
  assert.equal(netflixAdapter.getCapabilities().seek, false, "Netflix seek capability must be false until proven");
});
