"""AnkiConnect service encapsulating all HTTP/JSON-RPC operations."""
from __future__ import annotations

import html
import json
import os
import re
import socket
from typing import Any
import urllib.error
import urllib.request

from app.services.anki_formatter import (
    escape_html,
    format_basic_back,
    format_example_html,
    format_kanji_html,
    format_meaning_html,
    format_pitch_badge,
    format_ruby_html,
    sanitize_media_tags,
)
from app.services.card_normalizer import normalize_deck, normalize_expression, normalize_reading


def _clean_field_text(raw: str) -> str:
    """Strip HTML tags and unescape HTML entities from Anki field values."""
    if not raw:
        return ""
    cleaned = re.sub(r"<[^>]+>", "", raw)
    return html.unescape(cleaned).strip()


def _get_field(obj: Any, field_name: str) -> Any:
    if isinstance(obj, dict):
        return obj.get(field_name)
    return getattr(obj, field_name, None)


class AnkiError(Exception):
    """Base exception for AnkiConnect operations."""
    pass


class AnkiConnectionError(AnkiError):
    """Raised when AnkiConnect cannot be reached (e.g. connection refused)."""
    pass


class AnkiTimeoutError(AnkiError):
    """Raised when an AnkiConnect request times out."""
    pass


class AnkiResponseError(AnkiError):
    """Raised when AnkiConnect returns invalid or unparseable JSON/shape."""
    pass


class AnkiActionError(AnkiError):
    """Raised when AnkiConnect returns an error field in the JSON-RPC response."""
    pass


DEFAULT_ANKICONNECT_URL = "http://127.0.0.1:8765"

# Canonical media field keywords recognized across standard and community note models
IMAGE_FIELD_KEYWORDS: tuple[str, ...] = (
    "image", "picture", "sentenceimage", "sentencepicture",
    "vocabimage", "vocabpicture", "screenshot", "photo",
    "snapshot", "illustration", "images", "pictures"
)

AUDIO_FIELD_KEYWORDS: tuple[str, ...] = (
    "sentenceaudio", "sentencesound", "sentenceaudiofile", "sentence audio", "sentence sound",
    "audio", "sound", "vocabaudio", "vocabsound", "vocab audio", "vocab sound",
    "wordaudio", "word audio", "targetaudio", "targetwordaudio", "kanaaudio", "readingaudio",
    "voice", "pronunciation", "audios", "sounds"
)


