"""
One-off repair script: THE root-cause fix for "can't delete account / business".

Why this exists
----------------
The SQLAlchemy models declare `ForeignKey(..., ondelete="CASCADE")` and the
relationships use `passive_deletes=True`. That's correct - but it only tells
SQLAlchemy to *expect* the database to cascade. It does not, by itself,
change an already-existing constraint in Postgres. Alembic's autogenerate
does not reliably detect an `ondelete` change on an existing foreign key, so
if that constraint was ever created without `ON DELETE CASCADE` (e.g. an
early migration, before this was added to the models), it silently stays
that way in production forever - autogenerate sees "constraint already
exists" and produces no diff.

The visible symptom: deleting a user/business that still has rows in a
child table raises a Postgres `ForeignKeyViolation`. That bubbles up as an
unhandled exception, which `CatchAllMiddleware` in app/main.py correctly
turns into a generic 500 ("Something went wrong on our end") so it looks
like the delete is simply being "refused", with no useful detail anywhere.

This script is idempotent: for every (child table, column, parent table)
pair below, it looks up whatever the *current* foreign key constraint is
called (name doesn't matter, it's discovered from information_schema),
drops it, and recreates it with `ON DELETE CASCADE`. Safe to run any number
of times - if a constraint is already CASCADE it's left untouched.

Run once, against production:
    cd phase2-backend
    python -m scripts.fix_cascade_constraints

Uses DATABASE_URL_SYNC (the same synchronous Postgres URL Alembic uses),
so it works with a plain `psycopg2`/`psycopg` sync connection - no asyncpg
event-loop juggling needed for a one-shot DDL script.
"""
from __future__ import annotations

import sys

from sqlalchemy import create_engine, text

from app.config import get_settings

# (child_table, child_column, parent_table, parent_column)
FOREIGN_KEYS: list[tuple[str, str, str, str]] = [
    ("businesses", "owner_id", "users", "id"),
    ("refresh_tokens", "user_id", "users", "id"),
    ("qpd_calculations", "business_id", "businesses", "id"),
    ("capital_assets", "business_id", "businesses", "id"),
]

FIND_CONSTRAINT_SQL = text(
    """
    SELECT tc.constraint_name, rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
        AND tc.table_schema = rc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name
        AND rc.unique_constraint_schema = ccu.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = :child_table
        AND kcu.column_name = :child_column
        AND ccu.table_name = :parent_table
    """
)


def main() -> int:
    settings = get_settings()
    engine = create_engine(settings.database_url_sync)

    fixed, already_ok, missing = [], [], []

    with engine.begin() as conn:
        for child_table, child_column, parent_table, parent_column in FOREIGN_KEYS:
            row = conn.execute(
                FIND_CONSTRAINT_SQL,
                {"child_table": child_table, "child_column": child_column, "parent_table": parent_table},
            ).first()

            if row is None:
                missing.append((child_table, child_column, parent_table))
                continue

            constraint_name, delete_rule = row
            if delete_rule == "CASCADE":
                already_ok.append(constraint_name)
                continue

            conn.execute(text(f'ALTER TABLE {child_table} DROP CONSTRAINT "{constraint_name}"'))
            new_name = f"{child_table}_{child_column}_fkey"
            conn.execute(
                text(
                    f'ALTER TABLE {child_table} '
                    f'ADD CONSTRAINT "{new_name}" FOREIGN KEY ({child_column}) '
                    f'REFERENCES {parent_table} ({parent_column}) ON DELETE CASCADE'
                )
            )
            fixed.append(f"{constraint_name} -> {new_name} (was {delete_rule or 'NO ACTION'})")

    print("=== Cascade constraint repair ===")
    if fixed:
        print("Fixed (now ON DELETE CASCADE):")
        for f in fixed:
            print(f"  - {f}")
    if already_ok:
        print("Already correct:")
        for c in already_ok:
            print(f"  - {c}")
    if missing:
        print("WARNING - no matching constraint found (check table/column names):")
        for m in missing:
            print(f"  - {m}")

    print("\nDone. Account and business deletion will now cascade at the database level.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
