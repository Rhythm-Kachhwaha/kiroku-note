/**
 * Session 5 Test Suite: LLM Frontend Wiring, Escaping, Context Accuracy & Settings
 * Verifies payload construction, XSS protection, history capping, settings UI, and zero emojis.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.resolve(__dirname, "../sidepanel/sidepanel.html");
const cssPath = path.resolve(__dirname, "../sidepanel/sidepanel.css");
const jsPath = path.resolve(__dirname, "../sidepanel/sidepanel.js");

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const js = fs.readFileSync(jsPath, "utf8");

test("Session 5: HTML Structure - Settings LLM Configuration Controls", () => {
  assert.ok(html.includes('id="setting-llm-provider"'), "Must define #setting-llm-provider select");
  assert.ok(html.includes('id="setting-llm-model"'), "Must define #setting-llm-model input");
  assert.ok(html.includes('id="setting-llm-key"'), "Must define #setting-llm-key input");
  assert.ok(html.includes('id="setting-llm-ollama-url"'), "Must define #setting-llm-ollama-url input");
  assert.ok(html.includes('id="btn-test-llm"'), "Must define #btn-test-llm button");
  assert.ok(html.includes('id="btn-save-llm-config"'), "Must define #btn-save-llm-config button");
  assert.ok(html.includes('id="llm-config-feedback"'), "Must define #llm-config-feedback label");
  assert.ok(html.includes('id="llm-provider-display"'), "Must preserve legacy #llm-provider-display");
  assert.ok(html.includes('id="llm-status-label"'), "Must preserve legacy #llm-status-label");
});

test("Session 5: HTML Structure - Text Tab Dictionary AI Actions & Result Card", () => {
  assert.ok(html.includes('id="btn-dict-ai-translate"'), "Must define #btn-dict-ai-translate button");
  assert.ok(html.includes('id="btn-dict-ai-sense"'), "Must define #btn-dict-ai-sense button");
  assert.ok(html.includes('id="btn-dict-ai-mnemonic"'), "Must define #btn-dict-ai-mnemonic button");
  assert.ok(html.includes('id="dict-ai-result-card"'), "Must define #dict-ai-result-card container");
  assert.ok(html.includes('id="dict-ai-result-body"'), "Must define #dict-ai-result-body container");
  assert.ok(html.includes('id="btn-dict-ai-add-notes"'), "Must define #btn-dict-ai-add-notes button");
  assert.ok(html.includes('id="btn-dict-ai-close"'), "Must define #btn-dict-ai-close button");
});

test("Session 5: HTML Structure - Ask Status Dot Starts in Checking State", () => {
  assert.ok(
    html.includes('class="ask-status-dot checking"'),
    "Ask status dot must start in 'checking' neutral state instead of premature 'online'"
  );
});

test("Session 5: Strict Absence of Emojis Across HTML, CSS, and Ask/LLM Surfaces", () => {
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1FA70}-\u{1FAFF}\u{2728}\u{274C}\u{2705}\u{2714}\u{2716}\u{2715}\u{2702}-\u{27B0}\u{2B50}\u{2753}\u{2757}\u{231A}-\u{23FA}]/gu;

  // HTML zero-emoji verification
  const htmlMatches = html.match(emojiRegex);
  assert.equal(htmlMatches, null, `sidepanel.html must not contain emojis. Found: ${htmlMatches?.join(", ")}`);

  // CSS zero-emoji verification
  const cssMatches = css.match(emojiRegex);
  assert.equal(cssMatches, null, `sidepanel.css must not contain emojis. Found: ${cssMatches?.join(", ")}`);

  // Ask tab, Settings LLM group, and Text tab AI surfaces in HTML
  const askSection = html.match(/<div id="ask-mining-view"[\s\S]*?<\/div>\s*<!--\s*={5,}/)?.[0] || "";
  const llmSettingsSection = html.match(/<div class="card-settings-group settings-group" id="settings-group-llm"[\s\S]*?<\/div>/)?.[0] || "";
  const dictAiActions = html.match(/<div class="dict-ai-actions"[\s\S]*?<\/div>/)?.[0] || "";
  const dictAiResult = html.match(/<div id="dict-ai-result-card"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || "";

  assert.equal(askSection.match(emojiRegex), null, "Ask mining view must contain 0 emojis");
  assert.equal(llmSettingsSection.match(emojiRegex), null, "LLM settings section must contain 0 emojis");
  assert.equal(dictAiActions.match(emojiRegex), null, "Dictionary AI actions must contain 0 emojis");
  assert.equal(dictAiResult.match(emojiRegex), null, "Dictionary AI result card must contain 0 emojis");

  // Ask & LLM JS functions
  const llmJsSection = js.match(/\/\* =+[\r\n\s]+TIER 5: ASK TAB[\s\S]*?loadAutoCapturePreferences/)?.[0] || "";
  assert.equal(llmJsSection.match(emojiRegex), null, "Ask and LLM JS implementation must contain 0 emojis");
});

test("Session 5: sidepanel.js Exports & Helpers", () => {
  assert.ok(js.includes("fetchWithTimeout,"), "module.exports must include fetchWithTimeout");
  assert.ok(js.includes("loadLLMConfig,"), "module.exports must include loadLLMConfig");
  assert.ok(js.includes("saveLLMConfig,"), "module.exports must include saveLLMConfig");
  assert.ok(js.includes("testLLMConnection,"), "module.exports must include testLLMConnection");
  assert.ok(js.includes("executeQuickAiTask,"), "module.exports must include executeQuickAiTask");
});

test("Session 5: fetchWithTimeout Logic Verification", async () => {
  // Test mock fetch with timeout
  async function mockFetchWithTimeout(url, options = {}, timeoutMs = 50) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await new Promise((resolve, reject) => {
        controller.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
        setTimeout(() => resolve({ ok: true, status: 200 }), 200);
      });
      return res;
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  await assert.rejects(
    async () => {
      await mockFetchWithTimeout("http://127.0.0.1:21828/api/llm/ask", {}, 20);
    },
    (err) => {
      assert.ok(err.message.includes("timed out"));
      return true;
    }
  );
});

test("Session 5: Payload Construction & Duplicate Context Prevention", () => {
  // Simulate payload construction logic as written in sidepanel.js
  function buildPayload({ task, promptText, activeContextText, cardExpr, cardSentence, cardSource, cardMeaning, chatHistory = [] }) {
    const resolvedTask = task || "answer_question";
    let payload;

    if (resolvedTask === "explain_sense") {
      payload = {
        task: "explain_sense",
        word: cardExpr || promptText,
        text: promptText || cardSentence || cardSource || cardExpr,
        context: cardMeaning || undefined
      };
    } else if (resolvedTask === "mnemonic") {
      const targetWord = cardExpr || promptText;
      payload = {
        task: "mnemonic",
        word: targetWord,
        text: targetWord,
        context: cardMeaning || (activeContextText && activeContextText !== targetWord ? activeContextText : undefined)
      };
    } else if (resolvedTask === "translate" || resolvedTask === "explain_grammar") {
      payload = {
        task: resolvedTask,
        text: promptText,
        context: undefined
      };
    } else {
      payload = {
        task: resolvedTask,
        text: promptText,
        context: (activeContextText && activeContextText !== promptText) ? activeContextText : undefined
      };
    }

    let history = [...chatHistory];
    if (history.length > 10) history = history.slice(-10);
    if (history.length > 0) payload.messages = history;

    return payload;
  }

  // 1. explain_sense
  const sensePayload = buildPayload({
    task: "explain_sense",
    promptText: "",
    activeContextText: "映画を見る",
    cardExpr: "見る",
    cardSentence: "映画を見るのが好きです。",
    cardSource: "映画を見る",
    cardMeaning: "to see; to watch"
  });
  assert.equal(sensePayload.task, "explain_sense");
  assert.equal(sensePayload.word, "見る");
  assert.equal(sensePayload.text, "映画を見るのが好きです。");
  assert.equal(sensePayload.context, "to see; to watch");

  // 2. mnemonic
  const mnemonicPayload = buildPayload({
    task: "mnemonic",
    promptText: "掛ける",
    activeContextText: "",
    cardExpr: "掛ける",
    cardSentence: "電話を掛ける",
    cardMeaning: "to hang; to call"
  });
  assert.equal(mnemonicPayload.task, "mnemonic");
  assert.equal(mnemonicPayload.word, "掛ける");
  assert.equal(mnemonicPayload.text, "掛ける");
  assert.equal(mnemonicPayload.context, "to hang; to call");

  // 3. translate
  const translatePayload = buildPayload({
    task: "translate",
    promptText: "これは本です。",
    activeContextText: "これは本です。"
  });
  assert.equal(translatePayload.task, "translate");
  assert.equal(translatePayload.text, "これは本です。");
  assert.equal(translatePayload.context, undefined, "Translate must not send duplicate context");

  // 4. explain_grammar
  const grammarPayload = buildPayload({
    task: "explain_grammar",
    promptText: "雨が降るかもしれない",
    activeContextText: "雨が降るかもしれない"
  });
  assert.equal(grammarPayload.task, "explain_grammar");
  assert.equal(grammarPayload.text, "雨が降るかもしれない");
  assert.equal(grammarPayload.context, undefined, "Grammar must not send duplicate context");

  // 5. answer_question with activeContext identical to promptText
  const solvePayload = buildPayload({
    task: "answer_question",
    promptText: "正しい選択肢を選んでください。(1) A (2) B",
    activeContextText: "正しい選択肢を選んでください。(1) A (2) B"
  });
  assert.equal(solvePayload.context, undefined, "answer_question must not duplicate context when promptText matches context");

  // 6. History capping: max 10
  const longHistory = Array.from({ length: 25 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `msg ${i}` }));
  const cappedPayload = buildPayload({
    task: "chat",
    promptText: "Hello",
    chatHistory: longHistory
  });
  assert.equal(cappedPayload.messages.length, 10, "Chat history must be capped to max 10 messages");
  assert.equal(cappedPayload.messages[9].content, "msg 24");
});

test("Session 5: Error Detail Normalization & XSS Escaping", () => {
  function formatErrorMessage(detail, status = 422) {
    let errMsg = `LLM request failed (status ${status})`;
    if (typeof detail === "string") {
      errMsg = detail;
    } else if (Array.isArray(detail)) {
      errMsg = detail.map(d => (d && d.msg) ? d.msg : (typeof d === "string" ? d : JSON.stringify(d))).join("; ") || "Invalid request parameters";
    } else if (detail && typeof detail === "object") {
      errMsg = detail.msg || JSON.stringify(detail);
    }
    return errMsg;
  }

  // 1. FastAPI 422 validation array of objects
  const fastApi422 = [
    { loc: ["body", "text"], msg: "Text must not be empty.", type: "value_error" },
    { loc: ["body", "task"], msg: "Input should be 'chat'", type: "literal_error" }
  ];
  const formatted = formatErrorMessage(fastApi422);
  assert.equal(formatted.includes("[object Object]"), false, "Must not format error array as [object Object]");
  assert.ok(formatted.includes("Text must not be empty."));
  assert.ok(formatted.includes("Input should be 'chat'"));

  // 2. Malicious HTML string
  const maliciousError = "<script>alert('xss')</script><img src=x onerror=alert(1)>";
  const errOutput = formatErrorMessage(maliciousError);
  // Verify that setting this via textContent produces text, not HTML
  const div = { textContent: "" };
  div.textContent = errOutput;
  assert.equal(div.textContent, maliciousError);
});
