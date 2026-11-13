# Changelog

## 1.0.0 (Lite) - 2026-11-13

First release of PreStart Lite as owned code on Cloudflare Workers.

### Added

- Daily pre-start check form, built for phones, with a vehicle preselect link (`/check?vehicle=<id>`).
- Defect queue with start work, workshop notes and mark fixed. Critical defects first.
- Fleet page with rego and service due dates highlighted within 30 days.
- Setup page: business details, checklist editor with the 8 standard items, team and roles, setup help card.
- History with filters by vehicle, driver, date and result. Drivers see only their own checks.
- Email and password sign-in (Better Auth), optional email confirmation and password reset.
- First account on a fresh deploy becomes Admin. New sign-ups wait for approval.
- Private photo uploads in R2, served only after a permission check.
- Demo mode with a nightly reset, and `npm run seed:local` / `npm run seed:remote` sample data.

### Workflow improvements

- Marking a defect fixed returns the vehicle to service only when no other open or in-progress critical defect
  remains.
- A check, its results, its defect and the vehicle update are saved together or not at all.
- An odometer reading lower than the last one needs confirming and is flagged in history.
- Checks on off-road vehicles are rejected on the server.
- The business settings row is created once by a migration, so it cannot be duplicated.
- "Report a problem anyway" lets a driver raise a defect when every checklist item passed.
