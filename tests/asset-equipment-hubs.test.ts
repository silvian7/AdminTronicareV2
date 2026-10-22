import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app";
import { MemorySessions } from "../server/sessions";
import type { Transport } from "../server/upstream";
import {
  resourceMap,
  type Identity,
  type RecordData,
} from "../shared/resources";
import {
  fixtureRecord,
  fixtureTransport,
  testConfig,
  testIdentity,
  wireRecord,
  type CapturedCall,
} from "./fixtures";

const assetId = "9223372036854775807";
const directId = "9223372036854775806";
const sharedId = "9223372036854775805";
const deviceId = "9223372036854775804";
const path = `/api/assets/${assetId}/equipment-hubs`;
const ordinary: Identity = {
  ...testIdentity,
  userTypeId: "30",
  level: 30,
  permissions: [
    { entity: "assets", rights: "r" },
    { entity: "hubs", rights: "ru" },
    { entity: "devices", rights: "r" },
  ],
};
const hub = (id: string, owner: string, overrides: RecordData = {}) =>
  fixtureRecord(resourceMap.hubs, id, {
    m_nIDAsset: owner,
    m_nIDOrganization: "7",
    m_nIDHubType: "100",
    m_sTag: `synthetic-hub-${id}`,
    m_dhDhLastEvent: "2026-01-01T12:00:00Z",
    ...overrides,
  });
const device = (id: string, parent: string, overrides: RecordData = {}) =>
  fixtureRecord(resourceMap.devices, id, {
    IDAsset: assetId,
    IDOrganization: "7",
    IDHub: parent,
    ...overrides,
  });
const listResponse = (name: "hubs" | "devices", rows: RecordData[]) =>
  new Response(
    `[${rows.map((row) => wireRecord(resourceMap[name], row)).join(",")}]`,
    { headers: { "Content-Type": "application/json" } },
  );

async function setup(identity: Identity = ordinary) {
  const fixture = fixtureTransport(identity);
  fixture.records.set("assets", [fixtureRecord(resourceMap.assets, assetId)]);
  fixture.records.set("hubs", [hub(directId, assetId), hub(sharedId, "0")]);
  const lists = {
    hubs: [hub(directId, assetId)],
    devices: [device(deviceId, sharedId)],
  };
  const visibleAssets = new Set([assetId]);
  const calls: CapturedCall[] = [];
  const replies = new Map<string, () => Response>();
  const concurrency: {
    active: number;
    maximum: number;
    delayMs: number;
    beforeReply?: () => Promise<void>;
  } = { active: 0, maximum: 0, delayMs: 0 };
  const transport: Transport = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: new Headers(init?.headers),
      body: init?.body as string | undefined,
    });
    if (url.pathname === "/v1/assets/scope")
      return Response.json(
        [...visibleAssets].map((id) => ({
          m_nIDAsset: id,
          m_nIDOrganization: identity.organizationId,
        })),
      );
    if (method === "GET" && /^\/v1\/hubs\/\d+$/.test(url.pathname)) {
      concurrency.active += 1;
      concurrency.maximum = Math.max(concurrency.maximum, concurrency.active);
      try {
        await concurrency.beforeReply?.();
        if (concurrency.delayMs)
          await new Promise((resolve) =>
            setTimeout(resolve, concurrency.delayMs),
          );
        const replacement = replies.get(url.pathname);
        if (replacement) return replacement();
        const id = url.pathname.split("/").at(-1);
        const row = fixture.records
          .get("hubs")!
          .find((row) => row.m_nIDHub === id);
        return row
          ? new Response(wireRecord(resourceMap.hubs, row))
          : new Response(null, { status: 404 });
      } finally {
        concurrency.active -= 1;
      }
    }
    const replacement = replies.get(url.pathname);
    if (replacement) return replacement();
    if (method === "GET" && url.pathname === "/v1/hubs")
      return listResponse("hubs", lists.hubs);
    if (method === "GET" && url.pathname === "/v1/devices")
      return listResponse("devices", lists.devices);
    return fixture.transport(input, init);
  };
  const api = supertest.agent(
    createApp(testConfig, new MemorySessions(), transport),
  );
  const login = await api
    .post("/api/session/login")
    .set("Origin", testConfig.publicOrigin)
    .send({ login: "synthetic", password: "fixture-password" });
  expect(login.status).toBe(200);
  calls.length = 0;
  const coreCalls = () =>
    calls.filter((call) => call.url.origin === testConfig.origins.core);
  const parentCalls = () =>
    coreCalls().filter((call) => /^\/v1\/hubs\/\d+$/.test(call.url.pathname));
  return {
    api,
    fixture,
    lists,
    visibleAssets,
    calls,
    replies,
    concurrency,
    coreCalls,
    parentCalls,
    csrf: login.body.csrf as string,
  };
}

