import { expect, test, type Page } from "@playwright/test";
import type { Identity, RecordData } from "../../shared/resources";

test.use({ locale: "en-GB", timezoneId: "Europe/Brussels" });

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
  integer: unknown,
  event: unknown = "20261008101010",
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
        m_nValueType: "2",
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
        m_nValueType: "2",
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
    updateValueType: (id: string, valueType: string) => {
      if (types[id]?.data) types[id].data!.m_nValueType = valueType;
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

function readingRow(page: Page, historyId: string) {
  return page.locator(`tr[data-row-key="${historyId}"]`);
}

function readingValue(page: Page, historyId: string) {
  return readingRow(page, historyId).getByRole("cell").nth(1);
}

function readingEventTime(page: Page, historyId: string) {
  return readingRow(page, historyId).getByRole("cell").nth(2);
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
  await expect(page.getByRole("columnheader")).toHaveText([
    "Sensor",
    "Value",
    "Event time",
  ]);
  await expect(
    page.getByRole("columnheader", { name: "Sensor", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Sensor ID", exact: true }),
  ).toHaveCount(0);
  for (const [historyId, id] of [
    ["11", largeSensorId],
    ["12", largeSensorId],
    ["13", "41"],
  ]) {
    const row = readingRow(page, historyId);
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
    readingRow(page, "14").getByRole("link", {
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

test("unavailable or absent history type preserves the sensor ID and row without guessing its value", async ({
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
  for (const [historyId, id] of [
    ["21", "51"],
    ["22", "52"],
    ["23", "53"],
    ["24", "54"],
    ["25", "55"],
  ]) {
    const row = readingRow(page, historyId);
    await expect(row.getByText(`#${id}`, { exact: true })).toBeVisible();
    await expect(readingValue(page, historyId)).toHaveText("—");
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
  const row = readingRow(page, "31");
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
  await expect(readingValue(page, "31")).toHaveText("—");
});

test("history remains readable without sensor access and offers no forbidden sensor links", async ({
  page,
}) => {
  const mock = await syntheticHistory(page, {
    canReadSensors: false,
    pages: [historyPage([reading("41", largeSensorId, largeTypeId, "401")])],
  });
  await loadHistory(page);
  const row = readingRow(page, "41");
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
    readingRow(page, afterId).getByText("Recorded temperature label", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load next 100 readings", exact: true })
    .click();
  await expect(
    readingRow(page, "53").getByRole("link", {
      name: "RECORDED-TEMPERATURE-TYPE",
      exact: true,
    }),
  ).toHaveAttribute("href", "/sensors/62");
  await expect(page.getByText("3 loaded", { exact: true })).toBeVisible();
  await expect(readingRow(page, "51")).toBeVisible();
  await expect(readingRow(page, afterId)).toBeVisible();
  await expect(readingEventTime(page, afterId)).toHaveText("—");
  await expect(readingValue(page, afterId)).toHaveText("502");
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
  const row = readingRow(page, "61");
  await expect(
    row.getByRole("link", { name: "RECORDED-TEMPERATURE-TYPE", exact: true }),
  ).toBeVisible();
  await expect(readingValue(page, "61")).toHaveText("601");
  mock.updateTypeTag(largeTypeId, "UPDATED-RECORDED-TYPE");
  mock.updateValueType(largeTypeId, "4");
  await page.getByRole("button", { name: /Load history$/ }).click();
  await expect(
    row.getByRole("link", { name: "UPDATED-RECORDED-TYPE", exact: true }),
  ).toBeVisible();
  await expect(readingValue(page, "61")).toHaveText("0.125");
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
  await expect(readingValue(page, "61")).toHaveText("—");
  expect(mock.typeReads).toEqual([
    `/api/resources/sensortypes/${largeTypeId}`,
    `/api/resources/sensortypes/${largeTypeId}`,
    `/api/resources/sensortypes/${largeTypeId}`,
  ]);
  expect(mock.sensorReads).toEqual([]);
  await expect(page.getByText("1 loaded", { exact: true })).toBeVisible();
});

test("history Value follows each recorded type and preserves false, zero, null and numeric precision", async ({
  page,
}) => {
  const preciseReal = "1234567890.12345678901234567890";
  const values = [
    {
      id: "71",
      type: "1",
      boolean: true,
      integer: "999",
      real: "888",
      expected: "True",
    },
    {
      id: "72",
      type: "1",
      boolean: false,
      integer: "999",
      real: "888",
      expected: "False",
    },
    {
      id: "73",
      type: "1",
      boolean: null,
      integer: "999",
      real: "888",
      expected: "—",
    },
    {
      id: "74",
      type: "2",
      boolean: true,
      integer: largeSensorId,
      real: "888",
      expected: largeSensorId,
    },
    {
      id: "75",
      type: "2",
      boolean: true,
      integer: "0",
      real: "888",
      expected: "0",
    },
    {
      id: "76",
      type: "2",
      boolean: true,
      integer: null,
      real: "888",
      expected: "—",
    },
    {
      id: "77",
      type: "4",
      boolean: true,
      integer: "999",
      real: preciseReal,
      expected: preciseReal,
    },
    {
      id: "78",
      type: "4",
      boolean: true,
      integer: "999",
      real: "0",
      expected: "0",
    },
    {
      id: "79",
      type: "4",
      boolean: true,
      integer: "999",
      real: null,
      expected: "—",
    },
    {
      id: "80",
      type: "3",
      boolean: true,
      integer: "90",
      real: "888",
      expected: "On · 90 s",
    },
    {
      id: "81",
      type: "3",
      boolean: false,
      integer: "0",
      real: "888",
      expected: "Off · 0 s",
    },
    {
      id: "82",
      type: "3",
      boolean: null,
      integer: null,
      real: "888",
      expected: "— · —",
    },
  ];
  const types = Object.fromEntries(
    ["1", "2", "3", "4"].map((id) => [
      id,
      {
        data: {
          id,
          m_nIDSensorType: id,
          m_nValueType: id,
          m_sTag: `RECORDED-TYPE-${id}`,
          m_sLabel: `Recorded type ${id} label`,
        },
      },
    ]),
  );
  const mock = await syntheticHistory(page, {
    pages: [
      historyPage(
        values.map(({ id, type, boolean, integer, real }) => ({
          ...reading(id, largeSensorId, type, integer),
          m_bValueBool: boolean,
          m_rValueReal: real,
        })),
      ),
    ],
    types,
  });
  await loadHistory(page);
  await expect(
    page.getByRole("columnheader", { name: "Value", exact: true }),
  ).toBeVisible();
  for (const name of ["Boolean", "Integer", "Real"])
    await expect(
      page.getByRole("columnheader", { name, exact: true }),
    ).toHaveCount(0);
  for (const { id, type, expected } of values) {
    await expect(readingValue(page, id)).toHaveText(expected);
    await expect(
      readingRow(page, id).getByRole("link", {
        name: `RECORDED-TYPE-${type}`,
        exact: true,
      }),
    ).toHaveAttribute("href", `/sensors/${largeSensorId}`);
  }
  expect(mock.typeReads.sort()).toEqual([
    "/api/resources/sensortypes/1",
    "/api/resources/sensortypes/2",
    "/api/resources/sensortypes/3",
    "/api/resources/sensortypes/4",
  ]);
  expect(mock.sensorReads).toEqual([]);
  await expect(page.getByText("12 loaded", { exact: true })).toBeVisible();
});

test("unknown or absent value types show a missing value instead of guessing from stored slots", async ({
  page,
}) => {
  const mock = await syntheticHistory(page, {
    pages: [
      historyPage([
        { ...reading("91", largeSensorId, "5", "999"), m_bValueBool: true },
        { ...reading("92", "41", "6", "999"), m_bValueBool: true },
      ]),
    ],
    types: {
      "5": {
        data: {
          id: "5",
          m_nIDSensorType: "5",
          m_nValueType: "99",
          m_sTag: "UNSUPPORTED-TYPE",
          m_sLabel: "Unsupported value type",
        },
      },
      "6": {
        data: {
          id: "6",
          m_nIDSensorType: "6",
          m_sTag: "TYPE-WITHOUT-VALUE-KIND",
          m_sLabel: "Missing value type",
        },
      },
    },
  });
  await loadHistory(page);
  await expect(
    readingRow(page, "91").getByRole("link", {
      name: "UNSUPPORTED-TYPE",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    readingRow(page, "92").getByRole("link", {
      name: "TYPE-WITHOUT-VALUE-KIND",
      exact: true,
    }),
  ).toBeVisible();
  for (const id of ["91", "92"])
    await expect(readingValue(page, id)).toHaveText("—");
  expect(mock.typeReads.sort()).toEqual([
    "/api/resources/sensortypes/5",
    "/api/resources/sensortypes/6",
  ]);
});

test("history event time uses the browser timezone and event date's winter or summer offset", async ({
  page,
}) => {
  const cases = [
    {
      id: "101",
      raw: "20260108123045",
      display: "08/01/2026, 13:30:45",
      iso: "2026-01-08T12:30:45.000Z",
    },
    {
      id: "102",
      raw: "20260708123045",
      display: "08/07/2026, 14:30:45",
      iso: "2026-07-08T12:30:45.000Z",
    },
    {
      id: "103",
      raw: "2026-01-08T12:30:45Z",
      display: "08/01/2026, 13:30:45",
      iso: "2026-01-08T12:30:45.000Z",
    },
    {
      id: "104",
      raw: "2026-07-08T14:30:45+02:00",
      display: "08/07/2026, 14:30:45",
      iso: "2026-07-08T12:30:45.000Z",
    },
    {
      id: "105",
      raw: "2026-01-01T00:30:45+09:00",
      display: "31/12/2025, 16:30:45",
      iso: "2025-12-31T15:30:45.000Z",
    },
  ];
  const mock = await syntheticHistory(page, {
    pages: [
      historyPage(
        cases.map(({ id, raw }) =>
          reading(id, largeSensorId, largeTypeId, "0", raw),
        ),
      ),
    ],
  });
  await loadHistory(page);
  expect(
    await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
  ).toBe("Europe/Brussels");
  for (const { id, display, iso } of cases) {
    const cell = readingEventTime(page, id);
    await expect(cell).toHaveText(display);
    await expect(cell.locator("time")).toHaveAttribute("datetime", iso);
    await expect(cell.locator("time")).toHaveAttribute(
      "title",
      "Europe/Brussels",
    );
    await expect(readingValue(page, id)).toHaveText("0");
  }
  expect(mock.typeReads).toEqual([`/api/resources/sensortypes/${largeTypeId}`]);
});

test("invalid, absent or unzoned history event times preserve the reading without inventing a date", async ({
  page,
}) => {
  const timestamps: unknown[] = [
    undefined,
    null,
    "",
    "not-a-timestamp",
    "20260230123045",
    "2026-02-30T12:30:45Z",
    "2026-07-08T12:30:45",
    "2026-07-08 12:30:45",
    "20261008112233456789",
  ];
  await syntheticHistory(page, {
    pages: [
      historyPage(
        timestamps.map((timestamp, index) => ({
          ...reading(String(index + 111), largeSensorId, largeTypeId, "0"),
          m_dhDhLastEvent: timestamp,
        })),
      ),
    ],
  });
  await loadHistory(page);
  for (let index = 0; index < timestamps.length; index++) {
    const id = String(index + 111);
    const cell = readingEventTime(page, id);
    await expect(cell).toHaveText("—");
    await expect(cell.locator("time")).toHaveCount(0);
    await expect(readingValue(page, id)).toHaveText("0");
  }
});

test.describe("history event time follows a different browser timezone", () => {
  test.use({ timezoneId: "America/New_York" });

  test("UTC instants display local time including a previous local calendar day", async ({
    page,
  }) => {
    const cases = [
      {
        id: "121",
        raw: "2026-01-01T01:30:45Z",
        display: "31/12/2025, 20:30:45",
        iso: "2026-01-01T01:30:45.000Z",
      },
      {
        id: "122",
        raw: "20260708123045",
        display: "08/07/2026, 08:30:45",
        iso: "2026-07-08T12:30:45.000Z",
      },
    ];
    await syntheticHistory(page, {
      pages: [
        historyPage(
          cases.map(({ id, raw }) =>
            reading(id, largeSensorId, largeTypeId, "0", raw),
          ),
        ),
      ],
    });
    await loadHistory(page);
    expect(
      await page.evaluate(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    ).toBe("America/New_York");
    for (const { id, display, iso } of cases) {
      const cell = readingEventTime(page, id);
      await expect(cell).toHaveText(display);
      await expect(cell.locator("time")).toHaveAttribute("datetime", iso);
      await expect(cell.locator("time")).toHaveAttribute(
        "title",
        "America/New_York",
      );
    }
  });
});
