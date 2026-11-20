---
name: harden-module
description: Make one Kiroku module (db, cloud-auth, sync, extension, ankiconnect, desktop) trustworthy using a fixed loop of contract → scenarios → failing tests → minimal fixes → objective gate → fresh-session verification. Use whenever the user says "harden", "audit", "make X production ready", "is X ready", "fix bugs in X", "find bugs in X", wants a per-module bug sweep, or is about to start UI work and wants the backend locked. Also use when an agent is about to claim "done" or "100% prod ready" without test output, or when a bug has already taken more than two fix attempts. Use it instead of whole-repo code-read audits.
---

# harden-module

Goal: turn "is this module ready?" from an opinion into a command that passes or fails.
One module per session. Never audit the whole repo. Never say "done" or "production ready":
report test output and let the gate decide.

Invocation: `harden <module>` or `harden <module> --resume`.
Modules, in dependency order: `db` → `cloud-auth` → `sync` → `extension` → `ankiconnect` → `desktop` → (UI).
If the user picks a later module while an earlier one is not frozen, say so in one line and ask which to do.
Independent modules (e.g. `ankiconnect` does not depend on `extension` being frozen) may be hardened separately.

## Terminal states

Every run MUST end in one of:
- **frozen** — gate passed, git tag `frozen-<module>` created.
- **blocked** — ≥ 1 scenario hit the attempt limit with no new evidence; recorded in ledger.
- **report-only** — ledger written, no fixes applied (mode=report-only).

Never silently restart a completed phase or audit. Never re-enter Phase 0 after Phase 3+ without explicit user instruction.

---

## Hard rules (apply in every phase)

1. **Evidence, not claims.** Any statement of status must be followed by pasted command output. No output = no claim.
2. **Test the real boundary.** Real DB file, real `app.request()`/HTTP call, real message passing. Mock only third-party services (Google, Anki, Turso network). Never mock our own functions.
3. **Minimal diffs.** Fix only the failing test. No refactors, no drive-by fixes, no new fallback paths, no `catch {}` that swallows errors. Anything else goes under "Noticed, not fixed" in the ledger.
4. **Two-attempt rule — persistent.** Attempt counts live in `docs/hardening/<module>.md`. Starting a new session NEVER resets them. After 2 unsuccessful attempts on a scenario or shared root cause: mark `blocked`, record exact output + what was tried, stop. Do not retry the same hypothesis in another session without new evidence or user approval (`attempts.py unblock`). Always run `attempts.py check` before touching code.
5. **Read narrowly.** Read the contract file and the files it lists. Use grep to find the rest. Do not read the whole module.
6. **Resumable.** Keep `docs/hardening/<module>.md` updated after every phase so a new session can continue with `--resume` by reading only that file and the contract.
7. **No automatic audit loops.** Every phase has a defined exit condition. Never restart the entire audit because one check failed.
8. **Correct failure routing.**
   - Contract failures (UNKNOWN headings after Phase 1) → return to Phase 1.
   - Scenario/ledger failures → Phase 2–3.
   - Test failures → Phase 4.
   - Verifier findings → new scenarios in the ledger (Phase 2 addition), not automatic Phase 4.
   Do NOT send every gate failure to Phase 4.
9. **Fix when requested.** If the user says "harden X" (not "report-only"), proceed automatically from failing tests into the fix phase. Stop for approval only when: blocked, a destructive action is required, or requirements are genuinely ambiguous.
10. **No duplicate scenarios.** Before adding a scenario, check the ledger for one with the same observable behaviour and root cause. Extend the existing row instead.
11. **Bounded verification.** Maximum 2 independent verifier rounds per module freeze. After 2 rounds, unresolved findings leave the module `blocked`, not re-verified indefinitely.
12. **Meaningful scenarios only.** Target 8–15 relevant scenarios. Never invent scenarios just to satisfy a minimum count. Adjust the floor with `--min-scenarios` on the gate.
13. **Evidence-based gate.** Every scenario must reference an executable test path. The gate rejects unresolved critical UNKNOWNs, blocked scenarios, and invalid test references.
14. **Bounded scope.** One module per session. Do not expand into adjacent modules unless a confirmed defect crosses the selected module's boundary. Record unrelated findings under "Noticed, not fixed" without fixing them.

---

## Files this skill creates (in the user's repo)

