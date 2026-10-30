import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import type { SessionInfo } from "../../src/api";
import {
  resources,
  type OrganizationMembership,
  type RecordData,
} from "../../shared/resources";

const firstOrganization = "9223372036854775806";
const secondOrganization = "9223372036854775807";
const inactiveOrganization = "1407374883553285";
const firstTag = "SYNTHETIC-FIRST-ORGANIZATION";
const secondTag = "SYNTHETIC-SECOND-ORGANIZATION";
const firstRole = "SYNTHETIC-EDITOR-ROLE";
const secondRole = "SYNTHETIC-READER-ROLE";
const platformRole = "SYNTHETIC-PLATFORM-ROLE";
const privateLabel = "Synthetic first organization's private asset";
const secondLabel = "Synthetic second organization's asset";
const memberships: OrganizationMembership[] = [
  { organizationId: firstOrganization, userTypeId: "30", active: true },
  { organizationId: secondOrganization, userTypeId: "40", active: true },
  { organizationId: inactiveOrganization, userTypeId: "50", active: false },
];

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface ApiCall {
  url: URL;
  method: string;
  csrf?: string;
  body?: unknown;
}

async function syntheticOrganizations(
  surface: Page | BrowserContext,
  options: { labelsDenied?: boolean; global?: boolean } = {},
) {
  const assets: RecordData[] = [
    {
      id: "41",
      m_nIDAsset: "41",
      m_nIDOrganization: firstOrganization,
      m_sLabel: privateLabel,
    },
    {
      id: "42",
      m_nIDAsset: "42",
      m_nIDOrganization: secondOrganization,
      m_sLabel: secondLabel,
    },
  ];
  let rotation = 0;
  const sessionFor = (organizationId: string | null): SessionInfo => {
    const second = organizationId === secondOrganization;
    return {
      csrf: `synthetic-organization-csrf-${rotation}`,
      expiresAt: Date.now() + 3_600_000,
      activeOrganizationId: organizationId,
      organizationMemberships: structuredClone(memberships),
      identity: {
        id: "100",
        name: "Synthetic membership operator",
        organizationId: organizationId ?? "0",
        userTypeId: options.global ? "90" : second ? "40" : "30",
        level: options.global ? 90 : second ? 40 : 30,
        mustChangePassword: false,
        permissions: options.global
          ? resources.map((resource) => ({
              entity: resource.name,
              rights: "crud",
            }))
          : [
              { entity: "assets", rights: second ? "r" : "ru" },
              ...(!options.labelsDenied
                ? [
                    { entity: "organizations", rights: "r" },
                    { entity: "usertypes", rights: "r" },
                  ]
                : []),
            ],
      },
      services: { assets: { configured: true, writable: true } },
    };
  };
  let current: SessionInfo | null = sessionFor(
    options.global ? null : firstOrganization,
  );
  let failure: number | undefined;
  let switchHold: { entered: () => void; released: Promise<void> } | undefined;
  let readHold:
    | {
        path: string;
        status: 200 | 401;
        entered: () => void;
        released: Promise<void>;
      }
    | undefined;
  const calls: ApiCall[] = [];
  const reply = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

  await surface.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const call: ApiCall = {
      url,
      method: request.method(),
      csrf: request.headers()["x-csrf-token"],
      ...(request.postData() ? { body: request.postDataJSON() } : {}),
    };
    calls.push(call);
    if (path === "/api/session")
      return current
        ? reply(route, current)
        : reply(route, { message: "The synthetic session expired." }, 401);
    if (path === "/api/session/organizations")
      return reply(route, { data: memberships });
    if (path === "/api/session/organization" && request.method() === "POST") {
      if (switchHold) {
        const hold = switchHold;
        switchHold = undefined;
        hold.entered();
        await hold.released;
      }
      if (failure) {
        const status = failure;
        failure = undefined;
        if (status >= 500 || status === 401) current = null;
        return reply(
          route,
          { message: "Synthetic organization switch rejected." },
          status,
        );
      }
      if (!current || call.csrf !== current.csrf)
        return reply(route, { message: "Synthetic context expired." }, 401);
      const body = call.body as { organizationId?: string };
      if (
        !memberships.some(
          (entry) =>
            entry.active && entry.organizationId === body.organizationId,
        )
      )
        return reply(
          route,
          { message: "Synthetic membership unavailable." },
          403,
        );
      rotation += 1;
      current = sessionFor(body.organizationId!);
      return reply(route, current);
    }
    if (path === "/api/session/logout") {
      current = null;
      return reply(route, { success: true });
    }
    if (request.method() !== "GET")
      return reply(
        route,
        { message: "Unexpected synthetic business mutation." },
        405,
      );
    if (!current) return reply(route, { message: "Sign in to continue." }, 401);
    if (call.csrf !== current.csrf)
      return reply(
        route,
        {
          code: "organization_context_changed",
          message: "Synthetic context changed.",
        },
        409,
      );

    const requestSession = current;
    const data = assets.filter(
      (asset) =>
        requestSession.activeOrganizationId === null ||
        asset.m_nIDOrganization === requestSession.activeOrganizationId,
    );
    if (readHold?.path === path) {
      const hold = readHold;
      readHold = undefined;
      hold.entered();
      await hold.released;
      // Fetch may have been aborted by the session fence. Never forward a request.
      return reply(
        route,
        hold.status === 200
          ? { data, total: data.length }
          : { message: "Synthetic old context expired." },
        hold.status,
      ).catch(() => undefined);
    }
    if (path === "/api/resources/assets") {
      const scope = url.searchParams.get("_organization");
      if (
        requestSession.activeOrganizationId &&
        scope !== requestSession.activeOrganizationId
      )
        return reply(
          route,
          { message: "Synthetic workspace scope mismatch." },
          403,
        );
      return reply(route, { data, total: data.length });
    }
    if (path.startsWith("/api/resources/assets/")) {
      const asset = data.find((record) => record.id === path.split("/").at(-1));
      return asset
        ? reply(route, { data: asset })
        : reply(
            route,
            { message: "This asset is outside the active organization." },
            403,
          );
    }
    if (path === "/api/resources/organizations")
      return options.labelsDenied
        ? reply(
            route,
            { message: "Synthetic organization metadata denied." },
            403,
          )
        : reply(route, {
            data: [
              {
                id: firstOrganization,
                m_nIDOrganization: firstOrganization,
                m_sTag: firstTag,
              },
              {
                id: secondOrganization,
                m_nIDOrganization: secondOrganization,
                m_sTag: secondTag,
              },
              {
                id: inactiveOrganization,
                m_nIDOrganization: inactiveOrganization,
                m_sTag: "SYNTHETIC-INACTIVE-ORGANIZATION",
              },
              {
                id: "77",
                m_nIDOrganization: "77",
                m_sTag: "SYNTHETIC-NONMEMBER-ORGANIZATION",
              },
            ],
            total: 4,
          });
    if (path === "/api/resources/usertypes")
      return options.labelsDenied
        ? reply(route, { message: "Synthetic role metadata denied." }, 403)
        : reply(route, {
            data: [
              { id: "30", m_nIDUserType: "30", m_sTag: firstRole },
              { id: "40", m_nIDUserType: "40", m_sTag: secondRole },
              { id: "90", m_nIDUserType: "90", m_sTag: platformRole },
            ],
            total: 3,
          });
    return reply(route, { data: [], total: 0 });
  });
  return {
    calls,
    switches: () =>
      calls.filter((call) => call.url.pathname === "/api/session/organization"),
    businessWrites: () =>
      calls.filter(
        (call) =>
          call.method !== "GET" &&
          !call.url.pathname.startsWith("/api/session/"),
      ),
    failNext: (status: number) => {
      failure = status;
    },
    holdSwitch: () => {
      const entered = deferred();
      const released = deferred();
      switchHold = { entered: entered.release, released: released.promise };
      return { entered: entered.promise, release: released.release };
    },
    holdRead: (path: string, status: 200 | 401) => {
      const entered = deferred();
      const released = deferred();
      readHold = {
        path,
        status,
        entered: entered.release,
        released: released.promise,
      };
      return { entered: entered.promise, release: released.release };
    },
  };
}

