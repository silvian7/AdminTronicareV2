import { expect, test } from "@playwright/test";
import {
  installCareFixtures,
  syntheticCareOrganizationTag,
  syntheticCareSubjects,
} from "./care-fixtures";

test.use({ locale: "en-US", timezoneId: "America/New_York" });
const coordinatedGraphs =
  "Bed presence, heart rate, respiration, movement and HRV over time";

test("original bed pictograms and Asset event-age discs remain distinct", async ({
  page,
}, testInfo) => {
  const now = new Date("2026-10-29T12:00:00Z");
  await page.clock.install({ time: now });
  const subjects = syntheticCareSubjects(5);
  for (const [index, minutes] of [4.9, 15, 120, 540, null].entries())
    subjects[index].lastEventAt =
      minutes === null
        ? null
        : new Date(now.getTime() - minutes * 60_000).toISOString();
  subjects[0].bed.observedAt = "2026-10-28T01:00:00Z";
  const fixture = await installCareFixtures(page, {
    subjects,
    reportsAvailable: false,
  });
  await page.goto("/care");
  const rows = subjects.map((subject) =>
    page.getByRole("row").filter({ hasText: subject.tag }),
  );
  for (const [index, color] of [
    "green",
    "yellow",
    "red",
    "black",
    "black",
  ].entries())
    await expect(rows[index].locator(".hub-status-dot")).toHaveAttribute(
      "data-status",
      color,
    );
  const inBed = rows[0].getByRole("img", { name: "In bed", exact: true });
  const outBed = rows[1].getByRole("img", { name: "Out of bed", exact: true });
  await expect(inBed).toBeVisible();
  await expect(outBed).toBeVisible();
  expect(await inBed.getAttribute("src")).not.toBe(
    await outBed.getAttribute("src"),
  );
  await expect(rows[2].locator(".care-bed-pictogram")).toHaveCount(0);
  await expect(rows[0].locator(".care-bed-observation time")).toHaveAttribute(
    "datetime",
    "2026-10-28T01:00:00Z",
  );
  await page.clock.runFor(15_000);
  await expect(rows[0].locator(".hub-status-dot")).toHaveAttribute(
    "data-status",
    "yellow",
  );
  await page.setViewportSize({ width: 768, height: 1024 });
  const card = page
    .locator(".care-subject-card")
    .filter({ hasText: subjects[0].tag });
  await expect(card.locator(".care-bed-pictogram")).toBeVisible();
  await expect(card.locator(".hub-status-dot")).toHaveAttribute(
    "data-status",
    "yellow",
  );
  await page.screenshot({
    path: testInfo.outputPath("care-pictograms-status-tablet.png"),
    fullPage: false,
  });
  await card.getByRole("link", { name: subjects[0].tag, exact: true }).click();
  await expect(
    page.locator(".care-page-heading .hub-status-dot"),
  ).toHaveAttribute("data-status", "yellow");
  await expect(
    page.getByRole("heading", { name: "Latest observation", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".care-bed-pictogram")).toHaveCount(0);
  expect(fixture.unexpected).toEqual([]);
});

test("caregiver sign-in opens the read-only overview", async ({ page }) => {
  const fixture = await installCareFixtures(page, { authenticated: false });
  await page.goto("/login");
  await page.getByLabel("Login", { exact: true }).fill("synthetic-caregiver");
  await page.locator("#password").fill("SYNTHETIC-NOT-A-REAL-PASSWORD");
  await page.getByRole("button", { name: /Sign in$/ }).click();
  await expect(page).toHaveURL(/\/care$/);
  await expect(
    page.getByRole("searchbox", { name: "Search assets", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Administration", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".care-context")).toContainText(
    syntheticCareOrganizationTag("1"),
  );
  expect(
    fixture.calls.some(
      (call) => call.path === "/api/session/organization-tags",
    ),
  ).toBe(true);
  expect(
    fixture.calls.some((call) =>
      call.path.startsWith("/api/resources/organizations"),
    ),
  ).toBe(false);
  expect(
    fixture.calls
      .filter((call) => call.method !== "GET")
      .map((call) => call.path),
  ).toEqual(["/api/session/login"]);
  expect(fixture.unexpected).toEqual([]);
});

test("overview shows resident identities, accessible bed images and dated observations without explanatory clutter", async ({
  page,
}) => {
  const subjects = syntheticCareSubjects();
  subjects[0].bed.observedAt = "2026-10-28T19:24:00.000Z";
  subjects[1].bed.observedAt = "2026-10-28T23:00:00.000Z";
  const fixture = await installCareFixtures(page, { subjects });
  await page.goto("/care");
  await expect(
    page.getByRole("columnheader", { name: "Resident", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Caregiver navigation", exact: true })
      .getByRole("link", { name: "Overview", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Overview", { exact: true })).toHaveCount(0);
  await expect(page.locator(".care-context")).toContainText(
    syntheticCareOrganizationTag("1"),
  );
  for (const text of [
    "Active organization",
    "Read-only",
    "Current status unknown",
    "Freshness has not been assessed.",
  ])
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  for (const text of [
    /^Times shown in /,
    /^Status discs show/,
    /^List refreshed/,
    /Last observed:/,
  ])
    await expect(page.getByText(text)).toHaveCount(0);
  const first = page
    .getByRole("row")
    .filter({ hasText: fixture.subjects[0].tag });
  await expect(
    first.getByRole("img", { name: "In bed", exact: true }),
  ).toBeVisible();
  const afternoon = first.locator('time[datetime="2026-10-28T19:24:00.000Z"]');
  await expect(afternoon).toContainText("28/10/2026");
  await expect(afternoon).toContainText("20:24:00");
  await expect(afternoon).not.toContainText(/\b[AP]M\b/);
  await expect(first.locator(".care-bed-observation time")).toBeVisible();
  await expect(
    first.getByRole("link", { name: /Open completed report/ }),
  ).toHaveCount(0);
  await expect(first.locator(".care-latest-report time")).toHaveCount(2);
  await expect(page.getByText("Open report", { exact: true })).toHaveCount(0);
  const second = page
    .getByRole("row")
    .filter({ hasText: fixture.subjects[1].tag });
  await expect(
    second.getByRole("img", { name: "Out of bed", exact: true }),
  ).toBeVisible();
  const midnight = second.locator('time[datetime="2026-10-28T23:00:00.000Z"]');
  await expect(midnight).toContainText("29/10/2026");
  await expect(midnight).toContainText("00:00:00");
  await expect(midnight).not.toContainText(/\b[AP]M\b|24:00/);
  await expect(
    second.getByRole("link", { name: /Open completed report/ }),
  ).toHaveCount(0);
  const third = page
    .getByRole("row")
    .filter({ hasText: fixture.subjects[2].tag });
  await expect(third.locator(".care-bed-pictogram")).toHaveCount(0);
  await expect(third.locator(".care-bed-observation time")).toHaveCount(0);
  await expect(third).toContainText("No bed observation available.");
  expect(
    fixture.calls
      .filter((call) => call.path.startsWith("/api/care/"))
      .every((call) => call.path === "/api/care/subjects"),
  ).toBe(true);
  expect(fixture.unexpected).toEqual([]);
});

test("an unavailable caregiver backend shows no asset rows and Retry restores the real response", async ({
  page,
}) => {
  const fixture = await installCareFixtures(page);
  fixture.override(
    "GET",
    "/api/care/subjects",
    {
      code: "care_backend_unavailable",
      message:
        "The caregiver service is unavailable. Contact your administrator.",
    },
    503,
  );
  await page.goto("/care");
  await expect(
    page.getByText("Caregiver service unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The caregiver service is unavailable. Contact your administrator.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Authorized assets", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: fixture.subjects[0].tag, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Current status unknown", { exact: true }),
  ).toHaveCount(0);
  fixture.clearOverride("GET", "/api/care/subjects");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("link", { name: fixture.subjects[0].tag, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Caregiver service unavailable", { exact: true }),
  ).toHaveCount(0);
  expect(
    fixture.calls
      .filter((call) => call.path.startsWith("/api/care/"))
      .every((call) => call.path === "/api/care/subjects"),
  ).toBe(true);
  expect(fixture.unexpected).toEqual([]);
});

test("observation availability hides stale readings while available and legacy observations remain dated", async ({
  page,
}) => {
  const subjects = syntheticCareSubjects(6);
  const unavailable = [
    ["unavailable", "Bed observation unavailable."],
    ["ambiguous", "Multiple bed sensors; observation is ambiguous."],
    ["denied", "Measurement access unavailable."],
    ["limited", "Bed observation temporarily unavailable."],
  ] as const;
  for (const [index, [availability]] of unavailable.entries()) {
    subjects[index].bed = {
      ...subjects[index].bed,
      lastObservedState: "in_bed",
      observedAt: "2026-10-29T07:15:00.000Z",
      availability,
      source: "admin_sensor",
    };
  }
  subjects[4].bed = {
    ...subjects[4].bed,
    lastObservedState: "in_bed",
    observedAt: "2026-10-29T07:15:00.000Z",
    availability: "available",
    source: "admin_sensor",
  };
  subjects[5].bed = {
    ...subjects[5].bed,
    lastObservedState: "out_of_bed",
    observedAt: "2026-10-29T07:15:00.000Z",
  };
  const fixture = await installCareFixtures(page, { subjects });
  await page.goto("/care");
  for (const [index, [, message]] of unavailable.entries()) {
    const observation = page
      .getByRole("row")
      .filter({ hasText: subjects[index].tag })
      .locator(".care-bed-observation");
    await expect(observation).toContainText(message);
    await expect(observation.locator(".care-bed-pictogram")).toHaveCount(0);
    await expect(observation.locator("time")).toHaveCount(0);
  }
  for (const [index, state] of [
    [4, "In bed"],
    [5, "Out of bed"],
  ] as const) {
    const observation = page
      .getByRole("row")
      .filter({ hasText: subjects[index].tag })
      .locator(".care-bed-observation");
    await expect(
      observation.getByRole("img", { name: state, exact: true }),
    ).toBeVisible();
    await expect(
      observation.locator('time[datetime="2026-10-29T07:15:00.000Z"]'),
    ).toBeVisible();
  }
  expect(fixture.unexpected).toEqual([]);
});

test("search and pagination request bounded server pages without per-row reads", async ({
  page,
}) => {
  const fixture = await installCareFixtures(page);
  await page.goto("/care");
  await expect(
    page.getByRole("link", { name: fixture.subjects[0].tag, exact: true }),
  ).toBeVisible();
  await page.locator(".ant-pagination-item-2").click();
  await expect(
    page.getByRole("link", { name: fixture.subjects[20].tag, exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      fixture.calls.some(
        (call) =>
          call.path === "/api/care/subjects" && call.query.get("page") === "2",
      ),
    )
    .toBe(true);
  await page.getByLabel("Search assets", { exact: true }).fill("ASSET-24");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("link", { name: fixture.subjects[23].tag, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: fixture.subjects[20].tag, exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      fixture.calls.some(
        (call) =>
          call.path === "/api/care/subjects" &&
          call.query.get("q") === "ASSET-24" &&
          call.query.get("page") === "1",
      ),
    )
    .toBe(true);
  expect(
    fixture.calls
      .filter((call) => call.path.startsWith("/api/care/"))
      .every((call) => call.path === "/api/care/subjects"),
  ).toBe(true);
  expect(fixture.unexpected).toEqual([]);
});

test("desktop resident rows open the exact latest graphs while selection, modifiers and nested links retain their behavior", async ({
  page,
}) => {
  const fixture = await installCareFixtures(page, {
    subjects: syntheticCareSubjects(1),
  });
  const subject = fixture.subjects[0];
  const report = subject.latestReport!;
  const target = `/care/subjects/${subject.id}/reports/${report.id}`;
  const row = page.locator(`tr[data-row-key="${subject.id}"]`);
  const graph = page.getByRole("img", { name: coordinatedGraphs, exact: true });
  await page.goto("/care");
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("tabindex", "0");
  expect(await row.getAttribute("role")).toBeNull();
  await row.dispatchEvent("click", { button: 0, ctrlKey: true });
  await row.dispatchEvent("click", { button: 1 });
  await expect(page).toHaveURL(/\/care$/);
  const label = row.getByText(subject.label, { exact: true });
  await label.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await row.dispatchEvent("click", { button: 0 });
  await expect(page).toHaveURL(/\/care$/);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await label.click();
  await expect(page).toHaveURL(target);
  await expect(graph).toBeVisible();
  expect(
    fixture.calls.some(
      (call) =>
        call.path ===
        `/api/care/subjects/${subject.id}/reports/${report.id}/series`,
    ),
  ).toBe(true);

  await page
    .getByRole("navigation", { name: "Caregiver navigation", exact: true })
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  const nestedIdentity = row.getByRole("link", {
    name: subject.tag,
    exact: true,
  });
  await expect(nestedIdentity).toHaveAttribute("href", target);
  await nestedIdentity.focus();
  await nestedIdentity.press("Space");
  await expect(page).toHaveURL(/\/care$/);
  await nestedIdentity.press("Enter");
  await expect(page).toHaveURL(target);
  await expect(graph).toBeVisible();

  await page
    .getByRole("navigation", { name: "Caregiver navigation", exact: true })
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  await row.focus();
  await row.press("Space");
  await expect(page).toHaveURL(target);
  await expect(graph).toBeVisible();
  expect(
    fixture.calls
      .filter((call) => call.path.includes("/reports/"))
      .every(
        (call) =>
          call.path ===
            `/api/care/subjects/${subject.id}/reports/${report.id}` ||
          call.path ===
            `/api/care/subjects/${subject.id}/reports/${report.id}/series`,
      ),
  ).toBe(true);
  expect(fixture.calls.filter((call) => call.method !== "GET")).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test("tablet resident cards open latest report graphs from plain card content and keyboard activation", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const fixture = await installCareFixtures(page, {
    subjects: syntheticCareSubjects(1),
  });
  const subject = fixture.subjects[0];
  const target = `/care/subjects/${subject.id}/reports/${subject.latestReport!.id}`;
  const card = page
    .locator(".care-subject-card")
    .filter({ hasText: subject.tag });
  await page.goto("/care");
  await expect(card).toHaveAttribute("role", "group");
  await expect(card).toHaveAttribute("tabindex", "0");
  await expect(card).toHaveAttribute(
    "aria-label",
    `Open completed report for ${subject.tag}`,
  );
  await expect(
    card.getByRole("link", { name: /Open completed report/ }),
  ).toHaveCount(0);
  await expect(card.getByText("Open report", { exact: true })).toHaveCount(0);
  await expect(card.locator(".care-latest-report time")).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath("care-clickable-resident-card.png"),
    animations: "disabled",
  });
  await card
    .getByRole("heading", { name: "Bed observation", exact: true })
    .click();
  await expect(page).toHaveURL(target);
  await expect(
    page.getByRole("img", { name: coordinatedGraphs, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Caregiver navigation", exact: true })
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  await card.focus();
  await card.press("Enter");
  await expect(page).toHaveURL(target);
  await expect(
    page.getByRole("img", { name: coordinatedGraphs, exact: true }),
  ).toBeVisible();
  expect(fixture.calls.filter((call) => call.method !== "GET")).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

for (const scenario of [
  {
    name: "no eligible report",
    tablet: false,
    reportsAvailable: true,
    denied: false,
    latest: "none",
    message: "No eligible completed report is available.",
  },
  {
    name: "denied reports",
    tablet: true,
    reportsAvailable: true,
    denied: true,
    latest: "valid",
    message: "Measurement and report access is not enabled for this account.",
  },
  {
    name: "unconfigured reports",
    tablet: false,
    reportsAvailable: false,
    denied: false,
    latest: "valid",
    message: "Stored reports are currently unavailable. Refresh to try again.",
  },
  {
    name: "a latest report belonging to another subject",
    tablet: false,
    reportsAvailable: true,
    denied: false,
    latest: "wrong-parent",
    message: "No eligible completed report is available.",
  },
] as const) {
  test(`resident activation with ${scenario.name} opens the subject's honest unavailable view`, async ({
    page,
  }) => {
    if (scenario.tablet)
      await page.setViewportSize({ width: 768, height: 1024 });
    const subjects = syntheticCareSubjects(1);
    const subject = subjects[0];
    if (scenario.latest === "none") subject.latestReport = null;
    if (scenario.latest === "wrong-parent")
      subject.latestReport!.subjectId = "9223372036854775805";
    const fixture = await installCareFixtures(page, {
      subjects,
      reportsAvailable: scenario.reportsAvailable,
      reportAccess: scenario.denied ? "denied" : "allowed",
    });
    await page.goto("/care");
    if (scenario.tablet) {
      const card = page
        .locator(".care-subject-card")
        .filter({ hasText: subject.tag });
      await expect(card).toHaveAttribute(
        "aria-label",
        `Open asset ${subject.tag}`,
      );
      await card
        .getByRole("heading", { name: "Bed observation", exact: true })
        .click();
    } else {
      await page
        .locator(`tr[data-row-key="${subject.id}"]`)
        .getByText(subject.label, { exact: true })
        .click();
    }
    await expect(page).toHaveURL(`/care/subjects/${subject.id}`);
    await expect(
      page.getByText(scenario.message, {
        exact: scenario.latest !== "none" && scenario.latest !== "wrong-parent",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Report graphs", exact: true }),
    ).toHaveCount(0);
    expect(fixture.calls.some((call) => call.path.includes("/reports/"))).toBe(
      false,
    );
    expect(fixture.calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(fixture.unexpected).toEqual([]);
  });
}

test("direct report URL and reload preserve exact subject/report identities", async ({
  page,
}) => {
  const fixture = await installCareFixtures(page);
  const subject = fixture.subjects[0];
  const report = subject.latestReport!;
  const url = `/care/subjects/${subject.id}/reports/${report.id}`;
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: subject.tag, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Reporting period", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Report summary", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Asset ID", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Organization ID", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText(subject.id, { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(/Dates and times shown in Europe\/Brussels\./),
  ).toBeVisible();
  await expect(
    page.locator('.care-period time[datetime="2026-10-27T05:00:00.000Z"]'),
  ).toContainText("06:00");
  await expect(
    page.getByRole("img", { name: coordinatedGraphs }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${url}$`));
  await expect(
    page.getByRole("heading", { name: "Reporting period", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: coordinatedGraphs }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Report summary", exact: true }),
  ).toHaveCount(0);
  expect(
    fixture.calls
      .filter((call) => call.path.includes("/reports/"))
      .every(
        (call) =>
          call.path ===
            `/api/care/subjects/${subject.id}/reports/${report.id}` ||
          call.path ===
            `/api/care/subjects/${subject.id}/reports/${report.id}/series`,
      ),
  ).toBe(true);
  expect(fixture.unexpected).toEqual([]);
});

test("explicit denied report never falls back to the latest report", async ({
  page,
}) => {
  const fixture = await installCareFixtures(page);
  const subject = fixture.subjects[0];
  const denied = "9223372036854775599";
  fixture.deniedReports.add(denied);
  await page.goto(`/care/subjects/${subject.id}/reports/${denied}`);
  await expect(page.getByText(/Synthetic report not found/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Reporting period", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("img", { name: coordinatedGraphs })).toHaveCount(
    0,
  );
  const reportCalls = fixture.calls.filter((call) =>
    call.path.includes("/reports/"),
  );
  expect(reportCalls.length).toBeGreaterThan(0);
  expect(
    reportCalls.every(
      (call) =>
        call.path === `/api/care/subjects/${subject.id}/reports/${denied}`,
    ),
  ).toBe(true);
  expect(fixture.unexpected).toEqual([]);
});

test("denied subject stops report fetching", async ({ page }) => {
  const fixture = await installCareFixtures(page);
  const subject = fixture.subjects[0];
  fixture.deniedSubjects.add(subject.id);
  await page.goto(
    `/care/subjects/${subject.id}/reports/${subject.latestReport!.id}`,
  );
  await expect(page.getByText(/Synthetic asset not found/)).toBeVisible();
  expect(fixture.calls.some((call) => call.path.includes("/reports/"))).toBe(
    false,
  );
  await expect(
    page.getByRole("heading", { name: "Reporting period", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("img", { name: coordinatedGraphs })).toHaveCount(
    0,
  );
  expect(fixture.unexpected).toEqual([]);
});

test("caregiver technical deep link redirects before administrator resource reads", async ({
  page,
}) => {
  const fixture = await installCareFixtures(page);
  await page.goto("/assets/new");
  await expect(page).toHaveURL(/\/care$/);
  await expect(
    page.getByRole("searchbox", { name: "Search assets", exact: true }),
  ).toBeVisible();
  expect(
    fixture.calls.some((call) => call.path.startsWith("/api/resources/")),
  ).toBe(false);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/care\/account$/);
  expect(fixture.unexpected).toEqual([]);
});

test("administrator can return from the caregiver portal to administration", async ({
  page,
}) => {
  const fixture = await installCareFixtures(page, { caregiver: false });
  await page.goto("/care");
  await page.getByRole("link", { name: "Administration", exact: true }).click();
  await expect(page).not.toHaveURL(/\/care(?:\/|$)/);
  await page.goto("/assets");
  await expect(
    page.getByRole("heading", { name: "Assets", exact: true }),
  ).toBeVisible();
  expect(
    fixture.calls.some((call) => call.path === "/api/resources/assets"),
  ).toBe(true);
  expect(fixture.unexpected).toEqual([]);
});

test("tablet overview stays readable and asset links support keyboard navigation", async ({
  page,
}, testInfo) => {
  const fixture = await installCareFixtures(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/care");
  const link = page.getByRole("link", {
    name: fixture.subjects[0].tag,
    exact: true,
  });
  await expect(link).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
  await link.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(link).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("care-overview-tablet.png"),
    fullPage: false,
  });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    new RegExp(
      `/care/subjects/${fixture.subjects[0].id}/reports/${fixture.subjects[0].latestReport!.id}$`,
    ),
  );
  await expect(
    page.getByRole("heading", { name: fixture.subjects[0].tag, exact: true }),
  ).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});
