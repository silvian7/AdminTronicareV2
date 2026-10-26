import { describe, expect, it } from "vitest";
import {
  ruleInstanceTemplateDraft,
  ruleTemplateDraft,
} from "../shared/rule-template";
import type { RecordData } from "../shared/resources";

describe("rule drafts from templates", () => {
  it("copies configuration without identity, ownership, runtime or unknown fields", () => {
    const label =
      '[ {"lang":1033,"text":"Bed rule"}, {"lang":"fr","text":"Règle"} ]';
    const source = Object.freeze({
      id: "9223372036854775807",
      m_nIDRule: "9223372036854775807",
      m_nIDSensor: "9223372036854775806",
      m_nIDAsset: "9223372036854775805",
      m_sAssetTag: "source asset",
      m_nIDRuleType: "9223372036854775804",
      m_sTag: "Template tag",
      m_sLabel: label,
      m_duValueDuree: "9007199254740993",
      m_nValueThreshold: "-2147483648",
      m_nLevel: "3",
      m_hTimeStart: "00:00:00.001",
      m_hTimeEnd: "23:59:59.999",
      m_bTime24h: false,
      m_nResetDelayMs: "604800000",
      m_bEnabled: true,
      m_bIsTemplate: true,
      m_bOutput: true,
      m_bTimeoutStarted: true,
      m_bTimeoutElapsed: true,
      m_bTimeoutCanceled: true,
      m_bCanceled: true,
      m_bResetPending: true,
      m_dhDhReset: "2026-10-25T10:00:00.000",
      m_dhDhCreated: "2020-01-01T00:00:00.000",
      m_dhDhModified: "2026-10-25T10:00:00.000",
      m_dhDhActivated: "2026-10-25T10:00:00.000",
      m_dhDhDeactivated: "2026-10-25T10:00:00.000",
      m_dhDhTimeout: "2026-10-25T10:00:00.000",
      m_dhDhCanceled: "2026-10-25T10:00:00.000",
      DuInhibition: "10000",
      DhTimeoutInhibition: "2026-10-25T10:00:00.000",
      EbableBeforeWindow: true,
      actions: [{ id: "1" }],
      futureUnknownSetting: "not implicitly copied",
    });
    const before = structuredClone(source);
    const draft = ruleTemplateDraft(source);
    expect(draft).toEqual({
      m_nIDRuleType: "9223372036854775804",
      m_sTag: "Template tag",
      m_sLabel: label,
      m_duValueDuree: "9007199254740993",
      m_nValueThreshold: "-2147483648",
      m_nLevel: "3",
      m_hTimeStart: "00:00:00.001",
      m_hTimeEnd: "23:59:59.999",
      m_bTime24h: false,
      m_nResetDelayMs: "604800000",
      m_bIsTemplate: false,
      m_bEnabled: false,
    });
    expect(source).toEqual(before);
    draft.m_sTag = "A new instance";
    expect(source.m_sTag).toBe("Template tag");
    expect(source.m_bEnabled).toBe(true);
    expect(source.m_bIsTemplate).toBe(true);
  });

  it("resolves canonical response aliases to the API's write keys", () => {
    expect(
      ruleTemplateDraft({
        IsTemplate: true,
        IDRuleType: "7",
        Tag: "Canonical tag",
        Label: "Canonical label",
        ValueDuree: "1501",
        ValueThreshold: "0",
        Level: "2",
        TimeStart: "12:34:56.789",
        TimeEnd: "00:00:00",
        Time24h: true,
        ResetDelayMs: "1001",
        Enabled: true,
        IDSensor: "11",
        IDAsset: "12",
        Output: true,
      }),
    ).toEqual({
      m_nIDRuleType: "7",
      m_sTag: "Canonical tag",
      m_sLabel: "Canonical label",
      m_duValueDuree: "1501",
      m_nValueThreshold: "0",
      m_nLevel: "2",
      m_hTimeStart: "12:34:56.789",
      m_hTimeEnd: "00:00:00",
      m_bTime24h: true,
      m_nResetDelayMs: "1001",
      m_bIsTemplate: false,
      m_bEnabled: false,
    });
  });

  it.each([null, "", "00:00:00", "00:00:00.000", "01:30:00.001"])(
    "retains raw UTC clock/midnight value %j for editor conversion",
    (time) => {
      const draft = ruleTemplateDraft({
        m_bIsTemplate: true,
        m_hTimeStart: time,
        m_hTimeEnd: time,
      });
      expect(draft.m_hTimeStart).toBe(time);
      expect(draft.m_hTimeEnd).toBe(time);
    },
  );

  it.each(["9223372036854775807", "-9223372036854775808", "1001", "0"])(
    "does not round or convert raw millisecond duration %s",
    (duration) => {
      const draft = ruleTemplateDraft({
        m_bIsTemplate: true,
        m_duValueDuree: duration,
        m_nResetDelayMs: "1001",
      });
      expect(draft.m_duValueDuree).toBe(duration);
      expect(draft.m_nResetDelayMs).toBe("1001");
    },
  );

  it.each(["1", "9007199254740993", "9223372036854775807"])(
    "preserves exact positive rule-type ID %s",
    (id) =>
      expect(
        ruleTemplateDraft({ m_bIsTemplate: true, m_nIDRuleType: id })
          .m_nIDRuleType,
      ).toBe(id),
  );

  it.each([
    undefined,
    null,
    "",
    "0",
    "-1",
    "01",
    " 7 ",
    "7.0",
    "7e1",
    "9223372036854775808",
    7,
    9007199254740992,
    true,
    {},
  ])("omits an invalid or inexact rule-type reference %j", (id) => {
    const draft = ruleTemplateDraft({
      m_bIsTemplate: true,
      m_nIDRuleType: id,
      m_sTag: "Still copied",
    });
    expect(draft).toEqual({
      m_sTag: "Still copied",
      m_bIsTemplate: false,
      m_bEnabled: false,
    });
  });

  it("does not invent absent configuration or carry destination relationships", () => {
    expect(
      ruleTemplateDraft({
        m_bIsTemplate: true,
        m_nIDAsset: "7",
        m_nIDSensor: "8",
      }),
    ).toEqual({
      m_bIsTemplate: false,
      m_bEnabled: false,
    });
  });

  it.each([
    null,
    undefined,
    [],
    {},
    { m_bIsTemplate: false },
    { m_bIsTemplate: "true" },
    { IsTemplate: 1 },
  ])(
    "rejects a source that is not strictly flagged as a template: %j",
    (source) =>
      expect(() => ruleTemplateDraft(source as RecordData)).toThrow(
        "Choose a rule flagged as a template.",
      ),
  );
});

