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
- `video.attach`: `{ tab: int, frame?: int, site: str, title: str, duration: float, drm: bool, hasNextEpisode?: bool }`.
- `video.detach`: `{ tab: int, frame?: int }`.
- `video.state`: `{ tab?: int, frame?: int, t: float, paused: bool, rate: float, vol: float, muted: bool, hasNextEpisode?: bool }`.
  Emitted at <= 4Hz while playing, and immediately upon state change (pause/play/seek).
- `peer.status`: `{ ext: int, desk: int }` (broadcast by hub).
- `session.snapshot`: `{ sessions: [...] }` (optional full snapshot).
- `sub.status`: `{ tab?: int, frame?: int, source: "none"|"embedded"|"youtube"|"jimaku"|"file", name: str, count: int, offsetMs: int }`.
- `cue.list`: `{ tab?: int, frame?: int, hash: str, part?: int, parts?: int, cues: [{ i: int, s: float, e: float, text: str }] }`.
  Chunk size <= 500 cues; total payload <= 1MB.
- `cue.active`: `{ tab?: int, frame?: int, i: int | null, secondary_text?: str }`.
- `clip.result`: `{ reqId: str, image_b64?: str, audio_b64?: str }`.

## 4. Desktop -> Extension Commands (`desk -> ext`)
Only `desk` may originate `cmd.*` messages. Hub rejects any `cmd.*` from `ext`.
All commands accept optional `tab: int` and `frame: int`.
- `cmd.play`: `{ tab?: int, frame?: int }`
- `cmd.pause`: `{ tab?: int, frame?: int }`
- `cmd.toggle`: `{ tab?: int, frame?: int }`
- `cmd.seek`: `{ tab?: int, frame?: int, t?: float, delta?: float }` (at least one of t/delta required).
- `cmd.cue`: `{ tab?: int, frame?: int, delta?: int, i?: int }` (at least one of delta/i required).
- `cmd.loop`: `{ tab?: int, frame?: int, s: float, e: float, count: int }`.
- `cmd.rate`: `{ tab?: int, frame?: int, v: float }`.
- `cmd.offset`: `{ tab?: int, frame?: int, ms: int }`.
- `cmd.clip`: `{ tab?: int, frame?: int, reqId: str, s: float, e: float, want: ["image"|"audio"] }`.
- `cmd.subs`: `{ tab?: int, frame?: int, action: "open_menu"|"clear" }`.
- `cmd.next_episode`: `{ tab?: int, frame?: int }`.
- `cue.request`: `{ hash: str }`.

## 5. Acknowledgment & Error Reporting
- `ack`: `{ id: str, ok: bool, err?: str }`.
- Sent by the recipient for commands or by the hub when a message is rejected.

## 6. Security & Invariants
- Loopback only: hub binds strictly to `127.0.0.1:21828`.
- Size limits: payload <= 64KB for all types except `cue.list` (which is capped at 1MB).
- Rate limits: maximum 30 messages/sec per client.
- Role enforcement: only `desk` can issue `cmd.*`.
- No Widevine/DRM bypass: DRM sites emit `drm: true` and play in browser; Kiroku acts as companion.

## 7. Threat Model
- **Untrusted Web Content & Cross-Origin Sites**: Malicious websites in browser tabs must not issue commands or access companion data. Mitigated by strict Origin header validation (`check_link_origin`), denying wildcard/subdomain spoofing, and requiring cryptographic token verification during the 3-second `hello` handshake.
- **DNS Rebinding**: Malicious external domains resolving to `127.0.0.1` are blocked at handshake by strict `Host` header enforcement (`127.0.0.1`, `localhost`, `[::1]`).
- **Privilege Escalation**: Browser extensions and untrusted video contexts cannot issue control commands (`cmd.*`); commands are exclusively permitted from authenticated `desk` clients.
- **Denial of Service & Buffer Exhaustion**: WebSocket frames are strictly limited to 1MB (`MAX_CUE_LIST_PAYLOAD_BYTES`), with standard events capped at 64KB and a sliding window rate limit (30 msgs/sec). Oversized frames terminate the connection with code `1009`.
- **Credential Leakage**: Handshake tokens are transmitted only within WebSocket payload bodies over loopback, never logged in diagnostic output or exposed via query parameters.
- **Renderer Isolation in Theater**: Embedded streaming WebContentsViews operate in an isolated sandbox (`contextIsolation: true`, `nodeIntegration: false`) with no access to Electron `desktopAPI`.
