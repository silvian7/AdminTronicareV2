import { expect, test, type Locator, type Page } from "@playwright/test";
import type { CareReport } from "../../shared/care";
import { formatDisplayDateTime } from "../../shared/date-time";
import {
  installCareFixtures,
  syntheticCareSeries,
  zoomCareGraph,
  panCareGraph,
  resetCareGraph,
} from "./care-fixtures";

test.use({ timezoneId: "America/New_York" });
const chartName =
  "Bed presence, heart rate, HRV, respiration, movement and bed temperature over time";

async function openReport(page: Page) {
  const fixture = await installCareFixtures(page);
  const subject = fixture.subjects[0];
  const reports = fixture.histories.get(subject.id)!;
  const report = reports[0];
  await page.goto(`/care/subjects/${subject.id}/reports/${report.id}`);
  const graphs = page.getByRole("region", {
    name: "Report graphs",
    exact: true,
  });
  await expect(graphs.getByRole("img", { name: chartName })).toBeVisible();
  return { fixture, subject, reports, report, graphs };
}

async function bounds(graphs: Locator) {
  return graphs
    .getByRole("status", { name: "Visible range", exact: true })
    .locator("time")
    .evaluateAll((times) =>
      times.map((time) => Date.parse(time.getAttribute("datetime")!)),
    );
}

function bedTemperatureSeries(report: CareReport) {
  const source = syntheticCareSeries(report);
  const middle =
    (Date.parse(report.period.start) + Date.parse(report.period.endExclusive)) /
    2;
  const at = (minutes: number) =>
    new Date(middle + minutes * 60_000).toISOString();
  return {
    ...source,
    temperatureDefinition: {
      source: "stored_bedtemp_max" as const,
      unit: "°C" as const,
      gapThresholdSeconds: 120,
      availability: "available" as const,
    },
    temperatureStreams: [
      {
        id: "9223372036854775807",
        label: "Bed temperature 1",
        points: [
          { at: at(-15), value: 31.4 },
          { at: at(-14), value: 31.8 },
          { at: at(90), value: 32.6 },
          { at: at(91), value: null },
          { at: at(92), value: 33.1 },
        ],
      },
      {
        id: "9223372036854775806",
        label: "Bed temperature 2",
        points: [
          { at: at(-5), value: 29.4 },
          { at: at(40), value: 29.5 },
        ],
      },
    ],
  };
}

/** Observe text actually painted by the rich-text canvas tooltip. */
async function captureCanvasText(page: Page) {
  await page.addInitScript(() => {
    const state = window as typeof window & { syntheticPaintedText?: string[] };
    state.syntheticPaintedText = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      value: string,
      x: number,
      y: number,
      maximum?: number,
    ) {
      state.syntheticPaintedText!.push(String(value));
      if (state.syntheticPaintedText!.length > 2000)
        state.syntheticPaintedText!.shift();
      if (maximum === undefined) original.call(this, value, x, y);
      else original.call(this, value, x, y, maximum);
    };
  });
}

async function paintedText(page: Page) {
  return page.evaluate(() =>
    (
      (window as typeof window & { syntheticPaintedText?: string[] })
        .syntheticPaintedText ?? []
    )
      .join(" ")
      .replace(/\s+/g, " "),
  );
}

async function hoverTemperatureMiddle(page: Page, graphs: Locator) {
  const title = graphs.getByRole("heading", { name: /^Bed temperature/ });
  await title.scrollIntoViewIfNeeded();
  const heading = await title.boundingBox();
  const chart = await graphs.locator(".care-report-chart").boundingBox();
  if (!heading || !chart)
    throw new Error("Synthetic temperature graph is unavailable.");
  await page.evaluate(() => {
    (
      window as typeof window & { syntheticPaintedText?: string[] }
    ).syntheticPaintedText = [];
  });
  await page.mouse.move(chart.x + 54 + (chart.width - 74) / 2, heading.y + 90);
}

