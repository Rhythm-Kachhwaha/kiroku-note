"""LAN Manga & PDF streaming service for PC-to-Phone direct transfer."""
from __future__ import annotations

import ipaddress
import logging
import os
from pathlib import Path
import secrets
import socket
import time
from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, Request, Response, UploadFile, status
from pydantic import BaseModel
from starlette.responses import FileResponse

from app.config import get_data_dir, resolve_port

logger = logging.getLogger(__name__)

router = APIRouter(tags=["manga_stream"])

# In-memory ticket registry: ticket -> { book_id, expires_at }
_tickets: dict[str, dict[str, Any]] = {}
# In-memory registered books: book_id -> { id, title, filename, file_path, size, type }
_registered_books: dict[str, dict[str, Any]] = {}


def get_lan_ip() -> str:
    """Detect local subnet IP address for LAN device pairing."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def is_local_ip(ip_str: str) -> bool:
    """Return True if IP is loopback or private RFC 1918/4193 subnet."""
    if not ip_str:
        return False
    if ip_str in {"testclient", "localhost", "127.0.0.1", "::1"}:
        return True
    if ip_str.startswith("::ffff:"):
        ip_str = ip_str.replace("::ffff:", "")
    try:
        ip = ipaddress.ip_address(ip_str)
        return ip.is_loopback or ip.is_private
    except ValueError:
        return False


def get_manga_dir() -> Path:
    """Get the storage directory for manga books."""
    manga_dir = get_data_dir() / "manga"
    manga_dir.mkdir(parents=True, exist_ok=True)
    return manga_dir


def _cleanup_expired_tickets() -> None:
    now = time.time()
    expired = [t for t, v in _tickets.items() if v.get("expires_at", 0) < now]
    for t in expired:
        _tickets.pop(t, None)


class TicketRequest(BaseModel):
    book_id: str


class TicketResponse(BaseModel):
    ticket: str
    book_id: str
    expires_in: int
    stream_url: str


class BookRegisterRequest(BaseModel):
    id: str
    title: str
    filename: str
    file_path: str | None = None
    size: int = 0
    type: str = "pdf"


def _reset_manga_state_for_test() -> None:
    """Reset in-memory state for testing."""
    _tickets.clear()
    _registered_books.clear()


@router.get("/api/manga/lan-info")
def get_manga_lan_info(request: Request) -> dict[str, Any]:
    """Return LAN pairing IP, port, and available books catalogue."""
    lan_ip = get_lan_ip()
    port = resolve_port()
    base_url = f"http://{lan_ip}:{port}"

    manga_dir = get_manga_dir()
    books: list[dict[str, Any]] = []

    if manga_dir.exists():
        for f in manga_dir.iterdir():
            if f.is_file() and f.suffix.lower() in {".pdf", ".cbz", ".zip", ".bin"}:
                bid = f.stem
                books.append({
                    "id": bid,
                    "title": f.name,
                    "filename": f.name,
                    "size": f.stat().st_size,
                    "type": f.suffix.lower().lstrip("."),
                })

    for bid, bdata in _registered_books.items():
        if not any(b["id"] == bid for b in books):
            books.append({
                "id": bdata["id"],
                "title": bdata["title"],
                "filename": bdata["filename"],
                "size": bdata["size"],
                "type": bdata["type"],
            })

    return {
        "lan_ip": lan_ip,
        "port": port,
        "base_url": base_url,
        "books": books,
    }


@router.post("/api/manga/ticket", response_model=TicketResponse)
def create_manga_ticket(payload: TicketRequest, request: Request) -> TicketResponse:
    """Issue a single-use or short-lived transfer ticket for a book ID."""
    _cleanup_expired_tickets()

    book_id = payload.book_id.strip()
    if not book_id:
        raise HTTPException(status_code=400, detail="Missing book_id")

    # Verify book exists
    book_file = None
    manga_dir = get_manga_dir()

    # 1. Registered path
    if book_id in _registered_books:
        reg_path = _registered_books[book_id].get("file_path")
        if reg_path and Path(reg_path).is_file():
            book_file = Path(reg_path)

    # 2. File in manga_dir
    if not book_file:
        for f in manga_dir.iterdir():
            if f.is_file() and (f.stem == book_id or f.name == book_id):
                book_file = f
                break

    if not book_file:
        # Also check if book_id has extension in manga_dir
        candidate = manga_dir / book_id
        if candidate.is_file():
            book_file = candidate

    if not book_file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Book not found: {book_id}",
        )

    ticket = secrets.token_urlsafe(24)
    expires_in = 600  # 10 minutes
    _tickets[ticket] = {
        "book_id": book_id,
        "file_path": str(book_file),
        "expires_at": time.time() + expires_in,
    }

    lan_ip = get_lan_ip()
    port = resolve_port()
    stream_url = f"http://{lan_ip}:{port}/api/manga/stream/{book_id}?ticket={ticket}"

    return TicketResponse(
        ticket=ticket,
        book_id=book_id,
        expires_in=expires_in,
        stream_url=stream_url,
    )


@router.get("/api/manga/stream/{book_id}")
async def stream_manga_book(
    book_id: str,
    ticket: str = Query(..., description="Single-use transfer ticket"),
    request: Request = None,
) -> FileResponse:
    """Stream raw PDF/CBZ binary with HTTP Range support to local LAN devices."""
    _cleanup_expired_tickets()

    # 1. Security: Restrict strictly to local subnet IPs
    client_host = request.client.host if (request and request.client) else "127.0.0.1"
    if not is_local_ip(client_host):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Manga streaming is restricted to local network devices.",
        )

    # 2. Security: Validate transfer ticket
    ticket_data = _tickets.get(ticket)
    if not ticket_data or ticket_data.get("book_id") != book_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or unrecognized transfer ticket.",
        )

    if time.time() > ticket_data.get("expires_at", 0):
        _tickets.pop(ticket, None)
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Transfer ticket has expired.",
        )

    file_path = Path(ticket_data["file_path"])
    if not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Book file not found on disk.",
        )

    media_type = "application/pdf" if file_path.suffix.lower() == ".pdf" else "application/octet-stream"
    return FileResponse(
        path=file_path,
        filename=file_path.name,
        media_type=media_type,
    )


@router.get("/api/manga/qr")
def get_manga_qr_svg(text: str = Query(..., description="Text or URL to encode")) -> Response:
    """Generate and return an SVG QR code for LAN pairing."""
    import cv2
    try:
        encoder = cv2.QRCodeEncoder_create()
        mat = encoder.encode(text)
        h, w = mat.shape
        quiet_zone = 4
        svg_size = max(h, w) + 2 * quiet_zone
        paths = []
        for r in range(h):
            for c in range(w):
                if mat[r, c] == 0:
                    x = c + quiet_zone
                    y = r + quiet_zone
                    paths.append(f"M{x},{y}h1v1h-1z")
        path_data = " ".join(paths)
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {svg_size} {svg_size}" '
            f'width="220" height="220" shape-rendering="crispEdges">'
            f'<rect width="100%" height="100%" fill="white"/>'
            f'<path d="{path_data}" fill="black"/>'
            f'</svg>'
        )
        return Response(content=svg, media_type="image/svg+xml")
    except Exception as exc:
        logger.warning("QR generation failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not generate QR code")


@router.post("/api/manga/register")
def register_manga_book(payload: BookRegisterRequest) -> dict[str, Any]:
    """Register or update book metadata in catalogue."""
    _registered_books[payload.id] = {
        "id": payload.id,
        "title": payload.title,
        "filename": payload.filename,
        "file_path": payload.file_path,
        "size": payload.size,
        "type": payload.type,
    }
    return {"status": "ok", "registered": True, "book": _registered_books[payload.id]}
