"""Rolling annual estimate: the months-so-far -> annual-sales step that feeds calculate_qpd()."""

import pytest

from zimra_qpd.rolling_estimate import (
    MONTHS_ELAPSED_BY_QUARTER,
    rolling_annual_estimate,
    window_for_quarter,
)


def test_months_in_play_per_quarter():
    assert MONTHS_ELAPSED_BY_QUARTER == {1: 3, 2: 6, 3: 9, 4: 12}


def test_window_slices_first_n_months_and_pads_missing_with_zero():
    year = [1, 2, 3, 4, 5]  # a year in progress: only five months entered
    assert window_for_quarter(year, 1) == [1, 2, 3]
    assert window_for_quarter(year, 2) == [1, 2, 3, 4, 5, 0]
    assert window_for_quarter(year, 3) == [1, 2, 3, 4, 5, 0, 0, 0, 0]


def test_annualisation_is_average_times_twelve():
    r = rolling_annual_estimate([1000, 2000, 3000])
    assert r.months_in_play == 3
    assert r.window_total == 6000
    assert r.monthly_average == 2000
    assert r.annualised == 24000
    assert r.estimate == 24000


def test_one_off_is_added_before_the_buffer():
    r = rolling_annual_estimate([1000, 2000, 3000], one_off=1000, buffer_pct=10)
    assert r.adjusted == 25000
    assert r.estimate == 27500  # (24000 + 1000) * 1.10


def test_khami_qpd1_figures():
    # Jan 41,500 + Feb 38,200 actual, Mar estimate 44,000, 5% buffer.
    r = rolling_annual_estimate([41500, 38200, 44000], buffer_pct=5)
    assert r.estimate == 519540.00


def test_estimate_is_rounded_half_up_to_the_cent():
    # 100 / 3 * 12 = 400 exactly; use a case that lands on a half cent:
    # (0.01 + 0 + 0) / 3 * 12 = 0.04 ; x 1.125 = 0.045 -> 0.05 (half-up), not 0.04 (banker's)
    assert rolling_annual_estimate([0.01, 0, 0], buffer_pct=12.5).estimate == 0.05


def test_carry_forward_later_quarter_reuses_earlier_months():
    # QPD1 was filed with Mar as an estimate. At QPD2 the same Jan/Feb are still
    # in the window and Mar is now its real figure.
    actuals = [100, 200, 350, 400, 500, 0]
    at_qpd1 = window_for_quarter([100, 200, 300], 1)          # Mar estimated 300
    at_qpd2 = window_for_quarter(actuals, 2)                  # Mar now 350; Apr, May actual; Jun estimate 0
    assert at_qpd2[:2] == at_qpd1[:2]
    assert at_qpd2[2] == 350
    assert len(at_qpd2) == 6


@pytest.mark.parametrize("bad", [[1, 2], [1] * 4, [1] * 13, []])
def test_rejects_windows_that_are_not_a_whole_quarter(bad):
    with pytest.raises(ValueError):
        rolling_annual_estimate(bad)


def test_rejects_negative_inputs():
    with pytest.raises(ValueError):
        rolling_annual_estimate([1, -1, 1])
    with pytest.raises(ValueError):
        rolling_annual_estimate([1, 1, 1], buffer_pct=-1)


def test_bad_quarter():
    with pytest.raises(ValueError):
        window_for_quarter([1] * 12, 5)
