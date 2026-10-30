import { expect, test, type Locator, type Page } from "@playwright/test";
import { installCareFixtures, syntheticCareSeries } from "./care-fixtures";

test.use({ timezoneId: "Europe/Brussels" });
const chartName =
  "Bed presence, heart rate, respiration and movement over time";

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

const reading = (inspector: Locator, label: string) =>
  inspector.getByText(label, { exact: true }).locator("..").locator("dd");

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

test("report selector and UTC date select stored history without replacing a missing day", async ({
  page,
}) => {
  const { fixture, subject, reports } = await openReport(page);
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
  await page
    .getByLabel("Report date", { exact: true })
    .fill(reports[2].period.reportDate);
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
    .poll(async () =>
      Date.parse(
        `${await page.getByLabel("Range start (UTC)", { exact: true }).inputValue()}Z`,
      ),
    )
    .toBe(Date.parse(reports[2].period.start));
  await page.reload();
  await expect(page).toHaveURL(
    new RegExp(`\\?date=${reports[2].period.reportDate}$`),
  );
  await expect
    .poll(async () =>
      Date.parse(
        `${await page.getByLabel("Range start (UTC)", { exact: true }).inputValue()}Z`,
      ),
    )
    .toBe(Date.parse(reports[2].period.start));
  await page.getByLabel("Report date", { exact: true }).fill("2026-10-24");
  await expect(page).toHaveURL(/\?date=2026-10-24$/);
  await expect(page.getByText(/No eligible completed report/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Report graphs", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Report summary", exact: true }),
  ).toHaveCount(0);
  expect(fixture.unexpected).toEqual([]);
});

test("four coordinated panels expose numeric readings, genuine zero movement and gaps", async ({
  page,
}) => {
  const { fixture, report, graphs } = await openReport(page);
  for (const title of [
    "Bed presence",
    "Heart rate",
    "Respiration",
    "Movement",
  ]) {
    await expect(
      graphs.getByRole("heading", { name: new RegExp(`^${title}`) }),
    ).toBeVisible();
  }
  const inspector = graphs.getByRole("region", {
    name: "Sample values",
    exact: true,
  });
  const series = syntheticCareSeries(report);
  const sample = graphs.getByRole("combobox", {
    name: "Inspect retained sample",
    exact: true,
  });
  await expect(reading(inspector, "Heart rate (beats/min)")).toHaveText(
    String(series.points[0].heartRate),
  );
  await expect(reading(inspector, "Movement")).toHaveText(
    "No movement event flag",
  );
  await sample.selectOption("11");
  await expect(reading(inspector, "Heart rate (beats/min)")).toHaveText(
    "Not available",
  );
  await expect(reading(inspector, "Respiration (breaths/min)")).toHaveText(
    "Not available",
  );
  await expect(reading(inspector, "Movement")).toHaveText(
    "No movement event flag",
  );
  await page.getByRole("button", { name: "Next sample", exact: true }).click();
  await expect(reading(inspector, "Movement")).toHaveText("Unknown");
  await sample.selectOption("60");
  await expect(reading(inspector, "Movement")).toHaveText(
    "Movement event flag",
  );
  await sample.selectOption("270");
  await expect(reading(inspector, "Bed presence")).toHaveText("Unknown");
  expect(fixture.unexpected).toEqual([]);
});

