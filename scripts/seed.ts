/**
 * Loads the demo fleet into D1. DELETES ALL DATA FIRST.
 *
 *   npm run seed:local                 your local development database
 *   npm run seed:remote -- --yes       the live database (only for a demo deploy)
 *
 * Runs with plain Node (22.18 or newer runs TypeScript directly).
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { demoStatements, DEMO_ACCOUNTS, DEMO_PASSWORD } from "../src/seed/demo.ts";

const remote = process.argv.includes("--remote");
const confirmed = process.argv.includes("--yes");

if (remote && !confirmed) {
  console.error(
    "This wipes the LIVE database and loads demo data. Only do this on a demo deploy.\n" +
      "If you are sure, run: npm run seed:remote -- --yes",
  );
  process.exit(1);
}

const literal = (v: string | number | null): string => {
  if (v === null) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return `'${v.replaceAll("'", "''")}'`;
};

const statements = await demoStatements();
const sql = statements
  .map((s) => {
    let i = 0;
    return `${s.sql.replace(/\?/g, () => literal(s.params[i++] ?? null))};`;
  })
  .join("\n");

const dir = join(process.cwd(), ".wrangler");
mkdirSync(dir, { recursive: true });
const file = join(dir, "seed.sql");
writeFileSync(file, sql);

const args = ["wrangler", "d1", "execute", "DB", remote ? "--remote" : "--local", `--file=${file}`, "--yes"];
// The end-to-end tests keep their own local database in a separate folder.
if (!remote && process.env.SEED_PERSIST_TO) args.push(`--persist-to=${process.env.SEED_PERSIST_TO}`);
// Optional: a different Wrangler config, for example a separate demo deploy (--config=../demo/wrangler.jsonc).
const configArg = process.argv.find((a) => a.startsWith("--config="));
if (configArg) args.push(configArg);
if (process.platform === "win32") {
  // npx is a .cmd script on Windows, which needs a shell; the arguments here are fixed, apart from the quoted path.
  execSync(`npx ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`, { stdio: "inherit" });
} else {
  execFileSync("npx", args, { stdio: "inherit" });
}

console.log("\nDemo data loaded. Sign in with any of these (password for all: " + DEMO_PASSWORD + "):");
for (const a of DEMO_ACCOUNTS) console.log(`  ${a.role.padEnd(9)} ${a.email}`);
