const test = require("node:test");
const assert = require("node:assert/strict");
const SubtitleParser = require("../lib/subtitle-parser.js");

const sampleASS = `[Script Info]
Title: Sample Anime Episode
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,50,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:01:20.50,0:01:23.80,Default,,0,0,0,,{\\pos(192,200)}こんにちは、\\N世界！
Dialogue: 0,0:01:25.00,0:01:28.15,Default,Hero,0,0,0,,{\\fad(200,200)\\b1}日本語の勉強{\\b0}は楽しいです。
Dialogue: 1,0:02:10.10,0:02:12.90,Default,,0,0,0,,{\\an8\\fs40}【ナレーション】\\n次の町へ向かう。
Comment: 0,0:02:15.00,0:02:20.00,Default,,0,0,0,,Note to translator: ignore this
Dialogue: 0,0:02:30.00,0:02:32.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}
`;

const sampleSSA = `[Script Info]
ScriptType: v4.00

[Events]
Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: Marked=0,0:00:05.10,0:00:08.50,Default,,0000,0000,0000,,魔法少女まどか☆マギカ
`;

test("SubtitleParser - parseASS correctly parses ASS subtitles", () => {
  assert.ok(typeof SubtitleParser.parseASS === "function", "parseASS method must exist");
  const cues = SubtitleParser.parseASS(sampleASS);

  assert.equal(cues.length, 3, "Should parse 3 valid dialogue lines (excluding comments and drawing commands)");

  // Cue 1
  assert.equal(cues[0].id, 1);
  assert.equal(cues[0].startTime, 80.5);
  assert.equal(cues[0].endTime, 83.8);
  assert.equal(cues[0].text, "こんにちは、\n世界！");

  // Cue 2
  assert.equal(cues[1].id, 2);
  assert.equal(cues[1].startTime, 85.0);
  assert.equal(cues[1].endTime, 88.15);
  assert.equal(cues[1].text, "日本語の勉強は楽しいです。");

  // Cue 3
  assert.equal(cues[2].id, 3);
  assert.equal(cues[2].startTime, 130.1);
  assert.equal(cues[2].endTime, 132.9);
  assert.equal(cues[2].text, "【ナレーション】\n次の町へ向かう。");
});

test("SubtitleParser - parseASS correctly parses SSA v4 format", () => {
  const cues = SubtitleParser.parseASS(sampleSSA);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].startTime, 5.1);
  assert.equal(cues[0].endTime, 8.5);
  assert.equal(cues[0].text, "魔法少女まどか☆マギカ");
});

test("SubtitleParser - parseSubtitles auto-detects ASS / SSA", () => {
  // Hint with extension
  const cuesFromHint = SubtitleParser.parseSubtitles(sampleASS, "episode_01.ass");
  assert.equal(cuesFromHint.length, 3);

  const cuesFromSsaHint = SubtitleParser.parseSubtitles(sampleSSA, "episode_01.ssa");
  assert.equal(cuesFromSsaHint.length, 1);

  // Content sniffing without hint
  const sniffedCues = SubtitleParser.parseSubtitles(sampleASS);
  assert.equal(sniffedCues.length, 3);
});

test("SubtitleParser - parseASS handles edge cases gracefully", () => {
  assert.deepEqual(SubtitleParser.parseASS(""), []);
  assert.deepEqual(SubtitleParser.parseASS(null), []);
  assert.deepEqual(SubtitleParser.parseASS("Just random text with no headers"), []);
  
  // Malformed line with invalid timestamps
  const malformed = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,INVALID,0:01:00.00,Default,,0,0,0,,テスト
Dialogue: 0,0:02:00.00,0:01:00.00,Default,,0,0,0,,Reverse time
Dialogue: 0,0:01:00.00,0:01:05.00,Default,,0,0,0,,有効な字幕
`;
  const validOnly = SubtitleParser.parseASS(malformed);
  assert.equal(validOnly.length, 1);
  assert.equal(validOnly[0].text, "有効な字幕");
});
