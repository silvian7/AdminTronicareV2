import { expect, test, type Page } from "@playwright/test";
import type { RecordData } from "../../shared/resources";

test.use({ locale: "en-GB", timezoneId: "Europe/Brussels" });

const templateId = "9223372036854775807";
const typeId = "9223372036854775806";
const oldAssetId = "9223372036854775805";
const oldSensorId = "9223372036854775804";
const assetId = "9223372036854775803";
const sensorId = "9223372036854775802";
const otherAssetId = "9223372036854775801";
const otherSensorId = "9223372036854775800";
const templateLabel = "Synthetic template rule";
const tagJson = JSON.stringify({
  revision: 7,
  messages: [
    { lang: 3, text: "MODEL-TAG", origin: "legacy" },
    { lang: 5, text: "MODELE" },
  ],
});
const labelJson = JSON.stringify({
  source: { revision: 2 },
  messages: [
    { lang: 3, text: templateLabel, approved: true },
    { lang: 5, text: "Regle modele" },
    { lang: 12, text: "Sjabloonregel" },
    { lang: 1033, text: "Unmapped legacy message", keep: true },
  ],
});
const copyPath = (id = templateId) =>
  `/rules/new?fromTemplate=${encodeURIComponent(id)}`;

async function syntheticTemplate(
  page: Page,
  options: {
    rights?: string;
    writable?: boolean;
    templateFlag?: unknown;
    sourceStatus?: number;
    mismatchedId?: boolean;
  } = {},
) {
  const now = new Date("2026-07-15T12:00:00.000Z");
  await page.clock.install({ time: now });
  await page.clock.setFixedTime(now);
  const template: RecordData = {
    id: options.mismatchedId ? "41" : templateId,
    m_nIDRule: templateId,
    m_nIDRuleType: typeId,
    m_sTag: tagJson,
    m_sLabel: labelJson,
    m_duValueDuree: "12501",
    m_nValueThreshold: "17",
    m_nLevel: "4",
    m_hTimeStart: "00:30:00.125",
    m_hTimeEnd: "23:45:30.007",
    m_bTime24h: false,
    m_nResetDelayMs: "1001",
    m_bEnabled: true,
    m_bIsTemplate: options.templateFlag ?? true,
    m_nIDAsset: oldAssetId,
    m_nIDSensor: oldSensorId,
    m_sAssetTag: "OLD-ASSET-SNAPSHOT",
    m_dhDhCreated: "2020-01-15T12:00:00.000",
    m_dhDhModified: "2026-01-15T12:00:00.000",
    m_bOutput: true,
    m_dhDhActivated: "2026-07-15T11:00:00.000",
    m_bTimeoutStarted: true,
    m_bTimeoutElapsed: true,
    m_bTimeoutCanceled: true,
    m_bCanceled: true,
    m_bResetPending: true,
    m_dhDhReset: "2026-07-15T12:10:00.000",
  };
  const assets: RecordData[] = [
    {
      id: assetId,
      m_nIDAsset: assetId,
      m_nIDOrganization: "7",
      m_sTag: "NEW-ASSET",
      m_sLabel: "Synthetic chosen asset",
    },
    {
      id: otherAssetId,
      m_nIDAsset: otherAssetId,
      m_nIDOrganization: "7",
      m_sTag: "OTHER-ASSET",
      m_sLabel: "Synthetic other asset",
    },
    {
      id: oldAssetId,
      m_nIDAsset: oldAssetId,
      m_nIDOrganization: "7",
      m_sTag: "OLD-ASSET",
      m_sLabel: "Synthetic template's old asset",
    },
  ];
  const sensors: RecordData[] = [
    {
      id: sensorId,
      m_nIDSensor: sensorId,
      m_nIDAsset: assetId,
      m_nIDOrganization: "7",
      m_sLabel: "Synthetic matching sensor",
    },
    {
      id: otherSensorId,
      m_nIDSensor: otherSensorId,
      m_nIDAsset: otherAssetId,
      m_nIDOrganization: "7",
      m_sLabel: "Synthetic other asset sensor",
    },
    {
      id: oldSensorId,
      m_nIDSensor: oldSensorId,
      m_nIDAsset: oldAssetId,
      m_nIDOrganization: "7",
      m_sLabel: "Synthetic old template sensor",
    },
  ];
  const reads: URL[] = [];
  const mutations: {
    method: string;
    path: string;
    body: Record<string, unknown>;
    csrf?: string;
  }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let sourceStatus = options.sourceStatus;
  let mismatchedSensor = false;
  let created: RecordData | undefined;
  let heldSource: { enter: () => void; wait: Promise<void> } | undefined;
  let heldVerification: { enter: () => void; wait: Promise<void> } | undefined;
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (request.method() !== "GET") {
      const body = request.postDataJSON() as Record<string, unknown>;
      mutations.push({
        method: request.method(),
        path,
        body,
        csrf: request.headers()["x-csrf-token"],
      });
      if (path === "/api/resources/rules" && request.method() === "POST") {
        created = { id: "43", m_nIDRule: "43", ...body };
        return reply({ data: created });
      }
      return reply({ message: "Unexpected synthetic mutation." }, 405);
    }
    reads.push(url);
    if (path === "/api/session")
      return reply({
        identity: {
          id: "100",
          name: "Synthetic rule template creator",
          organizationId: "7",
          userTypeId: "30",
          level: 30,
          mustChangePassword: false,
          permissions: [
            { entity: "rules", rights: options.rights ?? "rc" },
            { entity: "assets", rights: "r" },
            { entity: "sensors", rights: "r" },
            { entity: "ruletypes", rights: "r" },
            { entity: "actions", rights: "crud" },
          ],
        },
        csrf: "synthetic-template-csrf",
        expiresAt: now.getTime() + 3_600_000,
        services: {
          rules: { configured: true, writable: options.writable ?? true },
        },
      });
    if (path === `/api/resources/rules/${templateId}`) {
      if (heldSource) {
        const held = heldSource;
        heldSource = undefined;
        held.enter();
        await held.wait;
      }
      return sourceStatus
        ? reply({ message: "Synthetic template access denied." }, sourceStatus)
        : reply({ data: template });
    }
    if (path === "/api/resources/rules/43" && created)
      return reply({ data: created });
    if (path === "/api/resources/rules")
      return reply({ data: [template], total: 1 });
    if (path === "/api/resources/actions")
      return reply({
        data: (url.searchParams.get("idrule") === templateId
          ? [1, 2, 3]
          : []
        ).map((id) => ({
          id: String(id),
          m_nIDAction: String(id),
          m_nIDRule: templateId,
          m_sLabel: `Synthetic source action ${id}`,
        })),
        total: url.searchParams.get("idrule") === templateId ? 3 : 0,
      });
    if (path === "/api/resources/assets")
      return reply({ data: assets, total: assets.length });
    const asset = assets.find(
      (row) => path === `/api/resources/assets/${row.id}`,
    );
    if (asset) return reply({ data: asset });
    if (path === "/api/resources/sensors") {
      // Deliberately return extra sensors to verify the picker also checks IDAsset.
      return reply({ data: sensors, total: sensors.length });
    }
    const sensor = sensors.find(
      (row) => path === `/api/resources/sensors/${row.id}`,
    );
    if (sensor) {
      if (sensor.id === sensorId && heldVerification) {
        const held = heldVerification;
        heldVerification = undefined;
        held.enter();
        await held.wait;
      }
      return reply({
        data:
          mismatchedSensor && sensor.id === sensorId
            ? { ...sensor, m_nIDAsset: otherAssetId }
            : sensor,
      });
    }
    const type = {
      id: typeId,
      m_nIDRuleType: typeId,
      m_sTag: "SYNTHETIC-COPY-TYPE",
      m_sLabel: "Synthetic copied rule type",
    };
    if (path === "/api/resources/ruletypes")
      return reply({ data: [type], total: 1 });
    if (path === `/api/resources/ruletypes/${typeId}`)
      return reply({ data: type });
    // Every API request, including references and other tabs, remains synthetic.
    return reply({ data: [], total: 0 });
  });
  return {
    template,
    reads,
    mutations,
    errors,
    allowSource: () => {
      sourceStatus = undefined;
    },
    changeSensorOwnership: (wrong: boolean) => {
      mismatchedSensor = wrong;
    },
    holdSource: () => {
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      heldSource = { enter, wait };
      return { entered, release };
    },
    holdVerification: () => {
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      heldVerification = { enter, wait };
      return { entered, release };
    },
  };
}

