import { expect, test, type Page } from "@playwright/test";
import type { RecordData } from "../../shared/resources";

test.use({ locale: "en-GB" });

const sourceId = "9223372036854775807";
const typeId = "9223372036854775806";
const oldAssetId = "9223372036854775805";
const oldRuleId = "9223372036854775804";
const assetId = "9223372036854775803";
const ruleId = "9223372036854775802";
const sensorId = "9223372036854775801";
const otherAssetId = "9223372036854775800";
const otherRuleId = "9223372036854775799";
const templateRuleId = "9223372036854775798";
const sourceLabel = "Synthetic source action";
const recipient = "synthetic+alert@example.test";
const subject = "Synthetic alert — {{asset}}";
const body = "Line one: {{sensor}}\nLine two — {value} & <test>";
const tagJson = JSON.stringify({
  revision: 7,
  messages: [
    { lang: 3, text: "ACTION-MODEL", origin: "legacy" },
    { lang: 5, text: "ACTION-MODELE" },
  ],
});
const labelJson = JSON.stringify({
  source: { revision: 2 },
  messages: [
    { lang: 3, text: sourceLabel, approved: true },
    { lang: 5, text: "Action source" },
    { lang: 12, text: "Bronactie" },
    { lang: 1033, text: "Unmapped legacy message", keep: true },
  ],
});
const copyPath = (reverse = false, id = sourceId) =>
  `/actions/new?${reverse ? "fromAction" : "fromTemplate"}=${encodeURIComponent(id)}`;
const heading = (reverse: boolean) =>
  reverse ? "Create template from action" : "Create action from template";
const sourceError = (reverse: boolean) =>
  reverse
    ? "Choose an action that is not flagged as a template."
    : "Choose an action flagged as a template.";

