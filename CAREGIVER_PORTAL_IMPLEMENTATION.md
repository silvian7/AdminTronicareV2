# Caregiver portal implementation

Scope: prompts 1–6 in prompts/caregiver_portal.txt, completed without running the
optional deployment prompt. Those stages performed no live application API/DB
operation, migration, vendor request, ingestion job or commit. The user subsequently
authorized the local Admin rebuild and isolated local caregiver API/database setup
recorded below. Those initial local follow-ups did not deploy or migrate a shared
backend. Later VPS5 report access began with read-only preflight; the user then
explicitly approved the report migration, dedicated reader and local connection.
That approved setup and its remaining historical-data boundary are recorded below.
Synthetic data exists only in labelled tests.

## Stage gates

| Stage                       | Status   | Evidence                                                                                                                                      |
| --------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — discovery               | Complete | Repositories, instructions, data paths, clocks and graph inventory inspected before implementation.                                           |
| 2 — API and analytics       | Complete | Authenticated stored-data reads, prospective attribution, shared preparation and backend/security/isolated PostgreSQL checks.                 |
| 3 — layout and overview     | Complete | Build, session isolation, nine mocked browser cases and tablet inspection.                                                                    |
| 4 — report and graphs       | Complete | Exact report navigation, four coordinated panels, 18 browser cases and synthetic ingester/HTTP parity.                                        |
| 5 — trends and HRV          | Complete | Bounded trends, independent breathing history, optional vendor HRV, 27 browser cases and final HRV axis check.                                |
| 6 — integrated verification | Complete | Final 34 caregiver browser cases, all 328 unique administration cases, backend/ingester checks and release preparation passed. No deployment. |

Final administration result: **328 unique checks passed**. Initial full run was
323 passed / five failed; the five corrected cases passed in targeted reruns.
Only tests changed: grouped detail panels, typed synthetic history/local display,
exact rule-row identity, optional list trailing slash, and a one-millisecond
paused-clock notification flush after the proven 60-second reference fetch.
There were no administration runtime fixes. Logs: `.local/care-stage6-admin*.log`.

## Source map and architecture

| Repository                                                               | Relevant implementation                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin — this repository                                                  | shared/care.ts; server/care.ts; server/app.ts; src/care/{layout,api,pages,report-navigation,report-graphs,report-graph-data,trends,trend-charts}.tsx/.ts and scoped CSS.                                   |
| Python — C:/Users/silvi/OneDrive/dev/python/Tronicare_multi/tronicare_py | Core compat_api/care.py, core_api_care.py, core_api_composition.py, adapters/http/care_assets.py and adapters/postgres/care.py; Foundation caregiver policy/portal_shared.py; Users/service authorization. |
| Ingester — C:/Users/silvi/OneDrive/dev/python/daily_report_ingester      | daily_report_analysis/portal_shared.py, existing analysis wrappers, scripts/sync_portal_shared.py, sql/20261029_portal_binding_events.sql and docs/analysis/caregiver_portal_reuse.md.                     |
| Flutter — C:/Users/silvi/OneDrive/dev/flutter/Tronicare_Flutter          | Read-only terminology/navigation reference; pre-existing changes preserved.                                                                                                                                |

No applicable Admin AGENTS.md was found. Applicable Python root/Core/deploy and
ingester instructions were followed. Unrelated working-tree changes were kept.
The supported subject is **Asset**, with existing tag, label, exact ID and
organization. Flutter's “Resident” wording does not establish a resident model.

The portal extends React 19, Refine 5, React Router 7, Ant Design 5 and TanStack
Query inside the existing application. Modular Apache ECharts 6.1.0 was selected:
the ingester renders Matplotlib, with no useful Plotly/browser reuse. Chart code
is lazy-loaded; no replacement application was created.

Browser requests remain same-origin through the Express BFF. Upstream tokens
stay in encrypted shared sessions; the cookie is an opaque ID. Existing CSRF,
session-epoch cancellation, organization-switch CAS and account flows remain.
Core checks fresh Users context and current Assets grants. Stored reports use a
separate optional read-only connection. Screens never run ingestion, query the
vendor or regenerate reports.

## Audience and authorization

Caregiver is an explicit, server-derived restriction, never “level below 90”.
Users applies USERS_CAREGIVER_USER_TYPE_IDS to the effective selected membership
and returns caregiver_read_only on login/context/switch. BFF
CAREGIVER_USER_TYPE_IDS is an additional restrictive configured set. Invalid
flags fail closed; ordinary administrators retain their existing permissions.

Foundation policy enforces the audience in Users, Core, Assets, Organizations,
Rules and Actions. BFF caregiver sessions deny technical APIs and mutations,
allowing supported self-session/account operations and /api/care reads.
Navigation hiding is not authorization. Public operational probes and metrics
keep their existing contracts.

Overview requires Assets read rights. Reports, series and trends additionally
require Sensors read rights. Assets-only access exposes no report/health values
and does not query the report database. Each request rechecks current
organization, asset grants and exact subject/report parentage. Failed or empty
scope never grants global permission. Cross-org, wrong-parent, revoked
membership and direct mutation cases are covered.

## Authenticated read contract and bounds

BFF /api/care paths map to the same Core /v1/care paths:

| GET suffix                                                       | Contract                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| /subjects?q=&page=&size=&organization=                           | One authorized bounded batch; no per-row API calls.               |
| /subjects/{asset}                                                | Exact authorized subject for stable deep links.                   |
| /subjects/{asset}/reports?startDate=&endDate=                    | Completed reports in at most 31 inclusive UTC dates.              |
| /subjects/{asset}/reports/{report}                               | Stored summary, period, units, quality and provenance.            |
| /subjects/{asset}/reports/{report}/series?start=&end=&maxPoints= | Report-contained UTC half-open range and bounded retained series. |
| /subjects/{asset}/trends?days=7\|30&endDate=                     | Seven/thirty dates, or explicit startDate/endDate up to 31 dates. |

IDs stay exact canonical strings through lossless JSON parsing. Only declared
quantitative fields convert to Number. tests/care-wire.test.ts checks generated
Core DTOs through this boundary. No download/raw-payload proxy was introduced.

Bounds: authorized overview candidates <=1,000 with limited metadata; page size
<=100; search <=100 characters; report listing <=100. Actual report periods are
<=26 hours; series <=5,000 retained points, <=5,000 presence intervals and <=288
five-minute HRV bins. Requested maxPoints is 100–5,000. Breathing history is
bounded to 100 points. Existing gateway response cap is 24 MiB.
Report SQL uses read-only transactions, 5-second statement and 8-second overall
limits; observation reads use narrower bounds. No runtime DDL is performed.

Reduction retains extrema, gaps and transitions rather than smoothing them.
Irreducible excessive transitions require a narrower range. UI rejects another
parent/window, malformed or oversized data and never draws stale placeholders.
Errors, denied access, no report and incomplete data remain distinct.

## Prospective report attribution

Stored path: daily_report.raw_packet_id -> raw_sleep.id ->
raw_sleep.id_monitored_system -> monitored_system.id. Raw JSONB retains arrays;
daily_report retains parsed vendor scalars, periods and quality. Existing
monitored_system bindings are mutable; installation/removal dates and cursors
cannot prove historical ownership.

