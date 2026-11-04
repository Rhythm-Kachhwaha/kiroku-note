"""
Live Analysis Pipeline for Kiroku Link (Slice 40).

Processes incoming `cue.list` events asynchronously in a background threadpool,
maintaining an in-memory LRU cache of annotated cues, known vocabulary percentages,
gap word lists, and cached grammar points per cue.
"""
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import logging
from typing import Any, Dict, List, Optional, Tuple

from app.config import get_learner_jlpt_level
from app.link.session import LinkVideoSession
from app.services.grammar_service import GrammarService
from app.services.subtitle_annotator import get_subtitle_annotator_service

logger = logging.getLogger(__name__)

MAX_LRU_ENTRIES = 50
MAX_GRAMMAR_CACHE_ENTRIES = 500


class LinkAnalysisService:
    """In-memory coordinator and background processor for live video subtitles."""

    def __init__(self, max_lru: int = MAX_LRU_ENTRIES):
        self.max_lru = max_lru
        # hash -> OrderedDict[int, Dict[str, Any]] (cue index i -> cue analysis)
        self._cues_cache: OrderedDict[str, Dict[int, Dict[str, Any]]] = OrderedDict()
        # (hash, cue_index) -> List[Dict[str, Any]]
        self._grammar_cache: OrderedDict[Tuple[str, int], List[Dict[str, Any]]] = OrderedDict()
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="link-analysis")
        self._grammar_service = GrammarService()

    def on_cue_list(self, cue_list_payload: Dict[str, Any], learner_level: Optional[str] = None) -> None:
        """Triggered upon cue.list receipt. Schedules chunked background annotation."""
        if not cue_list_payload or not isinstance(cue_list_payload, dict):
            return
        cue_hash = cue_list_payload.get("hash")
        cues = cue_list_payload.get("cues", [])
        if not cue_hash or not isinstance(cues, list):
            return

        level = learner_level or get_learner_jlpt_level()
        # Submit to threadpool so WebSocket event loop is never blocked
        self._executor.submit(self._process_cues_background, cue_hash, cues, level)

    def _process_cues_background(self, cue_hash: str, raw_cues: List[Dict[str, Any]], learner_level: str) -> None:
        """Background thread worker annotating cues in chunks."""
        try:
            annotator = get_subtitle_annotator_service(learner_level=learner_level)
            cues_map: Dict[int, Dict[str, Any]] = {}

            # Process in chunks of 25 to allow cache population incrementally
            chunk_size = 25
            for chunk_start in range(0, len(raw_cues), chunk_size):
                chunk = raw_cues[chunk_start:chunk_start + chunk_size]
                for cue in chunk:
                    idx = int(cue.get("i", 0))
                    text = cue.get("text", "")
                    start_t = float(cue.get("s", 0.0))
                    end_t = float(cue.get("e", 0.0))

                    if not text.strip():
                        cues_map[idx] = {
                            "i": idx,
                            "s": start_t,
                            "e": end_t,
                            "text": text,
                            "tokens": [],
                            "known_pct": 100.0,
                            "gap_words": [],
                        }
                        continue

                    # Annotate cue tokens
                    annotated = annotator.annotate_cue({
                        "id": idx,
                        "text": text,
                        "start": start_t,
                        "end": end_t,
                    }, learner_level=learner_level)

                    tokens = annotated.get("tokens", [])
                    known_count = 0
                    meaningful_tokens = 0
                    gap_words: List[str] = []

                    for tok in tokens:
                        status = tok.get("status", "unstyled")
                        is_punct = tok.get("pos") in ("補助記号", "記号") or not tok.get("surface", "").strip()
                        if not is_punct:
                            meaningful_tokens += 1
                            if status in ("known", "mined"):
                                known_count += 1
                            elif status in ("should_know", "gap"):
                                gap_words.append(tok.get("lemma") or tok.get("surface"))

                    known_pct = round((known_count / meaningful_tokens * 100.0), 1) if meaningful_tokens > 0 else 100.0

                    cues_map[idx] = {
                        "i": idx,
                        "s": start_t,
                        "e": end_t,
                        "text": text,
                        "tokens": tokens,
                        "known_pct": known_pct,
                        "gap_words": list(dict.fromkeys(gap_words)),  # preserve order, unique
                    }

            # Store in LRU cache
            if cue_hash in self._cues_cache:
                self._cues_cache.move_to_end(cue_hash)
            self._cues_cache[cue_hash] = cues_map

            while len(self._cues_cache) > self.max_lru:
                self._cues_cache.popitem(last=False)

        except Exception as e:
            logger.warning("[LinkAnalysis] Background cue processing failed for %s: %s", cue_hash, e)

    def get_cues_range(
        self,
        cue_hash: str,
        from_idx: Optional[int] = None,
        to_idx: Optional[int] = None,
    ) -> Optional[List[Dict[str, Any]]]:
        """Returns range of annotated cues with per-cue known% and gap words list."""
        if cue_hash not in self._cues_cache:
            return None

        self._cues_cache.move_to_end(cue_hash)
        cues_map = self._cues_cache[cue_hash]

        sorted_indices = sorted(cues_map.keys())
        filtered: List[Dict[str, Any]] = []

        for idx in sorted_indices:
            if from_idx is not None and idx < from_idx:
                continue
            if to_idx is not None and idx > to_idx:
                continue
            filtered.append(cues_map[idx])

        return filtered

    def get_cue_grammar(self, cue_hash: str, cue_index: int, learner_level: Optional[str] = None) -> Optional[List[Dict[str, Any]]]:
        """Returns cached grammar points for cue `cue_index`."""
        cache_key = (cue_hash, cue_index)
        if cache_key in self._grammar_cache:
            self._grammar_cache.move_to_end(cache_key)
            return self._grammar_cache[cache_key]

        if cue_hash not in self._cues_cache:
            return None

        cues_map = self._cues_cache[cue_hash]
        cue = cues_map.get(cue_index)
        if not cue:
            return None

        text = cue.get("text", "").strip()
        if not text:
            points: List[Dict[str, Any]] = []
        else:
            level = learner_level or get_learner_jlpt_level()
            try:
                res = self._grammar_service.analyze(text, learner_level=level)
                points = res.get("points", []) if isinstance(res, dict) else (getattr(res, "points", []) or [])
            except Exception as e:
                logger.debug("[LinkAnalysis] Grammar analysis failed for cue %d: %s", cue_index, e)
                points = []

        # Cache grammar points
        self._grammar_cache[cache_key] = points
        while len(self._grammar_cache) > MAX_GRAMMAR_CACHE_ENTRIES:
            self._grammar_cache.popitem(last=False)

        return points

    def clear(self) -> None:
        self._cues_cache.clear()
        self._grammar_cache.clear()


# Global analysis service singleton
link_analysis_service = LinkAnalysisService()

# Hook LinkVideoSession.update_cues so cue.list messages trigger background analysis automatically
_orig_update_cues = LinkVideoSession.update_cues


def _hooked_update_cues(self: LinkVideoSession, cue_list: Dict[str, Any]) -> None:
    _orig_update_cues(self, cue_list)
    try:
        link_analysis_service.on_cue_list(cue_list)
    except Exception as exc:
        logger.debug("[LinkAnalysis] update_cues hook error: %s", exc)


LinkVideoSession.update_cues = _hooked_update_cues
