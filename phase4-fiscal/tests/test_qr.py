"""Tests for qr.py (Phase 4 / P2, gate G1 part 2). Spec section 11."""

import hashlib
from datetime import date, datetime

import pytest

from fiscal_core.qr import (
    QrDataSource,
    QrError,
    build_receipt_qr_code,
    build_receipt_qr_data,
)

URL = "https://invoice.zimra.co.zw"


class TestQrCodeAssembly:
    def test_spec_example_1(self):
        assert build_receipt_qr_code(URL, 321, "2023-04-03", 1112223331, "4C8BE27663330417") == (
            "https://invoice.zimra.co.zw/00000003210304202311122233314C8BE27663330417"
        )

    def test_spec_example_2(self):
        assert build_receipt_qr_code(URL, 322, "2023-04-04", 1332, "C10B0476B3B14678") == (
            "https://invoice.zimra.co.zw/00000003220404202300000013" "32C10B0476B3B14678"
        )

    def test_total_length_after_base_is_44(self):
        code = build_receipt_qr_code(URL, 1, "2026-09-29", 1, "0" * 16)
        assert len(code[len(URL) + 1:]) == 10 + 8 + 10 + 16

    def test_trailing_slash_on_url_not_doubled(self):
        a = build_receipt_qr_code(URL + "/", 321, "2023-04-03", 5, "4C8BE27663330417")
        b = build_receipt_qr_code(URL, 321, "2023-04-03", 5, "4C8BE27663330417")
        assert a == b and "//0" not in a

    @pytest.mark.parametrize("d", [
        "2023-04-03", "2023-04-03T14:43:23", date(2023, 4, 3), datetime(2023, 4, 3, 23, 59, 59),
    ])
    def test_date_formats_all_give_ddmmyyyy(self, d):
        assert "03042023" in build_receipt_qr_code(URL, 1, d, 1, "0" * 16)

    def test_lowercase_qr_data_is_uppercased(self):
        assert build_receipt_qr_code(URL, 1, "2023-04-03", 1, "abcdef0123456789").endswith("ABCDEF0123456789")

    @pytest.mark.parametrize("kwargs", [
        dict(qr_url=""),
        dict(qr_url="   "),
        dict(device_id=-1),
        dict(device_id=10**10),
        dict(device_id=True),
        dict(receipt_global_no=10**10),
        dict(receipt_global_no=-5),
        dict(receipt_date="03/04/2023"),
        dict(receipt_date=20230403),
        dict(receipt_qr_data="short"),
        dict(receipt_qr_data="G" * 16),
    ])
    def test_invalid_inputs_rejected(self, kwargs):
        args = dict(qr_url=URL, device_id=1, receipt_date="2023-04-03", receipt_global_no=1,
                    receipt_qr_data="4C8BE27663330417")
        args.update(kwargs)
        with pytest.raises(QrError):
            build_receipt_qr_code(**args)


class TestQrData:
    def test_bytes_variant_is_md5_of_signature_bytes_first_16_upper(self):
        # MD5("abc") = 900150983cd24fb0d6963f7d28e17f72 (RFC 1321 test vector)
        assert build_receipt_qr_data(b"abc") == "900150983CD24FB0"

    def test_hex_text_variant_hashes_the_hex_text(self):
        expected = hashlib.md5(b"616263", usedforsecurity=False).hexdigest().upper()[:16]
        assert build_receipt_qr_data(b"abc", QrDataSource.HEX_TEXT) == expected
        assert expected != build_receipt_qr_data(b"abc", QrDataSource.BYTES)

    def test_output_shape(self):
        out = build_receipt_qr_data(bytes(range(64)))
        assert len(out) == 16 and out == out.upper()
        int(out, 16)  # is hex

    @pytest.mark.parametrize("bad", [b"", "abc", None, 123])
    def test_rejects_non_bytes_or_empty(self, bad):
        with pytest.raises(QrError):
            build_receipt_qr_data(bad)  # type: ignore[arg-type]

    def test_unknown_source_rejected(self):
        with pytest.raises(QrError):
            build_receipt_qr_data(b"abc", "NOPE")  # type: ignore[arg-type]

    def test_end_to_end_with_signing(self):
        from fiscal_core.crypto import KeyType, generate_private_key, sign_canonical_string

        key = generate_private_key(KeyType.RSA_2048)
        sig = sign_canonical_string(key, "321FISCALINVOICEZWL4322019-09-19T15:43:12945000").signature
        qr = build_receipt_qr_code(URL, 321, "2019-09-19T15:43:12", 432, build_receipt_qr_data(sig))
        assert qr.startswith(URL + "/0000000321" + "19092019" + "0000000432")
        assert len(qr) == len(URL) + 1 + 44
