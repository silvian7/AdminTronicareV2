import { expect, test, type Page } from "@playwright/test";
import { type Identity, type RecordData } from "../../shared/resources";

const largeTypeId = "9223372036854775807";

interface EquipmentKind {
  resource: "devices" | "sensors";
  singular: "Device" | "Sensor";
  types: "devicetypes" | "sensortypes";
  itemIdKey: "IDDevice" | "m_nIDSensor";
  typeIdKey: "IDDeviceType" | "m_nIDSensorType";
  tagKey: "Tag" | "m_sTag";
  labelKey: "Label" | "m_sLabel";
}

const equipmentKinds: EquipmentKind[] = [
  {
    resource: "devices",
    singular: "Device",
    types: "devicetypes",
    itemIdKey: "IDDevice",
    typeIdKey: "IDDeviceType",
    tagKey: "Tag",
    labelKey: "Label",
  },
  {
    resource: "sensors",
    singular: "Sensor",
    types: "sensortypes",
    itemIdKey: "m_nIDSensor",
    typeIdKey: "m_nIDSensorType",
    tagKey: "m_sTag",
    labelKey: "m_sLabel",
  },
];

const itemLabel = (kind: EquipmentKind, suffix: string) =>
  `Synthetic ${suffix} ${kind.singular.toLowerCase()}`;
const typeTag = (kind: EquipmentKind) =>
  `SYNTHETIC-${kind.singular.toUpperCase()}-TYPE-TAG`;
const typeLabel = (kind: EquipmentKind) =>
  `Synthetic descriptive ${kind.singular.toLowerCase()} type label`;

function equipmentRow(
  kind: EquipmentKind,
  id: string,
  typeId: string | undefined,
  label: string,
): RecordData {
  return {
    id,
    [kind.itemIdKey]: id,
    [kind.typeIdKey]: typeId,
    [kind.tagKey]: `SYNTHETIC-${kind.singular.toUpperCase()}-ITEM-${id}`,
    [kind.labelKey]: label,
  };
}

async function syntheticEquipment(
  page: Page,
  kind: EquipmentKind,
  options: {
    canReadTypes?: boolean;
    rows?: RecordData[];
    types?: Record<string, { data?: RecordData; status?: number }>;
  } = {},
) {
  const identity: Identity = {
    id: "100",
    name: `Synthetic ${kind.singular.toLowerCase()} reader`,
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      { entity: kind.resource, rights: "r" },
      ...(options.canReadTypes === false
        ? []
        : [{ entity: kind.types, rights: "r" }]),
    ],
  };
  const rows = options.rows ?? [
    equipmentRow(kind, "41", largeTypeId, itemLabel(kind, "first")),
    equipmentRow(kind, "42", largeTypeId, itemLabel(kind, "second")),
    equipmentRow(kind, "43", "77", itemLabel(kind, "third")),
  ];
  const types = options.types ?? {
    [largeTypeId]: {
      data: {
        id: largeTypeId,
        [kind.typeIdKey]: largeTypeId,
        [kind.tagKey]: typeTag(kind),
        [kind.labelKey]: typeLabel(kind),
      },
    },
    "77": {
      data: {
        id: "77",
        [kind.typeIdKey]: "77",
        [kind.tagKey]: JSON.stringify({
          messages: [
            { lang: "fr", text: "TYPE-FRANCAIS" },
            { lang: "en", text: "TRANSLATED-TYPE-TAG" },
          ],
        }),
        [kind.labelKey]: "Synthetic translated type label",
      },
    },
  };
  const reads: string[] = [];
  let denyTypes = false;
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
        csrf: "synthetic-equipment-csrf",
        expiresAt: Date.now() + 60000,
      });
    if (path === `/api/resources/${kind.resource}`)
      return reply({ data: rows, total: rows.length });
    if (path.startsWith(`/api/resources/${kind.resource}/`)) {
      const id = path.split("/").at(-1);
      const data = rows.find((row) => row.id === id);
      return data
        ? reply({ data })
        : reply({ message: "Synthetic equipment unavailable." }, 404);
    }
    if (path.startsWith(`/api/resources/${kind.types}/`)) {
      reads.push(path);
      const id = path.split("/").at(-1)!;
      const type = types[id];
      const status = denyTypes ? 403 : (type?.status ?? 200);
      return status !== 200 || !type?.data
        ? reply(
            { message: "Synthetic equipment type unavailable." },
            status === 200 ? 404 : status,
          )
        : reply({ data: type.data });
    }
    // Intercept every API request, including unrelated detail tabs.
    return reply({ data: [], total: 0 });
  });
  return {
    reads,
    updateTypeTag: (id: string, tag: string) => {
      if (types[id]?.data) types[id].data![kind.tagKey] = tag;
    },
    denyTypeReads: () => {
      denyTypes = true;
    },
  };
}

