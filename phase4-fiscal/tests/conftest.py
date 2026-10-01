"""Shared fixtures for the FDMS client tests (Phase 4 / P4). No network, no files
outside pytest's tmp_path."""

import base64
import hashlib
from datetime import datetime

import pytest

from fiscal_core.crypto import KeyType, build_csr_pem, generate_private_key
from fiscal_core.fdms_client import FdmsClient
from fiscal_core.fdms_simulator import FdmsSimulator

DEVICE_ID = 187
SERIAL = "SN-001"
ACTIVATION = "AB12CD34"
MODEL = ("Server", "v1")


@pytest.fixture
def sim():
    s = FdmsSimulator()
    s.add_device(DEVICE_ID, SERIAL, ACTIVATION)
    return s


@pytest.fixture
def sleeps():
    return []


@pytest.fixture
def make_client(sim, sleeps):
    """Factory: client wired to the simulator, with a fake sleep that records
    backoff delays instead of waiting."""
    made = []

    def _make(transport=None, cert_pem="present", **kw):
        c = FdmsClient(
            DEVICE_ID, MODEL[0], MODEL[1],
            transport=transport or sim.transport(),
            client_cert_pem=cert_pem if cert_pem != "present" else None,
            sleep=sleeps.append,
            **kw,
        )
        # tests that only need "an identity exists" without a real cert
        if cert_pem == "present":
            c._has_identity = True
        made.append(c)
        return c

    yield _make
    for c in made:
        c.close()


@pytest.fixture
def client(make_client):
    return make_client()


@pytest.fixture
def registered(sim, client):
    """(private_key, cert_pem) for a device registered through the client."""
    key = generate_private_key(KeyType.ECC_P256)
    csr = build_csr_pem(key, SERIAL, DEVICE_ID)
    resp = client.register_device(ACTIVATION, csr)
    return key, resp.certificate_pem


def sample_receipt(global_no=1, counter=1, tag="a"):
    digest = hashlib.sha256(f"{tag}-{global_no}".encode()).digest()
    return {
        "receiptType": "FiscalInvoice",
        "receiptCurrency": "USD",
        "receiptCounter": counter,
        "receiptGlobalNo": global_no,
        "invoiceNo": f"INV-{global_no:04d}",
        "receiptDate": "2026-09-30T10:00:00",
        "receiptLinesTaxInclusive": True,
        "receiptLines": [],
        "receiptTaxes": [],
        "receiptPayments": [],
        "receiptTotal": 0,
        "receiptDeviceSignature": {
            "hash": base64.b64encode(digest).decode(),
            "signature": base64.b64encode(b"x" * 64).decode(),
        },
    }


def open_day(client, when=None):
    return client.open_day(when or datetime(2026, 9, 30, 8, 0, 0))
