import { expect, test, type Locator, type Page } from "@playwright/test";
import { type Identity, type RecordData } from "../../shared/resources";

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
  await page.getByRole("tab", { name: "Devices", exact: true }).click();
  await page.getByRole("link", { name: deviceLabel, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: deviceLabel, exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Sensors", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "Current value", exact: true }),
  ).toBeVisible();
}

function sensorRow(page: Page, label: string) {
  return page
    .getByRole("link", { name: label, exact: true })
    .locator("xpath=ancestor::tr");
}

async function valueCell(page: Page, label: string) {
  const column = await page
    .getByRole("columnheader", { name: "Current value", exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
  return sensorRow(page, label).getByRole("cell").nth(column);
}

function sensorsPanel(page: Page) {
  return page.getByRole("tabpanel").filter({
    has: page.getByRole("columnheader", {
      name: "Current value",
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
  await expect(await valueCell(page, "Synthetic boolean reading")).toHaveText(
    "No",
  );
  await expect(await valueCell(page, "Synthetic integer reading")).toHaveText(
    exactInteger,
  );
  await expect(await valueCell(page, "Synthetic time-on reading")).toHaveText(
    "On · 90 s",
  );
  await expect(await valueCell(page, "Synthetic real reading")).toHaveText(
    exactReal,
  );
  await expect(
    page.getByRole("columnheader", { name: "Sensor type", exact: true }),
  ).toBeVisible();
  for (const [id, label] of [
    ["71", "Synthetic boolean reading"],
    ["72", "Synthetic integer reading"],
    ["73", "Synthetic time-on reading"],
    ["74", "Synthetic real reading"],
  ])
    await expect(
      sensorRow(page, label).getByRole("link", {
        name: `SYNTHETIC-SENSOR-TYPE-${id}`,
        exact: true,
      }),
    ).toHaveAttribute("href", `/sensortypes/${id}`);
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

test("sensor current values retain false and zero and do not substitute an unrelated slot for null", async ({
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
  for (const [label, value] of [
    ["Synthetic false value", "No"],
    ["Synthetic zero integer", "0"],
    ["Synthetic stopped timer", "Off · 0 s"],
    ["Synthetic zero real", "0.00000000000000000000"],
    ["Synthetic null integer", "\u2014"],
    ["Synthetic missing real", "\u2014"],
  ])
    await expect(await valueCell(page, label)).toHaveText(value);
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
  for (const [, , label] of definitions)
    await expectRawValues(await valueCell(page, label!));
  await expect(await valueCell(page, "Synthetic empty raw values")).toHaveText(
    "\u2014",
  );
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
  await expectRawValues(
    await valueCell(page, "Synthetic unreadable sensor type"),
  );
  const row = sensorRow(page, "Synthetic unreadable sensor type");
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
  });
  const type = sensorType("71", "1");
  const mock = await syntheticHierarchy(page, {
    sensors: [row],
    types: { "71": { data: type } },
  });
  await descendToSensors(page);
  await expect(await valueCell(page, "Synthetic refreshing sensor")).toHaveText(
    "No",
  );
  type.m_nValueType = "4";
  type.m_sTag = "UPDATED-SYNTHETIC-SENSOR-TYPE";
  const changedReal = "2.50000000000000000009";
  row.m_rValueReal = changedReal;
  await sensorsPanel(page)
    .getByRole("button", { name: /Refresh$/ })
    .click();
  await expect(await valueCell(page, "Synthetic refreshing sensor")).toHaveText(
    changedReal,
  );
  await expect(
    sensorRow(page, "Synthetic refreshing sensor").getByRole("link", {
      name: "UPDATED-SYNTHETIC-SENSOR-TYPE",
      exact: true,
    }),
  ).toBeVisible();
  mock.denyTypeReads();
  const latestReal = "3.75000000000000000007";
  row.m_rValueReal = latestReal;
  await sensorsPanel(page)
    .getByRole("button", { name: /Refresh$/ })
    .click();
  await expectRawValues(
    await valueCell(page, "Synthetic refreshing sensor"),
    latestReal,
  );
  await expect(
    sensorRow(page, "Synthetic refreshing sensor").getByRole("link", {
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