async function syntheticAction(
  page: Page,
  options: {
    reverse?: boolean;
    level?: number;
    rights?: string;
    writable?: boolean;
    mustChangePassword?: boolean;
    templateFlag?: unknown;
    sourceStatus?: number;
    mismatchedId?: boolean;
    saveStatus?: number;
  } = {},
) {
  const source: RecordData = {
    id: options.mismatchedId ? "41" : sourceId,
    m_nIDAction: sourceId,
    m_nIDActionType: typeId,
    m_nIDRule: oldRuleId,
    m_nIDAsset: oldAssetId,
    m_sAssetTag: "OLD-ASSET-SNAPSHOT",
    m_nLevel: "4",
    m_sTag: tagJson,
    m_sLabel: labelJson,
    m_sRecipient: recipient,
    m_sSubjectText: subject,
    m_sBodyText: body,
    m_bEnabled: true,
    m_bIsTemplate: options.templateFlag ?? !options.reverse,
    m_dhDhCreated: "2020-01-15T12:00:00.000",
    m_dhDhModified: "2026-01-15T12:00:00.000",
    m_bOutput: true,
    m_dhDhActivated: "2026-07-15T11:00:00.000",
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
      m_sLabel: "Synthetic source asset",
    },
  ];
  const rules: RecordData[] = [
    {
      id: ruleId,
      m_nIDRule: ruleId,
      m_nIDAsset: assetId,
      m_nIDSensor: sensorId,
      m_sLabel: "Synthetic matching rule",
      m_bIsTemplate: false,
    },
    {
      id: otherRuleId,
      m_nIDRule: otherRuleId,
      m_nIDAsset: otherAssetId,
      m_nIDSensor: sensorId,
      m_sLabel: "Synthetic other asset rule",
      m_bIsTemplate: false,
    },
    {
      id: templateRuleId,
      m_nIDRule: templateRuleId,
      m_nIDAsset: assetId,
      m_nIDSensor: sensorId,
      m_sLabel: "Synthetic template rule",
      m_bIsTemplate: true,
    },
    {
      id: oldRuleId,
      m_nIDRule: oldRuleId,
      m_nIDAsset: oldAssetId,
      m_nIDSensor: "0",
      m_sLabel: "Synthetic source rule",
      m_bIsTemplate: false,
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
  let saveStatus = options.saveStatus;
  let created: RecordData | undefined;
  let preflight:
    | "valid"
    | "rule-asset"
    | "rule-template"
    | "rule-sensor-zero"
    | "sensor-asset"
    | "sensor-id" = "valid";
  let heldSource: { enter: () => void; wait: Promise<void> } | undefined;
  let heldVerification: { enter: () => void; wait: Promise<void> } | undefined;
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
      const values = request.postDataJSON() as Record<string, unknown>;
      mutations.push({
        method: request.method(),
        path,
        body: values,
        csrf: request.headers()["x-csrf-token"],
      });
      if (path === "/api/resources/actions" && request.method() === "POST") {
        if (saveStatus)
          return reply(
            { message: "Synthetic action creation failed." },
            saveStatus,
          );
        created = { id: "43", m_nIDAction: "43", ...values };
        return reply({ data: created });
      }
      return reply({ message: "Unexpected synthetic mutation." }, 405);
    }
    reads.push(url);
    if (path === "/api/session")
      return reply({
        identity: {
          id: "100",
          name: "Synthetic action creator",
          organizationId: "7",
          userTypeId: String(options.level ?? (options.reverse ? 90 : 30)),
          level: options.level ?? (options.reverse ? 90 : 30),
          mustChangePassword: options.mustChangePassword ?? false,
          permissions: [
            { entity: "actions", rights: options.rights ?? "rc" },
            { entity: "assets", rights: "r" },
            { entity: "rules", rights: "r" },
            { entity: "sensors", rights: "r" },
            { entity: "actiontypes", rights: "r" },
          ],
        },
        csrf: "synthetic-action-copy-csrf",
        expiresAt: Date.now() + 3_600_000,
        services: {
          actions: { configured: true, writable: options.writable ?? true },
        },
      });
    if (path === `/api/resources/actions/${sourceId}`) {
      if (heldSource) {
        const held = heldSource;
        heldSource = undefined;
        held.enter();
        await held.wait;
      }
      return sourceStatus
        ? reply({ message: "Synthetic source action denied." }, sourceStatus)
        : reply({ data: source });
    }
    if (path === "/api/resources/actions/43" && created)
      return reply({ data: created });
    if (path === "/api/resources/actions")
      return reply({ data: [source], total: 1 });
    if (path === "/api/resources/assets")
      return reply({ data: assets, total: assets.length });
    const asset = assets.find(
      (row) => path === `/api/resources/assets/${row.id}`,
    );
    if (asset) return reply({ data: asset });
    if (path === "/api/resources/rules") {
      // Deliberately overbroad to verify the picker also validates the relationship and flag.
      return reply({ data: rules, total: rules.length });
    }
    const rule = rules.find((row) => path === `/api/resources/rules/${row.id}`);
    if (rule)
      return reply({
        data:
          rule.id === ruleId
            ? {
                ...rule,
                ...(preflight === "rule-asset"
                  ? { m_nIDAsset: otherAssetId }
                  : {}),
                ...(preflight === "rule-template"
                  ? { m_bIsTemplate: true }
                  : {}),
                ...(preflight === "rule-sensor-zero"
                  ? { m_nIDSensor: "0" }
                  : {}),
              }
            : rule,
      });
    if (path === `/api/resources/sensors/${sensorId}`) {
      if (heldVerification) {
        const held = heldVerification;
        heldVerification = undefined;
        held.enter();
        await held.wait;
      }
      return reply({
        data: {
          id: preflight === "sensor-id" ? "99" : sensorId,
          m_nIDSensor: sensorId,
          m_nIDAsset: preflight === "sensor-asset" ? otherAssetId : assetId,
          m_nIDOrganization: "7",
        },
      });
    }
    const type = {
      id: typeId,
      m_nIDActionType: typeId,
      m_sTag: "SYNTHETIC-ACTION-TYPE",
      m_sLabel: "Synthetic copied action type",
    };
    if (path === "/api/resources/actiontypes")
      return reply({ data: [type], total: 1 });
    if (path === `/api/resources/actiontypes/${typeId}`)
      return reply({ data: type });
    // Every API request remains local to this fixture, including account and references.
    return reply({ data: [], total: 0 });
  });
  function hold(kind: "source" | "verification") {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (kind === "source") heldSource = { enter, wait };
    else heldVerification = { enter, wait };
    return { entered, release };
  }
  return {
    source,
    reads,
    mutations,
    errors,
    allowSource: () => {
      sourceStatus = undefined;
    },
    denySource: () => {
      sourceStatus = 403;
    },
    allowSave: () => {
      saveStatus = undefined;
    },
    setPreflight: (value: typeof preflight) => {
      preflight = value;
    },
    holdSource: () => hold("source"),
    holdVerification: () => hold("verification"),
  };
}

