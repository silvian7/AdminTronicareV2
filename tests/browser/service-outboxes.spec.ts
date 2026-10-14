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

async function syntheticDashboard(page: Page, level = 90) {
  let signedIn = false;
  let unavailable = false;
  let metrics = populatedMetrics();
  let requests = 0;
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
    expiresAt: Date.now() + 60000,
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
    if (path === "/api/outboxes") {
      requests++;
      return unavailable
        ? reply({ message: "Service outbox metrics are unavailable." }, 502)
        : reply({ data: metrics });
    }
    if (path === "/api/core/outboxes")
      return reply({
        data: [
          { destination: "rules", size: "0", latencySeconds: "0" },
          { destination: "assets", size: "0", latencySeconds: "0" },
          { destination: "mqtt_information", size: "0", latencySeconds: "0" },
          { destination: "external_history", size: "0", latencySeconds: "0" },
        ],
      });
    return reply({ data: [], total: 0 });
  });
  return {
    requests: () => requests,
    fail: () => {
      unavailable = true;
    },
    recoverEmpty: () => {
      unavailable = false;
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

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Login", { exact: true }).fill("synthetic-admin");
  await page.locator('input[type="password"]').fill("synthetic-password");
  await page.getByRole("button", { name: /Sign in$/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Your workspace" }),
  ).toBeVisible();
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
        empty ? "0" : String(serviceIndex * 100 + queueIndex),
      ]);
    }
  }
}

test("dashboard shows all seven service outboxes with exact counts and integer latencies", async ({
  page,
}) => {
  const fixture = await syntheticDashboard(page);
  await login(page);
  const card = outboxCard(page);
  await expect(card).toBeVisible();
  await expect(card.getByRole("columnheader")).toHaveText([
    "Service",
    "Outbox",
    "Status",
    "Queue size",
    "Latency (s)",
  ]);
  await expectMetrics(page);
  await expect(page.getByText("Core outboxes", { exact: true })).toBeVisible();
  expect(fixture.requests()).toBe(1);
});

test("partial outages retain healthy services and distinguish unavailable from unconfigured", async ({
  page,
}) => {
  const fixture = await syntheticDashboard(page);
  fixture.partialFailure();
  await login(page);
  await expect(serviceRow(page, "sms")).toContainText("Unavailable");
  await expect(serviceRow(page, "email")).toContainText("Not configured");
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
  ).toHaveText(["MQTT bridge", "Core mirror", "Available", "62", "602"]);
});

test("a failed aggregate refresh removes stale counts and retry restores empty queues", async ({
  page,
}) => {
  const fixture = await syntheticDashboard(page);
  await login(page);
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

test("service metrics poll again after thirty seconds", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-14T10:00:00Z") });
  const fixture = await syntheticDashboard(page);
  await login(page);
  await expectMetrics(page);
  const initialRequests = fixture.requests();
  fixture.recoverEmpty();
  await page.clock.fastForward(30_001);
  await expect.poll(() => fixture.requests()).toBeGreaterThan(initialRequests);
  await expectMetrics(page, true);
});

test("ordinary administrators neither see nor fetch service outbox metrics", async ({
  page,
}) => {
  const fixture = await syntheticDashboard(page, 30);
  await login(page);
  await expect(outboxCard(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh service outboxes", exact: true }),
  ).toHaveCount(0);
  expect(fixture.requests()).toBe(0);
});
