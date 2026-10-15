import { expect, test, type Page } from "@playwright/test";
import type { Identity } from "../../shared/resources";

const organizationId = "9223372036854775806";
const typeId = "9223372036854775807";
const organizationTag = "SYNTHETIC-USER-ORGANIZATION";
const organizationLabel = "Synthetic descriptive user organization label";
const typeTag = "SYNTHETIC-USER-TYPE";
const typeLabel = "Synthetic descriptive user type label";
const translatedTag = (tag: string) =>
  JSON.stringify({
    messages: [
      { lang: "fr", text: "SYNTHETIC-REFERENCE-FRANCAISE" },
      { lang: "en", text: tag },
    ],
  });

async function syntheticUserDetails(page: Page, canReadOrganizations = true) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic user reader",
    organizationId,
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      { entity: "users", rights: "r" },
      ...(canReadOrganizations
        ? [{ entity: "organizations", rights: "r" }]
        : []),
    ],
  };
  const reads = { organizations: [] as string[], usertypes: [] as string[] };
  let currentOrganizationTag = translatedTag(organizationTag);
  let currentTypeTag = translatedTag(typeTag);
  let denied = false;
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
        csrf: "synthetic-user-details-csrf",
        expiresAt: Date.now() + 60000,
      });
    if (["/api/resources/users/41", "/api/resources/users/42"].includes(path)) {
      const id = path.split("/").at(-1)!;
      return reply({
        data: {
          id,
          m_nIDuser: id,
          m_nIDOrganization: id === "42" ? "0" : organizationId,
          m_nIDUserType: id === "42" ? "0" : typeId,
          m_sFirst_name: id === "42" ? "Unassigned" : " Synthetic ",
          m_sLast_name: " Person ",
          m_sLogin: "synthetic-login",
          m_sLabel: "Synthetic fallback user label",
        },
      });
    }
    for (const resource of ["organizations", "usertypes"] as const) {
      if (!path.startsWith(`/api/resources/${resource}/`)) continue;
      reads[resource].push(path.split("/").at(-1)!);
      if (denied)
        return reply({ message: "Synthetic reference unavailable." }, 403);
      return reply({
        data:
          resource === "organizations"
            ? {
                id: organizationId,
                m_nIDOrganization: organizationId,
                m_sTag: currentOrganizationTag,
                m_sLabel: organizationLabel,
              }
            : {
                id: typeId,
                m_nIDUserType: typeId,
                m_sTag: currentTypeTag,
                m_sLabel: typeLabel,
                m_nLevel: "20",
              },
      });
    }
    // Every API request, including unrelated user detail tabs, stays synthetic.
    return reply({ data: [], total: 0 });
  });
  return {
    reads,
    rename: () => {
      currentOrganizationTag = "RENAMED-SYNTHETIC-ORGANIZATION";
      currentTypeTag = "RENAMED-SYNTHETIC-USER-TYPE";
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

test("user details retain the full-name title and resolve exact organization and user type tags on refresh", async ({
  page,
}) => {
  const mock = await syntheticUserDetails(page);
  await page.goto("/users/41");
  await expect(
    page.getByRole("heading", { name: "Synthetic Person", exact: true }),
  ).toBeVisible();
  const references = [
    {
      field: "Organization",
      tag: organizationTag,
      label: organizationLabel,
      resource: "organizations",
      id: organizationId,
      changed: "RENAMED-SYNTHETIC-ORGANIZATION",
    },
    {
      field: "User type",
      tag: typeTag,
      label: typeLabel,
      resource: "usertypes",
      id: typeId,
      changed: "RENAMED-SYNTHETIC-USER-TYPE",
    },
  ];
  for (const reference of references) {
    await expect(
      detailField(page, reference.field).getByRole("link", {
        name: reference.tag,
        exact: true,
      }),
    ).toHaveAttribute("href", `/${reference.resource}/${reference.id}`);
    await expect(page.getByText(reference.label, { exact: true })).toHaveCount(
      0,
    );
  }
  mock.rename();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  for (const reference of references) {
    await expect(
      detailField(page, reference.field).getByRole("link", {
        name: reference.changed,
        exact: true,
      }),
    ).toHaveAttribute("href", `/${reference.resource}/${reference.id}`);
    await expect(page.getByText(reference.tag, { exact: true })).toHaveCount(0);
  }
  mock.deny();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  for (const reference of references) {
    await expect(
      detailField(page, reference.field).getByRole("link", {
        name: `#${reference.id}`,
        exact: true,
      }),
    ).toHaveAttribute("href", `/${reference.resource}/${reference.id}`);
    await expect(
      page.getByText(reference.changed, { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(reference.label, { exact: true })).toHaveCount(
      0,
    );
  }
  expect(mock.reads.organizations).toEqual([
    organizationId,
    organizationId,
    organizationId,
  ]);
  expect(mock.reads.usertypes).toEqual([typeId, typeId, typeId]);
});

test("user details respect organization permission while preserving ordinary user type reads and zero references", async ({
  page,
}) => {
  const mock = await syntheticUserDetails(page, false);
  await page.goto("/users/41");
  await expect(
    page.getByRole("heading", { name: "Synthetic Person", exact: true }),
  ).toBeVisible();
  await expect(detailField(page, "Organization")).toHaveText(
    `#${organizationId}`,
  );
  await expect(detailField(page, "Organization").getByRole("link")).toHaveCount(
    0,
  );
  await expect(page.getByText(organizationTag, { exact: true })).toHaveCount(0);
  await expect(page.getByText(organizationLabel, { exact: true })).toHaveCount(
    0,
  );
  await expect(
    detailField(page, "User type").getByRole("link", {
      name: typeTag,
      exact: true,
    }),
  ).toHaveAttribute("href", `/usertypes/${typeId}`);
  expect(mock.reads.organizations).toEqual([]);
  expect(mock.reads.usertypes).toEqual([typeId]);
  await page.goto("/users/42");
  await expect(
    page.getByRole("heading", { name: "Unassigned Person", exact: true }),
  ).toBeVisible();
  for (const label of ["Organization", "User type"]) {
    await expect(detailField(page, label)).toHaveText("0");
    await expect(detailField(page, label).getByRole("link")).toHaveCount(0);
  }
  expect(mock.reads.organizations).toEqual([]);
  expect(mock.reads.usertypes).toEqual([typeId]);
});
