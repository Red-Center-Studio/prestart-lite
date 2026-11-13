import { z } from "zod";
import { PASSWORD_MAX, PASSWORD_MIN } from "../auth/auth";
import { ROLES, SEVERITIES, VEHICLE_STATUSES } from "../labels";

/**
 * Server-side validation for every form and query. Nothing sent by the browser is trusted: ids, roles and
 * numbers are all checked here before any database work.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const required = (max: number, label: string) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `${label} is too long (${max} characters at most).`);
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long (${max} characters at most).`)
    .optional()
    .transform((v) => v ?? "");
const email = z.string().trim().toLowerCase().max(254, "Email is too long.").pipe(z.email("Enter a valid email."));
const password = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Password must be ${PASSWORD_MAX} characters or fewer.`);
export const id = z.uuid("Something went wrong with that link. Go back and try again.");
const checkbox = z
  .union([z.literal("1"), z.literal("on"), z.literal("true"), z.literal("")])
  .optional()
  .transform((v) => v === "1" || v === "on" || v === "true");
const isoDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))), {
    message: "Enter dates as YYYY-MM-DD.",
  });
const wholeNumber = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,7}$/, `${label} must be a whole number of 0 or more.`)
    .transform(Number);

export const signUpSchema = z.object({
  fullName: required(80, "Full name"),
  email,
  password,
});

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX),
  next: z.string().max(200).optional(),
});

export const forgotSchema = z.object({ email });

export const resetSchema = z
  .object({
    token: z.string().min(1).max(256),
    password,
    confirm: z.string().max(PASSWORD_MAX),
  })
  .refine((v) => v.password === v.confirm, { message: "The two passwords do not match.", path: ["confirm"] });

export const checkSubmitSchema = z.object({
  submissionId: id,
  vehicleId: z.uuid("Pick a vehicle."),
  odometer: wholeNumber("Odometer"),
  ok: z.array(id).max(200).default([]),
  notes: optionalText(1000, "Notes"),
  severity: z.enum(SEVERITIES).default("minor"),
  confirmLower: checkbox,
  reportAnyway: checkbox,
});

export const vehicleSchema = z.object({
  name: required(60, "Name"),
  rego: optionalText(20, "Rego"),
  vehicleType: optionalText(40, "Vehicle type"),
  odometer: wholeNumber("Odometer"),
  regoDue: isoDate,
  serviceDue: isoDate,
  status: z.enum(VEHICLE_STATUSES).default("in_service"),
  notes: optionalText(1000, "Notes"),
});

export const checklistLabelSchema = z.object({ label: required(120, "Checklist item") });
export const moveSchema = z.object({ direction: z.enum(["up", "down"]) });

export const businessSchema = z.object({
  businessName: required(80, "Business name"),
  supportEmail: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => v ?? "")
    .refine((v) => v === "" || z.email().safeParse(v).success, { message: "Enter a valid support email." }),
  setupHelpUrl: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v ?? "")
    .refine((v) => v === "" || /^https:\/\/[^\s]+$/.test(v), { message: "The help link must start with https://" }),
  showSetupOffer: checkbox,
});

export const roleSchema = z.object({ role: z.enum(ROLES) });

export const defectNotesSchema = z.object({ workshopNotes: optionalText(2000, "Workshop notes") });

export const accountNameSchema = z.object({ fullName: required(80, "Full name") });
export const accountEmailSchema = z.object({ email });
export const accountPasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(PASSWORD_MAX),
    newPassword: password,
    confirm: z.string().max(PASSWORD_MAX),
  })
  .refine((v) => v.newPassword === v.confirm, { message: "The two new passwords do not match.", path: ["confirm"] });

export const historyQuerySchema = z.object({
  vehicle: z.uuid().optional().catch(undefined),
  driver: z.uuid().optional().catch(undefined),
  from: isoDate.catch(null),
  to: isoDate.catch(null),
  result: z.enum(["pass", "fail"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});

/** Turns a parsed form body into plain values. Keys ending in [] become arrays; files are dropped. */
export function formValues(body: Record<string, string | File | (string | File)[]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    const strings = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === "string");
    if (key.endsWith("[]")) out[key.slice(0, -2)] = strings;
    else if (strings.length > 0) out[key] = strings[strings.length - 1];
  }
  return out;
}

/** The first validation message, written for people. */
export const firstError = (error: z.ZodError): string => error.issues[0]?.message ?? "Please check the form.";

export { trimmed };
