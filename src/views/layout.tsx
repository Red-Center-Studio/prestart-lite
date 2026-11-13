import type { Child, FC } from "hono/jsx";
import { raw } from "hono/html";
import type { AppUser } from "../env";
import { can } from "../lib/can";
import { CSRF_FIELD } from "../lib/csrf-field";
import { roleLabel, words } from "../labels";

export type NavKey = "check" | "history" | "defects" | "fleet" | "setup" | "account";

interface NavLink {
  key: NavKey;
  href: string;
  label: string;
  show: (u: AppUser) => boolean;
}

const NAV: NavLink[] = [
  { key: "check", href: "/check", label: "Check", show: (u) => can(u, "check:submit") },
  { key: "history", href: "/history", label: "History", show: (u) => can(u, "check:submit") },
  { key: "defects", href: "/defects", label: "Defects", show: (u) => can(u, "defect:view") },
  { key: "fleet", href: "/fleet", label: "Fleet", show: (u) => can(u, "vehicle:view") },
  { key: "setup", href: "/setup", label: "Setup", show: (u) => can(u, "settings:edit") },
  { key: "account", href: "/account", label: "Account", show: (u) => can(u, "check:submit") },
];

export interface PageProps {
  title: string;
  user?: AppUser | null;
  active?: NavKey;
  businessName?: string;
  csrf: string;
  demo?: boolean;
  children?: Child;
}

export const Page: FC<PageProps> = ({ title, user, active, businessName, csrf, demo, children }) => (
  <>
    {raw("<!doctype html>")}
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0c29ab" />
        <meta name="robots" content="noindex" />
        <title>{`${title} | ${businessName ?? words.appName}`}</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css" />
        <script src="/app.js" defer></script>
      </head>
      <body class="min-h-dvh bg-gray-50 text-ink antialiased">
        <a
          href="#main"
          class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        {demo ? (
          <div class="bg-alert-50 px-4 py-2 text-center text-sm text-ink">
            Demo mode. Anything you change is wiped every night.
          </div>
        ) : null}
        <Header user={user ?? null} active={active} businessName={businessName} csrf={csrf} />
        <div id="net-error" class="mx-auto hidden max-w-3xl px-4 pt-4" role="alert"></div>
        <main id="main" class="mx-auto w-full max-w-3xl px-4 pb-16 pt-4 sm:pt-6">
          {children}
        </main>
      </body>
    </html>
  </>
);

const Header: FC<{
  user: AppUser | null;
  active?: NavKey | undefined;
  businessName?: string | undefined;
  csrf: string;
}> = ({ user, active, businessName, csrf }) => {
  const links = user && user.role ? NAV.filter((l) => l.show(user)) : [];
  return (
    <header class="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div class="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <a href="/" class="flex min-w-0 items-center gap-2 font-semibold text-ink">
          <Logo />
          <span class="truncate">{businessName ?? words.appName}</span>
        </a>
        {user ? (
          <form method="post" action="/logout" class="shrink-0">
            <input type="hidden" name={CSRF_FIELD} value={csrf} />
            <button type="submit" class="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
              Sign out
            </button>
          </form>
        ) : null}
      </div>
      {links.length > 0 ? (
        <nav aria-label="Main" class="mx-auto max-w-3xl px-2">
          <ul class="grid auto-cols-fr grid-flow-col gap-0.5 pb-2 sm:flex sm:gap-1">
            {links.map((l) => (
              <li>
                <a
                  href={l.href}
                  aria-current={active === l.key ? "page" : undefined}
                  class={
                    active === l.key
                      ? "block whitespace-nowrap rounded-lg bg-primary-100 px-1 py-2.5 text-center text-[13px] font-semibold text-primary sm:px-3 sm:text-sm"
                      : "block whitespace-nowrap rounded-lg px-1 py-2.5 text-center text-[13px] text-gray-700 hover:bg-gray-100 sm:px-3 sm:text-sm"
                  }
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {user && user.role ? (
        <p class="sr-only">
          Signed in as {user.name}, {roleLabel[user.role]}
        </p>
      ) : null}
    </header>
  );
};

export const Logo: FC = () => (
  <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" class="shrink-0">
    <rect width="32" height="32" rx="8" fill="#0c29ab" />
    <path
      d="M9 16.5l4.5 4.5L23 11.5"
      fill="none"
      stroke="#fff"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);
