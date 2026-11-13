import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { check, defect, vehicle } from "../src/db/schema";
import { Browser, db, location, makeItems, makeVehicle, ORIGIN, signedIn } from "./helpers";

const someId = "33333333-3333-4333-8333-333333333333";

const MEMBER_GETS = [
  "/check",
  "/history",
  `/history/${someId}`,
  `/check/done/${someId}`,
  "/defects",
  "/fleet",
  "/fleet/new",
  `/fleet/${someId}/edit`,
  "/setup",
  "/account",
  `/photos/check/${someId}`,
  `/photos/defect/${someId}`,
];

const MEMBER_POSTS = [
  "/check",
  `/defects/${someId}/fix`,
  "/fleet",
  `/fleet/${someId}`,
  `/fleet/${someId}/delete`,
  "/setup/business",
  "/setup/checklist",
  "/setup/checklist/standard",
  `/setup/checklist/${someId}`,
  `/setup/checklist/${someId}/move`,
  `/setup/checklist/${someId}/toggle`,
  `/setup/checklist/${someId}/delete`,
  `/setup/team/${someId}/role`,
  `/setup/team/${someId}/remove`,
  "/account/name",
  "/account/email",
  "/account/password",
];

describe("signed-out visitors", () => {
  it("are sent to sign in from every member page, keeping where they were going", async () => {
    const b = new Browser();
    for (const path of [...MEMBER_GETS, "/waiting"]) {
      const res = await b.get(path);
      expect(res.status, path).toBe(303);
      const to = new URL(location(res), ORIGIN);
      expect(to.pathname, path).toBe("/login");
      expect(to.searchParams.get("next"), path).toBe(path);
    }
  });

  it("cannot post to any member form", async () => {
    const b = new Browser();
    for (const path of MEMBER_POSTS) {
      const res = await b.post(path, { role: "admin", label: "x", name: "x", odometer: "1" });
      expect(res.status, path).toBe(303);
      expect(location(res), path).toMatch(/^\/login/);
    }
    expect(await db().select().from(vehicle).all()).toHaveLength(0);
  });

  it("can see the public pages", async () => {
    const b = new Browser();
    for (const path of ["/", "/login", "/signup", "/forgot-password", "/terms", "/privacy"]) {
      expect((await b.get(path)).status, path).toBe(200);
    }
  });
});

describe("pending users", () => {
  it("only ever see the waiting page", async () => {
    const { browser } = await signedIn(null);
    for (const path of MEMBER_GETS) {
      const res = await browser.get(path);
      expect(res.status, path).toBe(303);
      expect(location(res), path).toBe("/waiting");
    }
    for (const path of MEMBER_POSTS) {
      const res = await browser.post(path, { role: "admin" });
      expect(location(res), path).toBe("/waiting");
    }
    const waiting = await browser.get("/waiting");
    expect(waiting.status).toBe(200);
    expect(await waiting.text()).toContain("Waiting for approval");
  });
});

