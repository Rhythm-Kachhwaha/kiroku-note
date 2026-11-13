"""Curated Transitive <-> Intransitive Japanese Verb Pairs Service.

Provides canonical verb pair mappings with particle usage hints, JLPT levels,
morphological pattern classification, and learner mastery states from SQLite.
"""
from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field

from app.db.connection import db_session, get_db_path


class TransitiveVerbDetail(BaseModel):
    expression: str
    reading: str
    meaning: str
    particle: str = "を"
    example_hint: str = ""
    state: str = "unseen"  # 'known' | 'learning' | 'unseen'
    is_mined: bool = False
    card_id: Optional[int] = None


class IntransitiveVerbDetail(BaseModel):
    expression: str
    reading: str
    meaning: str
    particle: str = "が"
    example_hint: str = ""
    state: str = "unseen"  # 'known' | 'learning' | 'unseen'
    is_mined: bool = False
    card_id: Optional[int] = None


class TransitivePair(BaseModel):
    id: str
    level: str  # 'N5', 'N4', 'N3', 'N2', 'N1'
    pattern: str  # e.g., 'eru-aru', 'su-ru', 'osu-iru', 'eru-u'
    english_concept: str
    transitive: TransitiveVerbDetail
    intransitive: IntransitiveVerbDetail
    pair_mastery: str = "unseen"  # 'both_known' | 'half_known' | 'learning' | 'unseen'


class TransitivePairSummary(BaseModel):
    total_pairs: int
    both_known: int
    half_known: int
    learning: int
    unseen: int
    level_counts: dict[str, int]


