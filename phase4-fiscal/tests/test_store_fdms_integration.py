"""P5 integration: FiscalStore + FdmsClient + FdmsSimulator (Phase 4 / P5).

Proves the ledger survives the failure modes the Plan names: lost replies,
crash between intent and send, close-day races. Glue code here is a sketch of
what P8/P9 will do; it is deliberately explicit about every state change.
"""

import base64
import hashlib
from datetime import datetime

import pytest

from fiscal_core.fdms_client import FdmsClient, FiscalDayStatus as S
from fiscal_core.fdms_errors import FdmsRejectedError, FdmsServerError, FdmsTransportError, FdmsUnknownOutcomeError
from fiscal_core.state import DayEvent as E, DayState as D, ReceiptState as R
from fiscal_core.store import FiscalStore, OrderingError

from .conftest import DEVICE_ID, sample_receipt

OPENED = datetime(2026, 9, 30, 8, 0, 0)
SIG = {"hash": base64.b64encode(b"h" * 32).decode(), "signature": base64.b64encode(b"s" * 64).decode()}
COUNTER = {"fiscalCounterType": "SaleByTax", "fiscalCounterCurrency": "USD", "fiscalCounterTaxID": 3,
           "fiscalCounterValue": 1}


@pytest.fixture
def store():
    s = FiscalStore(":memory:")
    s.register_device(DEVICE_ID, "SN-001")
    yield s
    s.close()


def open_day(store, client):
    """Intent first, then network, then confirm: the order P9 must follow."""
    no = store.begin_open_day(DEVICE_ID, OPENED)
    try:
        client.open_day(OPENED, no)
    except FdmsRejectedError:
        store.day_event(DEVICE_ID, E.OPEN_REJECTED)
        raise
    except FdmsUnknownOutcomeError:
        return no                                  # stay OPEN_PENDING; reconcile later
    store.day_event(DEVICE_ID, E.OPEN_CONFIRMED)
    return no


def reconcile(store, client):
    st = client.get_status()
    return store.apply_reconciliation(DEVICE_ID, st.fiscal_day_status, st.last_fiscal_day_no)


def issue(store, client, send=True):
    """reserve -> sign -> submit. `send=False` simulates a crash after signing."""
    r = store.reserve_receipt(DEVICE_ID, "USD", {"items": []})
    wire = sample_receipt(r.receipt_global_no, r.receipt_counter, tag="t")
    r = store.attach_signed(r.id, wire, wire["receiptDeviceSignature"]["hash"])
    if send:
        submit(store, client, r)
    return r


def submit(store, client, r):
    store.begin_submit(r.id)
    try:
        resp = client.submit_receipt(dict(r.payload))
    except (FdmsUnknownOutcomeError, FdmsTransportError, FdmsServerError) as exc:
        # An idempotent call whose retries ran out raises Transport/Server errors, not UnknownOutcome.
        # Either way FDMS MAY have processed the receipt, so it is UNKNOWN, never "failed".
        store.mark_unknown(r.id, type(exc).__name__)
        raise
    except FdmsRejectedError as e:
        store.mark_rejected(r.id, e.error_code or "?")
        raise
    return store.mark_accepted(r.id, resp.receipt_id, resp.server_date, resp.server_signature, resp.operation_id)