class AnkiConnectService:
    """Encapsulates all AnkiConnect HTTP communication and note mapping."""

    def __init__(self, endpoint_url: str | None = None, timeout_seconds: float = 5.0):
        self.endpoint_url = endpoint_url or os.getenv("ANKICONNECT_URL", DEFAULT_ANKICONNECT_URL)
        self.timeout_seconds = timeout_seconds

    def _invoke(self, action: str, **params: Any) -> Any:
        """Send a JSON-RPC request to AnkiConnect."""
        payload = {
            "action": action,
            "version": 6,
            "params": params,
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.endpoint_url,
            data=data,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout_seconds) as response:
                raw_bytes = response.read()
        except urllib.error.HTTPError as error:
            try:
                body = error.read().decode("utf-8")
                parsed = json.loads(body)
                if isinstance(parsed, dict) and parsed.get("error"):
                    raise AnkiActionError(f"AnkiConnect error on '{action}': {parsed['error']}") from error
            except (ValueError, UnicodeDecodeError):
                pass
            raise AnkiResponseError(f"HTTP {error.code} error from AnkiConnect: {error.reason}") from error
        except (urllib.error.URLError, socket.error) as error:
            reason = getattr(error, "reason", error)
            if isinstance(reason, socket.timeout) or "timed out" in str(reason).lower():
                raise AnkiTimeoutError(f"AnkiConnect timed out on '{action}': {reason}") from error
            raise AnkiConnectionError(f"Cannot connect to AnkiConnect at {self.endpoint_url}: {reason}") from error
        except TimeoutError as error:
            raise AnkiTimeoutError(f"AnkiConnect timed out on '{action}': {error}") from error
        except Exception as error:
            raise AnkiError(f"Unexpected error communicating with AnkiConnect: {error}") from error

        try:
            body_text = raw_bytes.decode("utf-8")
            parsed = json.loads(body_text)
        except (ValueError, UnicodeDecodeError) as error:
            raise AnkiResponseError(f"Malformed JSON response from AnkiConnect: {error}") from error

        if not isinstance(parsed, dict):
            raise AnkiResponseError(f"Unexpected response shape from AnkiConnect: expected dict, got {type(parsed).__name__}")

        if "error" not in parsed:
            raise AnkiResponseError("AnkiConnect response missing 'error' field.")

        if parsed["error"] is not None:
            raise AnkiActionError(f"AnkiConnect error on '{action}': {parsed['error']}")

        return parsed.get("result")

    def get_version(self) -> int | str:
        """Return the AnkiConnect API version."""
        result = self._invoke("version")
        if result is None:
            raise AnkiResponseError("AnkiConnect returned empty version.")
        return result

    def is_connected(self) -> tuple[bool, str | None]:
        """Check if AnkiConnect is reachable. Returns (connected, error_message)."""
        try:
            self.get_version()
            return True, None
        except Exception as error:
            return False, str(error)

    def list_decks(self) -> list[str]:
        """Retrieve the list of existing deck names."""
        result = self._invoke("deckNames")
        if not isinstance(result, list):
            raise AnkiResponseError(f"Expected list of deck names, got {type(result).__name__}")
        return [str(d) for d in result]

    def create_deck(self, deck_name: str) -> None:
        """Create a deck if it does not already exist."""
        clean_deck = deck_name.strip() or "Default"
        self._invoke("createDeck", deck=clean_deck)

    def get_model_names(self) -> list[str]:
        """Retrieve all note model names in Anki."""
        result = self._invoke("modelNames")
        if not isinstance(result, list):
            raise AnkiResponseError(f"Expected list of model names, got {type(result).__name__}")
        return [str(m) for m in result]

    def get_model_field_names(self, model_name: str) -> list[str]:
        """Retrieve field names for a specific note model."""
        result = self._invoke("modelFieldNames", modelName=model_name)
        if not isinstance(result, list):
            raise AnkiResponseError(f"Expected list of field names for model '{model_name}', got {type(result).__name__}")
        return [str(f) for f in result]

    def store_media_file(self, filename: str, data_bytes: bytes | None = None, base64_data: str | None = None) -> str:
        """
        Store a media file in Anki's media collection using storeMediaFile action.
        Accepts raw data bytes or base64 encoded string.
        """
        import base64 as b64_mod
        clean_name = os.path.basename(filename)
        if base64_data is not None:
            b64_payload = base64_data
        elif data_bytes is not None:
            b64_payload = b64_mod.b64encode(data_bytes).decode("ascii")
        else:
            raise AnkiActionError("No media data provided to store_media_file.")

        result = self._invoke("storeMediaFile", filename=clean_name, data=b64_payload, deleteExisting=False)
        return str(result or clean_name)

    def find_existing_note(self, deck_name: str, expression: str, reading: str = "") -> int | None:
        """
        Query AnkiConnect for notes in the deck matching normalized expression and reading.
        Uses findNotes to retrieve candidates, then notesInfo to inspect actual fields.
        Safely escapes user input to avoid query injection.
        """
        norm_target_expr = normalize_expression(expression)
        norm_target_read = normalize_reading(reading)

        # Sanitize deck and expression for query: strip quotes and backslashes
        safe_deck = deck_name.replace('"', '\\"').replace("'", "")
        # Search candidates in deck with expression token
        safe_term = expression.strip().replace('"', '\\"').replace("'", "").replace("*", "")

        # Guard: if expression is empty after sanitization, we cannot identify any
        # specific note. Issuing a bare deck query would match every note in the deck
        # and could produce false positives. Return None immediately.
        if not safe_term:
            return None

        query = f'deck:"{safe_deck}" "{safe_term}"'

        candidate_ids = self._invoke("findNotes", query=query)
        if not isinstance(candidate_ids, list) or not candidate_ids:
            return None

        # Inspect candidates in chunks (max 50)
        note_infos = self._invoke("notesInfo", notes=candidate_ids[:50])
        if not isinstance(note_infos, list):
            return None

        for note in note_infos:
            if not isinstance(note, dict):
                continue

            # Optional deck validation if note includes deckName
            if "deckName" in note and note["deckName"]:
                if normalize_deck(note["deckName"]) != normalize_deck(deck_name):
                    continue

            fields = note.get("fields", {})
            # Look for expression and reading in field values
            found_expr = ""
            found_read = ""
            for field_name, field_dict in fields.items():
                raw_val = field_dict.get("value", "") if isinstance(field_dict, dict) else str(field_dict)
                val = _clean_field_text(raw_val)
                lower_name = field_name.lower().replace(" ", "").replace("_", "")
                if lower_name in ("expression", "japanese", "word", "front", "kanji"):
                    if not found_expr or lower_name in ("expression", "japanese", "word"):
                        found_expr = val
                elif lower_name in ("reading", "furigana", "kana"):
                    found_read = val

            if not found_expr:
                continue

            # Check matching expression: direct match or bracketed reading (e.g. Basic model "映画 [えいが]")
            expr_matched = False
            extracted_reading = ""

            if normalize_expression(found_expr) == norm_target_expr:
                expr_matched = True
            else:
                base_expr = re.sub(r"\[[^\]]+\]", "", found_expr).strip()
                if normalize_expression(base_expr) == norm_target_expr:
                    expr_matched = True
                    brackets = re.findall(r"\[([^\]]+)\]", found_expr)
                    extracted_reading = "".join(brackets).strip()

            if not expr_matched:
                continue

            effective_read = found_read or extracted_reading
            # If reading is present in both, compare reading
            if norm_target_read and effective_read:
                if normalize_reading(effective_read) == norm_target_read:
                    return int(note["noteId"])
            else:
                return int(note["noteId"])

        return None

    def _model_supports_card(self, field_names: list[str]) -> bool:
        """Check if model fields contain at least one prompt field and one answer field."""
        fields_clean = {f.lower().replace(" ", "").replace("_", "").replace("-", "") for f in field_names}
        prompt_keywords = {
            "front", "expression", "word", "japanese", "kanji", "targetword",
            "vocabulary", "vocabkanji", "headword", "vocab"
        }
        answer_keywords = {
            "back", "meaning", "definition", "glossary", "english", "vocabmeaning",
            "primarymeaning", "englishmeaning", "vocabdef"
        }
        has_prompt = bool(fields_clean.intersection(prompt_keywords))
        has_answer = bool(fields_clean.intersection(answer_keywords))
        return has_prompt and has_answer

    def resolve_note_model(self) -> tuple[str, list[str]]:
        """
        Determine the note model to use.
        1. Check ANKI_NOTE_MODEL environment override if configured.
        2. Prefer models containing 'mining' or 'vocab' that support card fields.
        3. Check 'Basic' if available.
        4. Check any available model with 'japanese' that supports card fields.
        5. Fallback to any model supporting card fields, or 'Basic', or first available.
        """
        available = self.get_model_names()
        if not available:
            raise AnkiActionError("No note models available in Anki.")

        # 1. Environment override
        env_model = os.getenv("ANKI_NOTE_MODEL")
        if env_model and env_model in available:
            return env_model, self.get_model_field_names(env_model)

        # 2. Prefer mining/vocab models that support cards
        for name in available:
            lower = name.lower()
            if any(k in lower for k in ("mining", "vocab")):
                fields = self.get_model_field_names(name)
                if self._model_supports_card(fields):
                    return name, fields

        # 3. Check Basic
        if "Basic" in available:
            fields = self.get_model_field_names("Basic")
            if self._model_supports_card(fields):
                return "Basic", fields

        # 4. Check other Japanese models supporting cards
        for name in available:
            if "japanese" in name.lower():
                fields = self.get_model_field_names(name)
                if self._model_supports_card(fields):
                    return name, fields

        # 5. Check any model supporting cards
        for name in available:
            fields = self.get_model_field_names(name)
            if self._model_supports_card(fields):
                return name, fields

        if "Basic" in available:
            return "Basic", self.get_model_field_names("Basic")

        first = available[0]
        fields = self.get_model_field_names(first)
        return first, fields

    def get_model_capabilities(self, model_name: str | None = None) -> dict[str, Any]:
        """
        Inspect capabilities of a model in Anki.
        If model_name is not provided, resolves the default note model.
        Returns dict with model_name, fields, supports_image, supports_audio, supports_sentence.
        """
        if model_name and model_name.strip():
            chosen_model = model_name.strip()
            fields = self.get_model_field_names(chosen_model)
        else:
            chosen_model, fields = self.resolve_note_model()

        fields_clean = {f.lower().replace(" ", "").replace("_", "").replace("-", "") for f in fields}

        image_keywords = set(IMAGE_FIELD_KEYWORDS)
        supports_image = bool(fields_clean.intersection(image_keywords))

        audio_keywords = set(AUDIO_FIELD_KEYWORDS)
        supports_audio = bool(fields_clean.intersection(audio_keywords))

        sentence_keywords = {"examplesentence", "sentenceexpression", "sentence", "sentences", "example", "examples"}
        supports_sentence = bool(fields_clean.intersection(sentence_keywords))

        audio_field = None
        for f in fields:
            clean = f.lower().replace(" ", "").replace("_", "").replace("-", "")
            if clean in audio_keywords:
                audio_field = f
                break

        image_field = None
        for f in fields:
            clean = f.lower().replace(" ", "").replace("_", "").replace("-", "")
            if clean in image_keywords:
                image_field = f
                break

        return {
            "model_name": chosen_model,
            "fields": fields,
            "supports_image": supports_image,
            "supports_audio": supports_audio,
            "supports_sentence": supports_sentence,
            "audio_field": audio_field,
            "image_field": image_field,
        }

    def map_card_to_fields(self, card: dict[str, Any], model_fields: list[str]) -> dict[str, str]:
        """
        Deterministically map card fields to the model's fields.
        Supports standard Japanese fields, community templates (Yomitan, Core 2k/6k, Kaishi, Japanese Mining),
        as well as Basic (Front/Back).
        Consumes AnkiFormatter for HTML formatting, ruby annotations, and media sanitization.
        """
        field_map: dict[str, str] = {}
        fields_lower = {f.lower().replace(" ", "").replace("_", "").replace("-", ""): f for f in model_fields}

        expr = str(card.get("expression", "") or "").strip()
        reading = str(card.get("reading", "") or "").strip()
        meaning = str(card.get("meaning", "") or "").strip()
        hint = str(card.get("hint", "") or "").strip()
        example = str(card.get("example_sentence", "") or "").strip()
        example_trans = str(card.get("example_translation", "") or "").strip()
        example_reading = card.get("example_reading")
        notes = str(card.get("notes", "") or "").strip()
        entries = card.get("entries")
        kanji_entries = card.get("kanji_entries")
        examples = card.get("examples")
        pitches = card.get("pitches")

        # Extract pitch if not provided at top-level
        if pitches is None and entries and isinstance(entries, list):
            for e in entries:
                e_pitches = e.get("pitches") if isinstance(e, dict) else getattr(e, "pitches", None)
                if e_pitches and isinstance(e_pitches, list):
                    pitches = e_pitches
                    break

        # Extract example reading with ruby if not provided at top-level
        if not example_reading:
            if entries and isinstance(entries, list):
                for e in entries:
                    for s in (e.get("senses") if isinstance(e, dict) else getattr(e, "senses", [])) or []:
                        for eg in (s.get("examples") if isinstance(s, dict) else getattr(s, "examples", [])) or []:
                            eg_ja = eg.get("japanese") if isinstance(eg, dict) else getattr(eg, "japanese", "")
                            eg_rd = eg.get("reading") if isinstance(eg, dict) else getattr(eg, "reading", "")
                            if eg_rd and (not example or eg_ja == example):
                                example_reading = eg_rd
                                break
            if not example_reading and examples and isinstance(examples, list):
                for eg in examples:
                    eg_ja = eg.get("japanese") if isinstance(eg, dict) else getattr(eg, "japanese", "")
                    eg_rd = eg.get("reading") if isinstance(eg, dict) else getattr(eg, "reading", "")
                    if eg_rd and (not example or eg_ja == example):
                        example_reading = eg_rd
                        break

        # Extract JLPT level from card if present
        jlpt_level = card.get("jlpt_level") if isinstance(card, dict) else getattr(card, "jlpt_level", None)

        # Media values sanitized for Anki
        raw_img = (card.get("image") or "").strip()
        raw_aud = (card.get("audio") or "").strip()

        # Format image and audio for custom model fields (no extra class)
        formatted_img, formatted_aud = sanitize_media_tags(image=raw_img, audio=raw_aud, img_class=None)

        # Formatted meaning HTML
        formatted_meaning = format_meaning_html(meaning_text=meaning, entries=entries)

        # Escaped plain text values
        escaped_expr = escape_html(expr)
        escaped_reading = escape_html(reading)
        escaped_hint = escape_html(hint)
        escaped_notes = escape_html(notes)
        escaped_trans = escape_html(example_trans)

        # Check if model is standard Front/Back (Basic)
        if "front" in fields_lower and "back" in fields_lower:
            front_field = fields_lower["front"]
            back_field = fields_lower["back"]

            # Template settings resolution (single source of truth)
            settings = card.get("card_settings") if isinstance(card, dict) else getattr(card, "card_settings", None)
            settings = settings or {}
            front_cfg = settings.get("front", {}) if isinstance(settings, dict) else {}
            back_cfg = settings.get("back", {}) if isinstance(settings, dict) else {}

            show_reading_front = bool(front_cfg.get("show_reading", False))
            show_meaning_front = bool(front_cfg.get("show_meaning", False))
            show_kanji_reading_front = bool(front_cfg.get("show_kanji_reading", False))
            show_hint_front = bool(front_cfg.get("show_hint", False))

            show_reading_back = bool(back_cfg.get("show_reading", True))
            show_meaning_back = bool(back_cfg.get("show_meaning", True))
            show_hint_back = bool(back_cfg.get("show_hint", True))
            show_jlpt = bool(settings.get("show_jlpt", True))

            # Front: Japanese expression is base. Optional reading, kanji reading, meaning, hint
            front_elements = [escaped_expr]
            if show_reading_front and reading:
                front_elements.append(f'<div class="kn-front-reading">{escaped_reading}</div>')
            if show_kanji_reading_front and kanji_entries:
                kanji_readings = []
                for k in kanji_entries:
                    onyomi = _get_field(k, "onyomi") or []
                    kunyomi = _get_field(k, "kunyomi") or []
                    parts = []
                    if onyomi:
                        parts.append(f'<span class="kn-reading-lbl">On:</span> <span class="kn-onyomi">{", ".join(escape_html(str(x)) for x in onyomi)}</span>')
                    if kunyomi:
                        parts.append(f'<span class="kn-reading-lbl">Kun:</span> <span class="kn-kunyomi">{", ".join(escape_html(str(x)) for x in kunyomi)}</span>')
                    if parts:
                        kanji_readings.append(" ".join(parts))
                if kanji_readings:
                    front_elements.append(f'<div class="kn-front-kanji-reading">{"<br>".join(kanji_readings)}</div>')
            if show_meaning_front and formatted_meaning:
                front_elements.append(f'<div class="kn-front-meaning">{formatted_meaning}</div>')
            if show_hint_front and hint:
                front_elements.append(f'<div class="kn-hint">Hint: {escaped_hint}</div>')

            if len(front_elements) > 1:
                field_map[front_field] = f'<div class="kn-front-expression">{escaped_expr}</div>\n' + "\n".join(front_elements[1:])
            else:
                field_map[front_field] = escaped_expr

            # Dedicated media field detection on Basic model
            dedicated_img_field = None
            if formatted_img:
                for k in IMAGE_FIELD_KEYWORDS:
                    clean_k = k.lower().replace(" ", "").replace("_", "").replace("-", "")
                    if clean_k in fields_lower and clean_k not in ("front", "back"):
                        dedicated_img_field = fields_lower[clean_k]
                        break

            dedicated_aud_field = None
            if formatted_aud:
                for k in AUDIO_FIELD_KEYWORDS:
                    clean_k = k.lower().replace(" ", "").replace("_", "").replace("-", "")
                    if clean_k in fields_lower and clean_k not in ("front", "back"):
                        dedicated_aud_field = fields_lower[clean_k]
                        break

            # If dedicated media fields exist, omit from Back composite
            img_for_back = "" if dedicated_img_field else raw_img
            aud_for_back = "" if dedicated_aud_field else raw_aud

            # Back: generated via AnkiFormatter respecting card_settings
            field_map[back_field] = format_basic_back(
                card=card,
                expression=expr,
                reading=reading,
                meaning=meaning,
                entries=entries,
                kanji_entries=kanji_entries,
                example_sentence=example,
                example_reading=example_reading,
                example_translation=example_trans,
                hint=hint,
                notes=notes,
                image=img_for_back,
                audio=aud_for_back,
                pitches=pitches,
                jlpt_level=jlpt_level,
                show_reading=show_reading_back,
                show_meaning=show_meaning_back,
                show_jlpt=show_jlpt,
                show_hint=show_hint_back,
            )

            # Assign to dedicated media fields if present
            if dedicated_img_field and formatted_img:
                field_map[dedicated_img_field] = formatted_img
            if dedicated_aud_field and formatted_aud:
                field_map[dedicated_aud_field] = formatted_aud

            # Populate additional non-media fields if present in model
            if "word" in fields_lower and fields_lower["word"] not in field_map and escaped_expr:
                field_map[fields_lower["word"]] = escaped_expr
            if "reading" in fields_lower and fields_lower["reading"] not in field_map and escaped_reading:
                field_map[fields_lower["reading"]] = escaped_reading

            return field_map

        # Check if model has a dedicated translation field
        has_trans_field = any(
            k in fields_lower
            for k in (
                "exampletranslation",
                "sentencetranslation",
                "sentenceenglish",
                "examplesentencemeaning",
                "translation",
            )
        )

        # Formatted example sentence HTML
        # If model has a dedicated translation field, don't duplicate translation in example sentence block
        formatted_example = format_example_html(
            japanese=example,
            translation=None if has_trans_field else example_trans,
            reading=example_reading,
        )

        # Specialized or multi-field model: match fields deterministically
        def assign(keys: tuple[str, ...], value: str) -> bool:
            if not value:
                return False
            for k in keys:
                clean_k = k.lower().replace(" ", "").replace("_", "").replace("-", "")
                if clean_k in fields_lower:
                    real_name = fields_lower[clean_k]
                    if real_name not in field_map:
                        field_map[real_name] = value
                        return True
            return False

        assign(("expression", "japanese", "word", "front", "kanji", "vocabkanji", "vocab", "targetword", "vocabulary", "headword"), escaped_expr)
        assign(("reading", "furigana", "kana", "vocabfurigana", "vocabreading", "kanareading", "readingfurigana"), escaped_reading)
        assign(("meaning", "glossary", "english", "definition", "back", "vocabdef", "vocabmeaning", "meaningglossary", "primarymeaning", "englishmeaning"), formatted_meaning)
        assign(("hint",), escaped_hint)
        assign(("examplesentence", "sentenceexpression", "sentence", "sentences", "example", "examples"), formatted_example)
        assign(("exampletranslation", "sentencetranslation", "sentenceenglish", "examplesentencemeaning", "translation"), escaped_trans)
        assign(("notes", "note", "comment"), escaped_notes)

        # Pitch field if supported by model
        if pitches and isinstance(pitches, list) and pitches[0]:
            pitch_badge = format_pitch_badge(pitches[0])
            if pitch_badge:
                assign(("pitch", "pitchaccent", "vocabpitch"), pitch_badge)

        # Kanji fields if supported by model
        if kanji_entries and isinstance(kanji_entries, list):
            formatted_kanji = format_kanji_html(kanji_entries)
            if formatted_kanji:
                assign(("kanjidata", "kanjientries", "kanjiinfo", "kanjidetails"), formatted_kanji)

        image_keys = IMAGE_FIELD_KEYWORDS
        img_assigned = assign(image_keys, formatted_img)

        audio_keys = AUDIO_FIELD_KEYWORDS
        aud_assigned = assign(audio_keys, formatted_aud)

        # If image was not assigned to a dedicated field, append to notes/back fallback idempotently
        if formatted_img and not img_assigned:
            clean_cand = raw_img
            if clean_cand.lower().startswith("<img"):
                m = re.search(r'src=["\']?([^"\' >]+)', clean_cand, re.IGNORECASE)
                clean_cand = m.group(1) if m else clean_cand
            clean_img_file = os.path.basename(clean_cand) if clean_cand else ""

            for fallback_key in ("notes", "note", "back"):
                if fallback_key in fields_lower:
                    real = fields_lower[fallback_key]
                    current = field_map.get(real, "")
                    already_has_image = (
                        (formatted_img and formatted_img in current)
                        or (clean_img_file and clean_img_file in current)
                    )
                    if not already_has_image:
                        field_map[real] = f"{current}<br><br>{formatted_img}" if current else formatted_img
                    break

        # Ensure at least the first model field is populated
        if model_fields and model_fields[0] not in field_map:
            field_map[model_fields[0]] = escaped_expr
        if len(model_fields) > 1 and model_fields[1] not in field_map and formatted_meaning:
            field_map[model_fields[1]] = formatted_meaning

        return field_map

    def add_note(
        self,
        deck_name: str,
        card_data: dict[str, Any],
        tags: list[str] | None = None,
        model_name: str | None = None,
    ) -> int:
        """
        Add a note to AnkiConnect in the specified deck.
        Creates deck if missing, resolves note model (or uses specified model), maps fields, and creates note.
        Returns the new note ID.
        """
        clean_deck = deck_name.strip() or "Default"
        self.create_deck(clean_deck)

        if model_name and model_name.strip():
            chosen_model = model_name.strip()
            model_fields = self.get_model_field_names(chosen_model)
        else:
            chosen_model, model_fields = self.resolve_note_model()

        mapped_fields = self.map_card_to_fields(card_data, model_fields)

        note_payload = {
            "deckName": clean_deck,
            "modelName": chosen_model,
            "fields": mapped_fields,
            "options": {
                "allowDuplicate": False,
                "duplicateScope": "deck",
            },
            "tags": tags or [],
        }

        note_id = self._invoke("addNote", note=note_payload)
        if not note_id or not isinstance(note_id, int):
            raise AnkiActionError(f"AnkiConnect returned invalid note id: {note_id}")
        return int(note_id)