- `docs/contracts/<module>.md` — contract (template in `references/templates.md`).
- `docs/hardening/<module>.md` — ledger: phase, scenario table, attempt history, noticed-not-fixed, gate results. **This is the persistent source of truth; never discard it.**
- `tests/scenarios/<module>/` — one test per scenario (use the repo's existing test runner; do not introduce a new framework).
- `KNOWN_ISSUES.md` (repo root) — non-core-flow bugs parked for after UI.

Scripts live in this skill folder and are referenced with their relative path:
- `scripts/ledger_init.py` — scaffold ledger + contract without overwriting.
- `scripts/attempts.py` — persistent attempt limiter (check / log / unblock).
- `scripts/ledger.py` — shared ledger I/O helpers.
- `scripts/gate.py` — objective pass/fail gate.

---

## Workflow

Update the ledger's `Phase:` line at the end of each phase.

### Phase 0: Scope (5 min)

1. Run `python <skill>/scripts/ledger_init.py <module> [--mode fix|report-only]`.
   - If ledger **already exists**: the script prints its current state. Read ledger + contract and jump to the recorded phase. Do NOT restart or overwrite.
   - If new: script creates contract stub + ledger skeleton.
2. Find the existing test command (`Test-command:` in ledger or grep for it). Run it once for a baseline; paste the summary.
3. Note module files with `grep`/`ls` only.

### Phase 1: Contract

Write/fill `docs/contracts/<module>.md` from the template. Derive it from the code by grepping routes, message types, storage keys, env vars, tables. Mark anything you cannot determine as `UNKNOWN`. Ask the user at most **one batched question** about UNKNOWNs. Contract is one page max.

**Exit condition:** all required headings present. Remaining UNKNOWNs are acceptable (gate will warn, not fail, unless critical).
**Failure routing:** if gate later flags contract issues → return here, not to Phase 4.

### Phase 2: Scenarios

Open `references/checklists.md`, take the section for this module, adapt to the contract: **8–15 concrete scenarios**, each a row in the ledger table (`S01 … | todo`). Each scenario must name an observable pass condition ("returns 401", "row exists once", "token stored under key X"). Before adding any scenario, check the existing ledger rows for duplicates.

**Exit condition:** ledger has ≥ 8 rows, all with observable pass conditions, no duplicates.

### Phase 3: Tests first (no fixes yet)

Write one automated test per scenario against the real boundary. Run them all. Paste the raw summary. Update ledger statuses (`pass` / `fail` / `blocked`) with a one-line cause per failure. Show the user the full table — this red list is the real bug list.

Failures that cannot break a core flow go to `KNOWN_ISSUES.md` with `waived: <reason>`.

**Exit condition:** all scenarios have a status (not `todo`). Paste the raw run.
**Failure routing:** test failures here → Phase 4. Do not loop back to Phase 0 or 1.

### Phase 4: Fix loop

> Skip entirely if `mode: report-only`.

**Before every fix attempt:**
```
python <skill>/scripts/attempts.py check <module> <SID> --hypothesis "<what you will try>"
```
Exit codes: 0 = allowed, 3 = blocked (stop), 4 = repeated hypothesis (reformulate).

For each failing core-flow test, in ledger order, one at a time:
1. Show the failing output.
2. Make the smallest change.
3. Re-run that test, then the full scenario suite. Paste both.
4. Log the attempt:
   ```
   python <skill>/scripts/attempts.py log <module> <SID> --hypothesis "..." --change "..." --result pass|fail --evidence "<last 3 lines of output>"
   ```
5. If `result=fail` and the script exits 3 → scenario is now `blocked`. Record in ledger. Tell the user. Move to the next scenario.

Do not batch fixes. Do not start the next scenario before the previous one is green or blocked.

**Exit condition:** all core-flow scenarios are `pass`, `waived:`, or `blocked`. Non-core-flow failures stay in `KNOWN_ISSUES.md`.

### Phase 5: Gate

```
python <skill>/scripts/gate.py <module> \
  --test "<module test command>" \
  --smoke "<smoke command>" \
  --min-scenarios 8 \
  --tag
```

Gate checks (all must pass):
1. `docs/contracts/<module>.md` has all required headings (no critical UNKNOWN).
2. `docs/hardening/<module>.md` has ≥ N scenario rows, none `todo`/`fail`/`blocked` (unless `waived:`).
3. `--test` exits 0.
4. `--smoke` exits 0 (if given).

**Failure routing:**
- Contract failures → Phase 1.
- Ledger failures (todo/fail/blocked rows) → Phase 4 (or mark blocked if attempt limit reached).
- Test failures → Phase 4.
- Smoke failures → Phase 4.
Do NOT loop the entire audit. Fix the specific check that failed and re-run the gate.

Paste the full gate output to the ledger under `## Gate results`.

### Phase 6: Verify

Dispatch a **fresh subagent** using the verifier prompt (`references/prompts.md`). The verifier has not seen Phase 4 and must not edit source files. It reads only the contract and attacks the module's public boundary.

Verifier findings become new scenarios in the ledger (Phase 2 addition). Fix them in Phase 4 if core-flow. Maximum **2 verifier rounds**. After 2 rounds, unresolved findings = `blocked`.

### Phase 7: Freeze

Gate passes, verifier clean (or remaining findings are `blocked`/`waived:`):
```
git tag frozen-<module>
```
Update ledger `State: frozen`. Done — module is locked.

---

## Attempt-limit unblock protocol

If a scenario is `blocked` and the user provides **new evidence** (a stack trace, a repro that changes the root-cause hypothesis, or explicit approval):
```
python <skill>/scripts/attempts.py unblock <module> <SID> \
  --evidence "<what changed>" \
  [--approved-by-user]
```
This resets the counter for that scenario/root-cause group and allows 2 fresh attempts.

---

## Quick-start: what "harden db" looks like end-to-end

```
# Agent actions (fully automatic unless blocked):
python scripts/ledger_init.py db
# → If new: fills contract stub, creates ledger
# → If exists: prints phase, resumes

# Phase 1: grep routes/tables → fill docs/contracts/db.md
# Phase 2: 10 scenarios from checklist → rows in ledger
# Phase 3: write + run tests → paste red list
# Phase 4: for each fail:
#   attempts.py check db S03 --hypothesis "..."
#   <edit code>
#   <run test + suite>
#   attempts.py log db S03 --result pass|fail --evidence "..."
# Phase 5: gate.py db --test "..." --smoke "..." --tag
# Phase 6: verifier subagent → any findings become new scenarios
# Phase 7: git tag frozen-db
```

---

## Kiroku module dependency order (reference)

```
db → cloud-auth → sync → extension → ankiconnect → desktop → (UI)
```

Independent pairs (can be hardened out of order if no real dependency):
- `ankiconnect` and `extension` are independent.
- `desktop` depends on `db` being frozen; loosely depends on `sync`/`extension`.

If a module you pick depends on one that is not frozen, say so and ask which to do first.

