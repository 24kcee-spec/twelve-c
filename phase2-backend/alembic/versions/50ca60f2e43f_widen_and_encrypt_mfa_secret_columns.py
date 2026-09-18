"""widen and encrypt mfa secret columns

Revision ID: 50ca60f2e43f
Revises: afa72ebeef86
Create Date: 2026-09-15 11:02:00.722694

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '50ca60f2e43f'
down_revision: Union[str, None] = 'afa72ebeef86'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # A Fernet-encrypted 32-char TOTP secret is ~140 chars - String(64)
    # would silently truncate it.
    op.alter_column("users", "mfa_secret", type_=sa.String(255), existing_type=sa.String(64))
    op.alter_column("users", "mfa_secret_pending", type_=sa.String(255), existing_type=sa.String(64))
    _encrypt_existing_secrets()


def downgrade() -> None:
    _decrypt_existing_secrets()
    op.alter_column("users", "mfa_secret", type_=sa.String(64), existing_type=sa.String(255))
    op.alter_column("users", "mfa_secret_pending", type_=sa.String(64), existing_type=sa.String(255))


def _encrypt_existing_secrets() -> None:
    import os

    from cryptography.fernet import Fernet, InvalidToken

    key = os.environ.get("MFA_ENCRYPTION_KEY")
    if not key:
        raise RuntimeError(
            "MFA_ENCRYPTION_KEY is not set in the environment running this "
            "migration - existing MFA secrets cannot be encrypted without it."
        )
    fernet = Fernet(key.encode())

    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT id, mfa_secret, mfa_secret_pending FROM users "
        "WHERE mfa_secret IS NOT NULL OR mfa_secret_pending IS NOT NULL"
    )).fetchall()

    for row in rows:
        updates = {}
        for col in ("mfa_secret", "mfa_secret_pending"):
            value = getattr(row, col)
            if value is None:
                continue
            try:
                fernet.decrypt(value.encode())
                continue  # already encrypted - idempotent, leave it alone
            except InvalidToken:
                updates[col] = fernet.encrypt(value.encode()).decode()

        if updates:
            set_clause = ", ".join(f"{c} = :{c}" for c in updates)
            conn.execute(
                sa.text(f"UPDATE users SET {set_clause} WHERE id = :id"),
                {**updates, "id": row.id},
            )


def _decrypt_existing_secrets() -> None:
    import os

    from cryptography.fernet import Fernet, InvalidToken

    key = os.environ.get("MFA_ENCRYPTION_KEY")
    if not key:
        raise RuntimeError("MFA_ENCRYPTION_KEY is not set - cannot downgrade.")
    fernet = Fernet(key.encode())

    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT id, mfa_secret, mfa_secret_pending FROM users "
        "WHERE mfa_secret IS NOT NULL OR mfa_secret_pending IS NOT NULL"
    )).fetchall()

    for row in rows:
        updates = {}
        for col in ("mfa_secret", "mfa_secret_pending"):
            value = getattr(row, col)
            if value is None:
                continue
            try:
                updates[col] = fernet.decrypt(value.encode()).decode()
            except InvalidToken:
                continue  # already plaintext - leave it alone
        if updates:
            set_clause = ", ".join(f"{c} = :{c}" for c in updates)
            conn.execute(
                sa.text(f"UPDATE users SET {set_clause} WHERE id = :id"),
                {**updates, "id": row.id},
            )