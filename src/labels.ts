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

/** What each severity means, shown to drivers when they fail an item. Edit the wording to suit your fleet. */
export const severityHelp: Record<Severity, string> = {
  minor: "Safe to drive. Needs fixing soon, for example a chip, a dirty mirror or a worn seat cover.",
  major: "Get it checked before you drive, for example a warning light, low tyre pressure or a cracked mirror.",
  critical: "Unsafe. Do not drive, for example brakes, steering, missing doors, or no lights for night work.",
};

/** Suggested section names on the Setup page. Any name can be typed. */
export const SECTION_SUGGESTIONS = [
  "Exterior",
  "Tyres and wheels",
  "Lights",
  "Cab and controls",
  "Engine and fluids",
  "Brakes and steering",
  "Safety equipment",
  "Load and coupling",
  "Attachments",
  "Documents",
  "General",
];

export interface ChecklistTemplate {
  name: string;
  description: string;
  items: [section: string, label: string][];
}

/** Ready-made checklists offered on the Setup page. Adding one skips items you already have. */
export const CHECKLIST_TEMPLATES: Record<string, ChecklistTemplate> = {
  light: {
    name: "Car or light vehicle",
    description: "Sedans, wagons, vans and other light vehicles.",
    items: [
      ["Exterior", "Body, doors and panels: no new damage, doors open and close"],
      ["Exterior", "Mirrors and windows clean and undamaged"],
      ["Tyres and wheels", "Tyres: no damage, correct pressure, enough tread"],
      ["Tyres and wheels", "Wheel nuts present and tight"],
      ["Lights", "Headlights, tail lights and brake lights working"],
      ["Lights", "Indicators and hazard lights working"],
      ["Cab and controls", "Seatbelts working and undamaged"],
      ["Cab and controls", "Horn and wipers working"],
      ["Cab and controls", "No warning lights on the dash"],
      ["Brakes and steering", "Brakes and handbrake working"],
      ["Brakes and steering", "Steering feels normal"],
      ["Engine and fluids", "Oil, coolant and washer fluid levels OK"],
      ["Engine and fluids", "No leaks under the vehicle"],
      ["Safety equipment", "First aid kit present"],
      ["Documents", "Registration current"],
    ],
  },
  ute: {
    name: "Ute or 4WD",
    description: "Utes, 4WDs and light trucks, including trays and towing.",
    items: [
      ["Exterior", "Body, doors and panels: no new damage, doors open and close"],
      ["Exterior", "Tray, toolboxes and racks secure"],
      ["Exterior", "Mirrors and windows clean and undamaged"],
      ["Tyres and wheels", "Tyres: no damage, correct pressure, enough tread"],
      ["Tyres and wheels", "Spare tyre, jack and wheel brace present"],
      ["Lights", "Headlights, tail lights and brake lights working"],
      ["Lights", "Indicators, hazard lights and beacon working"],
      ["Cab and controls", "Seatbelts working and undamaged"],
      ["Cab and controls", "Horn, wipers and reversing alarm working"],
      ["Cab and controls", "No warning lights on the dash"],
      ["Brakes and steering", "Brakes and handbrake working"],
      ["Engine and fluids", "Oil, coolant and washer fluid levels OK"],
      ["Engine and fluids", "No leaks under the vehicle"],
      ["Load and coupling", "Tow bar, hitch and safety chains secure (if towing)"],
      ["Load and coupling", "Load restrained and within limits"],
      ["Safety equipment", "First aid kit and fire extinguisher present"],
    ],
  },
  truck: {
    name: "Truck or prime mover",
    description: "Rigid trucks and prime movers. Check your heavy vehicle rules for anything extra.",
    items: [
      ["Exterior", "Cab, body and panels: no new damage, doors and latches work"],
      ["Exterior", "Mirrors, windscreen and windows clean and undamaged"],
      ["Exterior", "Mudguards and flaps secure"],
      ["Tyres and wheels", "Tyres: no damage, cuts or bulges, correct pressure"],
      ["Tyres and wheels", "Wheel nuts present, no rust trails"],
      ["Lights", "Headlights, tail, brake and clearance lights working"],
      ["Lights", "Indicators and hazard lights working"],
      ["Brakes and steering", "Service brakes and park brake working"],
      ["Brakes and steering", "Air pressure builds normally, no air leaks"],
      ["Brakes and steering", "Steering: no excess play"],
      ["Cab and controls", "Seatbelt, horn, wipers and reversing alarm working"],
      ["Cab and controls", "No warning lights on the dash"],
      ["Engine and fluids", "Engine oil, coolant and washer fluid levels OK"],
      ["Engine and fluids", "No fuel, oil or coolant leaks"],
      ["Load and coupling", "Turntable, kingpin or tow coupling secure and greased"],
      ["Load and coupling", "Load restrained and within mass limits"],
      ["Safety equipment", "Fire extinguisher, first aid kit and warning triangles present"],
      ["Documents", "Work diary and registration current"],
    ],
  },
  trailer: {
    name: "Trailer",
    description: "Box, flatbed and plant trailers.",
    items: [
      ["Load and coupling", "Coupling, safety chains and shackles secure"],
      ["Load and coupling", "Electrical plug connected and secure"],
      ["Load and coupling", "Breakaway brake cable connected (if fitted)"],
      ["Tyres and wheels", "Tyres: no damage, correct pressure"],
      ["Tyres and wheels", "Wheel nuts present and tight"],
      ["Lights", "Tail, brake and indicator lights working"],
      ["Exterior", "Body, tailgate and ramps secure"],
      ["Brakes and steering", "Trailer brakes working"],
      ["Load and coupling", "Load restrained and within limits"],
      ["Documents", "Registration current"],
    ],
  },
  forklift: {
    name: "Forklift",
    description: "Counterbalance and reach forklifts.",
    items: [
      ["Exterior", "Overhead guard and frame undamaged"],
      ["Attachments", "Forks: no cracks or bends, locking pins in place"],
      ["Attachments", "Mast, chains and hoses: no damage or leaks"],
      ["Tyres and wheels", "Tyres and wheels undamaged"],
      ["Cab and controls", "Seatbelt working"],
      ["Cab and controls", "Horn, lights and reversing beeper working"],
      ["Cab and controls", "Lift, tilt and side shift controls work smoothly"],
      ["Brakes and steering", "Brakes and park brake working"],
      ["Brakes and steering", "Steering works normally"],
      ["Engine and fluids", "Fuel, gas or battery charge OK, no leaks"],
      ["Engine and fluids", "Hydraulic oil level OK"],
      ["Safety equipment", "Data plate legible, fire extinguisher present"],
    ],
  },
  plant: {
    name: "Plant or machinery",
    description: "Excavators, loaders, skid steers and similar mobile plant.",
    items: [
      ["Exterior", "Cab, ROPS and guards undamaged"],
      ["Exterior", "Windows and mirrors clean and undamaged"],
      ["Tyres and wheels", "Tracks or tyres undamaged and tensioned"],
      ["Attachments", "Bucket, quick hitch and locking pins secure"],
      ["Attachments", "Hydraulic hoses and rams: no leaks or damage"],
      ["Cab and controls", "Seatbelt working"],
      ["Cab and controls", "Horn, lights, beacon and reversing alarm working"],
      ["Cab and controls", "All controls and safety lockouts work"],
      ["Cab and controls", "No warning lights on the display"],
      ["Brakes and steering", "Brakes and park brake working"],
      ["Engine and fluids", "Engine oil, coolant, fuel and hydraulic levels OK"],
      ["Engine and fluids", "Grease points serviced"],
      ["Safety equipment", "Fire extinguisher present and charged"],
    ],
  },
};