# Canonical curated transitive <-> intransitive pairs across JLPT levels
CANONICAL_TRANSITIVE_PAIRS: tuple[dict[str, Any], ...] = (
    # --- N5 Pairs ---
    {
        "id": "pair-001",
        "level": "N5",
        "pattern": "eru-aku",
        "concept": "open",
        "vt": {"expression": "開ける", "reading": "あける", "meaning": "to open (something)", "particle": "を", "example_hint": "ドアを開ける"},
        "vi": {"expression": "開く", "reading": "あく", "meaning": "to open (by itself)", "particle": "が", "example_hint": "ドアが開く"},
    },
    {
        "id": "pair-002",
        "level": "N5",
        "pattern": "eru-maru",
        "concept": "stop",
        "vt": {"expression": "止める", "reading": "とめる", "meaning": "to stop/halt (something)", "particle": "を", "example_hint": "車を止める"},
        "vi": {"expression": "止まる", "reading": "とまる", "meaning": "to come to a stop", "particle": "が", "example_hint": "車が止まる"},
    },
    {
        "id": "pair-003",
        "level": "N5",
        "pattern": "meru-maru",
        "concept": "close",
        "vt": {"expression": "閉める", "reading": "しめる", "meaning": "to close/shut (something)", "particle": "を", "example_hint": "窓を閉める"},
        "vi": {"expression": "閉まる", "reading": "しまる", "meaning": "to close/shut", "particle": "が", "example_hint": "窓が閉まる"},
    },
    {
        "id": "pair-004",
        "level": "N5",
        "pattern": "keru-ku",
        "concept": "turn on / ignite",
        "vt": {"expression": "つける", "reading": "つける", "meaning": "to turn on (light/switch)", "particle": "を", "example_hint": "電気をつける"},
        "vi": {"expression": "つく", "reading": "つく", "meaning": "to turn on / catch fire", "particle": "が", "example_hint": "電気がつく"},
    },
    {
        "id": "pair-005",
        "level": "N5",
        "pattern": "su-eru",
        "concept": "turn off / extinguish",
        "vt": {"expression": "消す", "reading": "けす", "meaning": "to erase / turn off", "particle": "を", "example_hint": "火を消す / 電気を消す"},
        "vi": {"expression": "消える", "reading": "きえる", "meaning": "to go out / vanish", "particle": "が", "example_hint": "火が消える / 電気が消える"},
    },
    {
        "id": "pair-006",
        "level": "N5",
        "pattern": "reru-ru",
        "concept": "put in / enter",
        "vt": {"expression": "入れる", "reading": "いれる", "meaning": "to insert / put in", "particle": "を", "example_hint": "かばんに本を入れる"},
        "vi": {"expression": "入る", "reading": "はいる", "meaning": "to enter / go in", "particle": "が", "example_hint": "部屋に入る"},
    },
    {
        "id": "pair-007",
        "level": "N5",
        "pattern": "su-ru",
        "concept": "take out / exit",
        "vt": {"expression": "出す", "reading": "だす", "meaning": "to take out / bring forth", "particle": "を", "example_hint": "財布を出す"},
        "vi": {"expression": "出る", "reading": "でる", "meaning": "to exit / come out", "particle": "が", "example_hint": "部屋を出る / 芽が出る"},
    },

    # --- N4 Pairs ---
    {
        "id": "pair-008",
        "level": "N4",
        "pattern": "osu-iru",
        "concept": "drop / fall",
        "vt": {"expression": "落とす", "reading": "おとす", "meaning": "to drop (something)", "particle": "を", "example_hint": "財布を落とす"},
        "vi": {"expression": "落ちる", "reading": "おちる", "meaning": "to fall / drop down", "particle": "が", "example_hint": "葉が落ちる"},
    },
    {
        "id": "pair-009",
        "level": "N4",
        "pattern": "osu-iru",
        "concept": "wake / occur",
        "vt": {"expression": "起こす", "reading": "おこす", "meaning": "to wake (someone) up / cause", "particle": "を", "example_hint": "子供を起こす / 事故を起こす"},
        "vi": {"expression": "起きる", "reading": "おきる", "meaning": "to wake up / happen", "particle": "が", "example_hint": "朝起きる / 事故が起きる"},
    },
    {
        "id": "pair-010",
        "level": "N4",
        "pattern": "su-su",
        "concept": "break / shatter",
        "vt": {"expression": "壊す", "reading": "こわす", "meaning": "to break / destroy", "particle": "を", "example_hint": "時計を壊す"},
        "vi": {"expression": "壊れる", "reading": "こわれる", "meaning": "to break down / shatter", "particle": "が", "example_hint": "時計が壊れる"},
    },
    {
        "id": "pair-011",
        "level": "N4",
        "pattern": "su-reru",
        "concept": "soil / become dirty",
        "vt": {"expression": "汚す", "reading": "よごす", "meaning": "to make dirty / soil", "particle": "を", "example_hint": "服を汚す"},
        "vi": {"expression": "汚れる", "reading": "よごれる", "meaning": "to get dirty / stained", "particle": "が", "example_hint": "服が汚れる"},
    },
    {
        "id": "pair-012",
        "level": "N4",
        "pattern": "meru-maru",
        "concept": "begin / start",
        "vt": {"expression": "始める", "reading": "はじめる", "meaning": "to begin (an activity)", "particle": "を", "example_hint": "授業を始める"},
        "vi": {"expression": "始まる", "reading": "はじまる", "meaning": "to commence / start", "particle": "が", "example_hint": "授業が始まる"},
    },
    {
        "id": "pair-013",
        "level": "N4",
        "pattern": "eru-u",
        "concept": "finish / end",
        "vt": {"expression": "終える", "reading": "おえる", "meaning": "to finish / complete", "particle": "を", "example_hint": "仕事を終える"},
        "vi": {"expression": "終わる", "reading": "おわる", "meaning": "to come to an end", "particle": "が", "example_hint": "仕事が終わる"},
    },
    {
        "id": "pair-014",
        "level": "N4",
        "pattern": "su-reru",
        "concept": "spill / overflow",
        "vt": {"expression": "こぼす", "reading": "こぼす", "meaning": "to spill / shed (tears)", "particle": "を", "example_hint": "水をこぼす"},
        "vi": {"expression": "こぼれる", "reading": "こぼれる", "meaning": "to overflow / spill", "particle": "が", "example_hint": "水がこぼれる"},
    },
    {
        "id": "pair-015",
        "level": "N4",
        "pattern": "keru-ku",
        "concept": "reach / deliver",
        "vt": {"expression": "届ける", "reading": "とどける", "meaning": "to deliver / forward", "particle": "を", "example_hint": "荷物を届ける"},
        "vi": {"expression": "届く", "reading": "とどく", "meaning": "to reach / arrive", "particle": "が", "example_hint": "荷物が届く"},
    },
    {
        "id": "pair-016",
        "level": "N4",
        "pattern": "keru-ku",
        "concept": "continue",
        "vt": {"expression": "続ける", "reading": "つづける", "meaning": "to continue (something)", "particle": "を", "example_hint": "勉強を続ける"},
        "vi": {"expression": "続く", "reading": "つづく", "meaning": "to go on / continue", "particle": "が", "example_hint": "雨が続く"},
    },
    {
        "id": "pair-017",
        "level": "N4",
        "pattern": "su-reru",
        "concept": "cure / heal",
        "vt": {"expression": "治す", "reading": "なおす", "meaning": "to cure / heal (illness)", "particle": "を", "example_hint": "病気を治す"},
        "vi": {"expression": "治る", "reading": "なおる", "meaning": "to recover / get well", "particle": "が", "example_hint": "病気が治る"},
    },
    {
        "id": "pair-018",
        "level": "N4",
        "pattern": "su-ru",
        "concept": "repair / be fixed",
        "vt": {"expression": "直す", "reading": "なおす", "meaning": "to repair / fix (object)", "particle": "を", "example_hint": "時計を直す"},
        "vi": {"expression": "直る", "reading": "なおる", "meaning": "to be repaired", "particle": "が", "example_hint": "時計が直る"},
    },
    {
        "id": "pair-019",
        "level": "N4",
        "pattern": "su-ru",
        "concept": "find / be found",
        "vt": {"expression": "見つける", "reading": "みつける", "meaning": "to find (something)", "particle": "を", "example_hint": "鍵を見つける"},
        "vi": {"expression": "見つかる", "reading": "みつかる", "meaning": "to be discovered/found", "particle": "が", "example_hint": "鍵が見つかる"},
    },

    # --- N3 Pairs ---
    {
        "id": "pair-020",
        "level": "N3",
        "pattern": "asu-eru",
        "concept": "grow / breed",
        "vt": {"expression": "生やす", "reading": "はやす", "meaning": "to grow (beard/plants)", "particle": "を", "example_hint": "ひげを生やす"},
        "vi": {"expression": "生える", "reading": "はえる", "meaning": "to sprout / spring up", "particle": "が", "example_hint": "草が生える"},
    },
    {
        "id": "pair-021",
        "level": "N3",
        "pattern": "su-reru",
        "concept": "break / fold",
        "vt": {"expression": "折る", "reading": "おる", "meaning": "to break / fold / bend", "particle": "を", "example_hint": "枝を折る"},
        "vi": {"expression": "折れる", "reading": "おれる", "meaning": "to snap / be broken", "particle": "が", "example_hint": "枝が折れる"},
    },
    {
        "id": "pair-022",
        "level": "N3",
        "pattern": "su-reru",
        "concept": "tear / rip",
        "vt": {"expression": "破る", "reading": "やぶる", "meaning": "to tear / breach", "particle": "を", "example_hint": "紙を破る / 約束を破る"},
        "vi": {"expression": "破れる", "reading": "やぶれる", "meaning": "to get torn / burst", "particle": "が", "example_hint": "紙が破れる"},
    },
    {
        "id": "pair-023",
        "level": "N3",
        "pattern": "keru-ku",
        "concept": "burn / bake",
        "vt": {"expression": "焼く", "reading": "やく", "meaning": "to bake / grill / roast", "particle": "を", "example_hint": "パンを焼く"},
        "vi": {"expression": "焼ける", "reading": "やける", "meaning": "to be roasted / get burned", "particle": "が", "example_hint": "パンが焼ける"},
    },
    {
        "id": "pair-024",
        "level": "N3",
        "pattern": "su-ru",
        "concept": "scatter / fall",
        "vt": {"expression": "散らす", "reading": "ちらす", "meaning": "to scatter / disperse", "particle": "を", "example_hint": "花びらを散らす"},
        "vi": {"expression": "散る", "reading": "ちる", "meaning": "to scatter / fall (petals)", "particle": "が", "example_hint": "桜が散る"},
    },
    {
        "id": "pair-025",
        "level": "N3",
        "pattern": "asu-eru",
        "concept": "chill / freeze",
        "vt": {"expression": "冷やす", "reading": "ひやす", "meaning": "to chill / refrigerate", "particle": "を", "example_hint": "ビールを冷やす"},
        "vi": {"expression": "冷える", "reading": "ひえる", "meaning": "to become cold / chill", "particle": "が", "example_hint": "足が冷える"},
    },
    {
        "id": "pair-026",
        "level": "N3",
        "pattern": "ameru-amaru",
        "concept": "warm up",
        "vt": {"expression": "温める", "reading": "あたためる", "meaning": "to warm up / reheat", "particle": "を", "example_hint": "スープを温める"},
        "vi": {"expression": "温まる", "reading": "あたたまる", "meaning": "to get warm", "particle": "が", "example_hint": "部屋が温まる"},
    },
    {
        "id": "pair-027",
        "level": "N3",
        "pattern": "asu-eru",
        "concept": "boil / simmer",
        "vt": {"expression": "沸かす", "reading": "わかす", "meaning": "to boil / heat (water)", "particle": "を", "example_hint": "湯を沸かす"},
        "vi": {"expression": "沸く", "reading": "わく", "meaning": "to boil / seethe", "particle": "が", "example_hint": "湯が沸く"},
    },
    {
        "id": "pair-028",
        "level": "N3",
        "pattern": "keru-ku",
        "concept": "untie / resolve",
        "vt": {"expression": "解く", "reading": "とく", "meaning": "to untie / solve (a puzzle)", "particle": "を", "example_hint": "問題を解く / 帯を解く"},
        "vi": {"expression": "解ける", "reading": "とける", "meaning": "to come untied / be solved", "particle": "が", "example_hint": "疑問が解ける / 結び目が解ける"},
    },
    {
        "id": "pair-029",
        "level": "N3",
        "pattern": "osu-iru",
        "concept": "pass / spend time",
        "vt": {"expression": "過ごす", "reading": "すごす", "meaning": "to spend (time)", "particle": "を", "example_hint": "休日を楽しく過ごす"},
        "vi": {"expression": "過ぎる", "reading": "すぎる", "meaning": "to pass by / exceed", "particle": "が", "example_hint": "時間が過ぎる"},
    },
    {
        "id": "pair-030",
        "level": "N3",
        "pattern": "ameru-amaru",
        "concept": "gather / assemble",
        "vt": {"expression": "集める", "reading": "あつめる", "meaning": "to collect / gather (things)", "particle": "を", "example_hint": "切手を集める"},
        "vi": {"expression": "集まる", "reading": "あつまる", "meaning": "to gather / congregate", "particle": "が", "example_hint": "人が集まる"},
    },

    # --- N2 & N1 Pairs ---
    {
        "id": "pair-031",
        "level": "N2",
        "pattern": "osu-iru",
        "concept": "threaten / be intimidated",
        "vt": {"expression": "脅かす", "reading": "おびやかす", "meaning": "to threaten / endanger", "particle": "を", "example_hint": "平和を脅かす"},
        "vi": {"expression": "脅える", "reading": "おびえる", "meaning": "to be frightened / fearful", "particle": "が", "example_hint": "恐怖に脅える"},
    },
    {
        "id": "pair-032",
        "level": "N2",
        "pattern": "asu-eru",
        "concept": "spoil / go bad",
        "vt": {"expression": "腐らす", "reading": "くさらす", "meaning": "to let rot / corrode", "particle": "を", "example_hint": "食べ物を腐らす"},
        "vi": {"expression": "腐る", "reading": "くさる", "meaning": "to rot / go bad", "particle": "が", "example_hint": "魚が腐る"},
    },
    {
        "id": "pair-033",
        "level": "N2",
        "pattern": "keru-ku",
        "concept": "repel / bounce off",
        "vt": {"expression": "弾く", "reading": "はじく", "meaning": "to repel / snap / flick", "particle": "を", "example_hint": "水を弾く"},
        "vi": {"expression": "弾ける", "reading": "はじける", "meaning": "to burst open / snap", "particle": "が", "example_hint": "実が弾ける"},
    },
    {
        "id": "pair-034",
        "level": "N2",
        "pattern": "seru-su",
        "concept": "submerge / sink",
        "vt": {"expression": "沈める", "reading": "しずめる", "meaning": "to submerge / sink (a ship)", "particle": "を", "example_hint": "船を沈める"},
        "vi": {"expression": "沈む", "reading": "しずむ", "meaning": "to sink / go under", "particle": "が", "example_hint": "船が沈む / 日が沈む"},
    },
    {
        "id": "pair-035",
        "level": "N1",
        "pattern": "meru-maru",
        "concept": "soften / ease",
        "vt": {"expression": "緩める", "reading": "ゆるめる", "meaning": "to loosen / relax", "particle": "を", "example_hint": "ネクタイを緩める / 警戒を緩める"},
        "vi": {"expression": "緩む", "reading": "ゆるむ", "meaning": "to become loose / slacken", "particle": "が", "example_hint": "紐が緩む / 緊張が緩む"},
    },
)