test("stored BedTempMax streams render a sixth canvas panel with actual sample times and shared native zoom", async ({
  page,
}, testInfo) => {
  await captureCanvasText(page);
  const fixture = await installCareFixtures(page);
  const subject = fixture.subjects[0],
    report = fixture.histories.get(subject.id)![0];
  const series = bedTemperatureSeries(report);
  fixture.override(
    "GET",
    `/api/care/subjects/${subject.id}/reports/${report.id}/series`,
    { data: series },
  );
  await page.goto(`/care/subjects/${subject.id}/reports/${report.id}`);
  const graphs = page.getByRole("region", {
    name: "Report graphs",
    exact: true,
  });
  await expect(
    graphs.getByRole("img", { name: chartName, exact: true }),
  ).toBeVisible();
  await expect(graphs.locator(".care-graph-panel-title")).toHaveCount(6);
  await expect(
    graphs.getByRole("heading", { name: /^Bed temperature/ }),
  ).toContainText("°C");
  await expect(graphs.locator("canvas").first()).toBeVisible();
  const reads = fixture.calls.length;
  const full = await bounds(graphs);
  await hoverTemperatureMiddle(page, graphs);
  await expect
    .poll(() => paintedText(page))
    .toContain("Nearest bed temperature sample; not a reading at the cursor.");
  await expect.poll(() => paintedText(page)).toContain("31.8 °C");
  await expect.poll(() => paintedText(page)).toContain("29.4 °C");
  const expectedTime = formatDisplayDateTime(
    series.temperatureStreams[0].points[1].at,
    { timeZoneName: "shortOffset" },
  );
  await expect.poll(() => paintedText(page)).toContain(expectedTime);
  expect(await paintedText(page)).not.toContain(
    series.temperatureStreams[0].id,
  );
  expect(await bounds(graphs)).toEqual(full);
  await zoomCareGraph(page, graphs, "temperature");
  await expect.poll(() => bounds(graphs)).not.toEqual(full);
  await panCareGraph(page, graphs, "earlier");
  await resetCareGraph(page, graphs, full);
  expect(fixture.calls).toHaveLength(reads);
  expect(fixture.unexpected).toEqual([]);
  await graphs.screenshot({
    path: testInfo.outputPath("care-bed-temperature-streams.png"),
  });
});

for (const availability of [
  "legacy",
  "unavailable",
  "no_data",
  "limited",
] as const) {
  test(`${availability} temperature source preserves the other five report panels`, async ({
    page,
  }) => {
    const fixture = await installCareFixtures(page);
    const subject = fixture.subjects[0],
      report = fixture.histories.get(subject.id)![0];
    const base = syntheticCareSeries(report);
    const data =
      availability === "legacy"
        ? base
        : {
            ...base,
            temperatureDefinition: {
              source: "stored_bedtemp_max",
              unit: "°C",
              gapThresholdSeconds: 120,
              availability,
            },
            temperatureStreams: [],
          };
    fixture.override(
      "GET",
      `/api/care/subjects/${subject.id}/reports/${report.id}/series`,
      { data },
    );
    await page.goto(`/care/subjects/${subject.id}/reports/${report.id}`);
    const graphs = page.getByRole("region", {
      name: "Report graphs",
      exact: true,
    });
    await expect(
      graphs.getByRole("img", { name: chartName, exact: true }),
    ).toBeVisible();
    for (const title of [
      "Bed presence",
      "Heart rate",
      "Respiration",
      "Movement",
      "HRV",
    ])
      await expect(
        graphs.getByRole("heading", { name: new RegExp(`^${title}`) }),
      ).toBeVisible();
    await expect(
      graphs.getByRole("heading", { name: /^Bed temperature/ }),
    ).toContainText("Not available");
    await expect(graphs.locator(".care-graph-panel-title")).toHaveCount(6);
    expect(
      fixture.calls.filter((call) => call.path.endsWith("/series")),
    ).toHaveLength(1);
    expect(fixture.unexpected).toEqual([]);
  });
}

for (const width of [390, 768]) {
  test(`temperature panel remains contained and synchronized at ${width}px without refetching`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1024 });
    const fixture = await installCareFixtures(page);
    const subject = fixture.subjects[0],
      report = fixture.histories.get(subject.id)![0];
    fixture.override(
      "GET",
      `/api/care/subjects/${subject.id}/reports/${report.id}/series`,
      { data: bedTemperatureSeries(report) },
    );
    await page.goto(`/care/subjects/${subject.id}/reports/${report.id}`);
    const graphs = page.getByRole("region", {
      name: "Report graphs",
      exact: true,
    });
    await expect(
      graphs.getByRole("heading", { name: /^Bed temperature/ }),
    ).toContainText("°C");
    const reads = fixture.calls.length;
    const full = await bounds(graphs);
    await zoomCareGraph(page, graphs, "temperature");
    await expect.poll(() => bounds(graphs)).not.toEqual(full);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
    ).toBe(false);
    const panel = await graphs
      .getByRole("heading", { name: /^Bed temperature/ })
      .boundingBox();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(width + 1);
    expect(fixture.calls).toHaveLength(reads);
    expect(fixture.unexpected).toEqual([]);
    await graphs.screenshot({
      path: testInfo.outputPath(`care-bed-temperature-${width}.png`),
    });
  });
}

