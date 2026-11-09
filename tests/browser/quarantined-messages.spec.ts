import { expect, test, type Page } from "@playwright/test";
import type {
  QuarantinedMessage,
  QuarantinedMessageDetail,
  QuarantinedMessagesResponse,
} from "../../shared/quarantined-messages";
import { resources, type Identity } from "../../shared/resources";

const endpoint = "/api/core/quarantined-messages";
const nextCursor = "c3ludGhldGljX25leHRfcGFnZQ";
const observedAt = "2026-11-07T12:00:00.000Z";

function messages(): QuarantinedMessage[] {
  return Array.from({ length: 51 }, (_, index) => {
    const quarantinedAt = new Date(
      Date.parse("2026-11-07T10:00:00.000Z") - index * 60_000,
    ).toISOString();
    return {
      id: (9223372036854775700n - BigInt(index)).toString(),
      messageUuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      originItemId: String(8000 + index),
      destination:
        index < 2 ? "EXTERNAL_HISTORY" : index % 2 ? "RULES" : "ASSETS",
      state: index % 2 ? "PERMANENT_FAILURE" : "AMBIGUOUS",
      createdAt: "2026-11-07T07:00:00.000Z",
      quarantinedAt,
      updatedAt: "2026-11-07T11:00:00.000Z",
      attemptCount: index === 0 ? 101 : 1,
      errorCode:
        index === 1 ? "HISTORY_TYPE_RETAINED" : "SYNTHETIC_DELIVERY_CODE",
      acknowledgedAt: index === 0 ? "2026-11-07T10:05:00.000Z" : null,
      deferredDelivery: null,
    };
  });
}

function details(message: QuarantinedMessage): QuarantinedMessageDetail {
  return {
    message: {
      ...message,
      contractVersion: "1",
      payloadSha256: "a".repeat(64),
      version: 1,
    },
    attempts: Array.from(
      { length: Math.min(message.attemptCount, 100) },
      (_, index) => {
        const startedAt = new Date(
          Date.parse("2026-11-07T08:00:00.000Z") - index * 2_000,
        ).toISOString();
        return {
          attemptNumber: message.attemptCount - index,
          startedAt,
          completedAt: new Date(Date.parse(startedAt) + 1_000).toISOString(),
          outcome: index === 0 ? "AMBIGUOUS" : "RETRYABLE_FAILURE",
          protocolStatus: 503,
          durationMs: 1000,
          errorCode: "SYNTHETIC_DELIVERY_CODE",
        };
      },
    ),
    attemptLimit: 100,
    attemptsHasMore: message.attemptCount > 100,
    observedAt,
    recoveryDetailsAvailable: false,
  };
}

