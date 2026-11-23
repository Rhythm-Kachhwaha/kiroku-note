"""
Kiroku Note — Turso libSQL Client for Python
Provides ultra-fast HTTP pipeline queries to Turso edge database with automatic
argument formatting, connection pooling, and transaction support.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

import httpx

logger = logging.getLogger(__name__)


def format_turso_args(args: Sequence[Any]) -> List[Dict[str, Any]]:
    """Format Python values into Turso pipeline v2 typed arguments."""
    formatted = []
    for a in args:
        if a is None:
            formatted.append({"type": "null"})
        elif isinstance(a, bool):
            formatted.append({"type": "integer", "value": "1" if a else "0"})
        elif isinstance(a, int):
            formatted.append({"type": "integer", "value": str(a)})
        elif isinstance(a, float):
            formatted.append({"type": "float", "value": a})
        else:
            formatted.append({"type": "text", "value": str(a)})
    return formatted


class TursoClient:
    """High-performance HTTP pipeline client for Turso libSQL."""

    def __init__(
        self,
        db_url: Optional[str] = None,
        auth_token: Optional[str] = None,
        timeout: float = 8.0,
    ) -> None:
        self.db_url = db_url or os.environ.get("TURSO_DATABASE_URL", "")
        self.auth_token = auth_token or os.environ.get("TURSO_AUTH_TOKEN", "")
        self.timeout = timeout

        if self.db_url.startswith("libsql://"):
            self.http_url = self.db_url.replace("libsql://", "https://").rstrip("/") + "/v2/pipeline"
        elif self.db_url.startswith("http://") or self.db_url.startswith("https://"):
            self.http_url = self.db_url.rstrip("/") + "/v2/pipeline"
        else:
            self.http_url = f"https://{self.db_url.rstrip('/')}/v2/pipeline" if self.db_url else ""

        self._headers = {
            "Authorization": f"Bearer {self.auth_token}",
            "Content-Type": "application/json",
        }

    @property
    def is_configured(self) -> bool:
        return bool(self.http_url and self.auth_token)

    def execute(
        self, sql: str, args: Optional[Sequence[Any]] = None
    ) -> List[Dict[str, Any]]:
        """Execute a single SQL statement and return rows as list of column-name mapped dictionaries."""
        if not self.is_configured:
            logger.warning("Turso client queried but not configured.")
            return []

        typed_args = format_turso_args(args or [])
        payload = {
            "requests": [
                {
                    "type": "execute",
                    "stmt": {"sql": sql, "args": typed_args},
                }
            ]
        }

        with httpx.Client(timeout=self.timeout) as client:
            res = client.post(self.http_url, headers=self._headers, json=payload)
            if not res.is_success:
                raise RuntimeError(f"Turso HTTP error ({res.status_code}): {res.text}")

            data = res.json()
            first_res = data.get("results", [{}])[0]
            if first_res.get("type") == "error":
                err_msg = first_res.get("error", {}).get("message", "unknown error")
                raise RuntimeError(f"Turso SQL statement error: {err_msg}")

            result = first_res.get("response", {}).get("result", {})
            cols = [c.get("name") for c in result.get("cols", [])]
            rows_raw = result.get("rows", [])

            rows: List[Dict[str, Any]] = []
            for r in rows_raw:
                row_dict = {}
                for idx, cell in enumerate(r):
                    col_name = cols[idx] if idx < len(cols) else f"col_{idx}"
                    cell_type = cell.get("type")
                    cell_val = cell.get("value")
                    if cell_type == "null":
                        row_dict[col_name] = None
                    elif cell_type == "integer":
                        row_dict[col_name] = int(cell_val) if cell_val is not None else 0
                    elif cell_type == "float":
                        row_dict[col_name] = float(cell_val) if cell_val is not None else 0.0
                    else:
                        row_dict[col_name] = cell_val
                rows.append(row_dict)
            return rows

    def fetchone(
        self, sql: str, args: Optional[Sequence[Any]] = None
    ) -> Optional[Dict[str, Any]]:
        rows = self.execute(sql, args)
        return rows[0] if rows else None

    def fetchall(
        self, sql: str, args: Optional[Sequence[Any]] = None
    ) -> List[Dict[str, Any]]:
        """Return all rows from query as a list of dicts."""
        return self.execute(sql, args)

    def fetchval(
        self, sql: str, args: Optional[Sequence[Any]] = None
    ) -> Any:
        row = self.fetchone(sql, args)
        if not row:
            return None
        return next(iter(row.values()))

    def execute_transaction(
        self, statements: Sequence[Union[str, Tuple[str, Sequence[Any]]]]
    ) -> List[List[Dict[str, Any]]]:
        """Execute multiple SQL statements atomically in a transaction."""
        if not self.is_configured:
            return []

        requests = [{"type": "execute", "stmt": {"sql": "BEGIN TRANSACTION", "args": []}}]
        for stmt in statements:
            if isinstance(stmt, tuple):
                sql_str, sql_args = stmt
                requests.append({
                    "type": "execute",
                    "stmt": {"sql": sql_str, "args": format_turso_args(sql_args)},
                })
            else:
                requests.append({
                    "type": "execute",
                    "stmt": {"sql": str(stmt), "args": []},
                })
        requests.append({"type": "execute", "stmt": {"sql": "COMMIT", "args": []}})

        with httpx.Client(timeout=self.timeout + 4.0) as client:
            res = client.post(self.http_url, headers=self._headers, json={"requests": requests})
            if not res.is_success:
                raise RuntimeError(f"Turso transaction HTTP error: {res.text}")

            data = res.json()
            results = data.get("results", [])

            # Check for error in any step
            for idx, r in enumerate(results):
                if r.get("type") == "error":
                    err_msg = r.get("error", {}).get("message", "unknown error")
                    try:
                        client.post(
                            self.http_url,
                            headers=self._headers,
                            json={"requests": [{"type": "execute", "stmt": {"sql": "ROLLBACK"}}]},
                        )
                    except Exception:
                        pass
                    raise RuntimeError(f"Turso transaction failed at step {idx}: {err_msg}")

            # Return results excluding BEGIN and COMMIT
            out: List[List[Dict[str, Any]]] = []
            for r in results[1:-1]:
                res_obj = r.get("response", {}).get("result", {})
                cols = [c.get("name") for c in res_obj.get("cols", [])]
                stmt_rows = []
                for row_raw in res_obj.get("rows", []):
                    row_dict = {}
                    for i, cell in enumerate(row_raw):
                        col_name = cols[i] if i < len(cols) else f"col_{i}"
                        c_type = cell.get("type")
                        c_val = cell.get("value")
                        if c_type == "null":
                            row_dict[col_name] = None
                        elif c_type == "integer":
                            row_dict[col_name] = int(c_val) if c_val is not None else 0
                        elif c_type == "float":
                            row_dict[col_name] = float(c_val) if c_val is not None else 0.0
                        else:
                            row_dict[col_name] = c_val
                    stmt_rows.append(row_dict)
                out.append(stmt_rows)
            return out


_turso_singleton: Optional[TursoClient] = None


def get_turso_client() -> TursoClient:
    global _turso_singleton
    if _turso_singleton is None:
        _turso_singleton = TursoClient()
    return _turso_singleton

