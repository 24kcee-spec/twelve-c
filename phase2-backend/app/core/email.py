from __future__ import annotations

import logging

import httpx

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


async def send_verification_email(to_email: str, token: str) -> None:
    """Send a "confirm your email" message via Resend.

    Deliberately fails soft: if Resend isn't configured (e.g. during local
    dev without an API key) or the request errors, we log it instead of
    blowing up the registration request. The user can always hit
    /auth/resend-verification once email sending is fixed.
    """
    verify_link = f"{settings.frontend_url.rstrip('/')}/verify-email?token={token}"

    if not settings.resend_api_key:
        logger.warning(
            "RESEND_API_KEY not set - skipping verification email. Link for %s: %s",
            to_email,
            verify_link,
        )
        return

    html = f"""
    <div style="font-family: 'IBM Plex Sans', Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#1a1a1a;">Confirm your email</h2>
      <p style="color:#333; line-height:1.5;">
        Thanks for signing up for Twelve C. Click the button below to verify your
        email address and activate your account.
      </p>
      <p style="margin: 24px 0;">
        <a href="{verify_link}"
           style="background:#0b6b53; color:#ffffff; padding:12px 24px; border-radius:6px;
                  text-decoration:none; font-weight:600;">
          Verify my email
        </a>
      </p>
      <p style="color:#666; font-size:13px;">
        Or paste this link into your browser:<br>
        <a href="{verify_link}">{verify_link}</a>
      </p>
      <p style="color:#999; font-size:12px;">
        This link expires in {settings.email_verification_expire_hours} hours.
        If you didn't create a Twelve C account, you can ignore this email.
      </p>
    </div>
    """

    payload = {
        "from": settings.resend_from_email,
        "to": [to_email],
        "subject": "Verify your Twelve C account",
        "html": html,
    }
    headers = {
        "Authorization": f"Bearer {settings.resend_api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(RESEND_API_URL, json=payload, headers=headers)
            response.raise_for_status()
    except httpx.HTTPError:
        # Don't let an email-provider outage break signup - log and move on.
        logger.exception("Failed to send verification email to %s", to_email)
