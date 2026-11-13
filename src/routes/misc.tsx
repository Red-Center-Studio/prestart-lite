import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { check, checkPhoto, defect } from "../db/schema";
import { can } from "../lib/can";
import { requireMember } from "../lib/middleware";
import { photoResponse } from "../lib/photos";
import { id as idSchema } from "../lib/validate";
import { getSettings } from "../services/fleet";
import { H1 } from "../views/components";
import { render } from "./render";

export const miscRoutes = new Hono<AppEnv>();

// ---------- Photos ----------
// Photos are looked up by the record they belong to, never by storage key, and the permission check runs
// first. A guessed key, or another driver's check id, gets the same "not found" as a photo that does not exist.

miscRoutes.get("/photos/check/:id", requireMember, async (c) => {
  const parsed = idSchema.safeParse(c.req.param("id"));
  if (!parsed.success) return c.notFound();
  const row = await c
    .get("db")
    .select({ driverId: check.driverId, photoKey: check.photoKey })
    .from(check)
    .where(eq(check.id, parsed.data))
    .get();
  if (!row?.photoKey || !can(c.get("user"), "photo:view", { ownerId: row.driverId })) return c.notFound();
  return (await photoResponse(c.env.PHOTOS, row.photoKey)) ?? c.notFound();
});

// Any photo saved with a check: for the whole check or for one failed item.
miscRoutes.get("/photos/item/:id", requireMember, async (c) => {
  const parsed = idSchema.safeParse(c.req.param("id"));
  if (!parsed.success) return c.notFound();
  const row = await c
    .get("db")
    .select({ driverId: check.driverId, key: checkPhoto.key })
    .from(checkPhoto)
    .innerJoin(check, eq(check.id, checkPhoto.checkId))
    .where(eq(checkPhoto.id, parsed.data))
    .get();
  if (!row || !can(c.get("user"), "photo:view", { ownerId: row.driverId })) return c.notFound();
  return (await photoResponse(c.env.PHOTOS, row.key)) ?? c.notFound();
});

miscRoutes.get("/photos/defect/:id", requireMember, async (c) => {
  const parsed = idSchema.safeParse(c.req.param("id"));
  if (!parsed.success) return c.notFound();
  const row = await c
    .get("db")
    .select({ reportedById: defect.reportedById, photoKey: defect.photoKey })
    .from(defect)
    .where(eq(defect.id, parsed.data))
    .get();
  if (!row?.photoKey || !can(c.get("user"), "photo:view", { ownerId: row.reportedById })) return c.notFound();
  return (await photoResponse(c.env.PHOTOS, row.photoKey)) ?? c.notFound();
});

// ---------- Legal pages: placeholders the business edits ----------

miscRoutes.get("/terms", async (c) => {
  const s = await getSettings(c.get("db"));
  return render(
    c,
    { title: "Terms of use" },
    <article class="prose max-w-none">
      <H1 sub="Placeholder. Replace this text with your own terms before you go live.">Terms of use</H1>
      <div class="space-y-3 text-gray-800">
        <p>
          This app is run by {s.businessName} for its staff and contractors. By using it you agree to record vehicle
          checks honestly and to report faults as soon as you find them.
        </p>
        <p>
          Do not drive a vehicle marked off road. A check in this app does not replace your duty to stop and report a
          fault you notice while driving.
        </p>
        <p>{s.businessName} may remove access at any time.</p>
        <p>To edit this page, change src/routes/misc.tsx in the code.</p>
      </div>
    </article>,
  );
});

miscRoutes.get("/privacy", async (c) => {
  const s = await getSettings(c.get("db"));
  return render(
    c,
    { title: "Privacy" },
    <article>
      <H1 sub="Placeholder. Replace this text with your own privacy policy before you go live.">Privacy</H1>
      <div class="space-y-3 text-gray-800">
        <p>
          {s.businessName} stores your name, email, the checks you submit, any photos you add and the time of each
          check. This is used to keep vehicles safe and to keep records for safety audits.
        </p>
        <p>
          Data is stored in {s.businessName}'s own Cloudflare account. Photos are private and only visible to people
          allowed to see them.
        </p>
        <p>
          To ask about your data
          {s.supportEmail ? (
            <>
              , email <a href={`mailto:${s.supportEmail}`}>{s.supportEmail}</a>
            </>
          ) : (
            ", contact your manager"
          )}
          .
        </p>
        <p>To edit this page, change src/routes/misc.tsx in the code.</p>
      </div>
    </article>,
  );
});

miscRoutes.get("/healthz", (c) => c.json({ ok: true }));
miscRoutes.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 301));
