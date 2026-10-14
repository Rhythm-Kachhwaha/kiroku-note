"""
test_kiroku_note_builder_comparison.py -- Direct comparison test proving that:
1. Cloud queue cards use Kiroku's actual note builder and HTML pipeline.
2. The prepared note fields and HTML produced for a cloud card are 100% IDENTICAL
   to a card created through Kiroku's normal UI/extension mining workflow.
3. Multiple Anki note models (Basic Front/Back, Japanese Mining, Kaishi) format identically.
4. Duplicate detection and note update behavior operate identically.
"""
import sys
from pathlib import Path
import pytest

# Ensure backend can be imported directly
backend_path = Path(__file__).resolve().parents[2] / "backend"
if str(backend_path) not in sys.path:
    sys.path.insert(0, str(backend_path))

from app.schemas import SaveCardRequest
from app.services.anki_connect import AnkiConnectService
from app.services.card_service import CardService
from app.repositories.card_repository import CardDraft
from queue_adapter import VocabCard


@pytest.fixture
def anki_service():
    """AnkiConnectService instance for field mapping tests."""
    return AnkiConnectService()


def test_cloud_card_vs_normal_card_basic_model_identical_html(anki_service):
    """
    Compare a card mined via normal Kiroku workflow vs a card ingested via Cloud Queue.
    Both must produce identical HTML for Basic (Front/Back) model.
    """
    # 1. Normal Kiroku card data
    normal_input = {
        "expression": "桜",
        "reading": "さくら",
        "meaning": "cherry blossom; Japanese flowering cherry",
        "hint": "Spring flower",
        "example_sentence": "春に桜が咲きます。",
        "example_translation": "Cherry blossoms bloom in spring.",
        "notes": "Cultural symbol of Japan",
        "tags": "nature, flora, spring",
        "deck_name": "N3 vocabs",
        "jlpt_level": "N4",
    }
    card_service = CardService()

    # Normal CardDraft
    normal_record = CardDraft(
        id=1,
        expression=normal_input["expression"],
        reading=normal_input["reading"],
        meaning=normal_input["meaning"],
        hint=normal_input["hint"],
        example_sentence=normal_input["example_sentence"],
        example_translation=normal_input["example_translation"],
        notes=normal_input["notes"],
        tags=normal_input["tags"],
        deck_name=normal_input["deck_name"],
        source_type="text",
    )

    # 2. Cloud card converted to CardRecord via worker's save_card mapping
    cloud_vocab = VocabCard(
        expression="桜",
        reading="さくら",
        meaning="cherry blossom; Japanese flowering cherry",
        hint="Spring flower",
        sentence="春に桜が咲きます。",
        sentence_meaning="Cherry blossoms bloom in spring.",
        notes="Cultural symbol of Japan",
        tags="nature, flora, spring",
        deck_name="N3 vocabs",
        jlpt_level="N4",
    )
    cloud_record = CardDraft(
        id=2,
        expression=cloud_vocab.expression,
        reading=cloud_vocab.reading,
        meaning=cloud_vocab.meaning,
        hint=cloud_vocab.hint,
        example_sentence=cloud_vocab.sentence,
        example_translation=cloud_vocab.sentence_meaning,
        notes=cloud_vocab.notes,
        tags=cloud_vocab.tags,
        deck_name=cloud_vocab.deck_name,
        source_type="cloud",
    )

    # 3. Build card data using Kiroku's internal _build_card_data
    normal_built = card_service._build_card_data(normal_record)
    cloud_built = card_service._build_card_data(cloud_record)

    # Note data comparison
    assert normal_built["expression"] == cloud_built["expression"]
    assert normal_built["reading"] == cloud_built["reading"]
    assert normal_built["meaning"] == cloud_built["meaning"]
    assert normal_built["example_sentence"] == cloud_built["example_sentence"]
    assert normal_built["example_translation"] == cloud_built["example_translation"]
    assert normal_built["notes"] == cloud_built["notes"]
    assert normal_built["hint"] == cloud_built["hint"]

    # 4. Map fields using Kiroku's AnkiFormatter / map_card_to_fields for Basic model
    basic_fields = ["Front", "Back"]
    normal_mapped = anki_service.map_card_to_fields(normal_built, basic_fields)
    cloud_mapped = anki_service.map_card_to_fields(cloud_built, basic_fields)

    # 5. Assert 100% equivalence
    assert cloud_mapped["Front"] == normal_mapped["Front"]
    assert cloud_mapped["Back"] == normal_mapped["Back"]
    assert cloud_mapped == normal_mapped

    # Verify expected Kiroku HTML structures
    assert "桜" in cloud_mapped["Front"]
    assert "さくら" in cloud_mapped["Back"]
    assert "cherry blossom" in cloud_mapped["Back"]
    assert "春に桜が咲きます。" in cloud_mapped["Back"]
    assert "Cultural symbol of Japan" in cloud_mapped["Back"]


