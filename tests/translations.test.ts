import { describe, expect, it } from "vitest";
import { translated } from "../shared/resources";
import {
  parseTranslations,
  setTranslation,
  translationLanguage,
  translationText,
} from "../shared/translations";

describe("legacy translations", () => {
  it("parses translation documents without discarding root metadata or entries", () => {
    const document = {
      version: 4,
      metadata: { source: "synthetic" },
      messages: [null, { lang: 3, text: "English" }, { unknown: true }],
    };
    expect(parseTranslations(JSON.stringify(document))).toEqual(document);
    expect(parseTranslations(document)).toBe(document);
    expect(parseTranslations('{"messages":[]}')).toEqual({ messages: [] });
  });

  it.each([
    "Plain text",
    "{",
    "null",
    "true",
    "42",
    '"JSON string"',
    "[]",
    "{}",
    '{"messages":null}',
    '{"messages":{}}',
    '{"messages":"invalid"}',
    undefined,
    null,
    false,
  ])("rejects malformed or non-document roots safely: %s", (value) => {
    expect(parseTranslations(value)).toBeUndefined();
  });

  it("rejects array roots even if they carry a messages property", () => {
    expect(
      parseTranslations(Object.assign([], { messages: [] })),
    ).toBeUndefined();
  });

  it.each([
    { token: 3, locale: "en" },
    { token: 5, locale: "fr" },
    { token: 12, locale: "nl" },
    { token: "3", locale: "en" },
    { token: "5", locale: "fr" },
    { token: "12", locale: "nl" },
    { token: " EN ", locale: "en" },
    { token: "Fr", locale: "fr" },
    { token: " nl ", locale: "nl" },
    { token: " en-GB ", locale: "en-gb" },
  ])("recognizes language $token as $locale", ({ token, locale }) => {
    const entry = { lang: token, text: `Synthetic ${locale}` };
    expect(translationLanguage(entry)).toBe(locale);
    expect(translationText(entry)).toBe(`Synthetic ${locale}`);
  });

  it.each([
    { entry: null },
    { entry: undefined },
    { entry: "en" },
    { entry: 3 },
    { entry: ["en", "English"] },
    { entry: {} },
    { entry: { lang: null } },
    { entry: { lang: {} } },
    { entry: { lang: true } },
    { entry: { lang: 2 } },
    { entry: { lang: "2" } },
    { entry: { lang: 1033 } },
    { entry: { lang: "1033" } },
    { entry: { lang: 3.5 } },
    { entry: { lang: "3.5" } },
    { entry: { lang: "" } },
  ])("does not guess malformed or unknown languages: $entry", ({ entry }) => {
    expect(translationLanguage(entry)).toBeUndefined();
  });

  it.each([
    { entry: null },
    { entry: undefined },
    { entry: "Plain entry" },
    { entry: [] },
    { entry: {} },
    { entry: { lang: 3 } },
    { entry: { text: null } },
    { entry: { text: {} } },
    { entry: { text: [] } },
    { entry: { text: 42 } },
    { entry: { text: false } },
  ])("ignores malformed message text safely: $entry", ({ entry }) => {
    expect(translationText(entry)).toBeUndefined();
  });

  it("retains empty text and accepts string text without coercing other types", () => {
    expect(translationText({ text: "" })).toBe("");
    expect(translationText({ text: "0" })).toBe("0");
  });

  it("updates every matching alias while preserving order, tokens and all other data", () => {
    const document = {
      version: 7,
      metadata: { source: "synthetic", enabled: false },
      messages: [
        { lang: 3, text: "Old numeric English", note: "first" },
        { lang: "EN", text: "Old ISO English", metadata: { id: "second" } },
        { lang: "3", text: "Old string-code English", enabled: false },
        { lang: 5, text: "Français", note: "unchanged" },
        { lang: 2, text: "Unknown language", retain: true },
        null,
        { text: "Missing language", metadata: [1, 2] },
        { lang: { invalid: true }, text: "Invalid language" },
        ["unrecognized", "entry"],
      ],
    };
    const result = JSON.parse(
      setTranslation(JSON.stringify(document), " en ", "Updated English"),
    );
    expect(result).toEqual({
      ...document,
      messages: document.messages.map((entry, index) =>
        index < 3 ? { ...entry, text: "Updated English" } : entry,
      ),
    });
  });

  it.each([
    { token: 3, language: "en" },
    { token: 5, language: "fr" },
    { token: 12, language: "nl" },
    { token: "3", language: "en" },
    { token: "5", language: "fr" },
    { token: "12", language: "nl" },
  ])(
    "preserves the original $token token when editing $language",
    ({ token, language }) => {
      const document = {
        messages: [{ lang: token, text: { invalid: true }, extra: "retained" }],
      };
      expect(
        JSON.parse(
          setTranslation(JSON.stringify(document), language, "Edited"),
        ),
      ).toEqual({
        messages: [{ lang: token, text: "Edited", extra: "retained" }],
      });
    },
  );

  it.each([
    { existing: 3, language: "fr", expected: 5 },
    { existing: 5, language: "nl", expected: 12 },
    { existing: 12, language: "en", expected: 3 },
    { existing: 2, language: "en", expected: 3 },
    { existing: "3", language: "fr", expected: "5" },
    { existing: "5", language: "nl", expected: "12" },
    { existing: "12", language: "en", expected: "3" },
    { existing: "2", language: "nl", expected: "12" },
    { existing: "en", language: "fr", expected: "fr" },
    { existing: "fr", language: "nl", expected: "nl" },
  ])(
    "appends $language using the existing $existing encoding",
    ({ existing, language, expected }) => {
      const original = { lang: existing, text: "Unchanged", metadata: true };
      expect(
        JSON.parse(
          setTranslation(
            JSON.stringify({ messages: [original] }),
            language,
            "Added",
          ),
        ),
      ).toEqual({ messages: [original, { lang: expected, text: "Added" }] });
    },
  );

  it("prefers numeric tokens for a new locale when numeric and string formats are mixed", () => {
    const messages = [
      { lang: "3", text: "English" },
      { lang: 2, text: "Unknown language" },
    ];
    expect(
      JSON.parse(setTranslation(JSON.stringify({ messages }), "fr", "French")),
    ).toEqual({ messages: [...messages, { lang: 5, text: "French" }] });
  });

  it("uses ISO language strings for a document without existing language coding", () => {
    expect(
      JSON.parse(setTranslation('{"messages":[null]}', "en", "English")),
    ).toEqual({
      messages: [null, { lang: "en", text: "English" }],
    });
  });

  it.each(["Plain text", "{", "null", "[]", "{}", '{"messages":null}'])(
    "does not replace non-translation values while editing: %s",
    (value) => {
      expect(setTranslation(value, "en", "English")).toBe(value);
    },
  );

  it("does not invent a mapping for an unknown numeric editing language", () => {
    const value = '{"messages":[{"lang":2,"text":"Unknown"}]}';
    expect(setTranslation(value, "2", "Edited")).toBe(value);
  });
});

