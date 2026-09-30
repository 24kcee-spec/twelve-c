"""
key_provider.py - device private-key custody for FDMS (Phase 4 / P3).

Goal: the code that builds and submits receipts can ASK for a signature but
can never obtain the private key. Everything signs through a KeyProvider.

Providers
  - KeyProvider             abstract sign-only interface (what P8 depends on)
  - InMemoryKeyProvider     tests / throw-away use only; never persisted
  - EncryptedFileKeyProvider  zero-budget dev/pilot store: PKCS#8 key encrypted
                            with AES-256-GCM under a scrypt-derived key
  - AzureKeyVaultKeyProvider / AwsKmsKeyProvider / Pkcs11KeyProvider
                            STUBS. Constructing one raises NotImplementedError.
                            They mark where a real KMS/HSM plugs in.

HONEST LIMITS (do not oversell this in a security questionnaire)
  - The encrypted file protects the key AT REST (stolen disk, leaked backup,
    a committed file). Once opened, the key object lives in this process's
    memory and could be read by anything that can read that memory. Only a
    KMS/HSM provider, where the key never leaves the device, closes that gap.
    The file provider is therefore NOT enterprise-grade custody.
  - Python cannot reliably wipe key material from memory.
  - Windows DPAPI binding was deferred: it needs a non-stdlib dependency
    (pywin32) and ties the file to one machine/user, which conflicts with
    restore-on-another-host. Revisit in P17 if wanted.

File format (JSON, UTF-8, suffix must be .fkey so .gitignore covers it):
  format, version, key_id, key_type, kdf{name,n,r,p,salt}, cipher{name,nonce},
  ciphertext. The whole header is bound into the GCM tag as associated data,
  so changing key_id, key_type, KDF parameters, salt or nonce is detected.
"""

from __future__ import annotations

import base64
import json
import os
import re
import secrets
import unicodedata
from abc import ABC, abstractmethod
from typing import Optional

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    load_der_private_key,
)

from .crypto import (
    DEFAULT_ECDSA_ENCODING,
    KeyType,
    PrivateKey,
    PublicKey,
    SignatureEncoding,
    SignatureResult,
    build_csr_pem,
    generate_private_key,
    key_type_of,
    sign_canonical_string,
    verify_canonical_string,
)

# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------


class KeyProviderError(Exception):
    """Base class for all custody errors."""


class KeyStoreCorruptError(KeyProviderError):
    """The key file is malformed or uses parameters outside policy."""


class KeyStoreAuthError(KeyProviderError):
    """Wrong passphrase OR the file was modified. Deliberately not
    distinguishable: an attacker must not learn which one it was."""


# --------------------------------------------------------------------------
# Policy constants
# --------------------------------------------------------------------------
KEYFILE_SUFFIX = ".fkey"
FORMAT_NAME = "twelvec-fkey"
FORMAT_VERSION = 1

MIN_PASSPHRASE_CHARS = 12

DEFAULT_SCRYPT_N = 2 ** 17      # about 128 MiB at r=8; OWASP-level work factor
MIN_SCRYPT_N = 2 ** 14          # weakest accepted unless allow_weak_kdf
MAX_SCRYPT_N = 2 ** 18          # cap so a hostile file cannot demand GBs of RAM
SCRYPT_R = 8
SCRYPT_P = 1
_SALT_BYTES = 16
_NONCE_BYTES = 12
_KEY_BYTES = 32                 # AES-256

_KEY_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


# --------------------------------------------------------------------------
# Abstract interface
# --------------------------------------------------------------------------
class KeyProvider(ABC):
    """Sign-only access to one device key. There is intentionally NO method
    that returns private key material."""

    @property
    @abstractmethod
    def key_id(self) -> str: ...

    @property
    @abstractmethod
    def key_type(self) -> KeyType: ...

    @abstractmethod
    def public_key(self) -> PublicKey: ...

    @abstractmethod
    def sign(
        self,
        canonical_string: str,
        ecdsa_encoding: SignatureEncoding = DEFAULT_ECDSA_ENCODING,
    ) -> SignatureResult:
        """SHA-256 + sign a canonical string from canonicalise.py."""

    @abstractmethod
    def build_csr_pem(
        self, serial_no: str, device_id: int, include_optional_subject: bool = False
    ) -> str:
        """PKCS#10 CSR for registerDevice, signed by this key."""

    def verify(
        self,
        canonical_string: str,
        signature: bytes,
        ecdsa_encoding: SignatureEncoding = DEFAULT_ECDSA_ENCODING,
    ) -> bool:
        """Verify one of our own signatures using the public key."""
        return verify_canonical_string(
            self.public_key(), canonical_string, signature, ecdsa_encoding
        )


