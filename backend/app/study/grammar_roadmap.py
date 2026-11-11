"""Roadmap service organizing grammar into Genki/Tae Kim Chapter Flows and Conceptual Hubs.

Also provides Point Mastery Card details with big picture banners, formation rules,
nuance contrasts, and encounters with mined anime/cards context.
"""
from __future__ import annotations

from typing import Any

from app.db.connection import db_session
from app.services.grammar_reference import GrammarReferenceService
from app.services.grammar_tracker import GrammarTrackerService
from app.services.grammar_mastery import compute_pipeline_status


# Progression Chapters (Genki / Tae Kim style)
ROADMAP_CHAPTERS: list[dict[str, Any]] = [
    {
        "chapter_id": "ch1_foundations",
        "title": "Stage 1: Foundations & Identities",
        "subtitle": "State-of-being, core particles, questions, and polite copula",
        "level_bracket": "N5",
        "order": 1,
        "pattern_keys": ["だ / です", "は", "が", "を", "も", "か", "の"],
    },
    {
        "chapter_id": "ch2_daily_descriptions",
        "title": "Stage 2: Daily Descriptions & Adjectives",
        "subtitle": "Actions in time and space, I/Na-adjectives, negative & past forms",
        "level_bracket": "N5",
        "order": 2,
        "pattern_keys": ["に", "で", "へ", "と", "から", "まで", "ない", "た", "たい", "たくない"],
    },
    {
        "chapter_id": "ch3_desires_connections",
        "title": "Stage 3: Desires & Connections",
        "subtitle": "Te-form linking, ongoing states, giving/receiving favors, reasons",
        "level_bracket": "N5-N4",
        "order": 3,
        "pattern_keys": ["て", "ている", "てある", "てみる", "あげる", "くれる", "もらう", "から / ので", "たり〜たり"],
    },
    {
        "chapter_id": "ch4_potential_modality",
        "title": "Stage 4: Potential & Modality",
        "subtitle": "Obligations, permissions, potential ability, passive & causative voice",
        "level_bracket": "N4",
        "order": 4,
        "pattern_keys": [
            "受身",
            "使役",
            "使役受身",
            "なければならない",
            "てもいい",
            "てはいけない",
            "ことができる",
            "わけにはいかない",
        ],
    },
    {
        "chapter_id": "ch5_nuance_conjecture",
        "title": "Stage 5: Nuance & Conjecture",
        "subtitle": "Direct appearance vs hearsay, conditionals, subtle expressions",
        "level_bracket": "N4-N3",
        "order": 5,
        "pattern_keys": [
            "そうだ(appearance)",
            "そうだ(hearsay)",
            "らしい",
            "ようだ",
            "たら",
            "ば",
            "なら",
            "のに",
            "てくる",
            "ていく",
        ],
    },
]

# Conceptual Hubs clustering related functional patterns across JLPT levels
CONCEPTUAL_HUBS: list[dict[str, Any]] = [
    {
        "hub_id": "hub_particles",
        "title": "Core Particles & Role Markers",
        "description": "Topic, subject, object, venue, destination, and relational anchors.",
        "icon": "particle",
        "pattern_keys": ["は", "が", "を", "に", "で", "へ", "と", "も", "から", "まで", "より", "すら", "だけ", "しか〜ない"],
    },
    {
        "hub_id": "hub_conjugations",
        "title": "Verbal Inflections & Stems",
        "description": "Te-form chains, past, negative, volitional, and stem connectors.",
        "icon": "conjugation",
        "pattern_keys": ["て", "た", "ない", "ず", "ずに", "ながら", "たり〜たり"],
    },
    {
        "hub_id": "hub_giving_receiving",
        "title": "Giving & Receiving Benefactives",
        "description": "Action vectors and favor exchanges (あげる, くれる, もらう, てやる, ていただく).",
        "icon": "favor",
        "pattern_keys": ["あげる", "くれる", "もらう", "てあげる", "てくれる", "てもらう"],
    },
    {
        "hub_id": "hub_conjectures",
        "title": "Conjectures, Evidentials & Hearsay",
        "description": "Subjective appearance, rumors, deduction, and certainty judgements.",
        "icon": "conjecture",
        "pattern_keys": ["そうだ(appearance)", "そうだ(hearsay)", "らしい", "ようだ", "みたい", "に違いない", "に決まっている", "はず"],
    },
    {
        "hub_id": "hub_conditionals",
        "title": "Conditionals & Temporal Transitions",
        "description": "Hypothetical, temporal, inevitable, and contextual 'if/when' clauses.",
        "icon": "conditional",
        "pattern_keys": ["たら", "ば", "と", "なら", "たら最後 / が最後", "ともなると / ともなれば"],
    },
    {
        "hub_id": "hub_causative_passive",
        "title": "Voice: Passive, Causative & Causative-Passive",
        "description": "Transitivity, agency shifts, victim passive, and enforced actions.",
        "icon": "voice",
        "pattern_keys": ["受身", "使役", "使役受身"],
    },
]


