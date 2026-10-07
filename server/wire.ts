import {
  parse,
  stringify,
  LosslessNumber,
  isLosslessNumber,
} from "lossless-json";
import {
  hiddenField,
  editableFields,
  type Resource,
  type Field,
  type RecordData,
} from "../shared/resources";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
    public code?: string,
  ) {
    super(message);
  }
}
export function parseWire(text: string): unknown {
  const visit = (v: unknown): unknown => {
    if (isLosslessNumber(v)) return v.toString();
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, visit(x)]),
      );
    return v;
  };
  try {
    return text.trim() ? visit(parse(text)) : null;
  } catch {
    throw new ApiError(502, "The service returned an invalid response.");
  }
}
export function publicRecord(resource: Resource, value: unknown): RecordData {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(502, "The service returned an unexpected record.");
  const record = value as RecordData;
  const id = record[resource.primaryKey];
  if (typeof id !== "string" || !/^-?\d+$/.test(id))
    throw new ApiError(
      502,
      "The service returned a record without a valid ID.",
    );
  return {
    ...Object.fromEntries(
      resource.fields
        .filter((f) => !hiddenField(f.key) && f.key in record)
        .map((f) => [f.key, record[f.key]]),
    ),
    id,
  };
}
export function validateValue(field: Field, value: unknown): unknown {
  if (value === null && field.nullable) return null;
  if (field.type === "boolean") {
    if (typeof value !== "boolean") throw new Error("Choose yes or no.");
    return value;
  }
  if (field.type === "integer" || field.type === "number") {
    if (typeof value !== "string" && typeof value !== "number")
      throw new Error("Enter a number.");
    const raw = String(value);
    if (field.type === "integer") {
      if (!/^-?\d+$/.test(raw)) throw new Error("Enter a whole number.");
      if (typeof value === "number" && !Number.isSafeInteger(value))
        throw new Error("Use an exact decimal string for this number.");
      const n = BigInt(raw);
      if (
        n < BigInt(field.minimum ?? "-9223372036854775808") ||
        n > BigInt(field.maximum ?? "9223372036854775807")
      )
        throw new Error("This number is outside the allowed range.");
    } else if (
      !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw) ||
      !Number.isFinite(Number(raw))
    )
      throw new Error("Enter a finite decimal number.");
    if (field.enum && !field.enum.some((x) => String(x) === raw))
      throw new Error("Choose a supported value.");
    return new LosslessNumber(raw);
  }
  if (typeof value !== "string" || value.includes("\0"))
    throw new Error("Enter valid text.");
  if (value.length > (field.maxLength ?? 65536))
    throw new Error(`Use at most ${field.maxLength ?? 65536} characters.`);
  if (field.pattern && !new RegExp(field.pattern).test(value))
    throw new Error("Check the format.");
  return value;
}
export function writeBody(
  resource: Resource,
  input: unknown,
  mode: "create" | "edit",
): string {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiError(400, "An object is required.");
  const allowed = editableFields(resource, mode);
  const errors: Record<string, string> = {};
  const out: Record<string, unknown> = {};
  for (const field of allowed)
    if (field.required && !(field.key in input))
      errors[field.key] = "This field is required.";
  for (const [key, value] of Object.entries(input)) {
    const field = allowed.find((f) => f.key === key);
    if (!field) {
      errors[key] = "This field cannot be changed here.";
      continue;
    }
    try {
      out[key] = validateValue(field, value);
    } catch (e) {
      errors[key] = (e as Error).message;
    }
  }
  if (Object.keys(errors).length)
    throw new ApiError(422, "Please correct the highlighted fields.", errors);
  if (!Object.keys(out).length) throw new ApiError(422, "No changes to save.");
  return stringify(out)!;
}
export function idValue(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d{0,18}$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    throw new ApiError(400, "Invalid record ID.");
  return value;
}
