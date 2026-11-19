// #thanks: where Polar sends the parent after checkout (/app/?checkout=<id>#thanks, turned into #thanks by PracticeApp
// before anything else renders, so an unfinished onboarding or a slow /api/me/ never hides it; Polar's own back link
// /app/?back=1#thanks uses the checkout id this tab saved before leaving). It asks /api/plan/confirm/ (polar.ts
// confirmCheckout) and shows one of:
//   confirming  polling for a few seconds while Polar confirms the payment;
//   paid        a receipt-style summary: who has the plan, until when, what was paid, and the next steps;
//   processing  paid at Polar but not visible yet: the plan turns on within minutes, and we email the parent;
//   open/failed nothing was charged, with a way back;
//   refunded    paid, then refunded: the plan is off for that child;
//   error       the server's message (e.g. the child was removed meanwhile) and the support address.
// Parents only (the checkout belongs to the parent's account; PracticeApp never shows it to a student).
import './ThankYou.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../ctx';
import { config } from '../../pack';

export const CHECKOUT_KEY = `pe.${config.id}.checkout.v1`;
export const CHECKOUT_PENDING_KEY = `pe.${config.id}.checkout.pending.v1`;
type Kid = { id: string; nickname: string; login: boolean } | null;
type State =
  | { s: 'confirming' }
  | { s: 'paid'; until: string; amount: number | null; currency: string | null; child: Kid }
  | { s: 'processing'; child: Kid }
  | { s: 'open' | 'failed'; child: Kid }
  | { s: 'refunded'; child: Kid; amount: number | null; currency: string | null; until: string | null }
  | { s: 'error'; msg: string }
  | { s: 'none' };

const PLAN = config.plan;
const PLAN_NAME = PLAN?.name ?? 'Pro';
const SUPPORT = PLAN?.supportEmail || config.legal?.contactEmail || '';
const POLL_MS = 2000, POLL_FOR_MS = 30_000;
const name = (k: Kid) => k?.nickname || 'your child';
const Name = (k: Kid) => k?.nickname || 'Your child';
const money = (cents: number | null, cur: string | null) =>
  cents == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format(cents / 100);
/** "November 16, 2027": the plan ends at a minute in UTC; a minute back keeps the right day. */
const longDate = (iso: string) => new Date(Date.parse(iso) - 60_000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

async function post(path: string, body: unknown): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json().catch(() => ({ ok: false, error: 'Something went wrong. Try again.' }));
  } catch { return { ok: false, error: 'Could not reach the site. Check your connection and try again.' }; }
}