function fieldItem(page: Page, key: string) {
  return page
    .locator(".ant-form-item")
    .filter({ has: page.locator(`[id="${key}"]`) });
}

async function optionsFor(page: Page, key: "m_nIDAsset" | "m_nIDSensor") {
  await fieldItem(page, key)
    .locator(".ant-select-selector")
    .click({ timeout: 5000 });
  const dropdown = page.locator(
    ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
  );
  await expect(dropdown).toHaveCount(1);
  return dropdown;
}

async function selectReference(
  page: Page,
  key: "m_nIDAsset" | "m_nIDSensor",
  id: string,
) {
  const dropdown = await optionsFor(page, key);
  await dropdown
    .locator(".ant-select-item-option")
    .filter({ hasText: id })
    .click();
}

async function expectDraft(page: Page) {
  await expect(
    page.getByRole("heading", {
      name: "Create rule from template",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("m_sTag (en)", { exact: true })).toHaveValue(
    "MODEL-TAG",
  );
  await expect(page.getByLabel("m_sLabel (en)", { exact: true })).toHaveValue(
    templateLabel,
  );
  await expect(
    page.getByLabel("Duration (seconds)", { exact: true }),
  ).toHaveValue("12.501");
  await expect(
    page.getByLabel("Reset delay (seconds)", { exact: true }),
  ).toHaveValue("1.001");
  await expect(
    page.getByLabel("Start time (local)", { exact: true }),
  ).toHaveValue("02:30:00.125");
  await expect(
    page.getByLabel("End time (local)", { exact: true }),
  ).toHaveValue("01:45:30.007");
  await expect(
    page.getByRole("switch", { name: "Enabled", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Is Template", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Is Template", exact: true }),
  ).toBeDisabled();
}

async function scrollToTop(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.scrollTo(0, 0);
        requestAnimationFrame(() => resolve());
      }),
  );
}

