import { expect, test, type Page } from "@playwright/test";
import { installCareFixtures } from "./care-fixtures";

test.use({ timezoneId: "Europe/Brussels" });

async function setup(page: Page, caregiver = false) {
  const fixture = await installCareFixtures(page, {
    authenticated: false,
    caregiver,
    withTrends: true,
  });
  for (const path of ["/api/services", "/api/core/outboxes", "/api/outboxes"])
    fixture.override("GET", path, { data: [] });
  const externalRequests: string[] = [];
  const origin = new URL(process.env.E2E_BASE_URL ?? "http://localhost:8080")
    .origin;
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      externalRequests.push(route.request().url());
      return route.abort("blockedbyclient");
    }
    return route.fallback();
  });
  return { fixture, externalRequests };
}

async function signIn(page: Page) {
  await page.getByLabel("Login", { exact: true }).fill("synthetic-login-user");
  await page.locator("#password").fill("SYNTHETIC-NOT-A-REAL-PASSWORD");
  await page.getByRole("button", { name: /Sign in/ }).click();
}

async function expectCareLogin(page: Page, target: string) {
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("careReturnTo")).toBe(target);
  await expect(page.locator(".login-story .brand small")).toHaveText(
    "CAREGIVER PORTAL",
  );
  await expect(
    page.getByText(
      "Sign in with your TroniCare account to continue to the caregiver portal.",
      { exact: true },
    ),
  ).toBeVisible();
}

test("an anonymous caregiver entry returns an administrator to the caregiver overview after sign-in", async ({
  page,
}) => {
  const { fixture, externalRequests } = await setup(page);
  await page.goto("/care");
  await expectCareLogin(page, "/care");
  expect(fixture.calls.some((call) => call.path.startsWith("/api/care/"))).toBe(
    false,
  );
  await signIn(page);
  await expect(page).toHaveURL(/\/care$/);
  await expect(
    page.getByRole("searchbox", { name: "Search assets", exact: true }),
  ).toBeVisible();
  expect(fixture.calls.some((call) => call.path === "/api/services")).toBe(
    false,
  );
  expect(fixture.unexpected).toEqual([]);
  expect(externalRequests).toEqual([]);
});

for (const kind of ["report", "trends", "date"] as const) {
  test(`an exact caregiver ${kind} link survives the anonymous sign-in round trip`, async ({
    page,
  }) => {
    const { fixture, externalRequests } = await setup(page);
    const subject = fixture.subjects[0],
      report = fixture.histories.get(subject.id)![0];
    const target =
      kind === "report"
        ? `/care/subjects/${subject.id}/reports/${report.id}`
        : kind === "trends"
          ? `/care/subjects/${subject.id}/trends?days=30&endDate=2026-10-28`
          : `/care/subjects/${subject.id}?date=2026-10-26`;
    await page.goto(target);
    await expectCareLogin(page, target);
    await signIn(page);
    await expect
      .poll(() => {
        const url = new URL(page.url());
        return `${url.pathname}${url.search}`;
      })
      .toBe(target);
    await expect(
      page.getByRole("heading", {
        name: kind === "trends" ? "Historical trends" : "Reporting period",
        exact: true,
      }),
    ).toBeVisible();
    if (kind === "report")
      expect(
        fixture.calls.some(
          (call) =>
            call.path ===
            `/api/care/subjects/${subject.id}/reports/${report.id}`,
        ),
      ).toBe(true);
    if (kind === "trends")
      expect(
        fixture.calls.some(
          (call) =>
            call.path === `/api/care/subjects/${subject.id}/trends` &&
            call.query.get("days") === "30" &&
            call.query.get("endDate") === "2026-10-28",
        ),
      ).toBe(true);
    if (kind === "date") {
      const selected = fixture.histories
        .get(subject.id)!
        .find((entry) => entry.period.reportDate === "2026-10-26")!;
      expect(
        fixture.calls.some(
          (call) =>
            call.path ===
            `/api/care/subjects/${subject.id}/reports/${selected.id}`,
        ),
      ).toBe(true);
    }
    expect(fixture.unexpected).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
}

test("a caregiver signing in without a return link still opens the caregiver overview", async ({
  page,
}) => {
  const { fixture, externalRequests } = await setup(page, true);
  await page.goto("/login");
  await signIn(page);
  await expect(page).toHaveURL(/\/care$/);
  await expect(
    page.getByRole("searchbox", { name: "Search assets", exact: true }),
  ).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("ordinary platform sign-in keeps the service-status landing page", async ({
  page,
}) => {
  const { fixture, externalRequests } = await setup(page);
  await page.goto("/login");
  await expect(page.locator(".login-story .brand small")).toHaveText(
    "ADMINISTRATION",
  );
  await signIn(page);
  await expect(page).toHaveURL(/\/services$/);
  await expect(
    page.getByRole("heading", { name: "Service status", exact: true }),
  ).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
  expect(externalRequests).toEqual([]);
});

for (const careIntent of [false, true]) {
  test(`an external raw to parameter is ignored ${careIntent ? "with caregiver context" : "during ordinary sign-in"}`, async ({
    page,
  }) => {
    const { fixture, externalRequests } = await setup(page);
    const params = new URLSearchParams({ to: "https://outside.invalid/steal" });
    if (careIntent) params.set("careReturnTo", "/care");
    await page.goto(`/login?${params}`);
    await signIn(page);
    await expect(page).toHaveURL(careIntent ? /\/care$/ : /\/services$/);
    if (careIntent)
      await expect(
        page.getByRole("searchbox", { name: "Search assets", exact: true }),
      ).toBeVisible();
    else
      await expect(
        page.getByRole("heading", { name: "Service status", exact: true }),
      ).toBeVisible();
    expect(externalRequests).toEqual([]);
    expect(fixture.unexpected).toEqual([]);
  });
}

for (const scenario of [
  { caregiver: true, careIntent: true, destination: "/care/account" },
  { caregiver: false, careIntent: true, destination: "/care/account" },
  { caregiver: false, careIntent: false, destination: "/account" },
]) {
  test(`password change takes priority for ${scenario.caregiver ? "caregiver" : "platform"} sign-in ${scenario.careIntent ? "with caregiver intent" : "without a return link"}`, async ({
    page,
  }) => {
    const { fixture, externalRequests } = await setup(page, scenario.caregiver);
    fixture.session.identity.mustChangePassword = true;
    const subject = fixture.subjects[0],
      report = fixture.histories.get(subject.id)![0];
    await page.goto(
      scenario.careIntent
        ? `/care/subjects/${subject.id}/reports/${report.id}`
        : "/login",
    );
    if (scenario.careIntent)
      await expectCareLogin(
        page,
        `/care/subjects/${subject.id}/reports/${report.id}`,
      );
    await signIn(page);
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe(scenario.destination);
    await expect(
      page.getByRole("heading", { name: "My account", exact: true }),
    ).toBeVisible();
    expect(
      fixture.calls.some((call) => call.path.startsWith("/api/care/")),
    ).toBe(false);
    expect(fixture.unexpected).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
}
