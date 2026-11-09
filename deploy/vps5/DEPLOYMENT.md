# VPS5 deployment — 9 November 2026

The caregiver portal is restored for platform administrators. The previous
caregiver API rejected otherwise valid Assets inventory records whose organization
ID is `0` (unassigned), causing the entire subjects collection to return HTTP 503.
The fixed adapter accepts those inventory records and excludes them from caregiver
eligibility while retaining strict ID validation and caller authorization.

- Caregiver image: `sha256:8c418b48ebaa6c694953594d636c6132a5381e5217ce6dde510d77121fab5fb4`.
- Active selection: `/opt/tronicare-admin/releases/vps5-20261109-care-unassigned.env`;
  `/opt/tronicare-admin/current` points to its matching release directory.
- Previous selection: `/opt/tronicare-admin/releases/vps5-20261107-quarantine.env`.
- The candidate contains the exact previous caregiver image plus one
  `care_assets.py` replacement. Source SHA-256:
  `d75d00438c85c0cb4bde37ca4ac70d670a1220dcd5ac0d5b0e362fcd811e1a4d`.
- Image archive SHA-256:
  `12527944318eeffd2f81e5360473607f812f455311f81c6f5c539969f8db001d`.

The 124 focused caregiver and Assets adapter regression tests passed. With the
existing signed-in superadmin session, the caregiver upstream, local Admin proxy
and public HTTPS proxy changed from 503 to 200, returning 18 assigned subjects
and reporting report availability. All 16 unassigned inventory records remain
excluded from caregiver subjects.

Only the caregiver API container was recreated. Its runtime configuration,
networks and mounts were preserved; Admin, Redis and caregiver PostgreSQL retained
their container identities and settings. No migration, grant or business-data
change was performed. Release metadata, rollout and authenticated verification
receipts are stored in the active release directory. Admin remains the quarantine
release documented below; its previous release directory retains its full source
and validation evidence.

For subsequent operations, use both Compose files and the active selection above.
To roll back only this caregiver fix, retain the current Admin and databases and
select the previous caregiver image through the previous release environment:

```sh
docker compose --env-file releases/vps5-20261107-quarantine.env \
  -p tronicare-admin-vps5 -f compose.yaml -f compose.care.yaml \
  up -d --no-deps --pull never --wait --wait-timeout 120 care-api
```

## Previous Admin release — 7 November 2026 (Quarantine)

Incoming and outgoing quarantine inspectors are deployed at
<https://admin.tronicare.com/services> for platform administrators.

- Admin image: `sha256:1dc9f3d7b5b606e4ef1fb8343de9d3d72ced9650f9967433dbf76bca40005a72`.
- Active selection: `/opt/tronicare-admin/releases/vps5-20261107-quarantine.env`;
  `/opt/tronicare-admin/current` points to its matching release directory.
- Source: validated working tree based on `8d2fc4b83f7555793338d91994eb5365155b2a73`,
  snapshot SHA-256 `70dc24d761b6e7536d8c2b2c4b324f010869d5852a8c63cc1a95e816f15e81f8`.
- Image archive SHA-256: `8c39e7fd4dbf685bb0a425284c44efcede9ed07decff85bfb83fe359df4b3e56`.
- Entry bundle: `/assets/index-u5b66R9D.js`; all eight public client files match
  the verified image. All 18 public health/access checks passed.

Core API runs
`smandi/core-py@sha256:74bc1a4569cb0c4c6f81bf789e17d2bf5c8851bc526e7a66c06b128cd8b298bf`.
MqttBridge API runs
`smandi/mqttbridge-py@sha256:0f823b83fbc939e3a89f6c15299efac706259c499da838266d1e07e2152a5d07`.
Both are healthy in the existing migration namespace. Only their viewer hunks
and required authorization dependencies were overlaid on the verified running
baselines. Installed service/Foundation sources and migrations matched their
qualified manifests. The final images passed 125 Core and 85 MqttBridge tests.

The bridge's existing status ingress gained only the incoming-quarantine Prefix
to the same API service. Both new Bridge paths now return 401 without credentials;
all four new Core paths do likewise. Other ingress rules, network policies and
service settings were retained.

Admin retained runtime settings, session storage, caregiver API and caregiver
PostgreSQL container identities. All worker/ingest/outbox specifications and
replica counts were preserved. Core received 39 missing metadata-column SELECT
privileges; raw access, grant options, role memberships and deferred-table ACLs
were not expanded. Bridge required no grants. No schema migration or message
replay/acknowledgement occurred.

The 1,384 Admin unit tests (one opt-in Redis skip), 20 browser cases, three focused
visual checks and 10 isolated PostgreSQL checks passed. Deployed readers passed
live metadata and attempt checks for outgoing Core and all four incoming sources.
Empty capped incoming ranges retain continuation rather than claiming no older
quarantines. Raw message bodies/topics are excluded; History recovery status is
explicitly unavailable in this version.

No active production platform session was available for a signed-in BFF/browser
smoke check. Browser behavior was verified with synthetic sessions; live reader,
public artifact and access-protection checks passed independently.

## Previous Admin release — 7 November 2026 (Hub Online)

The following records the prior release at its rollout.

