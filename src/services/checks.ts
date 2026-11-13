import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  check,
  checkPhoto,
  checkResult,
  checklistItem,
  defect,
  vehicle,
  type Check,
  type CheckPhoto,
  type CheckResult,
} from "../db/schema";
import type { Severity } from "../labels";
import type { AppUser } from "../env";
import { can } from "../lib/can";
import { storePhoto } from "../lib/photos";

/** One answer on the checklist: pass, fail (with a note and how serious it is) or not applicable. */
export interface ItemAnswer {
  itemId: string;
  status: "pass" | "fail" | "na";
  note: string;
  /** How serious a failed item is. The driver must choose; null means they did not. */
  severity: Severity | null;
}

export interface SubmitInput {
  submissionId: string;
  vehicleId: string;
  odometer: number;
  /** Older form: the ids of ticked items. Used only when `answers` is empty. */
  ok: string[];
  /** Other notes. With `reportAnyway`, also the description of an extra problem. */
  notes: string;
  /** Severity of the extra problem (or of the single defect on the older form). */
  severity: Severity;
  confirmLower: boolean;
  reportAnyway: boolean;
  /** Current form: one answer per checklist item. */
  answers?: ItemAnswer[];
}

/** The older single photo for the whole check. */
export interface PhotoUpload {
  file: File;
  bucket: R2Bucket;
}

/** Photos from the current form: some for the check as a whole, some for particular failed items. */
export interface CheckPhotos {
  bucket: R2Bucket;
  overall: File[];
  byItem: Map<string, File[]>;
}

export type SubmitResult =
  | {
      kind: "saved";
      checkId: string;
      passed: boolean;
      /** The first defect raised, kept for callers that only need one. */
      defectId: string | null;
      defectIds: string[];
      offRoad: boolean;
      failed: string[];
      /** The most serious defect raised, or null when there were none. */
      worst: Severity | null;
    }
  | { kind: "duplicate"; checkId: string }
  | { kind: "odometer_lower"; lastReading: number }
  | { kind: "error"; message: string };

export function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

const SEVERITY_RANK: Record<Severity, number> = { minor: 1, major: 2, critical: 3 };
export const worstOf = (list: Severity[]): Severity | null =>
  list.reduce<Severity | null>((w, s) => (w === null || SEVERITY_RANK[s] > SEVERITY_RANK[w] ? s : w), null);

// Only a repeated check id counts as a duplicate. Other constraint failures are real errors.
const isUniqueViolation = (err: unknown): boolean => {
  const text = `${String(err)} ${err instanceof Error && err.cause instanceof Error ? err.cause.message : ""}`;
  return /UNIQUE constraint failed: check\.id/i.test(text);
};

const listLabels = (labels: string[]) =>
  labels.length <= 3 ? labels.join(", ") : `${labels.slice(0, 3).join(", ")} and ${labels.length - 3} more`;

/**
 * Saves a pre-start check. Everything is written in one D1 batch (a single transaction), so a check is never
 * saved without its answers, its defects or its vehicle update. Each failed item becomes its own defect, so the
 * workshop can fix and close them one at a time.
 */
