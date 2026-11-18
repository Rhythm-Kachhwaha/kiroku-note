/**
 * Targeted tests for Desktop Shell Offline Sudachi WASM Tokenizer
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");

describe("Desktop Offline Sudachi WASM Integration", () => {
  test("fallbackTokenize segments Japanese sentences into valid POS tokens", async () => {
    const { fallbackTokenize } = await import("../src/ui/lib/wasm/sudachi_tokenizer.js");
    const sample = "吾輩は猫である。名前はまだ無い。";
    const result = fallbackTokenize(sample);

    assert.ok(result);
    assert.ok(Array.isArray(result.tokens));
    assert.ok(result.tokens.length >= 2);
    assert.strictEqual(result.source, "client_fallback");

    // Verify token structure matches Sudachi schema
    const firstToken = result.tokens[0];
    assert.ok(firstToken.surface);
    assert.ok(firstToken.dictionary_form);
    assert.ok(firstToken.part_of_speech);
    assert.strictEqual(Array.isArray(firstToken.part_of_speech), true);
  });

  test("webAPI.tokenize resolves tokens and caches query in memory", async () => {
    // Set up mock window / localStorage for webAPI
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      key: () => null,
      length: 0
    };

    const { webAPI } = await import("../src/platform/web.js");
    assert.strictEqual(typeof webAPI.tokenize, "function");

    const text = "日本語の勉強";
    const res = await webAPI.tokenize(text, "C");
    assert.ok(res);
    assert.ok(Array.isArray(res.tokens));
    assert.ok(res.tokens.length > 0);

    // Call again to verify cache hit
    const cached = await webAPI.tokenize(text, "C");
    assert.strictEqual(cached, res);
  });

  test("apiClient.tokenize works without requiring remote server connection", async () => {
    const { apiClient } = await import("../src/ui/services/api_client.js");
    assert.strictEqual(typeof apiClient.tokenize, "function");

    const result = await apiClient.tokenize("花火大会", "C");
    assert.ok(result);
    assert.ok(Array.isArray(result.tokens));
    assert.strictEqual(result.tokens[0].surface, "花火大会");
  });
});

