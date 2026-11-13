import { defineConfig } from "drizzle-kit";

// `npm run db:generate` turns changes in src/db/schema.ts into a new SQL file in migrations/.
// Wrangler applies those files to D1 (`npm run db:migrate:local` or `npm run deploy`).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
