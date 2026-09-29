"""Repo-hygiene guards for phase4-fiscal (P0).

These encode the standing rules from docs/security.md and the Phase 4
blueprint as executable checks, so a violation fails the delivery gate
instead of relying on anyone remembering:

  - no float anywhere in the fiscal path (Decimal only)
  - phase4-fiscal never imports the QPD engine (zimra_qpd)
  - no certificate / private-key / env files committed outside the one
    allowed folder for ZIMRA's published illustration-only sample keys
  - .gitignore actually blocks those file types
"""

import ast
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "fiscal_core"
ALLOWED_FIXTURES = pathlib.Path("tests") / "fixtures" / "spec_examples"
SKIP_DIRS = {"venv", ".venv", "_backups", "_logs", ".pytest_cache", "__pycache__", ".git"}
SECRET_SUFFIXES = {".pem", ".key", ".csr", ".crt", ".cer", ".p12", ".pfx", ".jks", ".keystore"}
REQUIRED_IGNORES = [
    "*.pem", "*.key", "*.csr", "*.crt", "*.cer", "*.p12", "*.pfx", "*.jks",
    "*.keystore", "secrets/", "keystore/", ".env", ".env.*", "*.sqlite", "*.db",
    "venv/", "_backups/", "_logs/",
]


def _source_files():
    return sorted(SRC.rglob("*.py"))


def test_source_files_found():
    # Guard against the scan silently checking nothing.
    names = {p.name for p in _source_files()}
    assert {"money.py", "canonicalise.py"} <= names


def test_no_float_literals_or_float_calls_in_fiscal_path():
    offenders = []
    for path in _source_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, float):
                offenders.append(f"{path.name}:{node.lineno} float literal {node.value!r}")
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "float"
            ):
                offenders.append(f"{path.name}:{node.lineno} float() call")
    assert not offenders, "float in the fiscal path is a launch-blocker: " + "; ".join(offenders)


def test_no_qpd_engine_imports():
    offenders = []
    for path in _source_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.split(".")[0] == "zimra_qpd":
                        offenders.append(f"{path.name}:{node.lineno}")
            if isinstance(node, ast.ImportFrom) and node.module:
                if node.module.split(".")[0] == "zimra_qpd":
                    offenders.append(f"{path.name}:{node.lineno}")
    assert not offenders, "phase4-fiscal must not import zimra_qpd: " + "; ".join(offenders)


def test_no_secret_files_outside_allowed_fixtures():
    offenders = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        rel_dir = pathlib.Path(dirpath).relative_to(ROOT)
        in_allowed = rel_dir == ALLOWED_FIXTURES or ALLOWED_FIXTURES in rel_dir.parents
        for name in filenames:
            suffix = pathlib.Path(name).suffix.lower()
            is_secret = suffix in SECRET_SUFFIXES or name == ".env" or name.startswith(".env.")
            if is_secret and not in_allowed:
                offenders.append(str(rel_dir / name))
    assert not offenders, "secret-type files present: " + ", ".join(offenders)


def test_gitignore_blocks_secrets():
    lines = {
        ln.strip()
        for ln in (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    }
    missing = [p for p in REQUIRED_IGNORES if p not in lines]
    assert not missing, ".gitignore is missing: " + ", ".join(missing)
