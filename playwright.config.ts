import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "8791";
const baseURL = `http://127.0.0.1:${PORT}`;

// End-to-end tests drive a real browser against `wrangler dev` with a fresh local database and the demo data.
// They run once at desktop width and once at a 390px phone width. Uses the installed Microsoft Edge or Chrome;
// set E2E_BROWSER=chromium to use Playwright's own browser instead (run `npx playwright install chromium` first).
const channel = process.env.E2E_BROWSER === "chromium" ? undefined : (process.env.E2E_BROWSER ?? "msedge");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...(channel ? { channel } : {}),
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}) },
    },
    {
      name: "phone-390",
      dependencies: ["desktop"],
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...(channel ? { channel } : {}) },
    },
  ],
  webServer: {
    command: "node e2e/start-server.mjs",
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
