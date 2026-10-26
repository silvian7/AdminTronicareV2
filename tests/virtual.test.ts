import { describe, expect, it } from "vitest";
import { isVirtualRecord, isVirtualTag } from "../shared/virtual";

describe("virtual tags", () => {
  it.each([
    "VIRTUAL-bedroom",
    "virtual-bedroom",
    "ViRtUaL-bedroom",
    " \tVIRTUAL-bedroom\n",
    "VIRTUAL- bedroom",
    "VIRTUAL-\nroom",
  ])("recognizes the explicit prefix with a nonblank suffix: %j", (tag) => {
    expect(isVirtualTag(tag)).toBe(true);
  });

  it.each([
    "",
    " \t\n",
    "VIRTUAL",
    "VIRTUAL-",
    "VIRTUAL- \t\n",
    "VIRTUAL bedroom",
    "VIRTUAL_bedroom",
    "VIRTUALITY-bedroom",
    "room VIRTUAL-bedroom",
    "TEST-bedroom",
    "TEST-VIRTUAL-bedroom",
    null,
    undefined,
    true,
    42,
    {},
  ])("rejects missing or different markers: %j", (tag) => {
    expect(isVirtualTag(tag)).toBe(false);
  });

  it.each([3, "3", "en", " EN "])(
    "uses the displayed English translation for language token %j",
    (lang) => {
      expect(
        isVirtualTag(
          JSON.stringify({
            messages: [
              { lang: 5, text: "Ordinary French tag" },
              { lang, text: " VIRTUAL-bedroom " },
              { lang: 12, text: "Ordinary Dutch tag" },
            ],
          }),
        ),
      ).toBe(true);
    },
  );

  it("does not use a marker in a translation that is not displayed", () => {
    expect(
      isVirtualTag(
        JSON.stringify({
          messages: [
            { lang: 5, text: "VIRTUAL-chambre" },
            { lang: 3, text: "Ordinary room" },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("retains an empty preferred translation instead of inspecting other languages", () => {
    expect(
      isVirtualTag(
        JSON.stringify({
          messages: [
            { lang: 5, text: "VIRTUAL-chambre" },
            { lang: 3, text: "" },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("uses the first readable fallback after ignoring malformed entries", () => {
    expect(
      isVirtualTag(
        JSON.stringify({
          messages: [
            null,
            { lang: 3, text: { invalid: true } },
            { lang: "en", text: 42 },
            { lang: 5, text: "VIRTUAL-chambre" },
            { lang: 12, text: "Ordinary room" },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("follows the displayed fallback even when its language code is unknown", () => {
    expect(
      isVirtualTag(
        JSON.stringify({
          messages: [
            { lang: 1033, text: "Ordinary fallback" },
            { lang: 5, text: "VIRTUAL-chambre" },
          ],
        }),
      ),
    ).toBe(false);
  });

  it.each([
    "{",
    "[]",
    '{"messages":null}',
    '{"messages":[null,{"lang":3,"text":false}]}',
  ])("handles malformed translation documents safely: %j", (value) => {
    expect(isVirtualTag(value)).toBe(false);
  });
});

describe("virtual records", () => {
  it("recognizes canonical and API-prefixed Tag fields", () => {
    expect(isVirtualRecord({ Tag: "VIRTUAL-room" })).toBe(true);
    expect(isVirtualRecord({ m_sTag: "virtual-room" })).toBe(true);
  });

  it("follows canonical field precedence when aliases conflict", () => {
    expect(
      isVirtualRecord({ Tag: "Ordinary room", m_sTag: "VIRTUAL-room" }),
    ).toBe(false);
    expect(
      isVirtualRecord({ Tag: "VIRTUAL-room", m_sTag: "Ordinary room" }),
    ).toBe(true);
  });

  it("never derives virtual status from Label or a TEST tag", () => {
    expect(
      isVirtualRecord({ m_sTag: "TEST-room", m_sLabel: "VIRTUAL-room" }),
    ).toBe(false);
    expect(isVirtualRecord({ Label: "VIRTUAL-room" })).toBe(false);
  });

  it.each([null, undefined, {}, { Tag: null }, { m_sTag: "" }])(
    "handles missing records and tags: %j",
    (record) => {
      expect(isVirtualRecord(record)).toBe(false);
    },
  );
});