describe("asset equipment hubs", () => {
  it.each([ordinary, testIdentity])(
    "combines direct and shared parent hubs with exact IDs for level $level",
    async (identity) => {
      const { api, fixture, calls, coreCalls } = await setup(identity);
      fixture.records.set("hubs", [
        hub(sharedId, "0", {
          m_sThingId: "synthetic-internal-thing",
          m_sThingKey: "synthetic-private-key",
          Password: "synthetic-private-password",
          unrelated: "synthetic-private-extra",
        }),
      ]);
      const response = await api.get(path);
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toMatchObject({ total: 2, limited: false });
      const direct = response.body.data.find(
        (row: RecordData) => row.id === directId,
      );
      const shared = response.body.data.find(
        (row: RecordData) => row.id === sharedId,
      );
      expect(direct).toMatchObject({
        id: directId,
        m_nIDHub: directId,
        m_nIDAsset: assetId,
        _sharedGateway: false,
        _canOpenHub: true,
      });
      expect(shared).toMatchObject({
        id: sharedId,
        m_nIDHub: sharedId,
        m_nIDAsset: "0",
        _sharedGateway: true,
        _canOpenHub: identity.level >= 90,
      });
      expect(Object.keys(shared).sort()).toEqual(
        [
          "id",
          "m_nIDHub",
          "m_nIDHubType",
          "m_nIDOrganization",
          "m_nIDAsset",
          "m_sTag",
          "m_sLabel",
          "m_sSerialNr",
          "m_dhDhLastEvent",
          "_sharedGateway",
          "_canOpenHub",
        ].sort(),
      );
      expect(JSON.stringify(response.body)).not.toMatch(
        /synthetic-(?:private|internal)|ThingId|ThingKey|Password/,
      );
      expect(
        coreCalls()
          .map((call) => call.url.pathname)
          .sort(),
      ).toEqual(["/v1/devices", "/v1/hubs", `/v1/hubs/${sharedId}`].sort());
      for (const call of coreCalls()) {
        expect(call.method).toBe("GET");
        expect(call.headers.get("Token")).toBe("synthetic-session-token");
        expect(call.headers.has("Authorization")).toBe(false);
        expect(call.body).toBeUndefined();
        expect([...call.url.searchParams]).toEqual(
          call.url.pathname.endsWith(sharedId) ? [] : [["idasset", assetId]],
        );
      }
      if (identity.level < 90) {
        const scopeIndex = calls.findIndex(
          (call) => call.url.pathname === "/v1/assets/scope",
        );
        const firstCore = calls.findIndex(
          (call) => call.url.origin === testConfig.origins.core,
        );
        expect(scopeIndex).toBeGreaterThan(-1);
        expect(scopeIndex).toBeLessThan(firstCore);
      }
    },
  );

  it("deduplicates repeated devices and retains the direct-list hub record", async () => {
    const { api, fixture, lists, parentCalls } = await setup();
    lists.hubs = [hub(directId, assetId, { m_sTag: "direct-list-wins" })];
    lists.devices = [
      device("11", directId),
      device("12", sharedId),
      device("13", sharedId),
    ];
    fixture.records.set("hubs", [
      hub(directId, assetId, { m_sTag: "detail-must-not-replace-direct" }),
      hub(sharedId, "0"),
    ]);
    const response = await api.get(path);
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
    expect(
      response.body.data.find((row: RecordData) => row.id === directId).m_sTag,
    ).toBe("direct-list-wins");
    expect(parentCalls().map((call) => call.url.pathname)).toEqual([
      `/v1/hubs/${sharedId}`,
    ]);
  });

  it("excludes foreign-asset devices and foreign-organization devices or parents", async () => {
    const { api, fixture, lists, parentCalls } = await setup(testIdentity);
    lists.hubs.push(
      hub("60", "20"),
      hub("61", assetId, { m_nIDOrganization: "9" }),
    );
    lists.devices.push(
      device("11", "40", { IDAsset: "20" }),
      device("12", "41", { IDOrganization: "9" }),
    );
    fixture.records.set("hubs", [
      hub(sharedId, "0", { m_nIDOrganization: "9" }),
    ]);
    const response = await api.get(path);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 1, limited: true });
    expect(response.body.data[0].id).toBe(directId);
    expect(parentCalls().map((call) => call.url.pathname)).toEqual([
      `/v1/hubs/${sharedId}`,
    ]);
  });

  it("does not expose shared hubs through ordinary generic show or writes", async () => {
    const { api, csrf, coreCalls } = await setup();
    expect(
      (await api.get(path)).body.data.some(
        (row: RecordData) => row.id === sharedId,
      ),
    ).toBe(true);
    expect((await api.get(`/api/resources/hubs/${sharedId}`)).status).toBe(403);
    const update = await api
      .put(`/api/resources/hubs/${sharedId}`)
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", csrf)
      .send({ Tag: "blocked" });
    expect(update.status).toBe(403);
    expect(coreCalls().every((call) => call.method === "GET")).toBe(true);
  });

  it.each(["assets", "hubs"])(
    "requires %s read permission before Core calls",
    async (missing) => {
      const { api, coreCalls } = await setup({
        ...ordinary,
        permissions: ordinary.permissions.filter(
          (permission) => permission.entity !== missing,
        ),
      });
      expect((await api.get(path)).status).toBe(403);
      expect(coreCalls()).toHaveLength(0);
    },
  );

  it("returns only direct hubs without devices permission and never calls devices or parents", async () => {
    const { api, coreCalls } = await setup({
      ...ordinary,
      permissions: ordinary.permissions.filter(
        (permission) => permission.entity !== "devices",
      ),
    });
    const response = await api.get(path);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 1, limited: false });
    expect(response.body.data[0].id).toBe(directId);
    expect(coreCalls().map((call) => call.url.pathname)).toEqual(["/v1/hubs"]);
  });

  it.each(["grant", "organization", "identity"])(
    "denies an inaccessible asset (%s) before Core queries",
    async (reason) => {
      const { api, fixture, visibleAssets, replies, coreCalls } = await setup();
      if (reason === "grant") visibleAssets.clear();
      if (reason === "organization")
        fixture.records.set("assets", [
          fixtureRecord(resourceMap.assets, assetId, {
            m_nIDOrganization: "9",
          }),
        ]);
      if (reason === "identity")
        replies.set(`/v1/assets/${assetId}`, () =>
          Response.json(fixtureRecord(resourceMap.assets, "1")),
        );
      expect((await api.get(path)).status).toBe(403);
      expect(coreCalls()).toHaveLength(0);
    },
  );

  it("does not return hub metadata if the target asset grant is revoked during parent lookup", async () => {
    const { api, visibleAssets, concurrency } = await setup();
    let release!: () => void;
    let started!: () => void;
    const parentLookupStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const heldParent = new Promise<void>((resolve) => {
      release = resolve;
    });
    concurrency.beforeReply = async () => {
      started();
      await heldParent;
    };
    const pending = api.get(path).then((response) => response);
    await parentLookupStarted;
    visibleAssets.clear();
    release();
    const response = await pending;
    expect(response.status).toBe(403);
    expect(response.body.data).toBeUndefined();
  });

  it.each([403, 404])(
    "omits a parent denied by Core (%s) and marks the result partial",
    async (status) => {
      const { api, replies } = await setup();
      replies.set(
        `/v1/hubs/${sharedId}`,
        () => new Response("synthetic-private-dependency", { status }),
      );
      const response = await api.get(path);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ total: 1, limited: true });
      expect(response.body.data[0].id).toBe(directId);
      expect(JSON.stringify(response.body)).not.toContain(
        "synthetic-private-dependency",
      );
    },
  );

  it.each(["hubs", "devices", "parent"])(
    "fails closed for unavailable %s dependencies",
    async (dependency) => {
      const { api, replies } = await setup();
      const upstreamPath =
        dependency === "parent" ? `/v1/hubs/${sharedId}` : `/v1/${dependency}`;
      replies.set(
        upstreamPath,
        () => new Response("synthetic-private-failure", { status: 503 }),
      );
      const response = await api.get(path);
      expect(response.status).toBe(503);
      expect(response.body.data).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain(
        "synthetic-private-failure",
      );
    },
  );

  it.each([
    "hub-list",
    "device-list",
    "parent-id",
    "parent-asset",
    "device-parent",
    "device-id",
  ])("fails closed for malformed %s identity or response", async (defect) => {
    const { api, lists, replies } = await setup();
    if (defect === "hub-list")
      replies.set("/v1/hubs", () => Response.json({ data: [] }));
    if (defect === "device-list")
      replies.set("/v1/devices", () => Response.json([null]));
    if (defect === "parent-id")
      replies.set(`/v1/hubs/${sharedId}`, () => Response.json(hub("1", "0")));
    if (defect === "parent-asset")
      replies.set(`/v1/hubs/${sharedId}`, () =>
        Response.json(hub(sharedId, "00")),
      );
    if (defect === "device-parent") lists.devices = [device(deviceId, "0")];
    if (defect === "device-id") lists.devices = [device("-1", sharedId)];
    const response = await api.get(path);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.data).toBeUndefined();
  });

  it("binds the optional organization to the actual asset, including platform workspaces", async () => {
    const { api, fixture, coreCalls } = await setup(testIdentity);
    fixture.records.set("assets", [
      fixtureRecord(resourceMap.assets, assetId, { m_nIDOrganization: "9" }),
    ]);
    expect((await api.get(`${path}?_organization=7`)).status).toBe(403);
    expect(coreCalls()).toHaveLength(0);
  });

  it("accepts a matching organization without forwarding workspace parameters to Core", async () => {
    const { api, coreCalls } = await setup();
    expect((await api.get(`${path}?_organization=7`)).status).toBe(200);
    expect(
      coreCalls().every((call) => !call.url.searchParams.has("_organization")),
    ).toBe(true);
  });

  it.each(["?idasset=1", "?_organization=7&_organization=9", "?unexpected=1"])(
    "rejects unsupported query %s",
    async (query) => {
      const { api, coreCalls } = await setup();
      expect((await api.get(path + query)).status).toBe(400);
      expect(coreCalls()).toHaveLength(0);
    },
  );

  it.each(["0", "001", "-1", "9223372036854775808"])(
    "rejects invalid target asset ID %s",
    async (id) => {
      const { api, coreCalls } = await setup();
      expect((await api.get(`/api/assets/${id}/equipment-hubs`)).status).toBe(
        400,
      );
      expect(coreCalls()).toHaveLength(0);
    },
  );

  it("bounds unique missing-parent requests to 100 with at most four concurrent reads", async () => {
    const { api, fixture, lists, parentCalls, concurrency } = await setup();
    const parents = Array.from({ length: 101 }, (_, index) =>
      String(1000 + index),
    );
    lists.devices = parents.map((parent, index) =>
      device(String(2000 + index), parent),
    );
    fixture.records.set(
      "hubs",
      parents.map((id) => hub(id, "0")),
    );
    concurrency.delayMs = 5;
    const response = await api.get(path);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 101, limited: true });
    expect(parentCalls()).toHaveLength(100);
    expect(new Set(parentCalls().map((call) => call.url.pathname)).size).toBe(
      100,
    );
    expect(concurrency.maximum).toBe(4);
  });

  it.each(["hubs", "devices"] as const)(
    "marks a 10,000-row %s source as limited",
    async (name) => {
      const { api, lists, parentCalls } = await setup();
      lists.devices = [device(deviceId, directId)];
      lists[name] = Array.from({ length: 10000 }, () =>
        name === "hubs" ? hub(directId, assetId) : device(deviceId, directId),
      );
      const response = await api.get(path);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ total: 1, limited: true });
      expect(parentCalls()).toHaveLength(0);
    },
  );
});
