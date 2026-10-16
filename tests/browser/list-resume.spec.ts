import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Identity, RecordData } from "../../shared/resources";

const initialLabel = "Synthetic asset before browser return";
const refreshedLabel = "Synthetic asset after browser return";
const organizationTag = "SYNTHETIC-RESUME-ORGANIZATION";
const refreshedOrganizationTag = "SYNTHETIC-ORGANIZATION-AFTER-RETURN";

async function mockResumableAssets(page: Page, platformAdmin = false) {
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });
  const identity: Identity = {
    id: "100",
    name: "Synthetic browser return administrator",
    organizationId: "7",
    userTypeId: "30",
    level: platformAdmin ? 90 : 30,
    mustChangePassword: false,
    permissions: [
      { entity: "assets", rights: "ru" },
      { entity: "organizations", rights: "r" },
    ],
  };
  const asset: RecordData = {
    id: "41",
    m_nIDAsset: "41",
    m_nIDOrganization: "7",
    m_sLabel: initialLabel,
    m_dhDhLastEvent: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
  };
  const organization = {
    id: "7",
    m_nIDOrganization: "7",
    m_sTag: organizationTag,
  };
  const collectionReads: URL[] = [];
  const itemReads: URL[] = [];
  const mutations: string[] = [];
  let failure: 401 | 403 | undefined;
  let expired = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (request.method() !== "GET") {
      mutations.push(url.pathname);
      return reply({ message: "Synthetic operation unavailable." }, 405);
    }
    if (url.pathname === "/api/session")
      return expired
        ? reply({ message: "The synthetic session expired." }, 401)
        : reply({
            identity,
            csrf: "synthetic-list-resume-csrf",
            expiresAt: Date.now() + 60 * 60_000,
          });
    if (url.pathname === "/api/resources/assets") {
      collectionReads.push(url);
      if (failure) {
        if (failure === 401) expired = true;
        return reply(
          {
            message:
              failure === 401
                ? "The synthetic session expired."
                : "Synthetic asset list access revoked.",
          },
          failure,
        );
      }
      return reply({ data: [asset], total: 60 });
    }
    if (url.pathname === "/api/resources/assets/41") {
      itemReads.push(url);
      return reply({ data: asset });
    }
    if (url.pathname === "/api/resources/organizations")
      return reply({ data: [organization], total: 1 });
    if (url.pathname === "/api/resources/organizations/7")
      return reply({ data: organization });
    // Every API request stays synthetic, including workspace overview metrics.
    return reply({ data: [], total: 0 });
  });
  return {
    collectionReads,
    itemReads,
    mutations,
    update: (label = refreshedLabel, tag = refreshedOrganizationTag) => {
      asset.m_sLabel = label;
      asset.m_dhDhLastEvent = new Date().toISOString();
      organization.m_sTag = tag;
    },
    rejectList: (status: 401 | 403) => {
      failure = status;
    },
  };
}

async function visibility(
  page: Page,
  state: "hidden" | "visible",
  pairedFocus = false,
) {
  await page.evaluate(
    ({ state, pairedFocus }) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: state,
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: state === "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      if (pairedFocus) window.dispatchEvent(new Event("focus"));
    },
    { state, pairedFocus },
  );
}

async function windowEvent(page: Page, name: "focus" | "blur") {
  await page.evaluate((event) => window.dispatchEvent(new Event(event)), name);
}

async function settleBrowserWork(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function openAssets(page: Page) {
  await page.goto("/assets");
  await expect(
    page.getByRole("link", { name: initialLabel, exact: true }),
  ).toBeVisible();
}

async function pauseBeforeNavigation(page: Page) {
  const now = new Date();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
}

async function visibleWithPausedClock(page: Page, locator: Locator) {
  await expect
    .poll(async () => {
      await page.clock.runFor(0);
      return locator.isVisible();
    })
    .toBe(true);
}

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "visibilityState");
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
});