async function fixture(
  page: Page,
  options: {
    level?: number;
    caregiver?: boolean;
    mustChangePassword?: boolean;
  } = {},
) {
  const level = options.level ?? 90;
  let identity: Identity = {
    id: "100",
    name: "Synthetic quarantine administrator",
    organizationId: "7",
    userTypeId: String(level),
    level,
    caregiverReadOnly: options.caregiver ?? false,
    mustChangePassword: options.mustChangePassword ?? false,
    permissions: resources.map((resource) => ({
      entity: resource.name,
      rights: "crud",
    })),
  };
  let rows = messages();
  let listError = false;
  let detailError = false;
  let recovery = false;
  let nextDetailHold: Promise<void> | undefined;
  const reads: { method: string; path: string; query: URLSearchParams }[] = [];
  const session = () => ({
    identity,
    csrf: "synthetic-quarantine-csrf",
    expiresAt: Date.parse(observedAt) + 3_600_000,
    activeOrganizationId: null,
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const reply = async (body: unknown, status = 200) => {
      await route
        .fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        })
        .catch(() => {});
    };
    if (path === "/api/session" || path === "/api/session/login")
      return reply(session());
    if (path === endpoint) {
      reads.push({ method: request.method(), path, query: url.searchParams });
      if (listError)
        return reply(
          { message: "Synthetic quarantine service unavailable." },
          503,
        );
      const matching = rows.filter(
        (row) =>
          (!url.searchParams.has("destination") ||
            row.destination === url.searchParams.get("destination")) &&
          (!url.searchParams.has("state") ||
            row.state === url.searchParams.get("state")),
      );
      const offset = url.searchParams.has("cursor") ? 50 : 0;
      const response: QuarantinedMessagesResponse = {
        data: matching.slice(offset, offset + 50),
        limit: 50,
        hasMore: matching.length > offset + 50,
        nextCursor: matching.length > offset + 50 ? nextCursor : null,
        observedAt,
        recoveryDetailsAvailable: recovery,
      };
      return reply(response);
    }
    if (path.startsWith(`${endpoint}/`)) {
      reads.push({ method: request.method(), path, query: url.searchParams });
      const message = rows.find(
        (row) => row.id === path.slice(endpoint.length + 1),
      );
      const response = message ? details(message) : null;
      if (response) {
        response.recoveryDetailsAvailable = recovery;
        if (recovery)
          response.message.deferredDelivery = {
            state: "CONFIRMED",
            attemptCount: 2,
            failureCode: null,
            updatedAt: "2026-11-07T11:30:00.000Z",
            sourceVersion: 0,
            matchesCurrentSource: false,
          };
      }
      const hold = nextDetailHold;
      nextDetailHold = undefined;
      if (hold) await hold;
      return detailError
        ? reply({ message: "Synthetic details unavailable." }, 503)
        : response
          ? reply(response)
          : reply({ message: "Message is unavailable." }, 404);
    }
    if (path === "/api/quarantine/incoming")
      return reply({
        source: url.searchParams.get("source"),
        data: [],
        limit: 50,
        hasMore: false,
        nextCursor: null,
        observedAt,
        payloadAvailable: false,
        scanLimit: 100000,
        scannedRowCount: 0,
        scanLimited: false,
      });
    if (path === "/api/core/outboxes")
      return reply({
        data: ["rules", "assets", "mqtt_information", "external_history"].map(
          (destination) => ({ destination, size: "0", latencySeconds: "0" }),
        ),
      });
    return reply({ data: [], total: 0 });
  });
  return {
    reads,
    rows: () => rows,
    failList: (value = true) => {
      listError = value;
    },
    failDetail: (value = true) => {
      detailError = value;
    },
    empty: () => {
      rows = [];
    },
    recovery: () => {
      recovery = true;
    },
    holdNextDetail() {
      let release!: () => void;
      nextDetailHold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    changeAccount() {
      identity = {
        ...identity,
        id: "200",
        name: "Synthetic replacement administrator",
      };
      rows = [
        {
          ...messages()[0],
          id: "9000",
          messageUuid: "10000000-0000-4000-8000-000000000001",
        },
      ];
    },
  };
}

const card = (page: Page) =>
  page.getByRole("region", {
    name: "Outgoing quarantined messages",
    exact: true,
  });
const drawer = (page: Page) =>
  page.getByRole("dialog", {
    name: "Outgoing quarantined message",
    exact: true,
  });
async function select(page: Page, label: string, value: string) {
  await card(page)
    .locator(".ant-select")
    .filter({ has: page.getByLabel(label, { exact: true }) })
    .locator(".ant-select-selector")
    .click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText(value, { exact: true })
    .click();
}

