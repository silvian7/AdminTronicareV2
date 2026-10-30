# Caregiver portal implementation

Scope: prompts 1–6 in prompts/caregiver_portal.txt, completed without running the
optional deployment prompt. Those stages performed no live application API/DB
operation, migration, vendor request, ingestion job or commit. The user subsequently
authorized the local Admin rebuild and isolated local caregiver API/database setup
recorded below. These follow-ups did not deploy or migrate a shared backend.
The later explicitly requested VPS5 report access used read-only transactions;
its connection and prerequisite checks are recorded at the end of this note.
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
