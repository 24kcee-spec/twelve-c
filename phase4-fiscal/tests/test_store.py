"""Tests for store.py (Phase 4 / P5): durable ledger, constraints, ordering, atomicity."""

import base64
import hashlib
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from fiscal_core import audit
from fiscal_core.fdms_client import FiscalDayStatus as S
from fiscal_core.state import DayEvent as E, DayState as D, IllegalTransition, ReceiptState as R
from fiscal_core.store import (
    DayExpiredError, DayNotOpenError, DeviceConflictError, FiscalStore, OrderingError, StoreError)

DEV = 187
OPENED = datetime(2026, 9, 30, 8, 0, 0)


def h(tag):
    return base64.b64encode(hashlib.sha256(tag.encode()).digest()).decode()


def payload(g, c):
    return {"receiptGlobalNo": g, "receiptCounter": c, "receiptTotal": Decimal("10.00")}


@pytest.fixture
def store():
    s = FiscalStore(":memory:")
    s.register_device(DEV, "SN-001")
    yield s
    s.close()


@pytest.fixture
def day(store):
    store.begin_open_day(DEV, OPENED)
    store.day_event(DEV, E.OPEN_CONFIRMED)
    return store


def sign(store, r):
    return store.attach_signed(r.id, payload(r.receipt_global_no, r.receipt_counter), h(f"r{r.id}"))


def full_cycle(store):
    r = store.reserve_receipt(DEV, "USD", {"lines": []})
    r = sign(store, r)
    store.begin_submit(r.id)
    return store.mark_accepted(r.id, 1000 + r.receipt_global_no, "2026-09-30T08:01:00", {"hash": "h", "signature": "s"}, "OP")


class TestDevicesAndDays:
    def test_register_twice_refused(self, store):
        with pytest.raises(StoreError):
            store.register_device(DEV, "SN-001")

    def test_unknown_device_refused(self, store):
        with pytest.raises(StoreError):
            store.begin_open_day(999, OPENED)

    def test_first_day_is_one_and_pending(self, store):
        assert store.begin_open_day(DEV, OPENED) == 1
        d = store.current_day(DEV)
        assert d.state is D.OPEN_PENDING and d.fiscal_day_no == 1 and d.opened_local == "2026-09-30T08:00:00"

    def test_aware_datetime_refused(self, store):
        with pytest.raises(StoreError, match="naive"):
            store.begin_open_day(DEV, datetime(2026, 9, 30, tzinfo=timezone.utc))

    def test_cannot_open_while_a_day_is_not_closed(self, day):
        with pytest.raises(DayNotOpenError):
            day.begin_open_day(DEV, OPENED)

    def test_open_sent_event_is_not_a_public_event(self, store):
        with pytest.raises(StoreError):
            store.day_event(DEV, E.OPEN_SENT)

    def test_event_without_any_day_refused(self, store):
        with pytest.raises(DayNotOpenError):
            store.day_event(DEV, E.OPEN_CONFIRMED)

    def test_illegal_event_raises_and_changes_nothing(self, day):
        before = day.audit_head()
        with pytest.raises(IllegalTransition):
            day.day_event(DEV, E.CLOSE_DONE)
        assert day.current_day(DEV).state is D.OPENED and day.audit_head() == before

    def test_open_rejected_returns_to_closed_and_retry_reuses_the_same_number(self, store):
        assert store.begin_open_day(DEV, OPENED) == 1
        store.day_event(DEV, E.OPEN_REJECTED)
        d = store.current_day(DEV)
        assert d.state is D.CLOSED and d.closed_utc is None
        assert store.last_closed_day_no(DEV) is None          # a day that never opened is not a closed day
        assert store.begin_open_day(DEV, OPENED + timedelta(minutes=5)) == 1      # FDMS still expects day 1
        d = store.current_day(DEV)
        assert d.state is D.OPEN_PENDING and d.opened_local == "2026-09-30T08:05:00"
        store.day_event(DEV, E.OPEN_CONFIRMED)
        assert store.reserve_receipt(DEV, "USD", {}).fiscal_day_no == 1
        assert store.audit_verify().ok

    def test_rejected_open_after_a_real_day_reuses_next_number(self, day):
        for ev in (E.CLOSE_SENT, E.CLOSE_ACCEPTED, E.CLOSE_DONE):
            day.day_event(DEV, ev)
        assert day.begin_open_day(DEV, OPENED) == 2
        day.day_event(DEV, E.OPEN_REJECTED)
        assert day.last_closed_day_no(DEV) == 1
        assert day.begin_open_day(DEV, OPENED) == 2

    def test_a_really_closed_day_stays_immutable(self, day):
        for ev in (E.CLOSE_SENT, E.CLOSE_ACCEPTED, E.CLOSE_DONE):
            day.day_event(DEV, ev)
        with pytest.raises(sqlite3.IntegrityError):
            day._db.execute("UPDATE fiscal_days SET opened_local='2000-01-01T00:00:00'")

    def test_day_numbers_follow_last_day(self, day):
        day.day_event(DEV, E.CLOSE_SENT)
        day.day_event(DEV, E.CLOSE_ACCEPTED)
        day.day_event(DEV, E.CLOSE_DONE)
        assert day.last_closed_day_no(DEV) == 1 and day.current_day(DEV).closed_utc
        assert day.begin_open_day(DEV, OPENED + timedelta(days=1)) == 2

    def test_close_rejected_reverts_to_previous_state(self, day):
        day.day_event(DEV, E.CLOSE_SENT)
        assert day.current_day(DEV).resume_state is D.OPENED
        day.day_event(DEV, E.CLOSE_REJECTED)
        d = day.current_day(DEV)
        assert d.state is D.OPENED and d.resume_state is None


