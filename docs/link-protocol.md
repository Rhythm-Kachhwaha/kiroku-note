# Kiroku Link Protocol Specification (v1)

WebSocket companion protocol connecting the Kiroku Chrome extension (`ext`) and desktop app (`desk`) through a local loopback hub (`hub`) on `127.0.0.1:21828`.

## 1. Envelope Structure
Every message over WebSocket is a JSON object with the fixed schema:
- `v`: integer, always `1`.
- `id`: string, unique message ID (UUID or monotonic ID).
- `ts`: integer, Unix timestamp in milliseconds (> 0).
- `type`: string, message event or command name.
- `src`: string, `"ext"` | `"desk"` | `"hub"`.
- `sid`: string (optional), session ID assigned by the hub in `hello.ok`.
- `seq`: integer, sequence number per source/session (>= 0).
- `payload`: object, type-specific payload dictionary.

## 2. Authentication & Handshake
- First message from a client must be `hello` within 3.0 seconds of connection.
- `hello` payload: `{ role: "ext"|"desk", token: string, client: string }`.
  - Tokens are never sent in the WebSocket URL query.
  - `ext` presents a token with `link:rw` scope obtained via pairing.
  - `desk` presents the desktop control token.
- Hub responds with `hello.ok`: `{ sid: string }`.
- Either side may send `bye`: `{}` before closing.
- Errors during handshake close the socket with code `4401`.

## 3. Extension -> Desktop Messages (`ext -> desk`)
- `video.attach`: `{ tab: int, site: str, title: str, duration: float, drm: bool }`.
- `video.state`: `{ t: float, paused: bool, rate: float, vol: float, muted: bool }`.
  Emitted at <= 4Hz while playing, and immediately upon state change (pause/play/seek).
- `cue.list`: `{ hash: str, cues: [{ i: int, s: float, e: float, text: str }] }`.
  Chunk size <= 500 cues; total payload <= 1MB.
- `cue.active`: `{ i: int | null }`.
- `clip.result`: `{ reqId: str, image_b64?: str, audio_b64?: str }`.

## 4. Desktop -> Extension Commands (`desk -> ext`)
Only `desk` may originate `cmd.*` messages. Hub rejects any `cmd.*` from `ext`.
- `cmd.play`: `{}`
- `cmd.pause`: `{}`
- `cmd.toggle`: `{}`
- `cmd.seek`: `{ t?: float, delta?: float }` (at least one required).
- `cmd.cue`: `{ delta?: int, i?: int }` (at least one required).
- `cmd.loop`: `{ s: float, e: float, count: int }`.
- `cmd.rate`: `{ v: float }`.
- `cmd.offset`: `{ ms: int }`.
- `cmd.clip`: `{ reqId: str, s: float, e: float, want: ["image"|"audio"] }`.

## 5. Acknowledgment & Error Reporting
- `ack`: `{ id: str, ok: bool, err?: str }`.
- Sent by the recipient for commands or by the hub when a message is rejected.

## 6. Security & Invariants
- Loopback only: hub binds strictly to `127.0.0.1:21828`.
- Size limits: payload <= 64KB for all types except `cue.list` (which is capped at 1MB).
- Rate limits: maximum 30 messages/sec per client.
- Role enforcement: only `desk` can issue `cmd.*`.
- No Widevine/DRM bypass: DRM sites emit `drm: true` and play in browser; Kiroku acts as companion.
