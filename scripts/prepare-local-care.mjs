// Initialize a NEW local runtime only. Never print credentials or reuse live DBs.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", ".local", "care-runtime");
const privateFiles = [
  "postgres.env",
  "reader-grants.sql",
  "api/.env",
  "api/.secret",
];
if (privateFiles.some((path) => existsSync(resolve(root, path))))
  throw new Error(
    "Local caregiver configuration already exists; credentials were not changed.",
  );

// Read only the public common API origin from the existing local Admin process.
const configured =
  process.env.CARE_SCOPE_ORIGIN ||
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "admin",
      "node",
      "-p",
      "process.env.API_ORIGIN || ''",
    ],
    { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8" },
  ).trim();
let origin;
try {
  origin = new URL(configured);
} catch {
  throw new Error("A verified HTTPS Users/Assets API origin is required.");
}
if (
  origin.protocol !== "https:" ||
  origin.origin !== configured ||
  origin.username ||
  origin.password
)
  throw new Error("A verified HTTPS Users/Assets API origin is required.");

const ownerPassword = randomBytes(32).toString("hex");
const readerPassword = randomBytes(32).toString("hex");
const hmac = randomBytes(32).toString("hex");
mkdirSync(resolve(root, "api"), { recursive: true, mode: 0o700 });
const save = (file, content) =>
  writeFileSync(resolve(root, file), content, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
save(
  "postgres.env",
  `POSTGRES_DB=care_core_local\nPOSTGRES_USER=care_owner\nPOSTGRES_PASSWORD=${ownerPassword}\nPOSTGRES_INITDB_ARGS=--auth-host=scram-sha-256\n`,
);
save(
  "api/.env",
  [
    "TRONICARE_ENVIRONMENT=development",
    "CORE_MODE=active",
    "CORE_TEST_MODE=false",
    "CORE_API_HOST=0.0.0.0",
    "CORE_API_PORT=8082",
    "CORE_API_CONTRACT_PROFILE=legacy-semantic-v1",
    "CORE_API_SERVING_PROFILE=migration-readonly-v1",
    "CORE_API_SERVING_AUTHORIZED=true",
    "CORE_API_MUTATIONS_AUTHORIZED=false",
    "CORE_API_ACTIVATION_AUTHORIZED=false",
    "CORE_API_EXPECTED_AUTHORITY_EPOCH=d04fc5db-d3ae-5bc2-995a-153f56ccae04",
    `CORE_API_LEGACY_SCOPE_ORIGIN=${origin.origin}`,
    "CORE_DATABASE_POOL_SIZE=2",
    "CORE_DATABASE_MAX_OVERFLOW=0",
  ].join("\n") + "\n",
);
save(
  "api/.secret",
  `CORE_API_DATABASE_URL=postgresql+psycopg://care_reader:${readerPassword}@care-postgres:5432/care_core_local?sslmode=require&gssencmode=disable\nCORE_API_CALLER_REF_HMAC_KEY=${hmac}\n`,
);
save(
  "reader-grants.sql",
  `
REVOKE ALL ON DATABASE care_core_local FROM PUBLIC;
REVOKE ALL ON SCHEMA core FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA core FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA core FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA core FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE care_owner IN SCHEMA core REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE ROLE care_reader LOGIN PASSWORD '${readerPassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE care_core_local TO care_reader;
GRANT USAGE ON SCHEMA core TO care_reader;
GRANT SELECT ON core.core_api_authority_epoch, core.device, core.sensor, core.sensor_type TO care_reader;
ALTER ROLE care_reader SET default_transaction_read_only=on;
`,
);
console.log(
  "Initialized private configuration for a new isolated local caregiver database/API.",
);
