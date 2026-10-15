import { expect, test, type Page } from "@playwright/test";
import type { Identity } from "../../shared/resources";

const assetLabel = "Synthetic recoverable asset";
const filterError = "Check the idorganization filter.";

async function syntheticAssetFilters(page: Page) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic asset filter reader",
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [{ entity: "assets", rights: "r" }],
  };
  const requests: URL[] = [];
  let denied = false;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-filter-csrf",
        expiresAt: Date.now() + 60000,
      });
    if (url.pathname === "/api/resources/assets") {
      requests.push(url);
      if (denied)
        return reply(
          { message: "Synthetic asset access has been revoked." },
          403,
        );
      const organization = url.searchParams.get("idorganization");
      if (organization && !/^\d+$/.test(organization))
        return reply({ message: filterError }, 400);
      return reply({
        data: [
          {
            id: "41",
            m_nIDAsset: "41",
            m_nIDOrganization: "7",
            m_sLabel: assetLabel,
          },
        ],
        total: 1,
      });
    }
    // Intercept every API call; all records and validation errors are synthetic.
    return reply({ data: [], total: 0 });
  });
  return {
    requests,
    denyAccess: () => {
      denied = true;
    },
  };
}

async function openAssetFilters(page: Page) {
  await page.goto("/assets");
  await expect(
    page.getByRole("link", { name: assetLabel, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Filters$/ }).click();
  return page.getByLabel("Organization ID", { exact: true });
}

test("an invalid asset filter keeps controls available and can be corrected with Enter", async ({
  page,
}) => {
  const { requests } = await syntheticAssetFilters(page);
  const organization = await openAssetFilters(page);
  await organization.fill("abcd");
  await organization.press("Enter");
  await expect(page.getByRole("alert")).toContainText(filterError);
  await expect(
    page.getByRole("heading", { name: "Assets", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Filters$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clear filters", exact: true }),
  ).toBeVisible();
  await expect(organization).toBeVisible();
  await expect(organization).toHaveValue("abcd");
  await expect(
    page.getByRole("link", { name: assetLabel, exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByText(/loaded matches/)).toHaveCount(0);
  await organization.fill("7");
  await organization.press("Enter");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: assetLabel, exact: true }),
  ).toBeVisible();
  expect(
    requests.some((url) => url.searchParams.get("idorganization") === "7"),
  ).toBe(true);
});

test("clearing a rejected blur filter resets its input and URL while retaining the workspace scope", async ({
  page,
}) => {
  const { requests } = await syntheticAssetFilters(page);
  const organization = await openAssetFilters(page);
  await organization.fill("abcd");
  await page.getByRole("heading", { name: "Assets", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(filterError);
  const rejectedRequests = requests.filter(
    (url) => url.searchParams.get("idorganization") === "abcd",
  ).length;
  const afterClear = requests.length;
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(organization).toHaveValue("");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: assetLabel, exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/idorganization/);
  await organization.click();
  const refreshed = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/resources/assets" &&
      !url.searchParams.has("idorganization")
    );
  });
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await refreshed;
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(organization).toHaveValue("");
  expect(
    requests.filter((url) => url.searchParams.get("idorganization") === "abcd"),
  ).toHaveLength(rejectedRequests);
  expect(requests.slice(afterClear).length).toBeGreaterThan(0);
  for (const url of requests.slice(afterClear)) {
    expect(url.searchParams.get("_organization")).toBe("7");
    expect(url.searchParams.has("idorganization")).toBe(false);
  }
});

test("a forbidden refresh hides cached asset rows and counts while leaving filters editable", async ({
  page,
}) => {
  const { denyAccess } = await syntheticAssetFilters(page);
  const organization = await openAssetFilters(page);
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/resources/assets" &&
      url.searchParams.get("idorganization") === "7"
    );
  });
  await organization.fill("7");
  await organization.press("Enter");
  await filtered;
  await expect(
    page.getByRole("link", { name: assetLabel, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("1 loaded matches", { exact: true }),
  ).toBeVisible();
  denyAccess();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic asset access has been revoked.",
  );
  await expect(
    page.getByRole("link", { name: assetLabel, exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByText(/loaded matches/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Filters$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clear filters", exact: true }),
  ).toBeEnabled();
  await expect(organization).toBeEditable();
  await expect(organization).toHaveValue("7");
});
