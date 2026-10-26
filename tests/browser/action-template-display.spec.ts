import { expect, test, type Page } from "@playwright/test";
import type { RecordData } from "../../shared/resources";

test.use({ locale: "en-GB" });

const templateId = "9223372036854775807";
const instanceId = "9223372036854775806";
const typeId = "9223372036854775805";
const assetId = "9223372036854775804";
const otherAssetId = "9223372036854775803";
const ruleId = "9223372036854775802";
const templateLabel = "Synthetic visible action template";

function action(id: string, label: string, flag: unknown): RecordData {
  return {
    id,
    m_nIDAction: id,
    m_nIDActionType: typeId,
    m_nIDAsset: assetId,
    m_nIDRule: ruleId,
    m_sTag: `ACTION-${id}`,
    m_sLabel: label,
    m_bIsTemplate: flag,
    m_bEnabled: true,
    m_nLevel: "4",
    m_sRecipient: "synthetic@example.test",
    m_sSubjectText: "Synthetic subject",
    m_sBodyText: "Synthetic message\nSecond line",
  };
}

async function syntheticActions(
  page: Page,
  options: { level?: number; rights?: string; writable?: boolean } = {},
) {
  const rows = [
    action(templateId, templateLabel, true),
    action(instanceId, "Synthetic ordinary action", false),
    action("41", "Synthetic nonboolean flag", "true"),
  ];
  const assets = [
    {
      id: assetId,
      m_nIDAsset: assetId,
      m_nIDOrganization: "7",
      m_sTag: "LEGACY-ASSET",
      m_sLabel: "Synthetic retained asset",
    },
    {
      id: otherAssetId,
      m_nIDAsset: otherAssetId,
      m_nIDOrganization: "7",
      m_sTag: "OTHER-ASSET",
      m_sLabel: "Synthetic other asset",
    },
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
    const reply = (value: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(value),
      });
    if (request.method() !== "GET") {
      const body = request.postDataJSON() as Record<string, unknown>;
      mutations.push({ method: request.method(), path, body });
      if (path === "/api/resources/actions" && request.method() === "POST") {
        const created = { id: "43", m_nIDAction: "43", ...body };
        rows.push(created);
        return reply({ data: created });
      }
      const existing = rows.find(
        (row) => path === `/api/resources/actions/${row.id}`,
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
          name: "Synthetic action template reader",
          organizationId: "7",
          userTypeId: String(options.level ?? 90),
          level: options.level ?? 90,
          mustChangePassword: false,
          permissions: [
            { entity: "actions", rights: options.rights ?? "crud" },
            { entity: "actiontypes", rights: "r" },
            { entity: "assets", rights: "r" },
            { entity: "rules", rights: "r" },
          ],
        },
        csrf: "synthetic-action-display-csrf",
        expiresAt: Date.now() + 3_600_000,
        services: {
          actions: { configured: true, writable: options.writable ?? true },
        },
      });
    if (path === "/api/resources/actions") {
      const matching =
        url.searchParams.get("istemplate") === "true"
          ? rows.filter((row) => row.m_bIsTemplate === true)
          : rows;
      return reply({ data: matching, total: matching.length });
    }
    const existing = rows.find(
      (row) => path === `/api/resources/actions/${row.id}`,
    );
    if (existing) return reply({ data: existing });
    if (path === "/api/resources/assets")
      return reply({ data: assets, total: assets.length });
    const asset = assets.find(
      (row) => path === `/api/resources/assets/${row.id}`,
    );
    if (asset) return reply({ data: asset });
    const type = {
      id: typeId,
      m_nIDActionType: typeId,
      m_sTag: "SYNTHETIC-ACTION-TYPE",
      m_sLabel: "Synthetic action type",
    };
    if (path === "/api/resources/actiontypes")
      return reply({ data: [type], total: 1 });
    if (path === `/api/resources/actiontypes/${typeId}`)
      return reply({ data: type });
    const rule = {
      id: ruleId,
      m_nIDRule: ruleId,
      m_nIDAsset: assetId,
      m_bIsTemplate: false,
      m_sTag: "RULE-PARENT",
      m_sLabel: "Synthetic existing parent rule",
    };
    if (path === "/api/resources/rules")
      return reply({ data: [rule], total: 1 });
    if (path === `/api/resources/rules/${ruleId}`) return reply({ data: rule });
    // Every API request is mocked, including optional references and tabs.
    return reply({ data: [], total: 0 });
  });
  return { rows, reads, mutations, errors };
}

