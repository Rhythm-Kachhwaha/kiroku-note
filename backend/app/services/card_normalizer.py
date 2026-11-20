"""Centralized normalization for Japanese card duplicate identity."""
from __future__ import annotations

import re
import unicodedata

DEFAULT_DECK_NAME = "Default"


def normalize_expression(expression: str) -> str:
    """Normalize Japanese expression for duplicate identity comparisons."""
    if not expression:
        return ""
    # Unicode NFC normalization unifies composite characters (e.g. kana with combining dakuten)
    normalized = unicodedata.normalize("NFC", expression)
    # Collapse full-width (\u3000) and standard ASCII whitespace
    normalized = re.sub(r"[\s\u3000]+", " ", normalized).strip()
    return normalized


def normalize_reading(reading: str) -> str:
    """Normalize Japanese reading (kana) for duplicate identity comparisons."""
    if not reading:
        return ""
    normalized = unicodedata.normalize("NFC", reading)
    normalized = re.sub(r"[\s\u3000]+", " ", normalized).strip()
    return normalized


def normalize_deck(deck_name: str | None) -> str:
    """Normalize deck name for duplicate identity comparisons."""
    if not deck_name:
        return DEFAULT_DECK_NAME
    cleaned = deck_name.strip()
    return cleaned if cleaned else DEFAULT_DECK_NAME


def is_same_deck(deck_a: str | None, deck_b: str | None) -> bool:
    """
    Check if two deck names refer to the same intended deck identity.
    Handles case-insensitivity, whitespace, and hierarchical parent/child names
    (e.g. 'Japanese::JLPT advaned' and 'JLPT advaned').
    """
    norm_a = normalize_deck(deck_a)
    norm_b = normalize_deck(deck_b)

    if norm_a.lower() == norm_b.lower():
        return True

    # Handle Default matching
    if norm_a.lower() == "default" and norm_b.lower() == "default":
        return True

    # Check leaf component matching (e.g. 'Japanese::JLPT advaned' vs 'JLPT advaned')
    leaf_a = norm_a.split("::")[-1].strip().lower()
    leaf_b = norm_b.split("::")[-1].strip().lower()
    if leaf_a == leaf_b and leaf_a and leaf_a != "default":
        return True

    # Check suffix/prefix hierarchy
    lower_a = norm_a.lower()
    lower_b = norm_b.lower()
    if lower_a.endswith("::" + lower_b) or lower_b.endswith("::" + lower_a):
        return True

    return False


def match_deck_in_list(target_deck: str, available_decks: list[str]) -> str | None:
    """
    Find a matching deck in available_decks preserving existing hierarchy and casing.
    Returns the matching deck name if found, else None.
    """
    if not target_deck or not available_decks:
        return None

    clean_target = target_deck.strip()
    target_lower = clean_target.lower()
    target_leaf = clean_target.split("::")[-1].strip().lower()

    # 1. Exact match
    for d in available_decks:
        if d == clean_target:
            return d

    # 2. Case-insensitive exact match
    for d in available_decks:
        if d.lower() == target_lower:
            return d

    # 3. Hierarchical suffix match (e.g. 'Japanese::JLPT advaned' for 'JLPT advaned')
    for d in available_decks:
        d_clean = d.strip()
        d_lower = d_clean.lower()
        if d_lower.endswith("::" + target_lower) or target_lower.endswith("::" + d_lower):
            return d_clean

    # 4. Leaf match
    for d in available_decks:
        d_clean = d.strip()
        d_leaf = d_clean.split("::")[-1].strip().lower()
        if d_leaf == target_leaf and d_leaf != "default":
            return d_clean

    return None


def get_duplicate_identity(expression: str, reading: str, deck_name: str | None = None) -> tuple[str, str, str]:
    """Return the locked duplicate identity tuple: (normalized_expression, normalized_reading, normalized_deck)."""
    return (
        normalize_expression(expression),
        normalize_reading(reading),
        normalize_deck(deck_name),
    )
