import { expect, test, type Page } from "@playwright/test";
import type {
  IncomingQuarantineSource,
  IncomingQuarantinedMessage,
  IncomingQuarantinedMessageDetail,
  IncomingQuarantinedMessagesResponse,
} from "../../shared/incoming-quarantined-messages";
import { resources, type Identity } from "../../shared/resources";

const endpoint = "/api/quarantine/incoming";
const observedAt = "2026-11-07T12:00:00.000Z";
const pageCursor = "c3ludGhldGljX3BhZ2VfMg";
const scanCursor = "c3ludGhldGljX3NjYW5fMg";
const names: Record<IncomingQuarantineSource, string> = {
  CORE_TELEMETRY: "Core telemetry",
  MQTT_INGRESS: "MQTT ingress",
  BRIDGE_CORE_DELIVERY: "Bridge Core delivery batches",
  BRIDGE_CORE_DELIVERY_ITEM: "Bridge Core delivery items",
};

function rows(source: IncomingQuarantineSource): IncomingQuarantinedMessage[] {
  return Array.from(
    { length: source === "CORE_TELEMETRY" ? 51 : 1 },
    (_, index) => {
      const state =
        source === "CORE_TELEMETRY"
          ? (["REJECTED", "BLOCKED", "PERMANENT_FAILURE"] as const)[index % 3]
          : "PERMANENT_FAILURE";
      return {
        id: (9223372036854775700n - BigInt(index)).toString(),
        source,
        state,
        createdAt: "2026-11-07T07:00:00.000Z",
        quarantinedAt: "2026-11-07T10:00:00.000Z",
        updatedAt: "2026-11-07T11:00:00.000Z",
        attemptCount: index === 0 ? 101 : 1,
        outcomeCode:
          source === "CORE_TELEMETRY"
            ? state === "REJECTED"
              ? "UNKNOWN_HUB"
              : "SYNTHETIC_CORE_OUTCOME"
            : "SYNTHETIC_BRIDGE_OUTCOME",
        errorCode: source === "MQTT_INGRESS" ? "SYNTHETIC_PARSER_ERROR" : null,
        parentId: source === "BRIDGE_CORE_DELIVERY_ITEM" ? "100" : null,
        disposition: null,
        itemCount: source === "BRIDGE_CORE_DELIVERY" ? 2 : null,
        parserFamily: source === "CORE_TELEMETRY" ? null : "SYNTHETIC_PARSER",
        route:
          source === "BRIDGE_CORE_DELIVERY"
            ? "PRIMARY_AND_MIRROR"
            : source === "BRIDGE_CORE_DELIVERY_ITEM"
              ? "PRIMARY"
              : null,
      };
    },
  );
}

function details(
  message: IncomingQuarantinedMessage,
): IncomingQuarantinedMessageDetail {
  return {
    source: message.source,
    message: { ...message, version: 1 },
    attempts: Array.from(
      { length: Math.min(message.attemptCount, 100) },
      (_, index) => {
        const startedAt = new Date(
          Date.parse("2026-11-07T08:00:00.000Z") - index * 2_000,
        ).toISOString();
        return {
          attemptNumber: message.attemptCount - index,
          startedAt,
          completedAt: new Date(Date.parse(startedAt) + 1000).toISOString(),
          outcome:
            message.source === "CORE_TELEMETRY"
              ? "REJECTED"
              : "PERMANENT_FAILURE",
          outcomeCode: message.outcomeCode,
          errorCode: message.errorCode,
          protocolStatus:
            message.source === "BRIDGE_CORE_DELIVERY" ||
            message.source === "BRIDGE_CORE_DELIVERY_ITEM"
              ? 503
              : null,
          durationMs: 1000,
          component:
            message.source === "CORE_TELEMETRY"
              ? "CORE_PROCESSING"
              : message.source === "MQTT_INGRESS"
                ? "PARSER"
                : "CORE_PRIMARY",
        };
      },
    ),
    attemptLimit: 100,
    attemptsHasMore: message.attemptCount > 100,
    observedAt,
    payloadAvailable: false,
  };
}

