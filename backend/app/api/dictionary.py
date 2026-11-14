"""Dictionary management, status, and provisioning API routes."""
from __future__ import annotations

import logging
from threading import Lock
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

try:
    from sudachipy import Dictionary, SplitMode
except ImportError:
    Dictionary = None  # type: ignore[assignment,misc]
    SplitMode = None  # type: ignore[assignment,misc]

from app.config import (
    get_dictionary_backend,
    is_yomitan_secondary_enabled,
    load_stored_app_config,
    save_stored_app_config,
)
from app.services.dictionary_provider import get_dictionary_db_info
from app.services.yomitan import reset_dictionary_service
from kiroku_dictionary.provision import get_provision_status, start_provisioning_in_background

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dictionary"])

_sudachi_lock = Lock()
_sudachi_dict = None


def _get_sudachi_tokenizer():
    global _sudachi_dict
    if Dictionary is None:
        return None
    with _sudachi_lock:
        if _sudachi_dict is None:
            _sudachi_dict = Dictionary()
        return _sudachi_dict.tokenizer()


class TokenInfo(BaseModel):
    surface: str
    normalized: str
    dictionary_form: str
    reading: str
    part_of_speech: list[str]
    inflection_type: str
    inflection_form: str


class TokenizeRequest(BaseModel):
    text: str
    mode: str = "C"


class TokenizeResponse(BaseModel):
    tokens: list[TokenInfo]


class DictionarySettingsRequest(BaseModel):
    yomitan_secondary: bool


class DictionarySettingsResponse(BaseModel):
    yomitan_secondary: bool
    backend: str


class DictionaryStatusResponse(BaseModel):
    db_present: bool
    db_path: str
    jitendex: bool
    kanjidic: bool
    yomitan_secondary: bool
    backend: str
    provisioning: dict[str, Any]


class ProvisionRequest(BaseModel):
    jitendex_url: str | None = None
    kanjidic_url: str | None = None
    jitendex_sha256: str | None = None
    kanjidic_sha256: str | None = None


def _require_desktop_control(request: Request) -> None:
    """Guard provisioning mutations to desktop control token."""
    from app.main import _is_desktop_request

    if not _is_desktop_request(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: desktop control token is required.",
        )


@router.get("/api/dictionary/status", response_model=DictionaryStatusResponse)
def get_dictionary_status() -> DictionaryStatusResponse:
    """Return status of local dictionary database and background provisioning."""
    info = get_dictionary_db_info()
    prov = get_provision_status()
    backend = get_dictionary_backend()
    yomi_sec = is_yomitan_secondary_enabled()

    return DictionaryStatusResponse(
        db_present=info["db_present"],
        db_path=info["db_path"],
        jitendex=info["jitendex"],
        kanjidic=info["kanjidic"],
        yomitan_secondary=yomi_sec,
        backend=backend,
        provisioning=prov,
    )


@router.post("/api/dictionary/provision")
async def provision_dictionary(
    request: Request,
    payload: ProvisionRequest | None = None,
) -> dict[str, Any]:
    """Trigger background download, compilation, and provisioning of local dictionary database."""
    _require_desktop_control(request)

    body = payload or ProvisionRequest()
    started = start_provisioning_in_background(
        jitendex_url=body.jitendex_url,
        kanjidic_url=body.kanjidic_url,
        jitendex_sha256=body.jitendex_sha256,
        kanjidic_sha256=body.kanjidic_sha256,
    )

    if not started:
        prov = get_provision_status()
        return {
            "status": "already_running",
            "message": "Provisioning is already in progress.",
            "provisioning": prov,
        }

    return {
        "status": "started",
        "message": "Dictionary provisioning started in background.",
        "provisioning": get_provision_status(),
    }


@router.get("/api/dictionary/settings", response_model=DictionarySettingsResponse)
def get_dictionary_settings() -> DictionarySettingsResponse:
    """Return dictionary configuration settings."""
    return DictionarySettingsResponse(
        yomitan_secondary=is_yomitan_secondary_enabled(),
        backend=get_dictionary_backend(),
    )


@router.put("/api/dictionary/settings", response_model=DictionarySettingsResponse)
def update_dictionary_settings(
    payload: DictionarySettingsRequest,
) -> DictionarySettingsResponse:
    """Update and persist dictionary configuration settings."""
    stored = load_stored_app_config()
    dict_cfg = stored.get("dictionary")
    if not isinstance(dict_cfg, dict):
        dict_cfg = {}
        stored["dictionary"] = dict_cfg
    dict_cfg["yomitan_secondary"] = bool(payload.yomitan_secondary)
    save_stored_app_config(stored)

    reset_dictionary_service()

    return DictionarySettingsResponse(
        yomitan_secondary=is_yomitan_secondary_enabled(),
        backend=get_dictionary_backend(),
    )


@router.post("/api/tokenize", response_model=TokenizeResponse)
def tokenize_text(payload: TokenizeRequest) -> TokenizeResponse:
    """Analyze sentence text with Sudachi morphological analyzer."""
    if not payload.text or not payload.text.strip():
        return TokenizeResponse(tokens=[])

    tokenizer = _get_sudachi_tokenizer()
    if tokenizer is None or SplitMode is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SudachiPy tokenizer is not installed or available.",
        )

    mode_str = (payload.mode or "C").upper().strip()
    if mode_str == "A":
        split_mode = SplitMode.A
    elif mode_str == "B":
        split_mode = SplitMode.B
    else:
        split_mode = SplitMode.C

    try:
        morphemes = tokenizer.tokenize(payload.text, split_mode)
    except Exception as exc:
        logger.warning("Sudachi tokenization error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Tokenization failed: {exc}",
        )

    tokens: list[TokenInfo] = []
    for m in morphemes:
        pos = m.part_of_speech()
        tokens.append(
            TokenInfo(
                surface=m.surface(),
                normalized=m.normalized_form(),
                dictionary_form=m.dictionary_form(),
                reading=m.reading_form() or "",
                part_of_speech=list(pos[:4]) if len(pos) >= 4 else list(pos),
                inflection_type=pos[4] if len(pos) > 4 else "*",
                inflection_form=pos[5] if len(pos) > 5 else "*",
            )
        )

    return TokenizeResponse(tokens=tokens)

