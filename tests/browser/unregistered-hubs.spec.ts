import { expect, test, type Locator, type Page } from "@playwright/test";
import type {
  UnregisteredHub,
  UnregisteredHubsResponse,
} from "../../shared/unregistered-hubs";
import { installCareFixtures } from "./care-fixtures";

const endpoint = "/api/core/unregistered-hubs";
const firstSeenAt = "2026-11-04T06:15:00.000Z";
const lastSeenAt = "2026-11-05T07:45:00.000Z";
const observedAt = "2026-11-05T12:00:00.000Z";
const hub: UnregisteredHub = {
  hubKind: "SYNTHETIC-HUB-KIND",
  serialNumber: "SYNTHETIC-UNREGISTERED-0001",
  firstSeenAt,
  lastSeenAt,
  rejectionCount: "7",
  hubTypeStatus: "registered",
};

function response(data: UnregisteredHub[] = [hub]): UnregisteredHubsResponse {
  return {
    data: structuredClone(data),
    limit: 100,
    hasMore: false,
    scanLimit: 10000,
    scannedMessageCount: data.reduce(
      (sum, row) => sum + Number(row.rejectionCount),
      0,
    ),
    messagesLimited: false,
    observedAt,
  };
}

function card(page: Page) {
  return page.locator(".ant-card").filter({
    has: page.getByText("Unregistered hubs", { exact: true }),
  });
}

async function mockHubs(page: Page, caregiver = false) {
  const fixture = await installCareFixtures(page, { caregiver });
  let body: unknown = response();
  let status = 200;
  let nextHold: Promise<void> | undefined;
  let active = 0;
  let maximumActive = 0;
  const reads: { method: string; path: string; search: string }[] = [];
  await page.route(`**${endpoint}`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    reads.push({
      method: request.method(),
      path: url.pathname,
      search: url.search,
    });
    active++;
    maximumActive = Math.max(maximumActive, active);
    try {
      const hold = nextHold;
      nextHold = undefined;
      if (hold) await hold;
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    } finally {
      active--;
    }
  });
  return {
    fixture,
    reads,
    set(value: unknown, code = 200) {
      body = value;
      status = code;
    },
    holdNext() {
      let release!: () => void;
      nextHold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    active: () => active,
    maximumActive: () => maximumActive,
  };
}

function expectOnlyFixedReads(mock: Awaited<ReturnType<typeof mockHubs>>) {
  expect(
    mock.reads.every(
      (read) =>
        read.method === "GET" && read.path === endpoint && read.search === "",
    ),
  ).toBe(true);
  expect(mock.fixture.unexpected).toEqual([]);
  expect(mock.fixture.calls.filter((call) => call.method !== "GET")).toEqual(
    [],
  );
}

async function visibleWithClock(page: Page, locator: Locator) {
  await expect
    .poll(async () => {
      await page.clock.runFor(0);
      return locator.isVisible();
    })
    .toBe(true);
}

async function visibility(page: Page, state: "visible" | "hidden") {
  await page.evaluate((state) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: state,
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: state === "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test("Overview shows global unregistered hub identities, receipt times and unknown hub types", async ({
  page,
}) => {
  const mock = await mockHubs(page);
  mock.fixture.session.activeOrganizationId = "1";
  mock.set(
    response([
      hub,
      {
        ...hub,
        hubKind: "SYNTHETIC-UNKNOWN-TYPE",
        serialNumber: "SYNTHETIC-UNKNOWN-0002",
        rejectionCount: "3",
        hubTypeStatus: "unregistered",
      },
      {
        ...hub,
        hubKind: "SYNTHETIC-AMBIGUOUS-TYPE",
        serialNumber: "SYNTHETIC-AMBIGUOUS-0003",
        rejectionCount: "2",
        hubTypeStatus: "ambiguous",
      },
    ]),
  );
  await page.goto("/");
  const panel = card(page);
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole("cell", { name: hub.serialNumber, exact: true }),
  ).toBeVisible();
  await expect(panel).toContainText(/across the platform/i);
  const row = panel
    .getByRole("cell", { name: hub.serialNumber, exact: true })
    .locator("..");
  await expect(
    row.getByRole("cell", { name: hub.hubKind, exact: true }),
  ).toBeVisible();
  await expect(row.getByRole("cell", { name: "7", exact: true })).toBeVisible();
  await expect(row.locator("time").nth(0)).toHaveAttribute(
    "datetime",
    firstSeenAt,
  );
  await expect(row.locator("time").nth(1)).toHaveAttribute(
    "datetime",
    lastSeenAt,
  );
  const unknown = panel
    .getByRole("cell", { name: "SYNTHETIC-UNKNOWN-0002", exact: true })
    .locator("..");
  await expect(unknown).toContainText(/unregistered|unknown/i);
  const ambiguous = panel
    .getByRole("cell", { name: "SYNTHETIC-AMBIGUOUS-0003", exact: true })
    .locator("..");
  await expect(ambiguous).toContainText(/ambiguous/i);
  expect(mock.reads).toHaveLength(1);
  expectOnlyFixedReads(mock);
});

