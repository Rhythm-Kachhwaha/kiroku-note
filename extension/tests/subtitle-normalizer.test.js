const test = require("node:test");
const assert = require("node:assert/strict");
const SubtitleParser = require("../lib/subtitle-parser.js");

test("SubtitleParser - normalizeCues strips speaker labels when requested", () => {
  assert.ok(typeof SubtitleParser.normalizeCues === "function", "normalizeCues method must exist");

  const rawCues = [
    { id: 1, startTime: 1.0, endTime: 3.0, text: "【田中】こんにちは、皆さん。" },
    { id: 2, startTime: 3.5, endTime: 5.0, text: "[Hero]: 俺は負けない！" },
    { id: 3, startTime: 5.5, endTime: 7.0, text: "(Narrator): そして旅が始まった。" },
    { id: 4, startTime: 7.5, endTime: 9.0, text: "田中: おはようございます。" },
    { id: 5, startTime: 9.5, endTime: 11.0, text: "「これは残すべきセリフです」" } // Japanese quotation brackets must NOT be stripped as speaker labels
  ];

  const normalized = SubtitleParser.normalizeCues(rawCues, { stripSpeakerLabels: true });

  assert.equal(normalized.length, 5);
  assert.equal(normalized[0].text, "こんにちは、皆さん。");
  assert.equal(normalized[1].text, "俺は負けない！");
  assert.equal(normalized[2].text, "そして旅が始まった。");
  assert.equal(normalized[3].text, "おはようございます。");
  assert.equal(normalized[4].text, "「これは残すべきセリフです」");
});

test("SubtitleParser - normalizeCues removes positioning metadata and HTML tags", () => {
  const rawCues = [
    { id: 1, startTime: 1.0, endTime: 3.0, text: "<v Narrator>line:0% size:50% align:start<b>こんにちは</b> &amp; さようなら</v>" },
    { id: 2, startTime: 3.5, endTime: 5.0, text: "{\\pos(192,200)\\c&HFFFFFF&}東京へ\\N行く。" }
  ];

  const normalized = SubtitleParser.normalizeCues(rawCues);

  assert.equal(normalized[0].text, "こんにちは & さようなら");
  assert.equal(normalized[1].text, "東京へ\n行く。");
});

test("SubtitleParser - normalizeCues deduplicates and merges consecutive identical cues", () => {
  const rawCues = [
    { id: 1, startTime: 1.0, endTime: 2.0, text: "こんにちは" },
    { id: 2, startTime: 2.0, endTime: 3.0, text: "こんにちは" }, // consecutive identical
    { id: 3, startTime: 4.0, endTime: 5.0, text: "ありがとう" },
    { id: 4, startTime: 4.0, endTime: 5.0, text: "ありがとう" }  // exact duplicate timestamp and text
  ];

  const normalized = SubtitleParser.normalizeCues(rawCues, { deduplicate: true });

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].text, "こんにちは");
  assert.equal(normalized[0].startTime, 1.0);
  assert.equal(normalized[0].endTime, 3.0);

  assert.equal(normalized[1].text, "ありがとう");
  assert.equal(normalized[1].startTime, 4.0);
  assert.equal(normalized[1].endTime, 5.0);
});

test("SubtitleParser - normalizeCues filters empty, whitespace, and invalid time cues", () => {
  const rawCues = [
    { id: 1, startTime: 1.0, endTime: 2.0, text: "有効" },
    { id: 2, startTime: 3.0, endTime: 4.0, text: "   " }, // whitespace only
    { id: 3, startTime: 5.0, endTime: 4.0, text: "逆時間" }, // start > end
    { id: 4, startTime: NaN, endTime: 6.0, text: "無効時間" },
    { id: 5, startTime: 7.0, endTime: 8.0, text: "" } // empty
  ];

  const normalized = SubtitleParser.normalizeCues(rawCues);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].text, "有効");
  assert.equal(normalized[0].id, 1);
});
