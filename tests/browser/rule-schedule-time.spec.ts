import { expect, test, type Page } from "@playwright/test";
import type { Identity, RecordData } from "../../shared/resources";

test.use({ locale: "en-GB", timezoneId: "Europe/Brussels" });

const ruleLabel = "Synthetic local schedule rule";

async function mockRuleSchedule(
  page: Page,
  now: string,
  start: unknown,
  end: unknown,
) {
  const clock = new Date(now);
  await page.clock.install({ time: clock });
  await page.clock.setFixedTime(clock);
  const identity: Identity = {
    id: "100",
    name: "Synthetic schedule administrator",
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [{ entity: "rules", rights: "ru" }],
  };
  const rule: RecordData = {
    id: "41",
    m_nIDRule: "41",
    m_nIDRuleType: "0",
    m_nIDAsset: "0",
    m_nIDSensor: "0",
    m_sLabel: ruleLabel,
    m_hTimeStart: start,
    m_hTimeEnd: end,
    // The schedule's current UTC date must determine DST, even for an old rule.
    m_dhDhCreated: "2020-01-15T12:00:00.000",
    m_bEnabled: true,
    m_bTime24h: false,
  };
  const mutations: {
    method: string;
    path: string;
    body: unknown;
    csrf?: string;
  }[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-rule-schedule-csrf",
        expiresAt: clock.getTime() + 60 * 60_000,
      });
    if (request.method() !== "GET") {
      const body = request.postDataJSON();
      mutations.push({
        method: request.method(),
        path,
        body,
        csrf: request.headers()["x-csrf-token"],
      });
      if (path === "/api/resources/rules/41" && request.method() === "PUT") {
        Object.assign(rule, body);
        return reply({ data: rule });
      }
      return reply({ message: "Synthetic operation unavailable." }, 405);
    }
    if (path === "/api/resources/rules/41") return reply({ data: rule });
    if (path === "/api/resources/rules")
      return reply({ data: [rule], total: 1 });
    // Every API request, including selectors and unrelated tabs, is synthetic.
    return reply({ data: [], total: 0 });
  });
  return {
    mutations,
    setTimes: (start: unknown, end: unknown) => {
      rule.m_hTimeStart = start;
      rule.m_hTimeEnd = end;
    },
  };
}

function localTime(page: Page, boundary: "Start" | "End") {
  return page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: new RegExp(`^${boundary} time \\(local\\)$`) })
    .locator("xpath=following-sibling::*[1]");
}

async function expectSchedule(
  page: Page,
  expected: { start: string; end: string },
  raw: { start: string; end: string },
  timezone: string,
  anchorDate: string,
) {
  for (const [boundary, key] of [
    ["Start", "start"],
    ["End", "end"],
  ] as const) {
    const field = localTime(page, boundary);
    await expect(field).toHaveText(expected[key]);
    const tooltip = await field.locator("[title]").getAttribute("title");
    expect(tooltip).toContain(timezone);
    expect(tooltip).toContain(raw[key]);
    expect(tooltip).toContain(anchorDate);
    await expect(field.locator("time")).toHaveAttribute(
      "datetime",
      new Date(`${anchorDate}T${raw[key]}Z`).toISOString(),
    );
  }
}

for (const season of [
  {
    label: "winter",
    now: "2026-01-15T12:00:00.000Z",
    start: "22:30:45.123",
    end: "23:00:00",
    localStart: "23:30:45.123",
    localEnd: "00:00:00",
  },
  {
    label: "summer",
    now: "2026-07-15T12:00:00.000Z",
    start: "00:30:00",
    end: "12:34:56.987",
    localStart: "02:30:00",
    localEnd: "14:34:56.987",
  },
])
  test(`rule schedule details use the current ${season.label} date for Brussels local time`, async ({
    page,
  }, testInfo) => {
    const mock = await mockRuleSchedule(
      page,
      season.now,
      season.start,
      season.end,
    );
    await page.goto("/rules/41");
    await expectSchedule(
      page,
      { start: season.localStart, end: season.localEnd },
      { start: season.start, end: season.end },
      "Europe/Brussels",
      season.now.slice(0, 10),
    );
    if (season.label === "summer")
      await page.screenshot({
        path: testInfo.outputPath("rule-schedule-local.png"),
        fullPage: true,
        animations: "disabled",
      });
    expect(mock.mutations).toEqual([]);
  });

