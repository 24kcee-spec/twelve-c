"""Tests for key_provider.py (Phase 4 / P3: key custody).

Fast scrypt (n=2**10) is used everywhere except the one test that checks the
production default, so the suite stays quick. allow_weak_kdf is the explicit
opt-in that production code must never pass.
"""

import base64
import json
import os
import pickle
import stat
import sys

import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
)

from fiscal_core import key_provider as kp
from fiscal_core.crypto import (
    KeyType,
    SignatureEncoding,
    generate_private_key,
    load_certificate_pem,
    public_keys_match,
)
from fiscal_core.key_provider import (
    AwsKmsKeyProvider,
    AzureKeyVaultKeyProvider,
    EncryptedFileKeyProvider,
    InMemoryKeyProvider,
    KeyProvider,
    KeyProviderError,
    KeyStoreAuthError,
    KeyStoreCorruptError,
    Pkcs11KeyProvider,
    passphrase_from_env,
)

PW = "correct horse battery staple"
FAST = dict(kdf_n=2 ** 10, allow_weak_kdf=True)
CANONICAL = "321FISCALINVOICEZWL4322019-09-19T15:43:129450000"


@pytest.fixture
def keyfile(tmp_path):
    return str(tmp_path / "device-321.fkey")


def _create(keyfile, key_type=KeyType.ECC_P256, **kw):
    return EncryptedFileKeyProvider.create(keyfile, PW, key_type=key_type, key_id="dev-321", **FAST, **kw)


def _open(keyfile, passphrase=PW):
    return EncryptedFileKeyProvider.open(keyfile, passphrase, allow_weak_kdf=True)


def _rewrite(keyfile, mutate):
    with open(keyfile, "r", encoding="utf-8") as fh:
        doc = json.load(fh)
    mutate(doc)
    with open(keyfile, "w", encoding="utf-8") as fh:
        json.dump(doc, fh)


# ---------------------------------------------------------------- interface
class TestInterface:
    def test_abstract_cannot_be_instantiated(self):
        with pytest.raises(TypeError):
            KeyProvider()

    @pytest.mark.parametrize("key_type", [KeyType.ECC_P256, KeyType.RSA_2048])
    def test_sign_verifies_with_public_key(self, key_type):
        p = InMemoryKeyProvider.generate(key_type)
        result = p.sign(CANONICAL)
        assert p.verify(CANONICAL, result.signature)
        assert not p.verify(CANONICAL + "x", result.signature)
        assert len(result.hash) == 32

    def test_raw_rs_encoding_honoured(self):
        p = InMemoryKeyProvider.generate(KeyType.ECC_P256)
        result = p.sign(CANONICAL, SignatureEncoding.RAW_RS)
        assert len(result.signature) == 64
        assert p.verify(CANONICAL, result.signature, SignatureEncoding.RAW_RS)

    def test_csr_matches_key_and_subject(self):
        p = InMemoryKeyProvider.generate(KeyType.ECC_P256)
        pem = p.build_csr_pem("SN0001", 42)
        from cryptography import x509
        csr = x509.load_pem_x509_csr(pem.encode("ascii"))
        assert csr.is_signature_valid
        assert csr.subject.rfc4514_string() == "CN=ZIMRA-SN0001-0000000042"
        assert public_keys_match(csr, p.public_key())

    def test_invalid_key_id_rejected(self):
        with pytest.raises(KeyProviderError):
            InMemoryKeyProvider(generate_private_key(KeyType.ECC_P256), "bad id!")

    def test_unsupported_curve_rejected(self):
        from fiscal_core.crypto import CryptoError
        with pytest.raises(CryptoError):
            InMemoryKeyProvider(ec.generate_private_key(ec.SECP384R1()), "k")


# ---------------------------------------------------- no private-key leakage
class TestNoPrivateKeyExposure:
    def test_public_api_never_returns_a_private_key(self, keyfile):
        p = _create(keyfile)
        for name in dir(p):
            if name.startswith("_"):
                continue
            attr = getattr(p, name)
            if callable(attr):
                continue
            assert not isinstance(attr, (ec.EllipticCurvePrivateKey, rsa.RSAPrivateKey))
        assert not hasattr(p, "private_key")
        assert "private_key" not in vars(p)

    def test_repr_has_no_key_material(self, keyfile):
        p = _create(keyfile)
        text = repr(p)
        assert "dev-321" in text
        assert "PRIVATE" not in text

    def test_cannot_be_pickled(self):
        p = InMemoryKeyProvider.generate(KeyType.ECC_P256)
        with pytest.raises(TypeError):
            pickle.dumps(p)


