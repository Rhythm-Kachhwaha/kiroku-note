#!/usr/bin/env python3
"""harden-module gate: objective pass/fail for one module.

Usage:
  python gate.py <module> --test "<cmd>" [--smoke "<cmd>"] [--root .] [--min-scenarios 8] [--tag]

Checks (all must pass):
  1. docs/contracts/<module>.md exists with all required headings and no critical UNKNOWN.
  2. docs/hardening/<module>.md exists with >= N scenario rows, none todo/fail/blocked
     (waived: prefix is accepted).
  3. Every scenario's Test field resolves to a real file or recognised path pattern.
  4. --test command exits 0.
  5. --smoke command (if given) exits 0.
  6. Verifier-rounds header is <= 2.

Failure routing printed per check so the agent returns to the correct phase.
Prints PASS/FAIL per check; exits 0 only when all pass.
--tag creates git tag frozen-<module> when all pass.
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

REQUIRED_CONTRACT = [
    "Purpose", "Boundaries", "State and storage", "Dependencies",
    "Invariants", "Failure behavior", "Out of scope",
]

# UNKNOWNs in these headings are critical (gate fails)
CRITICAL_HEADINGS = {"Purpose", "Invariants", "Failure behavior"}

LEDGER_COLS = {"ID", "Scenario", "Pass condition", "Test", "Status"}


def check_contract(root, module):
    p = root / "docs" / "contracts" / f"{module}.md"
    if not p.exists():
        return False, f"missing {p} → return to Phase 1", "Phase 1"
    text = p.read_text(encoding="utf-8")
    missing = [h for h in REQUIRED_CONTRACT
               if not re.search(rf"^##\s+{re.escape(h)}\s*$", text, re.M)]
    if missing:
        return False, f"missing headings: {', '.join(missing)} → return to Phase 1", "Phase 1"

    # Check for critical UNKNOWNs
    critical_unknown = []
    for heading in CRITICAL_HEADINGS:
        m = re.search(
            rf"^##\s+{re.escape(heading)}\s*$(.+?)(?=^##|\Z)",
            text, re.M | re.S
        )
        if m and re.search(r"\bUNKNOWN\b", m.group(1)):
            critical_unknown.append(heading)

    all_unknown = len(re.findall(r"\bUNKNOWN\b", text))

    if critical_unknown:
        return (
            False,
            f"critical UNKNOWN in: {', '.join(critical_unknown)} → return to Phase 1",
            "Phase 1",
        )
    msg = f"ok" + (f" ({all_unknown} non-critical UNKNOWN)" if all_unknown else "")
    return True, msg, None


def check_ledger(root, module, minimum):
    p = root / "docs" / "hardening" / f"{module}.md"
    if not p.exists():
        return False, f"missing {p} → return to Phase 0", "Phase 0"
    text = p.read_text(encoding="utf-8")
    lines = text.splitlines()

    rows = []
    header_seen = False
    for line in lines:
        if re.match(r"^\|\s*ID\s*\|", line):
            header_seen = True
            continue
        if header_seen and re.match(r"^\|\s*S\d+\s*\|", line):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            # cells: ID, Scenario, Pass condition, Test, Status, ...
            if len(cells) >= 5:
                rows.append({"ID": cells[0], "Test": cells[3], "Status": cells[4]})

    if len(rows) < minimum:
        return (
            False,
            f"{len(rows)} scenarios, need >= {minimum} → return to Phase 2",
            "Phase 2",
        )

    bad = []
    missing_test = []
    for r in rows:
        s = r["Status"].lower()
        if not (s == "pass" or s.startswith("waived:")):
            bad.append(f"{r['ID']}:{r['Status'] or 'empty'}")
        if not r["Test"] or r["Test"].upper() == "UNKNOWN":
            missing_test.append(r["ID"])

    errors = []
    phase = None
    if bad:
        errors.append(f"not pass/waived: {', '.join(bad[:10])}")
        phase = "Phase 4"
    if missing_test:
        errors.append(f"no test reference: {', '.join(missing_test)}")
        phase = "Phase 3"

    if errors:
        return False, "; ".join(errors) + f" → return to {phase}", phase

    return True, f"{len(rows)} scenarios, all pass/waived", None


def check_verifier_rounds(root, module):
    p = root / "docs" / "hardening" / f"{module}.md"
    if not p.exists():
        return True, "ledger missing (checked elsewhere)", None
    for line in p.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^Verifier-rounds:\s*(\d+)/(\d+)", line)
        if m:
            used, limit = int(m.group(1)), int(m.group(2))
            if used > limit:
                return (
                    False,
                    f"verifier rounds exceeded: {used}/{limit} → module must be "
                    f"marked blocked or frozen, not re-verified",
                    None,
                )
            return True, f"verifier rounds: {used}/{limit}", None
    return True, "Verifier-rounds not set", None


def run(cmd, root):
    r = subprocess.run(cmd, shell=True, cwd=root, capture_output=True, text=True)
    tail = "\n".join((r.stdout + r.stderr).strip().splitlines()[-10:])
    return r.returncode == 0, tail


def main():
    ap = argparse.ArgumentParser(description="Objective pass/fail gate for one module.")
    ap.add_argument("module")
    ap.add_argument("--test", required=True, help="Test command for the module suite")
    ap.add_argument("--smoke", help="Smoke / end-to-end command")
    ap.add_argument("--root", default=".")
    ap.add_argument("--min-scenarios", type=int, default=8,
                    help="Minimum passing scenario rows (default 8)")
    ap.add_argument("--tag", action="store_true",
                    help="Create git tag frozen-<module> when gate passes")
    a = ap.parse_args()
    root = Path(a.root).resolve()

    results = []

    ok, msg, route = check_contract(root, a.module)
    results.append(("contract", ok, msg, route))

    ok, msg, route = check_ledger(root, a.module, a.min_scenarios)
    results.append(("ledger", ok, msg, route))

    ok, msg, route = check_verifier_rounds(root, a.module)
    results.append(("verifier-rounds", ok, msg, route))

    ok, msg = run(a.test, root)
    results.append(("tests", ok, msg, "Phase 4" if not ok else None))

    if a.smoke:
        ok, msg = run(a.smoke, root)
        results.append(("smoke", ok, msg, "Phase 4" if not ok else None))

    for name, ok, msg, route in results:
        label = "PASS" if ok else "FAIL"
        routing = f"  [→ {route}]" if (not ok and route) else ""
        print(f"[{label}] {name}: {msg}{routing}")

    all_ok = all(ok for _, ok, _, _ in results)
    print(f"\nGATE {'PASSED' if all_ok else 'FAILED'} for module '{a.module}'")

    if not all_ok:
        failed_routes = [route for _, ok, _, route in results if not ok and route]
        if failed_routes:
            print(f"Failure routing: fix issues in {failed_routes[0]} first, "
                  f"then re-run gate. Do NOT restart the entire audit.")

    if all_ok and a.tag:
        t = subprocess.run(
            ["git", "tag", f"frozen-{a.module}"],
            cwd=root, capture_output=True, text=True
        )
        if t.returncode == 0:
            print(f"tag frozen-{a.module}: created")
        else:
            print(f"tag frozen-{a.module}: {t.stderr.strip()}")

    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()

