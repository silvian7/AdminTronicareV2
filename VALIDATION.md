# Implementation validation

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
