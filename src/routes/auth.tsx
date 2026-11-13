import { Hono, type Context } from "hono";
import { APIError } from "better-auth/api";
import { type AppEnv, isOn } from "../env";
import { createAuth } from "../auth/auth";
import { homeFor, requireSignedIn, safeNext } from "../lib/middleware";
import { firstError, forgotSchema, formValues, resetSchema, signInSchema, signUpSchema } from "../lib/validate";
import { emailReady } from "../lib/email";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../seed/demo";
import { getSettings } from "../services/fleet";
import { Alert, btn, Button, Card, Csrf, Field, H1 } from "../views/components";
import { formBody, rateLimited, render } from "./render";
import { roleLabel } from "../labels";

export const authRoutes = new Hono<AppEnv>();

const copyCookies = (c: Context<AppEnv>, headers: Headers) => {
  for (const value of headers.getSetCookie()) c.header("set-cookie", value, { append: true });
};

const errorCode = (err: unknown): string => {
  if (err instanceof APIError) {
    const body = err.body as { code?: unknown } | undefined;
    return typeof body?.code === "string" ? body.code : String(err.status);
  }
  return "UNKNOWN";
};

const TOO_MANY = "Too many attempts. Wait a minute, then try again.";

// ---------- Landing ----------

authRoutes.get("/", async (c) => {
  const u = c.get("user");
  if (u) return c.redirect(homeFor(u), 303);
  const settings = await getSettings(c.get("db"));
  return render(
    c,
    { title: "Daily vehicle checks" },
    <>
      <div class="mb-5 rounded-3xl bg-navy px-5 py-7 text-white shadow-lg sm:px-8 sm:py-10">
        <p class="text-sm font-semibold uppercase tracking-wide text-accent">{settings.businessName}</p>
        <h1 class="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Daily pre-start checks, done in a minute.</h1>
        <p class="mt-3 text-lg text-navy-200">
          Drivers tick the checklist before they drive. Problems go straight to the workshop. Unsafe vehicles come off
          the road until they are fixed.
        </p>
      </div>
      <SignInCard c={c} />
      <ul class="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          ["Quick checks", "Built for phones, so drivers can check from the yard."],
          ["Defect queue", "The workshop sees every fault, critical ones first."],
          ["Full history", "Every check is saved with who, when and what was ticked."],
        ].map(([title, text]) => (
          <li class="rounded-2xl border border-line bg-white shadow-sm p-4">
            <p class="font-semibold">{title}</p>
            <p class="mt-1 text-sm text-gray-600">{text}</p>
          </li>
        ))}
      </ul>
    </>,
  );
});

// ---------- Sign in ----------

const loginMessages: Record<string, { tone: "info" | "success" | "warning"; text: string }> = {
  expired: { tone: "warning", text: "Your session has ended. Sign in again to carry on." },
  verified: { tone: "success", text: "Email confirmed. You can sign in now." },
  reset: { tone: "success", text: "Password changed. Sign in with your new password." },
  signedout: { tone: "info", text: "You are signed out." },
};

const SignInCard = ({
  c,
  error,
  email,
  next,
}: {
  c: Context<AppEnv>;
  error?: string;
  email?: string;
  next?: string | null;
}) => {
  const demo = isOn(c.env.DEMO_MODE);
  return (
    <Card>
      <h2 class="mb-4 text-xl font-semibold">Sign in</h2>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {demo ? (
        <div class="mb-5">
          <p class="mb-2 text-sm text-gray-700">Try the demo as:</p>
          <div class="grid grid-cols-3 gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <form method="post" action="/login/demo">
                <Csrf token={c.get("csrfToken")} />
                <input type="hidden" name="role" value={a.role} />
                <Button kind="secondary" full>
                  {roleLabel[a.role]}
                </Button>
              </form>
            ))}
          </div>
        </div>
      ) : null}
      <form method="post" action="/login" data-enhance>
        <Csrf token={c.get("csrfToken")} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Field label="Email" name="email" type="email" autocomplete="email" required value={email} maxlength={254} />
        <Field
          label="Password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
          maxlength={128}
        />
        <Button full>Sign in</Button>
      </form>
      <div class="mt-4 flex flex-wrap justify-between gap-2 text-sm">
        <a class="text-primary underline" href="/forgot-password">
          Forgot your password?
        </a>
        {demo ? null : (
          <a class="text-primary underline" href="/signup">
            Create an account
          </a>
        )}
      </div>
    </Card>
  );
};