One-time additive sql/20261029_portal_binding_events.sql captures bindings at
database NOW and installs append-only evidence on every asset, organization,
vendor identity, hub/lifecycle change and deletion. LEAD closes intervals in
monitored_system_binding_interval. Source-ID changes, truncation and direct
evidence rewrites fail closed. Existing reports/cursors are not rewritten.

BOTH raw and parsed periods must fit wholly within one active, nondeleted
interval matching asset, organization, monitored-system ID and both vendor IDs.
Normalize legacy inclusive whole-second :59 ends by adding one second.
Start >= valid_from and end <= valid_to when closed. No initial event proves
earlier time; reassignment back cannot stitch periods across a change.
Old unproven reports stay unavailable, not backfilled.

The script targets public and rejects reapplication. Other DB_SCHEMA values
require reviewed consistent qualification. The reader needs database CONNECT,
schema USAGE and SELECT on daily_report, raw_sleep and
monitored_system_binding_interval only: no event, sequence, write or DDL grants.

## Clocks, missing values and graph inventory

Vendor windows remain fixed 05:00 UTC to next 04:59:59 UTC inclusive, adapted to
half-open 05:00-to-05:00 periods. They do not move with browser DST.
Temperature uses local 07:00-to-next-07:00: 23/24/25 hours.
Display uses browser timezone and zone labels; UTC controls are explicit.
Brussels repeated 02:30 samples are distinguished by GMT+2/GMT+1 in tests.

Current bed status is unknown. Valid last observed state is separately dated,
with freshness unassessed: Core has no established occupancy TTL to reuse.
Suppressed/unchanged history and heartbeat age do not define coverage.
Coverage and generation time remain unknown when unproven. Vendor update,
ingestion, parsing and measurement timestamps stay separate.

| Ingester graph/source                            | Definition and portal disposition                                                                                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bed Presence — bed_presence.py                   | sleepStateStr/sleepState: 1 out, 2/3/4 in, malformed/missing unknown; shared grid and clipped/padded half-open intervals. Default panel.                                                        |
| Vital Parameters — vital_parameters.py           | detail.heartRate/breathRate in beats/min and breaths/min; <=0, >=255, malformed/nonfinite values are gaps. Default separate panels.                                                             |
| Movement markers — vital_parameters.py           | Exact detail.status ==34 event flag; false, true and unknown stay distinct. Default panel, never a count or continuous-activity claim.                                                          |
| HRV — hrv.py                                     | analysis.maxReport.hrvArray, validated UTC anchors, five-minute vendor samples in ms; not RMSSD. Optional panel preserves finite values, zero and null gaps.                                    |
| Breath — breath.py / caregiver_summary           | Nonnegative stored ahi_count events/report. Each vendor stream uses strict latest report start minus 28 days; no event timestamps. Implemented historical counts and exact report links.        |
| Bed Temperature — bed_temperature.py             | BedTempMax channels, °C [-50,150], highest valid same-record channel; not body temperature/daily maximum; gaps >=2 min break lines. Deferred: authorized period-specific source/binding absent. |
| Recorded movement — queries.load_movement_counts | Nonnegative recorded counts summed per UTC minute; missing is not zero. Deferred: independent verified source/binding absent; status-34 is not a substitute.                                    |
| Workbook archive/trend/risk tables               | Stored comparable daily values implemented. Rolling average needs >=3 valid values across seven rows; clinical/risk interpretation and new scores excluded.                                     |

Stored duration_min, asleep_min, wake_min and awake_min stay distinct. Vendor
duration is not silently renamed time in bed or sleep. hrv_rmssd is a separate
daily scalar. Report availability is not physiological coverage.

Verified trace: stored raw packet -> queries.load_report_payloads -> bed_presence
selection/grid -> build_bed_presence_intervals -> Matplotlib PNG -> workbook.
Public pandas/Matplotlib wrappers now call canonical Python-3.12+-stdlib
daily_report_analysis/portal_shared.py. Core imports a byte-identical Foundation
mirror with SHA256 provenance and py.typed: no jobs, pandas, plotting,
environment loading or DB code at analytical import.

From the ingester, check with:
uv run python scripts/sync_portal_shared.py --backend-root <tronicare_py>.
Use --write only after a reviewed canonical change. Do not independently edit
the mirror or implement report formulas in browser code.

## UI and graph behavior

Routes: /care; /care/subjects/{id}; /care/subjects/{id}/reports/{reportId};
/care/subjects/{id}/trends; /care/account. Caregiver login and technical deep
links redirect before mounting admin outlets. Administrators keep both sections.
Existing organization switching is reused.

Overview keeps search/page filters in the URL; observations and reports are
separate. Explicit report URLs survive refresh/back/forward. Default latest
selection becomes an exact URL; ?date=YYYY-MM-DD preserves date intent,
including empty days. Previous/next and report selection use a bounded 31-date
window. Explicit failures never fall back to another report.

Four aligned panels share cursor, zoom, pan and reset. Exit buttons and chart
intervals focus the full observed out interval plus context. Keyboard sample
inspection pans that same window. Tooltips separate cursor state/time from
nearest retained reading; null gaps remain gaps. HRV shares range/inspection
with explicit source/unit/bin definition. Its automatic axis includes finite
canonical values, including negatives. Unsupported HRV leaves four panels usable.

Trends show one unambiguous eligible report per UTC date. Verified incomplete
days expose no report/metrics; unavailable includes missing, unproven or
ambiguous dates. Neither becomes zero. Every value links to its exact report.
Separate breathing history preserves each stream's exclusive 28-day cutoff
independently of the selected seven/thirty-day trend dates.

Query keys include session epoch, account, organization, subject and report.
AbortSignals and late-response fences are reused. Current observations refresh
every minute while visible/focused and on return. Completed reports have
five-minute caching without polling. Logout/context changes clear old queries;
no previous subject is placeholder data. src/care/api.ts caches its Intl formatter
instead of constructing ~5,000 formatters per maximum bed-exit rendering pass.

## Final verification evidence

| Area                   | Actual completed result                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin units            | Default run: 908 passed, one optional Redis test skipped. That Redis integration separately passed against the owned disposable Compose Redis. |
| Admin contracts/build  | 11 API documents /22 resources; Windows and Node 24 Linux production builds pass.                                                              |
| Dependencies/style     | npm audit zero after compatible fixes; Prettier and all three repository diff checks pass.                                                     |
| Caregiver browser      | Final 34/34 pass after formatter fix; default five-second startup/control expectations unchanged.                                              |
| Administration browser | All 328 unique cases pass: initial 323 plus five corrected targeted reruns; isolated synthetic Compose fixture.                                |
| Core                   | 546 regression checks pass; 44 isolated report/observation PostgreSQL checks reused.                                                           |
| Authorization          | 305 security checks and two fresh Users PostgreSQL checks pass.                                                                                |
| Ingester               | 945 full tests with both parity opt-ins; Ruff, 95-file format check, Ty and 19 isolated binding PostgreSQL checks pass.                        |
| Packaging              | Docker Node 24 runtime UID1000, no source/tests/.env; readiness and SPA deep HTML 200; Admin Kustomize renders offline.                        |

Report/series and generated trends JSON reproduce actual synthetic Core HTTP
DTOs. BFF round-trip tests exercise lossless parsing/quantity conversion.
Independent public ingester wrappers compare arrays, 1,440 points, intervals,
scalars, HRV and trend/breath selection. TRONICARE_CARE_PARITY_FIXTURE and
TRONICARE_CARE_TRENDS_PARITY_FIXTURE opt into labelled fixtures.
Mirror and exact fixture regeneration checks pass.
Historical mobile ledger, lock and golden bytes remain unchanged; explicit
compatibility deltas track current source. No existing mobile call/route/DTO
inventory was changed.

