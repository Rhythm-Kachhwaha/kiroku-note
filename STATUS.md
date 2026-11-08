# Status
A3: detection and injection hardened for all frame/DOM contexts.
Persistent video detector pierces shadow roots; WeakSet prevents redundant notifications.
Idempotent injection guard added to video-mining.js and link-bridge.js; SPA swaps handled.
Tests: video-detect-frames.test.js GREEN; e03-e07 all PASS in real Chrome.
Mutation ok.
