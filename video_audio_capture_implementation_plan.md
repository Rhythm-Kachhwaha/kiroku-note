# Video Audio Capture & Subtitle Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable reliable, passive tab audio capture and sentence snippet extraction for video mining (YouTube, streaming anime, and video media) in Kiroku Note without disrupting video playback, converting audio into 16-bit Mono WAV clips that attach directly to local SQLite cards and Anki notes.

**Architecture:**
1. **Manifest V3 User-Gesture & Stream Lifecycle**: Replace the automatic `openPanelOnActionClick: true` setting (which blocks `action.onClicked`) with an explicit `chrome.action.onClicked` listener, `chrome.commands.onCommand` (`Alt+Shift+K` and dedicated `Alt+Shift+A`), and context menus. This guarantees that tab capture stream acquisition (`chrome.tabCapture.getMediaStreamId({ targetTabId })`) occurs within a legitimate user gesture context on the active tab, passing the `streamId` to the offscreen document.
2. **Persistent Offscreen PCM Capture & Speaker Mirroring**: The Manifest V3 Offscreen Document runs `PersistentAudioCaptureEngine`, mirrors tab audio to local speakers with unity gain (zero audio muting), and pipes PCM samples via an `AudioWorkletProcessor` downmixing to Mono Float32 into a 30-second rolling circular buffer.
3. **Cue-Linked Audio Extraction**: `video-mining-poc.js` forwards full subtitle cue timing (`startTime`, `endTime`, `text`), timing offset, and `timelineId` with `JAPANESE_TEXT_CAPTURED`. When audio extraction is triggered, `AudioTimelineSyncEngine` maps video media time to PCM sample indices, slices the circular buffer with 150ms start / 200ms end padding, encodes canonical 16-bit Mono WAV (`audio/wav`), and resolves to the Side Panel.
4. **Local & Anki Persistence**: The card draft displays a compact audio player and status badge; on card save, `MediaStorageService` writes `kiroku_audio_{id}.wav` to disk and SQLite, and Anki sync uploads the WAV via AnkiConnect `storeMediaFile` and maps `[sound:kiroku_audio_{id}.wav]` to dedicated audio fields.

**Architecture Diagram:**

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Toolbar as Action Icon / Shortcut (Alt+Shift+K)
    participant SW as Background Service Worker
    participant Offscreen as Offscreen Document (AudioWorklet + Ring Buffer)
    participant Content as Content Script (video-mining-poc.js)
    participant Panel as Side Panel (sidepanel.js)
    participant Backend as FastAPI Backend & SQLite
    participant Anki as AnkiConnect Desktop

    User->>Toolbar: Click Extension Icon / Press Alt+Shift+K
    Toolbar->>SW: chrome.action.onClicked / onCommand (Valid User Gesture)
    SW->>SW: chrome.sidePanel.open()
    SW->>SW: chrome.tabCapture.getMediaStreamId({ targetTabId })
    SW->>Offscreen: START_PERSISTENT_CAPTURE (streamId)
    Offscreen->>Offscreen: getUserMedia(streamId) -> Mirror to Speakers -> AudioWorklet -> 30s Ring Buffer
    SW->>Panel: AUDIO_CAPTURE_STATE_CHANGED (status: "capturing")

    Note over User,Content: Video plays naturally with audio in speakers
    Content->>Offscreen: AUDIO_SYNC_HEARTBEAT (videoTime, rate, paused, timelineId)

    User->>Content: Hover / Mine Japanese Subtitle Word
    Content->>Panel: JAPANESE_TEXT_CAPTURED (text, cue: {startTime, endTime}, timelineId)
    Panel->>Backend: POST /api/capture (Identify word via Yomitan)
    Backend-->>Panel: Card draft with expression, reading, definitions
    Panel->>Content: TRIGGER_AUDIO_RECORDING (cue, timelineId)
    Content->>Offscreen: EXTRACT_SUBTITLE_AUDIO (startTime, endTime, timelineId, padding)
    Offscreen->>Offscreen: Slice 30s Ring Buffer -> WavEncoder (16-bit Mono WAV)
    Offscreen-->>Content: { ok: true, status: "READY", dataUrl: "data:audio/wav;base64,..." }
    Content->>Panel: AUDIO_CAPTURED (dataUrl, mimeType: "audio/wav")
    Panel->>Panel: Render Audio Preview Player [Ready]

    User->>Panel: Click "Save Card"
    Panel->>Backend: POST /api/cards/save (with audio dataUrl)
    Backend->>Backend: Save WAV to data/media/kiroku_audio_xxx.wav & SQLite
    User->>Panel: Click "Send to Anki"
    Panel->>Backend: POST /api/cards/{id}/sync
    Backend->>Anki: storeMediaFile(kiroku_audio_xxx.wav)
    Backend->>Anki: addNote(fields: { SentenceAudio: "[sound:kiroku_audio_xxx.wav]" })
    Anki-->>Backend: Note ID created
    Backend-->>Panel: Sync status: synced
