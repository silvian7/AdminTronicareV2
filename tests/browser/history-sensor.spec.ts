import { expect, test, type Page } from "@playwright/test";
import type { Identity, RecordData } from "../../shared/resources";

const largeSensorId = "9223372036854775807";
const largeTypeId = "9223372036854775806";
const snapshot = "20261008123045123456";
const highWaterId = "9223372036854775805";

interface HistoryPage {
  data: RecordData[];
  snapshot: string | null;
  highWaterId: string | null;
  hasMore: boolean;
}

function reading(
  historyId: string,
  sensorId: string,
  typeId: unknown,
  integer: string,
  event = "20261008101010",
): RecordData {
  return {
    m_nIDSensorHistory: historyId,
    m_nIDSensor: sensorId,
    m_nIDSensorType: typeId,
    m_dhDhLastEvent: event,
    m_bValueBool: false,
    m_nValueInt: integer,
    m_rValueReal: "0.125",
  };
}

function historyPage(data: RecordData[], hasMore = false): HistoryPage {
  return { data, snapshot, highWaterId, hasMore };
}

async function syntheticHistory(
  page: Page,
  options: {
    pages: HistoryPage[];
    canReadSensors?: boolean;
    canReadTypes?: boolean;
    types?: Record<string, { data?: RecordData; status?: number }>;
  },
) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic history reader",
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      { entity: "sensorshistory", rights: "r" },
      ...(options.canReadSensors === false
        ? []
        : [{ entity: "sensors", rights: "r" }]),
      ...(options.canReadTypes === false
        ? []
        : [{ entity: "sensortypes", rights: "r" }]),
    ],
  };
  const types = options.types ?? {
    [largeTypeId]: {
      data: {
        id: largeTypeId,
        m_nIDSensorType: largeTypeId,
        m_sTag: "RECORDED-TEMPERATURE-TYPE",
        m_sLabel: JSON.stringify({
          messages: [
            { lang: "fr", text: "Température enregistrée" },
            { lang: "en", text: "Recorded temperature label" },
          ],
        }),
      },
    },
    "77": {
      data: {
        id: "77",
        m_nIDSensorType: "77",
        m_sTag: "RECORDED-MOTION-TYPE",
        m_sLabel: "Recorded motion label",
      },
    },
  };
  const typeReads: string[] = [];
  const sensorReads: string[] = [];
  const sensorListReads: string[] = [];
  const historyQueries: URLSearchParams[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-history-sensor-csrf",
        expiresAt: Date.now() + 60000,
      });
    if (path === "/api/history") {
      const index = historyQueries.length;
      historyQueries.push(url.searchParams);
      return reply(options.pages[index] ?? historyPage([]));
    }
    if (path === "/api/resources/sensors") {
      sensorListReads.push(path);
      return reply({
        data: [
          {
            id: largeSensorId,
            m_nIDSensor: largeSensorId,
            // Current equipment type deliberately differs from the history snapshot.
            m_nIDSensorType: "77",
            m_sLabel: "Current sensor label",
          },
        ],
        total: 1,
      });
    }
    if (path.startsWith("/api/resources/sensors/")) {
      sensorReads.push(path);
      const id = path.split("/").at(-1)!;
      return reply({
        data: {
          id,
          m_nIDSensor: id,
          m_nIDSensorType: "77",
          m_sLabel: "Current sensor label",
        },
      });
    }
    if (path.startsWith("/api/resources/sensortypes/")) {
      typeReads.push(path);
      const id = path.split("/").at(-1)!;
      const type = types[id];
      const status = type?.status ?? (type?.data ? 200 : 404);
      return status === 200
        ? reply({ data: type!.data })
        : reply({ message: "Synthetic sensor type unavailable." }, status);
    }
    // Every API request is intercepted; no live account or equipment is accessed.
    return reply({ data: [], total: 0 });
  });
  return {
    typeReads,
    sensorReads,
    sensorListReads,
    historyQueries,
    updateTypeTag: (id: string, tag: string) => {
      if (types[id]?.data) types[id].data!.m_sTag = tag;
    },
    denyTypeReads: (id: string) => {
      if (types[id]) types[id].status = 403;
    },
  };
}

async function loadHistory(page: Page) {
  await page.goto(`/sensor-history?idsensor=${largeSensorId}`);
  await page.getByRole("button", { name: /Load history$/ }).click();
}