test("zoom, pan and reset share one visible range while bed-exit focus selects its real sample", async ({
  page,
}) => {
  const { fixture, report, graphs } = await openReport(page);
  const start = Date.parse(report.period.start),
    end = Date.parse(report.period.endExclusive);
  await expect.poll(() => bounds(graphs)).toEqual([start, end]);
  await graphs.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect
    .poll(async () => {
      const range = await bounds(graphs);
      return range[1] - range[0];
    })
    .toBe((end - start) / 2);
  const previous = await bounds(graphs);
  await graphs
    .getByRole("button", { name: "Pan earlier", exact: true })
    .click();
  await expect
    .poll(async () => (await bounds(graphs))[0])
    .toBeLessThan(previous[0]);
  await graphs
    .getByRole("combobox", { name: "Inspect retained sample", exact: true })
    .selectOption("1");
  const explicitSample = Date.parse(syntheticCareSeries(report).points[1].at);
  await expect
    .poll(async () => {
      const visible = await bounds(graphs);
      return visible[0] <= explicitSample && visible[1] > explicitSample;
    })
    .toBe(true);
  await graphs.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect.poll(() => bounds(graphs)).toEqual([start, end]);
  const exits = graphs.getByRole("region", { name: "Bed exits", exact: true });
  await expect(
    exits.getByRole("button", { name: /^Inspect bed exit at/ }),
  ).toHaveCount(1);
  await exits.getByRole("button", { name: /^Inspect bed exit at/ }).click();
  const exitInterval = syntheticCareSeries(report).bedPresence.find(
    (interval) => interval.state === "out_of_bed",
  )!;
  const exit = Date.parse(exitInterval.start);
  await expect
    .poll(() => bounds(graphs))
    .toEqual([
      exit - 15 * 60_000,
      Date.parse(exitInterval.endExclusive) + 15 * 60_000,
    ]);
  const inspector = graphs.getByRole("region", {
    name: "Sample values",
    exact: true,
  });
  await expect(reading(inspector, "Bed presence")).toHaveText("Out of bed");
  await expect(
    inspector.locator('time[datetime="2026-10-27T07:00:00.000Z"]'),
  ).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});

