import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  HubOnlineHours,
  HubOnlineResponse,
} from "../../shared/hub-online";
import type { Identity, RecordData } from "../../shared/resources";

test.use({ timezoneId: "America/New_York", locale: "en-US" });
const hubId = "9223372036854775806";
const otherHubId = "9223372036854775805";
const organizationId = "7";
const end = Date.parse("2026-11-07T12:00:00.000Z");

function activity(
  id: string,
  hours: HubOnlineHours,
  mode = "activity",
): HubOnlineResponse {
  const start = end - hours * 3_600_000;
  const buckets = Array.from({ length: hours * 12 }, (_, index) => ({
    start: new Date(start + index * 300_000).toISOString(),
    end: new Date(start + (index + 1) * 300_000).toISOString(),
    receivedCount:
      mode === "limited" && index < 12
        ? null
        : mode === "empty"
          ? "0"
          : index === hours * 12 - 1 ||
              (id === otherHubId && index === hours * 12 - 2)
            ? "3"
            : "0",
  }));
  return {
    hubId: id,
    hours,
    rangeStart: new Date(start).toISOString(),
    rangeEnd: new Date(end).toISOString(),
    observedAt: new Date(end).toISOString(),
    bucketSeconds: 300,
    buckets,
    coverage: "retained_only",
    limited: mode === "limited",
    scanLimit: 100000,
    scannedItemCount:
      mode === "limited"
        ? 100000
        : buckets.reduce(
            (sum, bucket) => sum + Number(bucket.receivedCount),
            0,
          ),
  };
}

async function syntheticOnline(
  page: Page,
  options: { hubAccess?: boolean; devicesAccess?: boolean } = {},
) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic online reader",
    organizationId,
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      ...(options.hubAccess === false ? [] : [{ entity: "hubs", rights: "r" }]),
      { entity: "hubtypes", rights: "r" },
      { entity: "assets", rights: "r" },
      ...(options.devicesAccess === false
        ? []
        : [{ entity: "devices", rights: "r" }]),
    ],
  };
  const hubs = [hubId, otherHubId].map((id, index): RecordData => ({
    id,
    m_nIDHub: id,
    m_nIDHubType: "81",
    m_nIDOrganization: organizationId,
    m_nIDAsset: "0",
    m_sTag: `SYNTHETIC-ONLINE-HUB-${index + 1}`,
    m_sLabel: `Synthetic activity hub ${index + 1}`,
    m_sSerialNr: `synthetic-hub-${index + 1}`,
  }));
  let authenticated = true;
  let status = 200;
  let mode = "activity";
  let hold:
    | { release: Promise<void>; arrived: () => void; finished: () => void }
    | undefined;
  const calls: URL[] = [];
  const mutations: string[] = [];
  const reply = (route: Route, body: unknown, responseStatus = 200) =>
    route.fulfill({
      status: responseStatus,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().method() !== "GET") mutations.push(path);
    if (path === "/api/session/logout") {
      authenticated = false;
      return reply(route, { success: true });
    }
    if (path === "/api/session")
      return reply(
        route,
        authenticated
          ? {
              identity,
              csrf: "synthetic-online-csrf",
              expiresAt: Date.now() + 3_600_000,
            }
          : { message: "Synthetic sign-in required." },
        authenticated ? 200 : 401,
      );
    if (/^\/api\/hubs\/\d+\/online$/.test(path)) {
      calls.push(url);
      const id = path.split("/")[3];
      const hours = Number(url.searchParams.get("hours")) as HubOnlineHours;
      const body =
        status === 200
          ? activity(id, hours, mode)
          : { message: "Synthetic hub history denied or unavailable." };
      const responseStatus = status;
      const pending = hold;
      hold = undefined;
      if (pending) {
        pending.arrived();
        await pending.release;
      }
      try {
        await reply(route, body, responseStatus);
      } catch {
        /* A tab, target or account change can abort the held request. */
      } finally {
        pending?.finished();
      }
      return;
    }
    if (path === "/api/resources/hubs")
      return reply(route, { data: hubs, total: hubs.length, limited: false });
    if (path.startsWith("/api/resources/hubs/")) {
      const row = hubs.find((hub) => hub.id === path.split("/").at(-1));
      return reply(route, { data: row });
    }
    if (path === "/api/resources/hubtypes/81")
      return reply(route, {
        data: {
          id: "81",
          m_nIDHubType: "81",
          m_sTag: "SYNTHETIC-SHARED-HUB",
          m_bIsSingleAsset: false,
        },
      });
    return reply(route, { data: [], total: 0, limited: false });
  });
  return {
    calls,
    mutations,
    setStatus: (next: number) => {
      status = next;
    },
    setMode: (next: string) => {
      mode = next;
    },
    holdNext: () => {
      let release!: () => void;
      let arrived!: () => void;
      let finished!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      const completed = new Promise<void>((resolve) => {
        finished = resolve;
      });
      hold = { release: released, arrived, finished };
      return { release, entered, completed };
    },
  };
}

