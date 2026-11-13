import { Hono, type Context } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppEnv } from "../env";
import { defect, type ChecklistItem, type Defect, type Vehicle } from "../db/schema";
import { requirePermission } from "../lib/middleware";
import { checkSubmitSchema, firstError, formValues, id as idSchema } from "../lib/validate";
import { validatePhoto, MAX_PHOTO_BYTES } from "../lib/photos";
import { formatNumber } from "../lib/text";
import { getCheck, submitCheck, worstOf, type ItemAnswer } from "../services/checks";
import { listChecklist, listInServiceVehicles } from "../services/fleet";
import { SEVERITIES, severityHelp, severityLabel, words, type Severity } from "../labels";
import { Alert, btn, Button, Card, Csrf, Empty, H1, SeverityBadge } from "../views/components";
import { formBody, render } from "./render";

export const checkRoutes = new Hono<AppEnv>();

export const MAX_PHOTOS_PER_ITEM = 3;
export const MAX_OVERALL_PHOTOS = 3;

type Answer = { status: "pass" | "fail" | "na"; note: string; severity: Severity | null };

interface FormState {
  submissionId: string;
  vehicleId?: string | undefined;
  odometer?: string | undefined;
  answers?: Record<string, Answer> | undefined;
  notes?: string | undefined;
  severity?: Severity | undefined;
  reportAnyway?: boolean | undefined;
  error?: string | undefined;
  lowerReading?: number | undefined;
}

const inputClass =
  "block w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-200";

