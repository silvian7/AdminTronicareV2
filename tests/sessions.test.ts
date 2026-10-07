import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { EncryptJWT } from "jose";
import { createClient } from "redis";
import {
  MemorySessions,
  RedisSessions,
  type Session,
  type SessionStore,
} from "../server/sessions";
import { testIdentity } from "./fixtures";

const key = new Uint8Array(32).fill(7);
const sessionKey = "tronicare-admin:session:session-id";
const newSession = (): Session => ({
  token: "private-upstream-token",
  identity: structuredClone(testIdentity),
  csrf: "private-csrf",
  expiresAt: Date.now() + 60_000,
});

// Model Redis's atomic conditional SET and absolute key expiry, including a
// command delayed in transit. The existence check happens when SET executes.
class TestRedis {
  values = new Map<string, { value: string; expiresAt: number }>();
  beforeConditionalSet?: () => Promise<void>;

  async get(id: string) {
    const entry = this.values.get(id);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.values.delete(id);
      return null;
    }
    return entry.value;
  }
  async set(id: string, value: string, opts: { PXAT: number; XX?: true }) {
    if (opts.XX) {
      await this.beforeConditionalSet?.();
      const entry = this.values.get(id);
      if (!entry || entry.expiresAt <= Date.now()) {
        this.values.delete(id);
        return null;
      }
    }
    this.values.set(id, { value, expiresAt: opts.PXAT });
    return "OK";
  }
  async del(id: string) {
    return Number(this.values.delete(id));
  }
  async ping() {
    return "PONG";
  }
}

afterEach(() => vi.useRealTimers());

describe.each([
  ["memory", () => new MemorySessions()],
  ["Redis", () => new RedisSessions(new TestRedis(), key)],
] as const)("%s session lifecycle", (_name, createStore) => {
  it("updates existing sessions without extending their expiry", async () => {
    const store: SessionStore = createStore();
    const session = newSession();
    await store.set("session-id", session);
    session.identity.mustChangePassword = true;
    expect(await store.update("session-id", session)).toBe(true);
    expect(await store.get("session-id")).toEqual(session);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(session.expiresAt + 1);
    expect(await store.get("session-id")).toBeNull();
    expect(await store.update("session-id", newSession())).toBe(false);
  });

  it("never inserts a missing or logged-out session through update", async () => {
    const store = createStore();
    const session = newSession();
    expect(await store.update("session-id", session)).toBe(false);
    await store.set("session-id", session);
    await store.delete("session-id");
    expect(await store.update("session-id", session)).toBe(false);
    expect(await store.get("session-id")).toBeNull();
  });

  it("rejects an expired update even while the stored session is live", async () => {
    const store = createStore();
    const session = newSession();
    await store.set("session-id", session);
    expect(
      await store.update("session-id", {
        ...session,
        expiresAt: Date.now() - 1,
      }),
    ).toBe(false);
    expect(await store.get("session-id")).toEqual(session);
  });

  it("cannot replace the session credentials or renew its lifetime", async () => {
    const store = createStore();
    const session = newSession();
    await store.set("session-id", session);
    for (const replacement of [
      { ...session, token: "replacement-token" },
      { ...session, csrf: "replacement-csrf" },
      { ...session, expiresAt: session.expiresAt + 60_000 },
      { ...session, expiresAt: session.expiresAt - 1_000 },
    ])
      expect(await store.update("session-id", replacement)).toBe(false);
    expect(await store.get("session-id")).toEqual(session);
  });

  it("isolates nested session values from caller mutations", async () => {
    const store = createStore();
    const session = newSession();
    const original = structuredClone(session);
    await store.set("session-id", session);
    session.identity.permissions[0].rights = "";
    session.identity.mustChangePassword = true;
    expect(await store.get("session-id")).toEqual(original);

    const loaded = (await store.get("session-id"))!;
    loaded.identity.permissions[0].rights = "";
    expect(await store.get("session-id")).toEqual(original);
    expect(await store.update("session-id", loaded)).toBe(true);
    const updated = structuredClone(loaded);
    loaded.identity.name = "changed after update";
    expect(await store.get("session-id")).toEqual(updated);
  });

  it("keeps logout final when it follows an update", async () => {
    const store = createStore();
    const session = newSession();
    await store.set("session-id", session);
    expect(await store.update("session-id", session)).toBe(true);
    await store.delete("session-id");
    expect(await store.get("session-id")).toBeNull();
  });
});