class TestReserve:
    def test_numbers_start_at_one_and_run_gap_free(self, day):
        rs = [day.reserve_receipt(DEV, "USD", {}) for _ in range(5)]
        assert [r.receipt_global_no for r in rs] == [1, 2, 3, 4, 5]
        assert [r.receipt_counter for r in rs] == [1, 2, 3, 4, 5]
        assert all(r.state is R.RESERVED for r in rs)

    def test_global_continues_across_days_counter_restarts(self, day):
        for _ in range(2):
            full_cycle(day)
        for ev in (E.CLOSE_SENT, E.CLOSE_ACCEPTED, E.CLOSE_DONE):
            day.day_event(DEV, ev)
        day.begin_open_day(DEV, OPENED + timedelta(days=1))
        day.day_event(DEV, E.OPEN_CONFIRMED)
        r = day.reserve_receipt(DEV, "USD", {})
        assert (r.fiscal_day_no, r.receipt_global_no, r.receipt_counter) == (2, 3, 1)

    def test_two_devices_number_independently(self, day):
        day.register_device(2, "SN-2")
        day.begin_open_day(2, OPENED)
        day.day_event(2, E.OPEN_CONFIRMED)
        a, b = day.reserve_receipt(DEV, "USD", {}), day.reserve_receipt(2, "USD", {})
        assert a.receipt_global_no == 1 and b.receipt_global_no == 1

    def test_no_day_refused(self, store):
        with pytest.raises(DayNotOpenError):
            store.reserve_receipt(DEV, "USD", {})

    @pytest.mark.parametrize("events", [[], [E.CLOSE_SENT], [E.CLOSE_SENT, E.CLOSE_ACCEPTED]])
    def test_refused_unless_opened_or_close_failed(self, day, events):
        for ev in events:
            day.day_event(DEV, ev)
        if events:
            with pytest.raises(DayNotOpenError):
                day.reserve_receipt(DEV, "USD", {})
        else:
            day.reserve_receipt(DEV, "USD", {})

    def test_pending_open_refused(self, store):
        store.begin_open_day(DEV, OPENED)
        with pytest.raises(DayNotOpenError):
            store.reserve_receipt(DEV, "USD", {})

    def test_allowed_in_close_failed(self, day):
        for ev in (E.CLOSE_SENT, E.CLOSE_ACCEPTED, E.CLOSE_FAILED):
            day.day_event(DEV, ev)
        assert day.reserve_receipt(DEV, "USD", {}).receipt_counter == 1

    def test_day_max_hours_enforced(self, day):
        day.reserve_receipt(DEV, "USD", {}, day_max_hours=24, now_local=OPENED + timedelta(hours=23, minutes=59))
        with pytest.raises(DayExpiredError):
            day.reserve_receipt(DEV, "USD", {}, day_max_hours=24, now_local=OPENED + timedelta(hours=24))
        assert len(day.list_receipts(DEV)) == 1

    @pytest.mark.parametrize("cur", ["US", "USDX", "12$", "", None, 5])
    def test_bad_currency_refused(self, day, cur):
        with pytest.raises(StoreError):
            day.reserve_receipt(DEV, cur, {})

    def test_float_in_intent_refused_and_nothing_consumed(self, day):
        with pytest.raises(TypeError):
            day.reserve_receipt(DEV, "USD", {"total": 1.5})
        assert day.reserve_receipt(DEV, "USD", {}).receipt_global_no == 1

    def test_intent_roundtrips_with_exact_decimals(self, day):
        r = day.reserve_receipt(DEV, "usd", {"total": Decimal("115.10")})
        got = day.get_receipt(r.id)
        assert got.currency == "USD" and str(got.intent["total"]) == "115.10"