def _check_key_id(key_id: str) -> str:
    if not isinstance(key_id, str) or not _KEY_ID_RE.match(key_id):
        raise KeyProviderError("key_id must be 1-64 chars of letters, digits, '.', '_' or '-'")
    return key_id


class _LocalKeyProvider(KeyProvider):
    """Holds a key object in this process. Base for the in-memory and
    encrypted-file providers. The key sits in a name-mangled attribute, is
    never returned, never printed and cannot be pickled."""

    def __init__(self, private_key: PrivateKey, key_id: str) -> None:
        self.__key = private_key
        self.__key_type = key_type_of(private_key)  # validates curve / size
        self.__key_id = _check_key_id(key_id)

    @property
    def key_id(self) -> str:
        return self.__key_id

    @property
    def key_type(self) -> KeyType:
        return self.__key_type

    def public_key(self) -> PublicKey:
        return self.__key.public_key()

    def sign(
        self,
        canonical_string: str,
        ecdsa_encoding: SignatureEncoding = DEFAULT_ECDSA_ENCODING,
    ) -> SignatureResult:
        return sign_canonical_string(self.__key, canonical_string, ecdsa_encoding)

    def build_csr_pem(
        self, serial_no: str, device_id: int, include_optional_subject: bool = False
    ) -> str:
        return build_csr_pem(self.__key, serial_no, device_id, include_optional_subject)

    def _pkcs8_der(self) -> bytes:
        # Internal: only the encrypted-file writer uses this.
        return self.__key.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())

    def __repr__(self) -> str:
        return f"<{type(self).__name__} key_id={self.key_id!r} key_type={self.key_type.value}>"

    def __reduce__(self):
        raise TypeError(f"{type(self).__name__} must not be pickled (it holds a private key)")


class InMemoryKeyProvider(_LocalKeyProvider):
    """Tests and throw-away use ONLY. Nothing is persisted."""

    @classmethod
    def generate(cls, key_type: KeyType, key_id: str = "memory") -> "InMemoryKeyProvider":
        return cls(generate_private_key(key_type), key_id)


# --------------------------------------------------------------------------
# Encrypted file provider
# --------------------------------------------------------------------------
def _normalise_passphrase(passphrase: str) -> bytes:
    if not isinstance(passphrase, str):
        raise KeyProviderError("passphrase must be a str")
    if len(passphrase) < MIN_PASSPHRASE_CHARS:
        raise KeyProviderError(f"passphrase must be at least {MIN_PASSPHRASE_CHARS} characters")
    # NFKC so the same visible passphrase typed on another keyboard/OS matches.
    return unicodedata.normalize("NFKC", passphrase).encode("utf-8")


def passphrase_from_env(var_name: str) -> str:
    """Read the keystore passphrase from an environment variable (for
    unattended service start). Raises if unset; never logs the value."""
    value = os.environ.get(var_name)
    if not value:
        raise KeyProviderError(f"environment variable {var_name} is not set")
    return value


def _check_kdf(n: int, r: int, p: int, allow_weak: bool) -> None:
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in (n, r, p)):
        raise KeyStoreCorruptError("KDF parameters must be integers")
    if n < 2 or (n & (n - 1)) != 0:
        raise KeyStoreCorruptError("scrypt n must be a power of two")
    if n > MAX_SCRYPT_N:
        raise KeyStoreCorruptError(f"scrypt n above the allowed maximum {MAX_SCRYPT_N}")
    if r != SCRYPT_R or p != SCRYPT_P:
        raise KeyStoreCorruptError(f"scrypt r/p must be {SCRYPT_R}/{SCRYPT_P}")
    if n < MIN_SCRYPT_N and not allow_weak:
        raise KeyProviderError(
            f"scrypt n={n} is weaker than policy minimum {MIN_SCRYPT_N} (tests only: allow_weak_kdf=True)"
        )


def _derive(passphrase: bytes, salt: bytes, n: int, r: int, p: int) -> bytes:
    return Scrypt(salt=salt, length=_KEY_BYTES, n=n, r=r, p=p).derive(passphrase)


def _aad(key_id: str, key_type: str, n: int, r: int, p: int, salt_b64: str, nonce_b64: str) -> bytes:
    return "|".join(
        [FORMAT_NAME, str(FORMAT_VERSION), key_id, key_type, "scrypt",
         str(n), str(r), str(p), salt_b64, nonce_b64, "AES-256-GCM"]
    ).encode("utf-8")


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(text: object, what: str) -> bytes:
    if not isinstance(text, str):
        raise KeyStoreCorruptError(f"{what} must be a base64 string")
    try:
        return base64.b64decode(text.encode("ascii"), validate=True)
    except (ValueError, UnicodeEncodeError) as exc:
        raise KeyStoreCorruptError(f"{what} is not valid base64") from exc


