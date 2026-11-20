# Templates

## Contract (`docs/contracts/<module>.md`) — gate requires these headings

```markdown
# Contract: <module>
Depends-on: <module list or none>

## Purpose
One sentence.

## Boundaries
Inputs and outputs: routes, message types, function exports, CLI.
One line each with request/response shape.

## State and storage
Tables, files, storage keys, caches, env vars/secrets.
Note where state lives (memory vs persistent).

## Dependencies
Other modules and third-party services it calls, and what it assumes about them.

## Invariants
Things that must ALWAYS be true (e.g. "a user can never read another user's rows").
These become the core of the verifier's attack surface.

## Failure behavior
What it does when a dependency is down, input is bad, token is expired.
Errors must be visible (logged/returned), never swallowed.

## Out of scope
What this module deliberately does not do.
```

Use `UNKNOWN` for anything not determinable from the code.
`UNKNOWN` in **Purpose**, **Invariants**, or **Failure behavior** is a critical gate failure.

---

## Ledger (`docs/hardening/<module>.md`)

```markdown
# Hardening: <module>
State: in-progress
Phase: <0..7 | frozen | blocked>
Mode: fix | report-only
Updated: <date>
Test-command: <full command string>
Suite-covers: module
Smoke-command: <full command string or blank>
Verifier-rounds: 0/2
Verifier: pending | round-1-done | round-2-done | clean

## Scenarios
| ID  | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|-----|----------|----------------|------|--------|----------|------------|------|
| S01 | ...      | ...            | tests/scenarios/<m>/test_x.py::test_name | todo | critical | | |

Status values: todo | pass | fail | blocked | waived: <reason>
Severity values: critical (core flow) | high | low

## Baseline
Phase 3 red run (paste summary here):

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|----------|---|------------|--------|--------|----------|

## Noticed, not fixed
- <finding> (not a core-flow issue; defer to KNOWN_ISSUES.md)

## Gate results
<date>: <paste gate output tail>
```

**Status values explained:**
| Status | Meaning |
|--------|---------|
| `todo` | test not yet written or run |
| `pass` | test passes |
| `fail` | test fails, attempts remaining |
| `blocked` | 2 unsuccessful attempts, no new evidence; do not retry |
| `waived: <reason>` | non-core-flow; accepted as-is |

---

## KNOWN_ISSUES.md

```markdown
| Module | Scenario | Issue | Why not core flow | Repro/test |
|--------|----------|-------|-------------------|------------|
```

---

## AGENTS.md "Definition of done" block

```markdown
## Definition of done
- Never write "done" or "production ready". Paste the exact command output that proves it.
- Bug fix = failing test first, same test passing after. Show both outputs.
- Run the module smoke command. A fix that leaves it red is not done.
- Minimal diff. No refactors or unrelated fixes; list them under "Noticed, not fixed".
- No new try/catch that swallows errors; no new fallback paths.
- Same test still red after 2 attempts: stop, record in ledger, report to user.
  Do not continue in this session. Attempt counts persist across sessions.
- Module is frozen only when gate.py exits 0 and git tag frozen-<module> exists.
```