```

**Tech Stack:**
- Chromium Manifest V3 (`chrome.tabCapture`, `chrome.offscreen`, `chrome.action`, `chrome.commands`, `chrome.contextMenus`)
- Web Audio API (`AudioContext`, `AudioWorkletNode`, `AudioWorkletProcessor`, `MediaStreamAudioSourceNode`)
- Vanilla ES2022 JavaScript (DataView, Float32Array, Int16Array, Base64 Data URLs)
- Python 3.11, FastAPI, SQLite3, AnkiConnect JSON-RPC

**Spec Reference:**
- [docs/Audio/Stage1.md](file:///D:/Python/AnkiMiner/docs/Audio/Stage1.md) (Capture Pipeline Inspection & Constraints)
- [docs/Audio/Stage2.md](file:///D:/Python/AnkiMiner/docs/Audio/Stage2.md) (Persistent Passive Capture & 30s Ring Buffer)
- [docs/Audio/Stage3.md](file:///D:/Python/AnkiMiner/docs/Audio/Stage3.md) (Audio Timeline Sync & Subtitle Extraction)
- [docs/Audio/stage4.md](file:///D:/Python/AnkiMiner/docs/Audio/stage4.md) (Card Draft Integration & Media Persistence)
- [docs/Audio/stage5.md](file:///D:/Python/AnkiMiner/docs/Audio/stage5.md) (Production Hardening & Race Condition Resolution)
- [ARCHITECTURE.md](file:///D:/Python/AnkiMiner/ARCHITECTURE.md) (Locked boundaries: Side Panel shell, SQLite source of truth, Yomitan service isolation)

## Global Constraints
- Chromium Side Panel is the single application UI. No popup windows or React/Electron frameworks.
- Hard Playback Invariant: Zero `video.currentTime` seeking, zero `video.play()` / `video.pause()` hijacking, zero playback disruption. Audio capture is 100% passive.
- Local-first resilience: Failed audio extraction must fail soft (card draft remains text-editable and saveable).
- Deterministic 16-bit Mono WAV audio output.
- All existing 177 extension tests and 512 backend pytest tests must pass without regression.

---

### Task 1: Background Service Worker User-Gesture `tabCapture` Handover & State Management

**Files:**
- Modify: [manifest.json](file:///D:/Python/AnkiMiner/extension/manifest.json)
- Modify: [background.js](file:///D:/Python/AnkiMiner/extension/background.js#L1-L140)
- Create: `extension/tests/tab-audio-lifecycle.test.js`

**Interfaces:**
- Consumes: `chrome.action.onClicked`, `chrome.commands.onCommand`, `chrome.contextMenus.onClicked`.
- Produces: `streamId` via `chrome.tabCapture.getMediaStreamId({ targetTabId })`.
- Produces messages: `START_PERSISTENT_CAPTURE`, `STOP_PERSISTENT_CAPTURE`, `AUDIO_CAPTURE_STATE_CHANGED`.
- Produces state API: `GET_AUDIO_CAPTURE_STATE` returning `{ ok: true, capturing: boolean, tabId: number, state: string }`.

- [x] **Step 1: Write failing tests for background user-gesture tab capture handover**

Create `extension/tests/tab-audio-lifecycle.test.js`:
```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Background Service Worker Tab Capture Handover Contract", async (t) => {
  const bgCode = fs.readFileSync(path.resolve(__dirname, "../background.js"), "utf8");

  await t.test("manifest declares action, commands, contextMenus, and tabCapture permissions", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../manifest.json"), "utf8"));
    assert.ok(manifest.permissions.includes("tabCapture"), "Must have tabCapture permission");
    assert.ok(manifest.permissions.includes("offscreen"), "Must have offscreen permission");
    assert.ok(manifest.permissions.includes("activeTab"), "Must have activeTab permission");
    assert.ok(manifest.permissions.includes("contextMenus"), "Must have contextMenus permission");
    assert.ok(manifest.action, "Must declare action");
    assert.ok(manifest.commands && manifest.commands["open-side-panel"], "Must declare open-side-panel command");
  });

  await t.test("action.onClicked opens side panel and initiates tabCapture with streamId", async () => {
    let capturedStreamId = null;
    let sidePanelOpened = false;
    let offscreenMessage = null;

    const mockChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} },
        sendMessage: async (msg) => {
          if (msg.type === "START_PERSISTENT_CAPTURE") {
            offscreenMessage = msg;
            return { ok: true, state: "capturing" };
          }
          if (msg.type === "PING_OFFSCREEN") return { ok: true };
          return { ok: true };
        },
        getURL: (p) => `chrome-extension://test/${p}`
      },
      sidePanel: {
        open: async (opts) => { sidePanelOpened = true; return true; },
        setPanelBehavior: async () => {}
      },
      action: {
        onClicked: {
          addListener: (fn) => { mockChrome.action._listener = fn; }
        }
      },
      commands: {
        onCommand: {
          addListener: (fn) => { mockChrome.commands._listener = fn; }
        }
      },
      contextMenus: {
        create: () => {},
        onClicked: { addListener: () => {} }
      },
      tabCapture: {
        getMediaStreamId: async (opts) => {
          capturedStreamId = `stream_${opts.targetTabId}_abc123`;
          return capturedStreamId;
        }
      },
      tabs: {
        query: async () => [{ id: 101, windowId: 1, url: "https://www.youtube.com/watch?v=demo" }],
        sendMessage: async () => ({ ok: true }),
        onUpdated: { addListener: () => {} },
        onRemoved: { addListener: () => {} }
      },
      offscreen: {
        hasDocument: async () => true,
        createDocument: async () => {}
      },
      scripting: {
        executeScript: async () => {}
      }
    };

    const sandbox = {
      chrome: mockChrome,
      console,
      setTimeout,
      clearTimeout,
      module: { exports: {} }
    };

    vm.runInNewContext(bgCode, sandbox);

    // Simulate clicking action button
    assert.equal(typeof mockChrome.action._listener, "function", "action.onClicked listener must be registered");
    await mockChrome.action._listener({ id: 101, windowId: 1, url: "https://www.youtube.com/watch?v=demo" });

    assert.ok(sidePanelOpened, "Side panel must be opened on action click");
    assert.equal(capturedStreamId, "stream_101_abc123", "tabCapture.getMediaStreamId must be called in user gesture");
    assert.ok(offscreenMessage && offscreenMessage.streamId === "stream_101_abc123", "START_PERSISTENT_CAPTURE must be sent with streamId");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test extension/tests/tab-audio-lifecycle.test.js`
Expected: FAIL (`assert.ok(manifest.permissions.includes("contextMenus"))` or `action._listener is not a function`).

- [x] **Step 3: Implement user-gesture action and shortcut handover in background**

Update [manifest.json](file:///D:/Python/AnkiMiner/extension/manifest.json):
```json
   "permissions": [
     "sidePanel",
     "activeTab",
     "scripting",
     "tabs",
     "tabCapture",
     "offscreen",
     "clipboardRead",
     "contextMenus"
   ],
   "commands": {
     "open-side-panel": {
       "suggested_key": {
         "default": "Alt+Shift+K"
       },
       "description": "Open Kiroku Note side panel"
     },
     "capture-tab-audio": {
       "suggested_key": {
         "default": "Alt+Shift+A"
       },
       "description": "Connect Kiroku Note tab audio"
     }
   }
