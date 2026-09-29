"""Tests for crypto.py (Phase 4 / P2, gate G1 part 1).

Oracles used, in order of strength:
  * spec 13.2.2 FDMS example and 13.2.1 CreditNote "Example No 2": the
    spec's printed hash reproduces exactly from our canonical string.
  * spec section 12 sample keys/CSRs/certificates: the ECC and RSA sample
    private keys really are the keys inside the sample CSRs and certificates.
  * round-trip sign/verify for both key types and both ECDSA encodings.

Known spec inconsistencies (finding F9) are pinned by their own tests so a
future spec revision that fixes them is noticed.
"""

import hashlib
import pathlib
from decimal import Decimal

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.x509.oid import NameOID, SignatureAlgorithmOID

from fiscal_core.canonicalise import (
    TaxLine,
    build_receipt_fdms_signing_string,
    build_receipt_signing_string,
)
from fiscal_core.crypto import (
    CryptoError,
    KeyType,
    SignatureEncoding,
    build_csr_pem,
    build_device_common_name,
    certificate_thumbprint_sha1,
    generate_private_key,
    key_type_of,
    load_certificate_pem,
    public_keys_match,
    sha256_b64,
    sha256_digest,
    sign_canonical_string,
    verify_canonical_string,
)

FIX = pathlib.Path(__file__).resolve().parent / "fixtures" / "spec_examples"
PREV = "hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k="


def _key(name):
    return serialization.load_pem_private_key((FIX / name).read_bytes(), password=None)


@pytest.fixture(scope="module")
def ecc_key():
    return _key("spec_sample_ecc_private_key.pem")


@pytest.fixture(scope="module")
def rsa_key():
    return _key("spec_sample_rsa_private_key.pem")


# ---------------------------------------------------------------- hashing
class TestHashVectors:
    FDMS_SIG = (
        "YyXTSizBBrMjMk4VQL+sCNr+2AC6aQbDAn9JMV2rk3yJ6MDZwie0wqQW3oisNWrMkeZsuAyFSnFkU2A+pKm9"
        "1sOHVdjeRBebjQgAQQIMTCVIcYrx+BizQ7Ib9iCdsVI+Jel2nThqQiQzfRef6EgtgsaIAN+PV55xSrHvPkIe+Bc="
    )

    def test_sha256_b64_matches_hashlib(self):
        assert sha256_digest("abc").hex() == hashlib.sha256(b"abc").hexdigest()
        assert sha256_b64("abc") == "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0="

    def test_receipt_fdms_hash_matches_spec_13_2_2(self):
        s = build_receipt_fdms_signing_string(self.FDMS_SIG, 48377, "2019-09-19T15:43:12")
        assert sha256_b64(s) == "JQoIo/AgOsvm+PUQpvlQ/U7YMei3m/jbygNrBVfz6Sg="

    def test_credit_note_example_2_hash_matches_spec_13_2_1(self):
        taxes = [
            TaxLine(1, "", None, Decimal("0"), Decimal("-7")),
            TaxLine(2, "", Decimal("0"), Decimal("0"), Decimal("-10")),
            TaxLine(3, "", Decimal("14.5"), Decimal("-3"), Decimal("-23")),
        ]
        s = build_receipt_signing_string(
            322, "CREDITNOTE", "USD", 85, "2020-09-19T09:23:07", Decimal("-40.35"), taxes, PREV
        )
        assert sha256_b64(s) == "F9/QB0vhxQlEF2nk+oebwP8V+qBcNlOFvoTeE/1QxPc="

    def test_spec_fiscal_invoice_example_1_only_matches_with_stray_space(self):
        """F9: spec 13.2.1 FiscalInvoice Example 1 prints its hash source with
        NO separator, but the printed hash only reproduces when a space sits
        between the tax segment and previousReceiptHash. Five of the seven
        printed example hashes do not reproduce at all from the printed
        strings (only CreditNote No 2 and the FDMS example are clean). We
        follow the written rule (no separator); the test env is the judge."""
        taxes = [
            TaxLine(1, "A", None, Decimal("0"), Decimal("2500")),
            TaxLine(2, "B", Decimal("0"), Decimal("0"), Decimal("3500")),
            TaxLine(3, "C", Decimal("15"), Decimal("150"), Decimal("1150")),
            TaxLine(3, "D", Decimal("15"), Decimal("300"), Decimal("2300")),
        ]
        s = build_receipt_signing_string(
            321, "FISCALINVOICE", "ZWL", 432, "2019-09-19T15:43:12", Decimal("9450.00"), taxes, PREV
        )
        expected = "zDxEalWUpwX2BcsYxRUAEfY/13OaCrTwDt01So3a6uU="
        assert sha256_b64(s) != expected
        head = s[: -len(PREV)]
        assert sha256_b64(head + " " + PREV) == expected


