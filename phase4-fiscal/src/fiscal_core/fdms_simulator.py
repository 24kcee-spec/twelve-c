"""
fdms_simulator.py - a LOCAL, in-process stand-in for FDMS (Phase 4 / P4).

It is NOT ZIMRA. It exists so P5-P10 can be built and tested without test
environment access (P1-X). It implements the v7.2 behaviours we can read in the
spec text and nothing more:

  * registerDevice: parses the CSR, enforces CN ZIMRA-<serial>-<10 digit id>,
    DEV02 wrong activation key, DEV03 bad CSR, issues a certificate from a
    simulated two-level CA (root -> signing cert).
  * getServerCertificate: returns that chain (order deliberately shuffled-safe).
  * getConfig / getStatus / ping / verifyTaxpayerInformation.
  * openDay: FISC01 rules, fiscalDayNo rules (1 first, then last closed + 1).
  * submitReceipt: RCPT01 (day not open/closing), RCPT02 (structure), and the
    spec's idempotency rule - same (deviceID, receiptGlobalNo, receiptHash)
    returns the SAME receiptID and signature with a DIFFERENT operationID.
    Business validation (RCPT010-RCPT048 colours) is NOT here; that is P7.
  * closeDay: FISC04 (not open), FISC03 (already closing); asynchronous -
    status stays CloseInitiated until finish_close() is called, then Closed or
    CloseFailed (CountersMismatch) per `close_outcome`.
  * DEV01 (blocked/inactive), DEV04 (blacklisted model), DEV06 (model not registered).
  * Fault injection (inject_fault) including the nasty one: `lost_reply`,
    where FDMS PROCESSES the request but the client sees a read timeout.

Limits, on purpose
  * No real TLS, so no real 401. Use inject_fault(status=401) to exercise the
    client's 401 path. Paths/verbs come from fdms_client.ENDPOINTS, so passing
    these tests proves internal consistency, NOT agreement with ZIMRA (P13).
  * The signatures are real ECDSA over the receipt hash, so signature plumbing
    is exercised, but the signed string is NOT the spec's canonical string.
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from . import fdms_json
from .fdms_client import ENDPOINTS, FiscalDayStatus

_CN_RE = re.compile(r"^ZIMRA-(.+)-(\d{10})$")
_REQUIRED_RECEIPT_FIELDS = (
    "receiptType", "receiptCurrency", "receiptCounter", "receiptGlobalNo",
    "invoiceNo", "receiptDate", "receiptLines", "receiptTaxes",
    "receiptPayments", "receiptTotal", "receiptDeviceSignature",
)


@dataclass
class _Device:
    device_id: int
    serial_no: str
    activation_key: str
    active: bool = True
    mode: int = 0                       # 0 Online, 1 Offline
    cert_thumb_sha1: Optional[bytes] = None
    day_status: FiscalDayStatus = FiscalDayStatus.CLOSED
    day_no: int = 0                     # current or last day number
    last_closed_no: int = 0
    day_opened: Optional[str] = None
    closing_error: Optional[int] = None
    last_receipt_global_no: Optional[int] = None
    last_receipt_counter: int = 0
    receipts: Dict[Tuple[int, str], dict] = field(default_factory=dict)   # (globalNo, hash) -> stored
    next_receipt_id: int = 1000
    close_payload: Optional[dict] = None


@dataclass
class _Fault:
    status: Optional[int] = None        # reply with this HTTP status instead
    error_code: Optional[str] = None
    lost_reply: bool = False            # process, then time out
    drop_before: bool = False           # do not process, then time out
    remaining: int = 1


class FdmsSimulator:
    def __init__(self, now: Optional[Callable[[], datetime]] = None) -> None:
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._op = 0
        self.devices: Dict[int, _Device] = {}
        self.registered_models = {("Server", "v1")}
        self.blacklisted_models: set = set()
        self.close_outcome = "success"       # or "counters_mismatch"
        self.taxpayer = {
            "taxPayerName": "Simulated Trading (Pvt) Ltd",
            "taxPayerTIN": "1234567890",
            "vatNumber": "123456789",
            "deviceBranchName": "Main Branch",
            "deviceBranchAddress": {"province": "Bulawayo", "city": "Bulawayo",
                                    "street": "Test Street", "houseNo": "1"},
            "deviceBranchContacts": {"email": "sim@example.invalid"},
        }
        self.taxes = [
            {"taxID": 1, "taxName": "Exempt", "taxValidFrom": "2020-01-01"},
            {"taxID": 2, "taxPercent": Decimal("0.00"), "taxName": "Zero rated 0%", "taxValidFrom": "2020-01-01"},
            {"taxID": 3, "taxPercent": Decimal("15.50"), "taxName": "Standard rated 15.5%", "taxValidFrom": "2020-01-01"},
        ]
        self.qr_url = "https://sim.invalid/qr"
        self.calls: List[Tuple[str, int]] = []       # (endpoint name, http status) log
        self._faults: Dict[str, List[_Fault]] = {}

        # simulated CA: root -> signing certificate
        self._root_key = ec.generate_private_key(ec.SECP256R1())
        self._sign_key = ec.generate_private_key(ec.SECP256R1())
        self._ca_key = ec.generate_private_key(ec.SECP256R1())
        t0 = self._now() - timedelta(days=1)
        t1 = self._now() + timedelta(days=3650)
        self.root_cert = self._mk_cert("Twelve C Simulated FDMS Root", self._root_key.public_key(),
                                       "Twelve C Simulated FDMS Root", self._root_key, t0, t1, ca=True)
        self.signing_cert = self._mk_cert("Twelve C Simulated FDMS Signing", self._sign_key.public_key(),
                                          "Twelve C Simulated FDMS Root", self._root_key, t0, t1, ca=False)
        self.device_ca_cert = self._mk_cert("Twelve C Simulated FDMS Device CA", self._ca_key.public_key(),
                                            "Twelve C Simulated FDMS Root", self._root_key, t0, t1, ca=True)

    # ------------------------------------------------------------------ setup
    @staticmethod
    def _name(cn: str) -> x509.Name:
        return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])

    def _mk_cert(self, subject_cn, pub, issuer_cn, issuer_key, nb, na, ca: bool) -> x509.Certificate:
        return (x509.CertificateBuilder()
                .subject_name(self._name(subject_cn)).issuer_name(self._name(issuer_cn))
                .public_key(pub).serial_number(x509.random_serial_number())
                .not_valid_before(nb).not_valid_after(na)
                .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
                .sign(issuer_key, hashes.SHA256()))

    def add_device(self, device_id: int, serial_no: str, activation_key: str, **kw: Any) -> _Device:
        d = _Device(device_id, serial_no, activation_key.upper(), **kw)
        self.devices[device_id] = d
        return d

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def inject_fault(self, endpoint: str, *, status: Optional[int] = None, error_code: Optional[str] = None,
                     lost_reply: bool = False, drop_before: bool = False, times: int = 1) -> None:
        self._faults.setdefault(endpoint, []).append(
            _Fault(status, error_code, lost_reply, drop_before, times))

    def finish_close(self) -> None:
        """Complete every pending asynchronous closeDay (what FDMS does after the 202-ish reply)."""
        for d in self.devices.values():
            if d.day_status is FiscalDayStatus.CLOSE_INITIATED:
                if self.close_outcome == "success":
                    d.day_status = FiscalDayStatus.CLOSED
                    d.last_closed_no = d.day_no
                    d.closing_error = None
                else:
                    d.day_status = FiscalDayStatus.CLOSE_FAILED
                    d.closing_error = 3          # CountersMismatch (spec 5.4.9)

    # --------------------------------------------------------------- plumbing
    def _opid(self) -> str:
        self._op += 1
        return f"SIM-OP-{self._op:08d}"

    @staticmethod
    def _err(status: int, code: Optional[str], title: str) -> httpx.Response:
        body: Dict[str, Any] = {"type": "about:blank", "title": title, "status": status}
        if code:
            body["errorCode"] = code
        return httpx.Response(status, content=fdms_json.dumps(body).encode(),
                              headers={"content-type": "application/problem+json"})

    @staticmethod
    def _ok(payload: Dict[str, Any]) -> httpx.Response:
        return httpx.Response(200, content=fdms_json.dumps(payload).encode(),
                              headers={"content-type": "application/json"})

    def _match(self, request: httpx.Request) -> Tuple[Optional[str], Optional[int]]:
        for name, ep in ENDPOINTS.items():
            pattern = "^" + re.escape(ep.path).replace(re.escape("{deviceID}"), r"(\d+)") + "$"
            m = re.match(pattern, request.url.path)
            if m and request.method == ep.method:
                return name, int(m.group(1)) if m.groups() else None
        return None, None

    def _sign(self, data_b64_hash: str) -> Dict[str, Any]:
        raw = base64.b64decode(data_b64_hash)
        sig = self._sign_key.sign(raw, ec.ECDSA(hashes.SHA256()))
        thumb = self.signing_cert.fingerprint(hashes.SHA1())
        return {"hash": data_b64_hash, "signature": base64.b64encode(sig).decode(),
                "certificateThumbprint": thumb.hex().upper()}

    # ---------------------------------------------------------------- handler
    def handle(self, request: httpx.Request) -> httpx.Response:
        name, device_id = self._match(request)
        if name is None:
            self.calls.append(("?", 404))
            return self._err(404, None, "Resource not found")

        fault = self._take_fault(name)
        if fault and fault.drop_before:
            self.calls.append((name, -1))
            raise httpx.ReadTimeout("simulated: request lost before processing", request=request)
        if fault and fault.status is not None and not fault.lost_reply:
            self.calls.append((name, fault.status))
            return self._err(fault.status, fault.error_code, "Simulated fault")

        resp = self._dispatch(name, device_id, request)
        self.calls.append((name, resp.status_code))
        if fault and fault.lost_reply:
            raise httpx.ReadTimeout("simulated: reply lost after processing", request=request)
        return resp

    def _take_fault(self, name: str) -> Optional[_Fault]:
        queue = self._faults.get(name)
        if not queue:
            return None
        f = queue[0]
        f.remaining -= 1
        if f.remaining <= 0:
            queue.pop(0)
        return f

    def _dispatch(self, name: str, device_id: Optional[int], request: httpx.Request) -> httpx.Response:
        model = (request.headers.get("DeviceModelName"), request.headers.get("DeviceModelVersionNo"))
        if not all(model):
            return self._err(400, None, "DeviceModelName and DeviceModelVersionNo headers are mandatory")
        if model in self.blacklisted_models:
            return self._err(422, "DEV04", "Device model is blacklisted")
        if model not in self.registered_models:
            return self._err(422, "DEV06", "Device model and version is not registered")

        try:
            body = fdms_json.loads(request.content) if request.content else {}
        except fdms_json.FdmsJsonError:
            return self._err(400, None, "Malformed JSON")
        if not isinstance(body, dict):
            return self._err(400, None, "Body must be a JSON object")

        if name == "getServerCertificate":
            certs = [self.signing_cert, self.root_cert]   # leaf first; client must not rely on order
            return self._ok({
                "certificate": [c.public_bytes(serialization.Encoding.PEM).decode() for c in certs],
                "certificateValidTill": self.signing_cert.not_valid_after_utc.strftime("%Y-%m-%dT%H:%M:%S"),
            })

        dev = self.devices.get(device_id) if device_id is not None else None
        if dev is None or not dev.active:
            return self._err(422, "DEV01", "Device not found or not active")

        if name == "verifyTaxpayerInformation":
            if str(body.get("activationKey", "")).upper() != dev.activation_key or \
               str(body.get("deviceSerialNo")) != dev.serial_no:
                return self._err(422, "DEV02", "Activation key is incorrect")
            return self._ok({"operationID": self._opid(), **{k: v for k, v in self.taxpayer.items()
                                                             if k != "deviceBranchContacts"},
                             "deviceBranchContacts": self.taxpayer["deviceBranchContacts"]})
        if name == "registerDevice":
            return self._register(dev, body)

        # ---- everything below needs an issued device certificate in real life
        if name == "issueCertificate":
            return self._register(dev, body, renew=True)
        if name == "getConfig":
            return self._ok({
                "operationID": self._opid(), **self.taxpayer, "deviceSerialNo": dev.serial_no,
                "deviceOperatingMode": "Offline" if dev.mode == 1 else "Online",
                "taxPayerDayMaxHrs": 24, "taxpayerDayEndNotificationHrs": 2,
                "applicableTaxes": self.taxes,
                "certificateValidTill": (self._now() + timedelta(days=365)).strftime("%Y-%m-%d"),
                "qrUrl": self.qr_url,
            })
        if dev.mode == 1 and name in {"getStatus", "openDay", "submitReceipt", "closeDay"}:
            return self._err(422, "DEV01", "Not allowed in Offline mode")
        if name == "ping":
            return self._ok({"operationID": self._opid(), "reportingFrequency": 5})
        if name == "getStatus":
            return self._status(dev)
        if name == "openDay":
            return self._open_day(dev, body)
        if name == "submitReceipt":
            return self._submit_receipt(dev, body)
        if name == "closeDay":
            return self._close_day(dev, body)
        return self._err(422, "FILE03", f"{name} is not implemented by the simulator")

    # ------------------------------------------------------------- handlers
    def _register(self, dev: _Device, body: dict, renew: bool = False) -> httpx.Response:
        if not renew and str(body.get("activationKey", "")).upper() != dev.activation_key:
            return self._err(422, "DEV02", "Activation key is incorrect")
        pem = body.get("certificateRequest")
        try:
            csr = x509.load_pem_x509_csr(pem.encode("ascii"))
            if not csr.is_signature_valid:
                raise ValueError("bad CSR signature")
            cn = csr.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value
            m = _CN_RE.match(cn)
            if not m or m.group(1) != dev.serial_no or int(m.group(2)) != dev.device_id:
                raise ValueError("CN does not match the assigned device name")
            for attr in csr.subject:
                allowed = {NameOID.COMMON_NAME: None, NameOID.COUNTRY_NAME: "ZW",
                           NameOID.ORGANIZATION_NAME: "Zimbabwe Revenue Authority",
                           NameOID.STATE_OR_PROVINCE_NAME: "Zimbabwe"}
                if attr.oid not in allowed or (allowed[attr.oid] and attr.value != allowed[attr.oid]):
                    raise ValueError("unexpected subject field")
            cert = (x509.CertificateBuilder()
                    .subject_name(csr.subject).issuer_name(self.device_ca_cert.subject)
                    .public_key(csr.public_key()).serial_number(x509.random_serial_number())
                    .not_valid_before(self._now() - timedelta(minutes=1))
                    .not_valid_after(self._now() + timedelta(days=365))
                    .sign(self._ca_key, hashes.SHA256()))
        except Exception:                                    # noqa: BLE001 - any parse failure is DEV03
            return self._err(422, "DEV03", "Certificate request is invalid")
        dev.cert_thumb_sha1 = cert.fingerprint(hashes.SHA1())
        return self._ok({"operationID": self._opid(),
                         "certificate": cert.public_bytes(serialization.Encoding.PEM).decode()})

    def _status(self, dev: _Device) -> httpx.Response:
        out: Dict[str, Any] = {"operationID": self._opid(), "fiscalDayStatus": self._status_name(dev.day_status)}
        if dev.day_status is FiscalDayStatus.CLOSE_FAILED and dev.closing_error is not None:
            out["fiscalDayClosingErrorCode"] = dev.closing_error
        if dev.day_status is FiscalDayStatus.CLOSED and dev.last_closed_no:
            out["fiscalDayReconciliationMode"] = "Auto"
            out["fiscalDayClosed"] = self._now().strftime("%Y-%m-%dT%H:%M:%S")
        if dev.last_receipt_global_no is not None:
            out["lastReceiptGlobalNo"] = dev.last_receipt_global_no
        if dev.day_no:
            out["lastFiscalDayNo"] = dev.day_no
        return self._ok(out)

    @staticmethod
    def _status_name(s: FiscalDayStatus) -> str:
        return {FiscalDayStatus.CLOSED: "FiscalDayClosed", FiscalDayStatus.OPENED: "FiscalDayOpened",
                FiscalDayStatus.CLOSE_INITIATED: "FiscalDayCloseInitiated",
                FiscalDayStatus.CLOSE_FAILED: "FiscalDayCloseFailed"}[s]

    def _open_day(self, dev: _Device, body: dict) -> httpx.Response:
        if dev.day_status is not FiscalDayStatus.CLOSED:
            return self._err(422, "FISC01", "Open day is not allowed")
        if "fiscalDayOpened" not in body:
            return self._err(400, None, "fiscalDayOpened is mandatory")
        expected = dev.last_closed_no + 1
        no = body.get("fiscalDayNo", expected)
        if no != expected:
            return self._err(422, "FISC01", "fiscalDayNo must follow the last closed fiscal day")
        dev.day_status, dev.day_no, dev.day_opened = FiscalDayStatus.OPENED, no, str(body["fiscalDayOpened"])
        dev.last_receipt_counter = 0
        return self._ok({"operationID": self._opid(), "fiscalDayNo": no})

    def _submit_receipt(self, dev: _Device, body: dict) -> httpx.Response:
        if dev.day_status not in (FiscalDayStatus.OPENED, FiscalDayStatus.CLOSE_FAILED):
            return self._err(422, "RCPT01", "Submitting receipt is not allowed")
        r = body.get("receipt")
        if not isinstance(r, dict) or any(k not in r for k in _REQUIRED_RECEIPT_FIELDS):
            return self._err(422, "RCPT02", "Receipt structure invalid")
        sig = r["receiptDeviceSignature"]
        if not isinstance(sig, dict) or not isinstance(sig.get("hash"), str) or not isinstance(sig.get("signature"), str):
            return self._err(422, "RCPT02", "receiptDeviceSignature invalid")
        try:
            base64.b64decode(sig["hash"], validate=True)
        except Exception:                                    # noqa: BLE001
            return self._err(422, "RCPT02", "receiptDeviceSignature.hash is not base64")
        key = (r["receiptGlobalNo"], sig["hash"])
        stored = dev.receipts.get(key)
        if stored is None:
            stored = {"receiptID": dev.next_receipt_id, "serverDate": self._now().strftime("%Y-%m-%dT%H:%M:%S"),
                      "receiptServerSignature": self._sign(sig["hash"])}
            dev.next_receipt_id += 1
            dev.receipts[key] = stored
            dev.last_receipt_global_no = r["receiptGlobalNo"]
            dev.last_receipt_counter = r["receiptCounter"]
        return self._ok({"operationID": self._opid(), **stored})

    def _close_day(self, dev: _Device, body: dict) -> httpx.Response:
        if dev.day_status is FiscalDayStatus.CLOSE_INITIATED:
            return self._err(422, "FISC03", "Closing day is not allowed. Close day is in progress")
        if dev.day_status is FiscalDayStatus.CLOSED:
            return self._err(422, "FISC04", "Closing day is not allowed. Fiscal day not opened")
        for k in ("fiscalDayNo", "fiscalDayCounters", "fiscalDayDeviceSignature", "receiptCounter"):
            if k not in body:
                return self._err(400, None, f"{k} is mandatory")
        if body["fiscalDayNo"] != dev.day_no:
            return self._err(422, "FISC04", "fiscalDayNo does not match the open fiscal day")
        if any(c.get("fiscalCounterValue") == 0 for c in body["fiscalDayCounters"]):
            return self._err(400, None, "Zero value counters must not be submitted")
        dev.close_payload = body
        dev.day_status = FiscalDayStatus.CLOSE_INITIATED
        return self._ok({"operationID": self._opid()})
