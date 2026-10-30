import type { Express, Request } from "express";
import type { Session } from "./sessions";
import type { createUpstream } from "./upstream";
import { ApiError, idValue } from "./wire";
import { adminBedObservations } from "./care-observations";

const invalid = () => new ApiError(400, "Check the caregiver filters.");
const quantitativeKeys = new Set([
  "page",
  "size",
  "total",
  "value",
  "flagInvalid",
  "errorCode",
  "intervalSeconds",
  "windowDays",
  "heartRate",
  "breathRate",
]);

/** The lossless upstream parser preserves IDs. Convert only declared quantities. */
export function careResponse(value: unknown, key = ""): unknown {
  if (quantitativeKeys.has(key) && value !== null) {
    if (
      !["number", "string"].includes(typeof value) ||
      !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(String(value)) ||
      !Number.isFinite(Number(value))
    )
      throw new ApiError(502, "The service returned invalid caregiver values.");
    return Number(value);
  }
  if (Array.isArray(value)) return value.map((entry) => careResponse(entry));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [
        entryKey,
        careResponse(entry, entryKey),
      ]),
    );
  return value;
}

function filters(req: Request, allowed: string[]) {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (!allowed.includes(key) || typeof value !== "string") throw invalid();
    if (key === "q") {
      if (value.length > 100 || /[\x00-\x1f]/.test(value)) throw invalid();
    } else if (["page", "size", "days", "maxPoints"].includes(key)) {
      if (!/^[1-9]\d{0,5}$/.test(value)) throw invalid();
      const n = Number(value);
      if (
        (key === "page" && n > 1000) ||
        (key === "size" && n > 100) ||
        (key === "days" && ![7, 30].includes(n)) ||
        (key === "maxPoints" && (n < 100 || n > 5000))
      )
        throw invalid();
    } else if (key === "organization") {
      result[key] = idValue(value);
      continue;
    } else if (["startDate", "endDate"].includes(key)) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value
      )
        throw invalid();
    } else if (
      !/^\d{4}-\d{2}-\d{2}T[^\s]{8,30}(?:Z|\+00:00)$/.test(value) ||
      !Number.isFinite(Date.parse(value))
    )
      throw invalid();
    result[key] = value;
  }
  if (result.startDate && result.endDate) {
    const days =
      (Date.parse(result.endDate) - Date.parse(result.startDate)) / 86400000;
    if (days < 0 || days > 30) throw invalid();
  }
  if (
    result.start &&
    result.end &&
    Date.parse(result.start) >= Date.parse(result.end)
  )
    throw invalid();
  return result;
}

export function registerCareRoutes(
  app: Express,
  upstream: ReturnType<typeof createUpstream>,
  session: (req: Request) => Session,
  observationUpstream?: ReturnType<typeof createUpstream>,
) {
  const get = (path: string, allowed: string[]) => {
    app.get(`/api/care${path}`, async (req, res) => {
      const auth = session(req);
      if (auth.identity.mustChangePassword)
        throw new ApiError(403, "Change your password before opening reports.");
      const allowedRead = (entity: string) =>
        auth.identity.level >= 90 ||
        auth.identity.permissions.some(
          (permission) =>
            permission.entity.toLowerCase() === entity &&
            permission.rights.toLowerCase().includes("r"),
        );
      if (!allowedRead("assets"))
        throw new ApiError(
          403,
          "You do not have access to caregiver subjects.",
        );
      if (
        (path.includes("/reports") || path.endsWith("/trends")) &&
        !allowedRead("sensors")
      )
        throw new ApiError(
          403,
          "You do not have permission to read subject measurements.",
        );
      const query = filters(req, allowed);
      const upstreamPath = `/v1/care${path}`.replace(
        /:(asset|report)\b/g,
        (_match, key: string) =>
          idValue((req.params as Record<string, string>)[key]),
      );
      const read = () =>
        upstream("core", upstreamPath, auth.token, {
          query,
        }).catch((error: unknown) => {
          // A missing collection route is a service/deployment failure, not a
          // missing asset. Keep individual subject/report 404s unchanged.
          if (
            path === "/subjects" &&
            error instanceof ApiError &&
            error.status === 404 &&
            error.code === "upstream_404"
          )
            throw new ApiError(
              503,
              "The caregiver service is unavailable. Contact your administrator.",
              undefined,
              "care_backend_unavailable",
            );
          throw error;
        });
      const { data } = await read();
      const response =
        observationUpstream && ["/subjects", "/subjects/:asset"].includes(path)
          ? await adminBedObservations(
              data,
              auth,
              observationUpstream,
              async () => (await read()).data,
            )
          : data;
      res.json(careResponse(response));
    });
  };
  get("/subjects", ["q", "page", "size", "organization"]);
  get("/subjects/:asset", []);
  get("/subjects/:asset/reports", ["startDate", "endDate"]);
  get("/subjects/:asset/reports/:report", []);
  get("/subjects/:asset/reports/:report/series", ["start", "end", "maxPoints"]);
  get("/subjects/:asset/trends", ["days", "startDate", "endDate"]);
}