# --------------------------------------------------------- encrypted at rest
class TestEncryptedFile:
    @pytest.mark.parametrize("key_type", [KeyType.ECC_P256, KeyType.RSA_2048])
    def test_round_trip_signs_identically_verifiable(self, keyfile, key_type):
        created = _create(keyfile, key_type)
        reopened = _open(keyfile)
        assert reopened.key_id == "dev-321"
        assert reopened.key_type == key_type
        assert public_keys_match(created.public_key(), reopened.public_key())
        sig = reopened.sign(CANONICAL)
        assert created.verify(CANONICAL, sig.signature)

    def test_file_holds_no_plaintext_key(self, keyfile):
        key = generate_private_key(KeyType.ECC_P256)
        der = key.private_bytes(Encoding.DER, PrivateFormat.PKCS8, NoEncryption())
        EncryptedFileKeyProvider.create(keyfile, PW, private_key=key, key_id="k", **FAST)
        raw = open(keyfile, "rb").read()
        assert der not in raw
        assert base64.b64encode(der) not in raw
        assert b"PRIVATE KEY" not in raw
        # the raw private scalar must not appear either
        scalar = key.private_numbers().private_value.to_bytes(32, "big")
        assert scalar not in raw

    def test_wrong_passphrase(self, keyfile):
        _create(keyfile)
        with pytest.raises(KeyStoreAuthError):
            _open(keyfile, "a completely different phrase")

    def test_same_key_encrypts_differently_each_time(self, keyfile, tmp_path):
        key = generate_private_key(KeyType.ECC_P256)
        other = str(tmp_path / "other.fkey")
        EncryptedFileKeyProvider.create(keyfile, PW, private_key=key, key_id="k", **FAST)
        EncryptedFileKeyProvider.create(other, PW, private_key=key, key_id="k", **FAST)
        assert open(keyfile, "rb").read() != open(other, "rb").read()

    def test_tampered_ciphertext_detected(self, keyfile):
        _create(keyfile)

        def flip(doc):
            raw = bytearray(base64.b64decode(doc["ciphertext"]))
            raw[0] ^= 0x01
            doc["ciphertext"] = base64.b64encode(bytes(raw)).decode()

        _rewrite(keyfile, flip)
        with pytest.raises(KeyStoreAuthError):
            _open(keyfile)

    def test_tampered_key_id_detected(self, keyfile):
        _create(keyfile)
        _rewrite(keyfile, lambda d: d.__setitem__("key_id", "dev-999"))
        with pytest.raises(KeyStoreAuthError):
            _open(keyfile)

    def test_tampered_key_type_detected(self, keyfile):
        _create(keyfile)
        _rewrite(keyfile, lambda d: d.__setitem__("key_type", "RSA_2048"))
        with pytest.raises(KeyStoreAuthError):
            _open(keyfile)

    def test_tampered_kdf_cost_detected(self, keyfile):
        _create(keyfile)
        _rewrite(keyfile, lambda d: d["kdf"].__setitem__("n", 2 ** 11))
        with pytest.raises(KeyStoreAuthError):
            _open(keyfile)

    def test_kdf_cost_above_cap_rejected_before_deriving(self, keyfile):
        _create(keyfile)
        _rewrite(keyfile, lambda d: d["kdf"].__setitem__("n", 2 ** 30))
        with pytest.raises(KeyStoreCorruptError):
            _open(keyfile)

    def test_weak_kdf_rejected_without_opt_in(self, keyfile):
        _create(keyfile)
        with pytest.raises(KeyProviderError):
            EncryptedFileKeyProvider.open(keyfile, PW)  # allow_weak_kdf defaults to False

    def test_weak_kdf_rejected_on_create(self, keyfile):
        with pytest.raises(KeyProviderError):
            EncryptedFileKeyProvider.create(keyfile, PW, kdf_n=2 ** 10)
        assert not os.path.exists(keyfile)

    def test_production_default_kdf_round_trip(self, keyfile):
        EncryptedFileKeyProvider.create(keyfile, PW, key_id="prod")
        doc = json.load(open(keyfile, encoding="utf-8"))
        assert doc["kdf"]["n"] == kp.DEFAULT_SCRYPT_N >= kp.MIN_SCRYPT_N
        assert EncryptedFileKeyProvider.open(keyfile, PW).key_id == "prod"

    @pytest.mark.parametrize("content", [b"", b"not json", b"[]", b'{"format": "other"}'])
    def test_malformed_files_rejected(self, keyfile, content):
        with open(keyfile, "wb") as fh:
            fh.write(content)
        with pytest.raises(KeyStoreCorruptError):
            _open(keyfile)

    def test_unsupported_version_rejected(self, keyfile):
        _create(keyfile)
        _rewrite(keyfile, lambda d: d.__setitem__("version", 2))
        with pytest.raises(KeyStoreCorruptError):
            _open(keyfile)

    def test_bad_base64_rejected(self, keyfile):
        _create(keyfile)
        _rewrite(keyfile, lambda d: d.__setitem__("ciphertext", "!!!not base64!!!"))
        with pytest.raises(KeyStoreCorruptError):
            _open(keyfile)

    def test_missing_file(self, tmp_path):
        with pytest.raises(KeyProviderError):
            _open(str(tmp_path / "nope.fkey"))