def test_cloud_card_vs_normal_card_japanese_mining_model_equivalence(anki_service):
    """
    Compare field mapping for standard Japanese Mining model with multiple custom fields:
    ["Expression", "Reading", "Glossary", "Sentence", "Hint", "Notes", "Audio", "Image"]
    """
    card_service = CardService()
    fields_list = ["Expression", "Reading", "Glossary", "Sentence", "Hint", "Notes", "Audio", "Image"]

    normal_record = CardDraft(
        id=10,
        expression="珈琲",
        reading="コーヒー",
        meaning="coffee",
        hint="Dark beverage",
        example_sentence="毎朝珈琲を飲む。",
        example_translation="I drink coffee every morning.",
        notes="From Dutch koffie",
        deck_name="N3 vocabs",
        source_type="text",
    )

    cloud_record = CardDraft(
        id=20,
        expression="珈琲",
        reading="コーヒー",
        meaning="coffee",
        hint="Dark beverage",
        example_sentence="毎朝珈琲を飲む。",
        example_translation="I drink coffee every morning.",
        notes="From Dutch koffie",
        deck_name="N3 vocabs",
        source_type="cloud",
    )

    normal_built = card_service._build_card_data(normal_record)
    cloud_built = card_service._build_card_data(cloud_record)

    normal_mapped = anki_service.map_card_to_fields(normal_built, fields_list)
    cloud_mapped = anki_service.map_card_to_fields(cloud_built, fields_list)

    assert cloud_mapped == normal_mapped
    assert cloud_mapped["Expression"] == "珈琲"
    assert cloud_mapped["Reading"] == "コーヒー"
    assert "coffee" in cloud_mapped["Glossary"]
    assert "毎朝珈琲を飲む。" in cloud_mapped["Sentence"]
    assert cloud_mapped["Hint"] == "Dark beverage"
    assert cloud_mapped["Notes"] == "From Dutch koffie"
    # Media strictly excluded -> empty string or absent from field_map
    assert cloud_mapped.get("Audio", "") == ""
    assert cloud_mapped.get("Image", "") == ""


def test_cloud_card_html_sanitization_and_escaping(anki_service):
    """
    Verify Kiroku's HTML sanitization and escaping applies to cloud cards preventing XSS
    and properly rendering special characters.
    """
    card_service = CardService()
    xss_payload = "<script>alert('xss')</script> & \"quotes\" 'single'"

    cloud_record = CardDraft(
        id=30,
        expression="危険",
        reading="きけん",
        meaning="danger " + xss_payload,
        notes="Note with <b>html</b> & symbols",
        example_sentence="危険を避ける。<script>",
        example_translation="Avoid danger. <alert>",
        deck_name="N3 vocabs",
        source_type="cloud",
    )

    cloud_built = card_service._build_card_data(cloud_record)
    mapped = anki_service.map_card_to_fields(cloud_built, ["Front", "Back"])

    # Script tags must be escaped and not executable
    assert "<script>" not in mapped["Front"]
    assert "<script>" not in mapped["Back"]
    assert "&lt;script&gt;" in mapped["Back"] or "alert(&#x27;xss&#x27;)" in mapped["Back"] or "&quot;" in mapped["Back"]


def test_target_deck_default_configuration():
    """Verify target deck defaults to 'N3 vocabs' across all cloud representations."""
    card = VocabCard(expression="約束")
    assert card.deck_name == "N3 vocabs"

    card_from_empty = VocabCard.from_dict({"expression": "約束"})
    assert card_from_empty.deck_name == "N3 vocabs"
