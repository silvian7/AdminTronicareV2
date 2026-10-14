import { expect, test, type Page } from "@playwright/test";
import type { Identity, RecordData } from "../../shared/resources";

async function syntheticWorkspace(page: Page, level = 90) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic workspace administrator",
    organizationId: "0",
    userTypeId: String(level),
    level,
    mustChangePassword: false,
    permissions: [
      { entity: "organizations", rights: "r" },
      { entity: "assets", rights: "crud" },
      { entity: "hubs", rights: "r" },
    ],
  };
  const assets: RecordData[] = [
    {
      id: "41",
      m_nIDAsset: "41",
      m_nIDOrganization: "0",
      m_sLabel: "Synthetic unassigned asset",
    },
    {
      id: "42",
      m_nIDAsset: "42",
      m_nIDOrganization: "7",
      m_sLabel: "Synthetic assigned asset",
    },
  ];
  const hubs: RecordData[] = [
    {
      id: "51",
      m_nIDHub: "51",
      m_nIDOrganization: "0",
      m_sLabel: "Synthetic unassigned hub",
    },
    {
      id: "52",
      m_nIDHub: "52",
      m_nIDOrganization: "7",
      m_sLabel: "Synthetic assigned hub",
    },
  ];
  const organizations: RecordData[] = [
    {
      id: "0",
      m_nIDOrganization: "0",
      m_sTag: "Synthetic zero organization tag",
    },
    { id: "7", m_nIDOrganization: "7", m_sTag: "Synthetic organization seven" },
  ];
  const reads: URL[] = [];
  const updates: { path: string; body: unknown }[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    reads.push(url);
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-workspace-csrf",
        expiresAt: Date.now() + 60000,
      });
    const asset = assets.find(
      (row) => url.pathname === `/api/resources/assets/${row.id}`,
    );
    if (asset) {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        updates.push({ path: url.pathname, body });
        Object.assign(asset, body);
      }
      return reply({ data: asset });
    }
    if (route.request().method() !== "GET")
      return reply({ message: "Synthetic operation unavailable." }, 405);
    const rows =
      url.pathname === "/api/resources/organizations"
        ? organizations
        : url.pathname === "/api/resources/assets"
          ? assets
          : url.pathname === "/api/resources/hubs"
            ? hubs
            : undefined;
    if (rows) {
      const organization = url.searchParams.get("_organization");
      const data =
        organization === null
          ? rows
          : rows.filter((row) => row.m_nIDOrganization === organization);
      return reply({ data, total: data.length });
    }
    // Every API call is synthetic, including unrelated dashboard panels.
    return reply({ data: [], total: 0 });
  });
  return { reads, updates };
}

async function chooseOrganization(page: Page, label: string) {
  await page.locator(".organization-picker .ant-select-selector").click();
  const dropdown = page.locator(
    ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
  );
  await dropdown.getByText(label, { exact: true }).click();
  await expect(
    page.locator(".organization-picker .ant-select-selection-item"),
  ).toHaveText(label);
}

test("platform administrators can scope the workspace to Unassigned and return to all organizations", async ({
  page,
}) => {
  const { reads } = await syntheticWorkspace(page);
  await page.goto("/assets");
  await expect(
    page.getByRole("link", { name: "Synthetic assigned asset", exact: true }),
  ).toBeVisible();
  await page.locator(".organization-picker .ant-select-selector").click();
  const dropdown = page.locator(
    ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
  );
  await expect(dropdown.getByText("Unassigned", { exact: true })).toHaveCount(
    1,
  );
  await expect(
    dropdown.getByText("Synthetic zero organization tag", { exact: true }),
  ).toHaveCount(0);
  const beforeScope = reads.length;
  await dropdown.getByText("Unassigned", { exact: true }).click();
  await expect(
    page.locator(".organization-picker .ant-select-selection-item"),
  ).toHaveText("Unassigned");
  await expect(
    page.getByRole("link", { name: "Synthetic unassigned asset", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Synthetic assigned asset", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: /Overview$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Your workspace" }),
  ).toBeVisible();
  for (const resource of ["assets", "hubs"]) {
    await expect
      .poll(() =>
        reads
          .slice(beforeScope)
          .some(
            (url) =>
              url.pathname === `/api/resources/${resource}` &&
              url.searchParams.get("_organization") === "0",
          ),
      )
      .toBe(true);
  }
  await page.getByRole("menuitem", { name: "Assets", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Assets", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Synthetic unassigned asset", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Synthetic assigned asset", exact: true }),
  ).toHaveCount(0);
  await chooseOrganization(page, "All accessible organizations");
  await page.getByRole("menuitem", { name: "Assets", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Assets", exact: true }),
  ).toBeVisible();
  const unscopedResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/resources/assets" &&
      !url.searchParams.has("_organization")
    );
  });
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await unscopedResponse;
  for (const label of [
    "Synthetic unassigned asset",
    "Synthetic assigned asset",
  ])
    await expect(
      page.getByRole("link", { name: label, exact: true }),
    ).toBeVisible();
});

test("an ordinary administrator with organization zero remains scoped to disabled Unassigned", async ({
  page,
}) => {
  const { reads } = await syntheticWorkspace(page, 30);
  await page.goto("/assets");
  await expect(
    page.getByRole("heading", { name: "Assets", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Organization", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".organization-picker")).toContainText(
    "Unassigned",
  );
  await expect(
    page.getByRole("link", { name: "Synthetic unassigned asset", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Synthetic assigned asset", exact: true }),
  ).toHaveCount(0);
  const assetReads = reads.filter(
    (url) => url.pathname === "/api/resources/assets",
  );
  expect(assetReads.length).toBeGreaterThan(0);
  expect(
    assetReads.every((url) => url.searchParams.get("_organization") === "0"),
  ).toBe(true);
  await page
    .getByRole("link", { name: "Synthetic unassigned asset", exact: true })
    .click();
  await page.getByRole("button", { name: /Edit$/ }).click();
  await page
    .locator("form .ant-select")
    .filter({ has: page.locator("#m_nIDOrganization") })
    .locator(".ant-select-selector")
    .click();
  await expect(
    page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
      .getByText(/Synthetic organization seven/),
  ).toHaveCount(0);
});

test("a platform administrator can assign an asset while the workspace remains Unassigned", async ({
  page,
}) => {
  const { updates } = await syntheticWorkspace(page);
  await page.goto("/assets");
  await expect(
    page.getByRole("link", { name: "Synthetic assigned asset", exact: true }),
  ).toBeVisible();
  await chooseOrganization(page, "Unassigned");
  await page
    .getByRole("link", { name: "Synthetic unassigned asset", exact: true })
    .click();
  await page.getByRole("button", { name: /Edit$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Edit asset", exact: true }),
  ).toBeVisible();
  await page
    .locator("form .ant-select")
    .filter({ has: page.locator("#m_nIDOrganization") })
    .locator(".ant-select-selector")
    .click();
  const dropdown = page.locator(
    ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
  );
  await dropdown.getByText(/Synthetic organization seven/).click();
  await expect(
    page.locator(".organization-picker .ant-select-selection-item"),
  ).toHaveText("Unassigned");
  await page.getByRole("button", { name: /Save asset$/ }).click();
  await expect(page).toHaveURL(/\/assets\/41$/);
  const organization = page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: /^Organization$/ })
    .locator("xpath=following-sibling::*[1]");
  await expect(
    organization.getByRole("link", { name: "#7", exact: true }),
  ).toHaveAttribute("href", "/organizations/7");
  expect(updates).toEqual([
    { path: "/api/resources/assets/41", body: { m_nIDOrganization: "7" } },
  ]);
});
