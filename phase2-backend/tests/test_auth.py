from __future__ import annotations

import pyotp
import pytest

from tests.conftest import SENT_CODES

pytestmark = pytest.mark.asyncio

VALID_PASSWORD = "Str0ngPassw0rd!"


async def _register_and_login(client, email="user@example.com", password=VALID_PASSWORD):
    r = await client.post("/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    await _verify(client, email)
    r = await client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


async def _verify(client, email: str):
    # In production this code is emailed via Brevo; tests capture it from
    # the monkeypatched sender instead, since no real inbox exists here.
    code = SENT_CODES[email]
    r = await client.post("/auth/verify-email", json={"email": email, "code": code})
    assert r.status_code == 200, r.text


async def test_register_rejects_weak_password(client):
    r = await client.post("/auth/register", json={"email": "weak@example.com", "password": "short"})
    assert r.status_code == 422


async def test_register_and_login_returns_token_pair(client):
    tokens = await _register_and_login(client)
    assert "access_token" in tokens
    assert "refresh_token" in tokens


async def test_unverified_user_cannot_login(client):
    r = await client.post("/auth/register", json={"email": "unverified@example.com", "password": VALID_PASSWORD})
    assert r.status_code == 201
    r = await client.post("/auth/login", json={"email": "unverified@example.com", "password": VALID_PASSWORD})
    assert r.status_code == 403


async def test_login_wrong_password_rejected(client):
    r = await client.post("/auth/register", json={"email": "a@example.com", "password": VALID_PASSWORD})
    await _verify(client, "a@example.com")
    r = await client.post("/auth/login", json={"email": "a@example.com", "password": "WrongPassword1"})
    assert r.status_code == 401


async def test_me_requires_valid_token(client):
    r = await client.get("/auth/me")
    assert r.status_code == 401

    tokens = await _register_and_login(client, email="b@example.com")
    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert r.status_code == 200
    assert r.json()["email"] == "b@example.com"


async def test_mfa_enrollment_and_login_flow(client):
    tokens = await _register_and_login(client, email="mfa@example.com")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    setup = await client.post("/auth/mfa/setup", headers=headers)
    assert setup.status_code == 200
    provisioning_uri = setup.json()["provisioning_uri"]
    secret = dict(part.split("=") for part in provisioning_uri.split("?", 1)[1].split("&"))["secret"]

    totp = pyotp.TOTP(secret)
    verify = await client.post("/auth/mfa/verify", headers=headers, json={"totp_code": totp.now()})
    assert verify.status_code == 200
    assert verify.json()["mfa_enabled"] is True

    # Password-only login should now demand an MFA challenge, not tokens.
    login = await client.post("/auth/login", json={"email": "mfa@example.com", "password": VALID_PASSWORD})
    assert login.status_code == 200
    body = login.json()
    assert body["mfa_required"] is True
    pending_token = body["mfa_pending_token"]

    mfa_login = await client.post(
        "/auth/mfa/login", json={"mfa_pending_token": pending_token, "totp_code": totp.now()}
    )
    assert mfa_login.status_code == 200
    assert "access_token" in mfa_login.json()


async def test_mfa_login_rejects_bad_code(client):
    tokens = await _register_and_login(client, email="mfa2@example.com")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    setup = await client.post("/auth/mfa/setup", headers=headers)
    provisioning_uri = setup.json()["provisioning_uri"]
    secret = dict(part.split("=") for part in provisioning_uri.split("?", 1)[1].split("&"))["secret"]
    totp = pyotp.TOTP(secret)
    await client.post("/auth/mfa/verify", headers=headers, json={"totp_code": totp.now()})

    login = await client.post("/auth/login", json={"email": "mfa2@example.com", "password": VALID_PASSWORD})
    pending_token = login.json()["mfa_pending_token"]

    bad = await client.post(
        "/auth/mfa/login", json={"mfa_pending_token": pending_token, "totp_code": "000000"}
    )
    assert bad.status_code == 401


async def test_refresh_token_rotation(client):
    tokens = await _register_and_login(client, email="rot@example.com")
    r = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200
    new_tokens = r.json()
    assert new_tokens["refresh_token"] != tokens["refresh_token"]

    # Old refresh token must now be dead (rotation).
    reuse = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert reuse.status_code == 401


async def test_logout_revokes_refresh_token(client):
    tokens = await _register_and_login(client, email="logout@example.com")
    r = await client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 204

    r = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 401


async def test_verify_email_wrong_code_rejected(client):
    email = "wrongcode@example.com"
    await client.post("/auth/register", json={"email": email, "password": VALID_PASSWORD})
    real_code = SENT_CODES[email]
    wrong_code = "000000" if real_code != "000000" else "111111"

    r = await client.post("/auth/verify-email", json={"email": email, "code": wrong_code})
    assert r.status_code == 400

    # The real code still works afterwards - one bad guess doesn't burn it.
    r = await client.post("/auth/verify-email", json={"email": email, "code": real_code})
    assert r.status_code == 200


async def test_verify_email_locks_out_after_too_many_wrong_attempts(client):
    email = "bruteforce@example.com"
    await client.post("/auth/register", json={"email": email, "password": VALID_PASSWORD})
    real_code = SENT_CODES[email]
    wrong_code = "000000" if real_code != "000000" else "111111"

    for _ in range(5):
        r = await client.post("/auth/verify-email", json={"email": email, "code": wrong_code})
        assert r.status_code == 400

    # 6th attempt (even with the correct code) is locked out.
    r = await client.post("/auth/verify-email", json={"email": email, "code": real_code})
    assert r.status_code == 429


async def test_resend_verification_issues_a_new_working_code(client):
    email = "resend@example.com"
    await client.post("/auth/register", json={"email": email, "password": VALID_PASSWORD})
    first_code = SENT_CODES[email]

    r = await client.post("/auth/resend-verification", json={"email": email})
    assert r.status_code == 200
    second_code = SENT_CODES[email]
    if first_code == second_code:
        pytest.skip("random 6-digit codes collided - practically a 1-in-a-million fluke")

    # The old code must no longer work (a fresh code invalidates it)...
    r = await client.post("/auth/verify-email", json={"email": email, "code": first_code})
    assert r.status_code == 400

    # ...but the new one verifies successfully.
    r = await client.post("/auth/verify-email", json={"email": email, "code": second_code})
    assert r.status_code == 200


async def test_resend_verification_does_not_leak_account_existence(client):
    r = await client.post("/auth/resend-verification", json={"email": "nobody@example.com"})
    assert r.status_code == 200
    assert "exists" in r.json()["message"] or "on its way" in r.json()["message"]