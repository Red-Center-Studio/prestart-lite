import type { Context } from "hono";
import type { Child } from "hono/jsx";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type AppEnv, isOn } from "../env";
import { getSettings } from "../services/fleet";
import { Page, type NavKey } from "../views/layout";

/** Renders a full page with the shared header, nav and business name. */
export async function render(
  c: Context<AppEnv>,
  opts: { title: string; active?: NavKey; status?: ContentfulStatusCode },
  body: Child,
): Promise<Response> {
  const settings = await getSettings(c.get("db"));
  return c.html(
    <Page
      title={opts.title}
      user={c.get("user")}
      active={opts.active}
      businessName={settings.businessName}
      csrf={c.get("csrfToken")}
      demo={isOn(c.env.DEMO_MODE)}
    >
      {body}
    </Page>,
    opts.status ?? 200,
  );
}

/** Reads a form body (including files) once; later calls return the same parsed object. */
export async function formBody(c: Context<AppEnv>) {
  return c.req.parseBody({ all: true });
}

/** The visitor's IP, used only as a rate-limit key. */
export const clientIp = (c: Context<AppEnv>): string => c.req.header("cf-connecting-ip") ?? "local";

/** Applies the sign-in rate limit. Returns true when the visitor should wait. */
export async function rateLimited(c: Context<AppEnv>, bucket: string): Promise<boolean> {
  const limiter = c.env.AUTH_LIMITER;
  if (!limiter) return false;
  try {
    const { success } = await limiter.limit({ key: `${bucket}:${clientIp(c)}` });
    return !success;
  } catch {
    return false;
  }
}
