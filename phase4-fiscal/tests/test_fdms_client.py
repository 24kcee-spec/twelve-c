"""Tests for fdms_client.py against the local simulator (Phase 4 / P4).

These prove the client is internally consistent with the simulator and handles
the failure modes the spec describes. They do NOT prove agreement with ZIMRA's
real URL paths (see ENDPOINTS_VERIFIED) - that is P13.
"""

import base64
import ssl
from datetime import datetime
from decimal import Decimal

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from fiscal_core import fdms_client
from fiscal_core.crypto import KeyType, build_csr_pem, generate_private_key, load_certificate_pem, public_keys_match
from fiscal_core.fdms_client import (
    ENDPOINTS,
    ENDPOINTS_VERIFIED,
    DeviceOperatingMode,
    FdmsClient,
    FiscalDayStatus,
    make_mtls_context,
)
from fiscal_core.fdms_errors import (
    FdmsAuthError,
    FdmsBadRequestError,
    FdmsConfigError,
    FdmsHttpError,
    FdmsNotFoundError,
    FdmsProtocolError,
    FdmsRejectedError,
    FdmsServerError,
    FdmsTransportError,
    FdmsUnknownOutcomeError,
    UnauthorizedCause,
)
from fiscal_core.fdms_trust import verify_fdms_chain

from .conftest import ACTIVATION, DEVICE_ID, MODEL, SERIAL, open_day, sample_receipt


class FlakyTransport(httpx.BaseTransport):
    """Raises the given exceptions for the first N calls, then delegates."""

    def __init__(self, inner, errors):
        self.inner, self.errors, self.calls = inner, list(errors), 0

    def handle_request(self, request):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return self.inner.handle_request(request)


class RecordingTransport(httpx.BaseTransport):
    def __init__(self, inner):
        self.inner, self.requests = inner, []

    def handle_request(self, request):
        request.read()
        self.requests.append(request)
        return self.inner.handle_request(request)


# ---------------------------------------------------------------- construction
class TestConstruction:
    def test_http_url_rejected(self):
        with pytest.raises(FdmsConfigError, match="https"):
            FdmsClient(1, "Server", "v1", base_url="http://fdmsapitest.zimra.co.zw")

    def test_production_needs_explicit_opt_in(self):
        with pytest.raises(FdmsConfigError, match="allow_production"):
            FdmsClient(1, "Server", "v1", base_url=fdms_client.PRODUCTION_BASE_URL)
        FdmsClient(1, "Server", "v1", base_url=fdms_client.PRODUCTION_BASE_URL, allow_production=True).close()

    def test_model_headers_mandatory(self):
        with pytest.raises(FdmsConfigError):
            FdmsClient(1, "", "v1")
        with pytest.raises(FdmsConfigError):
            FdmsClient(1, "Server", "")

    def test_bad_device_id_and_attempts(self):
        with pytest.raises(FdmsConfigError):
            FdmsClient(True, "Server", "v1")
        with pytest.raises(FdmsConfigError):
            FdmsClient(1, "Server", "v1", max_attempts=0)

    def test_default_is_test_environment(self):
        c = FdmsClient(1, "Server", "v1")
        assert "fdmsapitest" in repr(c)
        c.close()

    def test_paths_flagged_unverified(self):
        assert ENDPOINTS_VERIFIED is False

    def test_public_and_device_endpoints_partitioned_per_spec_7_3(self):
        public = {n for n, e in ENDPOINTS.items() if e.public}
        assert public == {"verifyTaxpayerInformation", "registerDevice", "getServerCertificate"}

    def test_device_endpoint_without_identity_fails_before_network(self, sim, make_client):
        c = make_client(cert_pem=None)
        with pytest.raises(FdmsConfigError, match="mTLS"):
            c.get_config()
        assert sim.calls == []

    def test_public_endpoint_works_without_identity(self, sim, make_client):
        c = make_client(cert_pem=None)
        assert c.verify_taxpayer_information(ACTIVATION, SERIAL).tax_payer_tin == "1234567890"

    def test_repr_has_no_secrets(self, client):
        assert "cert" not in repr(client).lower() and "key" not in repr(client).lower()


