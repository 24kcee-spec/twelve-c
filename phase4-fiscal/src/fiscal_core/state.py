"""
state.py - fiscal-day and receipt state machines (Phase 4 / P5). PURE: no I/O.

FISCAL DAY (spec 5.4.2 + our own "pending" states)
  The spec has four server states: Closed, Opened, CloseInitiated, CloseFailed.
  The Plan says to persist OUR state, not infer it from the last reply, because
  a request can leave the machine and the reply can be lost. So two local
  intermediate states exist that the server never reports:

      OPEN_PENDING   openDay was sent; outcome not yet known
      CLOSE_PENDING  closeDay was sent; outcome not yet known

  Illegal transitions RAISE (IllegalTransition); they are never logged and
  ignored. A day left in a pending state is resolved ONLY by reconcile(), which
  compares our record with the server's getStatus and either adopts a provable
  outcome or declares CONFLICT (stop issuing, a human decides).

  Receipts may be created only while the day is OPENED or CLOSE_FAILED
  (spec 4.7: submitReceipt is allowed in CloseFailed).

RECEIPT (our own lifecycle; the spec only defines the wire behaviour)
      RESERVED -> SIGNED -> SUBMITTING -> ACCEPTED | REJECTED | UNKNOWN
      UNKNOWN  -> SUBMITTING | ACCEPTED | REJECTED
  ACCEPTED and REJECTED are terminal. A rejected receipt keeps its number
  (consumed on submission, vFiscal guide section 10). OPEN QUESTION S7: spec
  section 9 item 13 says "on failure, fix and resubmit", which may mean the same
  receiptGlobalNo can be resent corrected. P5 treats REJECTED as terminal (the
  conservative reading); P13 settles it against the test environment.

ASSUMPTION about getStatus.lastFiscalDayNo: it is the number of the MOST RECENT
fiscal day, open or closed. The v7.2 text does not say; the simulator behaves
this way. Verify in P13.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, Optional, Tuple

from .fdms_client import FiscalDayStatus


class IllegalTransition(Exception):
    """A state change that the machine does not allow."""


# ---------------------------------------------------------------- fiscal day
class DayState(str, Enum):
    CLOSED = "CLOSED"
    OPEN_PENDING = "OPEN_PENDING"
    OPENED = "OPENED"
    CLOSE_PENDING = "CLOSE_PENDING"
    CLOSE_INITIATED = "CLOSE_INITIATED"
    CLOSE_FAILED = "CLOSE_FAILED"


class DayEvent(str, Enum):
    OPEN_SENT = "OPEN_SENT"
    OPEN_CONFIRMED = "OPEN_CONFIRMED"
    OPEN_REJECTED = "OPEN_REJECTED"
    CLOSE_SENT = "CLOSE_SENT"
    CLOSE_ACCEPTED = "CLOSE_ACCEPTED"        # server took the request; close is now asynchronous
    CLOSE_REJECTED = "CLOSE_REJECTED"        # request never took effect; revert to the pre-close state
    CLOSE_DONE = "CLOSE_DONE"
    CLOSE_FAILED = "CLOSE_FAILED"


_D, _E = DayState, DayEvent
_DAY_TRANSITIONS: Dict[Tuple[DayState, DayEvent], DayState] = {
    (_D.CLOSED, _E.OPEN_SENT): _D.OPEN_PENDING,
    (_D.OPEN_PENDING, _E.OPEN_CONFIRMED): _D.OPENED,
    (_D.OPEN_PENDING, _E.OPEN_REJECTED): _D.CLOSED,
    (_D.OPENED, _E.CLOSE_SENT): _D.CLOSE_PENDING,
    (_D.CLOSE_FAILED, _E.CLOSE_SENT): _D.CLOSE_PENDING,
    (_D.CLOSE_PENDING, _E.CLOSE_ACCEPTED): _D.CLOSE_INITIATED,
    (_D.CLOSE_PENDING, _E.CLOSE_DONE): _D.CLOSED,             # reconciliation shortcut
    (_D.CLOSE_PENDING, _E.CLOSE_FAILED): _D.CLOSE_FAILED,     # reconciliation shortcut
    (_D.CLOSE_INITIATED, _E.CLOSE_DONE): _D.CLOSED,
    (_D.CLOSE_INITIATED, _E.CLOSE_FAILED): _D.CLOSE_FAILED,
}

RECEIPT_ALLOWED_DAY_STATES = frozenset({DayState.OPENED, DayState.CLOSE_FAILED})
PENDING_DAY_STATES = frozenset({DayState.OPEN_PENDING, DayState.CLOSE_PENDING})


def next_day_state(state: DayState, event: DayEvent, resume: Optional[DayState] = None) -> DayState:
    """`resume` is the state before CLOSE_SENT; only CLOSE_REJECTED uses it."""
    if state is DayState.CLOSE_PENDING and event is DayEvent.CLOSE_REJECTED:
        if resume in (DayState.OPENED, DayState.CLOSE_FAILED):
            return resume
        raise IllegalTransition("CLOSE_REJECTED needs a resume state of OPENED or CLOSE_FAILED")
    try:
        return _DAY_TRANSITIONS[(state, event)]
    except KeyError:
        raise IllegalTransition(f"fiscal day: {event.value} is not allowed in state {state.value}") from None


# ------------------------------------------------------------------ receipt
class ReceiptState(str, Enum):
    RESERVED = "RESERVED"
    SIGNED = "SIGNED"
    SUBMITTING = "SUBMITTING"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    UNKNOWN = "UNKNOWN"


_R = ReceiptState
_RECEIPT_TRANSITIONS = {
    _R.RESERVED: {_R.SIGNED},
    _R.SIGNED: {_R.SUBMITTING},
    _R.SUBMITTING: {_R.ACCEPTED, _R.REJECTED, _R.UNKNOWN},
    _R.UNKNOWN: {_R.SUBMITTING, _R.ACCEPTED, _R.REJECTED},
    _R.ACCEPTED: set(),
    _R.REJECTED: set(),
}
TERMINAL_RECEIPT_STATES = frozenset({ReceiptState.ACCEPTED, ReceiptState.REJECTED})


def check_receipt_transition(current: ReceiptState, new: ReceiptState) -> None:
    if new not in _RECEIPT_TRANSITIONS[current]:
        raise IllegalTransition(f"receipt: {current.value} -> {new.value} is not allowed")


# ------------------------------------------------------------ reconciliation
class ResolutionKind(str, Enum):
    NOOP = "NOOP"          # local and server agree
    ADOPT = "ADOPT"        # server state proves what happened; apply `events` locally
    CONFLICT = "CONFLICT"  # cannot be proved; stop issuing, a human decides


@dataclass(frozen=True)
class Resolution:
    kind: ResolutionKind
    events: Tuple[DayEvent, ...] = ()
    reason: str = ""


def _noop() -> Resolution:
    return Resolution(ResolutionKind.NOOP)


def _adopt(*events: DayEvent) -> Resolution:
    return Resolution(ResolutionKind.ADOPT, tuple(events))


def _conflict(why: str) -> Resolution:
    return Resolution(ResolutionKind.CONFLICT, (), why)


def reconcile(
    local_state: Optional[DayState],
    local_day_no: Optional[int],
    last_closed_no: Optional[int],
    resume: Optional[DayState],
    server_status: FiscalDayStatus,
    server_last_day_no: Optional[int],
) -> Resolution:
    """
    Compare our persisted day with the server's getStatus. Adopts an outcome only
    when the pair (status, day number) PROVES it; anything else is CONFLICT.
    `local_state is None` means we have never recorded a day for this device.
    """
    S = FiscalDayStatus
    n, srv = local_day_no, server_last_day_no

    if local_state is None:
        if server_status is S.CLOSED and srv is None:
            return _noop()
        return _conflict(f"server reports {server_status.name} (day {srv}) but we have no local day")

    if local_state is DayState.CLOSED:
        if server_status is S.CLOSED and srv == last_closed_no:
            return _noop()
        return _conflict(f"local CLOSED (last closed {last_closed_no}) but server reports {server_status.name} (day {srv})")

    if local_state is DayState.OPEN_PENDING:
        if server_status is S.OPENED and srv == n:
            return _adopt(DayEvent.OPEN_CONFIRMED)
        if server_status is S.CLOSED and srv == last_closed_no:
            return _adopt(DayEvent.OPEN_REJECTED)                     # openDay never took effect
        return _conflict(f"open of day {n} pending; server reports {server_status.name} (day {srv})")

    if local_state is DayState.OPENED:
        if server_status is S.OPENED and srv == n:
            return _noop()
        return _conflict(f"local day {n} OPENED but server reports {server_status.name} (day {srv})")

    if local_state is DayState.CLOSE_PENDING:
        if srv != n:
            return _conflict(f"close of day {n} pending; server reports day {srv}")
        if server_status is S.CLOSE_INITIATED:
            return _adopt(DayEvent.CLOSE_ACCEPTED)
        if server_status is S.CLOSED:
            return _adopt(DayEvent.CLOSE_DONE)
        if server_status is S.CLOSE_FAILED:
            return _adopt(DayEvent.CLOSE_FAILED)
        if server_status is S.OPENED and resume is DayState.OPENED:
            return _adopt(DayEvent.CLOSE_REJECTED)                    # closeDay never took effect
        return _conflict(f"close of day {n} pending; server reports {server_status.name}")

    if local_state is DayState.CLOSE_INITIATED:
        if srv != n:
            return _conflict(f"day {n} closing; server reports day {srv}")
        if server_status is S.CLOSE_INITIATED:
            return _noop()
        if server_status is S.CLOSED:
            return _adopt(DayEvent.CLOSE_DONE)
        if server_status is S.CLOSE_FAILED:
            return _adopt(DayEvent.CLOSE_FAILED)
        return _conflict(f"day {n} closing; server reports {server_status.name}")

    if local_state is DayState.CLOSE_FAILED:
        if server_status is S.CLOSE_FAILED and srv == n:
            return _noop()
        return _conflict(f"local day {n} CLOSE_FAILED but server reports {server_status.name} (day {srv})")

    return _conflict("unhandled local state")                          # pragma: no cover
