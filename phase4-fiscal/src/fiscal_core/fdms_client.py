"""
fdms_client.py - synchronous FDMS Fiscal Device Gateway client (Phase 4 / P4).

Spec: ZIMRA Fiscal Device Gateway API v7.2, sections 4 (endpoints), 7 (mTLS,
30 s timeout), 8 (errors).

WHAT IS AND IS NOT VERIFIED (read this before trusting the wire format)
  Verified from the spec text: endpoint names, request/response FIELDS,
  mandatory headers, HTTP status meanings, error codes, mTLS rules, timeout.
  NOT verified: the URL PATHS and HTTP VERBS, and whether deviceID travels in
  the path or the body. The v7.2 text names the endpoints but prints no paths
  (they live in ZIMRA's Swagger UI). ENDPOINTS below is a single table holding
  our best assumption, flagged ENDPOINTS_VERIFIED = False. It is corrected in
  ONE place once the Swagger is readable (P1-X / P13). The simulator uses the
  same table, so tests prove internal consistency, not agreement with ZIMRA.
  Also unverified: whether enums travel as names or numbers on the wire. The
  parsers accept both.

Behaviour
  * https only. Production host requires allow_production=True.
  * TLS server verification is always on; there is no switch to turn it off.
  * mTLS: pass an ssl.SSLContext with the device certificate loaded
    (make_mtls_context). Without one only the three public endpoints work.
    CUSTODY NOTE: the TLS stack must see the private key, so the P3 sign-only
    guarantee does NOT cover the transport key. Real HSM/KMS custody needs a
    TLS terminator or PKCS#11 engine (P17). Documented, not hidden.
  * Retries (max_attempts, exponential backoff, injectable sleep):
      - only for connect failures, timeouts, HTTP 500 and 502 (spec 8.1);
      - only for IDEMPOTENT endpoints (spec says a duplicate submitReceipt or
        submitFile returns the original result);
      - for openDay/closeDay/registerDevice/issueCertificate an ambiguous
        failure raises FdmsUnknownOutcomeError immediately - reconcile with
        getStatus, never blind-retry.
  * 401 is raised as FdmsAuthError; call diagnose_401() for what can be proved.
  * All money in and out is Decimal (see fdms_json).
"""

from __future__ import annotations

import logging
import ssl
import time
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence
from urllib.parse import urlsplit

import httpx

from . import fdms_json
from .fdms_errors import (
    FdmsAuthError,
    FdmsBadRequestError,
    FdmsConfigError,
    FdmsHttpError,
    FdmsMethodNotAllowedError,
    FdmsNotFoundError,
    FdmsProtocolError,
    FdmsRejectedError,
    FdmsServerError,
    FdmsTransportError,
    FdmsUnknownOutcomeError,
    ProblemDetails,
    UnauthorizedCause,
    diagnose_unauthorized,
)

log = logging.getLogger("fiscal_core.fdms")

TEST_BASE_URL = "https://fdmsapitest.zimra.co.zw"
PRODUCTION_BASE_URL = "https://fdmsapi.zimra.co.zw"
SYNC_TIMEOUT_SECONDS = 30          # spec 7.4 (int: fiscal path stays float-literal free)
ENDPOINTS_VERIFIED = False          # see module docstring


# --------------------------------------------------------------------------
# Endpoint table - the ONE place paths/verbs live
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Endpoint:
    name: str
    method: str
    path: str            # may contain {deviceID}
    public: bool         # True -> no client certificate needed (spec 7.3)
    idempotent: bool     # True -> safe to auto-retry (spec 4.7 / 4.9 or read-only)


