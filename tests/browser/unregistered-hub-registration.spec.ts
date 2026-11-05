import { expect, test, type Page, type Route } from "@playwright/test";
import type { RecordData } from "../../shared/resources";
import type { UnregisteredHubsResponse } from "../../shared/unregistered-hubs";
import { installCareFixtures } from "./care-fixtures";

const kind = " SYNTHETIC /+&?% Ω ";
const serial = " SYNTHETIC-SN /+&?%#= Ω ";
const typeId = "9223372036854775807";
const hubId = "9223372036854775701";
const typeTag = "SYNTHETIC-REGISTRATION-TYPE";
const prefill = () =>
  `/hubs/new?${new URLSearchParams({ hubKind: kind, serialNumber: serial })}`;
const catalogType = (id = typeId, exactKind = kind): RecordData => ({
  id,
  m_nIDHubType: id,
  m_sTag: typeTag,
  m_sLabel: "Synthetic hub type",
  m_sKind: exactKind,
});
const unregistered = (): UnregisteredHubsResponse => ({
  data: [
    {
      hubKind: kind,
      serialNumber: serial,
      firstSeenAt: "2026-11-05T06:00:00.000Z",
      lastSeenAt: "2026-11-05T07:00:00.000Z",
      rejectionCount: "3",
      hubTypeStatus: "registered",
    },
  ],
  limit: 100,
  hasMore: false,
  scanLimit: 10000,
  scannedMessageCount: 3,
  messagesLimited: false,
  observedAt: "2026-11-05T12:00:00.000Z",
});

async function mockRegistration(page: Page) {
  const fixture = await installCareFixtures(page, { caregiver: false });
  let types = [catalogType(), catalogType("41", kind.trim())];
  let catalogStatus = 200;
  let limited = false;
  let createStatus = 200;
  let created = false;
  let saved: RecordData = {
    id: hubId,
    m_nIDHub: hubId,
    m_nIDHubType: typeId,
    m_nIDOrganization: "1",
    m_nIDAsset: "0",
    m_sSerialNr: "SYNTHETIC-EXISTING-SERIAL",
    m_sTag: "SYNTHETIC-REGISTERED-HUB",
    m_sLabel: "Synthetic registered hub",
  };
  const posts: Record<string, unknown>[] = [];
  const otherWrites: string[] = [];
  const typeReads: URL[] = [];
  let overviewReads = 0;
  const reply = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.pathname === "/api/core/unregistered-hubs" &&
      request.method() === "GET"
    ) {
      overviewReads++;
      const body = unregistered();
      if (created) {
        body.data = [];
        body.scannedMessageCount = 0;
      }
      return reply(route, body);
    }
    if (
      url.pathname === "/api/resources/hubtypes" &&
      request.method() === "GET"
    ) {
      typeReads.push(url);
      return catalogStatus === 200
        ? reply(route, { data: types, total: types.length, limited })
        : reply(
            route,
            { message: "Synthetic type catalog unavailable." },
            catalogStatus,
          );
    }
    if (
      url.pathname.startsWith("/api/resources/hubtypes/") &&
      request.method() === "GET"
    ) {
      const row = types.find(
        (type) => type.id === url.pathname.split("/").at(-1),
      );
      return reply(
        route,
        row ? { data: row } : { message: "Synthetic type missing." },
        row ? 200 : 404,
      );
    }
    if (url.pathname === "/api/resources/hubs" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      posts.push(body);
      if (createStatus !== 200)
        return reply(
          route,
          {
            message: "Synthetic hub identity already exists.",
            errors: { SerialNr: "Choose a different serial number." },
          },
          createStatus,
        );
      created = true;
      saved = {
        ...saved,
        m_sSerialNr: body.SerialNr,
        m_nIDHubType: body.IDHubType,
        m_sTag: body.Tag ?? saved.m_sTag,
        m_sLabel: body.Label ?? saved.m_sLabel,
      };
      return reply(route, { data: saved });
    }
    if (url.pathname === "/api/resources/hubs" && request.method() === "GET")
      return reply(route, {
        data: created ? [saved] : [],
        total: created ? 1 : 0,
      });
    if (
      url.pathname === `/api/resources/hubs/${hubId}` &&
      request.method() === "GET"
    )
      return reply(route, { data: saved });
    if (request.method() !== "GET")
      otherWrites.push(`${request.method()} ${url.pathname}`);
    return route.fallback();
  });
  return {
    fixture,
    posts,
    otherWrites,
    typeReads,
    overviewReads: () => overviewReads,
    catalog(
      rows: RecordData[],
      options: { status?: number; limited?: boolean } = {},
    ) {
      types = rows;
      catalogStatus = options.status ?? 200;
      limited = options.limited ?? false;
    },
    conflict() {
      createStatus = 409;
    },
  };
}

function card(page: Page) {
  return page.getByRole("region", { name: "Unregistered hubs", exact: true });
}

function typeField(page: Page) {
  return page
    .getByLabel("Hub type", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'ant-form-item')][1]");
}