# ------------------------------------------------------------ sample keys
class TestSpecSampleKeys:
    def test_sample_keys_have_expected_types(self, ecc_key, rsa_key):
        assert key_type_of(ecc_key) == KeyType.ECC_P256
        assert key_type_of(rsa_key) == KeyType.RSA_2048

    def test_ecc_sample_private_scalar_matches_spec_text(self, ecc_key):
        # spec 12.1.1 prints priv: 15:e0:44:48:...:ac:1a
        d = ecc_key.private_numbers().private_value
        assert f"{d:064x}".startswith("15e044487c06fb178f41638dc676f444")
        assert f"{d:064x}".endswith("ac1a")

    @pytest.mark.parametrize("kind", ["ecc", "rsa"])
    def test_sample_csr_and_certificate_hold_the_sample_public_key(self, kind, ecc_key, rsa_key):
        key = ecc_key if kind == "ecc" else rsa_key
        csr = x509.load_pem_x509_csr((FIX / f"spec_sample_{kind}_csr.pem").read_bytes())
        cert = load_certificate_pem((FIX / f"spec_sample_{kind}_certificate.pem").read_bytes())
        assert csr.is_signature_valid
        assert public_keys_match(csr, key)
        assert public_keys_match(cert, key)

    def test_sample_csr_signature_algorithms_match_spec_4_2(self):
        ecc = x509.load_pem_x509_csr((FIX / "spec_sample_ecc_csr.pem").read_bytes())
        rsa_csr = x509.load_pem_x509_csr((FIX / "spec_sample_rsa_csr.pem").read_bytes())
        assert ecc.signature_algorithm_oid == SignatureAlgorithmOID.ECDSA_WITH_SHA256
        assert rsa_csr.signature_algorithm_oid == SignatureAlgorithmOID.RSA_WITH_SHA256

    def test_spec_sample_pems_carry_zrb_subject_not_zimra_F9(self):
        """F9: the spec text says the sample CN is ZIMRA-SN0001-0000000042,
        but the actual PEM blobs are a Zanzibar Revenue Board template
        (CN=ZRB-eVFD-0000000042). Use them for key vectors only."""
        csr = x509.load_pem_x509_csr((FIX / "spec_sample_ecc_csr.pem").read_bytes())
        assert csr.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value == "ZRB-eVFD-0000000042"

    def test_sample_certificate_thumbprints_are_sha1_of_der(self):
        for kind in ("ecc", "rsa"):
            cert = load_certificate_pem((FIX / f"spec_sample_{kind}_certificate.pem").read_bytes())
            tp = certificate_thumbprint_sha1(cert)
            assert len(tp) == 20
            assert tp == hashlib.sha1(cert.public_bytes(serialization.Encoding.DER)).digest()  # noqa: S324


# ------------------------------------------------------------- signatures
CANON = "321FISCALINVOICEZWL4322019-09-19T15:43:12945000A0250000B0.000350000" + PREV


class TestSigning:
    def test_ecc_der_roundtrip_and_hash(self, ecc_key):
        res = sign_canonical_string(ecc_key, CANON)
        assert res.hash == hashlib.sha256(CANON.encode()).digest()
        assert res.hash_b64 == sha256_b64(CANON)
        assert 68 <= len(res.signature) <= 72  # DER-encoded P-256 signature
        assert verify_canonical_string(ecc_key.public_key(), CANON, res.signature)

    def test_ecc_raw_rs_roundtrip_is_64_bytes(self, ecc_key):
        res = sign_canonical_string(ecc_key, CANON, SignatureEncoding.RAW_RS)
        assert len(res.signature) == 64
        assert verify_canonical_string(
            ecc_key.public_key(), CANON, res.signature, SignatureEncoding.RAW_RS
        )

    def test_ecc_encodings_are_not_interchangeable(self, ecc_key):
        der = sign_canonical_string(ecc_key, CANON, SignatureEncoding.DER).signature
        raw = sign_canonical_string(ecc_key, CANON, SignatureEncoding.RAW_RS).signature
        assert not verify_canonical_string(ecc_key.public_key(), CANON, der, SignatureEncoding.RAW_RS)
        assert not verify_canonical_string(ecc_key.public_key(), CANON, raw, SignatureEncoding.DER)

    def test_ecc_signatures_are_randomised_but_both_verify(self, ecc_key):
        a = sign_canonical_string(ecc_key, CANON).signature
        b = sign_canonical_string(ecc_key, CANON).signature
        assert a != b
        assert verify_canonical_string(ecc_key.public_key(), CANON, a)
        assert verify_canonical_string(ecc_key.public_key(), CANON, b)

    def test_rsa_signature_is_256_bytes_deterministic_and_verifies(self, rsa_key):
        a = sign_canonical_string(rsa_key, CANON)
        b = sign_canonical_string(rsa_key, CANON)
        assert len(a.signature) == 256  # spec 5.3: signature Binary (256)
        assert a.signature == b.signature  # PKCS#1 v1.5 is deterministic
        assert verify_canonical_string(rsa_key.public_key(), CANON, a.signature)

    def test_rsa_encoding_flag_is_ignored(self, rsa_key):
        a = sign_canonical_string(rsa_key, CANON, SignatureEncoding.RAW_RS)
        assert verify_canonical_string(rsa_key.public_key(), CANON, a.signature, SignatureEncoding.DER)

    @pytest.mark.parametrize("which", ["ecc", "rsa"])
    def test_tampered_string_or_signature_fails(self, which, ecc_key, rsa_key):
        key = ecc_key if which == "ecc" else rsa_key
        res = sign_canonical_string(key, CANON)
        assert not verify_canonical_string(key.public_key(), CANON + "x", res.signature)
        broken = bytearray(res.signature)
        broken[-1] ^= 0x01
        assert not verify_canonical_string(key.public_key(), CANON, bytes(broken))
        assert not verify_canonical_string(key.public_key(), CANON, b"")

    def test_wrong_key_fails(self, ecc_key):
        other = generate_private_key(KeyType.ECC_P256)
        res = sign_canonical_string(ecc_key, CANON)
        assert not verify_canonical_string(other.public_key(), CANON, res.signature)

    def test_verifies_against_public_key_from_spec_certificate(self, ecc_key, rsa_key):
        for kind, key in (("ecc", ecc_key), ("rsa", rsa_key)):
            cert = load_certificate_pem((FIX / f"spec_sample_{kind}_certificate.pem").read_bytes())
            res = sign_canonical_string(key, CANON)
            assert verify_canonical_string(cert.public_key(), CANON, res.signature)

    def test_signing_requires_str(self, ecc_key):
        with pytest.raises(CryptoError):
            sign_canonical_string(ecc_key, b"bytes")  # type: ignore[arg-type]