const panel = (page: Page) =>
  page.getByRole("region", { name: "Hub online activity", exact: true });
const chart = (page: Page) =>
  panel(page).getByRole("img", { name: /^Hub activity over/ });

test("Online follows Devices and loads only while selected with exact hub and organization scope", async ({
  page,
}, testInfo) => {
  const mock = await syntheticOnline(page);
  await page.goto(`/hubs/${hubId}?keep=preserved`);
  await expect(
    page.getByRole("tab", { name: "Assets", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab")).toHaveText([
    "Details",
    "Devices",
    "Online",
    "Assets",
  ]);
  expect(mock.calls).toHaveLength(0);
  await page.getByRole("tab", { name: "Online", exact: true }).click();
  await expect(chart(page)).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/hubs/${hubId}\\?keep=preserved&tab=online$`),
  );
  expect(mock.calls.length).toBeGreaterThan(0);
  for (const call of mock.calls)
    expect(Object.fromEntries(call.searchParams)).toEqual({
      hours: "24",
      _organization: organizationId,
    });
  await expect(panel(page).locator(".hub-online-bucket")).toHaveCount(288);
  await expect(panel(page).locator('[data-state="active"]')).toHaveCount(1);
  await expect(
    panel(page).locator(".hub-online-bucket title").last(),
  ).toContainText("07/11/2026, 12:55:00");
  await expect(panel(page)).toContainText(
    "Gaps do not confirm that the hub was offline.",
  );
  await page.screenshot({
    path: testInfo.outputPath("hub-online-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Devices", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  expect(mock.mutations).toEqual([]);
});

test("direct Online URLs and selectable 48-hour and seven-day spans preserve other parameters", async ({
  page,
}) => {
  const mock = await syntheticOnline(page);
  await page.goto(`/hubs/${hubId}?tab=online&onlineHours=48&keep=value`);
  await expect(chart(page)).toHaveAttribute(
    "aria-label",
    /^Hub activity over the past 48 hours/,
  );
  await expect(panel(page).locator(".hub-online-bucket")).toHaveCount(576);
  await panel(page).locator(".ant-select-selector").click();
  await page
    .locator(".ant-select-dropdown")
    .getByText("Past 7 days", { exact: true })
    .click();
  await expect(chart(page)).toHaveAttribute(
    "aria-label",
    /^Hub activity over the past 168 hours/,
  );
  await expect(panel(page).locator(".hub-online-bucket")).toHaveCount(2016);
  expect(new URL(page.url()).searchParams.get("keep")).toBe("value");
  expect(new URL(page.url()).searchParams.get("onlineHours")).toBe("168");
  expect([
    ...new Set(mock.calls.map((url) => url.searchParams.get("hours"))),
  ]).toEqual(["48", "168"]);
  await page.reload();
  await expect(chart(page)).toHaveAttribute(
    "aria-label",
    /^Hub activity over the past 168 hours/,
  );
});

test("invalid hub tabs fall back to Details and Online does not require device access", async ({
  page,
}) => {
  const mock = await syntheticOnline(page, { devicesAccess: false });
  await page.goto(`/hubs/${hubId}?tab=invalid&onlineHours=invalid&keep=value`);
  await expect(
    page.getByRole("tab", { name: "Details", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(mock.calls).toHaveLength(0);
  await page.getByRole("tab", { name: "Online", exact: true }).click();
  await expect(chart(page)).toHaveAttribute(
    "aria-label",
    /^Hub activity over the past 24 hours/,
  );
  expect(new URL(page.url()).searchParams.get("keep")).toBe("value");
});

test("failed refresh removes the prior timeline and Retry recovers while hub permission prevents reads", async ({
  page,
}) => {
  const mock = await syntheticOnline(page);
  await page.goto(`/hubs/${hubId}?tab=online`);
  await expect(chart(page)).toBeVisible();
  mock.setStatus(403);
  await panel(page)
    .getByRole("button", { name: "Refresh hub activity", exact: true })
    .click();
  await expect(
    panel(page).getByText("Hub activity unavailable", { exact: true }),
  ).toBeVisible();
  await expect(chart(page)).toHaveCount(0);
  mock.setStatus(200);
  await panel(page).getByRole("button", { name: "Retry", exact: true }).click();
  await expect(chart(page)).toBeVisible();
});

test("no hub read permission prevents Online requests", async ({ page }) => {
  const mock = await syntheticOnline(page, { hubAccess: false });
  await page.goto(`/hubs/${hubId}?tab=online`);
  await expect(
    page.getByText("Access unavailable", { exact: true }),
  ).toBeVisible();
  await expect(chart(page)).toHaveCount(0);
  expect(mock.calls).toHaveLength(0);
});

test("limited retained history marks leading intervals unknown and empty history remains distinct", async ({
  page,
}) => {
  const mock = await syntheticOnline(page);
  mock.setMode("limited");
  await page.goto(`/hubs/${hubId}?tab=online`);
  await expect(chart(page)).toBeVisible();
  await expect(
    panel(page).getByText("Incomplete activity history", { exact: true }),
  ).toBeVisible();
  await expect(panel(page).locator('[data-state="unknown"]')).toHaveCount(12);
  await expect(panel(page)).toContainText("earlier intervals are unknown");
  mock.setMode("empty");
  await panel(page)
    .getByRole("button", { name: "Refresh hub activity", exact: true })
    .click();
  await expect(
    panel(page).getByText("No activity was recorded in this period.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(panel(page).locator('[data-state="unknown"]')).toHaveCount(0);
  await expect(panel(page).locator('[data-state="empty"]')).toHaveCount(288);
  await expect(
    panel(page).getByText("Incomplete activity history", { exact: true }),
  ).toHaveCount(0);
});

test("visible minute refresh and detail Refresh update Online without polling hidden tabs", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(end) });
  const mock = await syntheticOnline(page);
  await page.goto(`/hubs/${hubId}?tab=online`);
  await expect(chart(page)).toBeVisible();
  const initial = mock.calls.length;
  await page.clock.runFor(60_000);
  await expect.poll(() => mock.calls.length).toBe(initial + 1);
  await expect(
    panel(page).getByRole("button", {
      name: "Refresh hub activity",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .locator(".page-heading")
    .getByRole("button", { name: /Refresh$/ })
    .click();
  await expect.poll(() => mock.calls.length).toBe(initial + 2);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  await page.clock.runFor(120_000);
  expect(mock.calls).toHaveLength(initial + 2);
});

test("mobile activity timeline and controls stay inside the viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await syntheticOnline(page);
  await page.goto(`/hubs/${hubId}?tab=online&onlineHours=168`);
  await expect(chart(page)).toBeVisible();
  const bounds = await chart(page).boundingBox();
  expect(bounds!.width).toBeGreaterThan(200);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("hub-online-mobile.png"),
    fullPage: true,
  });
});

test("a late response for the previous hub cannot replace the current hub timeline", async ({
  page,
}) => {
  const mock = await syntheticOnline(page);
  await page.goto(`/hubs/${hubId}?tab=online`);
  await expect(chart(page)).toBeVisible();
  const held = mock.holdNext();
  try {
    await panel(page)
      .getByRole("button", { name: "Refresh hub activity", exact: true })
      .click();
    await held.entered;
    await page
      .locator(".ant-breadcrumb")
      .getByRole("link", { name: "Hubs", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Synthetic activity hub 2", exact: true })
      .click();
    await page.getByRole("tab", { name: "Online", exact: true }).click();
    await expect(panel(page)).toContainText("2 of 288 recorded");
    held.release();
    await held.completed;
    await expect(panel(page)).toContainText("2 of 288 recorded");
    await expect(page).toHaveURL(
      new RegExp(`/hubs/${otherHubId}\\?tab=online$`),
    );
  } finally {
    held.release();
  }
});

test("signing out fences a late Online response and clears the graph", async ({
  page,
}) => {
  const mock = await syntheticOnline(page);
  await page.goto(`/hubs/${hubId}?tab=online`);
  await expect(chart(page)).toBeVisible();
  const held = mock.holdNext();
  try {
    await panel(page)
      .getByRole("button", { name: "Refresh hub activity", exact: true })
      .click();
    await held.entered;
    await page
      .getByRole("button", { name: "Account menu", exact: true })
      .click();
    await page.getByRole("menuitem", { name: /Sign out$/ }).click();
    await expect(page).toHaveURL(/\/login$/);
    held.release();
    await held.completed;
    await expect(page.getByLabel("Login", { exact: true })).toBeVisible();
    await expect(chart(page)).toHaveCount(0);
    expect(mock.mutations).toEqual(["/api/session/logout"]);
  } finally {
    held.release();
  }
});