Maximum compact UTF-8 wrapped synthetic responses: series 1,132,918 bytes
(5,000 points +5,000 intervals +288 HRV bins); 31-day trends 56,310 bytes.
Both fit 24 MiB. Oversized 5,001-point/interval responses fail closed.
Zoom/inspection/reset, late logout replies, org/subject changes, DST offsets,
keyboard links and tablet overflow checks pass. Desktop/tablet report, trends,
HRV, maximum and DST images were inspected. This is synthetic usability
evidence, not a production benchmark.

Final output: .local/test-results/care-stage6-release.
Sizes: .local/test-results/care-stage6-sizes-report.json.
The optional shared-session encryption/expiry/atomic-revocation check passed via
the isolated fixture container using `vitest run --configLoader native --no-cache
tests/sessions.test.ts -t 'preserves encryption, expiry, and atomic revocation on a real Redis server'`
with TEST_REDIS_URL targeting only that Compose project's disposable Redis.
Server-only setting names are absent from browser assets. Vite retains its main
chunk warning (~1.95 MB /582 KB gzip); shared ECharts is lazy (~496 KB /169 KB).
No broad framework upgrade was made.

## Local Admin rebuild — completed 29 October 2026

After the six stages, the user requested rebuilding and restarting localhost.
The existing `admintronicarev2` Compose Admin was rebuilt and recreated with:

```sh
docker compose up --build -d --no-deps --force-recreate --wait --wait-timeout 120 admin
```

It is running at http://localhost:8080. The existing Redis container remained
running. The Linux production build/typecheck passed; Admin became healthy.
Cookie-free smoke checks passed: live/ready 200; root, `/care` and a report deep
link serve the rebuilt SPA; JS/CSS bytes match the running image; `/api/session`
returns 401 with no-store. A fresh Chromium context verified both caregiver URLs
reach the visible login form without browser application errors.

Readiness proves local session-store connectivity, not backend/report readiness.
No authenticated caregiver data was requested. Backend deployment/configuration,
prospective migration and representative live parity remain unverified here.

### Caregiver sign-in return path

Follow-up on the same day: anonymous `/care` correctly requires sign-in, but its
fallback discarded the requested page and an administrator then landed in
Administration. `CareLoginRedirect` now retains a dedicated `careReturnTo` value;
the shared login page identifies the caregiver context. `src/care/login-return.ts`
accepts only bounded, normalized local `/care` URLs. After sign-in, an outstanding
password change takes priority, then the requested care URL, then the normal
role-specific landing. Refine's unvalidated `to` query override is ignored.
Existing credentials, backend authorization and auth-cache invalidation remain.

Checks: full units 926 passed / one opt-in Redis test skipped; production build,
typecheck, formatting and diff checks passed. Eleven new `care-login.spec.ts`
browser cases plus twelve existing sign-in/overview/logout checks passed with
strict local API mocks. Report IDs, trend/date filters, administrator/caregiver
defaults, hostile redirects and required-password routing are covered.
Local Admin was rebuilt/recreated with this fix and became healthy. Served
JS/CSS match the running image. Cookie-free Chromium checks on localhost:8080
confirmed the caregiver login label and retained return path for `/care` and a
report deep link, without browser errors. Redis remained running. Successful
authenticated return behavior is covered by synthetic browser checks; no real
credentials or protected report data were used.

## Future shared/backend release procedure — NOT EXECUTED

1. Review the completed gates and all three repositories, then make
   approved clean commits. Capture prior images/config, DB backup and restore
   readiness. Verify target cluster/server, namespace, registry, DB/schema and
   owner: no actual caregiver deployment target was established here.
2. Follow backend deploy/migration/target/core/release/README.md for immutable
   source, approved platform, scanning and signing. Core API base manifests have
   zero replicas and are not authoritative. Use the reviewed private overlay;
   never apply the base or enable authority as a side effect.
3. Coordinate ingester writers/scheduler and verified report DB owner. From the
   ingester checkout, against that explicitly verified public-schema DB:
   ```sh
   psql -X --set=ON_ERROR_STOP=1 --file=sql/20261029_portal_binding_events.sql
   ```
   Run once, not at startup. Never reapply/backdate/backfill evidence. Provision
   the narrow SELECT-only reader above through normal secret management.
4. Deploy Foundation plus enforcing Users/Core/Assets/Organizations/Rules/Actions
   BEFORE enabling role IDs. Set USERS_CAREGIVER_USER_TYPE_IDS in Users and
   matching CAREGIVER_USER_TYPE_IDS in BFF; grant Assets:r, Sensors:r and existing
   authorized asset grants.
5. Project optional CORE_CARE_REPORTS_DATABASE_URL only into Core API's existing
   .env/.secret mechanism. Use postgresql+psycopg, sslmode=require or verify-full,
   gssencmode=disable; CORE_CARE_REPORTS_SCHEMA defaults public. Use the narrow
   reader, not owner credentials, with reviewed API-to-report-DB network access.
6. Verify BFF-to-Core routing/policies. Gateway coexistence rendering does not
   inventory /v1/care. If authorized, CARE_API_ORIGIN may be
   http://core-python-api.tronicare-migration.svc.cluster.local (service port80
   to API8082), without redirecting normal Core operations. This example is not a
   verified release target.
7. Build/release Admin through its existing registry workflow:
   ```sh
   npm ci
   npm run contracts:check
   npm test
   npm run build
   npm audit
   docker build -t <approved-registry/image:immutable-tag> .
   kubectl kustomize <reviewed-admin-overlay>
   ```
   Supply exact HTTPS PUBLIC_ORIGIN, shared REDIS_URL/SESSION_SECRET, TLS and
   approved service origins through existing secret/config management.
   After context/server/namespace and rendered image/config review:
   ```sh
   kubectl --context <verified-context> -n <verified-namespace> apply -k <reviewed-admin-overlay>
   kubectl --context <verified-context> -n <verified-namespace> rollout status deployment/tronicare-admin
   ```
   For an already configured approved Core API image-only rollout:
   ```sh
   kubectl --context <verified-context> -n <verified-core-namespace> set image deployment/core-python-api api=<approved-image@sha256:digest>
   kubectl --context <verified-context> -n <verified-core-namespace> rollout status deployment/core-python-api
   ```
8. Follow ingester docs/deployment_vps4.md: reviewed Git fast-forward and
   uv sync --frozen --no-dev, scheduler/writer coordination and private config
   preserved. Opening the portal needs no ingestion/backfill.

## Future smoke, rollback and remaining limits

Smoke with normal authorized accounts: caregiver login; organization switch;
overview; exact report deep refresh/back/forward; graphs/HRV/gaps/exit focus;
trend -> exact report; logout/late reply. Verify denied cross-org, wrong-parent
and direct mutations, plus ordinary admin and mobile compatibility.
Check read-only grants, readiness and routing. Compare an authorized representative
live report with the ingester before claiming live parity. Pre-capture reports
may correctly be unavailable.

