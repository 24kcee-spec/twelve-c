"""Tests for audit.py (Phase 4 / P5): hash-chained append-only log."""

import sqlite3

import pytest

from fiscal_core import audit


@pytest.fixture
def db():
    c = sqlite3.connect(":memory:", isolation_level=None)
    c.executescript(audit.SCHEMA)
    return c


def add(db, n=3):
    for i in range(n):
        audit.append(db, f"2026-09-30T08:0{i}:00.000000Z", "tester", "test.event", 1, f"s:{i}", {"i": i})


class TestChain:
    def test_empty_log_verifies(self, db):
        assert audit.verify(db).ok and audit.head(db) is None

    def test_rows_chain_and_verify(self, db):
        add(db)
        r = audit.verify(db)
        assert r.ok and r.rows_checked == 3
        assert audit.head(db)[0] == 3

    def test_first_row_links_to_genesis(self, db):
        add(db, 1)
        assert db.execute("SELECT prev_hash FROM audit_log WHERE seq=1").fetchone()[0] == audit.GENESIS_HASH

    def test_each_row_links_to_previous(self, db):
        add(db)
        rows = db.execute("SELECT prev_hash, hash FROM audit_log ORDER BY seq").fetchall()
        assert rows[1][0] == rows[0][1] and rows[2][0] == rows[1][1]


class TestAppendOnly:
    def test_update_blocked(self, db):
        add(db)
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            db.execute("UPDATE audit_log SET actor='evil' WHERE seq=1")

    def test_delete_blocked(self, db):
        add(db)
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            db.execute("DELETE FROM audit_log WHERE seq=2")


class TestTamperDetection:
    def _drop_triggers(self, db):
        db.execute("DROP TRIGGER audit_no_update")
        db.execute("DROP TRIGGER audit_no_delete")

    def test_edited_field_detected(self, db):
        add(db)
        self._drop_triggers(db)
        db.execute("UPDATE audit_log SET detail_json='{\"i\":99}' WHERE seq=2")
        r = audit.verify(db)
        assert not r.ok and r.first_bad_seq == 2 and "hash" in r.reason

    def test_deleted_middle_row_detected(self, db):
        add(db)
        self._drop_triggers(db)
        db.execute("DELETE FROM audit_log WHERE seq=2")
        r = audit.verify(db)
        assert not r.ok and "gap" in r.reason

    def test_recomputed_row_breaks_next_link(self, db):
        add(db)
        self._drop_triggers(db)
        db.execute("UPDATE audit_log SET actor='evil' WHERE seq=1")
        row = db.execute("SELECT seq, ts_utc, actor, event, device_id, subject, detail_json, prev_hash FROM audit_log WHERE seq=1").fetchone()
        db.execute("UPDATE audit_log SET hash=? WHERE seq=1", (audit._digest(*row),))
        r = audit.verify(db)
        assert not r.ok and r.first_bad_seq == 2          # row 1 is now self-consistent, row 2 no longer links

    def test_tail_truncation_needs_external_anchor(self, db):
        add(db)
        anchor = audit.head(db)
        self._drop_triggers(db)
        db.execute("DELETE FROM audit_log WHERE seq=3")
        assert audit.verify(db).ok                          # honest limit: undetectable alone
        r = audit.verify(db, anchor=anchor)
        assert not r.ok and "anchor" in r.reason

    def test_anchor_mismatch_detected(self, db):
        add(db)
        r = audit.verify(db, anchor=(2, "f" * 64))
        assert not r.ok and r.first_bad_seq == 2

    def test_valid_anchor_passes(self, db):
        add(db)
        assert audit.verify(db, anchor=audit.head(db)).ok


class TestInputRules:
    @pytest.mark.parametrize("key", ["privateKey", "password", "activationKey", "certPem", "apiToken", "client_secret", "passphrase"])
    def test_secret_looking_keys_refused(self, db, key):
        with pytest.raises(audit.AuditError):
            audit.append(db, "t", "a", "x.y", 1, "s", {key: "v"})
        assert audit.head(db) is None

    def test_nested_secret_key_refused(self, db):
        with pytest.raises(audit.AuditError):
            audit.append(db, "t", "a", "x.y", 1, "s", {"ok": [{"deep": {"privateThing": 1}}]})

    def test_private_key_text_in_value_refused(self, db):
        with pytest.raises(audit.AuditError):
            audit.append(db, "t", "a", "x.y", 1, "s", {"note": "-----BEGIN PRIVATE KEY-----"})

    @pytest.mark.parametrize("actor,event", [("", "a.b"), ("x" * 65, "a.b"), ("ok", "Bad Event"), ("ok", ""), ("ok", "a" * 65)])
    def test_bad_actor_or_event_refused(self, db, actor, event):
        with pytest.raises(audit.AuditError):
            audit.append(db, "t", actor, event, 1, "s", {})

    def test_oversized_detail_refused(self, db):
        with pytest.raises(audit.AuditError):
            audit.append(db, "t", "a", "x.y", 1, "s", {"blob": "x" * 9000})

    def test_decimal_detail_is_stored_exactly_and_float_refused(self, db):
        from decimal import Decimal
        audit.append(db, "t", "a", "x.y", 1, "s", {"amount": Decimal("1.50")})
        assert '"amount":1.50' in db.execute("SELECT detail_json FROM audit_log").fetchone()[0]
        with pytest.raises(TypeError):
            audit.append(db, "t", "a", "x.y", 1, "s", {"amount": 1.5})

    def test_failed_append_leaves_chain_valid(self, db):
        add(db, 2)
        with pytest.raises(audit.AuditError):
            audit.append(db, "t", "a", "x.y", 1, "s", {"password": "x"})
        add(db, 1)
        assert audit.verify(db).ok
