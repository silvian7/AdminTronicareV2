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
    canReadDeviceTypes?: boolean;
    deviceStatus?: number;
    deviceTypeStatus?: number;
    deviceTypeTag?: string;
    missingDeviceType?: boolean;
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
      ...(options.canReadDeviceTypes === false
        ? []
        : [{ entity: "devicetypes", rights: "r" }]),
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
    m_nIDAsset: assetId,
    m_sTag: "SYNTHETIC-MSTRONIC-HUB",
    m_sLabel: hubLabel,
  };
  const device = {
    id: deviceId,
    IDDevice: deviceId,
    IDDeviceType: options.missingDeviceType ? undefined : deviceTypeId,
    IDHub: hubId,
    IDOrganization: organizationId,
    IDAsset: assetId,
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
    Tag: options.deviceTypeTag ?? "realtime",
    Label: "Synthetic realtime device type",
  };
  const deviceTypes: Record<string, RecordData> = {
    [deviceTypeId]: deviceType,
  };
  let deviceStatus = options.deviceStatus ?? 200;
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
    m_sTag: JSON.stringify({
      messages: [
        { lang: 5, text: "SYNTHETIC-FRENCH-ASSET-TAG" },
        { lang: 3, text: assetTag },
      ],
    }),
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
      return deviceStatus === 200
        ? reply({ data: device })
        : reply(
            { message: "Synthetic device reference unavailable." },
            deviceStatus,
          );
    if (path.startsWith("/api/resources/devicetypes/")) {
      const id = path.split("/").at(-1)!;
      const type = deviceTypes[id];
      const status = options.deviceTypeStatus ?? (type ? 200 : 404);
      return status === 200
        ? reply({ data: type })
        : reply(
            { message: "Synthetic device type reference unavailable." },
            status,
          );
    }
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
  return {
    reads,
    mutations,
    reassignDeviceType: (id: string, tag: string) => {
      device.IDDeviceType = id;
      deviceTypes[id] = { ...deviceType, id, IDDeviceType: id, Tag: tag };
    },
    updateDeviceTypeTag: (id: string, tag: string) => {
      if (deviceTypes[id]) deviceTypes[id].Tag = tag;
    },
    denyDeviceReferences: () => {
      deviceStatus = 403;
    },
  };
}

function deviceRow(page: Page) {
  return page
    .getByRole("link", { name: deviceId, exact: true })
    .locator("xpath=ancestor::tr");
}

async function expectDeviceListIdentity(page: Page) {
  await expect(page.getByRole("columnheader").first()).toHaveText("ID");
  const row = deviceRow(page);
  await expect(row.getByRole("cell").first()).toHaveText(deviceId);
  await expect(
    row.getByRole("link", { name: deviceId, exact: true }),
  ).toHaveAttribute("href", `/devices/${deviceId}`);
  return row;
}

function sensorRow(page: Page, id: string) {
  return page
    .getByRole("cell", { name: id, exact: true })
    .locator("xpath=ancestor::tr");
}

