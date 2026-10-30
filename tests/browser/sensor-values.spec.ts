import { expect, test, type Locator, type Page } from "@playwright/test";
import { type Identity, type RecordData } from "../../shared/resources";

test.use({ locale: "en-GB", timezoneId: "Europe/Brussels" });

const exactInteger = "9223372036854775807";
const exactReal = "1234567890.12345678901234567890";
const hubLabel = "Synthetic current-value hub";
const deviceLabel = "Synthetic current-value device";

function sensor(
  id: string,
  typeId: string | undefined,
  label: string,
  values: RecordData = {},
): RecordData {
  return {
    id,
    m_nIDSensor: id,
    m_nIDSensorType: typeId,
    m_nIDDevice: "51",
    m_sTag: `SYNTHETIC-SENSOR-${id}`,
    m_sLabel: label,
    ...values,
  };
}

function sensorType(id: string, valueType: string | undefined): RecordData {
  return {
    id,
    m_nIDSensorType: id,
    m_nValueType: valueType,
    m_sTag: `SYNTHETIC-SENSOR-TYPE-${id}`,
    m_sLabel: `Synthetic descriptive type ${id}`,
  };
}

async function syntheticHierarchy(
  page: Page,
  options: {
    sensors: RecordData[];
    canReadTypes?: boolean;
    types: Record<string, { data?: RecordData; status?: number }>;
  },
) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic sensor reader",
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      { entity: "hubs", rights: "r" },
      { entity: "devices", rights: "r" },
      { entity: "sensors", rights: "r" },
      ...(options.canReadTypes === false
        ? []
        : [{ entity: "sensortypes", rights: "r" }]),
    ],
  };
  const hub = {
    id: "41",
    m_nIDHub: "41",
    m_nIDOrganization: "7",
    m_sTag: "SYNTHETIC-VALUE-HUB",
    m_sLabel: hubLabel,
  };
  const device = {
    id: "51",
    IDDevice: "51",
    IDHub: "41",
    IDDeviceType: "81",
    Tag: "SYNTHETIC-VALUE-DEVICE",
    Label: deviceLabel,
  };
  const reads: URL[] = [];
  const typeReads: string[] = [];
  let denyTypes = false;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    reads.push(url);
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-sensor-values-csrf",
        expiresAt: Date.now() + 60000,
      });
    if (path === "/api/resources/hubs") return reply({ data: [hub], total: 1 });
    if (path === "/api/resources/hubs/41") return reply({ data: hub });
    if (path === "/api/resources/devices")
      return reply({ data: [device], total: 1 });
    if (path === "/api/resources/devices/51") return reply({ data: device });
    if (path === "/api/resources/sensors")
      return reply({ data: options.sensors, total: options.sensors.length });
    if (path.startsWith("/api/resources/sensors/")) {
      const id = path.split("/").at(-1)!;
      const record = options.sensors.find((row) => row.id === id);
      return record
        ? reply({ data: record })
        : reply({ message: "Synthetic sensor unavailable." }, 404);
    }
    if (path.startsWith("/api/resources/sensortypes/")) {
      const id = path.split("/").at(-1)!;
      typeReads.push(id);
      const type = options.types[id];
      const status = denyTypes ? 403 : (type?.status ?? 200);
      return status !== 200 || !type?.data
        ? reply(
            { message: "Synthetic sensor type unavailable." },
            status === 200 ? 404 : status,
          )
        : reply({ data: type.data });
    }
    // Every API request is synthetic, including unrelated mounted detail tabs.
    return reply({ data: [], total: 0 });
  });
  return {
    reads,
    typeReads,
    denyTypeReads: () => {
      denyTypes = true;
    },
  };
}

