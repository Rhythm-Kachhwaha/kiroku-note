"""Grammar Drill Generator and Active Proof Engine for Kiroku Note.

Provides 3 proof modalities:
1) spot_in_wild: Sentence with masked/bracketed target grammar; learner identifies concept / nuance.
2) conjugation_cloze: Sentence with blank + target root verb/adjective prompt; learner types exact inflected Japanese.
3) nuance_battle: Pits confusable lookalikes (e.g. そうだ appearance vs hearsay, てくる vs ていく, たら vs ば vs と vs なら) with contextual explanations.
4) micro-session generator: 10-question anti-grind bundle.
"""
from __future__ import annotations

import random
import re
import unicodedata
from typing import Any

from app.services.grammar_reference import GrammarReferenceService
from app.services.grammar_tracker import GrammarTrackerService

# Nuance battle battleground definitions with pairs/groups and explicit contextual explanations
NUANCE_BATTLES: list[dict[str, Any]] = [
    {
        "battle_id": "conjecture_souda_vs_hearsay",
        "title": "Appearance vs Hearsay: そうだ vs そうだ",
        "description": "Visual direct impression (looks like) vs reported speech (I hear that).",
        "options": [
            {
                "pattern_key": "そうだ(appearance)",
                "display": "そうだ (appearance)",
                "summary": "Direct visual/sensory impression: 'looks like, appears to'",
            },
            {
                "pattern_key": "そうだ(hearsay)",
                "display": "そうだ (hearsay)",
                "summary": "Reported secondhand information: 'I heard that, they say'",
            },
        ],
        "challenges": [
            {
                "sentence": "空が暗くなって、雨が[降りそうだ]。",
                "target_key": "そうだ(appearance)",
                "explanation": "Direct observation of dark clouds indicating imminent rain uses appearance そうだ (verb stem + そうだ).",
                "cloze_sentence": "空が暗くなって、雨が[___]。",
            },
            {
                "sentence": "天気予報によると、明日は雨が[降るそうだ]。",
                "target_key": "そうだ(hearsay)",
                "explanation": "Citing a weather forecast (によると) indicates secondhand hearsay, attaching to the plain form (降る + そうだ).",
                "cloze_sentence": "天気予報によると、明日は雨が[___]。",
            },
            {
                "sentence": "このケーキはとても[おいしそうだ]。",
                "target_key": "そうだ(appearance)",
                "explanation": "Judging a cake's deliciousness by its visual presentation takes adjective stem + そうだ.",
                "cloze_sentence": "このケーキはとても[___]。",
            },
            {
                "sentence": "田中さんの話では、あの店のケーキはとても[おいしいそうだ]。",
                "target_key": "そうだ(hearsay)",
                "explanation": "Attributing to Tanaka's testimony (田中さんの話では) requires plain form hearsay (おいしい + そうだ).",
                "cloze_sentence": "田中さんの話では、あの店のケーキはとても[___]。",
            },
        ],
    },
    {
        "battle_id": "conjecture_rashii_vs_youda",
        "title": "Conjecture Nuance: らしい vs ようだ",
        "description": "Objective hearsay/characteristic vibe vs subjective sensory deduction.",
        "options": [
            {
                "pattern_key": "らしい",
                "display": "らしい (conjecture / vibe)",
                "summary": "Conjecture based on external rumor or behaving true to type",
            },
            {
                "pattern_key": "ようだ",
                "display": "ようだ (sensory deduction)",
                "summary": "Subjective inference through personal senses (looks/feels like)",
            },
        ],
        "challenges": [
            {
                "sentence": "外を見ると、地面が濡れているから雨が降った[ようだ]。",
                "target_key": "ようだ",
                "explanation": "Personal sensory observation of wet pavement leading to a deduction calls for ようだ.",
                "cloze_sentence": "外を見ると、地面が濡れているから雨が降った[___]。",
            },
            {
                "sentence": "噂によると、先生は来月結婚する[らしい]。",
                "target_key": "らしい",
                "explanation": "Secondhand rumor (噂によると) is naturally phrased using らしい.",
                "cloze_sentence": "噂によると、先生は来月結婚する[___]。",
            },
        ],
    },
    {
        "battle_id": "direction_tekuru_vs_teiku",
        "title": "Directional Vector: てくる vs ていく",
        "description": "Motion toward the speaker / past-to-present vs motion away / present-to-future.",
        "options": [
            {
                "pattern_key": "てくる",
                "display": "〜てくる",
                "summary": "Action or change moving toward speaker or from past up to now",
            },
            {
                "pattern_key": "ていく",
                "display": "〜ていく",
                "summary": "Action or change moving away from speaker or continuing into the future",
            },
        ],
        "challenges": [
            {
                "sentence": "だんだん暖かく[なってきた]。",
                "target_key": "てくる",
                "explanation": "A change that has developed up until the present moment uses てくる (なってきた).",
                "cloze_sentence": "だんだん暖かく[___]。",
            },
            {
                "sentence": "これからも日本語を勉強し[続けていく]つもりです。",
                "target_key": "ていく",
                "explanation": "Continuing an action into the onward future (これからも) takes ていく.",
                "cloze_sentence": "これからも日本語を勉強し[___]つもりです。",
            },
            {
                "sentence": "ちょっと駅前のコンビニに行って[きます]。",
                "target_key": "てくる",
                "explanation": "Going out and coming back to the home base requires 行ってくる (行ってきます).",
                "cloze_sentence": "ちょっと駅前のコンビニに行って[___]。",
            },
        ],
    },
    {
        "battle_id": "giving_receiving_ageru_kureru_morau",
        "title": "Giving and Receiving: あげる vs くれる vs もらう",
        "description": "Giving outward vs giving toward the speaker vs receiving from another.",
        "options": [
            {
                "pattern_key": "あげる",
                "display": "あげる",
                "summary": "Speaker gives to someone else, or third person gives to third person",
            },
            {
                "pattern_key": "くれる",
                "display": "くれる",
                "summary": "Someone gives inward to the speaker or speaker's inner group",
            },
            {
                "pattern_key": "もらう",
                "display": "もらう",
                "summary": "Speaker receives from someone else (subject is recipient)",
            },
        ],
        "challenges": [
            {
                "sentence": "友だちが私に誕生日のプレゼントを[くれた]。",
                "target_key": "くれる",
                "explanation": "When an outside friend gives a gift towards me (私に), くれる must be used.",
                "cloze_sentence": "友だちが私に誕生日のプレゼントを[___]。",
            },
            {
                "sentence": "私は弟に新しいノートを[あげた]。",
                "target_key": "あげる",
                "explanation": "When I (the speaker) give outward to my younger brother, あげる is used.",
                "cloze_sentence": "私は弟に新しいノートを[___]。",
            },
            {
                "sentence": "私は先生に推薦状を書いて[もらった]。",
                "target_key": "もらう",
                "explanation": "The speaker is the subject receiving the favor (先生に...てもらう).",
                "cloze_sentence": "私は先生に推薦状を書いて[___]。",
            },
        ],
    },
    {
        "battle_id": "conditionals_tara_ba_to_nara",
        "title": "Conditionals Quadrant: たら vs ば vs と vs なら",
        "description": "General natural consequence vs hypothetical condition vs past trigger vs contextual topic condition.",
        "options": [
            {
                "pattern_key": "たら",
                "display": "〜たら",
                "summary": "Sequential 'once X happens, then Y' or temporal conditional",
            },
            {
                "pattern_key": "ば",
                "display": "〜ば",
                "summary": "Hypothetical general condition: 'provided that X holds'",
            },
            {
                "pattern_key": "と",
                "display": "〜と",
                "summary": "Natural, inevitable, or automated result: 'whenever X, inevitably Y'",
            },
            {
                "pattern_key": "なら",
                "display": "〜なら",
                "summary": "Contextual advice or topic uptake: 'if it's X you're talking about'",
            },
        ],
        "challenges": [
            {
                "sentence": "春になる[と]、桜が咲きます。",
                "target_key": "と",
                "explanation": "Natural inevitable seasonal succession is expressed with と.",
                "cloze_sentence": "春になる[___]、桜が咲きます。",
            },
            {
                "sentence": "京都へ行く[なら]、秋が一番おすすめです。",
                "target_key": "なら",
                "explanation": "Giving advice based on the conversation partner's stated premise uses なら.",
                "cloze_sentence": "京都へ行く[___]、秋が一番おすすめです。",
            },
            {
                "sentence": "家に帰っ[たら]、まず手を洗いましょう。",
                "target_key": "たら",
                "explanation": "Sequential temporal condition ('upon returning home, do Y') uses たら.",
                "cloze_sentence": "家に帰っ[___]、まず手を洗いましょう。",
            },
            {
                "sentence": "安けれ[ば]、買いたいです。",
                "target_key": "ば",
                "explanation": "General hypothetical condition for I-adjectives uses 〜ければ (ば).",
                "cloze_sentence": "安けれ[___]、買いたいです。",
            },
        ],
    },
    {
        "battle_id": "particles_wa_vs_ga",
        "title": "Core Particles: は vs が",
        "description": "Topic boundary marker (as for X) vs subject identifier (exhaustive spotlight).",
        "options": [
            {
                "pattern_key": "は",
                "display": "は (topic)",
                "summary": "Sets topic / stage for new predicate commentary",
            },
            {
                "pattern_key": "が",
                "display": "が (subject focus)",
                "summary": "Identifies actor or introduces brand new subject",
            },
        ],
        "challenges": [
            {
                "sentence": "象[は]鼻が長いです。",
                "target_key": "は",
                "explanation": "象 (elephant) is the overarching topic ('As for elephants...').",
                "cloze_sentence": "象[___]鼻が長いです。",
            },
            {
                "sentence": "誰[が]一番に来ましたか。",
                "target_key": "が",
                "explanation": "Question words (誰, 何) can never be marked with は; they take が for subject identification.",
                "cloze_sentence": "誰[___]一番に来ましたか。",
            },
        ],
    },
]

