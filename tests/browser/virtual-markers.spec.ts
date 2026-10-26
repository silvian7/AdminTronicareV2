import { expect, test, type Locator, type Page } from "@playwright/test";
import type { RecordData } from "../../shared/resources";

test.use({ locale: "en-GB", timezoneId: "Europe/Brussels" });

const virtualId = "9223372036854775807";
const ordinaryId = "9223372036854775806";
const translatedId = "9223372036854775805";
const blankId = "9223372036854775804";
const assetId = "9223372036854775803";
const deviceId = "9223372036854775802";
const sensorId = "9223372036854775801";
const typeId = "9223372036854775800";
const sensorTypeId = "9223372036854775799";
const markerSelector = '[aria-label="Virtual element"]';
const primaryKeys: Record<string, string> = {
  assets: "m_nIDAsset",
  hubs: "m_nIDHub",
  devices: "IDDevice",
  sensors: "m_nIDSensor",
  rules: "m_nIDRule",
  assettypes: "m_nIDAssetType",
  devicetypes: "m_nIDDeviceType",
  sensortypes: "m_nIDSensorType",
};

function record(
  resource: string,
  id: string,
  tag: unknown,
  label: string,
): RecordData {
  const core = resource === "devices";
  const row: RecordData = {
    id,
    [primaryKeys[resource]]: id,
    [core ? "Tag" : "m_sTag"]: tag,
    [core ? "Label" : "m_sLabel"]: label,
  };
  if (resource === "assets")
    Object.assign(row, { m_nIDOrganization: "7", m_nIDAssetType: "0" });
  if (resource === "hubs")
    Object.assign(row, {
      m_nIDOrganization: "7",
      m_nIDAsset: "0",
      m_nIDHubType: "0",
    });
  if (resource === "devices")
    Object.assign(row, {
      IDOrganization: "7",
      IDAsset: "0",
      IDHub: "0",
      IDDeviceType: "0",
    });
  if (resource === "sensors")
    Object.assign(row, {
      m_nIDAsset: "0",
      m_nIDDevice: "0",
      m_nIDSensorType: "0",
      m_bValueBool: false,
    });
  if (resource === "rules")
    Object.assign(row, {
      m_nIDAsset: "0",
      m_nIDSensor: "0",
      m_nIDRuleType: "0",
      m_bIsTemplate: false,
      m_bEnabled: false,
      m_duValueDuree: "12501",
      m_nValueThreshold: "17",
      m_nResetDelayMs: "1001",
      m_hTimeStart: "08:00:00",
      m_hTimeEnd: "16:00:00",
      m_bTime24h: false,
    });
  return row;
}

async function syntheticApi(
  page: Page,
  data: Record<string, RecordData[]>,
  permissions: Record<string, string>,
) {
  const reads: URL[] = [];
  const writes: { method: string; path: string }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (value: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(value),
      });
    if (request.method() !== "GET") {
      writes.push({ method: request.method(), path: url.pathname });
      return reply({ message: "Unexpected synthetic mutation." }, 405);
    }
    reads.push(url);
    if (url.pathname === "/api/session")
      return reply({
        identity: {
          id: "100",
          name: "Synthetic virtual element reader",
          organizationId: "7",
          userTypeId: "30",
          level: 30,
          mustChangePassword: false,
          permissions: Object.entries(permissions).map(([entity, rights]) => ({
            entity,
            rights,
          })),
        },
        csrf: "synthetic-virtual-marker-csrf",
        expiresAt: Date.now() + 3_600_000,
        services: {
          users: { configured: true, writable: true },
          assets: { configured: true, writable: true },
          core: { configured: true, writable: true },
          rules: { configured: true, writable: true },
        },
      });
    const match = /^\/api\/resources\/([^/]+)(?:\/([^/]+))?$/.exec(
      url.pathname,
    );
    if (match) {
      const rows = data[match[1]] ?? [];
      if (!match[2]) return reply({ data: rows, total: rows.length });
      const row = rows.find((candidate) => candidate.id === match[2]);
      return row
        ? reply({ data: row })
        : reply({ message: "Synthetic record unavailable." }, 404);
    }
    // Every API endpoint, including optional ancillary reads, is intercepted.
    return reply({ data: [], total: 0 });
  });
  return { reads, writes, errors };
}

