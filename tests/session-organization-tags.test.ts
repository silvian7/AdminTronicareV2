import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app";
import { MemorySessions } from "../server/sessions";
import {
  fixtureTransport,
  testConfig,
  testIdentity,
  type CapturedCall,
} from "./fixtures";
import type { Config } from "../server/config";

const path = "/api/session/organization-tags";
const target = "/v1/organizationsadmin/membership-tags";
const exactId = "9223372036854775807";
const translatedTag =
  '{"messages":[{"lang":"en","text":"Synthetic care home"}]}';

async function setup(
  reply: () => Response = () => Response.json({ organizations: [] }),
  config: Config = testConfig,
) {
  const identity = {
    ...testIdentity,
    level: 30,
    userTypeId: "27",
    permissions: [{ entity: "assets", rights: "r" }],
  };
  const fixture = fixtureTransport(identity);
  const calls: CapturedCall[] = [];
  const app = createApp(
    { ...config, caregiverUserTypeIds: new Set(["27"]) },
    new MemorySessions(),
    async (input, init) => {
      const url = new URL(String(input));
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: init?.body as string | undefined,
      });
      if (url.pathname === target) return reply();
      return fixture.transport(input, init);
    },
  );
  const api = supertest.agent(app);
  const login = await api
    .post("/api/session/login")
    .set("Origin", config.publicOrigin)
    .send({ login: "synthetic", password: "SYNTHETIC-TEST-PASSWORD" });
  expect(login.status).toBe(200);
  calls.length = 0;
  return { api, app, calls, login };
}

describe("self organization tag metadata", () => {
  it("allows a caregiver without organization rights, preserves exact IDs/raw translated tags and projects metadata only", async () => {
    const s = await setup(
      () =>
        new Response(
          `{"organizations":[{"idorganization":${exactId},"tag":${JSON.stringify(translatedTag)},"m_sEmail":"synthetic-private@example.invalid"}],"token":"must-not-be-exposed"}`,
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    expect(s.login.body.identity.caregiverReadOnly).toBe(true);
    expect(s.login.body.identity.permissions).toEqual([
      { entity: "assets", rights: "r" },
    ]);
    const response = await s.api
      .get(path)
      .set("X-CSRF-Token", s.login.body.csrf);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      organizations: [{ organizationId: exactId, tag: translatedTag }],
    });
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.text).not.toContain("synthetic-private");
    expect(response.text).not.toContain("must-not-be-exposed");
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].url.origin).toBe(testConfig.origins.organizations);
    expect(s.calls[0].url.pathname).toBe(target);
    expect(s.calls[0].url.search).toBe("");
    expect(s.calls[0].method).toBe("GET");
    expect(s.calls[0].headers.get("Token")).toBe("synthetic-session-token");
    expect(s.calls[0].body).toBeUndefined();
  });

  it("does not require cached BFF membership metadata and accepts empty or boundary-sized tag sets", async () => {
    const organizations = Array.from({ length: 256 }, (_, index) => ({
      idorganization: String(index + 1),
      tag: index === 0 ? "" : "x".repeat(65_536),
    }));
    // Avoid exceeding the independent 24MiB upstream body cap at this boundary.
    organizations.forEach((entry, index) => {
      if (index > 1) entry.tag = "Synthetic";
    });
    const s = await setup(() => Response.json({ organizations }));
    expect(s.login.body.organizationMemberships).toBeUndefined();
    const response = await s.api.get(path);
    expect(response.status).toBe(200);
    expect(response.body.organizations).toHaveLength(256);
    expect(response.body.organizations[0]).toEqual({
      organizationId: "1",
      tag: "",
    });
    expect(response.body.organizations[1].tag).toHaveLength(65_536);
    const empty = await setup();
    expect((await empty.api.get(path)).body).toEqual({ organizations: [] });
  });

  it.each(
    [
      null,
      [],
      {},
      { organizations: null },
      { organizations: {} },
      { organizations: [null] },
      { organizations: [[]] },
      { organizations: [{ idorganization: "0", tag: "Synthetic" }] },
      { organizations: [{ idorganization: "01", tag: "Synthetic" }] },
      {
        organizations: [
          { idorganization: "9223372036854775808", tag: "Synthetic" },
        ],
      },
      { organizations: [{ idorganization: true, tag: "Synthetic" }] },
      { organizations: [{ idorganization: {}, tag: "Synthetic" }] },
      { organizations: [{ idorganization: "1", tag: null }] },
      { organizations: [{ idorganization: "1", tag: 27 }] },
      { organizations: [{ idorganization: "1", tag: "bad\0tag" }] },
      { organizations: [{ idorganization: "1", tag: "x".repeat(65_537) }] },
      {
        organizations: [
          { idorganization: "1", tag: "One" },
          { idorganization: 1, tag: "Duplicate" },
        ],
      },
      {
        organizations: Array.from({ length: 257 }, (_, index) => ({
          idorganization: String(index + 1),
          tag: "Synthetic",
        })),
      },
    ].map((body, index) => ({ body, index })),
  )(
    "rejects malformed success metadata case $index without exposing rows",
    async ({ body }) => {
      const s = await setup(() => Response.json(body));
      const response = await s.api.get(path);
      expect(response.status).toBe(502);
      expect(response.body.organizations).toBeUndefined();
      expect(response.text).not.toContain("Synthetic");
      expect(s.calls.map((call) => call.url.pathname)).toEqual([target]);
    },
  );

  it.each([401, 403, 404, 503])(
    "preserves upstream status %s without a generic organization fallback",
    async (status) => {
      const s = await setup(
        () => new Response("synthetic-private-upstream-body", { status }),
      );
      const response = await s.api.get(path);
      expect(response.status).toBe(status);
      expect(response.text).not.toContain("synthetic-private");
      expect(s.calls.map((call) => call.url.pathname)).toEqual([target]);
    },
  );

  it("keeps an unconfigured service unavailable without making any upstream request", async () => {
    const s = await setup(undefined, {
      ...testConfig,
      origins: { ...testConfig.origins, organizations: undefined },
    });
    const response = await s.api.get(path);
    expect(response.status).toBe(503);
    expect(s.calls).toEqual([]);
  });

  it("requires an authenticated session", async () => {
    const s = await setup();
    const response = await supertest(s.app).get(path);
    expect(response.status).toBe(401);
    expect(s.calls).toEqual([]);
  });

  it.each(["?organizationId=7", "?userId=1", "?anything=1"])(
    "rejects query parameters %s before contacting the service",
    async (query) => {
      const s = await setup();
      expect((await s.api.get(path + query)).status).toBe(400);
      expect(s.calls).toEqual([]);
    },
  );

  it.each([{ body: {} }, { body: { organizationId: "7" } }, { body: " " }])(
    "rejects a GET body before contacting the service",
    async ({ body }) => {
      const s = await setup();
      expect((await s.api.get(path).send(body)).status).toBe(400);
      expect(s.calls).toEqual([]);
    },
  );
});
