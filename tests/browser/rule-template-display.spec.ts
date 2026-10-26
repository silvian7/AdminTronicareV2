import { expect, test, type Page } from "@playwright/test";
import type { RecordData } from "../../shared/resources";

test.use({ locale: "en-GB", timezoneId: "Europe/Brussels" });

const templateId = "9223372036854775807";
const instanceId = "9223372036854775806";
const typeId = "9223372036854775805";
const actionId = "61";
const templateLabel = "Synthetic visible template";

function rule(id: string, label: string, flag: unknown): RecordData {
  return {
    id,
    m_nIDRule: id,
    m_nIDRuleType: typeId,
    m_nIDAsset: "0",
    m_nIDSensor: "0",
    m_sTag: `RULE-${id}`,
    m_sLabel: label,
    m_bIsTemplate: flag,
    m_bEnabled: true,
    m_bOutput: true,
    m_duValueDuree: "12501",
    m_nValueThreshold: "17",
    m_nLevel: "4",
    m_hTimeStart: "00:30:00.125",
    m_hTimeEnd: "23:45:30.007",
    m_bTime24h: false,
    m_nResetDelayMs: "1001",
    m_bResetPending: false,
    m_dhDhReset: "1970-01-01T00:00:00.000",
  };
}

async function syntheticRules(
  page: Page,
  options: { level?: number; rights?: string; writable?: boolean } = {},
) {
  const rows = [
    rule(templateId, templateLabel, true),
    rule(instanceId, "Synthetic ordinary rule", false),
    rule("41", "Synthetic nonboolean flag", "true"),
  ];
  const reads: URL[] = [];
  const mutations: {
    method: string;
    path: string;
    body: Record<string, unknown>;
  }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (request.method() !== "GET") {
      const body = request.postDataJSON() as Record<string, unknown>;
      mutations.push({ method: request.method(), path, body });
      if (path === "/api/resources/rules" && request.method() === "POST") {
        const created = { id: "43", m_nIDRule: "43", ...body };
        rows.push(created);
        return reply({ data: created });
      }
      const existing = rows.find(
        (row) => path === `/api/resources/rules/${row.id}`,
      );
      if (existing && request.method() === "PUT") {
        Object.assign(existing, body);
        return reply({ data: existing });
      }
      return reply({ message: "Unexpected synthetic mutation." }, 405);
    }
    reads.push(url);
    if (path === "/api/session")
      return reply({
        identity: {
          id: "100",
          name: "Synthetic template reader",
          organizationId: "7",
          userTypeId: String(options.level ?? 90),
          level: options.level ?? 90,
          mustChangePassword: false,
          permissions: [
            { entity: "rules", rights: options.rights ?? "crud" },
            { entity: "ruletypes", rights: "r" },
            { entity: "actions", rights: "r" },
          ],
        },
        csrf: "synthetic-template-display-csrf",
        expiresAt: Date.now() + 3_600_000,
        services: {
          rules: { configured: true, writable: options.writable ?? true },
        },
      });
    if (path === "/api/resources/rules") {
      const matching =
        url.searchParams.get("istemplate") === "true"
          ? rows.filter((row) => row.m_bIsTemplate === true)
          : rows;
      return reply({ data: matching, total: matching.length });
    }
    const existing = rows.find(
      (row) => path === `/api/resources/rules/${row.id}`,
    );
    if (existing) return reply({ data: existing });
    const type = {
      id: typeId,
      m_nIDRuleType: typeId,
      m_sTag: "SYNTHETIC-RULE-TYPE",
      m_sLabel: "Synthetic rule type",
    };
    if (path === "/api/resources/ruletypes")
      return reply({ data: [type], total: 1 });
    if (path === `/api/resources/ruletypes/${typeId}`)
      return reply({ data: type });
    if (path === `/api/resources/actions/${actionId}`)
      return reply({
        data: {
          id: actionId,
          m_nIDAction: actionId,
          m_sLabel: "Synthetic template reference action",
          m_nIDRule: templateId,
          m_nIDAsset: "0",
          m_bEnabled: true,
          m_bIsTemplate: false,
        },
      });
    // All API requests, including references and tabs, remain synthetic.
    return reply({ data: [], total: 0 });
  });
  return { rows, reads, mutations, errors };
}

