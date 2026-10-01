"""
fdms_json.py - Decimal-safe JSON for the FDMS wire format (Phase 4 / P4).

Project rule: no float anywhere in the fiscal path.
  * dumps() REFUSES float outright and writes Decimal as an exact JSON number
    (Decimal("1.50") -> 1.50, never 1.5 or 1.4999999).
  * loads() parses every non-integer JSON number as Decimal, so a response
    such as {"fiscalCounterValue": 115.10} never passes through a binary float.
  * datetime: only NAIVE datetimes (spec: "local time without time zone
    information"), written as YYYY-MM-DDTHH:MM:SS.
"""

from __future__ import annotations

import json
import re
import secrets
from datetime import datetime
from decimal import Decimal
from typing import Any


class FdmsJsonError(ValueError):
    pass


def _reject_constant(name: str) -> Any:
    raise FdmsJsonError(f"Non-finite JSON number {name!r} is not allowed")


def loads(text: "str | bytes") -> Any:
    try:
        return json.loads(text, parse_float=Decimal, parse_constant=_reject_constant)
    except json.JSONDecodeError as exc:
        raise FdmsJsonError(f"Invalid JSON: {exc.msg}") from exc


def dumps(obj: Any) -> str:
    token = "\u0001DEC" + secrets.token_hex(8) + ":"

    def prep(value: Any) -> Any:
        if isinstance(value, bool) or value is None or isinstance(value, (int, str)):
            return value
        if isinstance(value, float):
            raise TypeError("float is forbidden in the fiscal path; use Decimal or int")
        if isinstance(value, Decimal):
            if not value.is_finite():
                raise TypeError("non-finite Decimal is not allowed")
            return token + format(value, "f")
        if isinstance(value, datetime):
            if value.tzinfo is not None:
                raise TypeError("FDMS datetimes are local time WITHOUT time zone; pass a naive datetime")
            return value.strftime("%Y-%m-%dT%H:%M:%S")
        if isinstance(value, (list, tuple)):
            return [prep(v) for v in value]
        if isinstance(value, dict):
            out = {}
            for k, v in value.items():
                if not isinstance(k, str):
                    raise TypeError(f"JSON object keys must be str, got {type(k).__name__}")
                out[k] = prep(v)
            return out
        raise TypeError(f"Unsupported type in FDMS payload: {type(value).__name__}")

    text = json.dumps(prep(obj), ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    pattern = re.compile('"' + re.escape(json.dumps(token)[1:-1]) + r"(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\"")
    return pattern.sub(lambda m: m.group(1), text)
