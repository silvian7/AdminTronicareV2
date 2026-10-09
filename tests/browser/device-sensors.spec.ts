import { expect, test, type Page } from "@playwright/test";
import { type Identity, type RecordData } from "../../shared/resources";

test.use({ timezoneId: "Europe/Brussels", locale: "en-GB" });

const organizationId = "7";
const hubId = "1407374883553285";
const deviceId = "9223372036854775806";
const sensorId = "9223372036854775805";
const secondSensorId = "9223372036854775803";
const assetId = "9223372036854775804";
const deviceTypeId = "81";
const sensorTypeId = "71";
const hubLabel = "Synthetic MStronic hub";
const deviceLabel = "Synthetic realtime device";
const sensorLabel = "Synthetic associated sensor";
const secondSensorLabel = "Synthetic second associated sensor";
const assetTag = "SYNTHETIC-ASSOCIATED-ASSET";
const assetLabel = "Synthetic associated asset";
const realValue = "21.37500000000000000009";
const lastReading = "2025-01-06T08:30:45Z";
const lastReadingLocal = "06/01/2025, 09:30:45";
const lastReadingInstant = "2025-01-06T08:30:45.000Z";

async function syntheticHierarchy(
  page: Page,
  options: {
    canReadSensors?: boolean;
    emptySensors?: boolean;
    secondSensor?: boolean;
    sensorRights?: string;
    deviceRights?: string;
    coreWritable?: boolean;
  } = {},
) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic MStronic operator",
    organizationId,
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      { entity: "organizations", rights: "r" },
      { entity: "assets", rights: "r" },
      { entity: "hubs", rights: "r" },
      { entity: "devices", rights: options.deviceRights ?? "r" },
      { entity: "devicetypes", rights: "r" },
      { entity: "sensortypes", rights: "r" },
      ...(options.canReadSensors === false
        ? []
        : [{ entity: "sensors", rights: options.sensorRights ?? "r" }]),
    ],
  };
  const organization = {
    id: organizationId,
    m_nIDOrganization: organizationId,
    m_sTag: "MSTRONIC-SYNTHETIC",
    m_sLabel: "MStronic",
  };
  const hub = {
    id: hubId,
    m_nIDHub: hubId,
    m_nIDOrganization: organizationId,
    m_sTag: "SYNTHETIC-MSTRONIC-HUB",
    m_sLabel: hubLabel,
  };
  const device = {
    id: deviceId,
    IDDevice: deviceId,
    IDDeviceType: deviceTypeId,
    IDHub: hubId,
    IDOrganization: organizationId,
    Tag: "SYNTHETIC-REALTIME-DEVICE",
    Label: deviceLabel,
  };
  const sensor: RecordData = {
    id: sensorId,
    m_nIDSensor: sensorId,
    m_nIDDevice: deviceId,
    m_nIDSensorType: sensorTypeId,
    m_nIDAsset: assetId,
    m_sTag: "SYNTHETIC-ASSOCIATED-SENSOR",
    m_sLabel: sensorLabel,
    m_bValueBool: false,
    m_nValueInt: "0",
    m_rValueReal: realValue,
    m_dhDhLastEvent: lastReading,
  };
  const secondSensor: RecordData = {
    ...sensor,
    id: secondSensorId,
    m_nIDSensor: secondSensorId,
    m_sTag: "SYNTHETIC-SECOND-ASSOCIATED-SENSOR",
    m_sLabel: secondSensorLabel,
  };
  let sensors = options.emptySensors
    ? []
    : options.secondSensor
      ? [sensor, secondSensor]
      : [sensor];
  const deviceType = {
    id: deviceTypeId,
    IDDeviceType: deviceTypeId,
    Tag: "realtime",
    Label: "Synthetic realtime device type",
  };
  const sensorType = {
    id: sensorTypeId,
    m_nIDSensorType: sensorTypeId,
    m_sTag: "SYNTHETIC-REAL-TYPE",
    m_sLabel: "Synthetic real sensor type",
    m_nValueType: "4",
  };
  const asset = {
    id: assetId,
    m_nIDAsset: assetId,
    m_nIDOrganization: organizationId,
    m_sTag: assetTag,
    m_sLabel: JSON.stringify({
      messages: [
        { lang: "fr", text: "Synthetic French asset label" },
        { lang: "en", text: assetLabel },
      ],
    }),
  };
  const reads: URL[] = [];
  const mutations: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (request.method() !== "GET") {
      mutations.push(`${request.method()} ${path}`);
      const target = sensors.find(
        (row) => path === `/api/resources/sensors/${row.id}`,
      );
      if (
        request.method() === "DELETE" &&
        target &&
        options.sensorRights?.includes("d") &&
        options.coreWritable !== false
      ) {
        sensors = sensors.filter((row) => row.id !== target.id);
        return reply({ data: target });
      }
      return reply({ message: "Synthetic read-only fixture." }, 405);
    }
    reads.push(url);
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-device-sensors-csrf",
        expiresAt: Date.now() + 60000,
        services: {
          core: { configured: true, writable: options.coreWritable ?? true },
        },
      });
    if (path === "/api/resources/organizations")
      return reply({ data: [organization], total: 1 });
    if (path === `/api/resources/organizations/${organizationId}`)
      return reply({ data: organization });
    if (path === "/api/resources/hubs") return reply({ data: [hub], total: 1 });
    if (path === `/api/resources/hubs/${hubId}`) return reply({ data: hub });
    if (path === "/api/resources/devices")
      return reply({ data: [device], total: 1 });
    if (path === `/api/resources/devices/${deviceId}`)
      return reply({ data: device });
    if (path === `/api/resources/devicetypes/${deviceTypeId}`)
      return reply({ data: deviceType });
    if (path === "/api/resources/sensors")
      return reply({
        data: sensors,
        total: sensors.length,
      });
    if (path === `/api/resources/sensors/${sensorId}`)
      return reply({ data: sensor });
    if (path === `/api/resources/sensors/${secondSensorId}`)
      return reply({ data: secondSensor });
    if (path === `/api/resources/sensortypes/${sensorTypeId}`)
      return reply({ data: sensorType });
    if (path === `/api/resources/assets/${assetId}`)
      return reply({ data: asset });
    // Every API call is intercepted, including unrelated mounted detail tabs.
    return reply({ data: [], total: 0 });
  });
  return { reads, mutations };
}

