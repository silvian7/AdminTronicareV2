import { expect, test, type Page } from "@playwright/test";
import type { Identity, RecordData } from "../../shared/resources";
import type { NotificationReadiness } from "../../shared/notification-readiness";

const largeId = "9223372036854775807";
const users: RecordData[] = [largeId, "41", "42", "43"].map((id, index) => ({
  id,
  m_nIDuser: id,
  m_nIDOrganization: "7",
  m_nIDUserType: "20",
  m_sFirst_name: [
    "AliceSynthetic",
    "BobSynthetic",
    "CarolSynthetic",
    "DanaSynthetic",
  ][index],
  m_sLast_name: "Caregiver",
  m_sLogin: `synthetic-${index}`,
}));

function available(
  userId: string,
  registeredDeviceCount: number,
): NotificationReadiness {
  return {
    userId,
    state: "available",
    registeredDeviceCount,
    notificationReadiness:
      registeredDeviceCount === 0
        ? "no_registered_device"
        : registeredDeviceCount > 32
          ? "device_limit_exceeded"
          : "registered",
    lastRegistrationAt: registeredDeviceCount
      ? "2026-10-20T09:00:00+00:00"
      : null,
  };
}

async function synthetic(
  page: Page,
  options: { permitted?: boolean; platform?: boolean } = {},
) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic registration reader",
    organizationId: "7",
    userTypeId: "30",
    level: options.platform ? 90 : 30,
    mustChangePassword: false,
    permissions:
      options.permitted === false ? [] : [{ entity: "users", rights: "r" }],
  };
  const rows = new Map<string, NotificationReadiness>([
    [largeId, available(largeId, 2)],
    ["41", available("41", 0)],
    ["42", { userId: "42", state: "unavailable" }],
    ["43", available("43", 33)],
  ]);
  const batches: string[][] = [];
  let malformed = false;
  let partial: string | undefined = "3";
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-csrf",
        expiresAt: Date.now() + 3_600_000,
      });
    if (url.pathname === "/api/resources/users")
      return reply({ data: users, total: users.length });
    if (url.pathname.startsWith("/api/resources/users/"))
      return reply({
        data: users.find((row) => row.id === url.pathname.split("/").at(-1)),
      });
    if (url.pathname === "/api/users/notification-readiness") {
      const ids = url.searchParams.get("ids")!.split(",");
      batches.push(ids);
      return reply({
        data: malformed
          ? []
          : ids.map(
              (id) => rows.get(id) ?? { userId: id, state: "unavailable" },
            ),
      });
    }
    if (url.pathname === "/api/outboxes")
      return reply({
        data: [
          {
            service: "push",
            state: "available",
            outboxes: [
              { destination: "delivery", size: "0", latencySeconds: "0" },
              { destination: "results", size: "0", latencySeconds: "0" },
            ],
            ...(partial === undefined
              ? {}
              : { partialSuccesses: partial, legacyPartialAcceptances: "1" }),
          },
        ],
      });
    // No request in this suite is allowed to reach a real session or backend.
    return reply({ data: [], total: 0 });
  });
  return {
    batches,
    set: (row: NotificationReadiness) => rows.set(row.userId, row),
    malformed: () => {
      malformed = true;
    },
    removePartial: () => {
      partial = undefined;
    },
  };
}

test("Users list batches visible exact IDs and keeps missing/unavailable/over-limit distinct", async ({
  page,
}) => {
  const fixture = await synthetic(page);
  await page.goto("/users");
  await expect(
    page.getByRole("columnheader", { name: "Push registrations", exact: true }),
  ).toBeVisible();
  const row = (name: string) =>
    page.locator(".ant-table-row").filter({ hasText: name });
  await expect(
    row("AliceSynthetic").getByText("Registered (2)", { exact: true }),
  ).toBeVisible();
  await expect(
    row("BobSynthetic").getByText("No registration", { exact: true }),
  ).toBeVisible();
  await expect(
    row("CarolSynthetic").getByText("Unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    row("DanaSynthetic").getByText("Too many registrations (33)", {
      exact: true,
    }),
  ).toBeVisible();
  expect(fixture.batches).toHaveLength(1);
  expect(new Set(fixture.batches[0])).toEqual(
    new Set(users.map((user) => user.id)),
  );
  await page.screenshot({
    path: "test-results/notification-readiness-list.png",
    fullPage: true,
  });
});

