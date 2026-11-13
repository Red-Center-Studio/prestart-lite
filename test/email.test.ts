import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { resetEmail, verifyEmail } from "../src/auth/auth";
import type { Bindings } from "../src/env";
import { sendEmail, senderName, wrapHtml } from "../src/lib/email";

describe("emails", () => {
  it("come from the business name, or PreStart until one is set", () => {
    expect(senderName("Outback Haulage")).toBe("Outback Haulage");
    expect(senderName("My Fleet")).toBe("PreStart");
    expect(senderName("")).toBe("PreStart");
    expect(senderName('Evil"\r\nBcc: x@y')).toBe("Evil Bcc: x@y");
  });

  it("name the business and the install address in sign-up and reset emails", () => {
    const reset = resetEmail("Outback Haulage", "checks.outback.example", "Dana", "https://checks.outback.example/r/1");
    expect(reset.subject).toBe("Reset your password for Outback Haulage");
    expect(reset.text).toContain("Outback Haulage's PreStart (checks.outback.example)");
    expect(reset.text).toContain("https://checks.outback.example/r/1");
    expect(reset.html).toContain('href="https://checks.outback.example/r/1"');
    const verify = verifyEmail("PreStart", "prestart.example", "<b>Dana</b>", "https://prestart.example/v");
    expect(verify.subject).toBe("Confirm your email for PreStart");
    expect(verify.text).toContain("signing up to PreStart (prestart.example)");
    expect(verify.html).toContain("&lt;b&gt;Dana&lt;/b&gt;");
  });

  it("wraps the body in a phone-friendly layout", () => {
    const html = wrapHtml("<p>Hello</p>", "Outback Haulage");
    expect(html).toContain('name="viewport"');
    expect(html).toContain("max-width:560px");
    expect(html).toContain("<p>Hello</p>");
    expect(html).toContain("Outback Haulage, sent by PreStart");
  });

  it("sends through the binding with the business name as the sender", async () => {
    await env.DB.prepare("UPDATE app_settings SET business_name = 'Outback Haulage' WHERE id = 1").run();
    const sent: unknown[] = [];
    const fake = {
      ...env,
      MAIL_FROM: "prestart@fleet.example",
      EMAIL: {
        send: (m: unknown) => {
          sent.push(m);
          return Promise.resolve({ messageId: "1" });
        },
      },
    } as unknown as Bindings;
    await sendEmail(fake, { to: "dana@fleet.example", subject: "Hi", text: "Hello", html: "<p>Hello</p>" });
    expect(sent[0]).toMatchObject({
      from: { email: "prestart@fleet.example", name: "Outback Haulage" },
      to: "dana@fleet.example",
      subject: "Hi",
      text: "Hello",
    });
    expect((sent[0] as { html: string }).html).toContain("Outback Haulage, sent by PreStart");
  });
});