# ------------------------------------------------------------------ headers
class TestModelHeaders:
    def test_headers_sent_on_every_call(self, sim):
        rec = RecordingTransport(sim.transport())
        c = FdmsClient(DEVICE_ID, *MODEL, transport=rec, client_cert_pem=None)
        c._has_identity = True
        c.ping()
        h = rec.requests[0].headers
        assert h["DeviceModelName"] == "Server" and h["DeviceModelVersionNo"] == "v1"
        c.close()

    def test_unregistered_model_is_dev06(self, sim):
        c = FdmsClient(DEVICE_ID, "Other", "v9", transport=sim.transport())
        c._has_identity = True
        with pytest.raises(FdmsRejectedError) as e:
            c.ping()
        assert e.value.error_code == "DEV06"
        c.close()

    def test_blacklisted_model_is_dev04(self, sim, client):
        sim.blacklisted_models.add(MODEL)
        with pytest.raises(FdmsRejectedError) as e:
            client.ping()
        assert e.value.error_code == "DEV04"


# --------------------------------------------------------- registration flow
class TestRegistration:
    def test_verify_taxpayer_ok_and_wrong_key(self, client):
        r = client.verify_taxpayer_information(ACTIVATION.lower(), SERIAL)   # key is case-insensitive
        assert r.vat_number == "123456789" and r.branch_name == "Main Branch"
        with pytest.raises(FdmsRejectedError) as e:
            client.verify_taxpayer_information("WRONGKEY", SERIAL)
        assert e.value.error_code == "DEV02"

    def test_register_device_issues_matching_certificate(self, registered):
        key, cert_pem = registered
        assert public_keys_match(key, load_certificate_pem(cert_pem))

    def test_register_wrong_activation_key(self, client):
        key = generate_private_key(KeyType.ECC_P256)
        with pytest.raises(FdmsRejectedError) as e:
            client.register_device("BADBAD00", build_csr_pem(key, SERIAL, DEVICE_ID))
        assert e.value.error_code == "DEV02"

    def test_register_wrong_common_name_is_dev03(self, client):
        key = generate_private_key(KeyType.ECC_P256)
        with pytest.raises(FdmsRejectedError) as e:
            client.register_device(ACTIVATION, build_csr_pem(key, SERIAL, 999))
        assert e.value.error_code == "DEV03"

    def test_register_garbage_csr_is_dev03(self, client):
        with pytest.raises(FdmsRejectedError) as e:
            client.register_device(ACTIVATION, "not a csr")
        assert e.value.error_code == "DEV03"

    def test_register_rsa_csr_accepted(self, client):
        key = generate_private_key(KeyType.RSA_2048)
        assert client.register_device(ACTIVATION, build_csr_pem(key, SERIAL, DEVICE_ID)).certificate_pem

    def test_issue_certificate_renews(self, client):
        key = generate_private_key(KeyType.ECC_P256)
        assert client.issue_certificate(build_csr_pem(key, SERIAL, DEVICE_ID)).certificate_pem.startswith("-----BEGIN")

    def test_server_certificate_chain_validates(self, client):
        r = client.get_server_certificate()
        v = verify_fdms_chain(list(r.certificates_pem))
        assert v.leaf.subject.rfc4514_string().endswith("Signing")


# ------------------------------------------------------------------- config
class TestConfigStatusPing:
    def test_get_config_typed(self, client):
        c = client.get_config()
        assert c.operating_mode is DeviceOperatingMode.ONLINE
        assert c.day_max_hrs == 24 and c.qr_url == "https://sim.invalid/qr"
        by_id = {t.tax_id: t for t in c.applicable_taxes}
        assert by_id[3].tax_percent == Decimal("15.50") and isinstance(by_id[3].tax_percent, Decimal)
        assert by_id[2].tax_percent == Decimal("0.00")
        assert by_id[1].tax_percent is None            # exempt: field omitted (spec 4.4)

    def test_offline_mode_parsed_and_blocks_online_calls(self, sim, client):
        sim.devices[DEVICE_ID].mode = 1
        assert client.get_config().operating_mode is DeviceOperatingMode.OFFLINE
        with pytest.raises(FdmsRejectedError) as e:
            client.get_status()
        assert e.value.error_code == "DEV01"

    def test_ping(self, client):
        assert client.ping().reporting_frequency_minutes == 5

    def test_unknown_device_is_dev01(self, sim, make_client):
        sim.devices[DEVICE_ID].active = False
        with pytest.raises(FdmsRejectedError) as e:
            make_client().get_config()
        assert e.value.error_code == "DEV01"