Admin's Hub **Online** tab and its shared Core endpoint are deployed at
<https://admin.tronicare.com>.

- Immutable Admin image: `sha256:7146cf9cd481987c87727a3cdeedeb593d31780a63eeda106f004496ccd1c288`.
- Previous selection: `/opt/tronicare-admin/releases/vps5-20261107-hub-online.env`;
  `/opt/tronicare-admin/current` pointed to the matching release directory.
- Source is a validated working tree based on
  `47f43d4efbed8192eba011d6b5213ed08bc07f14`, with source snapshot SHA-256
  `c69eb4c7abf7b94e0f39175ad6ba7a968a67b5eaf560682ae61f617ace5e15e4`.
- Image archive SHA-256: `c5d17ae81d1de34a3e417b9a0cc546648aa3666225dc486908a8323401857f19`.
- The previous `vps5-20261106-a6bad31` selection and image remain available.

The production build, 1,284 unit tests, 33 local browser cases, contract checks
and two additional read-only synthetic browser cases against the public bundle
passed. All eight public client files match the verified image. Public live and
readiness checks return 200; anonymous session and Hub Online requests return 401.
The entry bundle is `/assets/index-BVqQQpTv.js`.

Admin retained its existing runtime configuration, session storage, standalone
caregiver API and caregiver PostgreSQL container identities.

The shared Core API now runs
`smandi/core-py@sha256:c4d59aa94676884fc908d2f96b881ccd9c6f005ef43b524eb193d1e79d81cd38`
in `kubernetes-admin@dev` / `tronicare-migration`. Its four-file feature overlay
preserves the restored maintenance image `c0eb2262…` and schema revision
`20261107_0034`. The API is ready with one replica. Ingest, Worker and Outbox
deployment specifications were retained after maintenance had restored them.

The Core API role received SELECT on five receipt metadata columns only:
`telemetry_batch.id`, `telemetry_batch.received_at`, `telemetry_item.batch_id`,
`telemetry_item.resolved_hub_id` and `telemetry_item.replay_authorization_uuid`.
Raw payload access remains denied. No schema migration was needed. The final
image passed 54 focused container tests and five isolated PostgreSQL cases.
The time-first indexed query has an eight-second SQL deadline and ten-second
outer deadline. Core readiness returns 200 and anonymous history requests return
401 for all three spans.

The deployed reader returned valid 24-hour, 48-hour and seven-day buckets using
its actual API database login in a read-only snapshot. The three reads completed
in 0.374, 0.907 and 2.798 seconds. HTTPS ingress checks confirmed access protection
for every span, and public Admin readiness returned 200.

No active platform session was available locally or on production for a signed-in
browser check. The public bundle's desktop/mobile behavior was checked with
synthetic responses; live metadata checks and access-protection checks are
recorded separately in the private rollout evidence.

## Previous Admin release — 6 November 2026

The previous Admin release was built from clean commit
`a6bad31e37f814b1d5d6641b07011c209a0a9aef`.

- Immutable Admin image: `sha256:0d166c64ce94ccffc3d2a7b74c937107d4f3537982bc8277ee27f14a5930782e`.
- Active selection: `/opt/tronicare-admin/releases/vps5-20261106-a6bad31.env`.
- Release files and evidence: `/opt/tronicare-admin/releases/vps5-20261106-a6bad31/`;
  `/opt/tronicare-admin/current` points to this directory.
- Previous selection retained: `/opt/tronicare-admin/releases/vps5-20261103-all-assets.env`.
- Image archive SHA-256: `9d600143a93020473c0647cc7bde50773c882d06d119ed7c45bcccffae89638a`.

Validation passed: 1,243 unit tests (one opt-in Redis test skipped), the 11-document /
22-resource contract check, TypeScript and Linux production build, zero dependency
audit vulnerabilities, and 81 browser cases against the release image. Two further
synthetic browser checks passed against the public HTTPS bundle, covering bed-state
ages and the tablet asset list. Public `/`, `/care`, `/health/live` and
`/health/ready` return 200; anonymous `/api/session` and `/api/care/subjects` return
401. Public HTML, JavaScript and CSS match the release image byte for byte; the
client entry is `/assets/index-BAFOqEcW.js`.

Only Admin was recreated. Runtime configuration, Redis sessions, caregiver API and
caregiver PostgreSQL retained their existing settings and container identities.
No backend rollout or database migration was performed. The existing caregiver
API image predates temperature streams; this Admin handles that legacy response
by showing temperature as unavailable while preserving the other report panels.

The first post-rollout verification stopped after the new container became healthy.
Its receipt is preserved as `rollout.initial-postcheck-stop.json`. Independent
inspection then verified the exact running image, unchanged runtime/dependencies,
all loopback routes and public checks; the release pointer was finalized without
repeating the rollout or rolling back. Final evidence is in `rollout.json`.

For subsequent Admin-only activation, retain both Compose files and existing private
runtime settings:

```sh
docker compose --env-file releases/vps5-20261106-a6bad31.env \
  -p tronicare-admin-vps5 -f compose.yaml -f compose.care.yaml \
  up -d --no-deps --pull never --wait --wait-timeout 120 admin
```

The following sections preserve the previous deployment record from 3 November.

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
