import { describe, expect, it } from "vitest";
import { parseWire, writeBody, publicRecord } from "../server/wire";
import { resourceMap, editableFields } from "../shared/resources";
import { fixtureRecord } from "./fixtures";
import { passwordDigest } from "../server/app";

describe("wire compatibility", () => {
  it("preserves signed 64-bit IDs and exact decimal values on reads", () => {
    expect(
      parseWire(
        '{"id":9223372036854775807,"negative":-9223372036854775808,"credit":99999999.123456}',
      ),
    ).toEqual({
      id: "9223372036854775807",
      negative: "-9223372036854775808",
      credit: "99999999.123456",
    });
  });
  it("serializes integer and currency input without precision loss", () => {
    const body = writeBody(
      resourceMap.organizations,
      {
        m_nIDOrganizationType: "9223372036854775807",
        m_moEnCoursAutorisé: "99999999.123456",
      },
      "edit",
    );
    expect(body).toContain('"m_nIDOrganizationType":9223372036854775807');
    expect(body).toContain('"m_moEnCoursAutorisé":99999999.123456');
  });
  it("keeps Core response and input member names separate", () => {
    expect(
      writeBody(
        resourceMap.devices,
        { Label: "Updated", IDAsset: "0" },
        "edit",
      ),
    ).toBe('{"Label":"Updated","IDAsset":0}');
    expect(() =>
      writeBody(resourceMap.devices, { m_sLabel: "Wrong alias" }, "edit"),
    ).toThrow("highlighted");
    expect(resourceMap.devices.primaryKey).toBe("IDDevice");
  });
  it("requires Core creation fields expressed as alternative aliases", () => {
    expect(() =>
      writeBody(resourceMap.devices, { Label: "Incomplete" }, "create"),
    ).toThrow("highlighted");
    expect(
      writeBody(
        resourceMap.devices,
        { Label: "Device", SerialNr: "QA-1", IDHub: "1", IDDeviceType: "1" },
        "create",
      ),
    ).toContain('"IDHub":1');
    for (const name of [
      "hubs",
      "hubtypes",
      "devices",
      "devicetypes",
      "sensors",
      "sensortypes",
    ]) {
      expect(
        editableFields(resourceMap[name], "edit").some(
          (f) => f.key === "Label",
        ),
      ).toBe(true);
    }
  });
  it("removes credential fields before returning Users to a browser", () => {
    const row = publicRecord(
      resourceMap.users,
      fixtureRecord(resourceMap.users, "1", {
        m_sHash: "synthetic-private",
        m_sCode: "synthetic-code",
        m_sToken: "synthetic-token",
      }),
    );
    expect(row).not.toHaveProperty("m_sHash");
    expect(row).not.toHaveProperty("m_sCode");
    expect(row).not.toHaveProperty("m_sToken");
    expect(() =>
      writeBody(resourceMap.users, { m_sHash: "anything" }, "edit"),
    ).toThrow("highlighted");
  });
  it("rejects fractional integers, out-of-range IDs and unsafe JS numbers", () => {
    for (const v of ["1.5", "9223372036854775808", 9223372036854775807])
      expect(() =>
        writeBody(resourceMap.assets, { m_nIDOrganization: v }, "edit"),
      ).toThrow();
  });
  it("preserves zero/unassigned, false, empty dates and zero-date sentinels", () => {
    expect(
      writeBody(
        resourceMap.assets,
        {
          m_nIDOrganization: "0",
          m_bPauseRules: false,
          m_dDtPauseRulesStart: "",
          m_dDtPauseRulesEnd: "0000-00-00",
        },
        "edit",
      ),
    ).toBe(
      '{"m_nIDOrganization":0,"m_bPauseRules":false,"m_dDtPauseRulesStart":"","m_dDtPauseRulesEnd":"0000-00-00"}',
    );
  });
  it("hashes passwords exactly like the supplied Users implementation", () => {
    expect(passwordDigest("password", "tcare")).toMatch(/^[A-F0-9]{64}$/);
    expect(passwordDigest("password", "tcare")).not.toBe(
      passwordDigest("PASSWORD", "tcare"),
    );
  });
  it("limits forwarded-record writes to user-maintained flags", () => {
    expect(
      editableFields(resourceMap.actionsforward, "edit").map((f) => f.key),
    ).toEqual(["m_bIsRead", "m_bIsAck", "m_bIsArchive", "m_bIsDeleted"]);
    expect(() =>
      writeBody(resourceMap.actionsforward, { m_bProcessed: true }, "edit"),
    ).toThrow();
  });
});
