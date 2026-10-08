import { expect, test, type Page } from "@playwright/test";
import { type Identity, type RecordData } from "../../shared/resources";

const largeTypeId = "9223372036854775807";
const assetId = "9223372036854775806";
const organizationId = "7";
const typeTag = "SYNTHETIC-THRESHOLD-RULE-TYPE";
const typeLabel = "Synthetic descriptive rule type label";
const assetTag = "SYNTHETIC-RULE-ASSET";
const assetLabel = "Synthetic rule asset";

function ruleRecord(id: string, typeId: unknown, label: string): RecordData {
  return {
    id,
    m_nIDRule: id,
    m_nIDRuleType: typeId,
    m_nIDAsset: assetId,
    m_sTag: `SYNTHETIC-RULE-${id}`,
    m_sLabel: label,
    m_bEnabled: id === "41",
    m_bOutput: id !== "41",
    m_nLevel: "30",
  };
}

function ruleType(id: string, tag: string): RecordData {
  return {
    id,
    m_nIDRuleType: id,
    m_sTag: tag,
    m_sLabel: typeLabel,
  };
}

async function syntheticRules(
  page: Page,
  options: {
    canReadTypes?: boolean;
    rows?: RecordData[];
    types?: Record<string, { data?: RecordData; status?: number }>;
  } = {},
) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic rule reader",
    organizationId,
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      { entity: "rules", rights: "r" },
      { entity: "assets", rights: "r" },
      ...(options.canReadTypes === false
        ? []
        : [{ entity: "ruletypes", rights: "r" }]),
    ],
  };
  const rows = options.rows ?? [
    ruleRecord("41", largeTypeId, "Synthetic first rule"),
    ruleRecord("42", largeTypeId, "Synthetic second rule"),
  ];
  const types = options.types ?? {
    [largeTypeId]: {
      data: ruleType(
        largeTypeId,
        JSON.stringify({
          messages: [
            { lang: "fr", text: "SYNTHETIC-TYPE-FRANCAIS" },
            { lang: "en", text: typeTag },
          ],
        }),
      ),
    },
  };
  const asset = {
    id: assetId,
    m_nIDAsset: assetId,
    m_nIDOrganization: organizationId,
    m_sTag: assetTag,
    m_sLabel: assetLabel,
  };
  const reads: URL[] = [];
  const typeReads: string[] = [];
  const mutations: string[] = [];
  let denyTypes = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    reads.push(url);
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (request.method() !== "GET") {
      mutations.push(`${request.method()} ${path}`);
      return reply({ message: "Synthetic read-only fixture." }, 405);
    }
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-rule-types-csrf",
        expiresAt: Date.now() + 60000,
      });
    if (path === "/api/resources/rules")
      return reply({ data: rows, total: rows.length });
    if (path.startsWith("/api/resources/rules/")) {
      const id = path.split("/").at(-1);
      const data = rows.find((row) => row.id === id);
      return data
        ? reply({ data })
        : reply({ message: "Synthetic rule unavailable." }, 404);
    }
    if (path.startsWith("/api/resources/ruletypes/")) {
      const id = path.split("/").at(-1)!;
      typeReads.push(id);
      const type = types[id];
      const status = denyTypes ? 403 : (type?.status ?? 200);
      return status !== 200 || !type?.data
        ? reply(
            { message: "Synthetic rule type unavailable." },
            status === 200 ? 404 : status,
          )
        : reply({ data: type.data });
    }
    if (path === `/api/resources/assets/${assetId}`)
      return reply({ data: asset });
    // Intercept every API request; no calls reach real services or records.
    return reply({ data: [], total: 0 });
  });
  return {
    reads,
    typeReads,
    mutations,
    updateTypeTag: (id: string, tag: string) => {
      if (types[id]?.data) types[id].data!.m_sTag = tag;
    },
    denyTypeReads: () => {
      denyTypes = true;
    },
  };
}

function listRow(page: Page, label: string) {
  return page
    .getByRole("link", { name: label, exact: true })
    .locator("xpath=ancestor::tr");
}

