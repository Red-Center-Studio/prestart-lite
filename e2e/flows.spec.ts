import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

type Role = "admin" | "workshop" | "driver";

/** Opens a page signed in as a demo role, at this project's screen size. */
async function pageAs(browser: Browser, role: Role, info: TestInfo): Promise<Page> {
  const { viewport, isMobile, hasTouch } = info.project.use;
  const context = await browser.newContext({
    storageState: `.e2e-state/${role}.json`,
    baseURL: info.project.use.baseURL,
    ...(viewport ? { viewport } : {}),
    ...(isMobile !== undefined ? { isMobile } : {}),
    ...(hasTouch !== undefined ? { hasTouch } : {}),
  });
  const page = await context.newPage();
  page.on("dialog", (d) => void d.accept());
  return page;
}

/** A page with nobody signed in. */
async function freshPage(browser: Browser, info: TestInfo): Promise<Page> {
  const { viewport, isMobile, hasTouch } = info.project.use;
  const context = await browser.newContext({
    baseURL: info.project.use.baseURL,
    ...(viewport ? { viewport } : {}),
    ...(isMobile !== undefined ? { isMobile } : {}),
    ...(hasTouch !== undefined ? { hasTouch } : {}),
  });
  const page = await context.newPage();
  page.on("dialog", (d) => void d.accept());
  return page;
}

const uid = () => Math.random().toString(36).slice(2, 7).toUpperCase();

