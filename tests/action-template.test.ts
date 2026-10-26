import { describe, expect, it } from "vitest";
import {
  actionInstanceTemplateDraft,
  actionTemplateDraft,
} from "../shared/action-template";
import type { RecordData } from "../shared/resources";

const directions = [
  [
    "instance from template",
    true,
    actionTemplateDraft,
    { m_bIsTemplate: false, m_bEnabled: false },
  ],
  [
    "template from instance",
    false,
    actionInstanceTemplateDraft,
    { m_bIsTemplate: true, m_bEnabled: false, m_nIDRule: "0", m_nIDAsset: "0" },
  ],
] as const;

describe.each(directions)(
  "action %s",
  (_name, sourceFlag, createDraft, flags) => {
    it("preserves raw configuration and severity while excluding ownership, history and unknown fields", () => {
      const configuration = {
        m_nIDActionType: "9223372036854775807",
        m_nLevel: "3",
        m_sTag: "Reusable action",
        m_sLabel:
          '[ {"lang":1033,"text":"Action"}, {"lang":"fr","text":"Alerte"} ]',
        m_sRecipient: "  synthetic-recipient@example.invalid  ",
        m_sSubjectText:
          '[{"lang":"en","text":"Subject %ASSETTAG"},{"lang":"nl","text":"Onderwerp"}]',
        m_sBodyText: "First line\n%ASSETTAG\nSecond line",
      };
      const source = Object.freeze({
        ...configuration,
        id: "9223372036854775806",
        m_nIDAction: "9223372036854775806",
        m_nIDRule: "9223372036854775805",
        m_nIDAsset: "9223372036854775804",
        m_sAssetTag: "Source asset",
        m_bEnabled: true,
        m_bIsTemplate: sourceFlag,
        m_nIDActionForward: "9223372036854775803",
        m_bProcessed: true,
        m_bResultSuccess: true,
        m_bResultError: true,
        m_nForwardTries: "4",
        m_bForwardFailed: true,
        m_dhDhForwarded: "2026-10-26T10:00:00.000",
        m_dhDhTimeoutForwarded: "2026-10-26T10:00:00.000",
        m_dhDhProcessed: "2026-10-26T10:00:00.000",
        m_dhDhResult: "2026-10-26T10:00:00.000",
        m_bIsRead: true,
        m_bIsAck: true,
        m_bIsArchive: true,
        m_bIsDeleted: true,
        futureUnknownSetting: "Not implicitly copied",
        history: [{ id: "1" }],
      });
      const before = structuredClone(source);
      const draft = createDraft(source);
      expect(draft).toEqual({ ...configuration, ...flags });
      expect(source).toEqual(before);
      draft.m_sRecipient = "a-different-recipient@example.invalid";
      expect(source.m_sRecipient).toBe(configuration.m_sRecipient);
      expect(source.m_bIsTemplate).toBe(sourceFlag);
      expect(source.m_bEnabled).toBe(true);
    });

    it("accepts canonical response aliases and returns canonical API write keys", () => {
      expect(
        createDraft({
          IsTemplate: sourceFlag,
          Enabled: true,
          IDActionType: "9007199254740993",
          IDAction: "11",
          IDRule: "12",
          IDAsset: "13",
          Level: "2",
          Tag: "Canonical tag",
          Label: "Canonical label",
          Recipient: "canonical@example.invalid",
          SubjectText: "Canonical subject",
          BodyText: "Canonical body",
          Processed: true,
        }),
      ).toEqual({
        m_nIDActionType: "9007199254740993",
        m_nLevel: "2",
        m_sTag: "Canonical tag",
        m_sLabel: "Canonical label",
        m_sRecipient: "canonical@example.invalid",
        m_sSubjectText: "Canonical subject",
        m_sBodyText: "Canonical body",
        ...flags,
      });
    });

    it("preserves empty configured strings rather than inventing defaults", () => {
      expect(
        createDraft({
          IsTemplate: sourceFlag,
          Label: "",
          Recipient: "",
          SubjectText: "",
          BodyText: "",
        }),
      ).toEqual({
        m_sLabel: "",
        m_sRecipient: "",
        m_sSubjectText: "",
        m_sBodyText: "",
        ...flags,
      });
      expect(
        createDraft({ IsTemplate: sourceFlag, IDRule: "7", IDAsset: "8" }),
      ).toEqual(flags);
    });

    it.each(["1", "9007199254740993", "9223372036854775807"])(
      "keeps exact positive ActionType ID %s",
      (id) => {
        expect(
          createDraft({ IsTemplate: sourceFlag, IDActionType: id })
            .m_nIDActionType,
        ).toBe(id);
      },
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
    ])("omits invalid or inexact ActionType reference %j", (id) =>
      expect(
        createDraft({
          IsTemplate: sourceFlag,
          IDActionType: id,
          Tag: "Valid config",
        }),
      ).toEqual({ m_sTag: "Valid config", ...flags }),
    );

    it.each([
      null,
      undefined,
      [],
      {},
      { IsTemplate: "true" },
      { IsTemplate: "false" },
      { IsTemplate: 0 },
      { IsTemplate: 1 },
    ])(
      "rejects a source without an explicit boolean template flag: %j",
      (source) =>
        expect(() => createDraft(source as RecordData)).toThrow(
          /Choose an action/,
        ),
    );

    it("rejects the opposite source direction", () => {
      expect(() => createDraft({ IsTemplate: !sourceFlag })).toThrow(
        /Choose an action/,
      );
    });
  },
);

it("can reuse the new template for a fresh disabled action without restoring the original rule or asset", () => {
  const configuration = {
    m_nIDActionType: "9223372036854775807",
    m_nLevel: "3",
    m_sLabel: '[{"lang":1033,"text":"Reusable"}]',
    m_sRecipient: "synthetic@example.invalid",
    m_sSubjectText: "Same subject",
    m_sBodyText: "Same body",
  };
  const template = actionInstanceTemplateDraft({
    ...configuration,
    m_bIsTemplate: false,
    m_bEnabled: true,
    m_nIDAction: "7",
    m_nIDRule: "8",
    m_nIDAsset: "9",
    m_bProcessed: true,
  });
  expect(actionTemplateDraft(template)).toEqual({
    ...configuration,
    m_bIsTemplate: false,
    m_bEnabled: false,
  });
});
