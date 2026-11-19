/* Emails to parents through Cloudflare Email Service (the EMAIL send_email binding): the sign-in code and the
   welcome note sent when an account is made. Transactional only, never marketing. The sender is MAIL_FROM
   (wrangler.jsonc vars) with the site's name from the pack; the sending domain must be onboarded in Cloudflare
   (Email Service > Email Sending) before the first send.
   Local development has no email service: under `astro dev` the message is not sent and the sign-in code is printed
   in the server console instead, so sign-in still works. A deployed Worker without the EMAIL binding refuses to send
   (a code in the logs would let anyone who reads them sign in). */
import { config } from '../../pack';
import { bindings } from './env';
import { HttpError } from './http';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** "a***@x.com": enough to recognize the address in a log, not to read it. */
export const maskEmail = (email: string) => {
  const at = email.lastIndexOf('@');
  return at < 1 ? '***' : `${email[0]}***${email.slice(at)}`;
};

/** True when emails are only simulated (printed in the console): `astro dev` only. */
const simulated = () => import.meta.env.DEV;

async function send(to: string, subject: string, text: string, html: string) {
  if (simulated()) return;
  if (!bindings.EMAIL) throw new HttpError(503, 'Email sign-in is not set up on this site yet.');
  try {
    await bindings.EMAIL.send({ to, from: { email: bindings.MAIL_FROM || 'login@example.com', name: config.name }, subject, text, html });
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    console.error('Email send failed', code);
    if (code === 'E_RATE_LIMIT_EXCEEDED' || code === 'E_DAILY_LIMIT_EXCEEDED') throw new HttpError(429, 'We are sending too many emails right now. Try again in a few minutes.');
    if (code.startsWith('E_SENDER') || code === 'E_SENDER_DOMAIN_NOT_AVAILABLE') throw new HttpError(503, 'Email sign-in is not available yet. Try again later.');
    if (code === 'E_RECIPIENT_SUPPRESSED') throw new HttpError(400, 'We cannot send email to that address. Check it and try again.');
    throw new HttpError(502, 'We could not send the email. Try again in a minute.');
  }
}

const frame = (body: string, origin: string) => `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f4ef;font:16px/1.5 Arial,Helvetica,sans-serif;color:#1d2521">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">${body}
<p style="margin:24px 0 0;font-size:13px;color:#6b726e">${esc(config.name)} · ${esc(origin.replace(/^https?:\/\//, ''))}</p></div></body></html>`;

export function sendCode(to: string, code: string, origin = '') {
  if (simulated()) {
    console.log(`[dev] sign-in code for ${maskEmail(to)}: ${code}`);
    return Promise.resolve();
  }
  return send(to, `Your ${config.name} sign-in code: ${code}`,
    `Your ${config.name} sign-in code is ${code}.\n\nIt works for 10 minutes. If you didn't ask for it, ignore this email: nobody can sign in without the code.\n\n${config.name}${origin ? ` · ${origin}` : ''}`,
    frame(`<p style="margin:0 0 12px">Your ${esc(config.name)} sign-in code:</p>
<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px">${esc(code)}</p>
<p style="margin:0">It works for 10 minutes. If you didn't ask for it, ignore this email: nobody can sign in without the code.</p>`, origin));
}

/** Sent once, when the parent account is made: what we keep and how to delete it. */
export function sendWelcome(to: string, origin: string) {
  const account = `${origin}/account/`;
  return send(to, `Your ${config.name} parent account`,
    `You created a ${config.name} parent account with this email address.\n\nAdd each child with a nickname. Their practice progress is saved to your account so you can follow it.\n\nYou can delete a child's profile or your whole account at any time: ${account}\n\nIf you didn't create this account, delete it at that link.\n\n${config.name} · ${origin}`,
    frame(`<p style="margin:0 0 12px"><b>You created a ${esc(config.name)} parent account</b> with this email address.</p>
<p style="margin:0 0 12px">Add each child with a nickname. Their practice progress is saved to your account so you can follow it.</p>
<p style="margin:0 0 12px">You can delete a child's profile or your whole account at any time on <a href="${esc(account)}">your account page</a>.</p>
<p style="margin:0">If you didn't create this account, delete it at that link.</p>`, origin));
}