Rollback to captured prior UI/API images and compatible config, or remove the
optional report DSN. KEEP caregiver classification and backend/BFF enforcement;
never restore unrestricted caregiver admin access. KEEP binding tables, interval
view, capture triggers and immutable evidence. Never drop/reseed/backdate.
Preserve reports/jobs; use established release/DB recovery if repair is needed.
Use only captured compatible digests that retain the required enforcement:

```sh
kubectl --context <verified-context> -n <verified-namespace> set image deployment/tronicare-admin admin=<captured-compatible-ui@sha256:digest>
kubectl --context <verified-context> -n <verified-namespace> rollout status deployment/tronicare-admin
kubectl --context <verified-context> -n <verified-core-namespace> set image deployment/core-python-api api=<captured-compatible-core@sha256:digest>
kubectl --context <verified-context> -n <verified-core-namespace> rollout status deployment/core-python-api
```

Limits: representative live parity unverified; legacy attribution cannot be
inferred; occupancy freshness/coverage/generation time unknown where unproven.
Time in bed, authorized temperature and independent movement counts remain
explicitly unavailable. No clinical interpretation, AI, new scores/alerts or
download endpoint was introduced. Shared/backend release remains a separate step.

## Authorized local caregiver API — 29 October 2026

After the local Admin rebuild, caregiver reads reached an upstream without the new
`/v1/care` routes. The user authorized running the new Python API locally alongside
Admin. This extends the earlier no-live-operations boundary only for this isolated
local setup; it does not constitute a shared Core deployment or report-database
migration.

`Dockerfile.care-api` uses a pinned existing Core runtime and overlays the current
Core/Foundation working-tree sources plus Alembic configuration/migrations. Its
adjacent allowlist excludes private configuration and unrelated code. Dependencies
are reused, and image labels explicitly say `local-working-tree`, rather than
claiming a clean immutable release. The default process is `core-api` as UID65532.

`compose.care.yaml` adds the API, local PostgreSQL, TLS initialization and named
data/TLS volumes. Only the Admin caregiver origin is overridden:
`CARE_API_ORIGIN=http://care-api:8082`. Existing Users, Assets, Core and other
Administration origins remain unchanged. The API/database have no host ports;
Admin remains the browser entry point at localhost:8080. The API root filesystem
and private configuration mount are read-only, with a bounded temporary filesystem.

On this machine, that single `CARE_API_ORIGIN` setting was also persisted in the
existing ignored `.env`; no unrelated keys changed. Ordinary Admin-only Compose
rebuilds therefore retain caregiver routing. The overlay is still required when
starting or stopping the full local API/database stack.

`scripts/prepare-local-care.mjs` generated fresh local credentials under ignored
`.local/care-runtime`; it refuses to replace existing configuration. The new empty
local database was initialized through the backend Alembic path to revision
`20261027_0029`, and its dedicated reader grants were applied. Verified checks:

- Core API readiness is healthy against its local `LEGACY_ONLY` authority epoch.
- Its PostgreSQL reader connects with TLS and cannot write.
- `CORE_TEST_MODE=false`, with normal fresh Users context and exact Assets scope
  authorization through the existing HTTPS origin.
- API mutation and activation gates remain false; virtual-event bindings are empty.
- No report DSN, production equipment copy, telemetry, vendor job, worker or ingest
  process was configured or started.

The local database migration/grants are explicit setup operations, not API startup
behavior. The prospective ingester binding migration was not applied to a report
database. Subjects can therefore use existing authorized Asset identities, while
local Core observations and sleep reports have no populated source here. Missing
data remains unavailable; this setup does not invent readings or reports.

Build the API from the backend checkout as shown in the README, then retain the
overlay on subsequent rebuilds/restarts:

```powershell
docker compose -f compose.yaml -f compose.care.yaml up -d --build --wait --wait-timeout 120 admin care-api
```

Do not rerun the first-time initializer on restart or remove the named volumes as
a repair step. Admin was rebuilt/recreated with the caregiver-only origin override
and is healthy. Runtime checks confirmed the caregiver health route returns 200,
and the subjects route returns JSON 401 without a session, establishing that the
new route exists. Technical Core routing remained unchanged, and the served SPA
and asset bytes match the rebuilt image. Anonymous Playwright checks confirmed
`/care` and report deep links retain `careReturnTo` at sign-in without page errors.
An independent read-only audit also confirmed that the required upstream Users
context and Assets scope/list routes are reachable over HTTPS and return JSON 401
without a token. Token forwarding matches their existing contract; this does not
establish authenticated account access.

Checks for this follow-up: full units 929 passed / one optional test skipped,
production build passed, and the prior 21 mocked browser cases passed. Interactive
signed-in verification could not be completed because the native browser helper
remained unavailable after retry/reset. The account's authorized Asset list was
not verified. No real authenticated caregiver view or representative live report
parity is claimed by the route, readiness, TLS or write-denial checks. The future
shared release procedure above remains unexecuted.

## Optional local Admin observation bridge — 29 October 2026

The user subsequently reported that `/care` displays their Assets but lacks bed
observations. The normal Admin Core origin exposes current sensors/types/devices,
while the separate local caregiver database deliberately contains no equipment or
telemetry. Those are different read sources; an empty local SQL result cannot
establish a last-reported bed state.

`CARE_USE_ADMIN_OBSERVATIONS` is a BFF opt-in, default `false`. The local Compose
overlay and this machine's ignored `.env` enable it. On caregiver subject list and
detail responses only, it fills missing observations through three bounded batch
reads of the existing normal Core Sensor, Sensor type and Device endpoints, using
the same signed-in caller token. There are no per-subject read loops, elevated
credentials, Core-side remote fallback, raw technical route exposure or data
mutations. Existing primary observations are not overridden. Fresh caregiver
authorization and subject scope are revalidated before measurements are attached.

Eligibility requires the `bedoff` hardware type, Boolean ValueType1, an actual
Boolean value, matching device/asset/organization, and a positive, valid,
nonfuture Admin event timestamp. False maps to last observed in bed; true maps to
last observed out of bed. Duplicate candidates are ambiguous, and capped,
missing, malformed or inaccessible sources remain unknown with a separate
availability reason. `shared/sensor-reading.ts` reuses the existing Admin UTC
timestamp parser. The UI distinguishes unavailable measurement access from an
actual observation, while current state remains unknown and freshness unassessed;
no occupancy timeout or physiological interpretation was introduced.

This bridge has limited backend support. A server-classified caregiver account
may be denied Sensor type or Device reads even when its Assets are visible. In
that case measurement access remains unavailable; the bridge does not broaden
permissions or substitute another token. A dedicated authorized remote observation
projection remains a future integration. Older serializers may default a database
NULL Boolean to false, so their DTO cannot independently prove original nullness;
the bridge presents the same reported value/event timestamp available to Admin,
without claiming raw-value provenance or current occupancy.

No report DSN, shared Core deployment, remote schema change, ingestion or telemetry
was added. Checks completed: 1,016 unit tests passed with one optional Redis test
skipped, including 85 synthetic observation cases; typecheck and production build
passed. All 32 focused browser checks passed (11 caregiver overview, 11 login and
10 existing Admin sensor-value cases). These cover availability errors hiding stale
readings and unchanged Admin timestamp/value behavior. Formatting and diff checks
passed, and the isolated browser preview was stopped.

Local Admin was rebuilt/recreated and is healthy with the opt-in enabled. Runtime
checks confirmed the caregiver-only origin and unchanged technical Core routing,
the exact rebuilt SPA/assets, and anonymous caregiver login return paths without
browser errors. The user confirmed live Asset listing before this change; no live
bed reading through this bridge has yet been verified in a signed-in session.

