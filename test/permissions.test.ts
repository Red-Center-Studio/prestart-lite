import { describe, expect, it } from "vitest";
import { ALL_ACTIONS, can, type Action, type Actor } from "../src/lib/can";

// Every row of the permissions table in SPEC.md, checked both ways for every role.
type Expect = boolean | "own";
const TABLE: Record<Action, { driver: Expect; workshop: Expect; admin: Expect }> = {
  "check:submit": { driver: true, workshop: true, admin: true },
  "check:view": { driver: "own", workshop: true, admin: true },
  "check:viewAll": { driver: false, workshop: true, admin: true },
  "vehicle:view": { driver: true, workshop: true, admin: true },
  "checklist:view": { driver: true, workshop: true, admin: true },
  "defect:view": { driver: true, workshop: true, admin: true },
  "defect:work": { driver: false, workshop: true, admin: true },
  "vehicle:edit": { driver: false, workshop: false, admin: true },
  "checklist:edit": { driver: false, workshop: false, admin: true },
  "settings:edit": { driver: false, workshop: false, admin: true },
  "team:manage": { driver: false, workshop: false, admin: true },
  "photo:view": { driver: "own", workshop: true, admin: true },
};

const me = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

describe("permissions table", () => {
  it("covers every action", () => {
    expect(Object.keys(TABLE).sort()).toEqual([...ALL_ACTIONS].sort());
  });

  for (const action of ALL_ACTIONS) {
    for (const role of ["driver", "workshop", "admin"] as const) {
      const rule = TABLE[action][role];
      const actor: Actor = { id: me, role };
      if (rule === "own") {
        it(`${role} can ${action} on their own record only`, () => {
          expect(can(actor, action, { ownerId: me })).toBe(true);
          expect(can(actor, action, { ownerId: other })).toBe(false);
          expect(can(actor, action)).toBe(false);
        });
      } else {
        it(`${role} ${rule ? "can" : "cannot"} ${action}`, () => {
          expect(can(actor, action)).toBe(rule);
          expect(can(actor, action, { ownerId: me })).toBe(rule);
          expect(can(actor, action, { ownerId: other })).toBe(rule);
        });
      }
    }

    it(`a pending user (no role) cannot ${action}`, () => {
      expect(can({ id: me, role: null }, action)).toBe(false);
      expect(can({ id: me, role: null }, action, { ownerId: me })).toBe(false);
    });

    it(`a signed-out visitor cannot ${action}`, () => {
      expect(can(null, action)).toBe(false);
      expect(can(undefined, action, { ownerId: me })).toBe(false);
    });
  }

  it("rejects a forged role value", () => {
    expect(can({ id: me, role: "superadmin" as never }, "team:manage")).toBe(false);
  });
});
