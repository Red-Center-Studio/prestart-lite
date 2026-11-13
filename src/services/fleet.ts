import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  appSettings,
  checklistItem,
  defect,
  vehicle,
  type AppSettings,
  type ChecklistItem,
  type Vehicle,
} from "../db/schema";
import type { AppUser } from "../env";
import { CHECKLIST_TEMPLATES, STANDARD_CHECKLIST, type VehicleStatus } from "../labels";
import { can } from "../lib/can";
import { chunk } from "./checks";

export type Result<T = undefined> = { ok: true; value?: T } | { ok: false; message: string };
const denied = { ok: false as const, message: "Only an admin can do that." };

// ---------- Vehicles ----------

export interface VehicleInput {
  name: string;
  rego: string;
  vehicleType: string;
  odometer: number;
  regoDue: string | null;
  serviceDue: string | null;
  status: VehicleStatus;
  notes: string;
}

export async function listVehicles(db: DB, actor: AppUser): Promise<Vehicle[]> {
  if (!can(actor, "vehicle:view")) return [];
  return db.select().from(vehicle).orderBy(asc(vehicle.name), asc(vehicle.id)).all();
}

export async function listInServiceVehicles(db: DB, actor: AppUser): Promise<Vehicle[]> {
  if (!can(actor, "vehicle:view")) return [];
  return db
    .select()
    .from(vehicle)
    .where(eq(vehicle.status, "in_service"))
    .orderBy(asc(vehicle.name), asc(vehicle.id))
    .all();
}

export async function getVehicle(db: DB, vehicleId: string): Promise<Vehicle | undefined> {
  return db.select().from(vehicle).where(eq(vehicle.id, vehicleId)).get();
}

export async function addVehicle(db: DB, actor: AppUser, input: VehicleInput): Promise<Result<string>> {
  if (!can(actor, "vehicle:edit")) return denied;
  const id = crypto.randomUUID();
  await db.insert(vehicle).values({
    id,
    name: input.name,
    rego: input.rego.toUpperCase(),
    vehicleType: input.vehicleType,
    odometerKm: input.odometer,
    regoDue: input.regoDue,
    serviceDue: input.serviceDue,
    status: input.status,
    notes: input.notes,
  });
  return { ok: true, value: id };
}