def _encrypt_document(
    provider: _LocalKeyProvider, passphrase: str, kdf_n: int, allow_weak_kdf: bool
) -> bytes:
    _check_kdf(kdf_n, SCRYPT_R, SCRYPT_P, allow_weak_kdf)
    pw = _normalise_passphrase(passphrase)
    salt = secrets.token_bytes(_SALT_BYTES)
    nonce = secrets.token_bytes(_NONCE_BYTES)
    salt_b64, nonce_b64 = _b64(salt), _b64(nonce)
    aad = _aad(provider.key_id, provider.key_type.value, kdf_n, SCRYPT_R, SCRYPT_P, salt_b64, nonce_b64)
    ciphertext = AESGCM(_derive(pw, salt, kdf_n, SCRYPT_R, SCRYPT_P)).encrypt(
        nonce, provider._pkcs8_der(), aad
    )
    doc = {
        "format": FORMAT_NAME,
        "version": FORMAT_VERSION,
        "key_id": provider.key_id,
        "key_type": provider.key_type.value,
        "kdf": {"name": "scrypt", "n": kdf_n, "r": SCRYPT_R, "p": SCRYPT_P, "salt": salt_b64},
        "cipher": {"name": "AES-256-GCM", "nonce": nonce_b64},
        "ciphertext": _b64(ciphertext),
    }
    return (json.dumps(doc, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _write_atomic(path: str, data: bytes, overwrite: bool) -> None:
    """Write via a temp file in the same directory, fsync, then move into
    place. Without overwrite the move fails if the target exists, so an
    existing key can never be silently replaced (losing a device key means
    losing the ability to sign for that device)."""
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    tmp = os.path.join(directory, f".{os.path.basename(path)}.{secrets.token_hex(6)}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        if overwrite:
            os.replace(tmp, path)
        else:
            try:
                os.link(tmp, path)          # atomic, fails if path exists
            except FileExistsError:
                raise KeyProviderError(f"refusing to overwrite existing key file: {path}") from None
            except OSError:
                # Filesystem without hard links: fall back to check-then-move.
                if os.path.exists(path):
                    raise KeyProviderError(f"refusing to overwrite existing key file: {path}") from None
                os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    try:
        os.chmod(path, 0o600)               # best effort; meaningful on POSIX
    except OSError:
        pass


def _check_path(path: str) -> str:
    if not isinstance(path, str) or not path:
        raise KeyProviderError("path must be a non-empty str")
    if not path.lower().endswith(KEYFILE_SUFFIX):
        raise KeyProviderError(
            f"key files must end with {KEYFILE_SUFFIX} (that suffix is git-ignored and hygiene-tested)"
        )
    return path


class EncryptedFileKeyProvider(_LocalKeyProvider):
    """Device key stored encrypted at rest. See module docstring for limits."""

    def __init__(self, private_key: PrivateKey, key_id: str, path: str) -> None:
        super().__init__(private_key, key_id)
        self.__path = path

    @property
    def path(self) -> str:
        return self.__path

    # -- create ------------------------------------------------------------
    @classmethod
    def create(
        cls,
        path: str,
        passphrase: str,
        key_type: KeyType = KeyType.ECC_P256,
        key_id: Optional[str] = None,
        private_key: Optional[PrivateKey] = None,
        overwrite: bool = False,
        kdf_n: int = DEFAULT_SCRYPT_N,
        allow_weak_kdf: bool = False,
    ) -> "EncryptedFileKeyProvider":
        """Generate (or import) a key and write it encrypted. The file is
        written BEFORE the provider is returned, so a CSR can only be built
        from a key that already survives a crash."""
        _check_path(path)
        key = private_key if private_key is not None else generate_private_key(key_type)
        kid = key_id if key_id is not None else f"key-{secrets.token_hex(4)}"
        provider = cls(key, kid, path)
        _write_atomic(path, _encrypt_document(provider, passphrase, kdf_n, allow_weak_kdf), overwrite)
        return provider

    # -- open --------------------------------------------------------------
    @classmethod
    def open(cls, path: str, passphrase: str, allow_weak_kdf: bool = False) -> "EncryptedFileKeyProvider":
        _check_path(path)
        try:
            with open(path, "rb") as fh:
                raw = fh.read()
        except FileNotFoundError:
            raise KeyProviderError(f"key file not found: {path}") from None
        doc = cls._parse(raw)
        kdf, cipher = doc["kdf"], doc["cipher"]
        n, r, p = kdf["n"], kdf["r"], kdf["p"]
        _check_kdf(n, r, p, allow_weak_kdf)
        salt = _unb64(kdf["salt"], "kdf.salt")
        nonce = _unb64(cipher["nonce"], "cipher.nonce")
        if len(salt) != _SALT_BYTES or len(nonce) != _NONCE_BYTES:
            raise KeyStoreCorruptError("salt or nonce has the wrong length")
        ciphertext = _unb64(doc["ciphertext"], "ciphertext")
        kid = _check_key_id(doc["key_id"])
        aad = _aad(kid, doc["key_type"], n, r, p, kdf["salt"], cipher["nonce"])
        pw = _normalise_passphrase(passphrase)
        try:
            der = AESGCM(_derive(pw, salt, n, r, p)).decrypt(nonce, ciphertext, aad)
        except InvalidTag:
            raise KeyStoreAuthError("wrong passphrase or key file was modified") from None
        try:
            key = load_der_private_key(der, password=None)
        except (ValueError, TypeError):
            raise KeyStoreCorruptError("decrypted key material is not a valid PKCS#8 key") from None
        provider = cls(key, kid, path)
        if provider.key_type.value != doc["key_type"]:
            raise KeyStoreCorruptError("key_type in header does not match the stored key")
        return provider

    @staticmethod
    def _parse(raw: bytes) -> dict:
        try:
            doc = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise KeyStoreCorruptError("key file is not valid UTF-8 JSON") from None
        if not isinstance(doc, dict):
            raise KeyStoreCorruptError("key file root must be an object")
        if doc.get("format") != FORMAT_NAME:
            raise KeyStoreCorruptError("not a Twelve C key file")
        if doc.get("version") != FORMAT_VERSION:
            raise KeyStoreCorruptError(f"unsupported key file version: {doc.get('version')!r}")
        kdf, cipher = doc.get("kdf"), doc.get("cipher")
        if not isinstance(kdf, dict) or kdf.get("name") != "scrypt":
            raise KeyStoreCorruptError("unsupported KDF")
        if not isinstance(cipher, dict) or cipher.get("name") != "AES-256-GCM":
            raise KeyStoreCorruptError("unsupported cipher")
        for field in ("key_id", "key_type", "ciphertext"):
            if not isinstance(doc.get(field), str):
                raise KeyStoreCorruptError(f"missing or invalid field: {field}")
        for field in ("n", "r", "p", "salt"):
            if field not in kdf:
                raise KeyStoreCorruptError(f"missing kdf.{field}")
        if "nonce" not in cipher:
            raise KeyStoreCorruptError("missing cipher.nonce")
        return doc

    # -- maintenance -------------------------------------------------------
    def change_passphrase(
        self,
        old_passphrase: str,
        new_passphrase: str,
        kdf_n: int = DEFAULT_SCRYPT_N,
        allow_weak_kdf: bool = False,
    ) -> None:
        """Re-encrypt under a new passphrase (fresh salt and nonce). The old
        passphrase is re-verified against the file first."""
        EncryptedFileKeyProvider.open(self.__path, old_passphrase, allow_weak_kdf=True)
        _write_atomic(
            self.__path,
            _encrypt_document(self, new_passphrase, kdf_n, allow_weak_kdf),
            overwrite=True,
        )


# --------------------------------------------------------------------------
# KMS / HSM stubs (P3 deliverable: the seam, not the integration)
# --------------------------------------------------------------------------
class _UnimplementedProvider(KeyProvider):
    _NAME = "provider"
    _NEEDS = ""

    def __init__(self, *args, **kwargs) -> None:
        raise NotImplementedError(
            f"{self._NAME} is a stub. {self._NEEDS} Until it exists, use "
            "EncryptedFileKeyProvider and describe it as NOT enterprise-grade."
        )

    # Never reached (constructor always raises); present so the ABC is satisfied.
    key_id = property(lambda self: "")
    key_type = property(lambda self: KeyType.ECC_P256)

    def public_key(self):  # pragma: no cover
        raise NotImplementedError

    def sign(self, canonical_string, ecdsa_encoding=DEFAULT_ECDSA_ENCODING):  # pragma: no cover
        raise NotImplementedError

    def build_csr_pem(self, serial_no, device_id, include_optional_subject=False):  # pragma: no cover
        raise NotImplementedError


class AzureKeyVaultKeyProvider(_UnimplementedProvider):
    _NAME = "AzureKeyVaultKeyProvider"
    _NEEDS = ("Needs an Azure subscription, a Key Vault or Managed HSM holding an EC P-256 key, "
              "and the azure-keyvault-keys SDK. The CSR must be signed by the vault (sign operation).")


class AwsKmsKeyProvider(_UnimplementedProvider):
    _NAME = "AwsKmsKeyProvider"
    _NEEDS = ("Needs an AWS account, a KMS key with spec ECC_NIST_P256 and usage SIGN_VERIFY, "
              "and boto3. KMS returns DER signatures over the message digest.")


class Pkcs11KeyProvider(_UnimplementedProvider):
    _NAME = "Pkcs11KeyProvider"
    _NEEDS = ("Needs an HSM or token with a PKCS#11 module and a P-256 or RSA-2048 key, "
              "plus a PKCS#11 binding. Raw CKM_ECDSA output must be re-encoded if DER is chosen.")
