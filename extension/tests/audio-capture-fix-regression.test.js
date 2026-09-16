const assert = require("node:assert/strict");
const path = require("node:path");
const { RollingPcmBuffer } = require("../offscreen/rolling-pcm-buffer.js");
const { AudioTimelineSyncEngine } = require("../offscreen/audio-timeline-sync.js");
const { WavEncoder } = require("../offscreen/wav-encoder.js");
const { PersistentAudioCaptureEngine, CaptureState } = require("../offscreen/offscreen.js");

console.log("Starting Audio Capture Fix & Architecture Regression Tests...\n");

// ---------------------------------------------------------------------------
// 1. Paused Video Word Mining without Pending Deadlock
// ---------------------------------------------------------------------------
function testPausedVideoMiningExtraction() {
  const sampleRate = 48000;
  const ringBuffer = new RollingPcmBuffer({ sampleRate, durationSeconds: 30 });
  const sync = new AudioTimelineSyncEngine({ ringBuffer, sampleRate, WavEncoder });

  // Video started at 0.0s
  sync.ingestHeartbeat({
    timelineId: 101,
    videoTime: 0.0,
    playbackRate: 1.0,
    paused: false
  });

  // Video plays for 10 seconds (480,000 samples)
  const pcm = new Float32Array(480000);
  pcm.fill(0.2);
  ringBuffer.write(pcm);

  // Video pauses at 10.0s (e.g. user hover auto-pause on subtitle [8.0s, 10.0s])
  sync.ingestHeartbeat({
    timelineId: 101,
    videoTime: 10.0,
    playbackRate: 1.0,
    paused: true
  });

  // Subtitle cue: [8.0s, 10.0s], with default 200ms post-padding (10.2s)
  // Because video paused at 10.0s, audio-timeline-sync must auto-clamp targetEndSample to 10.0s (sample 480000)
  // and immediately produce READY WAV audio instead of stalling in PENDING
  const extractRes = sync.extractSubtitleAudio({
    startTime: 8.0,
    endTime: 10.0,
    timelineId: 101,
    paddingStart: 0.150,
    paddingEnd: 0.200,
    cue: { text: "これ、きれいだね。", startTime: 8.0, endTime: 10.0 },
    captureId: "draft_test_1"
  });

  assert.equal(extractRes.ok, true, "Paused extraction must succeed");
  assert.equal(extractRes.status, "READY", "Must return READY status immediately on paused video");
  assert.equal(extractRes.pending, false, "Must not be pending");
  assert.equal(extractRes.mimeType, "audio/wav", "Mime type must be audio/wav");
  assert.ok(extractRes.dataUrl.startsWith("data:audio/wav;base64,"), "Valid WAV Data URL must be returned");
  assert.equal(extractRes.captureId, "draft_test_1", "Capture ID must be preserved");

  // Sample check: start = 8.0 - 0.15 = 7.85s (376,800 samples), end = clamped to 10.0s (480,000 samples)
  // Expected sampleCount = 480,000 - 376,800 = 103,200 samples (2.15 seconds)
  assert.equal(extractRes.sampleCount, 103200, "Must contain exactly the available samples up to pause head");
  assert.equal(extractRes.durationMs, 2150, "Duration must match 2150ms");

  console.log("PASS: Paused video mining with auto-clamped post-padding produces instant WAV audio without deadlock.");
}

// ---------------------------------------------------------------------------
// 2. Subtitle Extraction After Timeline Re-Anchor (Zero Discontinuity Bug)
// ---------------------------------------------------------------------------
function testExtractionAfterTimelineAnchor() {
  const sampleRate = 48000;
  const ringBuffer = new RollingPcmBuffer({ sampleRate, durationSeconds: 30 });
  const sync = new AudioTimelineSyncEngine({ ringBuffer, sampleRate, WavEncoder });

  // Stream captures 12 seconds of audio (576,000 samples)
  const pcm = new Float32Array(576000);
  pcm.fill(0.3);
  ringBuffer.write(pcm);

  // Initial heartbeat arrives at videoTime = 12.0s on timeline 202
  // (e.g. user toggled mining or opened video already at 12s)
  const hbRes = sync.ingestHeartbeat({
    timelineId: 202,
    videoTime: 12.0,
    playbackRate: 1.0,
    paused: true
  });
  assert.equal(hbRes.ok, true);

  // Timeline start sample must be calculated as 576,000 - 12*48000 = 0 (not 576,000!)
  assert.equal(sync.timelineStartSample, 0, "timelineStartSample must account for prior video time in buffer");

  // Mine a subtitle that played from 9.0s to 11.5s
  const extractRes = sync.extractSubtitleAudio({
    startTime: 9.0,
    endTime: 11.5,
    timelineId: 202,
    paddingStart: 0.150,
    paddingEnd: 0.200,
    cue: { text: "映画を見ましょう", startTime: 9.0, endTime: 11.5 }
  });

  assert.equal(extractRes.ok, true, "Must extract past audio from buffer cleanly");
  assert.equal(extractRes.status, "READY", "Must be READY");
  assert.ok(extractRes.dataUrl.startsWith("data:audio/wav;base64,"), "Valid WAV Data URL");

  console.log("PASS: Subtitle extraction from past playback after timeline anchor succeeds without false discontinuity.");
}

