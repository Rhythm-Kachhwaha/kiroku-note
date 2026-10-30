"""
Segmentation Subsystem for Question Ingestion.
----------------------------------------------
Decomposes extracted documents into QuestionDraft and GroupDraft candidates.
"""
from __future__ import annotations

from app.study.ingestion.segmentation.answer_keys import AnswerKeyParser
from app.study.ingestion.segmentation.parser import TextSegmenter
from app.study.ingestion.segmentation.patterns import normalize_label

__all__ = [
    "TextSegmenter",
    "AnswerKeyParser",
    "normalize_label",
]

