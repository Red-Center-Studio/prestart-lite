import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { check, checklistItem, defect, user, vehicle } from "../src/db/schema";
import { createAuth, PUBLIC_PLACEHOLDER_SECRETS } from "../src/auth/auth";
import { resetDemo } from "../src/services/demo";
import { addStandardChecklist, deleteVehicle, moveChecklistItem, listChecklist } from "../src/services/fleet";
import { submitCheck } from "../src/services/checks";
import { DEMO_ACCOUNTS } from "../src/seed/demo";
import type { Bindings } from "../src/env";
import { Browser, db, location, makeItems, makeUser, makeVehicle, signedIn } from "./helpers";

describe("hostile edge cases", () => {
  it("shows a clear message when there are no vehicles to check", async () => {
    await makeItems();
    const { browser } = await signedIn("driver");
    const html = await (await browser.get("/check")).text();
    expect(html).toContain("There are no vehicles in service to check");
  });

  it("shows a clear message when every vehicle is off road", async () => {
    await makeItems();
    await makeVehicle({ status: "off_road" });
    const { browser } = await signedIn("driver");
    expect(await (await browser.get("/check")).text()).toContain("There are no vehicles in service to check");
  });

  it("shows the spec's message when the checklist is empty", async () => {
    await makeVehicle();
    const { browser } = await signedIn("driver");
    expect(await (await browser.get("/check")).text()).toContain(
      "No checklist items are set up yet. Ask an admin to add them on the Setup page.",
    );
  });

  it("rejects very long text everywhere instead of storing it", async () => {
    const v = await makeVehicle();
    await makeItems(["One"]);
    const { browser } = await signedIn("admin");
    const huge = "x".repeat(5000);
    const responses = await Promise.all([
      browser.post("/check", { submissionId: crypto.randomUUID(), vehicleId: v, odometer: "1", notes: huge }),
      browser.post("/fleet", { name: "Ute", odometer: "1", notes: huge }),
      browser.post("/setup/business", { businessName: huge }),
      browser.post("/account/name", { fullName: huge }),
      browser.post("/signup", { fullName: huge, email: "long@example.com", password: "long-enough" }),
      browser.post("/fleet", { name: "Ute", odometer: "99999999" }),
    ]);
    for (const res of responses) expect(res.status).toBe(400);
    expect(await db().select().from(check).all()).toHaveLength(0);
  });

  it("refuses to delete a vehicle with open defects, and keeps history when it is deleted later", async () => {
    const admin = await makeUser("admin");
    const driver = await makeUser("driver");
    const v = await makeVehicle({ name: "Old Ute" });
    await makeItems(["Brakes"]);
    const res = await submitCheck(db(), driver, {
      submissionId: crypto.randomUUID(),
      vehicleId: v,
      odometer: 2000,
      ok: [],
      notes: "Grinding",
      severity: "major",
      confirmLower: false,
      reportAnyway: false,
    });
    expect(res.kind).toBe("saved");
    expect(await deleteVehicle(db(), admin, v)).toEqual({
      ok: false,
      message: "This vehicle has open defects. Fix or close them before deleting it.",
    });
    await db().update(defect).set({ status: "fixed" }).where(eq(defect.vehicleId, v));
    expect(await deleteVehicle(db(), admin, v)).toEqual({ ok: true });
    expect(await db().select().from(vehicle).where(eq(vehicle.id, v)).all()).toHaveLength(0);
    // The check and defect stay, with the vehicle name they were saved with.
    const saved = await db().select().from(check).get();
    expect(saved?.vehicleName).toBe("Old Ute");
    expect((await db().select().from(defect).get())?.vehicleName).toBe("Old Ute");
  });

  it("only admins can delete vehicles", async () => {
    const v = await makeVehicle();
    for (const role of ["driver", "workshop", null] as const) {
      expect((await deleteVehicle(db(), await makeUser(role), v)).ok).toBe(false);
    }
    expect(await db().select().from(vehicle).all()).toHaveLength(1);
  });

  it("handles a vehicle deleted while a driver had the form open", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    await makeItems(["One"]);
    await db().delete(vehicle).where(eq(vehicle.id, v));
    const res = await submitCheck(db(), driver, {
      submissionId: crypto.randomUUID(),
      vehicleId: v,
      odometer: 1,
      ok: [],
      notes: "x",
      severity: "minor",
      confirmLower: false,
      reportAnyway: false,
    });
    expect(res).toEqual({ kind: "error", message: "That vehicle no longer exists. Pick another one." });
  });

  it("adds the standard checklist once, even if clicked twice", async () => {
    const admin = await makeUser("admin");
    expect(await addStandardChecklist(db(), admin)).toEqual({ ok: true, value: 8 });
    expect(await addStandardChecklist(db(), admin)).toEqual({ ok: true, value: 0 });
    expect(await db().select().from(checklistItem).all()).toHaveLength(8);
  });

  it("moves checklist items and ignores moves past either end", async () => {
    const admin = await makeUser("admin");
    const [a, b, c] = await makeItems(["A", "B", "C"]);
    await moveChecklistItem(db(), admin, c ?? "", "up");
    await moveChecklistItem(db(), admin, a ?? "", "up");
    await moveChecklistItem(db(), admin, b ?? "", "down");
    expect((await listChecklist(db(), admin)).map((i) => i.label)).toEqual(["A", "C", "B"]);
    expect((await moveChecklistItem(db(), await makeUser("driver"), a ?? "", "down")).ok).toBe(false);
  });

  it("works the defect queue through the real forms", async () => {
    const v = await makeVehicle({ status: "off_road" });
    const reporter = await makeUser("driver");
    const id = crypto.randomUUID();
    await db().insert(defect).values({
      id,
      vehicleId: v,
      vehicleName: "Hilux",
      description: "Brakes",
      severity: "critical",
      reportedById: reporter.id,
      reportedByName: reporter.name,
    });
    const { browser } = await signedIn("workshop");
    expect(location(await browser.post(`/defects/${id}/fix`, { op: "start", workshopNotes: "On it" }))).toBe(
      "/defects?m=started",
    );
    expect(location(await browser.post(`/defects/${id}/fix`, { op: "notes", workshopNotes: "Pads ordered" }))).toBe(
      "/defects?m=notes",
    );
    expect(location(await browser.post(`/defects/${id}/fix`, { op: "fix", workshopNotes: "Done" }))).toBe(
      "/defects?m=fixed-in-service",
    );
    expect((await db().select().from(vehicle).where(eq(vehicle.id, v)).get())?.status).toBe("in_service");
    expect((await db().select().from(defect).where(eq(defect.id, id)).get())?.workshopNotes).toBe("Done");
    expect((await browser.post(`/defects/${id}/fix`, { op: "unknown" })).status).toBe(400);
  });

  it("changes a user's own name and email, and blocks demo accounts from doing so", async () => {
    const { browser, user: me } = await signedIn("driver");
    expect(location(await browser.post("/account/name", { fullName: "Renamed Person" }))).toBe("/account?m=name");
    expect(location(await browser.post("/account/email", { email: "renamed@example.com" }))).toMatch(
      /^\/account\?m=email/,
    );
    const row = await db().select().from(user).where(eq(user.id, me.id)).get();
    expect(row?.name).toBe("Renamed Person");
    expect(row?.email).toBe("renamed@example.com");

    await db().update(user).set({ isDemo: true }).where(eq(user.id, me.id));
    expect((await browser.post("/account/name", { fullName: "Hacker" })).status).toBe(403);
    expect(
      (
        await browser.post("/account/password", {
          currentPassword: "x",
          newPassword: "longer-pass",
          confirm: "longer-pass",
        })
      ).status,
    ).toBe(403);
  });

  it("changes a password, and the old one stops working", async () => {
    const { browser, user: me } = await signedIn("driver");
    const res = await browser.post("/account/password", {
      currentPassword: "correct-horse-battery",
      newPassword: "new-battery-staple",
      confirm: "new-battery-staple",
    });
    expect(location(res)).toBe("/account?m=password");
    expect((await new Browser().post("/login", { email: me.email, password: "correct-horse-battery" })).status).toBe(
      401,
    );
    expect((await new Browser().post("/login", { email: me.email, password: "new-battery-staple" })).status).toBe(303);
    const wrong = await browser.post("/account/password", {
      currentPassword: "not-my-password",
      newPassword: "another-password",
      confirm: "another-password",
    });
    expect(wrong.status).toBe(401);
  });

  it("refuses to start without a strong AUTH_SECRET", () => {
    const weak = { ...env, AUTH_SECRET: "short" } as unknown as Bindings;
    expect(() => createAuth(weak, "https://x.test")).toThrow(/AUTH_SECRET/);
  });

  it("refuses the public example secret on a live address, but allows it on localhost", () => {
    for (const placeholder of PUBLIC_PLACEHOLDER_SECRETS) {
      const example = { ...env, AUTH_SECRET: placeholder } as unknown as Bindings;
      expect(() => createAuth(example, "https://fleet.example.com")).toThrow(/placeholder/);
      expect(() => createAuth(example, "https://prestart.someone.workers.dev")).toThrow(/placeholder/);
      expect(() => createAuth(example, "http://localhost:8787")).not.toThrow();
      expect(() => createAuth(example, "http://127.0.0.1:8791")).not.toThrow();
    }
  });

  it("does not reveal whether an email has an account when asking for a reset", async () => {
    const { user: me } = await signedIn("driver");
    const a = await new Browser().post("/forgot-password", { email: me.email });
    const b = await new Browser().post("/forgot-password", { email: "nobody@example.com" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const text = (html: string) => html.replace(/name="_csrf" value="[a-f0-9]+"/, "");
    expect(text(await a.text())).toBe(text(await b.text()));
  });
});

describe("demo reset", () => {
  const demoEnv = () => ({ ...env, DEMO_MODE: "true" }) as unknown as Bindings;

  it("does nothing unless demo mode is on", async () => {
    await makeVehicle({ name: "Real fleet ute" });
    expect(await resetDemo(env as unknown as Bindings)).toBe(false);
    expect(await db().select().from(vehicle).all()).toHaveLength(1);
  });

  it("wipes everything and loads the demo fleet, including photos", async () => {
    await makeVehicle({ name: "Leftover" });
    await env.PHOTOS.put("checks/leftover", "x");
    expect(await resetDemo(demoEnv())).toBe(true);
    const vehicles = await db().select().from(vehicle).all();
    expect(vehicles.map((v) => v.name)).not.toContain("Leftover");
    expect(vehicles).toHaveLength(6);
    expect(await db().select().from(checklistItem).all()).toHaveLength(8);
    expect((await env.PHOTOS.list({ prefix: "checks/" })).objects).toHaveLength(0);
    for (const a of DEMO_ACCOUNTS) {
      const row = await db().select().from(user).where(eq(user.email, a.email)).get();
      expect(row).toMatchObject({ role: a.role, isDemo: true });
    }
    // The seeded off-road truck has its critical defect, so the queue rule holds in the demo too.
    const offRoad = vehicles.filter((v) => v.status === "off_road");
    expect(offRoad).toHaveLength(1);
    const critical = await db()
      .select()
      .from(defect)
      .where(eq(defect.vehicleId, offRoad[0]?.id ?? ""))
      .all();
    expect(critical.some((d) => d.severity === "critical" && d.status === "open")).toBe(true);
  });

  it("lets the demo accounts sign in after a reset", async () => {
    await resetDemo(demoEnv());
    const b = new Browser();
    const res = await b.post("/login", { email: DEMO_ACCOUNTS[2].email, password: "prestart-demo-2026" });
    expect(res.status).toBe(303);
    expect(location(await b.get("/"))).toBe("/check");
  });
});
