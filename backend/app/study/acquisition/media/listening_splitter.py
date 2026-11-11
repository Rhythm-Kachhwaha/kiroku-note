"""
Deterministic Listening Audio Splitter (Script Timestamps & WAV Silence).
-------------------------------------------------------------------------
Splits multi-question listening audio tracks into per-question segments using:
1. Timestamped script cues (e.g. `[00:12]`, `00:12 - 00:45`, `1番 (0:05-0:38)`), OR
2. Pure-Python PCM WAV amplitude silence detection.
"""
from __future__ import annotations

import re
import struct
from typing import Any

from pydantic import BaseModel

from app.study.acquisition.media.audio_duration import extract_audio_duration_ms


TIMESTAMP_RANGE_RE = re.compile(
    r"(?:(?P<label>(?:Question|Q|問)?\s*\d+\s*番?)\s*[\(\[]?\s*)?"
    r"(?P<start>\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)\s*[-~]\s*"
    r"(?P<end>\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)"
)

TIMESTAMP_SINGLE_RE = re.compile(
    r"^\s*[\[\(]?(?P<start>\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)[\]\)]?\s*(?P<rest>.*)$"
)


class ScriptTimestampCue(BaseModel):
    """A parsed time cue from a listening script."""

    label: str
    start_ms: int
    end_ms: int | None = None
    transcript: str = ""


class AudioSegment(BaseModel):
    """A single segmented listening clip or time window."""

    index: int
    start_ms: int
    end_ms: int
    duration_ms: int
    label: str = ""
    transcript: str = ""
    data: bytes | None = None


def parse_timestamp_to_ms(value: str) -> int:
    """Parse MM:SS(.mmm) or HH:MM:SS(.mmm) string to milliseconds."""
    parts = value.strip().split(":")
    if len(parts) == 2:
        minutes = int(parts[0])
        sec_f = float(parts[1])
        return int(round((minutes * 60 + sec_f) * 1000))
    if len(parts) == 3:
        hours = int(parts[0])
        minutes = int(parts[1])
        sec_f = float(parts[2])
        return int(round((hours * 3600 + minutes * 60 + sec_f) * 1000))
    raise ValueError(f"Unsupported timestamp format: {value}")


def parse_script_timestamps(
    script_text: str,
    total_duration_ms: int | None = None,
) -> list[ScriptTimestampCue]:
    """Deterministically extract timestamped listening cues from script lines."""
    if not script_text or not script_text.strip():
        return []

    cues: list[ScriptTimestampCue] = []
    for line in script_text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        range_match = TIMESTAMP_RANGE_RE.search(stripped)
        if range_match:
            start_ms = parse_timestamp_to_ms(range_match.group("start"))
            end_ms = parse_timestamp_to_ms(range_match.group("end"))
            label = (range_match.group("label") or f"segment_{len(cues) + 1}").strip()
            transcript = stripped[range_match.end():].strip(" :：-)")
            if end_ms > start_ms:
                cues.append(
                    ScriptTimestampCue(
                        label=label,
                        start_ms=start_ms,
                        end_ms=end_ms,
                        transcript=transcript,
                    )
                )
            continue

        single_match = TIMESTAMP_SINGLE_RE.match(stripped)
        if single_match:
            start_ms = parse_timestamp_to_ms(single_match.group("start"))
            rest = single_match.group("rest").strip()
            cues.append(
                ScriptTimestampCue(
                    label=f"segment_{len(cues) + 1}",
                    start_ms=start_ms,
                    end_ms=None,
                    transcript=rest,
                )
            )

    # Fill missing end_ms from subsequent cue start or total_duration_ms
    for idx, cue in enumerate(cues):
        if cue.end_ms is None:
            if idx + 1 < len(cues):
                cue.end_ms = cues[idx + 1].start_ms
            elif total_duration_ms is not None and total_duration_ms > cue.start_ms:
                cue.end_ms = total_duration_ms
            else:
                cue.end_ms = cue.start_ms
    return [c for c in cues if (c.end_ms or 0) > c.start_ms]