## Caregiver pictograms, status and Standard entry — 29 October 2026

Reused the original occupied/empty bed SVGs from `AdminTronicareWD/Images` as
`src/assets/bed-in.svg` and `bed-out.svg`, with `BedPictogram` beside the dated
observation text in overview and detail. Unavailable/ambiguous observations do
not display an in/out pictogram. Current occupancy remains unknown.

Caregiver subject list/detail now carry `lastEventAt` from the existing Assets
`m_dhDhLastEvent` field, normalized to UTC or null. The API adds no query or
permission. The view reuses `HubStatus`: green under five minutes, yellow through
one hour, red through eight hours, black older/unavailable. Discs describe the
Asset event age independently of bed observations and update every 15 seconds
and on browser return. Text, tooltips and observation times remain available.

Removed the standalone role badge from the shared organization selector in both
headers. Membership choices retain their role descriptions. The user confirmed
User type 27 is Standard; the ignored local configuration adds it to
`CAREGIVER_USER_TYPE_IDS`, preserving other configured IDs. Existing BFF session
classification, login destination, route guard and technical API denials now
restrict that exact type to `/care`, while other administrator types retain
their existing behavior. No role-level threshold or guessed type ID was used.

Users source additionally derives its existing `caregiver_read_only` flag from
the fresh effective role Kind `standard` or configured caregiver IDs, preserving
`adminorg`/`adminsuper`. This source change has not been deployed to the shared
Users service; local enforcement uses the explicitly confirmed type ID.

Checks passed: 1,017 Admin unit tests (one optional Redis skip), production build,
and 32 browser cases (12 overview, 11 login, nine organization-switch). The new
browser case confirms both original pictograms, all four disc colors independent
of the bed timestamp, age recoloring, tablet cards and the detail heading. Tablet
layout was visually inspected; the isolated test preview was stopped. Core's 74
targeted caregiver/parity/trend tests, scoped Ruff and mypy passed. Users' 69
isolated PostgreSQL tests (including 12 new classification cases), 294 offline
tests (two optional broker skips), scoped Ruff and mypy passed.

Local Core API and Admin were rebuilt/recreated and are healthy. Runtime checks
confirmed the Standard restriction is configured, the caregiver origin remains
local, technical Core routing is unchanged, served assets match the new image,
and anonymous caregiver/deep links preserve their login destination. No shared
deployment, remote schema change, or additional data privileges were applied.
Actual signed-in Standard login and live status/bed values were not observed;
the user confirmed only the Asset list earlier.

## Caregiver display cleanup — 29 October 2026

The subsequent cleanup also removes the overview subtitle about available Assets,
last observations and completed reports. Its production build/typecheck passed;
local Admin was restarted and the served bundle was checked for the removal.

The overview column is now **Resident**, backed by the existing Asset IDs and
permissions. Removed the requested Read-only/context label, overview timezone,
status legend and list-refresh paragraphs, and the per-bed Current status unknown,
freshness and Last observed text. Known observations retain their original
pictogram and timestamp; image alt text supplies In bed/Out of bed. Missing,
denied or ambiguous readings retain their existing unavailable messages.

Caregiver organization selection hides the visible Active organization label and
uses its verified Tag; switching and accessible control names remain available.
`GET /api/session/organization-tags` projects only exact organization IDs and Tag
strings from the existing caller-scoped Organizations membership-tag endpoint.
It forwards the caller token, rejects query/body overrides, bounds and validates
the response, and never falls back to a generic organization read. Frontend tag
queries are session/context scoped, discard error/placeholder data, and preserve
an ID fallback when tags are unavailable. Administration keeps its existing label.

Visible caregiver dates now use DD/MM/YYYY and times use 24-hour h23 format,
including graph inspection, report selections and trend labels. UTC report dates,
wire timestamps, query filters, date input values and URL identities are unchanged.

Checks completed: 1,049 Admin unit tests passed (one optional Redis skip), including
32 new membership-tag boundary cases. Typecheck, production build, formatting and
diff checks passed. All 57 focused browser cases passed across caregiver overview,
login, reports, trends, hardening and organization switching. These verify the
requested removals, scoped organization Tags, DD/MM/YYYY dates, afternoon/midnight
24-hour time, and retained DST/source-time and cache-isolation behavior. The cleaned
tablet layout was visually inspected without clipping; the isolated preview was
stopped.

Local Admin was rebuilt/recreated and is healthy. Anonymous runtime checks confirm
the rebuilt SPA/assets, protected organization-tag metadata route, caregiver login
return paths, and retained Standard-role restriction and existing service routing.
The upstream membership-tag route responds with JSON 401 without a token; no real
authenticated Tag response was inspected. No backend deployment, database change,
permission grant or session credential change was required.

## VPS5 report credential access — 29 October 2026

The user authorized accessing reports with `.secret` credentials. The Admin
root `.secret` is empty; the existing ingester `.secret` contains the report
database URL. Its resolved host matches VPS5 and its database is
`sensors_history`. Credentials were read privately and never printed, passed in
process arguments, committed, or copied into the runtime. Added `.secret` and
`.secret.*` to Admin Git and Docker exclusions; the supplied file is untracked.

Direct and running caregiver-container probes both connected successfully with
TLS required, GSS encryption disabled, explicit read-only transactions, bounded
connection/statement deadlines, and the intended database verified. Catalog
checks confirm the expected source columns in `public.daily_report`,
`public.raw_sleep`, and `public.monitored_system`. Existence checks confirm stored
raw and parsed reports without reading payloads or printing protected records.

Two prerequisites remain: the supplied ingester role has elevated/write
privileges, and neither `monitored_system_binding_event` nor
`monitored_system_binding_interval` exists. A separate reader role and the
already prepared one-time prospective capture migration are therefore needed
before wiring `CORE_CARE_REPORTS_DATABASE_URL`. Current mutable source bindings
cannot establish historical report ownership. Capture begins at execution time;
earlier periods require independently verified historical assignment evidence
and must remain unavailable meanwhile.

Reviewable scope: verify a current backup and coordinate source writers; apply
ingester `sql/20261029_portal_binding_events.sql` once with bounded lock/statement
timeouts on the verified database; provision a dedicated SELECT-only reader
using the value-free `.local/care-runtime/report-reader.review.sql` template;
verify effective privileges (including PUBLIC grants); save only its separate
TLS report DSN to the ignored local API secret; restart and check only the local
caregiver API. Do not change Core authority, ingestion schedules, reports,
cursors, current assignments, or existing application credentials.

No remote schema, role, grant, configuration, or data changes were made. The
ingester instruction requiring explicit authorization for production data or
deployment configuration changes applies before this remaining scope. Local
report routing remains unconfigured instead of using the elevated account or
an unsafe historical fallback. The four local services remain healthy.

Checks completed: host and actual caregiver-container TLS/read-only connection
probes passed, database/source-column identity checks passed, report presence
confirmed, missing binding prerequisites and elevated supplied role identified,
Git secret exclusions and diff checks passed. No signed-in caregiver report
response or live graph parity is claimed.

## Caregiver row-to-report graphs — 30 October 2026

