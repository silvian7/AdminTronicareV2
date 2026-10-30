import { expect, test, type Locator, type Page } from "@playwright/test";
import { installCareFixtures, syntheticCareSeries } from "./care-fixtures";

test.use({ timezoneId: "America/New_York" });
const chartName =
  "Bed presence, heart rate, respiration, movement and HRV over time";

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

test("five coordinated panels remain visible while inspection and bed-exit sections are hidden", async ({
  page,
}) => {
  const { fixture, graphs } = await openReport(page);
  for (const title of [
    "Bed presence",
    "Heart rate",
    "Respiration",
    "Movement",
    "HRV",
  ]) {
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
  await graphs.getByRole("button", { name: "Pan later", exact: true }).click();
  await expect.poll(() => bounds(graphs)).toEqual(previous);
  await graphs.getByRole("button", { name: "Reset view", exact: true }).click();
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

test("HRV is always visible and shares zoom without an inspection section", async ({
  page,
}, testInfo) => {
  const { fixture, report, graphs } = await openReport(page);
  const start = report.period.start,
    end = report.period.endExclusive;
  await expect
    .poll(() => bounds(graphs))
    .toEqual([Date.parse(start), Date.parse(end)]);
  await graphs.getByRole("button", { name: "Zoom in", exact: true }).click();
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
      name: "Bed presence, heart rate, respiration, movement and HRV over time",
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
