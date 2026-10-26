import {
  canonical,
  resourceMap,
  responseKey,
  valueOf,
  type RecordData,
} from "./resources";

const configuration = new Set([
  "IDRuleType",
  "Tag",
  "Label",
  "ValueDuree",
  "ValueThreshold",
  "Level",
  "TimeStart",
  "TimeEnd",
  "Time24h",
  "ResetDelayMs",
]);

function copyConfiguration(source: RecordData): Record<string, unknown> {
  const resource = resourceMap.rules;
  const draft: Record<string, unknown> = {};
  for (const field of resource.createFields) {
    const name = canonical(field.key);
    if (!configuration.has(name)) continue;
    const value = valueOf(source, canonical(responseKey(resource, field.key)));
    if (value === undefined) continue;
    if (
      name === "IDRuleType" &&
      (typeof value !== "string" ||
        !/^[1-9]\d{0,18}$/.test(value) ||
        BigInt(value) > 9223372036854775807n)
    )
      continue;
    // Keep wire milliseconds, UTC times and multilingual label text verbatim.
    // The editor applies its existing display conversions and validation.
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

export function ruleTemplateDraft(source: RecordData): Record<string, unknown> {
  if (!hasTemplateFlag(source, true))
    throw new Error("Choose a rule flagged as a template.");
  return {
    ...copyConfiguration(source),
    m_bIsTemplate: false,
    m_bEnabled: false,
  };
}

export function ruleInstanceTemplateDraft(
  source: RecordData,
): Record<string, unknown> {
  if (!hasTemplateFlag(source, false))
    throw new Error("Choose a rule that is not flagged as a template.");
  return {
    ...copyConfiguration(source),
    m_bIsTemplate: true,
    m_bEnabled: false,
    m_nIDAsset: "0",
    m_nIDSensor: "0",
  };
}
