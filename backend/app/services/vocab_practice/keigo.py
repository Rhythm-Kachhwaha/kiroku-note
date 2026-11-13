"""Curated Japanese Keigo (Honorifics) Service.

Provides canonical Sonkeigo (尊敬語 - respectful language for others' actions),
Kenjougo (謙譲語 - humble language for speaker's actions), and Teineigo (丁寧語 - polite language),
with plain verb bases, business nuance notes, and learner mastery states from SQLite.
"""
from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field

from app.db.connection import db_session, get_db_path


class KeigoFormDetail(BaseModel):
    expression: str
    reading: str
    meaning: str
    nuance: str = ""
    example_sentence: str = ""
    state: str = "unseen"  # 'known' | 'learning' | 'unseen'
    is_mined: bool = False
    card_id: Optional[int] = None


class KeigoTrio(BaseModel):
    id: str
    base_verb: str
    base_reading: str
    english_concept: str
    level: str  # e.g., 'N4', 'N3', 'N2', 'N1'
    sonkeigo: KeigoFormDetail  # 尊敬語 (Respectful)
    kenjougo: KeigoFormDetail  # 謙譲語 (Humble)
    teineigo: Optional[KeigoFormDetail] = None  # 丁寧語 (Polite)
    mastery_status: str = "unseen"  # 'mastered' | 'learning' | 'unseen'


class KeigoSummary(BaseModel):
    total_trios: int
    sonkeigo_count: int
    kenjougo_count: int
    mastered_count: int
    learning_count: int
    unseen_count: int