async function fixture(
  page: Page,
  options: {
    level?: number;
    caregiver?: boolean;
    mustChangePassword?: boolean;
    shadow?: boolean;
  } = {},
) {
  const level = options.level ?? 90;
  const identity: Identity = {
    id: "100",
    name: "Synthetic incoming administrator",
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
  const reads: { method: string; path: string; query: URLSearchParams }[] = [];
  let failList = false,
    failDetail = false,
    scanEmptyFirst = false,
    empty = false;
  let nextDetailHold: Promise<void> | undefined;
  const sourceRows = (source: IncomingQuarantineSource) =>
    rows(source).map((row) =>
      options.shadow && source === "MQTT_INGRESS"
        ? { ...row, disposition: "SHADOW" as const }
        : row,
    );
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    const reply = async (body: unknown, status = 200) => {
      await route
        .fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        })
        .catch(() => {});
    };
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-incoming-csrf",
        expiresAt: Date.parse(observedAt) + 3_600_000,
        activeOrganizationId: null,
      });
    if (path === endpoint || path.startsWith(`${endpoint}/`)) {
      reads.push({ method: request.method(), path, query: url.searchParams });
      const source = url.searchParams.get("source") as IncomingQuarantineSource;
      if (!Object.hasOwn(names, source))
        return reply({ message: "Choose a source." }, 400);
      if (path === endpoint) {
        if (failList)
          return reply(
            { message: "Synthetic incoming service unavailable." },
            503,
          );
        const matching = empty
          ? []
          : sourceRows(source).filter(
              (row) =>
                !url.searchParams.has("state") ||
                row.state === url.searchParams.get("state"),
            );
        const limited = scanEmptyFirst && !url.searchParams.has("cursor");
        const offset = url.searchParams.get("cursor") === pageCursor ? 50 : 0;
        const response: IncomingQuarantinedMessagesResponse = {
          source,
          data: limited ? [] : matching.slice(offset, offset + 50),
          limit: 50,
          hasMore: limited || matching.length > offset + 50,
          nextCursor: limited
            ? scanCursor
            : matching.length > offset + 50
              ? pageCursor
              : null,
          observedAt,
          payloadAvailable: false,
          scanLimit: 100000,
          scannedRowCount: limited ? 100000 : Math.min(matching.length, 50),
          scanLimited: limited,
        };
        return reply(response);
      }
      const message = sourceRows(source).find(
        (row) => row.id === path.slice(endpoint.length + 1),
      );
      const response = message ? details(message) : null;
      const hold = nextDetailHold;
      nextDetailHold = undefined;
      if (hold) await hold;
      return failDetail
        ? reply({ message: "Synthetic incoming details unavailable." }, 503)
        : response
          ? reply(response)
          : reply({ message: "Unavailable message." }, 404);
    }
    if (path === "/api/core/quarantined-messages")
      return reply({
        data: [],
        limit: 50,
        hasMore: false,
        nextCursor: null,
        observedAt,
        recoveryDetailsAvailable: false,
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
    failList(value = true) {
      failList = value;
    },
    failDetail(value = true) {
      failDetail = value;
    },
    boundedEmpty() {
      scanEmptyFirst = true;
    },
    empty() {
      empty = true;
      scanEmptyFirst = false;
    },
    holdNextDetail() {
      let release!: () => void;
      nextDetailHold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

const card = (page: Page) =>
  page.getByRole("region", {
    name: "Incoming quarantined messages",
    exact: true,
  });
const drawer = (page: Page) =>
  page.getByRole("dialog", {
    name: "Incoming quarantined message",
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

test("incoming inspection shows Core outcomes and bounded processing attempts without claiming payload visibility", async ({
  page,
}, testInfo) => {
  const mock = await fixture(page);
  await page.goto("/services");
  const panel = card(page);
  await expect(panel).toContainText("Newest record IDs first");
  await expect(
    panel.getByRole("button", { name: /^View incoming quarantined message/ }),
  ).toHaveCount(50);
  await expect(panel).toContainText("UNKNOWN_HUB");
  await panel
    .getByRole("button", {
      name: `View incoming quarantined message ${rows("CORE_TELEMETRY")[0].id}`,
      exact: true,
    })
    .click();
  const detail = drawer(page);
  await expect(detail).toContainText("Core telemetry");
  await expect(detail).toContainText(
    "Message contents are unavailable in this view.",
  );
  await expect(detail).toContainText(
    "Only the latest 100 processing attempts are shown",
  );
  await expect(
    detail
      .getByRole("region", { name: "Processing attempts", exact: true })
      .getByRole("row"),
  ).toHaveCount(101);
  expect(
    mock.reads.every(
      (read) =>
        read.method === "GET" && read.query.get("source") === "CORE_TELEMETRY",
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("incoming-quarantine-desktop.png"),
    fullPage: false,
  });
});

test("source selection covers MQTT parsing, Core delivery batches and legacy delivery items", async ({
  page,
}) => {
  const mock = await fixture(page, { shadow: true });
  await page.goto("/services");
  await select(page, "Incoming quarantine status", "Rejected");
  for (const source of [
    "MQTT_INGRESS",
    "BRIDGE_CORE_DELIVERY",
    "BRIDGE_CORE_DELIVERY_ITEM",
  ] as const) {
    await select(page, "Incoming source", names[source]);
    await expect(
      card(page).getByRole("button", {
        name: /^View incoming quarantined message/,
      }),
    ).toHaveCount(1);
    const read = mock.reads.at(-1)!;
    expect(read.query.get("source")).toBe(source);
    expect(read.query.has("state")).toBe(false);
    expect(read.query.has("cursor")).toBe(false);
    await card(page)
      .getByRole("button", { name: /^View incoming quarantined message/ })
      .click();
    await expect(drawer(page)).toContainText(names[source]);
    if (source === "BRIDGE_CORE_DELIVERY_ITEM")
      await expect(drawer(page)).toContainText("100");
    if (source === "MQTT_INGRESS") {
      await expect(drawer(page)).toContainText("SYNTHETIC_PARSER_ERROR");
      await expect(drawer(page)).toContainText("Shadow");
    }
    await drawer(page)
      .getByRole("button", { name: "Close", exact: true })
      .click();
  }
});

test("an empty bounded scan retains an enabled continuation and does not claim an empty quarantine", async ({
  page,
}) => {
  const mock = await fixture(page);
  mock.boundedEmpty();
  await page.goto("/services");
  const panel = card(page);
  await expect(panel).toContainText(
    "Checked a bounded range of retained records. Load older to continue.",
  );
  await expect(panel).toContainText(
    "No quarantined messages in this checked range.",
  );
  await expect(
    panel.getByRole("button", {
      name: "Older incoming quarantined messages",
      exact: true,
    }),
  ).toBeEnabled();
  await panel
    .getByRole("button", {
      name: "Older incoming quarantined messages",
      exact: true,
    })
    .click();
  await expect(panel).toContainText("Page 2");
  await expect(
    panel.getByRole("button", { name: /^View incoming quarantined message/ }),
  ).toHaveCount(50);
  expect(mock.reads.at(-1)?.query.get("cursor")).toBe(scanCursor);
});

test("incoming list and detail errors hide stale results and support read-only retry", async ({
  page,
}) => {
  const mock = await fixture(page);
  mock.failDetail();
  await page.goto("/services");
  await card(page)
    .getByRole("button", { name: /^View incoming quarantined message/ })
    .first()
    .click();
  await expect(drawer(page).getByRole("alert")).toContainText(
    "Incoming message details unavailable",
  );
  mock.failDetail(false);
  await drawer(page)
    .getByRole("button", {
      name: "Retry incoming quarantined message details",
      exact: true,
    })
    .click();
  await expect(drawer(page)).toContainText("Core telemetry");
  await drawer(page)
    .getByRole("button", { name: "Close", exact: true })
    .click();
  mock.failList();
  await card(page)
    .getByRole("button", {
      name: "Refresh incoming quarantined messages",
      exact: true,
    })
    .click();
  await expect(card(page).getByRole("alert")).toContainText(
    "Incoming quarantined messages unavailable",
  );
  await expect(
    card(page).getByRole("button", {
      name: /^View incoming quarantined message/,
    }),
  ).toHaveCount(0);
  mock.failList(false);
  mock.empty();
  await card(page)
    .getByRole("button", {
      name: "Retry incoming quarantined messages",
      exact: true,
    })
    .click();
  await expect(card(page)).toContainText("No quarantined messages found.");
});

test("late details from another source cannot replace the selected source's same message ID", async ({
  page,
}) => {
  const mock = await fixture(page);
  const release = mock.holdNextDetail();
  await page.goto("/services");
  await card(page)
    .getByRole("button", { name: /^View incoming quarantined message/ })
    .first()
    .click();
  await expect(drawer(page)).toBeVisible();
  await drawer(page)
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await select(page, "Incoming source", "MQTT ingress");
  await card(page)
    .getByRole("button", { name: /^View incoming quarantined message/ })
    .click();
  await expect(drawer(page)).toContainText("MQTT ingress");
  release();
  await expect(drawer(page)).toContainText("SYNTHETIC_PARSER_ERROR");
  await expect(drawer(page)).not.toContainText("Core processing");
});

for (const options of [
  { level: 30 },
  { mustChangePassword: true },
  { caregiver: true },
]) {
  test(`incoming quarantine is not fetched for ${JSON.stringify(options)}`, async ({
    page,
  }) => {
    const mock = await fixture(page, options);
    await page.goto("/services");
    await expect(card(page)).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(mock.reads).toEqual([]);
  });
}

test("incoming inspection fits mobile screens with contained table scrolling", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto("/services");
  await card(page).scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await card(page)
    .getByRole("button", { name: /^View incoming quarantined message/ })
    .first()
    .click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page)).toContainText("UNKNOWN_HUB");
  await expect
    .poll(async () => Math.round((await drawer(page).boundingBox())?.x ?? -1))
    .toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("incoming-quarantine-mobile.png"),
    fullPage: false,
  });
});
