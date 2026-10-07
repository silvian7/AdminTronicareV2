import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:18080",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: process.env.E2E_HOST_OVERRIDE
        ? [
            `--host-resolver-rules=MAP localhost ${process.env.E2E_HOST_OVERRIDE}`,
          ]
        : [],
    },
  },
});
