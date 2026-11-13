import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { DB } from "../db/client";
import { check, checkResult, checklistItem, defect, vehicle, type Check, type CheckResult } from "../db/schema";
import type { Severity } from "../labels";
import type { AppUser } from "../env";
import { can } from "../lib/can";
import { storePhoto } from "../lib/photos";

export interface SubmitInput {
  submissionId: string;
  vehicleId: string;
  odometer: number;
  ok: string[];
  notes: string;
  severity: Severity;
  confirmLower: boolean;
  reportAnyway: boolean;
}

export interface PhotoUpload {
  file: File;
  bucket: R2Bucket;
}

export type SubmitResult =
  | { kind: "saved"; checkId: string; passed: boolean; defectId: string | null; offRoad: boolean; failed: string[] }
  | { kind: "duplicate"; checkId: string }
  | { kind: "odometer_lower"; lastReading: number }
  | { kind: "error"; message: string };

export function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// Only a repeated check id counts as a duplicate. Other constraint failures are real errors.
const isUniqueViolation = (err: unknown): boolean => {
  const text = `${String(err)} ${err instanceof Error && err.cause instanceof Error ? err.cause.message : ""}`;
  return /UNIQUE constraint failed: check\.id/i.test(text);
};

/**
 * Saves a pre-start check. Everything is written in one D1 batch (a single transaction), so a check is never
 * saved without its results, its defect or its vehicle update.
 */