def _parse_pcm_wav(data: bytes) -> dict[str, Any] | None:
    """Parse standard PCM RIFF/WAVE header and data chunk."""
    if len(data) < 44 or not data.startswith(b"RIFF") or data[8:12] != b"WAVE":
        return None
    offset = 12
    limit = len(data)
    fmt_info: dict[str, int] | None = None
    pcm_bytes = b""

    while offset + 8 <= limit:
        chunk_id = data[offset : offset + 4]
        chunk_size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        start = offset + 8
        end = min(limit, start + chunk_size)
        if chunk_id == b"fmt " and end - start >= 16:
            audio_fmt, channels, sample_rate, byte_rate, block_align, bits_per_sample = struct.unpack(
                "<HHIIHH", data[start : start + 16]
            )
            fmt_info = {
                "audio_fmt": audio_fmt,
                "channels": channels,
                "sample_rate": sample_rate,
                "byte_rate": byte_rate,
                "block_align": block_align,
                "bits_per_sample": bits_per_sample,
            }
        elif chunk_id == b"data":
            pcm_bytes = data[start:end]
        offset = start + chunk_size + (chunk_size % 2)

    if not fmt_info or fmt_info["audio_fmt"] != 1 or not pcm_bytes:
        return None
    return {**fmt_info, "pcm_bytes": pcm_bytes}