def get_transitive_pairs(
    level: Optional[str] = None,
    pattern: Optional[str] = None,
    mastery_filter: Optional[str] = None,
    db_path: Optional[Any] = None,
) -> list[TransitivePair]:
    """
    Retrieve curated transitive <-> intransitive pairs enriched with the learner's
    current mastery states from word_states and mined cards.
    """
    actual_db = db_path or get_db_path()

    states_by_expr: dict[str, str] = {}
    cards_by_expr: dict[str, int] = {}

    try:
        with db_session(actual_db) as conn:
            # 1. Map word states
            rows = conn.execute("SELECT expression, state FROM word_states").fetchall()
            for r in rows:
                expr = r["expression"]
                st = r["state"] or "unseen"
                if expr:
                    states_by_expr[expr] = st

            # 2. Map mined cards
            card_rows = conn.execute("SELECT id, expression FROM cards").fetchall()
            for cr in card_rows:
                expr = cr["expression"]
                if expr and expr not in cards_by_expr:
                    cards_by_expr[expr] = cr["id"]
    except Exception:
        # Fallback gracefully if database is empty or unavailable
        pass

    results: list[TransitivePair] = []

    for item in CANONICAL_TRANSITIVE_PAIRS:
        if level and level.strip().upper() != "ALL" and item["level"].upper() != level.strip().upper():
            continue
        if pattern and pattern.strip() != "all" and item["pattern"] != pattern.strip():
            continue

        vt_data = item["vt"]
        vi_data = item["vi"]

        vt_expr = vt_data["expression"]
        vi_expr = vi_data["expression"]

        vt_state = states_by_expr.get(vt_expr, "learning" if vt_expr in cards_by_expr else "unseen")
        vi_state = states_by_expr.get(vi_expr, "learning" if vi_expr in cards_by_expr else "unseen")

        vt_card_id = cards_by_expr.get(vt_expr)
        vi_card_id = cards_by_expr.get(vi_expr)

        # Compute pair mastery
        if vt_state == "known" and vi_state == "known":
            pair_mastery = "both_known"
        elif vt_state == "known" or vi_state == "known":
            pair_mastery = "half_known"
        elif vt_state == "learning" or vi_state == "learning" or vt_card_id or vi_card_id:
            pair_mastery = "learning"
        else:
            pair_mastery = "unseen"

        if mastery_filter and mastery_filter.strip().lower() != "all":
            if pair_mastery != mastery_filter.strip().lower():
                continue

        pair = TransitivePair(
            id=item["id"],
            level=item["level"],
            pattern=item["pattern"],
            english_concept=item["concept"],
            transitive=TransitiveVerbDetail(
                expression=vt_expr,
                reading=vt_data["reading"],
                meaning=vt_data["meaning"],
                particle=vt_data.get("particle", "を"),
                example_hint=vt_data.get("example_hint", ""),
                state=vt_state,
                is_mined=bool(vt_card_id),
                card_id=vt_card_id,
            ),
            intransitive=IntransitiveVerbDetail(
                expression=vi_expr,
                reading=vi_data["reading"],
                meaning=vi_data["meaning"],
                particle=vi_data.get("particle", "が"),
                example_hint=vi_data.get("example_hint", ""),
                state=vi_state,
                is_mined=bool(vi_card_id),
                card_id=vi_card_id,
            ),
            pair_mastery=pair_mastery,
        )
        results.append(pair)

    return results


def get_transitive_pairs_summary(db_path: Optional[Any] = None) -> TransitivePairSummary:
    """Return aggregated telemetry for all canonical transitive verb pairs."""
    all_pairs = get_transitive_pairs(db_path=db_path)
    total = len(all_pairs)
    both_known = sum(1 for p in all_pairs if p.pair_mastery == "both_known")
    half_known = sum(1 for p in all_pairs if p.pair_mastery == "half_known")
    learning = sum(1 for p in all_pairs if p.pair_mastery == "learning")
    unseen = sum(1 for p in all_pairs if p.pair_mastery == "unseen")

    level_counts: dict[str, int] = {}
    for p in all_pairs:
        lvl = p.level
        level_counts[lvl] = level_counts.get(lvl, 0) + 1

    return TransitivePairSummary(
        total_pairs=total,
        both_known=both_known,
        half_known=half_known,
        learning=learning,
        unseen=unseen,
        level_counts=level_counts,
    )
