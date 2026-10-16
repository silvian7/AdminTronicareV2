import { expect, test, type Page } from "@playwright/test";
import type { Identity, RecordData } from "../../shared/resources";

const sensorId = "9223372036854775807";
const sensorTypeId = "9223372036854775806";
const ruleTypeId = "9223372036854775805";
const assetId = "9223372036854775804";
const ruleLabel = "Synthetic rule reference display";
const sensorTypeTag = "SYNTHETIC-SENSOR-TYPE-TAG";
const assetTag = "SYNTHETIC-RULE-ASSET-TAG";
const assetLabel = "Synthetic descriptive rule asset label";
const translated = (text: string) =>
  JSON.stringify({
    messages: [
      { lang: "fr", text: "SYNTHETIC-REFERENCE-FRANCAISE" },
      { lang: "en", text },
    ],
  });

async function mockRuleReferences(
  page: Page,
  options: {
    canReadSensors?: boolean;
    canReadSensorTypes?: boolean;
    canReadAssets?: boolean;
    sensorStatus?: number;
    sensorTypeStatus?: number;
    assetStatus?: number;
    emptyTypeTag?: boolean;
    sensor?: unknown;
    asset?: unknown;
  } = {},
) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic rule reference reader",
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      { entity: "rules", rights: "r" },
      { entity: "ruletypes", rights: "r" },
      ...(options.canReadSensors === false
        ? []
        : [{ entity: "sensors", rights: "r" }]),
      ...(options.canReadSensorTypes === false
        ? []
        : [{ entity: "sensortypes", rights: "r" }]),
      ...(options.canReadAssets === false
        ? []
        : [{ entity: "assets", rights: "r" }]),
    ],
  };
  const rule: RecordData = {
    id: "41",
    m_nIDRule: "41",
    m_nIDRuleType: ruleTypeId,
    m_nIDSensor: "sensor" in options ? options.sensor : sensorId,
    m_nIDAsset: "asset" in options ? options.asset : assetId,
    m_sAssetTag: "LEGACY-SYNTHETIC-STALE-ASSET-TAG",
    m_sLabel: ruleLabel,
  };
  const sensor = {
    id: sensorId,
    m_nIDSensor: sensorId,
    m_nIDSensorType: sensorTypeId,
    m_sLabel: "Synthetic sensor instance label",
  };
  const sensorType = {
    id: sensorTypeId,
    m_nIDSensorType: sensorTypeId,
    m_sTag: options.emptyTypeTag ? "" : translated(sensorTypeTag),
    m_sLabel: "Synthetic sensor type descriptive label",
  };
  const asset = {
    id: assetId,
    m_nIDAsset: assetId,
    m_nIDOrganization: "7",
    m_sTag: translated(assetTag),
    m_sLabel: translated(assetLabel),
  };
  const reads: URL[] = [];
  const mutations: string[] = [];
  let sensorStatus = options.sensorStatus ?? 200;
  let sensorTypeStatus = options.sensorTypeStatus ?? 200;
  let assetStatus = options.assetStatus ?? 200;
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
      return reply({ message: "Synthetic read-only operation." }, 405);
    }
    reads.push(url);
    if (path === "/api/session")
      return reply({
        identity,
        csrf: "synthetic-rule-references-csrf",
        expiresAt: Date.now() + 60 * 60_000,
      });
    if (path === "/api/resources/rules/41") return reply({ data: rule });
    if (path === `/api/resources/ruletypes/${ruleTypeId}`)
      return reply({
        data: {
          id: ruleTypeId,
          m_nIDRuleType: ruleTypeId,
          m_sTag: "SYNTHETIC-RULE-TYPE-NOT-SENSOR-TYPE",
        },
      });
    if (path === `/api/resources/sensors/${sensorId}`)
      return sensorStatus === 200
        ? reply({ data: sensor })
        : reply({ message: "Synthetic sensor unavailable." }, sensorStatus);
    if (path === `/api/resources/sensortypes/${sensorTypeId}`)
      return sensorTypeStatus === 200
        ? reply({ data: sensorType })
        : reply(
            { message: "Synthetic sensor type unavailable." },
            sensorTypeStatus,
          );
    if (path === `/api/resources/assets/${assetId}`)
      return assetStatus === 200
        ? reply({ data: asset })
        : reply({ message: "Synthetic asset unavailable." }, assetStatus);
    // Unknown reference IDs fail, so a wrong lookup chain cannot pass silently.
    if (/^\/api\/resources\/[^/]+\/[^/]+$/.test(path))
      return reply({ message: "Synthetic reference not found." }, 404);
    // Intercept every other API call, including shell collections and tabs.
    return reply({ data: [], total: 0 });
  });
  return {
    mutations,
    readIds: (resource: string) =>
      reads
        .filter((url) => url.pathname.startsWith(`/api/resources/${resource}/`))
        .map((url) => url.pathname.split("/").at(-1)!),
    rename: () => {
      sensorType.m_sTag = "RENAMED-SYNTHETIC-SENSOR-TYPE";
      asset.m_sTag = "RENAMED-SYNTHETIC-ASSET-TAG";
      asset.m_sLabel = "Renamed synthetic asset label";
    },
    deny: () => {
      sensorStatus = 403;
      sensorTypeStatus = 403;
      assetStatus = 403;
    },
  };
}

