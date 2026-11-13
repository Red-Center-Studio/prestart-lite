import { Hono, type Context } from "hono";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { user as userTable } from "../db/schema";
import { emailReady } from "../lib/email";
import { createAuth } from "../auth/auth";
import { requireMember } from "../lib/middleware";
import { accountEmailSchema, accountNameSchema, accountPasswordSchema, firstError, formValues } from "../lib/validate";
import { updateName } from "../services/team";
import { roleLabel } from "../labels";
import { Alert, Button, Card, Csrf, Field, H1, H2 } from "../views/components";
import { formBody, rateLimited, render } from "./render";

export const accountRoutes = new Hono<AppEnv>();

const messages: Record<string, string> = {
  name: "Name saved.",
  password: "Password changed. Other devices have been signed out.",
  email: "Email updated.",
  "email-sent": "Check your new inbox for a link to confirm the change.",
};

async function page(c: Context<AppEnv>, error?: string, status: 200 | 400 | 401 | 403 | 429 = 200) {
  const user = c.get("user");
  if (!user || !user.role) throw new Error("unreachable");
  const csrf = c.get("csrfToken");
  const msg = messages[c.req.query("m") ?? ""];
  return render(
    c,
    { title: "Account", active: "account", status },
    <div class="mx-auto max-w-lg">
      <H1 sub={`Signed in as ${roleLabel[user.role]}.`}>Account</H1>
      {msg && !error ? <Alert tone="success">{msg}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {user.isDemo ? <Alert tone="warning">Demo accounts cannot change their name, email or password.</Alert> : null}
      <Card class="mb-4">
        <H2>Name</H2>
        <form method="post" action="/account/name" data-enhance>
          <Csrf token={csrf} />
          <Field label="Full name" name="fullName" autocomplete="name" required maxlength={80} value={user.name} />
          <Button>Save name</Button>
        </form>
      </Card>
      <Card class="mb-4">
        <H2>Email</H2>
        <form method="post" action="/account/email" data-enhance>
          <Csrf token={csrf} />
          <Field
            label="Email"
            name="email"
            type="email"
            autocomplete="email"
            required
            maxlength={254}
            value={user.email}
          />
          <Button>Change email</Button>
        </form>
      </Card>
      <Card>
        <H2>Password</H2>
        <form method="post" action="/account/password" data-enhance>
          <Csrf token={csrf} />
          <Field
            label="Current password"
            name="currentPassword"
            type="password"
            autocomplete="current-password"
            required
            maxlength={128}
          />
          <Field
            label="New password"
            name="newPassword"
            type="password"
            autocomplete="new-password"
            required
            maxlength={128}
            hint="At least 8 characters."
          />
          <Field
            label="Type the new password again"
            name="confirm"
            type="password"
            autocomplete="new-password"
            required
            maxlength={128}
          />
          <Button>Change password</Button>
        </form>
      </Card>
    </div>,
  );
}

const demoBlocked = (c: Context<AppEnv>) => page(c, "Demo accounts cannot be changed.", 403);

accountRoutes.get("/account", requireMember, (c) => page(c));

accountRoutes.post("/account/name", requireMember, async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  if (user.isDemo) return demoBlocked(c);
  const parsed = accountNameSchema.safeParse(formValues(await formBody(c)));
  if (!parsed.success) return page(c, firstError(parsed.error), 400);
  const res = await updateName(c.get("db"), user, parsed.data.fullName);
  if (!res.ok) return page(c, res.message, 400);
  return c.redirect("/account?m=name", 303);
});

accountRoutes.post("/account/email", requireMember, async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  if (user.isDemo) return demoBlocked(c);
  const parsed = accountEmailSchema.safeParse(formValues(await formBody(c)));
  if (!parsed.success) return page(c, firstError(parsed.error), 400);
  if (parsed.data.email === user.email) return c.redirect("/account", 303);
  if (await rateLimited(c, "email")) return page(c, "Too many attempts. Wait a minute, then try again.", 429);
  const auth = createAuth(c.env, c.get("origin"));
  try {
    await auth.api.changeEmail({
      body: { newEmail: parsed.data.email, callbackURL: "/account?m=email" },
      headers: c.req.raw.headers,
    });
  } catch (err) {
    if (err instanceof APIError)
      return page(c, "That email cannot be used. It may already belong to another account.", 400);
    throw err;
  }
  // Report what actually happened: changed now, or waiting for the person to confirm the new address.
  const row = await c
    .get("db")
    .select({ email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, user.id))
    .get();
  if (row?.email === parsed.data.email) return c.redirect("/account?m=email", 303);
  if (!emailReady(c.env)) {
    return page(c, "Email is not set up on this app, so the confirmation link could not be sent. Ask your admin.", 400);
  }
  return c.redirect("/account?m=email-sent", 303);
});

accountRoutes.post("/account/password", requireMember, async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  if (user.isDemo) return demoBlocked(c);
  const parsed = accountPasswordSchema.safeParse(formValues(await formBody(c)));
  if (!parsed.success) return page(c, firstError(parsed.error), 400);
  if (await rateLimited(c, "password")) return page(c, "Too many attempts. Wait a minute, then try again.", 429);
  const auth = createAuth(c.env, c.get("origin"));
  try {
    const { headers } = await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    for (const value of headers.getSetCookie()) c.header("set-cookie", value, { append: true });
  } catch (err) {
    if (err instanceof APIError) return page(c, "Your current password is not right.", 401);
    throw err;
  }
  return c.redirect("/account?m=password", 303);
});
