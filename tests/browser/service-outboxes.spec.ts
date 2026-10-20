import { expect, test, type Page } from "@playwright/test";
import {
  resources,
  serviceLabels,
  type Identity,
  type Service,
} from "../../shared/resources";

const destinations = {
  rules: [["rules_forward", "Rule forwarding"]],
  actions: [["actions_forward", "Action forwarding"]],
  push: [
    ["delivery", "Delivery"],
    ["results", "Results"],
  ],
  email: [
    ["delivery", "Delivery"],
    ["results", "Results"],
  ],
  sms: [
    ["delivery", "Delivery"],
    ["results", "Results"],
  ],
  mqtt: [
    ["delivery", "Delivery"],
    ["results", "Results"],
    ["sensor_information", "Sensor information"],
  ],
  mqttbridge: [
    ["mqtt", "MQTT"],
    ["core_primary", "Core primary"],
    ["core_mirror", "Core mirror"],
  ],
} as const;
type OutboxService = keyof typeof destinations;
const expectedLatencies: Record<OutboxService, readonly string[]> = {
  rules: ["00:00:00"],
  actions: ["00:01:40"],
  push: ["00:03:20", "00:03:21"],
  email: ["00:05:00", "00:05:01"],
  sms: ["00:06:40", "00:06:41"],
  mqtt: ["00:08:20", "00:08:21", "00:08:22"],
  mqttbridge: ["00:10:00", "00:10:01", "00:10:02"],
};
interface ServiceMetrics {
  service: OutboxService;
  state: "available" | "unavailable" | "unconfigured";
  outboxes: { destination: string; size: string; latencySeconds: string }[];
  message?: string;
}

function populatedMetrics(): ServiceMetrics[] {
  return (Object.keys(destinations) as OutboxService[]).map(
    (service, serviceIndex) => ({
      service,
      state: "available",
      outboxes: destinations[service].map(([destination], index) => ({
        destination,
        size:
          serviceIndex === 0
            ? "9223372036854775807"
            : String(serviceIndex * 10 + index),
        latencySeconds: String(serviceIndex * 100 + index),
      })),
    }),
  );
}

async function syntheticOutboxes(page: Page, level = 90) {
  let signedIn = false;
  let unavailable = false;
  let metrics = populatedMetrics();
  let requests = 0;
  let outboxRequests = 0;
  let coreRequests = 0;
  let statusRequests = 0;
  let coreSize = "1";
  let statusVersion = "synthetic-services-initial";
  let heartbeatAge: string | undefined;
  let coreAssetsLatency = "0";
  const identity: Identity = {
    id: "100",
    name: "Synthetic Administrator",
    organizationId: "7",
    userTypeId: String(level),
    level,
    mustChangePassword: false,
    permissions: resources.map((resource) => ({
      entity: resource.name,
      rights: "crud",
    })),
  };
  const session = () => ({
    identity,
    csrf: "synthetic-csrf",
    expiresAt: Date.now() + 60 * 60_000,
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/session/login") {
      signedIn = true;
      return reply(session());
    }
    if (!signedIn) return reply({ message: "Sign in to continue." }, 401);
    if (path === "/api/session") return reply(session());
    if (path === "/api/services") {
      statusRequests++;
      return reply({
        data: [
          {
            service: "core",
            state: "available",
            version: statusVersion,
            lastHeartbeat: heartbeatAge,
          },
        ],
      });
    }
    if (["/api/core/outboxes", "/api/outboxes"].includes(path))
      outboxRequests++;
    if (path === "/api/outboxes") {
      requests++;
      return unavailable
        ? reply({ message: "Service outbox metrics are unavailable." }, 502)
        : reply({ data: metrics });
    }
    if (path === "/api/core/outboxes") {
      coreRequests++;
      return reply({
        data: [
          { destination: "rules", size: coreSize, latencySeconds: "0" },
          {
            destination: "assets",
            size: "0",
            latencySeconds: coreAssetsLatency,
          },
          { destination: "mqtt_information", size: "0", latencySeconds: "0" },
          { destination: "external_history", size: "0", latencySeconds: "0" },
        ],
      });
    }
    return reply({ data: [], total: 0 });
  });
  return {
    requests: () => requests,
    outboxRequests: () => outboxRequests,
    queryRequests: () => ({
      status: statusRequests,
      core: coreRequests,
      services: requests,
    }),
    setDelays: (
      heartbeat: string,
      coreAssets: string,
      serviceMirror: string,
    ) => {
      heartbeatAge = heartbeat;
      coreAssetsLatency = coreAssets;
      metrics = populatedMetrics().map((service) => ({
        ...service,
        outboxes: service.outboxes.map((queue) => ({
          ...queue,
          latencySeconds:
            service.service === "mqttbridge" &&
            queue.destination === "core_mirror"
              ? serviceMirror
              : "0",
        })),
      }));
    },
    fail: () => {
      unavailable = true;
    },
    recoverEmpty: (version = "synthetic-services-refreshed") => {
      unavailable = false;
      coreSize = "0";
      statusVersion = version;
      metrics = populatedMetrics().map((service) => ({
        ...service,
        outboxes: service.outboxes.map((queue) => ({
          ...queue,
          size: "0",
          latencySeconds: "0",
        })),
      }));
    },
    partialFailure: () => {
      metrics = populatedMetrics().map((service) =>
        service.service === "sms"
          ? {
              ...service,
              state: "unavailable",
              outboxes: [],
              message: "Synthetic SMS dependency is unavailable.",
            }
          : service.service === "email"
            ? {
                ...service,
                state: "unconfigured",
                outboxes: [],
                message: "Synthetic email service is not configured.",
              }
            : service,
      );
    },
  };
}

