"""Safe, process-local counters for recoverable operational failures."""
from __future__ import annotations

from collections import Counter
import logging
from threading import Lock


logger = logging.getLogger(__name__)
_counts: Counter[str] = Counter()
_lock = Lock()


def record_operational_failure(operation: str, error: BaseException, *, level: int = logging.WARNING) -> None:
    """Record a sanitized failure without logging request, card, or credential data."""
    with _lock:
        _counts[operation] += 1
    logger.log(level, "Recoverable operation failed: operation=%s error_type=%s", operation, type(error).__name__)


def get_operational_failure_counts() -> dict[str, int]:
    """Return a snapshot suitable for the read-only System Doctor response."""
    with _lock:
        return dict(sorted(_counts.items()))


def reset_operational_failure_counts() -> None:
    """Reset process-local counters, primarily for focused tests."""
    with _lock:
        _counts.clear()
