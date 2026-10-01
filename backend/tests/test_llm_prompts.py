"""Tests for LLM Prompt Synthesis, JLPT adaptation, and Short/Detailed modes."""
import pytest
from app.services.llm_service import (
    LLMService,
    build_system_instruction,
    build_user_prompt,
)


def test_build_system_instruction_jlpt_levels():
    for level in ["N5", "N4", "N3", "N2", "N1"]:
        instr = build_system_instruction(task="chat", jlpt_level=level, mode="short")
        assert f"JLPT {level}" in instr
        assert "emojis" in instr.lower()


def test_chat_prompt_answers_from_configured_level_and_skips_basics():
    instr = build_system_instruction(task="chat", jlpt_level="N3", mode="short")

    assert "configured study level" in instr
    assert "JLPT N3 is configured in Settings" in instr
    assert "do not say you lack information" in instr
    assert "skip those basics unless asked or needed" in instr


def test_build_system_instruction_modes():
    short_instr = build_system_instruction(task="explain_grammar", jlpt_level="N3", mode="short")
    assert "short" in short_instr.lower()

    detailed_instr = build_system_instruction(task="explain_grammar", jlpt_level="N3", mode="detailed")
    assert "detailed" in detailed_instr.lower()


def test_translate_prompt_short_vs_detailed():
    short_sys = build_system_instruction(task="translate", jlpt_level="N3", mode="short")
    assert "only the translation" in short_sys.lower() or "translation" in short_sys.lower()

    det_sys = build_system_instruction(task="translate", jlpt_level="N3", mode="detailed")
    assert "nuance" in det_sys.lower() or "ambiguity" in det_sys.lower()


def test_mcq_prompt_direct_answer():
    sys = build_system_instruction(task="answer_question", jlpt_level="N3", mode="short")
    assert "correct choice immediately" in sys.lower() or "direct answer" in sys.lower()


def test_grammar_prompt_no_table_filler():
    sys = build_system_instruction(task="explain_grammar", jlpt_level="N3", mode="short")
    assert "meaning" in sys.lower()
    assert "usage" in sys.lower()
    assert "example" in sys.lower()


def test_mnemonic_prompt_brief():
    sys = build_system_instruction(task="mnemonic", jlpt_level="N3", mode="short")
    assert "mnemonic" in sys.lower()
    assert "brief" in sys.lower() or "memorable" in sys.lower()


def test_build_user_prompt_tasks():
    # Sense in context
    user_p = build_user_prompt(
        task="explain_sense",
        text="雨が降る。",
        context="1. fall\n2. descend",
        word="降る",
    )
    assert "降る" in user_p
    assert "雨が降る。" in user_p
    assert "fall" in user_p

    # MCQ
    mcq_p = build_user_prompt(
        task="answer_question",
        text="円をドルに（　）する。",
        context="a. 両側\nb. 両替",
        word=None,
    )
    assert "円をドルに（　）する。" in mcq_p
    assert "両替" in mcq_p


def test_llm_service_ask_with_jlpt_and_mode():
    svc = LLMService()
    sys_p, user_p = svc.build_prompts(
        task="explain_grammar",
        text="彼女は行くはずがない。",
        mode="detailed",
        jlpt_level="N2",
    )
    assert "JLPT N2" in sys_p
    assert "Detailed" in sys_p or "detailed" in sys_p
    assert "彼女は行くはずがない。" in user_p
