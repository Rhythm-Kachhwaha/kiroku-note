"""
Live Analysis Pipeline for Kiroku Link (Slice 40).

Asynchronous background analysis of incoming subtitle cues on `cue.list` receipt.
Annotates cues in chunks using SubtitleAnnotatorService, computes per-cue known%
and gap words, caches grammar points via GrammarService, and maintains an in-memory LRU.
Never blocks the WebSocket event loop.
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import logging
from typing import Any, Dict, List, Optional

from app.services.grammar_service import GrammarService
from app.services.subtitle_annotator import get_subtitle_annotator_service

logger = logging.getLogger(__name__)

# Max cue list hashes to retain in LRU memory cache
MAX_LRU_ENTRIES = 50


class LiveAnalysisPipeline:
    def __init__(self, max_entries: int = MAX_LRU_ENTRIES):
        self.max_entries = max_entries
        self.cache: OrderedDict[str, Dict[str, Any]] = OrderedDict()
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="link-analysis")
        self._grammar_service: Optional[GrammarService] = None

    @property
    def grammar_service(self) -> GrammarService:
        if self._grammar_service is None:
            self._grammar_service = GrammarService()
        return self._grammar_service

    def _get_hash(self, payload: Dict[str, Any]) -> str:
        if "hash" in payload and payload["hash"]:
            return str(payload["hash"])
        # Fallback hash generation from cue texts
        cues = payload.get("cues", [])
        combined = "".join(str(c.get("text", "")) for c in cues)
        return hashlib.sha256(combined.encode("utf-8")).hexdigest()[:16]

    def schedule_analysis(self, payload: Dict[str, Any], learner_level: Optional[str] = None) -> str:
        """Schedule background analysis of cues without blocking the caller."""
        cue_hash = self._get_hash(payload)
        cues = payload.get("cues", [])
        if not cues:
            return cue_hash

        if cue_hash in self.cache and self.cache[cue_hash].get("status") in ("ready", "processing"):
            self.cache.move_to_end(cue_hash)
            return cue_hash

        # Initialize cache entry
        entry: Dict[str, Any] = {
            "hash": cue_hash,
            "status": "processing",
            "total": len(cues),
            "completed": 0,
            "cues": [
                {
                    "i": c.get("i", idx),
                    "s": float(c.get("s", 0.0)),
                    "e": float(c.get("e", 0.0)),
                    "text": c.get("text", ""),
                    "tokens": [],
                    "known_pct": 0.0,
                    "gap_words": [],
                    "grammar": None,
                }
                for idx, c in enumerate(cues)
            ],
        }

        self.cache[cue_hash] = entry
        if len(self.cache) > self.max_entries:
            self.cache.popitem(last=False)

        # Offload chunked processing to threadpool
        try:
            loop = asyncio.get_running_loop()
            loop.run_in_executor(
                self._executor,
                self._process_cues_chunked,
                cues,
                cue_hash,
                learner_level,
            )
        except RuntimeError:
            # If no running loop (e.g. synchronous unit test), process directly in executor
            self._executor.submit(
                self._process_cues_chunked,
                cues,
                cue_hash,
                learner_level,
            )

        return cue_hash

    def _process_cues_chunked(
        self,
        raw_cues: List[Dict[str, Any]],
        cue_hash: str,
        learner_level: Optional[str] = None,
        chunk_size: int = 40,
    ) -> None:
        """Run annotation over cues in chunks using thread-safe SubtitleAnnotatorService."""
        annotator = get_subtitle_annotator_service()
        entry = self.cache.get(cue_hash)
        if not entry:
            return

        try:
            for start_idx in range(0, len(raw_cues), chunk_size):
                chunk = raw_cues[start_idx : start_idx + chunk_size]
                for offset, raw_cue in enumerate(chunk):
                    global_idx = start_idx + offset
                    text = raw_cue.get("text", "")
                    annotated = annotator.annotate_cue(raw_cue, learner_level=learner_level)

                    tokens_data = []
                    content_words = 0
                    known_words = 0
                    gap_words = []

                    for tok in getattr(annotated, "tokens", []):
                        status = getattr(tok, "status", "unstyled")
                        is_content = getattr(tok, "is_content_word", True) and not getattr(tok, "is_function_word", False)
                        surface = getattr(tok, "surface", "")

                        t_dict = {
                            "surface": surface,
                            "reading": getattr(tok, "reading", ""),
                            "lemma": getattr(tok, "lemma", surface),
                            "status": status,
                            "jlpt": getattr(tok, "jlpt", None),
                        }
                        tokens_data.append(t_dict)

                        if is_content:
                            content_words += 1
                            if status in ("known", "mined"):
                                known_words += 1
                            elif status in ("should_know", "gap"):
                                gap_words.append(surface)

                    known_pct = round((known_words / content_words) * 100, 1) if content_words > 0 else 100.0

                    if global_idx < len(entry["cues"]):
                        entry["cues"][global_idx]["tokens"] = tokens_data
                        entry["cues"][global_idx]["known_pct"] = known_pct
                        entry["cues"][global_idx]["gap_words"] = gap_words
                        entry["completed"] += 1

            entry["status"] = "ready"
        except Exception as exc:
            logger.exception("Error analyzing cues for hash %s: %s", cue_hash, exc)
            entry["status"] = "error"

    def get_cues(
        self,
        cue_hash: str,
        from_idx: Optional[int] = None,
        to_idx: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve annotated cues and vocabulary statistics for a given hash."""
        entry = self.cache.get(cue_hash)
        if not entry:
            return None

        self.cache.move_to_end(cue_hash)
        all_cues = entry["cues"]
        start = max(0, from_idx) if from_idx is not None else 0
        end = min(len(all_cues), to_idx) if to_idx is not None else len(all_cues)

        return {
            "hash": cue_hash,
            "status": entry["status"],
            "total": entry["total"],
            "completed": entry["completed"],
            "from": start,
            "to": end,
            "cues": all_cues[start:end],
        }

    def get_cue_grammar(self, cue_hash: str, cue_index: int) -> Optional[Dict[str, Any]]:
        """Retrieve or compute cached grammar points for a single cue."""
        entry = self.cache.get(cue_hash)
        if not entry:
            return None

        cue = next((c for c in entry["cues"] if c["i"] == cue_index), None)
        if not cue:
            return None

        # Return cached grammar if available
        if cue.get("grammar") is not None:
            return {
                "hash": cue_hash,
                "i": cue_index,
                "sentence": cue["text"],
                "points": cue["grammar"],
            }

        text = cue.get("text", "")
        if not text:
            cue["grammar"] = []
            return {"hash": cue_hash, "i": cue_index, "sentence": "", "points": []}

        # Analyze grammar using GrammarService
        try:
            analysis = self.grammar_service.analyze(text)
            points = analysis.get("points", [])
            formatted_points = [
                {
                    "id": p.get("id", ""),
                    "point": p.get("point", ""),
                    "title": p.get("title", p.get("point", "")),
                    "level": p.get("level", "N?"),
                    "description": p.get("description", ""),
                }
                if isinstance(p, dict)
                else {
                    "id": getattr(p, "id", ""),
                    "point": getattr(p, "point", ""),
                    "title": getattr(p, "title", getattr(p, "point", "")),
                    "level": getattr(p, "level", "N?"),
                    "description": getattr(p, "description", ""),
                }
                for p in points
            ]
            cue["grammar"] = formatted_points
            return {
                "hash": cue_hash,
                "i": cue_index,
                "sentence": text,
                "points": formatted_points,
            }
        except Exception as exc:
            logger.exception("Grammar analysis failed for cue %d in %s: %s", cue_index, cue_hash, exc)
            cue["grammar"] = []
            return {
                "hash": cue_hash,
                "i": cue_index,
                "sentence": text,
                "points": [],
            }


# Process-wide analysis pipeline singleton
analysis_pipeline = LiveAnalysisPipeline()


def install_link_hub_hook() -> None:
    """Hooks link_hub to automatically trigger background live analysis on cue.list receipt."""
    from app.link.hub import link_hub

    if getattr(link_hub, "_analysis_hook_installed", False):
        return

    orig_handle_message = link_hub.handle_message

    async def hooked_handle_message(sender: Any, raw_data: Any) -> None:
        await orig_handle_message(sender, raw_data)
        try:
            msg_type = raw_data.get("type") if isinstance(raw_data, dict) else getattr(raw_data, "type", "")
            if msg_type == "cue.list":
                payload = raw_data.get("payload", {}) if isinstance(raw_data, dict) else getattr(raw_data, "payload", {})
                analysis_pipeline.schedule_analysis(payload)
        except Exception as err:
            logger.debug("Failed to dispatch background cue.list analysis: %s", err)

    link_hub.handle_message = hooked_handle_message  # type: ignore[method-assign]
    setattr(link_hub, "_analysis_hook_installed", True)
