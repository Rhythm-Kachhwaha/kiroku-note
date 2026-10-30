"""
Unit Tests for Audio Duration and Metadata Extraction Subsystem.
----------------------------------------------------------------
Tests:
- ID3v2.2, ID3v2.3, and ID3v2.4 header and TLEN frame parsing
- MPEG-1 and MPEG-2 Layer III frame header parsing and size computation
- VBR Xing / Info and VBRI header frame counting
- Frame-walking duration calculation for CBR audio streams
- WAV / RIFF header parsing and duration calculation
- Robust rejection of malformed, truncated, or non-audio payloads
- AssetDownloader integration returning duration_ms for audio assets
"""
from __future__ import annotations

import io
from pathlib import Path
import sqlite3
import pytest

from app.study.acquisition.media.audio_duration import (
    decode_synchsafe_int,
    extract_audio_duration_ms,
    extract_mpeg_duration_ms,
    extract_vbr_duration_ms,
    extract_wav_duration_ms,
    parse_id3_tag,
    parse_mpeg_frame_header,
)
from app.study.acquisition.media.asset_downloader import AssetDownloader
from app.study.media import MediaStore


def build_synthetic_mpeg_frame(
    version_id: int = 3,       # 3: MPEG-1, 2: MPEG-2
    layer_id: int = 1,         # 1: Layer III, 2: Layer II, 3: Layer I
    bitrate_idx: int = 9,      # In MPEG-1 Layer III, 9 -> 128 kbps
    sample_rate_idx: int = 0,  # In MPEG-1, 0 -> 44100 Hz
    padding: int = 0,
    channel_mode: int = 0,     # 0: Stereo
    extra_payload: bytes = b"",
) -> bytes:
    """Build a synthetic valid MPEG audio frame."""
    b0 = 0xFF
    b1 = 0xE0 | ((version_id & 0x03) << 3) | ((layer_id & 0x03) << 1) | 1  # No CRC
    b2 = ((bitrate_idx & 0x0F) << 4) | ((sample_rate_idx & 0x03) << 2) | ((padding & 0x01) << 1)
    b3 = (channel_mode & 0x03) << 6

    header = bytes([b0, b1, b2, b3])
    parsed = parse_mpeg_frame_header(header)
    assert parsed is not None
    frame_size = parsed["frame_size"]

    body_len = frame_size - 4
    if len(extra_payload) > body_len:
        extra_payload = extra_payload[:body_len]
    body = extra_payload + b"\x55" * (body_len - len(extra_payload))
    return header + body


def test_decode_synchsafe_int():
    assert decode_synchsafe_int(b"\x00\x00\x00\x00") == 0
    assert decode_synchsafe_int(b"\x00\x00\x01\x00") == 128
    assert decode_synchsafe_int(b"\x00\x00\x02\x01") == 257
    assert decode_synchsafe_int(b"\x00\x01\x00\x00") == 16384


def test_parse_id3_tag_v23_with_tlen():
    # ID3v2.3 tag containing TLEN frame with "45000" (45 seconds)
    tlen_body = b"\x0045000"  # 0 = ISO-8859-1
    tlen_frame = b"TLEN" + (len(tlen_body)).to_bytes(4, "big") + b"\x00\x00" + tlen_body
    tag_size = len(tlen_frame)
    # Synchsafe size encoding for tag_size
    synchsafe_size = bytes([
        (tag_size >> 21) & 0x7F,
        (tag_size >> 14) & 0x7F,
        (tag_size >> 7) & 0x7F,
        tag_size & 0x7F,
    ])
    id3_header = b"ID3\x03\x00\x00" + synchsafe_size
    data = id3_header + tlen_frame + b"\x00" * 20

    offset, duration_ms = parse_id3_tag(data)
    assert offset == 10 + tag_size
    assert duration_ms == 45000


def test_parse_id3_tag_v24_with_tlen():
    # ID3v2.4 tag
    tlen_body = b"\x0360000"  # 3 = UTF-8
    frame_size = len(tlen_body)
    synchsafe_frame_size = bytes([0, 0, (frame_size >> 7) & 0x7F, frame_size & 0x7F])
    tlen_frame = b"TLEN" + synchsafe_frame_size + b"\x00\x00" + tlen_body
    tag_size = len(tlen_frame)
    synchsafe_size = bytes([0, 0, (tag_size >> 7) & 0x7F, tag_size & 0x7F])
    id3_header = b"ID3\x04\x00\x00" + synchsafe_size
    data = id3_header + tlen_frame

    offset, duration_ms = parse_id3_tag(data)
    assert offset == 10 + tag_size
    assert duration_ms == 60000


