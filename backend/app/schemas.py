from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


class CaptureRequest(BaseModel):
    """Untrusted text captured from the active webpage."""

    text: str = Field(max_length=500)
    deck_name: str = Field(default="Default", max_length=100)
    auto_save: bool = False

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Capture text must not be empty.")
        return normalized


class Example(BaseModel):
    japanese: str
    translation: Optional[str] = None
    reading: Optional[str] = None
    source_dictionary: Optional[str] = None


ExampleSentence = Example
ExampleSentenceSchema = Example


class PitchAccent(BaseModel):
    reading: str
    position: int
    pattern_name: Optional[str] = None
    nasal_positions: list[int] = Field(default_factory=list)
    devoice_positions: list[int] = Field(default_factory=list)
    dictionary: Optional[str] = None


PitchAccentSchema = PitchAccent


class FrequencyRank(BaseModel):
    dictionary: str
    frequency: int | float = 0
    display_value: Optional[str] = None
    rank: Optional[int] = None
    is_common: bool = False


FrequencyRankSchema = FrequencyRank


class Sense(BaseModel):
    index: int = 1
    glosses: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    examples: list[Example] = Field(default_factory=list)
    parts_of_speech: list[str] = Field(default_factory=list)
    field_tags: list[str] = Field(default_factory=list)


DictionarySense = Sense
DictionarySenseSchema = Sense


class DictionaryEntry(BaseModel):
    dictionary: str
    dictionary_alias: Optional[str] = None
    is_primary: bool = False
    term: str = ""
    reading: str = ""
    alt_terms: list[str] = Field(default_factory=list)
    alt_readings: list[str] = Field(default_factory=list)
    parts_of_speech: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    senses: list[Sense] = Field(default_factory=list)
    pitches: list[PitchAccent] = Field(default_factory=list)
    frequencies: list[FrequencyRank] = Field(default_factory=list)
    score: int = 0


DictionaryEntrySchema = DictionaryEntry


class KanjiEntry(BaseModel):
    character: str
    dictionary: str = "Unknown dictionary"
    dictionary_alias: Optional[str] = None
    onyomi: list[str] = Field(default_factory=list)
    kunyomi: list[str] = Field(default_factory=list)
    nanori: list[str] = Field(default_factory=list)
    meanings: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    stats: dict[str, str] = Field(default_factory=dict)
    frequencies: list[FrequencyRank] = Field(default_factory=list)


KanjiEntrySchema = KanjiEntry


class CaptureResponse(BaseModel):
    id: Optional[int] = None
    expression: str
    reading: str = ""
    meaning: str = ""
    hint: str = ""
    example_sentence: str = ""
    example_translation: str = ""
    image: str = ""
    audio: str = ""
    tags: str = ""
    notes: str = ""
    source_text: str = ""
    deinflected_text: str = ""
    jlpt_level: Optional[str] = None
    entries: list[DictionaryEntry] = Field(default_factory=list)
    kanji_entries: list[KanjiEntry] = Field(default_factory=list)
    dictionary_error: Optional[str] = None
    deck_name: str = "Default"
    model_name: str = ""
    status: str = "draft"
    sync_status: str = "pending"
    anki_note_id: Optional[int] = None
    is_duplicate: bool = False
    is_new: bool = False
    is_updated: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class SaveCardRequest(BaseModel):
    id: Optional[int] = None
    expression: str = Field(max_length=200)
    reading: str = Field(default="", max_length=200)
    meaning: str = Field(default="", max_length=2000)
    deck_name: str = Field(default="Default", max_length=100)
    model_name: str = Field(default="", max_length=100)
    hint: str = Field(default="", max_length=500)
    example_sentence: str = Field(default="", max_length=1000)
    example_translation: str = Field(default="", max_length=1000)
    image: str = Field(default="", max_length=5_000_000)
    audio: str = Field(default="", max_length=10_000_000)
    image_data: Optional[str] = Field(default=None, max_length=10_000_000)
    audio_data: Optional[str] = Field(default=None, max_length=20_000_000)
    media_mime_type: Optional[str] = Field(default=None, max_length=100)
    tags: str = Field(default="", max_length=500)
    notes: str = Field(default="", max_length=2000)
    source_text: str = Field(default="", max_length=500)
    deinflected_text: str = Field(default="", max_length=500)
    entries: list[dict[str, Any]] = Field(default_factory=list)
    kanji_entries: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("expression")
    @classmethod
    def expression_must_not_be_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Expression must not be empty.")
        return normalized


