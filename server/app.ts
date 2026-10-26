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
import { LosslessNumber, stringify } from "lossless-json";
import {
  resourceMap,
  assetAssignmentRoutes,
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
import { hubLastEventTime } from "../shared/hub-status";
import { createUpstream, type Transport } from "./upstream";
import { coreOutboxes } from "./core-outboxes";
import {
  serviceOutboxes,
  pushPartialSuccesses,
  pushLegacyPartialAcceptances,
} from "./service-outboxes";
import {
  notificationReadiness,
  readinessUserIds,
} from "./notification-readiness";
import {
  outboxServices,
  type ServiceOutboxStatus,
} from "../shared/service-outboxes";
import { createAuthorization, parseRoleLevel } from "./authorization";
import {
  connectedSession,
  organizationMemberships,
  validateSelectedMembership,
} from "./session-organizations";
import { assetEquipmentHubs } from "./asset-equipment-hubs";
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
  const contextChanged = () =>
    new ApiError(
      409,
      "Your organization context changed. Reload the session.",
      undefined,
      "organization_context_changed",
    );
  const switchPending = () =>
    new ApiError(
      409,
      "An organization change is in progress. Try again shortly.",
      undefined,
      "organization_switch_pending",
    );
  const sessionInfo = (session: Session) => ({
    identity: session.identity,
    csrf: session.csrf,
    expiresAt: session.expiresAt,
    ...(session.organizationMemberships === undefined
      ? {}
      : {
          organizationMemberships: session.organizationMemberships,
          activeOrganizationId: session.activeOrganizationId,
        }),
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
  const readMemberships = async (session: Session) => {
    const { data } = await upstream(
      "users",
      "/v1/usersadmin/organizations",
      session.token,
    );
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new ApiError(
        502,
        "The service returned an invalid organization context.",
      );
    const memberships = organizationMemberships(
      (data as Record<string, unknown>).organizations,
      session.identity.id,
    );
    const activeOrganizationId =
      session.activeOrganizationId === undefined
        ? session.identity.level >= 90
          ? null
          : session.identity.organizationId
        : session.activeOrganizationId;
    validateSelectedMembership(
      session.identity,
      memberships,
      activeOrganizationId,
    );
    return {
      ...session,
      organizationMemberships: memberships,
      activeOrganizationId,
    };
  };
  const disconnect = async (token: string) => {
    try {
      await upstream("users", "/v1/usersadmin/disconnect", token);
    } catch {
      /* No sensitive logging. */
    }
  };
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
    const connected = connectedSession(data, login);
    const previous = sessionId(req, config);
    if (previous) await store.delete(previous);
    const id = newSessionId();
    const session: Session = {
      ...connected,
      csrf: newSessionId(),
      expiresAt: Date.now() + 3540_000,
    };
    await store.set(id, session);
    setSessionCookie(res, config, id);
    res.json(sessionInfo(session));
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
      throw new ApiError(401, "Your session has expired. Sign in again.");
    }
    Object.assign(req, { session, sessionId: id });
    const path = req.originalUrl.split("?")[0];
    if (session.switching && path !== "/api/session/logout") {
      if (session.switching.expiresAt <= Date.now()) {
        await store.compareAndSet(id!, session, null);
        throw contextChanged();
      }
      throw switchPending();
    }
    const read = ["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (
      !read ||
      (path !== "/api/session" && req.headers["x-csrf-token"] !== undefined)
    ) {
      const csrf = req.headers["x-csrf-token"];
      if (
        typeof csrf !== "string" ||
        csrf.length !== session.csrf.length ||
        Buffer.byteLength(csrf) !== Buffer.byteLength(session.csrf) ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf))
      )
        throw new ApiError(
          read ? 409 : 403,
          "Your organization context changed. Reload the session.",
          undefined,
          "organization_context_changed",
        );
    }
    next();
  });
  app.get("/api/session", async (req, res) => {
    const r = req as AuthRequest;
    let session = r.session;
    if (session.organizationMemberships === undefined) {
      try {
        session = await readMemberships(session);
        if (!(await store.compareAndSet(r.sessionId, r.session, session)))
          throw contextChanged();
      } catch (error) {
        if (!(error instanceof ApiError) || ![404, 405].includes(error.status))
          throw error;
      }
    }
    res.json(sessionInfo(session));
  });
  app.get("/api/session/organizations", async (req, res) => {
    if (Object.keys(req.query).length)
      throw new ApiError(400, "Unsupported query parameters.");
    const r = req as AuthRequest;
    const session = await readMemberships(r.session);
    if (!(await store.compareAndSet(r.sessionId, r.session, session)))
      throw contextChanged();
    res.json({ data: session.organizationMemberships });
  });
  app.post("/api/session/organization", async (req, res) => {
    const r = req as AuthRequest;
    if (
      Object.keys(req.query).length ||
      !req.body ||
      Array.isArray(req.body) ||
      Object.keys(req.body).length !== 1 ||
      !("organizationId" in req.body)
    )
      throw new ApiError(400, "Choose an organization.");
    const target = idValue(req.body.organizationId);
    const claimed: Session = {
      ...r.session,
      switching: { nonce: newSessionId(), expiresAt: Date.now() + 30_000 },
    };
    if (!(await store.compareAndSet(r.sessionId, r.session, claimed)))
      throw contextChanged();
    let rotatedToken: string | undefined;
    let committed = false;
    try {
      const authoritative = await readMemberships(claimed);
      if (
        !authoritative.organizationMemberships.some(
          (member) => member.organizationId === target,
        )
      )
        throw new ApiError(
          403,
          "You do not have an active membership in this organization.",
        );
      // Membership discovery can itself wait on a dependency. Do not start a
      // token-rotating request after logout, replacement, or claim expiry.
      const currentClaim = await store.get(r.sessionId);
      if (
        claimed.switching!.expiresAt <= Date.now() ||
        currentClaim?.switching?.nonce !== claimed.switching!.nonce
      )
        throw contextChanged();
      if (authoritative.activeOrganizationId === target) {
        const { switching: _switching, ...unchanged } = authoritative;
        if (!(await store.compareAndSet(r.sessionId, claimed, unchanged)))
          throw contextChanged();
        committed = true;
        res.json(sessionInfo(unchanged));
        return;
      }
      const { data } = await upstream(
        "users",
        "/v1/usersadmin/switchorganization",
        claimed.token,
        {
          method: "POST",
          body: stringify({ idorganization: new LosslessNumber(target) })!,
        },
      );
      // Retain a syntactically valid returned token for best-effort orphan cleanup,
      // even if the remainder of the response fails strict context validation.
      const candidate =
        data && typeof data === "object"
          ? (data as Record<string, unknown>).token
          : undefined;
      if (
        typeof candidate === "string" &&
        candidate !== claimed.token &&
        /^[!-~]{1,4096}$/.test(candidate)
      )
        rotatedToken = candidate;
      const connected = connectedSession(data, claimed.identity.name, {
        userId: claimed.identity.id,
        organizationId: target,
        ...(claimed.identity.level >= 90
          ? {
              platformLevel: claimed.identity.level,
              platformUserTypeId: claimed.identity.userTypeId,
            }
          : {}),
      });
      if (
        connected.token === claimed.token ||
        claimed.switching!.expiresAt <= Date.now()
      )
        throw new ApiError(
          502,
          "The organization change could not be confirmed.",
        );
      const replacement: Session = {
        ...connected,
        csrf: newSessionId(),
        expiresAt: claimed.expiresAt,
      };
      if (!(await store.compareAndSet(r.sessionId, claimed, replacement)))
        throw contextChanged();
      committed = true;
      res.json(sessionInfo(replacement));
    } catch (error) {
      if (!committed) {
        const definite =
          error instanceof ApiError &&
          [400, 403, 404].includes(error.status) &&
          !rotatedToken;
        await store.compareAndSet(
          r.sessionId,
          claimed,
          definite ? r.session : null,
        );
        if (rotatedToken) {
          const winner = await store.get(r.sessionId);
          if (winner?.token !== rotatedToken) await disconnect(rotatedToken);
        }
      }
      throw error;
    }
  });
  app.post("/api/session/logout", async (req, res) => {
    const r = req as AuthRequest;
    // An already-started logout can delete its original session or its switch
    // claim, but must never delete a newly rotated winning session.
    let current = await store.get(r.sessionId);
    let deleted = false;
    for (let attempt = 0; current && attempt < 3; attempt++) {
      if (current.token !== r.session.token || current.csrf !== r.session.csrf)
        throw contextChanged();
      if (await store.compareAndSet(r.sessionId, current, null)) {
        deleted = true;
        break;
      }
      current = await store.get(r.sessionId);
    }
    if (!deleted) throw contextChanged();
    // Local logout always succeeds, even when legacy revocation is temporarily unavailable.
    // Keep the expired opaque browser cookie: a delayed logout response must
    // never clear a newer login's cookie. The deleted server record is final.
    await disconnect(r.session.token);
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
    if (!(await store.compareAndSet(r.sessionId, r.session, updated)))
      throw contextChanged();
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
  app.get("/api/users/notification-readiness", async (req, res) => {
    const r = requirePermission(req, resourceMap.users, "list");
    if (r.session.identity.mustChangePassword)
      throw new ApiError(
        403,
        "Change your password before checking notification registrations.",
      );
    const ids = readinessUserIds(req.query);
    res.json({
      data: await notificationReadiness(ids, r.session.token, upstream),
    });
  });
  const membershipRequest = (req: Request, mutation: boolean) => {
    const r = requirePermission(
      req,
      resourceMap.users,
      mutation ? "edit" : "show",
    );
    if (Object.keys(req.query).length)
      throw new ApiError(400, "Unsupported membership query parameters.");
    const userId = idValue(req.params.userId);
    const organizationId = mutation
      ? idValue(req.params.organizationId)
      : undefined;
    if (
      mutation &&
      r.session.identity.level < 90 &&
      organizationId !== r.session.identity.organizationId
    )
      throw new ApiError(403, "Choose your current organization.");
    return { r, userId, organizationId };
  };
  const noMembershipBody = (req: Request) => {
    if (
      req.body !== undefined ||
      req.headers["transfer-encoding"] !== undefined ||
      (req.headers["content-length"] !== undefined &&
        req.headers["content-length"] !== "0")
    )
      throw new ApiError(
        400,
        "This membership request does not accept a body.",
      );
  };
  const endOriginSession = async (r: AuthRequest) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await store.get(r.sessionId);
      if (
        !current ||
        current.token !== r.session.token ||
        current.csrf !== r.session.csrf
      )
        return;
      if (await store.compareAndSet(r.sessionId, current, null)) return;
    }
    throw contextChanged();
  };
  app.get("/api/users/:userId/organizations", async (req, res) => {
    const { r, userId } = membershipRequest(req, false);
    noMembershipBody(req);
    const { data } = await upstream(
      "users",
      `/v1/users/${userId}/organizations`,
      r.session.token,
    );
    const memberships = organizationMemberships(data, userId, {
      includeInactive: true,
    });
    if (
      r.session.identity.level < 90 &&
      userId !== r.session.identity.id &&
      memberships.some(
        (member) => member.organizationId !== r.session.identity.organizationId,
      )
    )
      throw new ApiError(
        502,
        "The service returned an invalid membership scope.",
      );
    res.json({ data: memberships });
  });
  const changeOrganizationMembership = async (req: Request, res: Response) => {
    const { r, userId, organizationId } = membershipRequest(req, true);
    let userTypeId: string | undefined;
    if (req.method === "PUT") {
      if (
        !req.body ||
        Array.isArray(req.body) ||
        Object.keys(req.body).length !== 1 ||
        !("userTypeId" in req.body)
      )
        throw new ApiError(400, "Choose the membership role.");
      userTypeId = idValue(req.body.userTypeId);
      const role = await authorization.read(r.session, "usertypes", userTypeId);
      const level = parseRoleLevel(valueOf(role, "Level"));
      if (level === null)
        throw new ApiError(
          502,
          "The service returned an invalid membership role.",
        );
      if (
        level >= 90 ||
        (r.session.identity.level < 90 && level >= r.session.identity.level)
      )
        throw new ApiError(
          403,
          "Choose a permitted organization role below your own level.",
        );
    } else noMembershipBody(req);
    const activeOrganizationId =
      r.session.activeOrganizationId === undefined
        ? r.session.identity.level < 90
          ? r.session.identity.organizationId
          : null
        : r.session.activeOrganizationId;
    const endsSession =
      userId === r.session.identity.id &&
      organizationId === activeOrganizationId;
    let result: unknown;
    try {
      const { data } = await upstream(
        "users",
        `/v1/users/${userId}/organizations/${organizationId}`,
        r.session.token,
        {
          method: req.method,
          ...(userTypeId
            ? {
                body: stringify({
                  idusertype: new LosslessNumber(userTypeId),
                  active: true,
                })!,
              }
            : {}),
        },
      );
      if (userTypeId) {
        const [membership] = organizationMemberships([data], userId, {
          includeInactive: true,
        });
        if (
          membership.organizationId !== organizationId ||
          membership.userTypeId !== userTypeId ||
          !membership.active
        )
          throw new ApiError(
            502,
            "The service returned an invalid membership change.",
          );
        result = membership;
      }
    } catch (error) {
      // The backend retires every token selected into the changed organization.
      // An uncertain result must not retain our possibly revoked credentials.
      if (
        endsSession &&
        !(
          error instanceof ApiError &&
          [400, 403, 404, 422].includes(error.status)
        )
      ) {
        await endOriginSession(r);
        throw new ApiError(
          401,
          "Your organization membership may have changed. Sign in again.",
          undefined,
          "organization_membership_session_ended",
        );
      }
      throw error;
    }
    if (endsSession) await endOriginSession(r);
    res.json({
      ...(userTypeId ? { data: result } : { success: true }),
      ...(endsSession ? { sessionEnded: true } : {}),
    });
  };
  app.put(
    "/api/users/:userId/organizations/:organizationId",
    changeOrganizationMembership,
  );
  app.delete(
    "/api/users/:userId/organizations/:organizationId",
    changeOrganizationMembership,
  );
  app.get("/api/assets/:assetId/equipment-hubs", async (req, res) => {
    const r = requirePermission(req, resourceMap.assets, "show");
    requirePermission(req, resourceMap.hubs, "list");
    const assetId = idValue(req.params.assetId);
    if (Object.keys(req.query).some((key) => key !== "_organization"))
      throw new ApiError(400, "Unknown gateway filter.");
    const organization = req.query._organization;
    if (organization !== undefined && typeof organization !== "string")
      throw new ApiError(400, "Check the organization filter.");
    res.json(
      await assetEquipmentHubs(
        assetId,
        r.session,
        upstream,
        authorization,
        organization,
      ),
    );
  });
  app.get("/api/resources/:resource", async (req, res) => {
    const resource = getResource(req);
    const r = requirePermission(req, resource, "list");
    if (resource.name === "assets" && req.query.idhub !== undefined)
      throw new ApiError(400, "The asset hub filter is no longer supported.");
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
    if (
      ["assets", "hubs", "devices"].includes(resource.name) &&
      sort === "status"
    ) {
      const events = new Map(
        records.map((row) => [
          row,
          hubLastEventTime(valueOf(row, "DhLastEvent")) ?? -Infinity,
        ]),
      );
      records.sort((a, b) => {
        const av = events.get(a)!,
          bv = events.get(b)!;
        const n = av === bv ? 0 : av > bv ? -1 : 1;
        return n * (req.query._order === "desc" ? -1 : 1);
      });
    } else if (resource.fields.some((f) => f.key === sort))
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
    if (resource.name === "assets" && req.query.idhub !== undefined)
      throw new ApiError(400, "The asset hub filter is no longer supported.");
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
    let membershipOrganization: string | undefined;
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
      const organization = valueOf(record, "IDOrganization");
      if (
        typeof organization !== "string" ||
        !/^(?:0|[1-9]\d{0,18})$/.test(organization) ||
        BigInt(organization) > 9223372036854775807n ||
        (membershipOrganization !== undefined &&
          membershipOrganization !== organization)
      )
        throw new ApiError(403, "Choose a user from the group's organization.");
      membershipOrganization = organization;
    }
    await upstream(
      "users",
      `/v1/users2usergroups/${req.body.action === "add" ? "addlink" : "removelink"}`,
      r.session.token,
      { query: { iduser: user, idusergroup: group } },
    );
    res.json({ success: true });
  });
  async function changeAssetAssignment(req: Request, res: Response) {
    const r = requirePermission(req, resourceMap.assets, "edit");
    const assetId = idValue(req.params.assetId);
    const relatedId = idValue(req.params.relatedId);
    const kind = String(req.params.kind);
    if (kind !== "users" && kind !== "usergroups")
      throw new ApiError(400, "Choose a user or user group assignment.");
    if (
      Object.keys(req.query).length ||
      Number(req.headers["content-length"] ?? 0) > 0 ||
      req.headers["transfer-encoding"] !== undefined
    )
      throw new ApiError(400, "Assignment changes accept no query or body.");
    const asset = await authorization.read(r.session, "assets", assetId);
    if (
      !(
        await authorization.scopeRecords(r.session, resourceMap.assets, [asset])
      ).length
    )
      throw new ApiError(403, "This asset is outside your access.");
    const related = await authorization.read(r.session, kind, relatedId);
    if (r.session.identity.level < 90) {
      const organization = r.session.identity.organizationId;
      if (
        String(valueOf(asset, "IDOrganization")) !== organization ||
        String(valueOf(related, "IDOrganization")) !== organization
      )
        throw new ApiError(
          403,
          "This assignment is outside your organization.",
        );
    }
    const operation = req.method === "POST" ? "add" : "remove";
    await upstream(
      "assets",
      assetAssignmentRoutes[kind][operation]
        .replace("{asset_id}", assetId)
        .replace("{related_id}", relatedId),
      r.session.token,
      { method: req.method },
    );
    res.json({ success: true });
  }
  app.post(
    "/api/assets/:assetId/assignments/:kind/:relatedId",
    changeAssetAssignment,
  );
  app.delete(
    "/api/assets/:assetId/assignments/:kind/:relatedId",
    changeAssetAssignment,
  );
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
  app.get("/api/core/outboxes", async (req, res) => {
    const r = req as AuthRequest;
    if (!(r.session.identity.level >= 90))
      throw new ApiError(
        403,
        "Core outbox metrics are available to platform administrators.",
      );
    const { data } = await upstream(
      "core",
      "/v1/coreadmin/info",
      r.session.token,
    );
    res.json({ data: coreOutboxes(data) });
  });
  app.get("/api/outboxes", async (req, res) => {
    const r = req as AuthRequest;
    if (!(r.session.identity.level >= 90))
      throw new ApiError(
        403,
        "Outbox metrics are available to platform administrators.",
      );
    const results = await Promise.all(
      outboxServices.map(async (service): Promise<ServiceOutboxStatus> => {
        if (!config.origins[service])
          return {
            service,
            state: "unconfigured",
            outboxes: [],
            message: "Service is not configured.",
          };
        try {
          const { data } = await upstream(
            service,
            `/v1/${service}admin/info`,
            r.session.token,
          );
          return {
            service,
            state: "available",
            outboxes: serviceOutboxes(service, data),
            ...(service === "push"
              ? {
                  partialSuccesses: pushPartialSuccesses(data),
                  legacyPartialAcceptances: pushLegacyPartialAcceptances(data),
                }
              : {}),
          };
        } catch (e) {
          return {
            service,
            state: "unavailable",
            outboxes: [],
            message:
              e instanceof ApiError
                ? e.message
                : "Outbox metrics are unavailable.",
          };
        }
      }),
    );
    res.json({ data: results });
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
    async (
      error: unknown,
      req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      let apiError =
        error instanceof ApiError
          ? error
          : new ApiError(
              error instanceof SyntaxError ? 400 : 500,
              error instanceof SyntaxError
                ? "Invalid JSON request."
                : "The request could not be completed.",
            );
      // A business request may already have left this process when a switch
      // starts. Its old-token 401 must not log out the newly selected context.
      const r = req as Partial<AuthRequest>;
      if (apiError.status === 401 && r.session && r.sessionId) {
        try {
          const current = await store.get(r.sessionId);
          if (current?.switching && current.switching.expiresAt > Date.now())
            apiError = switchPending();
          else if (
            current &&
            (current.csrf !== r.session.csrf ||
              current.token !== r.session.token)
          )
            apiError = contextChanged();
        } catch {
          apiError = new ApiError(
            503,
            "The session could not be verified. Try again.",
          );
        }
      }
      res.status(apiError.status).json({
        message: apiError.message,
        errors: apiError.fields,
        code: apiError.code,
      });
    },
  );
  return app;
}