# Canonical curated Keigo verbs dataset
CANONICAL_KEIGO_TRIOS: tuple[dict[str, Any], ...] = (
    {
        "id": "keigo-001",
        "base_verb": "行く / 来る / いる",
        "base_reading": "いく / くる / いる",
        "concept": "go / come / exist",
        "level": "N4",
        "sonkeigo": {
            "expression": "いらっしゃる",
            "reading": "いらっしゃる",
            "meaning": "to go / come / be (respectful)",
            "nuance": "Used when describing actions of superiors or clients.",
            "example_sentence": "先生は明日研究室にいらっしゃいます。",
        },
        "kenjougo": {
            "expression": "参る",
            "reading": "まいる",
            "meaning": "to go / come (humble)",
            "nuance": "Used when describing speaker's own movement towards superior.",
            "example_sentence": "明日十時に御社へ参ります。",
        },
        "teineigo": {
            "expression": "行きます / 来ます",
            "reading": "いきます / きます",
            "meaning": "to go / come (polite standard)",
            "nuance": "General polite form.",
            "example_sentence": "明日伺います。",
        },
    },
    {
        "id": "keigo-002",
        "base_verb": "言う",
        "base_reading": "いう",
        "concept": "say / speak",
        "level": "N4",
        "sonkeigo": {
            "expression": "おっしゃる",
            "reading": "おっしゃる",
            "meaning": "to say / state (respectful)",
            "nuance": "Elevates the other party's words.",
            "example_sentence": "部長がそのようにおっしゃいました。",
        },
        "kenjougo": {
            "expression": "申す",
            "reading": "もうす",
            "meaning": "to say / be called (humble)",
            "nuance": "Lowers speaker's own speech; also used in introductions.",
            "example_sentence": "田中と申します。よろしくお願いいたします。",
        },
        "teineigo": {
            "expression": "言います",
            "reading": "いいます",
            "meaning": "to say (polite)",
            "nuance": "Polite form.",
            "example_sentence": "そのように言いました。",
        },
    },
    {
        "id": "keigo-003",
        "base_verb": "する",
        "base_reading": "する",
        "concept": "do / execute",
        "level": "N4",
        "sonkeigo": {
            "expression": "なさる",
            "reading": "なさる",
            "meaning": "to do (respectful)",
            "nuance": "Elevates action performed by another party.",
            "example_sentence": "週末は何をなさいますか。",
        },
        "kenjougo": {
            "expression": "致す",
            "reading": "いたす",
            "meaning": "to do (humble)",
            "nuance": "Lowers speaker's own actions (e.g. 努力いたします).",
            "example_sentence": "私がその業務を担当いたします。",
        },
        "teineigo": {
            "expression": "します",
            "reading": "します",
            "meaning": "to do (polite)",
            "nuance": "Standard polite form.",
            "example_sentence": "準備をします。",
        },
    },
    {
        "id": "keigo-004",
        "base_verb": "食べる / 飲む",
        "base_reading": "たべる / のむ",
        "concept": "eat / drink",
        "level": "N4",
        "sonkeigo": {
            "expression": "召し上がる",
            "reading": "めしあがる",
            "meaning": "to eat / drink (respectful)",
            "nuance": "Respectfully offers or describes eating/drinking.",
            "example_sentence": "どうぞ温かいうちに召し上がってください。",
        },
        "kenjougo": {
            "expression": "いただく",
            "reading": "いただく",
            "meaning": "to receive / eat / drink (humble)",
            "nuance": "Humbly partakes in food or gifts received.",
            "example_sentence": "ありがたく頂戴いたします。",
        },
        "teineigo": {
            "expression": "食べます / 飲みます",
            "reading": "たべます / のみます",
            "meaning": "to eat / drink (polite)",
            "nuance": "Standard polite form.",
            "example_sentence": "お茶を飲みます。",
        },
    },
    {
        "id": "keigo-005",
        "base_verb": "見る",
        "base_reading": "みる",
        "concept": "look / see",
        "level": "N4",
        "sonkeigo": {
            "expression": "ご覧になる",
            "reading": "ごらんになる",
            "meaning": "to look at / inspect (respectful)",
            "nuance": "Respectfully asks someone to view something (ご覧ください).",
            "example_sentence": "こちらの資料をご覧になりましたか。",
        },
        "kenjougo": {
            "expression": "拝見する",
            "reading": "はいけんする",
            "meaning": "to look at / read (humble)",
            "nuance": "Humbly looks at documents or work belonging to another.",
            "example_sentence": "送っていただいた企画書を拝見しました。",
        },
        "teineigo": {
            "expression": "見ます",
            "reading": "みます",
            "meaning": "to see / look (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "映画を見ます。",
        },
    },
    {
        "id": "keigo-006",
        "base_verb": "聞く / 尋ねる / 訪ねる",
        "base_reading": "きく / たずねる",
        "concept": "ask / hear / visit",
        "level": "N3",
        "sonkeigo": {
            "expression": "お聞きになる",
            "reading": "おききになる",
            "meaning": "to hear / listen / ask (respectful)",
            "nuance": "Elevates listening or inquiring action.",
            "example_sentence": "その件について既にお聞きになりましたか。",
        },
        "kenjougo": {
            "expression": "伺う",
            "reading": "うかがう",
            "meaning": "to ask / hear / visit (humble)",
            "nuance": "Humbly visits (伺う) or asks questions (お伺いします).",
            "example_sentence": "明日午後二時にオフィスへ伺います。",
        },
        "teineigo": {
            "expression": "聞きます",
            "reading": "ききます",
            "meaning": "to ask / hear (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "先生に聞きます。",
        },
    },
    {
        "id": "keigo-007",
        "base_verb": "知っている",
        "base_reading": "しっている",
        "concept": "know / be acquainted with",
        "level": "N4",
        "sonkeigo": {
            "expression": "ご存じ",
            "reading": "ごぞんじ",
            "meaning": "to know (respectful: ご存じです / ご存じですか)",
            "nuance": "Respectfully asks about someone's knowledge.",
            "example_sentence": "新しい担当者をご存じですか。",
        },
        "kenjougo": {
            "expression": "存じ上げる",
            "reading": "ぞんじあげる",
            "meaning": "to know (humble: 存じております / 存じ上げております)",
            "nuance": "Humbly conveys that speaker knows or is aware.",
            "example_sentence": "その件についてはよく存じております。",
        },
        "teineigo": {
            "expression": "知っています",
            "reading": "しっています",
            "meaning": "to know (polite)",
            "nuance": "Standard polite form.",
            "example_sentence": "その本を知っています。",
        },
    },
    {
        "id": "keigo-008",
        "base_verb": "会う",
        "base_reading": "あう",
        "concept": "meet / encounter",
        "level": "N3",
        "sonkeigo": {
            "expression": "お会いになる",
            "reading": "おあいになる",
            "meaning": "to meet (respectful)",
            "nuance": "Used when superior meets someone.",
            "example_sentence": "社長とお会いになりましたか。",
        },
        "kenjougo": {
            "expression": "お目にかかる",
            "reading": "おめにかかる",
            "meaning": "to meet / see (humble)",
            "nuance": "Humble phrase used when privileged to meet someone.",
            "example_sentence": "またお目にかかれて光栄です。",
        },
        "teineigo": {
            "expression": "会います",
            "reading": "あいます",
            "meaning": "to meet (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "友達と会います。",
        },
    },
    {
        "id": "keigo-009",
        "base_verb": "もらう",
        "base_reading": "もらう",
        "concept": "receive / accept",
        "level": "N4",
        "sonkeigo": {
            "expression": "お受け取りになる",
            "reading": "おうけとりになる",
            "meaning": "to receive (respectful)",
            "nuance": "Respectfully asks client or superior to accept.",
            "example_sentence": "お荷物をお受け取りになりましたか。",
        },
        "kenjougo": {
            "expression": "いただく / 頂戴する",
            "reading": "いただく / ちょうだいする",
            "meaning": "to receive (humble)",
            "nuance": "Expresses gratitude for receiving something from superior.",
            "example_sentence": "ご丁寧なお返事をいただき感謝いたします。",
        },
        "teineigo": {
            "expression": "もらいます",
            "reading": "もらいます",
            "meaning": "to receive (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "プレゼントをもらいました。",
        },
    },
    {
        "id": "keigo-010",
        "base_verb": "あげる / くれる",
        "base_reading": "あげる / くれる",
        "concept": "give / bestow",
        "level": "N4",
        "sonkeigo": {
            "expression": "くださる",
            "reading": "くださる",
            "meaning": "to give (to speaker: respectful)",
            "nuance": "Superior gives to speaker (先生が本をくださった).",
            "example_sentence": "アドバイスをくださりありがとうございます。",
        },
        "kenjougo": {
            "expression": "差し上げる",
            "reading": "さしあげる",
            "meaning": "to give / present to (humble)",
            "nuance": "Speaker humbly gives or presents something to another.",
            "example_sentence": "新しいカタログを差し上げます。",
        },
        "teineigo": {
            "expression": "あげます",
            "reading": "あげます",
            "meaning": "to give (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "お花をあげます。",
        },
    },
    {
        "id": "keigo-011",
        "base_verb": "思う",
        "base_reading": "おもう",
        "concept": "think / consider",
        "level": "N3",
        "sonkeigo": {
            "expression": "お思いになる",
            "reading": "おおもいになる",
            "meaning": "to think (respectful)",
            "nuance": "Elevates thoughts or judgment of a superior.",
            "example_sentence": "今回の提案についてどうお思いになりますか。",
        },
        "kenjougo": {
            "expression": "存じる",
            "reading": "ぞんじる",
            "meaning": "to think / feel (humble)",
            "nuance": "Humbly expresses speaker's thought (～と存じます).",
            "example_sentence": "大変ありがたく存じます。",
        },
        "teineigo": {
            "expression": "思います",
            "reading": "おもいます",
            "meaning": "to think (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "いいと思います。",
        },
    },
    {
        "id": "keigo-012",
        "base_verb": "読む",
        "base_reading": "よむ",
        "concept": "read / peruse",
        "level": "N3",
        "sonkeigo": {
            "expression": "お読みになる",
            "reading": "およみになる",
            "meaning": "to read (respectful)",
            "nuance": "Used when a superior reads something.",
            "example_sentence": "記事をお読みになりましたか。",
        },
        "kenjougo": {
            "expression": "拝読する",
            "reading": "はいどくする",
            "meaning": "to read (humble)",
            "nuance": "Humbly reads letter or publication written by superior.",
            "example_sentence": "先生のご著書を拝読いたしました。",
        },
        "teineigo": {
            "expression": "読みます",
            "reading": "よみます",
            "meaning": "to read (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "本を読みます。",
        },
    },
    {
        "id": "keigo-013",
        "base_verb": "借りる",
        "base_reading": "かりる",
        "concept": "borrow",
        "level": "N2",
        "sonkeigo": {
            "expression": "お借りになる",
            "reading": "おかりになる",
            "meaning": "to borrow (respectful)",
            "nuance": "Superior borrows an item.",
            "example_sentence": "本をお借りになりましたか。",
        },
        "kenjougo": {
            "expression": "拝借する",
            "reading": "はいしゃくする",
            "meaning": "to borrow (humble)",
            "nuance": "Humbly borrows object or time (お知恵を拝借する).",
            "example_sentence": "ペンを拝借してもよろしいでしょうか。",
        },
        "teineigo": {
            "expression": "借ります",
            "reading": "かります",
            "meaning": "to borrow (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "本を借ります。",
        },
    },
    {
        "id": "keigo-014",
        "base_verb": "伝える",
        "base_reading": "つたえる",
        "concept": "convey / tell",
        "level": "N3",
        "sonkeigo": {
            "expression": "お伝えになる",
            "reading": "おつたえになる",
            "meaning": "to convey / pass message (respectful)",
            "nuance": "Superior conveys information.",
            "example_sentence": "部長にお伝えになりましたか。",
        },
        "kenjougo": {
            "expression": "申し伝える",
            "reading": "もうしつたえる",
            "meaning": "to convey (humble: e.g. to a client about a colleague)",
            "nuance": "Used when promising to pass a message to one's internal team.",
            "example_sentence": "担当の者に申し伝えておきます。",
        },
        "teineigo": {
            "expression": "伝えます",
            "reading": "つたえます",
            "meaning": "to convey (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "伝言を伝えます。",
        },
    },
    {
        "id": "keigo-015",
        "base_verb": "待つ",
        "base_reading": "まつ",
        "concept": "wait",
        "level": "N4",
        "sonkeigo": {
            "expression": "お待ちになる",
            "reading": "おまちになる",
            "meaning": "to wait (respectful: お待ちください)",
            "nuance": "Respectfully asks someone to wait.",
            "example_sentence": "少々お待ちいただけますか。",
        },
        "kenjougo": {
            "expression": "お待ちする",
            "reading": "おまちする",
            "meaning": "to wait for (humble)",
            "nuance": "Speaker humbly waits for superior or guest.",
            "example_sentence": "ロビーにてお待ちしております。",
        },
        "teineigo": {
            "expression": "待ちます",
            "reading": "まちます",
            "meaning": "to wait (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "ここで待ちます。",
        },
    },
)


