"""Authorization and persistent token storage for legacy (non-Study) local API mutations."""
from __future__ import annotations

from collections import Counter, defaultdict, deque
from dataclasses import dataclass
import hashlib
import json
import logging
from pathlib import Path
import secrets
import time
from typing import Iterable

from app.db.connection import db_session

logger = logging.getLogger("kiroku.legacy_api_auth")
PAIRING_TTL_SECONDS = 300
PAIRING_ATTEMPTS_PER_WINDOW = 8
PAIRING_WINDOW_SECONDS = 300

VALID_SCOPES: frozenset[str] = frozenset({"legacy:write", "link:rw"})
DEFAULT_SCOPES: frozenset[str] = frozenset({"legacy:write"})


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalize_scopes(scopes: Iterable[str] | str | None) -> frozenset[str]:
    if scopes is None:
        return DEFAULT_SCOPES
    if isinstance(scopes, str):
        candidates = [s.strip() for s in scopes.replace(",", " ").split() if s.strip()]
    else:
        candidates = [str(s).strip() for s in scopes if str(s).strip()]
    valid = frozenset(s for s in candidates if s in VALID_SCOPES)
    return valid if valid else DEFAULT_SCOPES


def _parse_scopes(raw: str | None) -> frozenset[str]:
    if not raw:
        return DEFAULT_SCOPES
    text = raw.strip()
    if text.startswith("["):
        try:
            items = json.loads(text)
            if isinstance(items, list):
                return _normalize_scopes(items)
        except Exception:
            pass
    return _normalize_scopes(text)


class PairingToken(str):
    scopes: frozenset[str]
    label: str
    created_at: float

    def __new__(
        cls,
        value: str,
        scopes: frozenset[str] = DEFAULT_SCOPES,
        label: str = "",
        created_at: float = 0.0,
    ) -> PairingToken:
        obj = super().__new__(cls, value)
        obj.scopes = scopes
        obj.label = label
        obj.created_at = created_at
        return obj


@dataclass
class _Pairing:
    code_hash: str
    expires_at: float
    scopes: frozenset[str] = DEFAULT_SCOPES
    label: str = ""


@dataclass
class _ExtensionToken:
    token_hash: str
    created_at: float
    scopes: frozenset[str]
    label: str = ""


