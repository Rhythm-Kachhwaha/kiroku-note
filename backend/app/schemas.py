from typing import Any, Literal, Optional, Union

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


class CrossReference(BaseModel):
    target_term: str
    display_text: str
    target_reading: Optional[str] = None
    target_sense_index: Optional[int] = None


CrossReferenceSchema = CrossReference


class Sense(BaseModel):
    index: int = 1
    glosses: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    examples: list[Example] = Field(default_factory=list)
    parts_of_speech: list[str] = Field(default_factory=list)
    field_tags: list[str] = Field(default_factory=list)
    cross_references: list[CrossReference] = Field(default_factory=list)


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
    raw_content: list[Any] = Field(default_factory=list)
    raw_tags: list[dict[str, Any]] = Field(default_factory=list)


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


class YomitanDictionariesResponse(BaseModel):
    available_dictionaries: list[str] = Field(default_factory=list)
    discovery_source: str = "yomitan_probe"
    disclaimer: str = "Discovered from enabled dictionaries responding in Yomitan."


class VerbMetadataSchema(BaseModel):
    is_verb: bool = False
    verb_type: Optional[str] = None
    is_transitive: bool = False
    is_intransitive: bool = False
    transitivity_label: str = "none"


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
    verb_metadata: Optional[VerbMetadataSchema] = None
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
    source_type: Optional[str] = Field(default="", max_length=100)
    source_url: Optional[str] = Field(default="", max_length=2000)
    entries: list[dict[str, Any]] = Field(default_factory=list)
    kanji_entries: list[dict[str, Any]] = Field(default_factory=list)
    card_settings: Optional[dict[str, Any]] = None
    jlpt_level: Optional[str] = None
    verb_metadata: Optional[VerbMetadataSchema] = None

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
    source_type: str = ""
    source_url: str = ""
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
    card_settings: Optional[dict[str, Any]] = None
    verb_metadata: Optional[VerbMetadataSchema] = None


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    yomitan: bool
    ankiconnect: bool
    ocr: bool
    db: bool


class AnkiStatusResponse(BaseModel):
    connected: bool
    version: Optional[int | str] = None
    error: Optional[str] = None
    endpoint_url: Optional[str] = None


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
    expression: Optional[str] = None


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
    source_type: str = ""
    source_url: str = ""
    jlpt_level: Optional[str] = None
    verb_metadata: Optional[VerbMetadataSchema] = None


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
    source_type: str = ""
    source_url: str = ""
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
    jlpt_level: Optional[str] = None
    verb_metadata: Optional[VerbMetadataSchema] = None


class DeleteCardResponse(BaseModel):
    id: int
    deleted: bool


class BulkDeleteCardsRequest(BaseModel):
    card_ids: list[int] = Field(default_factory=list)


class BulkDeleteCardsResponse(BaseModel):
    deleted_count: int
    deleted: bool = True
    card_ids: list[int] = Field(default_factory=list)


class BulkSyncCardsRequest(BaseModel):
    card_ids: list[int] = Field(default_factory=list)


class BulkDeckUpdateRequest(BaseModel):
    card_ids: list[int] = Field(default_factory=list)
    deck_name: str


class BulkDeckUpdateResponse(BaseModel):
    updated_count: int
    deck_name: str
    card_ids: list[int] = Field(default_factory=list)


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


class DeckStat(BaseModel):
    deck_name: str
    count: int


class MiningTimeframeStats(BaseModel):
    today: int = 0
    this_week: int = 0
    total: int = 0


class SyncRatioStats(BaseModel):
    synced: int = 0
    pending: int = 0
    failed: int = 0
    total: int = 0


class CardStatsResponse(BaseModel):
    total: int = 0
    today: int = 0
    this_week: int = 0
    timeframe: MiningTimeframeStats = Field(default_factory=MiningTimeframeStats)
    sync_ratio: SyncRatioStats = Field(default_factory=SyncRatioStats)
    jlpt_breakdown: dict[str, int] = Field(
        default_factory=lambda: {
            "N5": 0,
            "N4": 0,
            "N3": 0,
            "N2": 0,
            "N1": 0,
            "Unknown": 0,
        }
    )
    top_decks: list[DeckStat] = Field(default_factory=list)


