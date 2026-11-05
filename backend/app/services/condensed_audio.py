"""
Kiroku Note - Condensed Audio Generator Service
Generates dialogue-only condensed audio by concatenating audio segments matching dialogue subtitle cues using FFmpeg.
"""
from typing import List, Dict, Any, Union
import subprocess
import os

def build_ffmpeg_concat_filter(cues: List[Union[Dict[str, Any], Any]], padding: float = 0.0) -> str:
    """
    Builds an FFmpeg complex filtergraph string that trims each cue and concatenates them.
    Each cue has start time 's' and end time 'e'.
    Optionally applies padding buffer (seconds) with max(0.0, s - padding) to prevent clipping dialogue.
    """
    if not cues:
        return ""
    
    parts = []
    labels = []
    for idx, cue in enumerate(cues):
        s = float(cue.get("s", 0.0) if isinstance(cue, dict) else getattr(cue, "s", 0.0))
        e = float(cue.get("e", 0.0) if isinstance(cue, dict) else getattr(cue, "e", 0.0))
        start_t = max(0.0, s - padding) if padding > 0 else s
        end_t = e + padding if padding > 0 else e
        label = f"a{idx}"
        parts.append(f"[0:a]atrim=start={start_t}:end={end_t},asetpts=PTS-STARTPTS[{label}]")
        labels.append(f"[{label}]")
    
    concat_part = f"{''.join(labels)}concat=n={len(cues)}:v=0:a=1[out]"
    return ";".join(parts) + ";" + concat_part
