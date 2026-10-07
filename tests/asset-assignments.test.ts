import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app";
import { MemorySessions } from "../server/sessions";
import type { Config } from "../server/config";
import type { Transport } from "../server/upstream";
import { resourceMap, type Identity } from "../shared/resources";
import {
  fixtureRecord,
  fixtureTransport,
  testConfig,
  testIdentity,
  type CapturedCall,
} from "./fixtures";

const ordinaryIdentity: Identity = {
  ...testIdentity,
  level: 30,
  permissions: [{ entity: "assets", rights: "ru" }],
};
const commandCases = [
  ["post", "users"],
  ["delete", "users"],
  ["post", "usergroups"],
  ["delete", "usergroups"],
] as const;

async function setup(
  identity: Identity = ordinaryIdentity,
  config: Config = testConfig,
) {
  const fixture = fixtureTransport(identity);
  const calls: CapturedCall[] = [];
  const visibleAssets = new Set(["1"]);
  let mutationResponse: Response | undefined;
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
    if (/^\/v1\/assets\/\d+\/(users|usergroups)\/\d+$/.test(url.pathname)) {
      const response = mutationResponse ?? new Response(null, { status: 200 });
      if (
        response.ok &&
        method === "DELETE" &&
        url.pathname === `/v1/assets/1/users/${identity.id}`
      )
        visibleAssets.delete("1");
      return response;
    }
    return fixture.transport(input, init);
  };
  const api = supertest.agent(
    createApp(config, new MemorySessions(), transport),
  );
  const login = await api
    .post("/api/session/login")
    .set("Origin", config.publicOrigin)
    .send({ login: "fixture-admin", password: "fixture-password" });
  expect(login.status).toBe(200);
  const csrf = login.body.csrf as string;
  const commands = () =>
    calls.filter((call) => ["POST", "DELETE"].includes(call.method));
  return {
    api,
    fixture,
    calls,
    visibleAssets,
    csrf,
    commands,
    respondToMutation: (response: Response) => {
      mutationResponse = response;
    },
  };
}