# Curated Conjugation Cloze Banks for verified accurate conjugation challenges
CONJUGATION_CLOZE_BANK: list[dict[str, Any]] = [
    {
        "pattern_key": "そうだ(appearance)",
        "prompt_root": "降る",
        "prompt_type": "verb",
        "grammar_target": "そうだ (appearance)",
        "level": "N4",
        "sentence_template": "空が真っ暗になって、今にも雨が[___]。",
        "expected_inflection": "降りそうだ",
        "acceptable_alternatives": ["ふりそうだ", "降りそう", "ふりそう"],
        "hint": "Verb stem + そうだ (looks like it will...)",
        "explanation": "For godan verb 降る (to fall), the stem is 降り. Adding そうだ yields 降りそうだ.",
    },
    {
        "pattern_key": "そうだ(appearance)",
        "prompt_root": "おいしい",
        "prompt_type": "i-adjective",
        "grammar_target": "そうだ (appearance)",
        "level": "N4",
        "sentence_template": "焼き立てのパンはとても[___]ね。",
        "expected_inflection": "おいしそうだ",
        "acceptable_alternatives": ["美味しそうだ", "おいしそう", "美味しそう"],
        "hint": "I-adjective: drop ~い + そうだ",
        "explanation": "Drop い from おいしい to get the stem おいし, then append そうだ -> おいしそうだ.",
    },
    {
        "pattern_key": "受身",
        "prompt_root": "褒める",
        "prompt_type": "verb",
        "grammar_target": "受身 (passive)",
        "level": "N4",
        "sentence_template": "テストで満点を取って、先生に[___]。",
        "expected_inflection": "褒められた",
        "acceptable_alternatives": ["ほめられた", "褒められました", "ほめられました"],
        "hint": "Ichidan verb passive past: 褒める -> 褒められる -> 褒められた",
        "explanation": "褒める is an ichidan verb. Passive base is 褒められ, past form is 褒められた.",
    },
    {
        "pattern_key": "使役",
        "prompt_root": "食べる",
        "prompt_type": "verb",
        "grammar_target": "使役 (causative)",
        "level": "N4",
        "sentence_template": "母は子どもに毎日野菜を[___]。",
        "expected_inflection": "食べさせる",
        "acceptable_alternatives": ["たべさせる", "食べさせます", "たべさせます"],
        "hint": "Ichidan verb causative: 食べる -> 食べさせる",
        "explanation": "食べる is an ichidan verb. Causative suffix is させる -> 食べさせる.",
    },
    {
        "pattern_key": "使役受身",
        "prompt_root": "掃除する",
        "prompt_type": "suru-verb",
        "grammar_target": "使役受身 (causative-passive)",
        "level": "N4",
        "sentence_template": "日曜日の朝、母に部屋を[___]。",
        "expected_inflection": "掃除させられた",
        "acceptable_alternatives": ["そうじさせられた", "掃除させられました"],
        "hint": "Suru verb causative-passive past: 掃除する -> 掃除させられる -> 掃除させられた",
        "explanation": "する becomes させられる in causative-passive, in past tense: 掃除させられた.",
    },
    {
        "pattern_key": "ば",
        "prompt_root": "行く",
        "prompt_type": "verb",
        "grammar_target": "〜ば (conditional)",
        "level": "N5",
        "sentence_template": "この道をまっすぐ[___]、大きな駅が見えます。",
        "expected_inflection": "行けば",
        "acceptable_alternatives": ["いけば"],
        "hint": "Godan verb conditional: change -u to -e + ば",
        "explanation": "行く (iku) -> 行け (ike) + ば -> 行けば.",
    },
    {
        "pattern_key": "ば",
        "prompt_root": "高い",
        "prompt_type": "i-adjective",
        "grammar_target": "〜ば (conditional)",
        "level": "N5",
        "sentence_template": "あまり値段が[___]、買うのをやめます。",
        "expected_inflection": "高ければ",
        "acceptable_alternatives": ["たかければ"],
        "hint": "I-adjective conditional: drop ~い + ければ",
        "explanation": "Drop い from 高い and add ければ -> 高ければ.",
    },
    {
        "pattern_key": "たら",
        "prompt_root": "着く",
        "prompt_type": "verb",
        "grammar_target": "〜たら (temporal conditional)",
        "level": "N5",
        "sentence_template": "駅に[___]、すぐに電話してください。",
        "expected_inflection": "着いたら",
        "acceptable_alternatives": ["ついたら"],
        "hint": "Ta-form + ら: 着く -> 着いた -> 着いたら",
        "explanation": "The past form of 着く is 着いた. Appending ら gives 着いたら.",
    },
    {
        "pattern_key": "てくる",
        "prompt_root": "暖かくなる",
        "prompt_type": "verb",
        "grammar_target": "〜てくる (becoming toward now)",
        "level": "N4",
        "sentence_template": "春になって、最近だんだん[___]。",
        "expected_inflection": "暖かくなってきた",
        "acceptable_alternatives": ["あたたかくなってきた", "暖かくなってきました"],
        "hint": "Te-form + きた (past of てくる)",
        "explanation": "暖かくなる in te-form is 暖かくなって. Adding きた yields 暖かくなってきた.",
    },
    {
        "pattern_key": "なければならない",
        "prompt_root": "勉強する",
        "prompt_type": "suru-verb",
        "grammar_target": "なければならない (obligation)",
        "level": "N5",
        "sentence_template": "明日は大切な試験だから、今夜は[___]。",
        "expected_inflection": "勉強しなければならない",
        "acceptable_alternatives": ["べんきょうしなければならない", "勉強しなければなりません", "べんきょうしなければなりません"],
        "hint": "Negative stem + なければならない (勉強しない -> 勉強しなければならない)",
        "explanation": "勉強する negative is 勉強しない; dropping い and adding ければならない gives 勉強しなければならない.",
    },
]