function recordRow(page: Page, label: string) {
  return page
    .getByRole("link", { name: label, exact: true })
    .locator("xpath=ancestor::tr");
}

async function openHubDevices(page: Page) {
  await page.goto("/hubs");
  await expect(page.locator(".organization-picker")).toContainText("MStronic");
  await page.getByRole("link", { name: hubLabel, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/hubs/${hubId}$`));
  await page.getByRole("tab", { name: "Devices", exact: true }).click();
  return recordRow(page, deviceLabel);
}

async function expectAssociatedSensors(page: Page) {
  await expect(
    page.getByRole("tab", { name: "Sensors", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const row = recordRow(page, sensorLabel);
  await expect(
    row.getByRole("link", { name: sensorLabel, exact: true }),
  ).toHaveAttribute("href", `/sensors/${sensorId}`);
  const valueColumn = await page
    .getByRole("columnheader", { name: "Last reported value", exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
  await expect(row.getByRole("cell").nth(valueColumn)).toHaveText(realValue);
  const timeColumn = await page
    .getByRole("columnheader", { name: "Last reading", exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
  await expect(row.getByRole("cell").nth(timeColumn)).toHaveText(
    lastReadingLocal,
  );
  await expect(
    row.getByRole("cell").nth(timeColumn).locator("time"),
  ).toHaveAttribute("datetime", lastReadingInstant);
  const assetColumn = await page
    .getByRole("columnheader", { name: "Asset", exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
  const assetCell = row.getByRole("cell").nth(assetColumn);
  await expect(assetCell.getByRole("link")).toHaveCount(2);
  for (const name of [assetTag, assetLabel]) {
    const link = assetCell.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", `/assets/${assetId}`);
    await expect(link).toHaveCSS("font-size", "14px");
    await expect(link).toHaveCSS("font-weight", "600");
  }
  const id = assetCell.getByText(`#${assetId}`, { exact: true });
  await expect(id).toHaveCSS("font-size", "12px");
  await expect(id).toHaveCSS("color", "rgb(138, 154, 165)");
  return row;
}

test("hub devices offer an explicit sensor action while realtime remains a device type link", async ({
  page,
}) => {
  const mock = await syntheticHierarchy(page);
  const device = await openHubDevices(page);
  await expect(
    device.getByRole("link", { name: "realtime", exact: true }),
  ).toHaveAttribute("href", `/devicetypes/${deviceTypeId}`);
  const sensors = device.getByRole("link", {
    name: "View sensors",
    exact: true,
  });
  await expect(sensors).toHaveAttribute(
    "href",
    `/devices/${deviceId}?tab=sensors`,
  );
  await sensors.click();
  await expect(page).toHaveURL(`/devices/${deviceId}?tab=sensors`);
  await expect(
    page.getByRole("heading", { name: deviceLabel, exact: true }),
  ).toBeVisible();
  const row = await expectAssociatedSensors(page);
  const hubDeviceReads = mock.reads.filter(
    (url) =>
      url.pathname === "/api/resources/devices" &&
      url.searchParams.has("idhub"),
  );
  expect(hubDeviceReads.length).toBeGreaterThan(0);
  expect(
    hubDeviceReads.every(
      (url) =>
        url.searchParams.get("idhub") === hubId &&
        url.searchParams.get("_organization") === organizationId,
    ),
  ).toBe(true);
  const sensorReads = mock.reads.filter(
    (url) => url.pathname === "/api/resources/sensors",
  );
  expect(sensorReads.length).toBeGreaterThan(0);
  expect(
    sensorReads.every(
      (url) =>
        url.searchParams.get("iddevice") === deviceId &&
        url.searchParams.get("_organization") === organizationId,
    ),
  ).toBe(true);
  await row.getByRole("link", { name: sensorLabel, exact: true }).click();
  await expect(page).toHaveURL(`/sensors/${sensorId}`);
  await expect(
    page.getByRole("heading", { name: sensorLabel, exact: true }),
  ).toBeVisible();
  const readingTime = page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: /^Last reading$/ })
    .locator("xpath=following-sibling::*[1]");
  await expect(readingTime).toHaveText(lastReadingLocal);
  await expect(readingTime.locator("time")).toHaveAttribute(
    "datetime",
    lastReadingInstant,
  );
  expect(mock.mutations).toEqual([]);
});

