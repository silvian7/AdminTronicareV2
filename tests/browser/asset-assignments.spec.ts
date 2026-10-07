import { expect, test, type Page } from "@playwright/test";
import {
  type Identity,
  type AssetAssignmentKind,
} from "../../shared/resources";

const assetLabel = "Synthetic assigned asset";
const candidates = {
  users: [
    {
      id: "100",
      m_nIDUser: "100",
      m_nIDOrganization: "7",
      m_sLogin: "Synthetic current user",
    },
    {
      id: "101",
      m_nIDUser: "101",
      m_nIDOrganization: "7",
      m_sLogin: "Synthetic assignment user",
    },
  ],
  usergroups: [
    {
      id: "20",
      m_nIDUserGroup: "20",
      m_nIDOrganization: "7",
      m_sLabel: "Synthetic assignment group",
    },
  ],
};

async function mockAssignments(
  page: Page,
  options: {
    rights?: string;
    writable?: boolean;
    canReadUsers?: boolean;
    level?: number;
    initialUser?: string;
    duplicateUser?: boolean;
    revokeSelf?: boolean;
  } = {},
) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic assignment administrator",
    organizationId: "7",
    userTypeId: "30",
    level: options.level ?? 30,
    mustChangePassword: false,
    permissions: [
      { entity: "assets", rights: options.rights ?? "ru" },
      { entity: "hubs", rights: "r" },
      ...(options.canReadUsers === false
        ? []
        : [{ entity: "users", rights: "r" }]),
    ],
  };
  const assigned: Record<AssetAssignmentKind, Set<string>> = {
    users: new Set(options.initialUser ? [options.initialUser] : []),
    usergroups: new Set(),
  };
  const mutations: {
    method: string;
    path: string;
    body: string | null;
    csrf?: string;
  }[] = [];
  const reads: URL[] = [];
  let duplicate = options.duplicateUser ?? false;
  let revoked = false;
  let nextError:
    | {
        method: string;
        kind: AssetAssignmentKind;
        status: number;
        message: string;
        remove?: boolean;
      }
    | undefined;
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
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-assignment-csrf",
        expiresAt: Date.now() + 60000,
        services: {
          assets: { configured: true, writable: options.writable ?? true },
        },
      });
    if (path === "/api/resources/assets/42") {
      reads.push(url);
      return revoked
        ? reply({ message: "This asset is outside your scope." }, 403)
        : reply({
            data: {
              id: "42",
              m_nIDAsset: "42",
              m_nIDOrganization: "7",
              m_sLabel: assetLabel,
            },
          });
    }
    if (path === "/api/resources/assets") return reply({ data: [], total: 0 });
    for (const kind of ["users", "usergroups"] as const) {
      if (path === `/api/resources/${kind}`) {
        reads.push(url);
        if (revoked && url.searchParams.has("idasset"))
          return reply({ message: "This asset is outside your scope." }, 403);
        const rows = url.searchParams.has("idasset")
          ? candidates[kind].filter((row) => assigned[kind].has(row.id))
          : candidates[kind];
        return reply({ data: rows, total: rows.length });
      }
      const match = path.match(
        new RegExp(`^/api/assets/42/assignments/${kind}/(\\d+)$`),
      );
      if (match) {
        mutations.push({
          method: request.method(),
          path,
          body: request.postData(),
          csrf: request.headers()["x-csrf-token"],
        });
        const relatedId = match[1];
        if (nextError?.kind === kind && nextError.method === request.method()) {
          const failure = nextError;
          nextError = undefined;
          if (failure.remove) assigned[kind].delete(relatedId);
          return reply({ message: failure.message }, failure.status);
        }
        if (request.method() === "POST") assigned[kind].add(relatedId);
        else if (duplicate && kind === "users") duplicate = false;
        else assigned[kind].delete(relatedId);
        if (
          options.revokeSelf &&
          request.method() === "DELETE" &&
          kind === "users" &&
          relatedId === identity.id
        )
          revoked = true;
        return reply({ success: true });
      }
    }
    return reply({ data: [], total: 0 });
  });
  return {
    mutations,
    reads,
    failNext: (failure: NonNullable<typeof nextError>) => {
      nextError = failure;
    },
    restoreAssetVisibility: () => {
      revoked = false;
    },
  };
}

