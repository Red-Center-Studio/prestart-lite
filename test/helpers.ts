import { env, exports } from "cloudflare:workers";
import { getDb } from "../src/db/client";
import { checklistItem, user, vehicle } from "../src/db/schema";
import type { AppUser } from "../src/env";
import type { Role } from "../src/labels";

export const ORIGIN = "https://prestart.test";
export const db = () => getDb(env.DB);

export async function makeUser(role: Role | null, name = `${role ?? "pending"} person`): Promise<AppUser> {
  const id = crypto.randomUUID();
  const email = `${id.slice(0, 8)}@example.com`;
  await db().insert(user).values({ id, name, email, emailVerified: true, role });
  return { id, name, email, role, isDemo: false, emailVerified: true };
}

export async function makeVehicle(overrides: Partial<typeof vehicle.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await db()
    .insert(vehicle)
    .values({ id, name: "Hilux", rego: "ABC123", odometerKm: 1000, ...overrides });
  return id;
}

export async function makeItems(labels: string[] = ["Tyres", "Lights", "Brakes"]) {
  const ids = labels.map(() => crypto.randomUUID());
  await db()
    .insert(checklistItem)
    .values(labels.map((label, i) => ({ id: ids[i] ?? crypto.randomUUID(), label, sort: i })));
  return ids;
}

/** A tiny browser: keeps cookies, sends the CSRF token and the Origin header like a real form post. */
export class Browser {
  cookies = new Map<string, string>();
  ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private store(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (/max-age=0/i.test(line) || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async get(path: string, headers: Record<string, string> = {}): Promise<Response> {
    const res = await exports.default.fetch(
      new Request(`${ORIGIN}${path}`, {
        redirect: "manual",
        headers: { cookie: this.cookieHeader(), "cf-connecting-ip": this.ip, ...headers },
      }),
    );
    this.store(res);
    return res;
  }

  async csrf(): Promise<string> {
    if (!this.cookies.has("prestart_csrf")) await this.get("/login");
    return this.cookies.get("prestart_csrf") ?? "";
  }

  async post(
    path: string,
    fields: Record<string, string | string[] | File> = {},
    opts: { csrf?: string | false; origin?: string | false; multipart?: boolean } = {},
  ): Promise<Response> {
    const token = opts.csrf === false ? undefined : (opts.csrf ?? (await this.csrf()));
    const hasFile = Object.values(fields).some((v) => v instanceof File);
    let body: BodyInit;
    const headers: Record<string, string> = { cookie: this.cookieHeader(), "cf-connecting-ip": this.ip };
    if (opts.origin !== false) headers.origin = opts.origin ?? ORIGIN;
    if (hasFile || opts.multipart) {
      const fd = new FormData();
      if (token !== undefined) fd.append("_csrf", token);
      for (const [k, v] of Object.entries(fields)) {
        if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
        else fd.append(k, v);
      }
      body = fd;
    } else {
      const sp = new URLSearchParams();
      if (token !== undefined) sp.append("_csrf", token);
      for (const [k, v] of Object.entries(fields)) {
        if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
        else if (typeof v === "string") sp.append(k, v);
      }
      body = sp;
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    const res = await exports.default.fetch(
      new Request(`${ORIGIN}${path}`, { method: "POST", body, headers, redirect: "manual" }),
    );
    this.store(res);
    return res;
  }
}

let counter = 0;

/** Signs a new person up through the real sign-up form, then sets their role directly. */
export async function signedIn(role: Role | null, name?: string): Promise<{ browser: Browser; user: AppUser }> {
  const browser = new Browser();
  counter += 1;
  const email = `user${counter}-${crypto.randomUUID().slice(0, 6)}@example.com`;
  const fullName = name ?? `Test ${role ?? "pending"} ${counter}`;
  const res = await browser.post("/signup", { fullName, email, password: "correct-horse-battery" });
  if (res.status !== 303) throw new Error(`sign-up failed with ${res.status}: ${await res.text()}`);
  const row = await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first<{ id: string }>();
  if (!row) throw new Error("user not created");
  await env.DB.prepare("UPDATE user SET role = ? WHERE id = ?").bind(role, row.id).run();
  return { browser, user: { id: row.id, name: fullName, email, role, isDemo: false, emailVerified: false } };
}

export const location = (res: Response): string => res.headers.get("location") ?? "";