test("a reader and creator without update permission creates an exact disabled rule from a fresh template", async ({
  page,
}, testInfo) => {
  const mock = await syntheticTemplate(page);
  await page.goto(`/rules/${templateId}`);
  await expect(
    page.getByRole("heading", { name: templateLabel, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Actions (3)", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Edit$/ })).toHaveCount(0);
  const before = mock.reads.filter(
    (url) => url.pathname === `/api/resources/rules/${templateId}`,
  ).length;
  await page.getByRole("button", { name: /Create from template$/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/rules/new\\?fromTemplate=${templateId}$`),
  );
  await expectDraft(page);
  expect(
    mock.reads.filter(
      (url) => url.pathname === `/api/resources/rules/${templateId}`,
    ).length,
  ).toBeGreaterThan(before);
  await expect(fieldItem(page, "m_nIDRuleType")).toContainText(typeId);
  await expect(page.getByLabel("Threshold", { exact: true })).toHaveValue("17");
  await expect(page.getByLabel("Level", { exact: true })).toHaveValue("4");
  for (const key of ["m_nIDAsset", "m_nIDSensor"])
    await expect(
      fieldItem(page, key).locator(".ant-select-selection-item"),
    ).toHaveCount(0);
  await page.getByRole("button", { name: /Save rule$/ }).click();
  expect(mock.mutations).toEqual([]);
  await expect(
    fieldItem(page, "m_nIDAsset")
      .locator(".ant-form-item-explain-error")
      .first(),
  ).toBeVisible();
  await expect(
    fieldItem(page, "m_nIDSensor")
      .locator(".ant-form-item-explain-error")
      .first(),
  ).toBeVisible();
  await selectReference(page, "m_nIDAsset", assetId);
  const sensors = await optionsFor(page, "m_nIDSensor");
  await expect(sensors).toContainText(sensorId);
  await expect(sensors).not.toContainText(otherSensorId);
  await expect(sensors).not.toContainText(oldSensorId);
  await sensors
    .locator(".ant-select-item-option")
    .filter({ hasText: sensorId })
    .click();
  const sensorReads = mock.reads.filter(
    (url) => url.pathname === "/api/resources/sensors",
  );
  expect(sensorReads.length).toBeGreaterThan(0);
  expect(
    sensorReads.every((url) => url.searchParams.get("idasset") === assetId),
  ).toBe(true);
  await scrollToTop(page);
  await page.screenshot({
    path: testInfo.outputPath("rule-template-copy-desktop.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await scrollToTop(page);
  await page.screenshot({
    path: testInfo.outputPath("rule-template-copy-mobile.png"),
    animations: "disabled",
  });
  const verification = mock.holdVerification();
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await verification.entered;
  for (const key of ["m_nIDAsset", "m_nIDSensor", "m_nIDRuleType"])
    await expect(page.locator(`[id="${key}"]`)).toBeDisabled();
  expect(mock.mutations).toEqual([]);
  verification.release();
  await expect(page).toHaveURL(/\/rules\/43$/);
  await expect(
    page.getByRole("tab", { name: "Actions (0)", exact: true }),
  ).toBeVisible();
  expect(mock.mutations).toEqual([
    {
      method: "POST",
      path: "/api/resources/rules",
      csrf: "synthetic-template-csrf",
      body: {
        m_nIDRuleType: typeId,
        m_sTag: tagJson,
        m_sLabel: labelJson,
        m_duValueDuree: "12501",
        m_nValueThreshold: "17",
        m_nLevel: "4",
        m_hTimeStart: "00:30:00.125",
        m_hTimeEnd: "23:45:30.007",
        m_bTime24h: false,
        m_nResetDelayMs: "1001",
        m_bEnabled: false,
        m_bIsTemplate: false,
        m_nIDAsset: assetId,
        m_nIDSensor: sensorId,
      },
    },
  ]);
  expect(
    mock.reads.some(
      (url) => url.pathname === `/api/resources/assets/${assetId}`,
    ),
  ).toBe(true);
  expect(
    mock.reads.some(
      (url) => url.pathname === `/api/resources/sensors/${sensorId}`,
    ),
  ).toBe(true);
  expect(mock.template.m_bEnabled).toBe(true);
  expect(mock.template.m_bIsTemplate).toBe(true);
  expect(mock.errors).toEqual([]);
});

test("changing Asset clears the copied draft's selected Sensor and scopes new choices", async ({
  page,
}) => {
  const mock = await syntheticTemplate(page);
  await page.goto(copyPath());
  await expectDraft(page);
  await selectReference(page, "m_nIDAsset", assetId);
  await selectReference(page, "m_nIDSensor", sensorId);
  await selectReference(page, "m_nIDAsset", otherAssetId);
  await expect(
    fieldItem(page, "m_nIDSensor").locator(".ant-select-selection-item"),
  ).toHaveCount(0);
  const choices = await optionsFor(page, "m_nIDSensor");
  await expect(choices).toContainText(otherSensorId);
  await expect(choices).not.toContainText(sensorId);
  await choices
    .locator(".ant-select-item-option")
    .filter({ hasText: otherSensorId })
    .click();
  expect(
    mock.reads.some(
      (url) =>
        url.pathname === "/api/resources/sensors" &&
        url.searchParams.get("idasset") === otherAssetId,
    ),
  ).toBe(true);
  expect(mock.mutations).toEqual([]);
});

test("a changed Sensor-to-Asset relationship is verified before creating the rule", async ({
  page,
}) => {
  const mock = await syntheticTemplate(page);
  await page.goto(copyPath());
  await expectDraft(page);
  await selectReference(page, "m_nIDAsset", assetId);
  await selectReference(page, "m_nIDSensor", sensorId);
  mock.changeSensorOwnership(true);
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(
    page
      .locator(".ant-alert-error")
      .filter({ hasText: "Choose a sensor belonging to the selected asset." }),
  ).toBeVisible();
  expect(mock.mutations).toEqual([]);
});

test("template loading never exposes an enabled blank save", async ({
  page,
}) => {
  const mock = await syntheticTemplate(page),
    held = mock.holdSource();
  await page.goto(copyPath());
  await held.entered;
  await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
  await expect(
    page.getByLabel("Duration (seconds)", { exact: true }),
  ).toHaveCount(0);
  held.release();
  await expectDraft(page);
  expect(mock.mutations).toEqual([]);
});

test("a denied template source offers retry without an empty creation form", async ({
  page,
}) => {
  const mock = await syntheticTemplate(page, { sourceStatus: 403 });
  await page.goto(copyPath());
  await expect(
    page.getByText("Synthetic template access denied.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
  await expect(
    page.getByLabel("Duration (seconds)", { exact: true }),
  ).toHaveCount(0);
  mock.allowSource();
  await page.getByRole("button", { name: /Retry$/ }).click();
  await expectDraft(page);
  expect(mock.mutations).toEqual([]);
});

test("a template unflagged after viewing Details is rejected by the fresh copy read", async ({
  page,
}) => {
  const mock = await syntheticTemplate(page);
  await page.goto(`/rules/${templateId}`);
  await expect(
    page.getByRole("button", { name: /Create from template$/ }),
  ).toBeVisible();
  mock.template.m_bIsTemplate = false;
  await page.getByRole("button", { name: /Create from template$/ }).click();
  await expect(
    page.getByText("Choose a rule flagged as a template.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
  expect(mock.mutations).toEqual([]);
});

for (const templateFlag of [false, "true"])
  test(`only strict boolean template flags expose copying (${JSON.stringify(templateFlag)})`, async ({
    page,
  }) => {
    const mock = await syntheticTemplate(page, { templateFlag });
    await page.goto(`/rules/${templateId}`);
    await expect(
      page.getByRole("heading", { name: templateLabel, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Create from template$/ }),
    ).toHaveCount(0);
    await page.goto(copyPath());
    await expect(
      page.getByText("Choose a rule flagged as a template.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
    expect(mock.mutations).toEqual([]);
  });

for (const id of ["01", "9223372036854775808"])
  test(`invalid template ID ${id} is rejected before fetching source data`, async ({
    page,
  }) => {
    const mock = await syntheticTemplate(page);
    await page.goto(copyPath(id));
    await expect(
      page.getByText("Invalid template rule ID.", { exact: true }),
    ).toBeVisible();
    expect(
      mock.reads.filter((url) =>
        url.pathname.startsWith("/api/resources/rules/"),
      ),
    ).toHaveLength(0);
    await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
    expect(mock.mutations).toEqual([]);
  });

test("a mismatched template response cannot populate or save a copied draft", async ({
  page,
}) => {
  const mock = await syntheticTemplate(page, { mismatchedId: true });
  await page.goto(copyPath());
  await expect(
    page.getByText("Choose a rule flagged as a template.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Duration (seconds)", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
  expect(mock.mutations).toEqual([]);
});

for (const restriction of [
  { name: "no create right", rights: "r" },
  { name: "no read right", rights: "c" },
  { name: "Rules writes disabled", writable: false },
])
  test(`${restriction.name} cannot copy or submit a template`, async ({
    page,
  }) => {
    const mock = await syntheticTemplate(page, restriction);
    await page.goto(`/rules/${templateId}`);
    if (restriction.rights !== "c")
      await expect(
        page.getByRole("heading", { name: templateLabel, exact: true }),
      ).toBeVisible();
    else
      await expect(
        page.getByText("Access unavailable", { exact: true }),
      ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Create from template$/ }),
    ).toHaveCount(0);
    await page.goto(copyPath());
    await expect(
      page.getByText("Changes are unavailable", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
    expect(mock.mutations).toEqual([]);
  });

test("Cancel preserves an edited draft when requested and discards it without any write", async ({
  page,
}) => {
  const mock = await syntheticTemplate(page);
  await page.goto(copyPath());
  await expectDraft(page);
  const duration = page.getByLabel("Duration (seconds)", { exact: true });
  await duration.fill("9.001");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(duration).toHaveValue("9.001");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page).toHaveURL(/\/rules(?:\?|$)/);
  expect(mock.mutations).toEqual([]);
});