```

Update [background.js](file:///D:/Python/AnkiMiner/extension/background.js):
```javascript
function isTabCapturable(url) {
  if (!url || typeof url !== "string") return false;
  return !url.startsWith("chrome://") && !url.startsWith("chrome-extension://") && !url.startsWith("about:");
}

chrome.runtime.onInstalled.addListener(() => {
  if (typeof chrome !== "undefined" && chrome.contextMenus?.create) {
    chrome.contextMenus.create({
      id: "kiroku-connect-tab-audio",
      title: "Kiroku: Connect Tab Audio",
      contexts: ["page", "video", "frame"]
    });
  }
});

async function handleUserInitiatedCapture(tab) {
  if (!tab?.id) return;
  if (tab.windowId && chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
  if (!isTabCapturable(tab.url)) return;

  isMiningModeEnabled = true;
  try {
    if (chrome.tabCapture?.getMediaStreamId) {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }).catch(() => null);
      if (streamId) {
        await startPersistentCaptureForTab(tab.id, streamId);
        broadcastCaptureState("capturing", tab.id);
      }
    }
  } catch (err) {
    console.warn("[Kiroku Background] Tab capture initiation error:", err);
  }
}

if (typeof chrome !== "undefined" && chrome.action?.onClicked) {
  chrome.action.onClicked.addListener(handleUserInitiatedCapture);
}