class TestOpenDay:
    def test_normal_open(self, store, client):
        assert open_day(store, client) == 1
        assert store.current_day(DEVICE_ID).state is D.OPENED

    def test_lost_reply_leaves_open_pending_then_reconcile_confirms(self, store, client, sim):
        sim.inject_fault("openDay", lost_reply=True)
        open_day(store, client)
        assert store.current_day(DEVICE_ID).state is D.OPEN_PENDING
        with pytest.raises(Exception):                       # cannot issue while unresolved
            store.reserve_receipt(DEVICE_ID, "USD", {})
        res = reconcile(store, client)
        assert res.kind.value == "ADOPT" and store.current_day(DEVICE_ID).state is D.OPENED
        assert store.reserve_receipt(DEVICE_ID, "USD", {}).receipt_global_no == 1

    def test_dropped_request_reconciles_to_never_applied_then_retry_uses_same_day_number(self, store, client, sim):
        sim.inject_fault("openDay", drop_before=True)
        open_day(store, client)
        reconcile(store, client)
        assert store.current_day(DEVICE_ID).state is D.CLOSED
        assert open_day(store, client) == 1
        assert store.current_day(DEVICE_ID).state is D.OPENED
        assert sim.devices[DEVICE_ID].day_no == 1

    def test_server_rejection_rolls_local_state_back(self, store, client, sim):
        sim.devices[DEVICE_ID].active = False
        with pytest.raises(FdmsRejectedError):
            open_day(store, client)
        assert store.current_day(DEVICE_ID).state is D.CLOSED


class TestReceipts:
    def test_issue_and_accept(self, store, client):
        open_day(store, client)
        r = issue(store, client)
        got = store.get_receipt(r.id)
        assert got.state is R.ACCEPTED and got.server_receipt_id == 1000
        assert store.audit_verify().ok

    def test_one_lost_reply_is_absorbed_by_the_clients_idempotent_retry(self, store, client, sim):
        open_day(store, client)
        sim.inject_fault("submitReceipt", lost_reply=True, times=1)
        r = issue(store, client)
        assert store.get_receipt(r.id).state is R.ACCEPTED and len(sim.devices[DEVICE_ID].receipts) == 1

    def test_exhausted_retries_become_unknown_then_resubmit_keeps_one_server_receipt(self, store, client, sim):
        open_day(store, client)
        sim.inject_fault("submitReceipt", lost_reply=True, times=3)       # every attempt processed, none answered
        r = issue(store, client, send=False)
        with pytest.raises(FdmsTransportError):
            submit(store, client, r)
        assert store.get_receipt(r.id).state is R.UNKNOWN
        assert len(sim.devices[DEVICE_ID].receipts) == 1                  # FDMS did process it, exactly once
        done = submit(store, client, store.get_receipt(r.id))
        assert done.state is R.ACCEPTED and done.server_receipt_id == 1000
        assert len(sim.devices[DEVICE_ID].receipts) == 1

    def test_server_500s_exhausted_also_become_unknown(self, store, client, sim):
        open_day(store, client)
        sim.inject_fault("submitReceipt", status=502, times=3)
        r = issue(store, client, send=False)
        with pytest.raises(FdmsServerError):
            submit(store, client, r)
        assert store.get_receipt(r.id).state is R.UNKNOWN

    def test_unknown_receipt_blocks_next_then_resubmit_resolves(self, store, client, sim):
        open_day(store, client)
        a = issue(store, client, send=False)
        b = issue(store, client, send=False)
        # make `a` UNKNOWN by hand: server processed it but we never saw the reply
        store.begin_submit(a.id)
        client.submit_receipt(dict(store.get_receipt(a.id).payload))
        store.mark_unknown(a.id, "lost reply")
        with pytest.raises(OrderingError):
            store.begin_submit(b.id)
        done = submit(store, client, store.get_receipt(a.id))             # UNKNOWN -> SUBMITTING -> ACCEPTED
        assert done.state is R.ACCEPTED
        assert len(sim.devices[DEVICE_ID].receipts) == 1                  # server never minted a duplicate
        assert submit(store, client, store.get_receipt(b.id)).state is R.ACCEPTED
        assert [x.receipt_global_no for x in store.list_receipts(DEVICE_ID, states=[R.ACCEPTED])] == [1, 2]

    def test_crash_after_sign_before_send_recovers_with_same_numbers(self, store, client):
        open_day(store, client)
        r = issue(store, client, send=False)                 # process "dies" here
        again = store.next_to_submit(DEVICE_ID)
        assert again.id == r.id and again.state is R.SIGNED and again.receipt_global_no == 1
        assert submit(store, client, again).state is R.ACCEPTED

    def test_rejected_receipt_is_recorded_and_next_proceeds(self, store, client, sim):
        open_day(store, client)
        sim.inject_fault("submitReceipt", status=422, error_code="RCPT020")
        r = issue(store, client, send=False)
        with pytest.raises(FdmsRejectedError):
            submit(store, client, r)
        assert store.get_receipt(r.id).state is R.REJECTED and store.get_receipt(r.id).error_code == "RCPT020"
        assert issue(store, client).receipt_global_no == 2


