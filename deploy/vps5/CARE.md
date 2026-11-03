The optional caregiver overlay preserves `/care` when the normal API ingress has
no caregiver routes. It creates a new isolated PostgreSQL container and runs only
the read-only caregiver API. It starts no worker, ingest process, vendor job or
telemetry simulation, and does not migrate or change the shared report database.

Set these deployment environment variables in addition to the base Admin values:

```sh
export CARE_IMAGE='sha256:<verified-caregiver-image-id>'
export CARE_RUNTIME_ROOT='/absolute/private/shared/care-runtime'
```

When PostgreSQL was transferred by `docker save`/`docker load` and has no registry
digest mapping, also export `CARE_POSTGRES_IMAGE` with the exact verified image ID:
`sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af`.
Both the database and TLS helper use that same immutable image. Omit this override
when the default pinned registry digest is available. The base Redis has the
equivalent optional `SESSIONS_IMAGE` override; see `release.env.example`.

The helper and Compose commands require `ADMIN_IMAGE`, `ADMIN_ENV_FILE`,
`CARE_IMAGE` and `CARE_RUNTIME_ROOT` to be exported in the current shell. If they
are stored in the verified release environment file, load that file with shell
export enabled before running these commands:

```sh
set -a
. /absolute/path/to/verified-release.env
set +a
```

`CARE_IMAGE` must refer to the transferred, verified existing image by content ID
or registry digest. The current tested local-source image is not a clean Git
release; exporting it preserves its exact bytes without asserting clean source
provenance. Its bundled Foundation/Core source and migrations matched the named
local source tree at preparation time. Keep this provenance with the release.
The API retains the tested `migration-readonly-v1` serving profile, which requires
the configuration value `TRONICARE_ENVIRONMENT=development` even on this host.
This does not enable test mode, mutations or authority activation.

Extract only `CORE_CARE_REPORTS_DATABASE_URL` from the existing runtime into a new
private transfer file without printing it, then privately transfer that minimal
file to the verified VPS5 host. Only that existing SELECT-only report reader value
is consumed; owner credentials, API reader credentials and HMAC keys are generated
afresh for the isolated database. Do not transfer the original secret file, the
whole local runtime directory or any local database volume. Keep the transfer
private and never print its contents.

Prepare runtime files once, replacing the example paths with the verified paths:

```sh
sudo python3 prepare-care-runtime.py \
  --runtime-root "$CARE_RUNTIME_ROOT" \
  --scope-origin https://dev.api.tronicare.com \
  --reports-secret /absolute/private/transferred-reports.secret \
  --reports-host vps5.tronicare.com
python3 initialize-care.py
```

The preparation script refuses an existing directory. It assigns API/migration
configuration to UID 65532 and private Compose input files to the invoking sudo
user. The initialization script fixes project `tronicare-admin-vps5`, verifies
an unpublished, fresh database with no Core schema or reader role, applies the
image's Alembic migrations through revision `20261027_0029`, checks the initial
`LEGACY_ONLY` authority state and empty equipment tables, then grants the API
reader only its required SELECT permissions. It verifies TLS, read-only sessions
and absence of reader write/routine privileges, plus the existing reports
connection. It does not print credentials or protected records.

Any partial failure requires inspection of the existing state. Preserve the
volume/configuration and resolve the identified failure; do not blindly rerun
the initializer or delete state. Normal subsequent releases reuse the existing
private runtime and database; never run either initializer again.

Start the verified release using both Compose files:

```sh
docker compose -p tronicare-admin-vps5 -f compose.yaml -f compose.care.yaml \
  up -d --wait --wait-timeout 120 admin care-api
```

Retain `CAREGIVER_USER_TYPE_IDS=27` only while that ID matches the intended Users
classification. The overlay enables the caller-scoped Admin observation bridge
and routes only caregiver reads to this API; normal Core routing is preserved.
No API or database port is published. Keep the migration owner configuration
private and use only the API reader configuration for the running service.