describe("template drafts from existing rule instances", () => {
  it("preserves configuration and severity while clearing instance ownership and runtime", () => {
    const configuration = {
      m_nIDRuleType: "9223372036854775807",
      m_sTag: "Existing rule tag",
      m_sLabel:
        '[ {"lang":1033,"text":"Existing rule"}, {"lang":"nl","text":"Bestaande regel"} ]',
      m_duValueDuree: "-9223372036854775808",
      m_nValueThreshold: "2147483647",
      m_nLevel: "3",
      m_hTimeStart: "01:30:00.001",
      m_hTimeEnd: "23:59:59.999",
      m_bTime24h: false,
      m_nResetDelayMs: "604800000",
    };
    const source = Object.freeze({
      ...configuration,
      id: "9223372036854775806",
      m_nIDRule: "9223372036854775806",
      m_nIDAsset: "9223372036854775805",
      m_nIDSensor: "9223372036854775804",
      m_sAssetTag: "Original owner",
      m_bIsTemplate: false,
      m_bEnabled: true,
      m_bOutput: true,
      m_bTimeoutStarted: true,
      m_bTimeoutElapsed: true,
      m_bTimeoutCanceled: true,
      m_bCanceled: true,
      m_bResetPending: true,
      m_dhDhCreated: "2020-01-01T00:00:00.000",
      m_dhDhModified: "2026-10-26T10:00:00.000",
      m_dhDhActivated: "2026-10-26T10:00:00.000",
      m_dhDhDeactivated: "2026-10-26T10:00:00.000",
      m_dhDhTimeout: "2026-10-26T10:00:00.000",
      m_dhDhCanceled: "2026-10-26T10:00:00.000",
      m_dhDhReset: "2026-10-26T10:00:00.000",
      DuInhibition: "10000",
      actions: [{ id: "1" }],
      futureUnknownSetting: "Excluded",
    });
    const before = structuredClone(source);
    const draft = ruleInstanceTemplateDraft(source);
    expect(draft).toEqual({
      ...configuration,
      m_bIsTemplate: true,
      m_bEnabled: false,
      m_nIDAsset: "0",
      m_nIDSensor: "0",
    });
    expect(source).toEqual(before);
    draft.m_sTag = "Reusable template";
    expect(source.m_sTag).toBe("Existing rule tag");
    expect(source.m_bIsTemplate).toBe(false);
    expect(source.m_bEnabled).toBe(true);
  });

  it("uses canonical response aliases while returning only canonical wire write keys", () => {
    expect(
      ruleInstanceTemplateDraft({
        IsTemplate: false,
        Enabled: true,
        IDRule: "11",
        IDAsset: "12",
        IDSensor: "13",
        IDRuleType: "9007199254740993",
        Tag: "Canonical rule",
        Label: "Canonical label",
        Level: "2",
        ValueDuree: "1001",
        ValueThreshold: "0",
        ResetDelayMs: "1",
        TimeStart: "00:00:00.000",
        TimeEnd: "12:00:00.999",
        Time24h: true,
        Output: true,
        TimeoutStarted: true,
        ResetPending: true,
      }),
    ).toEqual({
      m_nIDRuleType: "9007199254740993",
      m_sTag: "Canonical rule",
      m_sLabel: "Canonical label",
      m_nLevel: "2",
      m_duValueDuree: "1001",
      m_nValueThreshold: "0",
      m_nResetDelayMs: "1",
      m_hTimeStart: "00:00:00.000",
      m_hTimeEnd: "12:00:00.999",
      m_bTime24h: true,
      m_bIsTemplate: true,
      m_bEnabled: false,
      m_nIDAsset: "0",
      m_nIDSensor: "0",
    });
  });

  it.each([null, "", "00:00:00.001"])(
    "preserves raw UTC time/midnight value %j",
    (time) => {
      const draft = ruleInstanceTemplateDraft({
        IsTemplate: false,
        TimeStart: time,
        TimeEnd: time,
      });
      expect(draft.m_hTimeStart).toBe(time);
      expect(draft.m_hTimeEnd).toBe(time);
    },
  );

  it("does not introduce an invalid rule type when producing a reusable template", () => {
    expect(
      ruleInstanceTemplateDraft({
        IsTemplate: false,
        IDRuleType: "9223372036854775808",
      }),
    ).toEqual({
      m_bIsTemplate: true,
      m_bEnabled: false,
      m_nIDAsset: "0",
      m_nIDSensor: "0",
    });
  });

  it("can produce a fresh disabled instance from the new template without restoring old ownership", () => {
    const template = ruleInstanceTemplateDraft({
      IsTemplate: false,
      IDAsset: "8",
      IDSensor: "9",
      IDRuleType: "7",
      Label: '{"en":"Same translations"}',
      Level: "3",
      ValueDuree: "9007199254740993",
      TimeStart: "00:00:00.001",
      TimeEnd: null,
      Output: true,
    });
    expect(ruleTemplateDraft(template)).toEqual({
      m_nIDRuleType: "7",
      m_sLabel: '{"en":"Same translations"}',
      m_nLevel: "3",
      m_duValueDuree: "9007199254740993",
      m_hTimeStart: "00:00:00.001",
      m_hTimeEnd: null,
      m_bIsTemplate: false,
      m_bEnabled: false,
    });
  });

  it.each([
    null,
    undefined,
    [],
    {},
    { IsTemplate: true },
    { IsTemplate: "false" },
    { m_bIsTemplate: 0 },
  ])(
    "rejects a source that is not strictly a non-template rule: %j",
    (source) =>
      expect(() => ruleInstanceTemplateDraft(source as RecordData)).toThrow(
        "Choose a rule that is not flagged as a template.",
      ),
  );
});
