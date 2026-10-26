import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { LosslessNumber, stringify } from "lossless-json";
import { createApp } from "../server/app";
import { MemorySessions } from "../server/sessions";
import { parseWire } from "../server/wire";
import type { Transport } from "../server/upstream";
import type { Config } from "../server/config";
import { resourceMap, type Identity } from "../shared/resources";
import {
  fixtureRecord,
  fixtureTransport,
  testConfig,
  testIdentity,
  type CapturedCall,
} from "./fixtures";

const targetUser = "9223372036854775807";
const targetOrg = "9223372036854775806";
const targetRole = "9223372036854775805";
const itemPath = (user = targetUser, org = targetOrg) =>
  `/api/users/${user}/organizations/${org}`;
const listPath = (user = targetUser) => `/api/users/${user}/organizations`;
const ordinary: Identity = {
  ...testIdentity,
  level: 50,
  userTypeId: "50",
  permissions: [
    { entity: "users", rights: "ru" },
    { entity: "usertypes", rights: "r" },
  ],
};
const document = (
  org = "7",
  role = targetRole,
  active = true,
  user = targetUser,
) => ({
  iduser: user,
  idorganization: org,
  idusertype: role,
  active,
});
const response = (data: unknown) =>
  new Response(
    stringify(data, (key, value) =>
      ["iduser", "idorganization", "idusertype"].includes(key) &&
      typeof value === "string"
        ? new LosslessNumber(value)
        : value,
    ),
    { headers: { "Content-Type": "application/json" } },
  );
function barrier() {
  let release!: () => void;
  let arrive!: () => void;
  const started = new Promise<void>((resolve) => (arrive = resolve));
  const wait = new Promise<void>((resolve) => (release = resolve));
  return {
    started,
    release,
    block: async () => {
      arrive();
      await wait;
    },
  };
}

async function setup(
  identity: Identity = testIdentity,
  config: Config = testConfig,
) {
  const fixture = fixtureTransport(identity);
  fixture.records.set("usertypes", [
    fixtureRecord(resourceMap.usertypes, targetRole, { m_nLevel: "10" }),
  ]);
  fixture.records.set("users", [
    fixtureRecord(resourceMap.users, targetUser, { m_nIDOrganization: "99" }),
  ]);
  const store = new MemorySessions();
  const calls: CapturedCall[] = [];
  const state: {
    list: unknown;
    listStatus: number;
    roleStatus: number;
    beforeMutation?: () => Promise<void>;
    mutationStatus: number;
    putReply?: unknown;
  } = {
    list: [document()],
    listStatus: 200,
    roleStatus: 200,
    mutationStatus: 200,
  };
  const transport: Transport = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: new Headers(init?.headers),
      body: init?.body as string | undefined,
    });
    if (/^\/v1\/users\/\d+\/organizations$/.test(url.pathname))
      return state.listStatus === 200
        ? response(state.list)
        : new Response(null, { status: state.listStatus });
    const item = url.pathname.match(
      /^\/v1\/users\/(\d+)\/organizations\/(\d+)$/,
    );
    if (item) {
      await state.beforeMutation?.();
      if (state.mutationStatus !== 200)
        return new Response(null, { status: state.mutationStatus });
      if (method === "DELETE") return new Response(null, { status: 200 });
      const body = parseWire(String(init?.body)) as { idusertype: string };
      return response(
        state.putReply ?? {
          ...document(item[2], body.idusertype, true, item[1]),
          privateSentinel: "must-not-return",
        },
      );
    }
    if (/^\/v1\/usertypes\/\d+$/.test(url.pathname) && state.roleStatus !== 200)
      return new Response(null, { status: state.roleStatus });
    return fixture.transport(input, init);
  };
  const app = createApp(config, store, transport);
  const login = await supertest(app)
    .post("/api/session/login")
    .set("Origin", config.publicOrigin)
    .send({ login: "synthetic", password: "synthetic password" });
  expect(login.status).toBe(200);
  const cookie = login.headers["set-cookie"][0].split(";")[0] as string;
  const sessionId = cookie.split("=")[1];
  const csrf = login.body.csrf as string;
  const request = (
    method: "get" | "put" | "delete" | "post",
    path: string,
    requestCsrf = csrf,
    requestCookie = cookie,
  ) => {
    const req = supertest(app)
      [method](path)
      .set("Cookie", requestCookie)
      .set("X-CSRF-Token", requestCsrf);
    if (method !== "get") req.set("Origin", config.publicOrigin);
    return req;
  };
  const selected = async (activeOrganizationId: string | null) => {
    const original = (await store.get(sessionId))!;
    expect(
      await store.compareAndSet(sessionId, original, {
        ...original,
        activeOrganizationId,
      }),
    ).toBe(true);
  };
  return {
    app,
    fixture,
    state,
    store,
    calls,
    request,
    csrf,
    cookie,
    sessionId,
    selected,
    mutations: () =>
      calls.filter((call) => ["PUT", "DELETE"].includes(call.method)),
  };
}

