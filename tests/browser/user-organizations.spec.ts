import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  OrganizationMembership,
  RecordData,
} from "../../shared/resources";

const userId = "9223372036854775807";
const homeOrganization = "9223372036854775806";
const inactiveOrganization = "9223372036854775805";
const newOrganization = "9223372036854775804";
const assignmentRole = "9223372036854775803";
const homeTag = "SYNTHETIC-HOME-ORGANIZATION";
const inactiveTag = "SYNTHETIC-INACTIVE-ORGANIZATION";
const newTag = "SYNTHETIC-NEW-ORGANIZATION";
const roleTag = "SYNTHETIC-LEVEL-TWENTY";
const userName = "Synthetic Target";
const tabName = /^Organizations(?: \(\d+\+?\))?$/;
const membershipPath = `/api/users/${userId}/organizations`;
const translatedTag = (tag: string) =>
  JSON.stringify({
    messages: [
      { lang: 5, text: "REFERENCE-FRANCAISE" },
      { lang: 3, text: tag },
    ],
  });

interface Mutation {
  path: string;
  method: string;
  body: unknown;
  csrf?: string;
}

async function mockUserOrganizations(
  page: Page,
  options: {
    level?: number;
    rights?: string;
    writable?: boolean;
    targetAdmin?: boolean;
    targetRole?: string;
    targetOrganization?: string;
    memberships?: OrganizationMembership[];
    detailDenied?: boolean;
    readFailure?: number;
    self?: boolean;
  } = {},
) {
  const level = options.level ?? 90;
  const initial: OrganizationMembership[] = options.memberships ?? [
    { organizationId: homeOrganization, userTypeId: "10", active: true },
    { organizationId: inactiveOrganization, userTypeId: "10", active: false },
  ];
  const memberships = new Map(
    initial.map((row) => [row.organizationId, { ...row }]),
  );
  const organizations: RecordData[] = [
    {
      id: homeOrganization,
      m_nIDOrganization: homeOrganization,
      m_sTag: translatedTag(homeTag),
      m_sLabel: "Unused home organization label",
    },
    {
      id: inactiveOrganization,
      m_nIDOrganization: inactiveOrganization,
      m_sTag: inactiveTag,
    },
    { id: newOrganization, m_nIDOrganization: newOrganization, m_sTag: newTag },
    { id: "0", m_nIDOrganization: "0", m_sTag: "SYNTHETIC-UNASSIGNED" },
  ];
  const roles: RecordData[] = [
    {
      id: "10",
      m_nIDUserType: "10",
      m_nLevel: "10",
      m_sTag: "SYNTHETIC-LOWER-ROLE",
    },
    {
      id: assignmentRole,
      m_nIDUserType: assignmentRole,
      m_nLevel: "20",
      m_sTag: translatedTag(roleTag),
    },
    {
      id: "60",
      m_nIDUserType: "60",
      m_nLevel: "60",
      m_sTag: "SYNTHETIC-PEER-ROLE",
    },
    {
      id: "90",
      m_nIDUserType: "90",
      m_nLevel: "90",
      m_sTag: "SYNTHETIC-PLATFORM-ROLE",
    },
    {
      id: "100",
      m_nIDUserType: "100",
      m_nLevel: "100",
      m_sTag: "SYNTHETIC-HIGHER-ROLE",
    },
    { id: "77", m_nIDUserType: "77", m_sTag: "SYNTHETIC-UNVERIFIED-ROLE" },
  ];
  const user = {
    id: userId,
    m_nIDuser: userId,
    m_nIDOrganization: options.targetOrganization ?? homeOrganization,
    m_nIDUserType: options.targetRole ?? "10",
    m_sLogin: "synthetic-target-login",
    m_sFirst_name: "Synthetic",
    m_sLast_name: "Target",
    m_bAdmin: options.targetAdmin ?? false,
  };
  const identity = {
    id: options.self ? userId : "100",
    name: "Synthetic membership administrator",
    organizationId: homeOrganization,
    userTypeId: String(level),
    level,
    mustChangePassword: false,
    permissions: [
      { entity: "users", rights: options.rights ?? "ru" },
      { entity: "organizations", rights: "r" },
    ],
  };
  const reads: URL[] = [],
    mutations: Mutation[] = [];
  let ended = false;
  let readFailure = options.readFailure;
  let nextFailure: { status: number; message: string } | undefined;
  let hold: { entered: () => void; released: Promise<void> } | undefined;
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (request.method() !== "GET") {
      const body: unknown = request.postData() ? request.postDataJSON() : null;
      mutations.push({
        path,
        method: request.method(),
        body,
        csrf: request.headers()["x-csrf-token"],
      });
      if (
        path.startsWith(`${membershipPath}/`) &&
        ["PUT", "DELETE"].includes(request.method())
      ) {
        if (hold) {
          const held = hold;
          hold = undefined;
          held.entered();
          await held.released;
        }
        if (nextFailure) {
          const failure = nextFailure;
          nextFailure = undefined;
          return reply({ message: failure.message }, failure.status);
        }
        const organizationId = path.split("/").at(-1)!;
        if (request.method() === "PUT")
          memberships.set(organizationId, {
            organizationId,
            userTypeId: (body as { userTypeId: string }).userTypeId,
            active: true,
          });
        else if (memberships.has(organizationId))
          memberships.get(organizationId)!.active = false;
        if (options.self && organizationId === homeOrganization) ended = true;
        return reply({
          success: true,
          ...(ended ? { sessionEnded: true } : {}),
        });
      }
      return reply({ message: "Unexpected synthetic mutation." }, 405);
    }
    reads.push(url);
    if (path === "/api/session")
      return ended
        ? reply({ message: "Membership changed; sign in again." }, 401)
        : reply({
            identity,
            csrf: "synthetic-user-organizations-csrf",
            expiresAt: Date.now() + 3_600_000,
            services: {
              users: { configured: true, writable: options.writable ?? true },
            },
            ...(options.self
              ? {
                  activeOrganizationId: homeOrganization,
                  organizationMemberships: [...memberships.values()],
                }
              : {}),
          });
    if (path === "/api/session/organizations")
      return reply({ data: [...memberships.values()] });
    if (path === `/api/resources/users/${userId}`)
      return options.detailDenied
        ? reply({ message: "Synthetic user detail denied." }, 403)
        : reply({ data: user });
    if (path === membershipPath)
      return readFailure
        ? reply(
            { message: "Synthetic membership list unavailable." },
            readFailure,
          )
        : reply({ data: [...memberships.values()] });
    if (path === "/api/resources/organizations")
      return reply({ data: organizations, total: organizations.length });
    if (path === "/api/resources/usertypes")
      return reply({ data: roles, total: roles.length });
    const organization = organizations.find(
      (row) => path === `/api/resources/organizations/${row.id}`,
    );
    if (organization) return reply({ data: organization });
    const role = roles.find(
      (row) => path === `/api/resources/usertypes/${row.id}`,
    );
    if (role) return reply({ data: role });
    // Every API call, including other user tabs, stays synthetic.
    return reply({ data: [], total: 0 });
  });
  return {
    reads,
    mutations,
    membershipReads: () =>
      reads.filter((url) => url.pathname === membershipPath),
    failNext: (status: number, message: string) => {
      nextFailure = { status, message };
    },
    allowReads: () => {
      readFailure = undefined;
    },
    holdNext: () => {
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      hold = { entered: enter, released };
      return { entered, release };
    },
  };
}

