"""Dedicated Anki HTML formatting service for Kiroku Note.

Converts structured card, dictionary, and linguistic data into safe,
learner-friendly HTML for Anki notes.
"""
from __future__ import annotations

from dataclasses import is_dataclass
import html
import os
import re
from typing import Any

# Circled number mapping for Tokyo pitch downstep positions 0..10
PITCH_CIRCLES = ["⓪", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"]

# Regex for matching bracket furigana: e.g. 朝[あさ]御[ご]飯[はん]を食[た]べる。
# Group 1: optional prefix (e.g. kana "お" in "お父[とう]")
# Group 2: base kanji or alphanumeric token
# Group 3: reading (rt) inside brackets
# Group 4: plain text outside brackets
RUBY_BRACKET_REGEX = re.compile(
    r'(?:([^\s\[\]]*?)([一-龠々〆ヶA-Za-z0-9]+)\[([^\]]+)\])|([^\[\]]+)'
)

# Allowed media file extensions
SAFE_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
SAFE_AUDIO_EXTS = {".wav", ".mp3", ".ogg", ".m4a", ".aac", ".flac", ".webm", ".opus"}
SAFE_MEDIA_FILENAME_REGEX = re.compile(r'^[a-zA-Z0-9_\-\.]+$')


def escape_html(text: Any) -> str:
    """Safely escape text for HTML insertion, converting &, <, >, ", and '."""
    if text is None:
        return ""
    return html.escape(str(text), quote=True)


def _format_bracket_ruby(segment: str) -> str:
    """Helper to convert bracket notation [rt] into <ruby> markup within a text segment."""
    if not segment:
        return ""
    if "[" in segment and "]" in segment:
        parts = []
        for m in RUBY_BRACKET_REGEX.finditer(segment):
            prefix, base, rt, plain = m.group(1), m.group(2), m.group(3), m.group(4)
            if base and rt:
                if prefix:
                    parts.append(escape_html(prefix))
                parts.append(f"<ruby>{escape_html(base)}<rt>{escape_html(rt)}</rt></ruby>")
            elif plain:
                parts.append(escape_html(plain))
            else:
                parts.append(escape_html(m.group(0)))
        return "".join(parts)
    return escape_html(segment)


def format_ruby_html(text: str = "", reading: str | None = None) -> str:
    """Safely convert Japanese text/reading with ruby or bracket furigana into <ruby> HTML.

    All base and rt tokens are strictly HTML-escaped to prevent script/markup injection.
    """
    source = (reading or text or "").strip()
    if not source:
        return ""

    # 1. If source already contains <ruby> tags, parse them safely and process brackets in between
    if "<ruby>" in source.lower():
        parts: list[str] = []
        pos = 0
        ruby_pattern = re.compile(r'<ruby>(.*?)<rt>(.*?)</rt></ruby>', re.IGNORECASE | re.DOTALL)
        for m in ruby_pattern.finditer(source):
            start, end = m.span()
            if start > pos:
                parts.append(_format_bracket_ruby(source[pos:start]))
            base = escape_html(re.sub(r'<[^>]+>', '', m.group(1)).strip())
            rt = escape_html(re.sub(r'<[^>]+>', '', m.group(2)).strip())
            if base and rt:
                parts.append(f"<ruby>{base}<rt>{rt}</rt></ruby>")
            elif base:
                parts.append(base)
            pos = end
        if pos < len(source):
            parts.append(_format_bracket_ruby(source[pos:]))
        return "".join(parts)

    # 2. Process bracket notation or plain text
    return _format_bracket_ruby(source)


def _get_field(obj: Any, key: str, default: Any = None) -> Any:
    """Extract a field from either a dict or an object/dataclass."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _extract_senses_from_entries(entries: list[Any]) -> list[dict[str, Any]]:
    """Flatten entries into a clean list of sense dictionaries, preserving ordering and POS/tags."""
    extracted: list[dict[str, Any]] = []

    for entry in entries:
        if not entry:
            continue

        raw_senses = _get_field(entry, "senses")
        entry_pos = _get_field(entry, "parts_of_speech") or []
        entry_tags = _get_field(entry, "tags") or []

        # Case A: entry itself is a sense
        if raw_senses is None and _get_field(entry, "glosses") is not None:
            raw_senses = [entry]

        if not raw_senses or not isinstance(raw_senses, list):
            continue

        total_senses = len(raw_senses)
        for s_idx, s in enumerate(raw_senses, 1):
            if not s:
                continue

            glosses = _get_field(s, "glosses") or []
            if isinstance(glosses, str):
                glosses = [glosses]
            clean_glosses = [str(g).strip() for g in glosses if g and str(g).strip()]

            if not clean_glosses:
                continue

            sense_pos = _get_field(s, "parts_of_speech") or []
            if not sense_pos and total_senses == 1 and entry_pos:
                sense_pos = entry_pos

            sense_tags = list(_get_field(s, "tags") or [])
            sense_field_tags = _get_field(s, "field_tags") or []
            sense_tags.extend(sense_field_tags)
            if not sense_tags and total_senses == 1 and entry_tags:
                sense_tags.extend(entry_tags)

            extracted.append({
                "index": _get_field(s, "index") or s_idx,
                "glosses": clean_glosses,
                "parts_of_speech": [str(p).strip() for p in sense_pos if p and str(p).strip()],
                "tags": [str(t).strip() for t in sense_tags if t and str(t).strip()],
            })

    return extracted


def format_meaning_html(
    meaning_text: str = "",
    entries: list[Any] | None = None,
) -> str:
    """Convert structured dictionary meanings into clean, learner-friendly Anki HTML.

    - Single sense: rendered inside <div class="kn-meaning">...</div> without <ol> list wrapper.
    - Multiple senses: rendered inside <ol class="kn-meanings"><li>...</li></ol>.
    - Preserves sense-bound POS ([vt], [vi]) and tags ([colloquial], [math]).
    - Strictly HTML-escapes text to prevent XSS.
    - Preserves dictionary sense ordering.
    """
    # 1. Format from structured entries if provided and valid
    if entries and isinstance(entries, list):
        senses = _extract_senses_from_entries(entries)
        if senses:
            if len(senses) == 1:
                sense = senses[0]
                content_parts: list[str] = []
                if sense["parts_of_speech"]:
                    pos_str = escape_html(", ".join(sense["parts_of_speech"]))
                    content_parts.append(f'<span class="kn-pos">[{pos_str}]</span>')
                if sense["tags"]:
                    tags_str = escape_html(", ".join(sense["tags"]))
                    content_parts.append(f'<span class="kn-tag">[{tags_str}]</span>')
                content_parts.append(escape_html(", ".join(sense["glosses"])))
                return f'<div class="kn-meaning">{" ".join(content_parts)}</div>'

            # Multiple senses -> numbered <ol> list
            li_items: list[str] = []
            for sense in senses:
                content_parts = []
                if sense["parts_of_speech"]:
                    pos_str = escape_html(", ".join(sense["parts_of_speech"]))
                    content_parts.append(f'<span class="kn-pos">[{pos_str}]</span>')
                if sense["tags"]:
                    tags_str = escape_html(", ".join(sense["tags"]))
                    content_parts.append(f'<span class="kn-tag">[{tags_str}]</span>')
                content_parts.append(escape_html(", ".join(sense["glosses"])))
                li_items.append(f'  <li>{" ".join(content_parts)}</li>')

            return '<ol class="kn-meanings">\n' + "\n".join(li_items) + "\n</ol>"

    # 2. Fallback to formatting meaning_text (plain string or user-edited)
    clean_text = (meaning_text or "").strip()
    if not clean_text:
        return ""

    lines = [l.strip() for l in clean_text.split("\n") if l.strip()]
    if not lines:
        return ""

    if len(lines) == 1:
        clean_line = re.sub(r'^(?:\d+[\.\)]|\(\d+\))\s*', '', lines[0])
        return f'<div class="kn-meaning">{escape_html(clean_line)}</div>'

    li_items = []
    for line in lines:
        clean_line = re.sub(r'^(?:\d+[\.\)]|\(\d+\))\s*', '', line)
        li_items.append(f'  <li>{escape_html(clean_line)}</li>')

    return '<ol class="kn-meanings">\n' + "\n".join(li_items) + "\n</ol>"


def format_example_html(
    japanese: str | Any = "",
    translation: str | None = None,
    reading: str | None = None,
    *,
    example: Any = None,
) -> str:
    """Convert example sentence and translation into clean Anki HTML.

    Preserves ruby furigana when reading is provided with bracket or ruby notation.
    HTML-escapes all text.
    """
    target = example or japanese
    ja_text = ""
    trans_text = translation or ""
    reading_text = reading

    if target and not isinstance(target, str):
        ja_text = str(_get_field(target, "japanese") or "").strip()
        trans_text = str(_get_field(target, "translation") or trans_text or "").strip()
        reading_text = _get_field(target, "reading") or reading_text
    elif isinstance(target, str):
        ja_text = target.strip()

    if reading_text:
        reading_text = str(reading_text).strip()
    if trans_text:
        trans_text = str(trans_text).strip()

    ja_html = format_ruby_html(text=ja_text, reading=reading_text)
    trans_html = escape_html(trans_text)

    if not ja_html and not trans_html:
        return ""

    parts = ['<div class="kn-example-block">']
    if ja_html:
        parts.append(f'  <p class="kn-example-ja">{ja_html}</p>')
    if trans_html:
        parts.append(f'  <p class="kn-example-en">{trans_html}</p>')
    parts.append('</div>')

    return "\n".join(parts)


def sanitize_media_tags(image: str = "", audio: str = "", img_class: str | None = "kn-image") -> tuple[str, str]:
    """Sanitize image and audio references to prevent HTML injection and attribute breakout.

    Returns (formatted_img_html, formatted_audio_tag).
    """
    raw_img = (image or "").strip()
    raw_aud = (audio or "").strip()

    formatted_img = ""
    if raw_img:
        candidate = raw_img
        if raw_img.lower().startswith("<img"):
            m = re.search(r'src=["\']?([^"\' >]+)', raw_img, re.IGNORECASE)
            candidate = m.group(1) if m else ""

        img_file = os.path.basename(candidate)
        ext = os.path.splitext(img_file)[1].lower()
        if ext in SAFE_IMAGE_EXTS and SAFE_MEDIA_FILENAME_REGEX.match(img_file):
            if img_class:
                formatted_img = f'<img src="{escape_html(img_file)}" class="{escape_html(img_class)}">'
            else:
                formatted_img = f'<img src="{escape_html(img_file)}">'

    formatted_aud = ""
    if raw_aud:
        candidate = raw_aud
        if raw_aud.startswith("[sound:"):
            m = re.search(r'\[sound:([^\]]+)\]', raw_aud)
            candidate = m.group(1) if m else ""

        aud_file = os.path.basename(candidate)
        ext = os.path.splitext(aud_file)[1].lower()
        if ext in SAFE_AUDIO_EXTS and SAFE_MEDIA_FILENAME_REGEX.match(aud_file):
            formatted_aud = f"[sound:{escape_html(aud_file)}]"

    return formatted_img, formatted_aud


def format_pitch_badge(pitch: Any) -> str:
    """Format a PitchAccent object or dict into a compact Tokyo pitch badge string."""
    if not pitch:
        return ""
    pos = _get_field(pitch, "position")
    if pos is None or not isinstance(pos, int):
        return ""

    pat_name = _get_field(pitch, "pattern_name") or ""
    pat_str = str(pat_name).strip().capitalize() if pat_name else ""

    circle = PITCH_CIRCLES[pos] if 0 <= pos < len(PITCH_CIRCLES) else str(pos)
    text = f"[{circle} {pat_str}]" if pat_str else f"[{circle}]"
    return text


_format_pitch_badge = format_pitch_badge


ANKI_CARD_CSS = """\
.kn-card {
  --kn-bg: #ffffff;
  --kn-text: #1f2937;
  --kn-muted: #6b7280;
  --kn-border: #e5e7eb;
  --kn-surface: #f9fafb;
  --kn-surface-border: #e5e7eb;
  --kn-badge-bg: #f3f4f6;
  --kn-badge-text: #4b5563;
  --kn-pitch-bg: #eff6ff;
  --kn-pitch-text: #2563eb;
  --kn-pitch-border: #bfdbfe;
  --kn-ruby: #6b7280;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif;
  font-size: 15px;
  line-height: 1.5;
  color: var(--kn-text);
  text-align: left;
  max-width: 520px;
  margin: 0 auto;
  box-sizing: border-box;
}
.kn-card *, .kn-card *::before, .kn-card *::after {
  box-sizing: border-box;
}
.nightMode .kn-card,
.night_mode .kn-card,
body.nightMode .kn-card,
body.night_mode .kn-card {
  --kn-bg: #1e1e2e;
  --kn-text: #e0e0e0;
  --kn-muted: #9ca3af;
  --kn-border: #374151;
  --kn-surface: #181825;
  --kn-surface-border: #313244;
  --kn-badge-bg: #262738;
  --kn-badge-text: #a6adc8;
  --kn-pitch-bg: #1e293b;
  --kn-pitch-text: #60a5fa;
  --kn-pitch-border: #2563eb;
  --kn-ruby: #9ca3af;
}
@media (prefers-color-scheme: dark) {
  .kn-card {
    --kn-bg: #1e1e2e;
    --kn-text: #e0e0e0;
    --kn-muted: #9ca3af;
    --kn-border: #374151;
    --kn-surface: #181825;
    --kn-surface-border: #313244;
    --kn-badge-bg: #262738;
    --kn-badge-text: #a6adc8;
    --kn-pitch-bg: #1e293b;
    --kn-pitch-text: #60a5fa;
    --kn-pitch-border: #2563eb;
    --kn-ruby: #9ca3af;
  }
}
.kn-card .kn-reading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}
.kn-card .kn-kana {
  font-size: 1.25em;
  font-weight: 600;
  color: var(--kn-text, #1f2937);
  letter-spacing: 0.02em;
}
.kn-card .kn-pitch {
  font-size: 0.78em;
  font-weight: 500;
  padding: 2px 7px;
  border-radius: 4px;
  background: var(--kn-pitch-bg, #eff6ff);
  color: var(--kn-pitch-text, #2563eb);
  border: 1px solid var(--kn-pitch-border, #bfdbfe);
  white-space: nowrap;
}
.kn-card .kn-divider {
  border: 0;
  height: 1px;
  background: var(--kn-border, #e5e7eb);
  margin: 8px 0 12px 0;
}
.kn-card .kn-meaning,
.kn-meaning {
  margin: 6px 0;
  font-size: 1em;
  line-height: 1.5;
}
.kn-card .kn-meanings,
.kn-meanings {
  margin: 6px 0 10px 0;
  padding-left: 20px;
  font-size: 1em;
  line-height: 1.5;
}
.kn-card .kn-meanings li,
.kn-meanings li {
  margin-bottom: 4px;
}
.kn-card .kn-pos,
.kn-pos {
  display: inline-block;
  font-size: 0.75em;
  font-weight: 500;
  padding: 1px 5px;
  margin-right: 5px;
  border-radius: 3px;
  background: var(--kn-badge-bg, #f3f4f6);
  color: var(--kn-badge-text, #4b5563);
  vertical-align: middle;
}
.kn-card .kn-tag,
.kn-tag {
  display: inline-block;
  font-size: 0.75em;
  font-weight: 500;
  padding: 1px 5px;
  margin-right: 5px;
  border-radius: 3px;
  background: var(--kn-badge-bg, #f3f4f6);
  color: var(--kn-muted, #6b7280);
  vertical-align: middle;
}
.kn-card .kn-example-block,
.kn-example-block {
  margin: 12px 0;
  padding: 10px 14px;
  background: var(--kn-surface, #f9fafb);
  border: 1px solid var(--kn-surface-border, #e5e7eb);
  border-radius: 6px;
}
.kn-card .kn-example-ja,
.kn-example-ja {
  margin: 0 0 4px 0;
  font-size: 1.05em;
  line-height: 1.6;
  font-weight: 500;
  color: var(--kn-text, #1f2937);
}
.kn-card .kn-example-ja ruby rt,
.kn-example-ja ruby rt {
  font-size: 0.58em;
  color: var(--kn-ruby, #6b7280);
  font-weight: normal;
}
.kn-card .kn-example-en,
.kn-example-en {
  margin: 0;
  font-size: 0.88em;
  line-height: 1.4;
  color: var(--kn-muted, #6b7280);
}
.kn-card .kn-hint,
.kn-card .kn-notes {
  margin: 6px 0;
  font-size: 0.85em;
  color: var(--kn-muted, #6b7280);
}
.kn-card .kn-media {
  margin-top: 12px;
  text-align: center;
}
.kn-card .kn-image,
.kn-image {
  max-width: 100%;
  max-height: 240px;
  height: auto;
  object-fit: contain;
  border-radius: 6px;
  display: block;
  margin: 6px auto;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
}"""


def get_anki_card_css() -> str:
    """Return the scoped CSS stylesheet used for Kiroku Anki cards."""
    return ANKI_CARD_CSS


def format_basic_back(
    card: Any = None,
    *,
    expression: str = "",
    reading: str = "",
    meaning: str = "",
    entries: list[Any] | None = None,
    example_sentence: str = "",
    example_reading: str | None = None,
    example_translation: str = "",
    hint: str = "",
    notes: str = "",
    image: str | None = None,
    audio: str | None = None,
    pitches: list[Any] | None = None,
) -> str:
    """Construct a clean, structured, learner-focused Back field for Anki Basic cards.

    Includes reading + pitch badge, divider, structured meanings, ruby examples,
    optional hint/notes, sanitized media tags, and a self-contained scoped <style> block.
    """
    c_reading = str(reading if reading else (_get_field(card, "reading") or "")).strip()
    c_meaning = str(meaning if meaning else (_get_field(card, "meaning") or "")).strip()
    c_entries = entries if entries is not None else _get_field(card, "entries")
    c_ex_sentence = str(example_sentence if example_sentence else (_get_field(card, "example_sentence") or "")).strip()
    c_ex_trans = str(example_translation if example_translation else (_get_field(card, "example_translation") or "")).strip()
    c_hint = str(hint if hint else (_get_field(card, "hint") or "")).strip()
    c_notes = str(notes if notes else (_get_field(card, "notes") or "")).strip()
    # Respect explicitly passed image/audio (e.g. empty string if dedicated fields exist)
    if image is not None:
        c_image = str(image).strip()
    elif card is not None:
        c_image = str(_get_field(card, "image") or "").strip()
    else:
        c_image = ""

    if audio is not None:
        c_audio = str(audio).strip()
    elif card is not None:
        c_audio = str(_get_field(card, "audio") or "").strip()
    else:
        c_audio = ""

    # 1. Pitch information
    c_pitches = pitches
    if c_pitches is None and c_entries and isinstance(c_entries, list):
        for e in c_entries:
            e_pitches = _get_field(e, "pitches")
            if e_pitches and isinstance(e_pitches, list):
                c_pitches = e_pitches
                break

    pitch_badge = ""
    if c_pitches and isinstance(c_pitches, list) and c_pitches[0]:
        pitch_badge = _format_pitch_badge(c_pitches[0])

    # 2. Example reading extraction from entries if not explicit
    c_ex_reading = example_reading
    if not c_ex_reading and c_entries and isinstance(c_entries, list):
        for e in c_entries:
            for s in _get_field(e, "senses") or []:
                for eg in _get_field(s, "examples") or []:
                    eg_ja = _get_field(eg, "japanese")
                    eg_rd = _get_field(eg, "reading")
                    if eg_rd and (not c_ex_sentence or eg_ja == c_ex_sentence):
                        c_ex_reading = eg_rd
                        break

    # Build sections
    sections: list[str] = []

    # Header: Reading & Pitch
    if c_reading or pitch_badge:
        reading_parts = ['<div class="kn-reading">']
        if c_reading:
            reading_parts.append(f'  <span class="kn-kana">{escape_html(c_reading)}</span>')
        if pitch_badge:
            reading_parts.append(f'  <span class="kn-pitch">{escape_html(pitch_badge)}</span>')
        reading_parts.append('</div>')
        reading_parts.append('<hr class="kn-divider">')
        sections.append("\n".join(reading_parts))

    # Meanings
    meanings_html = format_meaning_html(meaning_text=c_meaning, entries=c_entries)
    if meanings_html:
        sections.append(meanings_html)

    # Example block
    example_html = format_example_html(
        japanese=c_ex_sentence,
        translation=c_ex_trans,
        reading=c_ex_reading,
    )
    if example_html:
        sections.append(example_html)

    # Hint & Notes
    if c_hint:
        sections.append(f'<div class="kn-hint">Hint: {escape_html(c_hint)}</div>')
    if c_notes:
        sections.append(f'<div class="kn-notes">Notes: {escape_html(c_notes)}</div>')

    # Media
    img_tag, aud_tag = sanitize_media_tags(image=c_image, audio=c_audio)
    if img_tag or aud_tag:
        media_parts = ['<div class="kn-media">']
        if img_tag:
            media_parts.append(f'  {img_tag}')
        if aud_tag:
            media_parts.append(f'  {aud_tag}')
        media_parts.append('</div>')
        sections.append("\n".join(media_parts))

    if not sections:
        return ""

    body_html = "\n\n".join(sections)
    return f'<div class="kn-card">\n<style>\n{ANKI_CARD_CSS}\n</style>\n\n{body_html}\n</div>'