class TestDatabaseConstraints:
    def test_duplicate_global_number_rejected_by_database(self, day):
        r = day.reserve_receipt(DEV, "USD", {})
        with pytest.raises(sqlite3.IntegrityError):
            day._db.execute(
                "INSERT INTO receipts (device_id,fiscal_day_no,receipt_global_no,receipt_counter,currency,intent_json,state,created_utc,updated_utc)"
                " VALUES (?,?,?,?,?,?,?,?,?)", (DEV, 1, r.receipt_global_no, 9, "USD", "{}", "RESERVED", "t", "t"))

    def test_duplicate_counter_in_day_rejected_by_database(self, day):
        r = day.reserve_receipt(DEV, "USD", {})
        with pytest.raises(sqlite3.IntegrityError):
            day._db.execute(
                "INSERT INTO receipts (device_id,fiscal_day_no,receipt_global_no,receipt_counter,currency,intent_json,state,created_utc,updated_utc)"
                " VALUES (?,?,?,?,?,?,?,?,?)", (DEV, 1, 99, r.receipt_counter, "USD", "{}", "RESERVED", "t", "t"))

    def test_receipt_for_missing_day_rejected_by_database(self, day):
        with pytest.raises(sqlite3.IntegrityError):
            day._db.execute(
                "INSERT INTO receipts (device_id,fiscal_day_no,receipt_global_no,receipt_counter,currency,intent_json,state,created_utc,updated_utc)"
                " VALUES (?,?,?,?,?,?,?,?,?)", (DEV, 42, 1, 1, "USD", "{}", "RESERVED", "t", "t"))

    def test_receipts_cannot_be_deleted(self, day):
        day.reserve_receipt(DEV, "USD", {})
        with pytest.raises(sqlite3.IntegrityError, match="never deleted"):
            day._db.execute("DELETE FROM receipts")

    def test_fiscal_days_cannot_be_deleted(self, day):
        with pytest.raises(sqlite3.IntegrityError, match="never deleted"):
            day._db.execute("DELETE FROM fiscal_days")

    @pytest.mark.parametrize("col,val", [("receipt_global_no", 77), ("receipt_counter", 77), ("currency", "ZWG"),
                                         ("intent_json", "{}"), ("device_id", 5), ("fiscal_day_no", 9)])
    def test_identity_columns_immutable(self, day, col, val):
        r = day.reserve_receipt(DEV, "USD", {"a": 1})
        with pytest.raises(sqlite3.IntegrityError):
            day._db.execute(f"UPDATE receipts SET {col}=? WHERE id=?", (val, r.id))

    def test_signed_payload_and_hash_immutable(self, day):
        r = sign(day, day.reserve_receipt(DEV, "USD", {}))
        with pytest.raises(sqlite3.IntegrityError):
            day._db.execute("UPDATE receipts SET payload_json='{}' WHERE id=?", (r.id,))
        with pytest.raises(sqlite3.IntegrityError):
            day._db.execute("UPDATE receipts SET receipt_hash='x' WHERE id=?", (r.id,))

    def test_terminal_state_cannot_change_even_by_raw_sql(self, day):
        r = full_cycle(day)
        with pytest.raises(sqlite3.IntegrityError):
            day._db.execute("UPDATE receipts SET state='REJECTED' WHERE id=?", (r.id,))
        with pytest.raises(sqlite3.IntegrityError):
            day._db.execute("UPDATE receipts SET server_receipt_id=1 WHERE id=?", (r.id,))

    def test_bad_state_value_rejected(self, day):
        r = day.reserve_receipt(DEV, "USD", {})
        with pytest.raises(sqlite3.IntegrityError):
            day._db.execute("UPDATE receipts SET state='DONE' WHERE id=?", (r.id,))

    def test_day_identity_immutable(self, day):
        with pytest.raises(sqlite3.IntegrityError):
            day._db.execute("UPDATE fiscal_days SET opened_local='2000-01-01T00:00:00'")


