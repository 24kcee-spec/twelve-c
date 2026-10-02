"""Tests for state.py (Phase 4 / P5): pure fiscal-day / receipt state machines + reconciliation."""

import itertools

import pytest

from fiscal_core.fdms_client import FiscalDayStatus as S
from fiscal_core.state import (
    DayEvent as E,
    DayState as D,
    IllegalTransition,
    ReceiptState as R,
    ResolutionKind as K,
    check_receipt_transition,
    next_day_state,
    reconcile,
)

LEGAL = {
    (D.CLOSED, E.OPEN_SENT): D.OPEN_PENDING,
    (D.OPEN_PENDING, E.OPEN_CONFIRMED): D.OPENED,
    (D.OPEN_PENDING, E.OPEN_REJECTED): D.CLOSED,
    (D.OPENED, E.CLOSE_SENT): D.CLOSE_PENDING,
    (D.CLOSE_FAILED, E.CLOSE_SENT): D.CLOSE_PENDING,
    (D.CLOSE_PENDING, E.CLOSE_ACCEPTED): D.CLOSE_INITIATED,
    (D.CLOSE_PENDING, E.CLOSE_DONE): D.CLOSED,
    (D.CLOSE_PENDING, E.CLOSE_FAILED): D.CLOSE_FAILED,
    (D.CLOSE_INITIATED, E.CLOSE_DONE): D.CLOSED,
    (D.CLOSE_INITIATED, E.CLOSE_FAILED): D.CLOSE_FAILED,
}


class TestDayMachine:
    @pytest.mark.parametrize("pair,target", list(LEGAL.items()))
    def test_every_legal_transition(self, pair, target):
        assert next_day_state(*pair) is target

    def test_every_other_pair_raises(self):
        for state, event in itertools.product(D, E):
            if (state, event) in LEGAL or event is E.CLOSE_REJECTED:
                continue
            with pytest.raises(IllegalTransition):
                next_day_state(state, event)

    @pytest.mark.parametrize("resume", [D.OPENED, D.CLOSE_FAILED])
    def test_close_rejected_reverts_to_resume_state(self, resume):
        assert next_day_state(D.CLOSE_PENDING, E.CLOSE_REJECTED, resume) is resume

    @pytest.mark.parametrize("resume", [None, D.CLOSED, D.CLOSE_PENDING])
    def test_close_rejected_without_valid_resume_raises(self, resume):
        with pytest.raises(IllegalTransition):
            next_day_state(D.CLOSE_PENDING, E.CLOSE_REJECTED, resume)

    def test_close_rejected_outside_pending_raises(self):
        with pytest.raises(IllegalTransition):
            next_day_state(D.OPENED, E.CLOSE_REJECTED, D.OPENED)

    def test_full_happy_path(self):
        s = D.CLOSED
        for ev in (E.OPEN_SENT, E.OPEN_CONFIRMED, E.CLOSE_SENT, E.CLOSE_ACCEPTED, E.CLOSE_DONE):
            s = next_day_state(s, ev)
        assert s is D.CLOSED

    def test_close_failed_then_retry_path(self):
        s = next_day_state(D.CLOSE_INITIATED, E.CLOSE_FAILED)
        assert s is D.CLOSE_FAILED
        assert next_day_state(s, E.CLOSE_SENT) is D.CLOSE_PENDING


class TestReceiptMachine:
    OK = [(R.RESERVED, R.SIGNED), (R.SIGNED, R.SUBMITTING), (R.SUBMITTING, R.ACCEPTED),
          (R.SUBMITTING, R.REJECTED), (R.SUBMITTING, R.UNKNOWN), (R.UNKNOWN, R.SUBMITTING),
          (R.UNKNOWN, R.ACCEPTED), (R.UNKNOWN, R.REJECTED)]

    @pytest.mark.parametrize("a,b", OK)
    def test_legal(self, a, b):
        check_receipt_transition(a, b)

    def test_everything_else_raises(self):
        for a, b in itertools.product(R, R):
            if (a, b) in self.OK:
                continue
            with pytest.raises(IllegalTransition):
                check_receipt_transition(a, b)

    def test_terminal_states_have_no_exits(self):
        for t in (R.ACCEPTED, R.REJECTED):
            for b in R:
                with pytest.raises(IllegalTransition):
                    check_receipt_transition(t, b)