describe("asset assignment commands", () => {
  it.each(commandCases)(
    "%s %s uses the Assets route with token and no body or query",
    async (method, kind) => {
      const { api, csrf, calls, commands } = await setup();
      const response = await api[method](`/api/assets/1/assignments/${kind}/1`)
        .set("Origin", testConfig.publicOrigin)
        .set("Content-Type", "application/json")
        .set("X-CSRF-Token", csrf);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(commands()).toHaveLength(1);
      const call = commands()[0];
      expect(call.method).toBe(method.toUpperCase());
      expect(call.url.origin).toBe(testConfig.origins.assets);
      expect(call.url.pathname).toBe(`/v1/assets/1/${kind}/1`);
      expect(call.url.search).toBe("");
      expect(call.body).toBeUndefined();
      expect(call.headers.get("Token")).toBe("synthetic-session-token");
      expect(call.headers.get("Content-Type")).toBeNull();
      expect(
        calls.some((call) => call.url.pathname === "/v1/assets/scope"),
      ).toBe(true);
      expect(calls.some((call) => call.url.pathname === `/v1/${kind}/1`)).toBe(
        true,
      );
    },
  );

  it.each(["users", "usergroups"] as const)(
    "preserves the largest signed 64-bit asset and %s IDs",
    async (kind) => {
      const { api, fixture, csrf, commands } = await setup(testIdentity);
      const exactId = "9223372036854775807";
      fixture.records.set("assets", [
        fixtureRecord(resourceMap.assets, exactId),
      ]);
      fixture.records.set(kind, [fixtureRecord(resourceMap[kind], exactId)]);
      const response = await api
        .post(`/api/assets/${exactId}/assignments/${kind}/${exactId}`)
        .set("Origin", testConfig.publicOrigin)
        .set("X-CSRF-Token", csrf);
      expect(response.status).toBe(200);
      expect(commands()[0].url.pathname).toBe(
        `/v1/assets/${exactId}/${kind}/${exactId}`,
      );
    },
  );

  it.each(commandCases)(
    "%s %s requires assets update permission",
    async (method, kind) => {
      const { api, csrf, commands } = await setup({
        ...ordinaryIdentity,
        permissions: [
          { entity: "assets", rights: "r" },
          { entity: "users", rights: "crud" },
          { entity: "usergroups", rights: "crud" },
        ],
      });
      const response = await api[method](`/api/assets/1/assignments/${kind}/1`)
        .set("Origin", testConfig.publicOrigin)
        .set("X-CSRF-Token", csrf);
      expect(response.status).toBe(403);
      expect(commands()).toHaveLength(0);
    },
  );

  it("allows assigning a privileged user without changing that account", async () => {
    const { api, fixture, csrf, commands, calls } = await setup();
    fixture.records.set("users", [
      fixtureRecord(resourceMap.users, "1", {
        m_bAdmin: true,
        m_nIDUserType: "90",
      }),
    ]);
    const response = await api
      .post("/api/assets/1/assignments/users/1")
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", csrf);
    expect(response.status).toBe(200);
    expect(commands()).toHaveLength(1);
    expect(
      calls.some((call) => call.url.pathname.startsWith("/v1/usertypes/")),
    ).toBe(false);
  });

  it("blocks one-time-password sessions and paused Assets writes", async () => {
    for (const paused of [false, true]) {
      const { api, csrf, commands } = await setup(
        { ...ordinaryIdentity, mustChangePassword: !paused },
        {
          ...testConfig,
          enabledWrites: new Set(
            [...testConfig.enabledWrites].filter(
              (service) => !paused || service !== "assets",
            ),
          ),
        },
      );
      const response = await api
        .post("/api/assets/1/assignments/users/1")
        .set("Origin", testConfig.publicOrigin)
        .set("X-CSRF-Token", csrf);
      expect(response.status).toBe(paused ? 503 : 403);
      expect(commands()).toHaveLength(0);
    }
  });

  it("requires a session, trusted origin and session-bound CSRF", async () => {
    const { api, csrf, commands } = await setup();
    const path = "/api/assets/1/assignments/users/1";
    const anonymous = await supertest(
      createApp(testConfig, new MemorySessions(), fixtureTransport().transport),
    )
      .post(path)
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", csrf);
    expect(anonymous.status).toBe(401);
    expect((await api.post(path).set("X-CSRF-Token", csrf)).status).toBe(403);
    expect(
      (await api.post(path).set("Origin", testConfig.publicOrigin)).status,
    ).toBe(403);
    expect(
      (
        await api
          .post(path)
          .set("Origin", testConfig.publicOrigin)
          .set("X-CSRF-Token", "invalid-csrf")
      ).status,
    ).toBe(403);
    expect(
      (
        await api
          .post(path)
          .set("Origin", "https://untrusted.invalid")
          .set("X-CSRF-Token", csrf)
      ).status,
    ).toBe(403);
    expect(commands()).toHaveLength(0);
  });

  it.each(["0", "-1", "+1", "1.0", "1e3", "9223372036854775808", "001", "abc"])(
    "rejects invalid asset and related IDs: %s",
    async (invalidId) => {
      const { api, csrf, calls, commands } = await setup();
      const encodedId = encodeURIComponent(invalidId);
      for (const path of [
        `/api/assets/${encodedId}/assignments/users/1`,
        `/api/assets/1/assignments/users/${encodedId}`,
      ]) {
        const response = await api
          .post(path)
          .set("Origin", testConfig.publicOrigin)
          .set("X-CSRF-Token", csrf);
        expect(response.status).toBe(400);
      }
      expect(calls).toHaveLength(1);
      expect(commands()).toHaveLength(0);
    },
  );

  it("rejects unsupported assignment kinds, query parameters and request bodies", async () => {
    const { api, csrf, commands } = await setup();
    for (const path of [
      "/api/assets/1/assignments/groups/1",
      "/api/assets/1/assignments/__proto__/1",
      "/api/assets/1/assignments/users/1?unexpected=",
    ]) {
      const response = await api
        .post(path)
        .set("Origin", testConfig.publicOrigin)
        .set("X-CSRF-Token", csrf);
      expect(response.status).toBe(400);
    }
    for (const body of [{}, { relatedId: "2" }]) {
      const response = await api
        .post("/api/assets/1/assignments/users/1")
        .set("Origin", testConfig.publicOrigin)
        .set("X-CSRF-Token", csrf)
        .send(body);
      expect(response.status).toBe(400);
    }
    const textBody = await api
      .delete("/api/assets/1/assignments/users/1")
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", csrf)
      .set("Content-Type", "text/plain")
      .send("unneeded body");
    expect(textBody.status).toBe(400);
    expect(commands()).toHaveLength(0);
  });

  it.each(["users", "usergroups"] as const)(
    "blocks an ordinary caller from assigning a %s record in another organization",
    async (kind) => {
      const { api, fixture, csrf, commands } = await setup();
      fixture.records.set(kind, [
        fixtureRecord(resourceMap[kind], "1", { m_nIDOrganization: "999" }),
      ]);
      const response = await api
        .post(`/api/assets/1/assignments/${kind}/1`)
        .set("Origin", testConfig.publicOrigin)
        .set("X-CSRF-Token", csrf);
      expect(response.status).toBe(403);
      expect(commands()).toHaveLength(0);
    },
  );

  it("blocks assets outside current grants or in another organization", async () => {
    for (const crossOrganization of [false, true]) {
      const { api, fixture, visibleAssets, csrf, commands } = await setup();
      if (crossOrganization)
        fixture.records.set("assets", [
          fixtureRecord(resourceMap.assets, "1", { m_nIDOrganization: "999" }),
        ]);
      else visibleAssets.clear();
      const response = await api
        .delete("/api/assets/1/assignments/users/1")
        .set("Origin", testConfig.publicOrigin)
        .set("X-CSRF-Token", csrf);
      expect(response.status).toBe(403);
      expect(commands()).toHaveLength(0);
    }
  });

  it("retains platform authority across organizations, with valid target records", async () => {
    const { api, fixture, visibleAssets, csrf, commands } =
      await setup(testIdentity);
    visibleAssets.clear();
    fixture.records.set("assets", [
      fixtureRecord(resourceMap.assets, "1", { m_nIDOrganization: "999" }),
    ]);
    const response = await api
      .post("/api/assets/1/assignments/users/1")
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", csrf);
    expect(response.status).toBe(200);
    expect(commands()).toHaveLength(1);
    fixture.records.set("users", []);
    const missingTarget = await api
      .post("/api/assets/1/assignments/users/2")
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", csrf);
    expect(missingTarget.status).toBe(403);
    expect(commands()).toHaveLength(1);
  });

  it.each([403, 409, 503])(
    "preserves upstream %s failures without exposing their response bodies",
    async (status) => {
      const { api, csrf, commands, respondToMutation } = await setup();
      respondToMutation(
        new Response("private dependency information", { status }),
      );
      const response = await api
        .post("/api/assets/1/assignments/usergroups/1")
        .set("Origin", testConfig.publicOrigin)
        .set("X-CSRF-Token", csrf);
      expect(response.status).toBe(status);
      expect(response.body.code).toBe(`upstream_${status}`);
      expect(JSON.stringify(response.body)).not.toContain("private dependency");
      expect(commands()).toHaveLength(1);
    },
  );

  it("rechecks scope after removing the caller's last asset grant", async () => {
    const { api, csrf, commands, calls } = await setup();
    const removed = await api
      .delete("/api/assets/1/assignments/users/1")
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", csrf);
    expect(removed.status).toBe(200);
    expect((await api.get("/api/resources/assets/1")).status).toBe(403);
    const reassigned = await api
      .post("/api/assets/1/assignments/users/1")
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", csrf);
    expect(reassigned.status).toBe(403);
    expect(commands()).toHaveLength(1);
    expect(
      calls.filter((call) => call.url.pathname === "/v1/assets/scope"),
    ).toHaveLength(3);
  });
});