export default function ThankYou({ onPractice }: { onPractice: (childId: string) => void }) {
  const { me, sfx } = useApp();
  const [st, setSt] = useState<State>({ s: 'confirming' });
  const started = useRef(0);

  useEffect(() => {
    let id: string | null = null;
    try { id = sessionStorage.getItem(CHECKOUT_KEY); } catch { /* storage blocked */ }
    if (!id) { setSt({ s: 'none' }); return; }
    let live = true, timer = 0;
    started.current = Date.now();
    const done = () => { try { sessionStorage.removeItem(CHECKOUT_KEY); } catch { /* ignore */ } };
    const ask = async () => {
      const r = await post('/api/plan/confirm/', { checkout: id });
      if (!live) return;
      if (!r.ok) { setSt({ s: 'error', msg: r.error || 'We could not confirm your payment right now.' }); return; }
      const child = (r.child ?? null) as Kid;
      if (r.status === 'paid') {
        done();
        setSt({ s: 'paid', until: String(r.until), amount: typeof r.amount === 'number' ? r.amount : null, currency: r.currency ?? null, child });
        sfx('fanfare'); return;
      }
      if (r.status === 'open' || r.status === 'failed') { setSt({ s: r.status, child }); return; }
      if (r.status === 'refunded') {
        done();
        setSt({ s: 'refunded', child, amount: typeof r.amount === 'number' ? r.amount : null, currency: r.currency ?? null, until: r.on && r.until ? String(r.until) : null }); return;
      }
      // processing: ask again for a while, then say it will finish on its own
      if (Date.now() - started.current < POLL_FOR_MS) { timer = window.setTimeout(ask, POLL_MS); return; }
      setSt({ s: 'processing', child });
    };
    void ask();
    return () => { live = false; window.clearTimeout(timer); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const email = me.email || '';
  const help = SUPPORT ? <> Write to <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>.</> : null;
  const wait = (icon: string, title: string, body: ReactNode, acts: ReactNode, role: 'status' | 'alert' = 'status') => (
    <div className="pa-body ty">
      <section className="ty-card ty-wait" role={role}>
        {icon ? <span className="ty-dot" aria-hidden="true">{icon}</span> : null}
        <h1 className="ty-h">{title}</h1>
        <p className="ty-note">{body}</p>
        <div className="ty-acts">{acts}</div>
      </section>
    </div>
  );
  const account = <a className="pa-btn green press" href="/account/#plan">Back to your account</a>;

  if (st.s === 'confirming') return (
    <div className="pa-body ty">
      <section className="ty-card ty-wait" role="status" aria-live="polite">
        <span className="ty-spin" aria-hidden="true" />
        <h1 className="ty-h">Confirming your payment…</h1>
        <p className="ty-note">This takes a few seconds. Please keep this page open.</p>
      </section>
    </div>
  );

  if (st.s === 'paid') {
    const k = st.child, n = name(k), N = Name(k), paid = money(st.amount, st.currency);
    return (
      <div className="pa-body ty">
        <section className="ty-hero fx-fadeup" role="status" aria-live="polite">
          <svg className="ty-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24" /><path d="M15 27l7 7 15-16" /></svg>
          <p className="ty-eye">Thank you</p>
          <h1 className="ty-h">{PLAN_NAME} is on for {N}</h1>
          <p className="ty-sub">Everything is unlocked now. Nothing else to do.</p>
        </section>
        <section className="ty-card fx-fadeup" aria-label="Your order">
          <p className="ty-k">Your order</p>
          <dl className="ty-dl">
            <div><dt>Plan</dt><dd>{PLAN_NAME} · {PLAN?.months ?? 12} months</dd></div>
            <div><dt>For</dt><dd>{N}</dd></div>
            <div><dt>Until</dt><dd>{longDate(st.until)}</dd></div>
            {paid ? <div><dt>Paid</dt><dd>{paid} <span>one payment, never renews</span></dd></div> : null}
          </dl>
          <p className="ty-note">{email ? <>We emailed a confirmation to <b>{email}</b>. </> : null}Polar, our merchant of record, sends your receipt. Receipts and invoices are also on <a href="/account/#plan">your account page</a>.</p>
        </section>
        <section className="ty-card fx-fadeup" aria-label="What's next">
          <p className="ty-k">What’s next</p>
          <ol className="ty-next">
            <li><i aria-hidden="true">1</i><div><b>{k?.login ? `${N} signs in as usual` : `${N} can practice on this device`}</b><span>No free limits now, on every device.</span></div></li>
            <li><i aria-hidden="true">2</i><div><b>Follow {n}’s progress</b><span>The report on your account page shows what {n} practiced and what to work on.</span></div></li>
          </ol>
          <div className="ty-acts">
            {k ? <button type="button" className="pa-btn green press" onClick={() => { sfx('tap'); onPractice(k.id); }}>Practice as {N} here</button> : null}
            <a className="pa-btn ghost press" href="/account/" onClick={() => sfx('tap')}>Your account</a>
          </div>
        </section>
        {PLAN && PLAN.refundDays > 0 ? <p className="ty-fine">Changed your mind? Full refund within {PLAN.refundDays} days, for any reason.{help}</p> : null}
      </div>
    );
  }

  if (st.s === 'processing') return wait('⏳', 'Your payment is processing',
    <>{PLAN_NAME} turns on for {name(st.child)} within a few minutes, by itself. {email ? <>We’ll email <b>{email}</b> when it’s on.</> : 'We’ll email you when it’s on.'} You can close this page.</>, account);

  if (st.s === 'open' || st.s === 'failed') return wait('↩︎', st.s === 'failed' ? 'The payment didn’t go through' : 'No payment was made',
    <>Nothing was charged. {st.s === 'failed' ? 'The checkout expired or the card was declined.' : 'You left the checkout before paying.'} You can try again whenever you like.</>,
    <>{account}<a className="pa-btn ghost press" href="#home">Not now</a></>);

  if (st.s === 'refunded') {
    const back = money(st.amount, st.currency);
    return wait('↩︎', 'This payment was refunded',
      <>{back ? <>We refunded <b>{back}</b>. </> : 'We refunded this payment. '}Polar returns it to the card you paid with. {st.until ? <>{PLAN_NAME} for {name(st.child)} stays on until <b>{longDate(st.until)}</b> from another purchase.</> : <>{PLAN_NAME} for {name(st.child)} is off, and {name(st.child)}’s progress stays.</>}</>, account);
  }

  if (st.s === 'error') return wait('!', 'We couldn’t confirm this payment', <>{st.msg} If you were charged, we’ll sort it out.{help}</>, account, 'alert');

  return wait('', 'Nothing to confirm', <>Each child’s {PLAN_NAME} status is on your account page.</>, account);
}
