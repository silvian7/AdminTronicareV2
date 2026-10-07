import { services, type Service } from "../shared/resources";

export interface Config {
  port: number;
  production: boolean;
  publicOrigin: string;
  cookieSecure: boolean;
  sessionKey: Uint8Array;
  passwordSalt: string;
  origins: Partial<Record<Service, string>>;
  enabledWrites: Set<Service>;
  requestTimeoutMs: number;
  trustProxy: number;
  redisUrl?: string;
}
export function loadConfig(env = process.env): Config {
  const production = env.NODE_ENV === "production";
  const publicOrigin = env.PUBLIC_ORIGIN ?? "http://localhost:5173";
  const origin = new URL(publicOrigin);
  if (
    origin.origin !== publicOrigin ||
    !["http:", "https:"].includes(origin.protocol)
  )
    throw new Error("PUBLIC_ORIGIN must be an HTTP(S) origin without a path");
  const rawKey = env.SESSION_SECRET;
  if (!rawKey || !/^[A-Za-z0-9+/]{43}=$/.test(rawKey))
    throw new Error(
      "SESSION_SECRET must contain 32 random bytes encoded as base64",
    );
  const sessionKey = new Uint8Array(Buffer.from(rawKey, "base64"));
  if (sessionKey.length !== 32) throw new Error("Invalid session key length");
  const origins: Config["origins"] = {};
  for (const service of services) {
    const raw = env[`${service.toUpperCase()}_API_ORIGIN`] ?? env.API_ORIGIN;
    if (raw) {
      const url = new URL(raw);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      )
        throw new Error(`Invalid ${service} API origin`);
      origins[service] = url.origin;
    }
  }
  if (!origins.users)
    throw new Error("USERS_API_ORIGIN or API_ORIGIN is required");
  const enabledWrites = new Set(
    (
      env.ENABLED_WRITE_SERVICES ??
      "users,organizations,assets,core,rules,actions"
    )
      .split(",")
      .filter(Boolean) as Service[],
  );
  if ([...enabledWrites].some((s) => !services.includes(s)))
    throw new Error("Unknown ENABLED_WRITE_SERVICES entry");
  const cookieSecure = origin.protocol === "https:";
  if (production && !cookieSecure && env.ALLOW_HTTP !== "true")
    throw new Error(
      "Production requires HTTPS PUBLIC_ORIGIN (ALLOW_HTTP=true is for isolated local container tests)",
    );
  if (production && !env.REDIS_URL)
    throw new Error("REDIS_URL is required for shared Kubernetes sessions");
  return {
    port: Number(env.PORT ?? 8080),
    production,
    publicOrigin,
    cookieSecure,
    sessionKey,
    redisUrl: env.REDIS_URL,
    passwordSalt: env.LEGACY_PASSWORD_SALT ?? "tcare",
    origins,
    enabledWrites,
    requestTimeoutMs: 15000,
    trustProxy: Number(env.TRUST_PROXY_HOPS ?? 0),
  };
}
