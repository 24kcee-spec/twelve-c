"""
fdms_trust.py - chain-of-trust validation for FDMS signing certificates
(Phase 4 / P4; closes carry-over C3 / open item S5).

getServerCertificate returns "FDMS certificate chain" as a string array (spec
4.12) with NO stated ordering, so the chain is assembled by issuer/subject
matching rather than by position.

What this proves
  * every link is really signed by the next one (cryptographic check),
  * every certificate is inside its validity window at `now`,
  * the chain ends at a self-signed root,
  * optionally, that root equals a PINNED root you supplied.

What it does NOT prove (be honest in a security questionnaire)
  * Without a pinned root, a self-consistent chain served by an attacker would
    also pass. The real ZIMRA root must be pinned once it is obtained through
    an authenticated channel (P13). Until then treat trust as "consistent
    chain", not "ZIMRA-anchored". verify_fdms_chain() reports which one you got.
  * Revocation (CRL/OCSP) is not checked.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional, Sequence

from cryptography import x509
from cryptography.hazmat.primitives import hashes


class ChainError(ValueError):
    """The presented certificate chain is not acceptable."""


@dataclass(frozen=True)
class VerifiedChain:
    leaf: x509.Certificate                 # the signing certificate (end of chain)
    chain: List[x509.Certificate]          # leaf first, root last
    root: x509.Certificate
    anchored: bool                         # True only if a pinned root was supplied AND matched


def _load(pems: Sequence[str]) -> List[x509.Certificate]:
    if not pems:
        raise ChainError("empty certificate list")
    out = []
    for pem in pems:
        try:
            out.append(x509.load_pem_x509_certificate(pem.encode("ascii")))
        except (ValueError, UnicodeEncodeError) as exc:
            raise ChainError(f"certificate is not valid PEM: {exc}") from exc
    return out


def _fp(cert: x509.Certificate) -> bytes:
    return cert.fingerprint(hashes.SHA256())


def verify_fdms_chain(
    pems: Sequence[str],
    pinned_root_pem: Optional[str] = None,
    now: Optional[datetime] = None,
) -> VerifiedChain:
    certs = _load(pems)
    when = now or datetime.now(timezone.utc)

    if len({_fp(c) for c in certs}) != len(certs):
        raise ChainError("duplicate certificate in chain")

    for c in certs:
        if when < c.not_valid_before_utc or when >= c.not_valid_after_utc:
            raise ChainError(f"certificate {c.subject.rfc4514_string()!r} is outside its validity period")

    # The leaf is the one certificate that issued nobody else in the list.
    issuers = {c.issuer for c in certs if c.issuer != c.subject}
    leaves = [c for c in certs if c.subject not in issuers]
    if len(leaves) != 1:
        raise ChainError("cannot identify a single leaf certificate (ambiguous or cyclic chain)")

    ordered = [leaves[0]]
    remaining = [c for c in certs if c is not leaves[0]]
    while True:
        cur = ordered[-1]
        if cur.issuer == cur.subject:
            break                                   # reached a self-issued root
        nxt = [c for c in remaining if c.subject == cur.issuer]
        if not nxt:
            raise ChainError("chain is incomplete: issuer of "
                             f"{cur.subject.rfc4514_string()!r} not supplied")
        chosen = None
        last_exc: Optional[Exception] = None
        for cand in nxt:                             # same-named issuers: keep the one that verifies
            try:
                cur.verify_directly_issued_by(cand)
                chosen = cand
                break
            except Exception as exc:                 # noqa: BLE001 - library raises several types
                last_exc = exc
        if chosen is None:
            raise ChainError(f"signature link check failed: {last_exc}")
        ordered.append(chosen)
        remaining.remove(chosen)

    if remaining:
        raise ChainError("unrelated certificate(s) present in chain")

    root = ordered[-1]
    try:
        root.verify_directly_issued_by(root)
    except Exception as exc:                         # noqa: BLE001
        raise ChainError(f"root is not validly self-signed: {exc}") from exc

    anchored = False
    if pinned_root_pem is not None:
        pinned = _load([pinned_root_pem])[0]
        if _fp(pinned) != _fp(root):
            raise ChainError("chain root does not match the pinned root")
        anchored = True

    return VerifiedChain(leaf=ordered[0], chain=ordered, root=root, anchored=anchored)
