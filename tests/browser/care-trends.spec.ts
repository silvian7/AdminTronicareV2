import { expect, test, type Page } from "@playwright/test";
import {
  installCareFixtures,
  syntheticCareOrganizationTag,
  syntheticCareSubjects,
  syntheticCareTrends,
  type CareFixturesOptions,
} from "./care-fixtures";

test.use({ timezoneId: "America/New_York" });

async function openTrends(page: Page, options: CareFixturesOptions = {}) {
  // Brussels has crossed midnight; both UTC and the browser are still yesterday.
  await page.clock.setFixedTime(new Date("2026-10-28T23:30:00Z"));
  const fixture = await installCareFixtures(page, {
    withTrends: true,
    ...options,
  });
  const subject = fixture.subjects[0];
  await page.goto(`/care/subjects/${subject.id}/trends`);
  await expect(
    page.getByRole("heading", { name: "Historical trends", exact: true }),
  ).toBeVisible();
  return { fixture, subject };
}

const dayRow = (page: Page, date: string) =>
  page
    .locator(".care-trend-data")
    .getByRole("row")
    .filter({
      hasText: date.split("-").reverse().join("/"),
    });

test("seven-day trends distinguish available, incomplete, missing and recorded zero", async ({
  page,
}, testInfo) => {
  const { fixture, subject } = await openTrends(page);
  await expect(
    page.getByRole("img", { name: "Daily report trend", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      fixture.calls.some(
        (call) =>
          call.path === `/api/care/subjects/${subject.id}/trends` &&
          call.query.get("days") === "7" &&
          call.query.get("endDate") === "2026-10-29",
      ),
    )
    .toBe(true);
  await expect(dayRow(page, "2026-10-27")).toContainText("Available");
  await expect(dayRow(page, "2026-10-28")).toContainText("Incomplete report");
  await expect(dayRow(page, "2026-10-28")).toContainText("Not available");
  await expect(dayRow(page, "2026-10-28").getByRole("link")).toHaveCount(0);
  await expect(dayRow(page, "2026-10-24")).toContainText("Unavailable");
  const metric = page.getByRole("combobox", {
    name: "Trend metric",
    exact: true,
  });
  await metric.focus();
  await metric.press("ArrowDown");
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: "Vendor apnea/hypopnea events" })
    .click();
  await expect(
    dayRow(page, "2026-10-27").getByRole("cell", { name: "0", exact: true }),
  ).toBeVisible();
  await expect(dayRow(page, "2026-10-24")).toContainText("Not available");
  await metric.press("Escape");
  await expect(page.locator(".ant-select-dropdown:visible")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("care-trends-desktop.png"),
    fullPage: true,
  });
  expect(fixture.unexpected).toEqual([]);
});

