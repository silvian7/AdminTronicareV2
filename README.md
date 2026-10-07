# Tronicare Administration V2

React + TypeScript + Refine Core + Ant Design administration application, with a Node backend-for-frontend and Kubernetes/Kustomize packaging. The browser only contacts its own origin. Business data remains in the existing Tronicare services.

## Run locally

Requirements: Node 24 and Python 3 (only for contract synchronization), or Docker.

Run the following commands from `AdminTronicareV2`, which contains `compose.yaml`. If your terminal is in the parent `AdminTronicareGlobal` folder, first run:

```powershell
cd .\AdminTronicareV2
```

1. Copy `.env.example` to `.env` and configure the API origin(s).
2. Generate a local session encryption key with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and set `SESSION_SECRET`. Never commit the resulting `.env`.
3. For the production container on localhost, run `docker compose up --build` and open `http://localhost:8080`. Compose starts disposable Redis session storage.
4. For development with hot reload: `npm ci`, then `npm run dev`. This loads `.env` with Node 24. The frontend is at `http://localhost:5173`; it proxies `/api` to port 8080. Omit `REDIS_URL` to use memory sessions in development only.

Login uses your Tronicare account. Select **One-time code** for recovery credentials. Plain passwords are hashed server-side using the documented legacy Users protocol. Browser credentials are sent in a POST body; upstream Users still requires its documented GET protocol. Configure upstream/ingress logs to redact credential query parameters.

## Application coverage

- 22 resource definitions from the supplied OpenAPI specifications: organizations and types; users, groups, user types, permissions, permission resources and user activity; assets and types; hubs/devices/sensors and types; rules/actions, types and forwarded history.
- Search, sorting, pagination of loaded results, documented service filters, record details and schema-derived forms. Hub, device and sensor lists and details display their corresponding type tags. Core writes use canonical input names while reads preserve legacy DTO names. Organization-type updates use the documented nested compatibility path.
- Role-aware navigation and actions; backend permission enforcement remains authoritative. Service write switches can disable mutations independently while backend authority gates continue to apply.
- Asset details support assigning and removing users and groups through the Assets assignment APIs. Changes require Asset update permission and enabled Assets writes. Removing an assignment refreshes asset and equipment visibility. User/group memberships use the separate Users link commands.
- Equipment hierarchy, current readings in related sensor lists, rule/action editing, multilingual message fields, explicit UTC rule times, sensor history with fenced keyset continuation, password recovery/change, and service availability.
- User activity and permission-resource definitions are intentionally read-only. Forwarded history supports administrative read/acknowledge/archive flags, rather than editing engine-produced fields. Ingest/worker/outbox listeners are backend process interfaces, not administration screens; they are not exposed by the gateway.

## Security boundaries

The gateway checks resource permissions and record ownership before reads and mutations. Ordinary administrators are limited to their organization and explicitly visible assets. Equipment and automation writes resolve linked records and check their ownership against the effective record, including fields retained by a partial update. Missing, inaccessible or inconsistent references are rejected. Unassigned equipment and automation require platform administration.

Only platform administrators may mutate permission definitions, user types or shared templates. Administrators with user-management rights may create and manage verified lower-level, non-administrator accounts. Updating, deleting or changing memberships of equal/higher-level or administrator accounts is rejected; an unknown role cannot establish permission. The role selector offers lower-level roles to ordinary administrators.

Browser query caches are replaced on session changes, and requests from a previous session are cancelled and rejected before their responses can populate the next account's cache. Other tabs receive an opaque invalidation revision containing no account data. Persisted document restoration clears protected state. Denied resource views suppress retained records. Password-change completion updates only an existing session; it cannot recreate a session revoked by logout. Redis performs this update atomically across replicas and retains the original absolute expiry.

The companion Python workspace now enforces equivalent guards for direct callers in Users, Assets, Organizations, Core, Rules and Actions. Its APIs check current Users SQL authority, tenant and asset ownership, protected user roles, templates, forwarded-history flags and one-time sessions. Core carries that scope into fenced mutations; session renewal cannot revive revoked or expired Users sessions. Rollout requires the appended Users migration `20261005_0003`, the updated service endpoint settings and network policies, and Core's configured HTTP origin routing `/v1/usersadmin/context` to Python Users. Existing sessions remain restricted until a fresh login or password change. These source changes do not establish a live rollout.

Security regressions use synthetic records and responses. Run `npm test` and the browser suite described below. The optional real-Redis tests run with `TEST_REDIS_URL` pointing to an isolated disposable Redis instance; they use random test keys and delete only those keys. Never configure tests with application credentials or real service origins.

## API contract provenance

Snapshots in `contracts/` come from the companion Tronicare Python workspace's `tronicare_py/docs/openapi` directory.

Only each service's business/admin API is copied; Core uses `compat.openapi.json`. `shared/contracts.generated.json` records SHA-256 hashes and the derived field/route metadata for each source. No live API or credential is needed to generate it.

```powershell
python scripts/sync-contracts.py --source 'C:/path/to/tronicare_py/docs/openapi'
python scripts/sync-contracts.py --check
npm run typecheck
npm test
npm run build
```

