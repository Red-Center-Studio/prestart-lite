import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { defect } from "../db/schema";
import { requirePermission } from "../lib/middleware";
import { checkSubmitSchema, firstError, formValues, id as idSchema } from "../lib/validate";
import { validatePhoto, MAX_PHOTO_BYTES } from "../lib/photos";
import { formatNumber } from "../lib/text";
import { getCheck, submitCheck } from "../services/checks";
import { listChecklist, listInServiceVehicles } from "../services/fleet";
import type { ChecklistItem, Vehicle } from "../db/schema";
import { SEVERITIES, severityLabel, words, type Severity } from "../labels";
import { Alert, btn, Button, Card, Csrf, Empty, H1 } from "../views/components";
import { formBody, render } from "./render";

export const checkRoutes = new Hono<AppEnv>();

interface FormState {
  submissionId: string;
  vehicleId?: string | undefined;
  odometer?: string | undefined;
  ok?: string[] | undefined;
  notes?: string | undefined;
  severity?: Severity | undefined;
  reportAnyway?: boolean | undefined;
  error?: string | undefined;
  lowerReading?: number | undefined;
}

const CheckForm = ({
  c,
  vehicles,
  items,
  state,
}: {
  c: Context<AppEnv>;
  vehicles: Vehicle[];
  items: ChecklistItem[];
  state: FormState;
}) => {
  // Nothing starts ticked: drivers confirm each item themselves.
  const ticked = new Set(state.ok ?? []);
  const allTicked = items.every((i) => ticked.has(i.id));
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
        <label for="f-vehicle" class="mb-1 block text-sm font-medium">
          Vehicle
        </label>
        <select
          id="f-vehicle"
          name="vehicleId"
          required
          class="block w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          <option value="">Pick a vehicle</option>
          {vehicles.map((v) => (
            <option value={v.id} selected={state.vehicleId === v.id} data-odometer={v.odometerKm}>
              {v.rego ? `${v.name} (${v.rego})` : v.name}
            </option>
          ))}
        </select>

        <label for="f-odometer" class="mb-1 mt-4 block text-sm font-medium">
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
          class="block w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-200"
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

      <Card class="mb-4">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">Checklist</h2>
          <button type="button" class={btn("ghost", "min-h-9 px-2 py-1")} data-tick-all hidden>
            Tick all
          </button>
        </div>
        <p class="mb-3 text-sm text-gray-600">Tick every item that is OK. Leave anything with a problem unticked.</p>
        <ul class="divide-y divide-gray-100">
          {items.map((item) => (
            <li>
              <label class="flex min-h-12 cursor-pointer items-center gap-3 py-2">
                <input
                  type="checkbox"
                  name="ok[]"
                  value={item.id}
                  checked={ticked.has(item.id)}
                  class="h-6 w-6 shrink-0 rounded border-gray-400 accent-primary"
                  data-check-item
                />
                <span>{item.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </Card>

      <div data-report-anyway hidden={!allTicked ? true : undefined}>
        <label class="mb-4 flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4">
          <input
            type="checkbox"
            name="reportAnyway"
            value="1"
            checked={state.reportAnyway}
            class="h-5 w-5 accent-primary"
            data-report-toggle
          />
          <span>Report a problem anyway (something not on the checklist)</span>
        </label>
      </div>

      <Card class="mb-4" id="problem">
        <div data-problem>
          <h2 class="mb-1 text-lg font-semibold">Describe the problem</h2>
          <p class="mb-3 text-sm text-gray-600">Needed when an item is unticked. The workshop sees this.</p>
          <label for="f-notes" class="sr-only">
            Problem description
          </label>
          <textarea
            id="f-notes"
            name="notes"
            rows={3}
            maxlength={1000}
            class="mb-4 block w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-200"
          >
            {state.notes ?? ""}
          </textarea>
          <fieldset class="mb-4">
            <legend class="mb-2 text-sm font-medium">How serious is it?</legend>
            <div class="grid gap-2 sm:grid-cols-3">
              {SEVERITIES.map((s) => (
                <label class="flex min-h-12 items-center gap-2 rounded-xl border border-gray-300 px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-primary-50">
                  <input
                    type="radio"
                    name="severity"
                    value={s}
                    checked={(state.severity ?? "minor") === s}
                    class="h-5 w-5 accent-primary"
                  />
                  <span>{severityLabel[s]}</span>
                </label>
              ))}
            </div>
            <p class="mt-2 text-sm text-gray-600">Critical takes the vehicle off road until the workshop fixes it.</p>
          </fieldset>
          <label for="f-photo" class="mb-1 block text-sm font-medium">
            Photo <span class="font-normal text-gray-500">(optional, up to 10 MB)</span>
          </label>
          <input
            id="f-photo"
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            capture="environment"
            class="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:font-semibold file:text-primary"
            data-photo
          />
          <p class="mt-1 hidden text-sm text-danger" data-photo-error role="alert"></p>
        </div>
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
  let body;
  if (items.length === 0) {
    body = <Empty>No checklist items are set up yet. Ask an admin to add them on the Setup page.</Empty>;
  } else if (vehicles.length === 0) {
    body = <Empty>There are no vehicles in service to check. Ask an admin to add vehicles on the Fleet page.</Empty>;
  } else {
    body = <CheckForm c={c} vehicles={vehicles} items={items} state={state} />;
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

checkRoutes.post("/check", requirePermission("check:submit"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  const body = await formBody(c);
  const values = formValues(body);
  const keep = (error: string, extra: Partial<FormState> = {}): FormState => ({
    submissionId:
      typeof values.submissionId === "string" && idSchema.safeParse(values.submissionId).success
        ? values.submissionId
        : crypto.randomUUID(),
    vehicleId: typeof values.vehicleId === "string" ? values.vehicleId : undefined,
    odometer: typeof values.odometer === "string" ? values.odometer.slice(0, 7) : undefined,
    ok: Array.isArray(values.ok) ? (values.ok as string[]) : [],
    notes: typeof values.notes === "string" ? values.notes.slice(0, 1000) : undefined,
    severity: SEVERITIES.find((s) => s === values.severity),
    reportAnyway: values.reportAnyway === "1",
    error,
    ...extra,
  });

  const parsed = checkSubmitSchema.safeParse(values);
  if (!parsed.success) return showForm(c, keep(firstError(parsed.error)), 400);

  const photoField = body.photo;
  const photo = validatePhoto(Array.isArray(photoField) ? photoField[0] : photoField);
  if (!photo.ok) return showForm(c, keep(`${photo.message} Your answers are still here.`), 400);

  const result = await submitCheck(
    c.get("db"),
    user,
    parsed.data,
    photo.file ? { file: photo.file, bucket: c.env.PHOTOS } : null,
  );
  switch (result.kind) {
    case "saved":
    case "duplicate":
      return c.redirect(`/check/done/${result.checkId}`, 303);
    case "odometer_lower":
      return showForm(
        c,
        keep(
          photo.file
            ? "Please confirm the odometer reading. Choose your photo again before you submit."
            : "Please confirm the odometer reading.",
          { lowerReading: result.lastReading },
        ),
        409,
      );
    case "error":
      return showForm(c, keep(result.message), 400);
  }
});

checkRoutes.get("/check/done/:id", requirePermission("check:submit"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  const idParse = idSchema.safeParse(c.req.param("id"));
  if (!idParse.success) return c.notFound();
  const found = await getCheck(c.get("db"), user, idParse.data);
  if (!found) return c.notFound();
  const d = await c.get("db").select().from(defect).where(eq(defect.checkId, found.check.id)).get();
  const failed = found.results.filter((r) => !r.ok).map((r) => r.label);
  return render(
    c,
    { title: "Check submitted", active: "check" },
    <div class="mx-auto max-w-md">
      <div class="mb-5 rounded-2xl border border-success-200 bg-success-50 p-5" role="status">
        <h1 class="text-2xl font-bold text-success">Check submitted. Drive safe.</h1>
        <p class="mt-1 text-gray-700">
          {found.check.vehicleName}, {formatNumber(found.check.odometerKm)} {words.distanceUnit}
        </p>
      </div>
      {failed.length > 0 ? (
        <Alert tone="warning">These items failed and went to the workshop queue: {failed.join(", ")}.</Alert>
      ) : null}
      {d && failed.length === 0 ? <Alert tone="warning">Your problem report went to the workshop queue.</Alert> : null}
      {d?.severity === "critical" ? (
        <Alert tone="error">
          Because the fault is critical, {found.check.vehicleName} is now off road. Do not drive it until the workshop
          marks it fixed.
        </Alert>
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