async function expectPrefill(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Register hub", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Serial number", { exact: true })).toHaveValue(
    serial,
  );
}

function noWrites(mock: Awaited<ReturnType<typeof mockRegistration>>) {
  expect(mock.posts).toEqual([]);
  expect(mock.otherWrites).toEqual([]);
  expect(mock.fixture.unexpected).toEqual([]);
}

test("unregistered serial link preserves exact special characters and selects the exact int64 hub type", async ({
  page,
}) => {
  const mock = await mockRegistration(page);
  await page.goto("/");
  const link = card(page).getByRole("link", { name: serial, exact: true });
  await expect(link).toBeVisible();
  const target = new URL((await link.getAttribute("href"))!, page.url());
  expect(target.pathname).toBe("/hubs/new");
  expect(target.searchParams.getAll("hubKind")).toEqual([kind]);
  expect(target.searchParams.getAll("serialNumber")).toEqual([serial]);
  await link.click();
  await expectPrefill(page);
  await expect(
    typeField(page).locator(".ant-select-selection-item"),
  ).toContainText(typeId);
  expect(mock.typeReads.length).toBeGreaterThan(0);
  expect(
    mock.typeReads.every(
      (url) => url.searchParams.get("_pageSize") === "10000",
    ),
  ).toBe(true);
  await page.getByRole("menuitem", { name: /Overview$/ }).click();
  await card(page).getByRole("cell", { name: "3", exact: true }).click();
  await expectPrefill(page);
  await expect(
    typeField(page).locator(".ant-select-selection-item"),
  ).toContainText(typeId);
  await page.locator(".main-content").screenshot({
    path: test.info().outputPath("prefilled-registration.png"),
  });
  noWrites(mock);
});

for (const key of ["Enter", "Space"]) {
  test(`unregistered hub row opens registration with ${key}`, async ({
    page,
  }) => {
    const mock = await mockRegistration(page);
    await page.goto("/");
    const row = card(page)
      .getByRole("link", { name: serial, exact: true })
      .locator("xpath=ancestor::tr");
    await expect(row).toHaveAttribute("tabindex", "0");
    await row.focus();
    await row.press(key);
    await expectPrefill(page);
    expect(new URL(page.url()).searchParams.get("hubKind")).toBe(kind);
    expect(new URL(page.url()).searchParams.get("serialNumber")).toBe(serial);
    noWrites(mock);
  });
}