function marker(page: Page) {
  return page.locator('[aria-label="Rule template"]');
}
function row(page: Page, id: string) {
  return page.locator(`tr[data-row-key="${id}"]`);
}
function detailLabel(page: Page, text: string) {
  return page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: new RegExp(`^${text}$`) });
}
async function columnIndex(page: Page, name: string) {
  return page
    .getByRole("columnheader", { name, exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
}
async function chooseType(page: Page) {
  await page
    .locator(".ant-form-item")
    .filter({ has: page.locator('[id="m_nIDRuleType"]') })
    .locator(".ant-select-selector")
    .click();
  const dropdown = page.locator(
    ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
  );
  await expect(dropdown).toHaveCount(1);
  await dropdown
    .locator(".ant-select-item-option")
    .filter({ hasText: typeId })
    .click();
}
async function screenshotAtTop(page: Page, path: string) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.scrollTo(0, 0);
        requestAnimationFrame(() => resolve());
      }),
  );
  await page.screenshot({ path, animations: "disabled" });
}

test("mixed Rules lists mark only strict templates and suppress their instance status cells", async ({
  page,
}, testInfo) => {
  const mock = await syntheticRules(page);
  await page.goto("/rules");
  await expect(row(page, templateId)).toBeVisible();
  const enabled = await columnIndex(page, "Enabled"),
    output = await columnIndex(page, "Output");
  await expect(
    row(page, templateId).locator('[aria-label="Rule template"]'),
  ).toHaveCount(1);
  for (const id of [instanceId, "41"]) {
    await expect(
      row(page, id).locator('[aria-label="Rule template"]'),
    ).toHaveCount(0);
    await expect(row(page, id).getByRole("cell").nth(enabled)).not.toHaveText(
      "—",
    );
    await expect(row(page, id).getByRole("cell").nth(output)).not.toHaveText(
      "—",
    );
  }
  await expect(row(page, templateId).getByRole("cell").nth(enabled)).toHaveText(
    "—",
  );
  await expect(row(page, templateId).getByRole("cell").nth(output)).toHaveText(
    "—",
  );
  await screenshotAtTop(
    page,
    testInfo.outputPath("rule-template-mixed-list.png"),
  );
  await row(page, templateId).getByRole("cell").nth(enabled).click();
  await expect(page).toHaveURL(new RegExp(`/rules/${templateId}$`));
  await expect(
    page.getByRole("heading", { name: templateLabel }),
  ).toBeVisible();
  await expect(marker(page)).toHaveCount(1);
  expect(mock.mutations).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test("the Templates filter removes Enabled and Output columns and keeps exact query scope", async ({
  page,
}) => {
  const mock = await syntheticRules(page, { level: 30, rights: "r" });
  await page.goto("/rules");
  await expect(row(page, instanceId)).toBeVisible();
  await page.getByRole("button", { name: /Filters$/ }).click();
  await page
    .locator(".filter-grid > label")
    .filter({ hasText: /^Templates/ })
    .locator(".ant-select-selector")
    .click({ timeout: 5000 });
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("Yes", { exact: true })
    .click();
  await expect(row(page, instanceId)).toHaveCount(0);
  await expect(row(page, templateId)).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Enabled", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "Output", exact: true }),
  ).toHaveCount(0);
  expect(
    mock.reads.some(
      (url) =>
        url.pathname === "/api/resources/rules" &&
        url.searchParams.get("istemplate") === "true" &&
        url.searchParams.get("_organization") === "7",
    ),
  ).toBe(true);
  await row(page, templateId).focus();
  await row(page, templateId).press("Enter");
  await expect(page).toHaveURL(new RegExp(`/rules/${templateId}$`));
  await expect(page.getByRole("button", { name: /Edit$/ })).toHaveCount(0);
  expect(mock.mutations).toEqual([]);
});

test("template detail hides Enabled and Output and its existing editor preserves stored Enabled", async ({
  page,
}, testInfo) => {
  const mock = await syntheticRules(page);
  await page.goto(`/rules/${templateId}`);
  await expect(marker(page)).toHaveCount(1);
  await expect(detailLabel(page, "Enabled")).toHaveCount(0);
  await expect(detailLabel(page, "Output")).toHaveCount(0);
  await expect(detailLabel(page, "Is Template")).toHaveCount(1);
  await screenshotAtTop(page, testInfo.outputPath("rule-template-detail.png"));
  await page.getByRole("button", { name: /Edit$/ }).click();
  await expect(page.getByRole("heading", { name: /Edit rule/ })).toBeVisible();
  await expect(marker(page)).toHaveCount(1);
  await expect(
    page.getByRole("switch", { name: "Enabled", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("switch", { name: "Output", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Label", { exact: true })
    .fill("Renamed synthetic template");
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/rules/${templateId}$`));
  expect(mock.mutations).toEqual([
    {
      method: "PUT",
      path: `/api/resources/rules/${templateId}`,
      body: { m_sLabel: "Renamed synthetic template" },
    },
  ]);
  expect(mock.rows[0].m_bEnabled).toBe(true);
  expect(mock.rows[0].m_bOutput).toBe(true);
});

test("switching an existing rule to a template omits a hidden Enabled draft and restores stored state when unticked", async ({
  page,
}) => {
  const mock = await syntheticRules(page);
  await page.goto(`/rules/${instanceId}/edit`);
  await expect(
    page.getByRole("switch", { name: "Enabled", exact: true }),
  ).toBeChecked();
  await expect(marker(page)).toHaveCount(0);
  await page.getByRole("switch", { name: "Enabled", exact: true }).click();
  await page.getByRole("switch", { name: "Is Template", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Enabled", exact: true }),
  ).toHaveCount(0);
  await expect(marker(page)).toHaveCount(1);
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/rules/${instanceId}$`));
  expect(mock.mutations[0]).toEqual({
    method: "PUT",
    path: `/api/resources/rules/${instanceId}`,
    body: { m_bIsTemplate: true },
  });
  expect(mock.rows[1].m_bEnabled).toBe(true);
  await page.getByRole("button", { name: /Edit$/ }).click();
  await expect(
    page.getByRole("switch", { name: "Is Template", exact: true }),
  ).toBeChecked();
  await page.getByRole("switch", { name: "Is Template", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Enabled", exact: true }),
  ).toBeChecked();
  await expect(marker(page)).toHaveCount(0);
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/rules/${instanceId}$`));
  expect(mock.mutations[1]).toEqual({
    method: "PUT",
    path: `/api/resources/rules/${instanceId}`,
    body: { m_bIsTemplate: false },
  });
});

test("a fresh template hides Enabled and sends an explicit disabled value", async ({
  page,
}, testInfo) => {
  const mock = await syntheticRules(page);
  await page.goto("/rules/new?template=true");
  await expect(
    page.getByRole("switch", { name: "Is Template", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Enabled", exact: true }),
  ).toHaveCount(0);
  await expect(marker(page)).toHaveCount(1);
  await page
    .getByLabel("Label", { exact: true })
    .fill("Synthetic new template");
  await chooseType(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await screenshotAtTop(
    page,
    testInfo.outputPath("rule-template-create-mobile.png"),
  );
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(/\/rules\/43$/);
  expect(mock.mutations).toHaveLength(1);
  expect(mock.mutations[0]).toMatchObject({
    method: "POST",
    path: "/api/resources/rules",
    body: {
      m_bIsTemplate: true,
      m_bEnabled: false,
      m_sLabel: "Synthetic new template",
      m_nIDRuleType: typeId,
    },
  });
  expect(mock.mutations[0].body).not.toHaveProperty("m_bOutput");
});

test("a dynamically selected template hides Enabled and forces false on create", async ({
  page,
}) => {
  const mock = await syntheticRules(page);
  await page.goto("/rules/new");
  const enabled = page.getByRole("switch", { name: "Enabled", exact: true });
  await expect(enabled).toBeVisible();
  await enabled.click();
  await expect(enabled).toBeChecked();
  await page.getByRole("switch", { name: "Is Template", exact: true }).click();
  await expect(enabled).toHaveCount(0);
  await expect(marker(page)).toHaveCount(1);
  await page.getByRole("switch", { name: "Is Template", exact: true }).click();
  await expect(enabled).toBeChecked();
  await expect(marker(page)).toHaveCount(0);
  await page.getByRole("switch", { name: "Is Template", exact: true }).click();
  await page
    .getByLabel("Label", { exact: true })
    .fill("Synthetic dynamically selected template");
  await chooseType(page);
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(/\/rules\/43$/);
  expect(mock.mutations[0].body).toMatchObject({
    m_bIsTemplate: true,
    m_bEnabled: false,
  });
});

test("ordinary rule instances retain Enabled and Output and permit the Enabled edit", async ({
  page,
}) => {
  const mock = await syntheticRules(page, { level: 30 });
  await page.goto(`/rules/${instanceId}`);
  await expect(detailLabel(page, "Enabled")).toHaveCount(1);
  await expect(detailLabel(page, "Output")).toHaveCount(1);
  await expect(marker(page)).toHaveCount(0);
  await page.getByRole("button", { name: /Edit$/ }).click();
  await expect(
    page.getByRole("switch", { name: "Enabled", exact: true }),
  ).toBeChecked();
  await page.getByRole("switch", { name: "Enabled", exact: true }).click();
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/rules/${instanceId}$`));
  expect(mock.mutations).toEqual([
    {
      method: "PUT",
      path: `/api/resources/rules/${instanceId}`,
      body: { m_bEnabled: false },
    },
  ]);
});

test("Rule identities show the template marker without changing Action status presentation", async ({
  page,
}) => {
  const mock = await syntheticRules(page, { level: 30 });
  await page.goto(`/actions/${actionId}`);
  await expect(
    page.getByRole("heading", {
      name: "Synthetic template reference action",
      exact: true,
    }),
  ).toBeVisible();
  const reference = detailLabel(page, "Rule").locator(
    "xpath=following-sibling::*[1]",
  );
  await expect(reference.locator('[aria-label="Rule template"]')).toHaveCount(
    1,
  );
  await expect(
    reference.getByRole("link", { name: `RULE-${templateId}`, exact: true }),
  ).toHaveAttribute("href", `/rules/${templateId}`);
  await expect(detailLabel(page, "Enabled")).toHaveCount(1);
  await reference
    .getByRole("link", { name: `RULE-${templateId}`, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/rules/${templateId}$`));
  await expect(detailLabel(page, "Enabled")).toHaveCount(0);
  expect(mock.mutations).toEqual([]);
});

for (const options of [
  { label: "read only", level: 30, rights: "r" },
  { label: "writes disabled", writable: false },
])
  test(`template presentation remains readable with ${options.label} permissions`, async ({
    page,
  }) => {
    const mock = await syntheticRules(page, options);
    await page.goto(`/rules/${templateId}`);
    await expect(marker(page)).toHaveCount(1);
    await expect(detailLabel(page, "Enabled")).toHaveCount(0);
    await expect(detailLabel(page, "Output")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Edit$/ })).toHaveCount(0);
    await page.goto(`/rules/${templateId}/edit`);
    await expect(
      page.getByText("Changes are unavailable", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Enabled", exact: true }),
    ).toHaveCount(0);
    expect(mock.mutations).toEqual([]);
  });

test("denied Rules access does not fetch or expose template metadata", async ({
  page,
}) => {
  const mock = await syntheticRules(page, { level: 30, rights: "" });
  await page.goto(`/rules/${templateId}`);
  await expect(
    page.getByText("Access unavailable", { exact: true }),
  ).toBeVisible();
  await expect(marker(page)).toHaveCount(0);
  expect(
    mock.reads.filter((url) => url.pathname.startsWith("/api/resources/rules")),
  ).toHaveLength(0);
  expect(mock.mutations).toEqual([]);
});
