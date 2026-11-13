# Customising PreStart

Every change below is a small edit to one file, followed by `npm run deploy`.

## Words, roles and statuses

All captions live in [`src/labels.ts`](src/labels.ts):

- **Roles:** rename "Workshop" to "Maintenance", for example. Change only the text on the right; the keys on the left
  are stored in the database.
- **Severities:** "Critical (do not drive)" and friends.
- **Region wording:** change `rego` to `"Plate"` or `"Registration"`, and `distanceUnit` if you want the label to say
  something else. (Readings are stored as whole numbers either way.)

## Ready-made checklists, sections and severities

- **Ready-made checklists:** `CHECKLIST_TEMPLATES` in [`src/labels.ts`](src/labels.ts). Each one is a name, a
  description and a list of `[section, item]` pairs. Add your own (for example "Bus" or "Excavator") and it appears in
  the "Add a ready-made checklist" list on the Setup page. This only changes what the button adds. Items already on
  your list stay as they are.
- **Section suggestions:** `SECTION_SUGGESTIONS` in the same file. Admins can still type any section name.
- **What each severity means:** `severityHelp` in the same file, shown under each choice when a driver fails an item.
  Change the examples to match your fleet and your safety rules.
- **What drivers are told after a check:** `OUTCOMES` in [`src/routes/check.tsx`](src/routes/check.tsx).

## Colours and branding

- **Colours:** the `@theme` block at the top of [`src/styles/input.css`](src/styles/input.css). `--color-navy` is
  the header and banner colour, `--color-accent` the safety yellow, and `--color-primary` the main button colour.
- **Logo:** `public/favicon.svg` (browser tab) and the `Logo` component in
  [`src/views/layout.tsx`](src/views/layout.tsx) (top of each page).
- **Business name:** set on the Setup page. No code needed.

## Time zone

Set `TIME_ZONE` in `wrangler.jsonc` to your IANA time zone name, such as `Australia/Perth`, `Pacific/Auckland`,
`Europe/London` or `America/Chicago`.

## Terms and privacy pages

Both are placeholders in [`src/routes/misc.tsx`](src/routes/misc.tsx). Replace the text with your own before you go
live.

## Using Resend instead of Cloudflare Email Sending

Email goes through one function, `sendEmail` in [`src/lib/email.ts`](src/lib/email.ts). To use Resend:

1. Create a Resend API key and store it with `npx wrangler secret put RESEND_API_KEY`.
2. Replace the body of `sendEmail` with a `fetch` to `https://api.resend.com/emails`, sending
   `{ from, to, subject, text, html }` with the header `Authorization: Bearer <key>`.
3. Keep `MAIL_FROM` set to an address on your Resend domain.

## Permissions

Every rule is in [`src/lib/can.ts`](src/lib/can.ts), with a table at the top. Change a rule there and every page and
action follows. Update `test/permissions.test.ts` to match, then run `npm test`.

## Database changes

1. Edit [`src/db/schema.ts`](src/db/schema.ts).
2. Run `npm run db:generate`. It writes a new SQL file to `migrations/`.
3. Run `npm run deploy`. It applies the new migration to your live database first.

## Checks before you deploy

```bash
npm run check      # type check, lint, formatting and unit tests
npm run test:e2e   # end-to-end tests in a real browser (uses Microsoft Edge or Chrome)
```
