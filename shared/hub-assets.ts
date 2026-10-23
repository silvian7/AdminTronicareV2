import { valueOf, type RecordData } from "./resources";

function referenceId(value: unknown): string {
  return typeof value === "string"
    ? value
    : typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : "";
}

function positiveId(id: string): boolean {
  return /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;
}

export function linkedHubAssetIds(
  hub: RecordData,
  devices: readonly RecordData[],
): string[] {
  const hubId = referenceId(hub.id);
  const organization = referenceId(valueOf(hub, "IDOrganization"));
  if (!positiveId(hubId) || !(organization === "0" || positiveId(organization)))
    return [];
  const assets = new Set<string>();
  const assigned = referenceId(valueOf(hub, "IDAsset"));
  if (positiveId(assigned)) assets.add(assigned);
  for (const device of devices) {
    const asset = referenceId(valueOf(device, "IDAsset"));
    if (
      referenceId(valueOf(device, "IDHub")) === hubId &&
      referenceId(valueOf(device, "IDOrganization")) === organization &&
      positiveId(asset)
    )
      assets.add(asset);
  }
  return [...assets].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
}