# --------------------------------------------------------------- keys / CSR
class TestKeysAndCsr:
    def test_generate_both_types(self):
        assert key_type_of(generate_private_key(KeyType.ECC_P256)) == KeyType.ECC_P256
        assert key_type_of(generate_private_key(KeyType.RSA_2048)) == KeyType.RSA_2048

    def test_unsupported_keys_rejected(self):
        with pytest.raises(CryptoError):
            key_type_of(ec.generate_private_key(ec.SECP384R1()))
        with pytest.raises(CryptoError):
            key_type_of(rsa.generate_private_key(public_exponent=65537, key_size=3072))

    def test_common_name_format(self):
        assert build_device_common_name("SN0001", 42) == "ZIMRA-SN0001-0000000042"
        assert build_device_common_name("SN: 001", 187) == "ZIMRA-SN: 001-0000000187"  # spec 4.2 example

    @pytest.mark.parametrize("serial,dev", [("", 1), ("  ", 1), ("S", -1), ("S", 10_000_000_000), ("S", True)])
    def test_common_name_rejects_bad_input(self, serial, dev):
        with pytest.raises(CryptoError):
            build_device_common_name(serial, dev)

    @pytest.mark.parametrize("which,oid", [
        ("ecc", SignatureAlgorithmOID.ECDSA_WITH_SHA256),
        ("rsa", SignatureAlgorithmOID.RSA_WITH_SHA256),
    ])
    def test_csr_for_spec_sample_keys(self, which, oid, ecc_key, rsa_key):
        key = ecc_key if which == "ecc" else rsa_key
        pem = build_csr_pem(key, "SN0001", 42)
        assert pem.startswith("-----BEGIN CERTIFICATE REQUEST-----")
        csr = x509.load_pem_x509_csr(pem.encode())
        assert csr.is_signature_valid
        assert csr.signature_algorithm_oid == oid
        assert public_keys_match(csr, key)
        # CN only by default (spec: other subject fields optional)
        assert [a.oid for a in csr.subject] == [NameOID.COMMON_NAME]
        assert csr.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value == "ZIMRA-SN0001-0000000042"

    def test_csr_optional_subject_values_are_exactly_the_allowed_ones(self, ecc_key):
        csr = x509.load_pem_x509_csr(build_csr_pem(ecc_key, "SN0001", 42, include_optional_subject=True).encode())
        got = {a.oid: a.value for a in csr.subject}
        assert got[NameOID.COUNTRY_NAME] == "ZW"
        assert got[NameOID.ORGANIZATION_NAME] == "Zimbabwe Revenue Authority"
        assert got[NameOID.STATE_OR_PROVINCE_NAME] == "Zimbabwe"
        assert got[NameOID.COMMON_NAME] == "ZIMRA-SN0001-0000000042"

    def test_csr_rejects_unsupported_key(self):
        with pytest.raises(CryptoError):
            build_csr_pem(ec.generate_private_key(ec.SECP384R1()), "SN1", 1)

    def test_public_keys_match_false_for_different_keys(self, ecc_key):
        assert not public_keys_match(ecc_key, generate_private_key(KeyType.ECC_P256))

    def test_load_certificate_rejects_garbage(self):
        with pytest.raises(CryptoError):
            load_certificate_pem("not a certificate")