async function loginAndOpenServices(
  page: Page,
  fixture: { outboxRequests(): number },
  platform = true,
) {
  await page.goto("/login");
  await page.getByLabel("Login", { exact: true }).fill("synthetic-admin");
  await page.locator('input[type="password"]').fill("synthetic-password");
  await page.getByRole("button", { name: /Sign in$/ }).click();
  if (platform) {
    await expect(page).toHaveURL(/\/services$/);
    await expect(
      page.getByRole("heading", { name: "Service status", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("menuitem").first()).toHaveText(
      "Service status",
    );
  } else {
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "Your workspace" }),
    ).toBeVisible();
    for (const title of ["Core outboxes", "Service outboxes"])
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    expect(fixture.outboxRequests()).toBe(0);
    await page.goto("/services");
    await expect(page.getByRole("alert")).toContainText(
      "Service status is available to platform administrators.",
    );
  }
  await expect(page).toHaveURL(/\/services$/);
}

function outboxCard(page: Page) {
  return page
    .locator(".ant-card")
    .filter({ has: page.getByText("Service outboxes", { exact: true }) });
}

function serviceRow(page: Page, service: Service, destination?: string) {
  let row = outboxCard(page)
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", {
        name: serviceLabels[service],
        exact: true,
      }),
    });
  if (destination)
    row = row.filter({
      has: page.getByRole("cell", { name: destination, exact: true }),
    });
  return row;
}

async function expectMetrics(page: Page, empty = false) {
  for (const [serviceIndex, service] of (
    Object.keys(destinations) as OutboxService[]
  ).entries()) {
    for (const [queueIndex, [, label]] of destinations[service].entries()) {
      await expect(
        serviceRow(page, service, label).getByRole("cell"),
      ).toHaveText([
        serviceLabels[service],
        label,
        "Available",
        empty
          ? "0"
          : serviceIndex === 0
            ? "9223372036854775807"
            : String(serviceIndex * 10 + queueIndex),
        empty ? "00:00:00" : expectedLatencies[service][queueIndex],
      ]);
    }
  }
}

