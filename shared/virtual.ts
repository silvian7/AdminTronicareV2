import { translated, valueOf, type RecordData } from "./resources";

export function isVirtualTag(value: unknown): boolean {
  return /^VIRTUAL-\s*\S/i.test(translated(value).trim());
}

export function isVirtualRecord(
  record: RecordData | null | undefined,
): boolean {
  return record != null && isVirtualTag(valueOf(record, "Tag"));
}