class TestReconcile:
    def rec(self, local, n, last_closed, resume, status, srv):
        return reconcile(local, n, last_closed, resume, status, srv)

    # --- never had a day
    def test_no_local_day_and_empty_server_agree(self):
        assert self.rec(None, None, None, None, S.CLOSED, None).kind is K.NOOP

    def test_no_local_day_but_server_has_one_is_conflict(self):
        assert self.rec(None, None, None, None, S.OPENED, 3).kind is K.CONFLICT

    # --- CLOSED
    def test_closed_agrees(self):
        assert self.rec(D.CLOSED, 4, 4, None, S.CLOSED, 4).kind is K.NOOP

    @pytest.mark.parametrize("status,srv", [(S.OPENED, 5), (S.CLOSED, 6), (S.CLOSE_FAILED, 4)])
    def test_closed_vs_other_server_is_conflict(self, status, srv):
        assert self.rec(D.CLOSED, 4, 4, None, status, srv).kind is K.CONFLICT

    # --- OPEN_PENDING (we asked for day 5, outcome unknown)
    def test_open_pending_server_opened_that_day_confirms(self):
        r = self.rec(D.OPEN_PENDING, 5, 4, None, S.OPENED, 5)
        assert r.kind is K.ADOPT and r.events == (E.OPEN_CONFIRMED,)

    def test_open_pending_server_still_closed_at_previous_day_means_never_applied(self):
        r = self.rec(D.OPEN_PENDING, 5, 4, None, S.CLOSED, 4)
        assert r.kind is K.ADOPT and r.events == (E.OPEN_REJECTED,)

    def test_open_pending_first_ever_day_never_applied(self):
        r = self.rec(D.OPEN_PENDING, 1, None, None, S.CLOSED, None)
        assert r.kind is K.ADOPT and r.events == (E.OPEN_REJECTED,)

    @pytest.mark.parametrize("status,srv", [(S.OPENED, 6), (S.CLOSED, 5), (S.CLOSE_INITIATED, 5)])
    def test_open_pending_unprovable_is_conflict(self, status, srv):
        assert self.rec(D.OPEN_PENDING, 5, 4, None, status, srv).kind is K.CONFLICT

    # --- OPENED
    def test_opened_agrees(self):
        assert self.rec(D.OPENED, 5, 4, None, S.OPENED, 5).kind is K.NOOP

    @pytest.mark.parametrize("status,srv", [(S.CLOSED, 5), (S.CLOSE_INITIATED, 5), (S.OPENED, 6)])
    def test_opened_vs_other_is_conflict(self, status, srv):
        assert self.rec(D.OPENED, 5, 4, None, status, srv).kind is K.CONFLICT

    # --- CLOSE_PENDING
    @pytest.mark.parametrize("status,event", [
        (S.CLOSE_INITIATED, E.CLOSE_ACCEPTED), (S.CLOSED, E.CLOSE_DONE), (S.CLOSE_FAILED, E.CLOSE_FAILED)])
    def test_close_pending_adopts_provable_outcomes(self, status, event):
        r = self.rec(D.CLOSE_PENDING, 5, 4, D.OPENED, status, 5)
        assert r.kind is K.ADOPT and r.events == (event,)

    def test_close_pending_server_still_open_means_request_never_applied(self):
        r = self.rec(D.CLOSE_PENDING, 5, 4, D.OPENED, S.OPENED, 5)
        assert r.kind is K.ADOPT and r.events == (E.CLOSE_REJECTED,)

    def test_close_pending_after_failed_close_cannot_claim_never_applied(self):
        assert self.rec(D.CLOSE_PENDING, 5, 4, D.CLOSE_FAILED, S.OPENED, 5).kind is K.CONFLICT

    def test_close_pending_wrong_day_is_conflict(self):
        assert self.rec(D.CLOSE_PENDING, 5, 4, D.OPENED, S.CLOSED, 6).kind is K.CONFLICT

    # --- CLOSE_INITIATED
    def test_close_initiated_agrees(self):
        assert self.rec(D.CLOSE_INITIATED, 5, 4, None, S.CLOSE_INITIATED, 5).kind is K.NOOP

    @pytest.mark.parametrize("status,event", [(S.CLOSED, E.CLOSE_DONE), (S.CLOSE_FAILED, E.CLOSE_FAILED)])
    def test_close_initiated_resolves(self, status, event):
        r = self.rec(D.CLOSE_INITIATED, 5, 4, None, status, 5)
        assert r.kind is K.ADOPT and r.events == (event,)

    def test_close_initiated_vs_open_is_conflict(self):
        assert self.rec(D.CLOSE_INITIATED, 5, 4, None, S.OPENED, 5).kind is K.CONFLICT

    # --- CLOSE_FAILED
    def test_close_failed_agrees(self):
        assert self.rec(D.CLOSE_FAILED, 5, 4, None, S.CLOSE_FAILED, 5).kind is K.NOOP

    def test_close_failed_someone_else_retried_is_conflict(self):
        assert self.rec(D.CLOSE_FAILED, 5, 4, None, S.CLOSE_INITIATED, 5).kind is K.CONFLICT

    def test_every_conflict_has_a_reason(self):
        r = self.rec(D.OPENED, 5, 4, None, S.CLOSED, 5)
        assert r.kind is K.CONFLICT and r.reason