test("user details warn on missing registration and never replace an unavailable response with zero", async ({
  page,
}) => {
  const fixture = await synthetic(page);
  await page.goto("/users/41");
  const card = page.locator(".notification-readiness");
  await expect(
    card.getByText("No active push registration", { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText(
      /Registration does not confirm phone notification permissions/,
    ),
  ).toBeVisible();
  fixture.set({ userId: "41", state: "unavailable" });
  await card
    .getByRole("button", { name: "Refresh push registration status" })
    .click();
  await expect(
    card.getByText("Registration status unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText("No active push registration", { exact: true }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/\/users\/41$/);
  await page.screenshot({
    path: "test-results/notification-readiness-unavailable.png",
    fullPage: true,
  });
});

test("registered details show count/time without claiming delivery and refresh clears stale positive data", async ({
  page,
}) => {
  const fixture = await synthetic(page);
  await page.goto(`/users/${largeId}`);
  const card = page.locator(".notification-readiness");
  await expect(card.getByText("Registered (2)", { exact: true })).toBeVisible();
  await expect(card.locator("time")).toHaveAttribute(
    "datetime",
    "2026-10-20T09:00:00+00:00",
  );
  await expect(card.locator("time")).toHaveText("20/10/2026, 11:00:00");
  await expect(card.locator("time")).toHaveAttribute(
    "title",
    "Europe/Brussels",
  );
  await expect(
    card.getByText(
      /does not confirm phone notification permissions or guarantee delivery/,
    ),
  ).toBeVisible();
  fixture.malformed();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(
    card.getByText("Registration status unavailable", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText("Registered (2)", { exact: true })).toHaveCount(
    0,
  );
});

test("over-limit details remain a warning", async ({ page }) => {
  await synthetic(page);
  await page.goto("/users/43");
  const card = page.locator(".notification-readiness");
  await expect(
    card.getByText("Push registration limit exceeded", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText("Registered (33)", { exact: true })).toHaveCount(
    0,
  );
});

test("readiness polls at 30 seconds and stops polling while hidden", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await synthetic(page);
  await page.goto(`/users/${largeId}`);
  const card = page.locator(".notification-readiness");
  await expect(card.getByText("Registered (2)", { exact: true })).toBeVisible();
  fixture.set(available(largeId, 0));
  await page.clock.fastForward(30_001);
  await expect(
    card.getByText("No active push registration", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const count = fixture.batches.length;
  await page.clock.fastForward(60_000);
  expect(fixture.batches.length).toBe(count);
});

test("users without read permission do not request registration data", async ({
  page,
}) => {
  const fixture = await synthetic(page, { permitted: false });
  await page.goto("/users/41");
  await expect(
    page.getByText("Access unavailable", { exact: true }),
  ).toBeVisible();
  expect(fixture.batches).toHaveLength(0);
});

test("Push partial total includes its historical subset once and missing metrics stay unknown", async ({
  page,
}) => {
  const fixture = await synthetic(page, { platform: true });
  await page.goto("/services");
  const text = page.locator(".push-partial-deliveries");
  await expect(text).toContainText("Partial push deliveries (total): 3");
  await expect(text).toContainText("Includes 1 historical delivery");
  fixture.removePartial();
  await page.getByRole("button", { name: "Refresh service outboxes" }).click();
  await expect(text).toContainText("Unavailable");
  await expect(text).not.toContainText("Includes 1");
});
