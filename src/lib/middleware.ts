import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { createAuth } from "../auth/auth";
import { getDb } from "../db/client";
import { user as userTable } from "../db/schema";
import type { AppEnv, AppUser } from "../env";
import { ROLES, type Role } from "../labels";
import { can, type Action } from "./can";
import { CSRF_FIELD } from "./csrf-field";
import { forbiddenHtml } from "../views/errors";

const CSRF_COOKIE = "prestart_csrf";

const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);

/** Sets up the database handle, the request origin and the CSRF token for every request. */
export const base: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("db", getDb(c.env.DB));
  c.set("origin", new URL(c.req.url).origin);
  let token = getCookie(c, CSRF_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
    setCookie(c, CSRF_COOKIE, token, {
      httpOnly: true,
      sameSite: "Strict",
      secure: new URL(c.req.url).protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  c.set("csrfToken", token);
  c.set("user", null);
  c.set("sessionExpired", false);
  await next();
};

/** Loads the signed-in user (if any) from Better Auth, then re-reads the role from the database. */
export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const hasSessionCookie = /prestart\.session_token=/.test(c.req.header("cookie") ?? "");
  if (hasSessionCookie) {
    const auth = createAuth(c.env, c.get("origin"));
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (result) {
      const row = await c
        .get("db")
        .select({
          id: userTable.id,
          name: userTable.name,
          email: userTable.email,
          role: userTable.role,
          isDemo: userTable.isDemo,
          emailVerified: userTable.emailVerified,
        })
        .from(userTable)
        .where(eq(userTable.id, result.user.id))
        .get();
      if (row) {
        const appUser: AppUser = { ...row, role: isRole(row.role) ? row.role : null };
        c.set("user", appUser);
      }
    } else {
      c.set("sessionExpired", true);
    }
  }
  await next();
};

/**
 * Rejects form posts without a matching CSRF token. The token lives in a SameSite=Strict cookie and must be
 * echoed in a hidden form field, so another site cannot submit forms on a user's behalf.
 */
export const verifyCsrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") return next();
  const cookie = getCookie(c, CSRF_COOKIE) ?? "";
  let sent = "";
  const type = c.req.header("content-type") ?? "";
  if (type.includes("form")) {
    // Hono caches the parsed body, so routes calling parseBody({ all: true }) later get this same result.
    const body = await c.req.parseBody({ all: true });
    const v = body[CSRF_FIELD];
    sent = typeof v === "string" ? v : "";
  }
  if (!cookie || !sent || !timingSafeEqual(cookie, sent)) {
    return c.html(formExpiredPage(), 403);
  }
  return next();
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function formExpiredPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Form expired | PreStart</title><link rel="stylesheet" href="/styles.css"></head><body class="bg-gray-50 text-ink"><main class="mx-auto max-w-md p-6"><h1 class="text-xl font-semibold">This form has expired</h1><p class="mt-2">For your security, the page needs a refresh. Go back, reload the page and try again.</p><p class="mt-4"><a class="text-primary underline" href="/">Go to the start page</a></p></main></body></html>`;
}

/** Where a signed-in person lands, by role. */
export const homeFor = (u: AppUser): string => {
  if (!u.role) return "/waiting";
  return u.role === "driver" ? "/check" : "/defects";
};

const signInRedirect = (c: Context<AppEnv>) => {
  const url = new URL(c.req.url);
  const next = c.req.method === "GET" ? url.pathname + url.search : "/";
  const params = new URLSearchParams({ next });
  if (c.get("sessionExpired")) params.set("expired", "1");
  return c.redirect(`/login?${params.toString()}`, 303);
};

/** Requires a signed-in user with a role. Pending users only ever see the waiting page. */
export const requireMember: MiddlewareHandler<AppEnv> = async (c, next) => {
  const u = c.get("user");
  if (!u) return signInRedirect(c);
  if (!u.role) return c.redirect("/waiting", 303);
  await next();
};

/** Requires a permission. Signed-out users go to sign in; others get a plain "not allowed" page. */
export const requirePermission =
  (action: Action): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const u = c.get("user");
    if (!u) return signInRedirect(c);
    if (!u.role) return c.redirect("/waiting", 303);
    if (!can(u, action)) return c.html(forbiddenHtml({ user: u, csrf: c.get("csrfToken") }), 403);
    await next();
  };

/** Requires any signed-in user, including one waiting for approval. */
export const requireSignedIn: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) return signInRedirect(c);
  await next();
};

/** Only lets a local path through as a post-sign-in destination. */
export function safeNext(next: string | undefined | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (/[\r\n]/.test(next)) return null;
  return next.slice(0, 200);
}