export async function updateVehicle(db: DB, actor: AppUser, vehicleId: string, input: VehicleInput): Promise<Result> {
  if (!can(actor, "vehicle:edit")) return denied;
  const res = await db
    .update(vehicle)
    .set({
      name: input.name,
      rego: input.rego.toUpperCase(),
      vehicleType: input.vehicleType,
      odometerKm: input.odometer,
      regoDue: input.regoDue,
      serviceDue: input.serviceDue,
      status: input.status,
      notes: input.notes,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(vehicle.id, vehicleId))
    .run();
  if (res.meta.changes === 0) return { ok: false, message: "That vehicle no longer exists." };
  return { ok: true };
}

/** Deletes a vehicle. Refused while it has open or in-progress defects, so nothing in the queue is orphaned. */
export async function deleteVehicle(db: DB, actor: AppUser, vehicleId: string): Promise<Result> {
  if (!can(actor, "vehicle:edit")) return denied;
  const res = await db
    .delete(vehicle)
    .where(
      and(
        eq(vehicle.id, vehicleId),
        sql`NOT EXISTS (SELECT 1 FROM ${defect} WHERE ${defect.vehicleId} = ${vehicleId} AND ${defect.status} IN ('open', 'in_progress'))`,
      ),
    )
    .run();
  if (res.meta.changes === 0) {
    const stillThere = await getVehicle(db, vehicleId);
    return stillThere
      ? { ok: false, message: "This vehicle has open defects. Fix or close them before deleting it." }
      : { ok: false, message: "That vehicle no longer exists." };
  }
  return { ok: true };
}

export async function openDefectCounts(db: DB): Promise<Map<string, number>> {
  const rows = await db
    .select({ vehicleId: defect.vehicleId, n: count() })
    .from(defect)
    .where(inArray(defect.status, ["open", "in_progress"]))
    .groupBy(defect.vehicleId)
    .all();
  return new Map(rows.map((r) => [r.vehicleId, r.n]));
}

// ---------- Checklist ----------

export async function listChecklist(db: DB, actor: AppUser, activeOnly = false): Promise<ChecklistItem[]> {
  if (!can(actor, "checklist:view")) return [];
  return db
    .select()
    .from(checklistItem)
    .where(activeOnly ? eq(checklistItem.active, true) : undefined)
    .orderBy(asc(checklistItem.sort), asc(checklistItem.createdAt), asc(checklistItem.id))
    .all();
}

async function nextSort(db: DB): Promise<number> {
  const row = await db
    .select({ max: sql<number | null>`max(${checklistItem.sort})` })
    .from(checklistItem)
    .get();
  return (row?.max ?? -1) + 1;
}

export async function addChecklistItem(db: DB, actor: AppUser, label: string, section = "General"): Promise<Result> {
  if (!can(actor, "checklist:edit")) return denied;
  await db.insert(checklistItem).values({ id: crypto.randomUUID(), label, section, sort: await nextSort(db) });
  return { ok: true };
}

/** Adds the 8 standard items, skipping any whose wording is already on the list. */
export async function addStandardChecklist(db: DB, actor: AppUser): Promise<Result<number>> {
  return addItems(
    db,
    actor,
    STANDARD_CHECKLIST.map((label) => ["General", label]),
  );
}

/** Adds every item from a ready-made checklist, skipping any whose wording is already on the list. */
export async function addChecklistTemplate(db: DB, actor: AppUser, key: string): Promise<Result<number>> {
  const template = Object.hasOwn(CHECKLIST_TEMPLATES, key) ? CHECKLIST_TEMPLATES[key] : undefined;
  if (!template) return { ok: false, message: "Choose a checklist to add." };
  return addItems(db, actor, template.items);
}

async function addItems(db: DB, actor: AppUser, items: [string, string][]): Promise<Result<number>> {
  if (!can(actor, "checklist:edit")) return denied;
  const existing = new Set(
    (await db.select({ label: checklistItem.label }).from(checklistItem).all()).map((r) => r.label.toLowerCase()),
  );
  const toAdd = items.filter(([, l]) => !existing.has(l.toLowerCase()));
  if (toAdd.length === 0) return { ok: true, value: 0 };
  const start = await nextSort(db);
  const nowIso = new Date().toISOString();
  const rows = toAdd.map(([section, label], i) => ({
    id: crypto.randomUUID(),
    label,
    section,
    sort: start + i,
    active: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  // Chunked to stay under D1's 100 bound values per statement.
  const [first, ...rest] = chunk(rows, 10).map((part) => db.insert(checklistItem).values(part));
  if (first) await db.batch([first, ...rest]);
  return { ok: true, value: toAdd.length };
}

export async function renameChecklistItem(
  db: DB,
  actor: AppUser,
  itemId: string,
  label: string,
  section?: string,
): Promise<Result> {
  if (!can(actor, "checklist:edit")) return denied;
  const res = await db
    .update(checklistItem)
    .set({ label, ...(section ? { section } : {}), updatedAt: new Date().toISOString() })
    .where(eq(checklistItem.id, itemId))
    .run();
  return res.meta.changes === 0 ? { ok: false, message: "That item no longer exists." } : { ok: true };
}

export async function toggleChecklistItem(db: DB, actor: AppUser, itemId: string): Promise<Result> {
  if (!can(actor, "checklist:edit")) return denied;
  const res = await db
    .update(checklistItem)
    .set({ active: sql`NOT ${checklistItem.active}`, updatedAt: new Date().toISOString() })
    .where(eq(checklistItem.id, itemId))
    .run();
  return res.meta.changes === 0 ? { ok: false, message: "That item no longer exists." } : { ok: true };
}

/** Deletes a checklist item. Past checks keep their own copy of the wording, so history is unaffected. */
export async function deleteChecklistItem(db: DB, actor: AppUser, itemId: string): Promise<Result> {
  if (!can(actor, "checklist:edit")) return denied;
  const res = await db.delete(checklistItem).where(eq(checklistItem.id, itemId)).run();
  return res.meta.changes === 0 ? { ok: false, message: "That item no longer exists." } : { ok: true };
}

/** Moves an item one place up or down by renumbering the whole list in one batch. */
export async function moveChecklistItem(
  db: DB,
  actor: AppUser,
  itemId: string,
  direction: "up" | "down",
): Promise<Result> {
  if (!can(actor, "checklist:edit")) return denied;
  const items = await listChecklist(db, actor);
  const index = items.findIndex((i) => i.id === itemId);
  if (index < 0) return { ok: false, message: "That item no longer exists." };
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= items.length) return { ok: true };
  const reordered = [...items];
  const [moved] = reordered.splice(index, 1);
  if (!moved) return { ok: true };
  reordered.splice(swapWith, 0, moved);
  const nowIso = new Date().toISOString();
  const [first, ...rest] = reordered.map((item, sort) =>
    db.update(checklistItem).set({ sort, updatedAt: nowIso }).where(eq(checklistItem.id, item.id)),
  );
  if (first) await db.batch([first, ...rest]);
  return { ok: true };
}

// ---------- Business settings ----------

export async function getSettings(db: DB): Promise<AppSettings> {
  const row = await db.select().from(appSettings).where(eq(appSettings.id, 1)).get();
  if (row) return row;
  // The migration creates this row. If it is ever missing, recreate it once instead of failing.
  await db.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
  const created = await db.select().from(appSettings).where(eq(appSettings.id, 1)).get();
  if (!created) throw new Error("app_settings row is missing");
  return created;
}

export interface SettingsInput {
  businessName: string;
  supportEmail: string;
  setupHelpUrl: string;
  showSetupOffer: boolean;
}

export async function updateSettings(db: DB, actor: AppUser, input: SettingsInput): Promise<Result> {
  if (!can(actor, "settings:edit")) return denied;
  await getSettings(db);
  await db
    .update(appSettings)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(eq(appSettings.id, 1));
  return { ok: true };
}