const activeSelector = (page: Page) =>
  page.getByRole("combobox", { name: "Active organization", exact: true });
const picker = (page: Page) =>
  page.locator(".ant-select").filter({ has: activeSelector(page) });

async function openOptions(page: Page) {
  await picker(page).locator(".ant-select-selector").click();
  return page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
}

async function chooseOrganization(page: Page, label: string) {
  const dropdown = await openOptions(page);
  await dropdown
    .locator(".ant-select-item-option")
    .filter({ hasText: label })
    .click();
}

async function assertSecondContext(page: Page) {
  await expect(picker(page)).toContainText(secondTag);
  await expect(
    page.getByRole("heading", { name: "Your workspace", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
}

async function expectMobileHeaderContainsControls(page: Page) {
  await expect
    .poll(async () => {
      const header = await page.locator(".topbar").boundingBox();
      const controls = await page.locator(".workspace-controls").boundingBox();
      return (
        !!header &&
        !!controls &&
        controls.y >= header.y &&
        controls.y + controls.height <= header.y + header.height
      );
    })
    .toBe(true);
  expect(
    await page
      .locator(".topbar")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
}

test("ordinary members see only active memberships and adopt the selected role and rotated context", async ({
  page,
}, testInfo) => {
  const mock = await syntheticOrganizations(page);
  await page.goto("/assets");
  await expect(page.locator('tr[data-row-key="41"]')).toBeVisible();
  await expect(activeSelector(page)).toBeEnabled();
  const dropdown = await openOptions(page);
  await expect(dropdown.locator(".ant-select-item-option")).toHaveCount(2);
  for (const text of [firstTag, secondTag, firstRole, secondRole])
    await expect(dropdown).toContainText(text);
  await expect(dropdown).not.toContainText("SYNTHETIC-INACTIVE-ORGANIZATION");
  await expect(dropdown).not.toContainText("SYNTHETIC-NONMEMBER-ORGANIZATION");
  await expect(dropdown).not.toContainText("All accessible organizations");
  await page.screenshot({
    path: testInfo.outputPath("active-organization-memberships.png"),
    fullPage: true,
    animations: "disabled",
  });
  const held = mock.holdSwitch();
  await dropdown
    .locator(".ant-select-item-option")
    .filter({ hasText: secondTag })
    .click();
  await held.entered;
  await expect(activeSelector(page)).toBeDisabled();
  await expect.poll(() => page.locator("[inert]").count()).toBeGreaterThan(0);
  expect(mock.switches()).toHaveLength(1);
  expect(mock.switches()[0].body).toEqual({
    organizationId: secondOrganization,
  });
  expect(mock.switches()[0].csrf).toBe("synthetic-organization-csrf-0");
  held.release();
  await assertSecondContext(page);
  await expect(page.locator(".organization-role")).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Assets", exact: true }).click();
  await expect(page.locator('tr[data-row-key="42"]')).toBeVisible();
  await expect(page.getByText(privateLabel, { exact: true })).toHaveCount(0);
  const newReads = mock.calls.filter(
    (call) =>
      call.url.pathname === "/api/resources/assets" &&
      call.csrf === "synthetic-organization-csrf-1",
  );
  expect(newReads.length).toBeGreaterThan(0);
  expect(
    newReads.every(
      (call) =>
        call.url.searchParams.get("_organization") === secondOrganization,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: secondLabel, exact: true }).click();
  await expect(page.getByRole("button", { name: /Edit$/ })).toHaveCount(0);
  await page.reload();
  await expect(picker(page)).toContainText(secondTag);
  expect(mock.switches()).toHaveLength(1);
  expect(mock.businessWrites()).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(activeSelector(page)).toBeVisible();
  await expectMobileHeaderContainsControls(page);
  await page.locator(".topbar").screenshot({
    path: testInfo.outputPath("active-organization-mobile.png"),
    animations: "disabled",
  });
});

test("membership switching works without readable organization or role labels", async ({
  page,
}) => {
  const mock = await syntheticOrganizations(page, { labelsDenied: true });
  await page.goto("/assets");
  await expect(activeSelector(page)).toBeEnabled();
  const dropdown = await openOptions(page);
  await expect(dropdown).toContainText(secondOrganization);
  await expect(dropdown).toContainText("40");
  await dropdown
    .locator(".ant-select-item-option")
    .filter({ hasText: secondOrganization })
    .click();
  await expect(picker(page)).toContainText(secondOrganization);
  await expect(
    page.getByRole("heading", { name: "Your workspace", exact: true }),
  ).toBeVisible();
  expect(mock.switches()[0].body).toEqual({
    organizationId: secondOrganization,
  });
  expect(
    mock.calls.filter(
      (call) => call.url.pathname === "/api/resources/organizations",
    ),
  ).toHaveLength(0);
  expect(mock.businessWrites()).toEqual([]);
});

test("a definite rejection retains the old workspace and allows a user-triggered retry", async ({
  page,
}) => {
  const mock = await syntheticOrganizations(page);
  await page.goto("/assets");
  await expect(page.locator('tr[data-row-key="41"]')).toBeVisible();
  mock.failNext(403);
  await chooseOrganization(page, secondTag);
  await expect(
    page.getByText("Synthetic organization switch rejected.", { exact: true }),
  ).toBeVisible();
  await expect(picker(page)).toContainText(firstTag);
  await expect(page.locator('tr[data-row-key="41"]')).toBeVisible();
  expect(mock.switches()).toHaveLength(1);
  await chooseOrganization(page, secondTag);
  await assertSecondContext(page);
  expect(mock.switches()).toHaveLength(2);
  expect(mock.businessWrites()).toEqual([]);
});

test("keeping a dirty editor cancels the switch before any POST and discarding never submits its values", async ({
  page,
}) => {
  const mock = await syntheticOrganizations(page);
  await page.goto("/assets/41/edit");
  const label = page.getByLabel("Label", { exact: true });
  await expect(label).toHaveValue(privateLabel);
  await label.fill("Synthetic unsaved old-organization value");
  await chooseOrganization(page, secondTag);
  await expect(page.getByRole("dialog")).toContainText(
    "Discard unsaved changes?",
  );
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(label).toHaveValue("Synthetic unsaved old-organization value");
  await expect(picker(page)).toContainText(firstTag);
  await expect(page).toHaveURL(/\/assets\/41\/edit$/);
  expect(mock.switches()).toHaveLength(0);
  await chooseOrganization(page, secondTag);
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await assertSecondContext(page);
  expect(mock.switches()).toHaveLength(1);
  expect(mock.businessWrites()).toEqual([]);
  await expect(page.getByLabel("Label", { exact: true })).toHaveCount(0);
});

for (const status of [200, 401] as const)
  test(`late old-organization ${status} cannot restore private rows or expire the new context`, async ({
    page,
  }) => {
    const mock = await syntheticOrganizations(page);
    await page.goto("/assets");
    await expect(page.locator('tr[data-row-key="41"]')).toBeVisible();
    await page.evaluate(
      ({ selectedTag, selectedId, privateLabel }) => {
        const state = { leaked: false };
        new MutationObserver(() => {
          const picker = document.querySelector(".ant-select-selection-item");
          if (
            (picker?.textContent?.includes(selectedTag) ||
              picker?.textContent?.includes(selectedId)) &&
            document.body.innerText.includes(privateLabel)
          )
            state.leaked = true;
        }).observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
        });
        Object.assign(window, { organizationIsolation: state });
      },
      { selectedTag: secondTag, selectedId: secondOrganization, privateLabel },
    );
    const held = mock.holdRead("/api/resources/assets", status);
    await page.getByRole("button", { name: /Refresh$/ }).click();
    await held.entered;
    await chooseOrganization(page, secondTag);
    await assertSecondContext(page);
    held.release();
    await page.getByRole("menuitem", { name: "Assets", exact: true }).click();
    await expect(page.locator('tr[data-row-key="42"]')).toBeVisible();
    await expect(page.getByText(privateLabel, { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { organizationIsolation: { leaked: boolean } })
            .organizationIsolation.leaked,
      ),
    ).toBe(false);
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    expect(mock.switches()).toHaveLength(1);
    expect(mock.businessWrites()).toEqual([]);
  });

test("an unrecoverable ambiguous switch clears private data without replaying the POST", async ({
  page,
}) => {
  const mock = await syntheticOrganizations(page);
  await page.goto("/assets/41");
  await expect(
    page.getByRole("heading", { name: privateLabel, exact: true }),
  ).toBeVisible();
  mock.failNext(503);
  await chooseOrganization(page, secondTag);
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(privateLabel, { exact: true })).toHaveCount(0);
  await expect(page.locator(".ant-descriptions")).toHaveCount(0);
  expect(mock.switches()).toHaveLength(1);
  expect(mock.businessWrites()).toEqual([]);
});

test("another tab's rotation reloads the authoritative context and removes cached old detail", async ({
  page,
  context,
}) => {
  const mock = await syntheticOrganizations(context);
  await page.goto("/assets/41");
  await expect(
    page.getByRole("heading", { name: privateLabel, exact: true }),
  ).toBeVisible();
  const other = await context.newPage();
  await other.goto("/assets");
  await expect(other.locator('tr[data-row-key="41"]')).toBeVisible();
  const sessionReads = mock.calls.filter(
    (call) => call.url.pathname === "/api/session",
  ).length;
  await chooseOrganization(other, secondTag);
  await assertSecondContext(other);
  await expect(picker(page)).toContainText(secondTag);
  await expect(page.getByText(privateLabel, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(
      () =>
        mock.calls.filter((call) => call.url.pathname === "/api/session")
          .length,
    )
    .toBeGreaterThan(sessionReads);
  const storage = await other.evaluate(() => ({
    revision: localStorage.getItem("tronicare-admin-organization-revision"),
    content: JSON.stringify(Object.fromEntries(Object.entries(localStorage))),
  }));
  expect(storage.revision).toMatch(/^[0-9a-f-]{36}$/);
  for (const secret of [
    firstOrganization,
    secondOrganization,
    firstTag,
    secondTag,
    "synthetic-organization-csrf-",
  ])
    expect(storage.content).not.toContain(secret);
  expect(mock.switches()).toHaveLength(1);
  expect(mock.businessWrites()).toEqual([]);
  await other.close();
});

test("a modern global platform context is represented without offering a switch-to-all command", async ({
  page,
}, testInfo) => {
  const mock = await syntheticOrganizations(page, { global: true });
  await page.goto("/assets");
  const dropdown = await openOptions(page);
  const globalOption = dropdown
    .locator(".ant-select-item-option")
    .filter({ hasText: /All|Global/i });
  await expect(globalOption).toHaveCount(1);
  await expect(globalOption).toHaveClass(/ant-select-item-option-disabled/);
  await dropdown
    .locator(".ant-select-item-option")
    .filter({ hasText: secondTag })
    .click();
  await expect(picker(page)).toContainText(secondTag);
  await expect(page).toHaveURL(/\/services$/);
  await expect(
    page.getByRole("heading", { name: "Service status", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".organization-role")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Organization", exact: true }),
  ).toBeEnabled();
  const switched = await openOptions(page);
  await expect(
    switched
      .locator(".ant-select-item-option")
      .filter({ hasText: /All accessible|Global/i }),
  ).toHaveCount(0);
  expect(mock.switches().map((call) => call.body)).toEqual([
    { organizationId: secondOrganization },
  ]);
  expect(mock.businessWrites()).toEqual([]);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(activeSelector(page)).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Organization", exact: true }),
  ).toBeVisible();
  await expectMobileHeaderContainsControls(page);
  await page.locator(".topbar").screenshot({
    path: testInfo.outputPath(
      "platform-active-organization-and-workspace-mobile.png",
    ),
    animations: "disabled",
  });
});
