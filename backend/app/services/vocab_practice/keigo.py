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
    {
        "id": "keigo-016",
        "base_verb": "寝る",
        "base_reading": "ねる",
        "concept": "sleep / go to bed",
        "level": "N4",
        "sonkeigo": {
            "expression": "お休みになる",
            "reading": "おやすみになる",
            "meaning": "to sleep / rest (respectful)",
            "nuance": "Polite respectful way to refer to someone sleeping.",
            "example_sentence": "社長はもうお休みになりました。",
        },
        "kenjougo": {
            "expression": "休ませていただく",
            "reading": "やすませていただく",
            "meaning": "to take rest / go to bed (humble)",
            "nuance": "Humbly excusing oneself to rest.",
            "example_sentence": "本日は先に休ませていただきます。",
        },
        "teineigo": {
            "expression": "寝ます",
            "reading": "ねます",
            "meaning": "to sleep (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "十一時に寝ます。",
        },
    },
    {
        "id": "keigo-017",
        "base_verb": "帰る",
        "base_reading": "かえる",
        "concept": "return home / leave",
        "level": "N4",
        "sonkeigo": {
            "expression": "お帰りになる",
            "reading": "おかえりになる",
            "meaning": "to go home / return (respectful)",
            "nuance": "Used when a guest or superior leaves for home.",
            "example_sentence": "先生は先ほどお帰りになりました。",
        },
        "kenjougo": {
            "expression": "失礼する",
            "reading": "しつれいする",
            "meaning": "to take one's leave (humble)",
            "nuance": "Standard humble phrase when leaving work or a room.",
            "example_sentence": "お先に失礼いたします。",
        },
        "teineigo": {
            "expression": "帰ります",
            "reading": "かえります",
            "meaning": "to return home (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "これから家に帰ります。",
        },
    },
    {
        "id": "keigo-018",
        "base_verb": "休む",
        "base_reading": "やすむ",
        "concept": "take a break / be absent",
        "level": "N4",
        "sonkeigo": {
            "expression": "お休みになる",
            "reading": "おやすみになる",
            "meaning": "to take a day off / rest (respectful)",
            "nuance": "Used when a superior takes leave or rests.",
            "example_sentence": "部長は今日お休みになります。",
        },
        "kenjougo": {
            "expression": "お休みをいただく",
            "reading": "おやすみをいただく",
            "meaning": "to take leave (humble)",
            "nuance": "Humbly asking for or taking a day off.",
            "example_sentence": "来週の月曜日にお休みをいただきたく存じます。",
        },
        "teineigo": {
            "expression": "休みます",
            "reading": "やすみます",
            "meaning": "to rest / be absent (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "風邪で会社を休みます。",
        },
    },
    {
        "id": "keigo-019",
        "base_verb": "着る",
        "base_reading": "きる",
        "concept": "wear / put on",
        "level": "N3",
        "sonkeigo": {
            "expression": "お召しになる",
            "reading": "おめしになる",
            "meaning": "to wear / put on (respectful)",
            "nuance": "Special respectful verb for wearing clothes.",
            "example_sentence": "お客様が素敵なコートをお召しになっています。",
        },
        "kenjougo": {
            "expression": "着用する",
            "reading": "ちゃくようする",
            "meaning": "to wear (formal/humble)",
            "nuance": "Formal expression used in workplace or notices.",
            "example_sentence": "会議にはスーツを着用して参ります。",
        },
        "teineigo": {
            "expression": "着ます",
            "reading": "きます",
            "meaning": "to wear (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "新しいシャツを着ます。",
        },
    },
    {
        "id": "keigo-020",
        "base_verb": "座る",
        "base_reading": "すわる",
        "concept": "sit down",
        "level": "N3",
        "sonkeigo": {
            "expression": "お掛けになる",
            "reading": "おかけになる",
            "meaning": "to sit down (respectful)",
            "nuance": "Used when inviting guests or superiors to sit (お掛けください).",
            "example_sentence": "どうぞこちらにお掛けになってください。",
        },
        "kenjougo": {
            "expression": "着席する",
            "reading": "ちゃくせきする",
            "meaning": "to take a seat (formal)",
            "nuance": "Formal/humble way to state taking one's seat.",
            "example_sentence": "皆様が揃いましたので着席いたします。",
        },
        "teineigo": {
            "expression": "座ります",
            "reading": "すわります",
            "meaning": "to sit (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "椅子に座ります。",
        },
    },
    {
        "id": "keigo-021",
        "base_verb": "見せる",
        "base_reading": "みせる",
        "concept": "show",
        "level": "N3",
        "sonkeigo": {
            "expression": "お見せになる",
            "reading": "おみせになる",
            "meaning": "to show (respectful)",
            "nuance": "Elevates the action of someone showing something.",
            "example_sentence": "先生が写真をお見せになりました。",
        },
        "kenjougo": {
            "expression": "お目にかける",
            "reading": "おめにかける",
            "meaning": "to show (humble)",
            "nuance": "Humble expression for showing something to a superior.",
            "example_sentence": "新しい資料をお目にかけます。",
        },
        "teineigo": {
            "expression": "見せます",
            "reading": "みせます",
            "meaning": "to show (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "写真を見せます。",
        },
    },
    {
        "id": "keigo-022",
        "base_verb": "送る",
        "base_reading": "おくる",
        "concept": "send",
        "level": "N3",
        "sonkeigo": {
            "expression": "お送りになる",
            "reading": "おおくりになる",
            "meaning": "to send (respectful)",
            "nuance": "Used when a client or superior sends something.",
            "example_sentence": "部長が資料をお送りになりました。",
        },
        "kenjougo": {
            "expression": "お送りする",
            "reading": "おおくりする",
            "meaning": "to send (humble)",
            "nuance": "Humble way to say you will send an email or package.",
            "example_sentence": "後ほどメールにてお送りいたします。",
        },
        "teineigo": {
            "expression": "送ります",
            "reading": "おくります",
            "meaning": "to send (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "荷物を送ります。",
        },
    },
    {
        "id": "keigo-023",
        "base_verb": "呼ぶ",
        "base_reading": "よぶ",
        "concept": "call / invite",
        "level": "N3",
        "sonkeigo": {
            "expression": "お呼びになる",
            "reading": "およびになる",
            "meaning": "to call / summon (respectful)",
            "nuance": "Used when a superior calls someone.",
            "example_sentence": "課長がお呼びになっています。",
        },
        "kenjougo": {
            "expression": "お呼びする",
            "reading": "およびする",
            "meaning": "to call / invite (humble)",
            "nuance": "Speaker humbly calls or invites someone.",
            "example_sentence": "準備ができ次第お呼びいたします。",
        },
        "teineigo": {
            "expression": "呼びます",
            "reading": "よびます",
            "meaning": "to call (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "タクシーを呼びます。",
        },
    },
    {
        "id": "keigo-024",
        "base_verb": "使う",
        "base_reading": "つかう",
        "concept": "use",
        "level": "N3",
        "sonkeigo": {
            "expression": "お使いになる",
            "reading": "おつかいになる",
            "meaning": "to use (respectful)",
            "nuance": "Respectful form for someone using an item or facility.",
            "example_sentence": "こちらの会議室をお使いください。",
        },
        "kenjougo": {
            "expression": "使わせていただく",
            "reading": "つかわせていただく",
            "meaning": "to be allowed to use (humble)",
            "nuance": "Humble permission-seeking form when using another's resource.",
            "example_sentence": "お借りした資料を使わせていただきます。",
        },
        "teineigo": {
            "expression": "使います",
            "reading": "つかいます",
            "meaning": "to use (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "このパソコンを使います。",
        },
    },
    {
        "id": "keigo-025",
        "base_verb": "書く",
        "base_reading": "かく",
        "concept": "write",
        "level": "N3",
        "sonkeigo": {
            "expression": "お書きになる",
            "reading": "おかきになる",
            "meaning": "to write (respectful)",
            "nuance": "Elevates the other person's writing.",
            "example_sentence": "こちらにお名前をお書きください。",
        },
        "kenjougo": {
            "expression": "書かせていただく",
            "reading": "かかせていただく",
            "meaning": "to write (humble)",
            "nuance": "Humble form when writing on behalf of or for someone.",
            "example_sentence": "報告書を書かせていただきます。",
        },
        "teineigo": {
            "expression": "書きます",
            "reading": "かきます",
            "meaning": "to write (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "レポートを書きます。",
        },
    },
    {
        "id": "keigo-026",
        "base_verb": "死ぬ / 亡くなる",
        "base_reading": "しぬ / なくなる",
        "concept": "pass away",
        "level": "N3",
        "sonkeigo": {
            "expression": "お亡くなりになる",
            "reading": "おなくなりになる",
            "meaning": "to pass away (respectful)",
            "nuance": "Standard respectful euphemism for someone's passing.",
            "example_sentence": "先月、祖父がお亡くなりになりました。",
        },
        "kenjougo": {
            "expression": "他界する",
            "reading": "たかいする",
            "meaning": "to pass away (formal)",
            "nuance": "Formal expression used for one's own family or announcements.",
            "example_sentence": "母は昨年他界いたしました。",
        },
        "teineigo": {
            "expression": "亡くなります",
            "reading": "なくなります",
            "meaning": "to pass away (polite)",
            "nuance": "Polite standard.",
            "example_sentence": "去年亡くなりました。",
        },
    },
    {
        "id": "keigo-027",
        "base_verb": "受け取る",
        "base_reading": "うけとる",
        "concept": "receive / accept",
        "level": "N3",
        "sonkeigo": {
            "expression": "お受け取りになる",
            "reading": "おうけとりになる",
            "meaning": "to receive (respectful)",
            "nuance": "Used when a client or superior receives an item.",
            "example_sentence": "商品をお受け取りになりましたか。",
        },
        "kenjougo": {
            "expression": "拝受する",
            "reading": "はいじゅする",
            "meaning": "to humbly receive (humble)",
            "nuance": "Formal business keigo for receiving documents or emails.",
            "example_sentence": "添付の資料を確かに拝受いたしました。",
        },
        "teineigo": {
            "expression": "受け取ります",
            "reading": "うけとります",
            "meaning": "to receive (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "手紙を受け取ります。",
        },
    },
    {
        "id": "keigo-028",
        "base_verb": "確認する",
        "base_reading": "かくにんする",
        "concept": "confirm / check",
        "level": "N3",
        "sonkeigo": {
            "expression": "ご確認になる",
            "reading": "ごかくにんになる",
            "meaning": "to check / confirm (respectful)",
            "nuance": "Frequently used as ご確認ください in business.",
            "example_sentence": "部長が詳細をご確認になりました。",
        },
        "kenjougo": {
            "expression": "確認いたす",
            "reading": "かくにんいたす",
            "meaning": "to confirm / check (humble)",
            "nuance": "Humble business form (確認いたします).",
            "example_sentence": "ただいま日程を確認いたします。",
        },
        "teineigo": {
            "expression": "確認します",
            "reading": "かくにんします",
            "meaning": "to confirm (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "予定を確認します。",
        },
    },
    {
        "id": "keigo-029",
        "base_verb": "案内する",
        "base_reading": "あんないする",
        "concept": "guide / show around",
        "level": "N3",
        "sonkeigo": {
            "expression": "ご案内になる",
            "reading": "ごあんないになる",
            "meaning": "to guide / inform (respectful)",
            "nuance": "Elevates someone's guidance or announcement.",
            "example_sentence": "係の者がご案内になります。",
        },
        "kenjougo": {
            "expression": "ご案内いたす",
            "reading": "ごあんないいたす",
            "meaning": "to guide / show around (humble)",
            "nuance": "Humble hospitality phrase (ご案内いたします).",
            "example_sentence": "お席までご案内いたします。",
        },
        "teineigo": {
            "expression": "案内します",
            "reading": "あんないします",
            "meaning": "to guide (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "駅まで案内します。",
        },
    },
    {
        "id": "keigo-030",
        "base_verb": "連絡する",
        "base_reading": "れんらくする",
        "concept": "contact / get in touch",
        "level": "N3",
        "sonkeigo": {
            "expression": "ご連絡くださる",
            "reading": "ごれんらくくださる",
            "meaning": "to contact (respectful)",
            "nuance": "Used when asking or thanking someone for contacting you.",
            "example_sentence": "お決まりになりましたらご連絡ください。",
        },
        "kenjougo": {
            "expression": "ご連絡いたす",
            "reading": "ごれんらくいたす",
            "meaning": "to contact (humble)",
            "nuance": "Humble form when promising to follow up (ご連絡いたします).",
            "example_sentence": "分かり次第、すぐにご連絡いたします。",
        },
        "teineigo": {
            "expression": "連絡します",
            "reading": "れんらくします",
            "meaning": "to contact (polite)",
            "nuance": "Standard polite.",
            "example_sentence": "明日連絡します。",
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