authRoutes.get("/login", async (c) => {
  const u = c.get("user");
  const next = safeNext(c.req.query("next"));
  if (u) return c.redirect(next ?? homeFor(u), 303);
  const key = c.req.query("expired") ? "expired" : (c.req.query("m") ?? "");
  const msg = loginMessages[key];
  return render(
    c,
    { title: "Sign in" },
    <div class="mx-auto max-w-md">
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <SignInCard c={c} next={next} />
    </div>,
  );
});

authRoutes.post("/login", async (c) => {
  const values = formValues(await formBody(c));
  const parsed = signInSchema.safeParse(values);
  const email = typeof values.email === "string" ? values.email : "";
  const next = safeNext(typeof values.next === "string" ? values.next : null);
  const fail = (error: string, status: 400 | 401 | 403 | 429 = 400) =>
    render(
      c,
      { title: "Sign in", status },
      <div class="mx-auto max-w-md">
        <SignInCard c={c} error={error} email={email} next={next} />
      </div>,
    );
  if (!parsed.success) return fail(firstError(parsed.error));
  if (await rateLimited(c, "login")) return fail(TOO_MANY, 429);
  const auth = createAuth(c.env, c.get("origin"));
  try {
    const { headers } = await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password, rememberMe: true },
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    copyCookies(c, headers);
    return c.redirect(next ?? "/", 303);
  } catch (err) {
    const code = errorCode(err);
    if (code === "EMAIL_NOT_VERIFIED") {
      return fail("Confirm your email first. We sent you a new link; check your inbox and spam folder.", 403);
    }
    if (err instanceof APIError) return fail("That email and password do not match.", 401);
    throw err;
  }
});