function detailField(page: Page, label: "Sensor" | "Asset") {
  return page
    .locator(".ant-descriptions-item-label")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::*[1]");
}

async function openRule(page: Page) {
  await page.goto("/rules/41");
  await expect(
    page.getByRole("heading", { name: ruleLabel, exact: true }),
  ).toBeVisible();
}

test("rule details resolve the exact sensor's translated type tag and the asset tag, label and ID", async ({
  page,
}, testInfo) => {
  const mock = await mockRuleReferences(page);
  await openRule(page);
  const sensor = detailField(page, "Sensor");
  await expect(sensor).toHaveText(sensorTypeTag);
  await expect(
    sensor.getByRole("link", { name: sensorTypeTag, exact: true }),
  ).toHaveAttribute("href", `/sensors/${sensorId}`);
  await expect(sensor).not.toContainText(sensorId);
  await expect(sensor).not.toContainText("Synthetic sensor instance label");
  await expect(sensor).not.toContainText("SYNTHETIC-RULE-TYPE-NOT-SENSOR-TYPE");
  const asset = detailField(page, "Asset");
  for (const name of [assetTag, assetLabel])
    await expect(
      asset.getByRole("link", { name, exact: true }),
    ).toHaveAttribute("href", `/assets/${assetId}`);
  await expect(asset.getByText(`#${assetId}`, { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".ant-descriptions-item-label")
      .filter({ hasText: /^Asset [Tt]ag$/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText("LEGACY-SYNTHETIC-STALE-ASSET-TAG", { exact: true }),
  ).toHaveCount(0);
  expect(mock.readIds("sensors")).toEqual([sensorId]);
  expect(mock.readIds("sensortypes")).toEqual([sensorTypeId]);
  expect(mock.readIds("assets")).toEqual([assetId]);
  expect(mock.mutations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("rule-detail-references.png"),
    fullPage: true,
    animations: "disabled",
  });
});

for (const failure of [
  "missing sensor",
  "missing sensor type",
  "empty type tag",
])
  test(`a ${failure} preserves the sensor ID link without substituting other labels`, async ({
    page,
  }) => {
    const mock = await mockRuleReferences(page, {
      sensorStatus: failure === "missing sensor" ? 404 : 200,
      sensorTypeStatus: failure === "missing sensor type" ? 404 : 200,
      emptyTypeTag: failure === "empty type tag",
    });
    const lastLookup = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
        (failure === "missing sensor"
          ? `/api/resources/sensors/${sensorId}`
          : `/api/resources/sensortypes/${sensorTypeId}`),
    );
    await openRule(page);
    await lastLookup;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const sensor = detailField(page, "Sensor");
    await expect(sensor).toHaveText(`#${sensorId}`);
    await expect(
      sensor.getByRole("link", { name: `#${sensorId}`, exact: true }),
    ).toHaveAttribute("href", `/sensors/${sensorId}`);
    expect(mock.readIds("sensors")).toEqual([sensorId]);
    if (failure === "missing sensor")
      expect(mock.readIds("sensortypes")).toEqual([]);
    else
      await expect
        .poll(() => mock.readIds("sensortypes"))
        .toEqual([sensorTypeId]);
    expect(mock.mutations).toEqual([]);
  });

for (const permission of ["sensors", "sensortypes", "assets"])
  test(`rule reference lookups respect missing ${permission} read permission`, async ({
    page,
  }) => {
    const mock = await mockRuleReferences(page, {
      canReadSensors: permission !== "sensors",
      canReadSensorTypes: permission !== "sensortypes",
      canReadAssets: permission !== "assets",
    });
    await openRule(page);
    if (permission === "assets") {
      const asset = detailField(page, "Asset");
      await expect(asset).toHaveText(`#${assetId}`);
      await expect(asset.getByRole("link")).toHaveCount(0);
      expect(mock.readIds("assets")).toEqual([]);
    } else {
      const sensor = detailField(page, "Sensor");
      await expect(sensor).toHaveText(`#${sensorId}`);
      await expect(sensor.getByRole("link")).toHaveCount(
        permission === "sensors" ? 0 : 1,
      );
      expect(mock.readIds("sensortypes")).toEqual([]);
      expect(mock.readIds("sensors")).toEqual(
        permission === "sensors" ? [] : [sensorId],
      );
    }
    expect(mock.mutations).toEqual([]);
  });

test("refresh updates reference tags and removes cached metadata when the lookups become denied", async ({
  page,
}) => {
  const mock = await mockRuleReferences(page);
  await openRule(page);
  const sensor = detailField(page, "Sensor");
  const asset = detailField(page, "Asset");
  await expect(sensor).toHaveText(sensorTypeTag);
  await expect(asset).toContainText(assetTag);
  mock.rename();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(sensor).toHaveText("RENAMED-SYNTHETIC-SENSOR-TYPE");
  await expect(asset).toContainText("RENAMED-SYNTHETIC-ASSET-TAG");
  await expect(asset).toContainText("Renamed synthetic asset label");
  await expect(asset).not.toContainText(assetTag);
  await expect(asset).not.toContainText(assetLabel);
  mock.deny();
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(sensor).toHaveText(`#${sensorId}`);
  await expect(sensor.getByRole("link")).toHaveAttribute(
    "href",
    `/sensors/${sensorId}`,
  );
  await expect(asset).toHaveText(`#${assetId}`);
  await expect(asset.getByRole("link")).toHaveCount(0);
  await expect(
    page.getByText("RENAMED-SYNTHETIC-SENSOR-TYPE", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("RENAMED-SYNTHETIC-ASSET-TAG", { exact: true }),
  ).toHaveCount(0);
  expect(mock.readIds("sensors")).toEqual([sensorId, sensorId, sensorId]);
  expect(mock.readIds("assets")).toEqual([assetId, assetId, assetId]);
  expect(mock.mutations).toEqual([]);
});

for (const value of [undefined, "0"])
  test(`${value === undefined ? "missing" : "zero"} references preserve their fallback without reading records`, async ({
    page,
  }) => {
    const mock = await mockRuleReferences(page, {
      sensor: value,
      asset: value,
    });
    await openRule(page);
    await expect(detailField(page, "Sensor")).toHaveText(
      value === undefined ? "—" : "0",
    );
    await expect(detailField(page, "Asset")).toHaveText(
      value === undefined ? "—" : "#0",
    );
    expect(mock.readIds("sensors")).toEqual([]);
    expect(mock.readIds("sensortypes")).toEqual([]);
    expect(mock.readIds("assets")).toEqual([]);
    expect(mock.mutations).toEqual([]);
  });
