/** Escapes text for HTML emails. Pages use hono/jsx, which escapes output on its own. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Formats an ISO timestamp as a short local-style date and time, in UTC unless a time zone is given. */
export function formatDateTime(iso: string, timeZone = "UTC"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat("en-AU", { ...options, timeZone: timeZone || "UTC" }).format(d);
  } catch {
    // An unknown time zone name in wrangler.jsonc falls back to UTC rather than breaking the page.
    return `${new Intl.DateTimeFormat("en-AU", { ...options, timeZone: "UTC" }).format(d)} UTC`;
  }
}

/** Formats a YYYY-MM-DD date as "12 Mar 2027". */
export function formatDate(ymd: string | null): string {
  if (!ymd) return "";
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    d,
  );
}

/** Whole days from today (UTC) until a YYYY-MM-DD date. Negative when the date has passed. */
export function daysUntil(ymd: string | null, now = new Date()): number | null {
  if (!ymd) return null;
  const target = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

export const formatNumber = (n: number): string => new Intl.NumberFormat("en-AU").format(n);
