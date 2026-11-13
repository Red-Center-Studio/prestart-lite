import type { Bindings } from "../env";

export interface OutgoingEmail {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

/** True when Cloudflare Email Sending is set up (binding uncommented and MAIL_FROM filled in). */
export const emailReady = (env: Bindings): boolean => Boolean(env.EMAIL && env.MAIL_FROM);

/**
 * Sends an email through Cloudflare Email Sending. Without email set up it writes the message to the Worker log
 * instead, so local development still works (copy the link from your terminal).
 */
export async function sendEmail(env: Bindings, message: OutgoingEmail): Promise<void> {
  if (!env.EMAIL || !env.MAIL_FROM) {
    console.log(
      JSON.stringify({ event: "email_not_configured", to: message.to, subject: message.subject, text: message.text }),
    );
    return;
  }
  try {
    await env.EMAIL.send({
      from: { email: env.MAIL_FROM, name: "PreStart" },
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  } catch (err) {
    console.error(JSON.stringify({ event: "email_failed", subject: message.subject, error: String(err) }));
    throw err;
  }
}
