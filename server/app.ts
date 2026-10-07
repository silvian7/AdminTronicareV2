import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createHash, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  resourceMap,
  services,
  canAccess,
  canonical,
  valueOf,
  type Identity,
  type Operation,
  type Resource,
  type RecordData,
} from "../shared/resources";
import type { Config } from "./config";
import { createUpstream, type Transport } from "./upstream";
import { createAuthorization, parseRoleLevel } from "./authorization";
import {
  ApiError,
  publicRecord,
  writeBody,
  idValue,
  validateValue,
} from "./wire";
import {
  sessionId,
  setSessionCookie,
  newSessionId,
  type Session,
  type SessionStore,
} from "./sessions";

interface AuthRequest extends Request {
  session: Session;
  sessionId: string;
}
const text = (v: unknown, max = 128) => {
  if (typeof v !== "string" || v.length > max || v.includes("\0"))
    throw new ApiError(400, "Check the supplied values.");
  return v;
};
export const passwordDigest = (password: string, salt: string) =>
  createHash("sha256")
    .update(salt + password, "utf8")
    .digest("hex")
    .toUpperCase();

export function createApp(
  config: Config,
  store: SessionStore,
  transport?: Transport,
) {
  const app = express();
  const upstream = createUpstream(config, transport);
  const authorization = createAuthorization(upstream);
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.cookieSecure ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: config.cookieSecure ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "128kb" }));
  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (_req, res) => {
    const ready = await store.healthy();
    res
      .status(ready ? 200 : 503)
      .json({ status: ready ? "ready" : "unavailable" });
  });
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        req.headers.origin !== config.publicOrigin ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        throw new ApiError(403, "The request origin is not allowed.");
    }
    next();
  });
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Too many attempts. Please try again later." },
  });
  app.post("/api/session/login", loginLimiter, async (req, res) => {
    const login = text(req.body.login, 50).trim();
    const password = text(req.body.password, 512);
    if (!login || !password)
      throw new ApiError(400, "Enter your login and password.");
    const credential =
      req.body.mode === "code"
        ? text(password, 100).trim().toUpperCase()
        : passwordDigest(password, config.passwordSalt);
    const { data } = await upstream(
      "users",
      "/v1/usersadmin/connect",
      undefined,
      {
        query: {
          login,
          password: credential,
          version: "2.0",
          agent: "Tronicare Admin V2",
        },
      },
    );
    const result = data as Record<string, unknown>;
    if (
      result?.status !== true ||
      typeof result.token !== "string" ||
      result.token === "null" ||
      !/^[!-~]{1,4096}$/.test(result.token) ||
      !Array.isArray(result.authorizations)
    )
      throw new ApiError(401, "The login or password is incorrect.");
    const level = parseRoleLevel(result.usertypelevel);
    if (level === null)
      throw new ApiError(502, "The service returned an invalid account role.");
    const identity: Identity = {
      id: idValue(result.iduser),
      name:
        [result.firstname, result.lastname].filter(Boolean).join(" ") || login,
      organizationId: String(result.idorganization ?? "0"),
      userTypeId: String(result.idusertype ?? "0"),
      level,
      permissions: result.authorizations.filter(
        (p): p is { entity: string; rights: string } =>
          !!p &&
          typeof p === "object" &&
          typeof p.entity === "string" &&
          typeof p.rights === "string",
      ),
      mustChangePassword: result.onetimepwd === true,
    };
    const previous = sessionId(req, config);
    if (previous) await store.delete(previous);
    const id = newSessionId();
    const session: Session = {
      token: result.token,
      identity,
      csrf: newSessionId(),
      expiresAt: Date.now() + 3540_000,
    };
    await store.set(id, session);
    setSessionCookie(res, config, id);
    res.json({ identity, csrf: session.csrf, expiresAt: session.expiresAt });
  });
  app.post("/api/session/recover", loginLimiter, async (req, res) => {
    const login = text(req.body.login, 50).trim();
    if (!login) throw new ApiError(400, "Enter your login.");
    try {
      await upstream("users", "/v1/usersadmin/reqnewpwd", undefined, {
        query: { login },
      });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500) throw e;
    }
    res.json({
      message: "If the account exists, a password code has been requested.",
    });
  });
  app.use("/api", async (req, res, next) => {
    const id = sessionId(req, config);
    const session = id ? await store.get(id) : null;
    if (!session || session.expiresAt <= Date.now()) {
      setSessionCookie(res, config);
      throw new ApiError(401, "Your session has expired. Sign in again.");
    }
    Object.assign(req, { session, sessionId: id });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const csrf = req.headers["x-csrf-token"];
      if (
        typeof csrf !== "string" ||
        csrf.length !== session.csrf.length ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf))
      )
        throw new ApiError(403, "The session check failed. Reload the page.");
    }
    next();
  });
  app.get("/api/session", (req, res) => {
    const { session } = req as AuthRequest;
    res.json({
      identity: session.identity,
      csrf: session.csrf,
      expiresAt: session.expiresAt,
      services: Object.fromEntries(
        services.map((s) => [
          s,
          {
            configured: !!config.origins[s],
            writable: config.enabledWrites.has(s),
          },
        ]),
      ),
    });
  });
  app.post("/api/session/logout", async (req, res) => {
    const r = req as AuthRequest;
    await store.delete(r.sessionId);
    setSessionCookie(res, config);
    // Local logout always succeeds, even when legacy revocation is temporarily unavailable.
    try {
      await upstream("users", "/v1/usersadmin/disconnect", r.session.token);
    } catch {
      /* No sensitive logging. */
    }
    res.json({ success: true });
  });
  app.post("/api/session/password", async (req, res) => {
    const r = req as AuthRequest;
    const password = text(req.body.password, 512);
    if (password.length < 12)
      throw new ApiError(422, "Use at least 12 characters.", {
        password: "Use at least 12 characters.",
      });
    await upstream("users", "/v1/usersadmin/changepassword", r.session.token, {
      query: { password: passwordDigest(password, config.passwordSalt) },
    });
    const updated = {
      ...r.session,
      identity: { ...r.session.identity, mustChangePassword: false },
    };
    if (!(await store.update(r.sessionId, updated))) {
      setSessionCookie(res, config);
      throw new ApiError(401, "Your session has expired. Sign in again.");
    }
    res.json({ success: true });
  });
  function requirePermission(
    req: Request,
    resource: Resource,
    operation: Operation,
  ) {
    const r = req as AuthRequest;
    if (!canAccess(r.session.identity, resource.name, operation))
      throw new ApiError(403, "You do not have permission for this operation.");
    if (
      !["list", "show"].includes(operation) &&
      !config.enabledWrites.has(resource.service)
    )
      throw new ApiError(503, "Changes to this service are currently paused.");
    return r;
  }
  const route = (resource: Resource, op: Operation, id?: string) => {
    const path = resource.routes[op];
    if (!path) throw new ApiError(405, "This operation is unavailable.");
    return id ? path.replace(/\{[^}]+\}/, idValue(id)) : path;
  };
  const getResource = (req: Request) => {
    const resource = resourceMap[String(req.params.resource)];
    if (!resource) throw new ApiError(404, "Resource not found.");
    return resource;
  };
  app.get("/api/resources/:resource", async (req, res) => {
    const resource = getResource(req);
    const r = requirePermission(req, resource, "list");
    const query: Record<string, string> = {};
    for (const field of resource.query) {
      const value = req.query[field.key];
      if (value !== undefined && value !== "") {
        const raw = text(value, 8192);
        try {
          validateValue(
            { ...field, type: field.type === "integer" ? "integer" : "string" },
            raw,
          );
        } catch {
          throw new ApiError(400, `Check the ${field.key} filter.`);
        }
        query[field.key] = raw;
      }
    }
    if (resource.query.some((f) => f.key === "limit")) query.limit = "10000";
    const organization =
      typeof req.query._organization === "string"
        ? req.query._organization
        : undefined;
    if (organization && resource.query.some((f) => f.key === "idorganization"))
      query.idorganization = organization;
    if (
      !(r.session.identity.level >= 90) &&
      ["users", "usergroups"].includes(resource.name)
    )
      query.idorganization = r.session.identity.organizationId;
    const { data } = await upstream(
      resource.service,
      route(resource, "list"),
      r.session.token,
      { query },
    );
    if (!Array.isArray(data))
      throw new ApiError(502, "The service did not return a list.");
    let limited = data.length >= 10000;
    let records = await authorization.scopeRecords(
      r.session,
      resource,
      data.map((row) => publicRecord(resource, row)),
    );
    if (
      typeof organization === "string" &&
      organization &&
      resource.fields.some((f) => canonical(f.key) === "IDOrganization")
    )
      records = records.filter(
        (row) => valueOf(row, "IDOrganization") === organization,
      );
    else if (
      organization &&
      resource.fields.some((f) => canonical(f.key) === "IDAsset")
    ) {
      const assetResult = await upstream(
        "assets",
        "/v1/assets",
        r.session.token,
        { query: { idorganization: organization, limit: "10000" } },
      );
      if (!Array.isArray(assetResult.data))
        throw new ApiError(502, "Organization assets could not be checked.");
      const assets = assetResult.data as RecordData[];
      limited ||= assets.length >= 10000;
      const ids = new Set(
        assets
          .filter((row) => row.m_nIDOrganization === organization)
          .map((row) => row.m_nIDAsset),
      );
      records = records.filter(
        (row) => row.m_bIsTemplate === true || ids.has(valueOf(row, "IDAsset")),
      );
    }
    const search =
      typeof req.query._q === "string"
        ? req.query._q.toLowerCase().slice(0, 200)
        : "";
    if (search)
      records = records.filter((row) =>
        Object.values(row).some(
          (v) => typeof v === "string" && v.toLowerCase().includes(search),
        ),
      );
    const sort =
      typeof req.query._sort === "string"
        ? req.query._sort
        : resource.primaryKey;
    if (resource.fields.some((f) => f.key === sort))
      records.sort((a, b) => {
        const av = String(a[sort] ?? ""),
          bv = String(b[sort] ?? "");
        const n =
          /^-?\d+$/.test(av) && /^-?\d+$/.test(bv)
            ? BigInt(av) < BigInt(bv)
              ? -1
              : BigInt(av) > BigInt(bv)
                ? 1
                : 0
            : av.localeCompare(bv);
        return n * (req.query._order === "desc" ? -1 : 1);
      });
    const size = Math.min(
      10000,
      Math.max(1, Number(req.query._pageSize) || 25),
    );
    const page = Math.max(1, Number(req.query._page) || 1);
    res.json({
      data: records.slice((page - 1) * size, page * size),
      total: records.length,
      limited,
    });
  });
  app.get("/api/resources/:resource/:id", async (req, res) => {
    const resource = getResource(req);
    const r = requirePermission(req, resource, "show");
    const { data } = await upstream(
      resource.service,
      route(resource, "show", String(req.params.id)),
      r.session.token,
    );
    const record = publicRecord(resource, data);
    if (record.id !== String(req.params.id))
      throw new ApiError(403, "This record is outside your access.");
    if (
      !(await authorization.scopeRecords(r.session, resource, [record])).length
    )
      throw new ApiError(403, "This record is outside your access.");
    res.json({ data: record });
  });
  app.post("/api/resources/:resource", async (req, res) => {
    const resource = getResource(req);
    const r = requirePermission(req, resource, "create");
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
      throw new ApiError(400, "An object is required.");
    await authorization.checkWriteScope(r.session, resource, req.body);
    const { data } = await upstream(
      resource.service,
      route(resource, "create"),
      r.session.token,
      { method: "POST", body: writeBody(resource, req.body, "create") },
    );
    res.json({ data: publicRecord(resource, data) });
  });
  app.put("/api/resources/:resource/:id", async (req, res) => {
    const resource = getResource(req);
    const r = requirePermission(req, resource, "edit");
    const id = String(req.params.id);
    const old = await upstream(
      resource.service,
      route(resource, "show", id),
      r.session.token,
    );
    const previous = publicRecord(resource, old.data);
    if (previous.id !== id)
      throw new ApiError(403, "This record is outside your access.");
    if (
      !(await authorization.scopeRecords(r.session, resource, [previous]))
        .length
    )
      throw new ApiError(403, "This record is outside your access.");
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
      throw new ApiError(400, "An object is required.");
    await authorization.checkWriteScope(
      r.session,
      resource,
      req.body,
      previous,
    );
    const { data } = await upstream(
      resource.service,
      route(resource, "edit", id),
      r.session.token,
      { method: "PUT", body: writeBody(resource, req.body, "edit") },
    );
    res.json({ data: publicRecord(resource, data) });
  });
  app.delete("/api/resources/:resource/:id", async (req, res) => {
    const resource = getResource(req);
    const r = requirePermission(req, resource, "delete");
    const id = String(req.params.id);
    const old = await upstream(
      resource.service,
      route(resource, "show", id),
      r.session.token,
    );
    const previous = publicRecord(resource, old.data);
    if (previous.id !== id)
      throw new ApiError(403, "This record is outside your access.");
    if (
      !(await authorization.scopeRecords(r.session, resource, [previous]))
        .length
    )
      throw new ApiError(403, "This record is outside your access.");
    await authorization.checkWriteScope(r.session, resource, {}, previous);
    await upstream(
      resource.service,
      route(resource, "delete", id),
      r.session.token,
      { method: "DELETE" },
    );
    res.json({ data: { id } });
  });
  app.post("/api/memberships", async (req, res) => {
    const r = requirePermission(req, resourceMap.users, "edit");
    if (r.session.identity.mustChangePassword)
      throw new ApiError(403, "Change your password first.");
    const user = idValue(req.body.userId),
      group = idValue(req.body.groupId);
    if (!["add", "remove"].includes(req.body.action))
      throw new ApiError(400, "Unknown membership operation.");
    for (const [name, id] of [
      ["users", user],
      ["usergroups", group],
    ]) {
      const resource = resourceMap[name];
      const record = await authorization.read(r.session, name, id);
      if (
        !(await authorization.scopeRecords(r.session, resource, [record]))
          .length
      )
        throw new ApiError(
          403,
          "This membership is outside your organization.",
        );
      if (name === "users") await authorization.protectUser(r.session, record);
    }
    await upstream(
      "users",
      `/v1/users2usergroups/${req.body.action === "add" ? "addlink" : "removelink"}`,
      r.session.token,
      { query: { iduser: user, idusergroup: group } },
    );
    res.json({ success: true });
  });
  app.get("/api/history", async (req, res) => {
    const r = requirePermission(req, resourceMap.sensors, "list");
    const query: Record<string, string> = { limit: "100", filter: "1" };
    for (const key of [
      "idsensor",
      "idasset",
      "dhstart",
      "dhend",
      "afterevent",
      "afterid",
      "highwaterid",
      "snapshot",
      "filter",
    ]) {
      if (req.query[key] !== undefined && req.query[key] !== "")
        query[key] = text(req.query[key], key === "snapshot" ? 4096 : 128);
    }
    if (!query.idsensor && !query.idasset)
      throw new ApiError(400, "Choose a sensor or asset.");
    let historyAssets: Set<string> | undefined;
    if (!(r.session.identity.level >= 90)) {
      historyAssets = await authorization.visibleAssets(r.session);
      if (query.idasset && !historyAssets.has(idValue(query.idasset)))
        throw new ApiError(403, "This history is outside your access.");
      if (query.idsensor) {
        const sensor = await authorization.read(
          r.session,
          "sensors",
          query.idsensor,
        );
        const asset = String(valueOf(sensor, "IDAsset") ?? "");
        if (
          !historyAssets.has(asset) ||
          (query.idasset && query.idasset !== asset)
        )
          throw new ApiError(403, "This history is outside your access.");
      }
    }
    const { data, headers } = await upstream(
      "core",
      "/v1/sensorshistory",
      r.session.token,
      { query },
    );
    if (!Array.isArray(data))
      throw new ApiError(502, "History was not returned as a list.");
    const records = historyAssets
      ? data.filter(
          (row) =>
            row &&
            typeof row === "object" &&
            !Array.isArray(row) &&
            historyAssets.has(String(valueOf(row, "IDAsset"))) &&
            (!query.idasset ||
              String(valueOf(row, "IDAsset")) === query.idasset) &&
            (!query.idsensor ||
              String(valueOf(row, "IDSensor")) === query.idsensor),
        )
      : data;
    res.json({
      data: records,
      highWaterId: headers.get("X-Tronicare-History-High-Water-Id"),
      snapshot: headers.get("X-Tronicare-History-Snapshot"),
      hasMore: data.length === 100,
    });
  });
  app.get("/api/services", async (req, res) => {
    const r = req as AuthRequest;
    if (!(r.session.identity.level >= 90))
      throw new ApiError(
        403,
        "Service status is available to platform administrators.",
      );
    const results = await Promise.all(
      services.map(async (service) => {
        if (!config.origins[service]) return { service, state: "unconfigured" };
        try {
          const { data } = await upstream(
            service,
            `/v1/${service}admin/info`,
            r.session.token,
          );
          const info = (data ?? {}) as Record<string, unknown>;
          return {
            service,
            state: "available",
            version: info.Engine_Version ?? info.version ?? "",
            lastHeartbeat: info.Engine_Lastheartbeat ?? null,
          };
        } catch (e) {
          return {
            service,
            state: "unavailable",
            message: e instanceof ApiError ? e.message : "Unavailable",
          };
        }
      }),
    );
    res.json({ data: results });
  });
  app.use("/api", (_req, _res, next) =>
    next(new ApiError(404, "API route not found.")),
  );
  const client = resolve("dist/client");
  if (existsSync(client)) {
    app.use(express.static(client, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(resolve(client, "index.html"));
    });
  }
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(
              error instanceof SyntaxError ? 400 : 500,
              error instanceof SyntaxError
                ? "Invalid JSON request."
                : "The request could not be completed.",
            );
      res.status(apiError.status).json({
        message: apiError.message,
        errors: apiError.fields,
        code: apiError.code,
      });
    },
  );
  return app;
}