test("UTC range loading requests only that range and full-period control restores it", async ({
  page,
}) => {
  const { fixture, subject, report, graphs } = await openReport(page);
  await graphs
    .getByLabel("Range start (UTC)", { exact: true })
    .fill("2026-10-27T06:00");
  await graphs
    .getByLabel("Range end (UTC)", { exact: true })
    .fill("2026-10-27T08:00");
  await graphs.getByRole("button", { name: "Load range", exact: true }).click();
  await expect
    .poll(() =>
      fixture.calls.some(
        (call) =>
          call.path ===
            `/api/care/subjects/${subject.id}/reports/${report.id}/series` &&
          Date.parse(call.query.get("start") ?? "") ===
            Date.parse("2026-10-27T06:00Z") &&
          Date.parse(call.query.get("end") ?? "") ===
            Date.parse("2026-10-27T08:00Z"),
      ),
    )
    .toBe(true);
  await expect
    .poll(() => bounds(graphs))
    .toEqual([
      Date.parse("2026-10-27T06:00Z"),
      Date.parse("2026-10-27T08:00Z"),
    ]);
  await expect(graphs.getByText(/120 retained samples/)).toBeVisible();
  await graphs
    .getByRole("button", { name: "Full reporting period", exact: true })
    .click();
  await expect
    .poll(() => bounds(graphs))
    .toEqual([
      Date.parse(report.period.start),
      Date.parse(report.period.endExclusive),
    ]);
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
  await expect(page.getByRole("img", { name: chartName })).toHaveCount(0);
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
    { message: "Synthetic range is too dense." },
    422,
  );
  await graphs.getByRole("button", { name: "Load range", exact: true }).click();
  await expect(
    page.getByText("Choose a narrower time range", { exact: true }),
  ).toBeVisible();
  await expect(graphs.getByRole("img", { name: chartName })).toHaveCount(0);
  await expect(
    graphs.getByLabel("Range start (UTC)", { exact: true }),
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
  await page.getByRole("link", { name: /Back to overview$/ }).click();
  await page.getByRole("link", { name: target.tag, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/care/subjects/${target.id}$`));
  await expect(
    page.getByText("Synthetic asset not found.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Report summary", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("img", { name: chartName })).toHaveCount(0);
  expect(fixture.unexpected).toEqual([]);
});

test("desktop and tablet graph layouts resize without clipping and preserve visible range", async ({
  page,
}, testInfo) => {
  const { fixture, graphs } = await openReport(page);
  await graphs.getByRole("button", { name: "Reset view", exact: true }).click();
  await graphs.screenshot({
    path: testInfo.outputPath("care-report-full-period.png"),
  });
  await graphs.getByRole("button", { name: "Zoom in", exact: true }).click();
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

test("optional vendor HRV preserves zero, gaps, source units and the shared zoom", async ({
  page,
}, testInfo) => {
  const { fixture, report, graphs } = await openReport(page);
  const series = syntheticCareSeries(report);
  const start = series.hrv[0].at,
    end = series.hrv[series.hrv.length - 1].endExclusive;
  await graphs
    .getByLabel("Range start (UTC)", { exact: true })
    .fill(start.slice(0, 16));
  await graphs
    .getByLabel("Range end (UTC)", { exact: true })
    .fill(end.slice(0, 16));
  await graphs.getByRole("button", { name: "Load range", exact: true }).click();
  await expect(graphs.getByText(/30 retained samples/)).toBeVisible();
  await graphs.getByRole("button", { name: "Zoom in", exact: true }).click();
  const before = await bounds(graphs);
  const seriesCalls = fixture.calls.filter((call) =>
    call.path.endsWith("/series"),
  ).length;
  const toggle = graphs.getByRole("checkbox", {
    name: "Show Vendor HRV",
    exact: true,
  });
  await toggle.check();
  await expect(
    graphs.getByRole("heading", { name: /^Vendor HRV/ }),
  ).toBeVisible();
  await expect(
    graphs.getByRole("img", {
      name: "Bed presence, heart rate, respiration, movement and Vendor HRV over time",
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(() => bounds(graphs)).toEqual(before);
  const inspector = graphs.getByRole("region", {
    name: "Vendor HRV sample values",
    exact: true,
  });
  await expect(inspector).toContainText("Source: analysis.maxReport.hrvArray");
  await expect(inspector).toContainText("Sampling interval: 300 seconds");
  await expect(inspector).toContainText(/not RMSSD/i);
  await expect(reading(inspector, "Vendor HRV (ms)")).toHaveText("0");
  const samples = inspector.getByRole("combobox", {
    name: "Inspect Vendor HRV sample",
    exact: true,
  });
  await samples.selectOption("2");
  await expect(reading(inspector, "Vendor HRV (ms)")).toHaveText(
    "Not available",
  );
  await inspector
    .getByRole("button", { name: "Previous HRV sample", exact: true })
    .click();
  await expect(reading(inspector, "Vendor HRV (ms)")).toHaveText("42");
  await inspector
    .getByRole("button", { name: "Previous HRV sample", exact: true })
    .click();
  await expect(reading(inspector, "Vendor HRV (ms)")).toHaveText("0");
  await graphs.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect
    .poll(() => bounds(graphs))
    .toEqual([Date.parse(start), Date.parse(end)]);
  await graphs
    .getByRole("heading", { name: "Report graphs", exact: true })
    .hover();
  await graphs.screenshot({ path: testInfo.outputPath("care-vendor-hrv.png") });
  await page.setViewportSize({ width: 768, height: 1024 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
  ).toBe(false);
  await graphs.screenshot({
    path: testInfo.outputPath("care-vendor-hrv-tablet.png"),
  });
  await toggle.uncheck();
  await expect(
    graphs.getByRole("heading", { name: /^Vendor HRV/ }),
  ).toHaveCount(0);
  await expect(
    graphs.getByRole("img", { name: chartName, exact: true }),
  ).toBeVisible();
  expect(
    fixture.calls.filter((call) => call.path.endsWith("/series")),
  ).toHaveLength(seriesCalls);
  expect(fixture.unexpected).toEqual([]);
});