authRoutes.post("/login/demo", async (c) => {
  if (!isOn(c.env.DEMO_MODE)) return c.notFound();
  const role = formValues(await formBody(c)).role;
  const account = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!account) return c.redirect("/login", 303);
  const auth = createAuth(c.env, c.get("origin"));
  try {
    const { headers } = await auth.api.signInEmail({
      body: { email: account.email, password: DEMO_PASSWORD, rememberMe: false },
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    copyCookies(c, headers);
    return c.redirect("/", 303);
  } catch {
    return render(
      c,
      { title: "Sign in", status: 503 },
      <div class="mx-auto max-w-md">
        <SignInCard c={c} error="The demo is being reset. Try again in a minute." />
      </div>,
    );
  }
});

authRoutes.post("/logout", async (c) => {
  if (c.get("user")) {
    const auth = createAuth(c.env, c.get("origin"));
    try {
      const { headers } = await auth.api.signOut({ headers: c.req.raw.headers, returnHeaders: true });
      copyCookies(c, headers);
    } catch {
      // Already signed out: nothing to do.
    }
  }
  return c.redirect("/login?m=signedout", 303);
});

// ---------- Sign up ----------

const SignUpForm = ({ c, error, values }: { c: Context<AppEnv>; error?: string; values?: Record<string, unknown> }) => (
  <div class="mx-auto max-w-md">
    <H1 sub="An admin approves new accounts before they can be used.">Create an account</H1>
    <Card>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form method="post" action="/signup" data-enhance>
        <Csrf token={c.get("csrfToken")} />
        <Field
          label="Full name"
          name="fullName"
          autocomplete="name"
          required
          maxlength={80}
          value={typeof values?.fullName === "string" ? values.fullName : ""}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          autocomplete="email"
          required
          maxlength={254}
          value={typeof values?.email === "string" ? values.email : ""}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autocomplete="new-password"
          required
          maxlength={128}
          hint="At least 8 characters."
        />
        <Button full>Create account</Button>
      </form>
      <p class="mt-4 text-sm">
        Already have an account?{" "}
        <a class="text-primary underline" href="/login">
          Sign in
        </a>
      </p>
      <p class="mt-2 text-xs text-gray-500">
        By creating an account you agree to the{" "}
        <a class="underline" href="/terms">
          terms
        </a>{" "}
        and{" "}
        <a class="underline" href="/privacy">
          privacy policy
        </a>
        .
      </p>
    </Card>
  </div>
);

const demoSignupOff = (c: Context<AppEnv>) =>
  render(
    c,
    { title: "Create an account" },
    <div class="mx-auto max-w-md">
      <Alert>Sign-up is switched off in the demo. Use one of the demo accounts on the sign-in page.</Alert>
      <a class={btn("primary")} href="/login">
        Go to sign in
      </a>
    </div>,
  );

authRoutes.get("/signup", async (c) => {
  const u = c.get("user");
  if (u) return c.redirect(homeFor(u), 303);
  if (isOn(c.env.DEMO_MODE)) return demoSignupOff(c);
  return render(c, { title: "Create an account" }, <SignUpForm c={c} />);
});

authRoutes.post("/signup", async (c) => {
  if (isOn(c.env.DEMO_MODE)) return demoSignupOff(c);
  const values = formValues(await formBody(c));
  const fail = (error: string, status: 400 | 429 = 400) =>
    render(c, { title: "Create an account", status }, <SignUpForm c={c} error={error} values={values} />);
  const parsed = signUpSchema.safeParse(values);
  if (!parsed.success) return fail(firstError(parsed.error));
  if (await rateLimited(c, "signup")) return fail(TOO_MANY, 429);

  const requireVerification = isOn(c.env.REQUIRE_EMAIL_VERIFICATION);
  const auth = createAuth(c.env, c.get("origin"));
  try {
    const { headers } = await auth.api.signUpEmail({
      body: {
        name: parsed.data.fullName,
        email: parsed.data.email,
        password: parsed.data.password,
        callbackURL: "/login?m=verified",
      },
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    if (requireVerification) return c.redirect("/signup/check-email", 303);
    copyCookies(c, headers);
    return c.redirect("/", 303);
  } catch (err) {
    const code = errorCode(err);
    if (code === "USER_ALREADY_EXISTS" || code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
      // Same answer as a new sign-up when emails are verified, so nobody can probe which emails have accounts.
      if (requireVerification) return c.redirect("/signup/check-email", 303);
      return fail("An account with that email already exists. Sign in, or reset your password.");
    }
    if (err instanceof APIError) return fail("That did not work. Check your details and try again.");
    throw err;
  }
});

authRoutes.get("/signup/check-email", async (c) =>
  render(
    c,
    { title: "Check your email" },
    <div class="mx-auto max-w-md">
      <H1 sub="We sent you a link to confirm your email address. Open it to finish signing up.">Check your email</H1>
      <p class="text-gray-700">It can take a minute. Check your spam folder too.</p>
    </div>,
  ),
);

// ---------- Waiting for approval ----------

authRoutes.get("/waiting", requireSignedIn, async (c) => {
  const u = c.get("user");
  if (u?.role) return c.redirect(homeFor(u), 303);
  const settings = await getSettings(c.get("db"));
  return render(
    c,
    { title: "Waiting for approval" },
    <div class="mx-auto max-w-md">
      <H1 sub="Your account is set up. An admin needs to give you a role before you can use the app.">
        Waiting for approval
      </H1>
      <Card>
        <p class="text-gray-700">
          Let your manager know you have signed up as <strong>{u?.email}</strong>. Once they approve you, refresh this
          page.
        </p>
        {settings.supportEmail ? (
          <p class="mt-3 text-sm text-gray-600">
            Questions? Email{" "}
            <a class="text-primary underline" href={`mailto:${settings.supportEmail}`}>
              {settings.supportEmail}
            </a>
            .
          </p>
        ) : null}
        <a class={btn("secondary", "mt-4")} href="/waiting">
          Refresh
        </a>
      </Card>
    </div>,
  );
});

// ---------- Forgot and reset password ----------

const ForgotForm = ({ c, error, sent }: { c: Context<AppEnv>; error?: string; sent?: boolean }) => (
  <div class="mx-auto max-w-md">
    <H1 sub="We will email you a link to choose a new password.">Reset your password</H1>
    <Card>
      {sent ? (
        <Alert tone="success">
          If that email has an account, a reset link is on its way. It works for 1 hour. Check your spam folder too.
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!emailReady(c.env) ? (
        <Alert tone="warning">
          Email is not set up on this app yet, so reset links cannot be sent. Ask your admin to reset your access.
        </Alert>
      ) : null}
      <form method="post" action="/forgot-password" data-enhance>
        <Csrf token={c.get("csrfToken")} />
        <Field label="Email" name="email" type="email" autocomplete="email" required maxlength={254} />
        <Button full>Send reset link</Button>
      </form>
      <p class="mt-4 text-sm">
        <a class="text-primary underline" href="/login">
          Back to sign in
        </a>
      </p>
    </Card>
  </div>
);

authRoutes.get("/forgot-password", async (c) => render(c, { title: "Reset your password" }, <ForgotForm c={c} />));

authRoutes.post("/forgot-password", async (c) => {
  const values = formValues(await formBody(c));
  const parsed = forgotSchema.safeParse(values);
  if (!parsed.success) {
    return render(
      c,
      { title: "Reset your password", status: 400 },
      <ForgotForm c={c} error={firstError(parsed.error)} />,
    );
  }
  if (await rateLimited(c, "forgot")) {
    return render(c, { title: "Reset your password", status: 429 }, <ForgotForm c={c} error={TOO_MANY} />);
  }
  const auth = createAuth(c.env, c.get("origin"));
  try {
    await auth.api.requestPasswordReset({
      body: { email: parsed.data.email, redirectTo: "/reset-password" },
      headers: c.req.raw.headers,
    });
  } catch (err) {
    // Same answer either way, so nobody can probe which emails have accounts.
    console.error(JSON.stringify({ event: "reset_request_failed", error: String(err) }));
  }
  return render(c, { title: "Reset your password" }, <ForgotForm c={c} sent />);
});

const ResetForm = ({ c, token, error }: { c: Context<AppEnv>; token: string; error?: string }) => (
  <div class="mx-auto max-w-md">
    <H1>Choose a new password</H1>
    <Card>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <form method="post" action="/reset-password" data-enhance>
        <Csrf token={c.get("csrfToken")} />
        <input type="hidden" name="token" value={token} />
        <Field
          label="New password"
          name="password"
          type="password"
          autocomplete="new-password"
          required
          maxlength={128}
          hint="At least 8 characters."
        />
        <Field
          label="Type it again"
          name="confirm"
          type="password"
          autocomplete="new-password"
          required
          maxlength={128}
        />
        <Button full>Save new password</Button>
      </form>
    </Card>
  </div>
);

const badResetLink = (c: Context<AppEnv>) =>
  render(
    c,
    { title: "Reset link expired", status: 400 },
    <div class="mx-auto max-w-md">
      <H1 sub="Reset links work once, for 1 hour.">That reset link has expired</H1>
      <a class={btn("primary")} href="/forgot-password">
        Send a new link
      </a>
    </div>,
  );

authRoutes.get("/reset-password", async (c) => {
  const token = c.req.query("token") ?? "";
  if (!token || c.req.query("error") || token.length > 256) return badResetLink(c);
  return render(c, { title: "Choose a new password" }, <ResetForm c={c} token={token} />);
});

authRoutes.post("/reset-password", async (c) => {
  const values = formValues(await formBody(c));
  const token = typeof values.token === "string" ? values.token.slice(0, 256) : "";
  const parsed = resetSchema.safeParse(values);
  if (!parsed.success) {
    if (!token) return badResetLink(c);
    return render(
      c,
      { title: "Choose a new password", status: 400 },
      <ResetForm c={c} token={token} error={firstError(parsed.error)} />,
    );
  }
  if (await rateLimited(c, "reset")) {
    return render(
      c,
      { title: "Choose a new password", status: 429 },
      <ResetForm c={c} token={token} error={TOO_MANY} />,
    );
  }
  const auth = createAuth(c.env, c.get("origin"));
  try {
    await auth.api.resetPassword({ body: { newPassword: parsed.data.password, token: parsed.data.token } });
  } catch (err) {
    if (err instanceof APIError) return badResetLink(c);
    throw err;
  }
  return c.redirect("/login?m=reset", 303);
});
