"""Prepare private credentials for one NEW, isolated VPS5 caregiver database.

Run with sudo. Existing files are never replaced. No database is contacted or changed.
Only the existing SELECT-only reports DSN is taken from the supplied private file.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import secrets
import socket
import sys
from urllib.parse import parse_qs, urlsplit


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-root", type=Path, required=True)
    parser.add_argument("--scope-origin", required=True)
    parser.add_argument("--reports-secret", type=Path, required=True)
    parser.add_argument("--reports-host", required=True)
    args = parser.parse_args()
    if os.name != "posix" or os.geteuid() != 0:
        raise ValueError("Run this initializer with sudo on the verified Linux VPS.")
    root = args.runtime_root
    if not root.is_absolute() or root == Path("/") or root.is_symlink():
        raise ValueError("An absolute, dedicated runtime directory is required.")
    if root.exists():
        raise ValueError("Runtime directory already exists; it was not changed.")
    origin = urlsplit(args.scope_origin)
    if (origin.scheme != "https" or not origin.hostname or origin.username
            or origin.password or origin.query or origin.fragment or origin.path
            or args.scope_origin != f"https://{origin.netloc}"):
        raise ValueError("A verified HTTPS Users/Assets origin without a path is required.")
    values = {}
    for line in args.reports_secret.read_text(encoding="utf-8-sig").splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    reports = values.get("CORE_CARE_REPORTS_DATABASE_URL", "")
    parsed = urlsplit(reports)
    if (parsed.scheme != "postgresql+psycopg" or parsed.username != "care_portal_reader"
            or not parsed.password or parsed.path != "/sensors_history"
            or parse_qs(parsed.query).get("sslmode") != ["require"]):
        raise ValueError("Reports configuration must use the existing TLS/SELECT-only reader.")
    def addresses(host: str) -> set[str]:
        return {entry[4][0] for entry in socket.getaddrinfo(host, None)}
    if not parsed.hostname or not (addresses(parsed.hostname) & addresses(args.reports_host)):
        raise ValueError("Reports host does not match the independently verified target.")
    operator_uid = int(os.environ.get("SUDO_UID", "0"))
    operator_gid = int(os.environ.get("SUDO_GID", "0"))
    root.mkdir(parents=True, mode=0o700)
    os.chown(root, operator_uid, operator_gid)
    for child in ("api", "migrate"):
        (root / child).mkdir(mode=0o700)
        os.chown(root / child, 65532, 65532)
    def save(relative: str, content: str, uid: int = operator_uid, gid: int = operator_gid) -> None:
        path = root / relative
        with path.open("x", encoding="utf-8", newline="\n") as output:
            output.write(content)
        path.chmod(0o600)
        os.chown(path, uid, gid)
    owner_password = secrets.token_hex(32)
    reader_password = secrets.token_hex(32)
    save("postgres.env", "POSTGRES_DB=care_core\nPOSTGRES_USER=care_owner\n"
         f"POSTGRES_PASSWORD={owner_password}\nPOSTGRES_INITDB_ARGS=--auth-host=scram-sha-256\n")
    api_env = "\n".join([
        # The tested migration-readonly profile requires this environment name.
        "TRONICARE_ENVIRONMENT=development", "CORE_MODE=active", "CORE_TEST_MODE=false",
        "CORE_API_HOST=0.0.0.0", "CORE_API_PORT=8082",
        "CORE_API_CONTRACT_PROFILE=legacy-semantic-v1",
        "CORE_API_SERVING_PROFILE=migration-readonly-v1", "CORE_API_SERVING_AUTHORIZED=true",
        "CORE_API_MUTATIONS_AUTHORIZED=false", "CORE_API_ACTIVATION_AUTHORIZED=false",
        "CORE_API_EXPECTED_AUTHORITY_EPOCH=d04fc5db-d3ae-5bc2-995a-153f56ccae04",
        f"CORE_API_LEGACY_SCOPE_ORIGIN={args.scope_origin}",
        "CORE_DATABASE_POOL_SIZE=2", "CORE_DATABASE_MAX_OVERFLOW=0",
        "CORE_CARE_REPORTS_SCHEMA=public", "",
    ])
    save("api/.env", api_env, 65532, 65532)
    save("api/.secret",
         f"CORE_API_DATABASE_URL=postgresql+psycopg://care_reader:{reader_password}@care-postgres:5432/care_core?sslmode=require&gssencmode=disable\n"
         f"CORE_API_CALLER_REF_HMAC_KEY={secrets.token_hex(32)}\n"
         f"CORE_CARE_REPORTS_DATABASE_URL={reports}\n", 65532, 65532)
    save("migrate/.secret",
         f"CORE_DATABASE_URL=postgresql+psycopg://care_owner:{owner_password}@care-postgres:5432/care_core?sslmode=require&gssencmode=disable\n",
         65532, 65532)
    save("reader-grants.sql", f"""BEGIN;
REVOKE ALL ON DATABASE care_core FROM PUBLIC;
REVOKE ALL ON SCHEMA core FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA core FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA core FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA core FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE care_owner IN SCHEMA core REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE ROLE care_reader LOGIN PASSWORD '{reader_password}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE care_core TO care_reader;
GRANT USAGE ON SCHEMA core TO care_reader;
GRANT SELECT ON core.core_api_authority_epoch, core.device, core.sensor, core.sensor_type TO care_reader;
ALTER ROLE care_reader SET default_transaction_read_only=on;
COMMIT;
""")
    print("New isolated caregiver runtime prepared; no credentials were printed.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Caregiver runtime preparation failed; inspect inputs and preserve any partial files.", file=sys.stderr)
        sys.exit(1)
