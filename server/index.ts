import { createClient } from "redis";
import { loadConfig } from "./config";
import { createApp } from "./app";
import { MemorySessions, RedisSessions, type SessionStore } from "./sessions";

const config = loadConfig();
let store: SessionStore = new MemorySessions();
const redis = config.redisUrl
  ? createClient({
      url: config.redisUrl,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => Math.min(retries * 250, 3000),
      },
    })
  : undefined;
if (redis) {
  redis.on("error", () => console.error("Session store unavailable"));
  await redis.connect();
  store = new RedisSessions(redis, config.sessionKey);
}
const app = createApp(config, store);
const server = app.listen(config.port, "0.0.0.0", () =>
  console.log(`Tronicare admin listening on port ${config.port}`),
);
server.requestTimeout = 30000;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(async () => {
      if (redis?.isOpen) await redis.quit();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
