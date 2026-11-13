import { Hono } from "hono";
import type { AppEnv } from "../env";
import { can } from "../lib/can";
import { requirePermission } from "../lib/middleware";
import { historyQuerySchema, id as idSchema } from "../lib/validate";
import { formatDateTime, formatNumber } from "../lib/text";
import { checkDrivers, getCheck, listChecks } from "../services/checks";
import { listVehicles } from "../services/fleet";
import { words } from "../labels";
import { Alert, btn, Card, Empty, H1, PassBadge } from "../views/components";
import { render } from "./render";

export const historyRoutes = new Hono<AppEnv>();

const selectClass =
  "block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-200";

historyRoutes.get("/history", requirePermission("check:submit"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  const db = c.get("db");
  const q = historyQuerySchema.parse(c.req.query());
  const staff = can(user, "check:viewAll");
  const [{ rows, hasMore }, vehicles, drivers] = await Promise.all([
    listChecks(db, user, q),
    listVehicles(db, user),
    staff ? checkDrivers(db) : Promise.resolve([]),
  ]);
  const pageLink = (page: number) => {
    const p = new URLSearchParams();
    if (q.vehicle) p.set("vehicle", q.vehicle);
    if (q.driver && staff) p.set("driver", q.driver);
    if (q.from) p.set("from", q.from);
    if (q.to) p.set("to", q.to);
    if (q.result) p.set("result", q.result);
    p.set("page", String(page));
    return `/history?${p.toString()}`;
  };
  const filtered = Boolean(q.vehicle || q.driver || q.from || q.to || q.result);

  return render(
    c,
    { title: "History", active: "history" },
    <>
      <H1 sub={staff ? "Every check, newest first." : "Your checks, newest first."}>History</H1>
      <details class="mb-4 rounded-2xl border border-gray-200 bg-white p-4" open={filtered}>
        <summary class="cursor-pointer font-semibold">Filter</summary>
        <form method="get" action="/history" class="mt-3 grid gap-3 sm:grid-cols-2">
          <label class="text-sm font-medium">
            Vehicle
            <select name="vehicle" class={selectClass}>
              <option value="">All vehicles</option>
              {vehicles.map((v) => (
                <option value={v.id} selected={q.vehicle === v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          {staff ? (
            <label class="text-sm font-medium">
              Driver
              <select name="driver" class={selectClass}>
                <option value="">All drivers</option>
                {drivers.map((d) => (
                  <option value={d.id} selected={q.driver === d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label class="text-sm font-medium">
            From
            <input type="date" name="from" value={q.from ?? ""} class={selectClass} />
          </label>
          <label class="text-sm font-medium">
            To
            <input type="date" name="to" value={q.to ?? ""} class={selectClass} />
          </label>
          <label class="text-sm font-medium">
            Result
            <select name="result" class={selectClass}>
              <option value="">Passed and failed</option>
              <option value="pass" selected={q.result === "pass"}>
                Passed only
              </option>
              <option value="fail" selected={q.result === "fail"}>
                Failed only
              </option>
            </select>
          </label>
          <div class="flex items-end gap-2">
            <button type="submit" class={btn("primary")}>
              Apply
            </button>
            <a href="/history" class={btn("secondary")}>
              Clear
            </a>
          </div>
        </form>
      </details>

      {rows.length === 0 ? (
        <Empty>{filtered ? "No checks match these filters." : "No checks yet. Submitted checks will show here."}</Empty>
      ) : (
        <ul class="space-y-2">
          {rows.map((r) => (
            <li>
              <a
                href={`/history/${r.id}`}
                class="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 hover:border-primary-200"
              >
                <div class="min-w-0">
                  <p class="truncate font-semibold">{r.vehicleName}</p>
                  <p class="text-sm text-gray-600">
                    {formatDateTime(r.createdAt, c.env.TIME_ZONE)}
                    {staff ? ` Â· ${r.driverName}` : ""}
                  </p>
                  {r.odometerWentBack ? (
                    <p class="mt-1 text-xs font-semibold text-alert-700">Odometer lower than the last reading</p>
                  ) : null}
                </div>
                <PassBadge passed={r.passed} />
              </a>
            </li>
          ))}
        </ul>
      )}
      <div class="mt-4 flex justify-between">
        {q.page > 1 ? (
          <a class={btn("secondary")} href={pageLink(q.page - 1)}>
            Newer
          </a>
        ) : (
          <span />
        )}
        {hasMore ? (
          <a class={btn("secondary")} href={pageLink(q.page + 1)}>
            Older
          </a>
        ) : null}
      </div>
    </>,
  );
});

historyRoutes.get("/history/:id", requirePermission("check:submit"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  const parsed = idSchema.safeParse(c.req.param("id"));
  if (!parsed.success) return c.notFound();
  // getCheck returns null for another driver's check, so changing the id in the URL shows "not found".
  const found = await getCheck(c.get("db"), user, parsed.data);
  if (!found) return c.notFound();
  const { check: ch, results } = found;
  return render(
    c,
    { title: `Check: ${ch.vehicleName}`, active: "history" },
    <>
      <a href="/history" class="mb-3 inline-block text-sm text-primary underline">
        Back to history
      </a>
      <H1 sub={`${formatDateTime(ch.createdAt, c.env.TIME_ZONE)} by ${ch.driverName}`}>{ch.vehicleName}</H1>
      <Card class="mb-4">
        <div class="flex flex-wrap items-center gap-3">
          <PassBadge passed={ch.passed} />
          <span class="text-gray-700">
            {words.odometer}: {formatNumber(ch.odometerKm)} {words.distanceUnit}
          </span>
        </div>
        {ch.odometerWentBack ? (
          <Alert tone="warning">
            The driver confirmed a reading lower than the vehicle's previous one. Worth a quick check.
          </Alert>
        ) : null}
        {ch.notes ? <p class="mt-3 whitespace-pre-wrap text-gray-800">{ch.notes}</p> : null}
        {ch.photoKey ? (
          <a href={`/photos/check/${ch.id}`} target="_blank" rel="noopener" class="mt-3 block">
            <img
              src={`/photos/check/${ch.id}`}
              alt={`Photo from the check of ${ch.vehicleName}`}
              class="max-h-80 rounded-xl border border-gray-200"
              loading="lazy"
            />
          </a>
        ) : null}
      </Card>
      <Card>
        <h2 class="mb-2 text-lg font-semibold">Checklist</h2>
        <ul class="divide-y divide-gray-100">
          {results.map((r) => (
            <li class="flex items-center justify-between gap-3 py-2">
              <span>{r.label}</span>
              <span class={r.ok ? "text-sm font-semibold text-success" : "text-sm font-semibold text-danger"}>
                {r.ok ? "OK" : "Problem"}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>,
  );
});
