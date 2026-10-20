import { expect, test, type Locator, type Page } from "@playwright/test";
import { resources, type Identity } from "../../shared/resources";

const populatedMetrics = [
  { destination: "rules", size: "9223372036854775807", latencySeconds: "7.25" },
  { destination: "assets", size: "5", latencySeconds: "0.5" },
  { destination: "mqtt_information", size: "0", latencySeconds: "0" },
  { destination: "external_history", size: "11", latencySeconds: "90061.75" },
];

async function syntheticOutboxes(page: Page, level = 90) {
  let signedIn = false;
  let unavailable = false;
  let metrics = populatedMetrics;
  let requests = 0;
  let outboxRequests = 0;
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
    if (["/api/core/outboxes", "/api/outboxes"].includes(path))
      outboxRequests++;
    if (path === "/api/core/outboxes") {
      requests++;
      return unavailable
        ? reply({ message: "Core outbox metrics are unavailable." }, 502)
        : reply({ data: metrics });
    }
    return reply({ data: [], total: 0 });
  });
  return {
    fail: () => {
      unavailable = true;
    },
    recoverEmpty: () => {
      unavailable = false;
      metrics = populatedMetrics.map((row) => ({
        ...row,
        size: "0",
        latencySeconds: "0",
      }));
    },
    requests: () => requests,
    outboxRequests: () => outboxRequests,
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
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Your workspace" }),
  ).toBeVisible();
  for (const title of ["Core outboxes", "Service outboxes"])
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  expect(fixture.outboxRequests()).toBe(0);
  if (platform) {
    await page.getByRole("menuitem", { name: /Service status$/ }).click();
    await expect(
      page.getByRole("heading", { name: "Service status", exact: true }),
    ).toBeVisible();
  } else {
    await page.goto("/services");
    await expect(page.getByRole("alert")).toContainText(
      "Service status is available to platform administrators.",
    );
  }
  await expect(page).toHaveURL(/\/services$/);
}

function outboxCard(page: Page) {
  return page.locator(".ant-card").filter({
    has: page.getByText("Core outboxes", { exact: true }),
  });
}

async function expectRow(
  card: Locator,
  name: string,
  size: string,
  latency: string,
) {
  const row = card.getByRole("cell", { name, exact: true }).locator("..");
  await expect(row.getByRole("cell")).toHaveText([name, size, latency]);
}

test("Service status shows global core outbox sizes and oldest-message latencies", async ({
  page,
}) => {
  const fixture = await syntheticOutboxes(page);
  await loginAndOpenServices(page, fixture);
  const card = outboxCard(page);
  await expect(card).toBeVisible();
  await expect(card.getByRole("columnheader")).toHaveText([
    "Outbox",
    "Size (messages)",
    "Latency (hh:mm:ss)",
  ]);
  await expect(card).toContainText(/global/i);
  await expect(card).toContainText(/oldest/i);
  await expectRow(card, "Rules", "9223372036854775807", "00:00:07");
  await expectRow(card, "Assets", "5", "00:00:00");
  await expectRow(card, "MQTT information", "0", "00:00:00");
  await expectRow(card, "External history", "11", "25:01:01");
  expect(fixture.requests()).toBe(1);
});

test("a failed refresh removes stale metrics and retry recovers zero values", async ({
  page,
}) => {
  const fixture = await syntheticOutboxes(page);
  await loginAndOpenServices(page, fixture);
  const card = outboxCard(page);
  await expectRow(card, "Rules", "9223372036854775807", "00:00:07");
  fixture.fail();
  await card
    .getByRole("button", { name: "Refresh core outboxes", exact: true })
    .click();
  await expect(card.getByRole("alert")).toContainText(
    "Core outbox metrics are unavailable.",
  );
  await expect(
    card.getByRole("cell", { name: "Rules", exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("cell", { name: "9223372036854775807", exact: true }),
  ).toHaveCount(0);
  fixture.recoverEmpty();
  await card.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(card.getByRole("alert")).toHaveCount(0);
  for (const name of [
    "Rules",
    "Assets",
    "MQTT information",
    "External history",
  ])
    await expectRow(card, name, "0", "00:00:00");
  expect(fixture.requests()).toBe(3);
});

test("ordinary administrators do not see or fetch core outbox metrics", async ({
  page,
}) => {
  const fixture = await syntheticOutboxes(page, 30);
  await loginAndOpenServices(page, fixture, false);
  await expect(outboxCard(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh core outboxes", exact: true }),
  ).toHaveCount(0);
  expect(fixture.requests()).toBe(0);
  expect(fixture.outboxRequests()).toBe(0);
});
