# P3 notes - key custody (30 Sep 2026)

Module: `fiscal_core/key_provider.py`. Tests: `tests/test_key_provider.py` (44). No new dependencies.

## What P3 gives the rest of the build
- `KeyProvider` (abstract): `key_id`, `key_type`, `public_key()`, `sign()`, `build_csr_pem()`, `verify()`.
  There is **no method that returns a private key**. P8 (receipt engine) and P9 (day close) must depend on this
  interface only, never on `crypto.py` key objects directly.
- `InMemoryKeyProvider`: tests only.
- `EncryptedFileKeyProvider`: PKCS#8 key encrypted with AES-256-GCM, key derived by scrypt (n=2^17, r=8, p=1).
  File suffix must be `.fkey` (git-ignored, and hygiene-tested as a secret type). Header fields are bound into the
  GCM tag, so editing key_id / key_type / KDF cost / salt / nonce is detected. Atomic write, owner-only mode on POSIX,
  never overwrites an existing key unless `overwrite=True`.
- `AzureKeyVaultKeyProvider`, `AwsKmsKeyProvider`, `Pkcs11KeyProvider`: stubs that refuse to construct. They mark the seam.

## Rules for callers
1. Create the key file **before** building the CSR, so a crash cannot leave a registered device with a lost key.
   `create()` writes the file before it returns.
2. Losing the `.fkey` file or its passphrase means the device cannot sign. Back up the file and store the passphrase
   in a password manager. A lost key means re-registering the device with ZIMRA.
3. Passphrase: at least 12 characters, NFKC-normalised. For unattended start use `passphrase_from_env("VAR")`.
4. Never pass `allow_weak_kdf=True` outside tests.
5. Key rotation = new key + new CSR + `issueCertificate` (P4/P9), not a passphrase change. `change_passphrase` only
   re-encrypts the same key.

## Honest limits (say these out loud in any security questionnaire)
- Protects the key **at rest**. A running process holds the key in memory. Only a KMS/HSM provider fixes that.
- Zero-budget custody, **not enterprise-grade**. Delta/Econet-class buyers will ask for KMS/HSM: implement one stub
  (P17/P18) before that conversation.
- Python cannot reliably erase key bytes from memory.
- Windows DPAPI binding deferred: needs pywin32 and pins the file to one machine/user.
- Certificates are public and are **not** stored here; P5 persists them with the device record.

## Not done here (belongs later)
- Audit-log entries for sign operations: P5.
- Certificate expiry tracking and renewal: P4/P9.
