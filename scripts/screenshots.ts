/**
 * Captures the README screenshots from a running local copy with the demo data loaded.
 *
 *   npm run seed:local
 *   npx wrangler dev --port 8790        (in another terminal)
 *   npm run screenshots
 *
 * Uses Microsoft Edge by default; set PW_CHANNEL=chrome to use Chrome instead.
 */
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "@playwright/test";
import { DEMO_PASSWORD } from "../src/seed/demo.ts";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8790";
const OUT = new URL("../docs/screenshots/", import.meta.url);

async function signedIn(browser: Browser, email: string, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}

const shot = (page: Page, name: string) => page.screenshot({ path: fileURLToPath(new URL(name, OUT)) });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });
const phone = { width: 390, height: 844 };
const desktop = { width: 1100, height: 800 };

// Daily check, with one failed item open so the severity choices show.
const driver = await signedIn(browser, "driver@demo.prestart.example", phone);
await driver.goto(`${BASE}/check`);
await driver.getByLabel("Vehicle", { exact: true }).selectOption({ label: "Hilux 1 (1ABC234)" });
await driver.getByLabel("Odometer (km)").fill("84390");
const row = driver.locator("[data-item]").first();
await row.getByText("Fail", { exact: true }).click();
await row.getByLabel("What is wrong?").fill("Rear passenger door will not latch");
await row.getByRole("radio", { name: /^Major/ }).check();
// Scroll so the progress bar sits just under the sticky header.
// (A string, because this script is type-checked for Node, which has no DOM types.)
await driver.evaluate(`(() => {
  const bar = document.querySelector("[data-progress]").closest("div");
  const header = document.querySelector("header").getBoundingClientRect().height;
  window.scrollTo(0, bar.getBoundingClientRect().top + window.scrollY - header - 12);
})()`);
await shot(driver, "check-phone.png");

const workshop = await signedIn(browser, "workshop@demo.prestart.example", phone);
await workshop.goto(`${BASE}/defects`);
await shot(workshop, "defects-phone.png");

const admin = await signedIn(browser, "admin@demo.prestart.example", desktop);
await admin.goto(`${BASE}/fleet`);
await shot(admin, "fleet-desktop.png");
await admin.goto(`${BASE}/history`);
await shot(admin, "history-desktop.png");

await browser.close();
console.log("Screenshots saved to docs/screenshots.");
