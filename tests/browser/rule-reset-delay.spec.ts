import { expect, test, type Page } from "@playwright/test";
import type { Identity, RecordData } from "../../shared/resources";

const ruleLabel = "Synthetic reset delay rule";
const resetDelayLabel = "Reset delay (seconds)";

async function mockRuleResetDelay(
  page: Page,
  options: { rights?: string; writable?: boolean } = {},
) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic reset delay administrator",
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [{ entity: "rules", rights: options.rights ?? "cru" }],
  };
  const rules: RecordData[] = [
    {
      id: "41",
      m_nIDRule: "41",
      m_nIDRuleType: "0",
      m_nIDAsset: "0",
      m_nIDSensor: "0",
      m_sLabel: ruleLabel,
      m_duValueDuree: "12500",
      m_nResetDelayMs: "45000",
      m_bResetPending: true,
      m_dhDhReset: "2026-10-16T12:00:00.000",
      m_bEnabled: true,
      m_bOutput: false,
    },
    {
      id: "42",
      m_nIDRule: "42",
      m_nIDRuleType: "0",
      m_nIDAsset: "0",
      m_nIDSensor: "0",
      m_sLabel: "Synthetic immediate reset rule",
      m_duValueDuree: "0",
      m_nResetDelayMs: "0",
      m_bResetPending: false,
      m_dhDhReset: "1970-01-01T00:00:00.000",
    },
  ];
  const mutations: {
    method: string;
    path: string;
    body: unknown;
    csrf?: string;
  }[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-rule-reset-delay-csrf",
        expiresAt: Date.now() + 60 * 60_000,
        services: {
          rules: { configured: true, writable: options.writable ?? true },
        },
      });
    if (request.method() !== "GET") {
      const body = request.postDataJSON();
      mutations.push({
        method: request.method(),
        path,
        body,
        csrf: request.headers()["x-csrf-token"],
      });
      const rule = rules.find(
        (record) => path === `/api/resources/rules/${record.id}`,
      );
      if (rule && request.method() === "PUT") {
        Object.assign(rule, body);
        return reply({ data: rule });
      }
      if (path === "/api/resources/rules" && request.method() === "POST") {
        const created: RecordData = {
          id: "43",
          m_nIDRule: "43",
          m_nIDRuleType: "0",
          m_nIDAsset: "0",
          m_nIDSensor: "0",
          ...body,
        };
        rules.push(created);
        return reply({ data: created });
      }
      return reply({ message: "Synthetic operation unavailable." }, 405);
    }
    if (path === "/api/resources/rules")
      return reply({ data: rules, total: rules.length });
    const rule = rules.find(
      (record) => path === `/api/resources/rules/${record.id}`,
    );
    if (rule) return reply({ data: rule });
    // Every API request, including reference selectors and tabs, is synthetic.
    return reply({ data: [], total: 0 });
  });
  return {
    mutations,
    setDurations: (duration: unknown, resetDelay: unknown, label: string) => {
      rules[0].m_duValueDuree = duration;
      rules[0].m_nResetDelayMs = resetDelay;
      rules[0].m_sLabel = label;
    },
  };
}

function detailResetDelay(page: Page) {
  return page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: /^Reset delay \(seconds\)$/ })
    .locator("xpath=following-sibling::*[1]");
}

function detailDuration(page: Page) {
  return page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: /^Duration \(seconds\)$/ })
    .locator("xpath=following-sibling::*[1]");
}

