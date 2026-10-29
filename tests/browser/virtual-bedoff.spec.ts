import { expect, test, type Page } from "@playwright/test";

const sensorId = "1407374883553480";
const deviceId = "1407374883553363";
const assetId = "1407374883553299";
const typeId = "9223372036854775807";
type EventStatus = "queued" | "accepted" | "rejected";

async function syntheticBedoff(
  page: Page,
  options: {
    level?: number;
    writable?: boolean;
    tag?: string;
    typeTag?: string;
    hardwareType?: string;
    valueType?: string;
    supported?: boolean;
    initial?: boolean;
    mode?: EventStatus | "failed";
    malformedStatus?: boolean;
    delayedReadback?: boolean;
  } = {},
) {
  let level = options.level ?? 90;
  const sensor = {
    id: sensorId,
    m_nIDSensor: sensorId,
    m_nIDDevice: deviceId,
    m_nIDAsset: assetId,
    m_nIDSensorType: typeId,
    m_sTag: options.tag ?? "VIRTUAL-BM8701-2-bedoff",
    m_sLabel: "Synthetic bedoff sensor",
    m_bValueBool: options.initial ?? false,
    m_dhDhLastEvent: "2026-10-26T12:00:00.000Z",
  };
  const reads: URL[] = [];
  const posts: { operationId: string; value: boolean; csrf?: string }[] = [];
  const mutations: string[] = [];
  const events = new Map<
    string,
    {
      sensorId: string;
      operationId: string;
      value: boolean;
      status: EventStatus;
      eventAt: string;
    }
  >();
  let hold: { enter: () => void; wait: Promise<void> } | undefined;
  let acceptNext = false;
  let pendingReading: { value: boolean; eventAt: string } | undefined;
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (request.method() !== "GET") {
      mutations.push(`${request.method()} ${path}`);
      if (
        request.method() === "POST" &&
        path === `/api/sensors/${sensorId}/virtual-events`
      ) {
        const body = request.postDataJSON() as {
          operationId: string;
          value: boolean;
        };
        posts.push({ ...body, csrf: request.headers()["x-csrf-token"] });
        if (hold) {
          const pending = hold;
          hold = undefined;
          pending.enter();
          await pending.wait;
        }
        if (options.mode === "failed" && posts.length === 1)
          return reply(
            { message: "Synthetic uncertain telemetry response." },
            503,
          );
        const status: EventStatus = acceptNext
          ? "accepted"
          : options.mode === "queued" || options.mode === "rejected"
            ? options.mode
            : "accepted";
        acceptNext = false;
        const event = {
          sensorId,
          ...body,
          status,
          eventAt: "2026-10-26T12:00:01.000Z",
        };
        events.set(body.operationId, event);
        if (status === "accepted") {
          if (options.delayedReadback) pendingReading = event;
          else {
            sensor.m_bValueBool = body.value;
            sensor.m_dhDhLastEvent = event.eventAt;
          }
        }
        return reply({
          data: options.malformedStatus
            ? { ...event, status: [event.status] }
            : event,
        });
      }
      return reply({ message: "Unexpected synthetic mutation." }, 405);
    }
    reads.push(url);
    if (path === "/api/session")
      return reply({
        identity: {
          id: "100",
          name: "Synthetic simulation operator",
          organizationId: "1",
          userTypeId: String(level),
          level,
          mustChangePassword: false,
          permissions: ["sensors", "sensortypes", "devices", "assets"].map(
            (entity) => ({ entity, rights: "crud" }),
          ),
        },
        csrf: "synthetic-simulation-csrf",
        expiresAt: Date.now() + 3_600_000,
        services: {
          core: { configured: true, writable: options.writable ?? true },
        },
      });
    if (path === `/api/sensors/${sensorId}/virtual-events`)
      return reply({
        data: {
          sensorId,
          supported: options.supported ?? true,
          value: !sensor.m_bValueBool,
        },
      });
    if (path.startsWith(`/api/sensors/${sensorId}/virtual-events/`)) {
      const event = events.get(path.split("/").at(-1)!);
      return event
        ? reply({ data: event })
        : reply({ message: "Synthetic event not found." }, 404);
    }
    if (path === `/api/resources/sensors/${sensorId}`) {
      if (
        pendingReading &&
        reads.filter((read) => read.pathname === path).length >= 3
      ) {
        sensor.m_bValueBool = pendingReading.value;
        sensor.m_dhDhLastEvent = pendingReading.eventAt;
        pendingReading = undefined;
      }
      return reply({ data: sensor });
    }
    if (path === "/api/resources/sensors")
      return reply({ data: [sensor], total: 1 });
    if (path === `/api/resources/sensortypes/${typeId}`)
      return reply({
        data: {
          id: typeId,
          m_nIDSensorType: typeId,
          m_sTag: options.typeTag ?? "bedoff",
          m_sHardwareType: options.hardwareType ?? "bedoff",
          m_nValueType: options.valueType ?? "1",
        },
      });
    if (path === `/api/resources/devices/${deviceId}`)
      return reply({
        data: {
          id: deviceId,
          m_nIDDevice: deviceId,
          m_nIDAsset: assetId,
          m_nIDHub: "0",
          m_nIDDeviceType: "0",
          m_nIDOrganization: "1",
          m_sTag: "VIRTUAL-BM8701-2-realtime",
          m_sLabel: "Synthetic virtual device",
        },
      });
    if (path === `/api/resources/assets/${assetId}`)
      return reply({
        data: {
          id: assetId,
          m_nIDAsset: assetId,
          m_nIDOrganization: "1",
          m_sTag: "VIRTUAL-BM8701-2",
          m_sLabel: "Synthetic virtual asset",
        },
      });
    if (path === "/api/resources/organizations/1")
      return reply({
        data: { id: "1", m_nIDOrganization: "1", m_sTag: "SYNTHETIC-ORG" },
      });
    // All reads and writes remain synthetic, including optional tabs and references.
    return reply({ data: [], total: 0 });
  });
  return {
    sensor,
    reads,
    posts,
    mutations,
    acceptQueued: () => {
      for (const event of events.values()) {
        event.status = "accepted";
        sensor.m_bValueBool = event.value;
        sensor.m_dhDhLastEvent = event.eventAt;
      }
    },
    acceptRetryPost: () => {
      acceptNext = true;
    },
    ordinarySession: () => {
      level = 30;
    },
    holdPost: () => {
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      hold = { enter, wait };
      return { entered, release };
    },
  };
}

