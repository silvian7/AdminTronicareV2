import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Identity, RecordData } from "../../shared/resources";

test.use({ locale: "en-GB", timezoneId: "Europe/Brussels" });

const created = "2026-01-15T12:45:56.000";

function asset(id: string, name: string, timestamp: unknown): RecordData {
  return {
    id,
    m_nIDAsset: id,
    m_nIDOrganization: "7",
    m_sLabel: `Synthetic ${name} asset`,
    m_dhDhLastEvent: timestamp,
    m_dhDhCreated: created,
  };
}

async function syntheticAssets(page: Page, rows: RecordData[]) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic asset reader",
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [{ entity: "assets", rights: "r" }],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-asset-event-csrf",
        expiresAt: Date.now() + 60000,
      });
    if (path === "/api/resources/assets")
      return reply({ data: rows, total: rows.length });
    if (path.startsWith("/api/resources/assets/")) {
      const record = rows.find(
        (row) => path === `/api/resources/assets/${row.id}`,
      );
      return record
        ? reply({ data: record })
        : reply({ message: "Synthetic asset unavailable." }, 404);
    }
    // Every API request, including unrelated asset detail tabs, stays synthetic.
    return reply({ data: [], total: 0 });
  });
}

async function listEvent(page: Page, label: string) {
  const column = await page
    .getByRole("columnheader", { name: "Last event", exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
  return page
    .getByRole("link", { name: label, exact: true })
    .locator("xpath=ancestor::tr")
    .getByRole("cell")
    .nth(column);
}

function detailField(page: Page, label: string) {
  return page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::*[1]");
}

async function expectLocalEvent(
  page: Page,
  cell: Locator,
  iso: string,
  hour: number,
) {
  const local = await page.evaluate((instant) => {
    const date = new Date(instant);
    return {
      text: date.toLocaleString(undefined, { hourCycle: "h23" }),
      hour: date.getHours(),
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }, iso);
  expect(local.hour).toBe(hour);
  expect(local.zone).toBe("Europe/Brussels");
  await expect(cell).toHaveText(local.text);
  await expect(cell.locator("time")).toHaveAttribute("datetime", iso);
  await expect(cell.locator("time")).toHaveAttribute("title", local.zone);
}

test("asset last events use the event date's local winter or summer time across list, detail and overview", async ({
  page,
}) => {
  const cases = [
    {
      id: "41",
      name: "winter naive",
      value: "2026-01-15T12:00:00.000",
      iso: "2026-01-15T12:00:00.000Z",
      hour: 13,
    },
    {
      id: "42",
      name: "summer compact",
      value: "20260715120000",
      iso: "2026-07-15T12:00:00.000Z",
      hour: 14,
    },
    {
      id: "43",
      name: "summer offset",
      value: "2026-07-15T14:00:00+02:00",
      iso: "2026-07-15T12:00:00.000Z",
      hour: 14,
    },
    {
      id: "44",
      name: "winter compact milliseconds",
      value: "20260115120000123",
      iso: "2026-01-15T12:00:00.123Z",
      hour: 13,
    },
  ];
  const rows = cases.map(({ id, name, value }) => asset(id, name, value));
  await syntheticAssets(page, rows);
  await page.goto("/assets");
  for (const [index, { iso, hour }] of cases.entries())
    await expectLocalEvent(
      page,
      await listEvent(page, String(rows[index].m_sLabel)),
      iso,
      hour,
    );
  for (const [index, { id, iso, hour }] of cases.entries()) {
    await page.goto(`/assets/${id}`);
    await expect(
      page.getByRole("heading", {
        name: String(rows[index].m_sLabel),
        exact: true,
      }),
    ).toBeVisible();
    await expectLocalEvent(page, detailField(page, "Last event"), iso, hour);
    if (id === "41") {
      await expect(detailField(page, "Created")).toHaveText(
        "2026-01-15 12:45:56.000",
      );
      await expect(
        detailField(page, "Created").locator("span[title]"),
      ).toHaveAttribute("title", created);
    }
  }
  await page.goto("/");
  for (const [index, { iso, hour }] of cases.entries())
    await expectLocalEvent(
      page,
      await listEvent(page, String(rows[index].m_sLabel)),
      iso,
      hour,
    );
});

test("missing, zero and invalid asset event times remain unavailable across list, detail and overview", async ({
  page,
}) => {
  const values = [
    undefined,
    null,
    0,
    "0000-00-00T00:00:00.000",
    "not-a-timestamp",
    "2026-02-30T12:00:00Z",
  ];
  const rows = values.map((value, index) =>
    asset(String(index + 51), `unavailable event ${index + 1}`, value),
  );
  await syntheticAssets(page, rows);
  await page.goto("/assets");
  for (const row of rows) {
    const cell = await listEvent(page, String(row.m_sLabel));
    await expect(cell).toHaveText("\u2014");
    await expect(cell.locator("time")).toHaveCount(0);
  }
  for (const row of rows) {
    await page.goto(`/assets/${row.id}`);
    await expect(
      page.getByRole("heading", { name: String(row.m_sLabel), exact: true }),
    ).toBeVisible();
    await expect(detailField(page, "Last event")).toHaveText("\u2014");
    await expect(detailField(page, "Last event").locator("time")).toHaveCount(
      0,
    );
  }
  await page.goto("/");
  for (const row of rows) {
    const cell = await listEvent(page, String(row.m_sLabel));
    await expect(cell).toHaveText("\u2014");
    await expect(cell.locator("time")).toHaveCount(0);
  }
});
