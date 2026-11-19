/* Emails to parents through Cloudflare Email Service (the EMAIL send_email binding): the sign-in code, the welcome
   note sent when an account is made, a child's login made or changed, a password added or changed, a child's "Ask a
   parent for more", and the paid plan's emails (planMail.ts). Transactional only, never marketing. The sender is MAIL_FROM
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

export async function send(to: string, subject: string, text: string, html: string) {
  if (simulated()) { console.log(`[dev] email to ${maskEmail(to)}: ${subject}`); return; }
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

export const frame = (body: string, origin: string) => `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f4ef;font:16px/1.5 Arial,Helvetica,sans-serif;color:#1d2521">
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

/** A button in an email, in the pack's brand color. */
export const button = (href: string, label: string) =>
  `<p style="margin:0 0 16px"><a href="${esc(href)}" style="display:inline-block;background:${esc(config.brand.colors.primary)};color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">${esc(label)}</a></p>`;
export { esc as escapeHtml };

/** A child's own login was made or changed: the parent gets the username and where to make a new password, so a lost
    note never locks the child out. Never the password itself: it shows once on the parent's screen. Callers catch a
    failed send: it never blocks the change. */
export function sendChildLogin(to: string, nickname: string, username: string, kind: 'made' | 'reset' | 'changed', origin: string) {
  const account = `${origin}/account/`, signin = `${origin}/student/`;
  const head = kind === 'made' ? `${nickname}’s login is ready` : `${nickname} has a new password`;
  const why = kind === 'made' ? `You made a login for ${nickname} on ${config.name}.`
    : `The password for ${nickname}’s login was changed${kind === 'reset' ? ' (New password)' : ''}. Any device signed in with the old one is signed out.`;
  return send(to, kind === 'made' ? `${nickname}'s ${config.name} login` : `${nickname}'s password was changed`,
    [why, '', `Username: ${username}`, `Sign in at: ${signin}`, '',
      'For safety we never email the password. You saw it on your screen when you made it.',
      `Lost it? On your account page, press New password next to ${nickname}: ${account}`, '',
      'If you didn’t do this, sign in and make a new password.', '', `${config.name} · ${origin}`].join('\n'),
    frame(`<p style="margin:0 0 14px;font-size:20px;font-weight:700">${esc(head)}</p>
<p style="margin:0 0 12px">${esc(why)}</p>
<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:15px">
<tr><td style="padding:8px 0;color:#6b726e;border-bottom:1px solid #eee">Username</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #eee"><b>${esc(username)}</b></td></tr>
<tr><td style="padding:8px 0;color:#6b726e">Sign in at</td><td style="padding:8px 0;text-align:right"><a href="${esc(signin)}">${esc(signin.replace(/^https?:\/\//, ''))}</a></td></tr></table>
<p style="margin:0 0 12px">For safety we never email the password. You saw it on your screen when you made it.</p>
${button(account, 'Lost it? Make a new password')}
<p style="margin:0;font-size:13px;color:#6b726e">If you didn’t do this, sign in and make a new password.</p>`, origin));
}

/** A password was added to, or changed on, the parent account (parentPassword.ts). */
export function sendPasswordSet(to: string, changed: boolean, origin: string) {
  const what = changed ? 'Your password was changed' : 'You added a password';
  const line = changed
    ? `The password for your ${config.name} account was changed. Every other device signed in to your account was signed out.`
    : `You added a password to your ${config.name} account. You can now sign in with your email and this password, or with a code sent to your email as before.`;
  const account = `${origin}/account/`;
  return send(to, `${what} · ${config.name}`,
    [line, '', 'Forgot it later? Sign in with a code sent to your email, then make a new one on your account page.', account, '',
      'If this wasn’t you, sign in with a code sent to your email and change the password on your account page.', '', `${config.name} · ${origin}`].join('\n'),
    frame(`<p style="margin:0 0 14px;font-size:20px;font-weight:700">${esc(what)}</p>
<p style="margin:0 0 12px">${esc(line)}</p>
<p style="margin:0 0 12px">Forgot it later? Sign in with a code sent to your email, then make a new one on <a href="${esc(account)}">your account page</a>.</p>
<p style="margin:0;font-size:13px;color:#6b726e">If this wasn’t you, sign in with a code sent to your email and change the password on your account page.</p>`, origin));
}

/** "Ask a parent for more": the child at a free limit tapped the button (src/pages/api/student/ask-parent.ts). At most
    one a day per child. No price in it: the account page shows the plan. */
export function sendAskParent(to: string, nickname: string, kind: 'lessons' | 'tests', planName: string, origin: string) {
  const link = `${origin}/account/#plan`;
  const what = kind === 'tests' ? `${nickname} has used the free full practice tests` : `${nickname} finished today’s free new lessons`;
  return send(to, `${nickname} asked for more practice`,
    [`${what} on ${config.name} and tapped “Ask a parent for more.”`, '',
      `${planName} removes the free limits for ${nickname}. You can see ${nickname}’s progress and ${planName} on your account page:`, link, '',
      `Nothing changes unless you choose to. ${nickname} can keep reviewing mistakes and replaying lessons for free.`, '',
      `We send this at most once a day, only when ${nickname} taps the button.`, '', `${config.name} · ${origin}`].join('\n'),
    frame(`<p style="margin:0 0 12px"><b>${esc(what)}</b> on ${esc(config.name)} and tapped “Ask a parent for more.”</p>
<p style="margin:0 0 12px">${esc(planName)} removes the free limits for ${esc(nickname)}.</p>
${button(link, `See ${nickname}’s progress and ${planName}`)}
<p style="margin:0 0 12px">Nothing changes unless you choose to. ${esc(nickname)} can keep reviewing mistakes and replaying lessons for free.</p>
<p style="margin:0;font-size:13px;color:#6b726e">We send this at most once a day, only when ${esc(nickname)} taps the button.</p>`, origin));
}
