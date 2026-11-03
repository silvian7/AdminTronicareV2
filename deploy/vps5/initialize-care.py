"""One-time initialization of the verified project's NEW private caregiver database.

Never use this against an existing/shared database. It refuses a preexisting Core
schema/reader role. On failure, preserve the target and inspect the current state;
do not blindly rerun or delete its volume.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys

STAGE = "input validation"


def main() -> None:
    global STAGE
    here = Path(__file__).resolve().parent
    root = Path(os.environ["CARE_RUNTIME_ROOT"])
    if not root.is_absolute() or not (root / "reader-grants.sql").is_file():
        raise ValueError("Prepared private runtime is required.")
    if not re.fullmatch(r"(?:sha256:[0-9a-f]{64}|[^\s]+@sha256:[0-9a-f]{64})", os.environ["CARE_IMAGE"]):
        raise ValueError("Care image must be content-pinned.")
    compose = ["docker", "compose", "-p", "tronicare-admin-vps5", "-f", str(here / "compose.yaml"),
               "-f", str(here / "compose.care.yaml")]
    def run(command: list[str], *, data: str | None = None, timeout: int = 180) -> str:
        result = subprocess.run(command, input=data, capture_output=True, text=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError("Scoped caregiver initialization command failed.")
        return result.stdout.strip()
    STAGE = "Compose validation"
    run(compose + ["config", "--quiet"])
    STAGE = "private PostgreSQL startup"
    run(compose + ["up", "-d", "--wait", "--wait-timeout", "120", "care-postgres"])
    STAGE = "database target verification"
    container = run(compose + ["ps", "-q", "care-postgres"])
    details = json.loads(run(["docker", "inspect", container]))[0]
    labels = details["Config"]["Labels"]
    if (labels.get("com.docker.compose.project") != "tronicare-admin-vps5"
            or labels.get("com.docker.compose.service") != "care-postgres"
            or details["HostConfig"].get("PortBindings")):
        raise ValueError("Database container target is not the intended isolated instance.")
    psql = compose + ["exec", "-T", "care-postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1",
                      "-U", "care_owner", "-d", "care_core", "-At"]
    before = run(psql, data="""BEGIN READ ONLY;
SELECT CASE WHEN current_database()='care_core' AND current_user='care_owner'
 AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='core')
 AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='care_reader')
 AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema'))
 THEN 'fresh-isolated-database' ELSE 'STOP-existing-state' END;
ROLLBACK;
""")
    if "fresh-isolated-database" not in before.splitlines():
        raise ValueError("Existing database state was not changed.")
    print("Verified new project-private caregiver database; applying its Alembic migrations.", flush=True)
    STAGE = "Alembic migration"
    run(compose + ["run", "--rm", "--no-deps", "care-migrate"])
    STAGE = "migrated schema verification"
    after = run(psql, data="""BEGIN READ ONLY;
SELECT CASE WHEN (SELECT version_num FROM core.alembic_version)='20261027_0029'
 AND (SELECT count(*) FROM core.core_api_authority_epoch)=1
 AND EXISTS (SELECT 1 FROM core.core_api_authority_epoch
  WHERE epoch_uuid='d04fc5db-d3ae-5bc2-995a-153f56ccae04'::uuid AND state='LEGACY_ONLY')
 AND NOT EXISTS (SELECT 1 FROM core.device)
 AND NOT EXISTS (SELECT 1 FROM core.sensor)
 THEN 'expected-empty-schema' ELSE 'STOP-schema-mismatch' END;
ROLLBACK;
""")
    if "expected-empty-schema" not in after.splitlines():
        raise ValueError("Migrated schema did not match expected empty state.")
    STAGE = "isolated API reader grants"
    run(psql, data=(root / "reader-grants.sql").read_text(encoding="utf-8"))
    STAGE = "reader and reports connection verification"
    verification = (here / "verify-care-reader.py").read_text(encoding="utf-8")
    run(compose + ["run", "--rm", "--no-deps", "-T", "--entrypoint", "python", "care-api", "-"], data=verification)
    STAGE = "initialization receipt"
    receipt = root / "initialized.txt"
    with receipt.open("x", encoding="utf-8") as output:
        output.write("schema=20261027_0029\nreader=verified\nshared_database_mutations=none\n")
    receipt.chmod(0o600)
    print("Caregiver schema and TLS/SELECT-only reader verified; shared databases were unchanged.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(f"Caregiver initialization stopped during {STAGE}. Preserve current state and inspect it before continuing; no automatic cleanup was attempted.", file=sys.stderr)
        sys.exit(1)
