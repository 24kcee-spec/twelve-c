"""
crypto.py - device keys, CSR, hashing and signing for FDMS (Phase 4 / P2).

Scope: pure in-process cryptography. No network, no file writes, no key
storage (key custody is P3's KeyProvider job). Private keys are only ever
handled as `cryptography` key objects; nothing here serialises one.

Spec basis (ZIMRA Fiscal Device Gateway API v7.2):
  - 4.2 registerDevice: CSR subject CN = ZIMRA-<serial>-<10-digit deviceID>;
    optional subject fields, if present, must be C=ZW, O=Zimbabwe Revenue
    Authority, S(=ST)=Zimbabwe. Key types: ECC secp256r1 with
    ecdsa-with-SHA256 (preferred), or RSA-2048 with SHA256WithRSA.
  - 13.1: hash = SHA-256(concatenated string); signature is made over that
    same string with the device private key. Hash and signature are sent as
    base64 (SignatureData).

OPEN SPEC QUESTION (finding F4) - NOT resolved by the spec text:
  Section 13.1 only writes "ECC(Hash, CURVE, g, n)" and never states the
  ECDSA signature ENCODING (ASN.1 DER vs raw r||s). SignatureData.signature
  is "Binary (256)... length is variable depending on algorithm".
  Decision: DER is the default (it is what ecdsa-with-SHA256 in every
  standard library/CSR/certificate produces and what the spec's own "most
  tools hide encoding details" note implies); RAW_RS is implemented behind
  the same flag so the ZIMRA TEST environment (RCPT020 = bad signature) can
  settle it without a code rewrite. RSA is unambiguous: RSASSA-PKCS1-v1_5
  with SHA-256 (= "SHA256WithRSA").
"""

from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Union

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import (
    decode_dss_signature,
    encode_dss_signature,
)
from cryptography.x509.oid import NameOID

PrivateKey = Union[ec.EllipticCurvePrivateKey, rsa.RSAPrivateKey]
PublicKey = Union[ec.EllipticCurvePublicKey, rsa.RSAPublicKey]

ZIMRA_COUNTRY = "ZW"
ZIMRA_ORGANISATION = "Zimbabwe Revenue Authority"
ZIMRA_STATE = "Zimbabwe"

_P256_COORD_BYTES = 32  # secp256r1 field/order size -> raw signature is 64 bytes


class CryptoError(ValueError):
    """Raised for invalid crypto inputs (never for a merely-bad signature;
    verify_* return False for that)."""


class KeyType(str, Enum):
    ECC_P256 = "ECC_P256"   # preferred by the spec
    RSA_2048 = "RSA_2048"


class SignatureEncoding(str, Enum):
    """ECDSA signature wire encoding. Ignored for RSA. See F4 in the module
    docstring."""
    DER = "DER"        # ASN.1 SEQUENCE { r, s } (default)
    RAW_RS = "RAW_RS"  # fixed-width r || s (64 bytes for P-256)


DEFAULT_ECDSA_ENCODING = SignatureEncoding.DER


# --------------------------------------------------------------------------
# Keys
# --------------------------------------------------------------------------
def generate_private_key(key_type: KeyType) -> PrivateKey:
    """Generate a fresh device key in memory. Persisting it safely is P3."""
    if key_type == KeyType.ECC_P256:
        return ec.generate_private_key(ec.SECP256R1())
    if key_type == KeyType.RSA_2048:
        return rsa.generate_private_key(public_exponent=65537, key_size=2048)
    raise CryptoError(f"Unsupported key type: {key_type!r}")


def key_type_of(key: Union[PrivateKey, PublicKey]) -> KeyType:
    if isinstance(key, (ec.EllipticCurvePrivateKey, ec.EllipticCurvePublicKey)):
        if key.curve.name != "secp256r1":
            raise CryptoError(f"Unsupported curve {key.curve.name}; only secp256r1 is allowed")
        return KeyType.ECC_P256
    if isinstance(key, (rsa.RSAPrivateKey, rsa.RSAPublicKey)):
        if key.key_size != 2048:
            raise CryptoError(f"Unsupported RSA size {key.key_size}; only 2048 is allowed")
        return KeyType.RSA_2048
    raise CryptoError(f"Unsupported key object: {type(key).__name__}")


# --------------------------------------------------------------------------
# CSR (spec 4.2 + section 12)
# --------------------------------------------------------------------------
def build_device_common_name(serial_no: str, device_id: int) -> str:
    """ZIMRA-<Fiscal_device_serial_no>-<zero_padded_10_digit_deviceId>."""
    if not isinstance(device_id, int) or isinstance(device_id, bool):
        raise CryptoError("device_id must be an int")
    if not (0 <= device_id <= 9_999_999_999):
        raise CryptoError("device_id must fit in 10 digits")
    serial = (serial_no or "").strip()
    if not serial:
        raise CryptoError("serial_no must not be empty")
    return f"ZIMRA-{serial}-{device_id:010d}"


def build_csr_pem(
    private_key: PrivateKey,
    serial_no: str,
    device_id: int,
    include_optional_subject: bool = False,
) -> str:
    """
    PKCS#10 CSR (PEM) for registerDevice.certificateRequest.

    Default subject is CN only (spec: other fields optional). With
    include_optional_subject=True also adds C=ZW, O=Zimbabwe Revenue
    Authority, ST=Zimbabwe - the only values the spec allows.
    Signed ecdsa-with-SHA256 (ECC) or sha256WithRSAEncryption (RSA).
    """
    key_type_of(private_key)  # validates curve / size
    attrs = []
    if include_optional_subject:
        attrs += [
            x509.NameAttribute(NameOID.COUNTRY_NAME, ZIMRA_COUNTRY),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, ZIMRA_ORGANISATION),
            x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, ZIMRA_STATE),
        ]
    attrs.append(
        x509.NameAttribute(NameOID.COMMON_NAME, build_device_common_name(serial_no, device_id))
    )
    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(x509.Name(attrs))
        .sign(private_key, hashes.SHA256())
    )
    return csr.public_bytes(_pem()).decode("ascii")