test("Service status shows all seven service outboxes with exact counts and hh:mm:ss latencies", async ({
  page,
}) => {
  const fixture = await syntheticOutboxes(page);
  await loginAndOpenServices(page, fixture);
  const card = outboxCard(page);
  await expect(card).toBeVisible();
  await expect(card.getByRole("columnheader")).toHaveText([
    "Service",
    "Outbox",
    "Status",
    "Queue size",
    "Latency (hh:mm:ss)",
  ]);
  await expectMetrics(page);
  await expect(page.getByText("Core outboxes", { exact: true })).toBeVisible();
  expect(fixture.requests()).toBe(1);
});

test("partial outages retain healthy services and distinguish unavailable from unconfigured", async ({
  page,
}) => {
  const fixture = await syntheticOutboxes(page);
  fixture.partialFailure();
  await loginAndOpenServices(page, fixture);
  await expect(serviceRow(page, "sms")).toContainText("Unavailable");
  await expect(serviceRow(page, "email")).toContainText("Not configured");
  for (const service of ["sms", "email"] as const)
    await expect(serviceRow(page, service).getByRole("cell").nth(4)).toHaveText(
      "\u2014",
    );
  await expect(
    serviceRow(page, "sms").getByRole("cell", {
      name: "Delivery",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    serviceRow(page, "email").getByRole("cell", {
      name: "Delivery",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(serviceRow(page, "rules", "Rule forwarding")).toContainText(
    "9223372036854775807",
  );
  await expect(
    serviceRow(page, "mqttbridge", "Core mirror").getByRole("cell"),
  ).toHaveText(["MQTT bridge", "Core mirror", "Available", "62", "00:10:02"]);
});

test("Service status warns strictly above ten minutes for heartbeat and both outbox sources, then clears on refresh", async ({
  page,
}, testInfo) => {
  const fixture = await syntheticOutboxes(page);
  fixture.setDelays("600", "600", "600");
  await loginAndOpenServices(page, fixture);
  const warning = page.locator(".service-status-warning");
  const coreAssets = page
    .locator(".core-outboxes")
    .getByRole("cell", { name: "Assets", exact: true })
    .locator("..");
  const mirror = serviceRow(page, "mqttbridge", "Core mirror");
  const refresh = page
    .locator(".page-heading")
    .getByRole("button", { name: /Refresh$/ });
  await expect(
    page.getByRole("cell", { name: "synthetic-services-initial", exact: true }),
  ).toBeVisible();
  await expect(coreAssets.getByRole("cell").last()).toHaveText("00:10:00");
  await expect(mirror.getByRole("cell").last()).toHaveText("00:10:00");
  await expect(warning).toHaveCount(0);

  for (const [heartbeat, core, service, message] of [
    ["600.1", "600", "600", "Equipment heartbeat: 00:10:00"],
    ["600", "600.1", "600", "Core — Assets latency: 00:10:00"],
    ["600", "600", "601", "MQTT bridge — Core mirror latency: 00:10:01"],
  ]) {
    fixture.setDelays(heartbeat!, core!, service!);
    await refresh.click();
    await expect(warning).toHaveClass(/ant-alert-warning/);
    await expect(
      warning.getByText("Service delays exceed 10 minutes", { exact: true }),
    ).toBeVisible();
    await expect(warning.locator("li")).toHaveText([message!]);
  }
  await page.screenshot({
    path: testInfo.outputPath("service-delay-warning.png"),
    fullPage: true,
    animations: "disabled",
  });
  fixture.setDelays("600", "600", "600");
  await refresh.click();
  await expect(mirror.getByRole("cell").last()).toHaveText("00:10:00");
  await expect(warning).toHaveCount(0);
});

test("a failed aggregate refresh removes stale counts and retry restores empty queues", async ({
  page,
}) => {
  const fixture = await syntheticOutboxes(page);
  await loginAndOpenServices(page, fixture);
  const card = outboxCard(page);
  await expectMetrics(page);
  fixture.fail();
  await card
    .getByRole("button", { name: "Refresh service outboxes", exact: true })
    .click();
  await expect(card.getByRole("alert")).toContainText(
    "Service outbox metrics are unavailable.",
  );
  await expect(
    card.getByRole("cell", { name: "9223372036854775807", exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("cell", { name: "Rule forwarding", exact: true }),
  ).toHaveCount(0);
  fixture.recoverEmpty();
  await card.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(card.getByRole("alert")).toHaveCount(0);
  await expectMetrics(page, true);
  expect(fixture.requests()).toBe(3);
});

test("Service status polls all metrics each minute, pauses in the background and refreshes on return", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-14T10:00:00Z") });
  const fixture = await syntheticOutboxes(page);
  await loginAndOpenServices(page, fixture);

  // Reload at a frozen instant so all three query timers share an exact boundary.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10));
  await page.reload();
  async function settledMetrics(version: string, empty: boolean) {
    await expect
      .poll(async () => {
        await page.clock.runFor(0);
        return {
          version: await page
            .getByRole("cell", { name: version, exact: true })
            .isVisible(),
          core: await page
            .locator(".core-outboxes")
            .getByRole("cell", { name: "Rules", exact: true })
            .locator("..")
            .getByRole("cell")
            .allTextContents(),
          services: await serviceRow(page, "rules", "Rule forwarding")
            .getByRole("cell")
            .allTextContents(),
        };
      })
      .toEqual({
        version: true,
        core: ["Rules", empty ? "0" : "1", "00:00:00"],
        services: [
          "Rules",
          "Rule forwarding",
          "Available",
          empty ? "0" : "9223372036854775807",
          "00:00:00",
        ],
      });
    await expectMetrics(page, empty);
  }
  async function visibility(state: "hidden" | "visible") {
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
      window.dispatchEvent(new Event(state === "hidden" ? "blur" : "focus"));
    }, state);
  }
  try {
    await settledMetrics("synthetic-services-initial", false);
    const initialRequests = fixture.queryRequests();
    const next = (counts: typeof initialRequests) => ({
      status: counts.status + 1,
      core: counts.core + 1,
      services: counts.services + 1,
    });
    fixture.recoverEmpty();
    await page.clock.runFor(59_999);
    expect(fixture.queryRequests()).toEqual(initialRequests);
    await page.clock.runFor(1);
    await settledMetrics("synthetic-services-refreshed", true);
    expect(fixture.queryRequests()).toEqual(next(initialRequests));

    await visibility("hidden");
    const beforeHidden = fixture.queryRequests();
    fixture.recoverEmpty("synthetic-services-after-return");
    await page.clock.runFor(120_000);
    expect(fixture.queryRequests()).toEqual(beforeHidden);
    await visibility("visible");
    await settledMetrics("synthetic-services-after-return", true);
    expect(fixture.queryRequests()).toEqual(next(beforeHidden));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.clock.runFor(0);
    expect(fixture.queryRequests()).toEqual(next(beforeHidden));

    await page.clock.resume();
    await page.getByRole("menuitem", { name: /Overview$/ }).click();
    await expect(
      page.getByRole("heading", { name: "Your workspace" }),
    ).toBeVisible();
    const overviewRequests = fixture.queryRequests();
    for (const title of ["Core outboxes", "Service outboxes"])
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10));
    await page.clock.runFor(60_000);
    expect(fixture.queryRequests()).toEqual(overviewRequests);
  } finally {
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "visibilityState");
      Reflect.deleteProperty(document, "hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
  }
});

test("ordinary administrators neither see nor fetch service outbox metrics", async ({
  page,
}) => {
  const fixture = await syntheticOutboxes(page, 30);
  await loginAndOpenServices(page, fixture, false);
  await expect(outboxCard(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh service outboxes", exact: true }),
  ).toHaveCount(0);
  expect(fixture.requests()).toBe(0);
  expect(fixture.outboxRequests()).toBe(0);
  expect(fixture.queryRequests()).toEqual({ status: 0, core: 0, services: 0 });
});
