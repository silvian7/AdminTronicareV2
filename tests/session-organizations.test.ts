import { afterEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { stringify, LosslessNumber } from "lossless-json";
import { createApp } from "../server/app";
import { MemorySessions } from "../server/sessions";
import type { Transport } from "../server/upstream";
import {
  fixtureTransport,
  testConfig,
  testIdentity,
  type CapturedCall,
} from "./fixtures";

const target = "9223372036854775807";
const userId = "9223372036854775806";
const memberships = () => [
  { iduser: userId, idorganization: "7", idusertype: "30", active: true },
  { iduser: userId, idorganization: target, idusertype: "40", active: true },
];
const wire = (data: unknown) =>
  new Response(
    stringify(data, (_key, value) =>
      typeof value === "string" &&
      /^(?:iduser|idorganization|idusertype|usertypelevel)$/.test(_key)
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

function setup(level = 30) {
  const store = new MemorySessions();
  const base = fixtureTransport({
    ...testIdentity,
    id: userId,
    level,
    userTypeId: String(level),
  });
  const connect = {
    status: true,
    token: "synthetic-old-token",
    iduser: userId,
    idorganization: "7",
    idusertype: String(level),
    usertypelevel: String(level),
    firstname: "Synthetic",
    lastname: "Member",
    onetimepwd: false,
    authorizations: testIdentity.permissions,
    organizations: memberships() as unknown,
  };
  const state: {
    connect: Record<string, unknown>;
    members: unknown;
    membersStatus: number;
    switchStatus: number;
    switched?: unknown;
    beforeMembers?: () => Promise<void>;
    beforeSwitch?: () => Promise<void>;
    beforePassword?: () => Promise<void>;
    beforeDisconnect?: () => Promise<void>;
    beforeBusiness?: () => Promise<void>;
    businessStatus: number;
  } = {
    connect,
    members: { organizations: memberships() },
    membersStatus: 200,
    switchStatus: 200,
    businessStatus: 200,
  };
  const calls: CapturedCall[] = [];
  const transport: Transport = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body as string | undefined,
    });
    if (url.pathname === "/v1/usersadmin/connect") return wire(state.connect);
    if (url.pathname === "/v1/usersadmin/organizations") {
      await state.beforeMembers?.();
      return state.membersStatus === 200
        ? wire(state.members)
        : new Response(null, { status: state.membersStatus });
    }
    if (url.pathname === "/v1/usersadmin/switchorganization") {
      await state.beforeSwitch?.();
      if (state.switchStatus !== 200)
        return new Response(null, { status: state.switchStatus });
      return wire(
        state.switched ?? {
          ...connect,
          token: "synthetic-rotated-token",
          idorganization: target,
          idusertype: level >= 90 ? String(level) : "40",
          usertypelevel: level >= 90 ? String(level) : "40",
        },
      );
    }
    if (url.pathname === "/v1/usersadmin/changepassword") {
      await state.beforePassword?.();
      return wire({ status: true });
    }
    if (url.pathname === "/v1/usersadmin/disconnect") {
      await state.beforeDisconnect?.();
      return wire({ status: true });
    }
    if (url.pathname === "/v1/sensortypes") {
      await state.beforeBusiness?.();
      if (state.businessStatus !== 200)
        return new Response(null, { status: state.businessStatus });
    }
    return base.transport(input, init);
  };
  const app = createApp(testConfig, store, transport);
  const login = () =>
    supertest(app)
      .post("/api/session/login")
      .set("Origin", testConfig.publicOrigin)
      .send({ login: "synthetic", password: "synthetic password" });
  const request = (
    method: "get" | "post",
    path: string,
    cookie: string,
    csrf?: string,
  ) => {
    const req = supertest(app)[method](path).set("Cookie", cookie);
    if (method === "post") req.set("Origin", testConfig.publicOrigin);
    if (csrf !== undefined) req.set("X-CSRF-Token", csrf);
    return req;
  };
  const signedIn = async () => {
    const response = await login();
    expect(response.status).toBe(200);
    const cookie = response.headers["set-cookie"][0].split(";")[0] as string;
    return {
      cookie,
      csrf: response.body.csrf as string,
      sessionId: cookie.split("=")[1],
      response,
    };
  };
  return { state, calls, store, login, request, signedIn };
}

