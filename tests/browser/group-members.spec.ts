import { expect, test, type Page } from "@playwright/test";
import type { Identity, RecordData } from "../../shared/resources";

const groupId = "9223372036854775807";
const organizationId = "9223372036854775806";
const candidateId = "9223372036854775805";
const memberId = "9223372036854775804";
const groupLabel = "Synthetic member management group";
const candidateLabel = "Synthetic eligible member";
const candidateOption = `${candidateLabel} · ${candidateId}`;
const otherOrganization = "7";
const otherOrganizationTag = "SYNTHETIC-OTHER-ORGANIZATION";

async function mockMembers(
  page: Page,
  options: {
    userRights?: string;
    writable?: boolean;
    level?: number;
  } = {},
) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic group administrator",
    organizationId,
    userTypeId: "30",
    level: options.level ?? 90,
    mustChangePassword: false,
    permissions: [
      { entity: "usergroups", rights: "ru" },
      { entity: "organizations", rights: "r" },
      { entity: "users", rights: options.userRights ?? "ru" },
    ],
  };
  const group: RecordData = {
    id: groupId,
    m_nIDusergroup: groupId,
    m_nIDOrganization: organizationId,
    m_sLabel: groupLabel,
  };
  const users: RecordData[] = [
    {
      id: memberId,
      m_nIDuser: memberId,
      m_nIDOrganization: organizationId,
      m_sLogin: "synthetic-current-member",
      m_sFirst_name: "Existing",
      m_sLast_name: "Member",
      m_bDeleted: false,
    },
    {
      id: candidateId,
      m_nIDuser: candidateId,
      m_nIDOrganization: organizationId,
      m_sLogin: candidateLabel,
      m_sFirst_name: "Eligible",
      m_sLast_name: "Member",
      m_bDeleted: false,
    },
    {
      id: "9223372036854775803",
      m_nIDuser: "9223372036854775803",
      m_nIDOrganization: organizationId,
      m_sLogin: "Synthetic deleted member",
      m_bDeleted: true,
    },
    {
      id: "42",
      m_nIDuser: "42",
      m_nIDOrganization: otherOrganization,
      m_sLogin: "Synthetic other organization member",
      m_bDeleted: false,
    },
  ];
  const organizations = [
    {
      id: organizationId,
      m_nIDOrganization: organizationId,
      m_sTag: "SYNTHETIC-GROUP-ORGANIZATION",
    },
    {
      id: otherOrganization,
      m_nIDOrganization: otherOrganization,
      m_sTag: otherOrganizationTag,
    },
  ];
  const memberIds = new Set([memberId]);
  const reads: URL[] = [];
  const mutations: {
    method: string;
    path: string;
    body: unknown;
    csrf?: string;
  }[] = [];
  let nextFailure: { status: number; message: string } | undefined;
  let heldMembership:
    { entered: () => void; released: Promise<void> } | undefined;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (request.method() !== "GET") {
      const body = request.postDataJSON();
      mutations.push({
        method: request.method(),
        path,
        body,
        csrf: request.headers()["x-csrf-token"],
      });
      if (path === "/api/memberships" && request.method() === "POST") {
        if (heldMembership) {
          const held = heldMembership;
          heldMembership = undefined;
          held.entered();
          await held.released;
        }
        if (nextFailure) {
          const failure = nextFailure;
          nextFailure = undefined;
          return reply({ message: failure.message }, failure.status);
        }
        if (body.action === "add") memberIds.add(body.userId);
        return reply({ success: true });
      }
      return reply({ message: "Synthetic operation unavailable." }, 405);
    }
    reads.push(url);
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-group-members-csrf",
        expiresAt: Date.now() + 60000,
        services: {
          users: { configured: true, writable: options.writable ?? true },
        },
      });
    if (path === `/api/resources/usergroups/${groupId}`)
      return reply({ data: group });
    if (path === "/api/resources/usergroups")
      return reply({ data: [group], total: 1 });
    if (path === "/api/resources/organizations")
      return reply({ data: organizations, total: organizations.length });
    const organization = organizations.find(
      (row) => path === `/api/resources/organizations/${row.id}`,
    );
    if (organization) return reply({ data: organization });
    if (path === "/api/resources/users") {
      // Candidate responses deliberately contain extra rows: the UI must also
      // exclude existing members, deleted users and users outside the group org.
      const data = url.searchParams.has("idusergroup")
        ? users.filter((row) => memberIds.has(row.id!))
        : users;
      return reply({ data, total: data.length });
    }
    // Intercept every API call, including unrelated overview/detail panels.
    return reply({ data: [], total: 0 });
  });
  return {
    reads,
    mutations,
    changeOrganization: (id: string) => {
      group.m_nIDOrganization = id;
    },
    failNext: (status: number, message: string) => {
      nextFailure = { status, message };
    },
    holdNext: () => {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      heldMembership = { entered: enter, released };
      return { entered, release };
    },
  };
}

