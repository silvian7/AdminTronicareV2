import { expect, test, type Locator, type Page } from "@playwright/test";
import type { CareReportDetail, CareSeries } from "../../shared/care";
import {
  installCareFixtures,
  syntheticCareSeries,
  syntheticCareTrends,
} from "./care-fixtures";

test.use({ timezoneId: "America/New_York" });

const fourPanels =
  "Bed presence, heart rate, respiration, movement and Vendor HRV over time";
const fivePanels =
  "Bed presence, heart rate, respiration, movement and Vendor HRV over time";
const graphRegion = (page: Page) =>
  page.getByRole("region", { name: "Report graphs", exact: true });

async function visibleBounds(graphs: Locator) {
  return graphs
    .getByRole("status", { name: "Visible range", exact: true })
    .locator("time")
    .evaluateAll((times) =>
      times.map((time) => Date.parse(time.getAttribute("datetime")!)),
    );
}

/** Hold only this synthetic response; all other API routes stay locally mocked. */
async function holdResponse(page: Page, path: string, body: unknown) {
  let arrive!: () => void, release!: () => void, finish!: () => void;
  const arrived = new Promise<void>((resolve) => (arrive = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const finished = new Promise<void>((resolve) => (finish = resolve));
  await page.route(`**${path}*`, async (route) => {
    if (new URL(route.request().url()).pathname !== path)
      return route.fallback();
    arrive();
    await gate;
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    } catch {
      // Session cleanup may have already aborted this obsolete request.
    } finally {
      finish();
    }
  });
  return { arrived, finished, release };
}

for (const kind of ["report", "trends"] as const) {
  test(`logout prevents a late pending ${kind} response from restoring protected content`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-10-29T12:00:00Z"));
    const fixture = await installCareFixtures(page, { withTrends: true });
    const subject = fixture.subjects[0],
      report = fixture.histories.get(subject.id)![0];
    const path =
      kind === "report"
        ? `/api/care/subjects/${subject.id}/reports/${report.id}`
        : `/api/care/subjects/${subject.id}/trends`;
    const body = {
      data:
        kind === "report"
          ? report
          : syntheticCareTrends(
              subject.id,
              fixture.histories.get(subject.id)!,
              "2026-10-23",
              "2026-10-29",
            ),
    };
    const held = await holdResponse(page, path, body);
    try {
      await page.goto(
        kind === "report"
          ? `/care/subjects/${subject.id}/reports/${report.id}`
          : `/care/subjects/${subject.id}/trends`,
      );
      await held.arrived;
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      held.release();
      await held.finished;
      await expect(page.getByLabel("Login", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Reporting period", exact: true }),
      ).toHaveCount(0);
      await expect(page.getByRole("img", { name: fourPanels })).toHaveCount(0);
      await expect(
        page.getByRole("img", { name: "Daily report trend", exact: true }),
      ).toHaveCount(0);
      expect(
        fixture.calls.filter((call) => call.path.endsWith("/series")),
      ).toHaveLength(0);
      expect(
        fixture.calls
          .filter((call) => call.method !== "GET")
          .map((call) => call.path),
      ).toEqual(["/api/session/logout"]);
      expect(fixture.unexpected).toEqual([]);
    } finally {
      held.release();
    }
  });
}

test("Brussels DST labels distinguish repeated local times while UTC report boundaries remain exact", async ({
  page,
}, testInfo) => {
  const fixture = await installCareFixtures(page);
  const subject = fixture.subjects[0],
    report = structuredClone(fixture.histories.get(subject.id)![0]);
  // A synthetic short window covers both occurrences of the Brussels repeated hour.
  report.period = {
    start: "2026-10-25T00:30:00.000Z",
    endExclusive: "2026-10-25T01:31:00.000Z",
    reportDate: "2026-10-25",
    timezone: "UTC",
  };
  subject.latestReport = report;
  fixture.histories.set(subject.id, [report]);
  const series = syntheticCareSeries(report);
  series.points = ["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"].map(
    (at) => ({
      at,
      endExclusive: new Date(Date.parse(at) + 60_000).toISOString(),
      heartRate: 60,
      breathRate: 12,
      movement: false,
    }),
  );
  series.bedPresence = [
    {
      start: report.period.start,
      endExclusive: report.period.endExclusive,
      state: "in_bed",
    },
  ];
  series.hrv = [];
  fixture.override(
    "GET",
    `/api/care/subjects/${subject.id}/reports/${report.id}/series`,
    {
      data: series,
    },
  );
  await page.goto(`/care/subjects/${subject.id}/reports/${report.id}`);
  const graphs = graphRegion(page);
  await expect(graphs.getByRole("img", { name: fourPanels })).toBeVisible();
  const visible = graphs.getByRole("status", {
    name: "Visible range",
    exact: true,
  });
  await expect(visible.locator("time").nth(0)).toContainText(
    /25\/10\/2026.*02:30:00.*CEST/,
  );
  await expect(visible.locator("time").nth(0)).toHaveAttribute(
    "datetime",
    report.period.start,
  );
  await expect(visible.locator("time").nth(1)).toContainText(
    /25\/10\/2026.*02:31:00.*CET/,
  );
  await expect(visible.locator("time").nth(1)).toHaveAttribute(
    "datetime",
    report.period.endExclusive,
  );
  const seriesReads = fixture.calls.filter((call) =>
    call.path.endsWith("/series"),
  ).length;
  await graphs.getByRole("button", { name: "Zoom in", exact: true }).click();
  await graphs.getByRole("button", { name: "Reset view", exact: true }).click();
  expect(
    fixture.calls.filter((call) => call.path.endsWith("/series")),
  ).toHaveLength(seriesReads);
  await expect
    .poll(() => visibleBounds(graphs))
    .toEqual([
      Date.parse(report.period.start),
      Date.parse(report.period.endExclusive),
    ]);
  await expect(
    graphs.getByRole("heading", { name: /^Vendor HRV/ }),
  ).toContainText("Not available");
  await expect(page).toHaveURL(new RegExp(`/reports/${report.id}$`));
  await page.reload();
  await expect(graphs.getByRole("img", { name: fourPanels })).toBeVisible();
  await expect
    .poll(() => visibleBounds(graphs))
    .toEqual([
      Date.parse(report.period.start),
      Date.parse(report.period.endExclusive),
    ]);
  for (const call of fixture.calls.filter((call) =>
    call.path.endsWith("/series"),
  )) {
    expect(call.query.has("start")).toBe(false);
    expect(call.query.has("end")).toBe(false);
    expect(call.query.has("maxPoints")).toBe(false);
  }
  await graphs.screenshot({
    path: testInfo.outputPath("care-brussels-dst.png"),
  });
  expect(fixture.unexpected).toEqual([]);
});

/** Maximum-size labelled synthetic DTO, not a claim about source sample density. */
function maximumSeries(report: CareReportDetail): CareSeries {
  const data = syntheticCareSeries(report),
    start = Date.parse(report.period.start),
    end = Date.parse(report.period.endExclusive),
    step = (end - start) / 5000;
  data.sampling = { intervalSeconds: null, limited: true };
  data.points = Array.from({ length: 5000 }, (_, index) => ({
    at: new Date(start + index * step).toISOString(),
    endExclusive: new Date(start + (index + 1) * step).toISOString(),
    heartRate: index % 29 === 0 ? null : 60 + (index % 10),
    breathRate: index % 31 === 0 ? null : 12 + (index % 3),
    movement: index % 37 === 0 ? null : index % 3 === 0,
  }));
  data.bedPresence = data.points.map((point, index) => ({
    start: point.at,
    endExclusive: point.endExclusive,
    state: (["in_bed", "out_of_bed", "unknown"] as const)[index % 3],
  }));
  data.hrv = Array.from({ length: 288 }, (_, index) => ({
    at: new Date(start + index * 300_000).toISOString(),
    endExclusive: new Date(start + (index + 1) * 300_000).toISOString(),
    value: index === 0 ? 0 : index % 17 === 0 ? null : 42,
  }));
  return data;
}

test("maximum bounded series remains operable with 5000 points, 5000 intervals and 288 HRV bins on a tablet", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 768, height: 1024 });
  const fixture = await installCareFixtures(page);
  const subject = fixture.subjects[0],
    report = fixture.histories.get(subject.id)![0],
    data = maximumSeries(report);
  const body = { data },
    responseBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  expect(responseBytes).toBeLessThanOrEqual(24 * 1024 * 1024);
  testInfo.annotations.push({
    type: "synthetic-response-bytes",
    description: `maximum-series=${responseBytes}`,
  });
  await testInfo.attach("maximum-series-size.json", {
    body: JSON.stringify({ utf8Bytes: responseBytes }),
    contentType: "application/json",
  });
  fixture.override(
    "GET",
    `/api/care/subjects/${subject.id}/reports/${report.id}/series`,
    body,
  );
  await page.goto(`/care/subjects/${subject.id}/reports/${report.id}`);
  const graphs = graphRegion(page);
  await expect(graphs.getByRole("img", { name: fourPanels })).toBeVisible();
  await expect(graphs.getByText(/5000 retained samples/)).toBeVisible();
  await expect(
    graphs.getByText("Reduced sample set", { exact: true }),
  ).toBeVisible();
  const initialSeriesReads = fixture.calls.filter((call) =>
    call.path.endsWith("/series"),
  );
  expect(initialSeriesReads).toHaveLength(1);
  for (const key of ["start", "end", "maxPoints"])
    expect(initialSeriesReads[0].query.has(key)).toBe(false);
  await expect(graphs.getByRole("img", { name: fourPanels })).toBeVisible();
  await expect(graphs.getByRole("img", { name: fivePanels })).toBeVisible();
  const fullBounds = await visibleBounds(graphs);
  await graphs.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect.poll(() => visibleBounds(graphs)).not.toEqual(fullBounds);
  await graphs.getByRole("button", { name: "Pan later", exact: true }).click();
  for (const name of ["Sample values", "Vendor HRV sample values", "Bed exits"])
    await expect(graphs.getByRole("region", { name, exact: true })).toHaveCount(
      0,
    );
  await expect(
    graphs.getByRole("heading", { name: /^Vendor HRV/ }),
  ).toBeVisible();
  await graphs.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect.poll(() => visibleBounds(graphs)).toEqual(fullBounds);
  expect(
    fixture.calls.filter((call) => call.path.endsWith("/series")),
  ).toHaveLength(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
  ).toBe(false);
  await graphs.locator(".care-graph-figure").screenshot({
    path: testInfo.outputPath("care-maximum-series-tablet.png"),
  });
  expect(errors).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