afterEach(() => vi.useRealTimers());

describe("organization session contracts", () => {
  it("publishes exact IDs and active memberships without credentials", async () => {
    const h = setup();
    const s = await h.signedIn();
    expect(s.response.body).toMatchObject({
      activeOrganizationId: "7",
      organizationMemberships: [
        { organizationId: "7", userTypeId: "30", active: true },
        { organizationId: target, userTypeId: "40", active: true },
      ],
    });
    const list = await h.request(
      "get",
      "/api/session/organizations",
      s.cookie,
      s.csrf,
    );
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual(s.response.body.organizationMemberships);
    expect(JSON.stringify([s.response.body, list.body])).not.toMatch(
      /synthetic-old-token|"token"|"switching"/,
    );
    expect(
      h.calls
        .find((c) => c.url.pathname.endsWith("/organizations"))!
        .headers.get("Token"),
    ).toBe("synthetic-old-token");
  });

  it.each([30, 89, 90, 100])(
    "switches role level %i with a lossless integer body and preserved absolute expiry",
    async (level) => {
      const h = setup(level);
      if (level < 90)
        (
          h.state.connect.organizations as ReturnType<typeof memberships>
        )[0].idusertype = String(level);
      h.state.members = { organizations: h.state.connect.organizations };
      const s = await h.signedIn();
      expect(s.response.body.activeOrganizationId).toBe(
        level >= 90 ? null : "7",
      );
      const switched = await h
        .request("post", "/api/session/organization", s.cookie, s.csrf)
        .send({ organizationId: target });
      expect(switched.status).toBe(200);
      expect(switched.headers["set-cookie"]).toBeUndefined();
      expect(switched.body).toMatchObject({
        activeOrganizationId: target,
        expiresAt: s.response.body.expiresAt,
        identity: {
          id: userId,
          organizationId: target,
          userTypeId: level >= 90 ? String(level) : "40",
          level: level >= 90 ? level : 40,
        },
      });
      expect(switched.body.csrf).not.toBe(s.csrf);
      expect(JSON.stringify(switched.body)).not.toMatch(
        /synthetic-rotated-token|"token"|"switching"/,
      );
      const call = h.calls.find((c) =>
        c.url.pathname.endsWith("/switchorganization"),
      )!;
      expect(call.method).toBe("POST");
      expect(call.body).toBe(`{"idorganization":${target}}`);
      expect(call.url.search).toBe("");
      expect(call.headers.get("Token")).toBe("synthetic-old-token");
      expect((await h.store.get(s.sessionId))?.token).toBe(
        "synthetic-rotated-token",
      );
      const discovery = await h.request(
        "get",
        "/api/session",
        s.cookie,
        s.csrf,
      );
      expect(discovery.body.csrf).toBe(switched.body.csrf);
      expect(
        (await h.request("get", "/api/session/organizations", s.cookie, s.csrf))
          .status,
      ).toBe(409);
      expect(
        (
          await h
            .request("post", "/api/session/password", s.cookie, s.csrf)
            .send({ password: "another synthetic password" })
        ).body.code,
      ).toBe("organization_context_changed");
    },
  );

  it("keeps the password-change requirement through a switch", async () => {
    const h = setup();
    h.state.connect.onetimepwd = true;
    const s = await h.signedIn();
    const response = await h
      .request("post", "/api/session/organization", s.cookie, s.csrf)
      .send({ organizationId: target });
    expect(response.status).toBe(200);
    expect(response.body.identity.mustChangePassword).toBe(true);
  });

  it("verifies memberships before a same-organization no-op", async () => {
    const h = setup();
    const s = await h.signedIn();
    const response = await h
      .request("post", "/api/session/organization", s.cookie, s.csrf)
      .send({ organizationId: "7" });
    expect(response.status).toBe(200);
    expect(response.body.csrf).toBe(s.csrf);
    expect(h.calls.some((c) => c.url.pathname.endsWith("/organizations"))).toBe(
      true,
    );
    expect(
      h.calls.some((c) => c.url.pathname.endsWith("/switchorganization")),
    ).toBe(false);
  });

  it("does not treat the platform default organization as an already selected context", async () => {
    const h = setup(90);
    const s = await h.signedIn();
    h.state.switched = {
      ...h.state.connect,
      token: "synthetic-new-platform-token",
    };
    const response = await h
      .request("post", "/api/session/organization", s.cookie, s.csrf)
      .send({ organizationId: "7" });
    expect(response.status).toBe(200);
    expect(response.body.activeOrganizationId).toBe("7");
    expect(
      h.calls.some((c) => c.url.pathname.endsWith("/switchorganization")),
    ).toBe(true);
  });

  it.each([
    {},
    { organizationId: 7 },
    { organizationId: "0" },
    { organizationId: "07" },
    { organizationId: "9223372036854775808" },
    { organizationId: target, userTypeId: "90" },
  ])("rejects invalid switch input %j before upstream work", async (body) => {
    const h = setup();
    const s = await h.signedIn();
    const count = h.calls.length;
    const response = await h
      .request("post", "/api/session/organization", s.cookie, s.csrf)
      .send(body);
    expect(response.status).toBe(400);
    expect(h.calls).toHaveLength(count);
    expect((await h.store.get(s.sessionId))?.switching).toBeUndefined();
  });

  it("requires CSRF and origin, and rejects additional query parameters", async () => {
    const h = setup();
    const s = await h.signedIn();
    expect(
      (
        await h
          .request("post", "/api/session/organization", s.cookie)
          .send({ organizationId: target })
      ).status,
    ).toBe(403);
    expect(
      (
        await supertest(createApp(testConfig, h.store))
          .post("/api/session/organization")
          .set("Cookie", s.cookie)
          .set("X-CSRF-Token", s.csrf)
          .send({ organizationId: target })
      ).status,
    ).toBe(403);
    expect(
      (
        await h
          .request(
            "post",
            "/api/session/organization?role=90",
            s.cookie,
            s.csrf,
          )
          .send({ organizationId: target })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.request(
          "get",
          "/api/session/organizations?user=2",
          s.cookie,
          s.csrf,
        )
      ).status,
    ).toBe(400);
  });
});

