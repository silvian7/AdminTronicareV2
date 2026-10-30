import { expect, test, type Page } from "@playwright/test";
import type { Identity } from "../../shared/resources";

test.use({ locale: "en-GB", timezoneId: "Europe/Brussels" });

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

async function syntheticUserDetails(
  page: Page,
  canReadOrganizations = true,
  timestamps: Record<string, unknown> = {},
) {
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
          ...timestamps,
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

async function expectLocalTime(
  page: Page,
  label: string,
  iso: string,
  zone: string,
) {
  const expected = await page.evaluate(
    (value) =>
      new Date(value).toLocaleString("en-GB", {
        hourCycle: "h23",
        timeZone: "Europe/Brussels",
      }),
    iso,
  );
  const field = detailField(page, label);
  await expect(field).toHaveText(expected);
  await expect(field.locator("time")).toHaveAttribute("datetime", iso);
  await expect(field.locator("time")).toHaveAttribute("title", zone);
}

test("user details retain the full-name title and resolve exact organization and user type tags on refresh", async ({
  page,
}, testInfo) => {
  const mock = await syntheticUserDetails(page, true, {
    m_sTag: "SYNTHETIC-USER-TAG",
    m_sEmail: "synthetic-user@example.invalid",
    m_bAdmin: false,
    m_bConnected: true,
    m_bDeleted: false,
    m_dhLastLogin: "2026-01-15T12:34:56.123",
    m_dhLastLogout: "2026-07-15T12:34:56",
    m_dhCreated: "2026-01-01T12:00:00",
    m_dhModified: "2026-07-15T12:00:00",
    m_sHash: "synthetic-hidden-hash",
    m_sToken: "synthetic-hidden-token",
  });
  await page.goto("/users/41");
  await expect(
    page.getByRole("heading", { name: "Synthetic Person", exact: true }),
  ).toBeVisible();
  const panels = page.locator(".form-section");
  await expect(panels.locator(".ant-card-head-title")).toHaveText([
    "General",
    "Relationships",
    "Configuration",
  ]);
  const fieldGroups = [
    ["ID", "Login", "First name", "Last name", "Tag", "Label", "Email"],
    ["Organization", "User type"],
    [
      "Admin",
      "Connected",
      "Last Login",
      "Last Logout",
      "Deleted",
      "Created",
      "Modified",
      "Old Login",
    ],
  ];
  for (const [index, fields] of fieldGroups.entries()) {
    await expect(
      panels.nth(index).locator(".ant-descriptions-bordered"),
    ).toHaveCount(1);
    await expect(
      panels.nth(index).locator(".ant-descriptions-item-label"),
    ).toHaveText(fields);
  }
  const labels = await page
    .locator(".ant-descriptions-item-label")
    .allTextContents();
  expect(labels).toEqual(fieldGroups.flat());
  expect(new Set(labels).size).toBe(labels.length);
  await expect(detailField(page, "ID")).toHaveText("41");
  await expect(detailField(page, "Login")).toHaveText("synthetic-login");
  await expect(detailField(page, "Tag")).toHaveText("SYNTHETIC-USER-TAG");
  await expect(detailField(page, "Email")).toHaveText(
    "synthetic-user@example.invalid",
  );
  await expect(detailField(page, "Admin")).toHaveText("No");
  await expect(detailField(page, "Connected")).toHaveText("Yes");
  for (const secret of ["synthetic-hidden-hash", "synthetic-hidden-token"])
    await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
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
  await page.screenshot({
    path: testInfo.outputPath("user-detail-panels-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panels.locator(".ant-card-head-title")).toHaveText([
    "General",
    "Relationships",
    "Configuration",
  ]);
  await page.screenshot({
    path: testInfo.outputPath("user-detail-panels-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
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

test("all user detail timestamps display local time using each event's winter or summer offset", async ({
  page,
}) => {
  await syntheticUserDetails(page, false, {
    m_dhLastLogin: "2026-01-15T12:34:56.123",
    m_dhLastLogout: "2026-07-15 12:34:56",
    m_dhCreated: "20260115233000",
    m_dhModified: "2026-07-15T00:30:00+02:00",
  });
  await page.goto("/users/41");
  for (const [label, iso, clock] of [
    ["Last Login", "2026-01-15T12:34:56.123Z", "13:34:56"],
    ["Last Logout", "2026-07-15T12:34:56.000Z", "14:34:56"],
    ["Created", "2026-01-15T23:30:00.000Z", "00:30:00"],
    ["Modified", "2026-07-14T22:30:00.000Z", "00:30:00"],
  ]) {
    await expectLocalTime(page, label, iso, "Europe/Brussels");
    await expect(detailField(page, label)).toContainText(clock);
  }
});

test.describe("user timestamps retain Brussels time in a different browser timezone", () => {
  test.use({ timezoneId: "America/New_York" });

  test("Brussels dates stay fixed while invalid, zero and empty timestamps remain unavailable", async ({
    page,
  }) => {
    const timestamps: Record<string, unknown> = {
      m_dhLastLogin: "2026-01-15T01:30:00",
      m_dhLastLogout: "0000-00-00T00:00:00.000",
      m_dhCreated: "not-a-timestamp",
      m_dhModified: "",
    };
    await syntheticUserDetails(page, false, timestamps);
    await page.goto("/users/41");
    await expectLocalTime(
      page,
      "Last Login",
      "2026-01-15T01:30:00.000Z",
      "Europe/Brussels",
    );
    await expect(detailField(page, "Last Login")).toHaveText(
      "15/01/2026, 02:30:00",
    );
    for (const label of ["Last Logout", "Created", "Modified"]) {
      await expect(detailField(page, label)).toHaveText("\u2014");
      await expect(detailField(page, label).locator("time")).toHaveCount(0);
    }
    timestamps.m_dhLastLogin = undefined;
    timestamps.m_dhLastLogout = "00000000000000";
    timestamps.m_dhCreated = "2026-02-30T12:00:00Z";
    timestamps.m_dhModified = null;
    await page.getByRole("button", { name: /Refresh$/ }).click();
    for (const label of ["Last Login", "Last Logout", "Created", "Modified"]) {
      await expect(detailField(page, label)).toHaveText("\u2014");
      await expect(detailField(page, label).locator("time")).toHaveCount(0);
    }
    timestamps.m_dhModified = "1970-01-01T00:00:00Z";
    await page.getByRole("button", { name: /Refresh$/ }).click();
    await expectLocalTime(
      page,
      "Modified",
      "1970-01-01T00:00:00.000Z",
      "Europe/Brussels",
    );
  });
});
