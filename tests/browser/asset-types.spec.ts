import { expect, test, type Page } from "@playwright/test";
import type { Identity } from "../../shared/resources";

const typeId = "9223372036854775807";
const organizationId = "9223372036854775806";
const assetLabel = "Synthetic typed asset";
const typeTag = "SYNTHETIC-ASSET-TYPE";
const typeLabel = "Synthetic descriptive asset type label";
const organizationTag = "SYNTHETIC-ORGANIZATION";
const organizationLabel = "Synthetic descriptive organization label";

async function syntheticAssetType(page: Page, canReadReferences = true) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic asset type reader",
    organizationId,
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      { entity: "assets", rights: "r" },
      ...(canReadReferences
        ? [
            { entity: "assettypes", rights: "r" },
            { entity: "organizations", rights: "r" },
          ]
        : []),
    ],
  };
  const typeReads: string[] = [];
  const organizationReads: string[] = [];
  let denied = false;
  let currentOrganizationTag = JSON.stringify({
    messages: [
      { lang: "fr", text: "SYNTHETIC-ORGANISATION-FRANCAISE" },
      { lang: "en", text: organizationTag },
    ],
  });
  let tag = JSON.stringify({
    messages: [
      { lang: "fr", text: "SYNTHETIC-TYPE-FRANCAIS" },
      { lang: "en", text: typeTag },
    ],
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-asset-type-csrf",
        expiresAt: Date.now() + 60000,
      });
    if (
      ["/api/resources/assets/41", "/api/resources/assets/42"].includes(path)
    ) {
      const id = path.split("/").at(-1)!;
      return reply({
        data: {
          id,
          m_nIDAsset: id,
          m_nIDOrganization: id === "42" ? "0" : organizationId,
          m_nIDAssetType: id === "42" ? "0" : typeId,
          m_sLabel: assetLabel,
        },
      });
    }
    if (path.startsWith("/api/resources/assettypes/")) {
      typeReads.push(path.split("/").at(-1)!);
      return denied
        ? reply({ message: "Synthetic asset type unavailable." }, 403)
        : reply({
            data: {
              id: typeId,
              m_nIDAssetType: typeId,
              m_sTag: tag,
              m_sLabel: typeLabel,
            },
          });
    }
    if (path.startsWith("/api/resources/organizations/")) {
      organizationReads.push(path.split("/").at(-1)!);
      return denied
        ? reply({ message: "Synthetic organization unavailable." }, 403)
        : reply({
            data: {
              id: organizationId,
              m_nIDOrganization: organizationId,
              m_sTag: currentOrganizationTag,
              m_sLabel: organizationLabel,
            },
          });
    }
    // Every API call, including unrelated asset detail tabs, stays synthetic.
    return reply({ data: [], total: 0 });
  });
  return {
    typeReads,
    organizationReads,
    rename: (value: string) => {
      tag = value;
    },
    renameOrganization: (value: string) => {
      currentOrganizationTag = value;
    },
    deny: () => {
      denied = true;
    },
  };
}

function detailField(page: Page, label: string) {
  return page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::*[1]");
}

test("asset detail resolves exact type and organization tags and refreshes or removes cached metadata", async ({
  page,
}) => {
  const mock = await syntheticAssetType(page);
  await page.goto("/assets/41");
  await expect(
    page.getByRole("heading", { name: assetLabel, exact: true }),
  ).toBeVisible();
  const field = detailField(page, "Asset type");
  const organization = detailField(page, "Organization");
  await expect(
    field.getByRole("link", { name: typeTag, exact: true }),
  ).toHaveAttribute("href", `/assettypes/${typeId}`);
  await expect(page.getByText(typeLabel, { exact: true })).toHaveCount(0);
  await expect(
    organization.getByRole("link", { name: organizationTag, exact: true }),
  ).toHaveAttribute("href", `/organizations/${organizationId}`);
  await expect(page.getByText(organizationLabel, { exact: true })).toHaveCount(
    0,
  );
  const changedTag = "RENAMED-SYNTHETIC-ASSET-TYPE";
  const changedOrganizationTag = "RENAMED-SYNTHETIC-ORGANIZATION";
  mock.rename(changedTag);
  mock.renameOrganization(changedOrganizationTag);
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(
    field.getByRole("link", { name: changedTag, exact: true }),
  ).toHaveAttribute("href", `/assettypes/${typeId}`);
  await expect(page.getByText(typeTag, { exact: true })).toHaveCount(0);
  await expect(
    organization.getByRole("link", {
      name: changedOrganizationTag,
      exact: true,
    }),
  ).toHaveAttribute("href", `/organizations/${organizationId}`);
  await expect(page.getByText(organizationTag, { exact: true })).toHaveCount(0);
  mock.deny();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(
    field.getByRole("link", { name: `#${typeId}`, exact: true }),
  ).toHaveAttribute("href", `/assettypes/${typeId}`);
  await expect(page.getByText(changedTag, { exact: true })).toHaveCount(0);
  await expect(page.getByText(typeLabel, { exact: true })).toHaveCount(0);
  await expect(
    organization.getByRole("link", { name: `#${organizationId}`, exact: true }),
  ).toHaveAttribute("href", `/organizations/${organizationId}`);
  await expect(
    page.getByText(changedOrganizationTag, { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(organizationLabel, { exact: true })).toHaveCount(
    0,
  );
  expect(mock.typeReads).toEqual([typeId, typeId, typeId]);
  expect(mock.organizationReads).toEqual([
    organizationId,
    organizationId,
    organizationId,
  ]);
  await page.goto("/assets/42");
  await expect(detailField(page, "Organization")).toHaveText("0");
  await expect(detailField(page, "Organization").getByRole("link")).toHaveCount(
    0,
  );
  expect(mock.organizationReads).toHaveLength(3);
});

test("asset detail retains type and organization IDs without fetching or linking unauthorized metadata", async ({
  page,
}) => {
  const mock = await syntheticAssetType(page, false);
  await page.goto("/assets/41");
  await expect(
    page.getByRole("heading", { name: assetLabel, exact: true }),
  ).toBeVisible();
  const field = detailField(page, "Asset type");
  await expect(field).toHaveText(`#${typeId}`);
  await expect(field.getByRole("link")).toHaveCount(0);
  await expect(page.getByText(typeTag, { exact: true })).toHaveCount(0);
  await expect(page.getByText(typeLabel, { exact: true })).toHaveCount(0);
  const organization = detailField(page, "Organization");
  await expect(organization).toHaveText(`#${organizationId}`);
  await expect(organization.getByRole("link")).toHaveCount(0);
  await expect(page.getByText(organizationTag, { exact: true })).toHaveCount(0);
  await expect(page.getByText(organizationLabel, { exact: true })).toHaveCount(
    0,
  );
  expect(mock.typeReads).toEqual([]);
  expect(mock.organizationReads).toEqual([]);
});