class TestCloseDay:
    def close(self, store, client):
        store.day_event(DEVICE_ID, E.CLOSE_SENT)
        try:
            client.close_day(1, [COUNTER], SIG, store.current_day(DEVICE_ID) and 1)
        except FdmsRejectedError:
            store.day_event(DEVICE_ID, E.CLOSE_REJECTED)
            raise
        except FdmsUnknownOutcomeError:
            return
        store.day_event(DEVICE_ID, E.CLOSE_ACCEPTED)

    def test_full_day_lifecycle_and_next_day_number(self, store, client, sim):
        open_day(store, client)
        issue(store, client)
        self.close(store, client)
        sim.finish_close()
        reconcile(store, client)
        assert store.current_day(DEVICE_ID).state is D.CLOSED and store.last_closed_day_no(DEVICE_ID) == 1
        assert open_day(store, client) == 2
        assert issue(store, client).receipt_global_no == 2 and store.list_receipts(DEVICE_ID, 2)[0].receipt_counter == 1
        assert store.audit_verify().ok

    def test_lost_close_reply_reconciles_forward(self, store, client, sim):
        open_day(store, client)
        issue(store, client)
        sim.inject_fault("closeDay", lost_reply=True)
        self.close(store, client)
        assert store.current_day(DEVICE_ID).state is D.CLOSE_PENDING
        reconcile(store, client)
        assert store.current_day(DEVICE_ID).state is D.CLOSE_INITIATED
        sim.finish_close()
        reconcile(store, client)
        assert store.current_day(DEVICE_ID).state is D.CLOSED

    def test_dropped_close_request_reverts_to_opened(self, store, client, sim):
        open_day(store, client)
        sim.inject_fault("closeDay", drop_before=True)
        self.close(store, client)
        reconcile(store, client)
        assert store.current_day(DEVICE_ID).state is D.OPENED
        assert issue(store, client).receipt_global_no == 1

    def test_close_failed_still_accepts_receipts_then_recloses(self, store, client, sim):
        sim.close_outcome = "counters_mismatch"
        open_day(store, client)
        self.close(store, client)
        sim.finish_close()
        reconcile(store, client)
        assert store.current_day(DEVICE_ID).state is D.CLOSE_FAILED
        issue(store, client)                                   # spec 4.7: allowed in CloseFailed
        sim.close_outcome = "success"
        store.day_event(DEVICE_ID, E.CLOSE_SENT)               # re-close attempt is legal from CLOSE_FAILED
        assert store.current_day(DEVICE_ID).state is D.CLOSE_PENDING

    def test_someone_else_closed_our_day_is_a_conflict_that_halts_issuing(self, store, client, sim):
        open_day(store, client)
        d = sim.devices[DEVICE_ID]
        d.day_status, d.last_closed_no = S.CLOSED, 1          # closed behind our back (e.g. FDMS portal)
        res = reconcile(store, client)
        assert res.kind.value == "CONFLICT"
        with pytest.raises(Exception):
            store.reserve_receipt(DEVICE_ID, "USD", {})
        store.resolve_conflict(DEVICE_ID, "kuda", "closed via FDMS self-service; ledger corrected by hand")
        assert store.audit_verify().ok

    def test_audit_chain_covers_the_whole_scenario(self, store, client, sim):
        open_day(store, client)
        issue(store, client)
        self.close(store, client)
        sim.finish_close()
        reconcile(store, client)
        n = store.audit_verify().rows_checked
        assert n == 11 and store.audit_verify(anchor=store.audit_head()).ok
