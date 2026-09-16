"""
Live Anki Verification Script for Stage 5.5.
Executes live tests against Anki via AnkiConnectService:
1. Basic Model verification (Front, Back hierarchy, scoped CSS, ruby, pitch badge)
2. Multi-sense word verification (e.g. 掛ける with multiple senses, ordered lists, badges)
3. Media de-duplication verification (image/audio single assignment, idempotent fallback)
4. Custom model mappings verification (Kaishi 1.5k, japanese mining, Core 2000, Japanese sentences)
5. Security escaping verification (malicious scripts, attribute injection, media names)
Cleans up disposable test deck and notes after verification.
"""
from __future__ import annotations

import base64
import json
import os
import sys
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.repositories.card_repository import CardDraft
from app.services.anki_connect import AnkiConnectService
from app.services.anki_formatter import (
    escape_html,
    format_basic_back,
    format_example_html,
    format_meaning_html,
    format_pitch_badge,
    format_ruby_html,
    sanitize_media_tags,
)


def draft_to_dict(draft: CardDraft) -> dict[str, Any]:
    return {
        "expression": draft.expression,
        "reading": draft.reading,
        "meaning": draft.meaning,
        "hint": draft.hint,
        "example_sentence": draft.example_sentence,
        "example_translation": draft.example_translation,
        "image": draft.image,
        "audio": draft.audio,
        "tags": draft.tags,
        "notes": draft.notes,
        "entries": draft.entries,
    }