describe("wrong roles", () => {
  const adminOnlyGets = ["/setup", "/fleet/new"];
  const adminOnlyPosts = MEMBER_POSTS.filter((p) => p.startsWith("/setup") || p.startsWith("/fleet"));

  it("drivers get 'no access' on admin and workshop pages and actions", async () => {
    const { browser } = await signedIn("driver");
    for (const path of adminOnlyGets) expect((await browser.get(path)).status, path).toBe(403);
    for (const path of [...adminOnlyPosts, `/defects/${someId}/fix`]) {
      expect((await browser.post(path, { role: "admin", label: "x" })).status, path).toBe(403);
    }
    for (const path of ["/check", "/history", "/defects", "/fleet", "/account"]) {
      expect((await browser.get(path)).status, path).toBe(200);
    }
  });

  it("workshop staff get 'no access' on admin pages but can work defects", async () => {
    const { browser } = await signedIn("workshop");
    for (const path of adminOnlyGets) expect((await browser.get(path)).status, path).toBe(403);
    for (const path of adminOnlyPosts) expect((await browser.post(path, { role: "admin" })).status, path).toBe(403);
    // Allowed through the permission check; the defect does not exist, so the page shows an error instead.
    const res = await browser.post(`/defects/${someId}/fix`, { op: "fix" });
    expect(res.status).toBe(409);
  });

  it("admins can open every page", async () => {
    const { browser } = await signedIn("admin");
    for (const path of ["/check", "/history", "/defects", "/fleet", "/fleet/new", "/setup", "/account"]) {
      expect((await browser.get(path)).status, path).toBe(200);
    }
  });

  it("a driver cannot promote themselves by posting a role", async () => {
    const { browser, user } = await signedIn("driver");
    const res = await browser.post(`/setup/team/${user.id}/role`, { role: "admin" });
    expect(res.status).toBe(403);
    const row = await env.DB.prepare("SELECT role FROM user WHERE id = ?").bind(user.id).first<{ role: string }>();
    expect(row?.role).toBe("driver");
  });
});

describe("other people's records", () => {
  async function driverCheck() {
    const v = await makeVehicle();
    const items = await makeItems(["Tyres"]);
    const owner = await signedIn("driver", "Owner Driver");
    const photo = new File([new Uint8Array([255, 216, 255, 0])], "p.jpg", { type: "image/jpeg" });
    const res = await owner.browser.post("/check", {
      submissionId: crypto.randomUUID(),
      vehicleId: v,
      odometer: "1200",
      "ok[]": [],
      notes: "Flat tyre",
      severity: "minor",
      photo,
    });
    expect(res.status).toBe(303);
    const saved = await db().select().from(check).get();
    if (!saved) throw new Error("check not saved");
    const d = await db().select().from(defect).where(eq(defect.checkId, saved.id)).get();
    if (!d) throw new Error("defect not saved");
    return { owner, checkId: saved.id, defectId: d.id, photoKey: saved.photoKey ?? "", items };
  }

  it("a driver cannot read another driver's check, defect photo or check photo by changing the id", async () => {
    const { checkId, defectId, owner } = await driverCheck();
    expect((await owner.browser.get(`/history/${checkId}`)).status).toBe(200);
    expect((await owner.browser.get(`/photos/check/${checkId}`)).status).toBe(200);

    const { browser: other } = await signedIn("driver");
    expect((await other.get(`/history/${checkId}`)).status).toBe(404);
    expect((await other.get(`/check/done/${checkId}`)).status).toBe(404);
    expect((await other.get(`/photos/check/${checkId}`)).status).toBe(404);
    expect((await other.get(`/photos/defect/${defectId}`)).status).toBe(404);
    const history = await (await other.get("/history")).text();
    expect(history).not.toContain(checkId);
    // Filtering by the other driver's id does not leak their checks either.
    const filtered = await (await other.get(`/history?driver=${owner.user.id}`)).text();
    expect(filtered).not.toContain(checkId);
  });

  it("workshop and admin can see every check and photo", async () => {
    const { checkId, defectId } = await driverCheck();
    for (const role of ["workshop", "admin"] as const) {
      const { browser } = await signedIn(role);
      expect((await browser.get(`/history/${checkId}`)).status).toBe(200);
      const photo = await browser.get(`/photos/check/${checkId}`);
      expect(photo.status).toBe(200);
      expect(photo.headers.get("content-type")).toBe("image/jpeg");
      expect(photo.headers.get("cache-control")).toContain("private");
      expect((await browser.get(`/photos/defect/${defectId}`)).status).toBe(200);
    }
  });

  it("photos cannot be fetched by guessing or knowing the storage key", async () => {
    const { photoKey } = await driverCheck();
    const { browser } = await signedIn("admin");
    const uuidPart = photoKey.split("/")[1] ?? "";
    for (const path of [
      `/${photoKey}`,
      `/photos/${photoKey}`,
      `/photos/check/${uuidPart}`,
      `/photos/check/${photoKey}`,
    ]) {
      expect((await browser.get(path)).status, path).toBe(404);
    }
    expect((await new Browser().get(`/photos/check/${uuidPart}`)).status).toBe(303);
  });
});

