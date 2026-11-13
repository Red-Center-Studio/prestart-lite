import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Unit and route tests run inside the real Workers runtime with a real local D1 database and R2 bucket.
// Each test file gets fresh storage with the migrations applied (see test/setup.ts).
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            AUTH_SECRET: "test-secret-for-vitest-only-0123456789abcdef",
            REQUIRE_EMAIL_VERIFICATION: "false",
            DEMO_MODE: "false",
          },
          // Generous limit so tests that sign up many people do not hit the sign-in rate limit.
          ratelimits: { AUTH_LIMITER: { namespace_id: "1001", simple: { limit: 1000, period: 60 } } },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
      testTimeout: 30_000,
    },
  };
});
