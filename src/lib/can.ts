import type { Role } from "../labels";

/**
 * Every permission rule in one place. Routes call `can()` on the server before doing anything, so hiding a
 * button is never the only protection. A user with no role (waiting for approval) can do nothing.
 *
 * | Action                         | Driver          | Workshop | Admin |
 * | ------------------------------ | --------------- | -------- | ----- |
 * | check:submit                   | yes             | yes      | yes   |
 * | check:view (one check)         | own only        | all      | all   |
 * | check:viewAll (history filter) | no              | yes      | yes   |
 * | vehicle:view, checklist:view   | yes             | yes      | yes   |
 * | defect:view                    | yes (read only) | yes      | yes   |
 * | defect:work                    | no              | yes      | yes   |
 * | vehicle:edit                   | no              | no       | yes   |
 * | checklist:edit                 | no              | no       | yes   |
 * | settings:edit                  | no              | no       | yes   |
 * | team:manage                    | no              | no       | yes   |
 * | photo:view                     | own checks      | all      | all   |
 */

export type Action =
  | "check:submit"
  | "check:view"
  | "check:viewAll"
  | "vehicle:view"
  | "checklist:view"
  | "defect:view"
  | "defect:work"
  | "vehicle:edit"
  | "checklist:edit"
  | "settings:edit"
  | "team:manage"
  | "photo:view";

/** The record an action applies to. `ownerId` is the driver of a check or the reporter of a defect. */
export interface OwnedRecord {
  ownerId: string;
}

export interface Actor {
  id: string;
  role: Role | null;
}

const EVERY_ROLE: readonly Role[] = ["admin", "workshop", "driver"];
const STAFF: readonly Role[] = ["admin", "workshop"];
const ADMIN: readonly Role[] = ["admin"];

const allowed: Record<Exclude<Action, "check:view" | "photo:view">, readonly Role[]> = {
  "check:submit": EVERY_ROLE,
  "check:viewAll": STAFF,
  "vehicle:view": EVERY_ROLE,
  "checklist:view": EVERY_ROLE,
  "defect:view": EVERY_ROLE,
  "defect:work": STAFF,
  "vehicle:edit": ADMIN,
  "checklist:edit": ADMIN,
  "settings:edit": ADMIN,
  "team:manage": ADMIN,
};

export function can(actor: Actor | null | undefined, action: Action, record?: OwnedRecord): boolean {
  if (!actor || !actor.role) return false;
  const role = actor.role;
  if (!EVERY_ROLE.includes(role)) return false;

  if (action === "check:view" || action === "photo:view") {
    if (STAFF.includes(role)) return true;
    // Drivers only see their own checks and photos, and only when the record is known.
    return record !== undefined && record.ownerId === actor.id;
  }
  return allowed[action].includes(role);
}

export const ALL_ACTIONS: readonly Action[] = [
  "check:submit",
  "check:view",
  "check:viewAll",
  "vehicle:view",
  "checklist:view",
  "defect:view",
  "defect:work",
  "vehicle:edit",
  "checklist:edit",
  "settings:edit",
  "team:manage",
  "photo:view",
];
