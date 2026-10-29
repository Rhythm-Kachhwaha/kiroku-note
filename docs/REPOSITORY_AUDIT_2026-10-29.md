# Kiroku Note Repository Audit

Date: 2026-10-29

This audit records the repository state and a safe reorganization plan. It does
not implement a desktop UI, move application modules, delete files, or change
API behavior.

## Repository inventory

### Checkout and working tree

- Branch: `main`
- HEAD at audit start: `ea9348c` (`chore: update gitignore ignore patterns`)
- The working tree was already modified before this audit:
  `PROGRESS.md`, `backend/app/data/grammar_reference.sqlite`,
  `backend/tests/test_grammar_acceptance_gate.py`,
  `backend/tests/test_grammar_matcher.py`,
  `backend/tests/test_grammar_reference.py`, and
  `tools/build_grammar_index.py`.
- Those changes were not reverted, staged, or rewritten.

### Runtime boundaries

| Area | Confirmed entry point | Responsibility |
| --- | --- | --- |
| Backend | `run_backend.py`, `backend/app/main.py` | Uvicorn and FastAPI lifecycle |
| Browser extension | `extension/manifest.json`, `extension/background.js`, `extension/sidepanel/sidepanel.html` | MV3 service worker, capture messaging and Side Panel UI |
| OCR | `python -m ocr_server.server` | Optional loopback OCR daemon |
| Local dictionary | `kiroku_dictionary/` | Standalone stdlib-only dictionary lookup/deinflection |
| Cloud queue | `kiroku_cloud_queue/server.py`, `worker.py` | Separately deployable queue API and worker |
| Packaging | `packaging/*.spec`, `installer/*.iss`, `release/*.ps1` | Windows executables and installers |

Persistent user data is resolved by `backend/app/config.py` to
`%LOCALAPPDATA%\KirokuNote` in packaged mode. Development uses project-local
backend data unless overridden. Bundled runtime resources include
`backend/app/data/grammar_reference.sqlite`, `backend/app/data/openjlpt_grammar/`,
JLPT/KANJIVG notices, dictionary databases and extension assets.

## Structural findings

| Finding | Evidence | Risk | Safe recommendation |
| --- | --- | --- | --- |
| Route ownership is split unevenly | `backend/app/api/grammar.py` and `subtitle.py` are routers, while card, OCR, LLM, dictionary, Anki, media, JLPT and cloud routes remain in `backend/app/main.py` | `main.py` is a high-conflict integration point and route/business logic boundaries are harder to discover | Extract one domain router at a time, retaining imports, response models, prefixes, lifecycle dependencies and compatibility aliases |
| Configuration and lifecycle are shared but implicit | `backend/app/config.py`, `main.py` and `run_backend.py` jointly resolve ports and data paths | A move can break packaged resource lookup or legacy database discovery | Keep `config.py` as the compatibility boundary and add characterization tests before any extraction |
| OCR is correctly isolated | `ocr_server/server.py`, `ocr_service.py`, `ocr_process_manager.py`, separate specs/installers | Merging OCR would increase startup cost and failure coupling | Do not merge; only clarify ownership and test the existing process contract |
| Cloud queue is imported dynamically by the local backend | `_setup_cloud_queue_path()` and cloud imports in `main.py` | Packaging/import changes can silently disable cloud polling | Treat `kiroku_cloud_queue/` as a deployable boundary and add an explicit integration smoke check before changing it |
| Historical design path is stale | `AGENTS.md` previously named root `DESIGN.md`, but tracked design material is `docs/archive/DESIGN.md` | Agents could follow a non-existent or historical specification | The navigation map now labels the archived document as historical; create an active design spec only as a separate decision |
| Generated and user-like databases coexist with source | Root `kiroku.db`, `temp_bench.db`, `kiroku_dict.sqlite`, build outputs and checked-in grammar data are present | Deleting by filename could lose required fixtures or runtime data | Do not delete; classify each path using git tracking, imports, packaging manifests and tests |
| Desktop window is not implemented | Existing product/runtime paths are tray plus extension; no desktop shell manifest or source exists | A premature framework addition would create a second UI/runtime boundary | Compare frameworks first and implement only after an approved architecture decision |

The cleanup intentionally removes the obsolete tray/OCR convenience launchers
and root verification script. Runtime OCR and backend entry points remain
available through their modules and packaging contracts. Root user-like
databases are archived outside the repository source tree.

## Proposed and completed file mapping

The following cleanup moves and deletions were completed after the initial
read-only audit.

