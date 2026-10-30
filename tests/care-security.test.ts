import { describe, expect, it } from "vitest";
import supertest from "supertest";
import { createApp } from "../server/app";
import { MemorySessions } from "../server/sessions";
import { fixtureTransport, testConfig, testIdentity } from "./fixtures";
import { careResponse } from "../server/care";
import { connectedSession } from "../server/session-organizations";
import { loadConfig } from "../server/config";
import { canAccess } from "../shared/resources";

function setup(
  flag: unknown = true,
  configured = false,
  careStatus = 200,
  sensors = true,
  careApiOrigin?: string,
  roleId = "30",
) {
  const base = fixtureTransport({
    ...testIdentity,
    level: 30,
    userTypeId: roleId,
    permissions: testIdentity.permissions.filter(
      (permission) => sensors || permission.entity !== "sensors",
    ),
  });
  const calls: string[] = [];
  const targets: { path: string; origin: string }[] = [];
  const app = createApp(
    {
      ...testConfig,
      caregiverUserTypeIds: new Set(configured ? [roleId] : []),
      careApiOrigin,
    },
    new MemorySessions(),
    async (input, init) => {
      const path = new URL(String(input)).pathname;
      targets.push({ path, origin: new URL(String(input)).origin });
      calls.push(path);
      if (path.startsWith("/v1/care/") && careStatus !== 200)
        return new Response("private report database failure", {
          status: careStatus,
        });
      if (path.startsWith("/v1/care/"))
        return Response.json({
          data: [{ id: "9223372036854775807", metrics: [{ value: 3.5 }] }],
          total: 1,
        });
      const response = await base.transport(input, init);
      if (path === "/v1/usersadmin/connect") {
        const data = await response.json();
        return Response.json({
          ...data,
          ...(flag === undefined ? {} : { caregiver_read_only: flag }),
        });
      }
      return response;
    },
  );
  return {
    app,
    calls,
    targets,
    login: () =>
      supertest(app)
        .post("/api/session/login")
        .set("Origin", testConfig.publicOrigin)
        .send({ login: "synthetic", password: "test password" }),
  };
}

