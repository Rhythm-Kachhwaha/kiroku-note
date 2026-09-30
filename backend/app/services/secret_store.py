"""
Secure OS-level Secret Storage abstraction for Kiroku.

Provides encryption at rest using Windows DPAPI (CryptProtectData / CryptUnprotectData)
tied to the user's OS logon credentials, with atomic file persistence.
No raw secrets are stored in SQLite, config files, or application logs.
"""
from abc import ABC, abstractmethod
import json
import logging
import os
from pathlib import Path
import sys
import tempfile
from typing import Optional

logger = logging.getLogger(__name__)

# DPAPI flag: CRYPTPROTECT_UI_FORBIDDEN prevents any prompt UI
_CRYPTPROTECT_UI_FORBIDDEN = 0x1


class SecretStore(ABC):
    """Abstract interface for local secret storage."""

    @abstractmethod
    def get_secret(self, key_id: str) -> Optional[str]:
        """Retrieve decrypted secret string by key_id, or None if not present."""
        pass

    @abstractmethod
    def set_secret(self, key_id: str, secret: str) -> None:
        """Encrypt and persist secret string for key_id."""
        pass

    @abstractmethod
    def delete_secret(self, key_id: str) -> bool:
        """Delete secret for key_id. Returns True if it existed and was removed."""
        pass

    @abstractmethod
    def has_secret(self, key_id: str) -> bool:
        """Check if secret exists for key_id without returning the value."""
        pass


class WindowsDPAPISecretStore(SecretStore):
    """
    Windows implementation of SecretStore backed by Data Protection API (DPAPI).
    
    Protects secrets at rest by encrypting them with the Windows user account
    master key before persisting them into a local protected file.
    """

    def __init__(self, secrets_path: Optional[Path] = None) -> None:
        if secrets_path is not None:
            self._path = Path(secrets_path)
        else:
            from app.config import get_secrets_file_path
            self._path = get_secrets_file_path()

    @property
    def path(self) -> Path:
        return self._path

    def _encrypt(self, plaintext: bytes) -> bytes:
        import ctypes
        from ctypes import wintypes

        class DATA_BLOB(ctypes.Structure):
            _fields_ = [
                ("cbData", wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_byte)),
            ]

        blob_in = DATA_BLOB(
            len(plaintext),
            ctypes.cast(ctypes.create_string_buffer(plaintext), ctypes.POINTER(ctypes.c_byte)),
        )
        blob_out = DATA_BLOB()
        desc_ptr = ctypes.c_wchar_p("Kiroku Secret")

        success = ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(blob_in),
            desc_ptr,
            None,
            None,
            None,
            _CRYPTPROTECT_UI_FORBIDDEN,
            ctypes.byref(blob_out),
        )
        if not success:
            raise ctypes.WinError()
        try:
            return ctypes.string_at(blob_out.pbData, blob_out.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)

    def _decrypt(self, ciphertext: bytes) -> bytes:
        import ctypes
        from ctypes import wintypes

        class DATA_BLOB(ctypes.Structure):
            _fields_ = [
                ("cbData", wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_byte)),
            ]

        blob_in = DATA_BLOB(
            len(ciphertext),
            ctypes.cast(ctypes.create_string_buffer(ciphertext), ctypes.POINTER(ctypes.c_byte)),
        )
        blob_out = DATA_BLOB()

        success = ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(blob_in),
            None,
            None,
            None,
            None,
            _CRYPTPROTECT_UI_FORBIDDEN,
            ctypes.byref(blob_out),
        )
        if not success:
            raise ctypes.WinError()
        try:
            return ctypes.string_at(blob_out.pbData, blob_out.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)

    def _read_all_secrets(self) -> dict[str, str]:
        if not self._path.is_file():
            return {}
        try:
            ciphertext = self._path.read_bytes()
            if not ciphertext:
                return {}
            plaintext_bytes = self._decrypt(ciphertext)
            data = json.loads(plaintext_bytes.decode("utf-8"))
            if isinstance(data, dict):
                return {str(k): str(v) for k, v in data.items()}
        except Exception as e:
            logger.warning("Failed to decrypt secure secrets store: %s", type(e).__name__)
        return {}

    def _write_all_secrets(self, secrets: dict[str, str]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        raw_json = json.dumps(secrets).encode("utf-8")
        ciphertext = self._encrypt(raw_json)

        # Atomic file write
        temp_dir = self._path.parent
        fd, temp_file_path = tempfile.mkstemp(dir=temp_dir, prefix=".secrets_", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(ciphertext)
            os.replace(temp_file_path, self._path)
        except Exception:
            if os.path.exists(temp_file_path):
                try:
                    os.remove(temp_file_path)
                except OSError:
                    pass
            raise

    def get_secret(self, key_id: str) -> Optional[str]:
        secrets = self._read_all_secrets()
        return secrets.get(key_id)

    def set_secret(self, key_id: str, secret: str) -> None:
        if not key_id or not isinstance(key_id, str):
            raise ValueError("key_id must be a non-empty string.")
        if not secret or not isinstance(secret, str):
            raise ValueError("secret must be a non-empty string.")
        secrets = self._read_all_secrets()
        secrets[key_id] = secret
        self._write_all_secrets(secrets)

    def delete_secret(self, key_id: str) -> bool:
        secrets = self._read_all_secrets()
        if key_id in secrets:
            del secrets[key_id]
            self._write_all_secrets(secrets)
            return True
        return False

    def has_secret(self, key_id: str) -> bool:
        secrets = self._read_all_secrets()
        return key_id in secrets and bool(secrets[key_id])


class InMemorySecretStore(SecretStore):
    """In-memory secret store for testing or environments where DPAPI is unavailable."""

    def __init__(self) -> None:
        self._secrets: dict[str, str] = {}

    def get_secret(self, key_id: str) -> Optional[str]:
        return self._secrets.get(key_id)

    def set_secret(self, key_id: str, secret: str) -> None:
        if not key_id or not isinstance(key_id, str):
            raise ValueError("key_id must be a non-empty string.")
        if not secret or not isinstance(secret, str):
            raise ValueError("secret must be a non-empty string.")
        self._secrets[key_id] = secret

    def delete_secret(self, key_id: str) -> bool:
        if key_id in self._secrets:
            del self._secrets[key_id]
            return True
        return False

    def has_secret(self, key_id: str) -> bool:
        return key_id in self._secrets and bool(self._secrets[key_id])


_singleton_store: Optional[SecretStore] = None


def get_secret_store(secrets_path: Optional[Path] = None, force_in_memory: bool = False) -> SecretStore:
    """
    Get the configured SecretStore singleton or instance.
    
    If secrets_path is provided, returns an instance bound to that path.
    """
    global _singleton_store

    if secrets_path is not None:
        if force_in_memory or (sys.platform != "win32" and os.name != "nt"):
            return InMemorySecretStore()
        return WindowsDPAPISecretStore(secrets_path=secrets_path)

    if _singleton_store is None:
        if force_in_memory or (sys.platform != "win32" and os.name != "nt"):
            _singleton_store = InMemorySecretStore()
        else:
            _singleton_store = WindowsDPAPISecretStore()

    return _singleton_store


def reset_secret_store() -> None:
    """Reset the singleton store instance (primarily for tests)."""
    global _singleton_store
    _singleton_store = None
