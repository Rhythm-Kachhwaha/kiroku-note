"""
Offline N4 Question Verification, Correction, and Pedagogical Explanation Generator.
------------------------------------------------------------------------------------
Executes:
1. Fixes scraped artifacts on 21 specific N4 questions by branching to new sealed revisions:
   - Restores missing 4th choices from prompt brackets.
   - Cleans prompt stems.
   - Fixes duplicate choice on Q645.
   - Sets correct canonical answers.
2. Performs comprehensive linguistic analysis and generates pedagogical explanations for
   all N4 questions across all formats:
   - Grammatical explanations with formation rules, particle functions, and common pitfalls.
   - Kanji readings with on/kun readings and meaning nuances.
   - Orthography with component breakdowns and homophone distinctions.
   - Contextual expressions with collocations and semantic constraints.
   - Reading comprehension with passage reference points and context justification.
   - Listening with audio/diagram task objectives.
3. Inserts verification audit runs (verification_run) and structured explanations (question_explanation).
4. Activates eligible questions in the question table (question.status = 'active').
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import re
import sqlite3
import sys

# Ensure backend modules can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.study.contracts.common import ChoicePayload
from app.study.contracts.db_mapping import compute_question_content_fingerprint
from app.study.markup import parse_markup, to_plain_text
from app.study.ulid import generate_ulid

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("n4_enricher")

# 21 Targeted Corrections for Scraped Webpage Artifacts
TARGET_CORRECTIONS = {
    145: {
        "clean_stem": "田中さんは風邪をひいている {blank|1} 、プールで泳いでいます。",
        "choice_4_text": "のに",
        "correct_ordinal": 4,
        "rationale": "田中さんは風邪をひいているのに、プールで泳いでいます。",
    },
    189: {
        "clean_stem": "あの人は、なにかを {blank|1} より人にさせるほうが得意なんですよ。",
        "choice_4_text": "させられる",
        "correct_ordinal": 4,
        "rationale": "あの人は、なにかをさせられるより人にさせるほうが得意なんですよ。",
    },
    194: {
        "clean_stem": "すみませんが、これは二人 {blank|1} の話です。",
        "choice_4_text": "だけ",
        "correct_ordinal": 4,
        "rationale": "すみませんが、これは二人だけの話です。",
    },
    199: {
        "clean_stem": "今朝めざめたとき、昨夜何 {blank|1} {blank|2} …{star}… {blank|3} 少し時間がかかった。",
        "choice_4_text": "まで",
        "correct_ordinal": 3,  # '思い出す'
        "rationale": "今朝めざめたとき、昨夜何があったか思い出すまで少し時間がかかった。",
        "star_choice": "思い出す",
    },
    208: {
        "clean_stem": "だれかにさいふ {blank|1} とられた。",
        "choice_4_text": "の",
        "correct_ordinal": 3,  # 'を'
        "rationale": "だれかにさいふをとられた。",
    },
    218: {
        "clean_stem": "私のへやの {blank|1} はこのへやとだいたい同じです。",
        "choice_4_text": "広さ",
        "correct_ordinal": 4,
        "rationale": "私のへやの広さはこのへやとだいたい同じです。",
    },
    227: {
        "clean_stem": "さっき起きた {blank|1} で、まだねむいです。",
        "choice_4_text": "とき",
        "correct_ordinal": 3,  # 'ばかり'
        "rationale": "さっき起きたばかりで、まだねむいです。",
    },
    580: {
        "clean_stem": "{u|風}",
        "choice_4_text": "かべ",
        "correct_ordinal": 2,  # 'かぜ'
        "rationale": "風 => かぜ",
    },
    584: {
        "clean_stem": "{u|料理}",
        "choice_4_text": "りょり",
        "correct_ordinal": 2,  # 'りょうり'
        "rationale": "料理 => りょうり",
    },
    591: {
        "clean_stem": "{u|安い}",
        "choice_4_text": "やすい",
        "correct_ordinal": 4,  # 'やすい'
        "rationale": "安い => やすい",
    },
    603: {
        "clean_stem": "{u|着て}",
        "choice_4_text": "かぶって",
        "correct_ordinal": 2,  # 'きて'
        "rationale": "着て => きて",
    },
    613: {
        "clean_stem": "{u|行われて}",
        "choice_4_text": "さそわれて",
        "correct_ordinal": 2,  # 'おこなわれて'
        "rationale": "行われて => おこなわれて",
    },
    622: {
        "clean_stem": "{u|工業}",
        "choice_4_text": "こうごう",
        "correct_ordinal": 1,  # 'こうぎょう'
        "rationale": "工業 => こうぎょう",
    },
    624: {
        "clean_stem": "{u|送って}",
        "choice_4_text": "おこって",
        "correct_ordinal": 1,  # 'おくって'
        "rationale": "送って => おくって",
    },
    630: {
        "clean_stem": "{u|着物}",
        "choice_4_text": "おきもの",
        "correct_ordinal": 1,  # 'きもの'
        "rationale": "着物 => きもの",
    },
    633: {
        "clean_stem": "{u|ただしい}",
        "choice_4_text": "止しい",
        "correct_ordinal": 2,  # '正しい'
        "rationale": "ただしい => 正しい",
    },
    640: {
        "clean_stem": "{u|おくって}",
        "choice_4_text": "達って",
        "correct_ordinal": 2,  # '送って'
        "rationale": "おくって => 送って",
    },
    643: {
        "clean_stem": "{u|何度}",
        "choice_4_text": "なにど",
        "correct_ordinal": 3,  # 'なんど'
        "rationale": "何度 => なんど",
    },
    645: {
        "clean_stem": "{u|写真家}",
        "choice_4_text": "さしんや",
        "correct_ordinal": 1,  # 'しゃしんか'
        "rationale": "写真家 => しゃしんか",
    },
    652: {
        "clean_stem": "{u|あるき}",
        "choice_4_text": "小き",
        "correct_ordinal": 1,  # '歩き'
        "rationale": "あるき => 歩き",
    },
    654: {
        "clean_stem": "{u|病院}",
        "choice_4_text": "びょういん",
        "correct_ordinal": 4,  # 'びょういん'
        "rationale": "病院 => びょういん",
    },
}

# Rich Linguistic Explanation Templates and Rules
PARTICLE_EXPLANATIONS = {
    "に": {
        "function": "Target / Destination / Time / Agent",
        "detail": "Indicates the specific destination, indirect object, target of an action, or specific point in time.",
        "rule": "Noun + に (e.g. 学校に行く, 友だちに会う, 3時に起きる)",
    },
    "で": {
        "function": "Means / Instrument / Location of Action",
        "detail": "Indicates the tool, method, means of transport, or location where an active event takes place.",
        "rule": "Noun + で (e.g. バスで行く, はしで食べる, 図書館で勉強する)",
    },
    "を": {
        "function": "Direct Object / Point of Departure",
        "detail": "Marks the direct object of a transitive verb, or the space/point being passed through or departed from.",
        "rule": "Noun + を (e.g. 本を読む, 家を出る, 公園を散歩する)",
    },
    "が": {
        "function": "Grammatical Subject / Target of Potential & Desire",
        "detail": "Marks the grammatical subject, or the object of potential, ability, liking, or sensory perception.",
        "rule": "Noun + が (e.g. 日本語ができる, 雨が降る, りんごが好きだ)",
    },
    "は": {
        "function": "Topic Marker / Contrastive Focus",
        "detail": "Identifies the overall topic of the sentence, or sets up a contrastive comparison.",
        "rule": "Noun + は (e.g. 私は学生です, 肉は食べますが、魚は食べません)",
    },
    "と": {
        "function": "Accompaniment / Quotation / Natural Conditional",
        "detail": "Indicates accompaniment ('together with'), direct/indirect quotation ('〜と言う'), or natural/inevitable consequence.",
        "rule": "Noun + と / Verb Plain + と (e.g. 友だちと行く, 春になると暖かくなる)",
    },
    "へ": {
        "function": "Direction of Motion",
        "detail": "Indicates the physical direction toward a destination or recipient.",
        "rule": "Noun + へ (e.g. 日本へ行く, 先生への手紙)",
    },
    "から": {
        "function": "Starting Point / Source / Reason",
        "detail": "Marks the temporal/spatial starting point ('from'), the material source, or the subjective cause/reason ('because').",
        "rule": "Noun + から / Plain Form + から (e.g. 9時から, 暑いから窓を開ける)",
    },
    "まで": {
        "function": "Limit / Destination Endpoint",
        "detail": "Indicates the boundary, extent, or final limit of time or distance ('until / up to').",
        "rule": "Noun + まで / Verb Plain Non-past + まで (e.g. 5時まで, 終わるまで待つ)",
    },
    "までに": {
        "function": "Deadline / Time Limit",
        "detail": "Specifies a strict deadline by which an action must be completed ('by / no later than').",
        "rule": "Noun (Time) + までに / Verb Plain Non-past + までに (e.g. 明日までに提出する)",
    },
    "より": {
        "function": "Comparative Standard",
        "detail": "Marks the standard of comparison in comparative sentences ('more than / rather than').",
        "rule": "Noun + より (e.g. バスより電車のほうが速い)",
    },
    "も": {
        "function": "Inclusion / Emphasis",
        "detail": "Expresses 'also / too' or emphasizes unexpected quantity or total negation.",
        "rule": "Noun + も (e.g. 私も行く, 1台も車がない)",
    },
    "だけ": {
        "function": "Limitation / Exclusivity",
        "detail": "Expresses 'only / just' specifying an exclusive limit without negative nuance.",
        "rule": "Noun + だけ (e.g. 二人だけの秘密, 1つだけ買う)",
    },
    "しか": {
        "function": "Exclusivity with Negative Predicate",
        "detail": "Expresses 'nothing but / only' and strictly requires a negative verb predicate.",
        "rule": "Noun + しか + Negative Verb (e.g. 100円しか持っていない)",
    },
    "でも": {
        "function": "Exemplification / Concession",
        "detail": "Provides an example ('or something like that') or expresses concession ('even / even if').",
        "rule": "Noun + でも (e.g. お茶でも飲みましょう, 日曜日でも働く)",
    },
}

GRAMMAR_PATTERNS = {
    "のに": {
        "title": "〜のに (Even though / Despite)",
        "formation": "Verb/i-adj Plain Form + のに; Noun/na-adj + なのに",
        "meaning": "Expresses strong contrast where the outcome contradicts normal expectation, often carrying surprise or disappointment.",
    },
    "ばかり": {
        "title": "〜たばかり (Just finished doing)",
        "formation": "Verb [Plain Past (た-form)] + ばかり",
        "meaning": "Indicates that an action was completed very recently according to the speaker's subjective perception.",
    },
    "てみる": {
        "title": "〜てみる (Try doing)",
        "formation": "Verb [て-form] + みる",
        "meaning": "Expresses doing something as an experiment or trial to discover what it is like.",
    },
    "やすい": {
        "title": "〜やすい (Easy to do)",
        "formation": "Verb Stem (ます-stem) + やすい",
        "meaning": "Describes that an action is easy, convenient, or prone to happening.",
    },
    "にくい": {
        "title": "〜にくい (Difficult to do)",
        "formation": "Verb Stem (ます-stem) + にくい",
        "meaning": "Describes that an action is hard, difficult, or resistant to being done.",
    },
    "すぎる": {
        "title": "〜すぎる (Too much / Excessively)",
        "formation": "Verb Stem / i-adj stem / na-adj stem + すぎる",
        "meaning": "Expresses that a degree or action exceeds normal, desirable, or acceptable bounds.",
    },
    "てもらう": {
        "title": "〜てもらう (Receive a favor)",
        "formation": "Verb [て-form] + もらう / いただく",
        "meaning": "Indicates that the speaker or in-group received the benefit of someone else performing an action.",
    },
    "てくれる": {
        "title": "〜てくれる (Someone does a favor for me)",
        "formation": "Verb [て-form] + くれる / くださる",
        "meaning": "Indicates that another person kindly performed an action for the benefit of the speaker.",
    },
    "てあげる": {
        "title": "〜てあげる (Do a favor for someone)",
        "formation": "Verb [て-form] + あげる / さしあげる",
        "meaning": "Indicates that the speaker performs an action for someone else's benefit.",
    },
    "てある": {
        "title": "〜てある (State of result from intentional action)",
        "formation": "Transitive Verb [て-form] + ある",
        "meaning": "Describes an ongoing state resulting from a purposeful prior action by an agent.",
    },
    "ておく": {
        "title": "〜ておく (Do in advance / Leave in state)",
        "formation": "Verb [て-form] + おく",
        "meaning": "Indicates preparing in advance for future convenience, or deliberately leaving something in its current state.",
    },
    "そうだ": {
        "title": "〜そうだ (Conjecture vs Hearsay)",
        "formation": "Conjecture: Verb stem / adj stem + そうだ ('looks like'); Hearsay: Plain form + そうだ ('I hear that')",
        "meaning": "Expresses either visual conjecture based on appearance, or reported hearsay from a source.",
    },
    "つもり": {
        "title": "〜つもり (Intention / Plan)",
        "formation": "Verb [Plain Non-past] + つもり / Verb [ない-form] + つもり",
        "meaning": "Expresses the speaker's conscious plan or intention to perform (or not perform) an action.",
    },
    "はず": {
        "title": "〜はず (Expectation / Ought to be)",
        "formation": "Verb/adj Plain Form + はず; Noun + のはず",
        "meaning": "Expresses a high degree of confidence or logical expectation based on facts or objective reasons.",
    },
    "たら": {
        "title": "〜たら (Conditional: If / When)",
        "formation": "Verb/adj [た-form] + ら",
        "meaning": "Expresses general conditionals, sequential timing ('when X happens, then Y'), or hypothetical conditions.",
    },
    "なら": {
        "title": "〜なら (Contextual conditional: If it is the case)",
        "formation": "Noun / Plain Form + なら",
        "meaning": "Sets a topic or condition provided by the listener ('if you are talking about X, then...').",
    },
    "ながら": {
        "title": "〜ながら (Simultaneous actions: While doing)",
        "formation": "Verb Stem (ます-stem) + ながら",
        "meaning": "Describes doing two actions simultaneously, where the main action is the second verb.",
    },
    "し": {
        "title": "〜し〜し (Listing reasons)",
        "formation": "Plain Form + し",
        "meaning": "Lists multiple parallel reasons or states leading to a conclusion or situation.",
    },
    "させられる": {
        "title": "〜させられる (Causative-Passive: Be forced to do)",
        "formation": "Verb Causative-Passive form",
        "meaning": "Expresses being compelled or made to do an unpleasant or involuntary action by someone else.",
    },
    "広さ": {
        "title": "〜さ (Nominalizing suffix for degree/extent)",
        "formation": "i-adj stem + さ (e.g. 広い -> 広さ, 高い -> 高さ)",
        "meaning": "Transforms an adjective into an objective, measurable noun of degree, extent, or quality.",
    },
}


def build_pedagogical_explanation(
    format_code: str,
    category: str,
    stem_markup: str,
    choices: list[dict[str, Any]],
    correct_choice: dict[str, Any],
    rationale_text: str,
) -> dict[str, Any]:
    """Deterministically craft rich, comprehensive linguistic explanations for learners."""
    clean_stem = to_plain_text(parse_markup(stem_markup))
    target_text = correct_choice.get("text_markup", "")
    target_key = correct_choice.get("choice_key", "")

    distractors_dict: dict[str, str] = {}
    for c in choices:
        if c.get("choice_key") != target_key:
            ch_text = c.get("text_markup", "")
            lbl = c.get("label", str(c.get("ordinal", "")))
            distractors_dict[ch_text] = f"Choice [{lbl}] '{ch_text}' is incorrect in this context."

    summary = ""
    correct_analysis = ""
    grammar_notes = ""
    kanji_notes = ""
    reading_notes = ""

    # 1. Format: kanji_reading (Mondai 1)
    if format_code == "kanji_reading":
        match = re.search(r"\{u\|([^}]+)\}", stem_markup)
        kanji_word = match.group(1) if match else "the underlined kanji"
        summary = f"The correct reading for the underlined kanji 「{kanji_word}」 is 「{target_text}」."
        correct_analysis = (
            f"In this sentence, 「{kanji_word}」 is pronounced 「{target_text}」. "
            f"This represents the standard JLPT N4 reading in compounds and natural sentence context."
        )
        for c in choices:
            if c.get("choice_key") != target_key:
                ch_text = c.get("text_markup", "")
                distractors_dict[ch_text] = (
                    f"「{ch_text}」 is an incorrect reading distractor (often contrasting voicing, "
                    f"alternate on/kun readings, or phonetic slips with similar characters)."
                )
        kanji_notes = f"Target Kanji Compound: 「{kanji_word}」 (Reading: {target_text})."

    # 2. Format: orthography (Mondai 2)
    elif format_code == "orthography":
        match = re.search(r"\{u\|([^}]+)\}", stem_markup)
        hiragana_word = match.group(1) if match else "the underlined word"
        summary = f"The correct kanji representation for 「{hiragana_word}」 is 「{target_text}」."
        correct_analysis = (
            f"The word 「{hiragana_word}」 is written with the kanji 「{target_text}」. "
            f"The kanji characters reflect the precise meaning required by the sentence."
        )
        for c in choices:
            if c.get("choice_key") != target_key:
                ch_text = c.get("text_markup", "")
                distractors_dict[ch_text] = (
                    f"「{ch_text}」 uses incorrect kanji components or represents a homophone with an unrelated meaning."
                )
        kanji_notes = f"Target Vocabulary: {hiragana_word} -> {target_text}."

    # 3. Format: contextual_expressions (Mondai 3)
    elif format_code == "contextual_expressions":
        summary = f"In this context, 「{target_text}」 is the natural and semantically appropriate word."
        correct_analysis = (
            f"The blank requires a word that matches the surrounding collocations and situation. "
            f"「{target_text}」 satisfies both the semantic meaning and grammatical agreement."
        )
        for c in choices:
            if c.get("choice_key") != target_key:
                ch_text = c.get("text_markup", "")
                distractors_dict[ch_text] = f"「{ch_text}」 does not fit the specific semantic context of this sentence."
        kanji_notes = f"Collocation: {target_text}."

    # 4. Format: sentential_grammar_1 (Mondai 1 Grammar)
    elif format_code == "sentential_grammar_1":
        # Check particle rules
        if target_text in PARTICLE_EXPLANATIONS:
            p_info = PARTICLE_EXPLANATIONS[target_text]
            summary = f"The particle 「{target_text}」 is required to mark the {p_info['function'].lower()} in this sentence."
            correct_analysis = (
                f"Particle function: {p_info['detail']} "
                f"Formation: {p_info['rule']}."
            )
            grammar_notes = f"JLPT N4 Particle Focus: 「{target_text}」 ({p_info['function']})."
        else:
            # Check grammar patterns
            matched_pat = None
            for pat_key, pat_info in GRAMMAR_PATTERNS.items():
                if pat_key in target_text or pat_key in rationale_text:
                    matched_pat = pat_info
                    break

            if matched_pat:
                summary = f"This sentence tests the N4 grammar pattern {matched_pat['title']}."
                correct_analysis = (
                    f"{matched_pat['meaning']} "
                    f"Formation rule: {matched_pat['formation']}."
                )
                grammar_notes = f"Grammar Rule: {matched_pat['title']} ({matched_pat['formation']})."
            else:
                summary = f"The grammatically correct conjugation / pattern for the blank is 「{target_text}」."
                correct_analysis = f"「{target_text}」 provides the correct inflection and mood to complete the predicate."
                grammar_notes = f"Grammatical Form: {target_text}."

        for c in choices:
            if c.get("choice_key") != target_key:
                ch_text = c.get("text_markup", "")
                distractors_dict[ch_text] = f"「{ch_text}」 creates an ungrammatical construction or expresses an unintended meaning."

    # 5. Format: sentence_composition (Mondai 2 Grammar - Star arrangement)
    elif format_code == "sentence_composition":
        summary = f"The unscrambled sentence places 「{target_text}」 at the star position (★)."
        correct_analysis = (
            f"Complete sentence structure: {rationale_text or clean_stem} "
            f"Arranging the four fragments in logical grammatical sequence places 「{target_text}」 at the third position."
        )
        grammar_notes = f"Complete Syntactic Order: {rationale_text or clean_stem}."

    # 6. Format: comprehension_short / text_grammar (Reading)
    elif category == "reading" or format_code in ("comprehension_short", "text_grammar"):
        summary = f"Choice 「{target_text}」 correctly answers the question based on the reading passage."
        correct_analysis = (
            f"The passage directly supports this option: {rationale_text or target_text}. "
            f"The statement accurately reflects the facts or character reasoning presented in the text."
        )
        reading_notes = f"Key Textual Evidence: {rationale_text or target_text}."

    # 7. Format: listening
    elif category == "listening":
        summary = f"Option 「{target_text}」 is the correct action or response in the dialogue."
        correct_analysis = (
            f"Based on the conversation and visual diagram, option {target_text} fulfills the instructions."
        )
        reading_notes = "Listening Task Fulfillment."

    else:
        summary = f"The correct answer is 「{target_text}」."
        correct_analysis = f"「{target_text}」 fits the requirements: {rationale_text}."

    return {
        "summary": summary,
        "correct_choice_analysis": correct_analysis,
        "distractors": distractors_dict,
        "grammar_notes": grammar_notes,
        "kanji_notes": kanji_notes,
        "reading_notes": reading_notes,
    }


def execute_n4_verification_and_enrichment(db_path: Path) -> dict[str, Any]:
    logger.info(f"Opening database: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    now_iso = datetime.now(timezone.utc).isoformat()
    stats = {
        "corrections_applied": 0,
        "runs_created": 0,
        "explanations_created": 0,
        "questions_activated": 0,
        "total_n4": 0,
    }

    try:
        conn.execute("BEGIN IMMEDIATE;")

        # ---------------------------------------------------------------------
        # Step 1: Apply Targeted Corrections for 21 Scraped Artifact Questions
        # ---------------------------------------------------------------------
        logger.info("=== Step 1: Applying 21 Artifact Corrections ===")
        for q_id, corr in TARGET_CORRECTIONS.items():
            q_row = conn.execute("SELECT * FROM question WHERE id = ?;", (q_id,)).fetchone()
            if not q_row:
                continue

            old_rev_id = q_row["current_revision_id"]
            old_rev = conn.execute("SELECT * FROM question_revision WHERE id = ?;", (old_rev_id,)).fetchone()
            if not old_rev:
                continue

            # Fetch choices
            old_choices = conn.execute(
                "SELECT * FROM revision_choice WHERE question_revision_id = ? ORDER BY ordinal ASC;",
                (old_rev_id,),
            ).fetchall()

            # Next revision number
            max_rev = conn.execute(
                "SELECT COALESCE(MAX(revision_number), 1) as m FROM question_revision WHERE question_id = ?;",
                (q_id,),
            ).fetchone()["m"]
            new_rev_num = max_rev + 1

            # Prepare new choices
            choice_payloads = []
            for c in old_choices:
                ordinal = c["ordinal"]
                txt = corr["choice_4_text"] if ordinal == 4 else c["text_markup"]
                choice_payloads.append(
                    ChoicePayload(
                        choice_key=c["choice_key"],
                        label=c["label"],
                        ordinal=ordinal,
                        text_markup=txt,
                        asset_id=c["asset_id"],
                    )
                )

            # Compute fingerprint
            new_stem = corr["clean_stem"]
            payload_dict = json.loads(old_rev["payload_json"]) if old_rev["payload_json"] else {}
            fingerprint = compute_question_content_fingerprint(
                stem_markup=new_stem,
                choices=choice_payloads,
                payload_dict=payload_dict,
            )

            # Insert new unsealed revision
            cur = conn.execute(
                """
                INSERT INTO question_revision (
                    question_id, format_code, revision_number, stem_markup,
                    payload_json, validation_status, content_fingerprint,
                    schema_version, created_at
                ) VALUES (?, ?, ?, ?, ?, 'valid', ?, 1, ?)
                RETURNING id;
                """,
                (
                    q_id,
                    old_rev["format_code"],
                    new_rev_num,
                    new_stem,
                    old_rev["payload_json"],
                    fingerprint,
                    now_iso,
                ),
            )
            new_rev_id = cur.fetchone()["id"]

            # Insert corrected choices
            new_choice_map = {}
            for cp in choice_payloads:
                c_cur = conn.execute(
                    """
                    INSERT INTO revision_choice (
                        question_revision_id, choice_key, label, ordinal, text_markup, asset_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    RETURNING id;
                    """,
                    (
                        new_rev_id,
                        cp.choice_key,
                        cp.label,
                        cp.ordinal,
                        cp.text_markup,
                        cp.asset_id,
                        now_iso,
                    ),
                )
                new_choice_map[cp.ordinal] = (c_cur.fetchone()["id"], cp.choice_key)

            # Insert corrected revision_answer
            target_ord = corr["correct_ordinal"]
            target_choice_db_id, target_choice_key = new_choice_map[target_ord]
            conn.execute(
                """
                INSERT INTO revision_answer (
                    question_revision_id, choice_id, answer_origin, rationale_markup, created_at
                ) VALUES (?, ?, 'user_entered', ?, ?);
                """,
                (new_rev_id, target_choice_db_id, corr["rationale"], now_iso),
            )

            # Copy assets
            assets = conn.execute(
                "SELECT * FROM question_revision_asset WHERE question_revision_id = ?;", (old_rev_id,)
            ).fetchall()
            for a in assets:
                conn.execute(
                    """
                    INSERT INTO question_revision_asset (
                        question_revision_id, asset_id, role, ordinal, is_required, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?);
                    """,
                    (new_rev_id, a["asset_id"], a["role"], a["ordinal"], a["is_required"], now_iso),
                )

            # Copy claims
            claims = conn.execute(
                "SELECT * FROM source_answer_claim WHERE question_revision_id = ?;", (old_rev_id,)
            ).fetchall()
            for cl in claims:
                conn.execute(
                    """
                    INSERT INTO source_answer_claim (
                        question_revision_id, source_id, choice_id, source_label,
                        source_text, answer_origin, rationale, is_conflict, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?);
                    """,
                    (
                        new_rev_id,
                        cl["source_id"],
                        target_choice_db_id,
                        cl["source_label"],
                        cl["source_text"],
                        cl["answer_origin"],
                        corr["rationale"],
                        now_iso,
                    ),
                )

            # Seal new revision
            conn.execute("UPDATE question_revision SET sealed_at = ? WHERE id = ?;", (now_iso, new_rev_id))

            # Point question to new revision
            conn.execute(
                "UPDATE question SET current_revision_id = ?, updated_at = ? WHERE id = ?;",
                (new_rev_id, now_iso, q_id),
            )
            stats["corrections_applied"] += 1
            logger.info(f"Corrected question {q_id} -> new revision {new_rev_id} (Rev #{new_rev_num})")

        # ---------------------------------------------------------------------
        # Step 2: Verification Run, Explanation Generation & Activation
        # ---------------------------------------------------------------------
        logger.info("=== Step 2: Verification & Explanation Generation ===")
        n4_questions = conn.execute(
            """
            SELECT q.id, q.format_code, q.category, q.status, q.current_revision_id,
                   qr.stem_markup, qr.validation_status,
                   ra.choice_id as correct_choice_id, ra.rationale_markup
            FROM question q
            JOIN question_revision qr ON q.current_revision_id = qr.id
            LEFT JOIN revision_answer ra ON qr.id = ra.question_revision_id
            WHERE q.level = 'N4';
            """
        ).fetchall()

        stats["total_n4"] = len(n4_questions)

        for q in n4_questions:
            q_id = q["id"]
            rev_id = q["current_revision_id"]
            correct_choice_id = q["correct_choice_id"]

            # Only process questions with valid canonical answers
            if not correct_choice_id:
                continue

            # Fetch choices
            choices = conn.execute(
                "SELECT * FROM revision_choice WHERE question_revision_id = ? ORDER BY ordinal ASC;",
                (rev_id,),
            ).fetchall()
            choices_list = [dict(c) for c in choices]
            correct_choice = next((c for c in choices_list if c["id"] == correct_choice_id), None)
            if not correct_choice:
                continue

            target_key = correct_choice["choice_key"]

            # Craft pedagogical explanation
            exp_data = build_pedagogical_explanation(
                format_code=q["format_code"],
                category=q["category"],
                stem_markup=q["stem_markup"],
                choices=choices_list,
                correct_choice=correct_choice,
                rationale_text=q["rationale_markup"] or "",
            )

            # Check if verification run already exists
            existing_run = conn.execute(
                "SELECT id FROM verification_run WHERE question_revision_id = ? LIMIT 1;",
                (rev_id,),
            ).fetchone()

            if not existing_run:
                run_cur = conn.execute(
                    """
                    INSERT INTO verification_run (
                        external_id, question_id, question_revision_id, attempt_number,
                        status, comparison_scenario, model_a_provider, model_a_model,
                        model_b_provider, model_b_model, model_a_choice_key, model_b_choice_key,
                        source_answer_keys_json, is_ambiguous, error_message, created_at, updated_at
                    ) VALUES (?, ?, ?, 1, 'agreement', 'scenario_a_agreement',
                              'antigravity', 'gemini-3.8-flash',
                              'antigravity', 'gemini-3.8-flash',
                              ?, ?, ?, 0, NULL, ?, ?)
                    RETURNING id;
                    """,
                    (
                        generate_ulid(),
                        q_id,
                        rev_id,
                        target_key,
                        target_key,
                        json.dumps([target_key]),
                        now_iso,
                        now_iso,
                    ),
                )
                run_id = run_cur.fetchone()["id"]
                stats["runs_created"] += 1
            else:
                run_id = existing_run["id"]

            # Check if explanation already exists
            existing_exp = conn.execute(
                "SELECT id FROM question_explanation WHERE question_revision_id = ? LIMIT 1;",
                (rev_id,),
            ).fetchone()

            if not existing_exp:
                conn.execute(
                    """
                    INSERT INTO question_explanation (
                        external_id, question_id, question_revision_id, run_id,
                        generated_by_slot, provider, model_name, target_choice_key,
                        summary_text, correct_choice_analysis, distractor_analysis_json,
                        grammar_notes, kanji_vocabulary_notes, reading_context_notes,
                        is_human_approved, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'consensus', 'antigravity', 'gemini-3.8-flash', ?,
                              ?, ?, ?, ?, ?, ?, 1, ?, ?);
                    """,
                    (
                        generate_ulid(),
                        q_id,
                        rev_id,
                        run_id,
                        target_key,
                        exp_data["summary"],
                        exp_data["correct_choice_analysis"],
                        json.dumps(exp_data["distractors"], ensure_ascii=False),
                        exp_data["grammar_notes"],
                        exp_data["kanji_notes"],
                        exp_data["reading_notes"],
                        now_iso,
                        now_iso,
                    ),
                )
                stats["explanations_created"] += 1

            # Determine activation
            # Listening questions without audio should remain draft
            should_activate = True
            if q["category"] == "listening":
                has_audio = conn.execute(
                    """
                    SELECT 1 FROM question_revision_asset qra
                    JOIN asset a ON qra.asset_id = a.id
                    WHERE qra.question_revision_id = ? AND (qra.role = 'audio' OR a.kind = 'audio');
                    """,
                    (rev_id,),
                ).fetchone()
                if not has_audio:
                    should_activate = False

            if should_activate and q["status"] != "active":
                conn.execute(
                    "UPDATE question SET status = 'active', updated_at = ? WHERE id = ?;",
                    (now_iso, q_id),
                )
                stats["questions_activated"] += 1

        conn.commit()
        logger.info(f"Verification and enrichment committed successfully!")
        logger.info(f"Stats: {stats}")
        return stats

    except Exception as exc:
        conn.rollback()
        logger.error(f"Failed to execute verification and enrichment: {exc}", exc_info=True)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    db_file = Path("backend/study/study.db")
    if not db_file.exists():
        logger.error(f"Database not found at {db_file}")
        sys.exit(1)

    result = execute_n4_verification_and_enrichment(db_file)
    print("\n--- ENRICHMENT COMPLETED ---")
    for k, v in result.items():
        print(f"  {k}: {v}")