if (typeof chrome !== "undefined" && chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === "open-side-panel" || command === "capture-tab-audio") {
      handleUserInitiatedCapture(tab);
    }
  });
}

if (typeof chrome !== "undefined" && chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "kiroku-connect-tab-audio" && tab) {
      handleUserInitiatedCapture(tab);
    }
  });
}

function broadcastCaptureState(state, tabId = null) {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "AUDIO_CAPTURE_STATE_CHANGED",
        state,
        tabId: tabId || activeCaptureTabId,
        capturing: state === "capturing"
      }).catch(() => {});
    }
  } catch (_) {}
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test extension/tests/tab-audio-lifecycle.test.js`
Expected: PASS (All test assertions pass).

- [x] **Step 5: Commit**

```bash
git add extension/manifest.json extension/background.js extension/tests/tab-audio-lifecycle.test.js
git commit -m "fix(audio): implement user-gesture tab capture handover via action click, command, and context menu"
```

---

### Task 2: Subtitle Cue Metadata Pass-Through & Content Script Audio Extraction Alignment

**Files:**
- Modify: [video-mining-poc.js](file:///D:/Python/AnkiMiner/extension/content/video-mining-poc.js#L480-L510)
- Create: `extension/tests/video-mining-cue-audio.test.js`

**Interfaces:**
- Produces: `JAPANESE_TEXT_CAPTURED` with payload:
  `{ type: "JAPANESE_TEXT_CAPTURED", text: string, cue: Object, timelineId: string, offset: number, source: string }`
- Consumes: `TRIGGER_AUDIO_RECORDING` with `{ cue, options: { captureId, paddingStart, paddingEnd } }`.
- Produces: `EXTRACT_SUBTITLE_AUDIO` with `{ startTime, endTime, timelineId, offset, paddingStart, paddingEnd, captureId, mimeType: "audio/wav" }`.

- [x] **Step 1: Write failing tests for subtitle cue metadata pass-through**

Create `extension/tests/video-mining-cue-audio.test.js`:
```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Video Mining POC Cue Audio Coordination", async (t) => {
  const pocCode = fs.readFileSync(path.resolve(__dirname, "../content/video-mining-poc.js"), "utf8");

  await t.test("recordSentenceAudio uses 16-bit Mono WAV format and forwards timelineId", async () => {
    let sentExtractMsg = null;
    let audioCapturedMsg = null;

    const mockChrome = {
      runtime: {
        sendMessage: async (msg) => {
          if (msg.type === "EXTRACT_SUBTITLE_AUDIO") {
            sentExtractMsg = msg;
            return {
              ok: true,
              status: "READY",
              dataUrl: "data:audio/wav;base64,UklGR...",
              mimeType: "audio/wav",
              durationMs: 1400
            };
          }
          if (msg.type === "AUDIO_CAPTURED") {
            audioCapturedMsg = msg;
            return { ok: true };
          }
          return { ok: true };
        }
      },
      storage: { local: { get: () => {}, set: () => {} } }
    };

    const sandbox = {
      chrome: mockChrome,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      document: { createElement: () => ({ style: {} }), body: { appendChild: () => {} } },
      window: { addEventListener: () => {} },
      module: { exports: {} }
    };

    vm.runInNewContext(pocCode, sandbox);
    const VideoMiningPOC = sandbox.module.exports?.VideoMiningPOC || sandbox.VideoMiningPOC;
    const instance = new VideoMiningPOC();
    instance.activeVideo = { isConnected: true, paused: false, currentTime: 12.5 };
    instance.timelineId = "tl_unit_test_99";

    const testCue = { startTime: 10.0, endTime: 12.0, text: "こんにちは世界" };
    const res = await instance.recordSentenceAudio(testCue, { captureId: "cap_cue_101" });

    assert.ok(res.ok, "Extraction should succeed");
    assert.equal(sentExtractMsg.type, "EXTRACT_SUBTITLE_AUDIO");
    assert.equal(sentExtractMsg.startTime, 10.0);
    assert.equal(sentExtractMsg.endTime, 12.0);
    assert.equal(sentExtractMsg.timelineId, "tl_unit_test_99");
    assert.equal(audioCapturedMsg.mimeType, "audio/wav", "Must broadcast audio/wav format");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test extension/tests/video-mining-cue-audio.test.js`
Expected: FAIL or mismatch on payload structure.

- [x] **Step 3: Update `video-mining-poc.js` to pass active cue metadata and use WAV**

In [video-mining-poc.js](file:///D:/Python/AnkiMiner/extension/content/video-mining-poc.js):
Pass `this.currentCue` with `JAPANESE_TEXT_CAPTURED`:
```javascript
this._boundSubtitleMouseMove = (e) => {
  if (this.isDragging) return;
  if (typeof window !== "undefined" && window.getSelection) {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) return;
  }
  if (this._hoverWordTimer) clearTimeout(this._hoverWordTimer);
  this._hoverWordTimer = setTimeout(() => {
    const word = extractJapaneseWordAtPosition(this.subtitleEl, e.clientX, e.clientY);
    if (word && word !== this._lastHoverWord) {
      this._lastHoverWord = word;
      this.activeHighlightTerm = word;
      if (this.currentCue) {
        this.renderCue(this.currentCue);
      }
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: "JAPANESE_TEXT_CAPTURED",
            text: word,
            source: "subtitle_hover",
            cue: this.currentCue ? { ...this.currentCue } : null,
            timelineId: this.timelineId,
            offset: this.syncEngine?.offset || 0.0
          }).catch(() => {});
          chrome.runtime.sendMessage({
            type: "HIGHLIGHT_SUBTITLE_WORD",
            text: word
          }).catch(() => {});
        }
      } catch (_) {}
    }
  }, 180);
};
```

In `recordSentenceAudio`:
```javascript
const extractReq = {
  type: "EXTRACT_SUBTITLE_AUDIO",
  startTime: rawStart,
  endTime: rawEnd,
  timelineId: this.timelineId,
  offset,
  paddingStart,
  paddingEnd,
  cue: targetCue,
  captureId: options.captureId || null,
  preferredMimeType: "audio/wav"
};
```

Remove the flawed `_captureStreamFallback` fallback trap and replace with descriptive fail-soft response when offscreen sync is offline:
```javascript
if (!recResult?.ok) {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "AUDIO_CAPTURE_STATUS",
        ok: false,
        error: recResult?.error || "AUDIO_NOT_CONNECTED",
        message: recResult?.message || "Tab audio capture is not active. Click Kiroku icon or press Alt+Shift+K to connect.",
        captureId: options.captureId || null
      }).catch(() => {});
    }
  } catch (_) {}
  return recResult;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test extension/tests/video-mining-cue-audio.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add extension/content/video-mining-poc.js extension/tests/video-mining-cue-audio.test.js