describe("caregiver gateway boundary", () => {
  it("restricts confirmed Standard role 27 even when the older login service returns no caregiver classification", async () => {
    const fixture = setup(false, true, 200, true, undefined, "27");
    const login = await fixture.login();
    expect(login.status).toBe(200);
    expect(login.body.identity.userTypeId).toBe("27");
    expect(login.body.identity.caregiverReadOnly).toBe(true);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const restored = await supertest(fixture.app)
      .get("/api/session")
      .set("Cookie", cookie);
    expect(restored.body.identity.caregiverReadOnly).toBe(true);
    expect(
      (
        await supertest(fixture.app)
          .get("/api/care/subjects")
          .set("Cookie", cookie)
      ).status,
    ).toBe(200);
    expect(
      (
        await supertest(fixture.app)
          .get("/api/resources/assets")
          .set("Cookie", cookie)
      ).status,
    ).toBe(403);
    expect(
      (
        await supertest(fixture.app)
          .post("/api/resources/assets")
          .set("Cookie", cookie)
          .set("Origin", testConfig.publicOrigin)
          .set("X-CSRF-Token", login.body.csrf)
          .send({})
      ).status,
    ).toBe(403);
  });
  it("routes caregiver reads separately while preserving the technical Core origin", async () => {
    const s = setup(false, false, 200, true, "http://care.fixture.invalid");
    const login = await s.login();
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    expect(
      (await supertest(s.app).get("/api/care/subjects").set("Cookie", cookie))
        .status,
    ).toBe(200);
    expect(
      (
        await supertest(s.app)
          .get("/api/resources/sensortypes")
          .set("Cookie", cookie)
      ).status,
    ).toBe(200);
    expect(s.targets).toContainEqual({
      path: "/v1/care/subjects",
      origin: "http://care.fixture.invalid",
    });
    expect(s.targets).toContainEqual({
      path: "/v1/sensortypes",
      origin: testConfig.origins.core,
    });
  });

  it("validates the server-only caregiver origin without accepting credentials or paths", () => {
    const env = {
      SESSION_SECRET: Buffer.alloc(32).toString("base64"),
      API_ORIGIN: "http://api.fixture.invalid",
    };
    expect(
      loadConfig({
        ...env,
        CARE_API_ORIGIN: "http://care.fixture.invalid:8082",
      }).careApiOrigin,
    ).toBe("http://care.fixture.invalid:8082");
    expect(loadConfig(env).careApiOrigin).toBeUndefined();
    for (const origin of [
      "file:///tmp/care",
      "https://user:synthetic@care.fixture.invalid",
      "https://care.fixture.invalid/v1",
      "https://care.fixture.invalid?q=1",
      "https://care.fixture.invalid#care",
    ])
      expect(() => loadConfig({ ...env, CARE_API_ORIGIN: origin })).toThrow();
    expect(loadConfig(env).careUseAdminObservations).toBe(false);
    expect(
      loadConfig({ ...env, CARE_USE_ADMIN_OBSERVATIONS: "true" })
        .careUseAdminObservations,
    ).toBe(true);
    expect(
      loadConfig({ ...env, CARE_USE_ADMIN_OBSERVATIONS: "false" })
        .careUseAdminObservations,
    ).toBe(false);
    for (const value of ["1", "TRUE", "yes", ""])
      expect(() =>
        loadConfig({ ...env, CARE_USE_ADMIN_OBSERVATIONS: value }),
      ).toThrow();
  });

  it.each([false, true])(
    "only opts into Admin observations when configured: %s",
    async (enabled) => {
      const base = fixtureTransport({ ...testIdentity, level: 30 });
      base.records.set("sensortypes", [
        { m_nIDSensorType: "8", m_sHardwareType: "bedoff", m_nValueType: "1" },
      ]);
      base.records.set("devices", [
        { m_nIDDevice: "21", m_nIDAsset: "1", m_nIDOrganization: "7" },
      ]);
      base.records.set("sensors", [
        {
          m_nIDSensor: "31",
          m_nIDAsset: "1",
          m_nIDDevice: "21",
          m_nIDSensorType: "8",
          m_bValueBool: false,
          m_dhDhLastEvent: "2026-01-01T12:30:00.000Z",
        },
      ]);
      const calls: { path: string; origin: string; token: string | null }[] =
        [];
      const app = createApp(
        {
          ...testConfig,
          careApiOrigin: "http://care.fixture.invalid",
          careUseAdminObservations: enabled,
        },
        new MemorySessions(),
        async (input, init) => {
          const url = new URL(String(input));
          calls.push({
            path: url.pathname,
            origin: url.origin,
            token: new Headers(init?.headers).get("Token"),
          });
          if (url.pathname.startsWith("/v1/care/")) {
            const subject = {
              id: "1",
              organizationId: "7",
              tag: "SYNTHETIC",
              label: "",
              bed: {
                state: "unknown",
                lastObservedState: "unknown",
                observedAt: null,
                freshness: "unassessed",
              },
              latestReport: null,
            };
            return Response.json({
              data: url.pathname.endsWith("/subjects") ? [subject] : subject,
              reportAccess: "allowed",
              reportsAvailable: false,
            });
          }
          const response = await base.transport(input, init);
          if (url.pathname === "/v1/usersadmin/connect")
            return Response.json({
              ...(await response.json()),
              caregiver_read_only: true,
            });
          return response;
        },
      );
      const login = await supertest(app)
        .post("/api/session/login")
        .set("Origin", testConfig.publicOrigin)
        .send({ login: "synthetic", password: "test password" });
      const cookie = login.headers["set-cookie"][0].split(";")[0];
      for (const path of ["/api/care/subjects", "/api/care/subjects/1"]) {
        const response = await supertest(app).get(path).set("Cookie", cookie);
        expect(response.status).toBe(200);
        const subject = Array.isArray(response.body.data)
          ? response.body.data[0]
          : response.body.data;
        expect(subject.bed.lastObservedState).toBe(
          enabled ? "in_bed" : "unknown",
        );
        expect(subject.bed.state).toBe("unknown");
        expect(JSON.stringify(response.body)).not.toContain("m_nIDDevice");
        expect(JSON.stringify(response.body)).not.toContain(
          "synthetic-session-token",
        );
      }
      const readings = calls.filter((call) =>
        ["/v1/sensors", "/v1/devices", "/v1/sensortypes"].includes(call.path),
      );
      expect(readings).toHaveLength(enabled ? 6 : 0);
      expect(
        readings.every(
          (call) =>
            call.origin === testConfig.origins.core &&
            call.token === "synthetic-session-token",
        ),
      ).toBe(true);
      expect(
        (
          await supertest(app)
            .get("/api/resources/sensors")
            .set("Cookie", cookie)
        ).status,
      ).toBe(403);
    },
  );

  it.each(["trusted flag", "server role IDs"])(
    "denies technical reads and writes via %s",
    async (mode) => {
      const s = setup(
        mode === "trusted flag" ? true : undefined,
        mode !== "trusted flag",
      );
      const login = await s.login();
      expect(login.status).toBe(200);
      expect(login.body.identity.caregiverReadOnly).toBe(true);
      const cookie = login.headers["set-cookie"][0].split(";")[0];
      for (const path of [
        "/api/resources/assets",
        "/api/services",
        "/api/dashboard",
        "/api/user-organizations/1",
      ]) {
        expect(
          (await supertest(s.app).get(path).set("Cookie", cookie)).status,
        ).toBe(403);
      }
      expect(
        (
          await supertest(s.app)
            .post("/api/resources/assets")
            .set("Cookie", cookie)
            .set("Origin", testConfig.publicOrigin)
            .set("X-CSRF-Token", login.body.csrf)
            .send({})
        ).status,
      ).toBe(403);
      const subjects = await supertest(s.app)
        .get("/api/care/subjects?page=1&size=20")
        .set("Cookie", cookie);
      expect(subjects.status).toBe(200);
      expect(subjects.body.data[0].id).toBe("9223372036854775807");
      expect(subjects.body.data[0].metrics[0].value).toBe(3.5);
      expect(s.calls).not.toContain("/v1/assets");
    },
  );

  it("keeps ordinary administrators compatible", async () => {
    const s = setup(false);
    const login = await s.login();
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    expect(
      (
        await supertest(s.app)
          .get("/api/resources/assets")
          .set("Cookie", cookie)
      ).status,
    ).toBe(200);
    expect(
      canAccess({ ...testIdentity, caregiverReadOnly: true }, "assets", "show"),
    ).toBe(false);
    expect(canAccess(testIdentity, "assets", "edit")).toBe(true);
  });

  it("forwards only exact parent and report IDs to the read API", async () => {
    const s = setup();
    const login = await s.login();
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const asset = "9223372036854775807";
    const report = "9007199254740993";
    for (const suffix of [
      "",
      "/reports",
      `/reports/${report}`,
      `/reports/${report}/series`,
      "/trends",
    ]) {
      const path = `/care/subjects/${asset}${suffix}`;
      expect(
        (await supertest(s.app).get(`/api${path}`).set("Cookie", cookie))
          .status,
      ).toBe(200);
      expect(s.calls).toContain(`/v1${path}`);
    }
  });

  it("requires Sensors read rights for health reports even with Assets read access", async () => {
    const s = setup(true, false, 200, false);
    const login = await s.login();
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    expect(
      (await supertest(s.app).get("/api/care/subjects").set("Cookie", cookie))
        .status,
    ).toBe(200);
    for (const suffix of [
      "reports",
      "reports/2",
      "reports/2/series",
      "trends",
    ]) {
      const path = `/api/care/subjects/1/${suffix}`;
      expect(
        (await supertest(s.app).get(path).set("Cookie", cookie)).status,
      ).toBe(403);
      expect(s.calls).not.toContain(path.replace("/api/", "/v1/"));
    }
  });

  it.each([403, 404, 503])(
    "preserves unavailable/denied status %s with no mock fallback",
    async (status) => {
      const s = setup(true, false, status);
      const login = await s.login();
      const cookie = login.headers["set-cookie"][0].split(";")[0];
      const response = await supertest(s.app)
        .get("/api/care/subjects/1/reports/2")
        .set("Cookie", cookie);
      expect(response.status).toBe(status);
      expect(response.body.data).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain("private report");
    },
  );

  it("reports a missing caregiver collection as unavailable without inventing assets", async () => {
    const s = setup(true, false, 404);
    const login = await s.login();
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const response = await supertest(s.app)
      .get("/api/care/subjects?page=1&size=20")
      .set("Cookie", cookie);
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("care_backend_unavailable");
    expect(response.body.message).toContain("caregiver service is unavailable");
    expect(response.body.data).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("private report");
    expect(s.calls).toContain("/v1/care/subjects");
    expect(s.calls).not.toContain("/v1/assets");
  });

  it("bounds filters and never accepts arbitrary Core paths", async () => {
    const s = setup();
    const login = await s.login();
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    for (const query of [
      "size=101",
      "url=http://example.com",
      "page=1&page=2",
      "q=%00",
      "organization=0",
    ]) {
      expect(
        (
          await supertest(s.app)
            .get(`/api/care/subjects?${query}`)
            .set("Cookie", cookie)
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await supertest(s.app)
          .get(
            "/api/care/subjects/1/trends?startDate=2026-01-01&endDate=2026-03-01",
          )
          .set("Cookie", cookie)
      ).status,
    ).toBe(400);
  });

  it("rejects malformed trusted flags rather than assuming an administrator", async () => {
    expect((await setup("true").login()).status).toBe(502);
    expect(() =>
      connectedSession({ caregiver_read_only: "false" }, "Test"),
    ).toThrow();
  });

  it("preserves IDs and rejects non-finite chart values", () => {
    expect(
      careResponse({
        breathHistory: {
          windowDays: "28",
          groups: [
            { anchorReportId: "9223372036854775807", points: [{ value: "0" }] },
          ],
        },
      }),
    ).toEqual({
      breathHistory: {
        windowDays: 28,
        groups: [
          { anchorReportId: "9223372036854775807", points: [{ value: 0 }] },
        ],
      },
    });
    expect(
      careResponse({ id: "9223372036854775807", value: "0", heartRate: null }),
    ).toEqual({ id: "9223372036854775807", value: 0, heartRate: null });
    expect(() => careResponse({ value: "Infinity" })).toThrow();
  });

  it("validates explicit role IDs without guessing role levels", () => {
    const env = {
      SESSION_SECRET: Buffer.alloc(32).toString("base64"),
      API_ORIGIN: "http://api.fixture.invalid",
    };
    expect(
      loadConfig({ ...env, CAREGIVER_USER_TYPE_IDS: "30,9223372036854775807" })
        .caregiverUserTypeIds?.size,
    ).toBe(2);
    for (const value of ["0", "01", "-1", "9223372036854775808", "caregiver"])
      expect(() =>
        loadConfig({ ...env, CAREGIVER_USER_TYPE_IDS: value }),
      ).toThrow();
  });
});