# ------------------------------------------------------------ fiscal-day flow
class TestDayAndReceipts:
    def test_status_before_first_day(self, client):
        s = client.get_status()
        assert s.fiscal_day_status is FiscalDayStatus.CLOSED
        assert s.last_fiscal_day_no is None and s.last_receipt_global_no is None

    def test_open_day_assigns_number_one(self, client):
        assert open_day(client).fiscal_day_no == 1
        assert client.get_status().fiscal_day_status is FiscalDayStatus.OPENED

    def test_second_open_is_fisc01(self, client):
        open_day(client)
        with pytest.raises(FdmsRejectedError) as e:
            open_day(client)
        assert e.value.error_code == "FISC01"

    def test_explicit_wrong_day_number_is_fisc01(self, client):
        with pytest.raises(FdmsRejectedError) as e:
            client.open_day(datetime(2026, 9, 30, 8), fiscal_day_no=5)
        assert e.value.error_code == "FISC01"

    def test_bad_day_number_rejected_locally(self, sim, client):
        with pytest.raises(ValueError):
            client.open_day(datetime(2026, 9, 30, 8), fiscal_day_no=0)
        assert sim.calls == []

    def test_receipt_before_open_is_rcpt01(self, client):
        with pytest.raises(FdmsRejectedError) as e:
            client.submit_receipt(sample_receipt())
        assert e.value.error_code == "RCPT01"

    def test_malformed_receipt_is_rcpt02(self, client):
        open_day(client)
        bad = sample_receipt()
        del bad["invoiceNo"]
        with pytest.raises(FdmsRejectedError) as e:
            client.submit_receipt(bad)
        assert e.value.error_code == "RCPT02"

    def test_submit_returns_verifiable_server_signature(self, sim, client):
        open_day(client)
        r = client.submit_receipt(sample_receipt())
        assert r.receipt_id == 1000
        sig = r.server_signature
        sim.signing_cert.public_key().verify(
            base64.b64decode(sig["signature"]), base64.b64decode(sig["hash"]), ec.ECDSA(hashes.SHA256()))
        assert sig["certificateThumbprint"] == sim.signing_cert.fingerprint(hashes.SHA1()).hex().upper()
        assert client.get_status().last_receipt_global_no == 1

    def test_duplicate_submit_returns_original_id_new_operation_id(self, sim, client):
        """Spec 4.7: same (deviceID, receiptGlobalNo, receiptHash) -> same receiptID/signature, new operationID."""
        open_day(client)
        a = client.submit_receipt(sample_receipt())
        b = client.submit_receipt(sample_receipt())
        assert a.receipt_id == b.receipt_id and a.server_signature == b.server_signature
        assert a.operation_id != b.operation_id
        assert len(sim.devices[DEVICE_ID].receipts) == 1

    def test_different_receipts_get_different_ids(self, client):
        open_day(client)
        a = client.submit_receipt(sample_receipt(1, 1))
        b = client.submit_receipt(sample_receipt(2, 2))
        assert b.receipt_id == a.receipt_id + 1

    def test_money_reaches_the_wire_exactly(self, sim):
        rec = RecordingTransport(sim.transport())
        c = FdmsClient(DEVICE_ID, *MODEL, transport=rec)
        c._has_identity = True
        open_day(c)
        r = sample_receipt()
        r["receiptTotal"] = Decimal("115.10")
        r["receiptPayments"] = [{"moneyTypeCode": "Cash", "paymentAmount": Decimal("115.10")}]
        c.submit_receipt(r)
        wire = rec.requests[-1].content.decode()
        assert '"receiptTotal":115.10' in wire and '"paymentAmount":115.10' in wire
        c.close()

    def test_float_in_receipt_refused_before_network(self, sim, client):
        open_day(client)
        n = len(sim.calls)
        r = sample_receipt()
        r["receiptTotal"] = 115.1
        with pytest.raises(TypeError, match="float"):
            client.submit_receipt(r)
        assert len(sim.calls) == n