describe("user organization membership reads", () => {
  it("returns active and inactive memberships with exact IDs and no extra upstream fields", async () => {
    const h = await setup();
    h.state.list = [
      { ...document(targetOrg), privateSentinel: "must-not-return" },
      document("7", "30", false),
    ];
    const result = await h.request("get", listPath());
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      data: [
        { organizationId: "7", userTypeId: "30", active: false },
        { organizationId: targetOrg, userTypeId: targetRole, active: true },
      ],
    });
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(result.body)).not.toMatch(
      /token|must-not-return|synthetic-session/,
    );
    const call = h.calls.find((call) =>
      call.url.pathname.endsWith("/organizations"),
    )!;
    expect(call.url.pathname).toBe(`/v1/users/${targetUser}/organizations`);
    expect(call.url.search).toBe("");
    expect(call.headers.get("Token")).toBe("synthetic-session-token");
  });

  it("requires Users read permission", async () => {
    const h = await setup({
      ...ordinary,
      permissions: [{ entity: "users", rights: "u" }],
    });
    expect((await h.request("get", listPath())).status).toBe(403);
    expect(
      h.calls.some((call) => call.url.pathname.endsWith("/organizations")),
    ).toBe(false);
  });

  it("allows an ordinary user to read all their own organization memberships", async () => {
    const h = await setup(ordinary);
    h.state.list = [
      document("7", "50", true, ordinary.id),
      document(targetOrg, "20", false, ordinary.id),
    ];
    expect(
      (await h.request("get", listPath(ordinary.id))).body.data,
    ).toHaveLength(2);
  });

  it("does not apply the target user's home organization as a membership filter", async () => {
    const h = await setup(ordinary);
    const result = await h.request("get", listPath());
    expect(result.status).toBe(200);
    expect(result.body.data).toHaveLength(1);
    expect(
      h.calls.some((call) => call.url.pathname === `/v1/users/${targetUser}`),
    ).toBe(false);
  });

  it.each([
    ["wrong user", [document("7", targetRole, true, "2")]],
    ["duplicate organization", [document(), document()]],
    ["invalid role ID", [document("7", "07")]],
    ["invalid active flag", [{ ...document(), active: "false" }]],
    ["invalid list", { organizations: [document()] }],
    [
      "too many",
      Array.from({ length: 257 }, (_, i) => document(String(i + 1))),
    ],
  ] as const)("fails closed on %s", async (_label, data) => {
    const h = await setup();
    h.state.list = data;
    const result = await h.request("get", listPath());
    expect(result.status).toBe(502);
    expect(result.body.data).toBeUndefined();
  });

  it("fails closed on unexpected cross-organization rows for another ordinary user's target", async () => {
    const h = await setup(ordinary);
    h.state.list = [document(targetOrg)];
    expect((await h.request("get", listPath())).status).toBe(502);
  });

  it.each([403, 404, 503])(
    "preserves authoritative read denial %i",
    async (status) => {
      const h = await setup();
      h.state.listStatus = status;
      const result = await h.request("get", listPath());
      expect(result.status).toBe(status);
      expect(result.body.data).toBeUndefined();
    },
  );
});

