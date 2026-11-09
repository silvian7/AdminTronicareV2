# Implementation validation

## Incoming and outgoing quarantine inspection — 7 November 2026

Service status now provides separate read-only inspectors for incoming and
outgoing quarantine metadata. Incoming covers Core rejected/blocked/permanent
telemetry, MQTT parser quarantine, failed bridge batches and primary/mirror
routes, and individual bridge deliveries including unbatched shadow records.
Outgoing covers Core's uncertain and permanently failed intents across all four
destinations. Destination/source/status changes and refresh reset paging and
details; session/source changes cannot display stale details.

- Admin unit/BFF/decoder tests: **1,384 passed**, one opt-in Redis test skipped;
  this includes 100 new quarantine cases.
- Browser coverage: **20 cases passed**, followed by three focused layout/source
  checks after visual polish. Desktop/mobile screenshots were inspected.
- TypeScript, contract synchronization (11 documents / 22 resources), formatting
  and diff checks passed for the implemented Admin views.
- Isolated PostgreSQL 18 checks: **10 passed** across outgoing and incoming Core
  and MqttBridge readers. These exercise metadata-only privileges, missing-grant
  failures, exact identities, microsecond cursors, sparse 100,000-record paging,
  acknowledgement versions, mirror-only failures and the newest-100 attempt cap.
- Final candidate-container checks: **125 Core cases** and **85 MqttBridge cases
  passed**, verifying all installed service/Foundation sources and migrations.
  Each suite includes 14 checks for bounded empty-body handling, invalid headers,
  unexpected data and stalled request streams. Incoming reads reject unexpected
  bodies immediately and time out empty-stream validation after one second.

Payloads, protected MQTT topics, free-form errors, lease tokens and credentials
are excluded from the projections. Incoming lists explicitly report bounded scan
coverage and permit continuation through empty checked ranges. Incoming order is
by descending record ID; outgoing order is by quarantine time and ID. History
recovery metadata remains unavailable rather than being inferred from the source
quarantine state. No replay or acknowledgement mutation is exposed.

The broader Core compatibility run had **606 passes and one pre-existing frozen
source-provenance assertion failure** for an unchanged models binding. Only this
task's current API hash was refreshed; historical artifacts and unrelated current
bindings were preserved. Core's global OpenAPI route coverage retains seven
existing undocumented routes; all six added Core/Bridge GET operations and Core
schema references have targeted coverage.

Admin, Core API and MqttBridge API are deployed. All eight public client hashes,
18 public health/access checks, and installed-reader live-data checks passed.
The missing Bridge ingress Prefix was added to its existing status API service;
actual HTTPS list/detail paths now enforce authentication. Runtime/dependency
identities, worker specifications and replica counts were preserved. Core's
39 missing metadata column reads were granted without expanding raw access or
deferred ACLs; Bridge's existing permissions were retained. No schema migration,
message replay or acknowledgement was performed.

Production had no stored or eligible platform session during the final inventory,
so signed-in production BFF/browser verification was unavailable. The 20 browser
cases use synthetic sessions; installed-reader live-data and HTTPS access checks
are recorded separately. No authentication or session changes were made.

## Hub Online activity — 7 November 2026

Hub details now place **Online** immediately after **Devices**, with rolling
24-hour, 48-hour and seven-day views. The responsive timeline distinguishes
five-minute intervals with retained activity, no recorded activity and incomplete
counts. URL state, visible-minute refresh, manual refresh, retry and session/hub
isolation are covered. Activity gaps are not presented as confirmed disconnections.

- Admin unit tests: **1,284 passed**, one opt-in Redis test skipped.
- Browser checks: **10 new Online cases** and **23 existing hub/device cases passed**.
- TypeScript, contracts, production client/server build, Linux Docker build,
  changed-file formatting and diff checks passed. Desktop and mobile layouts were
  visually inspected.
- The companion Core implementation passed **54 API/bucket tests** and **five
  isolated PostgreSQL 18 cases**, including metadata-only privileges, missing-grant
  errors, exact scope, boundaries, replay exclusion and the 100,001-item limit probe.
- Core's broader compatibility run had **566 passes and one frozen source-provenance
  hash assertion failure**. Historical frozen artifacts were preserved. Its global
  OpenAPI coverage check also retains seven existing undocumented routes; the new
  route has targeted schema/reference coverage.

