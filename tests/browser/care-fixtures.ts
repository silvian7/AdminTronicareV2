/** Labelled synthetic caregiver data. Every API request is intercepted locally. */
import type { BrowserContext, Page, Route } from "@playwright/test";
import type {
  CareReport,
  CareReportDetail,
  CareSeries,
  CareSubject,
  CareTrends,
} from "../../shared/care";
import type { OrganizationMembership } from "../../shared/resources";
import type { SessionInfo } from "../../src/api";
import canonicalFixture from "./fixtures/care-report.synthetic.json" with { type: "json" };

/** DTOs generated through the actual Core CarePortal HTTP handlers. */
const canonical = canonicalFixture as unknown as {
  label: string;
  report: CareReportDetail;
  series: CareSeries;
};
export const syntheticCarePeriod = canonical.report.period;
const dayMilliseconds = 86_400_000;
export const syntheticCareOrganizationTag = (organizationId: string) =>
  `SYNTHETIC-ORGANIZATION-${organizationId}`;
const shiftTime = (value: string, offset: number) =>
  new Date(Date.parse(value) + offset).toISOString();

function shiftedReport(
  subjectId: string,
  id: string,
  offset: number,
): CareReportDetail {
  const report = structuredClone(canonical.report);
  report.id = id;
  report.subjectId = subjectId;
  report.period.start = shiftTime(report.period.start, offset);
  report.period.endExclusive = shiftTime(report.period.endExclusive, offset);
  report.period.reportDate = report.period.start.slice(0, 10);
  for (const key of ["ingestedAt", "parsedAt", "vendorUpdatedAt"] as const) {
    const value = report.provenance[key];
    if (value) report.provenance[key] = shiftTime(value, offset);
  }
  return report;
}

export function syntheticCareReport(
  subjectId: string,
  index = 0,
): CareReportDetail {
  return shiftedReport(
    subjectId,
    (9223372036854775500n + BigInt(index)).toString(),
    0,
  );
}

export function syntheticCareSeries(report: CareReport): CareSeries {
  const series = structuredClone(canonical.series);
  const offset =
    Date.parse(report.period.start) - Date.parse(canonical.report.period.start);
  series.subjectId = report.subjectId;
  series.reportId = report.id;
  series.period = structuredClone(report.period);
  series.range = {
    start: report.period.start,
    endExclusive: report.period.endExclusive,
  };
  for (const point of [
    ...series.points,
    ...series.hrv,
    ...series.temperature,
  ]) {
    point.at = shiftTime(point.at, offset);
    point.endExclusive = shiftTime(point.endExclusive, offset);
  }
  for (const interval of series.bedPresence) {
    interval.start = shiftTime(interval.start, offset);
    interval.endExclusive = shiftTime(interval.endExclusive, offset);
  }
  return series;
}

export function syntheticCareSubjects(count = 24): CareSubject[] {
  return Array.from({ length: count }, (_, index) => {
    const id = (9223372036854775806n - BigInt(index)).toString();
    const summary: CareReport | null =
      index % 2 === 0 ? syntheticCareReport(id, index) : null;
    return {
      id,
      organizationId: "1",
      tag: `SYNTHETIC-ASSET-${String(index + 1).padStart(2, "0")}`,
      label: `Labelled synthetic asset ${String(index + 1).padStart(2, "0")}`,
      bed: {
        state: "unknown",
        lastObservedState:
          index % 3 === 0
            ? "in_bed"
            : index % 3 === 1
              ? "out_of_bed"
              : "unknown",
        observedAt: index % 3 === 2 ? null : "2026-10-29T07:15:00.000Z",
        freshness: "unassessed",
      },
      latestReport: summary,
    };
  });
}

