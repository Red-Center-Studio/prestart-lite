/**
 * Demo data. Used by the nightly reset in demo mode and by `npm run seed:local` / `npm run seed:remote`.
 * Plain TypeScript with explicit .ts imports, so Node can run it directly for the seed script.
 * Never run this against a real fleet's database: it deletes everything first.
 */
import { hashPassword } from "../auth/password.ts";
import { CHECKLIST_TEMPLATES } from "../labels.ts";

export const DEMO_PASSWORD = "prestart-demo-2026";

export const DEMO_ACCOUNTS = [
  { role: "admin", name: "Alex Morgan", email: "admin@demo.prestart.example" },
  { role: "workshop", name: "Sam Lee", email: "workshop@demo.prestart.example" },
  { role: "driver", name: "Jordan Taylor", email: "driver@demo.prestart.example" },
] as const;

export interface Statement {
  sql: string;
  params: (string | number | null)[];
}

const DAY = 86_400_000;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Builds the statements that wipe the database and load the demo fleet, relative to `now`. */
export async function demoStatements(now = new Date()): Promise<Statement[]> {
  const out: Statement[] = [];
  const add = (sql: string, ...params: (string | number | null)[]) => out.push({ sql, params });
  const iso = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  const nowMs = now.getTime();

  for (const table of [
    "check_photo",
    "check_result",
    "defect",
    "`check`",
    "checklist_item",
    "vehicle",
    "session",
    "account",
    "verification",
    "user",
  ]) {
    add(`DELETE FROM ${table}`);
  }
  add(
    "UPDATE app_settings SET business_name = ?, support_email = ?, show_setup_offer = 1, updated_at = ? WHERE id = 1",
    "Outback Haulage (demo)",
    "",
    now.toISOString(),
  );
  add("INSERT OR IGNORE INTO app_settings (id, business_name) VALUES (1, 'Outback Haulage (demo)')");

  // People. The extra driver has no demo sign-in; they make the history and team pages realistic.
  const people = [
    ...DEMO_ACCOUNTS.map((a) => ({ ...a, id: crypto.randomUUID() })),
    { role: "driver" as const, name: "Casey Brown", email: "casey@demo.prestart.example", id: crypto.randomUUID() },
    { role: null, name: "Riley Chen", email: "riley@demo.prestart.example", id: crypto.randomUUID() },
  ];
  const hash = await hashPassword(DEMO_PASSWORD);
  for (const [i, p] of people.entries()) {
    const created = nowMs - (30 - i) * DAY;
    add(
      "INSERT INTO user (id, full_name, email, email_verified, role, is_demo, created_at, updated_at) VALUES (?, ?, ?, 1, ?, 1, ?, ?)",
      p.id,
      p.name,
      p.email,
      p.role,
      created,
      created,
    );
    add(
      "INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, 'credential', ?, ?, ?, ?)",
      crypto.randomUUID(),
      p.id,
      p.id,
      hash,
      created,
      created,
    );
  }
  const byName = (name: string) => {
    const p = people.find((x) => x.name === name);
    if (!p) throw new Error(`missing demo person ${name}`);
    return p;
  };

  // Checklist: the ready-made ute and 4WD list, which suits a mixed light fleet.
  const template = CHECKLIST_TEMPLATES.ute;
  if (!template) throw new Error("missing ute checklist template");
  const items = template.items.map(([section, label], sort) => ({ id: crypto.randomUUID(), section, label, sort }));
  for (const item of items) {
    add(
      "INSERT INTO checklist_item (id, label, section, sort, active) VALUES (?, ?, ?, ?, 1)",
      item.id,
      item.label,
      item.section,
      item.sort,
    );
  }
  const itemIndex = (start: string) => {
    const i = items.findIndex((x) => x.label.startsWith(start));
    if (i < 0) throw new Error(`missing demo checklist item ${start}`);
    return i;
  };

  // Vehicles. Due dates are relative to today so reminders always look current.
  const vehicles = [
    { name: "Hilux 1", rego: "1ABC234", type: "Ute", km: 84_210, regoDays: 21, serviceDays: 9, status: "in_service" },
    { name: "Hilux 2", rego: "1ABC235", type: "Ute", km: 61_904, regoDays: 140, serviceDays: 64, status: "in_service" },
    {
      name: "Isuzu NPR",
      rego: "XQ12AB",
      type: "Light truck",
      km: 152_330,
      regoDays: 5,
      serviceDays: -3,
      status: "off_road",
    },
    {
      name: "Hino 500",
      rego: "XR77CD",
      type: "Truck",
      km: 233_018,
      regoDays: 200,
      serviceDays: 30,
      status: "in_service",
    },
    {
      name: "Ranger Wildtrak",
      rego: "1DEF881",
      type: "Ute",
      km: 22_470,
      regoDays: 300,
      serviceDays: 120,
      status: "in_service",
    },
    {
      name: "Toyota 8FG25",
      rego: "",
      type: "Forklift",
      km: 6_120,
      regoDays: null,
      serviceDays: 45,
      status: "in_service",
    },
  ].map((v) => ({ ...v, id: crypto.randomUUID() }));
  for (const v of vehicles) {
    add(
      "INSERT INTO vehicle (id, name, rego, vehicle_type, odometer_km, rego_due, service_due, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')",
      v.id,
      v.name,
      v.rego,
      v.type,
      v.km,
      v.regoDays === null ? null : ymd(new Date(nowMs + v.regoDays * DAY)),
      ymd(new Date(nowMs + v.serviceDays * DAY)),
      v.status,
    );
  }
  const vehicleByName = (name: string) => {
    const v = vehicles.find((x) => x.name === name);
    if (!v) throw new Error(`missing demo vehicle ${name}`);
    return v;
  };

  // Checks over the last 10 days, plus their defects.
  type DemoCheck = {
    vehicle: string;
    driver: string;
    daysAgo: number;
    kmBack: number;
    failed?: number;
    notes?: string;
    severity?: "minor" | "major" | "critical";
    na?: number[];
    status?: "open" | "in_progress" | "fixed";
    workshopNotes?: string;
  };
  const checks: DemoCheck[] = [
    { vehicle: "Hilux 1", driver: "Jordan Taylor", daysAgo: 0.1, kmBack: 0 },
    { vehicle: "Hino 500", driver: "Casey Brown", daysAgo: 0.2, kmBack: 0 },
    {
      vehicle: "Isuzu NPR",
      driver: "Casey Brown",
      daysAgo: 1.1,
      kmBack: 0,
      failed: itemIndex("Brakes"),
      notes: "Brake pedal goes nearly to the floor. Parked it in bay 3.",
      severity: "critical",
      status: "open",
    },
    {
      vehicle: "Hilux 2",
      driver: "Jordan Taylor",
      daysAgo: 1.2,
      kmBack: 0,
      failed: itemIndex("Indicators"),
      notes: "Left rear indicator not flashing.",
      severity: "major",
      status: "in_progress",
      workshopNotes: "Globe ordered, arriving Thursday.",
    },
    {
      vehicle: "Ranger Wildtrak",
      driver: "Jordan Taylor",
      daysAgo: 2.1,
      kmBack: 180,
      na: [itemIndex("Tow bar")],
      failed: itemIndex("Tray"),
      notes: "Toolbox lid latch is loose. Strapped it shut for now.",
      severity: "minor",
      status: "open",
    },
    { vehicle: "Hilux 1", driver: "Casey Brown", daysAgo: 3.1, kmBack: 260 },
    {
      vehicle: "Hino 500",
      driver: "Jordan Taylor",
      daysAgo: 4.2,
      kmBack: 410,
      failed: itemIndex("Horn"),
      notes: "Passenger wiper blade torn.",
      severity: "minor",
      status: "fixed",
      workshopNotes: "Replaced both wiper blades.",
    },
    { vehicle: "Toyota 8FG25", driver: "Casey Brown", daysAgo: 5.1, kmBack: 12 },
    { vehicle: "Hilux 2", driver: "Casey Brown", daysAgo: 6.1, kmBack: 340 },
    { vehicle: "Hilux 1", driver: "Jordan Taylor", daysAgo: 8.1, kmBack: 690 },
  ];
  const workshop = byName("Sam Lee");
  for (const ch of checks) {
    const v = vehicleByName(ch.vehicle);
    const d = byName(ch.driver);
    const checkId = crypto.randomUUID();
    const when = iso(ch.daysAgo * DAY);
    const failedIndex = ch.failed ?? -1;
    const na = new Set(ch.na ?? []);
    const passed = failedIndex < 0;
    add(
      "INSERT INTO `check` (id, vehicle_id, vehicle_name, driver_id, driver_name, odometer_km, odometer_went_back, passed, notes, photo_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)",
      checkId,
      v.id,
      v.name,
      d.id,
      d.name,
      v.km - ch.kmBack,
      passed ? 1 : 0,
      "",
      when,
      when,
    );
    let failedResultId: string | null = null;
    for (const [index, item] of items.entries()) {
      const resultId = crypto.randomUUID();
      const status = index === failedIndex ? "fail" : na.has(index) ? "na" : "pass";
      if (status === "fail") failedResultId = resultId;
      add(
        "INSERT INTO check_result (id, check_id, checklist_item_id, label, section, ok, status, note, severity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        resultId,
        checkId,
        item.id,
        item.label,
        item.section,
        status === "fail" ? 0 : 1,
        status,
        status === "fail" ? (ch.notes ?? "") : "",
        status === "fail" ? (ch.severity ?? "minor") : null,
        when,
        when,
      );
    }
    const failedItem = items[failedIndex];
    if (failedItem) {
      const fixed = ch.status === "fixed";
      add(
        "INSERT INTO defect (id, vehicle_id, vehicle_name, check_id, check_result_id, description, severity, status, reported_by_id, reported_by_name, photo_key, workshop_notes, fixed_at, fixed_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)",
        crypto.randomUUID(),
        v.id,
        v.name,
        checkId,
        failedResultId,
        `${failedItem.label}: ${ch.notes ?? ""}`,
        ch.severity ?? "minor",
        ch.status ?? "open",
        d.id,
        d.name,
        ch.workshopNotes ?? "",
        fixed ? iso((ch.daysAgo - 0.5) * DAY) : null,
        fixed ? workshop.id : null,
        when,
        when,
      );
    }
  }
  return out;
}
