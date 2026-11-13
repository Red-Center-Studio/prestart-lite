import { expect, test as setup } from "@playwright/test";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../src/seed/demo.ts";

// Signs each demo role in once and saves the session, so the tests stay under the sign-in rate limit.
for (const account of DEMO_ACCOUNTS) {
  setup(`sign in as ${account.role}`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(account.role === "driver" ? /\/check$/ : /\/defects$/);
    await page.context().storageState({ path: `.e2e-state/${account.role}.json` });
  });
}