export async function submitCheck(
  db: DB,
  actor: AppUser,
  input: SubmitInput,
  photo: PhotoUpload | null = null,
): Promise<SubmitResult> {
  if (!can(actor, "check:submit")) return { kind: "error", message: "You do not have access to submit checks." };

  const existing = await db.select({ id: check.id }).from(check).where(eq(check.id, input.submissionId)).get();
  if (existing) return { kind: "duplicate", checkId: existing.id };

  const v = await db.select().from(vehicle).where(eq(vehicle.id, input.vehicleId)).get();
  if (!v) return { kind: "error", message: "That vehicle no longer exists. Pick another one." };
  if (v.status !== "in_service") {
    return { kind: "error", message: "That vehicle is off road. It cannot be checked until the workshop fixes it." };
  }
  if (!Number.isInteger(input.odometer) || input.odometer < 0) {
    return { kind: "error", message: "Odometer must be a whole number of 0 or more." };
  }
  const wentBack = input.odometer < v.odometerKm;
  if (wentBack && !input.confirmLower) return { kind: "odometer_lower", lastReading: v.odometerKm };

  const items = await db
    .select()
    .from(checklistItem)
    .where(eq(checklistItem.active, true))
    .orderBy(asc(checklistItem.sort), asc(checklistItem.createdAt))
    .all();
  if (items.length === 0) {
    return { kind: "error", message: "No checklist items are set up yet. Ask an admin to add them on the Setup page." };
  }

  const ticked = new Set(input.ok);
  const failed = items.filter((i) => !ticked.has(i.id));
  const passed = failed.length === 0;
  const notes = input.notes.trim();

  if (!passed && notes.length === 0) return { kind: "error", message: "Describe the problem before you submit." };
  if (passed && input.reportAnyway && notes.length === 0) {
    return { kind: "error", message: "Describe the problem you want to report." };
  }

  const raiseDefect = !passed || (input.reportAnyway && notes.length > 0);
  const severity: Severity = raiseDefect ? input.severity : "minor";
  const defectId = raiseDefect ? crypto.randomUUID() : null;
  const offRoad = raiseDefect && severity === "critical";
  const nowIso = new Date().toISOString();
  const checkId = input.submissionId;
  // Stored only after every check above has passed, and removed again if the save fails.
  const photoKey = photo ? await storePhoto(photo.bucket, "checks", photo.file) : null;

  const description = passed
    ? `Reported by driver: ${notes}`
    : `Failed: ${failed.map((f) => f.label).join(", ")}. Driver notes: ${notes}`;

  const insertCheck = db.insert(check).values({
    id: checkId,
    vehicleId: v.id,
    vehicleName: v.name,
    driverId: actor.id,
    driverName: actor.name,
    odometerKm: input.odometer,
    odometerWentBack: wentBack,
    passed,
    notes,
    photoKey,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  // D1 allows at most 100 bound values per statement, so results go in chunks of 10 rows (7 values each).
  const resultRows = items.map((i) => ({
    id: crypto.randomUUID(),
    checkId,
    checklistItemId: i.id,
    label: i.label,
    ok: ticked.has(i.id),
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  const insertResults = chunk(resultRows, 10).map((rows) => db.insert(checkResult).values(rows));
  const updateVehicle = db
    .update(vehicle)
    .set({ odometerKm: input.odometer, updatedAt: nowIso, ...(offRoad ? { status: "off_road" as const } : {}) })
    .where(eq(vehicle.id, v.id));

  try {
    if (defectId) {
      const insertDefect = db.insert(defect).values({
        id: defectId,
        vehicleId: v.id,
        vehicleName: v.name,
        checkId,
        description: description.slice(0, 2000),
        severity,
        status: "open",
        reportedById: actor.id,
        reportedByName: actor.name,
        photoKey,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      await db.batch([insertCheck, ...insertResults, insertDefect, updateVehicle]);
    } else {
      await db.batch([insertCheck, ...insertResults, updateVehicle]);
    }
  } catch (err) {
    if (photo && photoKey) await photo.bucket.delete(photoKey).catch(() => undefined);
    // A double click or a resent form arrives with the same submission id: treat it as already saved.
    if (isUniqueViolation(err)) return { kind: "duplicate", checkId };
    throw err;
  }

  return { kind: "saved", checkId, passed, defectId, offRoad, failed: failed.map((f) => f.label) };
}

export interface HistoryFilter {
  vehicle?: string | undefined;
  driver?: string | undefined;
  from?: string | null | undefined;
  to?: string | null | undefined;
  result?: "pass" | "fail" | undefined;
  page: number;
}

export const HISTORY_PAGE_SIZE = 25;

/** Past checks, newest first. Drivers only ever get their own, whatever filter they send. */
export async function listChecks(db: DB, actor: AppUser, filter: HistoryFilter) {
  if (!can(actor, "check:submit")) return { rows: [] as Check[], hasMore: false };
  const where: SQL[] = [];
  if (!can(actor, "check:viewAll")) where.push(eq(check.driverId, actor.id));
  else if (filter.driver) where.push(eq(check.driverId, filter.driver));
  if (filter.vehicle) where.push(eq(check.vehicleId, filter.vehicle));
  if (filter.from) where.push(gte(check.createdAt, `${filter.from}T00:00:00.000Z`));
  if (filter.to) where.push(lte(check.createdAt, `${filter.to}T23:59:59.999Z`));
  if (filter.result === "pass") where.push(eq(check.passed, true));
  if (filter.result === "fail") where.push(eq(check.passed, false));

  const rows = await db
    .select()
    .from(check)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(check.createdAt), desc(check.id))
    .limit(HISTORY_PAGE_SIZE + 1)
    .offset((filter.page - 1) * HISTORY_PAGE_SIZE)
    .all();
  return { rows: rows.slice(0, HISTORY_PAGE_SIZE), hasMore: rows.length > HISTORY_PAGE_SIZE };
}

/** One check with its results, or null when it does not exist or the user may not see it. */
export async function getCheck(
  db: DB,
  actor: AppUser,
  checkId: string,
): Promise<{ check: Check; results: CheckResult[] } | null> {
  const row = await db.select().from(check).where(eq(check.id, checkId)).get();
  if (!row || !can(actor, "check:view", { ownerId: row.driverId })) return null;
  const results = await db
    .select()
    .from(checkResult)
    .where(eq(checkResult.checkId, checkId))
    // rowid keeps the order the items were saved in, which is the checklist order at the time.
    .orderBy(sql`rowid`)
    .all();
  return { check: row, results };
}

/** Distinct drivers who have submitted checks, for the history filter. */
export async function checkDrivers(db: DB) {
  return db
    .select({ id: check.driverId, name: sql<string>`max(${check.driverName})` })
    .from(check)
    .groupBy(check.driverId)
    .orderBy(asc(sql`max(${check.driverName})`))
    .all();
}