async function openRuleEditor(page: Page) {
  await page.goto("/rules/41");
  await expect(
    page.getByRole("heading", { name: ruleLabel, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Edit$/ }).click();
  const delay = page.getByLabel(resetDelayLabel, { exact: true });
  await expect(delay).toHaveValue("45");
  return delay;
}

test("rule details show reset delay and duration in seconds, including immediate reset", async ({
  page,
}) => {
  const mock = await mockRuleResetDelay(page);
  await page.goto("/rules/41");
  await expect(detailResetDelay(page)).toHaveText("45");
  await expect(detailDuration(page)).toHaveText("12.5");
  await page.goto("/rules/42");
  await expect(detailResetDelay(page)).toHaveText("0");
  await expect(detailDuration(page)).toHaveText("0");
  await expect(
    page
      .locator(".ant-descriptions-item-label")
      .filter({ hasText: /^Reset at$/ })
      .locator("xpath=following-sibling::*[1]"),
  ).toHaveText("—");
  expect(mock.mutations).toEqual([]);
});

test("duration displays preserve fractional seconds and exact large millisecond values without writes", async ({
  page,
}, testInfo) => {
  const mock = await mockRuleResetDelay(page);
  await page.goto("/rules/41");
  await expect(detailDuration(page)).toHaveText("12.5");
  for (const [name, duration, resetDelay, seconds, resetSeconds] of [
    ["fractional", "12501", "1001", "12.501", "1.001"],
    ["zero", "0", "0", "0", "0"],
    ["large", "9223372036854775807", "1", "9223372036854775.807", "0.001"],
    ["absent", undefined, null, "—", "—"],
    ["null", null, undefined, "—", "—"],
  ]) {
    const label = `Synthetic ${name} duration rule`;
    mock.setDurations(duration, resetDelay, label);
    await page.getByRole("button", { name: /Refresh$/ }).click();
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
    await expect(detailDuration(page)).toHaveText(seconds!);
    await expect(detailResetDelay(page)).toHaveText(resetSeconds!);
    if (name === "fractional")
      await page.screenshot({
        path: testInfo.outputPath("rule-duration-seconds.png"),
        fullPage: true,
        animations: "disabled",
      });
  }
  expect(mock.mutations).toEqual([]);
});

test("reset delay can be edited and saved without submitting runtime reset state", async ({
  page,
}, testInfo) => {
  const mock = await mockRuleResetDelay(page);
  const delay = await openRuleEditor(page);
  const duration = page.getByLabel("Duration (seconds)", { exact: true });
  await expect(duration).toHaveValue("12.5");
  await expect(duration).toHaveAttribute("inputmode", "decimal");
  await expect(delay).toHaveAttribute("inputmode", "decimal");
  await expect(
    page.getByText(
      "Time the input must remain normal before the rule resets. 0 resets immediately; maximum 7 days.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator("#m_bResetPending, #m_dhDhReset")).toHaveCount(0);
  await delay.fill("60");
  await delay.evaluate((input) => input.scrollIntoView({ block: "center" }));
  await page.screenshot({
    path: testInfo.outputPath("rule-reset-delay-edit.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(/\/rules\/41$/);
  await expect(detailResetDelay(page)).toHaveText("60");
  await expect(detailDuration(page)).toHaveText("12.5");
  expect(mock.mutations).toEqual([
    {
      method: "PUT",
      path: "/api/resources/rules/41",
      body: { m_nResetDelayMs: "60000" },
      csrf: "synthetic-rule-reset-delay-csrf",
    },
  ]);
});

test("zero reset delay is accepted and saved as immediate reset", async ({
  page,
}) => {
  const mock = await mockRuleResetDelay(page);
  const delay = await openRuleEditor(page);
  await delay.fill("0");
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(detailResetDelay(page)).toHaveText("0");
  expect(mock.mutations.map(({ body }) => body)).toEqual([
    { m_nResetDelayMs: "0" },
  ]);
});

test("reset delays outside the allowed range are blocked while the seven-day maximum can be saved", async ({
  page,
}) => {
  const mock = await mockRuleResetDelay(page);
  const delay = await openRuleEditor(page);
  const formItem = page.locator(".ant-form-item").filter({ has: delay });
  const save = page.getByRole("button", { name: /Save rule$/ });
  for (const [value, message] of [
    ["604800.001", "Enter a value from 0 to 604800 seconds."],
    ["-1", "Enter a value from 0 to 604800 seconds."],
    ["1.0001", "Enter seconds with at most 3 decimal places."],
  ]) {
    await delay.fill(value);
    await save.click();
    await expect(formItem.getByText(message, { exact: true })).toBeVisible();
    await expect(delay).toHaveValue(value);
    await expect(page).toHaveURL(/\/rules\/41\/edit$/);
    expect(mock.mutations).toEqual([]);
  }
  await delay.fill("604800");
  await save.click();
  await expect(page).toHaveURL(/\/rules\/41$/);
  await expect(detailResetDelay(page)).toHaveText("604800");
  expect(mock.mutations.map(({ body }) => body)).toEqual([
    { m_nResetDelayMs: "604800000" },
  ]);
});

test("fractional duration and reset seconds are saved as exact integer milliseconds", async ({
  page,
}) => {
  const mock = await mockRuleResetDelay(page);
  const delay = await openRuleEditor(page);
  await page.getByLabel("Duration (seconds)", { exact: true }).fill("1.501");
  await delay.fill("0.001");
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(/\/rules\/41$/);
  await expect(detailDuration(page)).toHaveText("1.501");
  await expect(detailResetDelay(page)).toHaveText("0.001");
  expect(mock.mutations).toEqual([
    {
      method: "PUT",
      path: "/api/resources/rules/41",
      body: { m_duValueDuree: "1501", m_nResetDelayMs: "1" },
      csrf: "synthetic-rule-reset-delay-csrf",
    },
  ]);
});

test("editing another field preserves the exact maximum int64 duration without submitting it again", async ({
  page,
}) => {
  const mock = await mockRuleResetDelay(page);
  mock.setDurations("9223372036854775807", "45000", ruleLabel);
  await openRuleEditor(page);
  await expect(
    page.getByLabel("Duration (seconds)", { exact: true }),
  ).toHaveValue("9223372036854775.807");
  await page
    .getByLabel("Label", { exact: true })
    .fill("Synthetic renamed duration rule");
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(/\/rules\/41$/);
  await expect(detailDuration(page)).toHaveText("9223372036854775.807");
  await expect(detailResetDelay(page)).toHaveText("45");
  expect(mock.mutations.map(({ body }) => body)).toEqual([
    { m_sLabel: "Synthetic renamed duration rule" },
  ]);
});

test("creating a rule accepts seconds and posts stored millisecond durations", async ({
  page,
}) => {
  const mock = await mockRuleResetDelay(page);
  await page.goto("/rules/new");
  await expect(
    page.getByRole("heading", { name: "Add rule", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Label", { exact: true })
    .fill("Synthetic created duration rule");
  await page.getByLabel("Duration (seconds)", { exact: true }).fill("1.501");
  await page.getByLabel(resetDelayLabel, { exact: true }).fill("60");
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(/\/rules\/43$/);
  await expect(detailDuration(page)).toHaveText("1.501");
  await expect(detailResetDelay(page)).toHaveText("60");
  expect(mock.mutations).toEqual([
    {
      method: "POST",
      path: "/api/resources/rules",
      body: {
        m_sLabel: "Synthetic created duration rule",
        m_duValueDuree: "1501",
        m_nResetDelayMs: "60000",
      },
      csrf: "synthetic-rule-reset-delay-csrf",
    },
  ]);
});

for (const restriction of [
  "read-only rule permission",
  "service writes disabled",
])
  test(`reset delay remains readable without editing with ${restriction}`, async ({
    page,
  }) => {
    const mock = await mockRuleResetDelay(page, {
      rights: restriction === "read-only rule permission" ? "r" : "ru",
      writable: restriction !== "service writes disabled",
    });
    await page.goto("/rules/41");
    await expect(detailResetDelay(page)).toHaveText("45");
    await expect(page.getByRole("button", { name: /Edit$/ })).toHaveCount(0);
    await page.goto("/rules/41/edit");
    await expect(
      page.getByText("Changes are unavailable", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel(resetDelayLabel, { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /Save rule$/ })).toHaveCount(
      0,
    );
    expect(mock.mutations).toEqual([]);
  });
