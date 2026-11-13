# Setting up PreStart

This guide takes you from the downloaded code to your own live PreStart, step by step. You do not need to be a
developer. Each command is explained in plain words. Expect it to take about 20 minutes the first time.

Everything runs in **your own Cloudflare account**, on the free plan, for a small fleet.

## What you need

1. **A Cloudflare account.** Free. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. **Node.js 22.18 or newer.** This runs the setup tools on your computer. Download the "LTS" version from
   [nodejs.org](https://nodejs.org) and install it with the default options.
3. **The PreStart code** in a folder on your computer.

To run the commands below, open a terminal in the PreStart folder:

- **Windows:** open the folder in File Explorer, click the address bar, type `powershell` and press Enter.
- **Mac:** right-click the folder in Finder and choose "New Terminal at Folder".

## Step 1: Install the tools

```bash
npm install
```

This downloads the libraries PreStart uses into a `node_modules` folder. It takes a minute or two. You only do it
once (and again after you update the code).

## Step 2: Try it on your computer (optional)

```bash
cp .dev.vars.example .dev.vars
npm run dev
```

- The first line makes a settings file for local testing. On Windows PowerShell use
  `Copy-Item .dev.vars.example .dev.vars` instead.
- The second line builds the styles, creates a local database and starts PreStart on your computer.

Open [http://localhost:8787](http://localhost:8787). Create an account: the **first account becomes the Admin**.
Press `Ctrl + C` in the terminal to stop it.

Want sample data to click around? Run `npm run seed:local` (this wipes your local test database first).

## Step 3: Sign in to Cloudflare

```bash
npx wrangler login
```

This opens your browser and asks you to allow Wrangler (Cloudflare's command-line tool) to manage your account.
Click **Allow**. Nothing is deployed yet.

## Step 4: Set the secret key

PreStart needs one secret: a long random string that protects sign-in sessions. Never share it or put it in the
code.

```bash
npx wrangler secret put AUTH_SECRET
```

It asks for a value. Paste any long random string (40 characters or more) and press Enter. Nothing shows as you
paste; that is normal. To make one:

- **Mac or Linux:** run `openssl rand -hex 32` and copy the result.
- **Windows PowerShell:** run
  `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { '{0:x2}' -f $_ })` and copy the result.

The first time, Wrangler may ask whether to create the Worker. Answer **yes**.

## Step 5: Deploy

The very first time, run these two commands, one after the other:

```bash
npm run build:css
npx wrangler deploy
```

This uploads PreStart and creates its database and photo storage in your account. Wrangler may ask you to confirm
the new resources; answer yes. It prints your address, like `https://prestart.your-name.workers.dev`. Do not open it
yet: the database is still empty.

Then run:

```bash
npm run deploy
```

This sets up the database tables, then uploads PreStart again. From now on, this is the only command you need to
publish changes: it always updates the database before the code.

Now open your address and create your account. The first account becomes the Admin.

## Step 6: Set up your fleet

Signed in as the Admin:

1. **Setup page:** add your business name, then add your checklist (or click "Add the 8 standard items").
2. **Fleet page:** add your vehicles.
3. **Your team:** send them your PreStart address. When they create an account, they appear on the Setup page as
   "Waiting for approval". Give each person a role:
   - **Driver:** submits checks, sees their own history and the defect queue.
   - **Workshop:** also works on defects and sees every check.
   - **Admin:** can change everything.

## Optional: use your own web address

In the Cloudflare dashboard, open **Workers & Pages**, click **prestart**, then **Settings**, then **Domains &
Routes**, then **Add**, then **Custom domain**. Enter something like `checks.yourbusiness.com`. Your domain must be
on Cloudflare.

Then set `APP_URL` in `wrangler.jsonc` to that address (for example `"https://checks.yourbusiness.com"`) and run
`npm run deploy` again, so email links use it.

## Optional: email (password resets and email confirmation)

Without email, everything works except "Forgot your password?". An admin can still remove and re-approve people.

To turn email on:

1. In the Cloudflare dashboard, set up **Email Sending** for your domain (Compute, then Email Service). It walks you
   through the DNS records.
2. In `wrangler.jsonc`:
   - uncomment the line `"send_email": [{ "name": "EMAIL" }],`
   - set `"MAIL_FROM"` to an address on that domain, such as `"prestart@yourbusiness.com"`
   - set `"APP_URL"` to your PreStart address
   - optionally set `"REQUIRE_EMAIL_VERIFICATION": "true"` so new people confirm their email before signing in
3. Run `npm run deploy`.

Prefer Resend or another email service? See CUSTOMISING.md.

## Updating PreStart later

When you get a new version of the code:

```bash
npm install
npm run deploy
```

`npm run deploy` applies any new database changes before uploading, and never deletes your data.

## Backups

Cloudflare D1 keeps 30 days of point-in-time history automatically. To restore, see
[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/). To export a copy:

```bash
npx wrangler d1 export DB --remote --output=prestart-backup.sql
```

## Something not working?

- **"Please sign in" loops, or "This form has expired":** make sure `AUTH_SECRET` is set (Step 4) and refresh.
- **See what went wrong:** Cloudflare dashboard, then **Workers & Pages**, then **prestart**, then **Logs**.
- **Run the tests:** `npm test` checks the business rules and permissions on your computer.

## Demo mode (for showing PreStart off, not for real fleets)

Setting `"DEMO_MODE": "true"` adds one-click demo sign-ins to the login page, turns off sign-up, and wipes and
reloads sample data every day at 15:00 UTC. Load the sample data the first time with
`npm run seed:remote -- --yes`. **Never turn this on for a real fleet:** it deletes everything nightly.