JSON numbers are decoded losslessly at the server boundary and numeric values reach the browser as decimal strings. Mutation payloads are validated and serialized back to JSON numbers without passing IDs through JavaScript `Number`. Credential-related fields are excluded from browser responses and forms.

Several API collections do not support offset pagination or total counts. The adapter requests the documented maximum where a limit exists, applies presentation filtering/sorting/paging to the returned collection and marks potentially capped results. Counts are **loaded matches**, not invented global totals. Core lists are capped at 10,000; Users returns a service error above its completeness bound. Narrow filters when a result is limited. Sensor history uses all four documented continuation fields and retains the snapshot/high-water fence.

## Kubernetes

`deploy/base` contains a two-replica Deployment, Service, probes, resource requests/limits, disruption budget and private disposable Redis session deployment. Containers run without root, with read-only root filesystems, dropped capabilities and no service-account token. `deploy/overlays/example` adds a namespace and TLS Ingress. It is a template: replace `admin.example.com`, registry/image tag and API origins before applying it.

Build locally with `docker build -t tronicare-admin:local .`. Set a registry/image and immutable release tag in your overlay. Publishing the image and applying manifests are separate deployment operations; no shared-cluster deployment is performed by the build.

Provision the `tronicare-admin-session` Secret in the deployment namespace with a `SESSION_SECRET` key containing 32 cryptographically random bytes, base64 encoded. Use your normal secret manager; do not put its value in Kustomize files. Provision the TLS secret or configure your certificate controller. Render with:

```powershell
kubectl kustomize deploy/overlays/example
```

After selecting and verifying your intended Kubernetes context and namespace, apply the customized overlay through your usual deployment workflow. `PUBLIC_ORIGIN` must exactly match the browser's HTTPS origin. This is used for origin/CSRF checks. All replicas share `REDIS_URL` and `SESSION_SECRET`. Session expiry is 59 minutes, slightly shorter than the upstream one-hour session. Logout removes the shared session even if upstream revocation is unavailable. Redis restarts sign everyone out; use managed HA Redis for uninterrupted sessions. Redis values are encrypted and the browser cookie contains only a random opaque session ID.

Runtime settings:

| Variable                 | Purpose                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_ORIGIN`          | Exact browser origin; HTTPS required in production.                                                                                             |
| `SESSION_SECRET`         | Base64-encoded 32-byte encryption key shared by all replicas.                                                                                   |
| `REDIS_URL`              | Shared session store; required in production. Use `rediss://` where appropriate.                                                                |
| `API_ORIGIN`             | Common ingress origin for all service APIs.                                                                                                     |
| `<SERVICE>_API_ORIGIN`   | Per-service override for USERS, ORGANIZATIONS, ASSETS, CORE, RULES, ACTIONS, EMAIL, SMS, PUSH, MQTT or MQTTBRIDGE. No URL paths or credentials. |
| `ENABLED_WRITE_SERVICES` | Comma-separated write-enabled service names. Empty disables resource writes. Auth operations still follow Users' own authority gates.           |
| `LEGACY_PASSWORD_SALT`   | Users compatibility digest prefix; default `tcare` matches the supplied implementation.                                                         |
| `TRUST_PROXY_HOPS`       | Express trusted proxy hop count; leave zero unless the ingress topology is known.                                                               |
| `PORT`                   | Server port, default 8080.                                                                                                                      |
| `ALLOW_HTTP`             | Isolated local production-container testing only; never enable for public ingress.                                                              |

No internal service credential is embedded in the frontend. MqttBridge's documented admin authentication may require a service credential rather than a user session; its status will show unavailable when the service declines the current user's token.

## Validation and deployment boundaries

Assignment controls require the Assets service version exposing `POST` and `DELETE /v1/assets/{asset_id}/users/{related_id}` and `/v1/assets/{asset_id}/usergroups/{related_id}`. Admin resolves existing target records through Users; listing and selecting users/groups requires access to those records. Ordinary administrators must already have access to the asset and select users/groups in their organization. Platform administrators retain broader scope. The service removes one matching association per request; legacy duplicate links can keep an assignment visible after removal, so the screen reloads the actual links.

The test suite uses synthetic, isolated service responses. It validates contract routes, 64-bit IDs, field allowlists, auth/session behavior, tenant scope, mutation errors and history continuation without changing real records. A successful build/container test does not establish that every environment has enabled Python writes or completed its backend migration. Backend readiness and authority errors remain visible to operators.

For a reproducible synthetic browser environment, run `docker compose -f compose.test.yaml up --build -d`, then `npx playwright install chromium` and `npm run test:browser`. This environment uses port 18080 and the synthetic login `fixture-admin` / `fixture-password`; no real account is needed. Stop it with `docker compose -f compose.test.yaml down`. Do not run mutation tests against a real backend. The fixture is a separate Docker build target and is excluded from the production runtime image. Test artifacts are written to `test-results/` and `playwright-report/`.

See [VALIDATION.md](VALIDATION.md) for the checks completed on this implementation and the remaining environment-specific rollout work.

GitHub Actions runs the contract check, unit tests, production build, dependency audit and Chromium browser tests on pushes to `main` and pull requests. Browser tests use the isolated synthetic Compose environment.
