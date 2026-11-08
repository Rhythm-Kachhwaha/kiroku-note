const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const TitleParser = require("../lib/title-parser.js");

const TEST_CASES = [
  {
    raw: "Crunchyroll - Jujutsu Kaisen Episode 1",
    url: "https://crunchyroll.com/watch/123",
    expectedTitle: "Jujutsu Kaisen",
    expectedEp: 1
  },
  {
    raw: "Watch Attack on Titan Season 4 Ep. 2 English Sub/Dub online Free on HiAnime.to",
    url: "https://hianime.to/watch/attack-on-titan-season-4-112?ep=2",
    expectedTitle: "Attack on Titan Season 4",
    expectedEp: 2
  },
  {
    raw: "Bilibili - Frieren E05",
    url: "https://bilibili.tv/en/play/12345/67890",
    expectedTitle: "Frieren",
    expectedEp: 5
  },
  {
    raw: "Chainsaw Man - 03 (TV)",
    url: "",
    expectedTitle: "Chainsaw Man",
    expectedEp: 3
  },
  {
    raw: "[SubsPlease] Sousou no Frieren - 12 (1080p) [ABCD1234]",
    url: "",
    expectedTitle: "Sousou no Frieren",
    expectedEp: 12
  },
  {
    raw: "One Piece - Episode 1085 [English Sub]",
    url: "https://crunchyroll.com/one-piece",
    expectedTitle: "One Piece",
    expectedEp: 1085
  },
  {
    raw: "Demon Slayer: Kimetsu no Yaiba Swordsmith Village Arc - Episode 5 - A Connected Sword",
    url: "",
    expectedTitle: "Demon Slayer: Kimetsu no Yaiba Swordsmith Village Arc",
    expectedEp: 5
  },
  {
    raw: "Spy x Family Part 2 - 01 (13)",
    url: "",
    expectedTitle: "Spy x Family Part 2",
    expectedEp: 1
  },
  {
    raw: "Oshi no Ko Ep 11 - 1080p Web-DL",
    url: "",
    expectedTitle: "Oshi no Ko",
    expectedEp: 11
  },
  {
    raw: "Vinland Saga Season 2 Episode 24 [1080p]",
    url: "",
    expectedTitle: "Vinland Saga Season 2",
    expectedEp: 24
  },
  {
    raw: "Bleach: Thousand-Year Blood War - Episode 21",
    url: "",
    expectedTitle: "Bleach: Thousand-Year Blood War",
    expectedEp: 21
  },
  {
    raw: "Boku no Hero Academia 6th Season - Episode 138",
    url: "",
    expectedTitle: "Boku no Hero Academia 6th Season",
    expectedEp: 138
  },
  {
    raw: "Mob Psycho 100 III - 08",
    url: "",
    expectedTitle: "Mob Psycho 100 III",
    expectedEp: 8
  },
  {
    raw: "Cyberpunk: Edgerunners - Episode 04",
    url: "",
    expectedTitle: "Cyberpunk: Edgerunners",
    expectedEp: 4
  },
  {
    raw: "Mushoku Tensei II: Isekai Ittara Honki Dasu - 06",
    url: "",
    expectedTitle: "Mushoku Tensei II: Isekai Ittara Honki Dasu",
    expectedEp: 6
  },
  {
    raw: "Dungeon Meshi - E02 [Netflix]",
    url: "",
    expectedTitle: "Dungeon Meshi",
    expectedEp: 2
  },
  {
    raw: "【推しの子】 第11話「アイドル」",
    url: "",
    expectedTitle: "【推しの子】",
    expectedEp: 11
  },
  {
    raw: "チェンソーマン #12",
    url: "",
    expectedTitle: "チェンソーマン",
    expectedEp: 12
  },
  {
    raw: "Spy x Family Part 2 - 25 (English Dub)",
    url: "",
    expectedTitle: "Spy x Family Part 2",
    expectedEp: 25
  }
];

test("TitleParser correctly extracts anime show title and episode number across 16 site conventions", () => {
  for (const tc of TEST_CASES) {
    const res = TitleParser.cleanAnimeTitle(tc.raw, tc.url);
    assert.equal(res.title, tc.expectedTitle, `Expected title "${tc.expectedTitle}", got "${res.title}" for input "${tc.raw}"`);
    assert.equal(res.episode, tc.expectedEp, `Expected ep "${tc.expectedEp}", got "${res.episode}" for input "${tc.raw}"`);
  }
});

test("TitleParser generates reproducible site-scoped cache keys", () => {
  const k1 = TitleParser.hashTitleKey("hianime.to", "Frieren");
  const k2 = TitleParser.hashTitleKey("HiAnime.to", "frieren");
  const k3 = TitleParser.hashTitleKey("crunchyroll.com", "Frieren");

  assert.equal(k1, k2, "Cache key should be case-insensitive for same site and show");
  assert.notEqual(k1, k3, "Different sites should produce different cache keys");
  assert.ok(k1.startsWith("kiroku.sub_choice.hianimeto."), `Key should follow format: ${k1}`);
});