class TestReceiptLifecycle:
    def test_attach_signed_checks_hash_and_numbers(self, day):
        r = day.reserve_receipt(DEV, "USD", {})
        with pytest.raises(StoreError, match="base64"):
            day.attach_signed(r.id, payload(1, 1), "!!!")
        with pytest.raises(StoreError, match="32 bytes"):
            day.attach_signed(r.id, payload(1, 1), base64.b64encode(b"short").decode())
        with pytest.raises(StoreError, match="do not match"):
            day.attach_signed(r.id, payload(2, 1), h("x"))
        with pytest.raises(StoreError, match="do not match"):
            day.attach_signed(r.id, payload(1, 2), h("x"))
        assert day.get_receipt(r.id).state is R.RESERVED

    def test_cannot_sign_twice(self, day):
        r = sign(day, day.reserve_receipt(DEV, "USD", {}))
        with pytest.raises(IllegalTransition):
            sign(day, r)

    def test_cannot_submit_unsigned(self, day):
        r = day.reserve_receipt(DEV, "USD", {})
        with pytest.raises(IllegalTransition):
            day.begin_submit(r.id)

    def test_accepted_stores_server_fields(self, day):
        r = full_cycle(day)
        assert r.state is R.ACCEPTED and r.server_receipt_id == 1001 and r.last_operation_id == "OP"
        assert r.server_signature == {"hash": "h", "signature": "s"} and r.payload["receiptGlobalNo"] == 1
        assert str(r.payload["receiptTotal"]) == "10.00"

    def test_rejected_is_terminal_and_keeps_its_number(self, day):
        a = sign(day, day.reserve_receipt(DEV, "USD", {}))
        day.begin_submit(a.id)
        day.mark_rejected(a.id, "RCPT020", "OP9")
        with pytest.raises(IllegalTransition):
            day.begin_submit(a.id)
        assert day.reserve_receipt(DEV, "USD", {}).receipt_global_no == 2
        assert day.get_receipt(a.id).error_code == "RCPT020"

    def test_unknown_can_be_retried_or_resolved(self, day):
        r = sign(day, day.reserve_receipt(DEV, "USD", {}))
        day.begin_submit(r.id)
        day.mark_unknown(r.id, "timeout")
        assert day.begin_submit(r.id).state is R.SUBMITTING          # idempotent resubmit (spec 4.7)
        day.mark_unknown(r.id, "timeout again")
        assert day.mark_accepted(r.id, 5, "d", {"hash": "h", "signature": "s"}, "OP").state is R.ACCEPTED

    def test_mark_unknown_requires_submitting(self, day):
        r = sign(day, day.reserve_receipt(DEV, "USD", {}))
        with pytest.raises(IllegalTransition):
            day.mark_unknown(r.id, "x")

    def test_missing_receipt(self, day):
        with pytest.raises(StoreError):
            day.get_receipt(12345)


