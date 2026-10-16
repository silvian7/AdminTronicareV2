type TranslationDocument = Record<string, unknown> & { messages: unknown[] };

const legacyLanguages: ReadonlyMap<string, string> = new Map([
  ["3", "en"],
  ["5", "fr"],
  ["12", "nl"],
]);
const legacyCodes: ReadonlyMap<string, number> = new Map([
  ["en", 3],
  ["fr", 5],
  ["nl", 12],
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTranslations(
  value: unknown,
): TranslationDocument | undefined {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return isObject(parsed) && Array.isArray(parsed.messages)
    ? (parsed as TranslationDocument)
    : undefined;
}

export function translationLanguage(entry: unknown): string | undefined {
  if (!isObject(entry)) return undefined;
  if (typeof entry.lang === "number")
    return legacyLanguages.get(String(entry.lang));
  if (typeof entry.lang !== "string") return undefined;
  const language = entry.lang.trim().toLowerCase();
  const legacy = legacyLanguages.get(language);
  if (legacy) return legacy;
  return language &&
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/.test(language)
    ? language
    : undefined;
}

export function translationText(entry: unknown): string | undefined {
  return isObject(entry) && typeof entry.text === "string"
    ? entry.text
    : undefined;
}

export function setTranslation(
  value: string,
  language: string,
  text: string,
): string {
  const document = parseTranslations(value);
  const target = translationLanguage({ lang: language });
  if (!document || !target) return value;
  let matched = false;
  let numericLanguages = false;
  let numericStringLanguages = false;
  const messages = document.messages.map((entry) => {
    if (!isObject(entry)) return entry;
    if (
      typeof entry.lang === "number" &&
      Number.isSafeInteger(entry.lang) &&
      entry.lang > 0
    )
      numericLanguages = true;
    if (typeof entry.lang === "string" && /^[1-9]\d*$/.test(entry.lang.trim()))
      numericStringLanguages = true;
    if (translationLanguage(entry) !== target) return entry;
    matched = true;
    return { ...entry, text };
  });
  if (!matched) {
    const code = legacyCodes.get(target);
    const lang =
      code !== undefined && numericLanguages
        ? code
        : code !== undefined && numericStringLanguages
          ? String(code)
          : target;
    messages.push({ lang, text });
  }
  return JSON.stringify({ ...document, messages });
}
