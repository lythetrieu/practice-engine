/* The optional paid plan (pack.yaml `plan`, docs/payments.md): one plan per child, bought by the parent for
   plan.months months with one payment that never renews. Sold through Polar (polar.ts).
   - Off unless the pack has a `plan` block AND the POLAR_* settings are set (polarOn). Off means: no checkout, no
     price anywhere, no free limits, and the app behaves as it did before the plan existed.
   - A child has the plan while a paid purchase for that child (purchases.child_id) has not ended. A removed child's
     purchases keep its old id and give nothing.
   - Free limits (pack.yaml plan.limits) apply only while payments are on and the day is not before plan.freeUntil.
     The app counts them in the browser (src/practice/limits.ts): the questions are not secret, so they are honest
     product limits, not locks.
   - A child's screens never show a price (children's privacy rules): prices go to the parent only. */
import { config } from '../../pack';
import { bindings, now, type D1Database } from './env';

export const PLAN = config.plan ?? null;
/** The plan's name ("Pro" unless the pack names it). */
export const planName = PLAN?.name ?? 'Pro';
/** Where refund and support questions go. */
export const supportEmail = () => PLAN?.supportEmail || config.legal?.contactEmail || '';

/** Polar is set up on this server: the product and both secrets. */
export const polarOn = () => !!(PLAN && bindings.POLAR_PRODUCT_ID && bindings.POLAR_ACCESS_TOKEN && bindings.POLAR_WEBHOOK_SECRET);
/** The paid plan is on: the pack has one and Polar is set up. */
export const paymentsOn = polarOn;
/** Before plan.freeUntil (UTC day), nobody has free limits. */
export const freeNow = (at = new Date()) => !!PLAN?.freeUntil && at.toISOString().slice(0, 10) < PLAN.freeUntil;
/** The free limits apply now (payments on, not in the free period, and at least one limit set). */
export function limitsOn(at = new Date()): boolean {
  if (!paymentsOn() || freeNow(at) || !PLAN) return false;
  const l = PLAN.limits;
  return l.newLessonsPerDay != null || l.fullTests != null;
}

/** limitsOn, and Polar answers with a usable price: limits never apply while nobody could buy the plan (a wrong
    product id or token, or Polar down). The price is cached for 10 minutes (polar.ts offer). */
export async function limitsNow(): Promise<boolean> {
  if (!limitsOn()) return false;
  const { offer } = await import('./polar');
  return !!(await offer().catch(() => null));
}

/** When a plan bought at `at` ends: plan.months later, to the minute. */
export const planEnd = (at = new Date()) => { const d = new Date(at); d.setUTCMonth(d.getUTCMonth() + (PLAN?.months ?? 12)); return d.toISOString(); };

/** A date as "November 16, 2027" (UTC; a plan ends at a minute, so one minute back keeps the right day). */
export const longDate = (iso: string) => new Date(Date.parse(iso) - 60_000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** An amount in the smallest unit of a currency, as text: 4900 usd is "$49.00". */
export const money = (amount: number | null | undefined, currency: string | null | undefined) =>
  amount == null ? '' : new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(amount / 100);

export interface Plan { on: boolean; until: string | null }
const plan = (until: string | null | undefined): Plan => ({ on: !!until, until: until ?? null });

// A purchase gives a child the plan when it is paid, has not ended, belongs to the child's parent and names that child.
const ACTIVE_FOR = (user: string, child: string, at: string) => `status = 'paid' AND ends_at > ${at} AND user_id = ${user} AND child_id = ${child}`;

/** One child's plan. Before migration 0004 reaches a database there is no purchases table: no plan. */
export async function planOf(D: D1Database, userId: string, childId: string): Promise<Plan> {
  if (!PLAN) return plan(null);
  try {
    const r = await D.prepare(`SELECT MAX(ends_at) AS until FROM purchases WHERE ${ACTIVE_FOR('?1', '?2', '?3')}`).bind(userId, childId, now()).first<{ until: string | null }>();
    return plan(r?.until);
  } catch (e) {
    if (!/no such table/i.test(String(e))) throw e;
    return plan(null);
  }
}

export interface ChildPlan { plan: Plan; askedAt: string | null; askedKind: string | null }
/** Every child of the account (by id) with its plan and its last "Ask a parent for more". */
export async function familyPlans(D: D1Database, userId: string): Promise<Record<string, ChildPlan>> {
  if (!PLAN) return {};
  try {
    const { results } = await D.prepare(`SELECT c.id, c.plan_asked_at AS askedAt, c.plan_asked_kind AS askedKind,
        (SELECT MAX(ends_at) FROM purchases WHERE ${ACTIVE_FOR('c.user_id', 'c.id', '?2')}) AS until
      FROM children c WHERE c.user_id = ?1`).bind(userId, now()).all<{ id: string; askedAt: string | null; askedKind: string | null; until: string | null }>();
    return Object.fromEntries(results.map((r) => [r.id, { plan: plan(r.until), askedAt: r.askedAt, askedKind: r.askedKind }]));
  } catch (e) {
    if (!/no such (table|column)/i.test(String(e))) throw e;
    return {};   // before migration 0004
  }
}

/** Whether this parent has a Polar purchase, so "Receipts" has something to show. */
export async function hasPurchases(D: D1Database, userId: string): Promise<boolean> {
  if (!PLAN) return false;
  try { return !!(await D.prepare("SELECT 1 AS x FROM purchases WHERE user_id = ?1 AND provider = 'polar'").bind(userId).first()); }
  catch { return false; }
}

/** The site's address for links in emails: SITE_URL, else pack.yaml site.url, else the request's origin. */
export function siteUrl(origin = ''): string {
  const v = typeof bindings.SITE_URL === 'string' && /^https?:\/\//.test(bindings.SITE_URL) ? bindings.SITE_URL : config.site.url || origin;
  return (v || '').replace(/\/$/, '');
}
