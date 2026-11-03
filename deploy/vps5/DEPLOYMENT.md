# VPS5 deployment — 3 November 2026

Admin is available at <https://admin.tronicare.com> on VPS5 (`217.182.169.207`).
The temporary `https://vps5.tronicare.com` address redirects to the canonical host.

## Release

| Component | Immutable image ID |
| --- | --- |
| Admin | `sha256:b71f48d18cb2497f17a479371d02543c72aca05c0fd042accacb873c25b71523` |
| Caregiver API | `sha256:94c637838cb110c60a41492b7abeb84f3b5363dfe82a5eaaa6757328a71781a0` |
| Redis | `sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf` |
| PostgreSQL | `sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af` |

Admin was updated with the validated working tree based on commit
`79c3ce67d44b23aefd68e2f3f75b7351e1fb4c36`, adding membership all-assets controls
and their entry point from the user edit page. The archived source patch SHA-256 is
`8611f3c2cbbf6962c50ae9f4d39e718db67205297f339a05c52d61f613510e82`;
the image label records that hash. This is a working-tree release, not a new Git
commit. The prior clean-commit Admin image and release remain available for rollback.
The caregiver image preserves the exact
tested local-source image; it is not represented as a clean Git release. Its
207 bundled Foundation/Core/migration files matched the local named source tree.
Images were transferred as Docker archives and verified on VPS5. Archive loading
lost the Redis/PostgreSQL repository references, so their exact content IDs are
selected in the release environment file. Existing VPS5 Docker Hub credentials
were not changed.

## Installed layout

- Deployment root: `/opt/tronicare-admin`; Compose project: `tronicare-admin-vps5`.
- Active files: `compose.yaml` and `compose.care.yaml` in that root.
- Release selection: `/opt/tronicare-admin/releases/vps5-20261103-all-assets.env`.
- Release snapshot: `/opt/tronicare-admin/releases/vps5-20261103-all-assets/`, also
  referenced by `/opt/tronicare-admin/current`.
- Private Admin settings: `/opt/tronicare-admin/private/admin.env`.
- Private caregiver settings: `/opt/tronicare-admin/private/care-runtime`.
- Nginx sites: `tronicare-admin` and `tronicare-admin-vps5-redirect`.
- ACME webroot: `/var/www/tronicare-admin-acme`.

From the deployment root, reuse the existing configuration and database:

```sh
docker compose --env-file releases/vps5-20261103-all-assets.env \
  -p tronicare-admin-vps5 -f compose.yaml -f compose.care.yaml \
  up -d --pull never --wait --wait-timeout 120 admin care-api
```

Both Compose files must be retained on later deployments. Never rerun the
first-time credential/database initializers for this installation. Keep private
configuration and named volumes; do not use `down -v` during an application update.

## Runtime and verification

Nginx terminates HTTPS and forwards to Admin on `127.0.0.1:8080`; Admin trusts
exactly that one proxy. Redis and caregiver API/PostgreSQL have no published
ports. All four long-running containers were healthy. The separate existing
Nginx, Docker and ingester services remained active.

The new isolated caregiver database was migrated to `20261027_0029`, with the
initial `LEGACY_ONLY` authority epoch and empty equipment tables. Its API reader
was verified to have only the required SELECT privileges and no write/routine
privileges. The local and existing reports connections both verified TLS and
read-only sessions. Shared database schemas and grants were unchanged.

The caregiver API retains the tested `migration-readonly-v1` compatibility
profile. That profile requires `TRONICARE_ENVIRONMENT=development`; test mode,
mutation authorization and activation authorization remain false. Admin itself
runs its production image. The caregiver service uses normal caller-scoped
Users/Assets authorization and the existing reports reader, without workers or
ingestion. See [CARE.md](CARE.md) for the profile and image provenance.

The all-assets update recreated only Admin. The Redis, caregiver API and caregiver
database retained their container IDs and remained healthy. Existing private
settings and the session encryption key were reused. The deployed Users revision
9 and Assets revision 12 contain the all-assets contract and scope support; their
code markers and readiness were inspected without accessing credentials or data.
The database migration state was not independently queried in this update.

The update passed 1,098 unit tests (one opt-in test skipped), 23 local synthetic
browser cases, the contract check and the Linux production Docker build. Three
additional browser checks passed against the deployed HTTPS bundle with every API
request intercepted by synthetic routes: user-edit discovery, unsaved-change
navigation and explicit access revocation. No real account access was changed.
The served bundle is `/assets/index-kXBjEt0l.js`; public readiness returned 200.

Initial release validation:

- Contracts: 11 documents and 22 resources; unit tests: 1,056 passed, one opt-in
  test skipped; TypeScript, client and server builds passed.
- HTTPS `/health/live` and `/health/ready`: 200. Anonymous `/api/session` and
  `/api/care/subjects`: 401.
- Caregiver upstream readiness: 200; anonymous `/v1/care/subjects`: 401.
- Chromium rendered both Admin and caregiver login pages without JavaScript
  errors or failed requests; caregiver sign-in retained its return path.
  The browser resolved the hostname directly to VPS5 while validating its real
  certificate, because the workstation's recursive DNS resolver still cached
  the previous address.
- Authoritative DNS, Cloudflare and Google resolved `admin.tronicare.com` to
  `217.182.169.207`. Other recursive caches can retain the old address until expiry.
- The Admin hostname certificate expires on 1 February 2027; Certbot renewal
  is scheduled and reloads Nginx. HTTP redirects to canonical HTTPS.

No account credentials were submitted, so authenticated sign-in and account-data
workflows were not smoke-tested on the new public origin. Temporary copies used
to transfer the existing reports reader configuration were removed.
