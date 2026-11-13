import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { defect, vehicle } from "../src/db/schema";
import { listActiveDefects, markFixed, saveNotes, startWork } from "../src/services/defects";
import { db, makeUser, makeVehicle } from "./helpers";

async function makeDefect(
  vehicleId: string,
  severity: "minor" | "major" | "critical",
  status: "open" | "in_progress" = "open",
) {
  const id = crypto.randomUUID();
  const reporter = await makeUser("driver");
  await db()
    .insert(defect)
    .values({
      id,
      vehicleId,
      vehicleName: "Hilux",
      description: `${severity} fault`,
      severity,
      status,
      reportedById: reporter.id,
      reportedByName: reporter.name,
    });
  return id;
}

const vehicleStatus = async (id: string) => (await db().select().from(vehicle).where(eq(vehicle.id, id)).get())?.status;

describe("return-to-service rule", () => {
  it("puts the vehicle back in service when its only critical defect is fixed", async () => {
    const workshop = await makeUser("workshop");
    const v = await makeVehicle({ status: "off_road" });
    const d = await makeDefect(v, "critical");
    const res = await markFixed(db(), workshop, d, "Replaced brake pads");
    expect(res).toEqual({ ok: true, returnedToService: true });
    expect(await vehicleStatus(v)).toBe("in_service");
    const row = await db().select().from(defect).where(eq(defect.id, d)).get();
    expect(row).toMatchObject({ status: "fixed", fixedById: workshop.id, workshopNotes: "Replaced brake pads" });
    expect(row?.fixedAt).toBeTruthy();
  });

  it("keeps the vehicle off road while another critical defect is open or in progress", async () => {
    const admin = await makeUser("admin");
    const v = await makeVehicle({ status: "off_road" });
    const first = await makeDefect(v, "critical");
    const second = await makeDefect(v, "critical", "in_progress");

    const res1 = await markFixed(db(), admin, first, "");
    expect(res1).toEqual({ ok: true, returnedToService: false, stillOffRoad: true });
    expect(await vehicleStatus(v)).toBe("off_road");

    const res2 = await markFixed(db(), admin, second, "");
    expect(res2).toEqual({ ok: true, returnedToService: true });
    expect(await vehicleStatus(v)).toBe("in_service");
  });

  it("ignores critical defects on other vehicles", async () => {
    const admin = await makeUser("admin");
    const v = await makeVehicle({ status: "off_road" });
    const other = await makeVehicle({ status: "off_road" });
    const d = await makeDefect(v, "critical");
    await makeDefect(other, "critical");
    await markFixed(db(), admin, d, "");
    expect(await vehicleStatus(v)).toBe("in_service");
    expect(await vehicleStatus(other)).toBe("off_road");
  });

  it("does not return a vehicle to service when a minor or major defect is fixed", async () => {
    const admin = await makeUser("admin");
    const v = await makeVehicle({ status: "off_road" });
    await makeDefect(v, "critical");
    for (const severity of ["minor", "major"] as const) {
      const d = await makeDefect(v, severity);
      const res = await markFixed(db(), admin, d, "");
      expect(res.ok).toBe(true);
      expect(await vehicleStatus(v)).toBe("off_road");
    }
  });

  it("does not touch a vehicle an admin took off road by hand when a minor defect is fixed", async () => {
    const admin = await makeUser("admin");
    const v = await makeVehicle({ status: "off_road" });
    const d = await makeDefect(v, "minor");
    await markFixed(db(), admin, d, "");
    expect(await vehicleStatus(v)).toBe("off_road");
  });

  it("refuses to fix the same defect twice", async () => {
    const admin = await makeUser("admin");
    const v = await makeVehicle({ status: "off_road" });
    const d = await makeDefect(v, "critical");
    expect((await markFixed(db(), admin, d, "")).ok).toBe(true);
    expect((await markFixed(db(), admin, d, "")).ok).toBe(false);
  });
});

describe("defect actions by role", () => {
  it("workshop and admin can start work, add notes and fix", async () => {
    for (const role of ["workshop", "admin"] as const) {
      const u = await makeUser(role);
      const v = await makeVehicle();
      const d = await makeDefect(v, "major");
      expect(await startWork(db(), u, d)).toEqual({ ok: true });
      expect(await saveNotes(db(), u, d, "Parts ordered")).toEqual({ ok: true });
      const row = await db().select().from(defect).where(eq(defect.id, d)).get();
      expect(row).toMatchObject({ status: "in_progress", workshopNotes: "Parts ordered" });
      expect((await markFixed(db(), u, d, "Done")).ok).toBe(true);
    }
  });

  it("drivers and pending users cannot start work, add notes or fix", async () => {
    const v = await makeVehicle({ status: "off_road" });
    const d = await makeDefect(v, "critical");
    for (const role of ["driver", null] as const) {
      const u = await makeUser(role);
      expect((await startWork(db(), u, d)).ok).toBe(false);
      expect((await saveNotes(db(), u, d, "x")).ok).toBe(false);
      expect((await markFixed(db(), u, d, "x")).ok).toBe(false);
    }
    const row = await db().select().from(defect).where(eq(defect.id, d)).get();
    expect(row).toMatchObject({ status: "open", workshopNotes: "" });
    expect(await vehicleStatus(v)).toBe("off_road");
  });

  it("start work only applies to open defects", async () => {
    const u = await makeUser("workshop");
    const v = await makeVehicle();
    const d = await makeDefect(v, "minor", "in_progress");
    expect((await startWork(db(), u, d)).ok).toBe(false);
  });

  it("lists critical defects first and hides fixed ones", async () => {
    const u = await makeUser("driver");
    const v = await makeVehicle();
    await makeDefect(v, "minor");
    await makeDefect(v, "critical");
    await makeDefect(v, "major");
    const fixed = await makeDefect(v, "critical");
    await markFixed(db(), await makeUser("admin"), fixed, "");
    const list = await listActiveDefects(db(), u);
    expect(list.map((d) => d.severity)).toEqual(["critical", "major", "minor"]);
    expect(await listActiveDefects(db(), await makeUser(null))).toEqual([]);
  });
});