/** Three choices, each with a one-line explanation, so drivers pick the right level. */
const SeverityChoice = ({ name, value, legend }: { name: string; value: Severity | null; legend: string }) => (
  <fieldset class="mt-3">
    <legend class="mb-2 text-sm font-semibold">{legend}</legend>
    <div class="grid gap-2">
      {SEVERITIES.map((s) => (
        <label
          class={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border-2 bg-white px-3 py-2.5 ${
            s === "critical"
              ? "has-[:checked]:border-danger has-[:checked]:bg-danger-50"
              : s === "major"
                ? "has-[:checked]:border-accent-dark has-[:checked]:bg-alert-50"
                : "has-[:checked]:border-navy-700 has-[:checked]:bg-primary-50"
          } border-gray-300`}
        >
          <input type="radio" name={name} value={s} checked={value === s} class="mt-1 h-5 w-5 shrink-0 accent-navy" />
          <span>
            <span class="block font-semibold">{severityLabel[s]}</span>
            <span class="block text-sm text-gray-700">{severityHelp[s]}</span>
          </span>
        </label>
      ))}
    </div>
  </fieldset>
);

const ANSWER_STYLES: Record<Answer["status"], string> = {
  pass: "peer-checked:border-success peer-checked:bg-success peer-checked:text-white",
  fail: "peer-checked:border-danger peer-checked:bg-danger peer-checked:text-white",
  na: "peer-checked:border-slate-600 peer-checked:bg-slate-600 peer-checked:text-white",
};

const ItemRow = ({ item, answer }: { item: ChecklistItem; answer: Answer | undefined }) => (
  <li class="py-3" data-item>
    <p class="font-medium" id={`lbl-${item.id}`}>
      {item.label}
    </p>
    <div class="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby={`lbl-${item.id}`}>
      {(
        [
          ["pass", "Pass"],
          ["fail", "Fail"],
          ["na", "N/A"],
        ] as const
      ).map(([value, label]) => (
        <label class="cursor-pointer">
          <input
            type="radio"
            name={`s_${item.id}`}
            value={value}
            checked={answer?.status === value}
            class="peer sr-only"
            data-answer
          />
          <span
            class={`block min-h-12 rounded-xl border-2 border-gray-300 bg-white py-3 text-center font-semibold text-gray-700 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-200 ${ANSWER_STYLES[value]}`}
          >
            {label}
          </span>
        </label>
      ))}
    </div>
    <div class="mt-3 rounded-xl border-2 border-danger-200 bg-danger-50 p-3" data-fail-detail>
      <label for={`n_${item.id}`} class="mb-1 block text-sm font-semibold">
        What is wrong?
      </label>
      <textarea id={`n_${item.id}`} name={`n_${item.id}`} rows={2} maxlength={1000} class={inputClass} data-fail-note>
        {answer?.note ?? ""}
      </textarea>
      <SeverityChoice name={`v_${item.id}`} value={answer?.severity ?? null} legend="How serious is it?" />
      <label for={`p_${item.id}`} class="mb-1 mt-3 block text-sm font-semibold">
        Photos <span class="font-normal text-gray-600">(optional, up to {MAX_PHOTOS_PER_ITEM})</span>
      </label>
      <input
        id={`p_${item.id}`}
        name={`p_${item.id}`}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        capture="environment"
        class="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-navy-700 file:px-3 file:py-2 file:font-semibold file:text-white"
        data-photo
        data-max-files={MAX_PHOTOS_PER_ITEM}
      />
    </div>
  </li>
);

/** Items grouped by section, in checklist order. */
function bySection(items: ChecklistItem[]): [string, ChecklistItem[]][] {
  const groups = new Map<string, ChecklistItem[]>();
  for (const item of items) {
    const key = item.section || "General";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()];
}

const CheckForm = ({
  c,
  vehicles,
  items,
  faults,
  state,
}: {
  c: Context<AppEnv>;
  vehicles: Vehicle[];
  items: ChecklistItem[];
  faults: Defect[];
  state: FormState;
}) => {
  const faultsByVehicle = new Map<string, Defect[]>();
  for (const f of faults) faultsByVehicle.set(f.vehicleId, [...(faultsByVehicle.get(f.vehicleId) ?? []), f]);
  return (
    <form
      method="post"
      action="/check"
      enctype="multipart/form-data"
      data-enhance
      data-check-form
      data-max-photo={MAX_PHOTO_BYTES}
    >
      <Csrf token={c.get("csrfToken")} />
      <input type="hidden" name="submissionId" value={state.submissionId} />
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Card class="mb-4">
        <label for="f-vehicle" class="mb-1 block text-sm font-semibold">
          Vehicle
        </label>
        <select id="f-vehicle" name="vehicleId" required class={inputClass}>
          <option value="">Pick a vehicle</option>
          {vehicles.map((v) => (
            <option value={v.id} selected={state.vehicleId === v.id} data-odometer={v.odometerKm}>
              {v.rego ? `${v.name} (${v.rego})` : v.name}
            </option>
          ))}
        </select>

        {[...faultsByVehicle.entries()].map(([vehicleId, list]) => (
          <div
            class="mt-3 rounded-xl border-2 border-accent bg-alert-50 p-3"
            data-faults-for={vehicleId}
            hidden={state.vehicleId !== vehicleId}
          >
            <p class="font-semibold">Known faults on this vehicle</p>
            <p class="text-sm text-gray-700">Check these again. Report anything new or worse below.</p>
            <ul class="mt-2 space-y-1.5">
              {list.map((f) => (
                <li class="flex items-start gap-2 text-sm">
                  <SeverityBadge severity={f.severity} />
                  <span>{f.description}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <label for="f-odometer" class="mb-1 mt-4 block text-sm font-semibold">
          {words.odometer} ({words.distanceUnit})
        </label>
        <input
          id="f-odometer"
          name="odometer"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength={7}
          required
          autocomplete="off"
          value={state.odometer ?? ""}
          aria-describedby="odometer-hint"
          class={inputClass}
        />
        <p id="odometer-hint" class="mt-1 text-sm text-gray-600" data-odometer-hint>
          Whole number, no commas.
        </p>
        {state.lowerReading !== undefined ? (
          <div class="mt-3 rounded-xl border border-alert-200 bg-alert-50 p-3 text-sm" role="alert">
            <p>
              This reading is lower than the last one for this vehicle ({formatNumber(state.lowerReading)}{" "}
              {words.distanceUnit}). Check the number. If it is right, tick the box below and submit again. It will be
              flagged in history.
            </p>
            <label class="mt-2 flex items-center gap-2 font-medium">
              <input type="checkbox" name="confirmLower" value="1" class="h-5 w-5" /> Yes, this reading is right
            </label>
          </div>
        ) : null}
      </Card>

      <div class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-navy px-4 py-3 text-white">
        <p class="text-sm">
          Answer every item: <strong>Pass</strong>, <strong>Fail</strong> or <strong>N/A</strong>.{" "}
          <span class="text-navy-200" data-progress hidden></span>
        </p>
        <button type="button" class={btn("secondary", "min-h-10 px-3 py-1.5")} data-all-pass hidden>
          All pass
        </button>
      </div>

      {bySection(items).map(([section, list]) => (
        <Card class="mb-4 overflow-hidden">
          <h2 class="-mx-4 -mt-4 mb-1 bg-navy-700 px-4 py-2.5 text-base font-bold text-white sm:-mx-5 sm:-mt-5 sm:px-5">
            {section}
          </h2>
          <ul class="divide-y divide-gray-200">
            {list.map((item) => (
              <ItemRow item={item} answer={state.answers?.[item.id]} />
            ))}
          </ul>
        </Card>
      ))}

      <Card class="mb-4">
        <h2 class="mb-2 border-l-4 border-accent pl-3 text-lg font-bold text-navy">Anything else?</h2>
        <label for="f-notes" class="mb-1 block text-sm font-semibold">
          Other notes <span class="font-normal text-gray-600">(optional)</span>
        </label>
        <textarea id="f-notes" name="notes" rows={2} maxlength={1000} class={inputClass}>
          {state.notes ?? ""}
        </textarea>
        <label class="mt-3 flex items-start gap-3 rounded-xl border border-gray-300 bg-white p-3">
          <input
            type="checkbox"
            name="reportAnyway"
            value="1"
            checked={state.reportAnyway}
            class="mt-0.5 h-5 w-5 accent-navy"
            data-report-toggle
          />
          <span>Report a problem that is not on the checklist (describe it in the notes above)</span>
        </label>
        <div data-report-detail>
          <SeverityChoice name="severity" value={state.severity ?? "minor"} legend="How serious is that problem?" />
          <label for="f-photo" class="mb-1 mt-3 block text-sm font-semibold">
            Photos <span class="font-normal text-gray-600">(optional, up to {MAX_OVERALL_PHOTOS})</span>
          </label>
          <input
            id="f-photo"
            name="photo"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            capture="environment"
            class="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-navy-700 file:px-3 file:py-2 file:font-semibold file:text-white"
            data-photo
            data-max-files={MAX_OVERALL_PHOTOS}
          />
        </div>
        <p class="mt-2 hidden text-sm text-danger" data-photo-error role="alert"></p>
      </Card>

      <Button full>Submit check</Button>
    </form>
  );
};

async function showForm(c: Context<AppEnv>, state: FormState, status: 200 | 400 | 409 = 200) {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  const db = c.get("db");
  const [vehicles, items] = await Promise.all([listInServiceVehicles(db, user), listChecklist(db, user, true)]);
  const faults = vehicles.length
    ? await db
        .select()
        .from(defect)
        .where(
          and(
            inArray(defect.status, ["open", "in_progress"]),
            inArray(
              defect.vehicleId,
              vehicles.slice(0, 90).map((v) => v.id),
            ),
          ),
        )
        .orderBy(desc(defect.createdAt))
        .all()
    : [];
  let body;
  if (items.length === 0) {
    body = <Empty>No checklist items are set up yet. Ask an admin to add them on the Setup page.</Empty>;
  } else if (vehicles.length === 0) {
    body = <Empty>There are no vehicles in service to check. Ask an admin to add vehicles on the Fleet page.</Empty>;
  } else {
    body = <CheckForm c={c} vehicles={vehicles} items={items} faults={faults} state={state} />;
  }
  return render(
    c,
    { title: "Daily check", active: "check", status },
    <>
      <H1 sub="Do this before you drive.">Daily check</H1>
      {body}
    </>,
  );
}

checkRoutes.get("/check", requirePermission("check:submit"), async (c) => {
  const preselect = idSchema.safeParse(c.req.query("vehicle"));
  return showForm(c, {
    submissionId: crypto.randomUUID(),
    vehicleId: preselect.success ? preselect.data : undefined,
  });
});

type Body = Record<string, string | File | (string | File)[]>;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const str = (v: unknown): string =>
  typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : "";

/** Reads the Pass, Fail or N/A answers (fields s_<item id>, n_<item id>, v_<item id>). */
export function readAnswers(body: Body): ItemAnswer[] {
  const answers: ItemAnswer[] = [];
  for (const key of Object.keys(body)) {
    const m = new RegExp(`^s_(${UUID})$`, "i").exec(key);
    if (!m?.[1]) continue;
    const itemId = m[1].toLowerCase();
    const status = str(body[key]);
    if (status !== "pass" && status !== "fail" && status !== "na") continue;
    const sev = str(body[`v_${m[1]}`]);
    answers.push({
      itemId,
      status,
      note: str(body[`n_${m[1]}`]).slice(0, 1000),
      severity: SEVERITIES.find((s) => s === sev) ?? null,
    });
  }
  return answers.slice(0, 200);
}

const files = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

/** Checks and collects the photos: p_<item id> for failed items, `photo` for the check as a whole. */
export function readPhotos(
  body: Body,
  failedIds: Set<string>,
): { ok: true; overall: File[]; byItem: Map<string, File[]> } | { ok: false; message: string } {
  const take = (field: unknown, max: number): { ok: true; list: File[] } | { ok: false; message: string } => {
    const list: File[] = [];
    for (const v of files(field)) {
      const p = validatePhoto(v);
      if (!p.ok) return p;
      if (p.file) list.push(p.file);
    }
    if (list.length > max) return { ok: false, message: `Add up to ${max} photos for each item.` };
    return { ok: true, list };
  };
  const overall = take(body.photo, MAX_OVERALL_PHOTOS);
  if (!overall.ok) return overall;
  const byItem = new Map<string, File[]>();
  for (const id of failedIds) {
    const got = take(body[`p_${id}`], MAX_PHOTOS_PER_ITEM);
    if (!got.ok) return got;
    if (got.list.length) byItem.set(id, got.list);
  }
  return { ok: true, overall: overall.list, byItem };
}

checkRoutes.post("/check", requirePermission("check:submit"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  const body = await formBody(c);
  const values = formValues(body);
  const answers = readAnswers(body);
  const keep = (error: string, extra: Partial<FormState> = {}): FormState => ({
    submissionId:
      typeof values.submissionId === "string" && idSchema.safeParse(values.submissionId).success
        ? values.submissionId
        : crypto.randomUUID(),
    vehicleId: typeof values.vehicleId === "string" ? values.vehicleId : undefined,
    odometer: typeof values.odometer === "string" ? values.odometer.slice(0, 7) : undefined,
    answers: Object.fromEntries(
      answers.map((a) => [a.itemId, { status: a.status, note: a.note, severity: a.severity }]),
    ),
    notes: typeof values.notes === "string" ? values.notes.slice(0, 1000) : undefined,
    severity: SEVERITIES.find((s) => s === values.severity),
    reportAnyway: values.reportAnyway === "1",
    error,
    ...extra,
  });

  const parsed = checkSubmitSchema.safeParse(values);
  if (!parsed.success) return showForm(c, keep(firstError(parsed.error)), 400);

  const failedIds = new Set(answers.filter((a) => a.status === "fail").map((a) => a.itemId));
  const photos = readPhotos(body, failedIds);
  if (!photos.ok) return showForm(c, keep(`${photos.message} Your answers are still here.`), 400);
  const hadPhotos = photos.overall.length > 0 || photos.byItem.size > 0;

  const result = await submitCheck(
    c.get("db"),
    user,
    { ...parsed.data, answers },
    hadPhotos ? { bucket: c.env.PHOTOS, overall: photos.overall, byItem: photos.byItem } : null,
  );
  switch (result.kind) {
    case "saved":
    case "duplicate":
      return c.redirect(`/check/done/${result.checkId}`, 303);
    case "odometer_lower":
      return showForm(
        c,
        keep(
          hadPhotos
            ? "Please confirm the odometer reading. Choose your photos again before you submit."
            : "Please confirm the odometer reading.",
          { lowerReading: result.lastReading },
        ),
        409,
      );
    case "error":
      return showForm(
        c,
        keep(hadPhotos ? `${result.message} Choose your photos again before you submit.` : result.message),
        400,
      );
  }
});

/** What the driver is told after submitting, by the most serious fault they reported. */
export const OUTCOMES: Record<"none" | Severity, { tone: string; title: string; text: (vehicle: string) => string }> = {
  none: {
    tone: "border-success bg-success text-white",
    title: "Check passed. Drive safe.",
    text: () => "Everything on the checklist passed.",
  },
  minor: {
    tone: "border-navy-700 bg-navy-700 text-white",
    title: "Check submitted. Safe to drive.",
    text: () =>
      "The workshop has been told about the minor fault below and will fix it soon. If it gets worse while you drive, stop and report it.",
  },
  major: {
    tone: "border-accent bg-accent text-navy",
    title: "Check submitted. Do not drive yet.",
    text: (v) =>
      `A major fault on ${v} needs checking first. Tell your supervisor or the workshop now, and only drive once they say it is safe.`,
  },
  critical: {
    tone: "border-danger bg-danger text-white",
    title: "Do not drive this vehicle.",
    text: (v) =>
      `${v} is now off road. It goes back into service when the workshop has fixed every critical fault. Tell your supervisor so they can arrange another vehicle.`,
  },
};

checkRoutes.get("/check/done/:id", requirePermission("check:submit"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  const idParse = idSchema.safeParse(c.req.param("id"));
  if (!idParse.success) return c.notFound();
  const found = await getCheck(c.get("db"), user, idParse.data);
  if (!found) return c.notFound();
  const defects = await c.get("db").select().from(defect).where(eq(defect.checkId, found.check.id)).all();
  const worst = worstOf(defects.map((d) => d.severity));
  const outcome = OUTCOMES[worst ?? "none"];
  const na = found.results.filter((r) => r.status === "na").length;
  return render(
    c,
    { title: outcome.title, active: "check" },
    <div class="mx-auto max-w-md">
      <div
        class={`mb-5 rounded-2xl border-2 p-5 shadow-md ${outcome.tone}`}
        role={worst === "critical" || worst === "major" ? "alert" : "status"}
      >
        <h1 class="text-2xl font-bold">{outcome.title}</h1>
        <p class="mt-2">{outcome.text(found.check.vehicleName)}</p>
        <p class="mt-2 text-sm opacity-90">
          {found.check.vehicleName}, {formatNumber(found.check.odometerKm)} {words.distanceUnit}
          {na ? `. ${na} ${na === 1 ? "item" : "items"} marked N/A.` : ""}
        </p>
      </div>
      {defects.length > 0 ? (
        <Card class="mb-4">
          <h2 class="mb-2 border-l-4 border-accent pl-3 text-lg font-bold text-navy">
            {defects.length === 1 ? "Fault sent to the workshop" : `${defects.length} faults sent to the workshop`}
          </h2>
          <ul class="space-y-2">
            {defects.map((d) => (
              <li class="flex items-start gap-2">
                <SeverityBadge severity={d.severity} />
                <span>{d.description}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <div class="flex flex-wrap gap-2">
        <a class={btn("primary")} href="/check">
          Start another check
        </a>
        <a class={btn("secondary")} href={`/history/${found.check.id}`}>
          View this check
        </a>
      </div>
    </div>,
  );
});