async function descendToSensors(page: Page) {
  await page.goto("/hubs");
  await page.getByRole("link", { name: hubLabel, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: hubLabel, exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /^Devices(?: \(\d+\+?\))?$/ }).click();
  await expect(page.getByRole("columnheader").first()).toHaveText("ID");
  const deviceLink = page.getByRole("link", { name: "51", exact: true });
  await expect(deviceLink).toHaveAttribute("href", "/devices/51");
  await expect(
    deviceLink.locator("xpath=ancestor::tr").getByRole("cell").first(),
  ).toHaveText("51");
  await deviceLink.click();
  await expect(
    page.getByRole("heading", { name: deviceLabel, exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /^Sensors(?: \(\d+\+?\))?$/ }).click();
  await expect(
    page.getByRole("columnheader", {
      name: "Last reported value",
      exact: true,
    }),
  ).toBeVisible();
}

function sensorRow(page: Page, id: string) {
  return page
    .getByRole("cell", { name: id, exact: true })
    .locator("xpath=ancestor::tr");
}

async function valueCell(page: Page, id: string) {
  const column = await page
    .getByRole("columnheader", { name: "Last reported value", exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
  return sensorRow(page, id).getByRole("cell").nth(column);
}

async function lastReadingCell(page: Page, id: string) {
  const column = await page
    .getByRole("columnheader", { name: "Last reading", exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
  return sensorRow(page, id).getByRole("cell").nth(column);
}

function sensorsPanel(page: Page) {
  return page.getByRole("tabpanel").filter({
    has: page.getByRole("columnheader", {
      name: "Last reported value",
      exact: true,
    }),
  });
}

async function expectRawValues(cell: Locator, real = exactReal) {
  await expect(cell).toContainText("Boolean: No");
  await expect(cell).toContainText(`Integer: ${exactInteger}`);
  await expect(cell).toContainText(`Real: ${real}`);
}

test("hub-to-device navigation shows sensor values selected by their type without losing precision", async ({
  page,
}) => {
  const mock = await syntheticHierarchy(page, {
    sensors: [
      sensor("61", "71", "Synthetic boolean reading", {
        m_bValueBool: false,
        m_nValueInt: exactInteger,
        m_rValueReal: exactReal,
      }),
      sensor("62", "72", "Synthetic integer reading", {
        m_bValueBool: false,
        m_nValueInt: exactInteger,
        m_rValueReal: exactReal,
      }),
      sensor("63", "73", "Synthetic time-on reading", {
        m_bValueBool: true,
        m_nValueInt: "90",
        m_rValueReal: exactReal,
      }),
      sensor("64", "74", "Synthetic real reading", {
        m_bValueBool: false,
        m_nValueInt: exactInteger,
        m_rValueReal: exactReal,
      }),
    ],
    types: Object.fromEntries(
      ["71", "72", "73", "74"].map((id, index) => [
        id,
        { data: sensorType(id, String(index + 1)) },
      ]),
    ),
  });
  await descendToSensors(page);
  await expect(await valueCell(page, "61")).toHaveText("No");
  await expect(await valueCell(page, "62")).toHaveText(exactInteger);
  await expect(await valueCell(page, "63")).toHaveText("On · 90 s");
  await expect(await valueCell(page, "64")).toHaveText(exactReal);
  await expect(
    page.getByRole("columnheader", { name: "Sensor type", exact: true }),
  ).toBeVisible();
  for (const [id, typeId] of [
    ["61", "71"],
    ["62", "72"],
    ["63", "73"],
    ["64", "74"],
  ])
    await expect(
      sensorRow(page, id).getByRole("link", {
        name: `SYNTHETIC-SENSOR-TYPE-${typeId}`,
        exact: true,
      }),
    ).toHaveAttribute("href", `/sensortypes/${typeId}`);
  expect(
    mock.reads.some(
      (url) =>
        url.pathname === "/api/resources/devices" &&
        url.searchParams.get("idhub") === "41",
    ),
  ).toBe(true);
  expect(
    mock.reads.some(
      (url) =>
        url.pathname === "/api/resources/sensors" &&
        url.searchParams.get("iddevice") === "51",
    ),
  ).toBe(true);
});

test("sensor reported values retain false and zero and do not substitute an unrelated slot for null", async ({
  page,
}) => {
  await syntheticHierarchy(page, {
    sensors: [
      sensor("61", "71", "Synthetic false value", { m_bValueBool: false }),
      sensor("62", "72", "Synthetic zero integer", { m_nValueInt: "0" }),
      sensor("63", "73", "Synthetic stopped timer", {
        m_bValueBool: false,
        m_nValueInt: "0",
      }),
      sensor("64", "74", "Synthetic zero real", {
        m_rValueReal: "0.00000000000000000000",
      }),
      sensor("65", "72", "Synthetic null integer", {
        m_bValueBool: true,
        m_nValueInt: null,
        m_rValueReal: exactReal,
      }),
      sensor("66", "74", "Synthetic missing real", {
        m_bValueBool: false,
        m_nValueInt: exactInteger,
      }),
    ],
    types: Object.fromEntries(
      ["71", "72", "73", "74"].map((id, index) => [
        id,
        { data: sensorType(id, String(index + 1)) },
      ]),
    ),
  });
  await descendToSensors(page);
  for (const [id, value] of [
    ["61", "No"],
    ["62", "0"],
    ["63", "Off · 0 s"],
    ["64", "0.00000000000000000000"],
    ["65", "\u2014"],
    ["66", "\u2014"],
  ])
    await expect(await valueCell(page, id)).toHaveText(value);
});

test("unavailable and unknown sensor types show every available raw value with its label", async ({
  page,
}) => {
  const definitions = [
    ["61", "71", "Synthetic forbidden sensor type"],
    ["62", "72", "Synthetic missing sensor type"],
    ["63", "73", "Synthetic failed sensor type"],
    ["64", "74", "Synthetic unknown value type"],
    ["65", "75", "Synthetic no value type"],
    ["66", undefined, "Synthetic no sensor type"],
  ];
  const mock = await syntheticHierarchy(page, {
    sensors: [
      ...definitions.map(([id, typeId, label]) =>
        sensor(id!, typeId, label!, {
          m_bValueBool: false,
          m_nValueInt: exactInteger,
          m_rValueReal: exactReal,
        }),
      ),
      sensor("67", "74", "Synthetic empty raw values", {
        m_bValueBool: null,
        m_nValueInt: null,
        m_rValueReal: null,
      }),
    ],
    types: {
      "71": { status: 403 },
      "72": { status: 404 },
      "73": { status: 500 },
      "74": { data: sensorType("74", "99") },
      "75": { data: sensorType("75", undefined) },
    },
  });
  await descendToSensors(page);
  for (const [id] of definitions)
    await expectRawValues(await valueCell(page, id!));
  await expect(await valueCell(page, "67")).toHaveText("\u2014");
  expect(mock.typeReads).not.toContain("undefined");
});

test("sensor values fall back to labeled raw slots without fetching unreadable sensor types", async ({
  page,
}) => {
  const mock = await syntheticHierarchy(page, {
    canReadTypes: false,
    sensors: [
      sensor("61", "71", "Synthetic unreadable sensor type", {
        m_bValueBool: false,
        m_nValueInt: exactInteger,
        m_rValueReal: exactReal,
      }),
    ],
    types: { "71": { data: sensorType("71", "1") } },
  });
  await descendToSensors(page);
  await expectRawValues(await valueCell(page, "61"));
  const row = sensorRow(page, "61");
  await expect(row.getByText("#71", { exact: true })).toBeVisible();
  await expect(row.locator('a[href^="/sensortypes/"]')).toHaveCount(0);
  expect(mock.typeReads).toEqual([]);
});

test("sensor list refresh reloads values and types and removes a cached interpretation after forbidden reads", async ({
  page,
}) => {
  const row = sensor("61", "71", "Synthetic refreshing sensor", {
    m_bValueBool: false,
    m_nValueInt: exactInteger,
    m_rValueReal: exactReal,
    m_dhDhLastEvent: "2026-10-08T06:00:00Z",
  });
  const type = sensorType("71", "1");
  const mock = await syntheticHierarchy(page, {
    sensors: [row],
    types: { "71": { data: type } },
  });
  await descendToSensors(page);
  await expect(await valueCell(page, "61")).toHaveText("No");
  await expect(await lastReadingCell(page, "61")).toHaveText(
    "08/10/2026, 08:00:00",
  );
  type.m_nValueType = "4";
  type.m_sTag = "UPDATED-SYNTHETIC-SENSOR-TYPE";
  const changedReal = "2.50000000000000000009";
  row.m_rValueReal = changedReal;
  row.m_dhDhLastEvent = "2026-10-08T06:05:00Z";
  await sensorsPanel(page)
    .getByRole("button", { name: /Refresh$/ })
    .click();
  await expect(await valueCell(page, "61")).toHaveText(changedReal);
  await expect(await lastReadingCell(page, "61")).toHaveText(
    "08/10/2026, 08:05:00",
  );
  await expect(
    sensorRow(page, "61").getByRole("link", {
      name: "UPDATED-SYNTHETIC-SENSOR-TYPE",
      exact: true,
    }),
  ).toBeVisible();
  mock.denyTypeReads();
  const latestReal = "3.75000000000000000007";
  row.m_rValueReal = latestReal;
  row.m_dhDhLastEvent = "2026-10-08T06:10:00Z";
  await sensorsPanel(page)
    .getByRole("button", { name: /Refresh$/ })
    .click();
  await expectRawValues(await valueCell(page, "61"), latestReal);
  await expect(await lastReadingCell(page, "61")).toHaveText(
    "08/10/2026, 08:10:00",
  );
  await expect(
    sensorRow(page, "61").getByRole("link", {
      name: "#71",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("UPDATED-SYNTHETIC-SENSOR-TYPE", { exact: true }),
  ).toHaveCount(0);
  expect(
    mock.typeReads.filter((id) => id === "71").length,
  ).toBeGreaterThanOrEqual(3);
});

test("old sensor readings remain reported values with their event time on the list and details", async ({
  page,
}) => {
  const oldEvent = "2020-01-02T03:04:05Z";
  await syntheticHierarchy(page, {
    sensors: [
      sensor("61", "71", "Synthetic old false reading", {
        m_bValueBool: false,
        m_dhDhLastEvent: oldEvent,
      }),
      sensor("62", "72", "Synthetic old zero reading", {
        m_nValueInt: "0",
        m_dhDhLastEvent: oldEvent,
      }),
      sensor("63", "74", "Synthetic old heart rate reading", {
        m_rValueReal: "68.00000000000000000001",
        m_dhDhLastEvent: oldEvent,
      }),
    ],
    types: {
      "71": { data: sensorType("71", "1") },
      "72": { data: sensorType("72", "2") },
      "74": { data: sensorType("74", "4") },
    },
  });
  await descendToSensors(page);
  await expect(
    page.getByRole("columnheader", { name: "Current value", exact: true }),
  ).toHaveCount(0);
  for (const [id, value] of [
    ["61", "No"],
    ["62", "0"],
    ["63", "68.00000000000000000001"],
  ]) {
    await expect(await valueCell(page, id)).toHaveText(value);
    const eventCell = await lastReadingCell(page, id);
    await expect(eventCell).toHaveText("02/01/2020, 04:04:05");
    await expect(eventCell.locator("time")).toHaveCount(1);
    await expect(eventCell.locator("time")).toHaveAttribute(
      "title",
      /Europe\/Brussels/,
    );
  }
  await sensorRow(page, "63")
    .getByRole("cell", { name: "63", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic old heart rate reading",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Last reading", { exact: true })).toBeVisible();
  await expect(page.locator("time")).toHaveText("02/01/2020, 04:04:05");
});

test.describe("sensor event time stays in Brussels in a different browser timezone", () => {
  test.use({ timezoneId: "America/New_York" });

  test("offset, compact and genuine epoch timestamps display local time and preserve the absolute event time", async ({
    page,
  }) => {
    await syntheticHierarchy(page, {
      sensors: [
        sensor("61", "72", "Synthetic offset reading", {
          m_nValueInt: "1",
          m_dhDhLastEvent: "2026-10-08T08:10:11+02:00",
        }),
        sensor("62", "72", "Synthetic compact reading", {
          m_nValueInt: "2",
          m_dhDhLastEvent: "20261008061012",
        }),
        sensor("63", "72", "Synthetic epoch reading", {
          m_nValueInt: "0",
          m_dhDhLastEvent: "1970-01-01T00:00:00Z",
        }),
      ],
      types: { "72": { data: sensorType("72", "2") } },
    });
    await descendToSensors(page);
    expect(
      await page.evaluate(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    ).toBe("America/New_York");
    for (const [id, display, iso] of [
      ["61", "08/10/2026, 08:10:11", "2026-10-08T06:10:11.000Z"],
      ["62", "08/10/2026, 08:10:12", "2026-10-08T06:10:12.000Z"],
      ["63", "01/01/1970, 01:00:00", "1970-01-01T00:00:00.000Z"],
    ]) {
      const cell = await lastReadingCell(page, id);
      await expect(cell).toHaveText(display);
      await expect(cell.locator("time")).toHaveAttribute(
        "title",
        /Europe\/Brussels/,
      );
      const dateTime = await cell.locator("time").getAttribute("datetime");
      expect(new Date(dateTime!).toISOString()).toBe(iso);
    }
    await expect(await valueCell(page, "63")).toHaveText("0");
  });
});

test("local sensor reading times use the event date's winter or summer timezone offset", async ({
  page,
}) => {
  await syntheticHierarchy(page, {
    sensors: [
      sensor("61", "72", "Synthetic winter reading", {
        m_nValueInt: "1",
        m_dhDhLastEvent: "2026-01-15T12:34:56Z",
      }),
      sensor("62", "72", "Synthetic summer reading", {
        m_nValueInt: "2",
        m_dhDhLastEvent: "2026-07-15T12:34:56Z",
      }),
    ],
    types: { "72": { data: sensorType("72", "2") } },
  });
  await descendToSensors(page);
  expect(
    await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
  ).toBe("Europe/Brussels");
  for (const [id, display] of [
    ["61", "15/01/2026, 13:34:56"],
    ["62", "15/07/2026, 14:34:56"],
  ])
    await expect(await lastReadingCell(page, id)).toHaveText(display);
});

test.describe("local times use a 24-hour clock even in a 12-hour browser locale", () => {
  test.use({ locale: "en-US", timezoneId: "Europe/Brussels" });

  test("sensor list and detail times retain local dates and instants at afternoon and midnight", async ({
    page,
  }) => {
    const winterLabel = "Synthetic US-locale winter reading";
    const summerLabel = "Synthetic US-locale summer reading";
    const midnightLabel = "Synthetic US-locale midnight reading";
    const created = "2026-01-15T12:45:56Z";
    const modified = "2026-01-15T23:04:05Z";
    await syntheticHierarchy(page, {
      sensors: [
        sensor("61", "72", winterLabel, {
          m_nValueInt: "1",
          m_dhDhLastEvent: "2026-01-15T12:34:56Z",
          m_dhDhCreated: created,
          m_dhDhModified: modified,
        }),
        sensor("62", "72", summerLabel, {
          m_nValueInt: "2",
          m_dhDhLastEvent: "2026-07-15T12:34:56Z",
        }),
        sensor("63", "72", midnightLabel, {
          m_nValueInt: "3",
          m_dhDhLastEvent: modified,
        }),
      ],
      types: { "72": { data: sensorType("72", "2") } },
    });
    await descendToSensors(page);
    for (const [id, display, instant] of [
      ["61", "15/01/2026, 13:34:56", "2026-01-15T12:34:56.000Z"],
      ["62", "15/07/2026, 14:34:56", "2026-07-15T12:34:56.000Z"],
      ["63", "16/01/2026, 00:04:05", "2026-01-15T23:04:05.000Z"],
    ]) {
      const cell = await lastReadingCell(page, id);
      await expect(cell).toHaveText(display);
      await expect(cell.locator("time")).toHaveAttribute("datetime", instant);
      await expect(cell.locator("time")).toHaveAttribute(
        "title",
        "Europe/Brussels",
      );
    }
    await sensorRow(page, "61")
      .getByRole("cell", { name: "61", exact: true })
      .click();
    await expect(page).toHaveURL("/sensors/61");
    for (const [label, display] of [
      ["Created", "15/01/2026, 13:45:56"],
      ["Modified", "16/01/2026, 00:04:05"],
      ["Last reading", "15/01/2026, 13:34:56"],
    ]) {
      const content = page
        .locator(".ant-descriptions-item-label")
        .filter({ hasText: new RegExp(`^${label}$`) })
        .locator("xpath=following-sibling::*[1]");
      await expect(content).toHaveText(display);
      if (label === "Last reading")
        await expect(content.locator("time")).toHaveAttribute(
          "datetime",
          "2026-01-15T12:34:56.000Z",
        );
      else
        await expect(content.locator("span[title]")).toHaveAttribute(
          "title",
          "Europe/Brussels",
        );
    }
  });
});

test("missing, invalid and unzoned event times do not imply a live reading or alter its value", async ({
  page,
}) => {
  const cases: [string, unknown][] = [
    ["Missing", undefined],
    ["Null", null],
    ["Blank", ""],
    ["Malformed", "not-a-timestamp"],
    ["Zero legacy", "00000000000000"],
    ["Invalid calendar", "2026-02-30T10:00:00Z"],
    ["Unzoned ISO", "2026-10-08T06:10:11"],
    ["Local date", "2026-10-08 06:10:11"],
  ];
  await syntheticHierarchy(page, {
    sensors: cases.map(([name, timestamp], index) =>
      sensor(String(index + 61), "72", `Synthetic ${name} time`, {
        m_nValueInt: "0",
        m_dhDhLastEvent: timestamp,
      }),
    ),
    types: { "72": { data: sensorType("72", "2") } },
  });
  await descendToSensors(page);
  for (const [index] of cases.entries()) {
    const id = String(index + 61);
    const cell = await lastReadingCell(page, id);
    await expect(cell).toHaveText("\u2014");
    await expect(cell.locator("time")).toHaveCount(0);
    await expect(await valueCell(page, id)).toHaveText("0");
  }
});