Only the current provenance hashes for the two changed Core API/store files were
refreshed. The remaining provenance mismatch is confined to four unrelated dirty
files in the companion workspace. A feature-only backend patch applies cleanly to
its recorded base without including that unrelated work.

Local Admin was rebuilt and production Admin and Core were deployed with the new
tab and `GET /v1/hubs/{id}/online` endpoint. Production health, artifact hashes and
two read-only synthetic browser checks pass. The final Core image passed all 54
focused cases again, preserves the restored maintenance baseline and admits the
existing `20261107_0034` schema. Only the API image changed; other shared Core
deployment specifications were retained.

Five metadata-only SELECT privileges were added for the API role; raw payload
access remains denied and no schema migration was needed. A live-data performance
check exposed a full inbox scan for longer ranges. A time-first LATERAL lookup
using existing indexes passed all three spans; SQL and outer deadlines remain
bounded at eight and ten seconds. Core readiness returns 200 and anonymous
history requests return 401 for 24, 48 and 168 hours.

The deployed receipt reader passed all three spans using its configured API
database login in a read-only repeatable-read snapshot: 288, 576 and 2,016
buckets, completing in 0.374, 0.907 and 2.798 seconds respectively. Bucket/count
invariants passed; metadata SELECT access was confirmed, while raw columns and
grant options remained denied. The exact pod/image identity was rechecked after
the probe. HTTPS ingress protection and public Admin readiness also passed.

There were no active platform sessions locally or on production for a signed-in
browser check. Desktop/mobile browser coverage uses synthetic API responses;
separate live metadata checks exercise the real retained receipts without
changing authentication or business data.

## User edit access discovery and VPS5 update — 3 November 2026

The user edit page now links directly from **All assets / Manage asset access**
to that user's Organizations tab. Valid user tab URLs retain unrelated query
parameters, invalid tabs fall back to Details, and unsaved profile edits still
require Keep editing or Discard before navigation. Membership access remains a
separate organization-specific operation, outside User CRUD.

- Unit tests: **1,098 passed**, one opt-in real-Redis test skipped.
- Chromium: **23 passed** locally: all 21 membership cases, including three new
  discovery/navigation cases, and two existing device-tab regressions.
- TypeScript, contracts and the Linux production Docker build passed.
- VPS5 now serves the updated Admin image. Public HTTPS readiness passed and the
  served bundle contains the new controls. Three browser checks passed against
  that deployed bundle with all API calls intercepted by synthetic routes.
- Redis and caregiver API/database container IDs were retained. Existing runtime
  settings and session key were reused, and the previous release remains available.
- Read-only inspection confirmed deployed Users/Assets binaries support the
  membership flag. No backend rollout, database migration or real user grant was
  performed by this Admin update.

See [the VPS5 deployment record](deploy/vps5/DEPLOYMENT.md) for image identity,
working-tree provenance, installed paths and rollout evidence.

## Membership all-assets access — 3 November 2026

User organization memberships now display their `all_assets` setting and expose
an asset-access editor for eligible enabled memberships. Creation/reactivation
defaults to assignment scope. Updates preserve exact role/organization IDs and
membership status, and forward an explicit false when revoking a broad grant.
Legacy missing values remain unavailable; disabled broad grants are marked inactive.

- Unit tests: **1,098 passed**, one opt-in real-Redis test skipped.
- Chromium: **27 unique cases passed** across focused runs: 18 user-membership
  cases and nine organization-switch regressions, using fully synthetic API routes.
- TypeScript, production client/server builds, and the 11-document / 22-resource
  contract check passed. The existing Vite bundle-size warning remains.
- Coverage includes strict Boolean reads/writes, omitted-value compatibility,
  grant/revocation and reactivation permissions, denied/uncertain updates, active
  self-membership sign-out, and session grant changes across organization switches.
- Asset/equipment scope still comes from the authoritative Assets endpoint, even
  when a session reports all-assets access; unavailable scope fails closed.
- Desktop membership controls and their saved inactive-grant state were visually
  inspected in Chromium.

This feature validation made no live service or database changes. Usage requires
the matching Users/Assets backend support and Users migration `20261103_0006`;
local source inspection does not establish that backend rollout.

## Asset assignment API integration — 7 October 2026

