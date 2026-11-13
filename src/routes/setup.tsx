import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { requirePermission } from "../lib/middleware";
import {
  businessSchema,
  checklistLabelSchema,
  firstError,
  formValues,
  id as idSchema,
  moveSchema,
  roleSchema,
} from "../lib/validate";
import {
  addChecklistItem,
  addStandardChecklist,
  deleteChecklistItem,
  getSettings,
  listChecklist,
  listVehicles,
  moveChecklistItem,
  renameChecklistItem,
  toggleChecklistItem,
  updateSettings,
} from "../services/fleet";
import { listTeam, setRole } from "../services/team";
import { PENDING_LABEL, ROLES, roleLabel, STANDARD_CHECKLIST } from "../labels";
import { Alert, btn, Button, Card, Csrf, Field, H1, H2 } from "../views/components";
import { formBody, render } from "./render";

export const setupRoutes = new Hono<AppEnv>();

const messages: Record<string, string> = {
  business: "Business details saved.",
  "item-added": "Checklist item added.",
  standard: "Standard checklist items added.",
  "standard-none": "The standard items are already on your list.",
  "item-saved": "Checklist item saved.",
  "item-deleted": "Checklist item deleted. Past checks keep their own copy.",
  "item-toggled": "Checklist item updated.",
  moved: "Checklist order updated.",
  role: "Role updated.",
  removed: "Access removed. They have been signed out.",
};

