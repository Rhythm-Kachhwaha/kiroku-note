"""
Standard-library-only ULID (Universally Unique Lexicographically Sortable Identifier) generator.
------------------------------------------------------------------------------------------------
Spec:
- 48-bit timestamp (milliseconds since Unix epoch) -> 10 Base32 characters
- 80-bit randomness -> 16 Base32 characters
- Total: 26 characters using Crockford's Base32 alphabet (0123456789ABCDEFGHJKMNPQRSTVWXYZ)
"""
from __future__ import annotations

import os
import re
import time

CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
ULID_REGEX = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def encode_crockford(val: int, length: int) -> str:
    """Encode an integer value into a Crockford Base32 string of exact length."""
    chars = []
    for _ in range(length):
        chars.append(CROCKFORD_BASE32[val & 31])
        val >>= 5
    return "".join(reversed(chars))


def generate_ulid(timestamp_ms: int | None = None) -> str:
    """
    Generate a 26-character standard ULID string.

    If timestamp_ms is not provided, current UTC millisecond timestamp is used.
    """
    if timestamp_ms is None:
        timestamp_ms = int(time.time() * 1000)

    # 48-bit timestamp (max 2^48 - 1)
    time_part = timestamp_ms & 0xFFFFFFFFFFFF
    time_str = encode_crockford(time_part, 10)

    # 80-bit randomness (10 bytes)
    rand_bytes = os.urandom(10)
    rand_val = int.from_bytes(rand_bytes, byteorder="big")
    rand_str = encode_crockford(rand_val, 16)

    return time_str + rand_str


def is_valid_ulid(ulid_str: str) -> bool:
    """Validate whether a string is a well-formed 26-char Crockford Base32 ULID."""
    if not isinstance(ulid_str, str) or len(ulid_str) != 26:
        return False
    return bool(ULID_REGEX.match(ulid_str.upper()))