class TestCloseDay:
    COUNTER = {"fiscalCounterType": "SaleByTax", "fiscalCounterCurrency": "USD",
               "fiscalCounterTaxID": 3, "fiscalCounterTaxPercent": Decimal("15.50"),
               "fiscalCounterValue": Decimal("115.00")}
    SIG = {"hash": base64.b64encode(b"h" * 32).decode(), "signature": base64.b64encode(b"s" * 64).decode()}

    def test_close_when_no_day_open_is_fisc04(self, client):
        with pytest.raises(FdmsRejectedError) as e:
            client.close_day(1, [], self.SIG, 0)
        assert e.value.error_code == "FISC04"

    def test_zero_counter_refused_locally(self, sim, client):
        open_day(client)
        n = len(sim.calls)
        with pytest.raises(ValueError, match="zero-value"):
            client.close_day(1, [dict(self.COUNTER, fiscalCounterValue=Decimal("0.00"))], self.SIG, 1)
        assert len(sim.calls) == n

    def test_async_close_success(self, sim, client):
        open_day(client)
        client.submit_receipt(sample_receipt())
        client.close_day(1, [self.COUNTER], self.SIG, 1)
        assert client.get_status().fiscal_day_status is FiscalDayStatus.CLOSE_INITIATED
        sim.finish_close()
        s = client.get_status()
        assert s.fiscal_day_status is FiscalDayStatus.CLOSED and s.fiscal_day_closed
        assert open_day(client).fiscal_day_no == 2       # next day follows last closed

    def test_close_while_in_progress_is_fisc03(self, client):
        open_day(client)
        client.close_day(1, [self.COUNTER], self.SIG, 1)
        with pytest.raises(FdmsRejectedError) as e:
            client.close_day(1, [self.COUNTER], self.SIG, 1)
        assert e.value.error_code == "FISC03"

    def test_receipt_rejected_while_close_in_progress(self, client):
        open_day(client)
        client.close_day(1, [self.COUNTER], self.SIG, 0)
        with pytest.raises(FdmsRejectedError) as e:
            client.submit_receipt(sample_receipt())
        assert e.value.error_code == "RCPT01"

    def test_close_failed_reports_error_and_still_accepts_receipts(self, sim, client):
        sim.close_outcome = "counters_mismatch"
        open_day(client)
        client.close_day(1, [self.COUNTER], self.SIG, 0)
        sim.finish_close()
        s = client.get_status()
        assert s.fiscal_day_status is FiscalDayStatus.CLOSE_FAILED and s.closing_error_code == 3
        assert client.submit_receipt(sample_receipt()).receipt_id      # spec 4.7: allowed in CloseFailed

    def test_wrong_day_number_is_fisc04(self, client):
        open_day(client)
        with pytest.raises(FdmsRejectedError) as e:
            client.close_day(7, [self.COUNTER], self.SIG, 0)
        assert e.value.error_code == "FISC04"


