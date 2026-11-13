// Starts a fresh local PreStart for the end-to-end tests: empty database, migrations, demo data, then wrangler dev.
import { execSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";

const STATE = ".e2e-state";
const PORT = process.env.E2E_PORT ?? "8791";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (cmd) => execSync(cmd, { stdio: "inherit", env: { ...process.env, SEED_PERSIST_TO: STATE } });

rmSync(STATE, { recursive: true, force: true });
run(`npx wrangler d1 migrations apply DB --local --persist-to=${STATE}`);
run("node scripts/seed.ts --local");

const child = spawn(
  npx,
  ["wrangler", "dev", "--port", PORT, "--ip", "127.0.0.1", `--persist-to=${STATE}`, "--var", "DEMO_MODE:false"],
  { stdio: "inherit", shell: process.platform === "win32" },
);
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
