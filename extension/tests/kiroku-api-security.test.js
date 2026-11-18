/**
 * Kiroku Note - Kiroku API Security & Validation Tests
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { KirokuApi } = require("../lib/kiroku-api.js");

test("KirokuApi: rejects malformed cueHash and path traversal", async () => {
  const api = new KirokuApi();

  // Invalid / traversal hashes
  const invalidHashes = [
    "../traversal",
    "hash/with/slashes",
    "hash with spaces",
    "hash<script>alert(1)</script>",
    "",
    null,
    undefined,
    "a".repeat(129)
  ];

  for (const h of invalidHashes) {
    const res = await api.saveEpisodePosition(h, 12000);
    assert.equal(res.ok, false);
    assert.equal(res.error, "Invalid cueHash format");
  }
});

test("KirokuApi: rejects malformed sessionPayload.hash", async () => {
  const api = new KirokuApi();

  const invalidSessions = [
    { hash: "../../malicious" },
    { hash: "bad hash with spaces" },
    { hash: "" },
    {},
    null
  ];

  for (const s of invalidSessions) {
    const res = await api.syncEpisodeSession(s);
    assert.equal(res.ok, false);
  }
});

test("KirokuApi: attaches Bearer auth header when token configured", () => {
  const api = new KirokuApi("http://127.0.0.1:21828", "secret-token-123");
  assert.equal(api.getAuthToken(), "secret-token-123");

  const headers = api._getHeaders({ "Content-Type": "application/json" });
  assert.equal(headers["Authorization"], "Bearer secret-token-123");
  assert.equal(headers["Content-Type"], "application/json");

  api.setAuthToken("new-token-456");
  assert.equal(api.getAuthToken(), "new-token-456");
  const headers2 = api._getHeaders();
  assert.equal(headers2["Authorization"], "Bearer new-token-456");

  api.setAuthToken(null);
  assert.equal(api.getAuthToken(), null);
  const headers3 = api._getHeaders();
  assert.equal(headers3["Authorization"], undefined);
});
