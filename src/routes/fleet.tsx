import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import type { Vehicle } from "../db/schema";
import { can } from "../lib/can";
import { requirePermission } from "../lib/middleware";
import { firstError, formValues, id as idSchema, vehicleSchema } from "../lib/validate";
import { daysUntil, formatDate, formatNumber } from "../lib/text";
import {
  addVehicle,
  deleteVehicle,
  getVehicle,
  listVehicles,
  openDefectCounts,
  updateVehicle,
  type VehicleInput,
} from "../services/fleet";
import { VEHICLE_STATUSES, vehicleStatusLabel, words } from "../labels";
import { Alert, btn, Button, Card, Csrf, Empty, Field, H1, TextArea, VehicleStatusBadge } from "../views/components";
import { formBody, render } from "./render";

export const fleetRoutes = new Hono<AppEnv>();

const messages: Record<string, string> = {
  added: "Vehicle added.",
  saved: "Vehicle saved.",
  deleted: "Vehicle deleted. Its past checks stay in history.",
};

const DueLine = ({ label, date }: { label: string; date: string | null }) => {
  if (!date) return <p class="text-sm text-gray-500">{label}: not set</p>;
  const days = daysUntil(date);
  const tone =
    days !== null && days < 0
      ? "font-semibold text-danger"
      : days !== null && days <= 30
        ? "font-semibold text-alert-700"
        : "text-gray-700";
  const note =
    days === null ? "" : days < 0 ? " (overdue)" : days === 0 ? " (today)" : days <= 30 ? ` (in ${days} days)` : "";
  return (
    <p class={`text-sm ${tone}`}>
      {label}: {formatDate(date)}
      {note}
    </p>
  );
};

type FormValues = Partial<Record<keyof VehicleInput, string>>;

const fromVehicle = (v: Vehicle): FormValues => ({
  name: v.name,
  rego: v.rego,
  vehicleType: v.vehicleType,
  odometer: String(v.odometerKm),
  regoDue: v.regoDue ?? "",
  serviceDue: v.serviceDue ?? "",
  status: v.status,
  notes: v.notes,
});

const VehicleForm = ({
  c,
  action,
  values,
  error,
  idPrefix,
  submitLabel,
}: {
  c: Context<AppEnv>;
  action: string;
  values: FormValues;
  error?: string | undefined;
  idPrefix: string;
  submitLabel: string;
}) => (
  <form method="post" action={action} data-enhance>
    <Csrf token={c.get("csrfToken")} />
    {error ? <Alert tone="error">{error}</Alert> : null}
    <Field
      id={`${idPrefix}-name`}
      label="Name"
      name="name"
      required
      maxlength={60}
      value={values.name}
      placeholder="Hilux 3"
    />
    <div class="grid gap-x-3 sm:grid-cols-2">
      <Field id={`${idPrefix}-rego`} label={words.rego} name="rego" maxlength={20} value={values.rego} />
      <Field
        id={`${idPrefix}-type`}
        label="Vehicle type"
        name="vehicleType"
        maxlength={40}
        value={values.vehicleType}
        placeholder="Ute, truck, forklift"
      />
      <Field
        id={`${idPrefix}-odo`}
        label={`${words.odometer} (${words.distanceUnit})`}
        name="odometer"
        required
        inputmode="numeric"
        pattern="[0-9]*"
        maxlength={7}
        value={values.odometer ?? "0"}
      />
      <div class="mb-4">
        <label for={`${idPrefix}-status`} class="mb-1 block text-sm font-medium">
          Status
        </label>
        <select
          id={`${idPrefix}-status`}
          name="status"
          class="block w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-200"
        >
          {VEHICLE_STATUSES.map((s) => (
            <option value={s} selected={(values.status ?? "in_service") === s}>
              {vehicleStatusLabel[s]}
            </option>
          ))}
        </select>
      </div>
      <Field id={`${idPrefix}-rego-due`} label={words.regoDue} name="regoDue" type="date" value={values.regoDue} />
      <Field
        id={`${idPrefix}-service-due`}
        label={words.serviceDue}
        name="serviceDue"
        type="date"
        value={values.serviceDue}
      />
    </div>
    <TextArea id={`${idPrefix}-notes`} label="Notes" name="notes" maxlength={1000} value={values.notes ?? ""} />
    <Button full>{submitLabel}</Button>
  </form>
);