def run_live_verification() -> dict[str, bool]:
    service = AnkiConnectService()
    connected, err = service.is_connected()
    if not connected:
        print(f"[FAIL] Anki is not connected: {err}")
        return {"connected": False}

    print(f"[OK] Anki is connected. AnkiConnect version: {service.get_version()}")

    results = {}
    test_deck = "_kiroku_stage5_verify"
    service.create_deck(test_deck)

    try:
        # -------------------------------------------------------------
        # 1. Basic Model Card Creation & HTML Structure
        # -------------------------------------------------------------
        print("\n--- 1. Testing Basic Model Live Card ---")
        basic_draft = CardDraft(
            expression="食べる",
            reading="たべる",
            meaning="to eat; to consume",
            deck_name=test_deck,
            model_name="Basic",
            hint="ichidan verb",
            example_sentence="朝[あさ]御[ご]飯[はん]を食[た]べる。",
            example_translation="To eat breakfast.",
            notes="polite form: 食べます",
            entries=[
                {
                    "dictionary": "Jitendex",
                    "is_primary": True,
                    "pitches": [{"position": 2, "pattern_name": "nakadaka", "dictionary": "NHK"}],
                    "senses": [
                        {
                            "index": 1,
                            "glosses": ["to eat", "to consume"],
                            "parts_of_speech": ["v1", "vt"],
                            "tags": ["common"],
                        }
                    ],
                }
            ],
        )

        basic_fields = service.map_card_to_fields(draft_to_dict(basic_draft), ["Front", "Back"])
        assert "食べる" in basic_fields["Front"], "Front must contain expression"
        assert "[たべる]" in basic_fields["Front"], "Front must contain reading"

        back_html = basic_fields["Back"]
        assert '<div class="kn-hint">Hint: ichidan verb</div>' in back_html, "Back must contain hint"
        assert '<style>' in back_html, "Back must embed scoped CSS"
        assert ".kn-card" in back_html, "Back must contain .kn-card container"
        assert '<span class="kn-kana">たべる</span>' in back_html, "Back must render kana"
        assert '<span class="kn-pitch">[② Nakadaka]</span>' in back_html, "Back must render Tokyo pitch badge"
        assert '<hr class="kn-divider">' in back_html, "Back must render divider"
        assert '<span class="kn-pos">[v1, vt]</span>' in back_html, "Back must render POS badge"
        assert '<span class="kn-tag">[common]</span>' in back_html, "Back must render tag badge"
        assert "<ruby>朝<rt>あさ</rt></ruby>" in back_html, "Back must render ruby for 朝[あさ]"
        assert "<ruby>食<rt>た</rt></ruby>べる" in back_html, "Back must render ruby for 食[た]べる"
        assert '<p class="kn-example-en">To eat breakfast.</p>' in back_html, "Back must render translation"
        assert '<div class="kn-notes">Notes: polite form: 食べます</div>' in back_html, "Back must render notes"

        # Sync to Anki live
        basic_note_id = service.add_note(
            deck_name=test_deck,
            card_data=draft_to_dict(basic_draft),
            model_name="Basic",
        )
        assert basic_note_id and basic_note_id > 0
        print(f"[OK] Basic model note created live with ID: {basic_note_id}")
        results["basic_model"] = True

        # -------------------------------------------------------------
        # 2. Multi-Sense Word Live Verification (掛ける)
        # -------------------------------------------------------------
        print("\n--- 2. Testing Multi-Sense Word (掛ける) Live Card ---")
        kakeru_draft = CardDraft(
            expression="掛ける",
            reading="かける",
            meaning="1. to hang\n2. to multiply\n3. to spend (time/money)",
            deck_name=test_deck,
            model_name="Basic",
            example_sentence="壁[かべ]に絵[え]を掛[か]ける。",
            example_translation="To hang a picture on the wall.",
            entries=[
                {
                    "dictionary": "Jitendex",
                    "is_primary": True,
                    "pitches": [{"position": 2, "pattern_name": "nakadaka"}],
                    "senses": [
                        {"index": 1, "glosses": ["to hang (e.g. picture)", "to hoist"], "parts_of_speech": ["v1"], "tags": ["transitive"]},
                        {"index": 2, "glosses": ["to multiply (numbers)"], "parts_of_speech": ["v1"], "tags": ["math"]},
                        {"index": 3, "glosses": ["to spend (time)", "to expend (money)"], "parts_of_speech": ["v1"]},
                    ],
                }
            ],
        )

        kakeru_fields = service.map_card_to_fields(draft_to_dict(kakeru_draft), ["Front", "Back"])
        kakeru_back = kakeru_fields["Back"]
        assert '<ol class="kn-meanings">' in kakeru_back, "Multi-sense must use <ol class='kn-meanings'>"
        assert "to hang (e.g. picture), to hoist" in kakeru_back, "Sense 1 glosses present"
        assert "[math]" in kakeru_back, "Sense 2 math tag badge present"
        assert "to spend (time), to expend (money)" in kakeru_back, "Sense 3 glosses present"

        kakeru_note_id = service.add_note(
            deck_name=test_deck,
            card_data=draft_to_dict(kakeru_draft),
            model_name="Basic",
        )
        assert kakeru_note_id and kakeru_note_id > 0
        print(f"[OK] Multi-sense word note created live with ID: {kakeru_note_id}")
        results["multi_sense"] = True

        # -------------------------------------------------------------
        # 3. Media De-duplication & Idempotency Live Verification
        # -------------------------------------------------------------
        print("\n--- 3. Testing Media De-duplication Live Verification ---")
        # 1x1 transparent PNG payload
        dummy_png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        img_name = "kiroku_verify_test_img.png"
        service.store_media_file(img_name, base64_data=dummy_png)

        # 3a. Model with dedicated image field ("japanese mining" has "Front", "Back", "word", "Audio", "Image")
        jm_fields_list = service.get_model_field_names("japanese mining") if "japanese mining" in service.get_model_names() else ["Front", "Back", "Image", "Audio"]
        jm_draft = CardDraft(
            expression="林檎",
            reading="りんご",
            meaning="apple",
            deck_name=test_deck,
            model_name="japanese mining" if "japanese mining" in service.get_model_names() else "Basic",
            image=img_name,
            notes="sample note",
        )

        jm_fields = service.map_card_to_fields(draft_to_dict(jm_draft), jm_fields_list)
        if "Image" in jm_fields:
            assert f'<img src="{img_name}">' in jm_fields["Image"], "Dedicated Image field must contain img tag"
            assert f'<img src="{img_name}">' not in jm_fields["Back"], "Image must NOT be duplicated into Back when dedicated Image field exists"
            print("[OK] Single-source assignment verified: Dedicated Image field populated without Back duplication.")

        # 3b. Basic model fallback idempotency
        basic_img_draft = CardDraft(
            expression="桜",
            reading="さくら",
            meaning="cherry blossom",
            deck_name=test_deck,
            model_name="Basic",
            image=img_name,
        )
        fields_pass1 = service.map_card_to_fields(draft_to_dict(basic_img_draft), ["Front", "Back"])
        assert fields_pass1["Back"].count(img_name) == 1, "Image filename must appear exactly once in Back"
        assert f'<img src="{img_name}" class="kn-image">' in fields_pass1["Back"], "Image tag formatted with kn-image class"

        # Re-sync with existing Back containing image
        basic_img_draft.notes = "added note"
        fields_pass2 = service.map_card_to_fields(draft_to_dict(basic_img_draft), ["Front", "Back"])
        assert fields_pass2["Back"].count(img_name) == 1, "Repeated sync must not duplicate image"
        print("[OK] Media idempotency verified: Image appears exactly once on repeated sync.")
        results["media_dedup"] = True

        # -------------------------------------------------------------
        # 4. Custom Model Mappings Live Verification
        # -------------------------------------------------------------
        print("\n--- 4. Testing Live Custom Note Model Mappings ---")
        models_in_anki = service.get_model_names()
        target_models = ["Kaishi 1.5k", "japanese mining", "Core 2000", "Japanese sentences"]

        for m_name in target_models:
            if m_name in models_in_anki:
                m_fields = service.get_model_field_names(m_name)
                draft = CardDraft(
                    expression="猫",
                    reading="ねこ",
                    meaning="cat",
                    deck_name=test_deck,
                    model_name=m_name,
                    example_sentence="猫[ねこ]が好[す]きです。",
                    example_translation="I like cats.",
                    image=img_name,
                    entries=[
                        {
                            "dictionary": "Jitendex",
                            "is_primary": True,
                            "pitches": [{"position": 1, "pattern_name": "atamadaka"}],
                            "senses": [{"index": 1, "glosses": ["cat", "feline"], "parts_of_speech": ["n"]}],
                        }
                    ],
                )
                mapped = service.map_card_to_fields(draft_to_dict(draft), m_fields)
                print(f"[OK] Model '{m_name}' fields successfully mapped ({len(mapped)} fields populated):")
                for k, v in mapped.items():
                    if v:
                        preview_val = v if len(v) < 60 else v[:55] + "..."
                        print(f"     - {k}: {preview_val}")
                # Live create card in Anki
                note_id = service.add_note(
                    deck_name=test_deck,
                    card_data=draft_to_dict(draft),
                    model_name=m_name,
                )
                assert note_id and note_id > 0
                print(f"     -> Live Anki Note Created: ID {note_id}")
            else:
                print(f"[SKIP] Model '{m_name}' not installed in Anki collection.")

        results["custom_models"] = True

        # -------------------------------------------------------------
        # 5. Security & XSS Escaping Live Verification
        # -------------------------------------------------------------
        print("\n--- 5. Testing Security & XSS Escaping ---")
        xss_draft = CardDraft(
            expression="<script>alert(1)</script>",
            reading="<img src=x onerror=alert(2)>",
            meaning='"><script>alert(3)</script>',
            deck_name=test_deck,
            model_name="Basic",
            hint="<b onmouseover=alert(4)>hint</b>",
            example_sentence='<script>malicious</script>朝[<script>1</script>]ご飯',
            example_translation='<svg onload=alert(5)>',
            notes='"><iframe src="evil.com"></iframe>',
            image='evil" onfocus="alert(6).png',
        )
        xss_fields = service.map_card_to_fields(draft_to_dict(xss_draft), ["Front", "Back"])
        xss_front = xss_fields["Front"]
        xss_back = xss_fields["Back"]

        assert "<script>" not in xss_front, "Front must escape script tags"
        assert "&lt;script&gt;alert(1)&lt;/script&gt;" in xss_front, "Expression escaped"
        assert "&lt;img src=x onerror=alert(2)&gt;" in xss_front, "Reading escaped"
        assert "<script>" not in xss_back, "Back must escape script tags"
        assert "<iframe" not in xss_back, "Back must escape iframe tags"
        assert "&lt;svg onload=alert(5)&gt;" in xss_back, "Translation escaped"
        assert "onfocus=" not in xss_back, "Malicious media attribute breakout prevented"
        assert "alert(6)" not in xss_back, "Malicious media script prevented"

        xss_note_id = service.add_note(
            deck_name=test_deck,
            card_data=draft_to_dict(xss_draft),
            model_name="Basic",
        )
        assert xss_note_id and xss_note_id > 0
        print(f"[OK] XSS Payload note created safely with ID: {xss_note_id}")
        results["security"] = True

    finally:
        # -------------------------------------------------------------
        # Clean up disposable test deck and notes
        # -------------------------------------------------------------
        print("\n--- Cleaning up disposable test notes & deck ---")
        try:
            created_notes = service._invoke("findNotes", query=f'deck:"{test_deck}"')
            if created_notes:
                service._invoke("deleteNotes", notes=created_notes)
                print(f"[OK] Deleted {len(created_notes)} temporary verification notes.")
            service._invoke("deleteDecks", decks=[test_deck], cardsToo=True)
            print(f"[OK] Deleted disposable verification deck '{test_deck}'.")
        except Exception as e:
            print(f"[WARN] Cleanup note: {e}")

    return results


if __name__ == "__main__":
    res = run_live_verification()
    print("\n=======================================================")
    print("LIVE ANKI VERIFICATION SUMMARY:", json.dumps(res, indent=2))
    print("=======================================================")
    all_ok = all(res.values()) if res else False
    sys.exit(0 if all_ok else 1)