class LegacyApiAuth:
    """Manages pairing codes and persists extension tokens in SQLite."""

    def __init__(self, db_path: Path | str | None = None) -> None:
        self.db_path = db_path
        self._pairings: dict[str, _Pairing] = {}
        self._tokens: dict[str, _ExtensionToken] = {}
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self.missing_token_counts: Counter[str] = Counter()
        self._init_db()
        self._load_persisted_tokens()

    def _init_db(self) -> None:
        try:
            with db_session(self.db_path) as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS extension_token (
                        token_hash TEXT PRIMARY KEY,
                        created_at REAL NOT NULL,
                        label TEXT NOT NULL DEFAULT '',
                        scopes TEXT NOT NULL DEFAULT 'legacy:write'
                    );
                    """
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_extension_token_created ON extension_token(created_at);"
                )
                conn.commit()
        except Exception as exc:
            logger.warning("Failed to initialize extension_token table: %s", exc)

    def _load_persisted_tokens(self) -> None:
        try:
            with db_session(self.db_path) as conn:
                rows = conn.execute(
                    "SELECT token_hash, created_at, label, scopes FROM extension_token"
                ).fetchall()
                for row in rows:
                    scopes = _parse_scopes(row["scopes"])
                    self._tokens[row["token_hash"]] = _ExtensionToken(
                        token_hash=row["token_hash"],
                        created_at=float(row["created_at"]),
                        scopes=scopes,
                        label=row["label"] or "",
                    )
        except Exception as exc:
            logger.warning("Failed to load extension tokens from SQLite: %s", exc)

    def _persist_token(self, token: _ExtensionToken) -> None:
        try:
            with db_session(self.db_path) as conn:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO extension_token (token_hash, created_at, label, scopes)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        token.token_hash,
                        token.created_at,
                        token.label,
                        ",".join(sorted(token.scopes)),
                    ),
                )
                conn.commit()
        except Exception as exc:
            logger.warning("Failed to persist extension token: %s", exc)

    def create_pairing(
        self,
        code: str,
        scopes: Iterable[str] | str | None = None,
        label: str = "",
    ) -> int:
        self._prune()
        resolved_scopes = _normalize_scopes(scopes) if scopes is not None else DEFAULT_SCOPES
        self._pairings[_digest(code)] = _Pairing(
            code_hash=_digest(code),
            expires_at=time.monotonic() + PAIRING_TTL_SECONDS,
            scopes=resolved_scopes,
            label=label,
        )
        return PAIRING_TTL_SECONDS

    def redeem_pairing(
        self,
        code: str,
        origin: str,
        scopes: Iterable[str] | str | None = None,
        label: str = "",
    ) -> PairingToken | None:
        self._prune()
        attempts = self._attempts[origin]
        now = time.monotonic()
        while attempts and attempts[0] <= now - PAIRING_WINDOW_SECONDS:
            attempts.popleft()
        if len(attempts) >= PAIRING_ATTEMPTS_PER_WINDOW:
            raise PermissionError("Pairing attempts are temporarily rate limited.")
        attempts.append(now)
        pairing = self._pairings.pop(_digest(code), None)
        if not pairing or pairing.expires_at <= now:
            return None

        # Scopes requested during redeem take precedence; if not provided, use pairing scopes
        if scopes is not None:
            resolved_scopes = _normalize_scopes(scopes)
        else:
            resolved_scopes = pairing.scopes

        resolved_label = label if label else pairing.label
        token = f"knx_{secrets.token_urlsafe(32)}"
        token_hash = _digest(token)
        created_at = time.time()
        ext_token = _ExtensionToken(
            token_hash=token_hash,
            created_at=created_at,
            scopes=resolved_scopes,
            label=resolved_label,
        )
        self._tokens[token_hash] = ext_token
        self._persist_token(ext_token)
        return PairingToken(token, resolved_scopes, resolved_label, created_at)

    def has_extension_token(self, token: str | None, required_scope: str | None = None) -> bool:
        self._prune()
        if not token or not isinstance(token, str):
            return False
        digest = _digest(token)
        ext_token = self._tokens.get(digest)
        if ext_token is None:
            try:
                with db_session(self.db_path) as conn:
                    row = conn.execute(
                        "SELECT token_hash, created_at, label, scopes FROM extension_token WHERE token_hash = ?",
                        (digest,),
                    ).fetchone()
                    if row:
                        ext_token = _ExtensionToken(
                            token_hash=row["token_hash"],
                            created_at=float(row["created_at"]),
                            scopes=_parse_scopes(row["scopes"]),
                            label=row["label"] or "",
                        )
                        self._tokens[digest] = ext_token
            except Exception:
                pass

        if ext_token is None:
            return False
        if required_scope is not None and required_scope not in ext_token.scopes:
            return False
        return True

    def get_token_scopes(self, token: str | None) -> frozenset[str]:
        if not token or not isinstance(token, str):
            return frozenset()
        digest = _digest(token)
        if digest not in self._tokens:
            self.has_extension_token(token)
        ext_token = self._tokens.get(digest)
        return ext_token.scopes if ext_token else frozenset()

    def has_scope(self, token: str | None, scope: str) -> bool:
        return scope in self.get_token_scopes(token)

    def revoke_extension_token(self, token: str) -> bool:
        if not token or not isinstance(token, str):
            return False
        digest = _digest(token)
        removed_from_memory = self._tokens.pop(digest, None) is not None
        deleted_from_db = False
        try:
            with db_session(self.db_path) as conn:
                cursor = conn.execute("DELETE FROM extension_token WHERE token_hash = ?", (digest,))
                conn.commit()
                deleted_from_db = cursor.rowcount > 0
        except Exception as exc:
            logger.warning("Failed to delete extension token from SQLite: %s", exc)
        return removed_from_memory or deleted_from_db

    def revoke_all_extension_tokens(self) -> int:
        count = len(self._tokens)
        self._tokens.clear()
        try:
            with db_session(self.db_path) as conn:
                cursor = conn.execute("DELETE FROM extension_token")
                conn.commit()
                if cursor.rowcount > count:
                    count = cursor.rowcount
        except Exception as exc:
            logger.warning("Failed to clear extension tokens from SQLite: %s", exc)
        return count

    def status(self) -> dict[str, object]:
        self._prune()
        return {"paired_extensions": len(self._tokens), "missing_token_counts": dict(self.missing_token_counts)}

    def _prune(self) -> None:
        now = time.monotonic()
        self._pairings = {key: value for key, value in self._pairings.items() if value.expires_at > now}


legacy_api_auth = LegacyApiAuth()