def test_parse_id3_tag_without_tlen():
    # Tag has only TIT2 (Title)
    tit2_body = b"\x00Test Song"
    tit2_frame = b"TIT2" + (len(tit2_body)).to_bytes(4, "big") + b"\x00\x00" + tit2_body
    tag_size = len(tit2_frame)
    synchsafe_size = bytes([0, 0, (tag_size >> 7) & 0x7F, tag_size & 0x7F])
    data = b"ID3\x03\x00\x00" + synchsafe_size + tit2_frame

    offset, duration_ms = parse_id3_tag(data)
    assert offset == 10 + tag_size
    assert duration_ms is None


def test_parse_id3_tag_malformed_and_truncated():
    # Short header
    assert parse_id3_tag(b"ID3\x03") == (0, None)
    # Declared size far exceeds buffer length
    assert parse_id3_tag(b"ID3\x03\x00\x00\x7F\x7F\x7F\x7F" + b"\x00" * 10) == (0, None)
    # Non-ID3 data
    assert parse_id3_tag(b"RIFF\x00\x00\x00\x00WAVE") == (0, None)


def test_parse_mpeg_frame_header_valid():
    # MPEG-1, Layer III, 128 kbps, 44100 Hz, no padding, stereo
    # 144 * 128000 // 44100 = 417 bytes
    frame = build_synthetic_mpeg_frame(version_id=3, layer_id=1, bitrate_idx=9, sample_rate_idx=0, padding=0)
    parsed = parse_mpeg_frame_header(frame[:4])
    assert parsed is not None
    assert parsed["version_id"] == 3
    assert parsed["sample_rate"] == 44100
    assert parsed["bitrate_kbps"] == 128
    assert parsed["samples_per_frame"] == 1152
    assert parsed["frame_size"] == 417


def test_parse_mpeg_frame_header_mpeg2():
    # MPEG-2, Layer III, 64 kbps, 22050 Hz (version_id=2, bitrate_idx=8 in table 2_3 -> 64)
    # 72 * 64000 // 22050 = 209 bytes, samples_per_frame = 576
    frame = build_synthetic_mpeg_frame(version_id=2, layer_id=1, bitrate_idx=8, sample_rate_idx=0)
    parsed = parse_mpeg_frame_header(frame[:4])
    assert parsed is not None
    assert parsed["version_id"] == 2
    assert parsed["sample_rate"] == 22050
    assert parsed["samples_per_frame"] == 576
    assert parsed["frame_size"] == 208


def test_parse_mpeg_frame_header_invalid_cases():
    # Invalid sync
    assert parse_mpeg_frame_header(b"\x00\x00\x00\x00") is None
    # Reserved version (0b01)
    assert parse_mpeg_frame_header(bytes([0xFF, 0xE9, 0x90, 0x00])) is None
    # Reserved layer (0b00)
    assert parse_mpeg_frame_header(bytes([0xFF, 0xF9, 0x90, 0x00])) is None
    # Bad bitrate (0b1111)
    assert parse_mpeg_frame_header(bytes([0xFF, 0xFB, 0xF0, 0x00])) is None
    # Reserved sample rate (0b11)
    assert parse_mpeg_frame_header(bytes([0xFF, 0xFB, 0x9C, 0x00])) is None


def test_extract_vbr_duration_xing():
    # MPEG-1 Layer III Stereo -> side info is 32 bytes, Xing is at offset 4 + 32 = 36
    # Total frames = 500. Duration: 500 * 1152 / 44100 * 1000 = 13061 ms
    xing_payload = b"\x00" * 32 + b"Xing\x00\x00\x00\x01" + (500).to_bytes(4, "big")
    frame = build_synthetic_mpeg_frame(version_id=3, layer_id=1, bitrate_idx=9, sample_rate_idx=0, extra_payload=xing_payload)

    parsed = parse_mpeg_frame_header(frame[:4])
    assert parsed is not None
    duration = extract_vbr_duration_ms(frame, 0, parsed)
    assert duration == 13061