def get_keigo_entries(
    keigo_type: Optional[str] = None,
    level: Optional[str] = None,
    db_path: Optional[Any] = None,
) -> list[KeigoTrio]:
    """Retrieve canonical Keigo trios with learner mastery cross-referenced from SQLite."""
    actual_db = db_path or get_db_path()

    states_by_expr: dict[str, str] = {}
    cards_by_expr: dict[str, int] = {}

    try:
        with db_session(actual_db) as conn:
            rows = conn.execute("SELECT expression, state FROM word_states").fetchall()
            for r in rows:
                expr = r["expression"]
                st = r["state"] or "unseen"
                if expr:
                    states_by_expr[expr] = st

            card_rows = conn.execute("SELECT id, expression FROM cards").fetchall()
            for cr in card_rows:
                expr = cr["expression"]
                if expr and expr not in cards_by_expr:
                    cards_by_expr[expr] = cr["id"]
    except Exception:
        pass

    results: list[KeigoTrio] = []

    for item in CANONICAL_KEIGO_TRIOS:
        if level and level.strip().upper() != "ALL" and item["level"].upper() != level.strip().upper():
            continue

        son_data = item["sonkeigo"]
        ken_data = item["kenjougo"]
        tei_data = item.get("teineigo")

        son_expr = son_data["expression"]
        ken_expr = ken_data["expression"]

        son_state = states_by_expr.get(son_expr, "learning" if son_expr in cards_by_expr else "unseen")
        ken_state = states_by_expr.get(ken_expr, "learning" if ken_expr in cards_by_expr else "unseen")

        son_card = cards_by_expr.get(son_expr)
        ken_card = cards_by_expr.get(ken_expr)

        if son_state == "known" and ken_state == "known":
            mastery = "mastered"
        elif son_state == "known" or ken_state == "known" or son_state == "learning" or ken_state == "learning":
            mastery = "learning"
        else:
            mastery = "unseen"

        son_detail = KeigoFormDetail(
            expression=son_expr,
            reading=son_data["reading"],
            meaning=son_data["meaning"],
            nuance=son_data.get("nuance", ""),
            example_sentence=son_data.get("example_sentence", ""),
            state=son_state,
            is_mined=bool(son_card),
            card_id=son_card,
        )

        ken_detail = KeigoFormDetail(
            expression=ken_expr,
            reading=ken_data["reading"],
            meaning=ken_data["meaning"],
            nuance=ken_data.get("nuance", ""),
            example_sentence=ken_data.get("example_sentence", ""),
            state=ken_state,
            is_mined=bool(ken_card),
            card_id=ken_card,
        )

        tei_detail = None
        if tei_data:
            tei_expr = tei_data["expression"]
            tei_state = states_by_expr.get(tei_expr, "unseen")
            tei_card = cards_by_expr.get(tei_expr)
            tei_detail = KeigoFormDetail(
                expression=tei_expr,
                reading=tei_data["reading"],
                meaning=tei_data["meaning"],
                nuance=tei_data.get("nuance", ""),
                example_sentence=tei_data.get("example_sentence", ""),
                state=tei_state,
                is_mined=bool(tei_card),
                card_id=tei_card,
            )

        trio = KeigoTrio(
            id=item["id"],
            base_verb=item["base_verb"],
            base_reading=item["base_reading"],
            english_concept=item["concept"],
            level=item["level"],
            sonkeigo=son_detail,
            kenjougo=ken_detail,
            teineigo=tei_detail,
            mastery_status=mastery,
        )
        results.append(trio)

    return results


def get_keigo_summary(db_path: Optional[Any] = None) -> KeigoSummary:
    """Return summary statistics for Keigo trios."""
    entries = get_keigo_entries(db_path=db_path)
    total = len(entries)
    mastered = sum(1 for e in entries if e.mastery_status == "mastered")
    learning = sum(1 for e in entries if e.mastery_status == "learning")
    unseen = sum(1 for e in entries if e.mastery_status == "unseen")

    return KeigoSummary(
        total_trios=total,
        sonkeigo_count=total,
        kenjougo_count=total,
        mastered_count=mastered,
        learning_count=learning,
        unseen_count=unseen,
    )

