import { expect, test, type Page } from "@playwright/test";
import { type Identity, type RecordData } from "../../shared/resources";

test.use({ timezoneId: "Europe/Brussels" });

const organizationId = "7";
const hubId = "1407374883553285";
const deviceId = "9223372036854775806";
const sensorId = "9223372036854775805";
const deviceTypeId = "81";
const sensorTypeId = "71";
const hubLabel = "Synthetic MStronic hub";
const deviceLabel = "Synthetic realtime device";
const sensorLabel = "Synthetic associated sensor";
const realValue = "21.37500000000000000009";
const lastReading = "2025-01-06T08:30:45Z";
const lastReadingUtc = "2025-01-06 08:30:45 UTC";

async function syntheticHierarchy(
  page: Page,
  options: { canReadSensors?: boolean; emptySensors?: boolean } = {},
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
      { entity: "hubs", rights: "r" },
      { entity: "devices", rights: "r" },
      { entity: "devicetypes", rights: "r" },
      { entity: "sensortypes", rights: "r" },
      ...(options.canReadSensors === false
        ? []
        : [{ entity: "sensors", rights: "r" }]),
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
    m_sTag: "SYNTHETIC-ASSOCIATED-SENSOR",
    m_sLabel: sensorLabel,
    m_bValueBool: false,
    m_nValueInt: "0",
    m_rValueReal: realValue,
    m_dhDhLastEvent: lastReading,
  };
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
  const reads: URL[] = [];
  const mutations: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    reads.push(url);
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (request.method() !== "GET") {
      mutations.push(`${request.method()} ${path}`);
      return reply({ message: "Synthetic read-only fixture." }, 405);
    }
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-device-sensors-csrf",
        expiresAt: Date.now() + 60000,
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
        data: options.emptySensors ? [] : [sensor],
        total: options.emptySensors ? 0 : 1,
      });
    if (path === `/api/resources/sensors/${sensorId}`)
      return reply({ data: sensor });
    if (path === `/api/resources/sensortypes/${sensorTypeId}`)
      return reply({ data: sensorType });
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
    .getByRole("columnheader", { name: "Last reading (UTC)", exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
  await expect(row.getByRole("cell").nth(timeColumn)).toHaveText(
    lastReadingUtc,
  );
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
    .filter({ hasText: /^Last reading \(UTC\)$/ })
    .locator("xpath=following-sibling::*[1]");
  await expect(readingTime).toHaveText(lastReadingUtc);
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