# ============================================================================
# LLM Assistant Schemas
# ============================================================================

LLMTaskType = Literal[
    "translate",
    "explain_sense",
    "explain_grammar",
    "mnemonic",
    "answer_question",
    "chat",
]


LLMResponseMode = Literal["short", "detailed"]
LLMJLPTLevel = Literal["N1", "N2", "N3", "N4", "N5"]


class LLMChatMessage(BaseModel):
    role: Literal["user", "assistant"] = "user"
    content: str = Field(..., max_length=10_000)


class LLMRequest(BaseModel):
    task: LLMTaskType
    text: str = Field(..., max_length=10_000, description="The Japanese text, sentence, or user query")
    context: Optional[str] = Field(default=None, max_length=10_000, description="Optional surrounding text, dictionary definitions, or question options")
    word: Optional[str] = Field(default=None, max_length=200, description="Specific target word being analyzed")
    messages: Optional[list[LLMChatMessage]] = Field(default=None, max_length=20, description="Optional previous conversational history")
    mode: LLMResponseMode = Field(default="short", description="Response brevity mode: short (concise) or detailed (in-depth)")
    jlpt_level: Optional[LLMJLPTLevel] = Field(default=None, description="Learner JLPT level override (N5 to N1)")

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Text must not be empty.")
        return normalized

    @field_validator("messages")
    @classmethod
    def validate_messages_total_chars(cls, messages: Optional[list[LLMChatMessage]]) -> Optional[list[LLMChatMessage]]:
        if not messages:
            return messages
        total_chars = sum(len(m.content) for m in messages)
        if total_chars > 20_000:
            raise ValueError("Total characters across chat history messages must not exceed 20,000.")
        return messages


class LLMResponse(BaseModel):
    result: str
    provider: str
    model: str


class LLMStatusResponse(BaseModel):
    configured: bool
    provider: str
    model: Optional[str] = None
    key_name: Optional[str] = None


class LLMConfigResponse(BaseModel):
    provider: str = "none"
    model: Optional[str] = None
    ollama_url: str = "http://localhost:11434"
    configured: bool = False
    has_key: bool = False
    key_name: Optional[str] = None
    key_preview: Optional[str] = None
    provider_source: str = "default"
    timeout: float = 45.0
    jlpt_level: str = "N3"


class LLMConfigUpdateRequest(BaseModel):
    provider: Optional[str] = Field(default=None, max_length=50)
    model: Optional[str] = Field(default=None, max_length=100)
    key_name: Optional[str] = Field(default=None, max_length=100)
    ollama_url: Optional[str] = Field(default=None, max_length=500)
    api_key: Optional[str] = Field(default=None, max_length=1000)
    timeout: Optional[float] = Field(default=None, ge=5.0, le=180.0)
    jlpt_level: Optional[str] = Field(default=None, max_length=10)


class LLMSecretSaveRequest(BaseModel):
    api_key: str = Field(..., min_length=1, max_length=1000)
    key_name: Optional[str] = Field(default=None, max_length=100)


class LLMSecretSaveResponse(BaseModel):
    ok: bool = True
    configured: bool
    provider: str
    model: Optional[str] = None
    key_name: Optional[str] = None
    message: str = "API key configured securely."


class LLMSecretDeleteResponse(BaseModel):
    ok: bool = True
    configured: bool
    provider: str
    model: Optional[str] = None
    message: str = "API key removed."


class LLMTestRequest(BaseModel):
    provider: Optional[str] = Field(default=None, max_length=50)
    model: Optional[str] = Field(default=None, max_length=100)
    ollama_url: Optional[str] = Field(default=None, max_length=500)
    api_key: Optional[str] = Field(default=None, max_length=1000)


class LLMTestResponse(BaseModel):
    ok: bool
    provider: str
    model: Optional[str] = None
    duration_ms: float = 0.0
    error: Optional[str] = None
