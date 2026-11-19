/* The paid plan's three emails, to the parent's account email (never to a child):
   1. "<Plan> is on for <child>": when a purchase is first recorded as paid (the thank-you screen or the webhook,
      whichever comes first). Polar, the merchant of record, sends its own receipt; this one says what changed.
   2. "Your refund": when a purchase is first marked refunded. Polar sends the refund itself and its own note.
   3. "<Plan> for <child> ends on <date>": the plan never renews, so the parent hears ENDING_DAYS before it ends
      (the daily cron, src/worker.ts).
   Each goes out at most once per purchase: the purchase row is CLAIMED first (paid_mailed_at / refund_mailed_at /
   ending_mailed_at, migrations/0004_paid_plan.sql), then sent. A failed send is logged and never breaks the payment.
   Links point at SITE_URL (wrangler.jsonc var), else pack.yaml site.url (plan.ts siteUrl). */
import { config } from '../../pack';
import { bindings, now, type D1Database } from './env';
import { button, escapeHtml as esc, frame, send } from './mail';
import { PLAN, longDate, money, planName, siteUrl, supportEmail } from './plan';

const ENDING_DAYS = 14;
const dev = () => import.meta.env.DEV;

interface Row { id: string; email: string | null; nickname: string | null; username: string | null; until: string; amount: number | null; currency: string | null }

/** Claims one email for a purchase (the column must be NULL), returning what the email needs; null if already sent,
    not found, or the purchase has no parent any more. */
async function claim(D: D1Database, purchaseId: string, column: 'paid_mailed_at' | 'refund_mailed_at' | 'ending_mailed_at', status: 'paid' | 'refunded'): Promise<Row | null> {
  try {
    const won = await D.prepare(`UPDATE purchases SET ${column} = ?2 WHERE id = ?1 AND ${column} IS NULL AND status = ?3 AND user_id IS NOT NULL RETURNING id`)
      .bind(purchaseId, now(), status).first<{ id: string }>();
    if (!won) return null;
    return await D.prepare(`SELECT p.id, u.email, c.nickname, c.username, p.ends_at AS until, p.amount, p.currency
      FROM purchases p JOIN users u ON u.id = p.user_id LEFT JOIN children c ON c.id = p.child_id AND c.user_id = p.user_id WHERE p.id = ?1`)
      .bind(purchaseId).first<Row>();
  } catch (e) {
    console.error('plan mail claim', column, e);
    return null;
  }
}

const canSend = () => !!bindings.EMAIL || dev();
const kid = (n: string | null | undefined) => n || 'your child';
const Kid = (n: string | null | undefined) => n || 'Your child';
const help = () => (supportEmail() ? ` Write to ${supportEmail()} (or reply to this email).` : '');
const helpHtml = () => (supportEmail() ? ` Write to <a href="mailto:${esc(supportEmail())}">${esc(supportEmail())}</a>.` : '');

/** 1. "<Plan> is on" (once per purchase). */
export async function mailPaid(D: D1Database, purchaseId: string) {
  if (!canSend()) return;
  const r = await claim(D, purchaseId, 'paid_mailed_at', 'paid');
  if (!r?.email) return;
  const n = kid(r.nickname), N = Kid(r.nickname), paid = money(r.amount, r.currency), SITE = siteUrl();
  const how = r.username ? `${N} signs in with their own login (${r.username}), and ${planName} is already on there.` : `${planName} is already on for ${n}.`;
  const subject = `${planName} is on for ${N}. Thank you!`;
  const refund = PLAN && PLAN.refundDays > 0 ? `Need a refund? Within ${PLAN.refundDays} days, for any reason.${help()}` : `Questions?${help()}`;
  const text = [
    `Thank you for choosing ${config.name} ${planName}.`, '',
    `${planName} is on for ${N} until ${longDate(r.until)}.${paid ? ` You paid ${paid}, one payment.` : ''} It never renews: you will not be charged again unless you buy it again.`, '',
    how, ...(SITE ? [`Your account: ${SITE}/account/`] : []), '',
    `Polar, our merchant of record, emails your receipt. ${refund}`, '', `${config.name}${SITE ? ` · ${SITE}` : ''}`,
  ].join('\n');
  const html = frame(`<p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b726e">Thank you</p>
<p style="margin:0 0 14px;font-size:22px;font-weight:700">${esc(planName)} is on for ${esc(N)}</p>
<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:15px">
<tr><td style="padding:8px 0;color:#6b726e;border-bottom:1px solid #eee">Plan</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #eee"><b>${esc(planName)} · ${PLAN?.months ?? 12} months</b></td></tr>
<tr><td style="padding:8px 0;color:#6b726e;border-bottom:1px solid #eee">For</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #eee"><b>${esc(N)}</b></td></tr>
<tr><td style="padding:8px 0;color:#6b726e;border-bottom:1px solid #eee">Until</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #eee"><b>${esc(longDate(r.until))}</b></td></tr>
${paid ? `<tr><td style="padding:8px 0;color:#6b726e">Paid</td><td style="padding:8px 0;text-align:right"><b>${esc(paid)}</b>, one payment, never renews</td></tr>` : ''}
</table>
<p style="margin:0 0 14px">${esc(how)}</p>
${SITE ? button(`${SITE}/account/`, 'Open your account') : ''}
<p style="margin:0;font-size:13px;color:#6b726e">Polar, our merchant of record, emails your receipt. ${PLAN && PLAN.refundDays > 0 ? `Need a refund? Within ${PLAN.refundDays} days, for any reason.` : 'Questions?'}${helpHtml()}</p>`, SITE);
  try { await send(r.email, subject, text, html); } catch (e) { console.error('mail paid failed', purchaseId, e instanceof Error ? e.message : e); }
}

