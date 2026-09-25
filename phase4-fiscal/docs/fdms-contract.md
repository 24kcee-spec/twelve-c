# FDMS API Contract — distilled from ZIMRA Fiscal Device Gateway API Spec v7.2

Living reference for `fdms_client.py` work. Feed this file (not the raw spec)
into a session building or touching the HTTP client layer.

## Environments

| Environment | Base URL | Notes |
|---|---|---|
| Test | `https://fdmsapitest.zimra.co.zw` | Swagger UI at `/swagger/index.html`. Build and test everything here first. |
| Production | `https://fdmsapi.zimra.co.zw` | Not touched until Phase 11 (pilot). |

## Transport & auth

- HTTPS only. Mutual TLS for every endpoint except the three public ones below.
- Public (no client cert required): `verifyTaxpayerInformation`, `registerDevice`,
  `getServerCertificate`.
- Every other endpoint: client presents its device certificate (issued via
  `registerDevice`/`issueCertificate`) for mTLS.
- Required headers on every request: `DeviceModelName`, `DeviceModelVersionNo`
  (both mandatory, both must match what's registered with ZIMRA for the device).
- Synchronous timeout: 30 seconds. `closeDay` and `submitFile` return an
  immediate "accepted" response, then process asynchronously — poll
  `getStatus`/`getFileStatus` for the real outcome.

## Endpoint inventory (Section 4)

| Endpoint | Auth | Sync? | Purpose |
|---|---|---|---|
| `verifyTaxpayerInformation` | Public | Sync | Confirm taxpayer identity before registering a device |
| `registerDevice` | Public | Sync | CSR in → certificate + device link out |
| `issueCertificate` | mTLS | Sync | Renew cert before expiry |
| `getConfig` | mTLS | Sync | Taxpayer/device config, `applicableTaxes`, day-length limits |
| `getStatus` | mTLS | Sync | Current fiscal day status + counters (online mode only) |
| `openDay` | mTLS | Sync | Open a new fiscal day |
| `submitReceipt` | mTLS | Sync | Submit one FiscalInvoice/CreditNote/DebitNote |
| `submitFile` | mTLS | Async | Batch submission for offline devices (header/content/footer) |
| `getFileStatus` | mTLS | Sync | Poll outcome of a `submitFile` call |
| `closeDay` | mTLS | Async | Initiate fiscal day close |
| `getServerCertificate` | Public | Sync | FDMS's own cert, for verifying FDMS signatures |
| `ping` | mTLS | Sync | Heartbeat; response tells device its required reporting frequency |
| Users management block | mTLS | Sync | Optional — `login`, `createUserBegin/Confirm`, password reset, security codes. Not required for core fiscal flow. |
| `getStockList` | mTLS | Sync | Goods-in-stock lookup by HS code |

## Error taxonomy

**HTTP status meaning** (Section 8.1):
`400` malformed request · `401` auth failure (see the four causes in
`fiscal-rules.md` §9) · `404` unknown endpoint · `405` wrong HTTP verb ·
`422` structurally valid but semantically rejected — check `ProblemDetails.errorCode`
· `500` FDMS infra error, retry later · `502` bad gateway, retry later.

**Error body** is RFC 7807 `ProblemDetails`: `type`, `title`, `status`,
optional `errorCode`.

**Error code families**:
- `DEV0x`/`DEV1x` — device/user-management errors (device blocked, bad
  activation key, bad CSR, blacklisted model, inactive taxpayer, user-auth
  failures). Full table in the spec §8.2 — map every code to a plain-language
  string for the Preflight Engine (Phase 6).
- `RCPT01`/`RCPT02` — receipt rejected outright (day not open, structurally
  invalid).
- `RCPTxxx` (010–048) — receipt **accepted but flagged** Grey/Yellow/Red;
  full table with severity color already captured in `fiscal-rules.md` §4.
- `FISC01`/`FISC03`/`FISC04` — day open/close sequencing errors.
- `FILE01`–`FILE05` — batch file errors (too big, malformed, wrong device,
  sent for an already-closed day, offline-mode-only endpoint called in
  online mode).

## Key request/response shapes worth pre-building test fixtures for

- `Receipt` (the payload of `submitReceipt`) — the single largest, most
  validation-heavy object in the spec. Build canonical fixture JSON for
  FiscalInvoice, CreditNote, and DebitNote before writing `canonicalise.py`.
- `SignatureData` (`hash` + `signature`) vs `SignatureDataEx` (adds
  `certificateThumbprint`) — FDMS uses the `Ex` variant on its own signatures.
- `FiscalDayCounter` array — shape shared between `closeDay` and `submitFile`'s
  footer; zero-value counters must be omitted, not sent as zero.

## What's explicitly out of scope for `fdms_client.py` v1

- Users-management block (login/password reset/etc.) — optional per spec,
  not required for the core open→submit→close flow. Build only if a later
  session decides multi-user device access is needed.
- `getStockList` — no immediate use case; skip until something needs it.
