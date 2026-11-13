import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { session, user } from "../src/db/schema";
import { promoteFirstUser } from "../src/auth/auth";
import { setRole, countAdmins } from "../src/services/team";
import { Browser, db, location, makeUser } from "./helpers";

const roleOf = async (id: string) =>
  (await db().select({ role: user.role }).from(user).where(eq(user.id, id)).get())?.role;

describe("first user is admin", () => {
  it("makes the first sign-up an Admin and later sign-ups pending", async () => {
    const first = new Browser();
    const res1 = await first.post("/signup", {
      fullName: "Owner",
      email: "owner@example.com",
      password: "long-enough-pw",
    });
    expect(res1.status).toBe(303);
    const second = new Browser();
    const res2 = await second.post("/signup", {
      fullName: "Second",
      email: "second@example.com",
      password: "long-enough-pw",
    });
    expect(res2.status).toBe(303);

    const rows = await env.DB.prepare("SELECT email, role FROM user ORDER BY created_at").all<{
      email: string;
      role: string | null;
    }>();
    expect(rows.results).toEqual([
      { email: "owner@example.com", role: "admin" },
      { email: "second@example.com", role: null },
    ]);
    // The owner lands on the defect queue; the second person only sees the waiting page.
    expect(location(await first.get("/"))).toBe("/defects");
    expect(location(await second.get("/"))).toBe("/waiting");
    expect((await second.get("/waiting")).status).toBe(200);
  });

  it("promotes exactly one person when sign-ups race", async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO user (id, full_name, email, created_at, updated_at) VALUES (?, 'A', 'a@example.com', ?, ?)",
      ).bind(a, now, now),
      env.DB.prepare(
        "INSERT INTO user (id, full_name, email, created_at, updated_at) VALUES (?, 'B', 'b@example.com', ?, ?)",
      ).bind(b, now + 1, now + 1),
    ]);
    // The second person's hook runs first: they are not the oldest, so nothing happens.
    expect(await promoteFirstUser(env.DB, b)).toBe(false);
    expect(await promoteFirstUser(env.DB, a)).toBe(true);
    expect(await promoteFirstUser(env.DB, a)).toBe(false);
    expect(await countAdmins(db())).toBe(1);
    expect(await roleOf(a)).toBe("admin");
  });

  it("never promotes anyone once an admin exists", async () => {
    await makeUser("admin");
    const late = await makeUser(null);
    expect(await promoteFirstUser(env.DB, late.id)).toBe(false);
    expect(await roleOf(late.id)).toBeNull();
  });
});

describe("last admin guard", () => {
  it("blocks demoting or removing the last admin, including yourself", async () => {
    const admin = await makeUser("admin");
    for (const role of ["workshop", "driver", null] as const) {
      const res = await setRole(db(), admin, admin.id, role);
      expect(res).toEqual({
        ok: false,
        message: "You cannot remove the last admin. Make someone else an admin first.",
      });
      expect(await roleOf(admin.id)).toBe("admin");
    }
  });

  it("allows it once there is another admin", async () => {
    const a = await makeUser("admin");
    const b = await makeUser("admin");
    expect(await setRole(db(), a, b.id, "driver")).toEqual({ ok: true });
    expect(await roleOf(b.id)).toBe("driver");
    // Now a is the last admin again.
    expect((await setRole(db(), a, a.id, "driver")).ok).toBe(false);
  });

  it("leaves one admin when two admins demote each other at the same time", async () => {
    const a = await makeUser("admin");
    const b = await makeUser("admin");
    const results = await Promise.all([setRole(db(), a, b.id, "driver"), setRole(db(), b, a.id, "driver")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await countAdmins(db())).toBe(1);
  });

  it("only admins can change roles", async () => {
    const target = await makeUser(null);
    for (const role of ["driver", "workshop", null] as const) {
      const actor = await makeUser(role);
      expect((await setRole(db(), actor, target.id, "admin")).ok).toBe(false);
    }
    expect(await roleOf(target.id)).toBeNull();
  });

  it("removing access signs the person out everywhere", async () => {
    const admin = await makeUser("admin");
    const driver = await makeUser("driver");
    await db()
      .insert(session)
      .values({
        id: crypto.randomUUID(),
        token: crypto.randomUUID(),
        userId: driver.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    expect(await setRole(db(), admin, driver.id, null)).toEqual({ ok: true });
    expect(await roleOf(driver.id)).toBeNull();
    expect(await db().select().from(session).where(eq(session.userId, driver.id)).all()).toHaveLength(0);
  });
});