# ----------------------------------------------------------------- retry policy
class TestRetries:
    def test_500_then_success_on_idempotent_call(self, sim, client, sleeps):
        sim.inject_fault("getConfig", status=500, times=2)
        assert client.get_config().qr_url
        assert sleeps == [0.5, 1.0]                     # exponential backoff

    def test_502_exhausts_and_raises(self, sim, client, sleeps):
        sim.inject_fault("getConfig", status=502, times=5)
        with pytest.raises(FdmsServerError):
            client.get_config()
        assert [c for c in sim.calls if c[0] == "getConfig"].__len__() == 3
        assert len(sleeps) == 2

    def test_timeout_retried_for_idempotent_call(self, sim, client):
        sim.inject_fault("ping", drop_before=True, times=1)
        assert client.ping().reporting_frequency_minutes == 5

    def test_lost_reply_on_submit_receipt_is_safe_to_retry(self, sim, client):
        """The scariest case: FDMS processed the receipt, we saw a timeout. Retrying must
        not mint a second receipt (spec 4.7 idempotency)."""
        open_day(client)
        sim.inject_fault("submitReceipt", lost_reply=True, times=1)
        r = client.submit_receipt(sample_receipt())
        assert r.receipt_id == 1000
        assert len(sim.devices[DEVICE_ID].receipts) == 1

    def test_lost_reply_on_open_day_is_unknown_outcome_not_retried(self, sim, client):
        sim.inject_fault("openDay", lost_reply=True, times=1)
        with pytest.raises(FdmsUnknownOutcomeError):
            open_day(client)
        assert [c for c in sim.calls if c[0] == "openDay"].__len__() == 1
        # reconcile the way the exception tells us to:
        assert client.get_status().fiscal_day_status is FiscalDayStatus.OPENED

    def test_500_on_non_idempotent_call_is_unknown_outcome(self, sim, client, sleeps):
        sim.inject_fault("closeDay", status=500, times=1)
        open_day(client)
        with pytest.raises(FdmsUnknownOutcomeError):
            client.close_day(1, [], TestCloseDay.SIG, 0)
        assert sleeps == []

    def test_connect_failure_retried_even_for_non_idempotent_call(self, sim, sleeps):
        flaky = FlakyTransport(sim.transport(), [httpx.ConnectError("boom"), httpx.ConnectError("boom")])
        c = FdmsClient(DEVICE_ID, *MODEL, transport=flaky, sleep=sleeps.append)
        c._has_identity = True
        assert open_day(c).fiscal_day_no == 1            # request never left the machine -> safe
        assert flaky.calls == 3 and sleeps == [0.5, 1.0]
        c.close()

    def test_connect_failure_exhaustion_raises_transport_error(self, sim, sleeps):
        flaky = FlakyTransport(sim.transport(), [httpx.ConnectError("x")] * 5)
        c = FdmsClient(DEVICE_ID, *MODEL, transport=flaky, sleep=sleeps.append, max_attempts=2)
        c._has_identity = True
        with pytest.raises(FdmsTransportError) as e:
            c.ping()
        assert e.value.request_may_have_been_sent is False
        c.close()

    @pytest.mark.parametrize("status,exc", [
        (400, FdmsBadRequestError), (404, FdmsNotFoundError), (422, FdmsRejectedError), (401, FdmsAuthError)])
    def test_client_errors_are_never_retried(self, sim, client, sleeps, status, exc):
        sim.inject_fault("getConfig", status=status, error_code="X1", times=3)
        with pytest.raises(exc):
            client.get_config()
        assert [c for c in sim.calls if c[0] == "getConfig"].__len__() == 1 and sleeps == []

    def test_401_diagnosis_uses_only_local_facts(self, sim, sleeps):
        sim.add_device(DEVICE_ID, SERIAL, ACTIVATION)
        key = generate_private_key(KeyType.ECC_P256)
        bootstrap = FdmsClient(DEVICE_ID, *MODEL, transport=sim.transport())
        cert = bootstrap.register_device(ACTIVATION, build_csr_pem(key, SERIAL, DEVICE_ID)).certificate_pem
        bootstrap.close()
        c = FdmsClient(DEVICE_ID, *MODEL, transport=sim.transport(), client_cert_pem=cert, sleep=sleeps.append)
        sim.inject_fault("getConfig", status=401)
        with pytest.raises(FdmsAuthError):
            c.get_config()
        assert c.diagnose_401() is UnauthorizedCause.NOT_DETERMINABLE_LOCALLY
        c.close()