describe("Redis session encryption and atomic revocation", () => {
  it("snapshots candidate data and expiry before asynchronous store operations", async () => {
    const redis = new TestRedis();
    const store = new RedisSessions(redis, key);
    const candidate = newSession();
    const original = structuredClone(candidate);
    const setting = store.set("session-id", candidate);
    candidate.identity.name = "changed while encryption is pending";
    candidate.expiresAt += 60_000;
    await setting;
    expect(await store.get("session-id")).toEqual(original);
    expect(redis.values.get(sessionKey)?.expiresAt).toBe(original.expiresAt);

    const updateSnapshot = structuredClone(original);
    const updating = store.update("session-id", original);
    original.identity.name = "changed while update read is pending";
    original.expiresAt += 60_000;
    expect(await updating).toBe(true);
    expect(await store.get("session-id")).toEqual(updateSnapshot);
    expect(redis.values.get(sessionKey)?.expiresAt).toBe(
      updateSnapshot.expiresAt,
    );
  });

  it("encrypts stored credentials and decrypts only with the configured key", async () => {
    const redis = new TestRedis();
    const session = newSession();
    const store = new RedisSessions(redis, key);
    await store.set("session-id", session);
    const encoded = redis.values.get(sessionKey)!;
    expect(encoded.value).not.toContain(session.token);
    expect(encoded.value).not.toContain(session.csrf);
    expect(encoded.expiresAt).toBe(session.expiresAt);
    expect(await store.get("session-id")).toEqual(session);
    expect(
      await new RedisSessions(redis, new Uint8Array(32).fill(8)).get(
        "session-id",
      ),
    ).toBeNull();
  });

  it("rejects tampering and encrypted sessions past their own expiry", async () => {
    const redis = new TestRedis();
    const store = new RedisSessions(redis, key);
    await store.set("session-id", newSession());
    const stored = redis.values.get(sessionKey)!;
    const segments = stored.value.split(".");
    segments[3] = `${segments[3][0] === "A" ? "B" : "A"}${segments[3].slice(1)}`;
    stored.value = segments.join(".");
    expect(await store.get("session-id")).toBeNull();

    const expired = { ...newSession(), expiresAt: Date.now() - 1 };
    stored.value = await new EncryptJWT({ session: expired })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setIssuer("tronicare-admin")
      .setAudience("admin-session")
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .encrypt(key);
    expect(await store.get("session-id")).toBeNull();

    stored.value = await new EncryptJWT({ session: newSession() })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setIssuer("tronicare-admin")
      .setAudience("admin-session")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .encrypt(key);
    expect(await store.get("session-id")).toBeNull();
  });

  it("does not restore a session when logout wins against an in-flight update", async () => {
    const redis = new TestRedis();
    const writer = new RedisSessions(redis, key);
    const otherReplica = new RedisSessions(redis, key);
    const session = newSession();
    await writer.set("session-id", session);
    let release!: () => void;
    let arrived!: () => void;
    const commandArrived = new Promise<void>((resolve) => (arrived = resolve));
    redis.beforeConditionalSet = () => {
      arrived();
      return new Promise<void>((resolve) => (release = resolve));
    };
    const updating = writer.update("session-id", session);
    await commandArrived;
    await otherReplica.delete("session-id");
    release();
    expect(await updating).toBe(false);
    expect(await writer.get("session-id")).toBeNull();
    expect(redis.values.has(sessionKey)).toBe(false);
  });

  it("cannot revive a key that expires while the update is in flight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const redis = new TestRedis();
    const store = new RedisSessions(redis, key);
    const session = newSession();
    await store.set("session-id", session);
    redis.beforeConditionalSet = async () => {
      vi.setSystemTime(session.expiresAt + 1);
    };
    expect(await store.update("session-id", session)).toBe(false);
    expect(await store.get("session-id")).toBeNull();
  });
});

it.skipIf(!process.env.TEST_REDIS_URL)(
  "preserves encryption, expiry, and atomic revocation on a real Redis server",
  async () => {
    const options = {
      url: process.env.TEST_REDIS_URL,
      disableOfflineQueue: true,
      socket: { connectTimeout: 1000, reconnectStrategy: false as const },
    };
    const writerClient = createClient(options);
    const logoutClient = createClient(options);
    writerClient.on("error", () => {});
    logoutClient.on("error", () => {});
    const id = `session-test-${randomUUID()}`;
    const storedKey = `tronicare-admin:session:${id}`;
    try {
      await Promise.all([writerClient.connect(), logoutClient.connect()]);
      const writer = new RedisSessions(writerClient, key);
      const otherReplica = new RedisSessions(logoutClient, key);
      const session = newSession();
      await writer.set(id, session);
      expect(await otherReplica.get(id)).toEqual(session);
      const encoded = await writerClient.get(storedKey);
      expect(encoded).not.toContain(session.token);
      expect(encoded).not.toContain(session.csrf);
      const initialTtl = await writerClient.pTTL(storedKey);
      session.identity.mustChangePassword = true;
      expect(await writer.update(id, session)).toBe(true);
      expect(await otherReplica.get(id)).toEqual(session);
      expect(await writerClient.pTTL(storedKey)).toBeLessThanOrEqual(
        initialTtl,
      );

      let release!: () => void;
      let arrived!: () => void;
      const commandArrived = new Promise<void>(
        (resolve) => (arrived = resolve),
      );
      const delayedWriter = new RedisSessions(
        {
          get: (name) => writerClient.get(name),
          del: (name) => writerClient.del(name),
          ping: () => writerClient.ping(),
          set: async (name, value, setOptions) => {
            arrived();
            await new Promise<void>((resolve) => (release = resolve));
            return writerClient.set(name, value, setOptions);
          },
        },
        key,
      );
      const updating = delayedWriter.update(id, session);
      await commandArrived;
      await otherReplica.delete(id);
      release();
      expect(await updating).toBe(false);
      expect(await otherReplica.get(id)).toBeNull();
      expect(await writerClient.exists(storedKey)).toBe(0);
    } finally {
      if (writerClient.isReady) await writerClient.del(storedKey);
      if (writerClient.isOpen) writerClient.destroy();
      if (logoutClient.isOpen) logoutClient.destroy();
    }
  },
);