async function openAssignments(page: Page) {
  await page.goto("/assets/42");
  await expect(
    page.getByRole("heading", { name: assetLabel, exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Assignments", exact: true }).click();
}

async function choose(page: Page, noun: "User" | "Group", label: string) {
  await page.getByLabel(`${noun} to assign`, { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText(label, { exact: true })
    .click();
}

async function remove(page: Page, label: string) {
  await page
    .getByRole("link", { name: label, exact: true })
    .locator("xpath=ancestor::tr")
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "may lose access to this asset and its equipment",
  );
  await dialog
    .getByRole("button", { name: "Remove assignment", exact: true })
    .click();
}

test("asset users and groups can be assigned and removed with organization-scoped candidates", async ({
  page,
}) => {
  const mock = await mockAssignments(page, { level: 90 });
  await openAssignments(page);
  await expect(
    page.getByText("User and group assignments are view-only."),
  ).toHaveCount(0);
  for (const assignment of [
    {
      kind: "users",
      tab: "Users",
      noun: "User",
      id: "101",
      label: "Synthetic assignment user",
    },
    {
      kind: "usergroups",
      tab: "User groups",
      noun: "Group",
      id: "20",
      label: "Synthetic assignment group",
    },
  ] as const) {
    await page.getByRole("tab", { name: assignment.tab, exact: true }).click();
    const row = page.getByRole("link", { name: assignment.label, exact: true });
    await expect(row).toHaveCount(0);
    await choose(
      page,
      assignment.noun,
      `${assignment.label} · ${assignment.id}`,
    );
    await page
      .getByRole("button", {
        name: `Assign ${assignment.noun.toLowerCase()}`,
        exact: true,
      })
      .click();
    await expect(row).toBeVisible();
    await choose(
      page,
      assignment.noun,
      `${assignment.label} · ${assignment.id}`,
    );
    await expect(
      page.getByRole("button", {
        name: `Assign ${assignment.noun.toLowerCase()}`,
        exact: true,
      }),
    ).toBeDisabled();
    await remove(page, assignment.label);
    await expect(row).toHaveCount(0);
    const candidateRead = mock.reads.find(
      (url) =>
        url.pathname === `/api/resources/${assignment.kind}` &&
        !url.searchParams.has("idasset"),
    );
    expect(candidateRead?.searchParams.get("_organization")).toBe("7");
  }
  expect(mock.mutations.map(({ method, path }) => ({ method, path }))).toEqual([
    { method: "POST", path: "/api/assets/42/assignments/users/101" },
    { method: "DELETE", path: "/api/assets/42/assignments/users/101" },
    { method: "POST", path: "/api/assets/42/assignments/usergroups/20" },
    { method: "DELETE", path: "/api/assets/42/assignments/usergroups/20" },
  ]);
  for (const mutation of mock.mutations) {
    expect(mutation.body).toBeNull();
    expect(mutation.csrf).toBe("synthetic-assignment-csrf");
  }
});

test("assignment errors remain visible and retry works; conflicts refresh actual links", async ({
  page,
}) => {
  const mock = await mockAssignments(page);
  await openAssignments(page);
  mock.failNext({
    kind: "users",
    method: "POST",
    status: 502,
    message: "Synthetic assignment service unavailable.",
  });
  await choose(page, "User", "Synthetic assignment user · 101");
  const assign = page.getByRole("button", { name: /Assign user$/ });
  await assign.click();
  await expect(
    page.getByText("Synthetic assignment service unavailable.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(assign).toBeEnabled();
  await assign.click();
  const row = page.getByRole("link", {
    name: "Synthetic assignment user",
    exact: true,
  });
  await expect(row).toBeVisible();
  await expect(
    page.getByText("Synthetic assignment service unavailable.", {
      exact: true,
    }),
  ).toHaveCount(0);
  mock.failNext({
    kind: "users",
    method: "DELETE",
    status: 409,
    message: "This assignment was removed elsewhere.",
    remove: true,
  });
  await remove(page, "Synthetic assignment user");
  await expect(
    page.getByText("This assignment was removed elsewhere.", { exact: true }),
  ).toBeVisible();
  await expect(row).toHaveCount(0);
});

for (const restriction of [
  "read-only permission",
  "service writes disabled",
] as const)
  test(`assignment controls respect ${restriction}`, async ({ page }) => {
    const mock = await mockAssignments(page, {
      rights: restriction === "read-only permission" ? "r" : "ru",
      writable: restriction !== "service writes disabled",
      initialUser: "101",
    });
    await openAssignments(page);
    await expect(
      page.getByRole("link", {
        name: "Synthetic assignment user",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Assign user", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Remove", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "User groups", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Assign group", exact: true }),
    ).toHaveCount(0);
    expect(mock.mutations).toEqual([]);
  });

test("user read permission is required for assignment records and candidate selectors", async ({
  page,
}) => {
  const mock = await mockAssignments(page, { canReadUsers: false });
  await openAssignments(page);
  await expect(
    page.getByText("You do not have access to these records.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("User to assign", { exact: true })).toHaveCount(
    0,
  );
  expect(
    mock.reads.filter((url) => url.pathname === "/api/resources/users"),
  ).toHaveLength(0);
  expect(mock.mutations).toEqual([]);
});

test("removing one imported duplicate preserves the assignment until the service reports no link", async ({
  page,
}) => {
  await mockAssignments(page, { initialUser: "101", duplicateUser: true });
  await openAssignments(page);
  await remove(page, "Synthetic assignment user");
  const row = page.getByRole("link", {
    name: "Synthetic assignment user",
    exact: true,
  });
  await expect(row).toBeVisible();
  await expect(
    row
      .locator("xpath=ancestor::tr")
      .getByRole("button", { name: "Remove", exact: true }),
  ).toBeEnabled();
  await remove(page, "Synthetic assignment user");
  await expect(row).toHaveCount(0);
});

test("removing the current user's last assignment removes the now-denied asset detail", async ({
  page,
}) => {
  const mock = await mockAssignments(page, {
    initialUser: "100",
    revokeSelf: true,
  });
  await openAssignments(page);
  await remove(page, "Synthetic current user");
  await expect(
    page.getByText("This asset is outside your scope.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(assetLabel, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Assignments", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".ant-descriptions")).toHaveCount(0);
  expect(
    mock.reads.filter((url) => url.pathname === "/api/resources/assets/42")
      .length,
  ).toBeGreaterThan(1);
});

test("a pending equipment read cannot cache its old payload after assignment revocation", async ({
  page,
}) => {
  const mock = await mockAssignments(page, {
    initialUser: "100",
    revokeSelf: true,
  });
  const privateHubLabel = "Synthetic old private hub payload";
  let releaseFirstRead!: () => void;
  const firstReadHeld = new Promise<void>((resolve) => {
    releaseFirstRead = resolve;
  });
  let hubReads = 0;
  await page.route("**/api/resources/hubs?**", async (route) => {
    hubReads += 1;
    if (hubReads === 1) {
      await firstReadHeld;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [{ id: "55", m_nIDHub: "55", m_sLabel: privateHubLabel }],
          total: 1,
        }),
      });
    }
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        message: "This equipment is outside your scope.",
      }),
    });
  });
  await openAssignments(page);
  const initialRead = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/resources/hubs",
  );
  await page.getByRole("tab", { name: "Hubs", exact: true }).click();
  await initialRead;
  await page.getByRole("tab", { name: "Users", exact: true }).click();
  await remove(page, "Synthetic current user");
  await expect(
    page.getByText("This asset is outside your scope.", { exact: true }),
  ).toBeVisible();
  // Refetch must run while the original response is still held by the server.
  await expect.poll(() => hubReads).toBeGreaterThan(1);
  const oldResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/resources/hubs" &&
      response.status() === 200,
  );
  releaseFirstRead();
  await oldResponse;
  mock.restoreAssetVisibility();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: assetLabel, exact: true }),
  ).toBeVisible();
  await page.evaluate((label) => {
    const observation = { leaked: false };
    const observer = new MutationObserver(() => {
      if (document.body.innerText.includes(label)) observation.leaked = true;
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    Object.assign(window, { assignmentCacheObservation: observation });
  }, privateHubLabel);
  await page.getByRole("tab", { name: "Assignments", exact: true }).click();
  await page.getByRole("tab", { name: "Hubs", exact: true }).click();
  await expect(
    page.getByText("This equipment is outside your scope.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(privateHubLabel, { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            assignmentCacheObservation: { leaked: boolean };
          }
        ).assignmentCacheObservation.leaked,
    ),
  ).toBe(false);
});
