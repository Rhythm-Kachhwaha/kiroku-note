"""System API routes (health, extension origin check, diagnostics)."""
from __future__ import annotations

import logging
import time

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from app.config import (
    APP_VERSION,
    get_allowed_extension_ids,
    get_extension_origin_policy,
    is_legacy_extension_origin_rollback_enabled,
)
from app.db.connection import db_session
from app.schemas import HealthResponse
from app.services.dictionary_provider import get_dictionary_db_info, YomitanHttpProvider
from app.services.ocr_service import OcrService
from app.services.operational_diagnostics import record_operational_failure
from app.services.subtitle_annotator import get_tokenizer_status
from app.services.yomitan import YomitanService

from app.services.card_service import CardService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["system"])

# ---------------------------------------------------------------------------
# /api/health
# ---------------------------------------------------------------------------

_health_cache: dict[str, object] = {
    "timestamp": 0.0,
    "response": None,
}
HEALTH_CACHE_TTL_SECONDS = 3.0

# Lazily-created, long-lived service singletons reused by /api/health so each
# health check does not reconstruct YomitanService, CardService, or OcrService.
_health_yomitan_service: YomitanService | None = None
_health_card_service: CardService | None = None
_health_ocr_service: OcrService | None = None


def _health_yomitan() -> YomitanService:
    from app.services.yomitan import get_dictionary_service
    return get_dictionary_service()


def _health_card() -> CardService:
    global _health_card_service
    if _health_card_service is None:
        _health_card_service = CardService()
    return _health_card_service


def _health_ocr() -> OcrService:
    global _health_ocr_service
    if _health_ocr_service is None:
        _health_ocr_service = OcrService()
    return _health_ocr_service


def clear_health_cache() -> None:
    """Helper to clear health cache for testing or manual refresh.

    Also resets the lazily-created health service singletons so callers get a
    fresh probe on the next health check.
    """
    global _health_yomitan_service, _health_card_service, _health_ocr_service
    _health_cache["timestamp"] = 0.0
    _health_cache["response"] = None
    _health_yomitan_service = None
    _health_card_service = None
    _health_ocr_service = None
    from app.services.yomitan import reset_dictionary_service
    reset_dictionary_service()


