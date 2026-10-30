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

### Local caregiver API

The optional `compose.care.yaml` overlay runs the current Python caregiver API alongside Admin. It routes caregiver reads through `CARE_API_ORIGIN=http://care-api:8082`; normal Administration service origins, including Core reads and writes, remain unchanged. Admin stays at `http://localhost:8080`. The caregiver API and its PostgreSQL database have no published host ports.

On the current machine, the same `CARE_API_ORIGIN` is also saved in the existing ignored `.env`, with no unrelated keys changed. An Admin-only Compose rebuild therefore retains caregiver routing. Both Compose files are still required to start or stop the full local caregiver stack.

Build the local API image with the companion Python workspace as its context. From this Admin directory, set the backend path for your checkout:

```powershell
$adminRoot = (Get-Location).Path
$backendRoot = 'C:/Users/silvi/OneDrive/dev/python/Tronicare_multi/tronicare_py'
docker build -f "$adminRoot/Dockerfile.care-api" -t tronicare-care-api:local-working-tree "$backendRoot"
```

This is a local working-tree image: it overlays current Core/Foundation sources and migrations on a pinned trusted Core runtime, without reinstalling dependencies or claiming an immutable release revision. Its file-specific build allowlist excludes credentials, private artifacts, tests and vendor jobs. Runtime configuration is mounted separately from ignored `.local/care-runtime/api`.

The current local installation has a new isolated named PostgreSQL volume, schema revision `20261027_0029`, TLS, and a dedicated SELECT-only API role with writes denied. It contains no copied equipment or telemetry. The API uses the normal remote Users context and Assets scope endpoints for authorization; it does not bypass authentication or fabricate subjects. No report database DSN is configured, so stored sleep reports are unavailable. No worker, ingest process, vendor request or telemetry simulation is started.

The local overlay also enables the optional `CARE_USE_ADMIN_OBSERVATIONS=true` bridge, persisted in this machine's ignored `.env`. It fills only missing last-reported bed observations from the existing normal Core service, using the signed-in caller's token and bounded batched Sensor, Sensor type and Device reads. Existing caregiver observations are preserved. Boolean `bedoff=false` means last reported in bed, and `true` means last reported out of bed; matching device/asset/organization and a valid nonfuture Admin timestamp are required. Missing, denied, ambiguous or limited measurements remain unavailable. This does not establish current occupancy or freshness: current state stays unknown and freshness unassessed. A caregiver backend may deny the technical reads needed for this bridge; no elevated token or broader grant is used. Report access remains unconfigured.

For this initialized installation, rebuild/restart using both Compose files so the caregiver origin override is retained:

```powershell
docker compose -f compose.yaml -f compose.care.yaml up -d --build --wait --wait-timeout 120 admin care-api
```

Run the API image build again after changing Python source. Reuse the existing local database/configuration when restarting. `node scripts/prepare-local-care.mjs` is a first-time initializer only: it generates local credentials and a reader-grant script, requires the verified HTTPS Users/Assets origin, and refuses to overwrite existing configuration. It does not migrate the database or apply grants. A fresh installation requires separately initializing only its new local database through the backend Alembic path and applying its generated reader grants before starting the API; do not point this setup at an existing/shared database.