ENDPOINTS: Dict[str, Endpoint] = {e.name: e for e in [
    Endpoint("verifyTaxpayerInformation", "POST", "/Public/v1/{deviceID}/VerifyTaxpayerInformation", True, True),
    Endpoint("registerDevice",            "POST", "/Public/v1/{deviceID}/RegisterDevice",            True, False),
    Endpoint("getServerCertificate",      "POST", "/Public/v1/GetServerCertificate",                 True, True),
    Endpoint("issueCertificate",          "POST", "/Device/v1/{deviceID}/IssueCertificate",          False, False),
    Endpoint("getConfig",                 "GET",  "/Device/v1/{deviceID}/GetConfig",                 False, True),
    Endpoint("getStatus",                 "GET",  "/Device/v1/{deviceID}/GetStatus",                 False, True),
    Endpoint("openDay",                   "POST", "/Device/v1/{deviceID}/OpenDay",                   False, False),
    Endpoint("submitReceipt",             "POST", "/Device/v1/{deviceID}/SubmitReceipt",             False, True),
    Endpoint("submitFile",                "POST", "/Device/v1/{deviceID}/SubmitFile",                False, True),
    Endpoint("getFileStatus",             "GET",  "/Device/v1/{deviceID}/GetFileStatus",             False, True),
    Endpoint("closeDay",                  "POST", "/Device/v1/{deviceID}/CloseDay",                  False, False),
    Endpoint("ping",                      "POST", "/Device/v1/{deviceID}/Ping",                      False, True),
]}


# --------------------------------------------------------------------------
# Enums (spec 5.4). Wire representation unverified -> parsers accept name or int.
# --------------------------------------------------------------------------
class DeviceOperatingMode(int, Enum):
    ONLINE = 0
    OFFLINE = 1


class FiscalDayStatus(int, Enum):
    CLOSED = 0
    OPENED = 1
    CLOSE_INITIATED = 2
    CLOSE_FAILED = 3


class FiscalDayReconciliationMode(int, Enum):
    AUTO = 0
    MANUAL = 1


def _enum(value: Any, cls: type, what: str) -> Any:
    """Accept 0/1/.. or 'Online' / 'FiscalDayOpened' / 'OPENED' style names."""
    if isinstance(value, bool):
        raise FdmsProtocolError(f"{what}: unexpected boolean")
    if isinstance(value, int):
        try:
            return cls(value)
        except ValueError:
            raise FdmsProtocolError(f"{what}: unknown value {value}") from None
    if isinstance(value, str):
        norm = value.strip().replace("_", "").lower()
        for prefix in ("fiscalday", ):
            if norm.startswith(prefix):
                norm = norm[len(prefix):]
        for member in cls:
            if member.name.replace("_", "").lower() == norm:
                return member
    raise FdmsProtocolError(f"{what}: unrecognised value {value!r}")


# --------------------------------------------------------------------------
# Typed responses
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Tax:
    tax_id: int
    tax_percent: Optional[Decimal]
    tax_name: str
    valid_from: str
    valid_till: Optional[str]


@dataclass(frozen=True)
class VerifyTaxpayerResponse:
    operation_id: str
    tax_payer_name: str
    tax_payer_tin: str
    vat_number: Optional[str]
    branch_name: str
    branch_address: Mapping[str, Any]
    branch_contacts: Optional[Mapping[str, Any]]


@dataclass(frozen=True)
class CertificateResponse:
    """registerDevice / issueCertificate."""
    operation_id: str
    certificate_pem: str


@dataclass(frozen=True)
class ConfigResponse:
    operation_id: str
    tax_payer_name: str
    tax_payer_tin: str
    vat_number: Optional[str]
    device_serial_no: str
    branch_name: str
    branch_address: Mapping[str, Any]
    branch_contacts: Optional[Mapping[str, Any]]
    operating_mode: DeviceOperatingMode
    day_max_hrs: int
    day_end_notification_hrs: int
    applicable_taxes: Sequence[Tax]
    certificate_valid_till: str
    qr_url: str


@dataclass(frozen=True)
class StatusResponse:
    operation_id: str
    fiscal_day_status: FiscalDayStatus
    reconciliation_mode: Optional[FiscalDayReconciliationMode]
    server_signature: Optional[Mapping[str, Any]]
    fiscal_day_closed: Optional[str]
    closing_error_code: Optional[int]
    counters: Optional[Sequence[Mapping[str, Any]]]
    document_quantities: Optional[Sequence[Mapping[str, Any]]]
    last_receipt_global_no: Optional[int]
    last_fiscal_day_no: Optional[int]


