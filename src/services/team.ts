import { asc, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { session, user } from "../db/schema";
import type { AppUser } from "../env";
import type { Role } from "../labels";
import { can } from "../lib/can";
import type { Result } from "./fleet";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role | null;
  emailVerified: boolean;
  createdAt: Date;
}

/** Everyone with an account, people waiting for approval first. */
export async function listTeam(db: DB, actor: AppUser): Promise<TeamMember[]> {
  if (!can(actor, "team:manage")) return [];
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(sql`${user.role} IS NOT NULL`, asc(user.name))
    .all();
}

/**
 * Changes someone's role, or removes their access (role null). The last-admin guard is part of the same
 * UPDATE statement, so two admins demoting each other at once cannot leave the business with no admin.
 */
export async function setRole(db: DB, actor: AppUser, targetId: string, role: Role | null): Promise<Result> {
  if (!can(actor, "team:manage")) return { ok: false, message: "Only an admin can do that." };
  const target = await db.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, targetId)).get();
  if (!target) return { ok: false, message: "That person no longer has an account." };
  if (target.role === role) return { ok: true };

  const res = await db
    .update(user)
    .set({ role, updatedAt: new Date() })
    .where(
      sql`${user.id} = ${targetId} AND (${user.role} IS NOT 'admin' OR (SELECT COUNT(*) FROM ${user} WHERE ${user.role} = 'admin') > 1)`,
    )
    .run();
  if (res.meta.changes === 0) {
    return { ok: false, message: "You cannot remove the last admin. Make someone else an admin first." };
  }
  if (role === null) {
    // Sign them out everywhere straight away.
    await db.delete(session).where(eq(session.userId, targetId));
  }
  return { ok: true };
}

export async function countAdmins(db: DB): Promise<number> {
  const row = await db
    .select({ n: sql<number>`count(*)` })
    .from(user)
    .where(eq(user.role, "admin"))
    .get();
  return row?.n ?? 0;
}

export async function updateName(db: DB, actor: AppUser, name: string): Promise<Result> {
  if (actor.isDemo) return { ok: false, message: "Demo accounts cannot be changed." };
  await db.update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, actor.id));
  return { ok: true };
}
