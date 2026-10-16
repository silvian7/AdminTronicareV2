import { expect, test, type Page } from "@playwright/test";
import type { Identity, RecordData } from "../../shared/resources";

const assetId = "9223372036854775807";
const userId = "9223372036854775806";
const ruleId = "9223372036854775805";
const groupId = "9223372036854775804";
const actionId = "9223372036854775803";
const assetLabel = "Synthetic navigable asset";
const groupLabel = "Synthetic navigable group";
const sensorLabel = "Synthetic navigable sensor";

async function mockRows(page: Page, canReadSensors = true) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic row navigation administrator",
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      ...["assets", "users", "usergroups"].map((entity) => ({
        entity,
        rights: "ru",
      })),
      ...[
        "rules",
        "actions",
        "organizations",
        "devices",
        "sensortypes",
        "sensorshistory",
      ].map((entity) => ({ entity, rights: "r" })),
      ...(canReadSensors ? [{ entity: "sensors", rights: "rud" }] : []),
    ],
  };
  const records: Record<string, RecordData[]> = {
    assets: [
      {
        id: assetId,
        m_nIDAsset: assetId,
        m_nIDOrganization: "7",
        m_sLabel: assetLabel,
        m_dhDhLastEvent: new Date().toISOString(),
        m_bPauseRules: false,
      },
    ],
    users: [
      {
        id: userId,
        m_nIDuser: userId,
        m_nIDOrganization: "7",
        m_nIDUserType: "0",
        m_sLogin: "synthetic-row-user",
        m_sFirst_name: "Row",
        m_sLast_name: "User",
        m_bDeleted: false,
      },
    ],
    rules: [
      {
        id: ruleId,
        m_nIDRule: ruleId,
        m_nIDRuleType: "0",
        m_nIDSensor: "0",
        m_nIDAsset: assetId,
        m_sLabel: "Synthetic navigable rule",
        m_bEnabled: true,
      },
    ],
    usergroups: [
      {
        id: groupId,
        m_nIDusergroup: groupId,
        m_nIDOrganization: "7",
        m_sLabel: groupLabel,
      },
    ],
    actions: [
      {
        id: actionId,
        m_nIDAction: actionId,
        m_nIDActionType: "0",
        m_nIDRule: ruleId,
        m_nIDAsset: assetId,
        m_sLabel: "Synthetic navigable action",
        m_bEnabled: true,
      },
    ],
    organizations: [
      {
        id: "7",
        m_nIDOrganization: "7",
        m_sTag: "SYNTHETIC-ROW-ORGANIZATION",
        m_sLabel: "Synthetic row organization",
      },
    ],
    devices: [
      {
        id: "55",
        m_nIDDevice: "55",
        m_nIDDeviceType: "0",
        m_nIDOrganization: "7",
        m_sLabel: "Synthetic navigable device",
      },
    ],
    sensors: [
      {
        id: "66",
        m_nIDSensor: "66",
        m_nIDSensorType: "0",
        m_nIDDevice: "55",
        m_sLabel: sensorLabel,
      },
    ],
  };
  const reads: URL[] = [];
  const mutations: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (request.method() !== "GET") {
      mutations.push(`${request.method()} ${url.pathname}`);
      return reply({ message: "Synthetic mutation unavailable." }, 405);
    }
    reads.push(url);
    if (url.pathname === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-row-navigation-csrf",
        expiresAt: Date.now() + 60 * 60_000,
      });
    if (url.pathname === "/api/history")
      return reply({
        data: [
          {
            m_nIDSensorHistory: "88",
            m_nIDSensor: "66",
            m_nIDSensorType: "0",
            m_bValueBool: true,
            m_nValueInt: "1",
            m_rValueReal: "2.5",
            m_dhDhLastEvent: new Date().toISOString(),
          },
        ],
        snapshot: null,
        highWaterId: null,
        hasMore: false,
      });
    const match = url.pathname.match(
      /^\/api\/resources\/([^/]+)(?:\/([^/]+))?$/,
    );
    if (match) {
      const rows = records[match[1]] ?? [];
      if (match[2]) {
        const record = rows.find((row) => row.id === match[2]);
        return record
          ? reply({ data: record })
          : reply({ message: "Synthetic record not found." }, 404);
      }
      return reply({ data: rows, total: rows.length });
    }
    // Every API call, including dashboard panels, is synthetic.
    return reply({ data: [], total: 0 });
  });
  return { reads, mutations };
}

function row(page: Page, id: string) {
  return page.locator(`tr[data-row-key="${id}"]`);
}

for (const record of [
  { resource: "assets", id: assetId },
  { resource: "users", id: userId },
  { resource: "rules", id: ruleId },
])
  test(`${record.resource} rows replace View with navigation to the exact selected record`, async ({
    page,
  }, testInfo) => {
    const mock = await mockRows(page);
    await page.goto(`/${record.resource}`);
    const selected = row(page, record.id);
    await expect(selected).toHaveClass(/clickable-record-row/);
    await expect(selected).toHaveAttribute("tabindex", "0");
    expect(await selected.getAttribute("role")).toBeNull();
    await expect(
      page.getByRole("button", { name: "View", exact: true }),
    ).toHaveCount(0);
    if (record.resource === "assets")
      await page.screenshot({
        path: testInfo.outputPath("clickable-list-rows.png"),
        animations: "disabled",
      });
    await selected.click({ position: { x: 8, y: 8 } });
    await expect(page).toHaveURL(`/${record.resource}/${record.id}`);
    await expect(
      page.getByRole("tab", { name: "Details", exact: true }),
    ).toBeVisible();
    expect(mock.mutations).toEqual([]);
  });

