import { expect, test, type Page } from "@playwright/test";
import type { RecordData } from "../../shared/resources";

test.use({ locale: "en-GB", timezoneId: "Europe/Brussels" });

const sourceId = "9223372036854775807";
const typeId = "9223372036854775806";
const assetId = "9223372036854775805";
const sensorId = "9223372036854775804";
const sourceLabel = "Synthetic existing rule";
const tagJson = JSON.stringify({
  revision: 7,
  messages: [
    { lang: 3, text: "EXISTING-TAG", origin: "legacy" },
    { lang: 5, text: "REGLE" },
  ],
});
const labelJson = JSON.stringify({
  source: { revision: 2 },
  messages: [
    { lang: 3, text: sourceLabel, approved: true },
    { lang: 5, text: "Regle existante" },
    { lang: 12, text: "Bestaande regel" },
    { lang: 1033, text: "Unmapped legacy message", keep: true },
  ],
});
const copyPath = (id = sourceId) =>
  `/rules/new?fromRule=${encodeURIComponent(id)}`;

async function syntheticRule(
  page: Page,
  options: {
    level?: number;
    rights?: string;
    writable?: boolean;
    templateFlag?: unknown;
    sourceStatus?: number;
    mismatchedId?: boolean;
    saveStatus?: number;
  } = {},
) {
  const now = new Date("2026-07-15T12:00:00.000Z");
  await page.clock.install({ time: now });
  await page.clock.setFixedTime(now);
  const source: RecordData = {
    id: options.mismatchedId ? "41" : sourceId,
    m_nIDRule: sourceId,
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
    m_bIsTemplate: options.templateFlag ?? false,
    m_nIDAsset: assetId,
    m_nIDSensor: sensorId,
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
  let saveStatus = options.saveStatus;
  let created: RecordData | undefined;
  let heldSource: { enter: () => void; wait: Promise<void> } | undefined;
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
        if (saveStatus)
          return reply(
            { message: "Synthetic rule creation failed." },
            saveStatus,
          );
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
          name: "Synthetic template creator",
          organizationId: "7",
          userTypeId: String(options.level ?? 90),
          level: options.level ?? 90,
          mustChangePassword: false,
          permissions: [
            { entity: "rules", rights: options.rights ?? "rc" },
            { entity: "assets", rights: "r" },
            { entity: "sensors", rights: "r" },
            { entity: "ruletypes", rights: "r" },
            { entity: "actions", rights: "crud" },
          ],
        },
        csrf: "synthetic-create-template-csrf",
        expiresAt: now.getTime() + 3_600_000,
        services: {
          rules: { configured: true, writable: options.writable ?? true },
        },
      });
    if (path === `/api/resources/rules/${sourceId}`) {
      if (heldSource) {
        const held = heldSource;
        heldSource = undefined;
        held.enter();
        await held.wait;
      }
      return sourceStatus
        ? reply({ message: "Synthetic source access denied." }, sourceStatus)
        : reply({ data: source });
    }
    if (path === "/api/resources/rules/43" && created)
      return reply({ data: created });
    if (path === "/api/resources/rules")
      return reply({ data: [source], total: 1 });
    if (path === "/api/resources/actions") {
      const actions =
        url.searchParams.get("idrule") === sourceId ? [1, 2, 3] : [];
      return reply({
        data: actions.map((id) => ({
          id: String(id),
          m_nIDAction: String(id),
          m_nIDRule: sourceId,
          m_sLabel: `Synthetic source action ${id}`,
        })),
        total: actions.length,
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
    if (path === `/api/resources/assets/${assetId}`)
      return reply({
        data: {
          id: assetId,
          m_nIDAsset: assetId,
          m_nIDOrganization: "7",
          m_sTag: "SOURCE-ASSET",
          m_sLabel: "Source asset",
        },
      });
    if (path === `/api/resources/sensors/${sensorId}`)
      return reply({
        data: {
          id: sensorId,
          m_nIDSensor: sensorId,
          m_nIDAsset: assetId,
          m_nIDOrganization: "7",
        },
      });
    // No business request can leave this synthetic fixture.
    return reply({ data: [], total: 0 });
  });
  return {
    source,
    reads,
    mutations,
    errors,
    allowSource: () => {
      sourceStatus = undefined;
    },
    allowSave: () => {
      saveStatus = undefined;
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
  };
}

async function expectDraft(page: Page) {
  await expect(
    page.getByRole("heading", {
      name: "Create template from rule",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("m_sTag (en)", { exact: true })).toHaveValue(
    "EXISTING-TAG",
  );
  await expect(page.getByLabel("m_sLabel (en)", { exact: true })).toHaveValue(
    sourceLabel,
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
    page.getByRole("switch", { name: "Enabled", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("switch", { name: "Is Template", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Is Template", exact: true }),
  ).toBeDisabled();
  await expect(page.locator('[id="m_nIDAsset"]')).toHaveCount(0);
  await expect(page.locator('[id="m_nIDSensor"]')).toHaveCount(0);
  await expect(page.locator('[id="m_nIDRuleType"]')).toBeVisible();
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

test("platform operator makes an unbound template with exact copied configuration", async ({
  page,
}, testInfo) => {
  const mock = await syntheticRule(page);
  await page.goto(`/rules/${sourceId}`);
  await expect(
    page.getByRole("heading", { name: sourceLabel, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Actions (3)", exact: true }),
  ).toBeVisible();
  const before = mock.reads.filter(
    (url) => url.pathname === `/api/resources/rules/${sourceId}`,
  ).length;
  await page
    .getByRole("button", { name: /Create template from rule$/ })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/rules/new\\?fromRule=${sourceId}$`),
  );
  await expectDraft(page);
  expect(
    mock.reads.filter(
      (url) => url.pathname === `/api/resources/rules/${sourceId}`,
    ).length,
  ).toBeGreaterThan(before);
  await expect(
    page
      .locator(".ant-form-item")
      .filter({ has: page.locator('[id="m_nIDRuleType"]') }),
  ).toContainText(typeId);
  await expect(page.getByLabel("Threshold", { exact: true })).toHaveValue("17");
  await expect(page.getByLabel("Level", { exact: true })).toHaveValue("4");
  await scrollToTop(page);
  await page.screenshot({
    path: testInfo.outputPath("rule-create-template-desktop.png"),
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
    path: testInfo.outputPath("rule-create-template-mobile.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(/\/rules\/43$/);
  await expect(
    page.getByRole("tab", { name: "Actions (0)", exact: true }),
  ).toBeVisible();
  expect(mock.mutations).toEqual([
    {
      method: "POST",
      path: "/api/resources/rules",
      csrf: "synthetic-create-template-csrf",
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
        m_bIsTemplate: true,
        m_nIDAsset: "0",
        m_nIDSensor: "0",
      },
    },
  ]);
  expect(mock.source.m_bEnabled).toBe(true);
  expect(mock.source.m_bIsTemplate).toBe(false);
  expect(mock.source.m_nIDAsset).toBe(assetId);
  expect(mock.errors).toEqual([]);
});

test("failed creation retains the edited draft and permits retry without changing the source", async ({
  page,
}) => {
  const mock = await syntheticRule(page, { saveStatus: 422 });
  await page.goto(copyPath());
  await expectDraft(page);
  await page.getByLabel("Duration (seconds)", { exact: true }).fill("9.001");
  await page.getByRole("switch", { name: "Enabled", exact: true }).click();
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(
    page.getByText("Synthetic rule creation failed.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/rules/new\\?fromRule=${sourceId}$`),
  );
  await expect(
    page.getByLabel("Duration (seconds)", { exact: true }),
  ).toHaveValue("9.001");
  await expect(
    page.getByRole("switch", { name: "Enabled", exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("m_sTag (en)", { exact: true })).toHaveValue(
    "EXISTING-TAG",
  );
  mock.allowSave();
  await page.getByRole("button", { name: /Save rule$/ }).click();
  await expect(page).toHaveURL(/\/rules\/43$/);
  expect(mock.mutations).toHaveLength(2);
  expect(
    mock.mutations.every(
      (entry) =>
        entry.method === "POST" && entry.path === "/api/resources/rules",
    ),
  ).toBe(true);
  expect(mock.mutations[1].body).toMatchObject({
    m_duValueDuree: "9001",
    m_bEnabled: true,
    m_bIsTemplate: true,
    m_sTag: tagJson,
    m_sLabel: labelJson,
    m_nIDAsset: "0",
    m_nIDSensor: "0",
  });
  expect(
    mock.reads.filter((url) =>
      /^\/api\/resources\/(assets|sensors)(\/|$)/.test(url.pathname),
    ),
  ).toHaveLength(0);
});

test("source loading does not expose a blank creation form or enabled save", async ({
  page,
}) => {
  const mock = await syntheticRule(page),
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

test("source access errors permit retry without exposing a blank template", async ({
  page,
}) => {
  const mock = await syntheticRule(page, { sourceStatus: 403 });
  await page.goto(copyPath());
  await expect(
    page.getByText("Synthetic source access denied.", { exact: true }),
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

test("a rule flagged as template after Details is rejected by the fresh source read", async ({
  page,
}) => {
  const mock = await syntheticRule(page);
  await page.goto(`/rules/${sourceId}`);
  await expect(
    page.getByRole("button", { name: /Create template from rule$/ }),
  ).toBeVisible();
  mock.source.m_bIsTemplate = true;
  await page
    .getByRole("button", { name: /Create template from rule$/ })
    .click();
  await expect(
    page.getByText("Choose a rule that is not flagged as a template.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
  expect(mock.mutations).toEqual([]);
});

for (const templateFlag of [true, "false"])
  test(`source flag ${JSON.stringify(templateFlag)} cannot create a template`, async ({
    page,
  }) => {
    const mock = await syntheticRule(page, { templateFlag });
    await page.goto(`/rules/${sourceId}`);
    await expect(
      page.getByRole("heading", { name: sourceLabel, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Create template from rule$/ }),
    ).toHaveCount(0);
    await page.goto(copyPath());
    await expect(
      page.getByText("Choose a rule that is not flagged as a template.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
    expect(mock.mutations).toEqual([]);
  });

test("mismatched source identity never populates a template draft", async ({
  page,
}) => {
  const mock = await syntheticRule(page, { mismatchedId: true });
  await page.goto(copyPath());
  await expect(
    page.getByText("Choose a rule that is not flagged as a template.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Duration (seconds)", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
  expect(mock.mutations).toEqual([]);
});

for (const id of ["01", "9223372036854775808"])
  test(`invalid source ID ${id} is rejected before reading a rule`, async ({
    page,
  }) => {
    const mock = await syntheticRule(page);
    await page.goto(copyPath(id));
    await expect(
      page.getByText("Invalid source rule ID.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
    expect(
      mock.reads.filter((url) =>
        url.pathname.startsWith("/api/resources/rules/"),
      ),
    ).toHaveLength(0);
    expect(mock.mutations).toEqual([]);
  });

test("mixed copy directions are rejected without reading or saving either source", async ({
  page,
}) => {
  const mock = await syntheticRule(page);
  await page.goto(`${copyPath()}&fromTemplate=${sourceId}`);
  await expect(
    page.getByText("Invalid source rule ID.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
  expect(
    mock.reads.filter((url) =>
      url.pathname.startsWith("/api/resources/rules/"),
    ),
  ).toHaveLength(0);
  expect(mock.mutations).toEqual([]);
});

for (const restriction of [
  { name: "ordinary rule creator", level: 30 },
  { name: "ordinary read only", level: 30, rights: "r" },
  { name: "ordinary without source read", level: 30, rights: "c" },
  { name: "Rules writes disabled", writable: false },
])
  test(`${restriction.name} cannot create a template through Details or a direct URL`, async ({
    page,
  }) => {
    const mock = await syntheticRule(page, restriction);
    await page.goto(`/rules/${sourceId}`);
    await expect(
      page
        .getByText(
          restriction.rights === "c" ? "Access unavailable" : sourceLabel,
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Create template from rule$/ }),
    ).toHaveCount(0);
    await page.goto(copyPath());
    await expect(
      page.getByText("Changes are unavailable", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
    expect(mock.mutations).toEqual([]);
  });

test("Cancel keeps an edited template when requested and discards without a write", async ({
  page,
}) => {
  const mock = await syntheticRule(page);
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
