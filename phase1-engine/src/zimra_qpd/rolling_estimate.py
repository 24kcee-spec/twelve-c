"""
Rolling annual estimate - the step BEFORE calculate_qpd().

calculate_qpd() takes annual sales figures. In practice nobody knows the
year's sales in March, so the platform builds the annual figure from the
months trading so far and revises it at every QPD:

  - QPD1 (25 Mar): Jan, Feb actual + Mar estimate      -> 3 months in play
  - QPD2 (25 Jun): Jan-May actual + Jun estimate       -> 6 months in play
  - QPD3 (25 Sep): Jan-Aug actual + Sep estimate       -> 9 months in play
  - QPD4 (20 Dec): Jan-Nov actual + Dec estimate       -> 12 months in play

  annual estimate = ((sum of months in play / months in play) x 12
                     + one-off adjustment) x (1 + buffer %)

Months entered for an earlier QPD are CARRIED FORWARD: QPD2's window includes
the Jan-Mar figures already saved at QPD1 (with March's estimate replaced by
its actual). This module is the reference implementation of that arithmetic;
the web app's monthly calculator (src/lib/rollingEstimate.ts) mirrors it
line for line and the worked-example tests pin both to the same numbers.

Like calculator.py, all arithmetic is Decimal and the only rounding is one
ROUND_HALF_UP to the cent on the final estimate, so the figure handed to
calculate_qpd() is exactly what the person sees on screen.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Sequence

_CENTS = Decimal("0.01")
_TWELVE = Decimal(12)
_HUNDRED = Decimal(100)

MONTHS_ELAPSED_BY_QUARTER: dict[int, int] = {1: 3, 2: 6, 3: 9, 4: 12}


def _d(value: float | int | str | Decimal) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


@dataclass(frozen=True)
class RollingEstimate:
    months_in_play: int
    window_total: float      # sum of the months in play
    monthly_average: float   # window_total / months_in_play
    annualised: float        # monthly_average x 12
    adjusted: float          # annualised + one-off adjustment
    estimate: float          # adjusted x (1 + buffer%), rounded to the cent - feeds QpdInput.*_sales


def window_for_quarter(months_of_year: Sequence[float], quarter: int) -> list[float]:
    """The months in play at a QPD: the first 3/6/9/12 months of the year.
    `months_of_year` may be shorter than 12 (a year in progress); missing
    months count as zero, exactly like blank boxes in the web calculator."""
    if quarter not in MONTHS_ELAPSED_BY_QUARTER:
        raise ValueError("quarter must be 1, 2, 3, or 4")
    n = MONTHS_ELAPSED_BY_QUARTER[quarter]
    window = list(months_of_year[:n])
    window.extend([0.0] * (n - len(window)))
    return window


def rolling_annual_estimate(
    window: Sequence[float],
    *,
    one_off: float = 0.0,
    buffer_pct: float = 0.0,
) -> RollingEstimate:
    """Annualises the months in play. `window` must be exactly the months in
    play (3, 6, 9 or 12 entries) - use window_for_quarter() to slice a year."""
    if len(window) not in MONTHS_ELAPSED_BY_QUARTER.values():
        raise ValueError("window must contain 3, 6, 9 or 12 monthly figures")
    if any(_d(m) < 0 for m in window):
        raise ValueError("monthly figures cannot be negative")
    if _d(buffer_pct) < 0:
        raise ValueError("buffer_pct cannot be negative")

    n = Decimal(len(window))
    total = sum((_d(m) for m in window), Decimal(0))
    average = total / n
    annualised = average * _TWELVE
    adjusted = annualised + _d(one_off)
    buffered = adjusted * (Decimal(1) + _d(buffer_pct) / _HUNDRED)
    return RollingEstimate(
        months_in_play=len(window),
        window_total=float(total),
        monthly_average=float(average),
        annualised=float(annualised),
        adjusted=float(adjusted),
        estimate=float(buffered.quantize(_CENTS, rounding=ROUND_HALF_UP)),
    )
