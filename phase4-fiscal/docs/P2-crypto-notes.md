# P2 notes - crypto.py + qr.py (29 Sep 2026)

Built from ZIMRA Fiscal Device Gateway API v7.2 sections 4.2, 5.3, 11, 12, 13. Pure in-process crypto:
no network, no file writes, no key storage (key custody is P3).

## Decisions
- ECC: ECDSA secp256r1 + SHA-256. RSA: RSASSA-PKCS1-v1_5 + SHA-256 (= SHA256WithRSA). Signature and hash sent base64.
- CSR subject is CN only by default (`ZIMRA-<serial>-<10-digit deviceID>`); `include_optional_subject=True` adds
  C=ZW, O=Zimbabwe Revenue Authority, ST=Zimbabwe - the only values spec 4.2 permits.
- Private keys are never serialised by fiscal_core; only key objects cross function boundaries.

## Open findings (do NOT treat as settled until the ZIMRA TEST environment confirms)
- F4 (ECDSA signature encoding): spec 13.1 says only "ECC(Hash, CURVE, g, n)". Default = ASN.1 DER; raw r||s (64 bytes)
  is implemented behind `SignatureEncoding.RAW_RS`. A wrong choice surfaces as RCPT020 on every receipt. RSA is unambiguous.
- F8 (QR data): "first 16 chars of MD5 of ReceiptDeviceSignature hexadecimal value" is ambiguous. Default = MD5 of the raw
  signature bytes, upper-case hex; alternative = MD5 of the hex text (`QrDataSource.HEX_TEXT`). Settled by scanning a
  test-environment QR on invoice.zimra.co.zw.
- F9 (spec examples): of the 7 receipt hashes printed in 13.2.1/13.2.2 only the CreditNote "Example No 2" and the FDMS
  example reproduce from their printed strings. FiscalInvoice "Example No 1" reproduces only with a stray space before
  previousReceiptHash (contradicts "no concatenation character"); the other four do not reproduce at all.
  The spec's sample CSR/certificate PEMs (section 12) carry CN=ZRB-eVFD-0000000042 / O=Zanzibar Revenue Board / C=TZ although
  the text says ZIMRA-SN0001-0000000042. The sample PEMs are used here for key/signature vectors only.

## Verified independently (OpenSSL 3, 29 Sep 2026)
- RSA signature byte-identical to `openssl dgst -sha256 -sign`.
- ECC DER signature verified by `openssl dgst -sha256 -verify`; an OpenSSL-made ECC signature verified by verify_canonical_string.
- CSR passes `openssl req -verify` with subject `CN = ZIMRA-SN0001-0000000042`.