def test_extract_vbr_duration_vbri():
    # VBRI header at offset 36
    vbri_payload = b"\x00" * 32 + b"VBRI\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00" + (800).to_bytes(4, "big")
    frame = build_synthetic_mpeg_frame(version_id=3, layer_id=1, bitrate_idx=9, sample_rate_idx=0, extra_payload=vbri_payload)

    parsed = parse_mpeg_frame_header(frame[:4])
    assert parsed is not None
    duration = extract_vbr_duration_ms(frame, 0, parsed)
    # 800 * 1152 / 44100 * 1000 = 20897 ms
    assert duration == 20897


def test_extract_mpeg_duration_frame_walking_cbr():
    # Sequence of 30 frames without Xing header
    single_frame = build_synthetic_mpeg_frame(version_id=3, layer_id=1, bitrate_idx=9, sample_rate_idx=0)
    audio_stream = single_frame * 30

    duration = extract_mpeg_duration_ms(audio_stream, audio_offset=0)
    # 30 * 1152 / 44100 * 1000 = 783 ms
    assert duration == 783


def test_extract_mpeg_duration_with_id3_and_frame_walking():
    # 20 frames preceded by an ID3 tag
    id3_tag = b"ID3\x03\x00\x00\x00\x00\x00\x10" + b"\x00" * 16
    single_frame = build_synthetic_mpeg_frame(version_id=3, layer_id=1, bitrate_idx=9, sample_rate_idx=0)
    full_file = id3_tag + (single_frame * 20)

    duration = extract_audio_duration_ms(full_file, ext=".mp3")
    # 20 * 1152 / 44100 * 1000 = 522 ms
    assert duration == 522


def test_extract_wav_duration_valid():
    # Synthetic 16-bit 44.1kHz Stereo WAV file (byte_rate = 176400)
    byte_rate = 176400
    data_size = 352800  # Exactly 2.0 seconds (2000 ms)
    riff_header = b"RIFF" + (36 + data_size).to_bytes(4, "little") + b"WAVE"
    fmt_chunk = b"fmt \x10\x00\x00\x00\x01\x00\x02\x00\x44\xAC\x00\x00" + byte_rate.to_bytes(4, "little") + b"\x04\x00\x10\x00"
    data_chunk = b"data" + data_size.to_bytes(4, "little") + (b"\x00" * 1024)  # Truncated data bytes for test size

    wav_bytes = riff_header + fmt_chunk + data_chunk
    duration = extract_wav_duration_ms(wav_bytes)
    assert duration == 2000


def test_extract_audio_duration_safe_rejections():
    # Empty
    assert extract_audio_duration_ms(b"", ext=".mp3") is None
    # Plain text / HTML
    assert extract_audio_duration_ms(b"<html><body>Not audio</body></html>", ext=".mp3") is None
    # Truncated random garbage
    assert extract_audio_duration_ms(b"\x01\x02\x03\x04\x05\x06\x07\x08", ext=".mp3") is None


def test_asset_downloader_audio_duration_integration(tmp_path: Path):
    # Setup test MediaStore
    media_dir = tmp_path / "study_media"
    store = MediaStore(media_dir=media_dir)

    # Synthetic MP3 bytes: 10 frames
    single_frame = build_synthetic_mpeg_frame(version_id=3, layer_id=1, bitrate_idx=9, sample_rate_idx=0)
    audio_data = single_frame * 10

    # Mock HTTP client
    class MockResponse:
        def __init__(self, content: bytes):
            self.content = content
            self.headers = {"content-type": "audio/mpeg"}

        def raise_for_status(self):
            pass

    class MockClient:
        def get(self, url, headers=None):
            return MockResponse(audio_data)

        def close(self):
            pass

    downloader = AssetDownloader(media_store=store, client=MockClient())

    # Test disk-only download (conn is None)
    res = downloader.download_asset(
        asset_url="https://japanesetest4you.com/audio/sample_listening.mp3",
        conn=None,
    )
    assert res["kind"] == "audio"
    assert res["mime_type"] == "audio/mpeg"
    assert res["duration_ms"] == 261  # 10 * 1152 / 44100 * 1000 = 261 ms
    assert (media_dir / res["relative_path"]).is_file()