describe("CSRF protection", () => {
  it("rejects form posts without the token, with a wrong token, or from another site", async () => {
    const { browser } = await signedIn("admin");
    const fields = { name: "Sneaky", odometer: "1" };
    expect((await browser.post("/fleet", fields, { csrf: false })).status).toBe(403);
    expect((await browser.post("/fleet", fields, { csrf: "0".repeat(64) })).status).toBe(403);
    expect((await browser.post("/fleet", fields, { origin: "https://evil.example" })).status).toBe(403);
    expect(await db().select().from(vehicle).all()).toHaveLength(0);
    expect((await browser.post("/fleet", fields)).status).toBe(303);
    expect(await db().select().from(vehicle).all()).toHaveLength(1);
  });

  it("protects the sign-in form too", async () => {
    const b = new Browser();
    expect((await b.post("/login", { email: "a@example.com", password: "x" }, { csrf: false })).status).toBe(403);
  });
});

describe("escaping", () => {
  it("shows text people type as text, never as HTML", async () => {
    const { browser } = await signedIn("admin");
    const nasty = `<script>alert("x")</script><img src=x onerror=alert(1)>`;
    expect((await browser.post("/fleet", { name: nasty.slice(0, 60), odometer: "5", notes: nasty })).status).toBe(303);
    const html = await (await browser.get("/fleet")).text();
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("sends a strict content security policy", async () => {
    const res = await new Browser().get("/login");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("validation", () => {
  it("rejects bad input on every kind of form", async () => {
    const { browser } = await signedIn("admin");
    const v = await makeVehicle();
    const cases: [string, Record<string, string>][] = [
      ["/fleet", { name: "", odometer: "1" }],
      ["/fleet", { name: "Ute", odometer: "-5" }],
      ["/fleet", { name: "Ute", odometer: "1.5" }],
      ["/fleet", { name: "Ute", odometer: "1", regoDue: "next week" }],
      ["/fleet", { name: "Ute", odometer: "1", status: "flying" }],
      ["/fleet", { name: "x".repeat(61), odometer: "1" }],
      [`/fleet/${v}`, { name: "Ute", odometer: "abc" }],
      ["/setup/business", { businessName: "" }],
      ["/setup/business", { businessName: "Ok", supportEmail: "not-an-email" }],
      ["/setup/business", { businessName: "Ok", setupHelpUrl: "javascript:alert(1)" }],
      ["/setup/checklist", { label: "" }],
      ["/setup/checklist", { label: "x".repeat(121) }],
      ["/check", { submissionId: "not-a-uuid", vehicleId: v, odometer: "1" }],
      ["/check", { submissionId: crypto.randomUUID(), vehicleId: "../etc", odometer: "1" }],
      ["/check", { submissionId: crypto.randomUUID(), vehicleId: v, odometer: "-1" }],
      ["/check", { submissionId: crypto.randomUUID(), vehicleId: v, odometer: "1", severity: "apocalyptic" }],
      ["/account/name", { fullName: "" }],
      ["/account/password", { currentPassword: "x", newPassword: "short", confirm: "short" }],
    ];
    for (const [path, fields] of cases) {
      const res = await browser.post(path, fields);
      expect(res.status, `${path} ${JSON.stringify(fields)}`).toBe(400);
    }
    const team = await browser.post(`/setup/team/${someId}/role`, { role: "superadmin" });
    expect(team.status).toBe(400);
    expect((await browser.post("/fleet/not-a-uuid", { name: "x", odometer: "1" })).status).toBe(404);
    expect((await browser.get("/history/not-a-uuid")).status).toBe(404);
  });
});

describe("failure handling", () => {
  it("sends an expired session back to sign in with a clear message", async () => {
    const b = new Browser();
    b.cookies.set("__Secure-prestart.session_token", "expired.token");
    const res = await b.get("/check");
    expect(location(res)).toContain("expired=1");
    const page = await (await b.get(location(res))).text();
    expect(page).toContain("Your session has ended");
  });

  it("rejects an oversized upload before reading it", async () => {
    const { browser } = await signedIn("driver");
    const res = await browser.get("/check");
    expect(res.status).toBe(200);
    const big = await SELFpost(browser, 13 * 1024 * 1024);
    expect(big.status).toBe(413);
  });

  it("explains a photo that is too big, and keeps the answers", async () => {
    const v = await makeVehicle();
    await makeItems(["Tyres"]);
    const { browser } = await signedIn("driver");
    const photo = new File([new Uint8Array(11 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    const res = await browser.post("/check", {
      submissionId: crypto.randomUUID(),
      vehicleId: v,
      odometer: "1234",
      notes: "Cracked mirror",
      photo,
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("That photo is too big");
    expect(html).toContain("Cracked mirror");
    expect(await db().select().from(check).all()).toHaveLength(0);
  });

  it("rejects photos that are not images", async () => {
    const v = await makeVehicle();
    await makeItems(["Tyres"]);
    const { browser } = await signedIn("driver");
    const photo = new File(["<html>"], "x.html", { type: "text/html" });
    const res = await browser.post("/check", {
      submissionId: crypto.randomUUID(),
      vehicleId: v,
      odometer: "1",
      notes: "x",
      photo,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Photos must be JPEG");
  });

  it("shows a friendly page for unknown addresses", async () => {
    const res = await new Browser().get("/no-such-page");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Page not found");
  });

  it("only exposes the two Better Auth email-link endpoints", async () => {
    const b = new Browser();
    const res = await b.post("/api/auth/sign-up/email", { email: "x@example.com" });
    expect(res.status).toBe(404);
    expect((await b.get("/api/auth/get-session")).status).toBe(404);
  });
});

describe("sign in", () => {
  it("rejects a wrong password with a plain message", async () => {
    const { user } = await signedIn("driver");
    const b = new Browser();
    const res = await b.post("/login", { email: user.email, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("That email and password do not match.");
  });

  it("signs in and never redirects off-site", async () => {
    const { user } = await signedIn("driver");
    const b = new Browser();
    const res = await b.post("/login", {
      email: user.email,
      password: "correct-horse-battery",
      next: "//evil.example/x",
    });
    expect(res.status).toBe(303);
    expect(location(res)).toBe("/");
    expect(location(await b.get("/"))).toBe("/check");
  });

  it("returns to the page the person was trying to open", async () => {
    const { user } = await signedIn("driver");
    const b = new Browser();
    const res = await b.post("/login", { email: user.email, password: "correct-horse-battery", next: "/history" });
    expect(location(res)).toBe("/history");
  });

  it("signs out", async () => {
    const { browser } = await signedIn("driver");
    expect(location(await browser.post("/logout"))).toBe("/login?m=signedout");
    expect(location(await browser.get("/check"))).toMatch(/^\/login/);
  });

  it("keeps the demo sign-in switched off outside demo mode", async () => {
    expect((await new Browser().post("/login/demo", { role: "admin" })).status).toBe(404);
  });
});

/** Posts a body bigger than the upload limit, with an honest content-length. */
async function SELFpost(browser: Browser, bytes: number): Promise<Response> {
  const token = await browser.csrf();
  const body = new Uint8Array(bytes);
  return exports.default.fetch(`${ORIGIN}/check`, {
    method: "POST",
    body,
    redirect: "manual",
    headers: {
      origin: ORIGIN,
      "content-type": "multipart/form-data; boundary=x",
      "content-length": String(bytes),
      cookie: `prestart_csrf=${token}`,
    },
  });
}
