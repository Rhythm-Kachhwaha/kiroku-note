"""
Provider Registry and Factory for Study Bank Acquisition.
---------------------------------------------------------
Resolves acquisition providers dynamically based on name or configuration.
"""
from __future__ import annotations

import os

from app.study.acquisition.enums import ProviderKind
from app.study.acquisition.providers.base import BaseAcquisitionProvider
from app.study.acquisition.providers.keenable_provider import KeenableProvider
from app.study.acquisition.providers.mock import MockAcquisitionProvider
from app.study.acquisition.providers.parallel_provider import ParallelProvider


def get_acquisition_provider(name: str | None = None) -> BaseAcquisitionProvider:
    """
    Resolve and instantiate the requested acquisition provider.
    Defaults to Keenable (Architecture B).
    """
    provider_name = (name or os.environ.get("KIROKU_ACQUISITION_PROVIDER", ProviderKind.KEENABLE.value)).lower().strip()

    if provider_name == ProviderKind.KEENABLE.value:
        return KeenableProvider()
    elif provider_name == ProviderKind.PARALLEL.value:
        return ParallelProvider()
    elif provider_name == ProviderKind.MOCK.value:
        return MockAcquisitionProvider()
    else:
        raise ValueError(f"Unknown acquisition provider: {provider_name}")