export function syntheticCareSession(caregiver = true): SessionInfo {
  return {
    identity: {
      id: "9223372036854775600",
      name: caregiver
        ? "Synthetic caregiver"
        : "Synthetic platform administrator",
      organizationId: "1",
      userTypeId: caregiver ? "30" : "90",
      level: caregiver ? 30 : 90,
      mustChangePassword: false,
      caregiverReadOnly: caregiver,
      permissions: [
        { entity: "assets", rights: "r" },
        { entity: "sensors", rights: "r" },
      ],
    },
    csrf: "synthetic-care-csrf",
    expiresAt: Date.now() + 3_600_000,
    activeOrganizationId: caregiver ? "1" : null,
    services: {
      assets: { configured: true, writable: !caregiver },
      core: { configured: true, writable: !caregiver },
    },
  };
}

export interface CareApiCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}
export interface CareFixturesOptions {
  authenticated?: boolean;
  caregiver?: boolean;
  subjects?: CareSubject[];
  reportsAvailable?: boolean;
  reportAccess?: "allowed" | "denied";
  withTrends?: boolean;
  memberships?: OrganizationMembership[];
}

export function syntheticCareTrends(
  subjectId: string,
  reports: CareReportDetail[],
  startDate: string,
  endDate: string,
): CareTrends {
  const dates: string[] = [];
  for (
    let at = Date.parse(startDate);
    at <= Date.parse(endDate);
    at += dayMilliseconds
  ) {
    dates.push(new Date(at).toISOString().slice(0, 10));
  }
  const point = (report: CareReportDetail) => ({
    reportId: report.id,
    period: structuredClone(report.period),
    value:
      report.metrics.find((metric) => metric.key === "ahi_count")?.value ??
      null,
  });
  const primary = reports
    .filter((report) =>
      ["2026-09-30", "2026-10-25", "2026-10-26", "2026-10-27"].includes(
        report.period.reportDate,
      ),
    )
    .sort((a, b) => a.period.start.localeCompare(b.period.start));
  const secondary = reports
    .filter((report) =>
      ["2026-09-01", "2026-09-20"].includes(report.period.reportDate),
    )
    .sort((a, b) => a.period.start.localeCompare(b.period.start));
  const groups = [primary, secondary]
    .filter((group) => group.length)
    .map((group) => {
      const anchor = group[group.length - 1];
      return {
        anchorReportId: anchor.id,
        startExclusive: shiftTime(anchor.period.start, -28 * dayMilliseconds),
        endInclusive: anchor.period.start,
        points: group.map(point),
      };
    });
  return {
    subjectId,
    startDate,
    endDate,
    timezone: "UTC",
    days: dates.map((date) => {
      const report = reports.find((entry) => entry.period.reportDate === date);
      return report
        ? {
            date,
            status: "available" as const,
            report: structuredClone(report),
          }
        : {
            date,
            status:
              subjectId === canonical.report.subjectId && date === "2026-10-28"
                ? ("incomplete" as const)
                : ("unavailable" as const),
            report: null,
          };
    }),
    breathHistory: {
      source: "daily_report.ahi_count",
      unit: "events/report",
      windowDays: 28,
      cutoff: "exclusive",
      limited: false,
      groups,
    },
  };
}