The local API readiness and TLS/read-only checks have passed. Admin was rebuilt with the overlay and is healthy; the caregiver collection now returns an authentication response rather than an upstream route-not-found error. Anonymous caregiver links preserve their sign-in return path. The user subsequently reported that `/care` lists their Assets. A live bed reading through the optional bridge and representative report parity have not yet been verified. See the [local runtime follow-up](CAREGIVER_PORTAL_IMPLEMENTATION.md#authorized-local-caregiver-api--29-october-2026) for the recorded boundary and pending observation checks.

The ingester's `.secret` credentials were subsequently verified against VPS5 `sensors_history`, including a TLS connection from the running caregiver container using read-only transactions. Stored reports exist, but the required assignment-history view is absent and the supplied role has elevated privileges. Portal report wiring awaits the prospective binding migration and a dedicated read-only role; no remote changes have been applied. See the [report access preflight](CAREGIVER_PORTAL_IMPLEMENTATION.md#vps5-report-credential-access--29-october-2026). Admin excludes `.secret` files from Git and Docker build contexts.

## Application coverage

- The read-only caregiver portal lives at `/care`, with authorized Asset overview, completed reports, coordinated graphs and historical trends. See [caregiver implementation and release notes](CAREGIVER_PORTAL_IMPLEMENTATION.md) for supported metrics, backend configuration, prospective assignment evidence, checks and rollout limitations.
- Caregiver bed observations use the original Admin occupied/empty bed pictograms. Asset status discs reuse Admin's event-age colors and the Asset's `lastEventAt`, independently of bed observations. The header omits the standalone role badge. This local installation maps the confirmed Standard User type through `CAREGIVER_USER_TYPE_IDS`, so it opens only `/care`; organization and platform administrators retain their existing entry points.
- Caregiver dates display as `DD/MM/YYYY` and times use 24-hour format. The overview calls the Asset column **Resident**, shows bed pictograms with observation timestamps, and keeps the header compact with the active organization's tag. Membership tags use the caller-scoped Organizations metadata endpoint through `/api/session/organization-tags`, without general organization-read access.
- Click a caregiver Resident row or tablet card to open its latest authorized completed report and interactive graphs. Enter and Space also activate a focused row/card. Entries without an available report open the subject detail with its actual unavailable or access-denied state. Report graphs reuse the ingester's bed-presence, heart-rate, respiration, movement and optional vendor-HRV calculations; breathing-event history is under Trends. Bed Temperature still requires a verified history source.
- 22 resource definitions from the supplied OpenAPI specifications: organizations and types; users, groups, user types, permissions, permission resources and user activity; assets and types; hubs/devices/sensors and types; rules/actions, types and forwarded history.
- Search, sorting, pagination of loaded results, documented service filters, record details and schema-derived forms. Hub, device and sensor lists and details display their corresponding type tags. Core writes use canonical input names while reads preserve legacy DTO names. Organization-type updates use the documented nested compatibility path.
- Role-aware navigation and actions; backend permission enforcement remains authoritative. Service write switches can disable mutations independently while backend authority gates continue to apply.
- Asset details support assigning and removing users and groups through the Assets assignment APIs. Changes require Asset update permission and enabled Assets writes. Removing an assignment refreshes asset and equipment visibility. User/group memberships use the separate Users link commands.
- Asset Equipment lists directly assigned hubs and readable gateways used by the asset's devices. Shared gateways have an icon and tooltip. The asset-scoped `GET /api/assets/{assetId}/equipment-hubs` projection checks asset access before and after loading, verifies device ownership and gateway organization, and preserves normal hub detail/edit permissions. Parent reads use the caller's token, with at most 100 missing gateways and four concurrent reads; capped or unavailable results are marked incomplete.
- Equipment hierarchy, current readings in related sensor lists, rule/action editing, multilingual message fields, explicit UTC rule times, sensor history with fenced keyset continuation, password recovery/change, and service availability.
- Template rule details offer **Create from template** to open a new disabled rule with copied configuration, translations, severity, and schedule. Select its asset and sensor, review the settings, then save through the normal rule creation API. The editor checks the selected sensor belongs to the asset. New identity, activity, and history come from normal creation; configure the new rule's actions after saving. Creating from a template requires rule read/create rights and enabled Rules writes.
- Platform administrators can use **Create template from rule** on an existing rule to save a separate reusable template with the same configuration. The template defaults to disabled, has no asset or sensor assignment, and starts with fresh activity and history. Review its settings before saving; configure template actions separately.
- Rule and Action templates have a purple template icon in lists, detail/editor headings, and related lists; rule references also show it. Rule templates hide Enabled and Output, and Action templates hide Enabled and Asset. Template-only lists omit those columns, while mixed lists keep them for normal records. Template editors omit hidden fields from existing-record edits, preserving stored values; new templates are disabled and new Action templates have no asset assignment. Unticking Is Template restores the stored or draft controls for review.
- Virtual elements use an explicit Tag beginning with `VIRTUAL-`, followed by a nonblank identifier (for example `VIRTUAL-BM8701-2` or `VIRTUAL-BM8701-2-HUB`). Matching ignores surrounding whitespace and prefix case and follows the displayed translated Tag. A blue Virtual badge marks these records in lists, headings, available references, and selector options using already loaded data. Labels containing “virtual”, `TEST-` tags, and `VIRTUAL-` without a suffix do not designate a virtual element. This is a naming convention for display, with no new database field or change to permissions or processing.
- Platform administrators can use **Bed occupied** (`bedoff=false`) and **Bed vacant** (`bedoff=true`) on a supported virtual bedoff sensor, from Sensor details or its Device's Sensors list. These controls require enabled Core writes and the backend's explicit virtual-equipment binding; a `VIRTUAL-` tag alone does not enable simulation. Events use normal telemetry intake and processing. Queued, accepted, and rejected receipts are separate from the confirmed sensor reading; an explicit retry preserves its operation ID. The gateway exposes only the authenticated, narrowly scoped virtual-events API and never forwards browser-supplied telemetry or destinations.
- Actions support the same two copy flows. **Create template from action** saves a separate, disabled action template for platform administrators. **Create from template** copies the type, severity, translations, recipient, subject, and body into a disabled action draft; choose its asset and a non-template rule on that asset before saving. The editor verifies the rule and its sensor belong to that asset. New templates have no rule or asset assignment. Both flows use normal Action creation permissions and service write settings.
- Platform administrators see global Core outbox sizes and oldest queued-message latency on the overview dashboard, refreshed every 30 seconds from `/v1/coreadmin/info`. Missing or unavailable metrics show an error; empty queues report zero.
- The dashboard also shows outbox availability, queue sizes and latency for Rules, Actions, Push, Email, SMS, MQTT and MQTT bridge, using each configured service's `/v1/{service}admin/info` endpoint. It refreshes every 30 seconds and keeps other services visible when one is unavailable. Latency follows each service's queue-age definition; Actions uses the current forwarding/retry wait.
- User activity and permission-resource definitions are intentionally read-only. Forwarded history supports administrative read/acknowledge/archive flags, rather than editing engine-produced fields. Ingest/worker/outbox listeners are backend process interfaces, not administration screens; they are not exposed by the gateway.

## Security boundaries

The gateway checks resource permissions and record ownership before reads and mutations. Ordinary administrators are limited to their organization and explicitly visible assets. Equipment and automation writes resolve linked records and check their ownership against the effective record, including fields retained by a partial update. Missing, inaccessible or inconsistent references are rejected. Unassigned equipment and automation require platform administration.

Only platform administrators may mutate permission definitions, user types or shared templates. Administrators with user-management rights may create and manage verified lower-level, non-administrator accounts. Updating, deleting or changing memberships of equal/higher-level or administrator accounts is rejected; an unknown role cannot establish permission. The role selector offers lower-level roles to ordinary administrators.

Browser query caches are replaced on session changes, and requests from a previous session are cancelled and rejected before their responses can populate the next account's cache. Other tabs receive an opaque invalidation revision containing no account data. Persisted document restoration clears protected state. Denied resource views suppress retained records. Password-change completion updates only an existing session; it cannot recreate a session revoked by logout. Redis performs this update atomically across replicas and retains the original absolute expiry.

The active-organization selector uses the signed-in user's enabled memberships, including each membership's role. `GET /api/session/organizations` reads Users' self-membership endpoint; `POST /api/session/organization` accepts an exact decimal `organizationId` string and performs Users' token-rotating switch. The upstream token stays encrypted in the session store. Successful switching replaces identity, permissions and CSRF, clears browser caches, and asks other tabs to rediscover the session. Unsaved editors and password forms require a discard decision first. Atomic session claims prevent concurrent switches, logout and password completion from restoring stale credentials; interrupted or uncertain switches are reconciled without replaying the rotating request.

User details include an **Organizations** tab with organization tags and IDs, membership roles, and enabled status. **Add organization** grants or reactivates a membership with a role for that organization; **Remove** revokes it after confirmation. Existing memberships in other organizations and the user's default organization stay unchanged. Platform administrators may manage memberships across organizations, using organization roles below platform level. Ordinary administrators may manage eligible lower-level memberships in their active organization. Users service write settings and permissions apply. Changing your own currently active membership ends that session and requires signing in again.

Platform administrators retain their separate local Workspace filter. Their initial global session is distinct from an explicitly selected membership, and the backend offers no switch-back-to-global operation. Organization and role names use ordinary authorized lookups with ID fallbacks. Alert recipients continue to follow all authorized memberships and asset/group assignments in the backend, independently of the foreground organization. Older Users versions without membership endpoints retain the legacy selector.

The companion Python workspace now enforces equivalent guards for direct callers in Users, Assets, Organizations, Core, Rules and Actions. Its APIs check current Users SQL authority, tenant and asset ownership, protected user roles, templates, forwarded-history flags and one-time sessions. Core carries that scope into fenced mutations; session renewal cannot revive revoked or expired Users sessions. Rollout requires the appended Users migration `20261005_0003`, the updated service endpoint settings and network policies, and Core's configured HTTP origin routing `/v1/usersadmin/context` to Python Users. Existing sessions remain restricted until a fresh login or password change. These source changes do not establish a live rollout.

Security regressions use synthetic records and responses. Run `npm test` and the browser suite described below. The optional real-Redis tests run with `TEST_REDIS_URL` pointing to an isolated disposable Redis instance; they use random test keys and delete only those keys. Never configure tests with application credentials or real service origins.

## API contract provenance

Snapshots in `contracts/` come from the companion Tronicare Python workspace's `tronicare_py/docs/openapi` directory.

Only each service's business/admin API is copied; Core uses `compat.openapi.json`. `shared/contracts.generated.json` records SHA-256 hashes and the derived field/route metadata for each source. No live API or credential is needed to generate it.

Email, SMS and MQTT's supplied JSON snapshots omit their newer outbox fields. Their dashboard mappings follow the current service `store.py` implementations, OpenAPI YAML descriptions and outbox-monitoring tests in the companion workspace.

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

| Variable                      | Purpose                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_ORIGIN`               | Exact browser origin; HTTPS required in production.                                                                                                                                   |
| `SESSION_SECRET`              | Base64-encoded 32-byte encryption key shared by all replicas.                                                                                                                         |
| `REDIS_URL`                   | Shared session store; required in production. Use `rediss://` where appropriate.                                                                                                      |
| `API_ORIGIN`                  | Common ingress origin for all service APIs.                                                                                                                                           |
| `<SERVICE>_API_ORIGIN`        | Per-service override for USERS, ORGANIZATIONS, ASSETS, CORE, RULES, ACTIONS, EMAIL, SMS, PUSH, MQTT or MQTTBRIDGE. No URL paths or credentials.                                       |
| `CARE_API_ORIGIN`             | Optional origin used only for caregiver `/v1/care` reads; defaults to the normal Core origin. Does not redirect technical Core operations.                                            |
| `CARE_USE_ADMIN_OBSERVATIONS` | Optional `true`/`false` bridge for missing caregiver bed observations using the caller's normal Core read access. Defaults to `false`; enabled for the local caregiver stack.         |
| `ENABLED_WRITE_SERVICES`      | Comma-separated write-enabled service names. Empty disables resource writes. Auth operations still follow Users' own authority gates.                                                 |
| `CAREGIVER_USER_TYPE_IDS`     | Optional restrictive caregiver UserType IDs, matching Users' `USERS_CAREGIVER_USER_TYPE_IDS`. Trusted backend classification also applies; never infer this audience from role level. |
| `LEGACY_PASSWORD_SALT`        | Users compatibility digest prefix; default `tcare` matches the supplied implementation.                                                                                               |
| `TRUST_PROXY_HOPS`            | Express trusted proxy hop count; leave zero unless the ingress topology is known.                                                                                                     |
| `PORT`                        | Server port, default 8080.                                                                                                                                                            |
| `ALLOW_HTTP`                  | Isolated local production-container testing only; never enable for public ingress.                                                                                                    |

No internal service credential is embedded in the frontend. Administration information uses the signed-in platform administrator's token; a service that declines it is shown as unavailable.

Users lists and details show active push-registration status through a read-only, caller-scoped check. Missing registrations and counts above the current 32-device delivery limit have separate warnings. Registration does not confirm phone notification permission or guarantee delivery. The screen refreshes this status every 30 seconds while focused; denied, malformed, or unavailable responses remain unavailable rather than becoming zero. This requires Push's `GET /v1/pushadmin/devices/readiness/{user_id}` endpoint. The Admin adapter checks at most 50 requested users per batch, with four concurrent reads and a ten-second batch deadline. It does not register devices or send notifications.

The service monitor displays Push's optional partial-delivery total separately from queue sizes. Its historical partial-acceptance count is a subset of that total and is not added again. Older backends without these metrics show them as unavailable.

Overview's asset status and the Assets list refresh every 15 seconds while visible and immediately on browser return. Timer, focus and manual refreshes reuse an existing in-flight query. Counts, reference records and service outboxes keep their separate cadence; dirty editors do not poll. “Last refreshed” is the last successful fetch of the view, distinct from each device's event time, and remains unchanged after a failed refresh.

## Validation and deployment boundaries

Assignment controls require the Assets service version exposing `POST` and `DELETE /v1/assets/{asset_id}/users/{related_id}` and `/v1/assets/{asset_id}/usergroups/{related_id}`. Admin resolves existing target records through Users; listing and selecting users/groups requires access to those records. Ordinary administrators must already have access to the asset and select users/groups in their organization. Platform administrators retain broader scope. The service removes one matching association per request; legacy duplicate links can keep an assignment visible after removal, so the screen reloads the actual links.

The test suite uses synthetic, isolated service responses. It validates contract routes, 64-bit IDs, field allowlists, auth/session behavior, tenant scope, mutation errors and history continuation without changing real records. A successful build/container test does not establish that every environment has enabled Python writes or completed its backend migration. Backend readiness and authority errors remain visible to operators.

For a reproducible synthetic browser environment, run `docker compose -f compose.test.yaml up --build -d`, then `npx playwright install chromium` and `npm run test:browser`. This environment uses port 18080 and the synthetic login `fixture-admin` / `fixture-password`; no real account is needed. Stop it with `docker compose -f compose.test.yaml down`. Do not run mutation tests against a real backend. The fixture is a separate Docker build target and is excluded from the production runtime image. Test artifacts are written to `test-results/` and `playwright-report/`.

See [VALIDATION.md](VALIDATION.md) for the checks completed on this implementation and the remaining environment-specific rollout work.

GitHub Actions runs the contract check, unit tests, production build, dependency audit and Chromium browser tests on pushes to `main` and pull requests. Browser tests use the isolated synthetic Compose environment.