@dataclass(frozen=True)
class OpenDayResponse:
    operation_id: str
    fiscal_day_no: int


@dataclass(frozen=True)
class SubmitReceiptResponse:
    operation_id: str
    receipt_id: int
    server_date: str
    server_signature: Mapping[str, Any]      # SignatureDataEx: hash, signature, certificateThumbprint
    # NOT in the v7.2 text for 4.7 but commonly returned by FDMS; kept when present.
    validation_errors: Sequence[Mapping[str, Any]] = ()


@dataclass(frozen=True)
class CloseDayResponse:
    operation_id: str


@dataclass(frozen=True)
class PingResponse:
    operation_id: str
    reporting_frequency_minutes: int


@dataclass(frozen=True)
class ServerCertificateResponse:
    certificates_pem: Sequence[str]
    valid_till: str


@dataclass(frozen=True)
class SubmitFileResponse:
    operation_id: str


@dataclass(frozen=True)
class FileStatusResponse:
    operation_id: str
    files: Sequence[Mapping[str, Any]]


# --------------------------------------------------------------------------
# Field helpers
# --------------------------------------------------------------------------
def _obj(data: Any, what: str) -> Mapping[str, Any]:
    if not isinstance(data, Mapping):
        raise FdmsProtocolError(f"{what}: expected a JSON object")
    return data


def _req(d: Mapping[str, Any], key: str, typ: "type | tuple", what: str) -> Any:
    if key not in d or d[key] is None:
        raise FdmsProtocolError(f"{what}: missing required field {key!r}")
    v = d[key]
    if isinstance(v, bool) and bool not in (typ if isinstance(typ, tuple) else (typ,)):
        raise FdmsProtocolError(f"{what}: field {key!r} has wrong type")
    if not isinstance(v, typ):
        raise FdmsProtocolError(f"{what}: field {key!r} has wrong type")
    return v


def _opt(d: Mapping[str, Any], key: str, typ: "type | tuple", what: str) -> Any:
    if d.get(key) is None:
        return None
    return _req(d, key, typ, what)


# --------------------------------------------------------------------------
# TLS helper
# --------------------------------------------------------------------------
def make_mtls_context(
    cert_file: str,
    key_file: str,
    key_password: Optional[str] = None,
    ca_bundle: Optional[str] = None,
) -> ssl.SSLContext:
    """
    Build the client-side TLS context: device certificate + key for mTLS,
    server verification ON. `ca_bundle` optionally overrides the trust store
    (e.g. a pinned ZIMRA root). Files are read once here; delete them from
    disk afterwards if they were temporary.
    """
    ctx = ssl.create_default_context(cafile=ca_bundle) if ca_bundle else ssl.create_default_context()
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(certfile=cert_file, keyfile=key_file, password=key_password)
    return ctx