test("report neighbors, browser back/forward and reload retain explicit report identity", async ({
  page,
}) => {
  const { fixture, subject, reports } = await openReport(page);
  const address = (index: number) =>
    new RegExp(`/care/subjects/${subject.id}/reports/${reports[index].id}$`);
  await expect(
    page.getByRole("button", { name: /Next report$/ }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Previous report$/ }).click();
  await expect(page).toHaveURL(address(1));
  await page.getByRole("button", { name: /Previous report$/ }).click();
  await expect(page).toHaveURL(address(2));
  await expect(
    page.getByRole("button", { name: /Previous report$/ }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Next report$/ }).click();
  await expect(page).toHaveURL(address(1));
  await page
    .getByRole("button", { name: "Latest report", exact: true })
    .click();
  await expect(page).toHaveURL(address(0));
  await page.goBack();
  await expect(page).toHaveURL(address(1));
  await page.goForward();
  await expect(page).toHaveURL(address(0));
  await page.reload();
  await expect(page).toHaveURL(address(0));
  await expect(page.getByRole("img", { name: chartName })).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});

test("report selector and legacy dated links select stored history without replacing a missing day", async ({
  page,
}) => {
  const { fixture, subject, reports, graphs } = await openReport(page);
  const periodSelector = page.getByRole("combobox", {
    name: "Reporting period",
    exact: true,
  });
  await periodSelector.focus();
  await periodSelector.press("ArrowDown");
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({
      hasText: reports[1].period.reportDate.split("-").reverse().join("/"),
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`/reports/${reports[1].id}$`));
  await page.goto(
    `/care/subjects/${subject.id}?date=${reports[2].period.reportDate}`,
  );
  await expect(page).toHaveURL(
    new RegExp(`\\?date=${reports[2].period.reportDate}$`),
  );
  await expect
    .poll(() =>
      fixture.calls.some(
        (call) =>
          call.path === `/api/care/subjects/${subject.id}/reports` &&
          call.query.get("startDate") === reports[2].period.reportDate &&
          call.query.get("endDate") === reports[2].period.reportDate,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      fixture.calls.some(
        (call) =>
          call.path ===
          `/api/care/subjects/${subject.id}/reports/${reports[2].id}`,
      ),
    )
    .toBe(true);
  await expect
    .poll(() => bounds(graphs))
    .toEqual([
      Date.parse(reports[2].period.start),
      Date.parse(reports[2].period.endExclusive),
    ]);
  await expect(
    graphs
      .getByRole("status", { name: "Visible range", exact: true })
      .locator("time")
      .first(),
  ).toContainText(/25\/10\/2026.*06:00:00/);
  await page.reload();
  await expect(page).toHaveURL(
    new RegExp(`\\?date=${reports[2].period.reportDate}$`),
  );
  await expect
    .poll(() => bounds(graphs))
    .toEqual([
      Date.parse(reports[2].period.start),
      Date.parse(reports[2].period.endExclusive),
    ]);
  for (const call of fixture.calls.filter((call) =>
    call.path.endsWith("/series"),
  )) {
    expect(call.query.has("start")).toBe(false);
    expect(call.query.has("end")).toBe(false);
    expect(call.query.has("maxPoints")).toBe(false);
  }
  await page.goto(`/care/subjects/${subject.id}?date=2026-10-24`);
  await expect(page).toHaveURL(/\?date=2026-10-24$/);
  await expect(page.getByText(/No eligible completed report/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Report graphs", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Reporting period", exact: true }),
  ).toHaveCount(0);
  expect(fixture.unexpected).toEqual([]);
});