Asset details now add and remove user/group assignments through the updated Assets
POST/DELETE APIs. The refreshed Assets snapshot and generated route metadata match
the companion Python workspace; its Core compatibility contract is unchanged.
The gateway enforces Asset update permission, session/CSRF and write gates, exact
positive 64-bit IDs, existing target records and ordinary organization/asset scope.
The UI confirms removals, reloads actual links after changes/conflicts, and cancels
old queries before refreshing asset and equipment access.

- Unit tests: **158 passed**, one opt-in real-Redis test skipped; 30 new gateway cases.
- Chromium browser suite: **22 passed** against the isolated synthetic Compose environment.
- New browser coverage includes user/group add/remove, scoped candidates, read-only
  access, disabled writes, retry/conflict handling, retained duplicate associations,
  self-revocation and rejection of delayed equipment responses after revocation.
- TypeScript and production builds: pass on Windows and in the Linux Docker build.
- Contract synchronization, source snapshot hashes and changed TypeScript formatting: pass.

This run used synthetic accounts and records. The running application and companion
services were not redeployed; deployment must include the new Assets assignment APIs.

## GitHub publication validation — 7 October 2026

Fixed failed sign-in form resets, reversed sensor-history filter values, the Windows
launcher working directory and the optional development Redis setting. Updated
vulnerable dependency resolutions, repaired the README and added GitHub Actions CI.
Contract snapshots retain their original bytes across Git checkouts.

- TypeScript and production build: pass on Windows and in the Linux Docker build.
- Unit tests: **128 passed**, one opt-in real-Redis test skipped.
- Chromium browser tests: **14 passed** against the isolated synthetic Compose environment.
- Contract check: **11 documents / 22 resources** pass; staged snapshot hashes match.
- Dependency audit: **0 reported vulnerabilities**.
- Runtime container: UID 1000; local credentials, tests and development test tooling excluded.

The browser run used synthetic accounts and records. Companion Python workspace
results below are historical; that workspace and live deployments were outside this run.

## Security-boundary validation — 5 October 2026

Security changes were verified with synthetic records and browser-local API responses. No real accounts, records, email delivery or upstream mutations were used.

| Check                                               | Result                                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript and production build                     | Pass                                                                                                                                          |
| API, permissions, sessions and client request tests | 125 passing; one opt-in real-Redis test skipped in the default run                                                                            |
| Chromium browser suite                              | 12 passing, including the original six workflow tests                                                                                         |
| Real Redis integration                              | Pass against an isolated disposable Redis 7 instance; two-client encryption, original TTL and atomic logout/update ordering verified          |
| Contract synchronization                            | 11 documents / 22 resources pass                                                                                                              |
| Dependency audit                                    | 0 reported vulnerabilities                                                                                                                    |
| Production Docker packaging                         | Build and Linux typecheck pass; non-root runtime contains application/runtime dependencies and excludes `.env`, tests and development tooling |

Regression coverage includes privileged and equal-level user targets, lower-role creation/reassignment, membership record binding, platform-only access settings/templates, malformed account roles, equipment/automation ownership, omitted relationships in partial updates, tenant-scoped reads/logs/history, historical flag updates after parent deletion, and concurrent password completion/logout.

Browser regressions cover account changes with different resource permissions and with the same permissions but different record visibility, browser Back, direct editor access, denied refetches, expiry, and cross-tab session invalidation. Persisted-document coverage simulates the browser's `pageshow` event; it does not establish native BFCache activation under intercepted network requests. Request-level tests verify that late successful responses, old 401 errors and in-flight session checks cannot restore a prior account.

These checks validate AdminTronicareV2's gateway and browser boundaries. The direct Python API work below extends that validation; live deployment configuration remains outside it. The initial implementation checks below are historical results from 16 September 2026.

## Direct Python API guards — 5 October 2026

The companion `tronicare_py` workspace now guards direct Users, Assets, Organizations,
Core, Rules and Actions callers using current SQL permissions and explicit record scope.
Validation completed against synthetic requests and owned disposable PostgreSQL 18 servers:

- Combined affected Python offline suites: **1,666 passed**, six opt-in broker tests skipped.
- Users PostgreSQL: **69 passed**, including one-time sessions, expiry, hierarchy,
  credential redaction, protected membership and logout/renewal replay denials.
- Assets PostgreSQL: **27 passed**, one opt-in NATS forwarding test skipped.
- Organizations PostgreSQL: **51 passed**, including owned-container operator tests.
- Rules fenced CRUD/security PostgreSQL: **14 passed**; Actions: **13 passed**;
  Core scoped store/security PostgreSQL: **17 passed**.
