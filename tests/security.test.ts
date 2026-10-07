import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app";
import { MemorySessions } from "../server/sessions";
import { resourceMap, type Identity } from "../shared/resources";
import {
  fixtureRecord,
  fixtureTransport,
  testConfig,
  testIdentity,
} from "./fixtures";
import type { Transport } from "../server/upstream";

const ordinary: Identity = { ...testIdentity, userTypeId: "30", level: 30 };

async function setup(
  identity = ordinary,
  override?: (url: URL, init?: RequestInit) => Response | undefined,
) {
  const fixture = fixtureTransport(identity);
  const seed = (name: string, rows: [string, Record<string, unknown>][]) =>
    fixture.records.set(
      name,
      rows.map(([id, fields]) => fixtureRecord(resourceMap[name], id, fields)),
    );
  seed("usertypes", [
    ["10", { m_nLevel: "10" }],
    ["20", { m_nLevel: "20" }],
    ["30", { m_nLevel: "30" }],
    ["90", { m_nLevel: "90" }],
  ]);
  seed("users", [
    ["1", { m_nIDUserType: "10", m_bAdmin: false }],
    ["2", { m_nIDUserType: "30", m_bAdmin: false }],
    ["3", { m_nIDUserType: "90", m_bAdmin: false }],
    ["4", { m_nIDUserType: "10", m_bAdmin: true }],
    ["5", { m_nIDUserType: "999", m_bAdmin: false }],
    ["99", { m_nIDUserType: "10", m_bAdmin: false, m_nIDOrganization: "999" }],
  ]);
  seed("usergroups", [
    ["1", {}],
    ["99", { m_nIDOrganization: "999" }],
  ]);
  seed("assets", [
    ["1", {}],
    ["2", {}],
    ["99", { m_nIDOrganization: "999" }],
  ]);
  seed("hubs", [
    ["1", { m_nIDAsset: "1" }],
    ["2", { m_nIDAsset: "2" }],
    ["99", { m_nIDAsset: "99", m_nIDOrganization: "999" }],
  ]);
  seed("devices", [
    ["1", { IDAsset: "1", IDHub: "1" }],
    ["2", { IDAsset: "2", IDHub: "2" }],
    ["99", { IDAsset: "99", IDHub: "99", IDOrganization: "999" }],
  ]);
  seed("sensors", [
    ["1", { m_nIDAsset: "1", m_nIDDevice: "1" }],
    ["2", { m_nIDAsset: "2", m_nIDDevice: "2" }],
    ["99", { m_nIDAsset: "99", m_nIDDevice: "99" }],
  ]);
  seed("rules", [
    ["1", { m_nIDAsset: "1", m_nIDSensor: "1" }],
    ["2", { m_nIDAsset: "2", m_nIDSensor: "2" }],
    ["99", { m_nIDAsset: "99", m_nIDSensor: "99" }],
    ["100", { m_nIDAsset: "0", m_nIDSensor: "0", m_bIsTemplate: true }],
  ]);
  seed("actions", [
    ["1", { m_nIDAsset: "1", m_nIDRule: "1" }],
    ["2", { m_nIDAsset: "2", m_nIDRule: "2" }],
    ["99", { m_nIDAsset: "99", m_nIDRule: "99" }],
    ["100", { m_nIDAsset: "0", m_nIDRule: "0", m_bIsTemplate: true }],
  ]);
  const transport: Transport = async (input, init) => {
    const url = new URL(String(input));
    const replacement = override?.(url, init);
    if (replacement) return replacement;
    if (url.pathname === "/v1/assets/scope")
      return Response.json(
        ["1", "2"].map((id) => ({
          m_nIDAsset: id,
          m_nIDOrganization: identity.organizationId,
        })),
      );
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
  fixture.calls.length = 0;
  const mutate = (
    operation: "post" | "put" | "delete",
    path: string,
    body = {},
  ) =>
    api[operation](path)
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", login.body.csrf)
      .send(body);
  const writes = () =>
    fixture.calls.filter(
      (call) =>
        ["POST", "PUT", "DELETE"].includes(call.method) ||
        call.url.pathname.includes("/users2usergroups/"),
    );
  return { api, fixture, mutate, writes };
}

describe("privileged target protection", () => {
  it.each([
    undefined,
    null,
    "NaN",
    "Infinity",
    "30.5",
    "2147483648",
    "-2147483649",
  ])(
    "rejects malformed login roles without issuing a session: %s",
    async (level) => {
      const fixture = fixtureTransport();
      fixture.respondNext(
        Response.json({
          status: true,
          token: "synthetic-session-token",
          iduser: "1",
          idorganization: "7",
          idusertype: "30",
          usertypelevel: level,
          authorizations: ordinary.permissions,
        }),
      );
      const api = supertest.agent(
        createApp(testConfig, new MemorySessions(), fixture.transport),
      );
      const login = await api
        .post("/api/session/login")
        .set("Origin", testConfig.publicOrigin)
        .send({ login: "synthetic", password: "fixture-password" });
      expect(login.status).toBe(502);
      expect(login.headers["set-cookie"]).toBeUndefined();
      expect((await api.get("/api/services")).status).toBe(401);
      expect((await api.get("/api/history?idsensor=99")).status).toBe(401);
    },
  );
  it("fails closed for privileged routes even with a malformed stored identity level", async () => {
    const store = new MemorySessions();
    const id = "a".repeat(64);
    await store.set(id, {
      identity: { ...ordinary, level: Number.NaN },
      token: "synthetic-session-token",
      csrf: "b".repeat(64),
      expiresAt: Date.now() + 60_000,
    });
    const fixture = fixtureTransport(ordinary);
    const api = supertest(createApp(testConfig, store, fixture.transport));
    expect(
      (await api.get("/api/services").set("Cookie", `tronicare-admin=${id}`))
        .status,
    ).toBe(403);
    expect(
      (
        await api
          .get("/api/history?idasset=99")
          .set("Cookie", `tronicare-admin=${id}`)
      ).status,
    ).toBe(403);
  });
  it.each(["2", "3", "4", "5"])(
    "denies profile and deletion mutations of protected/unknown user %s",
    async (id) => {
      const { mutate, writes } = await setup();
      expect(
        (
          await mutate("put", `/api/resources/users/${id}`, {
            m_sLogin: "attacker@example.invalid",
          })
        ).status,
      ).toBe(403);
      expect(
        (await mutate("delete", `/api/resources/users/${id}`)).status,
      ).toBe(403);
      expect(writes()).toEqual([]);
    },
  );
  it.each(["add", "remove"])(
    "protects privileged targets from membership %s",
    async (action) => {
      const { mutate, writes } = await setup();
      expect(
        (
          await mutate("post", "/api/memberships", {
            userId: "3",
            groupId: "1",
            action,
          })
        ).status,
      ).toBe(403);
      expect(writes()).toEqual([]);
    },
  );
  it.each(["add", "remove"])(
    "rejects mismatched authoritative user/group IDs before membership %s",
    async (action) => {
      for (const name of ["users", "usergroups"]) {
        const { mutate, writes } = await setup(ordinary, (url) =>
          url.pathname === `/v1/${name}/1`
            ? Response.json(
                fixtureRecord(resourceMap[name], "2", {
                  m_nIDOrganization: "7",
                  m_nIDUserType: "10",
                  m_bAdmin: false,
                }),
              )
            : undefined,
        );
        expect(
          (
            await mutate("post", "/api/memberships", {
              userId: "1",
              groupId: "1",
              action,
            })
          ).status,
        ).toBe(403);
        expect(writes()).toEqual([]);
      }
    },
  );
  it("fails closed when the role service is unavailable or returns a malformed level", async () => {
    const { mutate, fixture, writes } = await setup(ordinary, (url) =>
      url.pathname === "/v1/usertypes/10"
        ? new Response(null, { status: 503 })
        : undefined,
    );
    expect(
      (await mutate("put", "/api/resources/users/1", { m_sLogin: "edited" }))
        .status,
    ).toBe(403);
    expect(writes()).toEqual([]);
    const malformed = await setup();
    malformed.fixture.records.set("usertypes", [
      fixtureRecord(resourceMap.usertypes, "10", { m_nLevel: "20.5" }),
    ]);
    expect(
      (await malformed.mutate("delete", "/api/resources/users/1")).status,
    ).toBe(403);
    expect(malformed.writes()).toEqual([]);
    expect(fixture.records.get("users")![0].m_sLogin).not.toBe("edited");
  });
  it("allows ordinary edits, lower-role assignment, creation and membership changes", async () => {
    const { mutate, fixture } = await setup();
    expect(
      (
        await mutate("put", "/api/resources/users/1", {
          m_sLogin: "edited",
          m_nIDUserType: "20",
        })
      ).status,
    ).toBe(200);
    const created = await mutate("post", "/api/resources/users", {
      m_sLogin: "new",
      m_nIDUserType: "10",
    });
    expect(created.status).toBe(200);
    expect(created.body.data.m_bAdmin).toBe(false);
    expect(created.body.data.m_nIDOrganization).toBe("7");
    expect(
      (
        await mutate("post", "/api/memberships", {
          userId: "1",
          groupId: "1",
          action: "add",
        })
      ).status,
    ).toBe(200);
    expect(fixture.records.get("users")![0].m_sLogin).toBe("edited");
  });
  it.each([
    { m_nIDUserType: "30" },
    { m_nIDUserType: "90" },
    { m_nIDUserType: "999" },
    { m_nIDUserType: "10", m_bAdmin: true },
    {},
  ])("denies unsafe/default creation roles %#", async (body) => {
    const { mutate, writes } = await setup();
    expect(
      (
        await mutate("post", "/api/resources/users", {
          m_sLogin: "blocked",
          ...body,
        })
      ).status,
    ).toBe(403);
    expect(writes()).toEqual([]);
  });
  it("allows platform administrators to maintain privileged accounts and memberships", async () => {
    const { mutate } = await setup(testIdentity);
    expect(
      (
        await mutate("put", "/api/resources/users/3", {
          m_sLogin: "platform-edited",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate("post", "/api/memberships", {
          userId: "3",
          groupId: "1",
          action: "add",
        })
      ).status,
    ).toBe(200);
  });
  it.each(["authz", "usertypes"])(
    "denies every non-platform mutation of %s",
    async (name) => {
      const { mutate, writes } = await setup();
      const id = name === "usertypes" ? "10" : "1";
      expect(
        (
          await mutate("post", `/api/resources/${name}`, {
            m_sLabel: "blocked",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await mutate("put", `/api/resources/${name}/${id}`, {
            m_sLabel: "blocked",
          })
        ).status,
      ).toBe(403);
      expect(
        (await mutate("delete", `/api/resources/${name}/${id}`)).status,
      ).toBe(403);
      expect(writes()).toEqual([]);
    },
  );
});

describe("automation relationship authorization", () => {
  it("rejects explicit null ownership and a mismatched resolved record ID", async () => {
    const nullOwnership = await setup();
    expect(
      (
        await nullOwnership.mutate("put", "/api/resources/rules/1", {
          m_nIDAsset: null,
        })
      ).status,
    ).toBe(403);
    expect(nullOwnership.writes()).toEqual([]);
    const mismatch = await setup(ordinary, (url) =>
      url.pathname === "/v1/sensors/1"
        ? Response.json(
            fixtureRecord(resourceMap.sensors, "99", { m_nIDAsset: "1" }),
          )
        : undefined,
    );
    expect(
      (
        await mismatch.mutate("post", "/api/resources/rules", {
          m_nIDAsset: "1",
          m_nIDSensor: "1",
        })
      ).status,
    ).toBe(403);
    expect(mismatch.writes()).toEqual([]);
  });
  it.each(["rulesforward", "actionsforward"])(
    "authorizes %s historical flags by persisted asset even after parents disappear",
    async (name) => {
      const { mutate, fixture, writes } = await setup();
      fixture.records.set(name, [
        fixtureRecord(resourceMap[name], "1", {
          m_nIDAsset: "1",
          m_nIDRule: "1",
          m_nIDSensor: "1",
          m_nIDAction: "1",
        }),
      ]);
      const row = fixture.records.get(name)![0];
      row.m_nIDAsset = "99";
      expect(
        (await mutate("put", `/api/resources/${name}/1`, { m_bIsRead: true }))
          .status,
      ).toBe(403);
      expect(writes()).toEqual([]);
      row.m_nIDAsset = "1";
      fixture.records.set("rules", []);
      fixture.records.set("sensors", []);
      fixture.records.set("actions", []);
      expect(
        (await mutate("put", `/api/resources/${name}/1`, { m_bIsRead: true }))
          .status,
      ).toBe(200);
      const attemptedLink =
        name === "rulesforward" ? { m_nIDSensor: "99" } : { m_nIDAction: "99" };
      expect(
        (await mutate("put", `/api/resources/${name}/1`, attemptedLink)).status,
      ).toBe(422);
      expect(writes()).toHaveLength(1);
    },
  );
  it.each(["rules", "actions"])(
    "rejects foreign, missing, unassigned and mismatched %s references",
    async (name) => {
      const reference = name === "rules" ? "m_nIDSensor" : "m_nIDRule";
      for (const id of ["99", "999", "0", "2"]) {
        const { mutate, writes } = await setup();
        expect(
          (
            await mutate("post", `/api/resources/${name}`, {
              m_nIDAsset: "1",
              [reference]: id,
            })
          ).status,
        ).toBe(403);
        expect(writes()).toEqual([]);
      }
    },
  );
  it.each(["rules", "actions"])(
    "checks inherited %s references and asset reassignment on partial PUT",
    async (name) => {
      const { mutate, fixture, writes } = await setup();
      expect(
        (await mutate("put", `/api/resources/${name}/1`, { m_nIDAsset: "2" }))
          .status,
      ).toBe(403);
      const reference = name === "rules" ? "m_nIDSensor" : "m_nIDRule";
      fixture.records.get(name)![0][reference] = "99";
      expect(
        (
          await mutate("put", `/api/resources/${name}/1`, {
            m_sLabel: "hidden invalid link",
          })
        ).status,
      ).toBe(403);
      expect(writes()).toEqual([]);
    },
  );
  it("checks a referenced rule's sensor rather than accepting its claimed visible asset", async () => {
    const { mutate, fixture, writes } = await setup();
    fixture.records.get("rules")![0].m_nIDSensor = "99";
    expect(
      (
        await mutate("post", "/api/resources/actions", {
          m_nIDAsset: "1",
          m_nIDRule: "1",
        })
      ).status,
    ).toBe(403);
    expect(writes()).toEqual([]);
  });
  it.each(["rules", "actions"])(
    "keeps %s templates readable and limits all template mutations to platform",
    async (name) => {
      const { api, mutate, writes } = await setup();
      expect((await api.get(`/api/resources/${name}/100`)).status).toBe(200);
      expect(
        (
          await mutate("post", `/api/resources/${name}`, {
            m_bIsTemplate: true,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await mutate("put", `/api/resources/${name}/100`, {
            m_bIsTemplate: false,
            m_sLabel: "blocked",
          })
        ).status,
      ).toBe(403);
      expect(
        (await mutate("delete", `/api/resources/${name}/100`)).status,
      ).toBe(403);
      expect(writes()).toEqual([]);
      const platform = await setup(testIdentity);
      expect(
        (
          await platform.mutate("put", `/api/resources/${name}/100`, {
            m_sLabel: "allowed",
          })
        ).status,
      ).toBe(200);
    },
  );
  it.each(["rules", "actions"])(
    "allows valid ordinary %s creation and consistent reassignment",
    async (name) => {
      const { mutate } = await setup();
      const reference = name === "rules" ? "m_nIDSensor" : "m_nIDRule";
      expect(
        (
          await mutate("post", `/api/resources/${name}`, {
            m_nIDAsset: "1",
            [reference]: "1",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await mutate("put", `/api/resources/${name}/1`, {
            m_sLabel: "allowed",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await mutate("put", `/api/resources/${name}/1`, {
            m_nIDAsset: "2",
            [reference]: "2",
          })
        ).status,
      ).toBe(200);
    },
  );
});

describe("password completion and logout", () => {
  it("cannot revive a logged-out session after an upstream password change finishes", async () => {
    const fixture = fixtureTransport({
      ...testIdentity,
      mustChangePassword: true,
    });
    let release!: () => void;
    let arrived!: () => void;
    const passwordArrived = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const passwordRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport: Transport = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/usersadmin/changepassword") {
        arrived();
        await passwordRelease;
      }
      if (url.pathname === "/v1/usersadmin/disconnect")
        return new Response(null, { status: 503 });
      return fixture.transport(input, init);
    };
    const app = createApp(testConfig, new MemorySessions(), transport);
    const api = supertest.agent(app);
    const login = await api
      .post("/api/session/login")
      .set("Origin", testConfig.publicOrigin)
      .send({ login: "synthetic", password: "fixture-password" });
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const changing = api
      .post("/api/session/password")
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", login.body.csrf)
      .send({ password: "a-new-password-with-length" })
      .then((response) => response);
    await passwordArrived;
    expect(
      (await api.get("/api/session")).body.identity.mustChangePassword,
    ).toBe(true);
    const logout = await api
      .post("/api/session/logout")
      .set("Origin", testConfig.publicOrigin)
      .set("X-CSRF-Token", login.body.csrf)
      .send({});
    expect(logout.status).toBe(200);
    release();
    const finished = await changing;
    expect(finished.status).toBe(401);
    expect(finished.headers["set-cookie"][0]).toContain("Max-Age=0");
    expect(
      (await supertest(app).get("/api/session").set("Cookie", cookie)).status,
    ).toBe(401);
  });
  it("updates an existing password-change session successfully", async () => {
    const { api, mutate } = await setup({
      ...testIdentity,
      mustChangePassword: true,
    });
    expect(
      (
        await mutate("post", "/api/session/password", {
          password: "a-new-password-with-length",
        })
      ).status,
    ).toBe(200);
    expect(
      (await api.get("/api/session")).body.identity.mustChangePassword,
    ).toBe(false);
  });
});

describe("tenant boundaries for equipment and history", () => {
  it.each(["assets", "hubs", "devices", "sensors"])(
    "filters foreign %s lists and denies direct reads/writes",
    async (name) => {
      const { api, mutate, writes } = await setup();
      const list = await api.get(`/api/resources/${name}`);
      expect(list.status).toBe(200);
      expect(list.body.data.map((row: { id: string }) => row.id)).toEqual([
        "1",
        "2",
      ]);
      expect((await api.get(`/api/resources/${name}/99`)).status).toBe(403);
      expect(
        (
          await mutate("put", `/api/resources/${name}/99`, {
            [name === "devices" ? "Label" : "m_sLabel"]: "blocked",
          })
        ).status,
      ).toBe(403);
      expect((await mutate("delete", `/api/resources/${name}/99`)).status).toBe(
        403,
      );
      expect(writes()).toEqual([]);
    },
  );
  it.each(["devices", "sensors"])(
    "authorizes %s parent links and partial ownership changes",
    async (name) => {
      const { mutate, writes } = await setup();
      const parent = name === "devices" ? "IDHub" : "IDDevice";
      const foreign = await mutate("put", `/api/resources/${name}/1`, {
        [parent]: "99",
      });
      expect(foreign.status).toBe(403);
      expect(
        (await mutate("put", `/api/resources/${name}/1`, { IDAsset: "2" }))
          .status,
      ).toBe(403);
      expect(writes()).toEqual([]);
      expect(
        (
          await mutate("put", `/api/resources/${name}/1`, {
            IDAsset: "2",
            [parent]: "2",
          })
        ).status,
      ).toBe(200);
    },
  );
  it("filters user logs by the authoritative user's organization", async () => {
    const { api, fixture } = await setup();
    fixture.records.set("userlog", [
      fixtureRecord(resourceMap.userlog, "1", { IDuser: "1" }),
      fixtureRecord(resourceMap.userlog, "2", { IDuser: "99" }),
      fixtureRecord(resourceMap.userlog, "3", { IDuser: "999" }),
    ]);
    const list = await api.get("/api/resources/userlog");
    expect(list.status).toBe(200);
    expect(list.body.data.map((row: { id: string }) => row.id)).toEqual(["1"]);
    expect((await api.get("/api/resources/userlog/2")).status).toBe(403);
  });
  it("denies foreign sensors/assets and mismatched history filters before reading history", async () => {
    const { api, fixture } = await setup();
    for (const query of ["idsensor=99", "idasset=99", "idsensor=1&idasset=2"])
      expect((await api.get(`/api/history?${query}`)).status).toBe(403);
    expect(
      fixture.calls.some((call) => call.url.pathname === "/v1/sensorshistory"),
    ).toBe(false);
  });
  it("filters an upstream history response to the authorized asset and requested sensor", async () => {
    const { api } = await setup(ordinary, (url) =>
      url.pathname === "/v1/sensorshistory"
        ? Response.json([
            { m_nIDSensor: "1", m_nIDAsset: "1", m_nValueInt: "10" },
            { m_nIDSensor: "99", m_nIDAsset: "99", m_nValueInt: "SECRET" },
            { m_nIDSensor: "2", m_nIDAsset: "2", m_nValueInt: "OTHER" },
          ])
        : undefined,
    );
    const history = await api.get("/api/history?idsensor=1");
    expect(history.status).toBe(200);
    expect(history.body.data).toEqual([
      { m_nIDSensor: "1", m_nIDAsset: "1", m_nValueInt: "10" },
    ]);
  });
});
