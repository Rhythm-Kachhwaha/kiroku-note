"""Tofugu conceptual grammar guide parser and reference schema.

Extracts rich conceptual fields:
- Big picture mental model / core concept
- Formation formulas & connection rules
- Common pitfalls / mistakes
- Nuance contrasts (e.g. A vs B comparisons)
- Visual anchor SVG representations
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import re
from typing import Any
from pydantic import BaseModel, Field


class FormationRule(BaseModel):
    """Rule describing how words/clauses attach to this grammar point."""
    structure: str
    description: str = ""
    example: str | None = None


class CommonPitfall(BaseModel):
    """Common misconception or incorrect usage mistake."""
    misconception: str
    correction: str = ""
    explanation: str = ""


class NuanceContrast(BaseModel):
    """Comparative contrast against a similar grammar pattern."""
    target_pattern: str
    difference: str
    when_to_use_this: str = ""
    when_to_use_target: str = ""


class GrammarEnrichment(BaseModel):
    """Enrichment record adhering to grammar_enrichment SQLite schema."""
    concept_id: str
    big_picture_concept: str
    formation_rules: list[FormationRule] = Field(default_factory=list)
    common_pitfalls: list[CommonPitfall] = Field(default_factory=list)
    nuance_contrasts: list[NuanceContrast] = Field(default_factory=list)
    visual_anchor_svg: str | None = None
    source_url: str = ""
    updated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_db_row(self) -> tuple[str, str, str, str, str, str | None, str, str]:
        """Convert to SQLite parameter tuple matching grammar_enrichment columns."""
        return (
            self.concept_id,
            self.big_picture_concept,
            json.dumps([f.model_dump() for f in self.formation_rules], ensure_ascii=False),
            json.dumps([p.model_dump() for p in self.common_pitfalls], ensure_ascii=False),
            json.dumps([c.model_dump() for c in self.nuance_contrasts], ensure_ascii=False),
            self.visual_anchor_svg,
            self.source_url,
            self.updated_at,
        )

    @classmethod
    def from_db_row(cls, row: dict[str, Any] | tuple[Any, ...]) -> GrammarEnrichment:
        """Create instance from database dictionary or tuple row."""
        if isinstance(row, dict):
            d = row
        else:
            d = {
                "concept_id": row[0],
                "big_picture_concept": row[1],
                "formation_rules": row[2],
                "common_pitfalls": row[3],
                "nuance_contrasts": row[4],
                "visual_anchor_svg": row[5],
                "source_url": row[6],
                "updated_at": row[7],
            }

        def _loads_if_str(val: Any) -> Any:
            if isinstance(val, str):
                try:
                    return json.loads(val)
                except Exception:
                    return []
            return val or []

        formation_data = _loads_if_str(d.get("formation_rules"))
        pitfalls_data = _loads_if_str(d.get("common_pitfalls"))
        contrasts_data = _loads_if_str(d.get("nuance_contrasts"))

        return cls(
            concept_id=d.get("concept_id", ""),
            big_picture_concept=d.get("big_picture_concept", "") or "",
            formation_rules=[FormationRule(**item) if isinstance(item, dict) else FormationRule(structure=str(item)) for item in formation_data],
            common_pitfalls=[CommonPitfall(**item) if isinstance(item, dict) else CommonPitfall(misconception=str(item)) for item in pitfalls_data],
            nuance_contrasts=[NuanceContrast(**item) if isinstance(item, dict) else NuanceContrast(target_pattern=str(item), difference="") for item in contrasts_data],
            visual_anchor_svg=d.get("visual_anchor_svg"),
            source_url=d.get("source_url", "") or "",
            updated_at=d.get("updated_at") or datetime.now(timezone.utc).isoformat(),
        )


class TofuguParser:
    """Deterministic parser extracting conceptual grammar structures from Tofugu articles."""

    def __init__(self) -> None:
        pass

    def parse(
        self,
        raw_markdown: str,
        concept_id: str,
        source_url: str = "",
        visual_anchor_svg: str | None = None,
    ) -> GrammarEnrichment:
        """Parse raw markdown into a validated GrammarEnrichment model."""
        clean_text = raw_markdown or ""
        big_picture = self._extract_big_picture(clean_text)
        formations = self._extract_formation_rules(clean_text)
        pitfalls = self._extract_pitfalls(clean_text)
        contrasts = self._extract_contrasts(clean_text)

        return GrammarEnrichment(
            concept_id=concept_id,
            big_picture_concept=big_picture,
            formation_rules=formations,
            common_pitfalls=pitfalls,
            nuance_contrasts=contrasts,
            visual_anchor_svg=visual_anchor_svg,
            source_url=source_url,
        )

    def _extract_big_picture(self, text: str) -> str:
        # Search for headings or paragraphs covering big picture / core concept / what is
        match = re.search(
            r"(?:#+\s*(?:Big Picture|Core Concept|Mental Model|What is [^\n]+|Introduction)\s*\n+)(.+?)(?=\n#|\Z)",
            text,
            re.IGNORECASE | re.DOTALL,
        )
        if match:
            # First non-empty paragraph
            paras = [p.strip() for p in match.group(1).strip().split("\n\n") if p.strip()]
            if paras:
                return paras[0]

        # Fallback: take the first paragraph after any initial H1/title
        lines = [line.strip() for line in text.splitlines()]
        paragraphs: list[str] = []
        current: list[str] = []
        for line in lines:
            if not line:
                if current:
                    paragraphs.append(" ".join(current))
                    current = []
            elif line.startswith("#"):
                if current:
                    paragraphs.append(" ".join(current))
                    current = []
            else:
                current.append(line)
        if current:
            paragraphs.append(" ".join(current))

        return paragraphs[0] if paragraphs else ""

    def _extract_formation_rules(self, text: str) -> list[FormationRule]:
        rules: list[FormationRule] = []
        section_match = re.search(
            r"(?:#+\s*(?:How to Form|How to Use|Formation|Connection|Patterns?)\s*\n+)(.+?)(?=\n#|\Z)",
            text,
            re.IGNORECASE | re.DOTALL,
        )
        body = section_match.group(1) if section_match else text

        # Match bullet list items or patterns like "Verb [plain] + ..."
        for line in body.splitlines():
            line = line.strip()
            bullet_match = re.match(r"^[-*•]\s*(?:`([^`]+)`|([^\n:]+))(?::\s*(.+))?$", line)
            if bullet_match:
                structure = (bullet_match.group(1) or bullet_match.group(2) or "").strip()
                desc = (bullet_match.group(3) or "").strip()
                if structure and ("+" in structure or "Verb" in structure or "Noun" in structure or "Adj" in structure or "Plain" in structure):
                    rules.append(FormationRule(structure=structure, description=desc))
            elif line.startswith("`") and line.endswith("`") and "+" in line:
                rules.append(FormationRule(structure=line.strip("`").strip()))

        return rules

    def _extract_pitfalls(self, text: str) -> list[CommonPitfall]:
        pitfalls: list[CommonPitfall] = []
        section_match = re.search(
            r"(?:#+\s*(?:Common (?:Mistakes|Pitfalls|Errors)|Warning|Caution)\s*\n+)(.+?)(?=\n#|\Z)",
            text,
            re.IGNORECASE | re.DOTALL,
        )
        if section_match:
            body = section_match.group(1)
            # Find bullet points or sub-sections
            current_misconception = ""
            current_explanation: list[str] = []
            for line in body.splitlines():
                line = line.strip()
                bullet_match = re.match(r"^[-*•]\s*(.+)$", line)
                if bullet_match:
                    if current_misconception:
                        pitfalls.append(CommonPitfall(
                            misconception=current_misconception,
                            explanation=" ".join(current_explanation).strip(),
                        ))
                        current_explanation = []
                    item_text = bullet_match.group(1).strip()
                    if ":" in item_text:
                        parts = item_text.split(":", 1)
                        current_misconception = parts[0].strip()
                        current_explanation.append(parts[1].strip())
                    else:
                        current_misconception = item_text
                elif line and current_misconception:
                    current_explanation.append(line)
            if current_misconception:
                pitfalls.append(CommonPitfall(
                    misconception=current_misconception,
                    explanation=" ".join(current_explanation).strip(),
                ))
        return pitfalls

    def _extract_contrasts(self, text: str) -> list[NuanceContrast]:
        contrasts: list[NuanceContrast] = []
        section_match = re.search(
            r"(?:#+\s*(?:(?:vs\.?|Versus|Differences?|Comparison|Nuance Contrasts?)[^\n]*)\s*\n+)(.+?)(?=\n#|\Z)",
            text,
            re.IGNORECASE | re.DOTALL,
        )
        if section_match:
            body = section_match.group(1)
            for line in body.splitlines():
                line = line.strip()
                bullet_match = re.match(r"^[-*•]\s*([^\n:]+):\s*(.+)$", line)
                if bullet_match:
                    target = bullet_match.group(1).strip()
                    diff = bullet_match.group(2).strip()
                    contrasts.append(NuanceContrast(
                        target_pattern=target,
                        difference=diff,
                    ))
        return contrasts
