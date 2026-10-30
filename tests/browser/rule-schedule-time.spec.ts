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
    permissions: [{ entity: "rules", rights: "cru" }],
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
  const records: Record<string, RecordData> = { "41": rule };
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
      if (path === "/api/resources/rules" && request.method() === "POST") {
        records["42"] = {
          id: "42",
          m_nIDRule: "42",
          m_nIDSensor: "0",
          m_nIDRuleType: "0",
          m_nIDAsset: "0",
          ...body,
        };
        return reply({ data: records["42"] });
      }
      return reply({ message: "Synthetic operation unavailable." }, 405);
    }
    const selected = records[path.split("/").at(-1)!];
    if (path.startsWith("/api/resources/rules/") && selected)
      return reply({ data: selected });
    if (path === "/api/resources/rules")
      return reply({
        data: Object.values(records),
        total: Object.keys(records).length,
      });
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
  zoneNames = { start: "CET", end: "CET" },
) {
  for (const [boundary, key] of [
    ["Start", "start"],
    ["End", "end"],
  ] as const) {
    const field = localTime(page, boundary);
    await expect(field).toHaveText(expected[key]);
    const tooltip = await field.locator("[title]").getAttribute("title");
    expect(tooltip).toContain(timezone);
    expect(tooltip).toContain(expected[key].slice(0, 8));
    expect(tooltip).toMatch(new RegExp(`\\b${zoneNames[key]}\\b`));
    expect(tooltip).not.toContain("GMT");
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
      season.label === "summer"
        ? { start: "CEST", end: "CEST" }
        : { start: "CET", end: "CET" },
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
    { start: "CET", end: "CEST" },
  );
  expect(mock.mutations).toEqual([]);
});