function listRow(page: Page, label: string) {
  return page
    .getByRole("link", { name: label, exact: true })
    .locator("xpath=ancestor::tr");
}

for (const kind of equipmentKinds) {
  test(`${kind.resource} list and detail show the corresponding type tag with exact type links`, async ({
    page,
  }) => {
    const mock = await syntheticEquipment(page, kind);
    await page.goto(`/${kind.resource}`);
    await expect(
      page.getByRole("columnheader", {
        name: `${kind.singular} type`,
        exact: true,
      }),
    ).toBeVisible();
    if (kind.resource === "devices")
      await expect(
        page.getByRole("columnheader", { name: /Last event/i }),
      ).toBeVisible();
    for (const suffix of ["first", "second"]) {
      const link = listRow(page, itemLabel(kind, suffix)).getByRole("link", {
        name: typeTag(kind),
        exact: true,
      });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute(
        "href",
        `/${kind.types}/${largeTypeId}`,
      );
    }
    await expect(
      listRow(page, itemLabel(kind, "third")).getByRole("link", {
        name: "TRANSLATED-TYPE-TAG",
        exact: true,
      }),
    ).toHaveAttribute("href", `/${kind.types}/77`);
    await expect(page.getByText(typeLabel(kind), { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText("Synthetic translated type label", { exact: true }),
    ).toHaveCount(0);
    expect(mock.reads.sort()).toEqual(
      [
        `/api/resources/${kind.types}/${largeTypeId}`,
        `/api/resources/${kind.types}/77`,
      ].sort(),
    );

    await page
      .getByRole("link", { name: itemLabel(kind, "first"), exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: itemLabel(kind, "first"),
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator(".ant-descriptions").getByRole("link", {
        name: typeTag(kind),
        exact: true,
      }),
    ).toHaveAttribute("href", `/${kind.types}/${largeTypeId}`);
    await expect(page.getByText(typeLabel(kind), { exact: true })).toHaveCount(
      0,
    );
  });

  test(`${kind.resource} unavailable, empty and unassigned types preserve list and detail`, async ({
    page,
  }) => {
    const fallbackRows = [
      { id: "51", typeId: "98", suffix: "forbidden type" },
      { id: "52", typeId: "99", suffix: "missing type" },
      { id: "53", typeId: "100", suffix: "empty tag" },
      { id: "54", typeId: "101", suffix: "failed type" },
      { id: "55", typeId: "0", suffix: "unassigned type" },
      { id: "56", typeId: undefined, suffix: "no type field" },
    ];
    const mock = await syntheticEquipment(page, kind, {
      rows: fallbackRows.map(({ id, typeId, suffix }) =>
        equipmentRow(kind, id, typeId, itemLabel(kind, suffix)),
      ),
      types: {
        "98": { status: 403 },
        "99": { status: 404 },
        "100": {
          data: {
            id: "100",
            [kind.typeIdKey]: "100",
            [kind.tagKey]: "",
            [kind.labelKey]: "Do not substitute this label for an empty tag",
          },
        },
        "101": { status: 500 },
      },
    });
    await page.goto(`/${kind.resource}`);
    const typeColumn = await page
      .getByRole("columnheader", { name: `${kind.singular} type`, exact: true })
      .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
    for (const { typeId, suffix } of fallbackRows.slice(0, 4)) {
      await expect(
        listRow(page, itemLabel(kind, suffix)).getByRole("link", {
          name: `#${typeId}`,
          exact: true,
        }),
      ).toHaveAttribute("href", `/${kind.types}/${typeId}`);
    }
    await expect(
      listRow(page, itemLabel(kind, "unassigned type"))
        .getByRole("cell")
        .nth(typeColumn),
    ).toHaveText("0");
    await expect(
      listRow(page, itemLabel(kind, "no type field"))
        .getByRole("cell")
        .nth(typeColumn),
    ).toHaveText("\u2014");
    await expect(
      page.getByText("Do not substitute this label for an empty tag", {
        exact: true,
      }),
    ).toHaveCount(0);
    expect(mock.reads).not.toContain(`/api/resources/${kind.types}/0`);
    expect(mock.reads).not.toContain(`/api/resources/${kind.types}/undefined`);

    for (const { id, typeId, suffix } of fallbackRows.slice(0, 4)) {
      await page.goto(`/${kind.resource}/${id}`);
      await expect(
        page.getByRole("heading", {
          name: itemLabel(kind, suffix),
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.locator(".ant-descriptions").getByRole("link", {
          name: `#${typeId}`,
          exact: true,
        }),
      ).toHaveAttribute("href", `/${kind.types}/${typeId}`);
      await expect(
        page.getByText("Do not substitute this label for an empty tag", {
          exact: true,
        }),
      ).toHaveCount(0);
    }
  });

  test(`${kind.resource} type references do not fetch or link records without read permission`, async ({
    page,
  }) => {
    const mock = await syntheticEquipment(page, kind, { canReadTypes: false });
    await page.goto(`/${kind.resource}`);
    const row = listRow(page, itemLabel(kind, "first"));
    await expect(
      row.getByText(`#${largeTypeId}`, { exact: true }),
    ).toBeVisible();
    await expect(row.locator(`a[href^="/${kind.types}/"]`)).toHaveCount(0);
    await page
      .getByRole("link", { name: itemLabel(kind, "first"), exact: true })
      .click();
    const detail = page.locator(".ant-descriptions");
    await expect(
      detail.getByText(`#${largeTypeId}`, { exact: true }),
    ).toBeVisible();
    await expect(detail.locator(`a[href^="/${kind.types}/"]`)).toHaveCount(0);
    await expect(page.getByText(typeTag(kind), { exact: true })).toHaveCount(0);
    expect(mock.reads).toEqual([]);
  });

  test(`${kind.resource} refresh updates type tags and suppresses cached tags after denied reads`, async ({
    page,
  }) => {
    const mock = await syntheticEquipment(page, kind);
    await page.goto(`/${kind.resource}`);
    await expect(
      listRow(page, itemLabel(kind, "first")).getByRole("link", {
        name: typeTag(kind),
        exact: true,
      }),
    ).toBeVisible();
    const changedTag = `UPDATED-${kind.singular.toUpperCase()}-TYPE-TAG`;
    mock.updateTypeTag(largeTypeId, changedTag);
    await page.getByRole("button", { name: /Refresh$/ }).click();
    for (const suffix of ["first", "second"]) {
      await expect(
        listRow(page, itemLabel(kind, suffix)).getByRole("link", {
          name: changedTag,
          exact: true,
        }),
      ).toBeVisible();
    }
    await expect(page.getByText(typeTag(kind), { exact: true })).toHaveCount(0);
    await page
      .getByRole("link", { name: itemLabel(kind, "first"), exact: true })
      .click();
    await expect(
      page.locator(".ant-descriptions").getByRole("link", {
        name: changedTag,
        exact: true,
      }),
    ).toBeVisible();
    mock.denyTypeReads();
    await page.getByRole("button", { name: /Refresh$/ }).click();
    await expect(
      page.locator(".ant-descriptions").getByRole("link", {
        name: `#${largeTypeId}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(changedTag, { exact: true })).toHaveCount(0);
    expect(
      mock.reads.filter(
        (path) => path === `/api/resources/${kind.types}/${largeTypeId}`,
      ),
    ).toHaveLength(3);
  });
}
