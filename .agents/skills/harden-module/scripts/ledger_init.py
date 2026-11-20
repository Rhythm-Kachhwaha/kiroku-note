#!/usr/bin/env python3
"""Scaffold contract + ledger for a module. Never overwrites an existing ledger.
If the ledger exists it prints its current state and exits so a new session resumes
instead of restarting.

Usage:
  ledger_init.py <module> [--root .] [--mode fix|report-only]
"""
import argparse
import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import ledger as L

CONTRACT = """\
# Contract: {m}
Depends-on: UNKNOWN
## Purpose
UNKNOWN
## Boundaries
UNKNOWN
## State and storage
UNKNOWN
## Dependencies
UNKNOWN
## Invariants
UNKNOWN
## Failure behavior
UNKNOWN
## Out of scope
UNKNOWN
"""

LEDGER = """\
# Hardening: {m}
State: in-progress
Phase: 0
Mode: {mode}
Updated: {d}
Test-command: UNSET
Suite-covers: module
Smoke-command:
Verifier-rounds: 0/2
Verifier: pending

## Scenarios
| ID | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|----|----------|----------------|------|--------|----------|------------|------|

## Baseline
Phase 3 red run (paste summary here):

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|----------|---|------------|--------|--------|----------|

## Noticed, not fixed

## Gate results
"""


def main():
    ap = argparse.ArgumentParser(
        description="Scaffold or resume hardening ledger for a module."
    )
    ap.add_argument("module")
    ap.add_argument("--root", default=".")
    ap.add_argument("--mode", choices=["fix", "report-only"], default="fix")
    a = ap.parse_args()
    root = Path(a.root)

    lp = L.ledger_path(root, a.module)
    if lp.exists():
        lines = L.load(lp)
        state = L.header_get(lines, "State")
        phase = L.header_get(lines, "Phase")
        mode = L.header_get(lines, "Mode")
        vr = L.header_get(lines, "Verifier-rounds")
        _, scen = L.table(lines, "Scenarios")
        blocked = [r["ID"] for r in scen if r.get("Status", "").lower() == "blocked"]
        print(
            f"EXISTS: {lp}\n"
            f"  State={state}  Phase={phase}  Mode={mode}  "
            f"Verifier-rounds={vr}\n"
            f"  Scenarios={len(scen)}"
            + (f"  BLOCKED={blocked}" if blocked else "")
        )
        print("Resume from the recorded phase. Do NOT restart or overwrite.")
        if blocked:
            print(
                f"WARNING: {len(blocked)} scenario(s) are blocked. "
                f"Provide new evidence or user approval before retrying."
            )
        return

    cp = L.contract_path(root, a.module)
    for p in (lp.parent, cp.parent, root / "tests" / "scenarios" / a.module):
        p.mkdir(parents=True, exist_ok=True)

    if not cp.exists():
        cp.write_text(CONTRACT.format(m=a.module), encoding="utf-8")

    lp.write_text(
        LEDGER.format(m=a.module, mode=a.mode, d=datetime.date.today()),
        encoding="utf-8"
    )

    ki = root / "KNOWN_ISSUES.md"
    if not ki.exists():
        ki.write_text(
            "| Module | Scenario | Issue | Why not core flow | Repro/test |\n"
            "|--------|----------|-------|-------------------|------------|\n",
            encoding="utf-8"
        )

    print(
        f"created: {cp}\n"
        f"         {lp}\n"
        f"         tests/scenarios/{a.module}/\n"
        f"Next: fill the contract (Phase 1). Mark anything unknown as UNKNOWN."
    )


if __name__ == "__main__":
    main()