async function page(c: Context<AppEnv>, error?: string, status: 200 | 400 | 409 = 200) {
  const user = c.get("user");
  if (!user) throw new Error("unreachable");
  const db = c.get("db");
  const [settings, items, team, vehicles] = await Promise.all([
    getSettings(db),
    listChecklist(db, user),
    listTeam(db, user),
    listVehicles(db, user),
  ]);
  const msg = messages[c.req.query("m") ?? ""];
  const csrf = c.get("csrfToken");
  const activeItems = items.filter((i) => i.active).length;
  const steps = [
    { done: settings.businessName !== "My Fleet", text: "Add your business name", href: "#business" },
    { done: vehicles.length > 0, text: "Add your vehicles", href: "/fleet" },
    { done: activeItems > 0, text: "Set up the checklist", href: "#checklist" },
    { done: team.some((m) => m.id !== user.id && m.role), text: "Invite your team and give them roles", href: "#team" },
  ];
  const pending = team.filter((m) => !m.role).length;

  return render(
    c,
    { title: "Setup", active: "setup", status },
    <>
      <H1 sub="Business details, checklist and team.">Setup</H1>
      {msg && !error ? <Alert tone="success">{msg}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {pending > 0 ? (
        <Alert tone="warning">
          {pending} {pending === 1 ? "person is" : "people are"} waiting for approval.{" "}
          <a href="#team" class="font-semibold underline">
            Review now
          </a>
        </Alert>
      ) : null}

      {steps.some((s) => !s.done) ? (
        <Card class="mb-4">
          <H2>Getting started</H2>
          <ol class="space-y-2">
            {steps.map((s) => (
              <li class="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  class={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-success text-white" : "border border-gray-300 text-gray-500"}`}
                >
                  {s.done ? "✓" : ""}
                </span>
                <a href={s.href} class={s.done ? "text-gray-500 line-through" : "text-primary underline"}>
                  {s.text}
                </a>
                <span class="sr-only">{s.done ? "(done)" : "(to do)"}</span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <Card class="mb-4" id="business">
        <H2>Business details</H2>
        <form method="post" action="/setup/business" data-enhance>
          <Csrf token={csrf} />
          <Field label="Business name" name="businessName" required maxlength={80} value={settings.businessName} />
          <Field
            label="Support email"
            name="supportEmail"
            type="email"
            maxlength={254}
            value={settings.supportEmail}
            hint="Shown to people waiting for approval."
          />
          <Field
            label="Setup help link"
            name="setupHelpUrl"
            type="url"
            maxlength={300}
            value={settings.setupHelpUrl}
            hint="Where the setup help card points. Must start with https://"
          />
          <label class="mb-4 flex items-center gap-3">
            <input
              type="checkbox"
              name="showSetupOffer"
              value="1"
              checked={settings.showSetupOffer}
              class="h-5 w-5 accent-primary"
            />
            <span>Show the setup help card on this page</span>
          </label>
          <Button>Save business details</Button>
        </form>
      </Card>

      <Card class="mb-4" id="checklist">
        <H2>Checklist</H2>
        <p class="mb-3 text-sm text-gray-600">
          Drivers tick these in order. Switched-off items are hidden from new checks. Past checks keep their own copy of
          the wording.
        </p>
        {items.length === 0 ? (
          <p class="mb-3 text-gray-700">
            No items yet. Add your own, or start with the {STANDARD_CHECKLIST.length} standard items.
          </p>
        ) : (
          <ul class="mb-4 divide-y divide-gray-100">
            {items.map((item, index) => (
              <li class="py-3">
                <form method="post" action={`/setup/checklist/${item.id}`} class="flex gap-2" data-enhance>
                  <Csrf token={csrf} />
                  <label for={`item-${item.id}`} class="sr-only">
                    Item {index + 1} wording
                  </label>
                  <input
                    id={`item-${item.id}`}
                    name="label"
                    value={item.label}
                    required
                    maxlength={120}
                    class={`min-w-0 flex-1 rounded-xl border border-gray-300 px-3 py-2 text-base ${item.active ? "" : "text-gray-400 line-through"}`}
                  />
                  <Button kind="secondary" class="min-h-10 py-2">
                    Save
                  </Button>
                </form>
                <div class="mt-2 flex flex-wrap gap-1">
                  <ItemAction
                    c={c}
                    itemId={item.id}
                    path="move"
                    label="Move up"
                    field={["direction", "up"]}
                    disabled={index === 0}
                  />
                  <ItemAction
                    c={c}
                    itemId={item.id}
                    path="move"
                    label="Move down"
                    field={["direction", "down"]}
                    disabled={index === items.length - 1}
                  />
                  <ItemAction c={c} itemId={item.id} path="toggle" label={item.active ? "Switch off" : "Switch on"} />
                  <ItemAction
                    c={c}
                    itemId={item.id}
                    path="delete"
                    label="Delete"
                    danger
                    confirm={`Delete "${item.label}"?`}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <form method="post" action="/setup/checklist" class="flex gap-2" data-enhance>
          <Csrf token={csrf} />
          <label for="new-item" class="sr-only">
            New checklist item
          </label>
          <input
            id="new-item"
            name="label"
            required
            maxlength={120}
            placeholder="New checklist item"
            class="min-w-0 flex-1 rounded-xl border border-gray-300 px-3 py-2.5 text-base"
          />
          <Button>Add item</Button>
        </form>
        <form method="post" action="/setup/checklist/standard" class="mt-3" data-enhance>
          <Csrf token={csrf} />
          <Button kind="ghost">Add the {STANDARD_CHECKLIST.length} standard items</Button>
        </form>
      </Card>

      {settings.showSetupOffer && settings.setupHelpUrl ? (
        <Card class="mb-4 border-primary-200 bg-primary-50">
          <H2>Want a hand setting up?</H2>
          <p class="mb-3 text-gray-700">
            Red Center Studio can set PreStart up for you: your vehicles, your checklist and your branding, ready for
            your team.
          </p>
          <a href={settings.setupHelpUrl} class={btn("secondary")} target="_blank" rel="noopener">
            Get setup help
          </a>
        </Card>
      ) : null}

      <Card id="team">
        <H2>Team</H2>
        <p class="mb-3 text-sm text-gray-600">
          New sign-ups wait here until you give them a role. Drivers submit checks. Workshop staff also work on defects.
          Admins can change everything.
        </p>
        <ul class="divide-y divide-gray-100">
          {team.map((m) => (
            <li class="py-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0">
                  <p class="font-semibold">
                    {m.name}
                    {m.id === user.id ? <span class="font-normal text-gray-500"> (you)</span> : null}
                  </p>
                  <p class="truncate text-sm text-gray-600">{m.email}</p>
                </div>
                <span
                  class={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.role ? "bg-primary-100 text-primary" : "bg-alert-100 text-ink"}`}
                >
                  {m.role ? roleLabel[m.role] : PENDING_LABEL}
                </span>
              </div>
              <div class="mt-2 flex flex-wrap gap-1">
                {ROLES.slice()
                  .reverse()
                  .map((r) => (
                    <form method="post" action={`/setup/team/${m.id}/role`} data-enhance>
                      <Csrf token={csrf} />
                      <input type="hidden" name="role" value={r} />
                      <button
                        type="submit"
                        disabled={m.role === r}
                        aria-pressed={m.role === r ? "true" : "false"}
                        class={btn(m.role === r ? "primary" : "secondary", "min-h-9 px-3 py-1.5 text-xs")}
                      >
                        {roleLabel[r]}
                      </button>
                    </form>
                  ))}
                {m.role ? (
                  <form method="post" action={`/setup/team/${m.id}/remove`} data-enhance>
                    <Csrf token={csrf} />
                    <button
                      type="submit"
                      data-confirm={`Remove access for ${m.name}? They will be signed out.`}
                      class={btn("danger", "min-h-9 px-3 py-1.5 text-xs")}
                    >
                      Remove access
                    </button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <p class="mt-3 text-sm text-gray-600">
          To add someone, send them this app's address and ask them to create an account. They will appear here.
        </p>
      </Card>
    </>,
  );
}

const ItemAction = ({
  c,
  itemId,
  path,
  label,
  field,
  disabled,
  danger,
  confirm,
}: {
  c: Context<AppEnv>;
  itemId: string;
  path: string;
  label: string;
  field?: [string, string];
  disabled?: boolean;
  danger?: boolean;
  confirm?: string;
}) => (
  <form method="post" action={`/setup/checklist/${itemId}/${path}`} data-enhance>
    <Csrf token={c.get("csrfToken")} />
    {field ? <input type="hidden" name={field[0]} value={field[1]} /> : null}
    <button
      type="submit"
      disabled={disabled}
      data-confirm={confirm}
      class={btn(danger ? "danger" : "secondary", "min-h-9 px-3 py-1.5 text-xs")}
    >
      {label}
    </button>
  </form>
);

const guard = requirePermission("settings:edit");
const actor = (c: Context<AppEnv>) => {
  const u = c.get("user");
  if (!u) throw new Error("unreachable");
  return u;
};
const itemId = (c: Context<AppEnv>) => idSchema.safeParse(c.req.param("id"));

setupRoutes.get("/setup", guard, (c) => page(c));

setupRoutes.post("/setup/business", guard, async (c) => {
  const parsed = businessSchema.safeParse(formValues(await formBody(c)));
  if (!parsed.success) return page(c, firstError(parsed.error), 400);
  const res = await updateSettings(c.get("db"), actor(c), parsed.data);
  if (!res.ok) return page(c, res.message, 400);
  return c.redirect("/setup?m=business", 303);
});

setupRoutes.post("/setup/checklist", requirePermission("checklist:edit"), async (c) => {
  const parsed = checklistLabelSchema.safeParse(formValues(await formBody(c)));
  if (!parsed.success) return page(c, firstError(parsed.error), 400);
  const res = await addChecklistItem(c.get("db"), actor(c), parsed.data.label);
  if (!res.ok) return page(c, res.message, 400);
  return c.redirect("/setup?m=item-added#checklist", 303);
});

setupRoutes.post("/setup/checklist/standard", requirePermission("checklist:edit"), async (c) => {
  const res = await addStandardChecklist(c.get("db"), actor(c));
  if (!res.ok) return page(c, res.message, 400);
  return c.redirect(`/setup?m=${res.value ? "standard" : "standard-none"}#checklist`, 303);
});

setupRoutes.post("/setup/checklist/:id", requirePermission("checklist:edit"), async (c) => {
  const id = itemId(c);
  if (!id.success) return c.notFound();
  const parsed = checklistLabelSchema.safeParse(formValues(await formBody(c)));
  if (!parsed.success) return page(c, firstError(parsed.error), 400);
  const res = await renameChecklistItem(c.get("db"), actor(c), id.data, parsed.data.label);
  if (!res.ok) return page(c, res.message, 409);
  return c.redirect("/setup?m=item-saved#checklist", 303);
});

setupRoutes.post("/setup/checklist/:id/move", requirePermission("checklist:edit"), async (c) => {
  const id = itemId(c);
  if (!id.success) return c.notFound();
  const parsed = moveSchema.safeParse(formValues(await formBody(c)));
  if (!parsed.success) return page(c, "Choose up or down.", 400);
  const res = await moveChecklistItem(c.get("db"), actor(c), id.data, parsed.data.direction);
  if (!res.ok) return page(c, res.message, 409);
  return c.redirect("/setup?m=moved#checklist", 303);
});

setupRoutes.post("/setup/checklist/:id/toggle", requirePermission("checklist:edit"), async (c) => {
  const id = itemId(c);
  if (!id.success) return c.notFound();
  const res = await toggleChecklistItem(c.get("db"), actor(c), id.data);
  if (!res.ok) return page(c, res.message, 409);
  return c.redirect("/setup?m=item-toggled#checklist", 303);
});

setupRoutes.post("/setup/checklist/:id/delete", requirePermission("checklist:edit"), async (c) => {
  const id = itemId(c);
  if (!id.success) return c.notFound();
  const res = await deleteChecklistItem(c.get("db"), actor(c), id.data);
  if (!res.ok) return page(c, res.message, 409);
  return c.redirect("/setup?m=item-deleted#checklist", 303);
});

setupRoutes.post("/setup/team/:id/role", requirePermission("team:manage"), async (c) => {
  const id = itemId(c);
  if (!id.success) return c.notFound();
  const parsed = roleSchema.safeParse(formValues(await formBody(c)));
  if (!parsed.success) return page(c, "Choose Driver, Workshop or Admin.", 400);
  const res = await setRole(c.get("db"), actor(c), id.data, parsed.data.role);
  if (!res.ok) return page(c, res.message, 409);
  return c.redirect("/setup?m=role#team", 303);
});

setupRoutes.post("/setup/team/:id/remove", requirePermission("team:manage"), async (c) => {
  const id = itemId(c);
  if (!id.success) return c.notFound();
  const res = await setRole(c.get("db"), actor(c), id.data, null);
  if (!res.ok) return page(c, res.message, 409);
  if (id.data === actor(c).id) return c.redirect("/login?m=signedout", 303);
  return c.redirect("/setup?m=removed#team", 303);
});