test("device detail exposes its sensors button and keeps manual tab selection in the URL", async ({
  page,
}) => {
  const mock = await syntheticHierarchy(page);
  await page.goto(`/devices/${deviceId}`);
  await expect(
    page.getByRole("tab", { name: "Details", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(
    mock.reads.filter((url) => url.pathname === "/api/resources/sensors"),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "View sensors", exact: true }).click();
  await expect(page).toHaveURL(`/devices/${deviceId}?tab=sensors`);
  await expectAssociatedSensors(page);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Details", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(new URL(page.url()).searchParams.get("tab")).not.toBe("sensors");
  await expect(page.locator(".ant-descriptions")).toBeVisible();
  await page.getByRole("tab", { name: "Sensors", exact: true }).click();
  await expect(page).toHaveURL(`/devices/${deviceId}?tab=sensors`);
  await expectAssociatedSensors(page);
  await page.reload();
  await expectAssociatedSensors(page);
  expect(mock.mutations).toEqual([]);
});

test("the global Devices list opens the individual device sensor tab", async ({
  page,
}) => {
  const mock = await syntheticHierarchy(page);
  await page.goto("/devices");
  const row = recordRow(page, deviceLabel);
  const action = row.getByRole("link", { name: "View sensors", exact: true });
  await expect(action).toHaveAttribute(
    "href",
    `/devices/${deviceId}?tab=sensors`,
  );
  await action.click();
  await expectAssociatedSensors(page);
  expect(
    mock.reads.some(
      (url) =>
        url.pathname === "/api/resources/sensors" &&
        url.searchParams.get("iddevice") === deviceId &&
        url.searchParams.get("_organization") === organizationId,
    ),
  ).toBe(true);
  expect(mock.mutations).toEqual([]);
});

test("a direct device sensor URL retains the selected tab and displays an empty list", async ({
  page,
}) => {
  const mock = await syntheticHierarchy(page, { emptySensors: true });
  await page.goto(`/devices/${deviceId}?tab=sensors`);
  await expect(
    page.getByRole("heading", { name: deviceLabel, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Sensors", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("columnheader", {
      name: "Last reported value",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".ant-empty-description")).toHaveText("No data");
  expect(
    mock.reads.some(
      (url) =>
        url.pathname === "/api/resources/sensors" &&
        url.searchParams.get("iddevice") === deviceId,
    ),
  ).toBe(true);
  expect(mock.mutations).toEqual([]);
});

test("sensor permissions hide navigation actions and prevent reads even for a direct sensor-tab URL", async ({
  page,
}) => {
  const mock = await syntheticHierarchy(page, { canReadSensors: false });
  const hubDevice = await openHubDevices(page);
  await expect(
    hubDevice.getByRole("link", { name: "View sensors", exact: true }),
  ).toHaveCount(0);
  await hubDevice.getByRole("link", { name: deviceLabel, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: deviceLabel, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View sensors", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Sensors", exact: true }).click();
  await expect(
    page.getByText("You do not have access to these records.", { exact: true }),
  ).toBeVisible();
  await page.goto(`/devices/${deviceId}?tab=sensors`);
  await expect(
    page.getByText("You do not have access to these records.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View sensors", exact: true }),
  ).toHaveCount(0);
  await page.goto("/devices");
  await expect(
    recordRow(page, deviceLabel).getByRole("link", {
      name: "View sensors",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    mock.reads.filter((url) =>
      url.pathname.startsWith("/api/resources/sensors"),
    ),
  ).toHaveLength(0);
  expect(mock.mutations).toEqual([]);
});

test("device sensor actions stay on sensor rows and refresh only the filtered sensor list", async ({
  page,
}, testInfo) => {
  const mock = await syntheticHierarchy(page, {
    deviceRights: "rud",
    sensorRights: "rud",
    secondSensor: true,
  });
  const device = await openHubDevices(page);
  await device.getByRole("link", { name: "View sensors", exact: true }).click();
  await expectAssociatedSensors(page);
  await expect(
    page.getByRole("columnheader", { name: "Actions", exact: true }),
  ).toBeVisible();
  for (const action of ["Refresh", "View sensors", "Edit", "Delete"])
    await expect(
      page.locator(".page-heading").getByRole("button", {
        name: new RegExp(`${action}$`),
      }),
    ).toHaveCount(0);
  for (const [id, label] of [
    [sensorId, sensorLabel],
    [secondSensorId, secondSensorLabel],
  ]) {
    const row = recordRow(page, label);
    await expect(
      row.getByRole("link", { name: "View", exact: true }),
    ).toHaveAttribute("href", `/sensors/${id}`);
    await expect(
      row.getByRole("link", { name: "Edit", exact: true }),
    ).toHaveAttribute("href", `/sensors/${id}/edit`);
    await expect(
      row.getByRole("button", { name: "Delete", exact: true }),
    ).toBeVisible();
  }

  const readsBeforeRefresh = mock.reads.length;
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect
    .poll(
      () =>
        mock.reads
          .slice(readsBeforeRefresh)
          .filter((url) => url.pathname === "/api/resources/sensors").length,
    )
    .toBeGreaterThan(0);
  const refreshedSensors = mock.reads
    .slice(readsBeforeRefresh)
    .filter((url) => url.pathname === "/api/resources/sensors");
  expect(
    refreshedSensors.every(
      (url) =>
        url.searchParams.get("iddevice") === deviceId &&
        url.searchParams.get("_organization") === organizationId,
    ),
  ).toBe(true);
  expect(
    mock.reads
      .slice(readsBeforeRefresh)
      .filter((url) => url.pathname === `/api/resources/devices/${deviceId}`),
  ).toHaveLength(0);
  await expect(page).toHaveURL(`/devices/${deviceId}?tab=sensors`);
  await page.screenshot({
    path: testInfo.outputPath("sensor-row-actions.png"),
    fullPage: true,
  });

  await page.getByRole("tab", { name: "Details", exact: true }).click();
  for (const action of ["Refresh", "View sensors", "Edit", "Delete"])
    await expect(
      page.locator(".page-heading").getByRole("button", {
        name: new RegExp(`${action}$`),
      }),
    ).toBeVisible();
  expect(mock.mutations).toEqual([]);
});

test("sensor row View and Edit navigate to the selected sensor with read-only device permission", async ({
  page,
}) => {
  const mock = await syntheticHierarchy(page, {
    deviceRights: "r",
    sensorRights: "rud",
    secondSensor: true,
  });
  await page.goto(`/devices/${deviceId}?tab=sensors`);
  const row = recordRow(page, secondSensorLabel);
  await row.getByRole("link", { name: "View", exact: true }).click();
  await expect(page).toHaveURL(`/sensors/${secondSensorId}`);
  await expect(
    page.getByRole("heading", { name: secondSensorLabel, exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(`/devices/${deviceId}?tab=sensors`);
  await row.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(`/sensors/${secondSensorId}/edit`);
  expect(mock.mutations).toEqual([]);
});

test("sensor row deletion confirms the selected sensor and retains the device sensor tab", async ({
  page,
}) => {
  const mock = await syntheticHierarchy(page, {
    deviceRights: "rud",
    sensorRights: "rud",
    secondSensor: true,
  });
  await page.goto(`/devices/${deviceId}?tab=sensors`);
  const first = recordRow(page, sensorLabel);
  const second = recordRow(page, secondSensorLabel);
  await expect(first).toBeVisible();
  await second.getByRole("button", { name: "Delete", exact: true }).click();
  const confirmation = page.getByRole("dialog");
  await expect(confirmation).toContainText("Delete this sensor?");
  await expect(confirmation).toContainText(secondSensorLabel);
  await expect(confirmation).not.toContainText(deviceLabel);
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expect(second).toBeVisible();
  expect(mock.mutations).toEqual([]);

  const readsBeforeDelete = mock.reads.length;
  await second.getByRole("button", { name: "Delete", exact: true }).click();
  await confirmation
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(second).toHaveCount(0);
  await expect(first).toBeVisible();
  await expect(page).toHaveURL(`/devices/${deviceId}?tab=sensors`);
  expect(mock.mutations).toEqual([
    `DELETE /api/resources/sensors/${secondSensorId}`,
  ]);
  const refreshedSensors = mock.reads
    .slice(readsBeforeDelete)
    .filter((url) => url.pathname === "/api/resources/sensors");
  expect(refreshedSensors.length).toBeGreaterThan(0);
  expect(
    refreshedSensors.every(
      (url) =>
        url.searchParams.get("iddevice") === deviceId &&
        url.searchParams.get("_organization") === organizationId,
    ),
  ).toBe(true);
});

for (const permissions of [
  {
    name: "read-only sensors with writable devices",
    sensorRights: "r",
    deviceRights: "rud",
    edit: false,
    remove: false,
  },
  {
    name: "sensor edit permission with read-only devices",
    sensorRights: "ru",
    deviceRights: "r",
    edit: true,
    remove: false,
  },
  {
    name: "sensor delete permission with read-only devices",
    sensorRights: "rd",
    deviceRights: "r",
    edit: false,
    remove: true,
  },
  {
    name: "disabled core service writes",
    sensorRights: "rud",
    deviceRights: "rud",
    coreWritable: false,
    edit: false,
    remove: false,
  },
])
  test(`sensor row actions respect ${permissions.name}`, async ({ page }) => {
    const mock = await syntheticHierarchy(page, permissions);
    await page.goto(`/devices/${deviceId}?tab=sensors`);
    const row = await expectAssociatedSensors(page);
    await expect(
      row.getByRole("link", { name: "View", exact: true }),
    ).toHaveAttribute("href", `/sensors/${sensorId}`);
    await expect(
      row.getByRole("link", { name: "Edit", exact: true }),
    ).toHaveCount(permissions.edit ? 1 : 0);
    await expect(
      row.getByRole("button", { name: "Delete", exact: true }),
    ).toHaveCount(permissions.remove ? 1 : 0);
    expect(mock.mutations).toEqual([]);
  });