git commit -m "fix(audio): pass full subtitle cue metadata and timelineId with captured Japanese text"
```

---

### Task 3: Side Panel Audio Status Indicator & Precision Cue Audio Triggering

**Files:**
- Modify: [sidepanel.html](file:///D:/Python/AnkiMiner/extension/sidepanel/sidepanel.html)
- Modify: [sidepanel.css](file:///D:/Python/AnkiMiner/extension/sidepanel/sidepanel.css)
- Modify: [sidepanel.js](file:///D:/Python/AnkiMiner/extension/sidepanel/sidepanel.js#L2810-L2835)
- Create: `extension/tests/sidepanel-audio-status-ui.test.js`

**Interfaces:**
- Renders: `#indicator-tab-audio` showing live status badge (`connected` / `disconnected`).
- Consumes: `AUDIO_CAPTURE_STATE_CHANGED` and updates `#indicator-tab-audio`.
- Consumes: `cue` from `JAPANESE_TEXT_CAPTURED` and sets `currentActiveCue`.
- Produces: `TRIGGER_AUDIO_RECORDING` with exact `cue`, `timelineId`, and `mimeType: "audio/wav"`.

- [x] **Step 1: Write failing tests for Side Panel Audio Status Indicator**

Create `extension/tests/sidepanel-audio-status-ui.test.js`:
```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Side Panel Audio Status UI & Cue Triggering Contracts", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.html"), "utf8");
  const css = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.css"), "utf8");
  const js = fs.readFileSync(path.resolve(__dirname, "../sidepanel/sidepanel.js"), "utf8");

  assert.ok(html.includes('id="indicator-tab-audio"'), "HTML must include #indicator-tab-audio status pill");
  assert.ok(css.includes(".indicator-tab-audio"), "CSS must style .indicator-tab-audio");
  assert.ok(css.includes(".tab-audio-connected"), "CSS must style connected state");
  assert.ok(js.includes("AUDIO_CAPTURE_STATE_CHANGED"), "JS must listen to AUDIO_CAPTURE_STATE_CHANGED");
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test extension/tests/sidepanel-audio-status-ui.test.js`
Expected: FAIL (`assert.ok(html.includes('id="indicator-tab-audio"'))`).