describe("user organization membership changes", () => {
  it("PUT uses lossless role integers, active true, caller token, and sanitized response", async () => {
    const h = await setup();
    const result = await h
      .request("put", itemPath())
      .send({ userTypeId: targetRole });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      data: { organizationId: targetOrg, userTypeId: targetRole, active: true },
    });
    const [call] = h.mutations();
    expect(call.url.pathname).toBe(
      `/v1/users/${targetUser}/organizations/${targetOrg}`,
    );
    expect(call.url.origin).toBe(testConfig.origins.users);
    expect(call.url.search).toBe("");
    expect(call.headers.get("Token")).toBe("synthetic-session-token");
    expect(call.body).toBe(`{"idusertype":${targetRole},"active":true}`);
    expect(JSON.stringify(result.body)).not.toMatch(
      /token|must-not-return|synthetic-session/,
    );
  });

  it("DELETE forwards no body or query with the caller token", async () => {
    const h = await setup();
    const result = await h.request("delete", itemPath());
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true });
    const [call] = h.mutations();
    expect(call.method).toBe("DELETE");
    expect(call.body).toBeUndefined();
    expect(call.url.search).toBe("");
    expect(call.headers.get("Token")).toBe("synthetic-session-token");
  });

  it("allows an ordinary administrator to add a permitted role into their current organization despite a foreign home organization", async () => {
    const h = await setup(ordinary);
    const result = await h
      .request("put", itemPath(targetUser, "7"))
      .send({ userTypeId: targetRole });
    expect(result.status).toBe(200);
    expect(h.mutations()).toHaveLength(1);
    expect(
      h.calls.some((call) => call.url.pathname === `/v1/users/${targetUser}`),
    ).toBe(false);
  });

  it.each(["put", "delete"] as const)(
    "requires Users edit permission for %s",
    async (method) => {
      const h = await setup({
        ...ordinary,
        permissions: [{ entity: "users", rights: "r" }],
      });
      const result = await h
        .request(method, itemPath(targetUser, "7"))
        .send(method === "put" ? { userTypeId: targetRole } : undefined);
      expect(result.status).toBe(403);
      expect(h.mutations()).toHaveLength(0);
    },
  );

  it.each(["put", "delete"] as const)(
    "blocks %s during password reset and paused Users writes",
    async (method) => {
      for (const paused of [false, true]) {
        const h = await setup(
          { ...ordinary, mustChangePassword: !paused },
          {
            ...testConfig,
            enabledWrites: new Set(
              [...testConfig.enabledWrites].filter(
                (service) => !paused || service !== "users",
              ),
            ),
          },
        );
        const result = await h
          .request(method, itemPath(targetUser, "7"))
          .send(method === "put" ? { userTypeId: targetRole } : undefined);
        expect(result.status).toBe(paused ? 503 : 403);
        expect(h.mutations()).toHaveLength(0);
      }
    },
  );

  it.each(["put", "delete"] as const)(
    "rejects another organization's destination for ordinary %s",
    async (method) => {
      const h = await setup(ordinary);
      expect(
        (
          await h
            .request(method, itemPath())
            .send(method === "put" ? { userTypeId: targetRole } : undefined)
        ).status,
      ).toBe(403);
      expect(h.mutations()).toHaveLength(0);
    },
  );

  it.each([50, 89, 90, 100])(
    "ordinary administrator cannot assign role level %i",
    async (level) => {
      const h = await setup(ordinary);
      h.fixture.records.set("usertypes", [
        fixtureRecord(resourceMap.usertypes, targetRole, {
          m_nLevel: String(level),
        }),
      ]);
      expect(
        (
          await h
            .request("put", itemPath(targetUser, "7"))
            .send({ userTypeId: targetRole })
        ).status,
      ).toBe(403);
      expect(h.mutations()).toHaveLength(0);
    },
  );

  it.each([90, 100])(
    "platform administrator cannot assign organization role level %i",
    async (level) => {
      const h = await setup();
      h.fixture.records.set("usertypes", [
        fixtureRecord(resourceMap.usertypes, targetRole, {
          m_nLevel: String(level),
        }),
      ]);
      expect(
        (await h.request("put", itemPath()).send({ userTypeId: targetRole }))
          .status,
      ).toBe(403);
      expect(h.mutations()).toHaveLength(0);
    },
  );

  it("rejects a role with malformed level and respects normal role-read denial", async () => {
    const h = await setup();
    h.fixture.records.set("usertypes", [
      fixtureRecord(resourceMap.usertypes, targetRole, {
        m_nLevel: "not-an-integer",
      }),
    ]);
    expect(
      (await h.request("put", itemPath()).send({ userTypeId: targetRole }))
        .status,
    ).toBe(502);
    h.state.roleStatus = 403;
    expect(
      (await h.request("put", itemPath()).send({ userTypeId: targetRole }))
        .status,
    ).toBe(403);
    expect(h.mutations()).toHaveLength(0);
  });

  it.each([
    {},
    { userTypeId: 7 },
    { userTypeId: "0" },
    { userTypeId: "07" },
    { userTypeId: "9223372036854775808" },
    { userTypeId: targetRole, active: false },
  ])("rejects malformed PUT body %j", async (body) => {
    const h = await setup();
    expect((await h.request("put", itemPath()).send(body)).status).toBe(400);
    expect(h.mutations()).toHaveLength(0);
  });

  it("rejects invalid IDs, query parameters, DELETE bodies, and GET bodies", async () => {
    const h = await setup();
    expect((await h.request("get", listPath("07"))).status).toBe(400);
    expect(
      (
        await h
          .request("put", itemPath(targetUser, "0"))
          .send({ userTypeId: targetRole })
      ).status,
    ).toBe(400);
    expect(
      (
        await h
          .request("put", `${itemPath()}?role=90`)
          .send({ userTypeId: targetRole })
      ).status,
    ).toBe(400);
    expect(
      (await h.request("get", `${listPath()}?organization=7`)).status,
    ).toBe(400);
    expect((await h.request("delete", itemPath()).send({})).status).toBe(400);
    expect(
      (
        await h
          .request("delete", itemPath())
          .set("Content-Type", "text/plain")
          .send("unexpected")
      ).status,
    ).toBe(400);
    expect((await h.request("get", listPath()).send({})).status).toBe(400);
    expect(h.mutations()).toHaveLength(0);
  });

  it("requires current CSRF and trusted origin before a membership change", async () => {
    const h = await setup();
    expect(
      (
        await h
          .request("put", itemPath(), "stale")
          .send({ userTypeId: targetRole })
      ).status,
    ).toBe(403);
    expect(
      (
        await supertest(h.app)
          .delete(itemPath())
          .set("Cookie", h.cookie)
          .set("X-CSRF-Token", h.csrf)
      ).status,
    ).toBe(403);
    expect(h.mutations()).toHaveLength(0);
  });

  it.each([403, 404, 409, 503])(
    "preserves backend target/current-role protection %i without changing the caller's session",
    async (status) => {
      const h = await setup();
      h.state.mutationStatus = status;
      const before = await h.store.get(h.sessionId);
      const result = await h
        .request("put", itemPath())
        .send({ userTypeId: targetRole });
      expect(result.status).toBe(status);
      expect(await h.store.get(h.sessionId)).toEqual(before);
    },
  );

  it.each([
    document(targetOrg, targetRole, true, "2"),
    document("7"),
    document(targetOrg, "30"),
    document(targetOrg, targetRole, false),
  ])("rejects mismatched or inactive PUT reply %j", async (reply) => {
    const h = await setup();
    h.state.putReply = reply;
    const result = await h
      .request("put", itemPath())
      .send({ userTypeId: targetRole });
    expect(result.status).toBe(502);
    expect(result.body.data).toBeUndefined();
  });
});