async function columnIndex(page: Page, name: string) {
  return page
    .getByRole("columnheader", { name, exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
}

test("Rules shows type tags after Rule with exact type links and shared lookups", async ({
  page,
}) => {
  const mock = await syntheticRules(page);
  await page.goto("/rules");
  await expect(
    page.getByRole("heading", { name: "Rules", exact: true }),
  ).toBeVisible();
  expect(
    (await page.getByRole("columnheader").allTextContents()).slice(0, 6),
  ).toEqual(["Rule", "Type", "Asset", "Enabled", "Level", "Output"]);
  for (const label of ["Synthetic first rule", "Synthetic second rule"]) {
    await expect(
      listRow(page, label).getByRole("link", { name: typeTag, exact: true }),
    ).toHaveAttribute("href", `/ruletypes/${largeTypeId}`);
  }
  await expect(page.getByText(typeLabel, { exact: true })).toHaveCount(0);
  expect(mock.typeReads).toEqual([largeTypeId]);
  expect(
    mock.reads.some(
      (url) =>
        url.pathname === "/api/resources/rules" &&
        url.searchParams.get("_organization") === organizationId,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "Synthetic first rule", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Synthetic first rule", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".ant-descriptions")
      .getByRole("link", { name: typeTag, exact: true }),
  ).toHaveAttribute("href", `/ruletypes/${largeTypeId}`);
  expect(mock.typeReads).toEqual([largeTypeId]);
  expect(mock.mutations).toEqual([]);
});

test("Rules type references preserve the exact ID without reading or linking unauthorized types", async ({
  page,
}) => {
  const mock = await syntheticRules(page, { canReadTypes: false });
  await page.goto("/rules");
  const row = listRow(page, "Synthetic first rule");
  await expect(row.getByText(`#${largeTypeId}`, { exact: true })).toBeVisible();
  await expect(row.locator('a[href^="/ruletypes/"]')).toHaveCount(0);
  await row
    .getByRole("link", { name: "Synthetic first rule", exact: true })
    .click();
  const detail = page.locator(".ant-descriptions");
  await expect(
    detail.getByText(`#${largeTypeId}`, { exact: true }),
  ).toBeVisible();
  await expect(detail.locator('a[href^="/ruletypes/"]')).toHaveCount(0);
  expect(mock.typeReads).toEqual([]);
  expect(mock.mutations).toEqual([]);
});

test("unavailable, empty-tag, zero and absent rule types preserve Rules rows", async ({
  page,
}) => {
  const definitions = [
    { id: "51", typeId: "98", label: "Synthetic forbidden type rule" },
    { id: "52", typeId: "99", label: "Synthetic missing type rule" },
    { id: "53", typeId: "100", label: "Synthetic empty-tag rule" },
    { id: "54", typeId: "101", label: "Synthetic failed type rule" },
    { id: "55", typeId: "0", label: "Synthetic unassigned type rule" },
    { id: "56", typeId: undefined, label: "Synthetic absent type rule" },
    { id: "57", typeId: null, label: "Synthetic null type rule" },
  ];
  const mock = await syntheticRules(page, {
    rows: definitions.map(({ id, typeId, label }) =>
      ruleRecord(id, typeId, label),
    ),
    types: {
      "98": { status: 403 },
      "99": { status: 404 },
      "100": { data: ruleType("100", "") },
      "101": { status: 500 },
    },
  });
  await page.goto("/rules");
  const typeColumn = await columnIndex(page, "Type");
  for (const { typeId, label } of definitions.slice(0, 4))
    await expect(
      listRow(page, label).getByRole("link", {
        name: `#${typeId}`,
        exact: true,
      }),
    ).toHaveAttribute("href", `/ruletypes/${typeId}`);
  for (const { label, value } of [
    { label: "Synthetic unassigned type rule", value: "0" },
    { label: "Synthetic absent type rule", value: "\u2014" },
    { label: "Synthetic null type rule", value: "\u2014" },
  ])
    await expect(
      listRow(page, label).getByRole("cell").nth(typeColumn),
    ).toHaveText(value);
  await expect(page.getByText(typeLabel, { exact: true })).toHaveCount(0);
  expect(mock.typeReads).not.toContain("0");
  expect(mock.typeReads).not.toContain("undefined");
  expect(mock.typeReads).not.toContain("null");
  expect(mock.mutations).toEqual([]);
});

test("Rules refresh updates type tags and suppresses cached metadata after denied reads", async ({
  page,
}) => {
  const mock = await syntheticRules(page);
  await page.goto("/rules");
  await expect(
    listRow(page, "Synthetic first rule").getByRole("link", {
      name: typeTag,
      exact: true,
    }),
  ).toBeVisible();
  const changedTag = "UPDATED-SYNTHETIC-RULE-TYPE";
  mock.updateTypeTag(largeTypeId, changedTag);
  await page.getByRole("button", { name: /Refresh$/ }).click();
  for (const label of ["Synthetic first rule", "Synthetic second rule"])
    await expect(
      listRow(page, label).getByRole("link", { name: changedTag, exact: true }),
    ).toHaveAttribute("href", `/ruletypes/${largeTypeId}`);
  await expect(page.getByText(typeTag, { exact: true })).toHaveCount(0);
  mock.denyTypeReads();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  for (const label of ["Synthetic first rule", "Synthetic second rule"])
    await expect(
      listRow(page, label).getByRole("link", {
        name: `#${largeTypeId}`,
        exact: true,
      }),
    ).toHaveAttribute("href", `/ruletypes/${largeTypeId}`);
  await expect(page.getByText(changedTag, { exact: true })).toHaveCount(0);
  expect(mock.typeReads).toHaveLength(3);
  expect(mock.mutations).toEqual([]);
});

test("Asset Equipment Rules places Type second and retains Asset, Enabled, Level and Output", async ({
  page,
}) => {
  const mock = await syntheticRules(page);
  await page.goto(`/assets/${assetId}`);
  await expect(
    page.getByRole("heading", { name: assetLabel, exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Equipment", exact: true }).click();
  await page.getByRole("tab", { name: "Rules", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "Type", exact: true }),
  ).toBeVisible();
  expect(await page.getByRole("columnheader").allTextContents()).toEqual([
    "Rule",
    "Type",
    "Asset",
    "Enabled",
    "Level",
    "Output",
    "ID",
  ]);
  const assetColumn = await columnIndex(page, "Asset");
  const enabledColumn = await columnIndex(page, "Enabled");
  const levelColumn = await columnIndex(page, "Level");
  const outputColumn = await columnIndex(page, "Output");
  for (const [label, enabled, output] of [
    ["Synthetic first rule", "Yes", "No"],
    ["Synthetic second rule", "No", "Yes"],
  ]) {
    const row = listRow(page, label);
    await expect(
      row.getByRole("link", { name: typeTag, exact: true }),
    ).toHaveAttribute("href", `/ruletypes/${largeTypeId}`);
    for (const name of [assetTag, assetLabel])
      await expect(
        row
          .getByRole("cell")
          .nth(assetColumn)
          .getByRole("link", { name, exact: true }),
      ).toHaveAttribute("href", `/assets/${assetId}`);
    await expect(row.getByRole("cell").nth(enabledColumn)).toHaveText(enabled!);
    await expect(row.getByRole("cell").nth(levelColumn)).toHaveText("30");
    await expect(row.getByRole("cell").nth(outputColumn)).toHaveText(output!);
  }
  expect(mock.typeReads).toEqual([largeTypeId]);
  const linkedReads = mock.reads.filter(
    (url) => url.pathname === "/api/resources/rules",
  );
  expect(linkedReads.length).toBeGreaterThan(0);
  expect(
    linkedReads.every(
      (url) =>
        url.searchParams.get("idasset") === assetId &&
        url.searchParams.get("_organization") === organizationId,
    ),
  ).toBe(true);
  expect(mock.mutations).toEqual([]);
});