class TestOrdering:
    def test_cannot_submit_ahead_of_an_unresolved_lower_number(self, day):
        a = sign(day, day.reserve_receipt(DEV, "USD", {}))
        b = sign(day, day.reserve_receipt(DEV, "USD", {}))
        with pytest.raises(OrderingError, match="receipt 1"):
            day.begin_submit(b.id)
        day.begin_submit(a.id)
        with pytest.raises(OrderingError):            # a is SUBMITTING, still unresolved
            day.begin_submit(b.id)
        day.mark_accepted(a.id, 1, "d", {"hash": "h", "signature": "s"}, "OP")
        assert day.begin_submit(b.id).state is R.SUBMITTING

    def test_unknown_blocks_later_numbers(self, day):
        a = sign(day, day.reserve_receipt(DEV, "USD", {}))
        b = sign(day, day.reserve_receipt(DEV, "USD", {}))
        day.begin_submit(a.id)
        day.mark_unknown(a.id, "timeout")
        with pytest.raises(OrderingError):
            day.begin_submit(b.id)

    def test_reserved_but_unsigned_blocks_later_numbers(self, day):
        day.reserve_receipt(DEV, "USD", {})           # crash before signing
        b = sign(day, day.reserve_receipt(DEV, "USD", {}))
        with pytest.raises(OrderingError):
            day.begin_submit(b.id)

    def test_rejected_does_not_block(self, day):
        a = sign(day, day.reserve_receipt(DEV, "USD", {}))
        b = sign(day, day.reserve_receipt(DEV, "USD", {}))
        day.begin_submit(a.id)
        day.mark_rejected(a.id, "RCPT011")
        assert day.begin_submit(b.id).state is R.SUBMITTING

    def test_next_to_submit_is_lowest_unresolved(self, day):
        assert day.next_to_submit(DEV) is None
        a = day.reserve_receipt(DEV, "USD", {})
        day.reserve_receipt(DEV, "USD", {})
        assert day.next_to_submit(DEV).id == a.id
        sign(day, a); day.begin_submit(a.id)
        day.mark_accepted(a.id, 1, "d", {"hash": "h", "signature": "s"}, "OP")
        assert day.next_to_submit(DEV).receipt_global_no == 2

    def test_list_filters(self, day):
        a = sign(day, day.reserve_receipt(DEV, "USD", {}))
        day.reserve_receipt(DEV, "USD", {})
        assert [r.receipt_global_no for r in day.list_receipts(DEV)] == [1, 2]
        assert [r.receipt_global_no for r in day.list_receipts(DEV, states=[R.SIGNED])] == [1]
        assert day.list_receipts(DEV, fiscal_day_no=2) == []


class TestCloseGate:
    def test_cannot_start_close_with_unresolved_receipts(self, day):
        day.reserve_receipt(DEV, "USD", {})
        before = day.current_day(DEV)
        with pytest.raises(StoreError, match="not yet resolved"):
            day.day_event(DEV, E.CLOSE_SENT)
        assert day.current_day(DEV) == before

    def test_close_allowed_once_all_receipts_resolved(self, day):
        full_cycle(day)
        assert day.day_event(DEV, E.CLOSE_SENT).state is D.CLOSE_PENDING