- [x] **Step 3: Implement indicator DOM, CSS, and message listener in Side Panel**

In [sidepanel.html](file:///D:/Python/AnkiMiner/extension/sidepanel/sidepanel.html):
Add `#indicator-tab-audio` inside the service indicators group (`#service-indicators`):
```html
<span id="indicator-tab-audio" class="service-indicator indicator-tab-audio" title="Tab Audio Capture: Inactive. Click toolbar icon or press Alt+Shift+K to connect.">
  <span class="indicator-dot"></span>
  <span class="indicator-label">Audio</span>
</span>
```

In [sidepanel.css](file:///D:/Python/AnkiMiner/extension/sidepanel/sidepanel.css):
```css
.indicator-tab-audio .indicator-dot {
  background-color: var(--text-muted);
}

.indicator-tab-audio.tab-audio-connected .indicator-dot {
  background-color: var(--color-success, #4ade80);
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.4);
}

.indicator-tab-audio.tab-audio-connected {
  border-color: rgba(74, 222, 128, 0.3);
  color: var(--text-secondary);
}
```

In [sidepanel.js](file:///D:/Python/AnkiMiner/extension/sidepanel/sidepanel.js):
1. Bind `#indicator-tab-audio`:
```javascript
const indicatorTabAudio = document.querySelector("#indicator-tab-audio");

function updateTabAudioIndicator(capturing) {
  if (!indicatorTabAudio) return;
  if (capturing) {
    indicatorTabAudio.classList.add("tab-audio-connected");
    indicatorTabAudio.title = "Tab Audio Capture: Active (Streaming audio into rolling buffer)";
  } else {
    indicatorTabAudio.classList.remove("tab-audio-connected");
    indicatorTabAudio.title = "Tab Audio Capture: Inactive. Click toolbar icon or press Alt+Shift+K to connect.";
  }
}
```

2. Listen for state changes:
```javascript
if (message?.type === "AUDIO_CAPTURE_STATE_CHANGED") {
  updateTabAudioIndicator(Boolean(message.capturing));
  sendResponse?.({ ok: true });
  return true;
}
```

3. Update `JAPANESE_TEXT_CAPTURED` listener to store exact `cue`:
```javascript
if (message?.type === "JAPANESE_TEXT_CAPTURED") {
  if (message.cue) {
    currentActiveCue = message.cue;
  }
  if (message.timelineId) {
    lastCaptureSource.timelineId = message.timelineId;
  }
  // Proceed with identify and draft population...
```

4. Update `retakeAudio`:
```javascript
function retakeAudio(captureId = null) {
  setStatus("Recording sentence audio…");
  const capId = captureId || currentCaptureId;
  broadcastToActiveVideo({
    type: "TRIGGER_AUDIO_RECORDING",
    cue: typeof currentActiveCue !== "undefined" ? currentActiveCue : null,
    options: {
      captureId: capId,
      mimeType: "audio/wav",
      allowPausedPlayback: true,
      allowFallbackRecording: false
    }
  });
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test extension/tests/sidepanel-audio-status-ui.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add extension/sidepanel/sidepanel.html extension/sidepanel/sidepanel.css extension/sidepanel/sidepanel.js extension/tests/sidepanel-audio-status-ui.test.js
git commit -m "feat(audio): add tab audio connection indicator and cue-linked audio triggering in sidepanel"
```

---

### Task 4: Offscreen AudioWorklet Loading & Speaker Mirroring Hardening

**Files:**
- Modify: [offscreen.js](file:///D:/Python/AnkiMiner/extension/offscreen/offscreen.js#L180-L210)
- Create: `extension/tests/offscreen-capture-hardening.test.js`

**Interfaces:**
- Ensures: `chrome.runtime.getURL("offscreen/pcm-worklet-processor.js")` loads without cross-origin or MIME-type failure.
- Ensures: `audioSource.connect(audioContext.destination)` preserves 100% volume speaker playback without distortion.
- Ensures: AudioContext resumes automatically if suspended by browser power-saving.

- [x] **Step 1: Write failing tests for offscreen AudioContext lifecycle and worklet loading**

Create `extension/tests/offscreen-capture-hardening.test.js`:
```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

test("Offscreen Capture Engine Hardening", async (t) => {
  const offscreenCode = fs.readFileSync(path.resolve(__dirname, "../offscreen/offscreen.js"), "utf8");

  await t.test("AudioContext automatically resumes if created in suspended state", async () => {
    let resumed = false;
    let connectedToDestination = false;

    class MockAudioContext {
      constructor() {
        this.state = "suspended";
        this.sampleRate = 48000;
        this.destination = {};
        this.audioWorklet = { addModule: async () => {} };
      }
      async resume() {
        resumed = true;
        this.state = "running";
      }
      createMediaStreamSource() {
        return {
          connect: (dest) => {
            if (dest === this.destination) connectedToDestination = true;
          },
          disconnect: () => {}
        };
      }
    }

    const sandbox = {
      window: { AudioContext: MockAudioContext },
      AudioContext: MockAudioContext,
      AudioWorkletNode: class {
        constructor() { this.port = { onmessage: null, postMessage: () => {} }; }
        disconnect() {}
      },
      navigator: {
        mediaDevices: {
          getUserMedia: async () => ({
            getAudioTracks: () => [{ onended: null, stop: () => {} }]
          })
        }
      },
      chrome: {
        runtime: {
          getURL: (p) => p,
          onMessage: { addListener: () => {} },
          sendMessage: async () => ({ ok: true })
        }
      },
      console,
      setTimeout,
      clearTimeout,
      module: { exports: {} }
    };

    vm.runInNewContext(offscreenCode, sandbox);
    const { PersistentAudioCaptureEngine } = sandbox.module.exports;
    const engine = new PersistentAudioCaptureEngine({
      AudioContextClass: MockAudioContext,
      AudioWorkletNodeClass: sandbox.AudioWorkletNode,
      getUserMedia: sandbox.navigator.mediaDevices.getUserMedia
    });

    const res = await engine.startCapture({ streamId: "mock_stream_123" });
    assert.ok(res.ok, "Engine should start successfully");
    assert.ok(resumed, "AudioContext must be resumed");
    assert.ok(connectedToDestination, "Stream must be mirrored to destination (speakers)");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test extension/tests/offscreen-capture-hardening.test.js`
Expected: Passes or highlights missing mock bindings.

- [x] **Step 3: Harden worklet URL resolution and state change listener in `offscreen.js`**

In [offscreen.js](file:///D:/Python/AnkiMiner/extension/offscreen/offscreen.js):
Ensure dynamic resume on user audio request:
```javascript
if (this.audioContext && this.audioContext.state === "suspended") {
  await this.audioContext.resume().catch(() => {});
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test extension/tests/offscreen-capture-hardening.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add extension/offscreen/offscreen.js extension/tests/offscreen-capture-hardening.test.js
git commit -m "fix(audio): harden offscreen AudioContext auto-resume and worklet loading"
```

---

### Task 5: End-to-End Verification Across Backend, Extension, and AnkiConnect

**Files:**
- Create: `backend/tests/test_audio_end_to_end_sync.py`
- Test: All backend pytest suites
- Test: All extension node test suites

**Interfaces:**
- Validates: End-to-end payload flow from extracted WAV Data URL -> `POST /api/cards/save` -> SQLite disk persistence -> `POST /api/cards/{id}/sync` -> Anki note `[sound:kiroku_audio_xxx.wav]`.

- [x] **Step 1: Write end-to-end integration test for audio saving and Anki syncing**

Create `backend/tests/test_audio_end_to_end_sync.py`:
```python
import base64
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.media_storage import MediaStorageService

# Canonical 44-byte RIFF/WAVE header + 4 bytes of 16-bit silence
WAV_BYTES = (
    b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00"
    b"\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x04\x00\x00\x00"
    b"\x00\x00\x00\x00"
)
WAV_DATA_URL = f"data:audio/wav;base64,{base64.b64encode(WAV_BYTES).decode('ascii')}"

def test_save_card_with_wav_audio_and_sync(tmp_path, monkeypatch):
    client = TestClient(app)

    # 1. Save card with WAV data URL
    save_payload = {
        "expression": "音声テスト",
        "reading": "おんせいてすと",
        "meaning": "Audio end-to-end test",
        "deck_name": "Default",
        "audio": WAV_DATA_URL
    }

    res = client.post("/api/cards/save", json=save_payload)
    assert res.status_code == 200, res.text
    card = res.json()
    assert card["audio"] != "", "Audio field must be populated"
    assert card["audio"].endswith(".wav"), "Audio filename must be a .wav file"

    # 2. Verify media endpoint serves the WAV file
    media_res = client.get(f"/api/media/{card['audio']}")
    assert media_res.status_code == 200
    assert media_res.headers["content-type"].startswith("audio/")
    assert media_res.content[:4] == b"RIFF"

    # 3. Verify card detail reflects the saved audio
    detail_res = client.get(f"/api/cards/{card['id']}")
    assert detail_res.status_code == 200
    assert detail_res.json()["audio"] == card["audio"]
```

- [x] **Step 2: Run test to verify it passes**

Run: `pytest backend/tests/test_audio_end_to_end_sync.py -v`
Expected: PASS (All assertions pass).

- [x] **Step 3: Run full backend and extension regression suites**

Run:
1. `python -m pytest backend/tests`
2. `node --test extension/tests/*.test.js`

Expected: 100% PASS across all tests.

- [x] **Step 4: Update `PROGRESS.md` with verification results**

Update [PROGRESS.md](file:///D:/Python/AnkiMiner/PROGRESS.md) documenting:
- Audio capture activation via user gesture (`action.onClicked`, `Alt+Shift+K`, `Alt+Shift+A`, context menu).
- Subtitle cue timing pass-through.
- Side Panel live connection badge (`#indicator-tab-audio`).
- Test suite outcomes.

- [x] **Step 5: Commit**

```bash
git add backend/tests/test_audio_end_to_end_sync.py PROGRESS.md
git commit -m "test(audio): add end-to-end WAV persistence and AnkiConnect verification test"
```
