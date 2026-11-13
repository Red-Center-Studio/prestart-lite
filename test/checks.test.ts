import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { check, checkResult, defect, vehicle } from "../src/db/schema";
import { submitCheck, type SubmitInput } from "../src/services/checks";
import { db, makeItems, makeUser, makeVehicle } from "./helpers";

const input = (overrides: Partial<SubmitInput> & Pick<SubmitInput, "vehicleId">): SubmitInput => ({
  submissionId: crypto.randomUUID(),
  odometer: 1500,
  ok: [],
  notes: "",
  severity: "minor",
  confirmLower: false,
  reportAnyway: false,
  ...overrides,
});

describe("check submit batch", () => {
  it("saves a passing check with one result per active item and updates the odometer", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    const items = await makeItems();
    const res = await submitCheck(db(), driver, input({ vehicleId: v, ok: items }));
    expect(res.kind).toBe("saved");
    if (res.kind !== "saved") return;
    expect(res.passed).toBe(true);
    expect(res.defectId).toBeNull();

    const saved = await db().select().from(check).where(eq(check.id, res.checkId)).get();
    expect(saved).toMatchObject({ passed: true, driverId: driver.id, driverName: driver.name, vehicleName: "Hilux" });
    const results = await db().select().from(checkResult).where(eq(checkResult.checkId, res.checkId)).all();
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
    const veh = await db().select().from(vehicle).where(eq(vehicle.id, v)).get();
    expect(veh?.odometerKm).toBe(1500);
    expect(await db().select().from(defect).all()).toHaveLength(0);
  });

  it("creates one defect for failed items, with the description format from the spec", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    const [tyres, lights, brakes] = await makeItems();
    const res = await submitCheck(
      db(),
      driver,
      input({ vehicleId: v, ok: [tyres ?? ""], notes: "Left indicator out", severity: "major" }),
    );
    expect(res.kind).toBe("saved");
    if (res.kind !== "saved") return;
    expect(res.passed).toBe(false);
    expect(res.failed).toEqual(["Lights", "Brakes"]);
    const d = await db().select().from(defect).where(eq(defect.checkId, res.checkId)).get();
    expect(d).toMatchObject({
      description: "Failed: Lights, Brakes. Driver notes: Left indicator out",
      severity: "major",
      status: "open",
      reportedById: driver.id,
      vehicleId: v,
    });
    const results = await db().select().from(checkResult).where(eq(checkResult.checkId, res.checkId)).all();
    expect(
      results
        .filter((r) => !r.ok)
        .map((r) => r.checklistItemId)
        .sort(),
    ).toEqual([lights, brakes].sort());
    const veh = await db().select().from(vehicle).where(eq(vehicle.id, v)).get();
    expect(veh?.status).toBe("in_service");
  });

  it("takes the vehicle off road for a critical fault", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    await makeItems(["Brakes"]);
    const res = await submitCheck(db(), driver, input({ vehicleId: v, notes: "No brakes", severity: "critical" }));
    expect(res.kind === "saved" && res.offRoad).toBe(true);
    const veh = await db().select().from(vehicle).where(eq(vehicle.id, v)).get();
    expect(veh?.status).toBe("off_road");
  });

  it("does not take the vehicle off road for minor or major faults", async () => {
    const driver = await makeUser("driver");
    for (const severity of ["minor", "major"] as const) {
      const v = await makeVehicle();
      await makeItems(["Item"]);
      await submitCheck(db(), driver, input({ vehicleId: v, notes: "x problem", severity }));
      const veh = await db().select().from(vehicle).where(eq(vehicle.id, v)).get();
      expect(veh?.status).toBe("in_service");
    }
  });

  it("rejects checks on an off-road vehicle even from a crafted request", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle({ status: "off_road" });
    const items = await makeItems();
    const res = await submitCheck(db(), driver, input({ vehicleId: v, ok: items }));
    expect(res).toMatchObject({ kind: "error" });
    expect(await db().select().from(check).all()).toHaveLength(0);
  });

  it("rejects a vehicle that does not exist", async () => {
    const driver = await makeUser("driver");
    await makeItems();
    const res = await submitCheck(db(), driver, input({ vehicleId: crypto.randomUUID() }));
    expect(res.kind).toBe("error");
  });

  it("rejects users without a role", async () => {
    const pending = await makeUser(null);
    const v = await makeVehicle();
    const items = await makeItems();
    const res = await submitCheck(db(), pending, input({ vehicleId: v, ok: items }));
    expect(res.kind).toBe("error");
    expect(await db().select().from(check).all()).toHaveLength(0);
  });

  it("lets every role with access submit", async () => {
    const v = await makeVehicle();
    const items = await makeItems();
    for (const role of ["driver", "workshop", "admin"] as const) {
      const u = await makeUser(role);
      const res = await submitCheck(db(), u, input({ vehicleId: v, ok: items }));
      expect(res.kind).toBe("saved");
    }
  });

  it("rejects a negative or fractional odometer", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    const items = await makeItems();
    for (const odometer of [-1, 12.5, Number.NaN]) {
      const res = await submitCheck(db(), driver, input({ vehicleId: v, ok: items, odometer }));
      expect(res.kind).toBe("error");
    }
    expect(await db().select().from(check).all()).toHaveLength(0);
  });

  it("asks to confirm a lower odometer reading, then saves it flagged", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle({ odometerKm: 5000 });
    const items = await makeItems();
    const first = await submitCheck(db(), driver, input({ vehicleId: v, ok: items, odometer: 4900 }));
    expect(first).toEqual({ kind: "odometer_lower", lastReading: 5000 });
    expect(await db().select().from(check).all()).toHaveLength(0);

    const confirmed = await submitCheck(
      db(),
      driver,
      input({ vehicleId: v, ok: items, odometer: 4900, confirmLower: true }),
    );
    expect(confirmed.kind).toBe("saved");
    if (confirmed.kind !== "saved") return;
    const saved = await db().select().from(check).where(eq(check.id, confirmed.checkId)).get();
    expect(saved?.odometerWentBack).toBe(true);
  });

  it("does not flag an equal or higher reading", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle({ odometerKm: 5000 });
    const items = await makeItems();
    for (const odometer of [5000, 5001]) {
      const res = await submitCheck(db(), driver, input({ vehicleId: v, ok: items, odometer }));
      expect(res.kind).toBe("saved");
      if (res.kind !== "saved") continue;
      const saved = await db().select().from(check).where(eq(check.id, res.checkId)).get();
      expect(saved?.odometerWentBack).toBe(false);
    }
  });

  it("refuses to save when no checklist items exist", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    const res = await submitCheck(db(), driver, input({ vehicleId: v }));
    expect(res).toEqual({
      kind: "error",
      message: "No checklist items are set up yet. Ask an admin to add them on the Setup page.",
    });
  });

  it("requires a description when something failed", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    await makeItems();
    const res = await submitCheck(db(), driver, input({ vehicleId: v, notes: "   " }));
    expect(res.kind).toBe("error");
    expect(await db().select().from(check).all()).toHaveLength(0);
  });

  it("ignores switched-off items and ids that are not on the checklist", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    const [active] = await makeItems(["Active"]);
    const offId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO checklist_item (id, label, sort, active) VALUES (?, 'Off', 9, 0)")
      .bind(offId)
      .run();
    const res = await submitCheck(db(), driver, input({ vehicleId: v, ok: [active ?? "", crypto.randomUUID()] }));
    expect(res.kind === "saved" && res.passed).toBe(true);
    if (res.kind !== "saved") return;
    const results = await db().select().from(checkResult).where(eq(checkResult.checkId, res.checkId)).all();
    expect(results.map((r) => r.label)).toEqual(["Active"]);
  });

  it("treats a resubmitted form (double click) as one check", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    await makeItems(["One"]);
    const same = input({ vehicleId: v, notes: "Broken", severity: "minor" });
    const [a, b] = await Promise.all([submitCheck(db(), driver, same), submitCheck(db(), driver, same)]);
    expect([a.kind, b.kind].sort()).toEqual(["duplicate", "saved"]);
    expect(await db().select().from(check).all()).toHaveLength(1);
    expect(await db().select().from(defect).all()).toHaveLength(1);
  });

  it("'report a problem anyway' creates a defect while the check still passes", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    const items = await makeItems();
    const res = await submitCheck(
      db(),
      driver,
      input({ vehicleId: v, ok: items, notes: "Strange noise from the gearbox", reportAnyway: true }),
    );
    expect(res.kind === "saved" && res.passed).toBe(true);
    if (res.kind !== "saved") return;
    const d = await db().select().from(defect).where(eq(defect.checkId, res.checkId)).get();
    expect(d).toMatchObject({ description: "Reported by driver: Strange noise from the gearbox", severity: "minor" });
  });

  it("saves notes typed with everything ticked, without a defect, unless reported", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    const items = await makeItems();
    const res = await submitCheck(db(), driver, input({ vehicleId: v, ok: items, notes: "All good today" }));
    expect(res.kind).toBe("saved");
    expect(await db().select().from(defect).all()).toHaveLength(0);
  });

  it("is all or nothing: a failing write saves neither the check nor the defect", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    await makeItems(["One"]);
    // A severity outside the allowed list breaks the defect insert (SQL CHECK constraint) mid-batch.
    await expect(
      submitCheck(db(), driver, input({ vehicleId: v, notes: "Broken", severity: "explode" as never })),
    ).rejects.toThrow();
    expect(await db().select().from(check).all()).toHaveLength(0);
    expect(await db().select().from(checkResult).all()).toHaveLength(0);
    const veh = await db().select().from(vehicle).where(eq(vehicle.id, v)).get();
    expect(veh?.odometerKm).toBe(1000);
  });

  it("stores and links a photo, and removes it if the save fails", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    await makeItems(["One"]);
    const file = new File([new Uint8Array([1, 2, 3])], "p.jpg", { type: "image/jpeg" });
    const res = await submitCheck(db(), driver, input({ vehicleId: v, notes: "Dent", severity: "minor" }), {
      file,
      bucket: env.PHOTOS,
    });
    expect(res.kind).toBe("saved");
    if (res.kind !== "saved") return;
    const saved = await db().select().from(check).where(eq(check.id, res.checkId)).get();
    expect(saved?.photoKey).toMatch(/^checks\//);
    const d = await db().select().from(defect).where(eq(defect.checkId, res.checkId)).get();
    expect(d?.photoKey).toBe(saved?.photoKey);
    expect(await env.PHOTOS.get(saved?.photoKey ?? "")).not.toBeNull();

    const before = (await env.PHOTOS.list()).objects.length;
    await expect(
      submitCheck(db(), driver, input({ vehicleId: v, odometer: 2000, notes: "x", severity: "bad" as never }), {
        file,
        bucket: env.PHOTOS,
      }),
    ).rejects.toThrow();
    expect((await env.PHOTOS.list()).objects.length).toBe(before);
  });
});