test("a quick browser return refreshes asset data and status once without reading while backgrounded", async ({
  page,
}) => {
  const mock = await mockResumableAssets(page);
  await openAssets(page);
  await expect(
    page.getByRole("link", { name: organizationTag, exact: true }),
  ).toHaveAttribute("href", "/organizations/7");
  await expect(page.locator(".hub-status-dot")).toHaveAttribute(
    "data-status",
    "red",
  );
  const before = mock.collectionReads.length;
  const leftAt = Date.now();
  await visibility(page, "hidden");
  await windowEvent(page, "blur");
  mock.update();
  await settleBrowserWork(page);
  expect(mock.collectionReads).toHaveLength(before);
  await visibility(page, "visible", true);
  await expect(
    page.getByRole("link", { name: refreshedLabel, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: initialLabel, exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".hub-status-dot")).toHaveAttribute(
    "data-status",
    "green",
  );
  await expect(
    page.getByRole("link", { name: refreshedOrganizationTag, exact: true }),
  ).toHaveAttribute("href", "/organizations/7");
  await expect(
    page.getByRole("link", { name: organizationTag, exact: true }),
  ).toHaveCount(0);
  expect(Date.now() - leftAt).toBeLessThan(15_000);
  await settleBrowserWork(page);
  expect(mock.collectionReads).toHaveLength(before + 1);
  // A repeated focus signal for the same foreground state is not another return.
  await windowEvent(page, "focus");
  await settleBrowserWork(page);
  expect(mock.collectionReads).toHaveLength(before + 1);
  expect(mock.mutations).toEqual([]);
});

test("returning preserves the list URL, workspace, filters, sort order and current page", async ({
  page,
}) => {
  const mock = await mockResumableAssets(page, true);
  await openAssets(page);
  await page.locator(".organization-picker .ant-select-selector").click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText(organizationTag, { exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Assets", exact: true }).click();
  await expect(
    page.getByRole("link", { name: initialLabel, exact: true }),
  ).toBeVisible();
  const search = page.getByLabel("Search assets", { exact: true });
  await search.fill("Synthetic");
  await search.press("Enter");
  await page.getByRole("button", { name: /Filters$/ }).click();
  const organization = page.getByLabel("Organization ID", { exact: true });
  await organization.fill("7");
  await organization.press("Enter");
  const status = page.getByRole("columnheader", {
    name: "Status",
    exact: true,
  });
  await status.click();
  await expect(status).toHaveAttribute("aria-sort", "ascending");
  await page.locator(".ant-pagination-item-2").click();
  await expect
    .poll(() => {
      const params = mock.collectionReads.at(-1)?.searchParams;
      return [
        params?.get("_organization"),
        params?.get("_page"),
        params?.get("_q"),
        params?.get("idorganization"),
        params?.get("_sort"),
        params?.get("_order"),
      ];
    })
    .toEqual(["7", "2", "Synthetic", "7", "status", "asc"]);
  const url = page.url();
  const previousQuery = mock.collectionReads.at(-1)!.search;
  const before = mock.collectionReads.length;
  await visibility(page, "hidden");
  mock.update();
  await visibility(page, "visible");
  await expect(
    page.getByRole("link", { name: refreshedLabel, exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(url);
  await expect(search).toHaveValue("Synthetic");
  await expect(organization).toHaveValue("7");
  await expect(status).toHaveAttribute("aria-sort", "ascending");
  await expect(page.locator(".ant-pagination-item-2")).toHaveClass(
    /ant-pagination-item-active/,
  );
  await expect(
    page.locator(".organization-picker .ant-select-selection-item"),
  ).toHaveText(organizationTag);
  expect(mock.collectionReads.length).toBeGreaterThan(before);
  for (const read of mock.collectionReads.slice(before))
    expect(read.search).toBe(previousQuery);
  expect(mock.mutations).toEqual([]);
});

test("window blur and focus refresh the visible list without requiring a visibility change", async ({
  page,
}) => {
  const mock = await mockResumableAssets(page);
  await openAssets(page);
  const before = mock.collectionReads.length;
  await windowEvent(page, "blur");
  mock.update();
  await settleBrowserWork(page);
  expect(mock.collectionReads).toHaveLength(before);
  expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
  await windowEvent(page, "focus");
  await expect(
    page.getByRole("link", { name: refreshedLabel, exact: true }),
  ).toBeVisible();
  await settleBrowserWork(page);
  expect(mock.collectionReads).toHaveLength(before + 1);
});

test("a forbidden list refresh on return hides cached rows and counts while preserving filters", async ({
  page,
}) => {
  const mock = await mockResumableAssets(page);
  await openAssets(page);
  await page.getByRole("button", { name: /Filters$/ }).click();
  const organization = page.getByLabel("Organization ID", { exact: true });
  await organization.fill("7");
  await organization.press("Enter");
  await expect(
    page.getByText("60 loaded matches", { exact: true }),
  ).toBeVisible();
  await visibility(page, "hidden");
  mock.rejectList(403);
  await visibility(page, "visible");
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic asset list access revoked.",
  );
  await expect(
    page.getByRole("link", { name: initialLabel, exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(
    page.getByText("60 loaded matches", { exact: true }),
  ).toHaveCount(0);
  await expect(organization).toBeEditable();
  await expect(organization).toHaveValue("7");
});

test("an expired session on return removes cached assets and returns to sign in", async ({
  page,
}) => {
  const mock = await mockResumableAssets(page);
  await openAssets(page);
  await visibility(page, "hidden");
  mock.rejectList(401);
  await visibility(page, "visible");
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("link", { name: initialLabel, exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("returning to a dirty edit form keeps its unsaved field and does not refetch the record", async ({
  page,
}) => {
  const mock = await mockResumableAssets(page);
  await page.goto("/assets/41/edit");
  const label = page.getByLabel("Label", { exact: true });
  await expect(label).toHaveValue(initialLabel);
  await label.fill("Synthetic unsaved edit");
  const reads = mock.itemReads.length;
  await visibility(page, "hidden");
  await windowEvent(page, "blur");
  mock.update();
  await visibility(page, "visible", true);
  await settleBrowserWork(page);
  await expect(label).toHaveValue("Synthetic unsaved edit");
  await expect(page).toHaveURL(/\/assets\/41\/edit$/);
  expect(mock.itemReads).toHaveLength(reads);
  expect(mock.collectionReads).toHaveLength(0);
  expect(mock.mutations).toEqual([]);
});

test("a visible list refreshes at each full minute while preserving its filters, sort and page", async ({
  page,
}) => {
  await pauseBeforeNavigation(page);
  const mock = await mockResumableAssets(page);
  const params = new URLSearchParams({
    currentPage: "2",
    pageSize: "25",
    "sorters[0][field]": "status",
    "sorters[0][order]": "asc",
    "filters[0][field]": "_q",
    "filters[0][operator]": "eq",
    "filters[0][value]": "Synthetic",
    "filters[1][field]": "idorganization",
    "filters[1][operator]": "eq",
    "filters[1][value]": "7",
  });
  await page.goto(`/assets?${params}`);
  await visibleWithPausedClock(
    page,
    page.getByRole("link", { name: initialLabel, exact: true }),
  );
  await visibleWithPausedClock(
    page,
    page.getByRole("link", { name: organizationTag, exact: true }),
  );
  const initialReads = mock.collectionReads.length;
  const initialQuery = mock.collectionReads.at(-1)!.search;
  const url = page.url();
  const status = page.getByRole("columnheader", {
    name: "Status",
    exact: true,
  });
  expect(mock.collectionReads.at(-1)?.searchParams.get("_page")).toBe("2");
  await expect(page.locator(".hub-status-dot")).toHaveAttribute(
    "data-status",
    "red",
  );
  mock.update();
  await page.clock.runFor(59_999);
  expect(mock.collectionReads).toHaveLength(initialReads);
  await expect(
    page.getByRole("link", { name: initialLabel, exact: true }),
  ).toBeVisible();
  await page.clock.runFor(1);
  await visibleWithPausedClock(
    page,
    page.getByRole("link", { name: refreshedLabel, exact: true }),
  );
  await visibleWithPausedClock(
    page,
    page.getByRole("link", { name: refreshedOrganizationTag, exact: true }),
  );
  await expect(page.locator(".hub-status-dot")).toHaveAttribute(
    "data-status",
    "green",
  );
  expect(mock.collectionReads).toHaveLength(initialReads + 1);
  const secondLabel = "Synthetic asset after second minute";
  const secondTag = "SYNTHETIC-ORGANIZATION-SECOND-MINUTE";
  mock.update(secondLabel, secondTag);
  await page.clock.runFor(59_999);
  expect(mock.collectionReads).toHaveLength(initialReads + 1);
  await page.clock.runFor(1);
  await visibleWithPausedClock(
    page,
    page.getByRole("link", { name: secondLabel, exact: true }),
  );
  await visibleWithPausedClock(
    page,
    page.getByRole("link", { name: secondTag, exact: true }),
  );
  expect(mock.collectionReads).toHaveLength(initialReads + 2);
  await expect(page).toHaveURL(url);
  await expect(page.getByLabel("Search assets", { exact: true })).toHaveValue(
    "Synthetic",
  );
  await expect(status).toHaveAttribute("aria-sort", "ascending");
  await expect(page.locator(".ant-pagination-item-2")).toHaveClass(
    /ant-pagination-item-active/,
  );
  await expect(
    page.locator(".organization-picker .ant-select-selection-item"),
  ).toHaveText(organizationTag);
  for (const read of mock.collectionReads.slice(initialReads))
    expect(read.search).toBe(initialQuery);
  expect(mock.mutations).toEqual([]);
});

test("minute refreshes skip hidden tabs, refresh immediately on return and continue while visible but unfocused", async ({
  page,
}) => {
  await pauseBeforeNavigation(page);
  const mock = await mockResumableAssets(page);
  await page.goto("/assets");
  await visibleWithPausedClock(
    page,
    page.getByRole("link", { name: initialLabel, exact: true }),
  );
  const initialReads = mock.collectionReads.length;
  await visibility(page, "hidden");
  await windowEvent(page, "blur");
  mock.update();
  await page.clock.runFor(120_000);
  expect(mock.collectionReads).toHaveLength(initialReads);
  await visibility(page, "visible", true);
  await visibleWithPausedClock(
    page,
    page.getByRole("link", { name: refreshedLabel, exact: true }),
  );
  expect(mock.collectionReads).toHaveLength(initialReads + 1);
  await windowEvent(page, "blur");
  const unfocusedLabel = "Synthetic visible unfocused minute refresh";
  mock.update(unfocusedLabel);
  await page.clock.runFor(60_000);
  await visibleWithPausedClock(
    page,
    page.getByRole("link", { name: unfocusedLabel, exact: true }),
  );
  expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
  expect(mock.collectionReads).toHaveLength(initialReads + 2);
  expect(mock.mutations).toEqual([]);
});

test("leaving a list stops its minute timer in detail and dirty edit views", async ({
  page,
}) => {
  await pauseBeforeNavigation(page);
  const mock = await mockResumableAssets(page);
  await page.goto("/assets");
  await visibleWithPausedClock(
    page,
    page.getByRole("link", { name: initialLabel, exact: true }),
  );
  await page.clock.resume();
  await page.getByRole("link", { name: initialLabel, exact: true }).click();
  await expect(page).toHaveURL(/\/assets\/41$/);
  await expect(
    page.getByRole("heading", { name: initialLabel, exact: true }),
  ).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  const readsInDetail = mock.collectionReads.length;
  const detailReads = mock.itemReads.length;
  await page.clock.runFor(120_000);
  expect(mock.collectionReads).toHaveLength(readsInDetail);
  expect(mock.itemReads).toHaveLength(detailReads);
  await page.clock.resume();
  await page.getByRole("button", { name: /Edit$/ }).click();
  const label = page.getByLabel("Label", { exact: true });
  await expect(label).toHaveValue(initialLabel);
  await label.fill("Synthetic unsaved minute timer edit");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  const readsInEditor = mock.itemReads.length;
  mock.update();
  await page.clock.runFor(120_000);
  await expect(label).toHaveValue("Synthetic unsaved minute timer edit");
  await expect(page).toHaveURL(/\/assets\/41\/edit$/);
  expect(mock.collectionReads).toHaveLength(readsInDetail);
  expect(mock.itemReads).toHaveLength(readsInEditor);
  expect(mock.mutations).toEqual([]);
});