async function openOrganizations(page: Page) {
  await page.goto(`/users/${userId}`);
  await expect(
    page.getByRole("heading", { name: userName, exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: tabName }).click();
  return page.getByRole("tabpanel", { name: tabName });
}

function membershipRow(panel: Locator, organizationId: string) {
  return panel.locator(`tr[data-row-key="${organizationId}"]`);
}

async function openAdd(page: Page, panel: Locator) {
  await panel.getByRole("button", { name: /Add organization$/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Add organization");
  return dialog;
}

async function optionsFor(
  page: Page,
  dialog: Locator,
  name: "Organization" | "User type",
) {
  const select = dialog.locator(".ant-select").filter({
    has: page.getByRole("combobox", { name: new RegExp(`${name}$`) }),
  });
  await select.locator(".ant-select-selector").click({ timeout: 5000 });
  const dropdown = page.locator(
    ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
  );
  await expect(dropdown).toHaveCount(1);
  return dropdown;
}

async function selectOption(
  page: Page,
  dialog: Locator,
  name: "Organization" | "User type",
  text: string,
) {
  const dropdown = await optionsFor(page, dialog, name);
  await dropdown
    .locator(".ant-select-item-option")
    .filter({ hasText: text })
    .click();
}

test("platform membership creation uses exact organization and role IDs and displays translated tags and status", async ({
  page,
}, testInfo) => {
  const mock = await mockUserOrganizations(page);
  const panel = await openOrganizations(page);
  const initial = membershipRow(panel, homeOrganization);
  await expect(initial).toContainText(`${homeTag} (#${homeOrganization})`);
  await expect(initial).toContainText("SYNTHETIC-LOWER-ROLE (#10)");
  await expect(initial.getByText("Enabled", { exact: true })).toBeVisible();
  await expect(
    membershipRow(panel, inactiveOrganization).getByText("Disabled", {
      exact: true,
    }),
  ).toBeVisible();
  expect((await page.getByRole("tab").allTextContents()).slice(0, 2)).toEqual([
    "Details",
    "Organizations (2)",
  ]);
  let dialog = await openAdd(page, panel);
  const organizations = await optionsFor(page, dialog, "Organization");
  await expect(organizations).not.toContainText(homeTag);
  await expect(organizations).not.toContainText("SYNTHETIC-UNASSIGNED");
  await expect(organizations).toContainText(inactiveTag);
  await dialog.locator(".ant-modal-title").click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(mock.mutations).toEqual([]);
  dialog = await openAdd(page, panel);
  await selectOption(page, dialog, "Organization", newTag);
  const roles = await optionsFor(page, dialog, "User type");
  await expect(roles).not.toContainText("SYNTHETIC-PLATFORM-ROLE");
  await expect(roles).not.toContainText("SYNTHETIC-HIGHER-ROLE");
  await expect(roles).not.toContainText("SYNTHETIC-UNVERIFIED-ROLE");
  await roles
    .locator(".ant-select-item-option")
    .filter({ hasText: roleTag })
    .click();
  await page.screenshot({
    path: testInfo.outputPath("add-user-organization.png"),
    fullPage: true,
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: /Add$/ }).click();
  const added = membershipRow(panel, newOrganization);
  await expect(added).toContainText(`${newTag} (#${newOrganization})`);
  await expect(added).toContainText(`${roleTag} (#${assignmentRole})`);
  await expect(added.getByText("Enabled", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Organizations (3)", exact: true }),
  ).toBeVisible();
  expect(mock.mutations).toEqual([
    {
      method: "PUT",
      path: `${membershipPath}/${newOrganization}`,
      body: { userTypeId: assignmentRole },
      csrf: "synthetic-user-organizations-csrf",
    },
  ]);
  expect(mock.membershipReads().length).toBeGreaterThan(1);
  await page.screenshot({
    path: testInfo.outputPath("user-organizations-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(added).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await panel
      .locator(".ant-table-content")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("user-organizations-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("ordinary administrators reactivate only their identity organization using a lower known role despite a different target home organization", async ({
  page,
}) => {
  const mock = await mockUserOrganizations(page, {
    level: 60,
    targetOrganization: inactiveOrganization,
    memberships: [
      { organizationId: homeOrganization, userTypeId: "10", active: false },
      {
        organizationId: inactiveOrganization,
        userTypeId: assignmentRole,
        active: true,
      },
    ],
  });
  const panel = await openOrganizations(page);
  await expect(
    membershipRow(panel, inactiveOrganization).getByRole("button", {
      name: /Remove$/,
    }),
  ).toHaveCount(0);
  const dialog = await openAdd(page, panel);
  const organizations = await optionsFor(page, dialog, "Organization");
  await expect(organizations.locator(".ant-select-item-option")).toHaveCount(1);
  await expect(organizations).toContainText(homeTag);
  await organizations.locator(".ant-select-item-option").click();
  const roles = await optionsFor(page, dialog, "User type");
  for (const hidden of [
    "SYNTHETIC-PEER-ROLE",
    "SYNTHETIC-PLATFORM-ROLE",
    "SYNTHETIC-HIGHER-ROLE",
    "SYNTHETIC-UNVERIFIED-ROLE",
  ])
    await expect(roles).not.toContainText(hidden);
  await roles
    .locator(".ant-select-item-option")
    .filter({ hasText: roleTag })
    .click();
  await dialog.getByRole("button", { name: /Add$/ }).click();
  const reactivated = membershipRow(panel, homeOrganization);
  await expect(reactivated.getByText("Enabled", { exact: true })).toBeVisible();
  await expect(reactivated).toContainText(`${roleTag} (#${assignmentRole})`);
  await expect(
    reactivated.getByRole("button", { name: /Remove$/ }),
  ).toBeEnabled();
  await expect(panel.locator("tbody tr[data-row-key]")).toHaveCount(2);
  expect(mock.mutations[0]).toMatchObject({
    method: "PUT",
    path: `${membershipPath}/${homeOrganization}`,
    body: { userTypeId: assignmentRole },
  });
  expect(
    mock.reads.some(
      (url) =>
        url.pathname === "/api/resources/organizations" &&
        url.searchParams.get("_organization") === homeOrganization,
    ),
  ).toBe(true);
});

test("removal requires confirmation, retains the enabled membership while pending or denied, and retries with a body-free DELETE", async ({
  page,
}, testInfo) => {
  const mock = await mockUserOrganizations(page);
  const panel = await openOrganizations(page),
    row = membershipRow(panel, homeOrganization);
  await row.getByRole("button", { name: /Remove$/ }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Remove organization membership?");
  await expect(dialog).toContainText(`${homeTag} (#${homeOrganization})`);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(mock.mutations).toEqual([]);
  mock.failNext(403, "Synthetic removal permission denied.");
  const held = mock.holdNext();
  await row.getByRole("button", { name: /Remove$/ }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Remove organization membership?");
  await dialog.screenshot({
    path: testInfo.outputPath("remove-user-organization-confirmation.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await held.entered;
  await expect(row.getByText("Enabled", { exact: true })).toBeVisible();
  held.release();
  await expect(
    panel.getByText("Synthetic removal permission denied.", { exact: true }),
  ).toBeVisible();
  await expect(row.getByText("Enabled", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: /Remove$/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(row.getByText("Disabled", { exact: true })).toBeVisible();
  expect(mock.mutations).toEqual(
    [1, 2].map(() => ({
      method: "DELETE",
      path: `${membershipPath}/${homeOrganization}`,
      body: null,
      csrf: "synthetic-user-organizations-csrf",
    })),
  );
});

test("failed additions keep the modal selection for an explicit retry without changing the table", async ({
  page,
}) => {
  const mock = await mockUserOrganizations(page);
  const panel = await openOrganizations(page),
    dialog = await openAdd(page, panel);
  await selectOption(page, dialog, "Organization", newTag);
  await selectOption(page, dialog, "User type", roleTag);
  mock.failNext(403, "Synthetic addition permission denied.");
  await dialog.getByRole("button", { name: /Add$/ }).click();
  await expect(
    dialog.getByText("Synthetic addition permission denied.", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.locator(".ant-select-selection-item").filter({ hasText: newTag }),
  ).toBeVisible();
  await expect(
    dialog.locator(".ant-select-selection-item").filter({ hasText: roleTag }),
  ).toBeVisible();
  await expect(membershipRow(panel, newOrganization)).toHaveCount(0);
  await dialog.getByRole("button", { name: /Add$/ }).click();
  await expect(
    membershipRow(panel, newOrganization).getByText("Enabled", { exact: true }),
  ).toBeVisible();
  expect(mock.mutations).toHaveLength(2);
});

for (const scenario of [
  { name: "read-only permission", level: 60, rights: "r" },
  { name: "disabled Users writes", writable: false },
])
  test(`${scenario.name} shows memberships without mutation controls`, async ({
    page,
  }) => {
    const mock = await mockUserOrganizations(page, scenario);
    const panel = await openOrganizations(page);
    await expect(membershipRow(panel, homeOrganization)).toBeVisible();
    await expect(
      panel.getByRole("button", { name: /Add organization$|Remove$/ }),
    ).toHaveCount(0);
    expect(mock.mutations).toEqual([]);
  });

for (const scenario of [
  { name: "administrator target", targetAdmin: true },
  { name: "equal-role target", targetRole: "60" },
])
  test(`ordinary operators cannot manage an ${scenario.name}`, async ({
    page,
  }) => {
    const mock = await mockUserOrganizations(page, { level: 60, ...scenario });
    const panel = await openOrganizations(page);
    await expect(membershipRow(panel, homeOrganization)).toBeVisible();
    await expect(
      panel.getByRole("button", { name: /Add organization$|Remove$/ }),
    ).toHaveCount(0);
    expect(mock.mutations).toEqual([]);
  });

test("a denied user detail never loads its organization memberships", async ({
  page,
}) => {
  const mock = await mockUserOrganizations(page, {
    level: 60,
    detailDenied: true,
  });
  await page.goto(`/users/${userId}`);
  await expect(
    page.getByText("Synthetic user detail denied.", { exact: true }),
  ).toBeVisible();
  expect(mock.membershipReads()).toHaveLength(0);
  expect(mock.mutations).toEqual([]);
});

test("membership-list errors hide management and can be retried", async ({
  page,
}) => {
  const mock = await mockUserOrganizations(page, { readFailure: 403 });
  const panel = await openOrganizations(page);
  await expect(
    panel.getByText("Synthetic membership list unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /Add organization$|Remove$/ }),
  ).toHaveCount(0);
  mock.allowReads();
  await panel.getByRole("button", { name: /Retry$/ }).click();
  await expect(
    membershipRow(panel, homeOrganization).getByText("Enabled", {
      exact: true,
    }),
  ).toBeVisible();
  expect(mock.membershipReads()).toHaveLength(2);
  expect(mock.mutations).toEqual([]);
});

test("removing the current user's active organization warns and ends the protected session", async ({
  page,
}) => {
  const mock = await mockUserOrganizations(page, { self: true });
  const panel = await openOrganizations(page);
  await membershipRow(panel, homeOrganization)
    .getByRole("button", { name: /Remove$/ })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Removing your active membership signs you out.",
  );
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: tabName })).toHaveCount(0);
  expect(mock.mutations).toEqual([
    {
      method: "DELETE",
      path: `${membershipPath}/${homeOrganization}`,
      body: null,
      csrf: "synthetic-user-organizations-csrf",
    },
  ]);
});
