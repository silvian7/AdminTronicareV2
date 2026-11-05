import { valueOf, type RecordData } from "./resources";

export type HubRegistrationDraft =
  | { state: "absent" }
  | { state: "invalid" }
  | { state: "valid"; hubKind: string; serialNumber: string };

const validIdentity = (value: string | null): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 256 &&
  [...value].length <= 128 &&
  !/[\u0000-\u001f]/.test(value);

export function hubRegistrationPath(hub: {
  hubKind: string;
  serialNumber: string;
}): string {
  return `/hubs/new?${new URLSearchParams({
    hubKind: hub.hubKind,
    serialNumber: hub.serialNumber,
  })}`;
}

export function readHubRegistration(
  params: URLSearchParams,
): HubRegistrationDraft {
  if (!params.has("hubKind") && !params.has("serialNumber"))
    return { state: "absent" };
  const hubKind = params.get("hubKind");
  const serialNumber = params.get("serialNumber");
  if (
    params.getAll("hubKind").length !== 1 ||
    params.getAll("serialNumber").length !== 1 ||
    !validIdentity(hubKind) ||
    !validIdentity(serialNumber)
  )
    return { state: "invalid" };
  return { state: "valid", hubKind, serialNumber };
}

export type HubTypeMatch =
  | { state: "matched"; id: string }
  | { state: "unavailable" | "missing" | "ambiguous" };

/** Only a complete catalog can establish a unique exact kind. */
export function matchRegistrationHubType(
  input: unknown,
  kind: string,
): HubTypeMatch {
  if (!input || typeof input !== "object") return { state: "unavailable" };
  const catalog = input as Record<string, unknown>;
  if (
    !Array.isArray(catalog.data) ||
    catalog.limited !== false ||
    !Number.isSafeInteger(catalog.total) ||
    catalog.total !== catalog.data.length ||
    catalog.data.some(
      (row) => !row || typeof row !== "object" || Array.isArray(row),
    )
  )
    return { state: "unavailable" };
  const matches = (catalog.data as RecordData[]).filter(
    (row) => valueOf(row, "Kind") === kind,
  );
  if (!matches.length) return { state: "missing" };
  if (matches.length !== 1) return { state: "ambiguous" };
  const id = matches[0].id;
  return typeof id === "string" &&
    /^[1-9]\d{0,18}$/.test(id) &&
    BigInt(id) <= 9223372036854775807n
    ? { state: "matched", id }
    : { state: "unavailable" };
}