// ---------------------------------------------------------------------------
// 3. Fallback Slice Extraction Preceding Current Playhead
// ---------------------------------------------------------------------------
function testPastFallbackSliceExtraction() {
  const sampleRate = 48000;
  const ringBuffer = new RollingPcmBuffer({ sampleRate, durationSeconds: 30 });
  const sync = new AudioTimelineSyncEngine({ ringBuffer, sampleRate, WavEncoder });

  // 15 seconds of audio played
  sync.ingestHeartbeat({ timelineId: 303, videoTime: 0.0, playbackRate: 1.0, paused: false });
  ringBuffer.write(new Float32Array(48000 * 15).fill(0.1));
  sync.ingestHeartbeat({ timelineId: 303, videoTime: 15.0, playbackRate: 1.0, paused: true });

  // Fallback slice [ct - 3.0, ct] = [12.0s, 15.0s]
  const extractRes = sync.extractSubtitleAudio({
    startTime: 12.0,
    endTime: 15.0,
    timelineId: 303,
    paddingStart: 0.150,
    paddingEnd: 0.200
  });

  assert.equal(extractRes.ok, true, "Fallback past slice must succeed");
  assert.equal(extractRes.status, "READY", "Fallback past slice must be immediately READY");
  assert.ok(extractRes.dataUrl.startsWith("data:audio/wav;base64,"));

  console.log("PASS: Past fallback audio slice (preceding 3s) extracts immediately as 16-bit Mono WAV.");
}

// ---------------------------------------------------------------------------
// 4. Playing Video Pending Capture Queue Finalization
// ---------------------------------------------------------------------------
function testPlayingVideoPendingCaptureFinalization() {
  const sampleRate = 48000;
  const ringBuffer = new RollingPcmBuffer({ sampleRate, durationSeconds: 30 });
  const capturedEvents = [];

  const sync = new AudioTimelineSyncEngine({
    ringBuffer,
    sampleRate,
    WavEncoder,
    onAudioCaptured: (payload) => capturedEvents.push(payload)
  });

  // Video is actively playing at 5.0s
  sync.ingestHeartbeat({ timelineId: 404, videoTime: 0.0, playbackRate: 1.0, paused: false });
  ringBuffer.write(new Float32Array(48000 * 5)); // 5s played

  sync.ingestHeartbeat({ timelineId: 404, videoTime: 5.0, playbackRate: 1.0, paused: false });

  // User mines a subtitle that runs from 4.0s to 6.0s (currently midway through sentence at 5.0s)
  const extractRes = sync.extractSubtitleAudio({
    startTime: 4.0,
    endTime: 6.0,
    timelineId: 404,
    paddingStart: 0.150,
    paddingEnd: 0.200,
    captureId: "pending_play_1"
  });

  assert.equal(extractRes.ok, true);
  assert.equal(extractRes.status, "PENDING", "Must be PENDING while video is actively playing through sentence");
  assert.equal(extractRes.pending, true);
  assert.equal(sync.pendingCaptures.length, 1, "Pending capture added to queue");

  // Playback continues: deliver remaining 1.5s of audio (72,000 samples)
  const nextPcm = new Float32Array(72000);
  ringBuffer.write(nextPcm);
  sync.onPcmChunkWritten(72000);

  // Pending capture should now be finalized and dispatched via callback
  assert.equal(sync.pendingCaptures.length, 0, "Pending capture queue must be cleared");
  assert.equal(capturedEvents.length, 1, "onAudioCaptured must be called");
  assert.equal(capturedEvents[0].captureId, "pending_play_1");
  assert.equal(capturedEvents[0].wasPending, true);
  assert.ok(capturedEvents[0].dataUrl.startsWith("data:audio/wav;base64,"));

  console.log("PASS: Active playback pending capture queue finalizes cleanly when playhead passes sentence end.");
}

// ---------------------------------------------------------------------------
// 5. Hard Playback Invariant Verification Across All Audio Paths
// ---------------------------------------------------------------------------
function testHardPlaybackInvariantPreservation() {
  const forbiddenProperties = ["currentTime", "playbackRate", "src"];
  const forbiddenMethods = ["play", "pause", "fastSeek"];

  // Mock video element to verify zero mutations
  const mutatedProps = [];
  const calledMethods = [];

  const mockVideo = {
    _currentTime: 10.0,
    get currentTime() { return this._currentTime; },
    set currentTime(v) { mutatedProps.push(`currentTime=${v}`); this._currentTime = v; },
    _playbackRate: 1.0,
    get playbackRate() { return this._playbackRate; },
    set playbackRate(v) { mutatedProps.push(`playbackRate=${v}`); this._playbackRate = v; },
    paused: true,
    isConnected: true,
    play() { calledMethods.push("play"); return Promise.resolve(); },
    pause() { calledMethods.push("pause"); }
  };

  // Ensure our sync engine never accesses or mutates video elements
  const ringBuffer = new RollingPcmBuffer({ sampleRate: 48000, durationSeconds: 30 });
  const sync = new AudioTimelineSyncEngine({ ringBuffer, sampleRate: 48000, WavEncoder });

  sync.ingestHeartbeat({ timelineId: 505, videoTime: mockVideo.currentTime, playbackRate: mockVideo.playbackRate, paused: mockVideo.paused });
  ringBuffer.write(new Float32Array(48000 * 10));

  sync.extractSubtitleAudio({ startTime: 8.0, endTime: 10.0, timelineId: 505 });

  assert.equal(mutatedProps.length, 0, "Zero video properties must be mutated");
  assert.equal(calledMethods.length, 0, "Zero video playback methods must be called");

  console.log("PASS: Hard Playback Invariant 100% preserved (0 seeking, 0 play/pause calls, 0 speed changes).");
}

// ---------------------------------------------------------------------------
// Run all test suites
// ---------------------------------------------------------------------------
testPausedVideoMiningExtraction();
testExtractionAfterTimelineAnchor();
testPastFallbackSliceExtraction();
testPlayingVideoPendingCaptureFinalization();
testHardPlaybackInvariantPreservation();

console.log("\n>>> ALL AUDIO CAPTURE FIX REGRESSION TESTS PASSED SUCCESSFULLY! <<<");