def _normalize_text(val: str) -> str:
    """Normalize Japanese text for robust comparison."""
    if not val:
        return ""
    normalized = unicodedata.normalize("NFKC", val).strip()
    normalized = normalized.replace(" ", "").replace("　", "")
    return normalized


class GrammarDrillService:
    """Generates and verifies grammar production drills across 3 modalities."""

    def __init__(
        self,
        reference_service: GrammarReferenceService | None = None,
        tracker_service: GrammarTrackerService | None = None,
    ):
        self.ref = reference_service or GrammarReferenceService()
        self.tracker = tracker_service or GrammarTrackerService()

    def generate_spot_in_wild_drill(
        self,
        level: str | None = None,
        pattern_key: str | None = None,
    ) -> dict[str, Any]:
        """Generate a spot_in_wild drill where learner selects the target grammar concept from context."""
        pts = self.ref.get_points()
        if level:
            pts = [p for p in pts if (p.get("level") or "").upper() == level.upper()]

        chosen: dict[str, Any] | None = None
        if pattern_key:
            chosen = self.ref.get_point_by_key(pattern_key)
            if not chosen:
                chosen = next((p for p in pts if p.get("pattern_key") == pattern_key), None)

        if not chosen:
            candidates = [p for p in pts if p.get("examples") and len(p["examples"]) > 0]
            if not candidates:
                candidates = pts
            chosen = random.choice(candidates) if candidates else None

        if not chosen:
            # Fallback point
            chosen = {
                "pattern_key": "そうだ(appearance)",
                "pattern_display": "そうだ (appearance)",
                "level": "N4",
                "meaning_short": "looks like; appears to",
                "examples": [{"ja": "雨が降りそうだ。", "en": "It looks like it will rain."}],
            }

        target_key = chosen.get("pattern_key", "")
        target_display = chosen.get("pattern_display") or target_key
        target_meaning = chosen.get("meaning_short") or ""
        examples = chosen.get("examples") or []
        ex_sentence = ""
        ex_translation = ""
        for ex in examples:
            if isinstance(ex, dict) and ex.get("ja"):
                ex_sentence = ex["ja"]
                ex_translation = ex.get("en", "")
                break

        if not ex_sentence:
            ex_sentence = f"雨が降り{target_display}。"

        # Bracket the grammar occurrence in sentence
        highlight_key = target_key.split("(")[0].strip()
        highlight_key = highlight_key.replace("〜", "").replace("~", "").strip()

        masked_sentence = ex_sentence
        if highlight_key and highlight_key in ex_sentence:
            # Mask the first occurrence with [brackets]
            masked_sentence = ex_sentence.replace(highlight_key, f"[{highlight_key}]", 1)
        else:
            masked_sentence = f"[{ex_sentence}]"

        # Generate 3 distractors
        all_other = [p for p in pts if p.get("pattern_key") != target_key]
        distractors = random.sample(all_other, min(3, len(all_other))) if all_other else []
        options = [
            {
                "pattern_key": target_key,
                "display": target_display,
                "meaning": target_meaning,
            }
        ]
        for d in distractors:
            options.append({
                "pattern_key": d.get("pattern_key", ""),
                "display": d.get("pattern_display") or d.get("pattern_key", ""),
                "meaning": d.get("meaning_short") or "",
            })
        random.shuffle(options)

        return {
            "drill_id": f"spot_{target_key}_{random.randint(1000, 9999)}",
            "modality": "spot_in_wild",
            "pattern_key": target_key,
            "target_display": target_display,
            "level": chosen.get("level"),
            "sentence": masked_sentence,
            "original_sentence": ex_sentence,
            "english_translation": ex_translation,
            "target_meaning": target_meaning,
            "options": options,
            "prompt": "Identify the grammar pattern and nuance highlighted in the sentence.",
        }

    def generate_conjugation_cloze_drill(
        self,
        level: str | None = None,
        pattern_key: str | None = None,
    ) -> dict[str, Any]:
        """Generate a conjugation cloze drill where learner must inflect a root word into target grammar."""
        pool = list(CONJUGATION_CLOZE_BANK)
        if level:
            pool_filtered = [item for item in pool if (item.get("level") or "").upper() == level.upper()]
            if pool_filtered:
                pool = pool_filtered
        if pattern_key:
            key_filtered = [item for item in pool if item.get("pattern_key") == pattern_key]
            if key_filtered:
                pool = key_filtered

        chosen = random.choice(pool) if pool else CONJUGATION_CLOZE_BANK[0]

        return {
            "drill_id": f"cloze_{chosen['pattern_key']}_{random.randint(1000, 9999)}",
            "modality": "conjugation_cloze",
            "pattern_key": chosen["pattern_key"],
            "target_display": chosen["grammar_target"],
            "level": chosen.get("level"),
            "sentence": chosen["sentence_template"],
            "prompt_root": chosen["prompt_root"],
            "prompt_type": chosen["prompt_type"],
            "hint": chosen["hint"],
            "expected_answer": chosen["expected_inflection"],
            "acceptable_alternatives": chosen["acceptable_alternatives"],
            "explanation": chosen["explanation"],
            "prompt": f"Type the correct inflected form of [{chosen['prompt_root']}] to complete the sentence.",
        }

    def generate_nuance_battle_drill(
        self,
        level: str | None = None,
        battle_id: str | None = None,
    ) -> dict[str, Any]:
        """Generate a nuance battle drill pitting confusable lookalikes against each other."""
        battles = list(NUANCE_BATTLES)
        if battle_id:
            filtered = [b for b in battles if b["battle_id"] == battle_id]
            if filtered:
                battles = filtered

        battle = random.choice(battles)
        challenge = random.choice(battle["challenges"])

        # Determine target point display
        target_opt = next(
            (o for o in battle["options"] if o["pattern_key"] == challenge["target_key"]),
            battle["options"][0],
        )

        return {
            "drill_id": f"battle_{battle['battle_id']}_{random.randint(1000, 9999)}",
            "modality": "nuance_battle",
            "battle_id": battle["battle_id"],
            "title": battle["title"],
            "description": battle["description"],
            "pattern_key": challenge["target_key"],
            "target_display": target_opt["display"],
            "sentence": challenge["cloze_sentence"],
            "full_sentence": challenge["sentence"],
            "options": battle["options"],
            "expected_answer": challenge["target_key"],
            "explanation": challenge["explanation"],
            "prompt": "Choose the correct grammar point that fits the contextual nuance of this sentence.",
        }

    def generate_session(
        self,
        modality: str | None = None,
        level: str | None = None,
        pattern_key: str | None = None,
        count: int = 10,
    ) -> dict[str, Any]:
        """Anti-grind micro-session bundle generator (typically 10 items)."""
        count = max(1, min(count, 20))
        modalities = [modality] if modality and modality in ("spot_in_wild", "conjugation_cloze", "nuance_battle") else [
            "spot_in_wild",
            "conjugation_cloze",
            "nuance_battle",
        ]

        drills = []
        for i in range(count):
            curr_mod = modalities[i % len(modalities)]
            if curr_mod == "spot_in_wild":
                d = self.generate_spot_in_wild_drill(level=level, pattern_key=pattern_key)
            elif curr_mod == "conjugation_cloze":
                d = self.generate_conjugation_cloze_drill(level=level, pattern_key=pattern_key)
            else:
                d = self.generate_nuance_battle_drill(level=level)
            drills.append(d)

        return {
            "session_id": f"session_{random.randint(100000, 999999)}",
            "item_count": len(drills),
            "level": level,
            "modality": modality or "mixed",
            "drills": drills,
        }

    def verify_drill_answer(
        self,
        modality: str,
        pattern_key: str,
        user_answer: str,
        expected_answer: str | None = None,
        context_sentence: str = "",
        drill_id: str | None = None,
    ) -> dict[str, Any]:
        """Verify learner's answer and score inflection / nuance."""
        norm_user = _normalize_text(user_answer)
        norm_exp = _normalize_text(expected_answer or "")
        is_correct = False
        feedback = ""

        if modality == "spot_in_wild":
            # Direct pattern key or display comparison
            is_correct = (norm_user == norm_exp) or (norm_user == _normalize_text(pattern_key))
            feedback = "Correct! You spotted the target grammar pattern." if is_correct else f"Incorrect. The target pattern was {expected_answer or pattern_key}."

        elif modality == "nuance_battle":
            # Compare key selection
            is_correct = (norm_user == norm_exp) or (norm_user == _normalize_text(pattern_key))
            feedback = "Spot on! You distinguished the exact contextual nuance." if is_correct else f"Not quite. The fitting nuance in this context is {expected_answer or pattern_key}."

        elif modality == "conjugation_cloze":
            # Inflection validation: exact match or acceptable alternative or reverse deinflection check
            matched_bank_item = next(
                (item for item in CONJUGATION_CLOZE_BANK if item["pattern_key"] == pattern_key and (
                    _normalize_text(item["expected_inflection"]) == norm_exp or norm_exp == ""
                )),
                None,
            )

            if matched_bank_item:
                valid_answers = [
                    _normalize_text(matched_bank_item["expected_inflection"]),
                    *[_normalize_text(alt) for alt in matched_bank_item.get("acceptable_alternatives", [])],
                ]
                if norm_user in valid_answers:
                    is_correct = True
                else:
                    # Reverse deinflector fallback
                    try:
                        from kiroku_dictionary.deinflect import deinflect
                        cands = list(deinflect(user_answer.strip()))
                        cand_terms = {_normalize_text(c.term) for c in cands}
                        prompt_root_norm = _normalize_text(matched_bank_item["prompt_root"])
                        if prompt_root_norm in cand_terms:
                            # User gave a form that deinflects back to the prompt root
                            # Check if target key is also reflected in the surface string
                            raw_key = pattern_key.split("(")[0].strip()
                            if _normalize_text(raw_key) in norm_user:
                                is_correct = True
                    except Exception:
                        pass
                feedback = (
                    f"Correct! '{matched_bank_item['expected_inflection']}' is the proper inflected form."
                    if is_correct
                    else f"Expected '{matched_bank_item['expected_inflection']}'. Hint: {matched_bank_item.get('hint', '')}"
                )
            else:
                # Direct string comparison if bank item not located
                is_correct = (norm_user == norm_exp) and bool(norm_user)
                feedback = "Correct inflection!" if is_correct else f"Expected: {expected_answer}"

        else:
            is_correct = (norm_user == norm_exp)
            feedback = "Correct!" if is_correct else f"Expected {expected_answer}"

        # Record drill outcome via GrammarTrackerService for dual-track mastery
        tracker_result = self.tracker.record_drill_outcome(
            pattern_key=pattern_key,
            modality=modality,
            is_correct=is_correct,
            user_answer=user_answer,
            expected_answer=expected_answer or pattern_key,
            context_sentence=context_sentence,
        )

        return {
            "is_correct": is_correct,
            "user_answer": user_answer,
            "expected_answer": expected_answer or pattern_key,
            "feedback": feedback,
            "tracker_result": tracker_result,
            "modality": modality,
            "pattern_key": pattern_key,
        }
