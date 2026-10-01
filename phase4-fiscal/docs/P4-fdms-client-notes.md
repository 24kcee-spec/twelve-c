# P4 notes - FDMS client + local simulator (30 Sep 2026)

Modules (all under `phase4-fiscal/src/fiscal_core/`): `fdms_client.py`, `fdms_errors.py`, `fdms_json.py`, `fdms_trust.py`, `fdms_simulator.py`.
Tests: `test_fdms_client.py`, `test_fdms_json.py`, `test_fdms_trust.py`, `conftest.py` (101 new tests). New dependency: `httpx>=0.27`.

## What P4 gives the rest of the build
- `FdmsClient`: one typed method per spec section 4 endpoint (verifyTaxpayerInformation, registerDevice, issueCertificate, getConfig, getStatus, openDay, submitReceipt, closeDay, ping, getServerCertificate, submitFile, getFileStatus).
- Typed errors: 400/401/404/405/422/500+502, transport failure, protocol error, and `FdmsUnknownOutcomeError`.
- Retry policy: only connect failures, timeouts, 500 and 502; only for idempotent endpoints; exponential backoff with injectable sleep.
  `submitReceipt` / `submitFile` / reads are idempotent (spec 4.7 / 4.9). `openDay`, `closeDay`, `registerDevice`, `issueCertificate` are NOT: an ambiguous failure raises `FdmsUnknownOutcomeError`; call `get_status()` to reconcile.
- `fdms_json`: Decimal-safe JSON. Floats are refused on the way out; fractional numbers are parsed as Decimal on the way in.
- `fdms_trust.verify_fdms_chain`: chain-of-trust check for getServerCertificate (closes carry-over C3 / S5). Reports `anchored=False` until a pinned ZIMRA root is supplied.
- `FdmsSimulator` (httpx MockTransport): stateful fake FDMS with fault injection (500/502/401, lost reply after processing, request dropped before processing), async closeDay, idempotent submitReceipt, DEV/FISC/RCPT codes.

## HONEST LIMITS - read before claiming anything
1. **URL paths and HTTP verbs are UNVERIFIED.** The v7.2 text names endpoints but prints no paths (they live in ZIMRA's Swagger). `fdms_client.ENDPOINTS` is our assumption, flagged `ENDPOINTS_VERIFIED = False`. A 404/405 against the real test environment means fix that ONE table. The simulator reads the same table, so passing tests prove internal consistency, not agreement with ZIMRA. Settled in P13 / once Swagger access arrives (P1-X).
2. Enum wire format (names vs numbers) is unverified; parsers accept both.
3. `submitReceipt` response: only `receiptID`, `serverDate`, `receiptServerSignature` are read; extra fields are ignored.
4. The simulator signs the receipt HASH only; it does not validate the canonical string, tax math or RCPT010-RCPT048 rules (that is P7).
5. **mTLS custody gap:** the TLS stack needs the private key, so the P3 sign-only guarantee does not cover the transport key. A real HSM/KMS needs a TLS terminator or PKCS#11 engine (P17).
6. 401 has four server-side causes and the reply does not say which. `diagnose_401()` proves only what our own certificate shows (expired, wrong device); otherwise "not determinable locally".
7. No revocation checking (CRL/OCSP) in `fdms_trust`.
8. Production host is refused unless `allow_production=True`. TLS verification cannot be disabled.

## Not done here (belongs later)
Persistence/audit/day state machine P5; counters P6; preflight P7; receipt engine P8 (builds on `submit_receipt`); day lifecycle polling P9; offline queue P10 (`submit_file` is a thin wrapper only).
