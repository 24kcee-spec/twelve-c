"""
Centralised, typed application settings.

Everything here is read from environment variables (or a local .env file
during development) - nothing is hardcoded, so the same image can be
promoted from dev -> staging -> prod by swapping env vars only.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Postgres
    database_url: str
    database_url_sync: str

    # JWT
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    # MFA
    mfa_issuer_name: str = "ZIMRA QPD Calculator"

    # App
    environment: str = "development"
    cors_origins: str = "http://localhost:3000,https://twelve-c.vercel.app"

    # Frontend base URL - used to build the link inside verification emails,
    # e.g. https://twelvec.vercel.app or http://localhost:3000
    frontend_url: str = "http://localhost:3000"

    # Email verification token lifetime
    email_verification_expire_hours: int = 24

    # Resend (transactional email) - https://resend.com
    resend_api_key: str | None = None
    resend_from_email: str = "Twelve C <onboarding@resend.dev>"

    # Google Sign-In (OAuth) - https://console.cloud.google.com/apis/credentials
    google_client_id: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
