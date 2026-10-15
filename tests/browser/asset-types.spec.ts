import { expect, test, type Page } from "@playwright/test";
import type { Identity } from "../../shared/resources";

const typeId = "9223372036854775807";
const assetLabel = "Synthetic typed asset";
const typeTag = "SYNTHETIC-ASSET-TYPE";
const typeLabel = "Synthetic descriptive asset type label";

async function syntheticAssetType(page: Page, canReadTypes = true) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic asset type reader",
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      { entity: "assets", rights: "r" },
      ...(canReadTypes ? [{ entity: "assettypes", rights: "r" }] : []),
    ],
  };
  const typeReads: string[] = [];
  let denied = false;
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
    if (path === "/api/resources/assets/41")
      return reply({
        data: {
          id: "41",
          m_nIDAsset: "41",
          m_nIDOrganization: "7",
          m_nIDAssetType: typeId,
          m_sLabel: assetLabel,
        },
      });
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
    // Every API call, including unrelated asset detail tabs, stays synthetic.
    return reply({ data: [], total: 0 });
  });
  return {
    typeReads,
    rename: (value: string) => {
      tag = value;
    },
    deny: () => {
      denied = true;
    },
  };
}

function assetTypeField(page: Page) {
  return page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: /^Asset type$/ })
    .locator("xpath=following-sibling::*[1]");
}

test("asset detail resolves the exact asset type tag and refreshes or removes cached metadata", async ({
  page,
}) => {
  const mock = await syntheticAssetType(page);
  await page.goto("/assets/41");
  await expect(
    page.getByRole("heading", { name: assetLabel, exact: true }),
  ).toBeVisible();
  const field = assetTypeField(page);
  await expect(
    field.getByRole("link", { name: typeTag, exact: true }),
  ).toHaveAttribute("href", `/assettypes/${typeId}`);
  await expect(page.getByText(typeLabel, { exact: true })).toHaveCount(0);
  const changedTag = "RENAMED-SYNTHETIC-ASSET-TYPE";
  mock.rename(changedTag);
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(
    field.getByRole("link", { name: changedTag, exact: true }),
  ).toHaveAttribute("href", `/assettypes/${typeId}`);
  await expect(page.getByText(typeTag, { exact: true })).toHaveCount(0);
  mock.deny();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(
    field.getByRole("link", { name: `#${typeId}`, exact: true }),
  ).toHaveAttribute("href", `/assettypes/${typeId}`);
  await expect(page.getByText(changedTag, { exact: true })).toHaveCount(0);
  await expect(page.getByText(typeLabel, { exact: true })).toHaveCount(0);
  expect(mock.typeReads).toEqual([typeId, typeId, typeId]);
});

test("asset detail retains the asset type ID without fetching or linking unauthorized metadata", async ({
  page,
}) => {
  const mock = await syntheticAssetType(page, false);
  await page.goto("/assets/41");
  await expect(
    page.getByRole("heading", { name: assetLabel, exact: true }),
  ).toBeVisible();
  const field = assetTypeField(page);
  await expect(field).toHaveText(`#${typeId}`);
  await expect(field.getByRole("link")).toHaveCount(0);
  await expect(page.getByText(typeTag, { exact: true })).toHaveCount(0);
  await expect(page.getByText(typeLabel, { exact: true })).toHaveCount(0);
  expect(mock.typeReads).toEqual([]);
});