function controls(page: Page) {
  return page.locator(".virtual-bedoff-controls");
}
function button(page: Page, value: boolean) {
  return controls(page).getByRole("button", {
    name: value ? "Bed vacant" : "Bed occupied",
    exact: true,
  });
}
async function expectCurrent(page: Page, value: boolean) {
  await expect(
    controls(page).getByText(
      `Current reading: ${value ? "Bed vacant" : "Bed occupied"}`,
      { exact: true },
    ),
  ).toBeVisible();
}

test("Sensor Details sends both exact bedoff mappings and reads back confirmed values without optimistic updates", async ({
  page,
}, testInfo) => {
  const mock = await syntheticBedoff(page, {
      typeTag: "Renamed bed vacancy",
      hardwareType: "BEDOFF",
    }),
    held = mock.holdPost();
  await page.goto(`/sensors/${sensorId}`);
  await expectCurrent(page, false); // Capability.value deliberately disagrees with the sensor.
  await button(page, true).click();
  await held.entered;
  await expect(button(page, false)).toBeDisabled();
  await expect(button(page, true)).toBeDisabled();
  await expectCurrent(page, false);
  expect(mock.posts).toHaveLength(1);
  expect(mock.posts[0]).toMatchObject({
    value: true,
    csrf: "synthetic-simulation-csrf",
  });
  expect(mock.posts[0].operationId).toMatch(
    /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i,
  );
  held.release();
  await expectCurrent(page, true);
  await expect(
    page.locator('time[datetime="2026-10-26T12:00:01.000Z"]'),
  ).toBeVisible();
  await expect(button(page, false)).toBeEnabled();
  await expect(controls(page)).toContainText(
    "Telemetry accepted. Readings update after processing.",
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("virtual-bedoff-desktop.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("virtual-bedoff-mobile.png"),
    animations: "disabled",
  });
  await button(page, false).click();
  await expectCurrent(page, false);
  await expect(button(page, true)).toBeEnabled();
  expect(mock.posts.map((event) => event.value)).toEqual([true, false]);
  expect(mock.posts[1].operationId).not.toBe(mock.posts[0].operationId);
  expect(mock.mutations).toEqual(
    Array(2).fill(`POST /api/sensors/${sensorId}/virtual-events`),
  );
});