export async function submitCheck(
  db: DB,
  actor: AppUser,
  input: SubmitInput,
  photos: PhotoUpload | CheckPhotos | null = null,
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

  const notes = input.notes.trim();
  const nowIso = new Date().toISOString();
  const checkId = input.submissionId;

  // Work out every item's answer, from the current form or the older ticked-items form.
  const usingAnswers = Boolean(input.answers && input.answers.length > 0);
  type Row = { item: (typeof items)[number]; status: "pass" | "fail" | "na"; note: string; severity: Severity | null };
  let rows: Row[];
  if (usingAnswers) {
    const byId = new Map((input.answers ?? []).map((a) => [a.itemId, a]));
    const missing = items.filter((i) => !byId.has(i.id));
    if (missing.length) {
      return {
        kind: "error",
        message: `Answer every item before you submit. Not answered: ${listLabels(missing.map((i) => i.label))}.`,
      };
    }
    rows = items.map((item) => {
      const a = byId.get(item.id);
      const status = a?.status ?? "pass";
      return {
        item,
        status,
        note: (a?.note ?? "").trim(),
        severity: status === "fail" ? (a?.severity ?? null) : null,
      };
    });
    const noNote = rows.filter((r) => r.status === "fail" && r.note.length < 2);
    if (noNote.length) {
      return { kind: "error", message: `Say what is wrong with: ${listLabels(noNote.map((r) => r.item.label))}.` };
    }
    const noSeverity = rows.filter((r) => r.status === "fail" && !r.severity);
    if (noSeverity.length) {
      return {
        kind: "error",
        message: `Choose how serious it is for: ${listLabels(noSeverity.map((r) => r.item.label))}.`,
      };
    }
  } else {
    const ticked = new Set(input.ok);
    rows = items.map((item) => ({ item, status: ticked.has(item.id) ? "pass" : "fail", note: "", severity: null }));
    const anyFailed = rows.some((r) => r.status === "fail");
    if (anyFailed && notes.length === 0) return { kind: "error", message: "Describe the problem before you submit." };
  }
  const failedRows = rows.filter((r) => r.status === "fail");
  const passed = failedRows.length === 0;
  if (input.reportAnyway && notes.length === 0 && (usingAnswers || passed)) {
    return { kind: "error", message: "Describe the problem you want to report." };
  }

  // Photos are stored only after every check above has passed, and removed again if the save fails.
  const stored: { key: string; checkResultItemId: string | null }[] = [];
  const bucket = photos ? photos.bucket : null;
  try {
    if (photos && "file" in photos) {
      stored.push({ key: await storePhoto(photos.bucket, "checks", photos.file), checkResultItemId: null });
    } else if (photos) {
      for (const file of photos.overall)
        stored.push({ key: await storePhoto(photos.bucket, "checks", file), checkResultItemId: null });
      for (const r of failedRows) {
        for (const file of photos.byItem.get(r.item.id) ?? []) {
          stored.push({ key: await storePhoto(photos.bucket, "checks", file), checkResultItemId: r.item.id });
        }
      }
    }
  } catch (err) {
    if (bucket) await Promise.all(stored.map((p) => bucket.delete(p.key).catch(() => undefined)));
    throw err;
  }
  const overallPhoto = stored.find((p) => p.checkResultItemId === null)?.key ?? null;

  const resultRows = rows.map((r) => ({
    id: crypto.randomUUID(),
    checkId,
    checklistItemId: r.item.id,
    label: r.item.label,
    section: r.item.section,
    ok: r.status !== "fail",
    status: r.status,
    note: r.note.slice(0, 1000),
    severity: r.severity,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  const resultIdByItem = new Map(resultRows.map((r) => [r.checklistItemId, r.id]));

  // Defects: one per failed item on the current form; one for the whole check on the older form.
  const defects: (typeof defect.$inferInsert)[] = [];
  const base = {
    vehicleId: v.id,
    vehicleName: v.name,
    checkId,
    status: "open" as const,
    reportedById: actor.id,
    reportedByName: actor.name,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  if (usingAnswers) {
    for (const r of failedRows) {
      defects.push({
        ...base,
        id: crypto.randomUUID(),
        checkResultId: resultIdByItem.get(r.item.id) ?? null,
        description: `${r.item.label}: ${r.note}`.slice(0, 2000),
        severity: r.severity ?? "minor",
        photoKey: stored.find((p) => p.checkResultItemId === r.item.id)?.key ?? null,
      });
    }
  } else if (!passed) {
    defects.push({
      ...base,
      id: crypto.randomUUID(),
      description: `Failed: ${failedRows.map((f) => f.item.label).join(", ")}. Driver notes: ${notes}`.slice(0, 2000),
      severity: input.severity,
      photoKey: overallPhoto,
    });
  }
  if (input.reportAnyway && notes.length > 0 && (usingAnswers || passed)) {
    defects.push({
      ...base,
      id: crypto.randomUUID(),
      description: `Reported by driver: ${notes}`.slice(0, 2000),
      severity: input.severity,
      photoKey: overallPhoto,
    });
  }
  const worst = worstOf(defects.map((d) => d.severity ?? "minor"));
  const offRoad = worst === "critical";

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
    photoKey: overallPhoto,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  // D1 allows at most 100 bound values per statement, so rows go in small chunks.
  const insertResults = chunk(resultRows, 8).map((part) => db.insert(checkResult).values(part));
  const insertDefects = chunk(defects, 5).map((part) => db.insert(defect).values(part));
  const photoRows = stored.map((p) => ({
    id: crypto.randomUUID(),
    checkId,
    checkResultId: p.checkResultItemId ? (resultIdByItem.get(p.checkResultItemId) ?? null) : null,
    key: p.key,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  const insertPhotos = chunk(photoRows, 10).map((part) => db.insert(checkPhoto).values(part));
  const updateVehicle = db
    .update(vehicle)
    .set({ odometerKm: input.odometer, updatedAt: nowIso, ...(offRoad ? { status: "off_road" as const } : {}) })
    .where(eq(vehicle.id, v.id));

  try {
    await db.batch([insertCheck, ...insertResults, ...insertDefects, ...insertPhotos, updateVehicle]);
  } catch (err) {
    if (bucket) await Promise.all(stored.map((p) => bucket.delete(p.key).catch(() => undefined)));
    // A double click or a resent form arrives with the same submission id: treat it as already saved.
    if (isUniqueViolation(err)) return { kind: "duplicate", checkId };
    throw err;
  }

  const defectIds = defects.map((d) => d.id);
  return {
    kind: "saved",
    checkId,
    passed,
    defectId: defectIds[0] ?? null,
    defectIds,
    offRoad,
    failed: failedRows.map((f) => f.item.label),
    worst,
  };
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
): Promise<{ check: Check; results: CheckResult[]; photos: CheckPhoto[] } | null> {
  const row = await db.select().from(check).where(eq(check.id, checkId)).get();
  if (!row || !can(actor, "check:view", { ownerId: row.driverId })) return null;
  const results = await db
    .select()
    .from(checkResult)
    .where(eq(checkResult.checkId, checkId))
    // rowid keeps the order the items were saved in, which is the checklist order at the time.
    .orderBy(sql`rowid`)
    .all();
  const photos = await db
    .select()
    .from(checkPhoto)
    .where(eq(checkPhoto.checkId, checkId))
    .orderBy(sql`rowid`)
    .all();
  return { check: row, results, photos };
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