/** 2. "Your refund" (once per purchase). */
export async function mailRefund(D: D1Database, purchaseId: string) {
  if (!canSend()) return;
  const r = await claim(D, purchaseId, 'refund_mailed_at', 'refunded');
  if (!r?.email) return;
  const n = kid(r.nickname), N = Kid(r.nickname), paid = money(r.amount, r.currency), SITE = siteUrl();
  const subject = `Your refund for ${n}'s ${planName}`;
  const text = [
    `We refunded ${n}'s ${planName}${paid ? ` (${paid})` : ''}. Polar, our merchant of record, returns the money to the card you paid with and sends its own confirmation.`, '',
    `${planName} for ${n} has ended. ${N} keeps a free account: their progress stays.`, '',
    ...(SITE ? [`You can get ${planName} again any time on your account page: ${SITE}/account/`, ''] : []),
    `Questions?${help()}`, '', `${config.name}${SITE ? ` · ${SITE}` : ''}`,
  ].join('\n');
  const html = frame(`<p style="margin:0 0 14px;font-size:20px;font-weight:700">Your refund for ${esc(n)}’s ${esc(planName)}</p>
<p style="margin:0 0 12px">We refunded ${esc(n)}’s ${esc(planName)}${paid ? ` (<b>${esc(paid)}</b>)` : ''}. Polar, our merchant of record, returns the money to the card you paid with and sends its own confirmation.</p>
<p style="margin:0 0 12px">${esc(planName)} for ${esc(n)} has ended. ${esc(N)} keeps a free account: their progress stays.</p>
<p style="margin:0;font-size:13px;color:#6b726e">You can get ${esc(planName)} again any time on your account page.${helpHtml()}</p>`, SITE);
  try { await send(r.email, subject, text, html); } catch (e) { console.error('mail refund failed', purchaseId, e instanceof Error ? e.message : e); }
}

/** 3. Daily cron: a plan that ends within ENDING_DAYS and is the child's latest (a newer purchase means nothing ends). */
export async function runPlanEnding(D: D1Database, at = new Date()) {
  if (!PLAN || !bindings.EMAIL) return { sent: 0 };
  const nowIso = at.toISOString(), soon = new Date(at.getTime() + ENDING_DAYS * 864e5).toISOString();
  let rows: { id: string }[] = [];
  try {
    ({ results: rows } = await D.prepare(`SELECT p.id FROM purchases p
      WHERE p.status = 'paid' AND p.user_id IS NOT NULL AND p.ending_mailed_at IS NULL AND p.ends_at > ?1 AND p.ends_at <= ?2
        AND NOT EXISTS (SELECT 1 FROM purchases q WHERE q.user_id = p.user_id AND q.status = 'paid' AND q.child_id = p.child_id AND q.ends_at > p.ends_at)
      ORDER BY p.ends_at LIMIT 50`).bind(nowIso, soon).all<{ id: string }>());
  } catch (e) {
    if (!/no such table/i.test(String(e))) console.error('plan ending query', e);
    return { sent: 0 };
  }
  let sent = 0;
  const SITE = siteUrl();
  for (const { id } of rows) {
    const r = await claim(D, id, 'ending_mailed_at', 'paid');
    if (!r?.email) continue;
    const n = kid(r.nickname), N = Kid(r.nickname), when = longDate(r.until);
    const subject = `${N}'s ${planName} ends on ${when}`;
    const text = [
      `${N}'s ${config.name} ${planName} ends on ${when}. It never renews, so nothing will be charged.`, '',
      `After that, ${n} keeps a free account with their progress.`,
      ...(SITE ? [`Want more time? You can buy ${planName} again on your account page: ${SITE}/account/`] : []), '',
      `${config.name}${SITE ? ` · ${SITE}` : ''}`,
    ].join('\n');
    const html = frame(`<p style="margin:0 0 14px;font-size:20px;font-weight:700">${esc(N)}’s ${esc(planName)} ends on ${esc(when)}</p>
<p style="margin:0 0 12px">It never renews, so nothing will be charged. After that, ${esc(n)} keeps a free account with their progress.</p>
${SITE ? button(`${SITE}/account/`, `Get ${planName} again`) : ''}
<p style="margin:0;font-size:13px;color:#6b726e">You get this once, about two weeks before it ends.</p>`, SITE);
    try { await send(r.email, subject, text, html); sent++; } catch (e) { console.error('mail ending failed', id, e instanceof Error ? e.message : e); }
  }
  return { sent };
}
