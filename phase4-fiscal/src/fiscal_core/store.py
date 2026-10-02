"""
store.py - durable fiscal ledger (Phase 4 / P5). stdlib sqlite3, no new dependency.

WHY THIS EXISTS (Plan phases 3 and 5)
  We must know our own fiscal-day and receipt state even when the network is
  down or the process was killed mid-request. Everything the receipt engine
  (P8) and day lifecycle (P9) need to survive a crash is persisted here.

GUARANTEES, and where each is enforced
  * Receipt numbers are gap-free and unique per device: allocated under
    BEGIN IMMEDIATE (cross-process safe) AND backed by UNIQUE constraints, so a
    bug cannot silently duplicate a number.
  * Number reservation stores the unsigned `intent`, so a receipt that was
    reserved but never signed or sent (crash) can be rebuilt with the SAME
    numbers by P8; a number is never "given back".
  * Once signed, a receipt's payload and hash are immutable (trigger). Identity
    columns are immutable; ACCEPTED/REJECTED are terminal; rows are never deleted.
  * Submission is strictly ascending by receiptGlobalNo (spec section 9 item 13):
    begin_submit refuses while any lower number is unresolved.
  * A day cannot start closing while any of its receipts is unresolved.
  * No receipts while a day is not OPENED/CLOSE_FAILED, while the device has an
    unresolved CONFLICT, or after taxPayerDayMaxHrs (spec section 9 item 4).
  * Every change and its audit row commit or roll back together.

HONEST LIMITS
  * SQLite is single-host. Multi-tenant / HA needs PostgreSQL (P15/P17); the
    method surface here is what a Postgres store would implement.
  * No secrets are stored: no keys, no certificates, no activation keys. Those
    live in the key store (P3) / password manager.
  * Receipt payloads contain buyer details (personal data). Encrypt the
    database file at rest (disk encryption now; SQLCipher or Postgres later).
"""

from __future__ import annotations

import base64
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Iterator, List, Mapping, Optional, Sequence

from . import audit, fdms_json
from .fdms_client import FiscalDayStatus
from .state import (
    PENDING_DAY_STATES,
    RECEIPT_ALLOWED_DAY_STATES,
    TERMINAL_RECEIPT_STATES,
    DayEvent,
    DayState,
    ReceiptState,
    Resolution,
    ResolutionKind,
    check_receipt_transition,
    next_day_state,
    reconcile,
)

SCHEMA_VERSION = 1
_STATES_SQL = ",".join(f"'{s.value}'" for s in ReceiptState)
_DAY_STATES_SQL = ",".join(f"'{s.value}'" for s in DayState)

