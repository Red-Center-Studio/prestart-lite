import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Every test starts from an empty database (with the settings row) and an empty photo bucket.
beforeEach(async () => {
  await env.DB.batch(
    [
      "check_result",
      "defect",
      "`check`",
      "checklist_item",
      "vehicle",
      "session",
      "account",
      "verification",
      "user",
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  await env.DB.prepare(
    "UPDATE app_settings SET business_name = 'My Fleet', support_email = '', show_setup_offer = 1 WHERE id = 1",
  ).run();
  const listed = await env.PHOTOS.list();
  if (listed.objects.length) await env.PHOTOS.delete(listed.objects.map((o) => o.key));
});