function reportOnDate(source: CareReportDetail, date: string, index: number) {
  const report = structuredClone(source);
  report.id = (9223372036854775400n + BigInt(index)).toString();
  report.period = {
    start: `${date}T05:00:00.000Z`,
    endExclusive: new Date(
      Date.parse(`${date}T05:00:00.000Z`) + 86_400_000,
    ).toISOString(),
    timezone: "UTC",
    reportDate: date,
  };
  return report;
}

test("31 daily reports stay bounded and their final keyboard link opens the exact stored identity", async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-10-29T12:00:00Z"));
  const fixture = await installCareFixtures(page),
    subject = fixture.subjects[0],
    source = fixture.histories.get(subject.id)![0];
  const reports = Array.from({ length: 31 }, (_, index) =>
    reportOnDate(
      source,
      new Date(Date.parse("2026-09-28") + index * 86_400_000)
        .toISOString()
        .slice(0, 10),
      index,
    ),
  );
  subject.latestReport = reports[30];
  fixture.histories.set(subject.id, [...reports].reverse());
  const body = {
      data: syntheticCareTrends(
        subject.id,
        fixture.histories.get(subject.id)!,
        "2026-09-28",
        "2026-10-28",
      ),
    },
    responseBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  expect(responseBytes).toBeLessThanOrEqual(24 * 1024 * 1024);
  testInfo.annotations.push({
    type: "synthetic-response-bytes",
    description: `31-day-trends=${responseBytes}`,
  });
  await testInfo.attach("31-day-trends-size.json", {
    body: JSON.stringify({ utf8Bytes: responseBytes }),
    contentType: "application/json",
  });
  fixture.override("GET", `/api/care/subjects/${subject.id}/trends`, body);
  await page.goto(
    `/care/subjects/${subject.id}/trends?startDate=2026-09-28&endDate=2026-10-28`,
  );
  await expect(
    page.getByRole("img", { name: "Daily report trend", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".care-trend-data").getByRole("row")).toHaveCount(
    32,
  );
  const before = fixture.calls.filter((call) =>
    call.path.endsWith("/trends"),
  ).length;
  expect(before).toBe(1);
  await page
    .getByLabel("Custom start date", { exact: true })
    .fill("2026-09-27");
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(
    page.getByText(
      "Choose at most 31 dates, with the end on or after the start.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    fixture.calls.filter((call) => call.path.endsWith("/trends")),
  ).toHaveLength(before);
  const link = page.getByRole("link", {
    name: "Open report for 28/10/2026",
    exact: true,
  });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/reports/${reports[30].id}$`));
  await expect(
    page.getByRole("heading", { name: "Reporting period", exact: true }),
  ).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});

for (const field of ["points", "bedPresence"] as const) {
  test(`5001 ${field} are rejected without drawing a partial report`, async ({
    page,
  }) => {
    const fixture = await installCareFixtures(page),
      subject = fixture.subjects[0],
      report = fixture.histories.get(subject.id)![0],
      data = maximumSeries(report);
    if (field === "points")
      data.points.push(structuredClone(data.points[4999]));
    else data.bedPresence.push(structuredClone(data.bedPresence[4999]));
    fixture.override(
      "GET",
      `/api/care/subjects/${subject.id}/reports/${report.id}/series`,
      { data },
    );
    await page.goto(`/care/subjects/${subject.id}/reports/${report.id}`);
    const graphs = graphRegion(page);
    await expect(
      graphs.getByText("Graphs unavailable", { exact: true }),
    ).toBeVisible();
    await expect(graphs.getByRole("img", { name: fourPanels })).toHaveCount(0);
    await expect(
      graphs.getByRole("checkbox", { name: "Show Vendor HRV", exact: true }),
    ).toHaveCount(0);
    expect(fixture.unexpected).toEqual([]);
  });
}