_SCHEMA = f"""
CREATE TABLE devices (
    device_id   INTEGER PRIMARY KEY CHECK (device_id >= 0),
    serial_no   TEXT NOT NULL,
    created_utc TEXT NOT NULL,
    conflict    TEXT
);
CREATE TABLE fiscal_days (
    device_id     INTEGER NOT NULL REFERENCES devices(device_id),
    fiscal_day_no INTEGER NOT NULL CHECK (fiscal_day_no >= 1),
    state         TEXT NOT NULL CHECK (state IN ({_DAY_STATES_SQL})),
    resume_state  TEXT,
    opened_local  TEXT NOT NULL,
    closed_utc    TEXT,
    PRIMARY KEY (device_id, fiscal_day_no)
);
CREATE TABLE receipts (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id             INTEGER NOT NULL,
    fiscal_day_no         INTEGER NOT NULL,
    receipt_global_no     INTEGER NOT NULL CHECK (receipt_global_no >= 1),
    receipt_counter       INTEGER NOT NULL CHECK (receipt_counter >= 1),
    currency              TEXT NOT NULL CHECK (length(currency) = 3),
    intent_json           TEXT NOT NULL,
    state                 TEXT NOT NULL CHECK (state IN ({_STATES_SQL})),
    payload_json          TEXT,
    receipt_hash          TEXT,
    server_receipt_id     INTEGER,
    server_date           TEXT,
    server_signature_json TEXT,
    error_code            TEXT,
    last_operation_id     TEXT,
    created_utc           TEXT NOT NULL,
    updated_utc           TEXT NOT NULL,
    UNIQUE (device_id, receipt_global_no),
    UNIQUE (device_id, fiscal_day_no, receipt_counter),
    FOREIGN KEY (device_id, fiscal_day_no) REFERENCES fiscal_days(device_id, fiscal_day_no)
);
CREATE INDEX receipts_by_state ON receipts (device_id, state);
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts
BEGIN SELECT RAISE(ABORT, 'receipts are never deleted'); END;
CREATE TRIGGER receipts_immutable BEFORE UPDATE ON receipts
WHEN NEW.id IS NOT OLD.id OR NEW.device_id IS NOT OLD.device_id
  OR NEW.fiscal_day_no IS NOT OLD.fiscal_day_no
  OR NEW.receipt_global_no IS NOT OLD.receipt_global_no
  OR NEW.receipt_counter IS NOT OLD.receipt_counter
  OR NEW.currency IS NOT OLD.currency OR NEW.intent_json IS NOT OLD.intent_json
  OR (OLD.payload_json IS NOT NULL AND NEW.payload_json IS NOT OLD.payload_json)
  OR (OLD.receipt_hash IS NOT NULL AND NEW.receipt_hash IS NOT OLD.receipt_hash)
  OR (OLD.state IN ('ACCEPTED','REJECTED') AND NEW.state IS NOT OLD.state)
  OR (OLD.state = 'ACCEPTED' AND (NEW.server_receipt_id IS NOT OLD.server_receipt_id
       OR NEW.server_signature_json IS NOT OLD.server_signature_json))
BEGIN SELECT RAISE(ABORT, 'receipt identity, signed payload and terminal state are immutable'); END;
CREATE TRIGGER fiscal_days_no_delete BEFORE DELETE ON fiscal_days
BEGIN SELECT RAISE(ABORT, 'fiscal days are never deleted'); END;
CREATE TRIGGER fiscal_days_immutable BEFORE UPDATE ON fiscal_days
WHEN NEW.device_id IS NOT OLD.device_id OR NEW.fiscal_day_no IS NOT OLD.fiscal_day_no
  OR (NEW.opened_local IS NOT OLD.opened_local AND NOT (OLD.state = 'CLOSED' AND OLD.closed_utc IS NULL))
BEGIN SELECT RAISE(ABORT, 'fiscal day identity is immutable'); END;
"""


class StoreError(Exception):
    """Base class for ledger refusals."""


class DeviceConflictError(StoreError):
    """Device has an unresolved reconciliation conflict; nothing may be issued."""


class DayNotOpenError(StoreError):
    """The fiscal day does not currently allow this operation."""


class DayExpiredError(StoreError):
    """taxPayerDayMaxHrs elapsed; close the day and open a new one (spec 9.4)."""


class OrderingError(StoreError):
    """Submission order (ascending receiptGlobalNo, none skipped) would be violated."""


@dataclass(frozen=True)
class DayRecord:
    device_id: int
    fiscal_day_no: int
    state: DayState
    resume_state: Optional[DayState]
    opened_local: str
    closed_utc: Optional[str]


