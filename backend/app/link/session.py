"""
Link Video Session data models and state tracking.
"""
from __future__ import annotations

import time
from typing import Any, Dict, Optional


class LinkVideoSession:
    """Represents an active video playback tab attached from the extension."""

    def __init__(
        self,
        tab: int,
        site: str,
        title: str,
        duration: float,
        drm: bool = False,
    ):
        self.tab = tab
        self.site = site
        self.title = title
        self.duration = duration
        self.drm = drm
        self.last_state: Optional[Dict[str, Any]] = None
        self.last_cue_list: Optional[Dict[str, Any]] = None
        self.last_active_cue: Optional[Dict[str, Any]] = None
        self.created_at = time.time()
        self.updated_at = time.time()

    def update_attach(self, site: str, title: str, duration: float, drm: bool = False) -> None:
        self.site = site
        self.title = title
        self.duration = duration
        self.drm = drm
        self.updated_at = time.time()

    def update_state(self, state: Dict[str, Any]) -> None:
        self.last_state = state
        self.updated_at = time.time()

    def update_cues(self, cue_list: Dict[str, Any]) -> None:
        self.last_cue_list = cue_list
        self.updated_at = time.time()

    def update_active_cue(self, cue: Dict[str, Any]) -> None:
        self.last_active_cue = cue
        self.updated_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tab": self.tab,
            "site": self.site,
            "title": self.title,
            "duration": self.duration,
            "drm": self.drm,
        }
