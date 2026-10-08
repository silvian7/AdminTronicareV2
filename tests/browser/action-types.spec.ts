import { expect, test, type Page } from "@playwright/test";
import { type Identity, type RecordData } from "../../shared/resources";

const largeTypeId = "9223372036854775807";
const assetId = "9223372036854775806";
const organizationId = "7";
const ruleId = "61";
const typeTag = "SYNTHETIC-NOTIFICATION-TYPE";
const typeLabel = "Synthetic descriptive action type label";
const assetTag = "SYNTHETIC-ACTION-ASSET";
const assetLabel = "Synthetic action asset";
const ruleLabel = "Synthetic action parent rule";

function action(id: string, typeId: unknown, label: string): RecordData {
  return {
    id,
    m_nIDAction: id,
    m_nIDActionType: typeId,
    m_nIDRule: ruleId,
    m_nIDAsset: assetId,
    m_sAssetTag: id === "41" ? "" : "STALE-SYNTHETIC-WIRE-ASSET-TAG",
    m_sTag: `SYNTHETIC-ACTION-${id}`,
    m_sLabel: label,
    m_bEnabled: id === "41",
    m_nLevel: "30",
  };
}

function actionType(id: string, tag: string): RecordData {
  return {
    id,
    m_nIDActionType: id,
    m_sTag: tag,
    m_sLabel: typeLabel,
  };
}

async function syntheticActions(
  page: Page,
  options: {
    canReadTypes?: boolean;
    canReadAssets?: boolean;
    rows?: RecordData[];
    types?: Record<string, { data?: RecordData; status?: number }>;
    assets?: Record<string, { data?: RecordData; status?: number }>;
  } = {},
) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic action reader",
    organizationId,
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      { entity: "actions", rights: "r" },
      { entity: "rules", rights: "r" },
      ...(options.canReadAssets === false
        ? []
        : [{ entity: "assets", rights: "r" }]),
      ...(options.canReadTypes === false
        ? []
        : [{ entity: "actiontypes", rights: "r" }]),
    ],
  };
  const rows = options.rows ?? [
    action("41", largeTypeId, "Synthetic first action"),
    action("42", largeTypeId, "Synthetic second action"),
  ];
  const types = options.types ?? {
    [largeTypeId]: {
      data: actionType(
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
  const rule = {
    id: ruleId,
    m_nIDRule: ruleId,
    m_sTag: "SYNTHETIC-ACTION-PARENT-RULE",
    m_sLabel: ruleLabel,
    m_bEnabled: true,
  };
  const assets = options.assets ?? {
    [assetId]: {
      data: {
        id: assetId,
        m_nIDAsset: assetId,
        m_nIDOrganization: organizationId,
        m_sTag: JSON.stringify({
          messages: [
            { lang: "fr", text: "SYNTHETIC-FRENCH-ASSET-TAG" },
            { lang: "en", text: assetTag },
          ],
        }),
        m_sLabel: assetLabel,
      },
    },
  };
  const reads: URL[] = [];
  const typeReads: string[] = [];
  const assetReads: string[] = [];
  const mutations: string[] = [];
  let denyTypes = false;
  let denyAssets = false;
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
        csrf: "synthetic-action-types-csrf",
        expiresAt: Date.now() + 60000,
      });
    if (path === "/api/resources/actions")
      return reply({ data: rows, total: rows.length });
    if (path.startsWith("/api/resources/actions/")) {
      const id = path.split("/").at(-1);
      const data = rows.find((row) => row.id === id);
      return data
        ? reply({ data })
        : reply({ message: "Synthetic action unavailable." }, 404);
    }
    if (path.startsWith("/api/resources/actiontypes/")) {
      const id = path.split("/").at(-1)!;
      typeReads.push(id);
      const type = types[id];
      const status = denyTypes ? 403 : (type?.status ?? 200);
      return status !== 200 || !type?.data
        ? reply(
            { message: "Synthetic action type unavailable." },
            status === 200 ? 404 : status,
          )
        : reply({ data: type.data });
    }
    if (path.startsWith("/api/resources/assets/")) {
      const id = path.split("/").at(-1)!;
      assetReads.push(id);
      const asset = assets[id];
      const status = denyAssets ? 403 : (asset?.status ?? 200);
      return status !== 200 || !asset?.data
        ? reply(
            { message: "Synthetic asset unavailable." },
            status === 200 ? 404 : status,
          )
        : reply({ data: asset.data });
    }
    if (path === `/api/resources/rules/${ruleId}`) return reply({ data: rule });
    // Intercept every API request; no calls reach real services or records.
    return reply({ data: [], total: 0 });
  });
  return {
    reads,
    typeReads,
    assetReads,
    mutations,
    updateTypeTag: (id: string, tag: string) => {
      if (types[id]?.data) types[id].data!.m_sTag = tag;
    },
    denyTypeReads: () => {
      denyTypes = true;
    },
    updateAssetTag: (id: string, tag: string) => {
      if (assets[id]?.data) assets[id].data!.m_sTag = tag;
    },
    denyAssetReads: () => {
      denyAssets = true;
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

function detailAssetTag(page: Page) {
  return page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: /^Asset Tag$/ })
    .locator("xpath=following-sibling::*[1]");
}