function readingRow(page: Page, integer: string) {
  return page
    .getByRole("cell", { name: integer, exact: true })
    .locator("xpath=ancestor::tr");
}

test("history Sensor column shows recorded type tag, translated label and exact sensor ID", async ({
  page,
}) => {
  const mock = await syntheticHistory(page, {
    pages: [
      historyPage([
        reading("11", largeSensorId, largeTypeId, "101"),
        reading("12", largeSensorId, largeTypeId, "102"),
        reading("13", "41", largeTypeId, "103"),
        reading("14", "42", "77", "104"),
      ]),
    ],
  });
  await loadHistory(page);
  await expect(
    page.getByRole("columnheader", { name: "Sensor", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Sensor ID", exact: true }),
  ).toHaveCount(0);
  for (const [integer, id] of [
    ["101", largeSensorId],
    ["102", largeSensorId],
    ["103", "41"],
  ]) {
    const row = readingRow(page, integer);
    await expect(
      row.getByRole("link", {
        name: "RECORDED-TEMPERATURE-TYPE",
        exact: true,
      }),
    ).toHaveAttribute("href", `/sensors/${id}`);
    await expect(
      row.getByRole("link", {
        name: "Recorded temperature label",
        exact: true,
      }),
    ).toHaveAttribute("href", `/sensors/${id}`);
    const identifier = row.getByText(`#${id}`, { exact: true });
    await expect(identifier).toBeVisible();
    await expect(identifier).toHaveCSS("font-size", "12px");
    await expect(identifier).toHaveCSS("color", "rgb(138, 154, 165)");
  }
  await expect(
    readingRow(page, "104").getByRole("link", {
      name: "RECORDED-MOTION-TYPE",
      exact: true,
    }),
  ).toHaveAttribute("href", "/sensors/42");
  expect(mock.typeReads.sort()).toEqual(
    [
      `/api/resources/sensortypes/${largeTypeId}`,
      "/api/resources/sensortypes/77",
    ].sort(),
  );
  expect(mock.sensorReads).toEqual([]);
  await expect(
    page.getByText("Current sensor label", { exact: true }),
  ).toHaveCount(0);
});

test("unavailable or absent history type preserves the sensor ID and recorded readings", async ({
  page,
}) => {
  const mock = await syntheticHistory(page, {
    pages: [
      historyPage([
        reading("21", "51", "98", "201"),
        reading("22", "52", "99", "202"),
        reading("23", "53", "100", "203"),
        reading("24", "54", undefined, "204"),
        reading("25", "55", "0", "205"),
      ]),
    ],
    types: {
      "98": { status: 403 },
      "99": { status: 404 },
      "100": { status: 500 },
    },
  });
  await loadHistory(page);
  for (const [integer, id] of [
    ["201", "51"],
    ["202", "52"],
    ["203", "53"],
    ["204", "54"],
    ["205", "55"],
  ]) {
    const row = readingRow(page, integer);
    await expect(row.getByText(`#${id}`, { exact: true })).toBeVisible();
    await expect(
      row.getByRole("cell", { name: "False", exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole("cell", { name: "0.125", exact: true }),
    ).toBeVisible();
  }
  await expect.poll(() => mock.typeReads.length).toBe(3);
  expect(mock.typeReads.sort()).toEqual([
    "/api/resources/sensortypes/100",
    "/api/resources/sensortypes/98",
    "/api/resources/sensortypes/99",
  ]);
  expect(mock.sensorReads).toEqual([]);
  await expect(page.getByText("5 loaded", { exact: true })).toBeVisible();
});

test("history type permission is required before any metadata lookup", async ({
  page,
}) => {
  const mock = await syntheticHistory(page, {
    canReadTypes: false,
    pages: [historyPage([reading("31", largeSensorId, largeTypeId, "301")])],
  });
  await loadHistory(page);
  const row = readingRow(page, "301");
  await expect(
    row.getByText(`#${largeSensorId}`, { exact: true }),
  ).toBeVisible();
  await expect(
    row.getByText("RECORDED-TEMPERATURE-TYPE", { exact: true }),
  ).toHaveCount(0);
  await expect(
    row.getByText("Recorded temperature label", { exact: true }),
  ).toHaveCount(0);
  expect(mock.typeReads).toEqual([]);
  expect(mock.sensorReads).toEqual([]);
});

test("history remains readable without sensor access and offers no forbidden sensor links", async ({
  page,
}) => {
  const mock = await syntheticHistory(page, {
    canReadSensors: false,
    pages: [historyPage([reading("41", largeSensorId, largeTypeId, "401")])],
  });
  await loadHistory(page);
  const row = readingRow(page, "401");
  await expect(
    row.getByText("RECORDED-TEMPERATURE-TYPE", { exact: true }),
  ).toBeVisible();
  await expect(
    row.getByText("Recorded temperature label", { exact: true }),
  ).toBeVisible();
  await expect(
    row.getByText(`#${largeSensorId}`, { exact: true }),
  ).toBeVisible();
  await expect(row.getByRole("link")).toHaveCount(0);
  expect(mock.typeReads).toEqual([`/api/resources/sensortypes/${largeTypeId}`]);
  expect(mock.sensorReads).toEqual([]);
  expect(mock.sensorListReads).toEqual([]);
});

test("enriched Sensor cells preserve exact history continuation cursors and share type lookups", async ({
  page,
}) => {
  const event = "20261008112233456789";
  const afterId = "9223372036854775804";
  const mock = await syntheticHistory(page, {
    pages: [
      historyPage(
        [
          reading("51", largeSensorId, largeTypeId, "501"),
          reading(afterId, "61", largeTypeId, "502", event),
        ],
        true,
      ),
      historyPage([reading("53", "62", largeTypeId, "503")]),
    ],
  });
  await loadHistory(page);
  await expect(
    readingRow(page, "502").getByText("Recorded temperature label", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load next 100 readings", exact: true })
    .click();
  await expect(
    readingRow(page, "503").getByRole("link", {
      name: "RECORDED-TEMPERATURE-TYPE",
      exact: true,
    }),
  ).toHaveAttribute("href", "/sensors/62");
  await expect(page.getByText("3 loaded", { exact: true })).toBeVisible();
  await expect(readingRow(page, "501")).toBeVisible();
  await expect(readingRow(page, "502")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load next 100 readings", exact: true }),
  ).toHaveCount(0);
  expect(mock.historyQueries.map((query) => Object.fromEntries(query))).toEqual(
    [
      { idsensor: largeSensorId, filter: "1" },
      {
        idsensor: largeSensorId,
        filter: "1",
        afterevent: event,
        afterid: afterId,
        highwaterid: highWaterId,
        snapshot,
      },
    ],
  );
  expect(mock.typeReads).toEqual([`/api/resources/sensortypes/${largeTypeId}`]);
  expect(mock.sensorReads).toEqual([]);
});

test("fresh history loads refresh type metadata and suppress stale labels after access is revoked", async ({
  page,
}) => {
  const rows = [reading("61", largeSensorId, largeTypeId, "601")];
  const mock = await syntheticHistory(page, {
    pages: [historyPage(rows), historyPage(rows), historyPage(rows)],
  });
  await loadHistory(page);
  const row = readingRow(page, "601");
  await expect(
    row.getByRole("link", { name: "RECORDED-TEMPERATURE-TYPE", exact: true }),
  ).toBeVisible();
  mock.updateTypeTag(largeTypeId, "UPDATED-RECORDED-TYPE");
  await page.getByRole("button", { name: /Load history$/ }).click();
  await expect(
    row.getByRole("link", { name: "UPDATED-RECORDED-TYPE", exact: true }),
  ).toBeVisible();
  await expect(
    row.getByText("RECORDED-TEMPERATURE-TYPE", { exact: true }),
  ).toHaveCount(0);
  mock.denyTypeReads(largeTypeId);
  await page.getByRole("button", { name: /Load history$/ }).click();
  await expect.poll(() => mock.typeReads.length).toBe(3);
  await expect(
    row.getByText(`#${largeSensorId}`, { exact: true }),
  ).toBeVisible();
  await expect(
    row.getByText("UPDATED-RECORDED-TYPE", { exact: true }),
  ).toHaveCount(0);
  await expect(
    row.getByText("Recorded temperature label", { exact: true }),
  ).toHaveCount(0);
  expect(mock.typeReads).toEqual([
    `/api/resources/sensortypes/${largeTypeId}`,
    `/api/resources/sensortypes/${largeTypeId}`,
    `/api/resources/sensortypes/${largeTypeId}`,
  ]);
  expect(mock.sensorReads).toEqual([]);
  await expect(page.getByText("1 loaded", { exact: true })).toBeVisible();
});
