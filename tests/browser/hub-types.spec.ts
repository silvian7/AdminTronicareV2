import { expect, test, type Page } from "@playwright/test";
import { type Identity, type RecordData } from "../../shared/resources";

const largeTypeId = "9223372036854775807";
const typeTag = "SYNTHETIC-GATEWAY-TYPE";
const typeLabel = "Synthetic descriptive type label";
const largeAssetId = "9223372036854775806";
const assetTag = "SYNTHETIC-HUB-ASSET";
const assetLabel = "Synthetic translated hub asset label";
const hubRows: RecordData[] = [
  {
    id: "41",
    m_nIDHub: "41",
    m_nIDHubType: largeTypeId,
    m_nIDOrganization: "7",
    m_nIDAsset: largeAssetId,
    m_sTag: "SYNTHETIC-HUB-ONE",
    m_sLabel: "Synthetic first hub",
  },
  {
    id: "42",
    m_nIDHub: "42",
    m_nIDHubType: largeTypeId,
    m_nIDOrganization: "7",
    m_nIDAsset: largeAssetId,
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
    sessionExpiresAt?: number;
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
      { entity: "assets", rights: "r" },
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
  const collectionReads: URL[] = [];
  let denyTypes = false;
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
        csrf: "synthetic-hub-csrf",
        expiresAt: options.sessionExpiresAt ?? Date.now() + 60000,
      });
    if (path === "/api/resources/hubs") {
      collectionReads.push(url);
      return reply({ data: hubs, total: hubs.length });
    }
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
    if (path === `/api/resources/assets/${largeAssetId}`)
      return reply({
        data: {
          id: largeAssetId,
          m_nIDAsset: largeAssetId,
          m_sTag: assetTag,
          m_sLabel: JSON.stringify({
            messages: [
              { lang: "fr", text: "Synthetic French hub asset label" },
              { lang: "en", text: assetLabel },
            ],
          }),
        },
      });
    // All other API calls also receive synthetic responses; never reach Core.
    return reply({ data: [], total: 0 });
  });
  return {
    reads,
    collectionReads,
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

test("hub list shows full asset identity and list and detail preserve exact type links", async ({
  page,
}) => {
  const mock = await syntheticHubs(page);
  await page.goto("/hubs");
  await expect(
    page.getByRole("columnheader", { name: "Hub type", exact: true }),
  ).toBeVisible();
  const assetColumn = await page
    .getByRole("columnheader", { name: "Asset", exact: true })
    .evaluate((cell) => (cell as HTMLTableCellElement).cellIndex);
  for (const label of ["Synthetic first hub", "Synthetic second hub"]) {
    const row = listRow(page, label);
    const link = row.getByRole("link", {
      name: typeTag,
      exact: true,
    });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `/hubtypes/${largeTypeId}`);
    const assetCell = row.getByRole("cell").nth(assetColumn);
    await expect(assetCell.getByRole("link")).toHaveCount(2);
    for (const name of [assetTag, assetLabel]) {
      const assetLink = assetCell.getByRole("link", { name, exact: true });
      await expect(assetLink).toBeVisible();
      await expect(assetLink).toHaveAttribute(
        "href",
        `/assets/${largeAssetId}`,
      );
    }
    await expect(
      assetCell.getByText(`#${largeAssetId}`, { exact: true }),
    ).toBeVisible();
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

test.describe("hub status follows the age of its last event", () => {
  test.use({ timezoneId: "Europe/Brussels" });
  const now = new Date("2026-10-13T12:00:00.000Z");

  test("status discs distinguish exact age boundaries and unavailable event times", async ({
    page,
  }, testInfo) => {
    await page.clock.install({ time: now });
    await page.clock.setFixedTime(now);
    const cases = [
      ["Below five minutes", "2026-10-13T11:55:00.001Z", "green"],
      ["Exactly five minutes", "2026-10-13T11:55:00.000Z", "yellow"],
      ["Beyond five minutes", "2026-10-13T11:54:59.999Z", "yellow"],
      ["Exactly one hour", "2026-10-13T11:00:00.000Z", "yellow"],
      ["Beyond one hour", "2026-10-13T10:59:59.999Z", "red"],
      ["Exactly eight hours", "2026-10-13T04:00:00.000Z", "red"],
      ["Beyond eight hours", "2026-10-13T03:59:59.999Z", "black"],
      ["Missing event", undefined, "black"],
      ["Malformed event", "not-a-timestamp", "black"],
      ["Invalid calendar event", "2026-02-30T10:00:00Z", "black"],
    ];
    await syntheticHubs(page, {
      canReadTypes: false,
      sessionExpiresAt: now.getTime() + 60000,
      hubs: cases.map(([label, timestamp], index) => ({
        id: String(index + 51),
        m_nIDHub: String(index + 51),
        m_sLabel: `Synthetic ${label} hub`,
        m_dhDhLastEvent: timestamp,
      })),
    });
    await page.goto("/hubs");
    const descriptions: Record<string, string> = {
      green: "Last event: less than 5 minutes ago",
      yellow: "Last event: 5 minutes to 1 hour ago",
      red: "Last event: more than 1 hour to 8 hours ago",
      black: "Last event: more than 8 hours ago",
    };
    for (const [label, , status] of cases) {
      const disc = listRow(page, `Synthetic ${label} hub`).locator(
        ".hub-status-dot",
      );
      await expect(disc).toBeVisible();
      await expect(disc).toHaveAttribute("role", "img");
      await expect(disc).toHaveAttribute("data-status", status!);
      const description = [
        "Missing event",
        "Malformed event",
        "Invalid calendar event",
      ].includes(label!)
        ? "Last event unavailable"
        : descriptions[status!];
      await expect(disc).toHaveAttribute("aria-label", description);
      await expect(disc).toHaveAttribute("title", description);
    }
    for (const [label, color] of [
      ["Below five minutes", "rgb(82, 196, 26)"],
      ["Exactly five minutes", "rgb(250, 219, 20)"],
      ["Beyond one hour", "rgb(245, 34, 45)"],
      ["Beyond eight hours", "rgb(20, 20, 20)"],
    ])
      await expect(
        listRow(page, `Synthetic ${label} hub`).locator(".hub-status-dot"),
      ).toHaveCSS("background-color", color);
    const recent = listRow(page, "Synthetic Below five minutes hub").locator(
      ".hub-status-dot",
    );
    await expect(recent).toHaveCSS("width", "12px");
    await expect(recent).toHaveCSS("height", "12px");
    await expect(recent).toHaveCSS("border-radius", "50%");
    await page.screenshot({
      path: testInfo.outputPath("hub-status-age-bands.png"),
      fullPage: true,
    });
  });

  test("offset, timezone-less UTC and compact last events represent the same status instant", async ({
    page,
  }) => {
    await page.clock.install({ time: now });
    await page.clock.setFixedTime(now);
    const representations = [
      ["UTC", "2026-10-13T11:54:00.000Z"],
      ["Explicit offset", "2026-10-13T13:54:00.000+02:00"],
      ["Timezone-less UTC", "2026-10-13T11:54:00.000"],
      ["Compact seconds", "20261013115400"],
      ["Compact milliseconds", "20261013115400000"],
    ];
    await syntheticHubs(page, {
      canReadTypes: false,
      sessionExpiresAt: now.getTime() + 60000,
      hubs: representations.map(([label, timestamp], index) => ({
        id: String(index + 51),
        m_nIDHub: String(index + 51),
        m_sLabel: `Synthetic ${label} status hub`,
        m_dhDhLastEvent: timestamp,
      })),
    });
    await page.goto("/hubs");
    for (const [label] of representations)
      await expect(
        listRow(page, `Synthetic ${label} status hub`).locator(
          ".hub-status-dot",
        ),
      ).toHaveAttribute("data-status", "yellow");
  });

  test("an idle hub list changes status as time passes without reloading hub records", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-10-13T11:59:30.000Z") });
    const label = "Synthetic aging status hub";
    const mock = await syntheticHubs(page, {
      canReadTypes: false,
      sessionExpiresAt: now.getTime() + 60000,
      hubs: [
        {
          id: "51",
          m_nIDHub: "51",
          m_sLabel: label,
          m_dhDhLastEvent: "2026-10-13T11:55:10.000Z",
        },
      ],
    });
    await page.goto("/hubs");
    const disc = listRow(page, label).locator(".hub-status-dot");
    await expect(disc).toHaveAttribute("data-status", "green");
    await page.clock.pauseAt(now);
    await expect(disc).toHaveAttribute("data-status", "green");
    const readsBeforeAging = mock.collectionReads.length;
    const urlBeforeAging = page.url();
    await page.clock.runFor(15000);
    await expect(disc).toHaveAttribute("data-status", "yellow");
    expect(mock.collectionReads).toHaveLength(readsBeforeAging);
    await expect(page).toHaveURL(urlBeforeAging);
  });
});

test("hub Status sorting sends both directions and restores the selection after reload", async ({
  page,
}) => {
  const mock = await syntheticHubs(page, { canReadTypes: false });
  await page.goto("/hubs");
  const status = page.getByRole("columnheader", {
    name: "Status",
    exact: true,
  });
  async function expectSort(field: string, order: string) {
    await expect
      .poll(() => {
        const query = mock.collectionReads.at(-1)?.searchParams;
        return [query?.get("_sort"), query?.get("_order")];
      })
      .toEqual([field, order]);
  }
  await status.click();
  await expectSort("status", "asc");
  await expect(status).toHaveAttribute("aria-sort", "ascending");
  await status.click();
  await expectSort("status", "desc");
  await expect(status).toHaveAttribute("aria-sort", "descending");
  await page.reload();
  await expectSort("status", "desc");
  await expect(status).toHaveAttribute("aria-sort", "descending");
  await page
    .getByRole("columnheader", { name: "Hub type", exact: true })
    .click();
  await expectSort("m_nIDHubType", "asc");
});