# ------------------------------------------------------ malformed 2xx replies
class TestProtocolErrors:
    def _serve(self, monkeypatch, sim, make_client, payload, status=200, ctype="application/json"):
        def handler(request):
            return httpx.Response(status, content=payload, headers={"content-type": ctype})
        return make_client(transport=httpx.MockTransport(handler))

    def test_non_json_2xx(self, sim, make_client, monkeypatch):
        with pytest.raises(FdmsProtocolError):
            self._serve(monkeypatch, sim, make_client, b"<html>hi</html>").ping()

    def test_missing_required_field(self, sim, make_client, monkeypatch):
        with pytest.raises(FdmsProtocolError, match="reportingFrequency"):
            self._serve(monkeypatch, sim, make_client, b'{"operationID":"x"}').ping()

    def test_wrong_type_field(self, sim, make_client, monkeypatch):
        with pytest.raises(FdmsProtocolError):
            self._serve(monkeypatch, sim, make_client, b'{"operationID":"x","reportingFrequency":"5"}').ping()

    def test_bool_is_not_an_int(self, sim, make_client, monkeypatch):
        with pytest.raises(FdmsProtocolError):
            self._serve(monkeypatch, sim, make_client, b'{"operationID":"x","reportingFrequency":true}').ping()

    def test_unknown_enum_value(self, sim, make_client, monkeypatch):
        with pytest.raises(FdmsProtocolError):
            self._serve(monkeypatch, sim, make_client, b'{"operationID":"x","fiscalDayStatus":"Sideways"}').get_status()

    def test_enums_accepted_as_numbers_or_names(self, sim, make_client, monkeypatch):
        for raw in (b'"FiscalDayOpened"', b'1', b'"Opened"'):
            body = b'{"operationID":"x","fiscalDayStatus":' + raw + b'}'
            assert self._serve(monkeypatch, sim, make_client, body).get_status().fiscal_day_status is FiscalDayStatus.OPENED

    def test_error_body_that_is_not_json_still_maps_to_status(self, sim, make_client, monkeypatch):
        with pytest.raises(FdmsNotFoundError):
            self._serve(monkeypatch, sim, make_client, b"nope", status=404, ctype="text/plain").ping()

    def test_redirects_are_not_followed(self, sim, make_client, monkeypatch):
        def handler(request):
            return httpx.Response(302, headers={"location": "https://evil.invalid/"})
        c = make_client(transport=httpx.MockTransport(handler))
        with pytest.raises(FdmsHttpError) as e:
            c.ping()
        assert e.value.http_status == 302 and "evil" not in str(e.value)


# ------------------------------------------------------------------ TLS helper
class TestMtlsContext:
    def test_context_requires_verification_and_loads_identity(self, sim, tmp_path):
        key = generate_private_key(KeyType.ECC_P256)
        c = FdmsClient(DEVICE_ID, *MODEL, transport=sim.transport())
        cert_pem = c.register_device(ACTIVATION, build_csr_pem(key, SERIAL, DEVICE_ID)).certificate_pem
        c.close()
        cert_f, key_f = tmp_path / "c.pem", tmp_path / "k.pem"
        cert_f.write_text(cert_pem)
        key_f.write_bytes(key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
            serialization.BestAvailableEncryption(b"pw")))
        ctx = make_mtls_context(str(cert_f), str(key_f), key_password="pw")
        assert isinstance(ctx, ssl.SSLContext)
        assert ctx.verify_mode == ssl.CERT_REQUIRED and ctx.check_hostname is True
        assert ctx.minimum_version >= ssl.TLSVersion.TLSv1_2

    def test_wrong_key_password_fails(self, sim, tmp_path):
        key = generate_private_key(KeyType.ECC_P256)
        c = FdmsClient(DEVICE_ID, *MODEL, transport=sim.transport())
        cert_pem = c.register_device(ACTIVATION, build_csr_pem(key, SERIAL, DEVICE_ID)).certificate_pem
        c.close()
        (tmp_path / "c.pem").write_text(cert_pem)
        (tmp_path / "k.pem").write_bytes(key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
            serialization.BestAvailableEncryption(b"pw")))
        with pytest.raises((ssl.SSLError, ValueError, TypeError)):
            make_mtls_context(str(tmp_path / "c.pem"), str(tmp_path / "k.pem"), key_password="nope")


# ------------------------------------------------------------- source hygiene
class TestSourceHygiene:
    def _sources(self):
        import pathlib
        base = pathlib.Path(fdms_client.__file__).parent
        return {p.name: p.read_text(encoding="utf-8") for p in
                [base / n for n in ("fdms_client.py", "fdms_errors.py", "fdms_json.py",
                                    "fdms_trust.py", "fdms_simulator.py")]}

    def test_tls_verification_is_never_disabled(self):
        for name, text in self._sources().items():
            assert "verify=False" not in text and "CERT_NONE" not in text, name

    def test_no_float_conversions_in_fdms_modules(self):
        for name, text in self._sources().items():
            assert "float(" not in text, name