Caregiver overview table rows and tablet cards now open the exact latest known,
same-subject completed report when report access is available. Resident-name
links use the same destination. Missing, denied, unavailable or invalid report
metadata opens the subject detail, preserving its existing honest empty/denied
state and fresh backend authorization rather than choosing another subject's
report. IDs remain decimal strings.

Extracted the existing guarded row handlers to `navigationRow` in
`src/components/record-row.ts` and reused them for caregiver rows/cards in
`src/care/pages.tsx`. Existing Administration permission checks remain in
`useRecordRow`. Both surfaces support Enter/Space and preserve nested controls,
modified clicks, selected text and portal-event guards. Tablet cards have a
visible hover/focus treatment and an accessible navigation label.

Reused the existing report page and shared ingester preparation: bed presence,
heart rate, respiration, movement flags and optional vendor HRV. The Excel
export's four-week breathing-event graph is already available under Trends.
Bed Temperature needs a separate verified history source and is still
unavailable; this change does not invent that source or recalculate metrics.

The current local API configuration still has no report DSN. Previous read-only
VPS5 connectivity checks established that reports exist, but did not apply the
missing binding migration or provision a reader. No production database changes
or broader grants were authorized or applied by this navigation request. Live
report availability and graph parity therefore remain unverified.

Checks completed: production build/typecheck, formatting and diff checks passed.
All 39 synthetic browser checks passed on the first run: 18 caregiver overview
(including six new activation/fallback cases), ten report-graph cases and 11
existing Administration row-navigation regressions. These cover exact 64-bit
subject/report identity, rendered coordinated graphs, desktop/tablet activation,
Enter/Space, nested links, modified clicks, text selection and no-report/denied/
unconfigured/wrong-parent fallbacks without report reads or mutations. The new
tablet-card screenshot was visually inspected without clipping. The isolated
preview was stopped after verification.

Local Admin was rebuilt/recreated with both Compose files and is healthy. Served
JS/CSS match the rebuilt image; caregiver overview/deep SPA routes return 200,
anonymous protected routes remain 401, Standard-role restrictions and local
caregiver routing remain configured, and technical service routing is unchanged.
The Core API and existing authorization services retain their expected health/
anonymous-auth responses. No signed-in live report or graph was inspected.

## Report dependency diagnosis — 30 October 2026

The user confirmed resident navigation succeeds but shows Reports unavailable.
Fresh read-only checks confirm `CORE_CARE_REPORTS_DATABASE_URL` is absent from
the local API secret, and VPS5 still lacks the binding event/interval relations.
The Admin root `.secret` now contains `DB_URL`; those supplied credentials were
verified privately with TLS/read-only transactions against the intended report
database. The role is elevated and must not be installed as the API reader.

The dedicated reader role and portal index do not exist yet. ACL preflight found
no PUBLIC schema/database CREATE, table-write, or public SECURITY DEFINER execute
grants that would obstruct the prepared reader setup. No current backup was
identified in the initial conventional-path check; verify/create a protected
backup before any approved migration. No live schema, role or configuration
changes were made. Approval for the prepared remote setup was requested under
the ingester's explicit production-change gate.

Core deliberately returns `reportsAvailable=false` for a missing or failed report
dependency; the page therefore makes no report/series request. A working query
with no eligible report instead returns true with an empty report selection.
Refresh cannot repair absent configuration/schema. Installing prospective
capture enables later whole reporting periods only; existing historical reports
also require independently verified assignment evidence, which the current
raw/report/run/summary schema does not contain. Current monitored-system links
and the Excel current-binding join are not such evidence.

## Approved VPS5 report setup — 30 October 2026

The user explicitly approved the prepared database setup. Verified the VPS5
host/database, PostgreSQL version, source schema/ownership, inactive writer
transactions, committed migration source and backup capacity. Created a protected
current database archive and verified its table of contents, complete decoding
without executing its SQL, and checksum before any DDL. The archive and original
extension ACL receipt remain in the protected server backup directory; private
operator receipts and generated credentials remain under ignored `.local`.

The supplied login could read reports but lacked schema-owner/role-management
authority. The verified SSH database operator applied the committed ingester
`sql/20261029_portal_binding_events.sql` as the existing source owner and created
the reader in one atomic transaction. Lock and statement deadlines were bounded.
Capture starts at database NOW; source-row fingerprints matched before/after.
The event table, interval view, three indexes and four enabled capture/immutability
guards were verified. Current source bindings match the latest captured events;
capture functions retain their pinned search path and are not publicly executable.

Privilege-validation failures rolled back fully before correction: sequence
privilege checks needed CASE protection against planner predicate reordering;
the existing TimescaleDB procedure
`_timescaledb_functions.cagg_migrate_update_watermark(integer)` was executable
through PUBLIC and could write. The scoped remedy preserved EXECUTE for every
preexisting role before revoking PUBLIC on that one exact routine. Role-set drift
aborts setup; original ACL metadata was preserved. The new reader has no role
memberships and cannot invoke that routine. All preexisting roles retain access.
Future roles now need explicit access; extension upgrades/new-role provisioning
must recheck this override. No other extension ACL was changed.

Created `care_portal_reader` with only the required CONNECT/schema usage and
SELECT grants on `daily_report`, `raw_sleep` and the interval view, four-connection
limit, read-only transaction default and query/idle deadlines. Fourteen live
reader checks passed: TLS, exact target/role, no elevated attributes, membership,
ownership, schema/database CREATE, table/column writes, sequence use/update,
executable definer routines, or direct source/event-table reads. Installed only
its separate `CORE_CARE_REPORTS_DATABASE_URL` in the ignored local API secret and
`CORE_CARE_REPORTS_SCHEMA=public` in its public configuration. Existing Core
authority, session secrets, technical routing and ingestion schedules are unchanged.

Restarted only the local caregiver API; it is healthy. Five actual report adapter
queries passed with impossible subject/organization IDs (zero protected rows),
and the actual availability projection returned true instead of dependency
unavailable. Local Core reader restrictions, Admin SPA/assets/health and anonymous
authentication boundaries also passed. No frontend/backend source changes or
additional synthetic-suite reruns were needed for this configuration-only step.
No real signed-in report/graph parity is claimed.

After the user reported that the list was still empty, a read-only existence
probe confirmed stored reports are present, no eligible completed report exists,
and every stored period starts before capture. For unchanged bindings, the first
whole vendor period ends on 1 November 2026 at 05:00 UTC / 06:00 Brussels time;
it becomes available after normal ingestion. Older reports remain unavailable
until independently verified historical mappings are supplied. Requested the
affected Resident/asset and an authoritative source of assignment dates. No
capture was backdated and no stored report, cursor or assignment was rewritten.

## Scoped historical report check — 30 October 2026

The user supplied a target asset. A bounded TLS/read-only check confirmed an
active report-system mapping with positive organization capture, matching raw
packets and valid parsed reports. All matching report periods predate capture.
Installation dates are populated and no source removal is recorded, but those
mutable fields do not prove uninterrupted historical ownership. Target IDs,
vendor identifiers and period metadata remain only in a private ignored evidence
file; no payload or clinical metric was read or printed.

The bounded service review found current hierarchy rows and digest-only mutation
audits, not a reconstructable complete reassignment timeline. Sensor history can
corroborate individual asset observations but lacks complete historical hub,
organization and vendor-report linkage. Verified retained import artifacts could
corroborate a dated baseline if supplied. Requested the independently verified
date from which the target's current device continuously belonged to the same
resident and organization. No historical attestation was inferred, no capture was
backdated, and no further database/runtime changes were made in this check.