describe("translated record labels", () => {
  it("prefers the requested legacy language regardless of message order", () => {
    const value = JSON.stringify({
      messages: [
        { lang: 5, text: "Français" },
        { lang: 3, text: "English" },
        { lang: 12, text: "Nederlands" },
      ],
    });
    expect(translated(value)).toBe("English");
    expect(translated(value, "fr")).toBe("Français");
    expect(translated(value, "nl")).toBe("Nederlands");
  });

  it("recognizes uppercase ISO and numeric-string language tokens", () => {
    for (const lang of ["EN", " en ", "3"])
      expect(
        translated(
          JSON.stringify({
            messages: [
              { lang: "fr", text: "French first" },
              { lang, text: "English preferred" },
            ],
          }),
        ),
      ).toBe("English preferred");
  });

  it("ignores malformed entries and non-string preferred text before choosing a safe fallback", () => {
    const value = JSON.stringify({
      messages: [
        null,
        { lang: {}, text: 42 },
        { lang: "en", text: { invalid: true } },
        { lang: 3 },
        { lang: 5, text: "Safe French fallback" },
      ],
    });
    expect(translated(value)).toBe("Safe French fallback");
    expect(typeof translated(value)).toBe("string");
  });

  it("retains the original document when no message has string text", () => {
    const value = JSON.stringify({
      messages: [null, { lang: null }, { lang: 3, text: false }],
    });
    expect(translated(value)).toBe(value);
  });

  it.each(["Plain text", "{", "null", "[]", "{}", '{"messages":null}'])(
    "leaves plain text and invalid translation documents unchanged: %s",
    (value) => {
      expect(translated(value)).toBe(value);
    },
  );
});