function row(page: Page, id: string) {
  return page.locator(`tr[data-row-key="${id}"]`);
}

function formItem(page: Page, key: string) {
  return page
    .locator(".ant-form-item")
    .filter({ has: page.locator(`[id="${key}"]`) });
}

async function tableCell(page: Page, recordRow: Locator, name: string) {
  const index = await page
    .getByRole("columnheader", { name, exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
  return recordRow.getByRole("cell").nth(index);
}

function detailValue(page: Page, name: string) {
  return page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: new RegExp(`^${name}$`) })
    .locator("xpath=following-sibling::*[1]");
}

async function screenshotAtTop(page: Page, path: string) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.scrollTo(0, 0);
        requestAnimationFrame(() => resolve());
      }),
  );
  await page.screenshot({ path, animations: "disabled" });
}

for (const resource of ["assets", "hubs", "devices", "sensors", "rules"]) {
  test(`${resource} list marks only the displayed virtual Tag without fetching row records`, async ({
    page,
  }, testInfo) => {
    const rows = [
      record(
        resource,
        virtualId,
        JSON.stringify({
          messages: [
            { lang: 5, text: "Ordinary French tag" },
            { lang: "3", text: " virtual-bedroom " },
          ],
        }),
        "Synthetic virtual bedroom",
      ),
      record(resource, ordinaryId, "TEST-bedroom", "VIRTUAL-label-only"),
      record(
        resource,
        translatedId,
        JSON.stringify({
          messages: [
            { lang: 5, text: "VIRTUAL-hidden-translation" },
            { lang: 3, text: "Ordinary displayed tag" },
          ],
        }),
        "Synthetic ordinary translation",
      ),
      record(resource, blankId, "VIRTUAL- \t", "Synthetic incomplete prefix"),
    ];
    const mock = await syntheticApi(
      page,
      { [resource]: rows },
      { [resource]: "r" },
    );
    await page.goto(`/${resource}`);
    const virtualRow = row(page, virtualId);
    const marker = virtualRow.locator(markerSelector);
    await expect(virtualRow).toBeVisible();
    await expect(virtualRow).toContainText(virtualId);
    await expect(marker).toHaveCount(1);
    await expect(marker).toHaveAttribute("role", "img");
    await expect(marker).toHaveText("Virtual");
    await expect(marker).toHaveClass(/ant-tag-geekblue/);
    await expect(marker).toHaveAttribute("tabindex", "0");
    expect(
      await marker.evaluate((element) =>
        Boolean(element.closest("[data-no-row-navigation]")),
      ),
    ).toBe(true);
    const bounds = await marker.boundingBox();
    expect(bounds?.height).toBeLessThan(30);
    expect(bounds?.width).toBeLessThan(100);
    for (const id of [ordinaryId, translatedId, blankId])
      await expect(row(page, id).locator(markerSelector)).toHaveCount(0);
    await marker.focus();
    await expect(marker).toBeFocused();
    await expect(
      page.getByRole("tooltip", { name: "Virtual element" }),
    ).toBeVisible();
    await marker.press("Enter");
    await marker.press("Space");
    await marker.click();
    expect(new URL(page.url()).pathname).toBe(`/${resource}`);
    expect(
      mock.reads.filter((url) =>
        new RegExp(`^/api/resources/${resource}/[^/]+$`).test(url.pathname),
      ),
    ).toEqual([]);
    expect(mock.writes).toEqual([]);
    expect(mock.errors).toEqual([]);
    if (resource === "assets") {
      await page.getByRole("heading", { name: "Assets", exact: true }).click();
      await expect(
        page.getByRole("tooltip", { name: "Virtual element" }),
      ).not.toBeVisible();
      await screenshotAtTop(
        page,
        testInfo.outputPath("virtual-assets-desktop.png"),
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await screenshotAtTop(
        page,
        testInfo.outputPath("virtual-assets-mobile.png"),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  });
}

test("Rule detail and editor headings keep Virtual outside h1 beside Template and follow unsaved Tag changes", async ({
  page,
}, testInfo) => {
  const source: RecordData = {
    ...record(
      "rules",
      virtualId,
      "VIRTUAL-bedroom",
      "Synthetic virtual rule template",
    ),
    m_bIsTemplate: true,
  };
  const mock = await syntheticApi(page, { rules: [source] }, { rules: "ru" });
  await page.goto(`/rules/${virtualId}`);
  const heading = page.locator(".page-heading");
  await expect(heading.getByRole("heading", { level: 1 })).toHaveText(
    "Synthetic virtual rule template",
  );
  await expect(heading.locator(markerSelector)).toHaveCount(1);
  await expect(heading.locator('[aria-label="Rule template"]')).toHaveCount(1);
  await expect(heading.locator(`h1 ${markerSelector}`)).toHaveCount(0);
  await screenshotAtTop(
    page,
    testInfo.outputPath("virtual-rule-detail-desktop.png"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshotAtTop(
    page,
    testInfo.outputPath("virtual-rule-detail-mobile.png"),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/rules/${virtualId}/edit`);
  await expect(heading.getByRole("heading", { level: 1 })).toHaveText(
    "Edit rule",
  );
  await expect(page.locator('[id="m_sTag"]')).toHaveValue("VIRTUAL-bedroom");
  await expect(heading.locator(markerSelector)).toHaveCount(1);
  await expect(heading.locator(`h1 ${markerSelector}`)).toHaveCount(0);
  await page.locator('[id="m_sTag"]').fill("TEST-bedroom");
  await expect(heading.locator(markerSelector)).toHaveCount(0);
  await expect(heading.locator('[aria-label="Rule template"]')).toHaveCount(1);
  await page.locator('[id="m_sTag"]').fill("VIRTUAL-   ");
  await expect(heading.locator(markerSelector)).toHaveCount(0);
  await page.locator('[id="m_sTag"]').fill("  ViRtUaL-updated  ");
  await expect(heading.locator(markerSelector)).toHaveCount(1);
  expect(source.m_sTag).toBe("VIRTUAL-bedroom");
  expect(mock.writes).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test("Device Sensors related rows use their own existing Tag and preserve the exact parent filter", async ({
  page,
}) => {
  const device = record(
    "devices",
    deviceId,
    "DEVICE-parent",
    "Synthetic parent device",
  );
  const virtualSensor = {
    ...record(
      "sensors",
      sensorId,
      "VIRTUAL-reading",
      "Synthetic nested sensor",
    ),
    m_nIDDevice: deviceId,
  };
  const ordinarySensor = {
    ...record("sensors", ordinaryId, "TEST-reading", "VIRTUAL-label-only"),
    m_nIDDevice: deviceId,
  };
  const mock = await syntheticApi(
    page,
    { devices: [device], sensors: [virtualSensor, ordinarySensor] },
    { devices: "r", sensors: "r" },
  );
  await page.goto(`/devices/${deviceId}?tab=sensors`);
  await expect(
    page.getByRole("tab", { name: "Sensors (2)", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(row(page, sensorId).locator(markerSelector)).toHaveCount(1);
  await expect(row(page, ordinaryId).locator(markerSelector)).toHaveCount(0);
  await expect(page.locator(`.page-heading ${markerSelector}`)).toHaveCount(0);
  expect(
    mock.reads
      .filter((url) => url.pathname === "/api/resources/sensors")
      .map((url) => url.searchParams.get("iddevice")),
  ).toEqual([deviceId]);
  expect(
    mock.reads.filter((url) =>
      /^\/api\/resources\/sensors\/[^/]+$/.test(url.pathname),
    ),
  ).toEqual([]);
  expect(mock.writes).toEqual([]);
  expect(mock.errors).toEqual([]);
});

function referenceRows(): Record<string, RecordData[]> {
  return {
    assets: [
      record("assets", assetId, "VIRTUAL-asset", "Synthetic readable asset"),
    ],
    devices: [
      {
        ...record(
          "devices",
          deviceId,
          "VIRTUAL-device",
          "Synthetic readable device",
        ),
        IDDeviceType: typeId,
      },
    ],
    sensors: [
      {
        ...record(
          "sensors",
          sensorId,
          "VIRTUAL-sensor",
          "Synthetic readable sensor",
        ),
        m_nIDDevice: deviceId,
        m_nIDAsset: assetId,
        m_nIDSensorType: sensorTypeId,
      },
    ],
    rules: [
      {
        ...record(
          "rules",
          virtualId,
          "RULE-references",
          "Synthetic referencing rule",
        ),
        m_nIDAsset: assetId,
        m_nIDSensor: sensorId,
      },
    ],
    devicetypes: [
      record(
        "devicetypes",
        typeId,
        "DISPLAY-DEVICE-TYPE",
        "Synthetic device type",
      ),
    ],
    sensortypes: [
      record(
        "sensortypes",
        sensorTypeId,
        "DISPLAY-SENSOR-TYPE",
        "Synthetic sensor type",
      ),
    ],
  };
}

test("authorized Asset and Device identities and SensorTypeTag use the referenced record Tag with existing reads", async ({
  page,
}) => {
  const mock = await syntheticApi(page, referenceRows(), {
    assets: "r",
    devices: "r",
    sensors: "r",
    rules: "r",
    devicetypes: "r",
    sensortypes: "r",
  });
  await page.goto("/sensors");
  const sensorRow = row(page, sensorId);
  const deviceCell = await tableCell(page, sensorRow, "Device");
  const assetCell = await tableCell(page, sensorRow, "Asset");
  await expect(
    deviceCell.getByRole("link", { name: "DISPLAY-DEVICE-TYPE", exact: true }),
  ).toHaveAttribute("href", `/devices/${deviceId}`);
  await expect(deviceCell.locator(markerSelector)).toHaveCount(1);
  await expect(
    assetCell.getByRole("link", { name: "VIRTUAL-asset", exact: true }),
  ).toHaveAttribute("href", `/assets/${assetId}`);
  await expect(assetCell.locator(markerSelector)).toHaveCount(1);
  for (const path of [
    `/api/resources/assets/${assetId}`,
    `/api/resources/devices/${deviceId}`,
    `/api/resources/devicetypes/${typeId}`,
  ])
    expect(mock.reads.filter((url) => url.pathname === path)).toHaveLength(1);
  await page.goto(`/rules/${virtualId}`);
  const sensorValue = detailValue(page, "Sensor");
  await expect(
    sensorValue.getByRole("link", { name: "DISPLAY-SENSOR-TYPE", exact: true }),
  ).toHaveAttribute("href", `/sensors/${sensorId}`);
  await expect(sensorValue.locator(markerSelector)).toHaveCount(1);
  await expect(detailValue(page, "Asset").locator(markerSelector)).toHaveCount(
    1,
  );
  expect(
    mock.reads.filter(
      (url) => url.pathname === `/api/resources/sensors/${sensorId}`,
    ),
  ).toHaveLength(1);
  expect(
    mock.reads.filter(
      (url) => url.pathname === `/api/resources/sensortypes/${sensorTypeId}`,
    ),
  ).toHaveLength(2);
  expect(mock.writes).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test("denied reference reads retain ID fallbacks without leaking virtual metadata", async ({
  page,
}) => {
  const data = referenceRows();
  data.sensors[0].m_sTag = "SENSOR-ordinary";
  const permissions: Record<string, string> = { sensors: "r", rules: "r" };
  const mock = await syntheticApi(page, data, permissions);
  await page.goto("/sensors");
  const sensorRow = row(page, sensorId);
  await expect(sensorRow).toBeVisible();
  await expect(sensorRow.locator(markerSelector)).toHaveCount(0);
  await expect(await tableCell(page, sensorRow, "Device")).toContainText(
    `#${deviceId}`,
  );
  await expect(await tableCell(page, sensorRow, "Asset")).toContainText(
    `#${assetId}`,
  );
  expect(
    mock.reads.filter((url) =>
      /^\/api\/resources\/(assets|devices|devicetypes|sensortypes)\/[^/]+$/.test(
        url.pathname,
      ),
    ),
  ).toEqual([]);
  // A fresh session denies the Sensor identity as well as the other references.
  delete permissions.sensors;
  await page.goto(`/rules/${virtualId}`);
  const sensorValue = detailValue(page, "Sensor");
  await expect(sensorValue).toContainText(`#${sensorId}`);
  await expect(sensorValue.locator(markerSelector)).toHaveCount(0);
  await expect(detailValue(page, "Asset").locator(markerSelector)).toHaveCount(
    0,
  );
  expect(
    mock.reads.filter(
      (url) => url.pathname === `/api/resources/sensors/${sensorId}`,
    ),
  ).toEqual([]);
  expect(
    mock.reads.filter((url) =>
      /^\/api\/resources\/(assets|devices|devicetypes|sensortypes)\/[^/]+$/.test(
        url.pathname,
      ),
    ),
  ).toEqual([]);
  expect(mock.writes).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test("generic ReferenceSelect marks options and selected values while retaining original label, search and exact ID", async ({
  page,
}) => {
  const virtualType = record(
    "assettypes",
    typeId,
    "VIRTUAL-type",
    "Selectable virtual type",
  );
  const ordinaryType = record(
    "assettypes",
    ordinaryId,
    "TEST-type",
    "VIRTUAL-label-only",
  );
  const mock = await syntheticApi(
    page,
    { assettypes: [virtualType, ordinaryType] },
    { assets: "cr", assettypes: "r" },
  );
  await page.goto("/assets/new");
  const item = formItem(page, "m_nIDAssetType");
  await item.locator(".ant-select-selector").click();
  const dropdown = page.locator(
    ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
  );
  await expect(dropdown).toHaveCount(1);
  const virtualOption = dropdown
    .locator(".ant-select-item-option")
    .filter({ hasText: typeId });
  const ordinaryOption = dropdown
    .locator(".ant-select-item-option")
    .filter({ hasText: ordinaryId });
  await expect(virtualOption).toContainText(
    `Selectable virtual type \u00b7 ${typeId}`,
  );
  await expect(virtualOption.locator(markerSelector)).toHaveCount(1);
  await expect(ordinaryOption.locator(markerSelector)).toHaveCount(0);
  await item.getByRole("combobox").fill("Selectable virtual type");
  await expect(virtualOption).toBeVisible();
  await expect(ordinaryOption).toHaveCount(0);
  await virtualOption.click();
  const selected = item.locator(".ant-select-selection-item");
  await expect(
    selected.getByText(`Selectable virtual type \u00b7 ${typeId}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(selected.locator(markerSelector)).toHaveCount(1);
  await item.locator(".ant-select-selector").click();
  await expect(dropdown).toHaveCount(1);
  await item.getByRole("combobox").fill(ordinaryId);
  await expect(ordinaryOption).toBeVisible();
  await expect(virtualOption).toHaveCount(0);
  expect(
    mock.reads.filter((url) =>
      /^\/api\/resources\/assettypes\/[^/]+$/.test(url.pathname),
    ),
  ).toEqual([]);
  expect(mock.writes).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test("legacy unmapped user type zero retains its raw selected label without a virtual marker", async ({
  page,
}) => {
  const mock = await syntheticApi(
    page,
    {
      users: [
        {
          id: ordinaryId,
          m_nIDUser: ordinaryId,
          m_nIDOrganization: "7",
          m_nIDUserType: "0",
          m_sLogin: "synthetic.legacy.user",
          m_sFirst_name: "Synthetic",
          m_sLast_name: "Legacy user",
        },
      ],
      usertypes: [],
    },
    { users: "ru", usertypes: "r" },
  );
  await page.goto(`/users/${ordinaryId}/edit`);
  const item = formItem(page, "m_nIDUserType");
  await expect(item.locator(".ant-select-selection-item")).toHaveText("0");
  await expect(item.locator(markerSelector)).toHaveCount(0);
  expect(
    mock.reads.filter((url) => url.pathname === "/api/resources/usertypes/0"),
  ).toEqual([]);
  expect(mock.writes).toEqual([]);
  expect(mock.errors).toEqual([]);
});