test("registration refreshes a previously cached type catalog before choosing a type", async ({
  page,
}) => {
  const mock = await mockRegistration(page);
  mock.catalog([catalogType("42")]);
  await page.goto("/hubs/new");
  await expect(
    page.getByRole("heading", { name: "Add hub", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Hub type", { exact: true }).click();
  await expect(
    page
      .locator(".ant-select-dropdown")
      .getByText("Synthetic hub type · 42", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const readsBefore = mock.typeReads.length;
  await page.getByRole("menuitem", { name: /Overview$/ }).click();
  mock.catalog([catalogType()]);
  await card(page).getByRole("link", { name: serial, exact: true }).click();
  await expectPrefill(page);
  await expect(
    typeField(page).locator(".ant-select-selection-item"),
  ).toContainText(typeId);
  expect(mock.typeReads.length).toBeGreaterThan(readsBefore);
  noWrites(mock);
});

for (const scenario of [
  "unknown",
  "ambiguous",
  "invalid ID",
  "limited",
  "error",
  "unreadable",
] as const) {
  test(`${scenario} type catalog never guesses a registration type and retains the serial`, async ({
    page,
  }) => {
    const mock = await mockRegistration(page);
    if (scenario === "unknown") mock.catalog([catalogType("41", kind.trim())]);
    if (scenario === "ambiguous")
      mock.catalog([catalogType(), catalogType("42")]);
    if (scenario === "invalid ID")
      mock.catalog([catalogType("9223372036854775808")]);
    if (scenario === "limited")
      mock.catalog([catalogType()], { limited: true });
    if (scenario === "error") mock.catalog([], { status: 502 });
    if (scenario === "unreadable") {
      mock.fixture.session.identity.level = 30;
      mock.fixture.session.identity.userTypeId = "30";
      mock.fixture.session.identity.permissions = [
        { entity: "hubs", rights: "cr" },
      ];
    }
    await page.goto(prefill());
    await expectPrefill(page);
    await expect(
      page.getByRole("alert").filter({ hasText: /type/i }).first(),
    ).toContainText(/choose|select|resolve/i);
    await expect(
      typeField(page).locator(".ant-select-selection-item"),
    ).toHaveCount(0);
    if (scenario === "unreadable") expect(mock.typeReads).toHaveLength(0);
    noWrites(mock);
  });
}

for (const suffix of [
  `${new URLSearchParams({ hubKind: kind, serialNumber: serial })}&hubKind=duplicate`,
  new URLSearchParams({ hubKind: kind }).toString(),
  new URLSearchParams({
    hubKind: kind,
    serialNumber: "SYNTHETIC\nINVALID",
  }).toString(),
]) {
  test(`malformed registration parameters are rejected without guessing a type: ${suffix}`, async ({
    page,
  }) => {
    const mock = await mockRegistration(page);
    await page.goto(`/hubs/new?${suffix}`);
    await expect(page.getByRole("alert")).toContainText(/invalid|malformed/i);
    await expect(
      page
        .locator("#IDHubType")
        .locator("xpath=ancestor::div[contains(@class,'ant-form-item')][1]")
        .locator(".ant-select-selection-item"),
    ).toHaveCount(0);
    noWrites(mock);
  });
}

test("a create conflict preserves the registration draft and exact submitted identity", async ({
  page,
}) => {
  const mock = await mockRegistration(page);
  mock.conflict();
  await page.goto(prefill());
  await expectPrefill(page);
  await expect(
    typeField(page).locator(".ant-select-selection-item"),
  ).toContainText(typeId);
  await page
    .getByLabel("Label", { exact: true })
    .fill("Synthetic unsaved registration label");
  await page.getByRole("button", { name: /Save hub$/ }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic hub identity already exists.",
  );
  await expect(page.getByLabel("Serial number", { exact: true })).toHaveValue(
    serial,
  );
  await expect(page.getByLabel("Label", { exact: true })).toHaveValue(
    "Synthetic unsaved registration label",
  );
  await expect(
    typeField(page).locator(".ant-select-selection-item"),
  ).toContainText(typeId);
  expect(mock.posts).toHaveLength(1);
  expect(mock.posts[0]).toMatchObject({
    SerialNr: serial,
    IDHubType: typeId,
    Label: "Synthetic unsaved registration label",
  });
  expect(new URL(page.url()).pathname).toBe("/hubs/new");
  expect(mock.otherWrites).toEqual([]);
  expect(mock.fixture.unexpected).toEqual([]);
});

test("Save alone creates the hub, opens its exact detail ID and invalidates the Overview candidate", async ({
  page,
}) => {
  const mock = await mockRegistration(page);
  await page.goto("/");
  await card(page).getByRole("link", { name: serial, exact: true }).click();
  await expectPrefill(page);
  await expect(
    typeField(page).locator(".ant-select-selection-item"),
  ).toContainText(typeId);
  noWrites(mock);
  const readsBeforeSave = mock.overviewReads();
  await page.getByRole("button", { name: /Save hub$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/hubs/${hubId}$`));
  expect(mock.posts).toHaveLength(1);
  expect(mock.posts[0]).toMatchObject({ SerialNr: serial, IDHubType: typeId });
  await page.getByRole("menuitem", { name: /Overview$/ }).click();
  await expect(card(page)).toContainText(
    "No unregistered hubs found in the checked rejections.",
  );
  await expect(
    card(page).getByRole("link", { name: serial, exact: true }),
  ).toHaveCount(0);
  expect(mock.overviewReads()).toBeGreaterThan(readsBeforeSave);
  expect(mock.otherWrites).toEqual([]);
  expect(mock.fixture.unexpected).toEqual([]);
});

test("a read-only Core service leaves candidate rows and serials noninteractive", async ({
  page,
}) => {
  const mock = await mockRegistration(page);
  mock.fixture.session.services!.core!.writable = false;
  await page.goto("/");
  const cell = card(page).getByRole("cell", { name: serial, exact: true });
  await expect(cell).toBeVisible();
  await expect(
    card(page).getByRole("link", { name: serial, exact: true }),
  ).toHaveCount(0);
  await expect(cell.locator("..")).not.toHaveAttribute("tabindex", "0");
  await cell.click();
  expect(new URL(page.url()).pathname).toBe("/");
  noWrites(mock);
});

test("ordinary readers cannot open platform candidates or create hubs through the registration URL", async ({
  page,
}) => {
  const mock = await mockRegistration(page);
  mock.fixture.session.identity.level = 30;
  mock.fixture.session.identity.userTypeId = "30";
  mock.fixture.session.identity.permissions = [{ entity: "hubs", rights: "r" }];
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your workspace", exact: true }),
  ).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  expect(mock.overviewReads()).toBe(0);
  await page.goto(prefill());
  await expect(
    page.getByText("Changes are unavailable", { exact: true }),
  ).toBeVisible();
  noWrites(mock);
});

test("normal new and edit hub pages keep their existing behavior", async ({
  page,
}) => {
  const mock = await mockRegistration(page);
  await page.goto("/hubs/new");
  await expect(
    page.getByRole("heading", { name: "Add hub", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Serial number", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    typeField(page).locator(".ant-select-selection-item"),
  ).toHaveCount(0);
  await page.goto(
    `/hubs/${hubId}/edit?${new URLSearchParams({ hubKind: kind, serialNumber: serial })}`,
  );
  await expect(
    page.getByRole("heading", { name: "Edit hub", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Serial number", { exact: true })).toHaveValue(
    "SYNTHETIC-EXISTING-SERIAL",
  );
  await expect(
    typeField(page).locator(".ant-select-selection-item"),
  ).toContainText(typeId);
  noWrites(mock);
});
