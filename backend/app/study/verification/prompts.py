"""
Task-Specific Prompt Synthesis for AI Question Verification.
------------------------------------------------------------
Constructs structured system and user prompts for:
1. Stage 1: Independent Solving (Strictly isolated from source answers and other models).
2. Stage 2: Source Claim Assessment (Evaluating external answer keys against question and solution).
3. Stage 3: Pedagogical Explanation Generation (Detailed learner-focused breakdown).
"""
from __future__ import annotations

import json
from typing import Any

from app.study.verification.models import (
    AIExplanationRequest,
    AISolveRequest,
    AIVerifyClaimsRequest,
)


def build_solve_system_prompt() -> str:
    """System instruction for independent question solving."""
    return (
        "You are an expert Japanese linguist, educator, and official JLPT examination author.\n"
        "Your task is to independently solve a Japanese language proficiency examination question.\n"
        "You must analyze the Japanese text, grammar, vocabulary, or passage rigorously.\n\n"
        "CRITICAL RULES:\n"
        "1. Strictly output valid JSON matching the specified schema. Do not add conversational markdown outside the JSON.\n"
        "2. Do NOT guess. If the question lacks context or has multiple equally valid answers, explicitly set "
        "\"question_validity\": \"ambiguous\" and \"ambiguity_detected\": true.\n"
        "3. You must choose from the provided choice keys only. Never invent choice identifiers.\n"
        "4. Provide a detailed breakdown for every choice explaining why it is correct or incorrect."
    )


def build_solve_user_prompt(req: AISolveRequest) -> str:
    """User prompt presenting question context, stem, choices, and JSON schema."""
    lines: list[str] = []
    lines.append(f"JLPT Level: {req.level}")
    lines.append(f"Category: {req.category}")
    lines.append(f"Format: {req.format_code} (Family: {req.structural_family})")

    if req.instruction_text.strip():
        lines.append(f"\nInstruction:\n{req.instruction_text.strip()}")

    if req.context_text and req.context_text.strip():
        lines.append(f"\nContext / Reading Passage / Script:\n{req.context_text.strip()}")

    if req.audio_transcript and req.audio_transcript.strip():
        lines.append(f"\nAudio Transcript:\n{req.audio_transcript.strip()}")

    lines.append(f"\nQuestion Stem:\n{req.stem_plain.strip()}")

    # Format-specific guidance
    if req.structural_family == "F2" or req.format_code == "sentence_composition":
        lines.append(
            "\n[Note on Sentence Composition]: The choices below represent fragments that must be rearranged "
            "into a grammatically correct sentence. The target answer is the fragment that belongs in the starred (★) position. "
            "Select the choice key corresponding to that fragment."
        )

    lines.append("\nAvailable Choices:")
    for c in req.choices:
        text_desc = c.text if c.text else "(visual or unprinted choice)"
        lines.append(f"  [{c.choice_key}] {c.label}: {text_desc}")

    allowed_keys_str = ", ".join(repr(c.choice_key) for c in req.choices)

    lines.append(
        "\nRequired Output JSON Schema:\n"
        "{\n"
        f"  \"selected_answer\": <choice key string, must be one of: {allowed_keys_str}>,\n"
        "  \"confidence\": \"high\" | \"medium\" | \"low\",\n"
        "  \"reasoning\": \"<detailed explanation of why the selected answer is correct>\",\n"
        "  \"choice_analysis\": {\n"
        "    \"<choice_key>\": \"<why this choice is correct or incorrect>\"\n"
        "  },\n"
        "  \"question_validity\": \"valid\" | \"ambiguous\" | \"defective\",\n"
        "  \"ambiguity_detected\": false | true,\n"
        "  \"notes\": [\"<any linguistic subtleties or notes>\"]\n"
        "}\n\n"
        "Return ONLY the JSON object."
    )

    return "\n".join(lines)


def build_verify_claims_system_prompt() -> str:
    """System instruction for evaluating external source answer claims."""
    return (
        "You are an expert Japanese linguist and JLPT examination auditor.\n"
        "You have already independently solved a JLPT question. Now, evaluate external answer key claims "
        "provided by external sources against the question and your analysis.\n\n"
        "CRITICAL RULES:\n"
        "1. Assess each source claim independently: is it 'supported', 'contradicted', or a 'plausible_alternative'?\n"
        "2. If an external source provides an answer differing from yours, objectively analyze whether "
        "the source is mistaken or if there was a subtle linguistic nuance you previously missed.\n"
        "3. Strictly return valid JSON."
    )


