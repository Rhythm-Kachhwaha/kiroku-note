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

    # --- Expanded N5-N1 Canonical Pairs ---
    {
        "id": "pair-036",
        "level": "N5",
        "pattern": "eru-aru",
        "concept": "line up / arrange",
        "vt": {"expression": "並べる", "reading": "ならべる", "meaning": "to line up / arrange", "particle": "を", "example_hint": "皿を並べる"},
        "vi": {"expression": "並ぶ", "reading": "ならぶ", "meaning": "to line up / stand in a row", "particle": "が", "example_hint": "人が並ぶ"},
    },
    {
        "id": "pair-037",
        "level": "N4",
        "pattern": "eru-aru",
        "concept": "change",
        "vt": {"expression": "変える", "reading": "かえる", "meaning": "to change (something)", "particle": "を", "example_hint": "予定を変える"},
        "vi": {"expression": "変わる", "reading": "かわる", "meaning": "to change / transform", "particle": "が", "example_hint": "季節が変わる"},
    },
    {
        "id": "pair-038",
        "level": "N4",
        "pattern": "meru-maru",
        "concept": "decide",
        "vt": {"expression": "決める", "reading": "きめる", "meaning": "to decide (something)", "particle": "を", "example_hint": "日時を決める"},
        "vi": {"expression": "決まる", "reading": "きまる", "meaning": "to be decided", "particle": "が", "example_hint": "日時が決まる"},
    },
    {
        "id": "pair-039",
        "level": "N4",
        "pattern": "eru-aru",
        "concept": "raise / rise",
        "vt": {"expression": "上げる", "reading": "あげる", "meaning": "to raise / lift", "particle": "を", "example_hint": "手を上げる"},
        "vi": {"expression": "上がる", "reading": "あがる", "meaning": "to rise / go up", "particle": "が", "example_hint": "値段が上がる"},
    },
    {
        "id": "pair-040",
        "level": "N4",
        "pattern": "eru-aru",
        "concept": "lower / drop",
        "vt": {"expression": "下げる", "reading": "さげる", "meaning": "to lower / hang down", "particle": "を", "example_hint": "音を下げる"},
        "vi": {"expression": "下がる", "reading": "さがる", "meaning": "to drop / go down", "particle": "が", "example_hint": "熱が下がる"},
    },
    {
        "id": "pair-041",
        "level": "N4",
        "pattern": "su-eru",
        "concept": "increase",
        "vt": {"expression": "増やす", "reading": "ふやす", "meaning": "to increase (something)", "particle": "を", "example_hint": "貯金を増やす"},
        "vi": {"expression": "増える", "reading": "ふえる", "meaning": "to increase / multiply", "particle": "が", "example_hint": "人口が増える"},
    },
    {
        "id": "pair-042",
        "level": "N4",
        "pattern": "su-ru",
        "concept": "decrease",
        "vt": {"expression": "減らす", "reading": "へらす", "meaning": "to reduce / decrease", "particle": "を", "example_hint": "ごみを減らす"},
        "vi": {"expression": "減る", "reading": "へる", "meaning": "to decrease / dwindle", "particle": "が", "example_hint": "体重が減る"},
    },
    {
        "id": "pair-043",
        "level": "N4",
        "pattern": "meru-mu",
        "concept": "advance / proceed",
        "vt": {"expression": "進める", "reading": "すすめる", "meaning": "to advance / move forward", "particle": "を", "example_hint": "計画を進める"},
        "vi": {"expression": "進む", "reading": "すすむ", "meaning": "to advance / progress", "particle": "が", "example_hint": "時計が進む"},
    },
    {
        "id": "pair-044",
        "level": "N4",
        "pattern": "su-ru",
        "concept": "return / put back",
        "vt": {"expression": "戻す", "reading": "もどす", "meaning": "to return / put back", "particle": "を", "example_hint": "本を棚に戻す"},
        "vi": {"expression": "戻る", "reading": "もどる", "meaning": "to return / go back", "particle": "が", "example_hint": "家に戻る"},
    },
    {
        "id": "pair-045",
        "level": "N4",
        "pattern": "su-ru",
        "concept": "give back / return",
        "vt": {"expression": "返す", "reading": "かえす", "meaning": "to return (something borrowed)", "particle": "を", "example_hint": "本を返す"},
        "vi": {"expression": "返る", "reading": "かえる", "meaning": "to return / come back", "particle": "が", "example_hint": "故郷に返る"},
    },
    {
        "id": "pair-046",
        "level": "N4",
        "pattern": "seru-ru",
        "concept": "place on / ride",
        "vt": {"expression": "乗せる", "reading": "のせる", "meaning": "to place on / give a ride", "particle": "を", "example_hint": "荷物を車に乗せる"},
        "vi": {"expression": "乗る", "reading": "のる", "meaning": "to get on / ride", "particle": "が", "example_hint": "電車に乗る"},
    },
    {
        "id": "pair-047",
        "level": "N4",
        "pattern": "su-riru",
        "concept": "unload / get off",
        "vt": {"expression": "降ろす", "reading": "おろす", "meaning": "to let off / unload", "particle": "を", "example_hint": "客を降ろす"},
        "vi": {"expression": "降りる", "reading": "おりる", "meaning": "to get off / descend", "particle": "が", "example_hint": "駅で降りる"},
    },
    {
        "id": "pair-048",
        "level": "N3",
        "pattern": "su-eru",
        "concept": "scorch / burn",
        "vt": {"expression": "焦がす", "reading": "こがす", "meaning": "to scorch / char (food)", "particle": "を", "example_hint": "パンを焦がす"},
        "vi": {"expression": "焦げる", "reading": "こげる", "meaning": "to burn / get scorched", "particle": "が", "example_hint": "鍋が焦げる"},
    },
    {
        "id": "pair-049",
        "level": "N4",
        "pattern": "eru-aru",
        "concept": "hang / take (time)",
        "vt": {"expression": "掛ける", "reading": "かける", "meaning": "to hang / make (a call)", "particle": "を", "example_hint": "壁に絵を掛ける"},
        "vi": {"expression": "掛かる", "reading": "かかる", "meaning": "to hang / take (time/money)", "particle": "が", "example_hint": "時間が掛かる"},
    },
    {
        "id": "pair-050",
        "level": "N4",
        "pattern": "eru-u",
        "concept": "build / stand",
        "vt": {"expression": "建てる", "reading": "たてる", "meaning": "to build / construct", "particle": "を", "example_hint": "家を建てる"},
        "vi": {"expression": "建つ", "reading": "たつ", "meaning": "to be built / stand", "particle": "が", "example_hint": "ビルが建つ"},
    },
    {
        "id": "pair-051",
        "level": "N4",
        "pattern": "eru-aru",
        "concept": "bend / turn",
        "vt": {"expression": "曲げる", "reading": "まげる", "meaning": "to bend (something)", "particle": "を", "example_hint": "膝を曲げる"},
        "vi": {"expression": "曲がる", "reading": "まがる", "meaning": "to bend / turn", "particle": "が", "example_hint": "角を曲がる"},
    },
    {
        "id": "pair-052",
        "level": "N4",
        "pattern": "eru-aru",
        "concept": "save / be rescued",
        "vt": {"expression": "助ける", "reading": "たすける", "meaning": "to help / rescue", "particle": "を", "example_hint": "迷子を助ける"},
        "vi": {"expression": "助かる", "reading": "たすかる", "meaning": "to be saved / relieved", "particle": "が", "example_hint": "命が助かる"},
    },
    {
        "id": "pair-053",
        "level": "N4",
        "pattern": "eru-u",
        "concept": "raise / grow up",
        "vt": {"expression": "育てる", "reading": "そだてる", "meaning": "to raise / bring up", "particle": "を", "example_hint": "花を育てる"},
        "vi": {"expression": "育つ", "reading": "そだつ", "meaning": "to grow up", "particle": "が", "example_hint": "木が育つ"},
    },
    {
        "id": "pair-054",
        "level": "N4",
        "pattern": "su-eru",
        "concept": "let escape / flee",
        "vt": {"expression": "逃がす", "reading": "にがす", "meaning": "to let escape / miss", "particle": "を", "example_hint": "鳥を逃がす"},
        "vi": {"expression": "逃げる", "reading": "にげる", "meaning": "to run away / escape", "particle": "が", "example_hint": "猫が逃げる"},
    },
    {
        "id": "pair-055",
        "level": "N4",
        "pattern": "su-ru",
        "concept": "leave behind / remain",
        "vt": {"expression": "残す", "reading": "のこす", "meaning": "to leave behind", "particle": "を", "example_hint": "ご飯を残す"},
        "vi": {"expression": "残る", "reading": "のこる", "meaning": "to remain / be left", "particle": "が", "example_hint": "時間が残る"},
    },
    {
        "id": "pair-056",
        "level": "N4",
        "pattern": "su-ru",
        "concept": "turn / spin",
        "vt": {"expression": "回す", "reading": "まわす", "meaning": "to turn / spin (something)", "particle": "を", "example_hint": "鍵を回す"},
        "vi": {"expression": "回る", "reading": "まわる", "meaning": "to turn / revolve", "particle": "が", "example_hint": "地球が回る"},
    },
    {
        "id": "pair-057",
        "level": "N4",
        "pattern": "su-ku",
        "concept": "move",
        "vt": {"expression": "動かす", "reading": "うごかす", "meaning": "to move (something)", "particle": "を", "example_hint": "机を動かす"},
        "vi": {"expression": "動く", "reading": "うごく", "meaning": "to move / operate", "particle": "が", "example_hint": "機械が動く"},
    },
    {
        "id": "pair-058",
        "level": "N4",
        "pattern": "su-reru",
        "concept": "flow / wash away",
        "vt": {"expression": "流す", "reading": "ながす", "meaning": "to pour / play (music)", "particle": "を", "example_hint": "水を流す"},
        "vi": {"expression": "流れる", "reading": "ながれる", "meaning": "to flow / stream", "particle": "が", "example_hint": "川が流れる"},
    },
    {
        "id": "pair-059",
        "level": "N4",
        "pattern": "su-ku",
        "concept": "dry",
        "vt": {"expression": "乾かす", "reading": "かわかす", "meaning": "to dry (something)", "particle": "を", "example_hint": "髪を乾かす"},
        "vi": {"expression": "乾く", "reading": "かわく", "meaning": "to get dry", "particle": "が", "example_hint": "洗濯物が乾く"},
    },
    {
        "id": "pair-060",
        "level": "N4",
        "pattern": "su-reru",
        "concept": "wet / get wet",
        "vt": {"expression": "濡らす", "reading": "ぬらす", "meaning": "to wet / soak", "particle": "を", "example_hint": "タオルを濡らす"},
        "vi": {"expression": "濡れる", "reading": "ぬれる", "meaning": "to get wet", "particle": "が", "example_hint": "服が濡れる"},
    },
    {
        "id": "pair-061",
        "level": "N4",
        "pattern": "su-eru",
        "concept": "cool down",
        "vt": {"expression": "冷ます", "reading": "さます", "meaning": "to let cool", "particle": "を", "example_hint": "お茶を冷ます"},
        "vi": {"expression": "冷める", "reading": "さめる", "meaning": "to cool down", "particle": "が", "example_hint": "スープが冷める"},
    },
    {
        "id": "pair-062",
        "level": "N4",
        "pattern": "su-ru",
        "concept": "ring / sound",
        "vt": {"expression": "鳴らす", "reading": "ならす", "meaning": "to ring / honk", "particle": "を", "example_hint": "ベルを鳴らす"},
        "vi": {"expression": "鳴る", "reading": "なる", "meaning": "to ring / chime", "particle": "が", "example_hint": "電話が鳴る"},
    },
    {
        "id": "pair-063",
        "level": "N4",
        "pattern": "su-reru",
        "concept": "shake / sway",
        "vt": {"expression": "揺らす", "reading": "ゆらす", "meaning": "to shake / rock", "particle": "を", "example_hint": "木を揺らす"},
        "vi": {"expression": "揺れる", "reading": "ゆれる", "meaning": "to shake / sway", "particle": "が", "example_hint": "電車が揺れる"},
    },
    {
        "id": "pair-064",
        "level": "N4",
        "pattern": "su-reru",
        "concept": "knock down / fall",
        "vt": {"expression": "倒す", "reading": "たおす", "meaning": "to knock down / defeat", "particle": "を", "example_hint": "木を倒す"},
        "vi": {"expression": "倒れる", "reading": "たおれる", "meaning": "to collapse / fall over", "particle": "が", "example_hint": "木が倒れる"},
    },
    {
        "id": "pair-065",
        "level": "N4",
        "pattern": "ru-reru",
        "concept": "break / split",
        "vt": {"expression": "割る", "reading": "わる", "meaning": "to break / divide", "particle": "を", "example_hint": "コップを割る"},
        "vi": {"expression": "割れる", "reading": "われる", "meaning": "to break / crack", "particle": "が", "example_hint": "皿が割れる"},
    },
    {
        "id": "pair-066",
        "level": "N4",
        "pattern": "ru-reru",
        "concept": "cut / snap",
        "vt": {"expression": "切る", "reading": "きる", "meaning": "to cut / turn off", "particle": "を", "example_hint": "紙を切る"},
        "vi": {"expression": "切れる", "reading": "きれる", "meaning": "to snap / run out", "particle": "が", "example_hint": "電池が切れる"},
    },
    {
        "id": "pair-067",
        "level": "N3",
        "pattern": "ku-keru",
        "concept": "pull out / fall out",
        "vt": {"expression": "抜く", "reading": "ぬく", "meaning": "to pull out / unplug", "particle": "を", "example_hint": "歯を抜く"},
        "vi": {"expression": "抜ける", "reading": "ぬける", "meaning": "to come out / fall out", "particle": "が", "example_hint": "毛が抜ける"},
    },
    {
        "id": "pair-068",
        "level": "N3",
        "pattern": "su-reru",
        "concept": "detach / come off",
        "vt": {"expression": "外す", "reading": "はずす", "meaning": "to unfasten / remove", "particle": "を", "example_hint": "眼鏡を外す"},
        "vi": {"expression": "外れる", "reading": "はずれる", "meaning": "to come off / miss", "particle": "が", "example_hint": "ボタンが外れる"},
    },
    {
        "id": "pair-069",
        "level": "N3",
        "pattern": "eru-aru",
        "concept": "spread / widen",
        "vt": {"expression": "広げる", "reading": "ひろげる", "meaning": "to spread / widen", "particle": "を", "example_hint": "地図を広げる"},
        "vi": {"expression": "広がる", "reading": "ひろがる", "meaning": "to spread out / expand", "particle": "が", "example_hint": "噂が広がる"},
    },
    {
        "id": "pair-070",
        "level": "N3",
        "pattern": "meru-maru",
        "concept": "deepen",
        "vt": {"expression": "深める", "reading": "ふかめる", "meaning": "to deepen (understanding)", "particle": "を", "example_hint": "理解を深める"},
        "vi": {"expression": "深まる", "reading": "ふかまる", "meaning": "to deepen / intensify", "particle": "が", "example_hint": "秋が深まる"},
    },
    {
        "id": "pair-071",
        "level": "N3",
        "pattern": "meru-maru",
        "concept": "heighten / raise",
        "vt": {"expression": "高める", "reading": "たかめる", "meaning": "to raise / enhance", "particle": "を", "example_hint": "質を高める"},
        "vi": {"expression": "高まる", "reading": "たかまる", "meaning": "to rise / heighten", "particle": "が", "example_hint": "関心が高まる"},
    },
    {
        "id": "pair-072",
        "level": "N3",
        "pattern": "meru-maru",
        "concept": "strengthen",
        "vt": {"expression": "強める", "reading": "つよめる", "meaning": "to strengthen / emphasize", "particle": "を", "example_hint": "結びつきを強める"},
        "vi": {"expression": "強まる", "reading": "つよまる", "meaning": "to grow stronger", "particle": "が", "example_hint": "風が強まる"},
    },
    {
        "id": "pair-073",
        "level": "N3",
        "pattern": "meru-maru",
        "concept": "weaken",
        "vt": {"expression": "弱める", "reading": "よわめる", "meaning": "to weaken / tone down", "particle": "を", "example_hint": "火を弱める"},
        "vi": {"expression": "弱まる", "reading": "よわまる", "meaning": "to weaken / subside", "particle": "が", "example_hint": "雨が弱まる"},
    },
    {
        "id": "pair-074",
        "level": "N3",
        "pattern": "meru-maru",
        "concept": "hasten / move up",
        "vt": {"expression": "早める", "reading": "はやめる", "meaning": "to hasten / bring forward", "particle": "を", "example_hint": "出発を早める"},
        "vi": {"expression": "早まる", "reading": "はやまる", "meaning": "to be moved up", "particle": "が", "example_hint": "予定が早まる"},
    },
    {
        "id": "pair-075",
        "level": "N3",
        "pattern": "seru-reru",
        "concept": "delay / be late",
        "vt": {"expression": "遅らせる", "reading": "おくらせる", "meaning": "to delay / postpone", "particle": "を", "example_hint": "開始を遅らせる"},
        "vi": {"expression": "遅れる", "reading": "おくれる", "meaning": "to be delayed / be late", "particle": "が", "example_hint": "電車が遅れる"},
    },
    {
        "id": "pair-076",
        "level": "N3",
        "pattern": "meru-mu",
        "concept": "shrink / shorten",
        "vt": {"expression": "縮める", "reading": "ちぢめる", "meaning": "to shorten / shrink", "particle": "を", "example_hint": "距離を縮める"},
        "vi": {"expression": "縮む", "reading": "ちぢむ", "meaning": "to shrink / contract", "particle": "が", "example_hint": "セーターが縮む"},
    },
    {
        "id": "pair-077",
        "level": "N3",
        "pattern": "su-biru",
        "concept": "stretch / grow",
        "vt": {"expression": "伸ばす", "reading": "のばす", "meaning": "to stretch / extend", "particle": "を", "example_hint": "手を伸ばす"},
        "vi": {"expression": "伸びる", "reading": "のびる", "meaning": "to stretch / grow", "particle": "が", "example_hint": "背が伸びる"},
    },
    {
        "id": "pair-078",
        "level": "N3",
        "pattern": "meru-maru",
        "concept": "spread / popularize",
        "vt": {"expression": "広める", "reading": "ひろめる", "meaning": "to spread / propagate", "particle": "を", "example_hint": "文化を広める"},
        "vi": {"expression": "広まる", "reading": "ひろまる", "meaning": "to spread / become popular", "particle": "が", "example_hint": "知識が広まる"},
    },
    {
        "id": "pair-079",
        "level": "N3",
        "pattern": "meru-maru",
        "concept": "harden / solidify",
        "vt": {"expression": "固める", "reading": "かためる", "meaning": "to harden / solidify", "particle": "を", "example_hint": "決意を固める"},
        "vi": {"expression": "固まる", "reading": "かたまる", "meaning": "to harden / gather", "particle": "が", "example_hint": "氷が固まる"},
    },
    {
        "id": "pair-080",
        "level": "N3",
        "pattern": "meru-maru",
        "concept": "gather / settle",
        "vt": {"expression": "まとめる", "reading": "まとめる", "meaning": "to summarize / gather", "particle": "を", "example_hint": "意見をまとめる"},
        "vi": {"expression": "まとまる", "reading": "まとまる", "meaning": "to be settled / collected", "particle": "が", "example_hint": "話がまとまる"},
    },
    {
        "id": "pair-081",
        "level": "N3",
        "pattern": "eru-aru",
        "concept": "convey / be transmitted",
        "vt": {"expression": "伝える", "reading": "つたえる", "meaning": "to convey / report", "particle": "を", "example_hint": "気持ちを伝える"},
        "vi": {"expression": "伝わる", "reading": "つたわる", "meaning": "to be conveyed / handed down", "particle": "が", "example_hint": "熱意が伝わる"},
    },
    {
        "id": "pair-082",
        "level": "N3",
        "pattern": "eru-aru",
        "concept": "mix",
        "vt": {"expression": "混ぜる", "reading": "まぜる", "meaning": "to mix / blend", "particle": "を", "example_hint": "材料を混ぜる"},
        "vi": {"expression": "混ざる", "reading": "まざる", "meaning": "to be mixed", "particle": "が", "example_hint": "色が混ざる"},
    },
    {
        "id": "pair-083",
        "level": "N3",
        "pattern": "eru-aru",
        "concept": "pile up / overlap",
        "vt": {"expression": "重ねる", "reading": "かさねる", "meaning": "to pile up / repeat", "particle": "を", "example_hint": "努力を重ねる"},
        "vi": {"expression": "重なる", "reading": "かさなる", "meaning": "to overlap / coincide", "particle": "が", "example_hint": "予定が重なる"},
    },
    {
        "id": "pair-084",
        "level": "N3",
        "pattern": "su-reru",
        "concept": "separate / leave",
        "vt": {"expression": "離す", "reading": "はなす", "meaning": "to separate / keep apart", "particle": "を", "example_hint": "手を離す"},
        "vi": {"expression": "離れる", "reading": "はなれる", "meaning": "to separate / leave", "particle": "が", "example_hint": "席を離れる"},
    },
    {
        "id": "pair-085",
        "level": "N3",
        "pattern": "keru-ku",
        "concept": "attach / stick",
        "vt": {"expression": "くっつける", "reading": "くっつける", "meaning": "to attach / stick together", "particle": "を", "example_hint": "紙をくっつける"},
        "vi": {"expression": "くっつく", "reading": "くっつく", "meaning": "to stick to / cling", "particle": "が", "example_hint": "磁石がくっつく"},
    },
    {
        "id": "pair-086",
        "level": "N3",
        "pattern": "keru-karu",
        "concept": "bump / collide",
        "vt": {"expression": "ぶつける", "reading": "ぶつける", "meaning": "to hit / bump against", "particle": "を", "example_hint": "頭をぶつける"},
        "vi": {"expression": "ぶつかる", "reading": "ぶつかる", "meaning": "to collide / run into", "particle": "が", "example_hint": "車がぶつかる"},
    },
    {
        "id": "pair-087",
        "level": "N3",
        "pattern": "eru-aru",
        "concept": "hit / strike",
        "vt": {"expression": "当てる", "reading": "あてる", "meaning": "to hit / guess right", "particle": "を", "example_hint": "ボールを当てる"},
        "vi": {"expression": "当たる", "reading": "あたる", "meaning": "to hit / win (lottery)", "particle": "が", "example_hint": "宝くじが当たる"},
    },
    {
        "id": "pair-088",
        "level": "N3",
        "pattern": "su-reru",
        "concept": "hide",
        "vt": {"expression": "隠す", "reading": "かくす", "meaning": "to hide (something)", "particle": "を", "example_hint": "秘密を隠す"},
        "vi": {"expression": "隠れる", "reading": "かくれる", "meaning": "to hide (oneself)", "particle": "が", "example_hint": "月が雲に隠れる"},
    },
    {
        "id": "pair-089",
        "level": "N3",
        "pattern": "su-eru",
        "concept": "burn / ignite",
        "vt": {"expression": "燃やす", "reading": "もやす", "meaning": "to burn (trash/wood)", "particle": "を", "example_hint": "落ち葉を燃やす"},
        "vi": {"expression": "燃える", "reading": "もえる", "meaning": "to burn / blaze", "particle": "が", "example_hint": "火が燃える"},
    },
    {
        "id": "pair-090",
        "level": "N3",
        "pattern": "su-eru",
        "concept": "melt / dissolve",
        "vt": {"expression": "溶かす", "reading": "とかす", "meaning": "to melt / dissolve", "particle": "を", "example_hint": "砂糖を溶かす"},
        "vi": {"expression": "溶ける", "reading": "とける", "meaning": "to melt / dissolve", "particle": "が", "example_hint": "氷が溶ける"},
    },
    {
        "id": "pair-091",
        "level": "N3",
        "pattern": "seru-ru",
        "concept": "freeze",
        "vt": {"expression": "凍らせる", "reading": "こおらせる", "meaning": "to freeze (something)", "particle": "を", "example_hint": "水を凍らせる"},
        "vi": {"expression": "凍る", "reading": "こおる", "meaning": "to freeze", "particle": "が", "example_hint": "湖が凍る"},
    },
    {
        "id": "pair-092",
        "level": "N3",
        "pattern": "ku-keru",
        "concept": "smash / shatter",
        "vt": {"expression": "砕く", "reading": "くだく", "meaning": "to smash / crush", "particle": "を", "example_hint": "氷を砕く"},
        "vi": {"expression": "砕ける", "reading": "くだける", "meaning": "to shatter / break", "particle": "が", "example_hint": "波が砕ける"},
    },
    {
        "id": "pair-093",
        "level": "N3",
        "pattern": "su-reru",
        "concept": "crush / collapse",
        "vt": {"expression": "潰す", "reading": "つぶす", "meaning": "to crush / kill (time)", "particle": "を", "example_hint": "空き缶を潰す"},
        "vi": {"expression": "潰れる", "reading": "つぶれる", "meaning": "to be crushed / go bankrupt", "particle": "が", "example_hint": "店が潰れる"},
    },
    {
        "id": "pair-094",
        "level": "N3",
        "pattern": "eru-aru",
        "concept": "pack / get clogged",
        "vt": {"expression": "詰める", "reading": "つめる", "meaning": "to pack / stuff", "particle": "を", "example_hint": "箱に詰める"},
        "vi": {"expression": "詰まる", "reading": "つまる", "meaning": "to be packed / clogged", "particle": "が", "example_hint": "鼻が詰まる"},
    },
    {
        "id": "pair-095",
        "level": "N3",
        "pattern": "gu-garu",
        "concept": "connect",
        "vt": {"expression": "繋ぐ", "reading": "つなぐ", "meaning": "to connect / hold (hands)", "particle": "を", "example_hint": "手を繋ぐ"},
        "vi": {"expression": "繋がる", "reading": "つながる", "meaning": "to be connected", "particle": "が", "example_hint": "電話が繋がる"},
    },
    {
        "id": "pair-096",
        "level": "N3",
        "pattern": "eru-aru",
        "concept": "save up / accumulate",
        "vt": {"expression": "貯める", "reading": "ためる", "meaning": "to save (money)", "particle": "を", "example_hint": "お金を貯める"},
        "vi": {"expression": "貯まる", "reading": "たまる", "meaning": "to accumulate / be saved", "particle": "が", "example_hint": "ポイントが貯まる"},
    },
    {
        "id": "pair-097",
        "level": "N3",
        "pattern": "eru-aru",
        "concept": "bury / fill",
        "vt": {"expression": "埋める", "reading": "うめる", "meaning": "to bury / fill in", "particle": "を", "example_hint": "穴を埋める"},
        "vi": {"expression": "埋まる", "reading": "うまる", "meaning": "to be buried / filled", "particle": "が", "example_hint": "席が埋まる"},
    },
    {
        "id": "pair-098",
        "level": "N2",
        "pattern": "eru-u",
        "concept": "float",
        "vt": {"expression": "浮かべる", "reading": "うかべる", "meaning": "to float / show (a smile)", "particle": "を", "example_hint": "笑みを浮かべる"},
        "vi": {"expression": "浮かぶ", "reading": "うかぶ", "meaning": "to float / come to mind", "particle": "が", "example_hint": "アイデアが浮かぶ"},
    },
    {
        "id": "pair-099",
        "level": "N2",
        "pattern": "su-mu",
        "concept": "inflate / swell",
        "vt": {"expression": "膨らます", "reading": "ふくらます", "meaning": "to inflate / expand", "particle": "を", "example_hint": "風船を膨らます"},
        "vi": {"expression": "膨らむ", "reading": "ふくらむ", "meaning": "to swell / expand", "particle": "が", "example_hint": "パンが膨らむ"},
    },
    {
        "id": "pair-100",
        "level": "N2",
        "pattern": "eru-u",
        "concept": "arrange / be ready",
        "vt": {"expression": "整える", "reading": "ととのえる", "meaning": "to arrange / prepare", "particle": "を", "example_hint": "服装を整える"},
        "vi": {"expression": "整う", "reading": "ととのう", "meaning": "to be prepared / in order", "particle": "が", "example_hint": "準備が整う"},
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
