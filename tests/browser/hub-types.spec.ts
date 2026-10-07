import { expect, test, type Page } from "@playwright/test";
import { type Identity, type RecordData } from "../../shared/resources";

const largeTypeId = "9223372036854775807";
const typeTag = "SYNTHETIC-GATEWAY-TYPE";
const typeLabel = "Synthetic descriptive type label";
const hubRows: RecordData[] = [
  {
    id: "41",
    m_nIDHub: "41",
    m_nIDHubType: largeTypeId,
    m_nIDOrganization: "7",
    m_sTag: "SYNTHETIC-HUB-ONE",
    m_sLabel: "Synthetic first hub",
  },
  {
    id: "42",
    m_nIDHub: "42",
    m_nIDHubType: largeTypeId,
    m_nIDOrganization: "7",
    m_sTag: "SYNTHETIC-HUB-TWO",
    m_sLabel: "Synthetic second hub",
  },
  {
    id: "43",
    m_nIDHub: "43",
    m_nIDHubType: "77",
    m_nIDOrganization: "7",
    m_sTag: "SYNTHETIC-HUB-THREE",
    m_sLabel: "Synthetic third hub",
  },
];

async function syntheticHubs(
  page: Page,
  options: {
    canReadTypes?: boolean;
    hubs?: RecordData[];
    types?: Record<string, { data?: RecordData; status?: number }>;
  } = {},
) {
  const identity: Identity = {
    id: "100",
    name: "Synthetic hub reader",
    organizationId: "7",
    userTypeId: "30",
    level: 30,
    mustChangePassword: false,
    permissions: [
      { entity: "hubs", rights: "r" },
      ...(options.canReadTypes === false
        ? []
        : [{ entity: "hubtypes", rights: "r" }]),
    ],
  };
  const hubs = options.hubs ?? hubRows;
  const types = options.types ?? {
    [largeTypeId]: {
      data: {
        id: largeTypeId,
        m_nIDHubType: largeTypeId,
        m_sTag: typeTag,
        m_sLabel: typeLabel,
      },
    },
    "77": {
      data: {
        id: "77",
        m_nIDHubType: "77",
        m_sTag: JSON.stringify({
          messages: [
            { lang: "fr", text: "TYPE-FRANCAIS" },
            { lang: "en", text: "TRANSLATED-TYPE-TAG" },
          ],
        }),
        m_sLabel: "Synthetic translated type label",
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
        csrf: "synthetic-hub-csrf",
        expiresAt: Date.now() + 60000,
      });
    if (path === "/api/resources/hubs")
      return reply({ data: hubs, total: hubs.length });
    if (path.startsWith("/api/resources/hubs/")) {
      const id = path.split("/").at(-1);
      const data = hubs.find((hub) => hub.id === id);
      return data
        ? reply({ data })
        : reply({ message: "Synthetic hub unavailable." }, 404);
    }
    if (path.startsWith("/api/resources/hubtypes/")) {
      const id = path.split("/").at(-1)!;
      reads.push(id);
      const type = types[id];
      const status = denyTypes ? 403 : (type?.status ?? 200);
      return status !== 200 || !type?.data
        ? reply(
            { message: "Synthetic hub type unavailable." },
            status === 200 ? 404 : status,
          )
        : reply({ data: type.data });
    }
    // All other API calls also receive synthetic responses; never reach Core.
    return reply({ data: [], total: 0 });
  });
  return {
    reads,
    updateTypeTag: (id: string, tag: string) => {
      if (types[id]?.data) types[id].data!.m_sTag = tag;
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

test("hub list and detail show the corresponding type tag with exact type links", async ({
  page,
}) => {
  const mock = await syntheticHubs(page);
  await page.goto("/hubs");
  await expect(
    page.getByRole("columnheader", { name: "Hub type", exact: true }),
  ).toBeVisible();
  for (const label of ["Synthetic first hub", "Synthetic second hub"]) {
    const link = listRow(page, label).getByRole("link", {
      name: typeTag,
      exact: true,
    });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `/hubtypes/${largeTypeId}`);
  }
  await expect(
    listRow(page, "Synthetic third hub").getByRole("link", {
      name: "TRANSLATED-TYPE-TAG",
      exact: true,
    }),
  ).toHaveAttribute("href", "/hubtypes/77");
  await expect(page.getByText(typeLabel, { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Synthetic translated type label", { exact: true }),
  ).toHaveCount(0);
  expect(mock.reads.filter((id) => id === largeTypeId)).toHaveLength(1);

  await page
    .getByRole("link", { name: "Synthetic first hub", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Synthetic first hub", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".ant-descriptions").getByRole("link", {
      name: typeTag,
      exact: true,
    }),
  ).toHaveAttribute("href", `/hubtypes/${largeTypeId}`);
  await expect(page.getByText(typeLabel, { exact: true })).toHaveCount(0);
});

test("unavailable, empty and unassigned hub types preserve the hub list and detail", async ({
  page,
}) => {
  const fallbackRows = [
    { id: "51", typeId: "98", label: "Synthetic forbidden type hub" },
    { id: "52", typeId: "99", label: "Synthetic missing type hub" },
    { id: "53", typeId: "100", label: "Synthetic empty tag hub" },
    { id: "54", typeId: "0", label: "Synthetic unassigned type hub" },
    { id: "55", typeId: undefined, label: "Synthetic no type field hub" },
  ];
  const mock = await syntheticHubs(page, {
    hubs: fallbackRows.map(({ id, typeId, label }) => ({
      id,
      m_nIDHub: id,
      m_nIDHubType: typeId,
      m_sTag: `SYNTHETIC-HUB-${id}`,
      m_sLabel: label,
    })),
    types: {
      "98": { status: 403 },
      "99": { status: 404 },
      "100": {
        data: {
          id: "100",
          m_nIDHubType: "100",
          m_sTag: "",
          m_sLabel: "Do not substitute this label for an empty tag",
        },
      },
    },
  });
  await page.goto("/hubs");
  const typeColumn = await page
    .getByRole("columnheader", { name: "Hub type", exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
  for (const { typeId, label } of fallbackRows.slice(0, 3)) {
    await expect(
      listRow(page, label).getByRole("link", {
        name: `#${typeId}`,
        exact: true,
      }),
    ).toHaveAttribute("href", `/hubtypes/${typeId}`);
  }
  await expect(
    listRow(page, "Synthetic unassigned type hub")
      .getByRole("cell")
      .nth(typeColumn),
  ).toHaveText("0");
  await expect(
    listRow(page, "Synthetic no type field hub")
      .getByRole("cell")
      .nth(typeColumn),
  ).toHaveText("—");
  await expect(
    page.getByText("Do not substitute this label for an empty tag", {
      exact: true,
    }),
  ).toHaveCount(0);
  expect(mock.reads).not.toContain("0");
  expect(mock.reads).not.toContain("undefined");

  await page
    .getByRole("link", { name: "Synthetic forbidden type hub", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic forbidden type hub",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator(".ant-descriptions").getByRole("link", {
      name: "#98",
      exact: true,
    }),
  ).toHaveAttribute("href", "/hubtypes/98");
});

test("hub type references do not fetch or link records without read permission", async ({
  page,
}) => {
  const mock = await syntheticHubs(page, { canReadTypes: false });
  await page.goto("/hubs");
  const row = listRow(page, "Synthetic first hub");
  await expect(row.getByText(`#${largeTypeId}`, { exact: true })).toBeVisible();
  await expect(row.locator('a[href^="/hubtypes/"]')).toHaveCount(0);
  await page
    .getByRole("link", { name: "Synthetic first hub", exact: true })
    .click();
  const detail = page.locator(".ant-descriptions");
  await expect(
    detail.getByText(`#${largeTypeId}`, { exact: true }),
  ).toBeVisible();
  await expect(detail.locator('a[href^="/hubtypes/"]')).toHaveCount(0);
  await expect(page.getByText(typeTag, { exact: true })).toHaveCount(0);
  expect(mock.reads).toEqual([]);
});

test("hub refresh updates type tags and removes a cached tag when its type becomes denied", async ({
  page,
}) => {
  const mock = await syntheticHubs(page);
  await page.goto("/hubs");
  await expect(
    listRow(page, "Synthetic first hub").getByRole("link", {
      name: typeTag,
      exact: true,
    }),
  ).toBeVisible();
  const changedTag = "UPDATED-SYNTHETIC-TYPE-TAG";
  mock.updateTypeTag(largeTypeId, changedTag);
  await page.getByRole("button", { name: /Refresh$/ }).click();
  await expect(
    listRow(page, "Synthetic first hub").getByRole("link", {
      name: changedTag,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    listRow(page, "Synthetic second hub").getByRole("link", {
      name: changedTag,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(typeTag, { exact: true })).toHaveCount(0);
  await page
    .getByRole("link", { name: "Synthetic first hub", exact: true })
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
  expect(mock.reads.filter((id) => id === largeTypeId)).toHaveLength(3);
});