class GrammarRoadmapService:
    """Provides Chapter Flow, Conceptual Hubs, and Point Mastery Card services."""

    def __init__(
        self,
        reference_service: GrammarReferenceService | None = None,
        tracker_service: GrammarTrackerService | None = None,
    ):
        self.ref = reference_service or GrammarReferenceService()
        self.tracker = tracker_service or GrammarTrackerService()

    def _enrich_point_dual_track(self, pattern_key: str) -> dict[str, Any]:
        """Fetch reference metadata and overlay dual-track badges for a point."""
        ref_pt = self.ref.get_point_by_key(pattern_key)
        stat = self.tracker.get_dual_track_status(pattern_key)

        seen_count = stat["exposure"]["seen_count"] if stat else 0
        mastery_score = stat["mastery"]["mastery_score"] if stat else 0.0
        drill_count = stat["mastery"]["drill_count"] if stat else 0
        pipeline_status = stat["pipeline_status"] if stat else "unseen"

        return {
            "pattern_key": pattern_key,
            "display": ref_pt.get("pattern_display", pattern_key) if ref_pt else pattern_key,
            "level": ref_pt.get("level", "N5") if ref_pt else "N5",
            "meaning_short": ref_pt.get("meaning_short", "") if ref_pt else "",
            "seen_count": seen_count,
            "mastery_score": mastery_score,
            "drill_count": drill_count,
            "pipeline_status": pipeline_status,
            "encountered_badge": seen_count > 0,
            "mastery_pct": int(round(mastery_score)),
        }

    def get_roadmap_flow(self) -> dict[str, Any]:
        """Get Chapter Flow (Genki / Tae Kim progression) with dual-track badges."""
        chapters = []
        for ch in ROADMAP_CHAPTERS:
            pts = [self._enrich_point_dual_track(key) for key in ch["pattern_keys"]]
            total_pts = len(pts)
            encountered_count = sum(1 for p in pts if p["seen_count"] > 0)
            mastered_count = sum(1 for p in pts if p["pipeline_status"] == "mastered")
            avg_mastery = round(sum(p["mastery_score"] for p in pts) / total_pts, 1) if total_pts > 0 else 0.0

            chapters.append({
                "chapter_id": ch["chapter_id"],
                "title": ch["title"],
                "subtitle": ch["subtitle"],
                "level_bracket": ch["level_bracket"],
                "order": ch["order"],
                "stats": {
                    "total_points": total_pts,
                    "encountered_points": encountered_count,
                    "mastered_points": mastered_count,
                    "average_mastery": avg_mastery,
                },
                "points": pts,
            })

        return {"chapters": chapters}

    def get_conceptual_hubs(self) -> dict[str, Any]:
        """Get Conceptual Hubs grouping related functional patterns."""
        hubs = []
        for hb in CONCEPTUAL_HUBS:
            pts = [self._enrich_point_dual_track(key) for key in hb["pattern_keys"]]
            total_pts = len(pts)
            encountered_count = sum(1 for p in pts if p["seen_count"] > 0)
            mastered_count = sum(1 for p in pts if p["pipeline_status"] == "mastered")
            avg_mastery = round(sum(p["mastery_score"] for p in pts) / total_pts, 1) if total_pts > 0 else 0.0

            hubs.append({
                "hub_id": hb["hub_id"],
                "title": hb["title"],
                "description": hb["description"],
                "icon": hb["icon"],
                "stats": {
                    "total_points": total_pts,
                    "encountered_points": encountered_count,
                    "mastered_points": mastered_count,
                    "average_mastery": avg_mastery,
                },
                "points": pts,
            })

        return {"hubs": hubs}

    def get_point_mastery_card(self, pattern_key: str) -> dict[str, Any] | None:
        """Fetch Point Mastery Card: big picture banner, formation, nuance contrasts, mined anime/cards context."""
        ref_pt = self.ref.get_point_by_key(pattern_key)
        if not ref_pt:
            return None

        concept_id = ref_pt.get("concept_id") or ""
        enrichment = self.ref.get_enrichment(concept_id) or {}

        # Big picture banner concept
        big_picture = enrichment.get("big_picture_concept")
        if not big_picture:
            big_picture = ref_pt.get("english_breakdown") or ref_pt.get("meaning_short") or ""

        # Formation rules block
        formation_rules = enrichment.get("formation_rules")
        if not formation_rules:
            raw_formation = ref_pt.get("formation") or ""
            formation_rules = [{"structure": raw_formation, "description": "Standard formation rule", "example": None}] if raw_formation else []

        # Nuance contrasts
        nuance_contrasts = enrichment.get("nuance_contrasts") or []
        common_pitfalls = enrichment.get("common_pitfalls") or []

        # Dual track stats & encounters from tracker
        dual_track = self.tracker.get_dual_track_status(pattern_key)
        seen_count = dual_track["exposure"]["seen_count"] if dual_track else 0
        mastery_score = dual_track["mastery"]["mastery_score"] if dual_track else 0.0
        drill_count = dual_track["mastery"]["drill_count"] if dual_track else 0
        pipeline_status = dual_track["pipeline_status"] if dual_track else "unseen"
        user_encounters = dual_track["exposure"]["encounters"] if dual_track else []

        # Mined anime context & cards linking
        # Search cards table for example sentences matching this grammar pattern
        mined_cards_encounters = []
        raw_key = pattern_key.split("(")[0].strip()
        raw_key = raw_key.replace("〜", "").replace("~", "").strip()

        with db_session(self.tracker.db_path) as conn:
            if raw_key:
                c_rows = conn.execute(
                    """SELECT id, expression, example_sentence, example_translation, image, audio, source_type, source_url
                       FROM cards
                       WHERE example_sentence LIKE ?
                       ORDER BY id DESC LIMIT 5""",
                    (f"%{raw_key}%",),
                ).fetchall()
                for cr in c_rows:
                    mined_cards_encounters.append({
                        "card_id": cr["id"],
                        "expression": cr["expression"],
                        "sentence": cr["example_sentence"],
                        "translation": cr["example_translation"],
                        "image_url": cr["image"],
                        "audio_url": cr["audio"],
                        "source": cr["source_type"] or "card",
                        "source_title": cr["source_url"] or "",
                    })

        # Combine user tracker encounters and mined cards
        return {
            "pattern_key": pattern_key,
            "display": ref_pt.get("pattern_display") or pattern_key,
            "level": ref_pt.get("level", "N5"),
            "meaning_short": ref_pt.get("meaning_short", ""),
            "big_picture_banner": big_picture,
            "formation_rules": formation_rules,
            "nuance_contrasts": nuance_contrasts,
            "common_pitfalls": common_pitfalls,
            "reference_examples": ref_pt.get("examples") or [],
            "status_badges": {
                "seen_count": seen_count,
                "mastery_score": mastery_score,
                "drill_count": drill_count,
                "pipeline_status": pipeline_status,
                "encountered_badge": seen_count > 0,
                "mastery_pct": int(round(mastery_score)),
            },
            "encounters": {
                "tracker_encounters": user_encounters,
                "mined_cards": mined_cards_encounters,
            },
        }