test("row keyboard activation works while modified clicks and selected text leave the list in place", async ({
  page,
}) => {
  const mock = await mockRows(page);
  await page.goto("/assets");
  const selected = row(page, assetId);
  await expect(selected).toBeVisible();
  const listUrl = page.url();
  await selected.dispatchEvent("click", { button: 0, ctrlKey: true });
  await selected.dispatchEvent("click", { button: 1 });
  await expect(page).toHaveURL(listUrl);
  await selected
    .getByRole("link", { name: assetLabel, exact: true })
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
  await selected.dispatchEvent("click", { button: 0 });
  await expect(page).toHaveURL(listUrl);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await selected.focus();
  await selected.press("Enter");
  await expect(page).toHaveURL(`/assets/${assetId}`);
  await page.goto("/assets");
  await row(page, assetId).focus();
  await row(page, assetId).press("Space");
  await expect(page).toHaveURL(`/assets/${assetId}`);
  expect(mock.mutations).toEqual([]);
});

test("a reference link in a row opens its own resource instead of the row record", async ({
  page,
}) => {
  await mockRows(page);
  await page.goto("/assets");
  await row(page, assetId)
    .getByRole("link", { name: "SYNTHETIC-ROW-ORGANIZATION", exact: true })
    .click();
  await expect(page).toHaveURL("/organizations/7");
});

test("nested Rule Actions rows open the corresponding action without a View control", async ({
  page,
}) => {
  const mock = await mockRows(page);
  await page.goto(`/rules/${ruleId}`);
  await page.getByRole("tab", { name: "Actions (1)", exact: true }).click();
  const selected = row(page, actionId);
  await expect(selected).toHaveClass(/clickable-record-row/);
  await expect(
    selected.getByRole("link", { name: "View", exact: true }),
  ).toHaveCount(0);
  await selected.getByRole("cell", { name: actionId, exact: true }).click();
  await expect(page).toHaveURL(`/actions/${actionId}`);
  expect(mock.mutations).toEqual([]);
});

test("Members Remove opens its confirmation while clicking the member row opens the user", async ({
  page,
}) => {
  const mock = await mockRows(page);
  await page.goto(`/usergroups/${groupId}`);
  await page.getByRole("tab", { name: "Members", exact: true }).click();
  const selected = row(page, userId);
  await selected
    .getByRole("button", { name: "Remove member", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Remove this member?");
  await expect(page).toHaveURL(`/usergroups/${groupId}`);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await selected
    .getByRole("cell", { name: "synthetic-row-user", exact: true })
    .click();
  await expect(page).toHaveURL(`/users/${userId}`);
  expect(mock.mutations).toEqual([]);
});

test("assignment Remove keeps the asset open while the assignment row opens its user", async ({
  page,
}) => {
  const mock = await mockRows(page);
  await page.goto(`/assets/${assetId}`);
  await page.getByRole("tab", { name: "Assignments", exact: true }).click();
  const selected = row(page, userId);
  await selected.getByRole("button", { name: "Remove", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Remove this user assignment?");
  await expect(page).toHaveURL(`/assets/${assetId}`);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await selected.getByRole("cell", { name: userId, exact: true }).click();
  await expect(page).toHaveURL(`/users/${userId}`);
  expect(mock.mutations).toEqual([]);
});

test("nested sensor Delete and Edit controls keep their own behavior without row navigation", async ({
  page,
}) => {
  const mock = await mockRows(page);
  await page.goto("/devices/55?tab=sensors");
  const selected = row(page, "66");
  await selected.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Delete this sensor?");
  await expect(page).toHaveURL("/devices/55?tab=sensors");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await selected.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL("/sensors/66/edit");
  expect(mock.mutations).toEqual([]);
});

test("overview asset rows and history reading rows open their corresponding records", async ({
  page,
}) => {
  const mock = await mockRows(page);
  await page.goto("/");
  const asset = row(page, assetId);
  await expect(asset).toHaveClass(/clickable-record-row/);
  await asset.getByRole("cell", { name: "Active", exact: true }).click();
  await expect(page).toHaveURL(`/assets/${assetId}`);
  await page.goto("/sensor-history?idsensor=66");
  await page.getByRole("button", { name: /Load history$/ }).click();
  const reading = row(page, "88");
  await expect(reading).toHaveClass(/clickable-record-row/);
  await reading.click({ position: { x: 8, y: 8 } });
  await expect(page).toHaveURL("/sensors/66");
  expect(mock.mutations).toEqual([]);
});

test("history rows cannot open sensors when sensor read permission is absent", async ({
  page,
}) => {
  const mock = await mockRows(page, false);
  await page.goto("/sensor-history?idsensor=66");
  await page.getByRole("button", { name: /Load history$/ }).click();
  const reading = row(page, "88");
  await expect(reading).toBeVisible();
  await expect(reading).not.toHaveClass(/clickable-record-row/);
  expect(await reading.getAttribute("tabindex")).toBeNull();
  const url = page.url();
  await reading.click({ position: { x: 8, y: 8 } });
  await reading.dispatchEvent("keydown", { key: "Enter" });
  await expect(page).toHaveURL(url);
  expect(
    mock.reads.filter((url) =>
      url.pathname.startsWith("/api/resources/sensors"),
    ),
  ).toEqual([]);
  expect(mock.mutations).toEqual([]);
});