test("schedule times on the DST transition day use the offset at each UTC time", async ({
  page,
}) => {
  const mock = await mockRuleSchedule(
    page,
    "2026-03-29T12:00:00.000Z",
    "00:30:00",
    "02:30:00",
  );
  await page.goto("/rules/41");
  await expectSchedule(
    page,
    { start: "01:30:00", end: "04:30:00" },
    { start: "00:30:00", end: "02:30:00" },
    "Europe/Brussels",
    "2026-03-29",
  );
  expect(mock.mutations).toEqual([]);
});

test.describe("rule schedule details in New York", () => {
  test.use({ timezoneId: "America/New_York" });

  test("UTC today anchors the conversion when the browser's local date is still yesterday", async ({
    page,
  }) => {
    const mock = await mockRuleSchedule(
      page,
      "2026-01-15T02:00:00.000Z",
      "00:30:00",
      "23:45:00",
    );
    await page.goto("/rules/41");
    await expectSchedule(
      page,
      { start: "19:30:00", end: "18:45:00" },
      { start: "00:30:00", end: "23:45:00" },
      "America/New_York",
      "2026-01-15",
    );
    expect(mock.mutations).toEqual([]);
  });
});

test("UTC midnight is a valid schedule while missing and invalid times remain unavailable", async ({
  page,
}) => {
  const mock = await mockRuleSchedule(
    page,
    "2026-01-15T12:00:00.000Z",
    "00:00:00",
    "23:59:59.999",
  );
  await page.goto("/rules/41");
  await expectSchedule(
    page,
    { start: "01:00:00", end: "00:59:59.999" },
    { start: "00:00:00", end: "23:59:59.999" },
    "Europe/Brussels",
    "2026-01-15",
  );
  async function refresh() {
    const updated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/resources/rules/41",
    );
    await page.getByRole("button", { name: /Refresh$/ }).click();
    await updated;
  }
  for (const [start, end] of [
    [undefined, null],
    ["", "not-a-time"],
    ["24:00:00", "12:60:00"],
    ["12:00:60", "12:30"],
  ]) {
    mock.setTimes(start, end);
    await refresh();
    await expect(localTime(page, "Start")).toHaveText("—");
    await expect(localTime(page, "End")).toHaveText("—");
    mock.setTimes("00:00:00", "23:59:59.999");
    await refresh();
    await expect(localTime(page, "Start")).toHaveText("01:00:00");
    await expect(localTime(page, "End")).toHaveText("00:59:59.999");
  }
  expect(mock.mutations).toEqual([]);
});

test("editing a rule retains stored UTC times and saving another field does not submit local conversions", async ({
  page,
}) => {
  const mock = await mockRuleSchedule(
    page,
    "2026-07-15T12:00:00.000Z",
    "00:30:00",
    "23:45:30",
  );
  await page.goto("/rules/41");
  await expect(localTime(page, "Start")).toHaveText("02:30:00");
  await expect(localTime(page, "End")).toHaveText("01:45:30");
  await page.getByRole("button", { name: /Edit$/ }).click();
  await expect(
    page.getByLabel("Start time (UTC)", { exact: true }),
  ).toHaveValue("00:30:00");
  await expect(page.getByLabel("End time (UTC)", { exact: true })).toHaveValue(
    "23:45:30",
  );
  await expect(
    page.getByLabel("Start time (local)", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("End time (local)", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Label", { exact: true })
    .fill("Synthetic renamed schedule rule");
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(/\/rules\/41$/);
  await expect(localTime(page, "Start")).toHaveText("02:30:00");
  await expect(localTime(page, "End")).toHaveText("01:45:30");
  expect(mock.mutations).toEqual([
    {
      method: "PUT",
      path: "/api/resources/rules/41",
      body: { m_sLabel: "Synthetic renamed schedule rule" },
      csrf: "synthetic-rule-schedule-csrf",
    },
  ]);
});