test("platform administrators can inspect retained outcomes and bounded delivery attempts", async ({
  page,
}, testInfo) => {
  const mock = await fixture(page);
  await page.goto("/services");
  const panel = card(page);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("across all workspaces");
  await expect(panel).toContainText("Unsupported history retained");
  await expect(
    panel.getByRole("button", { name: /^View quarantined message/ }),
  ).toHaveCount(50);
  await expect(
    panel.getByRole("columnheader", { name: "Deferred delivery", exact: true }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", {
      name: `View quarantined message ${mock.rows()[0].id}`,
      exact: true,
    })
    .click();
  const detail = drawer(page);
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("Uncertain delivery");
  await expect(detail).toContainText("Owner acknowledgement recorded");
  await expect(detail).toContainText("Recovery status is unavailable here");
  await expect(detail).toContainText(
    "History recovery may continue independently",
  );
  await expect(detail).toContainText(
    "Only the latest 100 delivery attempts are shown",
  );
  await expect(
    detail
      .getByRole("region", { name: "Delivery attempts", exact: true })
      .getByRole("row"),
  ).toHaveCount(101);
  await expect(
    detail.locator('time[datetime="2026-11-07T10:00:00.000Z"]'),
  ).toHaveText(/11:00/);
  await expect(
    detail.getByRole("button", {
      name: /replay|release|acknowledge|delete|retry delivery/i,
    }),
  ).toHaveCount(0);
  expect(mock.reads.every((read) => read.method === "GET")).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("quarantine-desktop.png"),
    fullPage: false,
  });
});

test("cursor paging and filters reset detail and return to the newest messages", async ({
  page,
}) => {
  const mock = await fixture(page);
  await page.goto("/services");
  const panel = card(page);
  await panel
    .getByRole("button", { name: "Older quarantined messages", exact: true })
    .click();
  await expect(panel).toContainText("Page 2");
  await expect(
    panel.getByRole("button", { name: /^View quarantined message/ }),
  ).toHaveCount(1);
  expect(mock.reads.at(-1)?.query.get("cursor")).toBe(nextCursor);
  await panel
    .getByRole("button", {
      name: `View quarantined message ${mock.rows()[50].id}`,
      exact: true,
    })
    .click();
  await expect(drawer(page)).toBeVisible();
  await drawer(page)
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await select(page, "Destination", "External history");
  await expect(panel).toContainText("Page 1");
  await expect(
    panel.getByRole("button", { name: /^View quarantined message/ }),
  ).toHaveCount(2);
  expect(mock.reads.at(-1)?.query.has("cursor")).toBe(false);
  await select(page, "Quarantine status", "Permanent failure");
  await expect(
    panel.getByRole("button", { name: /^View quarantined message/ }),
  ).toHaveCount(1);
  await expect(panel).toContainText("Unsupported history retained");
  expect(mock.reads.at(-1)?.query.get("destination")).toBe("EXTERNAL_HISTORY");
  expect(mock.reads.at(-1)?.query.get("state")).toBe("PERMANENT_FAILURE");
});

