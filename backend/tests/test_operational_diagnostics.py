"""Focused regression tests for recoverable-operation diagnostics."""
from __future__ import annotations

import logging

from app.services.operational_diagnostics import (
    get_operational_failure_counts,
    record_operational_failure,
    reset_operational_failure_counts,
)


def setup_function() -> None:
    reset_operational_failure_counts()


def teardown_function() -> None:
    reset_operational_failure_counts()


def test_failure_counter_logs_only_operation_and_error_type(caplog) -> None:
    secret = "should-not-appear-in-output"

    with caplog.at_level(logging.WARNING):
        record_operational_failure("health.database", RuntimeError(secret))

    assert get_operational_failure_counts() == {"health.database": 1}
    assert "operation=health.database" in caplog.text
    assert "error_type=RuntimeError" in caplog.text
    assert secret not in caplog.text


def test_failure_counter_accumulates_by_operation() -> None:
    record_operational_failure("config.llm_secret_read", OSError("not readable"))
    record_operational_failure("config.llm_secret_read", OSError("not readable"))
    record_operational_failure("health.anki", ConnectionError("offline"))

    assert get_operational_failure_counts() == {
        "config.llm_secret_read": 2,
        "health.anki": 1,
    }
