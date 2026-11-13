import { sql } from "drizzle-orm";
import { check as checkConstraint, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Database schema. One deploy serves one business, so there is no organisation table.
 * Ids are text UUIDs. App dates are ISO timestamps in UTC stored as text.
 * Better Auth's own tables (user, session, account, verification) use the column types it expects.
 */

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const timestamps = {
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
};

// ---------- Better Auth tables ----------

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    // Better Auth calls this field "name". It is the person's full name.
    name: text("full_name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    // null while the account waits for an admin to give it a role.
    role: text("role", { enum: ["admin", "workshop", "driver"] }),
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [checkConstraint("user_role_check", sql`${t.role} IS NULL OR ${t.role} IN ('admin', 'workshop', 'driver')`)],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------- App tables ----------

export const appSettings = sqliteTable(
  "app_settings",
  {
    // Always 1: there is exactly one settings row, created by a migration.
    id: integer("id").primaryKey(),
    businessName: text("business_name").notNull().default("My Fleet"),
    supportEmail: text("support_email").notNull().default(""),
    setupHelpUrl: text("setup_help_url").notNull().default("https://redcenterstudio.com/"),
    showSetupOffer: integer("show_setup_offer", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => [checkConstraint("app_settings_single_row", sql`${t.id} = 1`)],
);

export const vehicle = sqliteTable(
  "vehicle",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    rego: text("rego").notNull().default(""),
    vehicleType: text("vehicle_type").notNull().default(""),
    odometerKm: integer("odometer_km").notNull().default(0),
    regoDue: text("rego_due"),
    serviceDue: text("service_due"),
    status: text("status", { enum: ["in_service", "off_road"] })
      .notNull()
      .default("in_service"),
    notes: text("notes").notNull().default(""),
    ...timestamps,
  },
  (t) => [
    checkConstraint("vehicle_status_check", sql`${t.status} IN ('in_service', 'off_road')`),
    checkConstraint("vehicle_odometer_check", sql`${t.odometerKm} >= 0`),
  ],
);

export const checklistItem = sqliteTable("checklist_item", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  // Group shown as a heading on the check form, for example "Exterior" or "Safety equipment".
  section: text("section").notNull().default("General"),
  sort: integer("sort").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

export const check = sqliteTable(
  "check",
  {
    id: text("id").primaryKey(),
    vehicleId: text("vehicle_id").notNull(),
    vehicleName: text("vehicle_name").notNull(),
    driverId: text("driver_id").notNull(),
    driverName: text("driver_name").notNull(),
    odometerKm: integer("odometer_km").notNull(),
    // true when the reading was lower than the vehicle's last reading and the driver confirmed it.
    odometerWentBack: integer("odometer_went_back", { mode: "boolean" }).notNull().default(false),
    passed: integer("passed", { mode: "boolean" }).notNull(),
    notes: text("notes").notNull().default(""),
    photoKey: text("photo_key"),
    ...timestamps,
  },
  (t) => [
    index("check_vehicle_created_idx").on(t.vehicleId, t.createdAt),
    index("check_driver_created_idx").on(t.driverId, t.createdAt),
  ],
);

export const checkResult = sqliteTable(
  "check_result",
  {
    id: text("id").primaryKey(),
    checkId: text("check_id")
      .notNull()
      .references(() => check.id, { onDelete: "cascade" }),
    checklistItemId: text("checklist_item_id").notNull(),
    label: text("label").notNull(),
    section: text("section").notNull().default("General"),
    // false only for a failed item. N/A items count as ok.
    ok: integer("ok", { mode: "boolean" }).notNull(),
    status: text("status", { enum: ["pass", "fail", "na"] })
      .notNull()
      .default("pass"),
    note: text("note").notNull().default(""),
    severity: text("severity", { enum: ["minor", "major", "critical"] }),
    ...timestamps,
  },
  (t) => [index("check_result_check_idx").on(t.checkId)],
);

export const defect = sqliteTable(
  "defect",
  {
    id: text("id").primaryKey(),
    vehicleId: text("vehicle_id").notNull(),
    vehicleName: text("vehicle_name").notNull(),
    checkId: text("check_id"),
    // The checklist answer that raised this defect, when it came from a failed item.
    checkResultId: text("check_result_id"),
    description: text("description").notNull(),
    severity: text("severity", { enum: ["minor", "major", "critical"] })
      .notNull()
      .default("minor"),
    status: text("status", { enum: ["open", "in_progress", "fixed"] })
      .notNull()
      .default("open"),
    reportedById: text("reported_by_id").notNull(),
    reportedByName: text("reported_by_name").notNull(),
    photoKey: text("photo_key"),
    workshopNotes: text("workshop_notes").notNull().default(""),
    fixedAt: text("fixed_at"),
    fixedById: text("fixed_by_id"),
    ...timestamps,
  },
  (t) => [
    checkConstraint("defect_severity_check", sql`${t.severity} IN ('minor', 'major', 'critical')`),
    checkConstraint("defect_status_check", sql`${t.status} IN ('open', 'in_progress', 'fixed')`),
    index("defect_status_severity_idx").on(t.status, t.severity),
    index("defect_vehicle_status_idx").on(t.vehicleId, t.status),
  ],
);

// Photos taken during a check: one or more per failed item, or for the check as a whole. Never public.
export const checkPhoto = sqliteTable(
  "check_photo",
  {
    id: text("id").primaryKey(),
    checkId: text("check_id")
      .notNull()
      .references(() => check.id, { onDelete: "cascade" }),
    checkResultId: text("check_result_id"),
    key: text("key").notNull(),
    ...timestamps,
  },
  (t) => [index("check_photo_check_idx").on(t.checkId)],
);

export const schema = {
  user,
  session,
  account,
  verification,
  appSettings,
  vehicle,
  checklistItem,
  check,
  checkResult,
  defect,
  checkPhoto,
};

export type User = typeof user.$inferSelect;
export type Vehicle = typeof vehicle.$inferSelect;
export type ChecklistItem = typeof checklistItem.$inferSelect;
export type Check = typeof check.$inferSelect;
export type CheckResult = typeof checkResult.$inferSelect;
export type Defect = typeof defect.$inferSelect;
export type CheckPhoto = typeof checkPhoto.$inferSelect;
export type AppSettings = typeof appSettings.$inferSelect;