test("30-day and custom ranges request bounded UTC dates while invalid ranges do not fetch", async ({
  page,
}) => {
  const { fixture, subject } = await openTrends(page);
  await expect(
    page.getByRole("img", { name: "Daily report trend", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "30 days", exact: true }).click();
  await expect
    .poll(() =>
      fixture.calls.some(
        (call) =>
          call.path === `/api/care/subjects/${subject.id}/trends` &&
          call.query.get("days") === "30" &&
          call.query.get("endDate") === "2026-10-29",
      ),
    )
    .toBe(true);
  await expect(page.locator(".care-trend-data").getByRole("row")).toHaveCount(
    31,
  );
  await page.getByRole("button", { name: "Custom range", exact: true }).click();
  await page
    .getByLabel("Custom start date", { exact: true })
    .fill("2026-10-25");
  await page.getByLabel("Custom end date", { exact: true }).fill("2026-10-28");
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect
    .poll(() =>
      fixture.calls.some(
        (call) =>
          call.path === `/api/care/subjects/${subject.id}/trends` &&
          call.query.get("startDate") === "2026-10-25" &&
          call.query.get("endDate") === "2026-10-28" &&
          !call.query.has("days"),
      ),
    )
    .toBe(true);
  await expect(page.locator(".care-trend-data").getByRole("row")).toHaveCount(
    5,
  );
  const count = fixture.calls.filter((call) =>
    call.path.endsWith("/trends"),
  ).length;
  await page
    .getByLabel("Custom start date", { exact: true })
    .fill("2026-09-01");
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(
    page.getByText(
      "Choose at most 31 dates, with the end on or after the start.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    fixture.calls.filter((call) => call.path.endsWith("/trends")),
  ).toHaveLength(count);
  expect(fixture.unexpected).toEqual([]);
});

test("an accessible daily point link opens its actual stored report identity", async ({
  page,
}) => {
  const { fixture, subject } = await openTrends(page);
  const report = fixture.histories
    .get(subject.id)!
    .find((entry) => entry.period.reportDate === "2026-10-26")!;
  const link = page.getByRole("link", {
    name: "Open report for 26/10/2026",
    exact: true,
  });
  await expect(link).toBeVisible();
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    new RegExp(`/care/subjects/${subject.id}/reports/${report.id}$`),
  );
  await expect(
    page.getByRole("heading", { name: "Reporting period", exact: true }),
  ).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});

test("breathing history retains each backend-selected 28-day source independently of trend dates", async ({
  page,
}) => {
  const { fixture, subject } = await openTrends(page);
  await expect(
    page.getByRole("img", { name: "Breathing history source 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Breathing history source 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/exclusive 28-day cutoff, independently of the trend dates/),
  ).toBeVisible();
  await page.getByText("Report values for source 1", { exact: true }).click();
  const first = page
    .getByText("Report values for source 1", { exact: true })
    .locator("..");
  await expect(first.getByRole("listitem")).toHaveCount(4);
  await expect(first).toContainText("30/09/2026");
  await expect(first).not.toContainText("29/09/2026");
  await expect(first).toContainText("0 events/report");
  await page.getByText("Report values for source 2", { exact: true }).click();
  const second = page
    .getByText("Report values for source 2", { exact: true })
    .locator("..");
  await expect(second.getByRole("listitem")).toHaveCount(2);
  await expect(second).toContainText("01/09/2026");
  await expect(second).toContainText("20/09/2026");
  const originalLinks = await second
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  await page.getByRole("button", { name: "30 days", exact: true }).click();
  await expect
    .poll(() =>
      fixture.calls.some(
        (call) =>
          call.path.endsWith("/trends") && call.query.get("days") === "30",
      ),
    )
    .toBe(true);
  await expect(page.locator(".care-trend-data").getByRole("row")).toHaveCount(
    31,
  );
  await page.getByText("Report values for source 2", { exact: true }).click();
  await expect(second.getByRole("listitem")).toHaveCount(2);
  expect(
    await second
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
  ).toEqual(originalLinks);
  expect(subject.id).toBe("9223372036854775806");
  expect(fixture.unexpected).toEqual([]);
});

test("a trend service failure hides curves and explicit retry restores the response", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-29T12:00:00Z"));
  const fixture = await installCareFixtures(page, { withTrends: true });
  const subject = fixture.subjects[0],
    path = `/api/care/subjects/${subject.id}/trends`;
  fixture.override(
    "GET",
    path,
    { message: "Synthetic trend service is unavailable." },
    503,
  );
  await page.goto(`/care/subjects/${subject.id}/trends`);
  await expect(
    page.getByText("Synthetic trend service is unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Daily report trend", exact: true }),
  ).toHaveCount(0);
  fixture.clearOverride("GET", path);
  await page.getByRole("button", { name: "Retry trends", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Daily report trend", exact: true }),
  ).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});

test("a different subject cannot reuse another subject's trend response", async ({
  page,
}) => {
  const { fixture, subject } = await openTrends(page);
  await expect(
    page.getByRole("img", { name: "Daily report trend", exact: true }),
  ).toBeVisible();
  const target = fixture.subjects[2];
  fixture.override("GET", `/api/care/subjects/${target.id}/trends`, {
    data: syntheticCareTrends(
      subject.id,
      fixture.histories.get(subject.id)!,
      "2026-10-23",
      "2026-10-29",
    ),
  });
  await page
    .getByRole("main")
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  await page.getByRole("link", { name: target.tag, exact: true }).click();
  await page
    .getByRole("navigation", { name: "Caregiver navigation", exact: true })
    .getByRole("link", { name: "Trends", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/care/subjects/${target.id}/trends$`),
  );
  await expect(
    page.getByText("Trend data unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Daily report trend", exact: true }),
  ).toHaveCount(0);
  expect(fixture.unexpected).toEqual([]);
});

test("organization rotation clears prior trends and forbids their former subject", async ({
  page,
}) => {
  const subjects = syntheticCareSubjects(3);
  subjects[1].organizationId = "2";
  const { fixture, subject } = await openTrends(page, {
    subjects,
    memberships: [
      { organizationId: "1", userTypeId: "30", active: true },
      { organizationId: "2", userTypeId: "30", active: true },
    ],
  });
  await expect(
    page.getByRole("img", { name: "Daily report trend", exact: true }),
  ).toBeVisible();
  const organization = page.getByRole("combobox", {
    name: "Active organization",
    exact: true,
  });
  await organization.focus();
  await organization.press("ArrowDown");
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: syntheticCareOrganizationTag("2") })
    .click();
  await expect(page).toHaveURL(/\/care$/);
  await expect(
    page.getByRole("link", { name: subjects[1].tag, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: subject.tag, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "Daily report trend", exact: true }),
  ).toHaveCount(0);
  await page.goto(`/care/subjects/${subject.id}/trends`);
  await expect(
    page.getByText("Synthetic asset not found.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Daily report trend", exact: true }),
  ).toHaveCount(0);
  expect(
    fixture.calls
      .filter((call) => call.method === "POST")
      .map((call) => call.path),
  ).toEqual(["/api/session/organization"]);
  expect(fixture.unexpected).toEqual([]);
});

test("trends remain readable on a tablet", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const { fixture } = await openTrends(page);
  await expect(
    page.getByRole("img", { name: "Daily report trend", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
  ).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("care-trends-tablet.png"),
  });
  await page
    .locator(".care-trend-data")
    .screenshot({ path: testInfo.outputPath("care-trends-values-tablet.png") });
  expect(fixture.unexpected).toEqual([]);
});