@dataclass(frozen=True)
class ReceiptRecord:
    id: int
    device_id: int
    fiscal_day_no: int
    receipt_global_no: int
    receipt_counter: int
    currency: str
    intent: Mapping[str, Any]
    state: ReceiptState
    payload: Optional[Mapping[str, Any]]
    receipt_hash: Optional[str]
    server_receipt_id: Optional[int]
    server_date: Optional[str]
    server_signature: Optional[Mapping[str, Any]]
    error_code: Optional[str]
    last_operation_id: Optional[str]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class FiscalStore:
    def __init__(self, path: str, clock: Callable[[], datetime] = _utc_now, busy_timeout_ms: int = 5000) -> None:
        self._clock = clock
        self._lock = threading.RLock()
        self._db = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute(f"PRAGMA busy_timeout = {int(busy_timeout_ms)}")
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.execute("PRAGMA journal_mode = WAL")
        self._db.execute("PRAGMA synchronous = FULL")
        self._init_schema()

    # ------------------------------------------------------------- plumbing
    def close(self) -> None:
        with self._lock:
            self._db.close()

    def __enter__(self) -> "FiscalStore":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def _init_schema(self) -> None:
        with self._lock:
            version = self._db.execute("PRAGMA user_version").fetchone()[0]
            if version > SCHEMA_VERSION:
                raise StoreError(f"database schema v{version} is newer than this code (v{SCHEMA_VERSION})")
            if version == 0:
                self._db.execute("BEGIN IMMEDIATE")
                try:
                    for stmt in _split_sql(_SCHEMA + audit.SCHEMA):
                        self._db.execute(stmt)
                    self._db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
                except BaseException:
                    self._db.execute("ROLLBACK")
                    raise
                self._db.execute("COMMIT")

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                yield self._db
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
            else:
                self._db.execute("COMMIT")

    def _ts(self) -> str:
        return self._clock().astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

    def _audit(self, db: sqlite3.Connection, actor: str, event: str, device_id: Optional[int],
               subject: str, detail: Optional[Mapping[str, Any]] = None) -> None:
        audit.append(db, self._ts(), actor, event, device_id, subject, detail)

    # --------------------------------------------------------------- devices
    def register_device(self, device_id: int, serial_no: str, actor: str = "system") -> None:
        if not isinstance(device_id, int) or isinstance(device_id, bool) or device_id < 0:
            raise StoreError("device_id must be a non-negative int")
        if not isinstance(serial_no, str) or not serial_no.strip():
            raise StoreError("serial_no is required")
        with self._tx() as db:
            if db.execute("SELECT 1 FROM devices WHERE device_id=?", (device_id,)).fetchone():
                raise StoreError(f"device {device_id} is already registered")
            db.execute("INSERT INTO devices (device_id, serial_no, created_utc) VALUES (?,?,?)",
                       (device_id, serial_no, self._ts()))
            self._audit(db, actor, "device.registered", device_id, f"device:{device_id}", {"serialNo": serial_no})

    def _device(self, db: sqlite3.Connection, device_id: int) -> sqlite3.Row:
        row = db.execute("SELECT * FROM devices WHERE device_id=?", (device_id,)).fetchone()
        if row is None:
            raise StoreError(f"device {device_id} is not registered")
        return row

    def device_conflict(self, device_id: int) -> Optional[str]:
        with self._lock:
            return self._device(self._db, device_id)["conflict"]

    def _require_no_conflict(self, db: sqlite3.Connection, device_id: int) -> None:
        c = self._device(db, device_id)["conflict"]
        if c:
            raise DeviceConflictError(f"device {device_id} has an unresolved conflict: {c}")

    def resolve_conflict(self, device_id: int, actor: str, note: str) -> None:
        """A human has inspected the situation. Clears the flag; always audited."""
        if not note or not note.strip():
            raise StoreError("a note explaining the resolution is required")
        with self._tx() as db:
            dev = self._device(db, device_id)
            if not dev["conflict"]:
                raise StoreError("no conflict to resolve")
            db.execute("UPDATE devices SET conflict=NULL WHERE device_id=?", (device_id,))
            self._audit(db, actor, "conflict.resolved", device_id, f"device:{device_id}",
                        {"was": dev["conflict"], "note": note})

    # ------------------------------------------------------------- fiscal day
    @staticmethod
    def _day(row: Optional[sqlite3.Row]) -> Optional[DayRecord]:
        if row is None:
            return None
        return DayRecord(row["device_id"], row["fiscal_day_no"], DayState(row["state"]),
                         DayState(row["resume_state"]) if row["resume_state"] else None,
                         row["opened_local"], row["closed_utc"])

    def _latest_day_row(self, db: sqlite3.Connection, device_id: int) -> Optional[sqlite3.Row]:
        return db.execute("SELECT * FROM fiscal_days WHERE device_id=? ORDER BY fiscal_day_no DESC LIMIT 1",
                          (device_id,)).fetchone()

    def current_day(self, device_id: int) -> Optional[DayRecord]:
        with self._lock:
            return self._day(self._latest_day_row(self._db, device_id))

    def last_closed_day_no(self, device_id: int) -> Optional[int]:
        with self._lock:
            return self._last_closed(self._db, device_id)

    @staticmethod
    def _last_closed(db: sqlite3.Connection, device_id: int) -> Optional[int]:
        r = db.execute("SELECT MAX(fiscal_day_no) FROM fiscal_days WHERE device_id=? AND state='CLOSED' AND closed_utc IS NOT NULL",
                       (device_id,)).fetchone()
        return r[0]

    def begin_open_day(self, device_id: int, opened_local: datetime, actor: str = "system") -> int:
        """Record the INTENT to open a day, BEFORE sending openDay. Returns the day number to send."""
        if opened_local.tzinfo is not None:
            raise StoreError("opened_local must be naive local time (spec: no time zone)")
        with self._tx() as db:
            self._require_no_conflict(db, device_id)
            latest = self._latest_day_row(db, device_id)
            if latest is not None and DayState(latest["state"]) is not DayState.CLOSED:
                raise DayNotOpenError(f"day {latest['fiscal_day_no']} is {latest['state']}; cannot open a new day")
            stamp = opened_local.strftime("%Y-%m-%dT%H:%M:%S")
            next_day_state(DayState.CLOSED, DayEvent.OPEN_SENT)
            if latest is not None and latest["closed_utc"] is None:
                # CLOSED with no closed_utc = an openDay that never took effect (OPEN_REJECTED).
                # FDMS still expects that same day number, so re-arm the row rather than skip a number.
                no = latest["fiscal_day_no"]
                db.execute("UPDATE fiscal_days SET state=?, opened_local=? WHERE device_id=? AND fiscal_day_no=?",
                           (DayState.OPEN_PENDING.value, stamp, device_id, no))
                self._audit(db, actor, "day.open_sent", device_id, f"day:{no}", {"fiscalDayNo": no, "retry": True})
            else:
                no = (latest["fiscal_day_no"] if latest else 0) + 1
                db.execute("INSERT INTO fiscal_days (device_id, fiscal_day_no, state, opened_local) VALUES (?,?,?,?)",
                           (device_id, no, DayState.OPEN_PENDING.value, stamp))
                self._audit(db, actor, "day.open_sent", device_id, f"day:{no}", {"fiscalDayNo": no})
            return no

    def day_event(self, device_id: int, event: DayEvent, actor: str = "system",
                  detail: Optional[Mapping[str, Any]] = None) -> DayRecord:
        with self._tx() as db:
            if event in (DayEvent.OPEN_SENT,):
                raise StoreError("use begin_open_day() to start a day")
            self._device(db, device_id)
            return self._apply_day_event(db, device_id, event, actor, detail, check_conflict=True)

    def _apply_day_event(self, db: sqlite3.Connection, device_id: int, event: DayEvent, actor: str,
                         detail: Optional[Mapping[str, Any]], check_conflict: bool) -> DayRecord:
        if check_conflict:
            self._require_no_conflict(db, device_id)
        row = self._latest_day_row(db, device_id)
        if row is None:
            raise DayNotOpenError("no fiscal day exists for this device")
        state = DayState(row["state"])
        resume = DayState(row["resume_state"]) if row["resume_state"] else None
        if event is DayEvent.CLOSE_SENT:
            open_items = db.execute(
                "SELECT COUNT(*) FROM receipts WHERE device_id=? AND fiscal_day_no=? AND state NOT IN ('ACCEPTED','REJECTED')",
                (device_id, row["fiscal_day_no"])).fetchone()[0]
            if open_items:
                raise StoreError(f"cannot close day {row['fiscal_day_no']}: {open_items} receipt(s) not yet resolved "
                                 "(would fail with MissingReceipts)")
        new_state = next_day_state(state, event, resume)
        new_resume = state if event is DayEvent.CLOSE_SENT else None
        closed_utc = self._ts() if event is DayEvent.CLOSE_DONE else row["closed_utc"]
        db.execute("UPDATE fiscal_days SET state=?, resume_state=?, closed_utc=? WHERE device_id=? AND fiscal_day_no=?",
                   (new_state.value, new_resume.value if new_resume else None, closed_utc,
                    device_id, row["fiscal_day_no"]))
        d = dict(detail or {})
        d.update({"fiscalDayNo": row["fiscal_day_no"], "from": state.value, "to": new_state.value})
        self._audit(db, actor, "day." + event.value.lower(), device_id, f"day:{row['fiscal_day_no']}", d)
        return self._day(self._latest_day_row(db, device_id))  # type: ignore[return-value]

    def apply_reconciliation(self, device_id: int, server_status: FiscalDayStatus,
                             server_last_day_no: Optional[int], actor: str = "reconciler") -> Resolution:
        """Compare our record with the server's getStatus; adopt what is provable, else flag CONFLICT."""
        with self._tx() as db:
            self._device(db, device_id)
            row = self._latest_day_row(db, device_id)
            local = self._day(row)
            res = reconcile(
                local.state if local else None, local.fiscal_day_no if local else None,
                self._last_closed(db, device_id), local.resume_state if local else None,
                server_status, server_last_day_no)
            subject = f"day:{local.fiscal_day_no}" if local else f"device:{device_id}"
            base = {"serverStatus": server_status.name, "serverLastDayNo": server_last_day_no}
            if res.kind is ResolutionKind.ADOPT:
                for ev in res.events:
                    self._apply_day_event(db, device_id, ev, actor, {"reconciled": True}, check_conflict=False)
                self._audit(db, actor, "reconcile.adopted", device_id, subject,
                            dict(base, events=[e.value for e in res.events]))
            elif res.kind is ResolutionKind.CONFLICT:
                db.execute("UPDATE devices SET conflict=? WHERE device_id=?", (res.reason[:500], device_id))
                self._audit(db, actor, "reconcile.conflict", device_id, subject, dict(base, reason=res.reason))
            else:
                self._audit(db, actor, "reconcile.agreed", device_id, subject, base)
            return res

    # --------------------------------------------------------------- receipts
    @staticmethod
    def _receipt(row: Optional[sqlite3.Row]) -> Optional[ReceiptRecord]:
        if row is None:
            return None
        loads = fdms_json.loads
        return ReceiptRecord(
            row["id"], row["device_id"], row["fiscal_day_no"], row["receipt_global_no"], row["receipt_counter"],
            row["currency"], loads(row["intent_json"]), ReceiptState(row["state"]),
            loads(row["payload_json"]) if row["payload_json"] else None, row["receipt_hash"],
            row["server_receipt_id"], row["server_date"],
            loads(row["server_signature_json"]) if row["server_signature_json"] else None,
            row["error_code"], row["last_operation_id"])

    def _receipt_row(self, db: sqlite3.Connection, receipt_id: int) -> sqlite3.Row:
        row = db.execute("SELECT * FROM receipts WHERE id=?", (receipt_id,)).fetchone()
        if row is None:
            raise StoreError(f"receipt {receipt_id} not found")
        return row

    def get_receipt(self, receipt_id: int) -> ReceiptRecord:
        with self._lock:
            return self._receipt(self._receipt_row(self._db, receipt_id))  # type: ignore[return-value]

    def list_receipts(self, device_id: int, fiscal_day_no: Optional[int] = None,
                      states: Optional[Sequence[ReceiptState]] = None) -> List[ReceiptRecord]:
        sql, args = "SELECT * FROM receipts WHERE device_id=?", [device_id]
        if fiscal_day_no is not None:
            sql, args = sql + " AND fiscal_day_no=?", args + [fiscal_day_no]
        if states:
            sql += " AND state IN (" + ",".join("?" * len(states)) + ")"
            args += [s.value for s in states]
        with self._lock:
            return [self._receipt(r) for r in self._db.execute(sql + " ORDER BY receipt_global_no", args)]  # type: ignore[misc]

    def next_to_submit(self, device_id: int) -> Optional[ReceiptRecord]:
        """Lowest-numbered receipt that is not yet resolved (the only one allowed to go next)."""
        with self._lock:
            row = self._db.execute(
                "SELECT * FROM receipts WHERE device_id=? AND state NOT IN ('ACCEPTED','REJECTED') "
                "ORDER BY receipt_global_no LIMIT 1", (device_id,)).fetchone()
            return self._receipt(row)

    def reserve_receipt(self, device_id: int, currency: str, intent: Mapping[str, Any], actor: str = "system",
                        day_max_hours: Optional[int] = None, now_local: Optional[datetime] = None) -> ReceiptRecord:
        """
        Allocate the next receiptGlobalNo and the next per-day receiptCounter and persist the unsigned
        `intent`. The numbers are now spent: the receipt MUST eventually be submitted (P8 rebuilds it from
        `intent` after a crash). Refused while the day is not OPENED/CLOSE_FAILED, past its max hours, or
        while the device has a conflict.
        """
        if not isinstance(currency, str) or len(currency) != 3 or not currency.isalpha():
            raise StoreError("currency must be a 3-letter code")
        intent_json = fdms_json.dumps(dict(intent))
        with self._tx() as db:
            self._require_no_conflict(db, device_id)
            row = self._latest_day_row(db, device_id)
            if row is None or DayState(row["state"]) not in RECEIPT_ALLOWED_DAY_STATES:
                state = row["state"] if row else "no day"
                raise DayNotOpenError(f"cannot issue a receipt: fiscal day is {state}")
            if day_max_hours is not None:
                opened = datetime.strptime(row["opened_local"], "%Y-%m-%dT%H:%M:%S")
                now = now_local or datetime.now()
                if now - opened >= timedelta(hours=day_max_hours):
                    raise DayExpiredError(f"day {row['fiscal_day_no']} has been open {day_max_hours}h or more; "
                                          "close it and open a new one")
            g = db.execute("SELECT COALESCE(MAX(receipt_global_no),0) FROM receipts WHERE device_id=?",
                           (device_id,)).fetchone()[0] + 1
            c = db.execute("SELECT COALESCE(MAX(receipt_counter),0) FROM receipts WHERE device_id=? AND fiscal_day_no=?",
                           (device_id, row["fiscal_day_no"])).fetchone()[0] + 1
            ts = self._ts()
            cur = db.execute(
                "INSERT INTO receipts (device_id, fiscal_day_no, receipt_global_no, receipt_counter, currency, "
                "intent_json, state, created_utc, updated_utc) VALUES (?,?,?,?,?,?,?,?,?)",
                (device_id, row["fiscal_day_no"], g, c, currency.upper(), intent_json, ReceiptState.RESERVED.value, ts, ts))
            self._audit(db, actor, "receipt.reserved", device_id, f"receipt:{g}",
                        {"receiptGlobalNo": g, "receiptCounter": c, "fiscalDayNo": row["fiscal_day_no"],
                         "currency": currency.upper()})
            return self._receipt(self._receipt_row(db, cur.lastrowid))  # type: ignore[return-value]

    def _move(self, db: sqlite3.Connection, row: sqlite3.Row, new: ReceiptState, actor: str, event: str,
              sets: Optional[Dict[str, Any]] = None, detail: Optional[Mapping[str, Any]] = None) -> ReceiptRecord:
        check_receipt_transition(ReceiptState(row["state"]), new)
        cols = {"state": new.value, "updated_utc": self._ts(), **(sets or {})}
        db.execute(f"UPDATE receipts SET {', '.join(k + '=?' for k in cols)} WHERE id=?", [*cols.values(), row["id"]])
        d = {"receiptGlobalNo": row["receipt_global_no"], "from": row["state"], "to": new.value, **(detail or {})}
        self._audit(db, actor, event, row["device_id"], f"receipt:{row['receipt_global_no']}", d)
        return self._receipt(self._receipt_row(db, row["id"]))  # type: ignore[return-value]

    def attach_signed(self, receipt_id: int, payload: Mapping[str, Any], receipt_hash_b64: str,
                      actor: str = "system") -> ReceiptRecord:
        """Store the signed payload and its SHA-256 hash (base64). Allowed once; immutable afterwards."""
        try:
            raw = base64.b64decode(receipt_hash_b64, validate=True)
        except Exception:                                                   # noqa: BLE001
            raise StoreError("receipt hash must be valid base64") from None
        if len(raw) != 32:
            raise StoreError("receipt hash must be 32 bytes (SHA-256)")
        with self._tx() as db:
            row = self._receipt_row(db, receipt_id)
            self._require_no_conflict(db, row["device_id"])
            if payload.get("receiptGlobalNo") != row["receipt_global_no"] or \
               payload.get("receiptCounter") != row["receipt_counter"]:
                raise StoreError("payload receiptGlobalNo/receiptCounter do not match the reserved numbers")
            return self._move(db, row, ReceiptState.SIGNED, actor, "receipt.signed",
                              {"payload_json": fdms_json.dumps(dict(payload)), "receipt_hash": receipt_hash_b64},
                              {"hash": receipt_hash_b64})

    def begin_submit(self, receipt_id: int, actor: str = "system") -> ReceiptRecord:
        """SIGNED/UNKNOWN -> SUBMITTING, only if every lower-numbered receipt is already resolved."""
        with self._tx() as db:
            row = self._receipt_row(db, receipt_id)
            self._require_no_conflict(db, row["device_id"])
            blocker = db.execute(
                "SELECT receipt_global_no, state FROM receipts WHERE device_id=? AND receipt_global_no<? "
                "AND state NOT IN ('ACCEPTED','REJECTED') ORDER BY receipt_global_no LIMIT 1",
                (row["device_id"], row["receipt_global_no"])).fetchone()
            if blocker:
                raise OrderingError(f"receipt {blocker['receipt_global_no']} ({blocker['state']}) must be resolved "
                                    f"before {row['receipt_global_no']} can be submitted")
            day = db.execute("SELECT state FROM fiscal_days WHERE device_id=? AND fiscal_day_no=?",
                             (row["device_id"], row["fiscal_day_no"])).fetchone()
            if DayState(day["state"]) not in RECEIPT_ALLOWED_DAY_STATES:
                raise DayNotOpenError(f"day {row['fiscal_day_no']} is {day['state']}; cannot submit")
            return self._move(db, row, ReceiptState.SUBMITTING, actor, "receipt.submitting")

    def mark_accepted(self, receipt_id: int, server_receipt_id: int, server_date: str,
                      server_signature: Mapping[str, Any], operation_id: str, actor: str = "system") -> ReceiptRecord:
        with self._tx() as db:
            row = self._receipt_row(db, receipt_id)
            return self._move(db, row, ReceiptState.ACCEPTED, actor, "receipt.accepted", {
                "server_receipt_id": server_receipt_id, "server_date": server_date,
                "server_signature_json": fdms_json.dumps(dict(server_signature)), "last_operation_id": operation_id},
                {"serverReceiptId": server_receipt_id, "operationId": operation_id})

    def mark_rejected(self, receipt_id: int, error_code: str, operation_id: Optional[str] = None,
                      actor: str = "system") -> ReceiptRecord:
        with self._tx() as db:
            row = self._receipt_row(db, receipt_id)
            return self._move(db, row, ReceiptState.REJECTED, actor, "receipt.rejected",
                              {"error_code": error_code, "last_operation_id": operation_id},
                              {"errorCode": error_code})

    def mark_unknown(self, receipt_id: int, reason: str, actor: str = "system") -> ReceiptRecord:
        with self._tx() as db:
            row = self._receipt_row(db, receipt_id)
            return self._move(db, row, ReceiptState.UNKNOWN, actor, "receipt.unknown", None, {"reason": reason[:200]})

    # ------------------------------------------------------------------ audit
    def audit_verify(self, anchor: Optional[tuple] = None) -> audit.VerifyResult:
        with self._lock:
            return audit.verify(self._db, anchor)

    def audit_head(self) -> Optional[tuple]:
        with self._lock:
            return audit.head(self._db)


def _split_sql(script: str) -> List[str]:
    """Split on statement boundaries, keeping CREATE TRIGGER ... END; blocks whole."""
    out, buf, in_trigger = [], [], False
    for line in script.splitlines():
        s = line.strip()
        if not s:
            continue
        buf.append(line)
        if s.upper().startswith("CREATE TRIGGER"):
            in_trigger = True
        if in_trigger:
            if s.rstrip(";").upper().endswith("END"):
                out.append("\n".join(buf)); buf, in_trigger = [], False
        elif s.endswith(";"):
            out.append("\n".join(buf)); buf = []
    if buf:
        out.append("\n".join(buf))
    return out
