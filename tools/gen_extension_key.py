#!/usr/bin/env python3
"""
Generate an RSA private key for Kiroku Note extension packaging and pinning.
Derives the Chromium extension ID and public key for manifest.json.
Private key is saved OUTSIDE the repository (defaults to ~/.kiroku/extension_key.pem).
"""
import base64
import hashlib
import os
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def derive_extension_id(public_key_der: bytes) -> str:
    """Derive 32-char Chromium extension ID from SubjectPublicKeyInfo DER bytes."""
    sha256_digest = hashlib.sha256(public_key_der).digest()
    hex_str = sha256_digest[:16].hex()
    return "".join(chr(ord("a") + int(c, 16)) for c in hex_str)


def generate_or_load_key(key_path: Path) -> tuple[str, str, Path]:
    """Generate or load RSA private key, return (manifest_key_base64, extension_id, key_path)."""
    if key_path.exists():
        with open(key_path, "rb") as f:
            private_key = serialization.load_pem_private_key(f.read(), password=None)
    else:
        key_path.parent.mkdir(parents=True, exist_ok=True)
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem_bytes = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        with open(key_path, "wb") as f:
            f.write(pem_bytes)

    public_der = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    manifest_key = base64.b64encode(public_der).decode("ascii")
    extension_id = derive_extension_id(public_der)
    return manifest_key, extension_id, key_path


def main() -> None:
    default_dir = Path.home() / ".kiroku"
    key_path = default_dir / "extension_key.pem"
    manifest_key, ext_id, saved_path = generate_or_load_key(key_path)

    print("============================================================")
    print("  Kiroku Note Extension Key Generator")
    print(f"  Private Key Saved: {saved_path}")
    print(f"  Extension ID:      {ext_id}")
    print("============================================================")
    print("\nManifest 'key' string:\n")
    print(manifest_key)
    print("\nConfig DEFAULT_EXTENSION_IDS entry:\n")
    print(f'DEFAULT_EXTENSION_IDS = ("{ext_id}",)')
    print("============================================================")


if __name__ == "__main__":
    main()