async function addVehicle(admin: Page, name: string, rego: string) {
  await admin.goto("/fleet");
  await admin.getByRole("link", { name: "Add vehicle" }).click();
  const dialog = admin.getByRole("dialog", { name: "Add vehicle" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Rego (optional)", { exact: true }).fill(rego);
  await dialog.getByLabel("Odometer (km)").fill("1000");
  await dialog.getByRole("button", { name: "Add vehicle" }).click();
  await expect(admin.getByText("Vehicle added.")).toBeVisible();
  await expect(admin.getByRole("heading", { name, exact: true })).toBeVisible();
}

type Severity = "Minor" | "Major" | "Critical (do not drive)";

const OUTCOME: Record<"none" | Severity, string> = {
  none: "Check passed. Drive safe.",
  Minor: "Check submitted. Safe to drive.",
  Major: "Check submitted. Do not drive yet.",
  "Critical (do not drive)": "Do not drive this vehicle.",
};

// A real 1 by 1 PNG, so the browser can read it when it shrinks photos before upload.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function submitCheck(
  driver: Page,
  vehicleLabel: string,
  odometer: string,
  opts: { fail?: string; notes?: string; severity?: Severity; photo?: boolean } = {},
) {
  await driver.goto("/check");
  await driver.getByLabel("Vehicle", { exact: true }).selectOption({ label: vehicleLabel });
  await driver.getByLabel("Odometer (km)").fill(odometer);
  if (opts.fail) {
    const row = driver.locator("[data-item]").filter({ hasText: opts.fail });
    await row.getByText("Fail", { exact: true }).click();
    await row.getByLabel("What is wrong?").fill(opts.notes ?? "Problem found");
    await row
      .getByRole("radio", { name: new RegExp(`^${(opts.severity ?? "Minor").replace(/[()]/g, "\\$&")}`) })
      .check();
    if (opts.photo) {
      await row.locator("input[type=file]").setInputFiles({ name: "fault.png", mimeType: "image/png", buffer: PNG });
    }
  }
  await driver.getByRole("button", { name: "All pass" }).click();
  await expect(driver.getByText(/answered\./)).toHaveText(/(\d+) of \1 answered\./);
  await driver.getByRole("button", { name: "Submit check" }).click();
  const outcome = OUTCOME[opts.fail ? (opts.severity ?? "Minor") : "none"];
  await expect(driver.getByRole("heading", { name: outcome })).toBeVisible();
}

const vehicleCard = (page: Page, name: string) =>
  page
    .locator("li")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .first();

test("driver submits a passing check", async ({ browser }, info) => {
  const admin = await pageAs(browser, "admin", info);
  const name = `Pass Ute ${uid()}`;
  const rego = `P${uid()}`;
  await addVehicle(admin, name, rego);

  const driver = await pageAs(browser, "driver", info);
  await submitCheck(driver, `${name} (${rego})`, "1010");
  await expect(driver.getByText("went to the workshop queue")).toHaveCount(0);

  await driver.getByRole("link", { name: "View this check" }).click();
  await expect(driver.getByText("Passed", { exact: true })).toBeVisible();
  await driver.goto("/history");
  await expect(driver.getByRole("link", { name: new RegExp(name) }).first()).toBeVisible();
});

test("a major fault, like missing doors, tells the driver not to drive yet", async ({ browser }, info) => {
  const admin = await pageAs(browser, "admin", info);
  const driver = await pageAs(browser, "driver", info);
  const name = `Major Ute ${uid()}`;
  const rego = `M${uid()}`;
  await addVehicle(admin, name, rego);

  await submitCheck(driver, `${name} (${rego})`, "1020", {
    fail: "Body, doors and panels",
    notes: "Rear doors missing",
    severity: "Major",
    photo: true,
  });
  await expect(driver.getByText("Tell your supervisor or the workshop now")).toBeVisible();
  await expect(driver.getByText("Drive safe")).toHaveCount(0);

  // The check records the answer, the note and the photo, and the vehicle stays in service for the workshop to decide.
  await driver.getByRole("link", { name: "View this check" }).click();
  await expect(driver.getByText("Rear doors missing")).toBeVisible();
  const photo = driver.getByRole("img", { name: /Photo 1 from the check/ });
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // The next driver sees the open fault when they pick that vehicle.
  await driver.goto("/check");
  await driver.getByLabel("Vehicle", { exact: true }).selectOption({ label: `${name} (${rego})` });
  const faults = driver.locator("[data-faults-for]:visible");
  await expect(faults.getByText("Known faults on this vehicle")).toBeVisible();
  await expect(faults.getByText(/Rear doors missing/)).toBeVisible();

  // An unanswered item is pointed out before anything is sent.
  await driver.getByLabel("Odometer (km)").fill("1030");
  await driver.getByRole("button", { name: "Submit check" }).click();
  await expect(driver.getByText(/items have no answer yet/)).toBeVisible();
  await expect(driver).toHaveURL(/\/check$/);
});

test("a critical fault takes the vehicle off road, and it returns only when no critical defect remains", async ({
  browser,
}, info) => {
  const admin = await pageAs(browser, "admin", info);
  const driver = await pageAs(browser, "driver", info);
  const workshop = await pageAs(browser, "workshop", info);
  const name = `Crit Truck ${uid()}`;
  const rego = `C${uid()}`;
  await addVehicle(admin, name, rego);

  // First critical fault.
  await submitCheck(driver, `${name} (${rego})`, "1100", {
    fail: "Brakes and handbrake working",
    notes: "Brakes feel spongy",
    severity: "Critical (do not drive)",
  });
  await expect(driver.getByText(`${name} is now off road`)).toBeVisible();
  await driver.goto("/fleet");
  await expect(vehicleCard(driver, name).getByText("Off road")).toBeVisible();
  await driver.goto("/check");
  await expect(driver.getByLabel("Vehicle", { exact: true }).locator("option", { hasText: name })).toHaveCount(0);

  // An admin puts it back in service by hand, and a second critical fault is found.
  await admin.goto("/fleet");
  await vehicleCard(admin, name).getByRole("link", { name: "Edit" }).click();
  const edit = admin.getByRole("dialog", { name: `Edit ${name}` });
  await edit.getByLabel("Status").selectOption({ label: "In service" });
  await edit.getByRole("button", { name: "Save vehicle" }).click();
  await expect(admin.getByText("Vehicle saved.")).toBeVisible();
  await submitCheck(driver, `${name} (${rego})`, "1150", {
    fail: "Headlights, tail lights and brake lights working",
    notes: "No headlights at all",
    severity: "Critical (do not drive)",
  });

  // The workshop fixes one critical defect: the vehicle stays off road.
  await workshop.goto("/defects");
  const cards = workshop.locator("li").filter({ has: workshop.getByRole("heading", { name, exact: true }) });
  await expect(cards).toHaveCount(2);
  await cards.first().getByLabel("Workshop notes").fill("Fixed the first fault");
  await cards.first().getByRole("button", { name: "Mark fixed" }).click();
  await expect(workshop.getByText("The vehicle stays off road because it has another critical defect.")).toBeVisible();
  await workshop.goto("/fleet");
  await expect(vehicleCard(workshop, name).getByText("Off road")).toBeVisible();

  // Fixing the last critical defect puts it back in service.
  await workshop.goto("/defects");
  await cards.first().getByRole("button", { name: "Start work" }).click();
  await expect(workshop.getByText("Marked as in progress.")).toBeVisible();
  await cards.first().getByRole("button", { name: "Mark fixed" }).click();
  await expect(workshop.getByText("The vehicle is back in service.")).toBeVisible();
  await workshop.goto("/fleet");
  await expect(vehicleCard(workshop, name).getByText("In service")).toBeVisible();
});

test("admin edits the fleet, the checklist and team roles", async ({ browser }, info) => {
  const admin = await pageAs(browser, "admin", info);
  const name = `Admin Van ${uid()}`;
  await addVehicle(admin, name, `A${uid()}`);

  // Edit the vehicle.
  await vehicleCard(admin, name).getByRole("link", { name: "Edit" }).click();
  const edit = admin.getByRole("dialog", { name: `Edit ${name}` });
  await edit.getByLabel("Odometer (km)").fill("2500");
  await edit.getByLabel("Notes (optional)", { exact: true }).fill("Spare key in the office");
  await edit.getByRole("button", { name: "Save vehicle" }).click();
  await expect(admin.getByText("Vehicle saved.")).toBeVisible();
  await expect(vehicleCard(admin, name).getByText("Odometer: 2,500 km")).toBeVisible();

  // Checklist: add, rename, switch off and on, delete.
  const label = `Fire extinguisher ${uid()}`;
  await admin.goto("/setup");
  await admin.getByLabel("New checklist item").fill(label);
  await admin.getByRole("button", { name: "Add item" }).click();
  await expect(admin.getByText("Checklist item added.")).toBeVisible();
  const row = admin.locator("#checklist li").filter({ has: admin.locator(`input[value="${label}"]`) });
  await row.locator("input[name=label]").fill(`${label} charged`);
  await row.getByRole("button", { name: "Save" }).click();
  await expect(admin.getByText("Checklist item saved.")).toBeVisible();
  const renamed = admin.locator("#checklist li").filter({ has: admin.locator(`input[value="${label} charged"]`) });
  await renamed.getByRole("button", { name: "Switch off" }).click();
  await expect(renamed.getByRole("button", { name: "Switch on" })).toBeVisible();
  await renamed.getByRole("button", { name: "Delete" }).click();
  await expect(admin.getByText("Checklist item deleted.")).toBeVisible();
  await expect(renamed).toHaveCount(0);

  // A new person signs up, waits, and is approved as a driver.
  const newbie = await freshPage(browser, info);
  const email = `new-${uid().toLowerCase()}@example.com`;
  await newbie.goto("/signup");
  await newbie.getByLabel("Full name").fill(`New Driver ${uid()}`);
  await newbie.getByLabel("Email").fill(email);
  await newbie.getByLabel("Password").fill("a-strong-password");
  await newbie.getByRole("button", { name: "Create account" }).click();
  await expect(newbie).toHaveURL(/\/waiting$/);

  await admin.goto("/setup");
  const member = admin.locator("#team li").filter({ hasText: email });
  await expect(member.getByText("Waiting for approval")).toBeVisible();
  await member.getByRole("button", { name: "Driver" }).click();
  await expect(admin.getByText("Role updated.")).toBeVisible();
  await newbie.goto("/");
  await expect(newbie).toHaveURL(/\/check$/);

  // Remove their access again: they are signed out straight away.
  await admin.locator("#team li").filter({ hasText: email }).getByRole("button", { name: "Remove access" }).click();
  await expect(admin.getByText("Access removed.")).toBeVisible();
  await newbie.goto("/check");
  await expect(newbie).toHaveURL(/\/login/);
  await expect(newbie.getByText("Your session has ended")).toBeVisible();
});

test("a pending user only sees the waiting page", async ({ browser }, info) => {
  const page = await freshPage(browser, info);
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Pending Person");
  await page.getByLabel("Email").fill(`pending-${uid().toLowerCase()}@example.com`);
  await page.getByLabel("Password").fill("a-strong-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/waiting$/);
  await expect(page.getByRole("heading", { name: "Waiting for approval" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  for (const path of ["/check", "/history", "/defects", "/fleet", "/setup", "/account"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/waiting$/);
  }
});

test("pages fit the screen with no sideways scrolling", async ({ browser }, info) => {
  for (const role of ["admin", "driver"] as const) {
    const page = await pageAs(browser, role, info);
    for (const path of [
      "/check",
      "/history",
      "/defects",
      "/fleet",
      "/account",
      ...(role === "admin" ? ["/setup"] : []),
    ]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${role} ${path}`).toBeLessThanOrEqual(0);
      // Every nav link the role can use is visible without scrolling.
      const nav = page.getByRole("navigation", { name: "Main" }).getByRole("link");
      for (const link of await nav.all()) await expect(link).toBeInViewport();
    }
  }
});
