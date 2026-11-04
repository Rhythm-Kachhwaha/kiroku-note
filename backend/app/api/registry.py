"""Auto-discovery of API routers.

Imports every :mod:`app.api` submodule that exposes a module-level ``router``
and returns them so :mod:`app.main` can register them without being edited for
every new feature area.
"""
from __future__ import annotations

from importlib import import_module
from pathlib import Path
import pkgutil

API_PACKAGE = "app.api"

# Modules that are not feature-area routers (package init, this module).
_SKIP_MODULES = {"__init__", "registry"}


def discover_routers() -> list:
    """Import every ``app/api/*.py`` module exposing a ``router`` and return them.

    Only modules that bind a module-level ``router`` (an
    :class:`fastapi.APIRouter`) are returned. Existing routers bound under
    other names (e.g. ``subtitle_router``) are intentionally left to be
    registered explicitly in :mod:`app.main` to avoid double registration.
    """
    routers: list = []
    here = Path(__file__).resolve().parent
    for entry in pkgutil.iter_modules([str(here)]):
        name = entry.name
        if name in _SKIP_MODULES:
            continue
        module = import_module(f"{API_PACKAGE}.{name}")
        router = getattr(module, "router", None)
        if router is not None:
            routers.append(router)
    return routers