function marker(page: Page) {
  return page.locator('[aria-label="Action template"]');
}
function row(page: Page, id: string) {
  return page.locator(`tr[data-row-key="${id}"]`);
}
function detailLabel(page: Page, text: string) {
  return page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: new RegExp(`^${text}$`) });
}
function fieldItem(page: Page, key: string) {
  return page
    .locator(".ant-form-item")
    .filter({ has: page.locator(`[id="${key}"]`) });
}
async function columnIndex(page: Page, name: string) {
  return page
    .getByRole("columnheader", { name, exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
}
async function selectReference(
  page: Page,
  key: "m_nIDAsset" | "m_nIDRule" | "m_nIDActionType",
  id: string,
) {
  await fieldItem(page, key)
    .locator(".ant-select-selector")
    .click({ timeout: 5000 });
  const dropdown = page.locator(
    ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
  );
  await expect(dropdown).toHaveCount(1);
  await dropdown
    .locator(".ant-select-item-option")
    .filter({ hasText: id })
    .click();
}
async function expectHiddenFields(page: Page) {
  await expect(
    page.getByRole("switch", { name: "Enabled", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[id="m_nIDAsset"]')).toHaveCount(0);
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

test("mixed Actions lists mark strict templates and hide their Asset and Enabled values", async ({
  page,
}, testInfo) => {
  const mock = await syntheticActions(page);
  await page.goto("/actions");
  await expect(row(page, templateId)).toBeVisible();
  const enabled = await columnIndex(page, "Enabled"),
    asset = await columnIndex(page, "Asset");
  await expect(
    row(page, templateId).locator('[aria-label="Action template"]'),
  ).toHaveCount(1);
  await expect(row(page, templateId).getByRole("cell").nth(enabled)).toHaveText(
    "—",
  );
  await expect(row(page, templateId).getByRole("cell").nth(asset)).toHaveText(
    "—",
  );
  for (const id of [instanceId, "41"]) {
    await expect(
      row(page, id).locator('[aria-label="Action template"]'),
    ).toHaveCount(0);
    await expect(row(page, id).getByRole("cell").nth(enabled)).not.toHaveText(
      "—",
    );
    await expect(row(page, id).getByRole("cell").nth(asset)).toContainText(
      "LEGACY-ASSET",
    );
  }
  await screenshotAtTop(
    page,
    testInfo.outputPath("action-template-mixed-list.png"),
  );
  await row(page, templateId).getByRole("cell").nth(enabled).click();
  await expect(page).toHaveURL(new RegExp(`/actions/${templateId}$`));
  await expect(marker(page)).toHaveCount(1);
  expect(mock.mutations).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test("the Action Templates filter removes Asset and Enabled columns while retaining scoped readable rows", async ({
  page,
}) => {
  const mock = await syntheticActions(page, { level: 30, rights: "r" });
  await page.goto("/actions");
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
  for (const name of ["Asset", "Enabled"])
    await expect(
      page.getByRole("columnheader", { name, exact: true }),
    ).toHaveCount(0);
  expect(
    mock.reads.some(
      (url) =>
        url.pathname === "/api/resources/actions" &&
        url.searchParams.get("istemplate") === "true" &&
        url.searchParams.get("_organization") === "7",
    ),
  ).toBe(true);
  await row(page, templateId).focus();
  await row(page, templateId).press("Enter");
  await expect(page).toHaveURL(new RegExp(`/actions/${templateId}$`));
  await expect(page.getByRole("button", { name: /Edit$/ })).toHaveCount(0);
  expect(mock.mutations).toEqual([]);
});

test("template detail and editing hide Asset and Enabled while preserving legacy stored values", async ({
  page,
}, testInfo) => {
  const mock = await syntheticActions(page);
  await page.goto(`/actions/${templateId}`);
  await expect(marker(page)).toHaveCount(1);
  for (const name of ["Asset", "Enabled"])
    await expect(detailLabel(page, name)).toHaveCount(0);
  await expect(detailLabel(page, "Rule")).toHaveCount(1);
  await screenshotAtTop(
    page,
    testInfo.outputPath("action-template-detail.png"),
  );
  await page.getByRole("button", { name: /Edit$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Edit action", exact: true }),
  ).toBeVisible();
  await expect(marker(page)).toHaveCount(1);
  await expectHiddenFields(page);
  await expect(page.locator('[id="m_nIDRule"]')).toBeVisible();
  await page
    .getByLabel("Label", { exact: true })
    .fill("Renamed synthetic action template");
  await page.getByRole("button", { name: /Save action$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/actions/${templateId}$`));
  expect(mock.mutations).toEqual([
    {
      method: "PUT",
      path: `/api/resources/actions/${templateId}`,
      body: { m_sLabel: "Renamed synthetic action template" },
    },
  ]);
  expect(mock.rows[0].m_bEnabled).toBe(true);
  expect(mock.rows[0].m_nIDAsset).toBe(assetId);
  expect(mock.rows[0].m_nIDRule).toBe(ruleId);
});

test("an existing Action template toggle omits hidden draft changes and restores persisted Asset and Enabled", async ({
  page,
}) => {
  const mock = await syntheticActions(page);
  await page.goto(`/actions/${instanceId}/edit`);
  await expect(
    page.getByRole("switch", { name: "Enabled", exact: true }),
  ).toBeChecked();
  await expect(fieldItem(page, "m_nIDAsset")).toContainText(assetId);
  await page.getByRole("switch", { name: "Enabled", exact: true }).click();
  await selectReference(page, "m_nIDAsset", otherAssetId);
  await page.getByRole("switch", { name: "Is Template", exact: true }).click();
  await expectHiddenFields(page);
  await expect(marker(page)).toHaveCount(1);
  await page.getByRole("button", { name: /Save action$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/actions/${instanceId}$`));
  expect(mock.mutations[0]).toEqual({
    method: "PUT",
    path: `/api/resources/actions/${instanceId}`,
    body: { m_bIsTemplate: true },
  });
  expect(mock.rows[1].m_bEnabled).toBe(true);
  expect(mock.rows[1].m_nIDAsset).toBe(assetId);
  await page.getByRole("button", { name: /Edit$/ }).click();
  await expect(
    page.getByRole("switch", { name: "Is Template", exact: true }),
  ).toBeChecked();
  await page.getByRole("switch", { name: "Is Template", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Enabled", exact: true }),
  ).toBeChecked();
  await expect(fieldItem(page, "m_nIDAsset")).toContainText(assetId);
  await expect(marker(page)).toHaveCount(0);
  await page.getByRole("button", { name: /Save action$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/actions/${instanceId}$`));
  expect(mock.mutations[1]).toEqual({
    method: "PUT",
    path: `/api/resources/actions/${instanceId}`,
    body: { m_bIsTemplate: false },
  });
});

test("a fresh Action template hides Asset and Enabled and creates disabled and unassigned", async ({
  page,
}, testInfo) => {
  const mock = await syntheticActions(page);
  await page.goto("/actions/new?template=true");
  await expect(
    page.getByRole("switch", { name: "Is Template", exact: true }),
  ).toBeChecked();
  await expect(marker(page)).toHaveCount(1);
  await expectHiddenFields(page);
  await expect(page.locator('[id="m_nIDRule"]')).toBeVisible();
  await page
    .getByLabel("Label", { exact: true })
    .fill("Synthetic new Action template");
  await selectReference(page, "m_nIDActionType", typeId);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await screenshotAtTop(
    page,
    testInfo.outputPath("action-template-create-mobile.png"),
  );
  await page.getByRole("button", { name: /Save action$/ }).click();
  await expect(page).toHaveURL(/\/actions\/43$/);
  expect(mock.mutations).toHaveLength(1);
  expect(mock.mutations[0]).toMatchObject({
    method: "POST",
    path: "/api/resources/actions",
    body: {
      m_sLabel: "Synthetic new Action template",
      m_nIDActionType: typeId,
      m_bIsTemplate: true,
      m_bEnabled: false,
      m_nIDAsset: "0",
    },
  });
});

test("dynamic fresh-template toggles preserve draft controls but force hidden defaults at creation", async ({
  page,
}) => {
  const mock = await syntheticActions(page);
  await page.goto("/actions/new");
  const enabled = page.getByRole("switch", { name: "Enabled", exact: true });
  await enabled.click();
  await selectReference(page, "m_nIDAsset", otherAssetId);
  await selectReference(page, "m_nIDRule", ruleId);
  await page.getByRole("switch", { name: "Is Template", exact: true }).click();
  await expectHiddenFields(page);
  await expect(marker(page)).toHaveCount(1);
  await expect(fieldItem(page, "m_nIDRule")).toContainText(ruleId);
  await page.getByRole("switch", { name: "Is Template", exact: true }).click();
  await expect(enabled).toBeChecked();
  await expect(fieldItem(page, "m_nIDAsset")).toContainText(otherAssetId);
  await expect(marker(page)).toHaveCount(0);
  await page.getByRole("switch", { name: "Is Template", exact: true }).click();
  await page
    .getByLabel("Label", { exact: true })
    .fill("Synthetic dynamic Action template");
  await selectReference(page, "m_nIDActionType", typeId);
  await page.getByRole("button", { name: /Save action$/ }).click();
  await expect(page).toHaveURL(/\/actions\/43$/);
  expect(mock.mutations[0].body).toMatchObject({
    m_bIsTemplate: true,
    m_bEnabled: false,
    m_nIDAsset: "0",
    m_nIDRule: ruleId,
  });
});

test("ordinary Actions retain their Asset identity and Enabled control", async ({
  page,
}) => {
  const mock = await syntheticActions(page, { level: 30 });
  await page.goto(`/actions/${instanceId}`);
  await expect(detailLabel(page, "Asset")).toHaveCount(1);
  await expect(detailLabel(page, "Enabled")).toHaveCount(1);
  await expect(marker(page)).toHaveCount(0);
  await page.getByRole("button", { name: /Edit$/ }).click();
  await expect(
    page.getByRole("switch", { name: "Enabled", exact: true }),
  ).toBeChecked();
  await expect(fieldItem(page, "m_nIDAsset")).toContainText(assetId);
  await page.getByRole("switch", { name: "Enabled", exact: true }).click();
  await selectReference(page, "m_nIDAsset", otherAssetId);
  await page.getByRole("button", { name: /Save action$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/actions/${instanceId}$`));
  expect(mock.mutations).toEqual([
    {
      method: "PUT",
      path: `/api/resources/actions/${instanceId}`,
      body: { m_bEnabled: false, m_nIDAsset: otherAssetId },
    },
  ]);
});

for (const options of [
  { name: "read only", level: 30, rights: "r" },
  { name: "writes disabled", writable: false },
])
  test(`Action template presentation remains readable with ${options.name} permissions`, async ({
    page,
  }) => {
    const mock = await syntheticActions(page, options);
    await page.goto(`/actions/${templateId}`);
    await expect(marker(page)).toHaveCount(1);
    for (const name of ["Asset", "Enabled"])
      await expect(detailLabel(page, name)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Edit$/ })).toHaveCount(0);
    await page.goto(`/actions/${templateId}/edit`);
    await expect(
      page.getByText("Changes are unavailable", { exact: true }),
    ).toBeVisible();
    await expectHiddenFields(page);
    expect(mock.mutations).toEqual([]);
  });

test("denied Actions access does not fetch or display template metadata", async ({
  page,
}) => {
  const mock = await syntheticActions(page, { level: 30, rights: "" });
  await page.goto(`/actions/${templateId}`);
  await expect(
    page.getByText("Access unavailable", { exact: true }),
  ).toBeVisible();
  await expect(marker(page)).toHaveCount(0);
  expect(
    mock.reads.filter((url) =>
      url.pathname.startsWith("/api/resources/actions"),
    ),
  ).toHaveLength(0);
  expect(mock.mutations).toEqual([]);
});
