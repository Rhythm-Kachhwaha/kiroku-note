const test = require("node:test");
const assert = require("node:assert/strict");
const TitleParser = require("../lib/title-parser.js");

function makeHiAnimeDoc(epNumber) {
  return {
    querySelector(selector) {
      if (!epNumber || !selector.includes("ep-item.active")) return null;
      return {
        getAttribute(attr) {
          return attr === "data-number" ? String(epNumber) : null;
        },
        querySelector() {
          return { textContent: String(epNumber) };
        },
        textContent: String(epNumber),
      };
    },
  };
}

test("HiAnime K-ON! ground truth simulation: unique keys, clean titles, no bogus ?ep= IDs", () => {
  const cases = [
    {
      name: "K-ON! S1 Ep 1",
      url: "https://hianime.fm/watch/k-on-4052?ep=52268",
      docTitle: "Watch K-ON! English Sub/Dub online Free on HiAnime.to",
      domEp: 1,
      expectedKey: "hianime/k-on-4052/ep52268",
      expectedTitle: "K-ON!",
      expectedEpisode: 1,
    },
    {
      name: "K-ON! S1 Ep 10",
      url: "https://hianime.fm/watch/k-on-4052?ep=52277",
      docTitle: "Watch K-ON! English Sub/Dub online Free on HiAnime.to",
      domEp: 10,
      expectedKey: "hianime/k-on-4052/ep52277",
      expectedTitle: "K-ON!",
      expectedEpisode: 10,
    },
    {
      name: "K-ON! S2 Ep 2",
      url: "https://hianime.fm/watch/k-on-season-2-2926?ep=37507",
      docTitle: "Watch K-ON! Season 2 English Sub/Dub online Free on HiAnime.to",
      domEp: 2,
      expectedKey: "hianime/k-on-season-2-2926/ep37507",
      expectedTitle: "K-ON! Season 2",
      expectedEpisode: 2,
    },
    {
      name: "K-ON! OVA (Live House)",
      url: "https://hianime.fm/watch/k-on-live-house-6360?ep=84150",
      docTitle: "Watch K-ON! Live House! English Sub/Dub online Free on HiAnime.to",
      domEp: 1,
      expectedKey: "hianime/k-on-live-house-6360/ep84150",
      expectedTitle: "K-ON! Live House!",
      expectedEpisode: 1,
    },
    {
      name: "K-ON! Movie",
      url: "https://hianime.fm/watch/k-on-the-movie-4664?ep=59294",
      docTitle: "Watch K-ON! The Movie English Sub/Dub online Free on HiAnime.to",
      domEp: null,
      expectedKey: "hianime/k-on-the-movie-4664/ep59294",
      expectedTitle: "K-ON! The Movie",
      expectedEpisode: null,
    },
    {
      name: "K-ON! OVA 2 (Keikaku)",
      url: "https://hianime.fm/watch/k-on-plan-6359?ep=84149",
      docTitle: "Watch K-ON! Plan! English Sub/Dub online Free on HiAnime.to",
      domEp: 1,
      expectedKey: "hianime/k-on-plan-6359/ep84149",
      expectedTitle: "K-ON! Plan!",
      expectedEpisode: 1,
    },
  ];

  for (const c of cases) {
    const key = TitleParser.parseEpisodeKey(c.url, c.docTitle);
    assert.equal(key, c.expectedKey, `${c.name}: episodeKey mismatch`);

    const parsedWithDom = TitleParser.cleanAnimeTitle(c.docTitle, c.url, makeHiAnimeDoc(c.domEp));
    assert.equal(parsedWithDom.title, c.expectedTitle, `${c.name}: title mismatch`);
    assert.equal(parsedWithDom.episode, c.expectedEpisode, `${c.name}: DOM episode mismatch`);

    const parsedWithoutDom = TitleParser.cleanAnimeTitle(c.docTitle, c.url);
    assert.equal(parsedWithoutDom.title, c.expectedTitle, `${c.name}: title mismatch without DOM`);
    assert.equal(parsedWithoutDom.episode, null, `${c.name}: must not leak HiAnime ?ep= ID as episode`);
  }
});

test("TitleParser: Season/Part numbers are not stripped as episode numbers", () => {
  const s2 = TitleParser.cleanAnimeTitle("K-ON! Season 2", "https://hianime.fm/watch/k-on-season-2-2926?ep=37507");
  assert.equal(s2.title, "K-ON! Season 2");
  assert.equal(s2.episode, null);

  const p2 = TitleParser.cleanAnimeTitle("Attack on Titan Final Season Part 2");
  assert.equal(p2.title, "Attack on Titan Final Season Part 2");
  assert.equal(p2.episode, null);
});

test("Iframe HUD & background.js resolve top-tab HiAnime URL, title, and DOM episode", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const hudSrc = fs.readFileSync(path.join(__dirname, "../content/anime-hud.js"), "utf8");
  const bgSrc = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");

  assert.ok(hudSrc.includes("async _getPageContext()"), "anime-hud.js must implement _getPageContext()");
  assert.ok(hudSrc.includes('type: "GET_TAB_INFO"'), "anime-hud.js must query GET_TAB_INFO when inside an iframe");
  assert.ok(bgSrc.includes("frameIds: [0]") && bgSrc.includes("domEpisode"), "background.js GET_TAB_INFO must read domEpisode from top frame");
});

test("Extension fetches Jimaku key via background.js Kiroku account and restores #video-track-select", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const bgSrc = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
  const hudSrc = fs.readFileSync(path.join(__dirname, "../content/anime-hud.js"), "utf8");
  const jpSrc = fs.readFileSync(path.join(__dirname, "../lib/jimaku-provider.js"), "utf8");
  const htmlSrc = fs.readFileSync(path.join(__dirname, "../sidepanel/sidepanel.html"), "utf8");

  assert.ok(bgSrc.includes('message?.type === "GET_JIMAKU_KEY"'), "background.js must handle GET_JIMAKU_KEY");
  assert.ok(bgSrc.includes("getStoredCloudToken()"), "GET_JIMAKU_KEY must use stored Kiroku cloud token");
  assert.ok(hudSrc.includes('type: "GET_JIMAKU_KEY"'), "anime-hud.js must request Jimaku key via GET_JIMAKU_KEY");
  assert.ok(jpSrc.includes('type: "GET_JIMAKU_KEY"'), "jimaku-provider.js must fall back to GET_JIMAKU_KEY");
  assert.ok(htmlSrc.includes('id="video-track-select"'), "sidepanel.html must include #video-track-select");
});
