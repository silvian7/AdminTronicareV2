import { expect, test } from "@playwright/test";
import type { Identity } from "../../shared/resources";

test("sensor history filters send the documented changes and all values", async ({
  page,
}) => {
  const identity: Identity = {
    id: "100",
    name: "Synthetic history reader",
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      { entity: "sensors", rights: "r" },
      { entity: "sensorshistory", rights: "r" },
    ],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-history-csrf",
        expiresAt: Date.now() + 60000,
      });
    if (path === "/api/resources/sensors")
      return reply({
        data: [{ id: "1", m_nIDSensor: "1", m_sLabel: "Synthetic sensor" }],
        total: 1,
      });
    if (path === "/api/history")
      return reply({
        data: [],
        snapshot: null,
        highWaterId: null,
        hasMore: false,
      });
    return reply({ data: [], total: 0 });
  });

  await page.goto("/sensor-history?idsensor=1");
  const changes = page.getByRole("radio", { name: "Changes", exact: true });
  const all = page.getByRole("radio", { name: "All", exact: true });
  const load = page.getByRole("button", { name: /Load history$/ });

  async function expectHistoryFilter(value: string) {
    const pending = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/history",
    );
    await load.click();
    const response = await pending;
    await response.finished();
    const query = new URL(response.url()).searchParams;
    expect(query.get("idsensor")).toBe("1");
    expect(query.get("filter")).toBe(value);
    await expect(load).toBeEnabled();
  }

  // The documented default is 1: all recorded readings.
  await expect(all).toBeChecked();
  await expectHistoryFilter("1");
  await changes.check();
  await expectHistoryFilter("0");
  await all.check();
  await expectHistoryFilter("1");
});