async function listPage(c: Context<AppEnv>) {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  const db = c.get("db");
  const [vehicles, defectCounts] = await Promise.all([listVehicles(db, user), openDefectCounts(db)]);
  const admin = can(user, "vehicle:edit");
  const msg = messages[c.req.query("m") ?? ""];
  return render(
    c,
    { title: "Fleet", active: "fleet" },
    <>
      <H1
        sub={`${vehicles.length} ${vehicles.length === 1 ? "vehicle" : "vehicles"}`}
        action={
          admin ? (
            <a href="/fleet/new" class={btn("accent")} data-open-dialog="dialog-new">
              Add vehicle
            </a>
          ) : undefined
        }
      >
        Fleet
      </H1>
      {msg ? <Alert tone="success">{msg}</Alert> : null}
      {vehicles.length === 0 ? (
        <Empty>{admin ? "No vehicles yet. Add your first one." : "No vehicles yet. An admin can add them."}</Empty>
      ) : (
        <ul class="grid gap-3 sm:grid-cols-2">
          {vehicles.map((v) => {
            const open = defectCounts.get(v.id) ?? 0;
            return (
              <li>
                <Card class="h-full">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <h2 class="truncate text-lg font-semibold">{v.name}</h2>
                      <p class="text-sm text-gray-600">
                        {[v.rego, v.vehicleType].filter(Boolean).join(" · ") || "No details yet"}
                      </p>
                    </div>
                    <VehicleStatusBadge status={v.status} />
                  </div>
                  <div class="mt-3 space-y-0.5">
                    <p class="text-sm text-gray-700">
                      {words.odometer}: {formatNumber(v.odometerKm)} {words.distanceUnit}
                    </p>
                    <DueLine label={words.regoDue} date={v.regoDue} />
                    <DueLine label={words.serviceDue} date={v.serviceDue} />
                    {open > 0 ? (
                      <p class="text-sm">
                        <a href="/defects" class="font-semibold text-danger underline">
                          {open} open {open === 1 ? "defect" : "defects"}
                        </a>
                      </p>
                    ) : null}
                  </div>
                  {v.notes ? <p class="mt-2 whitespace-pre-wrap text-sm text-gray-600">{v.notes}</p> : null}
                  <div class="mt-3 flex flex-wrap gap-2">
                    {v.status === "in_service" ? (
                      <a href={`/check?vehicle=${v.id}`} class={btn("secondary", "min-h-10 py-2")}>
                        Check this vehicle
                      </a>
                    ) : null}
                    {admin ? (
                      <a
                        href={`/fleet/${v.id}/edit`}
                        class={btn("ghost", "min-h-10 py-2")}
                        data-open-dialog={`dialog-${v.id}`}
                      >
                        Edit
                      </a>
                    ) : null}
                  </div>
                </Card>
                {admin ? (
                  <dialog id={`dialog-${v.id}`} class="dialog" aria-label={`Edit ${v.name}`}>
                    <DialogHeader title={`Edit ${v.name}`} />
                    <VehicleForm
                      c={c}
                      action={`/fleet/${v.id}`}
                      values={fromVehicle(v)}
                      idPrefix={`e-${v.id.slice(0, 8)}`}
                      submitLabel="Save vehicle"
                    />
                    <DeleteForm c={c} v={v} />
                  </dialog>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {admin ? (
        <dialog id="dialog-new" class="dialog" aria-label="Add vehicle">
          <DialogHeader title="Add vehicle" />
          <VehicleForm c={c} action="/fleet" values={{}} idPrefix="new" submitLabel="Add vehicle" />
        </dialog>
      ) : null}
    </>,
  );
}

const DialogHeader = ({ title }: { title: string }) => (
  <div class="mb-4 flex items-center justify-between gap-2">
    <h2 class="text-lg font-semibold">{title}</h2>
    <button type="button" class={btn("ghost", "min-h-9 px-3 py-1")} data-close-dialog>
      Close
    </button>
  </div>
);

const DeleteForm = ({ c, v }: { c: Context<AppEnv>; v: Vehicle }) => (
  <form method="post" action={`/fleet/${v.id}/delete`} class="mt-3" data-enhance>
    <Csrf token={c.get("csrfToken")} />
    <Button kind="danger" full confirm={`Delete ${v.name}? Its past checks stay in history.`}>
      Delete vehicle
    </Button>
  </form>
);

async function formPage(
  c: Context<AppEnv>,
  opts: {
    title: string;
    action: string;
    values: FormValues;
    error?: string;
    vehicle?: Vehicle;
    status?: 200 | 400 | 409;
  },
) {
  return render(
    c,
    { title: opts.title, active: "fleet", status: opts.status ?? 200 },
    <div class="mx-auto max-w-lg">
      <a href="/fleet" class="mb-3 inline-block text-sm text-primary underline">
        Back to fleet
      </a>
      <H1>{opts.title}</H1>
      <Card>
        <VehicleForm
          c={c}
          action={opts.action}
          values={opts.values}
          error={opts.error}
          idPrefix="page"
          submitLabel={opts.vehicle ? "Save vehicle" : "Add vehicle"}
        />
        {opts.vehicle ? <DeleteForm c={c} v={opts.vehicle} /> : null}
      </Card>
    </div>,
  );
}

const asFormValues = (values: Record<string, unknown>): FormValues => {
  const out: FormValues = {};
  for (const key of ["name", "rego", "vehicleType", "odometer", "regoDue", "serviceDue", "status", "notes"] as const) {
    const v = values[key];
    if (typeof v === "string") out[key] = v.slice(0, 1000);
  }
  return out;
};

fleetRoutes.get("/fleet", requirePermission("vehicle:view"), (c) => listPage(c));

fleetRoutes.get("/fleet/new", requirePermission("vehicle:edit"), (c) =>
  formPage(c, { title: "Add vehicle", action: "/fleet", values: {} }),
);

fleetRoutes.post("/fleet", requirePermission("vehicle:edit"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  const values = formValues(await formBody(c));
  const parsed = vehicleSchema.safeParse(values);
  if (!parsed.success) {
    return formPage(c, {
      title: "Add vehicle",
      action: "/fleet",
      values: asFormValues(values),
      error: firstError(parsed.error),
      status: 400,
    });
  }
  const res = await addVehicle(c.get("db"), user, parsed.data);
  if (!res.ok)
    return formPage(c, {
      title: "Add vehicle",
      action: "/fleet",
      values: asFormValues(values),
      error: res.message,
      status: 400,
    });
  return c.redirect("/fleet?m=added", 303);
});

fleetRoutes.get("/fleet/:id/edit", requirePermission("vehicle:edit"), async (c) => {
  const idParse = idSchema.safeParse(c.req.param("id"));
  if (!idParse.success) return c.notFound();
  const v = await getVehicle(c.get("db"), idParse.data);
  if (!v) return c.notFound();
  return formPage(c, { title: `Edit ${v.name}`, action: `/fleet/${v.id}`, values: fromVehicle(v), vehicle: v });
});

fleetRoutes.post("/fleet/:id", requirePermission("vehicle:edit"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  const idParse = idSchema.safeParse(c.req.param("id"));
  if (!idParse.success) return c.notFound();
  const v = await getVehicle(c.get("db"), idParse.data);
  if (!v) return c.notFound();
  const values = formValues(await formBody(c));
  const parsed = vehicleSchema.safeParse(values);
  if (!parsed.success) {
    return formPage(c, {
      title: `Edit ${v.name}`,
      action: `/fleet/${v.id}`,
      values: asFormValues(values),
      error: firstError(parsed.error),
      vehicle: v,
      status: 400,
    });
  }
  const res = await updateVehicle(c.get("db"), user, v.id, parsed.data);
  if (!res.ok) return c.notFound();
  return c.redirect("/fleet?m=saved", 303);
});

fleetRoutes.post("/fleet/:id/delete", requirePermission("vehicle:edit"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  const idParse = idSchema.safeParse(c.req.param("id"));
  if (!idParse.success) return c.notFound();
  const v = await getVehicle(c.get("db"), idParse.data);
  if (!v) return c.notFound();
  const res = await deleteVehicle(c.get("db"), user, v.id);
  if (!res.ok) {
    return formPage(c, {
      title: `Edit ${v.name}`,
      action: `/fleet/${v.id}`,
      values: fromVehicle(v),
      error: res.message,
      vehicle: v,
      status: 409,
    });
  }
  return c.redirect("/fleet?m=deleted", 303);
});
