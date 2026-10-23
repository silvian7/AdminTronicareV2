import { randomBytes } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { parse, serialize } from "cookie";
import type { Request, Response } from "express";
import type { Identity, OrganizationMembership } from "../shared/resources";
import type { Config } from "./config";

export interface Session {
  token: string;
  identity: Identity;
  csrf: string;
  expiresAt: number;
  organizationMemberships?: OrganizationMembership[];
  activeOrganizationId?: string | null;
  switching?: { nonce: string; expiresAt: number };
}
export interface SessionStore {
  get(id: string): Promise<Session | null>;
  set(id: string, session: Session): Promise<void>;
  // Update identity only while the original credentials and lifetime remain live.
  update(id: string, session: Session): Promise<boolean>;
  compareAndSet(
    id: string,
    expected: Session,
    replacement: Session | null,
  ): Promise<boolean>;
  delete(id: string): Promise<void>;
  healthy(): Promise<boolean>;
}
const sameCredentials = (current: Session, updated: Session) =>
  current.token === updated.token &&
  current.csrf === updated.csrf &&
  current.expiresAt === updated.expiresAt;
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
const sameSession = (left: Session, right: Session) =>
  stable(left) === stable(right);
export class MemorySessions implements SessionStore {
  private sessions = new Map<string, Session>();
  async get(id: string) {
    const s = this.sessions.get(id);
    if (!s || s.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return structuredClone(s);
  }
  async set(id: string, s: Session) {
    for (const [key, value] of this.sessions)
      if (value.expiresAt <= Date.now()) this.sessions.delete(key);
    this.sessions.set(id, structuredClone(s));
  }
  async update(id: string, s: Session) {
    // No await between checking and writing: logout cannot interleave here.
    const current = this.sessions.get(id);
    const now = Date.now();
    if (!current || current.expiresAt <= now || s.expiresAt <= now) {
      if (current && current.expiresAt <= now) this.sessions.delete(id);
      return false;
    }
    if (current.switching || s.switching || !sameCredentials(current, s))
      return false;
    this.sessions.set(id, structuredClone(s));
    return true;
  }
  async compareAndSet(
    id: string,
    expected: Session,
    replacement: Session | null,
  ) {
    const current = this.sessions.get(id);
    const now = Date.now();
    if (
      !current ||
      current.expiresAt <= now ||
      expected.expiresAt <= now ||
      !sameSession(current, expected) ||
      (replacement &&
        (replacement.expiresAt !== expected.expiresAt ||
          replacement.expiresAt <= now))
    )
      return false;
    if (replacement) this.sessions.set(id, structuredClone(replacement));
    else this.sessions.delete(id);
    return true;
  }
  async delete(id: string) {
    this.sessions.delete(id);
  }
  async healthy() {
    return true;
  }
}
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    opts: { PXAT: number; XX?: true },
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
  ping(): Promise<string>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}
// Compare the exact encrypted value, and check expiry at execution time. Neither
// a delayed update nor another replica can resurrect or overwrite a newer session.
const sessionCas = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local now = redis.call('TIME')
if tonumber(ARGV[3]) <= tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000) then return 0 end
if ARGV[2] == '' then return redis.call('DEL', KEYS[1]) end
redis.call('SET', KEYS[1], ARGV[2], 'PXAT', ARGV[3])
return 1`;
export class RedisSessions implements SessionStore {
  constructor(
    private redis: RedisLike,
    private key: Uint8Array,
  ) {}
  async get(id: string): Promise<Session | null> {
    const raw = await this.redis.get(`tronicare-admin:session:${id}`);
    return raw ? this.decode(raw) : null;
  }
  private async decode(raw: string): Promise<Session | null> {
    try {
      const { payload } = await jwtDecrypt(raw, this.key, {
        issuer: "tronicare-admin",
        audience: "admin-session",
      });
      const session = payload.session as unknown as Session;
      return session &&
        Number.isFinite(session.expiresAt) &&
        session.expiresAt > Date.now()
        ? session
        : null;
    } catch {
      return null;
    }
  }
  async set(id: string, session: Session) {
    const snapshot = structuredClone(session);
    const encoded = await this.encode(snapshot);
    await this.redis.set(`tronicare-admin:session:${id}`, encoded, {
      PXAT: snapshot.expiresAt,
    });
  }
  async update(id: string, session: Session) {
    const snapshot = structuredClone(session);
    if (snapshot.expiresAt <= Date.now()) return false;
    const raw = await this.redis.get(`tronicare-admin:session:${id}`);
    const current = raw ? await this.decode(raw) : null;
    if (
      !raw ||
      !current ||
      current.switching ||
      snapshot.switching ||
      !sameCredentials(current, snapshot)
    )
      return false;
    return this.replaceRaw(id, raw, snapshot, snapshot.expiresAt);
  }
  async compareAndSet(
    id: string,
    expected: Session,
    replacement: Session | null,
  ) {
    const before = structuredClone(expected);
    const after = replacement ? structuredClone(replacement) : null;
    if (
      before.expiresAt <= Date.now() ||
      (after && after.expiresAt !== before.expiresAt)
    )
      return false;
    const raw = await this.redis.get(`tronicare-admin:session:${id}`);
    const current = raw ? await this.decode(raw) : null;
    if (!raw || !current || !sameSession(current, before)) return false;
    return this.replaceRaw(id, raw, after, before.expiresAt);
  }
  private async replaceRaw(
    id: string,
    raw: string,
    replacement: Session | null,
    expiresAt: number,
  ) {
    const encoded = replacement ? await this.encode(replacement) : "";
    return (
      (await this.redis.eval(sessionCas, {
        keys: [`tronicare-admin:session:${id}`],
        arguments: [raw, encoded, String(expiresAt)],
      })) === 1
    );
  }
  private encode(session: Session) {
    return new EncryptJWT({ session })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setIssuer("tronicare-admin")
      .setAudience("admin-session")
      .setExpirationTime(Math.floor(session.expiresAt / 1000))
      .encrypt(this.key);
  }
  async delete(id: string) {
    await this.redis.del(`tronicare-admin:session:${id}`);
  }
  async healthy() {
    try {
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }
}
export const newSessionId = () => randomBytes(32).toString("hex");
const cookieName = (config: Config) =>
  config.cookieSecure ? "__Host-tronicare-admin" : "tronicare-admin";
export function sessionId(req: Request, config: Config) {
  const value = parse(req.headers.cookie ?? "")[cookieName(config)];
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
export function setSessionCookie(res: Response, config: Config, id?: string) {
  res.setHeader(
    "Set-Cookie",
    serialize(cookieName(config), id ?? "", {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "strict",
      path: "/",
      maxAge: id ? 3540 : 0,
    }),
  );
}