describe("self-membership session retirement", () => {
  it.each(["put", "delete"] as const)(
    "ends a selected self session after successful %s without clearing cookies",
    async (method) => {
      const h = await setup();
      await h.selected("7");
      const result = await h
        .request(method, itemPath(testIdentity.id, "7"))
        .send(method === "put" ? { userTypeId: targetRole } : undefined);
      expect(result.status).toBe(200);
      expect(result.body.sessionEnded).toBe(true);
      expect(result.headers["set-cookie"]).toBeUndefined();
      expect(await h.store.get(h.sessionId)).toBeNull();
      expect((await h.request("get", "/api/session")).status).toBe(401);
    },
  );

  it("keeps a platform global session when editing its own default-org membership", async () => {
    const h = await setup();
    await h.selected(null);
    const before = await h.store.get(h.sessionId);
    const result = await h
      .request("put", itemPath(testIdentity.id, "7"))
      .send({ userTypeId: targetRole });
    expect(result.status).toBe(200);
    expect(result.body.sessionEnded).toBeUndefined();
    expect(await h.store.get(h.sessionId)).toEqual(before);
  });

  it("keeps a selected session when changing its own different organization", async () => {
    const h = await setup();
    await h.selected("7");
    const result = await h.request("delete", itemPath(testIdentity.id));
    expect(result.status).toBe(200);
    expect(result.body.sessionEnded).toBeUndefined();
    expect(await h.store.get(h.sessionId)).not.toBeNull();
  });

  it.each([400, 403, 404, 422])(
    "retains the selected self session after a definite rejection %i",
    async (status) => {
      const h = await setup();
      await h.selected("7");
      h.state.mutationStatus = status;
      const before = await h.store.get(h.sessionId);
      const result = await h.request("delete", itemPath(testIdentity.id, "7"));
      expect(result.status).toBe(status);
      expect(await h.store.get(h.sessionId)).toEqual(before);
    },
  );

  it.each(["network", "503", "malformed"] as const)(
    "retires possibly revoked credentials after uncertain self outcome %s",
    async (failure) => {
      const h = await setup();
      await h.selected("7");
      if (failure === "network")
        h.state.beforeMutation = async () => {
          throw new Error("synthetic transport failure");
        };
      if (failure === "503") h.state.mutationStatus = 503;
      if (failure === "malformed")
        h.state.putReply = document("8", targetRole, true, testIdentity.id);
      const result = await h
        .request("put", itemPath(testIdentity.id, "7"))
        .send({ userTypeId: targetRole });
      expect(result.status).toBe(401);
      expect(result.body.code).toBe("organization_membership_session_ended");
      expect(result.headers["set-cookie"]).toBeUndefined();
      expect(await h.store.get(h.sessionId)).toBeNull();
      expect(h.mutations()).toHaveLength(1);
    },
  );

  it.each([200, 503])(
    "does not delete a newer rotated session after a late self operation status %i",
    async (status) => {
      const h = await setup();
      await h.selected("7");
      const gate = barrier();
      h.state.beforeMutation = gate.block;
      h.state.mutationStatus = status;
      const updating = h
        .request("delete", itemPath(testIdentity.id, "7"))
        .then((result) => result);
      await gate.started;
      const old = (await h.store.get(h.sessionId))!;
      const winner = {
        ...old,
        token: "synthetic-winning-token",
        csrf: "winning-csrf",
        activeOrganizationId: targetOrg,
      };
      expect(await h.store.compareAndSet(h.sessionId, old, winner)).toBe(true);
      gate.release();
      const result = await updating;
      expect(result.status).toBe(status === 200 ? 200 : 409);
      expect(result.headers["set-cookie"]).toBeUndefined();
      expect(await h.store.get(h.sessionId)).toEqual(winner);
    },
  );

  it("does not clear a newer login's cookie or resurrect the old self session", async () => {
    const h = await setup();
    await h.selected("7");
    const gate = barrier();
    h.state.beforeMutation = gate.block;
    const deleting = h
      .request("delete", itemPath(testIdentity.id, "7"))
      .then((result) => result);
    await gate.started;
    const login = await h
      .request("post", "/api/session/login")
      .send({ login: "synthetic", password: "synthetic password" });
    const winnerId = login.headers["set-cookie"][0].split(";")[0].split("=")[1];
    gate.release();
    const result = await deleting;
    expect(result.status).toBe(200);
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(await h.store.get(h.sessionId)).toBeNull();
    expect((await h.store.get(winnerId))?.csrf).toBe(login.body.csrf);
  });
});
