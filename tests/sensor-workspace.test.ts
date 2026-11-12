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
} from "./fixtures";

const sensor = (id: string, device: string, asset = "0") =>
  fixtureRecord(resourceMap.sensors, id, {
    m_nIDDevice: device,
    m_nIDAsset: asset,
  });
const device = (id: string, organization = "7", asset = "0") =>
  fixtureRecord(resourceMap.devices, id, {
    IDOrganization: organization,
    IDAsset: asset,
  });

async function setup(
  options: {
    identity?: Identity;
    sensors?: RecordData[];
    devices?: RecordData[];
    override?: (
      url: URL,
      init?: RequestInit,
    ) => Response | undefined | Promise<Response | undefined>;
  } = {},
) {
  const fixture = fixtureTransport(options.identity ?? testIdentity);
  fixture.records.set("assets", [
    fixtureRecord(resourceMap.assets, "1", { m_nIDOrganization: "7" }),
    fixtureRecord(resourceMap.assets, "99", { m_nIDOrganization: "8" }),
  ]);
  fixture.records.set("sensors", options.sensors ?? [sensor("2", "10")]);
  fixture.records.set("devices", options.devices ?? [device("10")]);
  const calls: { url: URL; init?: RequestInit }[] = [];
  const transport: Transport = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const response = await options.override?.(url, init);
    return response ?? fixture.transport(input, init);
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
  const parents = () =>
    calls.filter(({ url }) => /^\/v1\/devices\/\d+$/.test(url.pathname));
  return { api, calls, parents };
}