# --------------------------------------------------------------------------
# Client
# --------------------------------------------------------------------------
class FdmsClient:
    def __init__(
        self,
        device_id: int,
        model_name: str,
        model_version: str,
        base_url: str = TEST_BASE_URL,
        *,
        allow_production: bool = False,
        ssl_context: Optional[ssl.SSLContext] = None,
        client_cert_pem: Optional[str] = None,
        transport: Optional[httpx.BaseTransport] = None,
        max_attempts: int = 3,
        backoff_base_ms: int = 500,
        sleep: Callable[[float], None] = time.sleep,
        timeout_seconds: int = SYNC_TIMEOUT_SECONDS,
    ) -> None:
        if not isinstance(device_id, int) or isinstance(device_id, bool) or device_id < 0:
            raise FdmsConfigError("device_id must be a non-negative int")
        if not model_name or not model_version:
            raise FdmsConfigError("model_name and model_version are mandatory headers (spec section 4)")
        parts = urlsplit(base_url)
        if parts.scheme != "https" or not parts.hostname:
            raise FdmsConfigError("base_url must be an https:// URL")
        if parts.hostname == urlsplit(PRODUCTION_BASE_URL).hostname and not allow_production:
            raise FdmsConfigError("production FDMS requires allow_production=True (Phase 11 pilot only)")
        if max_attempts < 1:
            raise FdmsConfigError("max_attempts must be >= 1")

        self.device_id = device_id
        self._has_identity = ssl_context is not None or client_cert_pem is not None
        self._client_cert_pem = client_cert_pem
        self._max_attempts = max_attempts
        self._backoff_ms = backoff_base_ms
        self._sleep = sleep
        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(timeout_seconds),
            headers={
                "DeviceModelName": model_name,
                "DeviceModelVersionNo": model_version,
                "Accept": "application/json",
            },
            verify=ssl_context if ssl_context is not None else True,
            transport=transport,
            follow_redirects=False,
        )

    # -- lifecycle ----------------------------------------------------------
    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "FdmsClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def __repr__(self) -> str:                      # never print certs / keys
        return f"FdmsClient(device_id={self.device_id}, base_url={str(self._http.base_url)!r})"

    def diagnose_401(self, now: Optional[datetime] = None) -> UnauthorizedCause:
        return diagnose_unauthorized(self.device_id, self._client_cert_pem, now)

    # -- core request -------------------------------------------------------
    def _request(
        self,
        name: str,
        body: Optional[Mapping[str, Any]] = None,
        params: Optional[Mapping[str, str]] = None,
    ) -> Any:
        ep = ENDPOINTS[name]
        if not ep.public and not self._has_identity:
            raise FdmsConfigError(f"{name} needs the device certificate (mTLS); none configured")
        path = ep.path.format(deviceID=self.device_id)
        content = fdms_json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Content-Type": "application/json"} if content is not None else {}

        last_error: Optional[BaseException] = None
        for attempt in range(1, self._max_attempts + 1):
            try:
                resp = self._http.request(ep.method, path, content=content, headers=headers, params=params)
            except httpx.TransportError as exc:
                sent = not isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout))
                last_error = FdmsTransportError(name, exc, request_may_have_been_sent=sent)
                if sent and not ep.idempotent:
                    raise FdmsUnknownOutcomeError(name, last_error) from exc
            else:
                if resp.status_code in (500, 502):
                    last_error = self._http_error(name, resp)
                    if not ep.idempotent:
                        raise FdmsUnknownOutcomeError(name, last_error) from last_error
                elif 200 <= resp.status_code < 300:
                    log.debug("%s -> %s", name, resp.status_code)
                    try:
                        return fdms_json.loads(resp.content)
                    except fdms_json.FdmsJsonError as exc:
                        raise FdmsProtocolError(f"{name}: response is not valid JSON") from exc
                else:
                    raise self._http_error(name, resp)

            if attempt < self._max_attempts:
                # a delay in seconds, never money; integer ms in, seconds out
                self._sleep(self._backoff_ms * (2 ** (attempt - 1)) / 1000)
        assert last_error is not None
        raise last_error

    @staticmethod
    def _http_error(name: str, resp: httpx.Response) -> FdmsHttpError:
        try:
            problem = ProblemDetails.from_json(fdms_json.loads(resp.content), resp.status_code)
        except fdms_json.FdmsJsonError:
            problem = ProblemDetails(status=resp.status_code)
        cls = {
            400: FdmsBadRequestError,
            401: FdmsAuthError,
            404: FdmsNotFoundError,
            405: FdmsMethodNotAllowedError,
            422: FdmsRejectedError,
            500: FdmsServerError,
            502: FdmsServerError,
        }.get(resp.status_code, FdmsHttpError)
        return cls(resp.status_code, problem, name)

    # -- public endpoints ---------------------------------------------------
    def verify_taxpayer_information(self, activation_key: str, device_serial_no: str) -> VerifyTaxpayerResponse:
        d = _obj(self._request("verifyTaxpayerInformation", {
            "activationKey": activation_key, "deviceSerialNo": device_serial_no}), "verifyTaxpayerInformation")
        w = "verifyTaxpayerInformation"
        return VerifyTaxpayerResponse(
            operation_id=_req(d, "operationID", str, w),
            tax_payer_name=_req(d, "taxPayerName", str, w),
            tax_payer_tin=_req(d, "taxPayerTIN", str, w),
            vat_number=_opt(d, "vatNumber", str, w),
            branch_name=_req(d, "deviceBranchName", str, w),
            branch_address=_obj(d.get("deviceBranchAddress"), w + ".deviceBranchAddress"),
            branch_contacts=d.get("deviceBranchContacts"),
        )

    def register_device(self, activation_key: str, certificate_request_pem: str) -> CertificateResponse:
        d = _obj(self._request("registerDevice", {
            "activationKey": activation_key, "certificateRequest": certificate_request_pem}), "registerDevice")
        return CertificateResponse(_req(d, "operationID", str, "registerDevice"),
                                   _req(d, "certificate", str, "registerDevice"))

    def get_server_certificate(self, thumbprint_b64: Optional[str] = None) -> ServerCertificateResponse:
        d = _obj(self._request("getServerCertificate",
                               {"thumbprint": thumbprint_b64} if thumbprint_b64 else {}), "getServerCertificate")
        certs = _req(d, "certificate", list, "getServerCertificate")
        if not certs or not all(isinstance(c, str) for c in certs):
            raise FdmsProtocolError("getServerCertificate: certificate must be a non-empty array of strings")
        return ServerCertificateResponse(tuple(certs), _req(d, "certificateValidTill", str, "getServerCertificate"))

    # -- device endpoints ---------------------------------------------------
    def issue_certificate(self, certificate_request_pem: str) -> CertificateResponse:
        d = _obj(self._request("issueCertificate", {"certificateRequest": certificate_request_pem}), "issueCertificate")
        return CertificateResponse(_req(d, "operationID", str, "issueCertificate"),
                                   _req(d, "certificate", str, "issueCertificate"))

    def get_config(self) -> ConfigResponse:
        w = "getConfig"
        d = _obj(self._request("getConfig"), w)
        taxes = []
        for t in _req(d, "applicableTaxes", list, w):
            t = _obj(t, w + ".applicableTaxes")
            pct = t.get("taxPercent")
            if pct is not None and (isinstance(pct, bool) or not isinstance(pct, (Decimal, int))):
                raise FdmsProtocolError(f"{w}: taxPercent has wrong type")
            taxes.append(Tax(
                tax_id=_req(t, "taxID", int, w),
                tax_percent=None if pct is None else Decimal(pct),
                tax_name=_req(t, "taxName", str, w),
                valid_from=_req(t, "taxValidFrom", str, w),
                valid_till=_opt(t, "taxValidTill", str, w),
            ))
        return ConfigResponse(
            operation_id=_req(d, "operationID", str, w),
            tax_payer_name=_req(d, "taxPayerName", str, w),
            tax_payer_tin=_req(d, "taxPayerTIN", str, w),
            vat_number=_opt(d, "vatNumber", str, w),
            device_serial_no=_req(d, "deviceSerialNo", str, w),
            branch_name=_req(d, "deviceBranchName", str, w),
            branch_address=_obj(d.get("deviceBranchAddress"), w + ".deviceBranchAddress"),
            branch_contacts=d.get("deviceBranchContacts"),
            operating_mode=_enum(d.get("deviceOperatingMode"), DeviceOperatingMode, w + ".deviceOperatingMode"),
            day_max_hrs=_req(d, "taxPayerDayMaxHrs", int, w),
            day_end_notification_hrs=_req(d, "taxpayerDayEndNotificationHrs", int, w),
            applicable_taxes=tuple(taxes),
            certificate_valid_till=_req(d, "certificateValidTill", str, w),
            qr_url=_req(d, "qrUrl", str, w),
        )

    def get_status(self) -> StatusResponse:
        w = "getStatus"
        d = _obj(self._request("getStatus"), w)
        recon = d.get("fiscalDayReconciliationMode")
        return StatusResponse(
            operation_id=_req(d, "operationID", str, w),
            fiscal_day_status=_enum(d.get("fiscalDayStatus"), FiscalDayStatus, w + ".fiscalDayStatus"),
            reconciliation_mode=None if recon is None else _enum(recon, FiscalDayReconciliationMode, w),
            server_signature=d.get("fiscalDayServerSignature"),
            fiscal_day_closed=_opt(d, "fiscalDayClosed", str, w),
            closing_error_code=_opt(d, "fiscalDayClosingErrorCode", int, w),
            counters=d.get("fiscalDayCounters"),
            document_quantities=d.get("fiscalDayDocumentQuantities"),
            last_receipt_global_no=_opt(d, "lastReceiptGlobalNo", int, w),
            last_fiscal_day_no=_opt(d, "lastFiscalDayNo", int, w),
        )

    def open_day(self, fiscal_day_opened: datetime, fiscal_day_no: Optional[int] = None) -> OpenDayResponse:
        body: Dict[str, Any] = {"fiscalDayOpened": fiscal_day_opened}
        if fiscal_day_no is not None:
            if not isinstance(fiscal_day_no, int) or isinstance(fiscal_day_no, bool) or fiscal_day_no < 1:
                raise ValueError("fiscal_day_no must be an int >= 1")
            body["fiscalDayNo"] = fiscal_day_no
        d = _obj(self._request("openDay", body), "openDay")
        return OpenDayResponse(_req(d, "operationID", str, "openDay"), _req(d, "fiscalDayNo", int, "openDay"))

    def submit_receipt(self, receipt: Mapping[str, Any]) -> SubmitReceiptResponse:
        w = "submitReceipt"
        d = _obj(self._request("submitReceipt", {"receipt": receipt}), w)
        sig = _obj(d.get("receiptServerSignature"), w + ".receiptServerSignature")
        for k in ("hash", "signature"):
            _req(sig, k, str, w + ".receiptServerSignature")
        rid = _req(d, "receiptID", int, w)
        return SubmitReceiptResponse(
            operation_id=_req(d, "operationID", str, w),
            receipt_id=rid,
            server_date=_req(d, "serverDate", str, w),
            server_signature=sig,
            validation_errors=tuple(d.get("validationErrors") or ()),
        )

    def close_day(
        self,
        fiscal_day_no: int,
        counters: Sequence[Mapping[str, Any]],
        device_signature: Mapping[str, Any],
        receipt_counter: int,
    ) -> CloseDayResponse:
        for c in counters:
            v = c.get("fiscalCounterValue")
            if not isinstance(v, (Decimal, int)) or isinstance(v, bool):
                raise ValueError("fiscalCounterValue must be Decimal or int")
            if v == 0:
                raise ValueError("zero-value counters must not be submitted to FDMS (spec 4.11)")
        d = _obj(self._request("closeDay", {
            "fiscalDayNo": fiscal_day_no,
            "fiscalDayCounters": list(counters),
            "fiscalDayDeviceSignature": device_signature,
            "receiptCounter": receipt_counter,
        }), "closeDay")
        return CloseDayResponse(_req(d, "operationID", str, "closeDay"))

    def ping(self) -> PingResponse:
        d = _obj(self._request("ping"), "ping")
        return PingResponse(_req(d, "operationID", str, "ping"), _req(d, "reportingFrequency", int, "ping"))

    def submit_file(self, file_b64: str) -> SubmitFileResponse:
        d = _obj(self._request("submitFile", {"file": file_b64}), "submitFile")
        return SubmitFileResponse(_req(d, "operationID", str, "submitFile"))

    def get_file_status(
        self,
        uploaded_from: str,
        uploaded_till: str,
        operation_id: Optional[str] = None,
    ) -> FileStatusResponse:
        params = {"fileUploadedFrom": uploaded_from, "fileUploadedTill": uploaded_till}
        if operation_id:
            params["operationID"] = operation_id
        d = _obj(self._request("getFileStatus", params=params), "getFileStatus")
        return FileStatusResponse(_req(d, "operationID", str, "getFileStatus"), tuple(_req(d, "fileStatus", list, "getFileStatus")))
