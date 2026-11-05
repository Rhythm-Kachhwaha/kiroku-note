"""
Kiroku Note - Condensed Audio Generator Service
Generates dialogue-only condensed audio by concatenating audio segments matching dialogue subtitle cues using FFmpeg.
"""
from typing import List, Dict, Any, Union
import subprocess
import os

def build_ffmpeg_concat_filter(cues: List[Union[Dict[str, Any], Any]]) -> str:
    """
    Builds an FFmpeg complex filtergraph string that trims each cue and concatenates them.
    Each cue has start time 's' and end time 'e'.
    """
    if not cues:
        return ""
    
    parts = []
    labels = []
    for idx, cue in enumerate(cues):
        s = cue.get("s", 0.0) if isinstance(cue, dict) else getattr(cue, "s", 0.0)
        e = cue.get("e", 0.0) if isinstance(cue, dict) else getattr(cue, "e", 0.0)
        label = f"a{idx}"
        parts.append(f"[0:a]atrim=start={float(s)}:end={float(e)},asetpts=PTS-STARTPTS[{label}]")
        labels.append(f"[{label}]")
    
    concat_part = f"{''.join(labels)}concat=n={len(cues)}:v=0:a=1[out]"
    return ";".join(parts) + ";" + concat_part