describe("sensor Workspace organization projection", () => {
  it("includes exact same-organization unassigned parents alongside assigned sensors", async () => {
    const { api, parents } = await setup({
      sensors: [
        sensor("1", "1", "1"),
        sensor("2", "10"),
        sensor("3", "20"),
        sensor("4", "30", "99"),
      ],
      devices: [device("10"), device("20", "8"), device("30")],
    });
    const response = await api.get("/api/resources/sensors?_organization=7");
    expect(response.status).toBe(200);
    expect(response.body.data.map((row: RecordData) => row.id)).toEqual([
      "1",
      "2",
    ]);
    expect(response.body).toMatchObject({ total: 2, limited: false });
    expect(parents().map(({ url }) => url.pathname)).toEqual([
      "/v1/devices/10",
      "/v1/devices/20",
    ]);
  });

  it("preserves the exact device filter and uses the signed-in caller token", async () => {
    const id = "9223372036854775806";
    const { api, calls, parents } = await setup({
      sensors: [sensor("2", id)],
      devices: [device(id)],
    });
    const response = await api.get(
      `/api/resources/sensors?iddevice=${id}&_organization=7`,
    );
    expect(response.status).toBe(200);
    expect(response.body.data.map((row: RecordData) => row.id)).toEqual(["2"]);
    expect(
      calls
        .find(({ url }) => url.pathname === "/v1/sensors")
        ?.url.searchParams.get("iddevice"),
    ).toBe(id);
    expect(parents()[0]?.url.pathname).toBe(`/v1/devices/${id}`);
    expect(new Headers(parents()[0]?.init?.headers).get("Token")).toBe(
      "synthetic-session-token",
    );
  });

  it("uses organization zero for the Unassigned Workspace", async () => {
    const { api } = await setup({
      sensors: [sensor("2", "10"), sensor("3", "20")],
      devices: [device("10", "0"), device("20", "7")],
    });
    const response = await api.get("/api/resources/sensors?_organization=0");
    expect(response.status).toBe(200);
    expect(response.body.data.map((row: RecordData) => row.id)).toEqual(["2"]);
    expect(response.body.limited).toBe(false);
  });

  it("keeps ordinary administrator asset scope and performs no parent lookups", async () => {
    const { api, parents } = await setup({
      identity: { ...testIdentity, level: 30, userTypeId: "30" },
      sensors: [sensor("1", "1", "1"), sensor("2", "10")],
    });
    const response = await api.get("/api/resources/sensors?_organization=7");
    expect(response.status).toBe(200);
    expect(response.body.data.map((row: RecordData) => row.id)).toEqual(["1"]);
    expect(parents()).toHaveLength(0);
    expect(response.body.limited).toBe(false);
  });

  it.each([403, 404])(
    "omits unreadable parents and marks the result incomplete (%s)",
    async (status) => {
      const { api } = await setup({
        sensors: [sensor("1", "1", "1"), sensor("2", "10")],
        override: (url) =>
          url.pathname === "/v1/devices/10"
            ? new Response(null, { status })
            : undefined,
      });
      const response = await api.get("/api/resources/sensors?_organization=7");
      expect(response.status).toBe(200);
      expect(response.body.data.map((row: RecordData) => row.id)).toEqual([
        "1",
      ]);
      expect(response.body.limited).toBe(true);
    },
  );

  it.each([
    {
      name: "different parent identity",
      fields: { IDDevice: "11" },
      limited: true,
    },
    {
      name: "missing parent organization",
      fields: { IDOrganization: undefined },
      limited: true,
    },
    {
      name: "malformed parent organization",
      fields: { IDOrganization: "007" },
      limited: true,
    },
    {
      name: "malformed parent asset",
      fields: { IDAsset: "-1" },
      limited: true,
    },
    { name: "assigned parent", fields: { IDAsset: "1" }, limited: false },
  ])("fails closed for $name", async ({ fields, limited }) => {
    const { api } = await setup({
      override: (url) =>
        url.pathname === "/v1/devices/10"
          ? Response.json({ ...device("10"), ...fields })
          : undefined,
    });
    const response = await api.get("/api/resources/sensors?_organization=7");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: [], total: 0, limited });
  });

  it("skips invalid sensor parent identities without requesting them", async () => {
    const { api, parents } = await setup({ sensors: [sensor("2", "0")] });
    const response = await api.get("/api/resources/sensors?_organization=7");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: [], total: 0, limited: true });
    expect(parents()).toHaveLength(0);
  });

  it("deduplicates and bounds parent reads to 100 with four concurrent calls", async () => {
    let active = 0;
    let maximum = 0;
    const signals: AbortSignal[] = [];
    const sensors = Array.from({ length: 101 }, (_, index) =>
      sensor(String(index + 1), String(index + 1)),
    );
    const { api, parents } = await setup({
      sensors: [...sensors, sensor("102", "1")],
      override: async (url, init) => {
        const id = url.pathname.match(/^\/v1\/devices\/(\d+)$/)?.[1];
        if (!id) return;
        active += 1;
        maximum = Math.max(maximum, active);
        signals.push(init!.signal!);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return Response.json(device(id));
      },
    });
    const response = await api.get(
      "/api/resources/sensors?_organization=7&_pageSize=10000",
    );
    expect(response.status).toBe(200);
    expect(parents()).toHaveLength(100);
    expect(maximum).toBe(4);
    expect(new Set(parents().map(({ url }) => url.pathname)).size).toBe(100);
    expect(
      parents().some(({ url }) => url.pathname === "/v1/devices/101"),
    ).toBe(false);
    expect(response.body).toMatchObject({ total: 101, limited: true });
    expect(response.body.data.some((row: RecordData) => row.id === "101")).toBe(
      false,
    );
    expect(signals).toHaveLength(100);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("returns an upstream error instead of a fabricated empty list", async () => {
    const { api } = await setup({
      override: (url) =>
        url.pathname === "/v1/devices/10"
          ? new Response(null, { status: 503 })
          : undefined,
    });
    const response = await api.get("/api/resources/sensors?_organization=7");
    expect(response.status).toBe(503);
    expect(response.body.data).toBeUndefined();
  });

  it.each([
    {
      name: "assigned matches",
      sensors: [sensor("1", "1", "1")],
      workspace: "7",
    },
    { name: "empty records", sensors: [], workspace: "7" },
    { name: "no Workspace", sensors: [sensor("2", "10")], workspace: "" },
  ])("avoids parent reads for $name", async ({ sensors, workspace }) => {
    const { api, parents } = await setup({ sensors });
    const response = await api.get(
      `/api/resources/sensors${workspace ? `?_organization=${workspace}` : ""}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(sensors.length);
    expect(response.body.limited).toBe(false);
    expect(parents()).toHaveLength(0);
  });
});