def _build_pcm_wav(pcm_bytes: bytes, channels: int, sample_rate: int, bits_per_sample: int) -> bytes:
    """Wrap raw PCM frames in a valid RIFF/WAVE container."""
    block_align = channels * (bits_per_sample // 8)
    byte_rate = sample_rate * block_align
    data_size = len(pcm_bytes)
    riff_header = b"RIFF" + (36 + data_size).to_bytes(4, "little") + b"WAVE"
    fmt_chunk = b"fmt " + (16).to_bytes(4, "little") + struct.pack(
        "<HHIIHH", 1, channels, sample_rate, byte_rate, block_align, bits_per_sample
    )
    data_chunk = b"data" + data_size.to_bytes(4, "little") + pcm_bytes
    return riff_header + fmt_chunk + data_chunk


def _slice_wav_bytes(wav_info: dict[str, Any], start_ms: int, end_ms: int) -> bytes:
    block_align = wav_info["block_align"]
    sample_rate = wav_info["sample_rate"]
    start_frame = int((start_ms / 1000.0) * sample_rate)
    end_frame = int((end_ms / 1000.0) * sample_rate)
    pcm = wav_info["pcm_bytes"]
    start_byte = max(0, min(len(pcm), start_frame * block_align))
    end_byte = max(start_byte, min(len(pcm), end_frame * block_align))
    return _build_pcm_wav(
        pcm[start_byte:end_byte],
        wav_info["channels"],
        sample_rate,
        wav_info["bits_per_sample"],
    )


def split_wav_by_silence(
    data: bytes,
    *,
    silence_threshold: int = 300,
    min_silence_ms: int = 400,
    min_segment_ms: int = 200,
    window_ms: int = 50,
) -> list[AudioSegment]:
    """Split a PCM WAV file deterministically across silent pauses."""
    wav_info = _parse_pcm_wav(data)
    if wav_info is None:
        raise ValueError("split_wav_by_silence requires uncompressed PCM WAV input.")

    channels = wav_info["channels"]
    sample_rate = wav_info["sample_rate"]
    bits = wav_info["bits_per_sample"]
    block_align = wav_info["block_align"]
    pcm = wav_info["pcm_bytes"]
    if bits not in (8, 16) or block_align <= 0 or sample_rate <= 0:
        raise ValueError(f"Unsupported WAV format: bits={bits}, channels={channels}")

    total_frames = len(pcm) // block_align
    frames_per_win = max(1, int(sample_rate * (window_ms / 1000.0)))
    min_silence_wins = max(1, int(round(min_silence_ms / window_ms)))

    win_active: list[bool] = []
    for frame_start in range(0, total_frames, frames_per_win):
        frame_end = min(total_frames, frame_start + frames_per_win)
        peak = 0
        byte_start = frame_start * block_align
        byte_end = frame_end * block_align
        if bits == 16:
            sample_count = (byte_end - byte_start) // 2
            samples = struct.unpack(f"<{sample_count}h", pcm[byte_start : byte_start + sample_count * 2])
            for s in samples:
                val = abs(s)
                if val > peak:
                    peak = val
        else:
            for b in pcm[byte_start:byte_end]:
                val = abs(b - 128) * 256
                if val > peak:
                    peak = val
        win_active.append(peak > silence_threshold)

    segments: list[AudioSegment] = []
    in_seg = False
    seg_start_win = 0
    silent_run = 0

    for idx, active in enumerate(win_active):
        if active:
            if not in_seg:
                in_seg = True
                seg_start_win = idx
            silent_run = 0
        else:
            if in_seg:
                silent_run += 1
                if silent_run >= min_silence_wins:
                    seg_end_win = idx - silent_run + 1
                    start_ms = seg_start_win * window_ms
                    end_ms = min(int((total_frames / sample_rate) * 1000), seg_end_win * window_ms)
                    if end_ms - start_ms >= min_segment_ms:
                        segments.append(
                            AudioSegment(
                                index=len(segments) + 1,
                                start_ms=start_ms,
                                end_ms=end_ms,
                                duration_ms=end_ms - start_ms,
                                label=f"segment_{len(segments) + 1}",
                                data=_slice_wav_bytes(wav_info, start_ms, end_ms),
                            )
                        )
                    in_seg = False
                    silent_run = 0

    if in_seg:
        start_ms = seg_start_win * window_ms
        end_ms = int((total_frames / sample_rate) * 1000)
        if end_ms - start_ms >= min_segment_ms:
            segments.append(
                AudioSegment(
                    index=len(segments) + 1,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    duration_ms=end_ms - start_ms,
                    label=f"segment_{len(segments) + 1}",
                    data=_slice_wav_bytes(wav_info, start_ms, end_ms),
                )
            )
    return segments


def split_audio_by_script_or_silence(
    data: bytes,
    *,
    ext: str = ".mp3",
    script_text: str = "",
    total_duration_ms: int | None = None,
    silence_threshold: int = 300,
    min_silence_ms: int = 400,
) -> list[AudioSegment]:
    """
    Segment listening audio deterministically by script timestamps or WAV silence.

    For timestamped scripts on MP3/WAV, returns exact time-window segments (with
    sliced WAV bytes when WAV input is supplied). Without script timestamps,
    splits PCM WAV by silence or returns a validated full-duration segment for MP3.
    """
    detected_duration = total_duration_ms or extract_audio_duration_ms(data, ext=ext)
    cues = parse_script_timestamps(script_text, total_duration_ms=detected_duration)

    wav_info = _parse_pcm_wav(data) if (ext.lower() == ".wav" or data.startswith(b"RIFF")) else None
    if cues:
        segments: list[AudioSegment] = []
        for cue in cues:
            end_ms = cue.end_ms or 0
            if detected_duration is not None:
                end_ms = min(end_ms, detected_duration)
            if end_ms <= cue.start_ms:
                continue
            seg_data = _slice_wav_bytes(wav_info, cue.start_ms, end_ms) if wav_info else None
            segments.append(
                AudioSegment(
                    index=len(segments) + 1,
                    start_ms=cue.start_ms,
                    end_ms=end_ms,
                    duration_ms=end_ms - cue.start_ms,
                    label=cue.label,
                    transcript=cue.transcript,
                    data=seg_data,
                )
            )
        if segments:
            return segments

    if wav_info is not None:
        return split_wav_by_silence(
            data,
            silence_threshold=silence_threshold,
            min_silence_ms=min_silence_ms,
        )

    if detected_duration is None or detected_duration <= 0:
        raise ValueError("Unable to determine valid audio duration for segmentation.")

    return [
        AudioSegment(
            index=1,
            start_ms=0,
            end_ms=detected_duration,
            duration_ms=detected_duration,
            label="full_track",
            transcript=script_text.strip(),
            data=None,
        )
    ]