test("Device Sensors exposes bed-state actions beside the reading without opening the row", async ({
  page,
}) => {
  const mock = await syntheticBedoff(page, { initial: true });
  await page.goto(`/devices/${deviceId}?tab=sensors`);
  await expectCurrent(page, true);
  await button(page, false).click();
  await expectCurrent(page, false);
  await expect(page).toHaveURL(
    new RegExp(`/devices/${deviceId}\\?tab=sensors$`),
  );
  expect(mock.posts[0].value).toBe(false);
  expect(
    mock.reads.filter((url) => url.pathname === "/api/resources/sensors")
      .length,
  ).toBeGreaterThan(1);
  expect(mock.mutations).toEqual([
    `POST /api/sensors/${sensorId}/virtual-events`,
  ]);
});

test("an unchanged bed state still waits for a reading at the accepted event time", async ({
  page,
}) => {
  const mock = await syntheticBedoff(page, { delayedReadback: true });
  await page.goto(`/sensors/${sensorId}`);
  await expectCurrent(page, false);
  await button(page, false).click();
  await expect(button(page, true)).toBeEnabled();
  await expectCurrent(page, false);
  await expect(
    page.locator('time[datetime="2026-10-26T12:00:01.000Z"]'),
  ).toBeVisible();
  expect(
    mock.reads.filter(
      (url) => url.pathname === `/api/resources/sensors/${sensorId}`,
    ).length,
  ).toBeGreaterThanOrEqual(3);
  expect(mock.posts).toHaveLength(1);
  expect(mock.posts[0].value).toBe(false);
});

