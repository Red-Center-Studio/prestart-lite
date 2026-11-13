import type { Bindings } from "../env";
import { escapeHtml } from "./text";

export interface OutgoingEmail {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

/** True when Cloudflare Email Sending is set up (binding uncommented and MAIL_FROM filled in). */
export const emailReady = (env: Bindings): boolean => Boolean(env.EMAIL && env.MAIL_FROM);

/** The name emails come from: the business name, or "PreStart" until one is set. */
export function senderName(businessName: string | null | undefined): string {
  const name = (businessName ?? "")
    .replace(/[\r\n"<>]+/g, " ")
    .trim()
    .slice(0, 70);
  return !name || name === "My Fleet" ? "PreStart" : name;
}

/** A link styled as a large button, for the main action in an email. */
export function emailButton(url: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#0c29ab;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escapeHtml(label)}</a></p>`;
}

/** Wraps an email body in a plain layout that reads well on a phone: one column, large text, no images. */
export function wrapHtml(inner: string, businessName: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef1f6">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a">
<div style="background:#ffffff;border-radius:12px;padding:24px">${inner}</div>
<p style="margin:16px 4px 0;font-size:13px;color:#555">${escapeHtml(senderName(businessName))}, sent by PreStart</p>
</div></body></html>`;
}

/** The business name from the settings, or an empty string if it cannot be read. */
export async function businessName(env: Bindings): Promise<string> {
  try {
    const row = await env.DB.prepare("SELECT business_name FROM app_settings WHERE id = 1").first<{
      business_name: string;
    }>();
    return row?.business_name ?? "";
  } catch {
    return "";
  }
}

/**
 * Sends an email through Cloudflare Email Sending, from the business name. Without email set up it writes the message
 * to the Worker log instead, so local development still works (copy the link from your terminal).
 */
export async function sendEmail(env: Bindings, message: OutgoingEmail): Promise<void> {
  if (!env.EMAIL || !env.MAIL_FROM) {
    console.log(
      JSON.stringify({ event: "email_not_configured", to: message.to, subject: message.subject, text: message.text }),
    );
    return;
  }
  const business = await businessName(env);
  try {
    await env.EMAIL.send({
      from: { email: env.MAIL_FROM, name: senderName(business) },
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: wrapHtml(message.html, business) } : {}),
    });
  } catch (err) {
    console.error(JSON.stringify({ event: "email_failed", subject: message.subject, error: String(err) }));
    throw err;
  }
}