export async function installCareFixtures(
  surface: Page | BrowserContext,
  options: CareFixturesOptions = {},
) {
  const subjects = structuredClone(options.subjects ?? syntheticCareSubjects());
  const session = syntheticCareSession(options.caregiver ?? true);
  if (options.memberships)
    session.organizationMemberships = structuredClone(options.memberships);
  let authenticated = options.authenticated ?? true;
  const calls: CareApiCall[] = [];
  const unexpected: string[] = [];
  const deniedSubjects = new Set<string>();
  const deniedReports = new Set<string>();
  const histories = new Map<string, CareReportDetail[]>();
  for (const subject of subjects) {
    const latest = subject.latestReport;
    if (!latest) {
      histories.set(subject.id, []);
      continue;
    }
    const reports = [
      {
        ...structuredClone(latest),
        provenance: structuredClone(canonical.report.provenance),
        availableSignals: [...canonical.report.availableSignals],
      },
    ];
    if (
      subject.id === canonical.report.subjectId &&
      latest.id === canonical.report.id
    ) {
      for (const days of [1, 2]) {
        reports.push(
          shiftedReport(
            subject.id,
            (BigInt(latest.id) - BigInt(days)).toString(),
            -days * dayMilliseconds,
          ),
        );
      }
      if (options.withTrends) {
        for (const days of [27, 37, 56]) {
          reports.push(
            shiftedReport(
              subject.id,
              (BigInt(latest.id) - BigInt(days)).toString(),
              -days * dayMilliseconds,
            ),
          );
        }
      }
    }
    histories.set(subject.id, reports);
  }
  const overrides = new Map<string, { status: number; body: unknown }>();
  const reply = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  const reportsAvailable = options.reportsAvailable ?? true;
  const reportAccess = options.reportAccess ?? "allowed";
  const detail = (
    subject: CareSubject,
    reportId: string,
  ): CareReportDetail | undefined => {
    if (deniedReports.has(reportId)) return undefined;
    return histories.get(subject.id)?.find((report) => report.id === reportId);
  };

  await surface.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    calls.push({
      method,
      path,
      query: url.searchParams,
      body: request.postData() ? request.postDataJSON() : undefined,
    });
    const overridden = overrides.get(`${method} ${path}`);
    if (overridden) return reply(route, overridden.body, overridden.status);
    if (path === "/api/session/login" && method === "POST") {
      authenticated = true;
      return reply(route, session);
    }
    if (path === "/api/session/logout" && method === "POST") {
      authenticated = false;
      return reply(route, { success: true });
    }
    if (path === "/api/session")
      return reply(
        route,
        authenticated ? session : { message: "Synthetic sign-in required." },
        authenticated ? 200 : 401,
      );
    if (!authenticated)
      return reply(route, { message: "Synthetic sign-in required." }, 401);
    if (path === "/api/session/organizations" && method === "GET")
      return reply(route, { data: session.organizationMemberships ?? [] });
    if (
      path === "/api/session/organization-tags" &&
      method === "GET" &&
      url.search === ""
    ) {
      const organizationIds = [
        session.identity.organizationId,
        ...(session.organizationMemberships ?? [])
          .filter((membership) => membership.active)
          .map((membership) => membership.organizationId),
      ].filter(
        (id) =>
          /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n,
      );
      return reply(route, {
        organizations: [...new Set(organizationIds)].map((organizationId) => ({
          organizationId,
          tag: syntheticCareOrganizationTag(organizationId),
        })),
      });
    }
    if (path === "/api/session/organization" && method === "POST") {
      const organizationId = request.postDataJSON().organizationId;
      const membership = session.organizationMemberships?.find(
        (entry) => entry.active && entry.organizationId === organizationId,
      );
      if (!membership)
        return reply(
          route,
          { message: "Synthetic organization is unavailable." },
          403,
        );
      session.identity.organizationId = organizationId;
      session.identity.userTypeId = membership.userTypeId;
      session.activeOrganizationId = organizationId;
      session.csrf = `synthetic-care-csrf-${organizationId}`;
      return reply(route, session);
    }

    if (path === "/api/care/subjects" && method === "GET") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const page = Number(url.searchParams.get("page") ?? 1);
      const size = Number(url.searchParams.get("size") ?? 20);
      const organization = url.searchParams.get("organization");
      const selected = subjects.filter(
        (subject) =>
          `${subject.tag} ${subject.label}`.toLowerCase().includes(q) &&
          (!organization || subject.organizationId === organization) &&
          (!session.identity.caregiverReadOnly ||
            subject.organizationId === session.identity.organizationId),
      );
      return reply(route, {
        data: selected.slice((page - 1) * size, page * size),
        page,
        size,
        total: selected.length,
        reportsAvailable,
        reportAccess,
        limited: false,
      });
    }
    const subjectPath = path.match(/^\/api\/care\/subjects\/(\d+)(.*)$/);
    if (subjectPath && method === "GET") {
      const [, subjectId, suffix] = subjectPath;
      const subject = subjects.find((candidate) => candidate.id === subjectId);
      if (
        !subject ||
        deniedSubjects.has(subjectId) ||
        (session.identity.caregiverReadOnly &&
          subject.organizationId !== session.identity.organizationId)
      )
        return reply(route, { message: "Synthetic asset not found." }, 404);
      if (!suffix)
        return reply(route, { data: subject, reportsAvailable, reportAccess });
      if (suffix === "/reports") {
        const startDate = url.searchParams.get("startDate");
        const endDate = url.searchParams.get("endDate");
        const reports = (histories.get(subjectId) ?? []).filter(
          (report) =>
            !deniedReports.has(report.id) &&
            (!startDate || report.period.reportDate >= startDate) &&
            (!endDate || report.period.reportDate <= endDate),
        );
        return reply(route, {
          data: reports,
          reportsAvailable,
          limited: false,
          availability: {
            status: reports.length ? "available" : "no_eligible_reports",
            reason: reports.length
              ? null
              : "No proven synthetic report binding.",
          },
        });
      }
      const reportPath = suffix.match(/^\/reports\/(\d+)(\/series)?$/);
      if (reportPath) {
        const report = detail(subject, reportPath[1]);
        if (!report)
          return reply(route, { message: "Synthetic report not found." }, 404);
        if (!reportPath[2]) return reply(route, { data: report });
        const series = syntheticCareSeries(report);
        const start = url.searchParams.get("start") ?? series.range.start;
        const end = url.searchParams.get("end") ?? series.range.endExclusive;
        const left = Date.parse(start),
          right = Date.parse(end);
        if (
          !Number.isFinite(left) ||
          !Number.isFinite(right) ||
          left >= right
        ) {
          return reply(
            route,
            { message: "Synthetic requested range unavailable." },
            422,
          );
        }
        series.range = { start, endExclusive: end };
        series.points = series.points.filter(
          (point) =>
            Date.parse(point.at) < right &&
            Date.parse(point.endExclusive) > left,
        );
        series.hrv = series.hrv.filter(
          (point) =>
            Date.parse(point.at) < right &&
            Date.parse(point.endExclusive) > left,
        );
        series.temperature = series.temperature.filter(
          (point) =>
            Date.parse(point.at) < right &&
            Date.parse(point.endExclusive) > left,
        );
        series.bedPresence = series.bedPresence
          .filter(
            (interval) =>
              Date.parse(interval.start) < right &&
              Date.parse(interval.endExclusive) > left,
          )
          .map((interval) => ({
            ...interval,
            start: new Date(
              Math.max(left, Date.parse(interval.start)),
            ).toISOString(),
            endExclusive: new Date(
              Math.min(right, Date.parse(interval.endExclusive)),
            ).toISOString(),
          }));
        return reply(route, { data: series });
      }
      if (suffix === "/trends") {
        const end = url.searchParams.get("endDate") ?? "2026-10-29";
        const days = Number(url.searchParams.get("days") ?? 7);
        const start =
          url.searchParams.get("startDate") ??
          shiftTime(
            `${end}T00:00:00.000Z`,
            -(days - 1) * dayMilliseconds,
          ).slice(0, 10);
        const duration = Date.parse(end) - Date.parse(start);
        if (
          !Number.isFinite(duration) ||
          duration < 0 ||
          duration > 30 * dayMilliseconds ||
          (!url.searchParams.has("startDate") && ![7, 30].includes(days))
        ) {
          return reply(
            route,
            { message: "Synthetic trend range is unavailable." },
            400,
          );
        }
        return reply(route, {
          data: syntheticCareTrends(
            subjectId,
            histories.get(subjectId) ?? [],
            start,
            end,
          ),
        });
      }
    }
    // Normal administrator surfaces can be checked without permitting a real API.
    if (
      !session.identity.caregiverReadOnly &&
      method === "GET" &&
      path.startsWith("/api/resources/")
    ) {
      return reply(route, { data: [], total: 0 });
    }
    unexpected.push(`${method} ${path}`);
    return reply(route, { message: "Unexpected synthetic API request." }, 501);
  });
  return {
    subjects,
    session,
    calls,
    unexpected,
    deniedSubjects,
    deniedReports,
    histories,
    override(method: string, path: string, body: unknown, status = 200) {
      overrides.set(`${method} ${path}`, { body, status });
    },
    clearOverride(method: string, path: string) {
      overrides.delete(`${method} ${path}`);
    },
  };
}
