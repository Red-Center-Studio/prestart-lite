import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { defect, vehicle, type Defect } from "../db/schema";
import type { AppUser } from "../env";
import { can } from "../lib/can";

export type DefectActionResult =
  { ok: true; returnedToService?: boolean; stillOffRoad?: boolean } | { ok: false; message: string };

const SEVERITY_ORDER = sql`CASE ${defect.severity} WHEN 'critical' THEN 0 WHEN 'major' THEN 1 ELSE 2 END`;

/** Open and in-progress defects, critical first, then newest. */
export async function listActiveDefects(db: DB, actor: AppUser): Promise<Defect[]> {
  if (!can(actor, "defect:view")) return [];
  return db
    .select()
    .from(defect)
    .where(inArray(defect.status, ["open", "in_progress"]))
    .orderBy(SEVERITY_ORDER, desc(defect.createdAt))
    .all();
}

/** The most recently fixed defects, for the "recently fixed" list. */
export async function listRecentlyFixed(db: DB, actor: AppUser, limit = 10): Promise<Defect[]> {
  if (!can(actor, "defect:view")) return [];
  return db.select().from(defect).where(eq(defect.status, "fixed")).orderBy(desc(defect.fixedAt)).limit(limit).all();
}

export async function getDefect(db: DB, defectId: string): Promise<Defect | undefined> {
  return db.select().from(defect).where(eq(defect.id, defectId)).get();
}

export async function startWork(db: DB, actor: AppUser, defectId: string): Promise<DefectActionResult> {
  if (!can(actor, "defect:work")) return { ok: false, message: "Only the workshop or an admin can do that." };
  const res = await db
    .update(defect)
    .set({ status: "in_progress", updatedAt: new Date().toISOString() })
    .where(and(eq(defect.id, defectId), eq(defect.status, "open")))
    .run();
  if (res.meta.changes === 0) return { ok: false, message: "That defect is no longer open." };
  return { ok: true };
}

export async function saveNotes(db: DB, actor: AppUser, defectId: string, notes: string): Promise<DefectActionResult> {
  if (!can(actor, "defect:work")) return { ok: false, message: "Only the workshop or an admin can do that." };
  const res = await db
    .update(defect)
    .set({ workshopNotes: notes, updatedAt: new Date().toISOString() })
    .where(and(eq(defect.id, defectId), inArray(defect.status, ["open", "in_progress"])))
    .run();
  if (res.meta.changes === 0) return { ok: false, message: "That defect is already fixed or no longer exists." };
  return { ok: true };
}

/**
 * Marks a defect fixed. Fixing a critical defect puts the vehicle back in
 * service only when no other open or in-progress critical defect remains on it. Both writes run in one batch,
 * and the vehicle update checks the remaining defects inside the same transaction.
 */
export async function markFixed(db: DB, actor: AppUser, defectId: string, notes: string): Promise<DefectActionResult> {
  if (!can(actor, "defect:work")) return { ok: false, message: "Only the workshop or an admin can do that." };
  const d = await getDefect(db, defectId);
  if (!d || d.status === "fixed") return { ok: false, message: "That defect is already fixed or no longer exists." };

  const nowIso = new Date().toISOString();
  const fix = db
    .update(defect)
    .set({ status: "fixed", fixedAt: nowIso, fixedById: actor.id, workshopNotes: notes, updatedAt: nowIso })
    .where(and(eq(defect.id, defectId), inArray(defect.status, ["open", "in_progress"])));

  if (d.severity !== "critical") {
    const res = await fix.run();
    if (res.meta.changes === 0) return { ok: false, message: "That defect is already fixed." };
    return { ok: true, returnedToService: false };
  }

  const returnToService = db
    .update(vehicle)
    .set({ status: "in_service", updatedAt: nowIso })
    .where(
      and(
        eq(vehicle.id, d.vehicleId),
        eq(vehicle.status, "off_road"),
        sql`NOT EXISTS (SELECT 1 FROM ${defect} WHERE ${defect.vehicleId} = ${d.vehicleId} AND ${defect.severity} = 'critical' AND ${defect.status} IN ('open', 'in_progress'))`,
      ),
    );
  const [fixRes, vehicleRes] = await db.batch([fix, returnToService]);
  if (fixRes.meta.changes === 0) return { ok: false, message: "That defect is already fixed." };
  if ((vehicleRes.meta.changes ?? 0) > 0) return { ok: true, returnedToService: true };
  const v = await db.select({ status: vehicle.status }).from(vehicle).where(eq(vehicle.id, d.vehicleId)).get();
  return { ok: true, returnedToService: false, stillOffRoad: v?.status === "off_road" };
}
