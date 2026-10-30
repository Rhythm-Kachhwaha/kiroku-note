"""
Audio Duration and Metadata Extraction Service.
-----------------------------------------------
Extracts exact playback duration (in milliseconds) from audio files,
specifically MPEG Layer III (MP3) and WAV, using deterministic binary parsing.

Guarantees:
- Pure Python implementation (zero heavyweight external C/FFmpeg dependencies)
- Dual-strategy MPEG duration: ID3 metadata parsing + MPEG frame-header traversal
- Full support for ID3v2 tags (ID3v2.2, ID3v2.3, ID3v2.4) with synchsafe integer decoding
- Support for MPEG-1, MPEG-2, and MPEG-2.5 (Layers I, II, and III)
- Support for VBR Xing / Info / VBRI headers for instant O(1) duration lookup
- Deterministic frame-walking fallback for CBR and unindexed VBR files
- Safe rejection of malformed, truncated, or unsupported audio files without crashing
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# MPEG Bitrate tables (kbps) indexed by [version_layer_key][bitrate_index]
# version_layer_key:
#   1_1: MPEG-1 Layer I
#   1_2: MPEG-1 Layer II
#   1_3: MPEG-1 Layer III
#   2_1: MPEG-2 / 2.5 Layer I
#   2_2: MPEG-2 / 2.5 Layer II
#   2_3: MPEG-2 / 2.5 Layer III
MPEG_BITRATES: dict[str, list[int]] = {
    "1_1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    "1_2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    "1_3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    "2_1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    "2_2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    "2_3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}

# MPEG Sample rate tables (Hz) indexed by version_id (3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5)
MPEG_SAMPLE_RATES: dict[int, list[int]] = {
    3: [44100, 48000, 32000],  # MPEG-1
    2: [22050, 24000, 16000],  # MPEG-2
    0: [11025, 12000, 8000],   # MPEG-2.5
}


def decode_synchsafe_int(b: bytes) -> int:
    """Decode a 4-byte synchsafe integer (7 bits per byte)."""
    if len(b) < 4:
        return 0
    return (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3]


def parse_id3_tag(data: bytes) -> tuple[int, int | None]:
    """
    Parse ID3v2 tag at the start of audio data.

    Returns:
        tuple of (audio_data_offset, duration_ms_from_id3_if_any)
    """
    if len(data) < 10 or not data.startswith(b"ID3"):
        return 0, None

    version_major = data[3]
    flags = data[5]
    tag_body_size = decode_synchsafe_int(data[6:10])

    has_footer = bool(flags & 0x10)
    total_tag_size = 10 + tag_body_size + (10 if has_footer else 0)

    if total_tag_size > len(data):
        # Malformed or truncated ID3 header
        return 0, None

    duration_ms: int | None = None

    # Attempt to extract TLEN (Length in milliseconds) frame
    try:
        offset = 10
        limit = 10 + tag_body_size

        while offset + 10 <= limit:
            # Check padding (zeros after frames)
            if data[offset] == 0:
                break

            if version_major == 2:
                # ID3v2.2: 3-byte frame ID, 3-byte size
                frame_id = data[offset : offset + 3].decode("ascii", errors="replace")
                frame_size = (data[offset + 3] << 16) | (data[offset + 4] << 8) | data[offset + 5]
                header_len = 6
            elif version_major == 4:
                # ID3v2.4: 4-byte frame ID, 4-byte synchsafe size, 2-byte flags
                frame_id = data[offset : offset + 4].decode("ascii", errors="replace")
                frame_size = decode_synchsafe_int(data[offset + 4 : offset + 8])
                header_len = 10
            else:
                # ID3v2.3: 4-byte frame ID, 4-byte big-endian size, 2-byte flags
                frame_id = data[offset : offset + 4].decode("ascii", errors="replace")
                frame_size = int.from_bytes(data[offset + 4 : offset + 8], "big")
                header_len = 10

            frame_data_start = offset + header_len
            frame_data_end = frame_data_start + frame_size

            if frame_data_end > limit:
                break

            if frame_id in ("TLEN", "TLE") and frame_size > 1:
                frame_payload = data[frame_data_start:frame_data_end]
                # First byte is encoding: 0 = ISO-8859-1, 1 = UTF-16, 3 = UTF-8
                enc = frame_payload[0]
                text_bytes = frame_payload[1:]
                try:
                    if enc in (0, 3):
                        txt = text_bytes.decode("utf-8", errors="replace").strip("\x00 \t\r\n")
                    else:
                        txt = text_bytes.decode("utf-16", errors="replace").strip("\x00 \t\r\n")
                    val = int(txt)
                    if val > 0:
                        duration_ms = val
                except (ValueError, UnicodeDecodeError):
                    pass

            offset = frame_data_end
    except Exception:
        # Gracefully tolerate non-standard ID3 tags
        pass

    return total_tag_size, duration_ms


def parse_mpeg_frame_header(header_bytes: bytes) -> dict[str, Any] | None:
    """
    Parse a 4-byte MPEG audio frame header.

    Returns dict of frame metadata or None if invalid.
    """
    if len(header_bytes) < 4:
        return None

    b0, b1, b2, b3 = header_bytes[0], header_bytes[1], header_bytes[2], header_bytes[3]

    # Sync word: 11 bits set (0xFF followed by high 3 bits set)
    if b0 != 0xFF or (b1 & 0xE0) != 0xE0:
        return None

    # Version: 00 = 2.5, 01 = reserved, 10 = 2, 11 = 1
    version_id = (b1 >> 3) & 0x03
    if version_id == 1:
        return None

    # Layer: 00 = reserved, 01 = Layer III, 10 = Layer II, 11 = Layer I
    layer_id = (b1 >> 1) & 0x03
    if layer_id == 0:
        return None

    # Bitrate index: 0000 = free, 1111 = bad
    bitrate_idx = (b2 >> 4) & 0x0F
    if bitrate_idx in (0, 15):
        return None

    # Sample rate index: 11 = reserved
    sample_rate_idx = (b2 >> 2) & 0x03
    if sample_rate_idx == 3:
        return None

    padding = (b2 >> 1) & 0x01
    channel_mode = (b3 >> 6) & 0x03

    # Look up sample rate
    sample_rates = MPEG_SAMPLE_RATES.get(version_id)
    if not sample_rates or sample_rate_idx >= len(sample_rates):
        return None
    sample_rate = sample_rates[sample_rate_idx]

    # Look up bitrate
    version_key = "1" if version_id == 3 else "2"
    layer_key = str(4 - layer_id)  # 3 -> 1 (Layer I), 2 -> 2 (Layer II), 1 -> 3 (Layer III)
    table_key = f"{version_key}_{layer_key}"

    bitrates = MPEG_BITRATES.get(table_key)
    if not bitrates or bitrate_idx >= len(bitrates):
        return None
    bitrate_kbps = bitrates[bitrate_idx]
    bitrate_bps = bitrate_kbps * 1000

    # Determine samples per frame
    if layer_id == 3:  # Layer I
        samples_per_frame = 384
        frame_size = ((12 * bitrate_bps // sample_rate) + padding) * 4
    elif layer_id == 2:  # Layer II
        samples_per_frame = 1152
        frame_size = (144 * bitrate_bps // sample_rate) + padding
    else:  # Layer III
        if version_id == 3:  # MPEG-1 Layer III
            samples_per_frame = 1152
            frame_size = (144 * bitrate_bps // sample_rate) + padding
        else:  # MPEG-2 / 2.5 Layer III
            samples_per_frame = 576
            frame_size = (72 * bitrate_bps // sample_rate) + padding

    if frame_size < 24:
        return None

    return {
        "version_id": version_id,
        "layer_id": layer_id,
        "sample_rate": sample_rate,
        "bitrate_kbps": bitrate_kbps,
        "padding": padding,
        "channel_mode": channel_mode,
        "samples_per_frame": samples_per_frame,
        "frame_size": frame_size,
    }


def extract_vbr_duration_ms(data: bytes, frame_offset: int, header: dict[str, Any]) -> int | None:
    """
    Inspect the first audio frame for Xing / Info or VBRI variable-bitrate headers.

    Returns duration in ms if present and valid, else None.
    """
    version_id = header["version_id"]
    channel_mode = header["channel_mode"]
    sample_rate = header["sample_rate"]
    samples_per_frame = header["samples_per_frame"]

    # 1. Determine Xing/Info header offset
    if version_id == 3:  # MPEG-1
        side_info_len = 17 if channel_mode == 3 else 32
    else:  # MPEG-2 / 2.5
        side_info_len = 9 if channel_mode == 3 else 17

    xing_offset = frame_offset + 4 + side_info_len

    if xing_offset + 8 <= len(data):
        tag = data[xing_offset : xing_offset + 4]
        if tag in (b"Xing", b"Info"):
            flags = int.from_bytes(data[xing_offset + 4 : xing_offset + 8], "big")
            if flags & 0x01:  # Frames flag is present
                if xing_offset + 12 <= len(data):
                    total_frames = int.from_bytes(data[xing_offset + 8 : xing_offset + 12], "big")
                    if total_frames > 0 and sample_rate > 0:
                        return int((total_frames * samples_per_frame / sample_rate) * 1000)

    # 2. Check for Fraunhofer VBRI header (always at offset 36 in frame)
    vbri_offset = frame_offset + 36
    if vbri_offset + 18 <= len(data) and data[vbri_offset : vbri_offset + 4] == b"VBRI":
        total_frames = int.from_bytes(data[vbri_offset + 14 : vbri_offset + 18], "big")
        if total_frames > 0 and sample_rate > 0:
            return int((total_frames * samples_per_frame / sample_rate) * 1000)

    return None


def extract_mpeg_duration_ms(data: bytes, audio_offset: int = 0, id3_duration_ms: int | None = None) -> int | None:
    """
    Extract MPEG playback duration by inspecting VBR headers or walking frame sequences.

    Combines VBR tags, frame accumulation, and ID3 fallback.
    """
    pos = audio_offset
    limit = len(data)

    # Find the first valid MPEG sync frame (allowing up to 4KB scan)
    first_frame_pos: int | None = None
    first_header: dict[str, Any] | None = None

    search_limit = min(limit - 4, pos + 4096)
    curr = pos
    while curr <= search_limit:
        if data[curr] == 0xFF and (data[curr + 1] & 0xE0) == 0xE0:
            h = parse_mpeg_frame_header(data[curr : curr + 4])
            if h is not None:
                first_frame_pos = curr
                first_header = h
                break
        curr += 1

    if first_frame_pos is None or first_header is None:
        # No MPEG frames found; fall back to ID3 metadata if available
        return id3_duration_ms

    # 1. Check for Xing / Info / VBRI header in the first frame
    vbr_duration = extract_vbr_duration_ms(data, first_frame_pos, first_header)
    if vbr_duration is not None and vbr_duration > 0:
        return vbr_duration

    # 2. Walk frame headers to calculate duration accurately for CBR or unindexed VBR
    accumulated_samples = 0
    frame_count = 0
    sample_rate = first_header["sample_rate"]
    pos = first_frame_pos

    while pos + 4 <= limit:
        # Check for trailing ID3v1 tag (128 bytes at EOF starting with b'TAG')
        if pos >= limit - 128 and data[pos : pos + 3] == b"TAG":
            break

        header = parse_mpeg_frame_header(data[pos : pos + 4])
        if header is None:
            # Sync lost or end of audio data reached
            break

        accumulated_samples += header["samples_per_frame"]
        frame_count += 1
        pos += header["frame_size"]

    if frame_count > 0 and sample_rate > 0:
        calc_ms = int((accumulated_samples / sample_rate) * 1000)
        return calc_ms

    return id3_duration_ms


def extract_wav_duration_ms(data: bytes) -> int | None:
    """Extract playback duration from standard RIFF / WAVE audio bytes."""
    if len(data) < 44 or not data.startswith(b"RIFF") or data[8:12] != b"WAVE":
        return None

    byte_rate: int | None = None
    data_size: int | None = None

    offset = 12
    limit = len(data)

    while offset + 8 <= limit:
        chunk_id = data[offset : offset + 4]
        chunk_size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        chunk_data_start = offset + 8
        chunk_data_end = chunk_data_start + chunk_size

        if chunk_id == b"fmt " and chunk_size >= 16 and chunk_data_end <= limit:
            # byte_rate is at offset 8 within fmt chunk (4 bytes little-endian)
            byte_rate = int.from_bytes(data[chunk_data_start + 8 : chunk_data_start + 12], "little")
        elif chunk_id == b"data":
            data_size = chunk_size
            if byte_rate and byte_rate > 0 and data_size > 0:
                return int((data_size / byte_rate) * 1000)

        offset = chunk_data_end

    if byte_rate and byte_rate > 0 and data_size and data_size > 0:
        return int((data_size / byte_rate) * 1000)

    return None


def extract_audio_duration_ms(data: bytes, ext: str = ".mp3") -> int | None:
    """
    Main entry point for audio duration extraction.

    Supports MP3 (ID3 + MPEG frame calculation) and WAV.
    Safe against corrupted, truncated, or non-audio binary data.
    """
    if not data or len(data) < 12:
        return None

    ext_lower = ext.lower()

    try:
        if ext_lower in (".mp3", "") or data.startswith((b"ID3", b"\xff\xfb", b"\xff\xfa", b"\xff\xf3", b"\xff\xf2")):
            audio_offset, id3_duration_ms = parse_id3_tag(data)
            duration = extract_mpeg_duration_ms(data, audio_offset=audio_offset, id3_duration_ms=id3_duration_ms)
            return duration

        elif ext_lower == ".wav" or (data.startswith(b"RIFF") and b"WAVE" in data[:12]):
            return extract_wav_duration_ms(data)

    except Exception as exc:
        logger.warning("Safely caught error during audio duration extraction: %s", exc)
        return None

    return None