@router.get("/api/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """Report backend dependency health (db, dictionary, AnkiConnect, OCR)."""
    now = time.monotonic()
    if (
        _health_cache["response"] is not None
        and (now - _health_cache["timestamp"]) < HEALTH_CACHE_TTL_SECONDS
    ):
        return _health_cache["response"]  # type: ignore[return-value]

    # 1. Database check
    db_ok = False
    try:
        with db_session() as conn:
            conn.execute("SELECT 1")
        db_ok = True
    except Exception as exc:
        record_operational_failure("health.database", exc)
        db_ok = False

    # 2. Yomitan / Dictionary check (reused singleton, not reconstructed per request)
    yomitan_ok = False
    dict_health: dict[str, Any] = {}
    try:
        yomitan_service = _health_yomitan()
        yomitan_ok = yomitan_service.check_availability()
        db_info = get_dictionary_db_info()
        yomitan_reachable = False
        try:
            if getattr(yomitan_service, "_yomitan_provider", None) is not None:
                yomitan_reachable = yomitan_service._yomitan_provider.check_availability()
            else:
                yomitan_reachable = YomitanHttpProvider().check_availability()
        except Exception:
            yomitan_reachable = False

        dict_health = {
            "backend": yomitan_service.backend_name,
            "db_present": db_info["db_present"],
            "db_path": db_info["db_path"],
            "jitendex": db_info["jitendex"],
            "kanjidic": db_info["kanjidic"],
            "yomitan_secondary": bool(getattr(yomitan_service, "yomitan_secondary_enabled", False)),
            "yomitan_reachable": bool(yomitan_reachable),
        }
    except Exception as exc:
        record_operational_failure("health.yomitan", exc)
        yomitan_ok = False
        db_info = get_dictionary_db_info()
        dict_health = {
            "backend": "local",
            "db_present": db_info["db_present"],
            "db_path": db_info["db_path"],
            "jitendex": db_info["jitendex"],
            "kanjidic": db_info["kanjidic"],
            "yomitan_secondary": False,
            "yomitan_reachable": False,
        }

    # 3. AnkiConnect check (reused singleton, not reconstructed per request)
    anki_ok = False
    try:
        card_service = _health_card()
        anki_status = card_service.get_anki_status()
        anki_ok = bool(anki_status.connected)
    except Exception as exc:
        record_operational_failure("health.anki", exc)
        anki_ok = False

    # 4. Standalone OCR check (reused singleton, not reconstructed per request)
    ocr_ok = False
    try:
        ocr_service = _health_ocr()
        ocr_status = ocr_service.get_status()
        ocr_ok = bool(ocr_status.available)
    except Exception as exc:
        record_operational_failure("health.ocr", exc)
        ocr_ok = False

    tokenizer = get_tokenizer_status()
    response = HealthResponse(
        status="ok",
        version=APP_VERSION,
        yomitan=yomitan_ok,
        ankiconnect=anki_ok,
        ocr=ocr_ok,
        db=db_ok,
        tokenizer=tokenizer["tokenizer"],
        tokenizer_dictionary=tokenizer["dictionary"],
        tokenizer_ready=tokenizer["ready"],
        dictionary=dict_health,
    )
    _health_cache["timestamp"] = time.monotonic()
    _health_cache["response"] = response
    return response


# ---------------------------------------------------------------------------
# Setup checklist
# ---------------------------------------------------------------------------

class SetupChecklistItem(BaseModel):
    id: str
    ok: bool
    detail: str
    fix_action: str | None = None
    required: bool = True
    informational: bool = False


@router.get("/api/setup/checklist", response_model=list[SetupChecklistItem])
def get_setup_checklist() -> list[SetupChecklistItem]:
    """Report setup readiness and diagnostic status for all dependencies."""
    items: list[SetupChecklistItem] = []

    # 1. Dictionary DB
    dict_ok = False
    dict_detail = "Dictionary database missing or unprovisioned."
    try:
        db_info = get_dictionary_db_info()
        dict_ok = bool(db_info.get("db_present", False))
        if dict_ok:
            dict_detail = f"Dictionary database present at {db_info.get('db_path')}."
        else:
            dict_detail = "Dictionary database missing or unprovisioned. Provisioning required."
    except Exception as exc:
        record_operational_failure("setup.checklist.dictionary", exc)
        dict_ok = False
        dict_detail = f"Error checking dictionary database: {exc}"

    items.append(
        SetupChecklistItem(
            id="dictionary_db",
            ok=dict_ok,
            detail=dict_detail,
            fix_action=None if dict_ok else "provision_dictionary",
            required=True,
            informational=False,
        )
    )

    # 2. Tokenizer Dict
    tok_ok = False
    tok_detail = "Tokenizer dictionary missing or unready."
    try:
        tokenizer = get_tokenizer_status()
        tok_ok = bool(tokenizer.get("ready", False))
        tok_name = tokenizer.get("tokenizer", "unknown")
        dict_name = tokenizer.get("dictionary", "none")
        if tok_ok:
            tok_detail = f"Tokenizer ({tok_name}) is ready with dictionary '{dict_name}'."
        else:
            tok_detail = f"Tokenizer ({tok_name}) dictionary is unready or missing."
    except Exception as exc:
        record_operational_failure("setup.checklist.tokenizer", exc)
        tok_ok = False
        tok_detail = f"Error checking tokenizer dictionary: {exc}"

    items.append(
        SetupChecklistItem(
            id="tokenizer_dict",
            ok=tok_ok,
            detail=tok_detail,
            fix_action=None if tok_ok else "install_tokenizer_dict",
            required=True,
            informational=False,
        )
    )

    # 3. Extension origin allowlist
    ext_ok = False
    ext_detail = "No extension IDs allowlisted."
    try:
        allowed_ids = get_allowed_extension_ids()
        ext_ok = bool(len(allowed_ids) > 0)
        if ext_ok:
            ext_detail = f"Extension origin allowlisted with {len(allowed_ids)} extension ID(s)."
        else:
            ext_detail = "No extension IDs are allowlisted; browser extension requests will be rejected."
    except Exception as exc:
        record_operational_failure("setup.checklist.extension", exc)
        ext_ok = False
        ext_detail = f"Error checking extension allowlist status: {exc}"

    items.append(
        SetupChecklistItem(
            id="extension_pairing",
            ok=ext_ok,
            detail=ext_detail,
            fix_action=None,
            required=True,
            informational=False,
        )
    )

    # 4. Anki reachable
    anki_ok = False
    anki_detail = "AnkiConnect is not reachable at localhost:8765."
    try:
        card_service = _health_card()
        anki_status = card_service.get_anki_status()
        anki_ok = bool(anki_status.connected)
        if anki_ok:
            anki_detail = "AnkiConnect is connected and responsive."
        else:
            anki_detail = "AnkiConnect is not reachable at localhost:8765."
    except Exception as exc:
        record_operational_failure("setup.checklist.anki", exc)
        anki_ok = False
        anki_detail = f"AnkiConnect check error: {exc}"

    items.append(
        SetupChecklistItem(
            id="anki",
            ok=anki_ok,
            detail=anki_detail,
            fix_action=None if anki_ok else "start_anki",
            required=True,
            informational=False,
        )
    )

    # 5. PDF dependency (pypdf)
    pdf_ok = False
    pdf_detail = "PDF reader dependency (pypdf) is missing."
    try:
        import pypdf
        pdf_ok = True
        pdf_version = getattr(pypdf, "__version__", "")
        pdf_detail = f"PDF dependency (pypdf {pdf_version}) is installed." if pdf_version else "PDF reader dependency (pypdf) is installed."
    except ImportError:
        pdf_ok = False
        pdf_detail = "PDF reader dependency (pypdf) is not installed."
    except Exception as exc:
        record_operational_failure("setup.checklist.pdf", exc)
        pdf_ok = False
        pdf_detail = f"Error checking PDF dependency: {exc}"

    items.append(
        SetupChecklistItem(
            id="pdf_dependency",
            ok=pdf_ok,
            detail=pdf_detail,
            fix_action=None if pdf_ok else "install_pypdf",
            required=True,
            informational=False,
        )
    )

    # 6. Data dir writable
    from app.config import get_data_dir
    data_ok = False
    data_detail = "Data directory write check failed."
    try:
        data_dir = get_data_dir()
        data_dir.mkdir(parents=True, exist_ok=True)
        test_file = data_dir / ".setup_write_test"
        test_file.write_text("ok", encoding="utf-8")
        test_file.unlink(missing_ok=True)
        data_ok = True
        data_detail = f"Data directory is writable ({data_dir})."
    except Exception as exc:
        record_operational_failure("setup.checklist.data_dir", exc)
        data_ok = False
        data_detail = f"Data directory write test failed: {exc}"

    items.append(
        SetupChecklistItem(
            id="data_dir_writable",
            ok=data_ok,
            detail=data_detail,
            fix_action=None if data_ok else "fix_data_dir_permissions",
            required=True,
            informational=False,
        )
    )

    # 7. Yomitan (optional secondary, informational)
    yomitan_reachable = False
    yomitan_detail = "Yomitan server is offline (optional secondary source)."
    try:
        yomitan_service = _health_yomitan()
        if getattr(yomitan_service, "_yomitan_provider", None) is not None:
            yomitan_reachable = bool(yomitan_service._yomitan_provider.check_availability())
        else:
            yomitan_reachable = bool(YomitanHttpProvider().check_availability())
        if yomitan_reachable:
            yomitan_detail = "Yomitan server is reachable and active."
        else:
            yomitan_detail = "Yomitan server is offline (optional secondary source)."
    except Exception as exc:
        record_operational_failure("setup.checklist.yomitan", exc)
        yomitan_reachable = False
        yomitan_detail = f"Yomitan probe error: {exc}"

    items.append(
        SetupChecklistItem(
            id="yomitan",
            ok=yomitan_reachable,
            detail=yomitan_detail,
            fix_action=None if yomitan_reachable else "start_yomitan",
            required=False,
            informational=True,
        )
    )

    # 8. OCR (optional, informational)
    ocr_ok = False
    ocr_detail = "Manga-OCR service is offline (optional image OCR)."
    try:
        ocr_service = _health_ocr()
        ocr_ok = bool(ocr_service.get_status().available)
        if ocr_ok:
            ocr_detail = "Manga-OCR service is running and ready."
        else:
            ocr_detail = "Manga-OCR service is offline (optional image OCR)."
    except Exception as exc:
        record_operational_failure("setup.checklist.ocr", exc)
        ocr_ok = False
        ocr_detail = f"Manga-OCR probe error: {exc}"

    items.append(
        SetupChecklistItem(
            id="ocr",
            ok=ocr_ok,
            detail=ocr_detail,
            fix_action=None if ocr_ok else "start_ocr",
            required=False,
            informational=True,
        )
    )

    return items
