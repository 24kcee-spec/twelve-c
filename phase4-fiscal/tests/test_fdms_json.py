"""Tests for fdms_json.py (Phase 4 / P4): Decimal-safe wire format."""

from datetime import datetime, timezone
from decimal import Decimal

import pytest

from fiscal_core import fdms_json


class TestDumps:
    def test_decimal_written_exactly(self):
        assert fdms_json.dumps({"a": Decimal("1.50")}) == '{"a":1.50}'

    def test_trailing_zeros_and_precision_preserved(self):
        assert fdms_json.dumps([Decimal("115.10"), Decimal("0.000001")]) == "[115.10,0.000001]"

    def test_exponent_decimal_expanded(self):
        assert fdms_json.dumps(Decimal("1E+2")) == "100"

    def test_negative_decimal(self):
        assert fdms_json.dumps({"v": Decimal("-3.75")}) == '{"v":-3.75}'

    def test_float_is_refused(self):
        with pytest.raises(TypeError, match="float"):
            fdms_json.dumps({"a": 1.5})

    def test_nonfinite_decimal_refused(self):
        with pytest.raises(TypeError):
            fdms_json.dumps(Decimal("NaN"))

    def test_naive_datetime_formatted_local(self):
        assert fdms_json.dumps({"d": datetime(2026, 9, 30, 8, 5, 3)}) == '{"d":"2026-09-30T08:05:03"}'

    def test_aware_datetime_refused(self):
        with pytest.raises(TypeError, match="WITHOUT time zone"):
            fdms_json.dumps(datetime(2026, 9, 30, tzinfo=timezone.utc))

    def test_non_string_key_and_unknown_type_refused(self):
        with pytest.raises(TypeError):
            fdms_json.dumps({1: "x"})
        with pytest.raises(TypeError):
            fdms_json.dumps({"a": object()})

    def test_bool_none_int_str_unchanged(self):
        assert fdms_json.dumps({"t": True, "n": None, "i": 3, "s": "x"}) == '{"t":true,"n":null,"i":3,"s":"x"}'

    def test_string_that_looks_like_a_decimal_token_is_not_rewritten(self):
        evil = "\u0001DEC0000000000000000:9.99"
        assert fdms_json.loads(fdms_json.dumps({"s": evil})) == {"s": evil}

    def test_unicode_kept(self):
        assert fdms_json.loads(fdms_json.dumps({"n": "Café"})) == {"n": "Café"}


class TestLoads:
    def test_fractional_numbers_become_decimal_exactly(self):
        v = fdms_json.loads('{"x": 115.10, "y": 0.1}')
        assert v["x"] == Decimal("115.10") and str(v["x"]) == "115.10"
        assert isinstance(v["y"], Decimal)

    def test_integers_stay_int(self):
        v = fdms_json.loads('{"n": 5}')
        assert v["n"] == 5 and isinstance(v["n"], int)

    def test_nan_rejected(self):
        with pytest.raises(fdms_json.FdmsJsonError):
            fdms_json.loads('{"x": NaN}')

    def test_invalid_json_rejected(self):
        with pytest.raises(fdms_json.FdmsJsonError):
            fdms_json.loads("{not json")

    def test_roundtrip_preserves_decimal_text(self):
        original = {"a": [Decimal("2.10"), {"b": Decimal("100.00")}]}
        back = fdms_json.loads(fdms_json.dumps(original))
        assert back == original
        assert str(back["a"][0]) == "2.10"
