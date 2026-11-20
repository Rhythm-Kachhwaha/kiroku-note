# Prompts for other agent sessions

Use these verbatim (fill in the angle-bracket placeholders). They set narrow scope
so the subagent cannot drift into unrelated modules or restart completed phases.

---

## Scenario writer (Phases 2–3 in a separate session)

```
Module: <name>. Read ONLY docs/contracts/<name>.md and the files it lists.
Task: write tests, not fixes.

1. Fill the scenario table in docs/hardening/<name>.md (8–15 rows) using the
   harden-module checklist for this module. Before adding any row, check the
   existing table for a scenario with the same observable behaviour or root
   cause; extend the existing row instead of adding a duplicate.
2. Write one automated test per scenario against the real boundary:
   real DB file, real HTTP/app.request, real message passing.
   Mock only third-party services (Google, Anki, Turso network).
   Never mock our own functions.
3. Run all tests. Paste the raw output summary.
4. Update ledger statuses (pass / fail / blocked) with a one-line cause per failure.

Output: the full scenario table with statuses and causes. Do not fix anything.
Do not say "ready", "done", or "production ready".
Do not expand into adjacent modules.
```

---

## Fixer (one failing scenario per session)

```
Fix this one failing scenario only: <SID> — <scenario description>.
Failure output:
<paste raw test failure output>

Files you may touch: <2–3 specific paths>.

Before touching any code:
  python <skill>/scripts/attempts.py check <module> <SID> --hypothesis "<your plan>"
If that exits non-zero, stop immediately and report the exit code.

Make the smallest possible change. No refactors, no new fallbacks, no
try/catch that swallows errors.

After the change:
  1. Re-run the scenario test. Paste output.
  2. Re-run the full module suite. Paste summary.
  3. Log the attempt:
     python <skill>/scripts/attempts.py log <module> <SID> \
       --hypothesis "<what you tried>" --change "<files:lines>" \
       --result pass|fail --evidence "<last 3 lines of output>"

If still failing after logging: stop. Record what you tried under "Noticed, not fixed".
Do not attempt a third time in this session.
Anything else you notice goes under "Noticed, not fixed" in the ledger and stays unfixed.
```

---

## Verifier (fresh session — never the author)

```
You are a hostile tester. You did not write this code.

Read ONLY docs/contracts/<name>.md. Do not read the source unless a specific
boundary call requires it.

Your goal: find at least one real failure through the module's public boundary,
focusing on the Invariants and Failure behavior sections.

For each probe, write:
  - Command / call made
  - Full output (or relevant excerpt)
  - Expected vs actual

Return either:
  (a) A failing reproduction: command + output + expected vs actual.
  (b) "No failing repro after N probes" listing every probe attempted.

Do NOT:
  - Propose redesigns.
  - Edit source files.
  - Restart phases or re-run the full audit.
  - Add more than 10 probes without a finding (bounded verification).

If you find a failure, the COORDINATOR will add it as a new scenario in the ledger
(Phase 2 addition) and route it through Phase 4. Do not fix it yourself.
```

---

## Resume prompt (new session on a blocked module)

```
Module: <name>. Resuming hardening.

Read docs/hardening/<name>.md and docs/contracts/<name>.md ONLY.
Jump to Phase <N as recorded in ledger>.

Blocked scenarios: <list SIDs>
Do NOT retry blocked scenarios without first running:
  python <skill>/scripts/attempts.py unblock <module> <SID> \
    --evidence "<new evidence>" [--approved-by-user]

Proceed with any non-blocked failing scenarios in ledger order.
If all failing scenarios are blocked, run the gate and report the terminal state.
```