class TestConflict:
    def conflict(self, day):
        res = day.apply_reconciliation(DEV, S.CLOSED, 1)           # we think OPENED, server says CLOSED
        assert res.kind.value == "CONFLICT"

    def test_conflict_blocks_everything_that_issues(self, day):
        r = sign(day, day.reserve_receipt(DEV, "USD", {}))
        self.conflict(day)
        for call in (lambda: day.reserve_receipt(DEV, "USD", {}), lambda: day.begin_submit(r.id),
                     lambda: day.day_event(DEV, E.CLOSE_SENT), lambda: day.begin_open_day(DEV, OPENED)):
            with pytest.raises(DeviceConflictError):
                call()
        assert "OPENED" in day.device_conflict(DEV)

    def test_resolve_requires_note_and_a_conflict(self, day):
        with pytest.raises(StoreError, match="no conflict"):
            day.resolve_conflict(DEV, "kuda", "x")
        self.conflict(day)
        with pytest.raises(StoreError, match="note"):
            day.resolve_conflict(DEV, "kuda", "  ")
        day.resolve_conflict(DEV, "kuda", "checked FDMS portal; day was closed manually")
        assert day.device_conflict(DEV) is None
        assert day.audit_verify().ok


class TestReconciliationApply:
    def test_open_pending_confirmed(self, store):
        store.begin_open_day(DEV, OPENED)
        res = store.apply_reconciliation(DEV, S.OPENED, 1)
        assert res.kind.value == "ADOPT" and store.current_day(DEV).state is D.OPENED

    def test_open_pending_never_applied(self, store):
        store.begin_open_day(DEV, OPENED)
        store.apply_reconciliation(DEV, S.CLOSED, None)
        assert store.current_day(DEV).state is D.CLOSED

    def test_close_pending_to_closed_sets_last_closed(self, day):
        day.day_event(DEV, E.CLOSE_SENT)
        day.apply_reconciliation(DEV, S.CLOSED, 1)
        assert day.current_day(DEV).state is D.CLOSED and day.last_closed_day_no(DEV) == 1

    def test_close_pending_to_close_failed_then_receipts_allowed(self, day):
        day.day_event(DEV, E.CLOSE_SENT)
        day.apply_reconciliation(DEV, S.CLOSE_FAILED, 1)
        assert day.reserve_receipt(DEV, "USD", {}).receipt_global_no == 1

    def test_agreement_changes_nothing_but_is_audited(self, day):
        res = day.apply_reconciliation(DEV, S.OPENED, 1)
        assert res.kind.value == "NOOP" and day.current_day(DEV).state is D.OPENED

    def test_no_local_day_but_server_has_one_flags_device(self, store):
        res = store.apply_reconciliation(DEV, S.OPENED, 4)
        assert res.kind.value == "CONFLICT" and store.device_conflict(DEV)


class TestDurability:
    def test_state_survives_reopen(self, tmp_path):
        path = str(tmp_path / "ledger.sqlite")
        s = FiscalStore(path)
        s.register_device(DEV, "SN-001")
        s.begin_open_day(DEV, OPENED)
        s.day_event(DEV, E.OPEN_CONFIRMED)
        r = s.reserve_receipt(DEV, "USD", {"k": Decimal("2.10")})
        s.close()

        s2 = FiscalStore(path)
        assert s2.current_day(DEV).state is D.OPENED
        back = s2.get_receipt(r.id)
        assert back.state is R.RESERVED and str(back.intent["k"]) == "2.10"
        assert s2.reserve_receipt(DEV, "USD", {}).receipt_global_no == 2     # numbering continues
        assert s2.audit_verify().ok
        s2.close()

    def test_newer_schema_refused(self, tmp_path):
        path = str(tmp_path / "ledger.sqlite")
        FiscalStore(path).close()
        c = sqlite3.connect(path)
        c.execute("PRAGMA user_version = 99")
        c.close()
        with pytest.raises(StoreError, match="newer"):
            FiscalStore(path)

    def test_wal_and_full_sync_on_file_databases(self, tmp_path):
        s = FiscalStore(str(tmp_path / "l.sqlite"))
        assert s._db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert s._db.execute("PRAGMA synchronous").fetchone()[0] == 2        # FULL
        assert s._db.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        s.close()


