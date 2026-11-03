"""Runtime-only authorization for legacy (non-Study) local API mutations."""
from __future__ import annotations

import hashlib
import logging
import secrets
import time
from collections import Counter, defaultdict, deque
from dataclasses import dataclass

logger = logging.getLogger("kiroku.legacy_api_auth")
PAIRING_TTL_SECONDS = 300
PAIRING_ATTEMPTS_PER_WINDOW = 8
PAIRING_WINDOW_SECONDS = 300


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass
class _Pairing:
    code_hash: str
    expires_at: float


@dataclass
class _ExtensionToken:
    token_hash: str
    created_at: float
    scopes: frozenset[str]


class LegacyApiAuth:
    """Keeps pairing codes and extension tokens in process memory only."""

    def __init__(self) -> None:
        self._pairings: dict[str, _Pairing] = {}
        self._tokens: dict[str, _ExtensionToken] = {}
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self.missing_token_counts: Counter[str] = Counter()

    def create_pairing(self, code: str) -> int:
        self._prune()
        self._pairings[_digest(code)] = _Pairing(_digest(code), time.monotonic() + PAIRING_TTL_SECONDS)
        return PAIRING_TTL_SECONDS

    def redeem_pairing(self, code: str, origin: str) -> str | None:
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
        token = f"knx_{secrets.token_urlsafe(32)}"
        self._tokens[_digest(token)] = _ExtensionToken(_digest(token), now, frozenset({"legacy:write"}))
        return token

    def has_extension_token(self, token: str | None) -> bool:
        self._prune()
        return bool(token and _digest(token) in self._tokens)

    def revoke_extension_token(self, token: str) -> bool:
        return self._tokens.pop(_digest(token), None) is not None

    def revoke_all_extension_tokens(self) -> int:
        count = len(self._tokens)
        self._tokens.clear()
        return count

    def status(self) -> dict[str, object]:
        self._prune()
        return {"paired_extensions": len(self._tokens), "missing_token_counts": dict(self.missing_token_counts)}

    def _prune(self) -> None:
        now = time.monotonic()
        self._pairings = {key: value for key, value in self._pairings.items() if value.expires_at > now}


legacy_api_auth = LegacyApiAuth()