# ------------------------------------------------------------ path and policy
class TestPolicy:
    def test_suffix_enforced(self, tmp_path):
        with pytest.raises(KeyProviderError):
            EncryptedFileKeyProvider.create(str(tmp_path / "device.pem"), PW, **FAST)
        with pytest.raises(KeyProviderError):
            EncryptedFileKeyProvider.open(str(tmp_path / "device.txt"), PW)

    def test_short_passphrase_rejected(self, keyfile):
        with pytest.raises(KeyProviderError):
            EncryptedFileKeyProvider.create(keyfile, "short", **FAST)
        assert not os.path.exists(keyfile)

    def test_non_str_passphrase_rejected(self, keyfile):
        with pytest.raises(KeyProviderError):
            EncryptedFileKeyProvider.create(keyfile, b"bytes passphrase!!", **FAST)

    def test_unicode_passphrase_normalised(self, keyfile):
        composed = "caf\u00e9 au lait s\u00e9curis\u00e9"       # precomposed
        decomposed = "cafe\u0301 au lait se\u0301curise\u0301"   # combining accents
        EncryptedFileKeyProvider.create(keyfile, composed, **FAST)
        assert EncryptedFileKeyProvider.open(keyfile, decomposed, allow_weak_kdf=True)

    def test_never_silently_overwrites_existing_key(self, keyfile):
        first = _create(keyfile)
        with pytest.raises(KeyProviderError):
            _create(keyfile)
        assert public_keys_match(_open(keyfile).public_key(), first.public_key())

    def test_overwrite_is_explicit(self, keyfile):
        first = _create(keyfile)
        second = _create(keyfile, overwrite=True)
        assert not public_keys_match(first.public_key(), second.public_key())
        assert public_keys_match(_open(keyfile).public_key(), second.public_key())

    def test_no_temp_files_left_behind(self, keyfile):
        _create(keyfile)
        leftovers = [n for n in os.listdir(os.path.dirname(keyfile)) if n.endswith(".tmp")]
        assert leftovers == []

    @pytest.mark.skipif(sys.platform.startswith("win"), reason="POSIX permissions only")
    def test_file_mode_is_owner_only(self, keyfile):
        _create(keyfile)
        assert stat.S_IMODE(os.stat(keyfile).st_mode) == 0o600

    def test_passphrase_from_env(self, monkeypatch):
        monkeypatch.setenv("TWELVEC_KEY_PASS", PW)
        assert passphrase_from_env("TWELVEC_KEY_PASS") == PW
        monkeypatch.delenv("TWELVEC_KEY_PASS")
        with pytest.raises(KeyProviderError):
            passphrase_from_env("TWELVEC_KEY_PASS")


# ------------------------------------------------------------ maintenance
class TestChangePassphrase:
    def test_rotate_passphrase(self, keyfile):
        p = _create(keyfile)
        p.change_passphrase(PW, "a brand new long passphrase", **FAST)
        with pytest.raises(KeyStoreAuthError):
            _open(keyfile, PW)
        again = _open(keyfile, "a brand new long passphrase")
        assert public_keys_match(again.public_key(), p.public_key())

    def test_wrong_old_passphrase_changes_nothing(self, keyfile):
        p = _create(keyfile)
        before = open(keyfile, "rb").read()
        with pytest.raises(KeyStoreAuthError):
            p.change_passphrase("not the old passphrase!", "a brand new long passphrase", **FAST)
        assert open(keyfile, "rb").read() == before
        assert _open(keyfile)


# ------------------------------------------------------------ KMS / HSM stubs
class TestStubs:
    @pytest.mark.parametrize("cls", [AzureKeyVaultKeyProvider, AwsKmsKeyProvider, Pkcs11KeyProvider])
    def test_stubs_refuse_to_construct(self, cls):
        with pytest.raises(NotImplementedError) as exc:
            cls()
        assert "NOT enterprise-grade" in str(exc.value)