describe("membership validation and legacy sessions", () => {
  it.each([
    ["duplicate", () => [memberships()[0], memberships()[0]]],
    ["foreign user", () => [{ ...memberships()[0], iduser: "2" }]],
    ["wrong role", () => [{ ...memberships()[0], idusertype: "40" }]],
    ["invalid ID", () => [{ ...memberships()[0], idorganization: "07" }]],
    ["non-boolean active", () => [{ ...memberships()[0], active: "true" }]],
    ["missing selected", () => [memberships()[1]]],
    [
      "too many",
      () =>
        Array.from({ length: 257 }, (_, i) => ({
          ...memberships()[0],
          idorganization: String(i + 1),
        })),
    ],
  ] as const)("rejects %s membership data at login", async (_name, make) => {
    const h = setup();
    h.state.connect.organizations = make();
    const response = await h.login();
    expect(response.status).toBe(502);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("filters disabled memberships and denies them even for a platform account", async () => {
    const h = setup(90);
    h.state.connect.organizations = [{ ...memberships()[1], active: false }];
    h.state.members = { organizations: h.state.connect.organizations };
    const s = await h.signedIn();
    expect(s.response.body.organizationMemberships).toEqual([]);
    const response = await h
      .request("post", "/api/session/organization", s.cookie, s.csrf)
      .send({ organizationId: target });
    expect(response.status).toBe(403);
    expect(
      h.calls.some((c) => c.url.pathname.endsWith("/switchorganization")),
    ).toBe(false);
    expect((await h.store.get(s.sessionId))?.token).toBe("synthetic-old-token");
  });

  it("enriches a legacy session from the authenticated self-membership endpoint", async () => {
    const h = setup();
    delete h.state.connect.organizations;
    const s = await h.signedIn();
    expect(s.response.body.organizationMemberships).toBeUndefined();
    const response = await h.request("get", "/api/session", s.cookie);
    expect(response.status).toBe(200);
    expect(response.body.activeOrganizationId).toBe("7");
    expect(response.body.organizationMemberships).toHaveLength(2);
    expect(
      (await h.store.get(s.sessionId))?.organizationMemberships,
    ).toHaveLength(2);
  });

  it.each([404, 405])(
    "keeps a legacy session usable when the backend returns %i",
    async (status) => {
      const h = setup();
      delete h.state.connect.organizations;
      h.state.membersStatus = status;
      const s = await h.signedIn();
      const response = await h.request("get", "/api/session", s.cookie);
      expect(response.status).toBe(200);
      expect(response.body.organizationMemberships).toBeUndefined();
    },
  );

  it.each([401, 403, 503])(
    "does not silently fall back on membership service failure %i",
    async (status) => {
      const h = setup();
      delete h.state.connect.organizations;
      h.state.membersStatus = status;
      const s = await h.signedIn();
      const response = await h.request("get", "/api/session", s.cookie);
      expect(response.status).toBe(status);
      expect(response.body.identity).toBeUndefined();
    },
  );
});

describe("atomic organization switching", () => {
  it("allows one switch and blocks business and session discovery until it commits", async () => {
    const h = setup();
    const s = await h.signedIn();
    const gate = barrier();
    h.state.beforeSwitch = gate.block;
    const switching = h
      .request("post", "/api/session/organization", s.cookie, s.csrf)
      .send({ organizationId: target })
      .then((r) => r);
    await gate.started;
    for (const [method, path] of [
      ["get", "/api/session"],
      ["get", "/api/session/organizations"],
      ["get", "/api/resources/sensortypes"],
      ["post", "/api/session/organization"],
    ] as const) {
      const response = await h
        .request(method, path, s.cookie, s.csrf)
        .send(method === "post" ? { organizationId: target } : undefined);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("organization_switch_pending");
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    gate.release();
    expect((await switching).status).toBe(200);
    expect(
      h.calls.filter((c) => c.url.pathname.endsWith("/switchorganization")),
    ).toHaveLength(1);
  });

  it("lets logout win against an in-flight switch and disconnects the orphan token", async () => {
    const h = setup();
    const s = await h.signedIn();
    const gate = barrier();
    h.state.beforeSwitch = gate.block;
    const switching = h
      .request("post", "/api/session/organization", s.cookie, s.csrf)
      .send({ organizationId: target })
      .then((r) => r);
    await gate.started;
    const logout = await h
      .request("post", "/api/session/logout", s.cookie, s.csrf)
      .send({});
    expect(logout.status).toBe(200);
    gate.release();
    const response = await switching;
    expect(response.status).toBe(409);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(await h.store.get(s.sessionId)).toBeNull();
    expect(
      h.calls
        .filter((c) => c.url.pathname.endsWith("/disconnect"))
        .map((c) => c.headers.get("Token")),
    ).toContain("synthetic-rotated-token");
  });

  it("a newer login is preserved when an older switch finishes", async () => {
    const h = setup();
    const s = await h.signedIn();
    const gate = barrier();
    h.state.beforeSwitch = gate.block;
    const switching = h
      .request("post", "/api/session/organization", s.cookie, s.csrf)
      .send({ organizationId: target })
      .then((r) => r);
    await gate.started;
    const login = await h
      .request("post", "/api/session/login", s.cookie)
      .send({ login: "synthetic", password: "synthetic password" });
    expect(login.status).toBe(200);
    const winnerId = login.headers["set-cookie"][0].split(";")[0].split("=")[1];
    gate.release();
    const response = await switching;
    expect(response.status).toBe(409);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect((await h.store.get(winnerId))?.csrf).toBe(login.body.csrf);
  });

  it("a delayed logout response cannot clear a newer login cookie", async () => {
    const h = setup();
    const s = await h.signedIn();
    const gate = barrier();
    h.state.beforeDisconnect = gate.block;
    const loggingOut = h
      .request("post", "/api/session/logout", s.cookie, s.csrf)
      .send({})
      .then((r) => r);
    await gate.started;
    expect(await h.store.get(s.sessionId)).toBeNull();
    const login = await h
      .request("post", "/api/session/login", s.cookie)
      .send({ login: "synthetic", password: "synthetic password" });
    expect(login.status).toBe(200);
    const winnerCookie = login.headers["set-cookie"][0].split(";")[0] as string;
    const winnerId = winnerCookie.split("=")[1];
    gate.release();
    const logout = await loggingOut;
    expect(logout.status).toBe(200);
    expect(logout.headers["set-cookie"]).toBeUndefined();
    expect((await h.store.get(winnerId))?.csrf).toBe(login.body.csrf);
    expect((await h.request("get", "/api/session", winnerCookie)).status).toBe(
      200,
    );
    expect((await h.request("get", "/api/session", s.cookie)).status).toBe(401);
  });

  it.each([400, 403, 404])(
    "releases its claim after a definite switch rejection %i",
    async (status) => {
      const h = setup();
      const s = await h.signedIn();
      h.state.switchStatus = status;
      const before = await h.store.get(s.sessionId);
      const response = await h
        .request("post", "/api/session/organization", s.cookie, s.csrf)
        .send({ organizationId: target });
      expect(response.status).toBe(status);
      expect(await h.store.get(s.sessionId)).toEqual(before);
    },
  );

  it.each([401, 409, 503])(
    "deletes only its claim on an uncertain switch failure %i",
    async (status) => {
      const h = setup();
      const s = await h.signedIn();
      h.state.switchStatus = status;
      const response = await h
        .request("post", "/api/session/organization", s.cookie, s.csrf)
        .send({ organizationId: target });
      expect(response.status).toBe(status);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(await h.store.get(s.sessionId)).toBeNull();
    },
  );

  it.each([
    ["different user", { iduser: "2" }],
    ["different organization", { idorganization: "8" }],
    ["wrong membership role", { idusertype: "41" }],
    ["elevated ordinary role", { usertypelevel: "90", idusertype: "90" }],
    ["same token", { token: "synthetic-old-token" }],
    ["missing membership metadata", { organizations: null }],
  ] as const)(
    "fails closed on a malformed switch reply: %s",
    async (_name, change) => {
      const h = setup();
      const s = await h.signedIn();
      h.state.switched = {
        ...h.state.connect,
        token: "synthetic-rotated-token",
        idorganization: target,
        idusertype: "40",
        usertypelevel: "40",
        ...change,
      };
      const response = await h
        .request("post", "/api/session/organization", s.cookie, s.csrf)
        .send({ organizationId: target });
      expect(response.status).toBe(502);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(await h.store.get(s.sessionId)).toBeNull();
    },
  );

  it("prevents a delayed password update from overwriting a completed switch", async () => {
    const h = setup();
    h.state.connect.onetimepwd = true;
    const s = await h.signedIn();
    const gate = barrier();
    h.state.beforePassword = gate.block;
    const password = h
      .request("post", "/api/session/password", s.cookie, s.csrf)
      .send({ password: "another synthetic password" })
      .then((r) => r);
    await gate.started;
    const switched = await h
      .request("post", "/api/session/organization", s.cookie, s.csrf)
      .send({ organizationId: target });
    expect(switched.status).toBe(200);
    gate.release();
    const response = await password;
    expect(response.status).toBe(409);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect((await h.store.get(s.sessionId))?.csrf).toBe(switched.body.csrf);
  });

  it.each([false, true])(
    "fences an already-started business 401 when switch committed=%s",
    async (committed) => {
      const h = setup();
      const s = await h.signedIn();
      const business = barrier();
      h.state.beforeBusiness = business.block;
      h.state.businessStatus = 401;
      const oldRequest = h
        .request("get", "/api/resources/sensortypes", s.cookie, s.csrf)
        .then((r) => r);
      await business.started;
      const gate = barrier();
      if (!committed) h.state.beforeSwitch = gate.block;
      const switching = h
        .request("post", "/api/session/organization", s.cookie, s.csrf)
        .send({ organizationId: target })
        .then((r) => r);
      if (committed) expect((await switching).status).toBe(200);
      else await gate.started;
      business.release();
      const response = await oldRequest;
      expect(response.status).toBe(409);
      expect(response.body.code).toBe(
        committed
          ? "organization_context_changed"
          : "organization_switch_pending",
      );
      expect(response.headers["set-cookie"]).toBeUndefined();
      if (!committed) {
        gate.release();
        expect((await switching).status).toBe(200);
      }
      expect((await h.store.get(s.sessionId))?.token).toBe(
        "synthetic-rotated-token",
      );
    },
  );

  it("expires an abandoned claim without restoring its possibly revoked token", async () => {
    const h = setup();
    const s = await h.signedIn();
    const original = (await h.store.get(s.sessionId))!;
    const claim = {
      ...original,
      switching: { nonce: "abandoned", expiresAt: Date.now() - 1 },
    };
    expect(await h.store.compareAndSet(s.sessionId, original, claim)).toBe(
      true,
    );
    const response = await h.request("get", "/api/session", s.cookie, s.csrf);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("organization_context_changed");
    expect(await h.store.get(s.sessionId)).toBeNull();
    expect((await h.request("get", "/api/session", s.cookie)).status).toBe(401);
  });

  it("does not start token rotation after a membership lookup outlives the claim", async () => {
    const h = setup();
    const s = await h.signedIn();
    const gate = barrier();
    h.state.beforeMembers = gate.block;
    const switching = h
      .request("post", "/api/session/organization", s.cookie, s.csrf)
      .send({ organizationId: target })
      .then((r) => r);
    await gate.started;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 30_001);
    gate.release();
    const response = await switching;
    expect(response.status).toBe(409);
    expect(await h.store.get(s.sessionId)).toBeNull();
    expect(
      h.calls.some((c) => c.url.pathname.endsWith("/switchorganization")),
    ).toBe(false);
  });

  it("fails closed on a lost switch response without retrying the revoked token", async () => {
    const h = setup();
    const s = await h.signedIn();
    h.state.beforeSwitch = async () => {
      throw new Error("synthetic transport failure");
    };
    const response = await h
      .request("post", "/api/session/organization", s.cookie, s.csrf)
      .send({ organizationId: target });
    expect(response.status).toBe(502);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(await h.store.get(s.sessionId)).toBeNull();
    expect(
      h.calls.filter((c) => c.url.pathname.endsWith("/switchorganization")),
    ).toHaveLength(1);
  });

  it("rejects a platform switch response that substitutes membership permissions for the global role", async () => {
    const h = setup(90);
    const s = await h.signedIn();
    h.state.switched = {
      ...h.state.connect,
      token: "synthetic-rotated-token",
      idorganization: target,
      idusertype: "40",
      usertypelevel: "40",
    };
    const response = await h
      .request("post", "/api/session/organization", s.cookie, s.csrf)
      .send({ organizationId: target });
    expect(response.status).toBe(502);
    expect(await h.store.get(s.sessionId)).toBeNull();
  });
});
