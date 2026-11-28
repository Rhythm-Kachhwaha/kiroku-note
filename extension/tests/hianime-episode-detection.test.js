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