- Deployment packaging and route proxy checks: **73 passed**; manifests render offline.
- Scoped Ruff, formatting and mypy checks passed. OpenAPI validation covers
  **26 documents, 11 services and 229 operations**; Core generated contracts match.
- Refreshed V2 contracts: **11 API documents and 22 resource definitions**.
  V2 unit tests: **125 passed**, one opt-in Redis test skipped; typecheck and build passed.
- Flutter/Core active-call ledger tests passed with byte-identical mirrors, unchanged
  wire inventory and schemas, and current source provenance.

Users migration `20261005_0003` adds the persisted one-time-password marker with a
fail-closed default for preexisting sessions. No live migration, credentials, deployment,
write authority, forwarding, or route cutover was changed.

## Initial implementation validation

Validated on 16 September 2026. All application records used for tests were synthetic. No real Tronicare records were changed.

| Check                           | Result                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| Contract synchronization        | 11 supplied OpenAPI documents, 22 resources; generated metadata matches snapshots                   |
| TypeScript and production build | Pass, including the Node server bundle and Vite frontend                                            |
| API/session tests               | 48 passing Vitest tests                                                                             |
| Chromium browser tests          | 6 passing Playwright tests; final mobile CSS adjustment rechecked with the mobile test (pass)       |
| Dependency audit                | 0 reported vulnerabilities when dependencies were installed                                         |
| Docker                          | Production runtime image built successfully; tests excluded from runtime                            |
| Kubernetes                      | Local kind v0.33.0 / Kubernetes v1.37.0; application 2/2 replicas, Redis 1/1, readiness healthy     |
| Replica behavior                | Login on replica A accepted on B; logout on B invalidated the session on A                          |
| Container restrictions          | Runtime UID 1000 and rejected writes to the read-only root filesystem verified inside a running pod |
| Manifests                       | Example Kustomize overlay and synthetic test Compose configuration render successfully              |

The API suite covers documented routing, Core read/write alias differences, required equipment fields, signed 64-bit IDs and exact decimal serialization, credential redaction, CSRF/origin enforcement, tenant filtering, permissions, one-time-password restrictions, business failures, mutation gates, memberships, and all four history continuation parameters.

The browser suite loads every resource list and detail view without JavaScript errors; creates, edits and deletes a synthetic asset; checks view-only asset assignments; edits equipment; checks mobile navigation and viewport overflow; checks discard/keep-editing prompts; and loads sensor history. Screenshots were visually reviewed for login, overview, equipment editing and the mobile overview. `playwright-report/` and `test-results/` contain the latest targeted mobile run (ignored generated artifacts); each test run replaces these outputs.

## Local preview

The validated preview runs in the isolated `tronicare-admin-qa` kind cluster, with a separate kubeconfig at `.local/kind-kubeconfig`. Its synthetic upstream is reachable only inside that cluster. While the port forward is running, open **http://localhost:18080** and use **fixture-admin / fixture-password**. These credentials belong only to the synthetic test server.

To reopen the preview after closing the port forward:

```powershell
kubectl --kubeconfig .local/kind-kubeconfig --context kind-tronicare-admin-qa -n tronicare-admin-qa port-forward service/tronicare-admin 18080:80
```

To remove only this disposable local cluster when finished:

```powershell
.local/kind.exe delete cluster --name tronicare-admin-qa
```

The original shared Kubernetes context remained `kubernetes-admin@dev`. No resources were applied to that cluster. Use `compose.test.yaml` to reproduce the synthetic browser environment without Kubernetes; see the README.

## Environment-specific rollout work

Before a real deployment, supply the registry/image tag, hostname/TLS configuration, session secret and service origins in an environment overlay. Validate sign-in and representative authorized workflows with that environment's Python services. The tests establish adapter and UI behavior against the supplied contracts; they do not prove that live services have enabled every write gate or completed their migration.

Asset-to-user and asset-to-group assignment changes require the updated Assets service's documented POST/DELETE assignment routes and enabled mutation authority. User/group membership changes use the separate Users commands. API collection ceilings still apply; displayed totals describe loaded matches. The initial frontend bundle is approximately 547 KB gzipped; route/library splitting is a remaining performance improvement for slow connections.
