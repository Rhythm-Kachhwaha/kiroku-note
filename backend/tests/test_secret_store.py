"""
Tests for SecretStore abstraction, Windows DPAPI implementation, and secure persistence.
"""
from pathlib import Path
import sys
import pytest

from app.services.secret_store import (
    InMemorySecretStore,
    SecretStore,
    WindowsDPAPISecretStore,
    get_secret_store,
    reset_secret_store,
)


def test_in_memory_secret_store():
    store = InMemorySecretStore()
    assert not store.has_secret("test_key")
    assert store.get_secret("test_key") is None

    store.set_secret("test_key", "sec_12345")
    assert store.has_secret("test_key")
    assert store.get_secret("test_key") == "sec_12345"

    # Replace key
    store.set_secret("test_key", "sec_67890")
    assert store.get_secret("test_key") == "sec_67890"

    # Delete key
    assert store.delete_secret("test_key") is True
    assert store.delete_secret("test_key") is False
    assert not store.has_secret("test_key")
    assert store.get_secret("test_key") is None


@pytest.mark.skipif(sys.platform != "win32", reason="Windows DPAPI requires win32")
def test_windows_dpapi_secret_store_lifecycle(tmp_path: Path):
    secrets_file = tmp_path / "data" / ".secrets.enc"
    store = WindowsDPAPISecretStore(secrets_path=secrets_file)

    assert not store.has_secret("llm_api_key")
    assert store.get_secret("llm_api_key") is None

    test_key_val = "gsk_test_secret_1234567890abcdef"
    store.set_secret("llm_api_key", test_key_val)

    # Key exists and is retrievable
    assert store.has_secret("llm_api_key")
    assert store.get_secret("llm_api_key") == test_key_val

    # Assert that the file exists and is encrypted (does NOT contain the raw secret)
    assert secrets_file.is_file()
    raw_disk_bytes = secrets_file.read_bytes()
    assert len(raw_disk_bytes) > 0
    # Must NOT contain plain text secret anywhere in the raw bytes
    assert test_key_val.encode("utf-8") not in raw_disk_bytes

    # Simulate process restart by instantiating a brand new SecretStore pointing to the same file
    store2 = WindowsDPAPISecretStore(secrets_path=secrets_file)
    assert store2.has_secret("llm_api_key")
    assert store2.get_secret("llm_api_key") == test_key_val

    # Replace key
    new_key_val = "gsk_replacement_key_999999999"
    store2.set_secret("llm_api_key", new_key_val)
    assert store2.get_secret("llm_api_key") == new_key_val
    raw_disk_bytes2 = secrets_file.read_bytes()
    assert new_key_val.encode("utf-8") not in raw_disk_bytes2

    # Delete key
    assert store2.delete_secret("llm_api_key") is True
    assert not store2.has_secret("llm_api_key")
    assert store2.get_secret("llm_api_key") is None

    # Restart check after deletion
    store3 = WindowsDPAPISecretStore(secrets_path=secrets_file)
    assert not store3.has_secret("llm_api_key")
    assert store3.get_secret("llm_api_key") is None


def test_secret_store_validation(tmp_path: Path):
    store = InMemorySecretStore()
    with pytest.raises(ValueError):
        store.set_secret("", "secret")
    with pytest.raises(ValueError):
        store.set_secret("key", "")
