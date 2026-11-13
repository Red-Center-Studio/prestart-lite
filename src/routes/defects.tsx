import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import type { Defect } from "../db/schema";
import { can } from "../lib/can";
import { requirePermission } from "../lib/middleware";
import { defectNotesSchema, firstError, formValues, id as idSchema } from "../lib/validate";
import { formatDateTime } from "../lib/text";
import { listActiveDefects, listRecentlyFixed, markFixed, saveNotes, startWork } from "../services/defects";
import { Alert, Button, Card, Csrf, DefectStatusBadge, Empty, H1, SeverityBadge } from "../views/components";
import { formBody, render } from "./render";

export const defectRoutes = new Hono<AppEnv>();

const messages: Record<string, { tone: "success" | "info"; text: string }> = {
  started: { tone: "info", text: "Marked as in progress." },
  notes: { tone: "success", text: "Notes saved." },
  fixed: { tone: "success", text: "Marked fixed." },
  "fixed-in-service": { tone: "success", text: "Marked fixed. The vehicle is back in service." },
  "fixed-still-off": {
    tone: "info",
    text: "Marked fixed. The vehicle stays off road because it has another critical defect.",
  },
};

const DefectCard = ({ c, d, canWork }: { c: Context<AppEnv>; d: Defect; canWork: boolean }) => (
  <li>
    <Card>
      <div class="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={d.severity} />
        <DefectStatusBadge status={d.status} />
      </div>
      <h2 class="mt-2 text-lg font-semibold">{d.vehicleName}</h2>
      <p class="mt-1 whitespace-pre-wrap text-gray-800">{d.description}</p>
      <p class="mt-2 text-sm text-gray-600">
        Reported {formatDateTime(d.createdAt, c.env.TIME_ZONE)} by {d.reportedByName}
      </p>
      {d.photoKey && can(c.get("user"), "photo:view", { ownerId: d.reportedById }) ? (
        <a href={`/photos/defect/${d.id}`} target="_blank" rel="noopener" class="mt-3 block">
          <img
            src={`/photos/defect/${d.id}`}
            alt={`Photo of the defect on ${d.vehicleName}`}
            class="max-h-64 rounded-xl border border-gray-200"
            loading="lazy"
          />
        </a>
      ) : null}
      {d.checkId && can(c.get("user"), "check:view", { ownerId: d.reportedById }) ? (
        <a href={`/history/${d.checkId}`} class="mt-2 inline-block text-sm text-primary underline">
          View the check
        </a>
      ) : null}
      {canWork ? (
        <div class="mt-4 border-t border-gray-100 pt-4">
          <form method="post" action={`/defects/${d.id}/fix`} data-enhance>
            <Csrf token={c.get("csrfToken")} />
            <label for={`notes-${d.id}`} class="mb-1 block text-sm font-medium">
              Workshop notes
            </label>
            <textarea
              id={`notes-${d.id}`}
              name="workshopNotes"
              rows={2}
              maxlength={2000}
              class="mb-3 block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-200"
            >
              {d.workshopNotes}
            </textarea>
            <div class="flex flex-wrap gap-2">
              {d.status === "open" ? (
                <Button kind="secondary" type="submit" name="op" value="start">
                  Start work
                </Button>
              ) : null}
              <Button kind="secondary" type="submit" name="op" value="notes">
                Save notes
              </Button>
              <Button type="submit" name="op" value="fix" confirm="Mark this defect fixed?">
                Mark fixed
              </Button>
            </div>
          </form>
        </div>
      ) : d.workshopNotes ? (
        <p class="mt-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">Workshop: {d.workshopNotes}</p>
      ) : null}
    </Card>
  </li>
);

async function page(c: Context<AppEnv>, error?: string, status: 200 | 400 | 409 = 200) {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  const db = c.get("db");
  const [active, fixed] = await Promise.all([listActiveDefects(db, user), listRecentlyFixed(db, user)]);
  const canWork = can(user, "defect:work");
  const msg = messages[c.req.query("m") ?? ""];
  return render(
    c,
    { title: "Defects", active: "defects", status },
    <>
      <H1
        sub={canWork ? "Open and in-progress defects, critical first." : "What the workshop is working on. Read only."}
      >
        Defects
      </H1>
      {msg && !error ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {active.length === 0 ? (
        <Empty>No open defects. Nice work.</Empty>
      ) : (
        <ul class="space-y-3">
          {active.map((d) => (
            <DefectCard c={c} d={d} canWork={canWork} />
          ))}
        </ul>
      )}
      {fixed.length > 0 ? (
        <details class="mt-6">
          <summary class="cursor-pointer font-semibold">Recently fixed</summary>
          <ul class="mt-3 space-y-2">
            {fixed.map((d) => (
              <li class="rounded-2xl border border-line bg-white shadow-sm p-4">
                <div class="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={d.severity} />
                  <span class="font-semibold">{d.vehicleName}</span>
                </div>
                <p class="mt-1 text-sm text-gray-700">{d.description}</p>
                <p class="mt-1 text-sm text-gray-600">
                  Fixed {d.fixedAt ? formatDateTime(d.fixedAt, c.env.TIME_ZONE) : ""}
                  {d.workshopNotes ? `. ${d.workshopNotes}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>,
  );
}

defectRoutes.get("/defects", requirePermission("defect:view"), (c) => page(c));

defectRoutes.post("/defects/:id/fix", requirePermission("defect:work"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  const idParse = idSchema.safeParse(c.req.param("id"));
  if (!idParse.success) return c.notFound();
  const values = formValues(await formBody(c));
  const parsed = defectNotesSchema.safeParse(values);
  if (!parsed.success) return page(c, firstError(parsed.error), 400);
  const db = c.get("db");
  const notes = parsed.data.workshopNotes;

  if (values.op === "start") {
    const res = await startWork(db, user, idParse.data);
    if (!res.ok) return page(c, res.message, 409);
    if (notes) await saveNotes(db, user, idParse.data, notes);
    return c.redirect("/defects?m=started", 303);
  }
  if (values.op === "notes") {
    const res = await saveNotes(db, user, idParse.data, notes);
    if (!res.ok) return page(c, res.message, 409);
    return c.redirect("/defects?m=notes", 303);
  }
  if (values.op === "fix") {
    const res = await markFixed(db, user, idParse.data, notes);
    if (!res.ok) return page(c, res.message, 409);
    const m = res.returnedToService ? "fixed-in-service" : res.stillOffRoad ? "fixed-still-off" : "fixed";
    return c.redirect(`/defects?m=${m}`, 303);
  }
  return page(c, "Choose an action.", 400);
});
