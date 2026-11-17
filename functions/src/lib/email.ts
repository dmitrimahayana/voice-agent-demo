// Transactional email through Resend (https://resend.com, free tier: 3,000 emails/month).
// Used by Demo 4 for reservation emails. Needs RESEND_API_KEY (secret) and EMAIL_FROM (var).
// EMAIL_FROM must use a domain verified in Resend; "onboarding@resend.dev" works for tests but only
// delivers to the email address of your own Resend account.
import type { Env } from "../env";
import { fetchJson } from "./util";

export const emailEnabled = (env: Env) => Boolean(env.RESEND_API_KEY);

export interface Email { to: string; subject: string; html: string; text: string; replyTo?: string }

export async function sendEmail(env: Env, e: Email): Promise<string> {
  const res = await fetchJson<{ id: string }>("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "Dewlane Skin Studio <onboarding@resend.dev>",
      to: [e.to],
      subject: e.subject,
      html: e.html,
      text: e.text,
      ...(e.replyTo ? { reply_to: e.replyTo } : {}),
    }),
  });
  return res.id;
}

/** Simple, loosely checked email address (voice transcription often adds spaces or "at"/"dot"). */
export function normalizeEmail(raw: string): string {
  const e = raw.trim().toLowerCase()
    .replace(/\s+(at|arroba)\s+/g, "@").replace(/\s+(dot|punto)\s+/g, ".")
    .replace(/\s+/g, "");
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) ? e : "";
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** One reservation email layout for booked, rescheduled and cancelled. Rows are [label, value]. */
export function reservationEmail(opts: {
  to: string; studio: string; heading: string; intro: string; rows: [string, string][]; footer: string[];
}): Email {
  const rowsHtml = opts.rows.map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#7a6a64;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#2b2320">${esc(v)}</td></tr>`).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f7f1ee;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px" cellpadding="0" cellspacing="0">
<tr><td style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#b0786a">${esc(opts.studio)}</td></tr>
<tr><td style="font-size:22px;color:#2b2320;padding:8px 0 12px">${esc(opts.heading)}</td></tr>
<tr><td style="font-size:15px;color:#4a3f3b;line-height:1.5;padding-bottom:16px">${esc(opts.intro)}</td></tr>
<tr><td><table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px">${rowsHtml}</table></td></tr>
${opts.footer.map((f) => `<tr><td style="font-size:13px;color:#7a6a64;line-height:1.5;padding-top:14px">${esc(f)}</td></tr>`).join("")}
</table></td></tr></table></body></html>`;
  const text = [opts.studio, "", opts.heading, "", opts.intro, "", ...opts.rows.map(([k, v]) => `${k}: ${v}`), "", ...opts.footer].join("\n");
  return { to: opts.to, subject: `${opts.heading} - ${opts.studio}`, html, text };
}
