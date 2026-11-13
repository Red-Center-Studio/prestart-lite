import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { type Bindings, isOn } from "../env";
import { getDb } from "../db/client";
import { account, session, user, verification } from "../db/schema";
import { businessName, emailButton, sendEmail, senderName } from "../lib/email";
import { escapeHtml } from "../lib/text";
import { hashPassword, verifyPassword } from "./password";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/**
 * Makes the first account on a fresh deploy an Admin. Runs after every sign-up as one atomic statement:
 * only the oldest account gets the role, and only while no admin exists. If two people sign up at the same
 * moment, exactly one becomes Admin.
 */
export async function promoteFirstUser(d1: D1Database, userId: string): Promise<boolean> {
  const res = await d1
    .prepare(
      `UPDATE user SET role = 'admin'
       WHERE id = ?1
         AND id = (SELECT id FROM user ORDER BY created_at ASC, id ASC LIMIT 1)
         AND NOT EXISTS (SELECT 1 FROM user WHERE role = 'admin')`,
    )
    .bind(userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Example values that ship in .dev.vars.example (now or in earlier versions). Anyone can read them. */
export const PUBLIC_PLACEHOLDER_SECRETS = [
  "replace-me-with-a-long-random-string-of-32-or-more-characters",
  "local-development-secret-change-me-0123456789abcdef",
];

export function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** The address used in email links: APP_URL if set, otherwise the address the request came in on. */
export const appOrigin = (env: Bindings, requestOrigin: string): string =>
  env.APP_URL ? env.APP_URL.replace(/\/+$/, "") : requestOrigin;

export function createAuth(env: Bindings, origin: string) {
  // Refuse to run with a missing or weak secret rather than sign sessions with something guessable.
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
    throw new Error("AUTH_SECRET is missing or shorter than 32 characters. See SETUP.md, step 4.");
  }
  // The example placeholders are public. They are accepted on your own computer only, never on a live address.
  // Compared without surrounding whitespace: a pasted value often carries a stray space or line ending.
  if (PUBLIC_PLACEHOLDER_SECRETS.includes(env.AUTH_SECRET.trim()) && !isLocalOrigin(origin)) {
    throw new Error("AUTH_SECRET is still the example placeholder. Set a long random value. See SETUP.md, step 4.");
  }
  const baseURL = appOrigin(env, origin);
  const requireVerification = isOn(env.REQUIRE_EMAIL_VERIFICATION);
  return betterAuth({
    appName: "PreStart",
    baseURL,
    basePath: "/api/auth",
    secret: env.AUTH_SECRET,
    trustedOrigins: [baseURL, origin],
    database: drizzleAdapter(getDb(env.DB), {
      provider: "sqlite",
      schema: { user, session, account, verification },
    }),
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
      cookiePrefix: "prestart",
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, input: false },
        isDemo: { type: "boolean", required: false, defaultValue: false, input: false },
      },
      // Without email confirmation switched on, an unconfirmed address changes straight away. Otherwise Better Auth
      // emails a confirmation link to the new address first.
      changeEmail: { enabled: true, updateEmailWithoutVerification: !requireVerification },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      requireEmailVerification: requireVerification,
      autoSignIn: !requireVerification,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      password: { hash: hashPassword, verify: verifyPassword },
      sendResetPassword: async ({ user: u, url }) => {
        const m = resetEmail(senderName(await businessName(env)), new URL(baseURL).host, u.name, url);
        await sendEmail(env, { to: u.email, ...m });
      },
    },
    emailVerification: {
      sendOnSignUp: requireVerification,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user: u, url }) => {
        const m = verifyEmail(senderName(await businessName(env)), new URL(baseURL).host, u.name, url);
        await sendEmail(env, { to: u.email, ...m });
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (created) => {
            await promoteFirstUser(env.DB, created.id);
          },
        },
      },
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Where the account lives, in words: "Acme's PreStart (checks.acme.com)", or "PreStart (...)" with no name set. */
const place = (name: string, host: string) => `${name === "PreStart" ? "PreStart" : `${name}'s PreStart`} (${host})`;

export function resetEmail(name: string, host: string, person: string, url: string) {
  return {
    subject: name === "PreStart" ? "Reset your PreStart password" : `Reset your password for ${name}`,
    text: `Hi ${person},\n\nSomeone asked to reset the password for your account on ${place(name, host)}. Open this link to choose a new password. It works for 1 hour.\n\n${url}\n\nIf you did not ask for this, you can ignore this email. Your password stays the same.`,
    html: `<p>Hi ${escapeHtml(person)},</p><p>Someone asked to reset the password for your account on ${escapeHtml(place(name, host))}. The link works for 1 hour.</p>${emailButton(url, "Choose a new password")}<p>If you did not ask for this, you can ignore this email. Your password stays the same.</p>`,
  };
}

export function verifyEmail(name: string, host: string, person: string, url: string) {
  return {
    subject: name === "PreStart" ? "Confirm your email for PreStart" : `Confirm your email for ${name}`,
    text: `Hi ${person},\n\nThanks for signing up to ${place(name, host)}. Open this link to confirm your email address. It works for 24 hours.\n\n${url}\n\nAfter that, an admin gives you access. If you did not sign up, you can ignore this email.`,
    html: `<p>Hi ${escapeHtml(person)},</p><p>Thanks for signing up to ${escapeHtml(place(name, host))}. The link works for 24 hours.</p>${emailButton(url, "Confirm your email address")}<p>After that, an admin gives you access. If you did not sign up, you can ignore this email.</p>`,
  };
}