async function sensorDeviceCell(page: Page) {
  const column = await page
    .getByRole("columnheader", { name: "Device", exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
  return sensorRow(page, sensorId).getByRole("cell").nth(column);
}

test("global and nested sensor lists identify devices by their type tag and exact device ID", async ({
  page,
}) => {
  const mock = await syntheticHierarchy(page);
  for (const path of ["/sensors", `/devices/${deviceId}?tab=sensors`]) {
    await page.goto(path);
    await expect(sensorRow(page, sensorId)).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Sensor", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: sensorLabel, exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(sensorLabel, { exact: true })).toHaveCount(0);
    const cell = await sensorDeviceCell(page);
    await expect(
      cell.getByRole("link", { name: "realtime", exact: true }),
    ).toHaveAttribute("href", `/devices/${deviceId}`);
    await expect(cell.getByRole("link")).toHaveCount(1);
    await expect(cell.getByText(`#${deviceId}`, { exact: true })).toHaveCSS(
      "font-size",
      "12px",
    );
    await expect(cell).not.toContainText(deviceLabel);
    await expect(cell).not.toContainText("SYNTHETIC-REALTIME-DEVICE");
    const row = sensorRow(page, sensorId);
    await expect(
      row.getByRole("link", { name: "SYNTHETIC-REAL-TYPE", exact: true }),
    ).toHaveAttribute("href", `/sensortypes/${sensorTypeId}`);
    if (path === "/sensors")
      await expect(row.getByText("No", { exact: true })).toBeVisible();
    else {
      await expect(row.getByText(realValue, { exact: true })).toBeVisible();
      await expect(
        row.getByText(lastReadingLocal, { exact: true }),
      ).toBeVisible();
    }
  }
  expect(mock.mutations).toEqual([]);
});

test("sensor list Refresh follows device type reassignment and tag changes and clears denied references", async ({
  page,
}) => {
  const mock = await syntheticHierarchy(page);
  await page.goto(`/devices/${deviceId}?tab=sensors`);
  const cell = await sensorDeviceCell(page);
  await expect(
    cell.getByRole("link", { name: "realtime", exact: true }),
  ).toBeVisible();
  const reassignedTypeId = "9223372036854775799";
  mock.reassignDeviceType(reassignedTypeId, "SYNTHETIC-REASSIGNED-TYPE");
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(
    cell.getByRole("link", { name: "SYNTHETIC-REASSIGNED-TYPE", exact: true }),
  ).toHaveAttribute("href", `/devices/${deviceId}`);
  expect(
    mock.reads.some(
      (url) =>
        url.pathname === `/api/resources/devicetypes/${reassignedTypeId}`,
    ),
  ).toBe(true);
  const renamedTag = "SYNTHETIC-RENAMED-DEVICE-TYPE";
  mock.updateDeviceTypeTag(
    reassignedTypeId,
    JSON.stringify({
      messages: [
        { lang: "fr", text: "SYNTHETIC-FRENCH-DEVICE-TYPE" },
        { lang: "en", text: renamedTag },
      ],
    }),
  );
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(
    cell.getByRole("link", { name: renamedTag, exact: true }),
  ).toHaveAttribute("href", `/devices/${deviceId}`);
  await expect(cell).not.toContainText("SYNTHETIC-REASSIGNED-TYPE");
  await expect(cell).not.toContainText("SYNTHETIC-FRENCH-DEVICE-TYPE");
  mock.denyDeviceReferences();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(
    cell.getByRole("link", { name: renamedTag, exact: true }),
  ).toHaveCount(0);
  await expect(
    cell.getByRole("link", { name: `#${deviceId}`, exact: true }),
  ).toHaveAttribute("href", `/devices/${deviceId}`);
  await expect(cell.getByText(`#${deviceId}`, { exact: true })).toBeVisible();
  await expect(cell).not.toContainText(renamedTag);
  await expect(
    sensorRow(page, sensorId).getByText(realValue, { exact: true }),
  ).toBeVisible();
  await expect(
    sensorRow(page, sensorId).getByRole("link", {
      name: "SYNTHETIC-REAL-TYPE",
      exact: true,
    }),
  ).toHaveAttribute("href", `/sensortypes/${sensorTypeId}`);
  await expect(page).toHaveURL(`/devices/${deviceId}?tab=sensors`);
  expect(mock.mutations).toEqual([]);
});

test("sensor device cells retain the exact ID without fetching or exposing unavailable references", async ({
  page,
}) => {
  const cases = [
    {
      name: "device permission denied",
      options: { deviceRights: "" },
      readDevice: false,
      readType: false,
    },
    {
      name: "device type permission denied",
      options: { canReadDeviceTypes: false },
      readDevice: true,
      readType: false,
    },
    {
      name: "device reference missing",
      options: { deviceStatus: 404 },
      readDevice: true,
      readType: false,
    },
    {
      name: "device type reference denied",
      options: { deviceTypeStatus: 403 },
      readDevice: true,
      readType: true,
    },
    {
      name: "device type unassigned",
      options: { missingDeviceType: true },
      readDevice: true,
      readType: false,
    },
    {
      name: "device type tag empty",
      options: { deviceTypeTag: "" },
      readDevice: true,
      readType: true,
    },
  ];
  for (const scenario of cases) {
    await test.step(scenario.name, async () => {
      const casePage = await page.context().newPage();
      try {
        const mock = await syntheticHierarchy(casePage, scenario.options);
        await casePage.goto("/sensors");
        const cell = await sensorDeviceCell(casePage);
        await expect(
          cell.getByText(`#${deviceId}`, { exact: true }),
        ).toBeVisible();
        await casePage.waitForLoadState("networkidle");
        if (scenario.readDevice) {
          await expect(cell.getByRole("link")).toHaveCount(1);
          await expect(
            cell.getByRole("link", { name: `#${deviceId}`, exact: true }),
          ).toHaveAttribute("href", `/devices/${deviceId}`);
        } else await expect(cell.getByRole("link")).toHaveCount(0);
        for (const text of [
          "realtime",
          "Synthetic realtime device type",
          deviceLabel,
          "SYNTHETIC-REALTIME-DEVICE",
        ])
          await expect(cell).not.toContainText(text);
        const deviceReads = mock.reads.filter(
          (url) => url.pathname === `/api/resources/devices/${deviceId}`,
        );
        const typeReads = mock.reads.filter((url) =>
          url.pathname.startsWith("/api/resources/devicetypes/"),
        );
        if (scenario.readDevice) expect(deviceReads.length).toBeGreaterThan(0);
        else expect(deviceReads).toHaveLength(0);
        if (scenario.readType) expect(typeReads.length).toBeGreaterThan(0);
        else expect(typeReads).toHaveLength(0);
        await expect(
          sensorRow(casePage, sensorId).getByText("No", {
            exact: true,
          }),
        ).toBeVisible();
        expect(mock.mutations).toEqual([]);
      } finally {
        await casePage.close();
      }
    });
  }
});

async function openHub(page: Page) {
  await page.goto("/hubs");
  await expect(page.locator(".organization-picker")).toContainText(
    "MSTRONIC-SYNTHETIC",
  );
  await page.getByRole("link", { name: hubLabel, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/hubs/${hubId}$`));
}

async function openHubDevices(page: Page) {
  await openHub(page);
  await page.getByRole("tab", { name: /^Devices(?: \(\d+\+?\))?$/ }).click();
  return expectDeviceListIdentity(page);
}

async function expectAssociatedSensors(page: Page) {
  await expect(
    page.getByRole("tab", { name: /^Sensors(?: \(\d+\+?\))?$/ }),
  ).toHaveAttribute("aria-selected", "true");
  const row = sensorRow(page, sensorId);
  await expect(row).toHaveClass(/clickable-record-row/);
  await expect(row).toHaveAttribute("tabindex", "0");
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
}, testInfo) => {
  const mock = await syntheticHierarchy(page);
  await openHub(page);
  await expect(
    page.getByRole("tab", { name: "Details", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const organization = page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: /^Organization$/ })
    .locator("xpath=following-sibling::*[1]");
  await expect(organization).toHaveText("MSTRONIC-SYNTHETIC");
  await expect(
    organization.getByRole("link", {
      name: "MSTRONIC-SYNTHETIC",
      exact: true,
    }),
  ).toHaveAttribute("href", "/organizations/7");
  await expect(organization).not.toContainText("MStronic");
  await expect(organization).not.toContainText("#7");
  const hubAsset = page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: /^Asset$/ })
    .locator("xpath=following-sibling::*[1]");
  await expect(hubAsset.getByRole("link")).toHaveCount(2);
  for (const name of [assetTag, assetLabel])
    await expect(
      hubAsset.getByRole("link", { name, exact: true }),
    ).toHaveAttribute("href", `/assets/${assetId}`);
  await expect(hubAsset).not.toContainText(`#${assetId}`);
  await expect(hubAsset).not.toContainText("SYNTHETIC-FRENCH-ASSET-TAG");
  await expect(hubAsset).not.toContainText("Synthetic French asset label");
  await page.screenshot({
    path: testInfo.outputPath("hub-organization-asset-identities.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: /^Devices(?: \(\d+\+?\))?$/ }).click();
  const device = await expectDeviceListIdentity(page);
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
  await row.getByRole("cell", { name: sensorId, exact: true }).click();
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
  const asset = page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: /^Asset$/ })
    .locator("xpath=following-sibling::*[1]");
  await expect(asset).toHaveText(`${assetTag} (#${assetId})`);
  await expect(asset.getByRole("link")).toHaveCount(1);
  await expect(
    asset.getByRole("link", {
      name: `${assetTag} (#${assetId})`,
      exact: true,
    }),
  ).toHaveAttribute("href", `/assets/${assetId}`);
  await expect(asset).not.toContainText(assetLabel);
  await expect(asset).not.toContainText("SYNTHETIC-FRENCH-ASSET-TAG");
  await page.screenshot({
    path: testInfo.outputPath("sensor-asset-tag-id.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(mock.mutations).toEqual([]);
});

test("device detail exposes its sensors button and keeps manual tab selection in the URL", async ({
  page,
}, testInfo) => {
  const mock = await syntheticHierarchy(page);
  await page.goto(`/devices/${deviceId}`);
  await expect(
    page.getByRole("tab", { name: "Details", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const organization = page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: /^Organization$/ })
    .locator("xpath=following-sibling::*[1]");
  await expect(organization).toHaveText("MSTRONIC-SYNTHETIC");
  await expect(
    organization.getByRole("link", {
      name: "MSTRONIC-SYNTHETIC",
      exact: true,
    }),
  ).toHaveAttribute("href", "/organizations/7");
  await expect(organization.getByText("MStronic", { exact: true })).toHaveCount(
    0,
  );
  await expect(organization).not.toContainText("#7");
  const asset = page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: /^Asset$/ })
    .locator("xpath=following-sibling::*[1]");
  for (const name of [assetTag, assetLabel])
    await expect(
      asset.getByRole("link", { name, exact: true }),
    ).toHaveAttribute("href", `/assets/${assetId}`);
  await expect(asset.getByText(`#${assetId}`, { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("device-asset-identity.png"),
    fullPage: true,
    animations: "disabled",
  });
  await expect(
    page.getByRole("tab", { name: "Sensors (1)", exact: true }),
  ).toBeVisible();
  const prefetchedSensors = mock.reads.filter(
    (url) => url.pathname === "/api/resources/sensors",
  );
  expect(prefetchedSensors).toHaveLength(1);
  expect(prefetchedSensors[0]!.searchParams.get("iddevice")).toBe(deviceId);
  expect(prefetchedSensors[0]!.searchParams.get("_organization")).toBe(
    organizationId,
  );
  await page.getByRole("button", { name: "View sensors", exact: true }).click();
  await expect(page).toHaveURL(`/devices/${deviceId}?tab=sensors`);
  await expectAssociatedSensors(page);
  expect(
    mock.reads.filter((url) => url.pathname === "/api/resources/sensors"),
  ).toHaveLength(prefetchedSensors.length);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Details", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(new URL(page.url()).searchParams.get("tab")).not.toBe("sensors");
  await expect(page.locator(".ant-descriptions").first()).toBeVisible();
  await page.getByRole("tab", { name: /^Sensors(?: \(\d+\+?\))?$/ }).click();
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
  const row = await expectDeviceListIdentity(page);
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
    page.getByRole("tab", { name: /^Sensors(?: \(\d+\+?\))?$/ }),
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
  await hubDevice.getByRole("link", { name: deviceId, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: deviceLabel, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View sensors", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /^Sensors(?: \(\d+\+?\))?$/ }).click();
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
    deviceRow(page).getByRole("link", {
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
  for (const id of [sensorId, secondSensorId]) {
    const row = sensorRow(page, id);
    await expect(row).toHaveClass(/clickable-record-row/);
    await expect(row).toHaveAttribute("tabindex", "0");
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
      .filter((url) => url.pathname === "/api/resources/devices"),
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

test("sensor row click and Edit navigate to the selected sensor with read-only device permission", async ({
  page,
}) => {
  const mock = await syntheticHierarchy(page, {
    deviceRights: "r",
    sensorRights: "rud",
    secondSensor: true,
  });
  await page.goto(`/devices/${deviceId}?tab=sensors`);
  const row = sensorRow(page, secondSensorId);
  await row.getByRole("cell", { name: secondSensorId, exact: true }).click();
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
  const first = sensorRow(page, sensorId);
  const second = sensorRow(page, secondSensorId);
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
    await expect(row).toHaveClass(/clickable-record-row/);
    await expect(row).toHaveAttribute("tabindex", "0");
    await expect(
      row.getByRole("link", { name: "Edit", exact: true }),
    ).toHaveCount(permissions.edit ? 1 : 0);
    await expect(
      row.getByRole("button", { name: "Delete", exact: true }),
    ).toHaveCount(permissions.remove ? 1 : 0);
    expect(mock.mutations).toEqual([]);
  });