test("six coordinated panels remain visible while inspection and bed-exit sections are hidden", async ({
  page,
}) => {
  const { fixture, graphs } = await openReport(page);
  const panelTitles = [
    "Bed presence",
    "Heart rate",
    "HRV",
    "Respiration",
    "Movement",
    "Bed temperature",
  ];
  await expect(graphs.locator(".care-graph-panel-title")).toHaveText(
    panelTitles.map((title) => new RegExp(`^${title}`)),
  );
  for (const title of panelTitles) {
    await expect(
      graphs.getByRole("heading", { name: new RegExp(`^${title}`) }),
    ).toBeVisible();
  }
  for (const name of ["Sample values", "HRV sample values", "Bed exits"])
    await expect(graphs.getByRole("region", { name, exact: true })).toHaveCount(
      0,
    );
  await expect(graphs.getByRole("combobox", { name: /^Inspect/ })).toHaveCount(
    0,
  );
  await expect(graphs.getByRole("button", { name: /^Inspect/ })).toHaveCount(0);
  await expect(graphs.getByLabel(/^Range (start|end)/)).toHaveCount(0);
  await expect(
    graphs.getByRole("button", {
      name: /^(?:Load range|Full reporting period)$/,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Reporting period", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Report date", { exact: true })).toHaveCount(0);
  const main = page.getByRole("main");
  await expect(main.getByRole("button", { name: /Refresh$/ })).toHaveCount(0);
  await expect(
    page.getByRole("banner").getByRole("button", { name: /Refresh$/ }),
  ).toHaveCount(0);
  await expect(
    main.getByRole("link", { name: /Back to overview$/ }),
  ).toHaveCount(0);
  await expect(
    main.getByRole("link", { name: "Trends", exact: true }),
  ).toHaveCount(0);
  const navigation = page.getByRole("navigation", {
    name: "Caregiver navigation",
    exact: true,
  });
  for (const name of ["Overview", "Reports", "Trends"])
    await expect(
      navigation.getByRole("link", { name, exact: true }),
    ).toBeVisible();
  await expect(
    graphs.getByText("Unknown / missing", { exact: true }),
  ).toBeVisible();
  expect(fixture.calls.filter((call) => call.method !== "GET")).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test("zoom, pan and reset share one visible Brussels range without extra data reads", async ({
  page,
}) => {
  const { fixture, report, graphs } = await openReport(page);
  const start = Date.parse(report.period.start),
    end = Date.parse(report.period.endExclusive);
  const initialSeriesReads = fixture.calls.filter((call) =>
    call.path.endsWith("/series"),
  ).length;
  await expect.poll(() => bounds(graphs)).toEqual([start, end]);
  await zoomCareGraph(page, graphs);
  await expect
    .poll(async () => {
      const range = await bounds(graphs);
      return range[1] - range[0];
    })
    .toBeLessThan(end - start);
  const previous = await bounds(graphs);
  expect(previous[0]).toBeGreaterThan(start);
  expect(previous[1]).toBeLessThan(end);
  await panCareGraph(page, graphs, "earlier");
  await expect
    .poll(async () => (await bounds(graphs))[0])
    .toBeLessThan(previous[0]);
  const earlier = await bounds(graphs);
  await panCareGraph(page, graphs, "later");
  await expect
    .poll(async () => (await bounds(graphs))[0])
    .toBeGreaterThan(earlier[0]);
  expect(
    Math.abs(
      (await bounds(graphs))[1] -
        (await bounds(graphs))[0] -
        (previous[1] - previous[0]),
    ),
  ).toBeLessThanOrEqual(2);
  await resetCareGraph(page, graphs, [start, end]);
  await expect.poll(() => bounds(graphs)).toEqual([start, end]);
  expect(
    fixture.calls.filter((call) => call.path.endsWith("/series")),
  ).toHaveLength(initialSeriesReads);
  expect(fixture.unexpected).toEqual([]);
});

test("empty measurements remain unavailable without zero curves or invented exits", async ({
  page,
}) => {
  const fixture = await installCareFixtures(page);
  const subject = fixture.subjects[0],
    report = subject.latestReport!;
  const empty = syntheticCareSeries(report);
  empty.points = [];
  empty.bedPresence = [];
  empty.hrv = [];
  empty.temperature = [];
  fixture.override(
    "GET",
    `/api/care/subjects/${subject.id}/reports/${report.id}/series`,
    { data: empty },
  );
  await page.goto(`/care/subjects/${subject.id}/reports/${report.id}`);
  await expect(
    page.getByText("No observations are available in this range.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: chartName })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^HRV/ })).toContainText(
    "Not available",
  );
  await expect(
    page.getByRole("button", { name: /^Inspect bed exit at/ }),
  ).toHaveCount(0);
  expect(fixture.unexpected).toEqual([]);
});

test("series failure clears previous curves and permits explicit retry", async ({
  page,
}) => {
  const { fixture, subject, report, graphs } = await openReport(page);
  const path = `/api/care/subjects/${subject.id}/reports/${report.id}/series`;
  fixture.override(
    "GET",
    path,
    { message: "Synthetic report is too dense." },
    422,
  );
  await page.reload();
  await expect(
    page.getByText(
      "Graph data is unavailable for this report. Select another reporting period or retry.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(graphs.getByText(/narrower/i)).toHaveCount(0);
  await expect(graphs.getByRole("img", { name: chartName })).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Reporting period", exact: true }),
  ).toBeVisible();
  fixture.clearOverride("GET", path);
  await graphs
    .getByRole("button", { name: "Retry graphs", exact: true })
    .click();
  await expect(graphs.getByRole("img", { name: chartName })).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});

test("a different subject URL cannot retain the previous subject report or measurements", async ({
  page,
}) => {
  const { fixture } = await openReport(page);
  const target = fixture.subjects[1];
  fixture.deniedSubjects.add(target.id);
  await page
    .getByRole("navigation", { name: "Caregiver navigation", exact: true })
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  await page.getByRole("link", { name: target.tag, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/care/subjects/${target.id}$`));
  await expect(
    page.getByText("Synthetic asset not found.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Reporting period", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("img", { name: chartName })).toHaveCount(0);
  expect(fixture.unexpected).toEqual([]);
});

test("desktop and tablet graph layouts resize without clipping and preserve visible range", async ({
  page,
}, testInfo) => {
  const { fixture, graphs, report } = await openReport(page);
  await expect
    .poll(() => bounds(graphs))
    .toEqual([
      Date.parse(report.period.start),
      Date.parse(report.period.endExclusive),
    ]);
  await graphs.screenshot({
    path: testInfo.outputPath("care-report-full-period.png"),
  });
  await zoomCareGraph(page, graphs);
  const selected = await bounds(graphs);
  await graphs.scrollIntoViewIfNeeded();
  await graphs.screenshot({
    path: testInfo.outputPath("care-report-desktop.png"),
  });
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(graphs.getByRole("img", { name: chartName })).toBeVisible();
  await expect.poll(() => bounds(graphs)).toEqual(selected);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
  ).toBe(false);
  await graphs.screenshot({
    path: testInfo.outputPath("care-report-tablet.png"),
  });
  expect(fixture.unexpected).toEqual([]);
});

test("HRV is always visible and shares zoom without an inspection section", async ({
  page,
}, testInfo) => {
  const { fixture, report, graphs } = await openReport(page);
  const start = report.period.start,
    end = report.period.endExclusive;
  await expect
    .poll(() => bounds(graphs))
    .toEqual([Date.parse(start), Date.parse(end)]);
  await zoomCareGraph(page, graphs, "hrv");
  const before = await bounds(graphs);
  const seriesCalls = fixture.calls.filter((call) =>
    call.path.endsWith("/series"),
  ).length;
  await expect(graphs.getByRole("heading", { name: /^HRV/ })).toBeVisible();
  await expect(
    graphs.getByRole("heading", { name: /^Vendor HRV/ }),
  ).toHaveCount(0);
  expect(await graphs.innerText()).not.toMatch(/\bVendor\b/i);
  await expect(
    graphs.getByRole("img", {
      name: chartName,
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(() => bounds(graphs)).toEqual(before);
  await expect(graphs.getByRole("heading", { name: /^HRV/ })).toContainText(
    "ms",
  );
  await expect(
    graphs.getByRole("region", {
      name: "HRV sample values",
      exact: true,
    }),
  ).toHaveCount(0);
  await resetCareGraph(page, graphs, [Date.parse(start), Date.parse(end)]);
  await expect
    .poll(() => bounds(graphs))
    .toEqual([Date.parse(start), Date.parse(end)]);
  await graphs
    .getByRole("status", { name: "Visible range", exact: true })
    .hover();
  await graphs.screenshot({ path: testInfo.outputPath("care-vendor-hrv.png") });
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
    )
    .toBe(false);
  await graphs.screenshot({
    path: testInfo.outputPath("care-vendor-hrv-tablet.png"),
  });
  await expect(
    graphs.getByRole("checkbox", { name: "Show HRV", exact: true }),
  ).toHaveCount(0);
  await expect(
    graphs.getByRole("img", { name: chartName, exact: true }),
  ).toBeVisible();
  expect(
    fixture.calls.filter((call) => call.path.endsWith("/series")),
  ).toHaveLength(seriesCalls);
  expect(fixture.unexpected).toEqual([]);
});