test("a valid empty unregistered hub result is distinct from bounded incomplete results", async ({
  page,
}) => {
  const mock = await mockHubs(page);
  mock.set(response([]));
  await page.goto("/");
  const panel = card(page);
  await expect(panel).toContainText(/no unregistered hubs/i);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  const limited = response(
    Array.from({ length: 100 }, (_, index) => ({
      ...hub,
      serialNumber: `SYNTHETIC-LIMITED-${String(index).padStart(3, "0")}`,
      rejectionCount: "1",
    })),
  );
  limited.hasMore = true;
  limited.messagesLimited = true;
  limited.scannedMessageCount = 10000;
  mock.set(limited);
  await panel
    .getByRole("button", { name: "Refresh unregistered hubs", exact: true })
    .click();
  await expect(
    panel.getByRole("cell", { name: "SYNTHETIC-LIMITED-000", exact: true }),
  ).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveText([
    /latest 10,000 retained unknown-hub rejections.*Older rejections are not included/,
    /Only the 100 most recently seen unregistered hubs are shown/,
  ]);
  await expect(panel).not.toContainText(/no unregistered hubs/i);
  expect(mock.reads).toHaveLength(2);
  expectOnlyFixedReads(mock);
});

test("failed or invalid unregistered hub refreshes clear stale rows and Retry recovers", async ({
  page,
}) => {
  const mock = await mockHubs(page);
  await page.goto("/");
  const panel = card(page);
  await expect(
    panel.getByRole("cell", { name: hub.serialNumber, exact: true }),
  ).toBeVisible();
  mock.set({ message: "Synthetic Core projection is unavailable." }, 502);
  await panel
    .getByRole("button", { name: "Refresh unregistered hubs", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Synthetic Core projection is unavailable.",
  );
  await expect(
    panel.getByRole("cell", { name: hub.serialNumber, exact: true }),
  ).toHaveCount(0);
  await expect(panel).not.toContainText(/no unregistered hubs/i);
  mock.set({ ...response(), messagesLimited: "false" });
  await panel
    .getByRole("button", { name: "Retry unregistered hubs", exact: true })
    .click();
  await expect.poll(() => mock.reads.length).toBe(3);
  await expect(panel.getByRole("alert")).toContainText(
    "Unregistered hub data is unavailable.",
  );
  await expect(
    panel.getByRole("cell", { name: hub.serialNumber, exact: true }),
  ).toHaveCount(0);
  mock.set(response([]));
  await panel
    .getByRole("button", { name: "Retry unregistered hubs", exact: true })
    .click();
  await expect(panel).toContainText(/no unregistered hubs/i);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  expect(mock.reads).toHaveLength(4);
  expectOnlyFixedReads(mock);
});

for (const audience of [
  "ordinary administrator",
  "caregiver",
  "password change required",
] as const) {
  test(`${audience} never fetches or sees the unregistered hub card`, async ({
    page,
  }) => {
    const mock = await mockHubs(page, audience === "caregiver");
    if (audience === "ordinary administrator") {
      mock.fixture.session.identity.level = 30;
      mock.fixture.session.identity.userTypeId = "30";
    }
    if (audience === "password change required")
      mock.fixture.session.identity.mustChangePassword = true;
    await page.goto("/");
    if (audience === "caregiver") await expect(page).toHaveURL(/\/care$/);
    else
      await expect(
        page.getByRole("heading", { name: "Your workspace", exact: true }),
      ).toBeVisible();
    if (audience === "password change required")
      await expect(page.getByRole("alert")).toContainText(
        "Set a new password to enable changes",
      );
    await expect(card(page)).toHaveCount(0);
    expect(mock.reads).toHaveLength(0);
    expectOnlyFixedReads(mock);
  });
}

test("unregistered hubs refresh each visible minute and coalesce timer, card and Overview refreshes", async ({
  page,
}) => {
  const now = new Date(observedAt);
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => false,
    });
  });
  const mock = await mockHubs(page);
  await page.goto("/");
  const panel = card(page);
  await visibleWithClock(
    page,
    panel.getByRole("cell", { name: hub.serialNumber, exact: true }),
  );
  expect(mock.reads).toHaveLength(1);
  // Align the first poll assertion with the timer's current elapsed time.
  const elapsed = (await page.evaluate(() => Date.now())) - now.getTime();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  const refreshed = { ...hub, serialNumber: "SYNTHETIC-REFRESHED-0001" };
  mock.set(response([refreshed]));
  await page.clock.runFor(59_999 - elapsed);
  expect(mock.reads).toHaveLength(1);
  await page.clock.runFor(1);
  await expect.poll(() => mock.reads.length).toBe(2);
  await visibleWithClock(
    page,
    panel.getByRole("cell", { name: refreshed.serialNumber, exact: true }),
  );
  await visibility(page, "hidden");
  await page.clock.runFor(120_000);
  expect(mock.reads).toHaveLength(2);
  await visibility(page, "visible");
  expect(mock.reads).toHaveLength(2);
  const release = mock.holdNext();
  try {
    await panel
      .getByRole("button", { name: "Refresh unregistered hubs", exact: true })
      .click();
    await expect.poll(() => mock.reads.length).toBe(3);
    await page
      .locator(".page-heading")
      .getByRole("button", { name: /Refresh$/ })
      .click();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.clock.runFor(120_000);
    expect(mock.reads).toHaveLength(3);
    expect(mock.maximumActive()).toBe(1);
  } finally {
    release();
  }
  await expect.poll(() => mock.active()).toBe(0);
  await page.clock.runFor(1);
  await page
    .locator(".page-heading")
    .getByRole("button", { name: /Refresh$/ })
    .click();
  await expect.poll(() => mock.reads.length).toBe(4);
  expectOnlyFixedReads(mock);
});