for (const restricted of [
  { name: "ordinary operator", level: 30 },
  { name: "paused Core writes", writable: false },
  { name: "physical sensor", tag: "PHYSICAL-bedoff" },
  { name: "another sensor type", hardwareType: "bedtempmax" },
  { name: "nonboolean bedoff type", valueType: "2" },
  { name: "unsupported capability", supported: false },
])
  test(`${restricted.name} never exposes bed-state mutation controls`, async ({
    page,
  }) => {
    const mock = await syntheticBedoff(page, restricted);
    await page.goto(`/sensors/${sensorId}`);
    await expect(
      page.getByRole("heading", {
        name: "Synthetic bedoff sensor",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator(".ant-descriptions").getByRole("link", {
        name: "bedoff",
        exact: true,
      }),
    ).toBeVisible();
    await expect(controls(page)).toHaveCount(0);
    if (restricted.supported === false)
      await expect
        .poll(
          () =>
            mock.reads.filter(
              (url) =>
                url.pathname === `/api/sensors/${sensorId}/virtual-events`,
            ).length,
        )
        .toBe(1);
    else
      expect(
        mock.reads.filter((url) =>
          url.pathname.startsWith(`/api/sensors/${sensorId}/virtual-events`),
        ),
      ).toHaveLength(0);
    expect(mock.mutations).toEqual([]);
  });

test("an uncertain event survives SPA navigation and explicit retry retains its operation UUID", async ({
  page,
}) => {
  const mock = await syntheticBedoff(page, { mode: "failed" });
  await page.goto(`/sensors/${sensorId}`);
  await button(page, true).click();
  await expect(controls(page)).toContainText(
    "Synthetic uncertain telemetry response.",
  );
  await expectCurrent(page, false);
  await expect(button(page, false)).toBeDisabled();
  const original = mock.posts[0];
  await page.locator('.ant-breadcrumb a[href="/sensors"]').click();
  const row = page.locator(`tr[data-row-key="${sensorId}"]`);
  await row.focus();
  await row.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/sensors/${sensorId}$`));
  await expect(
    controls(page).getByRole("button", {
      name: "Retry simulation",
      exact: true,
    }),
  ).toBeVisible();
  expect(mock.posts).toHaveLength(1);
  await controls(page)
    .getByRole("button", { name: "Retry simulation", exact: true })
    .click();
  await expectCurrent(page, true);
  await expect(button(page, false)).toBeEnabled();
  expect(mock.posts).toEqual([original, original]);
  expect(
    mock.reads.some(
      (url) =>
        url.pathname ===
        `/api/sensors/${sensorId}/virtual-events/${original.operationId}`,
    ),
  ).toBe(true);
});

test("queued telemetry polls within a bound and checks the same event without another POST", async ({
  page,
}) => {
  const mock = await syntheticBedoff(page, { mode: "queued" });
  await page.goto(`/sensors/${sensorId}`);
  await button(page, true).click();
  await expect(controls(page)).toContainText(
    "Telemetry stored and queued. Processing is not confirmed.",
  );
  await expectCurrent(page, false);
  const retry = controls(page).getByRole("button", {
    name: "Retry simulation",
    exact: true,
  });
  await expect(retry).toBeVisible({ timeout: 10000 });
  expect(
    mock.reads.filter((url) => url.pathname.includes("/virtual-events/"))
      .length,
  ).toBe(3);
  await expect(button(page, true)).toBeDisabled();
  mock.acceptQueued();
  await retry.click();
  await expectCurrent(page, true);
  await expect(button(page, false)).toBeEnabled();
  expect(mock.posts).toHaveLength(1);
});

test("a rejected event is terminal, preserves the reading and permits a new explicit operation", async ({
  page,
}) => {
  const mock = await syntheticBedoff(page, { mode: "rejected" });
  await page.goto(`/sensors/${sensorId}`);
  await button(page, true).click();
  await expect(controls(page)).toContainText(
    "Telemetry was rejected. The sensor reading is unchanged.",
  );
  await expectCurrent(page, false);
  await expect(button(page, true)).toBeEnabled();
  await expect(
    controls(page).getByRole("button", {
      name: "Retry simulation",
      exact: true,
    }),
  ).toHaveCount(0);
  await button(page, true).click();
  await expect.poll(() => mock.posts.length).toBe(2);
  expect(mock.posts[1].operationId).not.toBe(mock.posts[0].operationId);
  expect(mock.sensor.m_bValueBool).toBe(false);
});

test("explicit retry dispatches a still-queued event once using its original UUID", async ({
  page,
}) => {
  const mock = await syntheticBedoff(page, { mode: "queued" });
  await page.goto(`/sensors/${sensorId}`);
  await button(page, true).click();
  const retry = controls(page).getByRole("button", {
    name: "Retry simulation",
    exact: true,
  });
  await expect(retry).toBeVisible({ timeout: 10000 });
  const original = mock.posts[0];
  await expectCurrent(page, false);
  await expect(controls(page)).toContainText(
    "Wait a moment, then use Retry simulation if needed.",
  );
  await expect(controls(page)).not.toContainText("Telemetry accepted.");
  expect(mock.posts).toHaveLength(1);
  expect(
    mock.reads.filter((url) => url.pathname.includes("/virtual-events/")),
  ).toHaveLength(3);
  mock.acceptRetryPost();
  await retry.click();
  await expectCurrent(page, true);
  await expect(button(page, false)).toBeEnabled();
  expect(mock.posts).toEqual([original, original]);
  expect(
    mock.reads.filter((url) => url.pathname.includes("/virtual-events/")),
  ).toHaveLength(4);
});

test("a non-string receipt status remains unconfirmed without polling or changing the reading", async ({
  page,
}) => {
  const mock = await syntheticBedoff(page, {
    mode: "queued",
    malformedStatus: true,
  });
  await page.goto(`/sensors/${sensorId}`);
  await button(page, true).click();
  await expect(controls(page)).toContainText(
    "The simulation response could not be confirmed.",
  );
  await expectCurrent(page, false);
  await expect(button(page, true)).toBeDisabled();
  await expect(
    controls(page).getByRole("button", {
      name: "Retry simulation",
      exact: true,
    }),
  ).toBeVisible();
  expect(mock.posts).toHaveLength(1);
  expect(
    mock.reads.filter((url) => url.pathname.includes("/virtual-events/")),
  ).toHaveLength(0);
});

test("a late event response cannot poll, refresh or replay into a changed account session", async ({
  page,
}) => {
  const mock = await syntheticBedoff(page),
    held = mock.holdPost();
  await page.goto(`/sensors/${sensorId}`);
  await button(page, true).click();
  await held.entered;
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "tronicare-admin-session-revision",
        newValue: "synthetic-logout",
      }),
    ),
  );
  await expect(page).toHaveURL(/\/login$/);
  const reads = mock.reads.length;
  held.release();
  await expect(page).toHaveURL(/\/login$/);
  expect(mock.reads.length).toBe(reads);
  mock.ordinarySession();
  await page.goto(`/sensors/${sensorId}`);
  await expect(
    page.getByRole("heading", { name: "Synthetic bedoff sensor", exact: true }),
  ).toBeVisible();
  await expect(controls(page)).toHaveCount(0);
  expect(mock.posts).toHaveLength(1);
  expect(
    mock.reads.filter((url) => url.pathname.includes("/virtual-events/")),
  ).toHaveLength(0);
});