class SaveCardResponse(BaseModel):
    id: int
    expression: str
    reading: str = ""
    meaning: str = ""
    hint: str = ""
    example_sentence: str = ""
    example_translation: str = ""
    image: str = ""
    audio: str = ""
    tags: str = ""
    notes: str = ""
    source_text: str = ""
    deinflected_text: str = ""
    deck_name: str = "Default"
    model_name: str = ""
    status: str = "saved"
    sync_status: str = "pending"
    anki_note_id: Optional[int] = None
    sync_error: str = ""
    synced_at: Optional[str] = None
    is_duplicate: bool = False
    is_new: bool = True
    is_updated: bool = False
    created_at: str
    updated_at: str
    entries: list[dict[str, Any]] = Field(default_factory=list)
    kanji_entries: list[dict[str, Any]] = Field(default_factory=list)


class AnkiStatusResponse(BaseModel):
    connected: bool
    version: Optional[int | str] = None
    error: Optional[str] = None


class AnkiDecksResponse(BaseModel):
    decks: list[str] = ["Default"]
    connected: bool = True


class AnkiModelsResponse(BaseModel):
    models: list[str] = ["Basic"]
    connected: bool = True


class AnkiModelCapabilitiesResponse(BaseModel):
    connected: bool = True
    model_name: str = "Basic"
    fields: list[str] = ["Front", "Back"]
    supports_image: bool = False
    supports_audio: bool = False
    supports_sentence: bool = False
    error: Optional[str] = None


class SyncCardResponse(BaseModel):
    id: int
    sync_status: str
    anki_note_id: Optional[int] = None
    deck_name: str = "Default"
    model_name: Optional[str] = None
    error: Optional[str] = None
    synced_at: Optional[str] = None


class SyncAllResponse(BaseModel):
    total_eligible: int = 0
    synced_count: int = 0
    failed_count: int = 0
    results: list[SyncCardResponse] = Field(default_factory=list)
    error: Optional[str] = None



class CardSummary(BaseModel):
    id: int
    expression: str
    reading: str = ""
    meaning: str = ""
    deck_name: str = "Default"
    model_name: str = ""
    sync_status: str = "pending"
    anki_note_id: Optional[int] = None
    sync_error: str = ""
    created_at: str
    updated_at: str


class CardListResponse(BaseModel):
    cards: list[CardSummary] = []
    total: int = 0
    limit: int = 50
    offset: int = 0


class CardDetailResponse(BaseModel):
    id: int
    expression: str
    reading: str = ""
    meaning: str = ""
    hint: str = ""
    example_sentence: str = ""
    example_translation: str = ""
    image: str = ""
    audio: str = ""
    tags: str = ""
    notes: str = ""
    source_text: str = ""
    deinflected_text: str = ""
    deck_name: str = "Default"
    model_name: str = ""
    status: str = "saved"
    sync_status: str = "pending"
    anki_note_id: Optional[int] = None
    sync_error: str = ""
    synced_at: Optional[str] = None
    created_at: str
    updated_at: str
    entries: list[dict] = []
    kanji_entries: list[dict] = []


class DeleteCardResponse(BaseModel):
    id: int
    deleted: bool


class OcrStatusResponse(BaseModel):
    available: bool = False
    installed: bool = False
    engine: str = "manga-ocr"
    device: str = "cpu"
    model_loaded: bool = False
    error: Optional[str] = None


class OcrRecognizeRequest(BaseModel):
    image: str = Field(max_length=20_000_000, description="Base64 encoded image string or data URL")

    @field_validator("image")
    @classmethod
    def image_must_not_be_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Image data must not be empty.")
        return normalized


class OcrRecognizeResponse(BaseModel):
    text: str = ""
    engine: str = "manga-ocr"
    device: str = "cpu"
    duration_ms: float = 0.0
    error: Optional[str] = None