def _pem():
    from cryptography.hazmat.primitives.serialization import Encoding
    return Encoding.PEM


# --------------------------------------------------------------------------
# Hash + signature (spec 13.1)
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class SignatureResult:
    """SignatureData (spec 5.3): SHA-256 hash + signature, both raw bytes.
    Use .hash_b64 / .signature_b64 for the JSON payload."""
    hash: bytes
    signature: bytes

    @property
    def hash_b64(self) -> str:
        return base64.b64encode(self.hash).decode("ascii")

    @property
    def signature_b64(self) -> str:
        return base64.b64encode(self.signature).decode("ascii")


def _to_bytes(text: str) -> bytes:
    if not isinstance(text, str):
        raise CryptoError("canonical signing string must be str")
    return text.encode("utf-8")


def sha256_digest(text: str) -> bytes:
    return hashlib.sha256(_to_bytes(text)).digest()


def sha256_b64(text: str) -> str:
    """Base64 SHA-256 of the canonical string (the spec's 'hash in base64')."""
    return base64.b64encode(sha256_digest(text)).decode("ascii")


def _ecdsa_encode(der: bytes, encoding: SignatureEncoding) -> bytes:
    if encoding == SignatureEncoding.DER:
        return der
    r, s = decode_dss_signature(der)
    return r.to_bytes(_P256_COORD_BYTES, "big") + s.to_bytes(_P256_COORD_BYTES, "big")


def _ecdsa_to_der(sig: bytes, encoding: SignatureEncoding) -> bytes:
    if encoding == SignatureEncoding.DER:
        return sig
    if len(sig) != 2 * _P256_COORD_BYTES:
        raise CryptoError("RAW_RS signature must be exactly 64 bytes")
    r = int.from_bytes(sig[:_P256_COORD_BYTES], "big")
    s = int.from_bytes(sig[_P256_COORD_BYTES:], "big")
    return encode_dss_signature(r, s)


def sign_canonical_string(
    private_key: PrivateKey,
    canonical_string: str,
    ecdsa_encoding: SignatureEncoding = DEFAULT_ECDSA_ENCODING,
) -> SignatureResult:
    """
    Hash and sign a canonical string produced by canonicalise.py.

    ECC: ECDSA over SHA-256 (signing the message with SHA-256 is identical
         to signing its SHA-256 digest). Randomised: two signatures over the
         same input differ, both verify.
    RSA: RSASSA-PKCS1-v1_5 + SHA-256 (deterministic).
    """
    data = _to_bytes(canonical_string)
    digest = hashlib.sha256(data).digest()
    kt = key_type_of(private_key)
    if kt == KeyType.ECC_P256:
        der = private_key.sign(data, ec.ECDSA(hashes.SHA256()))
        sig = _ecdsa_encode(der, ecdsa_encoding)
    else:
        sig = private_key.sign(data, padding.PKCS1v15(), hashes.SHA256())
    return SignatureResult(hash=digest, signature=sig)


def verify_canonical_string(
    public_key: PublicKey,
    canonical_string: str,
    signature: bytes,
    ecdsa_encoding: SignatureEncoding = DEFAULT_ECDSA_ENCODING,
) -> bool:
    """True iff `signature` is a valid signature of `canonical_string`.
    Used for our own round-trip checks and to verify FDMS signatures once the
    server certificate is fetched (P4). Returns False on any bad signature or
    malformed encoding; raises CryptoError only for unsupported key types."""
    data = _to_bytes(canonical_string)
    kt = key_type_of(public_key)
    try:
        if kt == KeyType.ECC_P256:
            public_key.verify(_ecdsa_to_der(signature, ecdsa_encoding), data, ec.ECDSA(hashes.SHA256()))
        else:
            public_key.verify(signature, data, padding.PKCS1v15(), hashes.SHA256())
        return True
    except (InvalidSignature, ValueError, CryptoError):
        return False


# --------------------------------------------------------------------------
# Certificates
# --------------------------------------------------------------------------
def load_certificate_pem(pem: Union[str, bytes]) -> x509.Certificate:
    data = pem.encode("ascii") if isinstance(pem, str) else pem
    try:
        return x509.load_pem_x509_certificate(data)
    except ValueError as exc:
        raise CryptoError(f"Invalid certificate PEM: {exc}") from exc


def certificate_thumbprint_sha1(cert: x509.Certificate) -> bytes:
    """SignatureDataEx.certificateThumbprint: SHA-1 of the DER certificate."""
    return cert.fingerprint(hashes.SHA1())  # noqa: S303 - mandated by spec 5.3


def public_keys_match(a: Union[PrivateKey, PublicKey, x509.Certificate, x509.CertificateSigningRequest],
                      b: Union[PrivateKey, PublicKey, x509.Certificate, x509.CertificateSigningRequest]) -> bool:
    """True if both objects hold the same public key (e.g. issued certificate
    vs our private key - a sanity check before installing a certificate)."""
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    def spki(obj) -> bytes:
        pub = obj.public_key() if hasattr(obj, "public_key") else obj
        return pub.public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)

    return spki(a) == spki(b)
