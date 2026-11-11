"""Script to mine, extract, and enrich grammar points from Tofugu into grammar_reference.sqlite.

Features:
- Deterministic mapping between Tofugu grammar slugs and Kiroku concept_ids.
- HTML cleaning and structured extraction:
  * Big picture concept mental model
  * Formation rules & structures
  * Common pitfalls & misconceptions
  * Nuance contrasts (e.g. A vs B comparisons)
- Upsert into `grammar_enrichment` table in `grammar_reference.sqlite`.
- Preserves pre-existing hand-curated seeds (core reference hubs) while enriching new entries.
"""
from __future__ import annotations

import json
import logging
import re
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

from app.services.grammar_reference import (
    CREATE_ENRICHMENT_TABLE_SQL,
    resolve_grammar_reference_db_path,
)
from app.study.acquisition.parsers.enrichment_seeds import CORE_ENRICHMENT_SEEDS
from app.study.acquisition.parsers.tofugu_parser import (
    CommonPitfall,
    FormationRule,
    GrammarEnrichment,
    NuanceContrast,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("mine_tofugu")

# Canonical mapping from Tofugu article slugs to Kiroku grammar_index concept_ids
SLUG_TO_CONCEPT_ID: dict[str, str] = {
    "adjective-suffix-sa": "c_n4_point_78",                  # さ
    "adjective-sou": "c_n4_souda_appearance",                # そうだ (appearance)
    "verb-command-form-ro": "c_n4_point_35",                 # え / ろ (command)
    "conjunctive-particle-node": "c_n5_point_10",            # ので
    "conjunctive-particle-noni": "c_n4_noni",                # のに
    "conjunctive-particle-ga-kedo": "c_n5_point_22",         # が / けど
    "honorific-prefix-o-go": "c_n5_o",                       # お / ご
    "particle-ka": "c_n5_point_15",                          # か
    "particle-kara": "c_n5_point_29",                        # から
    "particle-ga": "c_n5_point_22",                          # が
    "particle-de": "c_n5_point_26",                          # で
    "particle-to": "c_n5_point_9",                           # と
    "verb-to": "c_n5_point_9",                               # と (conditional)
    "particle-ni": "c_n5_point_24",                          # に
    "particle-ne": "c_n5_point_30",                          # ね
    "particle-no-nominalizer": "c_n5_point_28",              # の
    "particle-no-noun-modifier": "c_n5_point_28",            # の
    "particle-wa": "c_n5_point_21",                          # は
    "particle-he": "c_n5_point_25",                          # へ
    "particle-made": "c_n5_point_3",                         # まで
    "particle-mo": "c_n5_point_16",                          # も
    "particle-ya": "c_n5_point_27",                          # や
    "particle-yo": "c_n5_point_31",                          # よ
    "particle-yori-than": "c_n5_point_32",                   # より
    "particle-yori-from": "c_n5_point_32",                   # より
    "sentence-ending-particle-wa": "c_n1_wa",                 # わ
    "particle-wo": "c_n5_point_23",                          # を
    "transitivity": "c_n4_tadoushi_jidoushi",                # 他動詞 & 自動詞
    "verb-sou": "c_n4_souda_appearance",                     # そうだ (appearance)
    "kamoshirenai": "c_n4_point_49",                         # かもしれない
    "kotogaaru": "c_n4_point_65",                            # ことがある
    "verb-causative-form-saseru": "c_n4_shieki",             # 使役
    "shi": "c_n4_point_41",                                  # し
    "janai-dewanai": "c_n5_point_38",                        # ではない / じゃない
    "verb-past-ta-form": "c_n5_point_45",                    # た
    "tai-form": "c_n5_point_49",                             # たい
    "tagaru-form": "c_n4_point_47",                          # たがる
    "takotogaaru": "c_n5_point_59",                          # たことがある
    "conditional-form-tara": "c_n4_point_38",                # たら
    "tarisuru": "c_n5_tari_tari",                            # たり〜たり
    "tearu": "c_n5_point_4",                                 # てある
    "teiku-tekuru": "c_n4_point_17",                         # ていく
    "verb-past-continuous-form-teita": "c_n5_point_57",      # ている
    "verb-continuous-form-teiru": "c_n5_point_57",           # ている
    "teoku": "c_n4_point_20",                                # ておく
    "tehoshii": "c_n4_point_46",                             # てほしい
    "temiru": "c_n4_point_21",                               # てみる
    "temoii": "c_n5_point_54",                               # てもいい
    "toiu": "c_n5_point_82",                                 # という
    "toki": "c_n4_point_22",                                 # とき
    "na": "c_n5_point_8",                                    # な
    "verb-negative-nai-form": "c_n5_point_44",               # ない
    "verb-negative-past-nakatta-form": "c_n5_point_44",      # なかった
    "nagara": "c_n5_point",                                  # ながら
    "verb-nagara": "c_n5_point",                             # ながら
    "verb-imperative-form-nasai": "c_n4_point_36",           # なさい
    "nikui": "c_n4_point_58",                                # やすい / にくい
    "yasui": "c_n4_point_58",                                # やすい / にくい
    "verb-conditional-form-ba": "c_n4_point_37",             # ば
    "masu": "c_n5_point_40",                                 # ます
    "verb-volitional-form-you": "c_n4_ikou_kei_volitional_form", # 意向形
    "verb-passive-form-rareru": "c_n4_ukemi",                 # 受身
    "verb-potential-form-reru": "c_n4_point_31",             # える / られる
    "juu": "c_n4_point_26",                                  # 中
    "chuu": "c_n4_point_26",                                 # 中
    "amarinai": "c_n3_point_7",                              # あまり
    "i-adjective-past-form-katta": "c_n5_point_80",          # くない / かった / くなかった
    "i-adjective-garu": "c_n4_point_48",                     # がる
    "i-adjective-negative-form-kunai": "c_n5_point_80",       # くない / かった / くなかった
    "i-adjective-conditional-form-kereba": "c_n4_point_37",  # ば
    "i-adjective": "c_n5_i_adjectives",                      # い-adjectives
    "iru-aru": "c_n5_point_65",                              # がある / がいる
    "uchi": "c_n3_point_48",                                 # うちに
    "kudasai": "c_n5_point_52",                              # てください
    "kurai": "c_n5_point_2",                                 # くらい / ぐらい
    "kureru-ageru-morau": "c_n4_point_12",                   # あげる / くれる / もらう
    "koto": "c_n4_point_3",                                  # こと
    "kono-sono-ano-dono": "c_n5_point_78",                   # この / その / あの / どの
    "kore-sore-are-dore": "c_n5_point_77",                   # これ / それ / あれ / どれ
    "koko-soko-asoko-doko": "c_n5_point_79",                 # ここ / そこ / あそこ / どこ
    "konna-sonna-anna-donna": "c_n5_donna",                  # どんな
    "sasuga": "c_n4_sasuga",                                 # さすが
    "sugiru": "c_n5_point_5",                                # すぎる
    "da": "c_n5_point_37",                                   # だ
    "dake": "c_n5_point_73",                                 # だけ
    "datta": "c_n5_point_37",                                # だ / だった
    "darou": "c_n5_point_13",                                # だろう
    "tsumori": "c_n5_point_7",                               # つもり
    "te-form": "c_n5_point_11",                              # て
    "deshita": "c_n5_point_39",                              # でした
    "deshou": "c_n5_point_66",                               # でしょう
    "desu": "c_n5_point_36",                                 # です
    "na-adjective": "c_n5_na_adjectives",                    # な-adjectives
    "conditional-form-nara": "c_n4_point_39",                # なら
    "naru": "c_n5_naru",                                     # なる
    "mada": "c_n5_mada",                                     # まだ
    "mou-little-more": "c_n5_mou",                           # もう
    "mou-already-not-anymore": "c_n5_mou",                   # もう
    "explanatory-nda-ndesu-noda-nodesu": "c_n5_point_14",    # んです / のです
    "naka": "c_n4_no_naka_de",                               # の中で
    "mae-ushiro": "c_n5_point_60",                           # 前に
    "iku-kuru": "c_n5_point_62",                             # に行く
}

SEED_CONCEPT_IDS = {seed["concept_id"] for seed in CORE_ENRICHMENT_SEEDS}


def fetch_tofugu_html(slug: str, cache_dir: Path) -> str | None:
    """Fetch article HTML from Tofugu or return from local cache."""
    cache_file = cache_dir / f"{slug}.html"
    if cache_file.exists():
        return cache_file.read_text(encoding="utf-8")

    url = f"https://www.tofugu.com/japanese-grammar/{slug}/"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read().decode("utf-8", errors="ignore")
            cache_file.write_text(content, encoding="utf-8")
            return content
    except Exception as exc:
        logger.warning("Failed to fetch %s: %s", url, exc)
        return None


def extract_enrichment_from_html(
    html: str,
    concept_id: str,
    slug: str,
) -> GrammarEnrichment | None:
    """Extract structured conceptual fields from Tofugu HTML."""
    soup = BeautifulSoup(html, "html.parser")

    # Clean TOC & extraneous tags
    for toc in soup.find_all(["div", "ul", "nav"], class_=lambda c: c and "toc" in c):
        toc.decompose()
    for h in soup.find_all(["h2", "h3"]):
        if "table of contents" in h.get_text().lower():
            nxt = h.find_next_sibling()
            if nxt and nxt.name == "ul":
                nxt.decompose()
            h.decompose()

    main = soup.find("article")
    if main and main.find("div", class_="main"):
        main = main.find("div", class_="main")
    if not main:
        return None

    # 1. Big picture concept
    big_picture = ""
    basics = main.find(
        lambda tag: tag.name in ["h2", "h3"]
        and any(k in tag.get_text().lower() for k in ["basics", "what is", "overview", "introduction"])
    )
    if basics:
        paras = []
        curr = basics.find_next_sibling()
        while curr and curr.name not in ["h2", "h3"]:
            if curr.name == "p":
                t = curr.get_text().strip()
                if t:
                    paras.append(t)
            curr = curr.find_next_sibling()
        if paras:
            big_picture = " ".join(paras[:2])
    if not big_picture:
        for p in main.find_all("p"):
            t = p.get_text().strip()
            if len(t) > 30 and not t.startswith("Table of"):
                big_picture = t
                break

    # 2. Formations
    formations: list[FormationRule] = []
    seen_f: set[str] = set()
    for h in main.find_all(["h2", "h3", "h4"]):
        htext = h.get_text().strip()
        if (
            any(k in htext for k in ["+", "〜", "Conjugat", "Form", "Patterns of Use"])
            and "table of contents" not in htext.lower()
        ):
            if htext in seen_f:
                continue
            seen_f.add(htext)
            nxt = h.find_next_sibling()
            desc = nxt.get_text().strip() if nxt and nxt.name == "p" else ""
            formations.append(FormationRule(structure=htext, description=desc[:250]))

    for li in main.find_all("li"):
        litext = " ".join(li.get_text().split())
        if ("+" in litext or "→" in litext) and len(litext) < 120:
            if litext not in seen_f:
                seen_f.add(litext)
                formations.append(FormationRule(structure=litext))

    # 3. Contrasts
    contrasts: list[NuanceContrast] = []
    seen_c: set[str] = set()
    for h in main.find_all(["h2", "h3", "h4"]):
        htext = h.get_text().strip()
        if any(k in htext.lower() for k in ["difference between", " vs ", " vs. ", "versus", "compared to"]):
            if htext in seen_c:
                continue
            seen_c.add(htext)
            nxt = h.find_next_sibling()
            desc = nxt.get_text().strip() if nxt and nxt.name == "p" else ""
            contrasts.append(NuanceContrast(target_pattern=htext, difference=desc[:300]))

    # 4. Pitfalls
    pitfalls: list[CommonPitfall] = []
    seen_p: set[str] = set()
    for p in main.find_all("p"):
        ptxt = p.get_text().strip()
        if (
            any(
                warn in ptxt.lower()
                for warn in [
                    "careful",
                    "incorrect",
                    "mistake",
                    "wrong",
                    "do not",
                    "don't",
                    "caution",
                    "warning",
                    "cannot",
                ]
            )
            and 40 < len(ptxt) < 350
        ):
            if ptxt in seen_p:
                continue
            seen_p.add(ptxt)
            pitfalls.append(CommonPitfall(misconception=ptxt[:120], explanation=ptxt))
            if len(pitfalls) >= 3:
                break

    source_url = f"https://www.tofugu.com/japanese-grammar/{slug}/"
    return GrammarEnrichment(
        concept_id=concept_id,
        big_picture_concept=big_picture,
        formation_rules=formations,
        common_pitfalls=pitfalls,
        nuance_contrasts=contrasts,
        source_url=source_url,
    )


def run_mining(db_path: Path | None = None) -> int:
    """Mine all mapped Tofugu articles and upsert non-seed entries into grammar_enrichment."""
    if db_path is None:
        db_path = resolve_grammar_reference_db_path()

    cache_dir = Path(__file__).resolve().parent / ".tofugu_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(db_path)
    conn.executescript(CREATE_ENRICHMENT_TABLE_SQL)

    logger.info("Starting Tofugu grammar enrichment into %s", db_path)
    logger.info("Mapped slugs count: %d", len(SLUG_TO_CONCEPT_ID))

    enriched_count = 0
    # Group by concept_id so we merge or prioritize best enrichment
    by_concept: dict[str, list[str]] = {}
    for slug, cid in SLUG_TO_CONCEPT_ID.items():
        by_concept.setdefault(cid, []).append(slug)

    for cid, slugs in by_concept.items():
        # If concept_id is already a core seed with rich verified hand-crafted models, skip overwriting
        if cid in SEED_CONCEPT_IDS:
            logger.info("Preserving hand-curated seed for %s", cid)
            continue

        # Fetch and extract for the primary slug
        combined_enrichment: GrammarEnrichment | None = None
        for slug in slugs:
            html = fetch_tofugu_html(slug, cache_dir)
            if not html:
                continue
            enr = extract_enrichment_from_html(html, concept_id=cid, slug=slug)
            if not enr:
                continue

            if combined_enrichment is None:
                combined_enrichment = enr
            else:
                # Merge formations, pitfalls, contrasts
                combined_enrichment.formation_rules.extend(enr.formation_rules)
                combined_enrichment.common_pitfalls.extend(enr.common_pitfalls)
                combined_enrichment.nuance_contrasts.extend(enr.nuance_contrasts)
                if not combined_enrichment.big_picture_concept and enr.big_picture_concept:
                    combined_enrichment.big_picture_concept = enr.big_picture_concept

        if combined_enrichment and combined_enrichment.big_picture_concept:
            # Deduplicate items
            uniq_rules: list[FormationRule] = []
            seen_r = set()
            for r in combined_enrichment.formation_rules:
                if r.structure not in seen_r:
                    seen_r.add(r.structure)
                    uniq_rules.append(r)
            combined_enrichment.formation_rules = uniq_rules[:8]

            uniq_p: list[CommonPitfall] = []
            seen_p = set()
            for p in combined_enrichment.common_pitfalls:
                if p.misconception not in seen_p:
                    seen_p.add(p.misconception)
                    uniq_p.append(p)
            combined_enrichment.common_pitfalls = uniq_p[:4]

            uniq_c: list[NuanceContrast] = []
            seen_c = set()
            for c in combined_enrichment.nuance_contrasts:
                if c.target_pattern not in seen_c:
                    seen_c.add(c.target_pattern)
                    uniq_c.append(c)
            combined_enrichment.nuance_contrasts = uniq_c[:4]

            # Upsert into DB
            conn.execute(
                """
                INSERT INTO grammar_enrichment (
                    concept_id, big_picture_concept, formation_rules,
                    common_pitfalls, nuance_contrasts, visual_anchor_svg,
                    source_url, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(concept_id) DO UPDATE SET
                    big_picture_concept=excluded.big_picture_concept,
                    formation_rules=excluded.formation_rules,
                    common_pitfalls=excluded.common_pitfalls,
                    nuance_contrasts=excluded.nuance_contrasts,
                    source_url=excluded.source_url,
                    updated_at=excluded.updated_at
                """,
                combined_enrichment.to_db_row(),
            )
            enriched_count += 1
            logger.info("Enriched %s (from slugs: %s)", cid, slugs)

    conn.commit()
    total_in_db = conn.execute("SELECT count(*) FROM grammar_enrichment").fetchone()[0]
    conn.close()

    logger.info("Mining complete! Successfully enriched %d points (Total in DB: %d)", enriched_count, total_in_db)
    return total_in_db


if __name__ == "__main__":
    count = run_mining()
    print(f"Total points in grammar_enrichment: {count}")
