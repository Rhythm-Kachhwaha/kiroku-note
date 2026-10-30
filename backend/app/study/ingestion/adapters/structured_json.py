"""
Structured JSON Input Adapter for Question Ingestion.
----------------------------------------------------
Accepts structured question dictionaries, batches, or lists matching
the M2 question/group contract schemas or intermediate import definitions.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.study.contracts.enums import JlptLevel
from app.study.ingestion.adapters.base import BaseInputAdapter
from app.study.ingestion.enums import IngestAdapterKind
from app.study.ingestion.models import ExtractedDocument, ExtractedPage, IngestInput


class StructuredJsonInputAdapter(BaseInputAdapter):
    """Adapter for importing structured JSON data."""

    def extract(self, input_data: IngestInput) -> ExtractedDocument:
        content = input_data.content
        payload: Any

        if isinstance(content, (str, bytes)):
            raw_str = content.decode("utf-8-sig") if isinstance(content, bytes) else content.lstrip("\ufeff")
            if not raw_str.strip():
                raise ValueError("JSON content is empty.")
            try:
                payload = json.loads(raw_str)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Malformed JSON: {exc.msg} (line {exc.lineno}, col {exc.colno})") from exc
        elif isinstance(content, Path):
            if not content.is_file():
                raise ValueError(f"JSON file not found: {content}")
            with open(content, "r", encoding="utf-8-sig") as f:
                try:
                    payload = json.load(f)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"Malformed JSON in file {content}: {exc}") from exc
        elif isinstance(content, (dict, list)):
            payload = content
        else:
            raise ValueError(f"StructuredJsonInputAdapter requires str, bytes, dict, list, or Path, got {type(content).__name__}")

        # Normalize structure
        questions_data: list[dict[str, Any]] = []
        groups_data: list[dict[str, Any]] = []
        source_name = input_data.source_name
        source_type = input_data.source_type
        level = input_data.default_level

        if isinstance(payload, dict):
            # Check for container structure: {"source": ..., "questions": [...], "groups": [...]}
            if "source" in payload and isinstance(payload["source"], dict):
                src = payload["source"]
                source_name = src.get("name", source_name)
                source_type = src.get("source_type", source_type)
                if "level" in src and src["level"]:
                    try:
                        level = JlptLevel(src["level"].upper())
                    except ValueError:
                        pass

            if "questions" in payload and isinstance(payload["questions"], list):
                questions_data = [q for q in payload["questions"] if isinstance(q, dict)]
            elif "format_code" in payload or "prompt_markup" in payload or "stem" in payload:
                # Single question object
                questions_data = [payload]

            if "groups" in payload and isinstance(payload["groups"], list):
                groups_data = [g for g in payload["groups"] if isinstance(g, dict)]

        elif isinstance(payload, list):
            for item in payload:
                if isinstance(item, dict):
                    if "group_type" in item or "parts" in item:
                        groups_data.append(item)
                    else:
                        questions_data.append(item)

        if not questions_data and not groups_data:
            raise ValueError("Structured JSON does not contain any recognizable question or group objects.")

        canonical_text = json.dumps(payload, indent=2, ensure_ascii=False)

        return ExtractedDocument(
            adapter_kind=IngestAdapterKind.STRUCTURED_JSON,
            raw_text=canonical_text,
            pages=[ExtractedPage(page_number=1, text=canonical_text, confidence=1.0)],
            media_assets=[],
            source_name=source_name,
            source_type=source_type,
            license_or_permission=input_data.license_or_permission,
            citation=input_data.citation,
            url=input_data.url,
            default_level=level,
            extraction_method="structured_json",
            extraction_confidence=1.0,
            metadata={
                "json_payload": payload,
                "question_count": len(questions_data),
                "group_count": len(groups_data),
                "raw_questions": questions_data,
                "raw_groups": groups_data,
                **input_data.metadata,
            },
        )