def build_verify_claims_user_prompt(req: AIVerifyClaimsRequest) -> str:
    """User prompt presenting the question, independent solution, and source claims to evaluate."""
    lines: list[str] = []
    lines.append(f"JLPT Level: {req.level} | Format: {req.format_code}")
    if req.context_text and req.context_text.strip():
        lines.append(f"Context / Passage:\n{req.context_text.strip()}\n")

    lines.append(f"Question Stem:\n{req.stem_plain.strip()}\n")
    lines.append("Choices:")
    for c in req.choices:
        text_desc = c.text if c.text else "(visual or unprinted choice)"
        lines.append(f"  [{c.choice_key}] {c.label}: {text_desc}")

    lines.append(f"\nYour Independently Derived Answer: Choice [{req.independent_selected_choice_key}]")
    lines.append(f"Your Initial Reasoning: {req.independent_reasoning}")

    lines.append("\nExternal Source Answer Claims to Evaluate:")
    for sc in req.source_claims:
        rationale_str = f" (Source rationale: {sc.claimed_rationale})" if sc.claimed_rationale else ""
        lines.append(f"  - Claim ID {sc.claim_id} from source '{sc.source_name}': Choice [{sc.claimed_choice_key}]{rationale_str}")

    lines.append(
        "\nRequired Output JSON Schema:\n"
        "{\n"
        "  \"assessments\": [\n"
        "    {\n"
        "      \"claim_id\": <claim_id>,\n"
        "      \"claimed_choice_key\": \"<choice_key>\",\n"
        "      \"assessment\": \"supported\" | \"contradicted\" | \"plausible_alternative\",\n"
        "      \"rationale\": \"<detailed justification of this assessment>\",\n"
        "      \"confidence\": \"high\" | \"medium\" | \"low\"\n"
        "    }\n"
        "  ],\n"
        "  \"opinion_changed\": false | true,\n"
        "  \"revised_choice_key\": null | \"<choice_key>\",\n"
        "  \"revised_reasoning\": null | \"<reason for revision if applicable>\"\n"
        "}\n\n"
        "Return ONLY the JSON object."
    )

    return "\n".join(lines)


def build_explanation_system_prompt() -> str:
    """System instruction for generating clear learner explanations."""
    return (
        "You are a master Japanese teacher explaining JLPT questions to an English-speaking learner.\n"
        "Your explanations must be lucid, pedagogical, and encouraging, breaking down the question's "
        "grammar patterns, vocabulary meanings, kanji readings, and distractor traps."
    )


def build_explanation_user_prompt(req: AIExplanationRequest) -> str:
    """User prompt requesting structured explanation for a target answer choice."""
    lines: list[str] = []
    lines.append(f"JLPT Level: {req.level} | Format: {req.format_code}")
    if req.context_text and req.context_text.strip():
        lines.append(f"Context / Passage:\n{req.context_text.strip()}\n")

    lines.append(f"Question Stem:\n{req.stem_plain.strip()}\n")
    lines.append("Choices:")
    for c in req.choices:
        text_desc = c.text if c.text else "(visual or unprinted choice)"
        lines.append(f"  [{c.choice_key}] {c.label}: {text_desc}")

    lines.append(f"\nTarget Correct Choice: [{req.target_choice_key}]")

    if req.independent_reasonings:
        lines.append("\nReference Solver Notes:")
        for r in req.independent_reasonings:
            lines.append(f"  - {r}")

    lines.append(
        "\nRequired Output JSON Schema:\n"
        "{\n"
        f"  \"target_choice_key\": \"{req.target_choice_key}\",\n"
        "  \"summary\": \"<1-2 clear summary sentences in English of the core answer logic>\",\n"
        "  \"correct_choice_analysis\": \"<why the target choice is correct, nuance, grammar rules>\",\n"
        "  \"distractor_analysis\": {\n"
        "    \"<other_choice_key>\": \"<why this choice is incorrect, common misconception or misuse>\"\n"
        "  },\n"
        "  \"grammar_notes\": \"<relevant grammar patterns, conjugations, particle usage>\",\n"
        "  \"kanji_vocabulary_notes\": \"<kanji readings, definitions, collocations>\",\n"
        "  \"reading_context_notes\": \"<contextual reasoning from passage or dialogue if applicable>\"\n"
        "}\n\n"
        "Return ONLY the JSON object."
    )

    return "\n".join(lines)

