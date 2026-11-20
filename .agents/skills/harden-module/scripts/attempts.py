#!/usr/bin/env python3
"""Persistent attempt limiter. State lives in docs/hardening/MODULE.md — never in the session.
Starting a new session NEVER resets attempt counts.

Commands
--------
  attempts.py check   MODULE SID --hypothesis "..."
      Exit 0 = allowed, 3 = blocked (stop, do not touch code), 4 = repeated hypothesis.

  attempts.py log     MODULE SID --hypothesis "..." --change "..." --result pass|fail --evidence "..."
      Record the outcome. If the scenario or its root-cause group now has >= LIMIT failures, marks
      all affected scenarios 'blocked' and exits 3.

  attempts.py unblock MODULE SID --evidence "..." [--approved-by-user]
      Insert an 'unblock' record so the next 2 fresh attempts are allowed.
      Use only when the user provides new evidence or gives explicit approval.

Rules
-----
  - Max 2 unsuccessful attempts per scenario OR per shared Root-cause key.
  - The 2nd failure sets the scenario(s) to 'blocked'.
  - A hypothesis already tried for the scenario is refused (exit 4) unless the latest
    unblock was recorded with --approved-by-user.
  - Always run `check` BEFORE changing any code.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import ledger as L

LIMIT = 2


def group(lines, sid):
    _, scen = L.table(lines, "Scenarios")
    me = next((r for r in scen if r.get("ID") == sid), None)
    if not me:
        sys.exit(f"ERROR: scenario {sid} not found in ledger. Available: "
                 f"{[r.get('ID') for r in scen]}")
    rc = L.norm(me.get("Root cause", ""))
    ids = {
        r["ID"] for r in scen
        if r["ID"] == sid or (rc and L.norm(r.get("Root cause", "")) == rc)
    }
    return me, scen, ids


def history(lines, ids):
    _, att = L.table(lines, "Attempts")
    rows = [a for a in att if a.get("Scenario") in ids]
    last_unblock = max(
        (i for i, a in enumerate(rows) if a.get("Result") == "unblock"),
        default=-1
    )
    since = rows[last_unblock + 1:]
    fails = [a for a in since if a.get("Result") == "fail"]
    return rows, last_unblock, fails


def cmd_check(a):
    p = L.ledger_path(a.root, a.module)
    lines = L.load(p)
    me, scen, ids = group(lines, a.sid)
    rows, lu, fails = history(lines, ids)

    if me.get("Status", "").lower() == "blocked" or len(fails) >= LIMIT:
        print(
            f"BLOCKED: {a.sid} has {len(fails)} unsuccessful attempt(s) "
            f"(limit {LIMIT}). Do not touch code. Record the exact output in "
            f"the ledger and report to the user. Use 'attempts.py unblock' "
            f"only when new evidence or explicit user approval is provided."
        )
        sys.exit(3)

    tried = [
        L.norm(r.get("Hypothesis", ""))
        for r in rows
        if r.get("Hypothesis") and r.get("Result") != "unblock"
    ]
    approved = lu >= 0 and rows[lu].get("Change") == "approved-by-user"

    if a.hypothesis and L.norm(a.hypothesis) in tried and not approved:
        print(
            f"REPEAT: this hypothesis was already tried for {a.sid}. "
            f"Form a materially different hypothesis, or ask the user to "
            f"approve a repeat via 'attempts.py unblock --approved-by-user'."
        )
        sys.exit(4)

    remaining = LIMIT - len(fails)
    print(f"ALLOWED: attempt {len(fails) + 1} of {LIMIT} for {a.sid} "
          f"({remaining} remaining before block)")


def cmd_log(a):
    p = L.ledger_path(a.root, a.module)
    lines = L.load(p)
    me, scen, ids = group(lines, a.sid)
    _, att = L.table(lines, "Attempts")
    n = sum(1 for r in att if r.get("Scenario") == a.sid) + 1

    L.append_row(lines, "Attempts", {
        "Scenario": a.sid, "#": n,
        "Hypothesis": a.hypothesis, "Change": a.change,
        "Result": a.result, "Evidence": a.evidence,
    })

    cols, scen_rows = L.table(lines, "Scenarios")
    _, _, fails = history(lines, ids)

    for r in scen_rows:
        if r["ID"] == a.sid and a.result == "pass":
            r["Status"] = "pass"
            L.write_row(lines, cols, r)
        if r["ID"] in ids and a.result == "fail" and len(fails) >= LIMIT:
            r["Status"] = "blocked"
            L.write_row(lines, cols, r)

    L.save(p, lines)

    if a.result == "fail" and len(fails) >= LIMIT:
        print(
            f"BLOCKED: {sorted(ids)} marked 'blocked' after {len(fails)} "
            f"unsuccessful attempt(s). Record the raw failure output in the "
            f"ledger. Tell the user. Do not retry in this session."
        )
        sys.exit(3)

    print(f"logged attempt {n} for {a.sid}: {a.result}")


def cmd_unblock(a):
    p = L.ledger_path(a.root, a.module)
    lines = L.load(p)
    me, scen, ids = group(lines, a.sid)

    L.append_row(lines, "Attempts", {
        "Scenario": a.sid, "#": "-",
        "Hypothesis": "unblock",
        "Change": "approved-by-user" if a.approved_by_user else "new-evidence",
        "Result": "unblock",
        "Evidence": a.evidence,
    })

    cols, scen_rows = L.table(lines, "Scenarios")
    for r in scen_rows:
        if r["ID"] in ids and r.get("Status", "").lower() == "blocked":
            r["Status"] = "fail"
            L.write_row(lines, cols, r)

    L.save(p, lines)
    print(f"unblocked {sorted(ids)}: {LIMIT} fresh attempts now allowed")


def main():
    ap = argparse.ArgumentParser(
        description="Persistent attempt limiter for harden-module."
    )
    ap.add_argument("--root", default=".")
    sub = ap.add_subparsers(dest="cmd", required=True)

    for name in ("check", "log", "unblock"):
        s = sub.add_parser(name)
        s.add_argument("module")
        s.add_argument("sid")
        s.add_argument("--root", default=".")
        if name != "unblock":
            s.add_argument("--hypothesis", default="",
                           help="What you plan to try (or tried)")
        if name == "log":
            s.add_argument("--change", default="",
                           help="Files/lines changed")
            s.add_argument("--result", choices=["pass", "fail"], required=True)
            s.add_argument("--evidence", default="",
                           help="Last 3-5 lines of test output")
        if name == "unblock":
            s.add_argument("--evidence", required=True,
                           help="New evidence or reason for unblock")
            s.add_argument("--approved-by-user", action="store_true",
                           help="User explicitly approved retrying this scenario")

    a = ap.parse_args()
    {"check": cmd_check, "log": cmd_log, "unblock": cmd_unblock}[a.cmd](a)


if __name__ == "__main__":
    main()

