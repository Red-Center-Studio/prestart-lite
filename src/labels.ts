/**
 * Every role, status and severity caption shown in the app lives here, so you can rename them in one place.
 * The keys on the left are stored in the database and must not change. Edit only the text on the right.
 */

export const ROLES = ["admin", "workshop", "driver"] as const;
export type Role = (typeof ROLES)[number];

export const SEVERITIES = ["minor", "major", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const DEFECT_STATUSES = ["open", "in_progress", "fixed"] as const;
export type DefectStatus = (typeof DEFECT_STATUSES)[number];

export const VEHICLE_STATUSES = ["in_service", "off_road"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const roleLabel: Record<Role, string> = {
  admin: "Admin",
  workshop: "Workshop",
  driver: "Driver",
};

/** Shown for a signed-up user who has not been given a role yet. */
export const PENDING_LABEL = "Waiting for approval";

export const severityLabel: Record<Severity, string> = {
  minor: "Minor",
  major: "Major",
  critical: "Critical (do not drive)",
};

export const defectStatusLabel: Record<DefectStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  fixed: "Fixed",
};

export const vehicleStatusLabel: Record<VehicleStatus, string> = {
  in_service: "In service",
  off_road: "Off road",
};

/** Wording used across the app. Change "Rego" to "Plate" or "Registration" to suit your region. */
export const words = {
  appName: "PreStart",
  rego: "Rego",
  regoDue: "Rego due",
  serviceDue: "Service due",
  odometer: "Odometer",
  distanceUnit: "km",
};

/** The 8 standard checklist items offered on the Setup page. */
export const STANDARD_CHECKLIST = [
  "Tyres and wheels: no damage, correct pressure",
  "Lights and indicators working",
  "Brakes and handbrake working",
  "Mirrors and windows clean and undamaged",
  "Oil, coolant and washer fluid levels OK",
  "Seatbelts working",
  "Horn and wipers working",
  "No warning lights on the dash",
];
