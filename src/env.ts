import type { DB } from "./db/client";
import type { Role } from "./labels";

/** Cloudflare bindings from wrangler.jsonc, plus the optional email binding (commented out until set up). */
export type Bindings = Omit<Env, "APP_URL" | "REQUIRE_EMAIL_VERIFICATION" | "MAIL_FROM" | "DEMO_MODE" | "TIME_ZONE"> & {
  APP_URL: string;
  TIME_ZONE: string;
  REQUIRE_EMAIL_VERIFICATION: string;
  MAIL_FROM: string;
  DEMO_MODE: string;
  EMAIL?: SendEmail;
};

/** The signed-in person, loaded fresh from the database on every request. */
export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role | null;
  isDemo: boolean;
  emailVerified: boolean;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    db: DB;
    user: AppUser | null;
    /** True when the browser sent a session cookie that is no longer valid. */
    sessionExpired: boolean;
    csrfToken: string;
    origin: string;
  };
}

export const isOn = (value: string | undefined): boolean => value === "true" || value === "1";