class TestConcurrency:
    def test_threads_never_get_duplicate_or_missing_numbers(self, tmp_path):
        path = str(tmp_path / "c.sqlite")
        s = FiscalStore(path)
        s.register_device(DEV, "SN-001")
        s.begin_open_day(DEV, OPENED)
        s.day_event(DEV, E.OPEN_CONFIRMED)
        s.close()
        got, errors = [], []

        def worker():
            try:
                st = FiscalStore(path)               # separate connection per thread = separate "process"
                for _ in range(10):
                    got.append(st.reserve_receipt(DEV, "USD", {}).receipt_global_no)
                st.close()
            except Exception as exc:                 # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=worker) for _ in range(6)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert not errors
        assert sorted(got) == list(range(1, 61))
        v = FiscalStore(path)
        assert v.audit_verify().ok and v.audit_verify().rows_checked == 3 + 60
        v.close()

    def test_shared_connection_threads_are_serialised(self, day):
        got = []
        t = [threading.Thread(target=lambda: got.extend(day.reserve_receipt(DEV, "USD", {}).receipt_global_no
                                                        for _ in range(10))) for _ in range(5)]
        [x.start() for x in t]
        [x.join() for x in t]
        assert sorted(got) == list(range(1, 51))


class TestAtomicity:
    def test_audit_failure_rolls_back_the_change(self, day, monkeypatch):
        monkeypatch.setattr(audit, "append", lambda *a, **k: (_ for _ in ()).throw(audit.AuditError("boom")))
        with pytest.raises(audit.AuditError):
            day.reserve_receipt(DEV, "USD", {})
        monkeypatch.undo()
        assert day.list_receipts(DEV) == []
        assert day.reserve_receipt(DEV, "USD", {}).receipt_global_no == 1      # no number was burned
        assert day.audit_verify().ok

    def test_every_mutation_is_audited_and_chain_verifies(self, day):
        full_cycle(day)
        for ev in (E.CLOSE_SENT, E.CLOSE_ACCEPTED, E.CLOSE_DONE):
            day.day_event(DEV, ev)
        events = [r[0] for r in day._db.execute("SELECT event FROM audit_log ORDER BY seq")]
        assert events == ["device.registered", "day.open_sent", "day.open_confirmed", "receipt.reserved",
                          "receipt.signed", "receipt.submitting", "receipt.accepted",
                          "day.close_sent", "day.close_accepted", "day.close_done"]
        assert day.audit_verify().ok

    def test_no_secrets_or_payload_bodies_in_audit(self, day):
        r = sign(day, day.reserve_receipt(DEV, "USD", {"buyer": "Jane Doe"}))
        text = " ".join(x[0] for x in day._db.execute("SELECT detail_json FROM audit_log"))
        assert "Jane Doe" not in text and "PRIVATE" not in text

    def test_store_holds_no_secret_columns(self, store):
        cols = {r[1] for t in ("devices", "fiscal_days", "receipts") for r in store._db.execute(f"PRAGMA table_info({t})")}
        assert not [c for c in cols if any(w in c for w in ("key", "secret", "password", "cert", "activation"))]

    def test_stored_tamper_is_caught_by_audit_verify(self, day):
        full_cycle(day)
        day._db.execute("DROP TRIGGER audit_no_update")
        day._db.execute("UPDATE audit_log SET detail_json='{}' WHERE event='receipt.accepted'")
        assert not day.audit_verify().ok


class TestSourceHygiene:
    def test_no_float_in_new_modules(self):
        import pathlib
        base = pathlib.Path(__import__("fiscal_core").__file__).parent
        for n in ("state.py", "audit.py", "store.py"):
            assert "float(" not in (base / n).read_text(encoding="utf-8"), n

    def test_store_does_not_import_qpd_code(self):
        import pathlib
        base = pathlib.Path(__import__("fiscal_core").__file__).parent
        for n in ("state.py", "audit.py", "store.py"):
            assert "zimra_qpd" not in (base / n).read_text(encoding="utf-8"), n
