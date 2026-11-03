# Ignore policy

Read this once after `AGENTS.md`. Do not read, modify, or use these unless the
task explicitly names them.

- Generated or local state: `__pycache__/`, `*.pyc`, `.pytest_cache/`,
  `.coverage`, `htmlcov/`, `dist/`, `build/`, `*.egg-info/`, logs, virtual
  environments, root `*.json` test output, and root throwaway `test_*.py`.
- Editor and OS state: `.vscode/`, `.idea/`, `*.swp`, `.DS_Store`, `Thumbs.db`.
- Historical or large material: `docs/archive/`, `grammar-audits/`,
  `desktop/src/ui/vendor/`, `desktop/src/ui/lib/`, `*.riv`, `*.wasm`, and
  screenshots.
- Secrets: `backend/data/.secrets.enc`; never read or commit it.
- Keep tests in their subsystem directories. Do not create root-level tests.
- Root scripts are not application code unless a task explicitly names them.