test.describe("rule schedule details in a New York browser", () => {
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
      { start: "01:30:00", end: "00:45:00" },
      { start: "00:30:00", end: "23:45:00" },
      "Europe/Brussels",
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

test("editing a rule shows local times and saving another field preserves stored UTC times and milliseconds", async ({
  page,
}) => {
  const mock = await mockRuleSchedule(
    page,
    "2026-07-15T12:00:00.000Z",
    "00:30:00.123",
    "23:45:30.007",
  );
  await page.goto("/rules/41");
  await expect(localTime(page, "Start")).toHaveText("02:30:00.123");
  await expect(localTime(page, "End")).toHaveText("01:45:30.007");
  await page.getByRole("button", { name: /Edit$/ }).click();
  await expect(
    page.getByLabel("Start time (local)", { exact: true }),
  ).toHaveValue("02:30:00.123");
  await expect(
    page.getByLabel("End time (local)", { exact: true }),
  ).toHaveValue("01:45:30.007");
  await expect(
    page.getByLabel("Start time (local)", { exact: true }),
  ).toHaveAttribute("step", "0.001");
  await expect(
    page.getByLabel("End time (local)", { exact: true }),
  ).toHaveAttribute("step", "0.001");
  await expect(
    page.getByLabel("Start time (UTC)", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("End time (UTC)", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByLabel("Label", { exact: true })
    .fill("Synthetic renamed schedule rule");
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(/\/rules\/41$/);
  await expect(localTime(page, "Start")).toHaveText("02:30:00.123");
  await expect(localTime(page, "End")).toHaveText("01:45:30.007");
  expect(mock.mutations).toEqual([
    {
      method: "PUT",
      path: "/api/resources/rules/41",
      body: { m_sLabel: "Synthetic renamed schedule rule" },
      csrf: "synthetic-rule-schedule-csrf",
    },
  ]);
});

for (const season of [
  {
    name: "winter",
    now: "2026-01-15T12:00:00.000Z",
    start: "07:15:30.125",
    end: "21:45:00.007",
  },
  {
    name: "summer",
    now: "2026-07-15T12:00:00.000Z",
    start: "06:15:30.125",
    end: "20:45:00.007",
  },
])
  test(`edited local schedule times are stored as exact UTC times in Brussels ${season.name}`, async ({
    page,
  }, testInfo) => {
    const mock = await mockRuleSchedule(
      page,
      season.now,
      "00:30:00",
      "23:45:30",
    );
    await page.goto("/rules/41/edit");
    await page
      .getByLabel("Start time (local)", { exact: true })
      .fill("08:15:30.125");
    await page
      .getByLabel("End time (local)", { exact: true })
      .fill("22:45:00.007");
    if (season.name === "summer") {
      await page
        .getByLabel("Start time (local)", { exact: true })
        .evaluate((input) => input.scrollIntoView({ block: "center" }));
      await page.screenshot({
        path: testInfo.outputPath("rule-schedule-local-edit.png"),
        animations: "disabled",
      });
    }
    await page.getByRole("button", { name: /Save rule$/ }).click();
    await expect(page).toHaveURL(/\/rules\/41$/);
    await expect(localTime(page, "Start")).toHaveText("08:15:30.125");
    await expect(localTime(page, "End")).toHaveText("22:45:00.007");
    expect(mock.mutations).toEqual([
      {
        method: "PUT",
        path: "/api/resources/rules/41",
        body: { m_hTimeStart: season.start, m_hTimeEnd: season.end },
        csrf: "synthetic-rule-schedule-csrf",
      },
    ]);
  });

test.describe("editing Brussels schedule times in a New York browser", () => {
  test.use({ timezoneId: "America/New_York" });

  test("local edits crossing midnight are saved as UTC time-of-day values", async ({
    page,
  }) => {
    const mock = await mockRuleSchedule(
      page,
      "2026-01-15T02:00:00.000Z",
      "00:30:00",
      "23:45:00",
    );
    await page.goto("/rules/41/edit");
    const start = page.getByLabel("Start time (local)", { exact: true });
    const end = page.getByLabel("End time (local)", { exact: true });
    await expect(start).toHaveValue("01:30:00");
    await expect(end).toHaveValue("00:45:00");
    await start.fill("20:15:30.125");
    await end.fill("00:15:00.500");
    await page.getByRole("button", { name: /Save rule$/ }).click();
    await expect(page).toHaveURL(/\/rules\/41$/);
    await expect(localTime(page, "Start")).toHaveText("20:15:30.125");
    await expect(localTime(page, "End")).toHaveText("00:15:00.500");
    expect(mock.mutations.map(({ body }) => body)).toEqual([
      { m_hTimeStart: "19:15:30.125", m_hTimeEnd: "23:15:00.500" },
    ]);
  });
});

test("a nonexistent DST local time is rejected using the editor's initial schedule date after midnight", async ({
  page,
}) => {
  const mock = await mockRuleSchedule(
    page,
    "2026-03-29T23:50:00.000Z",
    "00:30:00",
    "02:30:00",
  );
  await page.goto("/rules/41/edit");
  const start = page.getByLabel("Start time (local)", { exact: true });
  await expect(start).toHaveValue("01:30:00");
  await page.clock.setFixedTime(new Date("2026-03-30T00:10:00.000Z"));
  await start.fill("02:30:00");
  await page.getByRole("button", { name: /Save rule$/ }).click();
  const item = page.locator(".ant-form-item").filter({ has: start });
  await expect(
    item.getByText("Enter a valid local time for the schedule date.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/rules\/41\/edit$/);
  await expect(start).toHaveValue("02:30:00");
  expect(mock.mutations).toEqual([]);
});

test("unchanged local times in the autumn DST overlap preserve each original UTC occurrence", async ({
  page,
}) => {
  const mock = await mockRuleSchedule(
    page,
    "2026-10-25T12:00:00.000Z",
    "01:30:00.125",
    "00:30:00.125",
  );
  await page.goto("/rules/41/edit");
  for (const label of ["Start time (local)", "End time (local)"])
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(
      "02:30:00.125",
    );
  await page
    .getByLabel("Label", { exact: true })
    .fill("Synthetic unchanged overlap schedule");
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(/\/rules\/41$/);
  await expect(localTime(page, "Start")).toHaveText("02:30:00.125");
  await expect(localTime(page, "End")).toHaveText("02:30:00.125");
  expect(mock.mutations.map(({ body }) => body)).toEqual([
    { m_sLabel: "Synthetic unchanged overlap schedule" },
  ]);
});

test("new rules accept local schedule times and post UTC times with milliseconds", async ({
  page,
}) => {
  const mock = await mockRuleSchedule(
    page,
    "2026-07-15T12:00:00.000Z",
    "00:30:00",
    "23:45:00",
  );
  await page.goto("/rules/new");
  await page
    .getByLabel("Label", { exact: true })
    .fill("Synthetic created local schedule");
  await page
    .getByLabel("Start time (local)", { exact: true })
    .fill("08:00:00.123");
  await page.getByLabel("End time (local)", { exact: true }).fill("23:45:30");
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(/\/rules\/42$/);
  await expect(localTime(page, "Start")).toHaveText("08:00:00.123");
  await expect(localTime(page, "End")).toHaveText("23:45:30");
  expect(mock.mutations).toEqual([
    {
      method: "POST",
      path: "/api/resources/rules",
      body: {
        m_sLabel: "Synthetic created local schedule",
        m_hTimeStart: "06:00:00.123",
        m_hTimeEnd: "21:45:30",
      },
      csrf: "synthetic-rule-schedule-csrf",
    },
  ]);
});
