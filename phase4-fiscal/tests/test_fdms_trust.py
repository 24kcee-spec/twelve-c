"""Tests for fdms_trust.py and the 401 diagnosis in fdms_errors.py (Phase 4 / P4)."""

from datetime import datetime, timedelta, timezone

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from fiscal_core.crypto import KeyType, build_csr_pem, generate_private_key
from fiscal_core.fdms_errors import UnauthorizedCause, diagnose_unauthorized
from fiscal_core.fdms_simulator import FdmsSimulator
from fiscal_core.fdms_trust import ChainError, verify_fdms_chain

from .conftest import ACTIVATION, DEVICE_ID, SERIAL


def pem(cert):
    return cert.public_bytes(serialization.Encoding.PEM).decode()


@pytest.fixture
def s():
    return FdmsSimulator()


def _cert(subject_cn, issuer_cn, pub, signer, nb=None, na=None):
    nb = nb or datetime.now(timezone.utc) - timedelta(days=1)
    na = na or datetime.now(timezone.utc) + timedelta(days=30)
    n = lambda cn: x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    return (x509.CertificateBuilder().subject_name(n(subject_cn)).issuer_name(n(issuer_cn))
            .public_key(pub).serial_number(x509.random_serial_number())
            .not_valid_before(nb).not_valid_after(na).sign(signer, hashes.SHA256()))


class TestChain:
    def test_valid_chain_leaf_first(self, s):
        v = verify_fdms_chain([pem(s.signing_cert), pem(s.root_cert)])
        assert v.leaf == s.signing_cert and v.root == s.root_cert and not v.anchored
        assert v.chain == [s.signing_cert, s.root_cert]

    def test_order_does_not_matter(self, s):
        v = verify_fdms_chain([pem(s.root_cert), pem(s.signing_cert)])
        assert v.leaf == s.signing_cert

    def test_pinned_root_match_is_anchored(self, s):
        v = verify_fdms_chain([pem(s.signing_cert), pem(s.root_cert)], pinned_root_pem=pem(s.root_cert))
        assert v.anchored is True

    def test_pinned_root_mismatch_rejected(self, s):
        other = FdmsSimulator()
        with pytest.raises(ChainError, match="pinned"):
            verify_fdms_chain([pem(s.signing_cert), pem(s.root_cert)], pinned_root_pem=pem(other.root_cert))

    def test_missing_issuer_rejected(self, s):
        with pytest.raises(ChainError, match="incomplete"):
            verify_fdms_chain([pem(s.signing_cert)])

    def test_forged_link_rejected(self, s):
        # claims to be issued by the real root's NAME but signed by an attacker key
        attacker = ec.generate_private_key(ec.SECP256R1())
        forged = _cert("Twelve C Simulated FDMS Signing", "Twelve C Simulated FDMS Root",
                       attacker.public_key(), attacker)
        with pytest.raises(ChainError, match="signature link"):
            verify_fdms_chain([pem(forged), pem(s.root_cert)])

    def test_expired_certificate_rejected(self, s):
        with pytest.raises(ChainError, match="validity"):
            verify_fdms_chain([pem(s.signing_cert), pem(s.root_cert)],
                              now=datetime.now(timezone.utc) + timedelta(days=4000))

    def test_unrelated_certificate_rejected(self, s):
        stray = FdmsSimulator()
        with pytest.raises(ChainError):
            verify_fdms_chain([pem(s.signing_cert), pem(s.root_cert), pem(stray.root_cert)])

    def test_duplicate_rejected(self, s):
        with pytest.raises(ChainError, match="duplicate"):
            verify_fdms_chain([pem(s.root_cert), pem(s.root_cert)])

    def test_garbage_and_empty_rejected(self):
        with pytest.raises(ChainError):
            verify_fdms_chain(["not a certificate"])
        with pytest.raises(ChainError):
            verify_fdms_chain([])

    def test_self_signed_alone_is_a_root(self, s):
        v = verify_fdms_chain([pem(s.root_cert)])
        assert v.leaf == v.root


class TestDiagnose401:
    def _device_cert(self, s, device_id=DEVICE_ID):
        s.add_device(device_id, SERIAL, ACTIVATION)
        key = generate_private_key(KeyType.ECC_P256)
        csr = build_csr_pem(key, SERIAL, device_id)
        body = {"certificateRequest": csr, "activationKey": ACTIVATION}
        return s._register(s.devices[device_id], body)

    def _pem_of(self, s, device_id=DEVICE_ID):
        from fiscal_core import fdms_json
        return fdms_json.loads(self._device_cert(s, device_id).content)["certificate"]

    def test_no_cert(self):
        assert diagnose_unauthorized(DEVICE_ID, None) is UnauthorizedCause.NO_LOCAL_CERT_TO_CHECK

    def test_valid_cert_cannot_be_narrowed(self, s):
        assert diagnose_unauthorized(DEVICE_ID, self._pem_of(s)) is UnauthorizedCause.NOT_DETERMINABLE_LOCALLY

    def test_expired_locally(self, s):
        later = datetime.now(timezone.utc) + timedelta(days=400)
        assert diagnose_unauthorized(DEVICE_ID, self._pem_of(s), now=later) is UnauthorizedCause.CERT_EXPIRED_LOCALLY

    def test_cert_for_other_device(self, s):
        assert diagnose_unauthorized(999, self._pem_of(s)) is UnauthorizedCause.CERT_NOT_FOR_THIS_DEVICE