async function openMembers(page: Page, workspace?: string) {
  await page.goto(`/usergroups/${groupId}`);
  await expect(
    page.getByRole("heading", { name: groupLabel, exact: true }),
  ).toBeVisible();
  if (workspace) {
    await page.locator(".organization-picker .ant-select-selector").click();
    await page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
      .getByText(workspace, { exact: true })
      .click();
    await expect(
      page.locator(".organization-picker .ant-select-selection-item"),
    ).toHaveText(workspace);
    await page.getByRole("menuitem", { name: /User groups$/ }).click();
    await page.getByRole("link", { name: groupLabel, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: groupLabel, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("tab", { name: "Members", exact: true }).click();
  await expect(
    page.getByRole("link", { name: memberId, exact: true }),
  ).toHaveAttribute("href", `/users/${memberId}`);
}

function memberSelect(page: Page) {
  return page.locator(".ant-select").filter({
    has: page.getByLabel("User to add", { exact: true }),
  });
}

async function chooseMember(page: Page, label = candidateOption) {
  await page.getByLabel("User to add", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText(label, { exact: true })
    .click();
}

for (const workspace of [undefined, otherOrganizationTag])
  test(`members can be added from their group organization with ${workspace ? "another organization" : "all organizations"} selected`, async ({
    page,
  }, testInfo) => {
    const mock = await mockMembers(page);
    await openMembers(page, workspace);
    const add = page.getByRole("button", { name: /Add member$/ });
    await expect(add).toBeDisabled();
    for (const name of ["ID", "Login", "First name", "Last name"])
      await expect(
        page.getByRole("columnheader", { name, exact: true }),
      ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "User", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("User to add", { exact: true }).click();
    const dropdown = page.locator(
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
    );
    await expect(
      dropdown.getByText(candidateOption, { exact: true }),
    ).toBeVisible();
    for (const unavailable of [
      `synthetic-current-member · ${memberId}`,
      "Synthetic deleted member · 9223372036854775803",
      "Synthetic other organization member · 42",
      "Unassigned",
    ])
      await expect(
        dropdown.getByText(unavailable, { exact: true }),
      ).toHaveCount(0);
    await dropdown.getByText(candidateOption, { exact: true }).click();
    await expect(add).toBeEnabled();
    if (!workspace) {
      await page.getByLabel("User to add", { exact: true }).press("Escape");
      await expect(dropdown).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath("group-members-add.png"),
        fullPage: true,
      });
    }
    const previousMemberReads = mock.reads.filter((url) =>
      url.searchParams.has("idusergroup"),
    ).length;
    await add.click();
    const added = page.getByRole("link", { name: candidateId, exact: true });
    await expect(added).toHaveAttribute("href", `/users/${candidateId}`);
    await expect(added.locator("xpath=ancestor::tr")).toContainText(
      candidateLabel,
    );
    await expect(
      memberSelect(page).locator(".ant-select-selection-item"),
    ).toHaveCount(0);
    await expect(memberSelect(page)).toContainText("Choose user");
    await expect(add).toBeDisabled();
    await expect(page.getByLabel("User to add", { exact: true })).toBeEnabled();
    await page.getByLabel("User to add", { exact: true }).click();
    await expect(
      page
        .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
        .getByText(candidateOption, { exact: true }),
    ).toHaveCount(0);
    const userReads = mock.reads.filter(
      (url) => url.pathname === "/api/resources/users",
    );
    const memberReads = userReads.filter((url) =>
      url.searchParams.has("idusergroup"),
    );
    expect(memberReads.length).toBeGreaterThan(previousMemberReads);
    for (const read of memberReads)
      expect(read.searchParams.get("idusergroup")).toBe(groupId);
    const candidateReads = userReads.filter(
      (url) =>
        !url.searchParams.has("idusergroup") &&
        url.searchParams.get("_pageSize") === "10000",
    );
    expect(candidateReads.length).toBeGreaterThan(0);
    for (const read of candidateReads)
      expect(read.searchParams.get("_organization")).toBe(organizationId);
    expect(mock.mutations).toEqual([
      {
        method: "POST",
        path: "/api/memberships",
        body: { userId: candidateId, groupId, action: "add" },
        csrf: "synthetic-group-members-csrf",
      },
    ]);
  });

test("membership authorization errors retain the members and selected user so adding can be retried", async ({
  page,
}) => {
  const mock = await mockMembers(page);
  await openMembers(page);
  await chooseMember(page);
  mock.failNext(403, "Synthetic membership permission denied.");
  const add = page.getByRole("button", { name: "Add member", exact: true });
  await add.click();
  await expect(
    page.getByText("Synthetic membership permission denied.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: memberId, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: candidateId, exact: true }),
  ).toHaveCount(0);
  await expect(
    memberSelect(page).locator(".ant-select-selection-item"),
  ).toHaveText(candidateOption);
  await expect(add).toBeEnabled();
  await add.click();
  await expect(
    page.getByRole("link", { name: candidateId, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic membership permission denied.", { exact: true }),
  ).toHaveCount(0);
  expect(mock.mutations.map(({ body }) => body)).toEqual([
    { userId: candidateId, groupId, action: "add" },
    { userId: candidateId, groupId, action: "add" },
  ]);
});

for (const restriction of [
  "read-only user permission",
  "service writes disabled",
])
  test(`members remain visible without add controls with ${restriction}`, async ({
    page,
  }) => {
    const mock = await mockMembers(page, {
      level: 30,
      userRights: restriction === "read-only user permission" ? "r" : "ru",
      writable: restriction !== "service writes disabled",
    });
    await openMembers(page);
    await expect(page.getByLabel("User to add", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Add member", exact: true }),
    ).toHaveCount(0);
    expect(mock.mutations).toEqual([]);
    expect(
      mock.reads.filter(
        (url) =>
          url.pathname === "/api/resources/users" &&
          !url.searchParams.has("idusergroup"),
      ),
    ).toHaveLength(0);
  });

test("refreshing a group's organization clears a previously selected user and reloads the new organization's candidates", async ({
  page,
}) => {
  const mock = await mockMembers(page);
  await openMembers(page);
  await chooseMember(page);
  mock.changeOrganization(otherOrganization);
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(
    memberSelect(page).locator(".ant-select-selection-item"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add member", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("User to add", { exact: true }).click();
  const dropdown = page.locator(
    ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
  );
  await expect(
    dropdown.getByText("Synthetic other organization member · 42", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dropdown.getByText(candidateOption, { exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      mock.reads.some(
        (url) =>
          url.pathname === "/api/resources/users" &&
          !url.searchParams.has("idusergroup") &&
          url.searchParams.get("_organization") === otherOrganization,
      ),
    )
    .toBe(true);
  expect(mock.mutations).toEqual([]);
});

test("a membership completed after leaving the group refreshes members when returning", async ({
  page,
}) => {
  const mock = await mockMembers(page);
  await openMembers(page);
  await chooseMember(page);
  const held = mock.holdNext();
  await page.getByRole("button", { name: "Add member", exact: true }).click();
  await held.entered;
  await page.getByRole("menuitem", { name: /User groups$/ }).click();
  await expect(
    page.getByRole("heading", { name: "User groups", exact: true }),
  ).toBeVisible();
  const completed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/memberships",
  );
  held.release();
  await completed;
  await page.getByRole("link", { name: groupLabel, exact: true }).click();
  await page.getByRole("tab", { name: "Members", exact: true }).click();
  await expect(
    page.getByRole("link", { name: candidateId, exact: true }),
  ).toHaveAttribute("href", `/users/${candidateId}`);
  await page.getByLabel("User to add", { exact: true }).click();
  await expect(
    page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
      .getByText(candidateOption, { exact: true }),
  ).toHaveCount(0);
  expect(mock.mutations).toHaveLength(1);
});