test("Actions shows type tags after Action with exact type links and shared lookups", async ({
  page,
}) => {
  const mock = await syntheticActions(page);
  await page.goto("/actions");
  await expect(
    page.getByRole("heading", { name: "Actions", exact: true }),
  ).toBeVisible();
  expect(
    (await page.getByRole("columnheader").allTextContents()).slice(0, 5),
  ).toEqual(["Action", "Type", "Asset", "Enabled", "Level"]);
  for (const label of ["Synthetic first action", "Synthetic second action"]) {
    await expect(
      listRow(page, label).getByRole("link", { name: typeTag, exact: true }),
    ).toHaveAttribute("href", `/actiontypes/${largeTypeId}`);
  }
  await expect(page.getByText(typeLabel, { exact: true })).toHaveCount(0);
  expect(mock.typeReads).toEqual([largeTypeId]);
  expect(
    mock.reads.some(
      (url) =>
        url.pathname === "/api/resources/actions" &&
        url.searchParams.get("_organization") === organizationId,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "Synthetic first action", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Synthetic first action", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".ant-descriptions")
      .getByRole("link", { name: typeTag, exact: true }),
  ).toHaveAttribute("href", `/actiontypes/${largeTypeId}`);
  await expect(
    detailAssetTag(page).getByRole("link", { name: assetTag, exact: true }),
  ).toHaveAttribute("href", `/assets/${assetId}`);
  expect(mock.assetReads).toEqual([assetId]);
  expect(mock.typeReads).toEqual([largeTypeId]);
  expect(mock.mutations).toEqual([]);
});

test("Action detail refresh resolves the current asset tag and removes cached metadata after denied reads", async ({
  page,
}) => {
  const mock = await syntheticActions(page);
  await page.goto("/actions/42");
  await expect(
    page.getByRole("heading", { name: "Synthetic second action", exact: true }),
  ).toBeVisible();
  const tag = detailAssetTag(page);
  await expect(
    tag.getByRole("link", { name: assetTag, exact: true }),
  ).toHaveAttribute("href", `/assets/${assetId}`);
  await expect(
    page.getByText("STALE-SYNTHETIC-WIRE-ASSET-TAG", { exact: true }),
  ).toHaveCount(0);
  const changedTag = "RENAMED-SYNTHETIC-ASSET-TAG";
  mock.updateAssetTag(
    assetId,
    JSON.stringify({
      messages: [
        { lang: "fr", text: "SYNTHETIC-RENAMED-FRENCH-ASSET" },
        { lang: "en", text: changedTag },
      ],
    }),
  );
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(
    tag.getByRole("link", { name: changedTag, exact: true }),
  ).toHaveAttribute("href", `/assets/${assetId}`);
  await expect(page.getByText(assetTag, { exact: true })).toHaveCount(0);
  mock.denyAssetReads();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(tag).toHaveText("\u2014");
  await expect(tag.getByRole("link")).toHaveCount(0);
  await expect(page.getByText(changedTag, { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("STALE-SYNTHETIC-WIRE-ASSET-TAG", { exact: true }),
  ).toHaveCount(0);
  expect(mock.assetReads).toEqual([assetId, assetId, assetId]);
  expect(mock.mutations).toEqual([]);
});

test("Actions remain readable without Assets permission and do not fetch or disclose asset tag metadata", async ({
  page,
}) => {
  const mock = await syntheticActions(page, { canReadAssets: false });
  await page.goto("/actions");
  const row = listRow(page, "Synthetic second action");
  await expect(row.getByText(`#${assetId}`, { exact: true })).toBeVisible();
  await row
    .getByRole("link", { name: "Synthetic second action", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Synthetic second action", exact: true }),
  ).toBeVisible();
  await expect(detailAssetTag(page)).toHaveText("\u2014");
  await expect(detailAssetTag(page).getByRole("link")).toHaveCount(0);
  await expect(
    page.getByText("STALE-SYNTHETIC-WIRE-ASSET-TAG", { exact: true }),
  ).toHaveCount(0);
  expect(mock.assetReads).toEqual([]);
  expect(mock.mutations).toEqual([]);
});

test("unassigned, missing and mismatched associated assets cannot supply an Action asset tag", async ({
  page,
}) => {
  const definitions = [
    { id: "51", linkedId: "0" },
    { id: "52", linkedId: null },
    { id: "53", linkedId: undefined },
    { id: "54", linkedId: "97" },
    { id: "55", linkedId: "98" },
  ];
  const rows = definitions.map(({ id, linkedId }) => ({
    ...action(id, largeTypeId, `Synthetic unresolved asset action ${id}`),
    m_nIDAsset: linkedId,
    m_sAssetTag: "STALE-SYNTHETIC-WIRE-ASSET-TAG",
  }));
  const mock = await syntheticActions(page, {
    rows,
    assets: {
      "97": { status: 404 },
      "98": {
        data: {
          id: "99",
          m_nIDAsset: "99",
          m_sTag: "SYNTHETIC-UNRELATED-ASSET-TAG",
          m_sLabel: "Synthetic unrelated asset",
        },
      },
    },
  });
  for (const { id } of definitions) {
    await page.goto(`/actions/${id}`);
    await expect(
      page.getByRole("heading", {
        name: `Synthetic unresolved asset action ${id}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(detailAssetTag(page)).toHaveText("\u2014");
    await expect(detailAssetTag(page).getByRole("link")).toHaveCount(0);
    await expect(
      page.getByText("STALE-SYNTHETIC-WIRE-ASSET-TAG", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("SYNTHETIC-UNRELATED-ASSET-TAG", { exact: true }),
    ).toHaveCount(0);
  }
  expect(mock.assetReads).toEqual(["97", "98"]);
  expect(mock.mutations).toEqual([]);
});

test("Actions type references preserve the exact ID without reading or linking unauthorized types", async ({
  page,
}) => {
  const mock = await syntheticActions(page, { canReadTypes: false });
  await page.goto("/actions");
  const row = listRow(page, "Synthetic first action");
  await expect(row.getByText(`#${largeTypeId}`, { exact: true })).toBeVisible();
  await expect(row.locator('a[href^="/actiontypes/"]')).toHaveCount(0);
  await row
    .getByRole("link", { name: "Synthetic first action", exact: true })
    .click();
  const detail = page.locator(".ant-descriptions");
  await expect(
    detail.getByText(`#${largeTypeId}`, { exact: true }),
  ).toBeVisible();
  await expect(detail.locator('a[href^="/actiontypes/"]')).toHaveCount(0);
  expect(mock.typeReads).toEqual([]);
  expect(mock.mutations).toEqual([]);
});

test("unavailable, empty-tag, zero and absent action types preserve Actions rows", async ({
  page,
}) => {
  const definitions = [
    { id: "51", typeId: "98", label: "Synthetic forbidden type action" },
    { id: "52", typeId: "99", label: "Synthetic missing type action" },
    { id: "53", typeId: "100", label: "Synthetic empty-tag action" },
    { id: "54", typeId: "101", label: "Synthetic failed type action" },
    { id: "55", typeId: "0", label: "Synthetic unassigned type action" },
    { id: "56", typeId: undefined, label: "Synthetic absent type action" },
    { id: "57", typeId: null, label: "Synthetic null type action" },
  ];
  const mock = await syntheticActions(page, {
    rows: definitions.map(({ id, typeId, label }) => action(id, typeId, label)),
    types: {
      "98": { status: 403 },
      "99": { status: 404 },
      "100": { data: actionType("100", "") },
      "101": { status: 500 },
    },
  });
  await page.goto("/actions");
  const typeColumn = await columnIndex(page, "Type");
  for (const { typeId, label } of definitions.slice(0, 4))
    await expect(
      listRow(page, label).getByRole("link", {
        name: `#${typeId}`,
        exact: true,
      }),
    ).toHaveAttribute("href", `/actiontypes/${typeId}`);
  for (const { label, value } of [
    { label: "Synthetic unassigned type action", value: "0" },
    { label: "Synthetic absent type action", value: "\u2014" },
    { label: "Synthetic null type action", value: "\u2014" },
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

test("Actions refresh updates type tags and suppresses cached metadata after denied reads", async ({
  page,
}) => {
  const mock = await syntheticActions(page);
  await page.goto("/actions");
  await expect(
    listRow(page, "Synthetic first action").getByRole("link", {
      name: typeTag,
      exact: true,
    }),
  ).toBeVisible();
  const changedTag = "UPDATED-SYNTHETIC-ACTION-TYPE";
  mock.updateTypeTag(largeTypeId, changedTag);
  await page.getByRole("button", { name: /Refresh$/ }).click();
  for (const label of ["Synthetic first action", "Synthetic second action"])
    await expect(
      listRow(page, label).getByRole("link", { name: changedTag, exact: true }),
    ).toHaveAttribute("href", `/actiontypes/${largeTypeId}`);
  await expect(page.getByText(typeTag, { exact: true })).toHaveCount(0);
  mock.denyTypeReads();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  for (const label of ["Synthetic first action", "Synthetic second action"])
    await expect(
      listRow(page, label).getByRole("link", {
        name: `#${largeTypeId}`,
        exact: true,
      }),
    ).toHaveAttribute("href", `/actiontypes/${largeTypeId}`);
  await expect(page.getByText(changedTag, { exact: true })).toHaveCount(0);
  expect(mock.typeReads).toHaveLength(3);
  expect(mock.mutations).toEqual([]);
});

test("Rule Actions includes type tags while retaining Asset, Enabled and Level", async ({
  page,
}) => {
  const mock = await syntheticActions(page);
  await page.goto(`/rules/${ruleId}`);
  await expect(
    page.getByRole("heading", { name: ruleLabel, exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Actions", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "Type", exact: true }),
  ).toBeVisible();
  expect(await page.getByRole("columnheader").allTextContents()).toEqual([
    "Action",
    "ID",
    "Type",
    "Asset",
    "Enabled",
    "Level",
  ]);
  const assetColumn = await columnIndex(page, "Asset");
  const enabledColumn = await columnIndex(page, "Enabled");
  const levelColumn = await columnIndex(page, "Level");
  for (const [label, enabled] of [
    ["Synthetic first action", "Yes"],
    ["Synthetic second action", "No"],
  ]) {
    const row = listRow(page, label);
    await expect(
      row.getByRole("link", { name: typeTag, exact: true }),
    ).toHaveAttribute("href", `/actiontypes/${largeTypeId}`);
    for (const name of [assetTag, assetLabel])
      await expect(
        row
          .getByRole("cell")
          .nth(assetColumn)
          .getByRole("link", { name, exact: true }),
      ).toHaveAttribute("href", `/assets/${assetId}`);
    await expect(row.getByRole("cell").nth(enabledColumn)).toHaveText(enabled!);
    await expect(row.getByRole("cell").nth(levelColumn)).toHaveText("30");
  }
  expect(mock.typeReads).toEqual([largeTypeId]);
  const linkedReads = mock.reads.filter(
    (url) => url.pathname === "/api/resources/actions",
  );
  expect(linkedReads.length).toBeGreaterThan(0);
  expect(
    linkedReads.every(
      (url) =>
        url.searchParams.get("idrule") === ruleId &&
        url.searchParams.get("_organization") === organizationId,
    ),
  ).toBe(true);
  expect(mock.mutations).toEqual([]);
});
