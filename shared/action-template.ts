import {
  canonical,
  resourceMap,
  responseKey,
  valueOf,
  type RecordData,
} from "./resources";

const configuration = new Set([
  "IDActionType",
  "Level",
  "Tag",
  "Label",
  "Recipient",
  "SubjectText",
  "BodyText",
]);

function copyConfiguration(source: RecordData): Record<string, unknown> {
  const resource = resourceMap.actions;
  const draft: Record<string, unknown> = {};
  for (const field of resource.createFields) {
    const name = canonical(field.key);
    if (!configuration.has(name)) continue;
    const value = valueOf(source, canonical(responseKey(resource, field.key)));
    if (value === undefined) continue;
    if (
      name === "IDActionType" &&
      (typeof value !== "string" ||
        !/^[1-9]\d{0,18}$/.test(value) ||
        BigInt(value) > 9223372036854775807n)
    )
      continue;
    // Preserve all configured text, including untranslated multilingual JSON.
    draft[field.key] = value;
  }
  return draft;
}

function hasTemplateFlag(source: RecordData, flag: boolean): boolean {
  return (
    !!source &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    valueOf(source, "IsTemplate") === flag
  );
}

export function actionTemplateDraft(
  source: RecordData,
): Record<string, unknown> {
  if (!hasTemplateFlag(source, true))
    throw new Error("Choose an action flagged as a template.");
  return {
    ...copyConfiguration(source),
    m_bIsTemplate: false,
    m_bEnabled: false,
  };
}

export function actionInstanceTemplateDraft(
  source: RecordData,
): Record<string, unknown> {
  if (!hasTemplateFlag(source, false))
    throw new Error("Choose an action that is not flagged as a template.");
  return {
    ...copyConfiguration(source),
    m_bIsTemplate: true,
    m_bEnabled: false,
    m_nIDRule: "0",
    m_nIDAsset: "0",
  };
}
