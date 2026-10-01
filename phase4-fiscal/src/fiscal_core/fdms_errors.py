"""
fdms_errors.py - typed errors for the FDMS client (Phase 4 / P4).

Spec basis: v7.2 section 8.1 (HTTP statuses), 8.2 (error codes), 7.3 (401).

Design rules
  * An RFC 7807 ProblemDetails body is parsed into ProblemDetails and attached
    to the exception; the raw body is never logged by this module.
  * 422 -> FdmsRejectedError carrying errorCode (DEV0x, RCPT01/02, FISC0x, FILE0x).
  * 500/502/transport failure -> retryable family. Whether a retry is SAFE
    depends on the endpoint (see fdms_client.IDEMPOTENT_ENDPOINTS); when a
    non-idempotent call may or may not have been processed the client raises
    FdmsUnknownOutcomeError so the caller must reconcile via getStatus instead
    of blindly retrying (Plan phase 5, "unknown outcome").
  * 401 has four possible server-side causes and the response does not say
    which. diagnose_unauthorized() narrows it using only LOCAL facts and
    never claims more than it can know.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Mapping, Optional

from cryptography import x509
from cryptography.x509.oid import NameOID


class FdmsError(Exception):
    """Base class for every error raised by the FDMS client layer."""


class FdmsConfigError(FdmsError):
    """Client mis-configured (e.g. calling an mTLS endpoint with no client
    identity, or pointing at production without explicit opt-in). Raised
    BEFORE any network call."""


class FdmsProtocolError(FdmsError):
    """Server replied 2xx but the body is not what the spec promises."""


@dataclass(frozen=True)
class ProblemDetails:
    """RFC 7807 body as used by FDMS (spec section 8)."""

    type: str = ""
    title: str = ""
    status: int = 0
    error_code: Optional[str] = None

    @classmethod
    def from_json(cls, data: Any, http_status: int) -> "ProblemDetails":
        if not isinstance(data, Mapping):
            return cls(status=http_status)
        code = data.get("errorCode")
        return cls(
            type=str(data.get("type", ""))[:200],
            title=str(data.get("title", ""))[:500],
            status=int(data["status"]) if isinstance(data.get("status"), int) else http_status,
            error_code=str(code)[:20] if code is not None else None,
        )


class FdmsHttpError(FdmsError):
    """Any non-2xx reply from FDMS."""

    def __init__(self, http_status: int, problem: ProblemDetails, endpoint: str) -> None:
        self.http_status = http_status
        self.problem = problem
        self.endpoint = endpoint
        code = f" [{problem.error_code}]" if problem.error_code else ""
        super().__init__(f"{endpoint}: HTTP {http_status}{code} {problem.title}".strip())

    @property
    def error_code(self) -> Optional[str]:
        return self.problem.error_code


class FdmsBadRequestError(FdmsHttpError):
    """400 - malformed message. A bug in our request builder, not retryable."""


class FdmsAuthError(FdmsHttpError):
    """401 - see diagnose_unauthorized()."""


class FdmsNotFoundError(FdmsHttpError):
    """404 - endpoint path wrong. In this codebase that almost certainly means
    the UNVERIFIED path table in fdms_client.ENDPOINTS needs correcting (P13)."""


class FdmsMethodNotAllowedError(FdmsHttpError):
    """405 - wrong HTTP verb. Same remedy as 404."""


class FdmsRejectedError(FdmsHttpError):
    """422 - FDMS understood the request and refused it. error_code says why."""


class FdmsServerError(FdmsHttpError):
    """500/502 - FDMS infrastructure. Spec says: retry later."""


class FdmsTransportError(FdmsError):
    """No HTTP reply at all (connect failure, timeout, TLS failure)."""

    def __init__(self, endpoint: str, cause: BaseException, request_may_have_been_sent: bool) -> None:
        self.endpoint = endpoint
        self.cause = cause
        self.request_may_have_been_sent = request_may_have_been_sent
        super().__init__(f"{endpoint}: transport failure ({type(cause).__name__})")


class FdmsUnknownOutcomeError(FdmsError):
    """
    A NON-idempotent request may or may not have been processed (timeout or
    5xx after the request left the machine). Do NOT retry blindly: call
    getStatus / reconcile first. `last_error` holds the final underlying error.
    """

    def __init__(self, endpoint: str, last_error: BaseException) -> None:
        self.endpoint = endpoint
        self.last_error = last_error
        super().__init__(f"{endpoint}: outcome unknown after {type(last_error).__name__}; reconcile before retrying")


# --------------------------------------------------------------------------
# 401 diagnosis (spec 7.3 lists four causes; the reply does not say which)
# --------------------------------------------------------------------------
class UnauthorizedCause(str, Enum):
    CERT_EXPIRED_LOCALLY = "CERT_EXPIRED_LOCALLY"        # cause 3, provable from our own cert
    CERT_NOT_FOR_THIS_DEVICE = "CERT_NOT_FOR_THIS_DEVICE"  # cause 4, provable from cert CN vs deviceID
    NO_LOCAL_CERT_TO_CHECK = "NO_LOCAL_CERT_TO_CHECK"
    NOT_DETERMINABLE_LOCALLY = "NOT_DETERMINABLE_LOCALLY"  # causes 1 or 2 (not issued by gateway / revoked)


_CN_RE = re.compile(r"^ZIMRA-(.+)-(\d{10})$")


def diagnose_unauthorized(
    device_id: int,
    client_cert_pem: Optional[str],
    now: Optional[datetime] = None,
) -> UnauthorizedCause:
    """
    Narrow a 401 using only what we can prove locally.

    Returns CERT_EXPIRED_LOCALLY / CERT_NOT_FOR_THIS_DEVICE when our own
    certificate proves it. Otherwise NOT_DETERMINABLE_LOCALLY: it is then
    either "not issued by the gateway" or "revoked", which only ZIMRA can tell
    us. We deliberately do not guess between them.
    """
    if not client_cert_pem:
        return UnauthorizedCause.NO_LOCAL_CERT_TO_CHECK
    cert = x509.load_pem_x509_certificate(client_cert_pem.encode("ascii"))
    when = now or datetime.now(timezone.utc)
    if when >= cert.not_valid_after_utc or when < cert.not_valid_before_utc:
        return UnauthorizedCause.CERT_EXPIRED_LOCALLY
    cns = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
    if cns:
        m = _CN_RE.match(str(cns[0].value))
        if m and int(m.group(2)) != device_id:
            return UnauthorizedCause.CERT_NOT_FOR_THIS_DEVICE
    return UnauthorizedCause.NOT_DETERMINABLE_LOCALLY