test("manual and page refresh clear detail and pagination; list errors hide stale rows", async ({
  page,
}) => {
  const mock = await fixture(page);
  await page.goto("/services");
  const panel = card(page);
  await panel
    .getByRole("button", { name: "Older quarantined messages", exact: true })
    .click();
  await expect(panel).toContainText("Page 2");
  await page
    .locator(".page-heading")
    .getByRole("button", { name: /Refresh$/ })
    .click();
  await expect(panel).toContainText("Page 1");
  await panel
    .getByRole("button", {
      name: `View quarantined message ${mock.rows()[0].id}`,
      exact: true,
    })
    .click();
  await expect(drawer(page)).toBeVisible();
  await drawer(page)
    .getByRole("button", { name: "Close", exact: true })
    .click();
  mock.failList();
  await panel
    .getByRole("button", { name: "Refresh quarantined messages", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Quarantined messages unavailable",
  );
  await expect(
    panel.getByRole("button", { name: /^View quarantined message/ }),
  ).toHaveCount(0);
  mock.failList(false);
  mock.empty();
  await panel
    .getByRole("button", { name: "Retry quarantined messages", exact: true })
    .click();
  await expect(panel).toContainText(
    "No quarantined messages match these filters.",
  );
});

test("a visible-minute refresh closes stale details and returns to the newest page", async ({
  page,
}) => {
  const mock = await fixture(page);
  await page.clock.install({ time: new Date("2026-11-07T12:00:00.000Z") });
  await page.goto("/services");
  const panel = card(page);
  await panel
    .getByRole("button", { name: "Older quarantined messages", exact: true })
    .click();
  await expect(panel).toContainText("Page 2");
  await panel
    .getByRole("button", {
      name: `View quarantined message ${mock.rows()[50].id}`,
      exact: true,
    })
    .click();
  await expect(drawer(page)).toBeVisible();
  const before = mock.reads.length;
  await page.clock.fastForward(60_000);
  await expect(drawer(page)).toHaveCount(0);
  await expect(panel).toContainText("Page 1");
  await expect.poll(() => mock.reads.length).toBeGreaterThan(before);
  expect(mock.reads.at(-1)?.query.has("cursor")).toBe(false);
});

test("detail failures can be retried and earlier recovery versions stay explicit", async ({
  page,
}) => {
  const mock = await fixture(page);
  mock.failDetail();
  await page.goto("/services");
  await card(page)
    .getByRole("button", {
      name: `View quarantined message ${mock.rows()[0].id}`,
      exact: true,
    })
    .click();
  const detail = drawer(page);
  await expect(detail.getByRole("alert")).toContainText(
    "Message details unavailable",
  );
  mock.failDetail(false);
  mock.recovery();
  await detail
    .getByRole("button", {
      name: "Retry quarantined message details",
      exact: true,
    })
    .click();
  await expect(detail).toContainText("Earlier source version");
  await expect(
    detail.getByRole("region", { name: "Deferred delivery", exact: true }),
  ).toContainText("Confirmed");
  await expect(detail).not.toContainText("Recovery status is unavailable here");
});

test("an old detail response cannot reopen the drawer after filters change", async ({
  page,
}) => {
  const mock = await fixture(page);
  const release = mock.holdNextDetail();
  await page.goto("/services");
  await card(page)
    .getByRole("button", {
      name: `View quarantined message ${mock.rows()[0].id}`,
      exact: true,
    })
    .click();
  await expect(drawer(page)).toBeVisible();
  await drawer(page)
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await select(page, "Destination", "Rules");
  release();
  await expect(drawer(page)).toHaveCount(0);
  await expect(
    card(page).getByRole("cell", { name: "External history", exact: true }),
  ).toHaveCount(0);
});

test("a session change clears open message details before another account signs in", async ({
  page,
}) => {
  const mock = await fixture(page);
  await page.goto("/services");
  const oldId = mock.rows()[0].id;
  await card(page)
    .getByRole("button", {
      name: `View quarantined message ${oldId}`,
      exact: true,
    })
    .click();
  await expect(drawer(page)).toBeVisible();
  mock.changeAccount();
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "tronicare-admin-session-revision",
        newValue: "synthetic-account-change",
      }),
    ),
  );
  await expect(drawer(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/login$/);
  await page
    .getByLabel("Login", { exact: true })
    .fill("synthetic-replacement-admin");
  await page.locator('input[type="password"]').fill("synthetic-password");
  await page.getByRole("button", { name: /Sign in$/ }).click();
  await expect(
    card(page).getByRole("button", {
      name: "View quarantined message 9000",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(oldId, { exact: true })).toHaveCount(0);
});

for (const options of [
  { level: 30 },
  { mustChangePassword: true },
  { caregiver: true },
]) {
  test(`quarantine is not fetched for ${JSON.stringify(options)}`, async ({
    page,
  }) => {
    const mock = await fixture(page, options);
    await page.goto("/services");
    await expect(card(page)).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(mock.reads).toEqual([]);
  });
}

test("the inspector fits mobile screens and confines wide tables to their panels", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mock = await fixture(page);
  await page.goto("/services");
  const panel = card(page);
  await expect(panel).toBeVisible();
  await panel.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await panel
    .getByRole("button", {
      name: `View quarantined message ${mock.rows()[0].id}`,
      exact: true,
    })
    .click();
  await expect(drawer(page)).toBeVisible();
  await expect(
    drawer(page).getByText("Payload SHA-256", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => Math.round((await drawer(page).boundingBox())?.x ?? -1))
    .toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("quarantine-mobile.png"),
    fullPage: false,
  });
});
