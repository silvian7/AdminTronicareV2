import { describe, expect, it, vi } from "vitest";
import type { CareSubject } from "../shared/care";
import type { Session } from "../server/sessions";
import { adminBedObservations } from "../server/care-observations";
import { createUpstream, type Transport } from "../server/upstream";
import { ApiError } from "../server/wire";
import { testConfig, testIdentity } from "./fixtures";

// Labelled synthetic records only. These exact int64 IDs cannot round-trip through Number.
const assetId = "9223372036854775806";
const otherAssetId = "9223372036854775805";
const deviceId = "9223372036854775804";
const sensorId = "9223372036854775803";
const typeId = "9223372036854775802";
const observedAt = "2026-01-02T03:04:05.123Z";
const unknownBed: CareSubject["bed"] = {
  state: "unknown",
  freshness: "unassessed",
  lastObservedState: "unknown",
  observedAt: null,
};
const subject = (overrides: Partial<CareSubject> = {}): CareSubject => ({
  id: assetId,
  organizationId: "7",
  tag: "SYNTHETIC-CARE-ASSET",
  label: "Synthetic care asset",
  bed: { ...unknownBed },
  latestReport: null,
  ...overrides,
});
const response = (rows = [subject()]) => ({
  data: rows,
  total: rows.length,
  page: 1,
  size: 20,
  reportAccess: "allowed",
  reportsAvailable: false,
  limited: false,
});
const session = (overrides: Partial<Session> = {}): Session => ({
  token: "synthetic-original-caller-token",
  csrf: "synthetic-csrf",
  expiresAt: Date.now() + 60_000,
  identity: {
    ...testIdentity,
    level: 30,
    userTypeId: "30",
    permissions: [{ entity: "sensors", rights: "r" }],
  },
  ...overrides,
});
const sensor = (overrides: Record<string, unknown> = {}) => ({
  m_nIDSensor: sensorId,
  m_nIDSensorType: typeId,
  m_nIDDevice: deviceId,
  m_nIDAsset: assetId,
  m_bValueBool: false,
  m_dhDhLastEvent: observedAt,
  m_sSerialNr: "SYNTHETIC-PRIVATE-SERIAL",
  m_sLabel: "SYNTHETIC-PRIVATE-SENSOR-LABEL",
  ...overrides,
});
const sensorType = (overrides: Record<string, unknown> = {}) => ({
  m_nIDSensorType: typeId,
  m_sHardwareType: "bedoff",
  m_nValueType: "1",
  ...overrides,
});
const device = (overrides: Record<string, unknown> = {}) => ({
  IDDevice: deviceId,
  IDAsset: assetId,
  IDOrganization: "7",
  SerialCode: "SYNTHETIC-PRIVATE-DEVICE-CODE",
  ...overrides,
});
type Source = "sensors" | "sensortypes" | "devices";
type SourceReplies = Partial<Record<Source, unknown>>;
function setup(
  options: {
    initial?: unknown;
    fresh?: unknown;
    auth?: Session;
    replies?: SourceReplies;
    statuses?: Partial<Record<Source, number>>;
    revalidate?: () => Promise<unknown>;
    transport?: Transport;
  } = {},
) {
  const initial = options.initial ?? response();
  const auth = options.auth ?? session();
  const calls: { url: URL; headers: Headers; method: string }[] = [];
  const replies = {
    sensors: [sensor()],
    sensortypes: [sensorType()],
    devices: [device()],
    ...options.replies,
  };
  const transport: Transport = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      url,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
    });
    if (options.transport) return options.transport(input, init);
    const source = url.pathname.slice("/v1/".length) as Source;
    if (!(source in replies)) throw new Error("Unexpected synthetic route");
    return Response.json(replies[source], {
      status: options.statuses?.[source] ?? 200,
    });
  };
  const fresh = options.fresh ?? structuredClone(initial);
  const revalidate = vi.fn(options.revalidate ?? (async () => fresh));
  const run = () =>
    adminBedObservations(
      initial,
      auth,
      createUpstream(testConfig, transport),
      revalidate,
    );
  return { run, initial, auth, calls, revalidate };
}
function beds(result: unknown): CareSubject["bed"][] {
  const body = result as { data: CareSubject | CareSubject[] };
  return (Array.isArray(body.data) ? body.data : [body.data]).map(
    (row) => row.bed,
  );
}
function expectUnknown(result: unknown, availability?: string) {
  for (const bed of beds(result)) {
    expect(bed).toMatchObject(unknownBed);
    if (availability) expect(bed.availability).toBe(availability);
    expect(bed.source).toBeUndefined();
  }
}