## Confirmed historical access and legacy UTC — 30 October 2026

The user explicitly confirmed that the requested asset's current report device
has continuously belonged to the same resident and organization "from beginning".
Recorded that confirmation and its exact scope privately. The historical start
is conservatively bounded to the earliest already-stored matched completed
report for that one confirmed stream; installation dates were not substituted
for evidence and no other asset was attested.

Added ingester `sql/20261030_portal_binding_attestations.sql`: owner-only immutable
attestation/revocation records, operation UUID, confirmation digest, exact first
capture and asset/org/vendor snapshot, database actor/clock, and guarded bounded
registration. It rejects source drift, later captured changes, invalid/pre-report
starts, duplicate active evidence and non-READ-COMMITTED registration. The view
computes later boundaries from original events before extending only the
confirmed initial interval. Revocation restores its original start; reassignment
back never extends a later interval. The view identity/owner/ACL and the reader's
existing SELECT-only surface are preserved. Generic evidence rules are documented
in ingester `docs/analysis/caregiver_portal_reuse.md`.

After a fresh protected backup and verified complete archive decode, applied
the migration and one scoped attestation in a bounded owner transaction, first
validated with rollback. Source/report/raw/event fingerprints remained identical;
no report, metric, cursor, assignment or capture recording time was rewritten.
The private confirmation/snapshot, original view metadata and operation receipt
remain in restricted backup/operator artifacts. The API reader has no new table
or validation-function access. All 61 isolated PostgreSQL 18 checks passed
(42 new historical-evidence cases and 19 prospective cases), including revocation,
later reassignment, permissions and view identity preservation. Scoped Ruff,
formatting, Ty and diff checks passed.

Live verification then exposed a separate legacy storage compatibility issue:
VPS5 daily-report session start/end and update timestamps are timezone-naive UTC,
while raw-packet/provenance timestamps are timezone-aware. The ingester's parser
and stored packet boundaries establish their UTC convention. Core's
`PostgresCareReports._read` now attaches UTC only to naive `session_start_at`,
`session_end_at`, `update_at` and computed `end_exclusive`. Existing aware offsets,
raw timestamps, all other fields and strict global ISO/analytics validation remain
unchanged. No database type or timestamp value was altered.

Fourteen new offline timestamp-boundary cases plus existing caregiver detail,
series, trends and analytical parity checks passed: 88 total, with scoped Ruff,
formatting and mypy passing. Rebuilt/restarted only the local caregiver API from
the current working tree; it is healthy. The actual dedicated-reader queries now
load the confirmed asset's latest historical report, match its stored payload and
prepare bed intervals, signal samples and vendor HRV within graph limits. Wrong
asset/org report lookups remain denied, and the reader still cannot access the
new evidence tables/function. Probes emit only outcome flags, no clinical values.
Signed-in browser rendering was not inspected; the user can refresh the existing
resident view. Other assets' unconfirmed pre-capture history remains excluded.

## Report display and Brussels time — 30 October 2026

Hidden the Report summary card, standalone vital/HRV Inspect sections, Bed exits
list and displayed Asset/Organization IDs in the caregiver portal. Resident and
organization tags/labels remain, including ID-free fallback labels. Report IDs
and the internal route/API identities are unchanged. Vendor HRV is always the
fifth synchronized graph; absent or unsupported readings show Not available
without manufactured samples. Chart tooltips, bed-interval interaction and
shared zoom/pan remain available.

`shared/date-time.ts` provides bounded cached Brussels formatters and local
range-input conversion. Admin fields, status/notification timestamps, schedules,
history filters, caregiver observations, reporting periods, provenance and chart
labels use Europe/Brussels regardless of the browser timezone, with DD/MM/YYYY
dates and 24-hour times. Local edits are converted to UTC; unchanged repeated-hour
report boundaries preserve their original instant/milliseconds, and ambiguous or
skipped edits are rejected. Daily rule schedules retain their UTC-day anchoring
and existing overlap behavior. Date-only report identifiers, birth dates and pause
dates remain calendar values; report windows, metrics, API/storage timestamps and
ingestion schedules are unchanged. The default report/trend date uses the Brussels
calendar date, including when UTC and the browser are still on the previous day.

The initial summary-only change passed 11 affected existing browser cases.
The combined display changes passed 52 focused date/schedule/graph unit cases,
production build/typecheck, formatting and diff checks. Six caregiver overview/
trends cases and nine Admin cases passed using synthetic fixtures, including
New York-browser Brussels rendering, local midnight, summer/winter UTC conversion,
and the absence of displayed IDs. All 17 report/hardening browser cases also
passed, including both autumn-fold offsets, preserved exact UTC range requests,
ambiguous-edit rejection, always-visible/unavailable HRV, hidden inspectors/exits,
and bounded maximum series on tablet. Desktop/tablet screenshots were reviewed
for clipping. These checks use synthetic fixtures, not real account sessions.

Rebuilt/recreated only local Admin with the existing caregiver Compose overlay.
The container is healthy; localhost SPA/deep links, anonymous authentication
boundaries and served entry/graph bundle hashes passed. The served bundles contain
Brussels range labels and the HRV panel, with summary/inspector/exit headings
absent. No backend/database or production deployment was changed in this UI step.

## Hide Report information — 30 October 2026

Removed the caregiver Report information card and its generation, received,
processed and vendor-update metadata from `src/care/pages.tsx`. Reporting period
and graphs remain. Existing browser checks have no dependency on that card, so
no test changes were needed for this display-only removal. Formatting, diff
checks and the container production build/typecheck passed. Rebuilt/restarted
local Admin; health, SPA/deep links, anonymous authentication boundaries and served
bundle hashes passed, with Report information absent from the served entry.

## Use reporting selectors for graphs — 30 October 2026

Removed the graph-specific start/end fields, Load range and Full reporting period
buttons, their state and related instructions from `src/care/report-graphs.tsx`.
Graphs request the selected report's full period through the existing default
series endpoint. Report/date/previous/next selectors remain, as do coordinated
chart zoom, pan, reset and tooltips. Error and reduced-sampling notices no longer
direct users to the removed fields; 422 responses offer another report or retry.
Backend contracts, limits and report-boundary validation are unchanged.

Updated existing report/hardening browser checks and removed one obsolete
form-only case. All six affected cases passed against synthetic fixtures,
including report selection, full-period requests without range query parameters,
DST labels/reload, HRV, maximum series, zoom without extra reads and error retry.
The tablet screenshot was reviewed for clipping. Formatting, diff checks and
host/container production builds/typechecks passed. Rebuilt/restarted local
Admin; health, deep links, authentication boundaries and served-bundle checks
passed, with graph range controls absent and reporting selectors present.

## Hide Report date — 30 October 2026

Removed the Report date field from `src/care/report-navigation.tsx` and updated
instructions that referred to it. Reporting period and previous/next/latest report
navigation remain. Existing dated deep links continue to resolve normally.
Two affected existing browser cases passed against synthetic fixtures using the
exact container-built assets, covering dropdown selection, legacy date links and
reload, missing-day behavior, full-period graphs and the hidden field. Formatting,
diff checks and the container production build/typecheck passed. Local Admin was
rebuilt/restarted healthy; SPA/deep links, authentication boundaries and served
bundle hashes passed, including Report date absent and Reporting period present.