for (const width of [1440, 390]) {
  test(`unregistered hub table remains contained with long exact identities at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const mock = await mockHubs(page);
    const longHub = {
      ...hub,
      hubKind: `SYNTHETIC-${"TYPE".repeat(25)}`,
      serialNumber: `SYNTHETIC-${"SERIAL".repeat(19)}`,
    };
    mock.set(response([longHub]));
    await page.goto("/");
    const panel = card(page);
    await expect(
      panel.getByRole("cell", { name: longHub.serialNumber, exact: true }),
    ).toBeVisible();
    const bounds = await panel.evaluate((element) => {
      const scroller =
        element.querySelector<HTMLElement>(".ant-table-content")!;
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        panelRight: element.getBoundingClientRect().right,
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
      };
    });
    expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.viewport + 1);
    expect(bounds.panelRight).toBeLessThanOrEqual(bounds.viewport + 1);
    if (width === 390) {
      expect(bounds.scrollWidth).toBeGreaterThan(bounds.clientWidth);
      await panel.locator(".ant-table-content").evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      expect(
        await panel
          .locator(".ant-table-content")
          .evaluate((element) => element.scrollLeft),
      ).toBeGreaterThan(0);
    }
    await expect(
      panel.getByRole("button", {
        name: "Refresh unregistered hubs",
        exact: true,
      }),
    ).toBeVisible();
    await panel.screenshot({
      path: test.info().outputPath(`unregistered-hubs-${width}.png`),
    });
    expectOnlyFixedReads(mock);
  });
}