| Current path | Proposed path | Status | Reason and verification |
| --- | --- | --- | --- |
| `backend/app/main.py` route blocks | `backend/app/api/<domain>.py` | Future staged refactor | Extract one router at a time; preserve route paths and run backend API tests after each batch |
| `backend/app/services/*` | Keep current service boundary initially | Retained | Services already provide domain seams; broad package moves would add import/resource risk |
| `ocr_server/` and OCR packaging files | Keep separate | Retained | Isolation, lazy loading and optional installation are intentional and tested |
| `kiroku_cloud_queue/` | Keep separate deployable component | Retained | Own requirements, deployment files, databases and tests |
| `docs/archive/DESIGN.md` | Keep archived | Retained | History is not evidence that it is the active product specification |
| Root grammar audit reports | `docs/archive/grammar-audits/` | Completed | Historical reports retained without cluttering the root |
| Root manual browser checks | `tools/manual_tests/` | Completed | Scripts retained as explicitly invoked manual checks |
| `run_tray.py`, `run_ocr.py`, `test_plan_verification.py` | Removed | Completed | Explicitly requested obsolete entrypoints/check |
| `AGENTS.md` | Root navigation map | Completed | Replaced stale high-level guidance with verified ownership, entry points and maintenance rules |
| `docs/REPOSITORY_AUDIT_2026-10-29.md` | Audit record | Completed | Records inventory, findings, desktop decision and verification limits |

## Desktop architecture decision

The desktop shell is not being implemented in this phase.

| Criterion | Electron | Tauri 2 |
| --- | --- | --- |
| UI reuse | Excellent Chromium/HTML reuse and straightforward extension-style debugging | Excellent for the existing vanilla HTML/CSS/JS UI, but browser-extension APIs do not transfer directly |
| Windows integration | Mature windows, tray, protocol and updater ecosystem | Strong native window/tray integration with a smaller native shell |
| Size and memory | Higher: bundled Chromium runtime and Node process | Lower typical footprint; WebView2 is shared by Windows |
| Backend integration | Easy child-process management from Node, but adds a privileged Node surface | Requires Rust-side process management or a narrowly scoped sidecar command |
| Security | Must carefully constrain Node/WebContents IPC | Strong capability-based model, but requires deliberate command/capability design |
| Packaging and updates | Mature tooling, larger installer | Good Windows packaging; updater and sidecar coordination need explicit design |
| Maintenance | One JavaScript ecosystem, but Chromium/Node upgrades are substantial | Smaller runtime, but Rust is a new build/CI/tooling dependency |
| Accessibility/layout | Mature Chromium behavior | WebView2 provides the same modern web accessibility/layout foundation |

**Recommendation:** evaluate Tauri 2 as the preferred future shell, with
Electron as the fallback if sidecar management or browser-compatibility
requirements outweigh footprint and security benefits. Tauri fits the existing
vanilla web UI and Windows WebView2 environment without shipping another
Chromium runtime. This is a recommendation, not an implementation.

The future shell should:

1. Start or connect to one existing backend instance and use `/api/health` for
   readiness; it must not create a second SQLite authority.
2. Manage backend and OCR as separate optional processes with bounded startup,
   shutdown and port-collision handling.
3. Use narrowly scoped IPC for lifecycle/status operations; never expose
   arbitrary filesystem access, secrets, or unrestricted process execution.
4. Preserve extension access to the same localhost backend and avoid shutting
   down a shared backend when only the desktop window closes.
5. Reuse existing API contracts and backend services rather than duplicating
   card, grammar, dictionary, OCR, LLM or sync logic.

Open decisions before implementation: whether the desktop shell owns backend
startup or attaches to an existing tray host, how single-instance signaling is
shared, whether the Side Panel UI is reused directly or adapted, and how
installer upgrades coordinate the shell, backend and optional OCR installer.

## Verification report

Baseline commands were run before documentation edits:

| Command | Result |
| --- | --- |
| `$env:PYTHONPATH='.;backend'; python -m pytest backend\tests -q` | Exit 0; 741 passed, 1 warning, 256 subtests |
| `node --test extension\tests\*.test.js` | Exit 0; 255 passed, 0 failed |

The warning is the existing FastAPI deprecation warning for
`HTTP_422_UNPROCESSABLE_ENTITY` in `test_jlpt_batch.py`. No packaging build,
live Anki/Yomitan smoke test, OCR model inference, browser-loaded extension
test, or cloud deployment test was run as part of this read-only audit.

## Final Git summary and remaining work

Completed:

- Updated `AGENTS.md` with a verified navigation map and safe maintenance rule.
- Added this audit report.
- Did not delete, move, stage, commit, or overwrite source, runtime data,
  generated artifacts, or the pre-existing grammar worktree changes.

Remaining:

- Route extraction, if desired, should be performed as small independent
  batches with API/packaging regression checks.
- Desktop framework selection needs owner approval before adding Tauri/Electron
  dependencies or source.
- Manual Windows smoke tests remain for tray startup, installer upgrade,
  extension loading, OCR optional installation, AnkiConnect, Yomitan and
  localhost lifecycle sharing.
- Potential duplicates/obsolete files remain intentionally unresolved because
  the audit found no deletion-safe evidence.