describe("caller-scoped Admin bed observations", () => {
  it.each([
    [false, "in_bed"],
    [true, "out_of_bed"],
  ] as const)(
    "projects Boolean %s as a dated %s observation",
    async (value, state) => {
      const fixture = setup({
        replies: { sensors: [sensor({ m_bValueBool: value })] },
      });
      const original = structuredClone(fixture.initial);
      const result = await fixture.run();
      expect(beds(result)).toEqual([
        {
          ...unknownBed,
          lastObservedState: state,
          observedAt,
          availability: "available",
          source: "admin_sensor",
        },
      ]);
      expect(fixture.initial).toEqual(original);
      expect(fixture.revalidate).toHaveBeenCalledTimes(1);
      expect(fixture.calls.map((call) => call.url.pathname).sort()).toEqual([
        "/v1/devices",
        "/v1/sensors",
        "/v1/sensortypes",
      ]);
      for (const call of fixture.calls) {
        expect(call.method).toBe("GET");
        expect(call.headers.get("Token")).toBe(fixture.auth.token);
        expect(call.url.searchParams.has("limit")).toBe(false);
      }
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(sensorId);
      expect(serialized).not.toContain(deviceId);
      expect(serialized).not.toContain("SYNTHETIC-PRIVATE");
      expect(serialized).not.toContain(fixture.auth.token);
    },
  );

  it("supports an individual subject envelope without changing its other fields", async () => {
    const initial = {
      data: subject(),
      reportAccess: "allowed",
      syntheticMetadata: "kept",
    };
    const fixture = setup({ initial });
    const result = await fixture.run();
    expect(result).toMatchObject({
      syntheticMetadata: "kept",
      data: { id: assetId },
    });
    expect(beds(result)[0].lastObservedState).toBe("in_bed");
    for (const call of fixture.calls.filter(
      (call) => call.url.pathname !== "/v1/sensortypes",
    ))
      expect(call.url.searchParams.get("idasset")).toBe(assetId);
  });

  it("reads source collections concurrently and revalidates after all three finish", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const fixture = setup({
      transport: async (input) => {
        reads += 1;
        await held;
        const path = new URL(String(input)).pathname;
        return Response.json(
          path === "/v1/sensors"
            ? [sensor()]
            : path === "/v1/devices"
              ? [device()]
              : [sensorType()],
        );
      },
    });
    const pending = fixture.run();
    await vi.waitFor(() => expect(reads).toBe(3));
    expect(fixture.revalidate).not.toHaveBeenCalled();
    release();
    expect(beds(await pending)[0].availability).toBe("available");
  });

  it("keeps a real primary observation and makes no secondary calls", async () => {
    const primary = {
      ...unknownBed,
      lastObservedState: "out_of_bed" as const,
      observedAt,
    };
    const fixture = setup({ initial: response([subject({ bed: primary })]) });
    expect(await fixture.run()).toEqual(fixture.initial);
    expect(fixture.calls).toHaveLength(0);
    expect(fixture.revalidate).not.toHaveBeenCalled();
  });

  it.each(["denied", "unavailable", "ambiguous", "limited"] as const)(
    "does not override an explicit primary %s observation decision",
    async (availability) => {
      const fixture = setup({
        initial: response([subject({ bed: { ...unknownBed, availability } })]),
      });
      expect(await fixture.run()).toEqual(fixture.initial);
      expect(fixture.calls).toHaveLength(0);
      expect(fixture.revalidate).not.toHaveBeenCalled();
    },
  );

  it("enriches multiple visible subjects with one bounded set of source reads", async () => {
    const initial = response([subject(), subject({ id: otherAssetId })]);
    const otherDeviceId = "9223372036854775800";
    const fixture = setup({
      initial,
      replies: {
        sensors: [
          sensor(),
          sensor({
            m_nIDSensor: "9223372036854775799",
            m_nIDAsset: otherAssetId,
            m_nIDDevice: otherDeviceId,
            m_bValueBool: true,
          }),
        ],
        devices: [
          device(),
          device({ IDDevice: otherDeviceId, IDAsset: otherAssetId }),
        ],
      },
    });
    expect(
      beds(await fixture.run()).map((bed) => bed.lastObservedState),
    ).toEqual(["in_bed", "out_of_bed"]);
    expect(fixture.calls).toHaveLength(3);
    expect(
      fixture.calls.every((call) => !call.url.searchParams.has("idasset")),
    ).toBe(true);
    expect(fixture.revalidate).toHaveBeenCalledTimes(1);
  });

  it("preserves a fresh primary reading discovered during revalidation", async () => {
    const fresh = response([
      subject({
        bed: { ...unknownBed, lastObservedState: "out_of_bed", observedAt },
      }),
    ]);
    const fixture = setup({ fresh });
    expect(await fixture.run()).toEqual(fresh);
  });

  it("preserves a fresh explicit primary denial discovered during revalidation", async () => {
    const fresh = response([
      subject({ bed: { ...unknownBed, availability: "denied" } }),
    ]);
    const fixture = setup({ fresh });
    expect(await fixture.run()).toEqual(fresh);
  });

  it.each(["denied", undefined, null])(
    "does not read health sources when reportAccess is %s",
    async (reportAccess) => {
      const fixture = setup({ initial: { ...response(), reportAccess } });
      expectUnknown(await fixture.run(), "denied");
      expect(fixture.calls).toHaveLength(0);
      expect(fixture.revalidate).not.toHaveBeenCalled();
    },
  );

  it.each([
    { permissions: [] },
    { permissions: [{ entity: "sensors", rights: "u" }] },
  ])("requires the normal Sensors read permission", async ({ permissions }) => {
    const auth = session();
    auth.identity.permissions = permissions;
    const fixture = setup({ auth });
    expectUnknown(await fixture.run(), "denied");
    expect(fixture.calls).toHaveLength(0);
  });

  it("supports a platform caller without inventing an ordinary user's permission", async () => {
    const auth = session();
    auth.identity.level = 90;
    auth.identity.permissions = [];
    const fixture = setup({ auth });
    expect(beds(await fixture.run())[0].availability).toBe("available");
  });

  it("keeps an explicitly classified caregiver on normal caller credentials", async () => {
    const auth = session();
    auth.identity.caregiverReadOnly = true;
    const fixture = setup({ auth, statuses: { devices: 403 } });
    expectUnknown(await fixture.run(), "denied");
    expect(
      fixture.calls.every((call) => call.headers.get("Token") === auth.token),
    ).toBe(true);
  });

  it.each([null, undefined, "false", "true", 0, 1, {}, []])(
    "ignores a non-Boolean reading %j",
    async (value) => {
      const fixture = setup({
        replies: { sensors: [sensor({ m_bValueBool: value })] },
      });
      expectUnknown(await fixture.run(), "unavailable");
    },
  );

  it.each([
    null,
    undefined,
    "",
    1767323045,
    "2026-01-02T03:04:05",
    "2026-02-30T03:04:05Z",
    "1970-01-01T00:00:00Z",
    "1969-12-31T23:59:59Z",
    "9999-01-01T00:00:00Z",
    "2026-01-02T03:04:05.123456Z",
  ])(
    "ignores an absent, invalid, nonpositive or future timestamp %j",
    async (timestamp) => {
      const fixture = setup({
        replies: { sensors: [sensor({ m_dhDhLastEvent: timestamp })] },
      });
      expectUnknown(await fixture.run(), "unavailable");
    },
  );

  it.each([
    ["20260102030405", "2026-01-02T03:04:05.000Z"],
    ["2026-01-02T04:04:05.123+01:00", observedAt],
  ])(
    "uses the Admin timestamp semantics for %s",
    async (timestamp, expected) => {
      const fixture = setup({
        replies: { sensors: [sensor({ m_dhDhLastEvent: timestamp })] },
      });
      expect(beds(await fixture.run())[0].observedAt).toBe(expected);
    },
  );

  it("recognizes the exact trimmed case-insensitive bedoff Boolean type", async () => {
    const fixture = setup({
      replies: { sensortypes: [sensorType({ m_sHardwareType: "  BeDoFf  " })] },
    });
    expect(beds(await fixture.run())[0].availability).toBe("available");
  });

  it.each([
    { m_sHardwareType: "movement" },
    { m_sHardwareType: "bedoff-other" },
    { m_sHardwareType: null },
    { m_nValueType: "2" },
    { m_nValueType: null },
  ])(
    "does not infer a bed reading from unrelated or malformed type metadata %j",
    async (type) => {
      const fixture = setup({ replies: { sensortypes: [sensorType(type)] } });
      expectUnknown(await fixture.run());
    },
  );

  it.each([
    { IDAsset: otherAssetId },
    { IDOrganization: "8" },
    { IDAsset: null },
    { IDOrganization: undefined },
  ])(
    "requires the sensor's device to match the subject asset and organization %j",
    async (owner) => {
      const fixture = setup({ replies: { devices: [device(owner)] } });
      expectUnknown(await fixture.run(), "unavailable");
    },
  );

  it("does not attach a sensor from another asset", async () => {
    const fixture = setup({
      replies: { sensors: [sensor({ m_nIDAsset: otherAssetId })] },
    });
    expectUnknown(await fixture.run());
  });

  it.each(["devices", "sensortypes"] as const)(
    "does not infer missing %s ownership/type evidence",
    async (source) => {
      const fixture = setup({ replies: { [source]: [] } });
      expectUnknown(await fixture.run());
    },
  );

  it.each(["sensors", "sensortypes", "devices"] as const)(
    "rejects duplicate exact primary identities in %s",
    async (source) => {
      const row =
        source === "sensors"
          ? sensor()
          : source === "devices"
            ? device()
            : sensorType();
      const fixture = setup({ replies: { [source]: [row, { ...row }] } });
      expectUnknown(await fixture.run(), "unavailable");
    },
  );

  it.each(["0", "-1", "01", "9223372036854775808"])(
    "rejects a malformed sensor primary ID %j",
    async (identity) => {
      const fixture = setup({
        replies: { sensors: [sensor({ m_nIDSensor: identity })] },
      });
      expectUnknown(await fixture.run(), "unavailable");
    },
  );

  it.each([true, false])(
    "keeps multiple bedoff sensors ambiguous even if the second value is valid=%s",
    async (valid) => {
      const fixture = setup({
        replies: {
          sensors: [
            sensor(),
            sensor({
              m_nIDSensor: "9223372036854775801",
              m_bValueBool: valid ? true : null,
              m_dhDhLastEvent: "2026-02-01T00:00:00Z",
            }),
          ],
        },
      });
      expectUnknown(await fixture.run(), "ambiguous");
    },
  );

  it.each(["sensors", "sensortypes", "devices"] as const)(
    "refuses capped %s collections rather than treating them as complete",
    async (source) => {
      const row =
        source === "sensors"
          ? sensor()
          : source === "devices"
            ? device()
            : sensorType();
      const fixture = setup({
        replies: { [source]: Array.from({ length: 10000 }, () => row) },
      });
      expectUnknown(await fixture.run(), "limited");
      expect(fixture.revalidate).not.toHaveBeenCalled();
    },
  );

  it.each([
    [403, "denied"],
    [404, "unavailable"],
    [500, "unavailable"],
    [503, "unavailable"],
  ] as const)(
    "fails closed on a source status %s without disclosing its body",
    async (status, availability) => {
      const fixture = setup({
        statuses: { sensortypes: status },
        replies: {
          sensortypes: { private: "SYNTHETIC-PRIVATE-UPSTREAM-BODY" },
        },
      });
      const result = await fixture.run();
      expectUnknown(result, availability);
      expect(JSON.stringify(result)).not.toContain("SYNTHETIC-PRIVATE");
      expect(fixture.revalidate).not.toHaveBeenCalled();
    },
  );

  it("propagates an expired token even when another concurrent source denies access", async () => {
    const fixture = setup({ statuses: { sensors: 401, sensortypes: 403 } });
    await expect(fixture.run()).rejects.toMatchObject({ status: 401 });
    expect(fixture.revalidate).not.toHaveBeenCalled();
  });

  it("does not expose exception text when a source cannot be reached", async () => {
    const fixture = setup({
      transport: async () => {
        throw new Error("SYNTHETIC-PRIVATE-EXCEPTION");
      },
    });
    const result = await fixture.run();
    expectUnknown(result, "unavailable");
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC-PRIVATE");
  });

  it.each([null, {}, [null], ["wrong"]])(
    "fails closed on a malformed source collection %j",
    async (rows) => {
      const fixture = setup({ replies: { sensors: rows } });
      expectUnknown(await fixture.run(), "unavailable");
    },
  );

  it.each([
    response([]),
    response([subject({ id: otherAssetId })]),
    response([subject({ organizationId: "8" })]),
    { ...response(), reportAccess: "denied" },
  ])(
    "never attaches an old reading after fresh subject scope or permission changes",
    async (fresh) => {
      const fixture = setup({ fresh });
      expect(await fixture.run()).toEqual(fresh);
      expect(fixture.revalidate).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403, 404])(
    "propagates fresh authority failure %s after source reads",
    async (status) => {
      const fixture = setup({
        revalidate: async () => {
          throw new ApiError(status, "Synthetic fresh denial");
        },
      });
      await expect(fixture.run()).rejects.toMatchObject({ status });
    },
  );

  it("does not return a reading if the fresh care lookup is unavailable", async () => {
    const fixture = setup({
      revalidate: async () => {
        throw new ApiError(503, "SYNTHETIC-PRIVATE-FAILURE");
      },
    });
    expectUnknown(await fixture.run(), "unavailable");
  });

  it.each([
    { data: [subject(), subject()], reportAccess: "allowed" },
    { data: subject({ id: "01" }), reportAccess: "allowed" },
    { data: null, reportAccess: "allowed" },
  ])(
    "rejects a malformed primary care response before any secondary request",
    async (initial) => {
      const fixture = setup({ initial });
      await expect(fixture.run()).rejects.toMatchObject({ status: 502 });
      expect(fixture.calls).toHaveLength(0);
    },
  );
});
