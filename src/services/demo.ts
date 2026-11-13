import { type Bindings, isOn } from "../env";
import { demoStatements } from "../seed/demo";

/**
 * Wipes and reloads the demo data. Runs from the daily Cron Trigger, and only when DEMO_MODE is "true",
 * so it can never touch a real fleet's data by accident.
 */
export async function resetDemo(env: Bindings, now = new Date()): Promise<boolean> {
  if (!isOn(env.DEMO_MODE)) return false;
  const statements = await demoStatements(now);
  await env.DB.batch(statements.map((s) => env.DB.prepare(s.sql).bind(...s.params)));

  // Remove every uploaded photo from the day.
  let cursor: string | undefined;
  do {
    const page = await env.PHOTOS.list({ prefix: "checks/", limit: 1000, ...(cursor ? { cursor } : {}) });
    if (page.objects.length > 0) await env.PHOTOS.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  console.log(JSON.stringify({ event: "demo_reset", statements: statements.length }));
  return true;
}
