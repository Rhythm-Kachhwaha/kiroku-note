import pytest
from app.services.condensed_audio import build_ffmpeg_concat_filter

def test_build_ffmpeg_concat_filter():
    cues = [{"s": 1.0, "e": 4.0}, {"s": 10.0, "e": 12.5}]
    filter_str = build_ffmpeg_concat_filter(cues)
    assert "[0:a]atrim=start=1.0:end=4.0,asetpts=PTS-STARTPTS[a0]" in filter_str
    assert "[0:a]atrim=start=10.0:end=12.5,asetpts=PTS-STARTPTS[a1]" in filter_str
    assert "[a0][a1]concat=n=2:v=0:a=1[out]" in filter_str

