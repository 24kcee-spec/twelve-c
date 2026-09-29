"""
qr.py - receipt QR code value (Phase 4 / P2), spec section 11.

receiptQrCode = qrUrl + "/" + deviceID(10) + receiptDate(ddMMyyyy) +
                receiptGlobalNo(10) + receiptQrData(16)

The spec's two worked examples (section 11) are reproduced by the tests for
the URL assembly. The spec gives receiptQrData examples but NOT the
signature they came from, so the derivation cannot be proven offline:

OPEN SPEC QUESTION (finding F8, new in P2):
  "receiptQrData = first 16 characters of MD5 hash from
  ReceiptDeviceSignature hexadecimal format value" can be read two ways:
    BYTES    - MD5 over the raw signature bytes (default; the normal reading)
    HEX_TEXT - MD5 over the hexadecimal *text* of the signature bytes
  Output is upper-case hex (spec examples: 4C8BE27663330417). Both are
  implemented; the ZIMRA verification page (invoice.zimra.co.zw) on the
  test environment settles which one is right (P13).
"""

from __future__ import annotations

import hashlib
from datetime import date, datetime
from enum import Enum
from typing import Union


class QrError(ValueError):
    pass


class QrDataSource(str, Enum):
    BYTES = "BYTES"        # MD5(signature bytes)              (default)
    HEX_TEXT = "HEX_TEXT"  # MD5(hex text of signature bytes)  (alternative)


DateLike = Union[str, date, datetime]


def _md5_hex_upper(data: bytes) -> str:
    # MD5 is mandated by the spec for this display code only; it is not a
    # security control (the device signature is).
    return hashlib.md5(data, usedforsecurity=False).hexdigest().upper()


def build_receipt_qr_data(
    device_signature: bytes,
    source: QrDataSource = QrDataSource.BYTES,
) -> str:
    """First 16 characters of the MD5 of the receipt device signature."""
    if not isinstance(device_signature, (bytes, bytearray)) or not device_signature:
        raise QrError("device_signature must be non-empty bytes (decoded from base64)")
    raw = bytes(device_signature)
    if source == QrDataSource.BYTES:
        return _md5_hex_upper(raw)[:16]
    if source == QrDataSource.HEX_TEXT:
        return _md5_hex_upper(raw.hex().upper().encode("ascii"))[:16]
    raise QrError(f"Unknown QR data source: {source!r}")


def _format_ddmmyyyy(value: DateLike) -> str:
    if isinstance(value, datetime):
        return value.strftime("%d%m%Y")
    if isinstance(value, date):
        return value.strftime("%d%m%Y")
    if isinstance(value, str):
        text = value.strip()
        try:
            # receiptDate is ISO 8601 YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
            return datetime.fromisoformat(text[:19]).strftime("%d%m%Y")
        except ValueError as exc:
            raise QrError(f"receipt_date not ISO 8601: {value!r}") from exc
    raise QrError("receipt_date must be str, date or datetime")


def _zero_pad(value: int, width: int, name: str) -> str:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise QrError(f"{name} must be a non-negative int")
    text = str(value)
    if len(text) > width:
        raise QrError(f"{name} does not fit in {width} digits")
    return text.zfill(width)


def build_receipt_qr_code(
    qr_url: str,
    device_id: int,
    receipt_date: DateLike,
    receipt_global_no: int,
    receipt_qr_data: str,
) -> str:
    """Full receiptQrCode string. `qr_url` is the base URL from getConfig;
    the spec says to add '/' before the other fields (a trailing '/' already
    present is not doubled)."""
    if not qr_url or not qr_url.strip():
        raise QrError("qr_url must not be empty")
    if len(receipt_qr_data) != 16 or any(c not in "0123456789ABCDEFabcdef" for c in receipt_qr_data):
        raise QrError("receipt_qr_data must be 16 hex characters")
    return (
        qr_url.strip().rstrip("/")
        + "/"
        + _zero_pad(device_id, 10, "device_id")
        + _format_ddmmyyyy(receipt_date)
        + _zero_pad(receipt_global_no, 10, "receipt_global_no")
        + receipt_qr_data.upper()
    )
