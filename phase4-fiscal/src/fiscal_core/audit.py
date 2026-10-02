"""
audit.py - hash-chained, append-only audit log (Phase 4 / P5).

Every fiscal-sensitive state change writes one row INSIDE THE SAME TRANSACTION
as the change itself, so the log can never describe something that did not
commit, nor miss something that did.

Chain
  hash(n) = SHA-256 of the canonical JSON of
            [seq, ts_utc, actor, event, device_id, subject, detail_json, prev_hash(n-1)]
  seq starts at 1 and is contiguous; prev_hash of row 1 is 64 zeros.

What this detects
  * editing any stored field of any row        -> that row's hash no longer matches
  * deleting or reordering a row in the middle -> seq gap / broken prev link
  * (with an external anchor) truncating the tail or rewriting the whole chain

What it does NOT do (do not oversell this in a security questionnaire)
  * Someone with write access to the database file who recomputes every later
    hash produces a valid-looking chain. The DB triggers block UPDATE/DELETE for
    ordinary SQL, but file access beats triggers. The defence is to export
    head() (seq + hash) to a place the database host cannot write (a separate
    log sink, an email, a signed ticket) and pass it back to verify(anchor=...).
    That external anchoring is P17 (operations).
  * Nothing here is a trusted timestamp; ts_utc is the local clock.

Secrets are refused at the door: detail keys that look like secrets, and values
containing PEM private-key text, raise AuditError instead of being stored.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Tuple

from . import fdms_json

GENESIS_HASH = "0" * 64
_FORBIDDEN_KEY = re.compile(r"(private|secret|passw|passphrase|token|activation|pem|credential)", re.IGNORECASE)
_MAX_DETAIL_BYTES = 8192


class AuditError(Exception):
    """Refused to write an audit row (bad actor/event/detail)."""


@dataclass(frozen=True)
class VerifyResult:
    ok: bool
    rows_checked: int
    first_bad_seq: Optional[int] = None
    reason: str = ""


SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_log (
    seq         INTEGER PRIMARY KEY CHECK (seq >= 1),
    ts_utc      TEXT NOT NULL,
    actor       TEXT NOT NULL,
    event       TEXT NOT NULL,
    device_id   INTEGER,
    subject     TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    prev_hash   TEXT NOT NULL,
    hash        TEXT NOT NULL UNIQUE
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
"""


def _check_detail(detail: Any, path: str = "detail") -> None:
    if isinstance(detail, Mapping):
        for k, v in detail.items():
            if not isinstance(k, str):
                raise AuditError(f"{path}: keys must be str")
            if _FORBIDDEN_KEY.search(k):
                raise AuditError(f"{path}.{k}: key name looks like a secret; refusing to audit it")
            _check_detail(v, f"{path}.{k}")
    elif isinstance(detail, (list, tuple)):
        for i, v in enumerate(detail):
            _check_detail(v, f"{path}[{i}]")
    elif isinstance(detail, str):
        if "PRIVATE KEY" in detail:
            raise AuditError(f"{path}: value contains private-key text; refusing to audit it")


def _digest(seq: int, ts: str, actor: str, event: str, device_id: Optional[int],
            subject: str, detail_json: str, prev_hash: str) -> str:
    canonical = json.dumps([seq, ts, actor, event, device_id, subject, detail_json, prev_hash],
                           separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


def append(
    db: sqlite3.Connection,
    ts_utc: str,
    actor: str,
    event: str,
    device_id: Optional[int],
    subject: str,
    detail: Optional[Mapping[str, Any]] = None,
) -> Tuple[int, str]:
    """Append one row. MUST be called inside the caller's open transaction."""
    if not isinstance(actor, str) or not 1 <= len(actor) <= 64:
        raise AuditError("actor must be 1-64 characters")
    if not isinstance(event, str) or not re.fullmatch(r"[a-z0-9_.]{1,64}", event):
        raise AuditError("event must match [a-z0-9_.]{1,64}")
    if not isinstance(subject, str) or len(subject) > 200:
        raise AuditError("subject must be a string of at most 200 characters")
    detail = dict(detail or {})
    _check_detail(detail)
    detail_json = fdms_json.dumps(detail)
    if len(detail_json.encode("utf-8")) > _MAX_DETAIL_BYTES:
        raise AuditError("detail too large")

    row = db.execute("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1").fetchone()
    seq, prev = (row[0] + 1, row[1]) if row else (1, GENESIS_HASH)
    h = _digest(seq, ts_utc, actor, event, device_id, subject, detail_json, prev)
    db.execute(
        "INSERT INTO audit_log (seq, ts_utc, actor, event, device_id, subject, detail_json, prev_hash, hash) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (seq, ts_utc, actor, event, device_id, subject, detail_json, prev, h),
    )
    return seq, h


def head(db: sqlite3.Connection) -> Optional[Tuple[int, str]]:
    row = db.execute("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1").fetchone()
    return (row[0], row[1]) if row else None


def verify(db: sqlite3.Connection, anchor: Optional[Tuple[int, str]] = None) -> VerifyResult:
    expected_seq, prev, checked = 1, GENESIS_HASH, 0
    seen_anchor = anchor is None
    for r in db.execute("SELECT seq, ts_utc, actor, event, device_id, subject, detail_json, prev_hash, hash "
                        "FROM audit_log ORDER BY seq"):
        seq, ts, actor, event, dev, subject, detail_json, prev_hash, h = tuple(r)
        if seq != expected_seq:
            return VerifyResult(False, checked, seq, f"sequence gap: expected {expected_seq}, found {seq}")
        if prev_hash != prev:
            return VerifyResult(False, checked, seq, "prev_hash does not match the previous row")
        if _digest(seq, ts, actor, event, dev, subject, detail_json, prev_hash) != h:
            return VerifyResult(False, checked, seq, "row content does not match its hash")
        if anchor is not None and seq == anchor[0]:
            if h != anchor[1]:
                return VerifyResult(False, checked + 1, seq, "row does not match the external anchor")
            seen_anchor = True
        prev, expected_seq, checked = h, expected_seq + 1, checked + 1
    if not seen_anchor:
        return VerifyResult(False, checked, None, "external anchor not found: log truncated or replaced")
    return VerifyResult(True, checked)