function fieldItem(page: Page, key: string) {
  return page
    .locator(".ant-form-item")
    .filter({ has: page.locator(`[id="${key}"]`) });
}
async function optionsFor(page: Page, key: "m_nIDAsset" | "m_nIDRule") {
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
  key: "m_nIDAsset" | "m_nIDRule",
  id: string,
) {
  const dropdown = await optionsFor(page, key);
  await dropdown
    .locator(".ant-select-item-option")
    .filter({ hasText: id })
    .click();
}
async function selectDestination(page: Page) {
  await selectReference(page, "m_nIDAsset", assetId);
  await selectReference(page, "m_nIDRule", ruleId);
}
async function expectDraft(page: Page, reverse = false) {
  await expect(
    page.getByRole("heading", { name: heading(reverse), exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("m_sTag (en)", { exact: true })).toHaveValue(
    "ACTION-MODEL",
  );
  await expect(page.getByLabel("m_sLabel (en)", { exact: true })).toHaveValue(
    sourceLabel,
  );
  await expect(page.getByLabel("Recipient", { exact: true })).toHaveValue(
    recipient,
  );
  await expect(page.getByLabel("Subject Text", { exact: true })).toHaveValue(
    subject,
  );
  await expect(page.getByLabel("Body Text", { exact: true })).toHaveValue(body);
  await expect(page.getByLabel("Level", { exact: true })).toHaveValue("4");
  if (reverse)
    await expect(
      page.getByRole("switch", { name: "Enabled", exact: true }),
    ).toHaveCount(0);
  else {
    await expect(
      page.getByRole("switch", { name: "Enabled", exact: true }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("switch", { name: "Enabled", exact: true }),
    ).toBeEnabled();
  }
  await expect(
    page.getByRole("switch", { name: "Is Template", exact: true }),
  ).toBeChecked({ checked: reverse });
  await expect(
    page.getByRole("switch", { name: "Is Template", exact: true }),
  ).toBeDisabled();
  await expect(fieldItem(page, "m_nIDActionType")).toContainText(typeId);
  await expect(page.locator('[id="m_nIDSensor"]')).toHaveCount(0);
  for (const key of ["m_nIDAsset", "m_nIDRule"])
    if (reverse) await expect(page.locator(`[id="${key}"]`)).toHaveCount(0);
    else
      await expect(
        fieldItem(page, key).locator(".ant-select-selection-item"),
      ).toHaveCount(0);
}
function expectedBody(reverse: boolean) {
  return {
    m_nIDActionType: typeId,
    m_nLevel: "4",
    m_sTag: tagJson,
    m_sLabel: labelJson,
    m_sRecipient: recipient,
    m_sSubjectText: subject,
    m_sBodyText: body,
    m_bEnabled: false,
    m_bIsTemplate: reverse,
    m_nIDAsset: reverse ? "0" : assetId,
    m_nIDRule: reverse ? "0" : ruleId,
  };
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

test("an ordinary reader and creator copies exact template messages and binds only a verified asset rule", async ({
  page,
}, testInfo) => {
  const mock = await syntheticAction(page);
  await page.goto(`/actions/${sourceId}`);
  await expect(
    page.getByRole("heading", { name: sourceLabel, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Edit$/ })).toHaveCount(0);
  const before = mock.reads.filter(
    (url) => url.pathname === `/api/resources/actions/${sourceId}`,
  ).length;
  await page.getByRole("button", { name: /Create from template$/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/actions/new\\?fromTemplate=${sourceId}$`),
  );
  await expectDraft(page);
  expect(
    mock.reads.filter(
      (url) => url.pathname === `/api/resources/actions/${sourceId}`,
    ).length,
  ).toBeGreaterThan(before);
  expect(
    mock.reads.filter((url) => url.pathname === "/api/resources/rules"),
  ).toHaveLength(0);
  await page.getByRole("button", { name: /Save action$/ }).click();
  expect(mock.mutations).toEqual([]);
  for (const key of ["m_nIDAsset", "m_nIDRule"])
    await expect(
      fieldItem(page, key).locator(".ant-form-item-explain-error").first(),
    ).toBeVisible();
  await selectReference(page, "m_nIDAsset", assetId);
  const choices = await optionsFor(page, "m_nIDRule");
  await expect(choices).toContainText(ruleId);
  for (const excluded of [otherRuleId, templateRuleId, oldRuleId])
    await expect(choices).not.toContainText(excluded);
  await choices
    .locator(".ant-select-item-option")
    .filter({ hasText: ruleId })
    .click();
  const listReads = mock.reads.filter(
    (url) => url.pathname === "/api/resources/rules",
  );
  expect(listReads.length).toBeGreaterThan(0);
  expect(
    listReads.every((url) => url.searchParams.get("idasset") === assetId),
  ).toBe(true);
  expect(
    listReads.every((url) => url.searchParams.get("istemplate") === "false"),
  ).toBe(true);
  await scrollToTop(page);
  await page.screenshot({
    path: testInfo.outputPath("action-template-copy-desktop.png"),
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
    path: testInfo.outputPath("action-template-copy-mobile.png"),
    animations: "disabled",
  });
  const held = mock.holdVerification();
  await page.getByRole("button", { name: /Save action$/ }).click();
  await held.entered;
  for (const key of ["m_nIDActionType", "m_nIDAsset", "m_nIDRule"])
    await expect(page.locator(`[id="${key}"]`)).toBeDisabled();
  expect(mock.mutations).toEqual([]);
  held.release();
  await expect(page).toHaveURL(/\/actions\/43$/);
  expect(mock.mutations).toEqual([
    {
      method: "POST",
      path: "/api/resources/actions",
      csrf: "synthetic-action-copy-csrf",
      body: expectedBody(false),
    },
  ]);
  for (const [resource, id] of [
    ["assets", assetId],
    ["rules", ruleId],
    ["sensors", sensorId],
  ])
    expect(
      mock.reads.some(
        (url) => url.pathname === `/api/resources/${resource}/${id}`,
      ),
    ).toBe(true);
  expect(mock.source.m_nIDAsset).toBe(oldAssetId);
  expect(mock.source.m_bIsTemplate).toBe(true);
  expect(mock.errors).toEqual([]);
});

test("a platform operator creates an unbound template from an existing action without copying runtime fields", async ({
  page,
}, testInfo) => {
  const mock = await syntheticAction(page, { reverse: true });
  await page.goto(`/actions/${sourceId}`);
  await expect(
    page.getByRole("heading", { name: sourceLabel, exact: true }),
  ).toBeVisible();
  const before = mock.reads.filter(
    (url) => url.pathname === `/api/resources/actions/${sourceId}`,
  ).length;
  await page
    .getByRole("button", { name: /Create template from action$/ })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/actions/new\\?fromAction=${sourceId}$`),
  );
  await expectDraft(page, true);
  expect(
    mock.reads.filter(
      (url) => url.pathname === `/api/resources/actions/${sourceId}`,
    ).length,
  ).toBeGreaterThan(before);
  await scrollToTop(page);
  await page.screenshot({
    path: testInfo.outputPath("action-create-template-desktop.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: /Save action$/ }).click();
  await expect(page).toHaveURL(/\/actions\/43$/);
  expect(mock.mutations).toEqual([
    {
      method: "POST",
      path: "/api/resources/actions",
      csrf: "synthetic-action-copy-csrf",
      body: expectedBody(true),
    },
  ]);
  expect(mock.source.m_bEnabled).toBe(true);
  expect(mock.source.m_bIsTemplate).toBe(false);
  expect(mock.source.m_nIDRule).toBe(oldRuleId);
  expect(mock.errors).toEqual([]);
});

test("changing an action draft's Asset clears Rule and scopes the next rule choices", async ({
  page,
}) => {
  const mock = await syntheticAction(page);
  await page.goto(copyPath());
  await expectDraft(page);
  await selectDestination(page);
  await selectReference(page, "m_nIDAsset", otherAssetId);
  await expect(
    fieldItem(page, "m_nIDRule").locator(".ant-select-selection-item"),
  ).toHaveCount(0);
  const choices = await optionsFor(page, "m_nIDRule");
  await expect(choices).toContainText(otherRuleId);
  await expect(choices).not.toContainText(ruleId);
  expect(
    mock.reads.some(
      (url) =>
        url.pathname === "/api/resources/rules" &&
        url.searchParams.get("idasset") === otherAssetId,
    ),
  ).toBe(true);
  expect(mock.mutations).toEqual([]);
});

for (const failure of [
  "rule-asset",
  "rule-template",
  "rule-sensor-zero",
  "sensor-asset",
  "sensor-id",
] as const)
  test(`fresh relationship verification rejects ${failure} before creating an action`, async ({
    page,
  }) => {
    const mock = await syntheticAction(page);
    await page.goto(copyPath());
    await expectDraft(page);
    await selectDestination(page);
    mock.setPreflight(failure);
    await page.getByRole("button", { name: /Save action$/ }).click();
    await expect(
      page.locator(".ant-alert-error").filter({
        hasText: failure.startsWith("rule-")
          ? "Choose a non-template rule belonging to the selected asset with a valid sensor."
          : "The rule's sensor must belong to the selected asset.",
      }),
    ).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`/actions/new\\?fromTemplate=${sourceId}$`),
    );
    expect(mock.mutations).toEqual([]);
  });

test("a failed action save retains messages, destination and enabled edits for retry", async ({
  page,
}) => {
  const mock = await syntheticAction(page, { saveStatus: 422 });
  await page.goto(copyPath());
  await expectDraft(page);
  await selectDestination(page);
  await page.getByRole("switch", { name: "Enabled", exact: true }).click();
  await page
    .getByLabel("Recipient", { exact: true })
    .fill("retry@example.test");
  await page.getByRole("button", { name: /Save action$/ }).click();
  await expect(
    page.getByText("Synthetic action creation failed.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Recipient", { exact: true })).toHaveValue(
    "retry@example.test",
  );
  await expect(page.getByLabel("Body Text", { exact: true })).toHaveValue(body);
  await expect(
    page.getByRole("switch", { name: "Enabled", exact: true }),
  ).toBeChecked();
  await expect(fieldItem(page, "m_nIDRule")).toContainText(ruleId);
  mock.allowSave();
  await page.getByRole("button", { name: /Save action$/ }).click();
  await expect(page).toHaveURL(/\/actions\/43$/);
  expect(mock.mutations).toHaveLength(2);
  expect(mock.mutations[1].body).toEqual({
    ...expectedBody(false),
    m_sRecipient: "retry@example.test",
    m_bEnabled: true,
  });
  expect(
    mock.mutations.every(
      (entry) =>
        entry.method === "POST" && entry.path === "/api/resources/actions",
    ),
  ).toBe(true);
});

test("Cancel preserves or discards a dirty action-template draft without writing", async ({
  page,
}) => {
  const mock = await syntheticAction(page, { reverse: true });
  await page.goto(copyPath(true));
  await expectDraft(page, true);
  const input = page.getByLabel("Subject Text", { exact: true });
  await input.fill("Edited synthetic subject");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(input).toHaveValue("Edited synthetic subject");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page).toHaveURL(/\/actions(?:\?|$)/);
  expect(mock.mutations).toEqual([]);
});

for (const reverse of [false, true]) {
  test(`${heading(reverse)} keeps loading and denied sources out of the form until retry succeeds`, async ({
    page,
  }) => {
    const mock = await syntheticAction(page, { reverse }),
      held = mock.holdSource();
    mock.denySource();
    await page.goto(copyPath(reverse));
    await held.entered;
    await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
    await expect(page.getByLabel("Recipient", { exact: true })).toHaveCount(0);
    held.release();
    await expect(
      page.getByText("Synthetic source action denied.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
    mock.allowSource();
    await page.getByRole("button", { name: /Retry$/ }).click();
    await expectDraft(page, reverse);
    expect(mock.mutations).toEqual([]);
  });

  test(`${heading(reverse)} requires a fresh strict source flag`, async ({
    page,
  }) => {
    const mock = await syntheticAction(page, { reverse });
    await page.goto(`/actions/${sourceId}`);
    const button = page.getByRole("button", {
      name: reverse ? /Create template from action$/ : /Create from template$/,
    });
    await expect(button).toBeVisible();
    mock.source.m_bIsTemplate = reverse;
    await button.click();
    await expect(
      page.getByText(sourceError(reverse), { exact: true }),
    ).toBeVisible();
    await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
    mock.source.m_bIsTemplate = String(!reverse);
    await page.goto(`/actions/${sourceId}`);
    await expect(
      page.getByRole("heading", { name: sourceLabel, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: reverse
          ? /Create template from action$/
          : /Create from template$/,
      }),
    ).toHaveCount(0);
    await page.goto(copyPath(reverse));
    await expect(
      page.getByText(sourceError(reverse), { exact: true }),
    ).toBeVisible();
    await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
    expect(mock.mutations).toEqual([]);
  });

  test(`${heading(reverse)} rejects mismatched source identities`, async ({
    page,
  }) => {
    const mock = await syntheticAction(page, { reverse, mismatchedId: true });
    await page.goto(copyPath(reverse));
    await expect(
      page.getByText(sourceError(reverse), { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Recipient", { exact: true })).toHaveCount(0);
    await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
    expect(mock.mutations).toEqual([]);
  });

  test(`${heading(reverse)} rejects malformed, repeated and conflicting source parameters before fetching`, async ({
    page,
  }) => {
    const mock = await syntheticAction(page, { reverse, level: 90 });
    const key = reverse ? "fromAction" : "fromTemplate";
    for (const path of [
      copyPath(reverse, "01"),
      copyPath(reverse, "9223372036854775808"),
      `${copyPath(reverse)}&${key}=${sourceId}`,
      `${copyPath(reverse)}&${reverse ? "fromTemplate" : "fromAction"}=${sourceId}`,
      `${copyPath(reverse)}&fromRule=${sourceId}`,
    ]) {
      await page.goto(path);
      await expect(
        page.getByText(/^Invalid (?:source|template) action ID\.$/),
      ).toBeVisible();
      await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(
        0,
      );
    }
    expect(
      mock.reads.filter((url) =>
        url.pathname.startsWith("/api/resources/actions/"),
      ),
    ).toHaveLength(0);
    expect(mock.mutations).toEqual([]);
  });
}

for (const restriction of [
  { name: "no create permission", rights: "r" },
  { name: "no source read permission", rights: "c" },
  { name: "writes disabled", writable: false },
  { name: "ordinary template author", reverse: true, level: 30 },
  { name: "platform template writes disabled", reverse: true, writable: false },
])
  test(`${restriction.name} cannot use an action-copy button or direct route`, async ({
    page,
  }) => {
    const mock = await syntheticAction(page, restriction);
    await page.goto(`/actions/${sourceId}`);
    await expect(
      page
        .getByText(
          restriction.rights === "c" ? "Access unavailable" : sourceLabel,
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: restriction.reverse
          ? /Create template from action$/
          : /Create from template$/,
      }),
    ).toHaveCount(0);
    await page.goto(copyPath(restriction.reverse));
    await expect(
      page.getByText("Changes are unavailable", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('button[type="submit"]:enabled')).toHaveCount(0);
    expect(mock.mutations).toEqual([]);
  });

test("a forced-password account cannot enter either action-copy editor", async ({
  page,
}) => {
  const mock = await syntheticAction(page, {
    reverse: true,
    mustChangePassword: true,
  });
  for (const reverse of [false, true]) {
    await page.goto(copyPath(reverse));
    await expect(
      page.getByText("Changes are unavailable", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator('button[type="submit"]:enabled')
        .filter({ hasText: "Save action" }),
    ).toHaveCount(0);
  }
  expect(
    mock.reads.filter((url) =>
      url.pathname.startsWith("/api/resources/actions/"),
    ),
  ).toHaveLength(0);
  expect(mock.mutations).toEqual([]);
});
