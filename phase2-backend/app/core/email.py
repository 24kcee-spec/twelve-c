from __future__ import annotations

import logging

import httpx

from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"


async def _send_brevo_email(to_email: str, subject: str, html: str, log_context: str, code: str) -> None:
    if not settings.brevo_api_key:
        logger.warning(
            "BREVO_API_KEY not set - skipping %s email. Code for %s: %s",
            log_context,
            to_email,
            code,
        )
        return

    payload = {
        "sender": {"name": settings.brevo_sender_name, "email": settings.brevo_sender_email},
        "to": [{"email": to_email}],
        "subject": subject,
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
        # Don't let an email-provider outage break the request - log and move on.
        logger.exception("Failed to send %s email to %s", log_context, to_email)


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
    await _send_brevo_email(to_email, f"{code} is your Twelve C verification code", html, "verification", code)


async def send_password_reset_email(to_email: str, code: str) -> None:
    """Send a 6-digit "reset your password" code via Brevo.

    Same pattern as send_verification_email: a short numeric code rather
    than a link, hashed at rest, expires quickly, deliberately fails soft
    so an email-provider outage never breaks the request.
    """
    html = f"""
    <div style="font-family: 'IBM Plex Sans', Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#1a1a1a;">Reset your password</h2>
      <p style="color:#333; line-height:1.5;">
        We received a request to reset the password for your Twelve C account.
        Enter this code to choose a new password:
      </p>
      <p style="margin: 28px 0; text-align:center;">
        <span style="display:inline-block; background:#f4f1ea; color:#0b6b53; font-family:monospace;
                     font-size:32px; font-weight:700; letter-spacing:8px; padding:16px 24px; border-radius:8px;">
          {code}
        </span>
      </p>
      <p style="color:#666; font-size:13px;">
        This code expires in {settings.email_verification_code_expire_minutes} minutes.
        If you didn't request a password reset, you can safely ignore this email -
        your password will not be changed.
      </p>
    </div>
    """
    await _send_brevo_email(to_email, f"{code} is your Twelve C password reset code", html, "password reset", code)