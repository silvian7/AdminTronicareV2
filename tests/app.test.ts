import { describe, it, expect } from "vitest";
import supertest from "supertest";
import { createApp, passwordDigest } from "../server/app";
import { MemorySessions } from "../server/sessions";
import {
  fixtureTransport,
  testConfig,
  testIdentity,
  fixtureRecord,
} from "./fixtures";
import {
  resourceMap,
  resources,
  editableFields,
  type Identity,
} from "../shared/resources";

async function setup(identity: Identity = testIdentity) {
  const fixture = fixtureTransport(identity);
  const store = new MemorySessions();
  const api = supertest.agent(createApp(testConfig, store, fixture.transport));
  const login = await api
    .post("/api/session/login")
    .set("Origin", testConfig.publicOrigin)
    .send({
      login: "fixture-admin",
      password: "fixture-password",
      mode: "password",
    });
  expect(login.status).toBe(200);
  const csrf = login.body.csrf as string;
  return { api, fixture, login, csrf, store };
}
describe("session boundary", () => {
  it("uses an opaque HttpOnly cookie and never returns the upstream token", async () => {
    const { api, login, fixture } = await setup();
    expect(login.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(login.headers["set-cookie"][0]).toContain("SameSite=Strict");
    expect(JSON.stringify(login.body)).not.toContain("synthetic-session-token");
    const call = fixture.calls[0];
    expect(call.url.searchParams.get("password")).toBe(
      passwordDigest("fixture-password", "tcare"),
    );
    const me = await api.get("/api/session");
    expect(me.body.identity.id).toBe("1");
    expect(me.headers["cache-control"]).toBe("no-store");
  });
  it("rejects HTTP 200 business login failures", async () => {
    const fixture = fixtureTransport();
    fixture.respondNext(
      Response.json({
        status: false,
        token: "null",
        errormsg: "bad login or password",
      }),
    );
    const result = await supertest(
      createApp(testConfig, new MemorySessions(), fixture.transport),
    )
      .post("/api/session/login")
      .set("Origin", testConfig.publicOrigin)
      .send({ login: "bad", password: "wrong" });
    expect(result.status).toBe(401);
    expect(result.headers["set-cookie"]).toBeUndefined();
  });
  it("requires origin and session-bound CSRF for mutations", async () => {
    const { api, csrf } = await setup();
    expect(
      (await api.post("/api/resources/assets").send({ m_sLabel: "Unsafe" }))
        .status,
    ).toBe(403);
    expect(
      (
        await api
          .post("/api/resources/assets")
          .set("Origin", testConfig.publicOrigin)
          .send({ m_sLabel: "Unsafe" })
      ).status,
    ).toBe(403);
    expect(
      (
        await api
          .post("/api/resources/assets")
          .set("Origin", "https://untrusted.invalid")
          .set("X-CSRF-Token", csrf)
          .send({ m_sLabel: "Unsafe" })
      ).status,
    ).toBe(403);
  });
  it("invalidates the shared session on logout", async () => {
    const { api, csrf } = await setup();
    expect(
      (
        await api
          .post("/api/session/logout")
          .set("Origin", testConfig.publicOrigin)
          .set("X-CSRF-Token", csrf)
          .send({})
      ).status,
    ).toBe(200);
    expect((await api.get("/api/session")).status).toBe(401);
  });
});
describe("contract routing", () => {
  it.each(resources.map((r) => [r.name]))(
    "lists and reads %s using the documented service and DTO",
    async (name) => {
      const { api, fixture } = await setup();
      const resource = resourceMap[name];
      const id = "9223372036854775807";
      fixture.records.set(name, [fixtureRecord(resource, id)]);
      const list = await api.get(`/api/resources/${name}`);
      expect(list.status).toBe(200);
      expect(list.body.data[0].id).toBe(id);
      const detail = await api.get(`/api/resources/${name}/${id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.id).toBe(id);
      const call = fixture.calls.at(-1)!;
      expect(call.url.origin).toBe(testConfig.origins[resource.service]);
      expect(call.headers.get("Token")).toBe("synthetic-session-token");
      expect(call.url.pathname).toBe(
        resource.routes.show!.replace(/\{[^}]+\}/, id),
      );
    },
  );
  it("uses the nested organization-type update route and exact numeric payloads", async () => {
    const { api, fixture, csrf } = await setup();
    const result = await api
      .put("/api/resources/organizationstypes/1")
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", csrf)
      .send({ m_sLabel: "Updated" });
    expect(result.status).toBe(200);
    expect(fixture.calls.at(-1)!.url.pathname).toBe(
      "/v1/organizationstypes/v1/organizationtypes/1",
    );
  });
  it("preserves filter zero and uses the supported collection ceiling", async () => {
    const { api, fixture } = await setup();
    await api.get("/api/resources/assets?idorganization=0");
    const call = fixture.calls.at(-1)!;
    expect(call.url.searchParams.get("idorganization")).toBe("0");
    expect(call.url.searchParams.get("limit")).toBe("10000");
    expect(call.url.searchParams.has("offset")).toBe(false);
  });
  it("handles empty successful delete bodies", async () => {
    const { api, csrf } = await setup();
    const result = await api
      .delete("/api/resources/assets/1")
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(result.status).toBe(200);
    expect(result.body.data.id).toBe("1");
  });
  it("turns documented backend write gates into an actionable error", async () => {
    const { api, fixture, csrf } = await setup();
    fixture.respondNext(new Response("private backend error", { status: 503 }));
    const result = await api
      .post("/api/resources/assets")
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", csrf)
      .send({ m_sLabel: "Updated" });
    expect(result.status).toBe(503);
    expect(result.body.message).toContain("paused");
    expect(JSON.stringify(result.body)).not.toContain("private backend");
  });
  it("translates membership commands to legacy GET mutations behind POST+CSRF", async () => {
    const { api, fixture, csrf } = await setup();
    const result = await api
      .post("/api/memberships")
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", csrf)
      .send({ userId: "1", groupId: "1", action: "add" });
    expect(result.status).toBe(200);
    const call = fixture.calls.at(-1)!;
    expect(call.method).toBe("GET");
    expect(call.url.pathname).toBe("/v1/users2usergroups/addlink");
  });
  it("keeps asset assignment mutations unavailable", async () => {
    const { api, csrf } = await setup();
    expect(
      (
        await api
          .post("/api/assetslinks/user")
          .set("Origin", testConfig.publicOrigin)
          .set("X-CSRF-Token", csrf)
          .send({})
      ).status,
    ).toBe(404);
  });
  it("preserves all history fences and continuation fields", async () => {
    const { api, fixture } = await setup();
    fixture.respondNext(
      new Response("[]", {
        headers: {
          "X-Tronicare-History-Snapshot": "snapshot-fixture",
          "X-Tronicare-History-High-Water-Id": "42",
        },
      }),
    );
    const result = await api.get(
      "/api/history?idsensor=1&afterevent=20260101000000&afterid=2&highwaterid=42&snapshot=snapshot-fixture",
    );
    expect(result.status).toBe(200);
    expect(result.body.snapshot).toBe("snapshot-fixture");
    expect(result.body.highWaterId).toBe("42");
    const q = fixture.calls.at(-1)!.url.searchParams;
    for (const key of ["afterevent", "afterid", "highwaterid", "snapshot"])
      expect(q.has(key)).toBe(true);
  });
});
describe("scope and permissions", () => {
  it("scopes sensor lists through organization assets", async () => {
    const { api, fixture } = await setup();
    fixture.records.set("sensors", [
      fixtureRecord(resourceMap.sensors, "1", { m_nIDAsset: "1" }),
      fixtureRecord(resourceMap.sensors, "2", { m_nIDAsset: "99" }),
    ]);
    const response = await api.get("/api/resources/sensors?_organization=7");
    expect(response.status).toBe(200);
    expect(response.body.data.map((r: { id: string }) => r.id)).toEqual(["1"]);
  });
  it("returns a usable validation error for invalid numeric filters", async () => {
    const { api } = await setup();
    expect(
      (await api.get("/api/resources/assets?idorganization=invalid")).status,
    ).toBe(400);
  });
  it("filters ordinary users' lists and rejects cross-organization direct reads", async () => {
    const { api, fixture } = await setup({ ...testIdentity, level: 30 });
    fixture.records.set("users", [
      fixtureRecord(resourceMap.users, "8", { m_nIDOrganization: "999" }),
    ]);
    const list = await api.get("/api/resources/users?idorganization=999");
    expect(list.body.data).toEqual([]);
    expect(fixture.calls.at(-1)!.url.searchParams.get("idorganization")).toBe(
      "7",
    );
    expect((await api.get("/api/resources/users/8")).status).toBe(403);
  });
  it("prevents role escalation by ordinary administrators", async () => {
    const { api, csrf } = await setup({ ...testIdentity, level: 30 });
    const result = await api
      .put("/api/resources/users/1")
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", csrf)
      .send({ m_nIDUserType: "90" });
    expect(result.status).toBe(403);
  });
  it("denies writes when the user's entity permission is absent", async () => {
    const { api, csrf } = await setup({
      ...testIdentity,
      level: 30,
      permissions: [{ entity: "assets", rights: "r" }],
    });
    expect(
      (
        await api
          .post("/api/resources/assets")
          .set("Origin", testConfig.publicOrigin)
          .set("X-CSRF-Token", csrf)
          .send({ m_sLabel: "Blocked" })
      ).status,
    ).toBe(403);
  });
  it("does not enable changes for one-time-password sessions", async () => {
    const { api, csrf } = await setup({
      ...testIdentity,
      mustChangePassword: true,
    });
    expect(
      (
        await api
          .post("/api/resources/assets")
          .set("Origin", testConfig.publicOrigin)
          .set("X-CSRF-Token", csrf)
          .send({ m_sLabel: "Blocked" })
      ).status,
    ).toBe(403);
  });
});
