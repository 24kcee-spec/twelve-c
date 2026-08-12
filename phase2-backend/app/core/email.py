from __future__ import annotations

import logging

import httpx

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"


async def send_verification_email(to_email: str, code: str) -> None:
    """Send a 6-digit "verify your email" code via Brevo.

    Brevo's free tier only requires the *sender address* to be verified
    (a one-time, six-digit confirmation you do once in the Brevo dashboard) -
    unlike Resend/SES, it does not require you to own and verify a whole
    domain. Once the sender is verified, Brevo will deliver to any inbox
    (Gmail, Yahoo, a company domain, etc.) for free, up to 300 emails/day.

    Deliberately fails soft: if Brevo isn't configured (e.g. during local
    dev without an API key) or the request errors, we log it instead of
    blowing up the registration request. The user can always hit
    /auth/resend-verification once email sending is fixed.
    """
    if not settings.brevo_api_key:
        logger.warning(
            "BREVO_API_KEY not set - skipping verification email. Code for %s: %s",
            to_email,
            code,
        )
        return

    html = f"""
    <div style="font-family: 'IBM Plex Sans', Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#1a1a1a;">Verify your email</h2>
      <p style="color:#333; line-height:1.5;">
        Thanks for signing up for Twelve C. Enter this code to verify your email
        address and activate your account:
      </p>
      <p style="margin: 28px 0; text-align:center;">
        <span style="display:inline-block; background:#f4f1ea; color:#0b6b53; font-family:monospace;
                     font-size:32px; font-weight:700; letter-spacing:8px; padding:16px 24px; border-radius:8px;">
          {code}
        </span>
      </p>
      <p style="color:#666; font-size:13px;">
        This code expires in {settings.email_verification_code_expire_minutes} minutes.
        If you didn't create a Twelve C account, you can ignore this email.
      </p>
    </div>
    """

    payload = {
        "sender": {"name": settings.brevo_sender_name, "email": settings.brevo_sender_email},
        "to": [{"email": to_email}],
        "subject": f"{code} is your Twelve C verification code",
        "htmlContent": html,
    }
    headers = {
        "api-key": settings.brevo_api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(BREVO_API_URL, json=payload, headers=headers)
            response.raise_for_status()
    except httpx.HTTPError:
        # Don't let an email-provider outage break signup - log and move on.
        logger.exception("Failed to send verification email to %s", to_email)