## Remove Latest observation card — 30 October 2026

Removed the Latest observation card and its explanatory paragraph from caregiver
detail in `src/care/pages.tsx`. The overview's bed pictograms, timestamps and status
discs remain, as do report selection and graphs. Formatting, diff checks and the
container production build/typecheck passed. Rebuilt/restarted local Admin
healthy; SPA/deep links, authentication boundaries and served-bundle hashes passed,
with Latest observation absent from the served entry.
The one affected existing browser case passed against synthetic fixtures using
the container-built assets, confirming desktop/tablet overview observations and
event-age colors remain while the detail card/pictogram are absent.

## Report controls and display polish — 30 October 2026

Rearranged `src/care/report-navigation.tsx` into two rows: Reporting period and
Latest report first, then Previous report and Next report. DOM/keyboard order
follows that layout. Brussels date/time formatters now show CET in winter and
CEST in summer, including tooltips and the repeated autumn hour; UTC instants
and stored values are unchanged. Removed the graphs card's introductory sentence.

Moved the chart zoom slider from the bottom to the top, before Bed presence, in
`src/care/report-graphs.tsx`; matching grid/title offsets in `report-graphs.css`
leave room for the slider while retaining the chart height and linked zoom/pan.
Five focused date-format cases passed for short/offset labels and DST boundaries.
Formatting, diff checks and production container build/typecheck passed. Local
Admin was rebuilt/restarted healthy; served entry/graph hashes, SPA/deep links,
authentication boundaries and hidden-introduction checks passed.
Eight affected existing browser cases passed against synthetic fixtures using
the container-built assets: three caregiver navigation/DST cases and five Admin
zone-label cases. A temporary 1440/768px layout check verified row bounds and
actual Tab order, absence of the introduction, and zoom/reset preserving UTC
bounds without extra reads. Reviewed desktop/tablet screenshots: slider above
Bed presence, all five panels readable, no overlap or clipping.

## Populate overview reports for all mapped residents — 30 October 2026

The user clarified that every resident's Latest completed report cell should be
populated. Read-only source review found no blank-cell or overview truncation
bug: each visible asset uses the batched latest-report query over all eligible
history, with the normal asset/organization checks. A value-free live database
audit found 13 current mapped residents with stored completed reports, one with
eligible history and 12 whose reports predate assignment capture.

Prepared an exact private 12-stream/12-resident scope across three organizations.
The user explicitly confirmed all 12 devices have continuously belonged to their
current resident and organization since their first stored report. Recorded the
actual question/answer against the frozen scope digest. A fresh protected backup
was checksum-verified and completely decoded without restoring or emitting data.
Preparing INSERT-only historical evidence through the existing owner guard;
the previous single-resident attestation and all source/report/capture rows remain
unchanged at this stage. No frontend or authorization change is needed.

Completed the 12-row historical evidence operation through the installed owner
guard, with distinct persisted operation UUIDs and confirmation digests. The
frozen cohort, guard definitions, view, reader privileges and prior canonical
attestation were checked before and under bounded locks. Validated with rollback
before committing the batch atomically; source, raw/report/capture fingerprints,
prior evidence/revocations and view/reader privileges remained unchanged.

The first validation stopped before any insert because a read-only boolean check
returned psql's `t` rather than JSON `true`. Corrected the two scalar JSON queries;
proved the exact frozen preflight/prior evidence unchanged, all 12 operation IDs
absent and the remote provenance artifact absent before rebinding the reviewed
script digest. Preserved all operation UUIDs/digests and recorded that pre-write
recovery privately. Fresh rollback validation and commit then passed. Independent
script review, local/embedded syntax and confirmation/backup checks passed.

The actual dedicated reader now returns valid Latest completed report summaries
for all 13 confirmed mapped residents. Every latest report link resolves to a
stored payload with matching identity; wrong-parent and wrong-organization lookups
remain denied. Checks emit only outcomes/counts, never clinical values. No frontend,
API deployment or restart was needed; refresh Overview to replace cached cells.

## Simplify overview and report-page controls — 30 October 2026

Removed the visible Overview heading from caregiver overview while keeping its
Refresh button aligned right. On report detail, removed the page-level Refresh
button and Back to overview/Trends links. The primary caregiver navigation and
explicit error retry actions remain. Changes are confined to `src/care/pages.tsx`.
Formatting, diff checks and the production container build/typecheck passed;
rebuilt/restarted local Admin with the existing caregiver overlay.
All 10 affected existing browser cases passed against synthetic fixtures using
the exact container-built assets. Checks cover overview arrival without a heading,
sign-in/deep links, desktop/tablet header navigation, absence of report-page
controls and cross-subject isolation. The tablet screenshot was reviewed for
readability and clipping. Health, SPA/deep links, authentication boundaries and
served entry/graph hashes also passed. Temporary synthetic preview was stopped.

## Inline report navigation — 30 October 2026

Merged the report controls into one wrapping row in `src/care/report-navigation.tsx`:
Reporting period, Latest report, Previous report, Next report. Controls align at
their lower edge and retain this DOM/keyboard order when wrapping on smaller
screens. The existing neighbor/back-forward/reload browser case passed against
the exact container-built assets. A temporary 1440/768px check and screenshots
confirmed desktop inline placement, tablet wrapping, keyboard order and no
clipping. Formatting, diff checks and the production build/typecheck passed;
local Admin was rebuilt/restarted healthy and served-bundle/authentication checks
passed. No report-query behavior or data changed.

## Remove repeated overview navigation text — 30 October 2026

Hidden the Overview navigation link on `/care` and `/care/` in
`src/care/layout.tsx`; other caregiver pages retain that return link. Removed
the Open report link from `LatestReport` in `src/care/pages.tsx`, covering both
desktop rows and tablet cards. Reporting periods, resident-name links and
click/keyboard navigation on rows/cards remain.

Formatting, diff checks and the production container build/typecheck passed.
Local Admin was rebuilt/restarted healthy; health, SPA/deep-link, anonymous
authentication boundaries and served-image checks passed. Five affected existing
browser cases passed against synthetic fixtures using the exact container-built
assets: overview text/link absence, desktop/tablet row navigation and keyboard
guards, report-header return navigation, and report neighbors/history/reload.
The tablet screenshot was reviewed for readability and clipping. Temporary
synthetic preview was stopped after verification.

## Simplify HRV and Trends labels and controls — 30 October 2026

Renamed the graph's Vendor HRV display to HRV in `src/care/report-graphs.tsx`,
including the panel heading, series name, tooltip and accessible chart label.
Removed vendor wording from the graph movement note, breathing-history note and
tooltip. In `src/care/trends.tsx`, metric display labels omit the Vendor prefix
and capitalize their first letter; selector, heading, table and chart reuse those
display labels. API metadata, metric keys, source definitions and values remain
unchanged. Removed Refresh trends and the page-level Overview/Back to asset
links above the Trends heading.

Formatting, diff checks and the production container build/typecheck passed.
Local Admin was rebuilt/restarted healthy; health, SPA/deep-link, authentication
boundaries, served-image hashes and HRV display checks passed. Five affected
existing browser cases passed against synthetic fixtures using the exact final
container assets. Checks cover HRV and metric naming, removed Trends controls,
desktop row/header navigation and cross-subject isolation. Reviewed HRV tablet
and Trends desktop captures for correct text and contained layout. Temporary
synthetic preview was stopped after verification.
