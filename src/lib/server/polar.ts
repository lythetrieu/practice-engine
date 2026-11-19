/* The paid plan through Polar, the merchant of record (polar.sh: Polar sells to the parent, handles tax and receipts,
   and pays the site). Plain fetch, API version 2026-10. Polar rotates API versions quarterly and drops each about
   nine months later: move VERSION to a newer one before then (an unknown version answers 404).
   - Off unless pack.yaml has a `plan` block and POLAR_PRODUCT_ID (wrangler.jsonc var), the POLAR_ACCESS_TOKEN and
     POLAR_WEBHOOK_SECRET secrets are all set (plan.ts polarOn). POLAR_SERVER=sandbox uses Polar's test server.
   - One product: a one-time product with one fixed price. The price parents see is READ FROM POLAR (offer()), so the
     page always says what Polar charges; a product that is recurring, or has more or less than one fixed price, keeps
     checkout closed (logged).
   - Checkout: a hosted Polar page for one child, the parent's email, our user id as the external customer id, and
     our user id and child id in metadata. Polar copies metadata to the order, and the buyer cannot change it from the
     browser, so the metadata is ours. The open page for a child is reused (plan_checkouts), so a double click or two
     tabs cannot pay twice.
   - The plan is given by the order.paid webhook, or by the thank-you screen if the webhook is late; both key on the
     order id, so a payment counts once, for the child in its metadata. A full refund ends it (order.refunded, or an
     order.updated that says refunded), and a refunded order stays refunded even if its order.paid arrives later.
     Polar documents no dispute event: ask Polar what a lost chargeback sends.
   - After paying, Polar sends the parent to success_url (/app/?checkout={CHECKOUT_ID}#thanks); its own back link goes
     to return_url (/app/?back=1#thanks), where the app uses the checkout id this tab saved before leaving.
   Read Polar's Acceptable Use Policy before you sell: it has rules about services for minors. Checkout here is for
   parents only, and a child's screen never shows a price. */
import { bindings, now, type D1Database } from './env';
import { HttpError } from './http';
import { planEnd, polarOn } from './plan';
import { mailPaid, mailRefund } from './planMail';

const VERSION = '2026-10';
const ourProduct = (id: unknown) => typeof id === 'string' && !!id && id === bindings.POLAR_PRODUCT_ID;
const base = () => (bindings.POLAR_SERVER === 'sandbox' ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh');

async function polar<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(base() + path, {
    ...init,
    headers: { authorization: `Bearer ${bindings.POLAR_ACCESS_TOKEN}`, 'polar-version': VERSION, accept: 'application/json', 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error('Polar API', res.status, path, (await res.text()).slice(0, 300));
    throw new HttpError(502, 'The payment service did not answer. Please try again in a minute.');
  }
  return res.json() as Promise<T>;
}

interface Order {
  id: string; status: string; paid?: boolean; billing_reason?: string; product_id: string | null; checkout_id?: string | null;
  created_at: string; total_amount?: number; net_amount?: number; currency?: string; customer_id?: string;
  metadata?: Record<string, unknown>; customer?: { email?: string | null; external_id?: string | null };
}

// ---------------------------------------------------------------- the price, read from Polar

interface Price { amount_type?: string; price_amount?: number; price_currency?: string; is_archived?: boolean }
interface Product { id: string; is_recurring?: boolean; is_archived?: boolean; prices?: Price[] }
/** What the plan costs, as Polar charges it: the amount in the currency's smallest unit (cents), and the currency. */
export interface Offer { amount: number; currency: string }

/** The one fixed price of a one-time product, or null when the product is not set up that way. */
function onePrice(p: Product | null): Offer | null {
  if (!p || p.is_recurring || p.is_archived) return null;
  const live = (p.prices || []).filter((x) => !x.is_archived);
  const x = live.length === 1 ? live[0] : null;
  return x && x.amount_type === 'fixed' && Number.isInteger(x.price_amount) && x.price_amount! > 0
    ? { amount: x.price_amount!, currency: (x.price_currency || 'usd').toLowerCase() } : null;
}

let offerCache: { at: number; key: string; offer: Offer | null } | null = null;
const OFFER_MS = 10 * 60_000;
/**
 * The plan's price as Polar will charge it, cached for 10 minutes in this isolate. null when payments are off, or
 * when the product is not a one-time product with one fixed price (logged): checkout then stays closed instead of
 * showing a price that differs from Polar's.
 */
export async function offer(): Promise<Offer | null> {
  if (!polarOn()) return null;
  const key = [bindings.POLAR_SERVER, bindings.POLAR_PRODUCT_ID].join('|');
  if (offerCache && offerCache.key === key && Date.now() - offerCache.at < OFFER_MS) return offerCache.offer;
  const product = await polar<Product>(`/v1/products/${encodeURIComponent(bindings.POLAR_PRODUCT_ID as string)}`).catch(() => null);
  const o = onePrice(product);
  if (!o) console.error('POLAR_PRODUCT_ID is not a one-time product with one fixed price (or Polar did not answer); checkout stays closed');
  // a failed read is kept for one minute only, so a short Polar outage does not close checkout for ten
  offerCache = { at: o ? Date.now() : Date.now() - OFFER_MS + 60_000, key, offer: o };
  return o;
}

// ---------------------------------------------------------------- checkout

/** A hosted checkout for one child's plan; returns the page to send the parent to. An open checkout for the same
    child is reused while it has 10 minutes left. */
export async function createCheckout(user: { id: string; email: string }, childId: string, request: Request, origin: string): Promise<{ id: string; url: string }> {
  if (!polarOn()) throw new HttpError(503, 'Payments are not set up on this site.');
  if (!(await offer())) throw new HttpError(503, 'Checkout is not available right now. Please try again later.');
  const D = bindings.DB as D1Database;
  const soon = new Date(Date.now() + 10 * 60_000).toISOString();
  const open = await D.prepare('SELECT id, url FROM plan_checkouts WHERE user_id = ?1 AND child_id = ?2 AND expires_at > ?3 ORDER BY created_at DESC LIMIT 1')
    .bind(user.id, childId, soon).first<{ id: string; url: string }>();
  if (open) return { id: open.id, url: open.url };
  const ip = request.headers.get('cf-connecting-ip');
  const c = await polar<{ id: string; url: string; expires_at?: string }>('/v1/checkouts/', {
    method: 'POST',
    body: JSON.stringify({
      products: [bindings.POLAR_PRODUCT_ID],
      external_customer_id: user.id,
      customer_email: user.email,
      ...(ip ? { customer_ip_address: ip } : {}),
      metadata: { user_id: user.id, child_id: childId, plan: 'plan' },
      allow_discount_codes: false,
      // back into the app's thank-you screen (src/practice/screens/ThankYou.tsx): paid, with the id; or Polar's back
      // link, where the app uses the checkout id this tab saved before leaving.
      success_url: `${origin}/app/?checkout={CHECKOUT_ID}#thanks`,
      return_url: `${origin}/app/?back=1#thanks`,
    }),
  });
  if (!c || typeof c.id !== 'string' || typeof c.url !== 'string' || !/^https:\/\//.test(c.url)) throw new HttpError(502, 'The payment service did not answer. Please try again in a minute.');
  const expires = c.expires_at && Number.isFinite(Date.parse(c.expires_at)) ? new Date(c.expires_at).toISOString() : new Date(Date.now() + 3600_000).toISOString();
  await D.prepare('INSERT OR IGNORE INTO plan_checkouts (id, user_id, child_id, url, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(c.id, user.id, childId, c.url, now(), expires).run();
  return { id: c.id, url: c.url };
}

/** The parent an order belongs to (our user id in its metadata), or null if unknown. */
async function orderUser(D: D1Database, o: Order): Promise<{ id: string } | null> {
  const userId = typeof o.metadata?.user_id === 'string' ? o.metadata.user_id : null;
  return userId ? await D.prepare('SELECT id FROM users WHERE id = ?1').bind(userId).first<{ id: string }>() : null;
}

/** The child an order or checkout is for (our child id in its metadata), or null. */
const metaChild = (m: Record<string, unknown> | undefined): string | null =>
  typeof m?.child_id === 'string' && m.child_id && m.child_id.length <= 40 ? m.child_id : null;

/**
 * Records a paid order (idempotent on the order id), for the child in its metadata, which is kept even if that child
 * was removed meanwhile (it then gives nothing). Returns when the plan ends and for which child, or null if the order
 * was refunded or is not for our product.
 */
async function grant(D: D1Database, o: Order): Promise<{ until: string; child: string | null } | null> {
  if (!ourProduct(o.product_id) || o.status !== 'paid' || (o.billing_reason && o.billing_reason !== 'purchase')) return null;
  const user = await orderUser(D, o), child = metaChild(o.metadata);
  if (!child) { console.error('Polar order without a child in its metadata; not recorded', o.id); return null; }
  // The order's customer should be the parent we opened the checkout for (external_customer_id = our user id). Polar
  // reuses an existing customer with the same email and keeps that customer's external id (null, or another app's id
  // when one Polar organization serves several sites). So a checkout WE opened for this parent and child
  // (plan_checkouts) is the proof; the external id only decides when there is no such checkout.
  const ext = o.customer?.external_id;
  const ours = o.checkout_id
    ? await D.prepare('SELECT user_id, child_id FROM plan_checkouts WHERE id = ?1').bind(o.checkout_id).first<{ user_id: string; child_id: string }>()
    : null;
  const fromOurCheckout = !!user && !!ours && ours.user_id === user.id && ours.child_id === child;
  if (user && ext && ext !== user.id && !fromOurCheckout) { console.error('Polar order whose customer is another user', o.id); return null; }
  const until = planEnd(new Date(o.created_at)), at = now();
  // A row already marked refunded stays refunded (see refund()), so a late order.paid gives nothing.
  const row = await D.prepare(`INSERT INTO purchases (id, user_id, child_id, provider, status, amount, currency, email, checkout_id, customer_ref, ends_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, 'polar', 'paid', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
    ON CONFLICT(id) DO UPDATE SET status = CASE WHEN purchases.status = 'refunded' THEN purchases.status ELSE 'paid' END, updated_at = excluded.updated_at
    RETURNING status, child_id`)
    .bind(o.id, user?.id ?? null, child, o.total_amount ?? o.net_amount ?? null, o.currency ?? null, user ? o.customer?.email ?? null : null,
      o.checkout_id ?? null, o.customer_id ?? null, until, at)
    .first<{ status: string; child_id: string | null }>();
  if (!user) console.error('Polar order without a known user (no email kept)', o.id);
  if (row?.status !== 'paid') return null;
  await mailPaid(D, o.id);   // "<plan> is on", once per purchase (planMail.ts)
  return { until, child: row.child_id };
}

/**
 * Ends the plan for a fully refunded order. If its order.paid was never recorded (it failed and Polar will retry it),
 * the row is written now, already refunded, so that retry cannot give the plan for money that went back. Orders for
 * another product are only updated, never added.
 */
async function refund(D: D1Database, o: Order) {
  const at = now();
  if (!ourProduct(o.product_id)) {
    await D.prepare("UPDATE purchases SET status = 'refunded', updated_at = ?2 WHERE id = ?1").bind(o.id, at).run();
    return;
  }
  const user = await orderUser(D, o);
  const created = o.created_at && Number.isFinite(Date.parse(o.created_at)) ? new Date(o.created_at) : new Date();
  await D.prepare(`INSERT INTO purchases (id, user_id, child_id, provider, status, amount, currency, email, checkout_id, customer_ref, ends_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, 'polar', 'refunded', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
    ON CONFLICT(id) DO UPDATE SET status = 'refunded', updated_at = excluded.updated_at`)
    .bind(o.id, user?.id ?? null, metaChild(o.metadata), o.total_amount ?? o.net_amount ?? null, o.currency ?? null, user ? o.customer?.email ?? null : null,
      o.checkout_id ?? null, o.customer_id ?? null, planEnd(created), at).run();
  await mailRefund(D, o.id);   // "Your refund", once per purchase (planMail.ts)
}

/** The plan from another paid purchase for this child, after one was refunded. */
async function stillOn(D: D1Database, userId: string, childId: string | null): Promise<{ on: boolean; until?: string }> {
  const r = await D.prepare("SELECT MAX(ends_at) AS until FROM purchases WHERE user_id = ?1 AND status = 'paid' AND child_id = ?2 AND ends_at > ?3")
    .bind(userId, childId, now()).first<{ until: string | null }>();
  return r?.until ? { on: true, until: r.until } : { on: false };
}

/**
 * The thank-you screen (src/practice/screens/ThankYou.tsx), back from Polar: where this parent's checkout stands, and
 * the plan now if it is paid, without waiting for the webhook. `status`:
 *   paid        the order is paid and recorded: the plan is on for `child` until `until` (amount in cents).
 *   processing  Polar is still confirming the payment (or the order is not visible yet): ask again shortly.
 *   open        nothing was paid (the parent left Polar's page, or it is still open there).
 *   failed      the payment failed or the checkout expired: nothing was charged.
 *   refunded    it was paid, then refunded: the plan is off for that child (unless another purchase covers it).
 * A paid checkout for a child removed meanwhile is recorded and answers 409. Only checkouts this parent opened here
 * (plan_checkouts) are looked up, so a made-up id costs no Polar request.
 */
export type CheckoutStatus = 'paid' | 'processing' | 'open' | 'failed' | 'refunded';
export async function confirmCheckout(D: D1Database, userId: string, checkoutId: unknown): Promise<{
  status: CheckoutStatus; on: boolean; until?: string; amount?: number | null; currency?: string | null;
  child: { id: string; nickname: string; login: boolean } | null;
}> {
  if (!polarOn()) throw new HttpError(503, 'Payments are not set up on this site.');
  if (typeof checkoutId !== 'string' || !/^[0-9a-f-]{36}$/i.test(checkoutId)) throw new HttpError(400, 'Unknown checkout.');
  if (!(await D.prepare('SELECT 1 AS x FROM plan_checkouts WHERE id = ?1 AND user_id = ?2').bind(checkoutId, userId).first())) throw new HttpError(404, 'Unknown checkout.');
  const c = await polar<{ status: string; product_id: string; metadata?: Record<string, unknown> }>(`/v1/checkouts/${checkoutId}`);
  if (c.metadata?.user_id !== userId || !ourProduct(c.product_id)) throw new HttpError(403, 'That checkout belongs to another account.');
  const childId = metaChild(c.metadata);
  const k = childId
    ? await D.prepare('SELECT id, nickname, username FROM children WHERE id = ?1 AND user_id = ?2').bind(childId, userId).first<{ id: string; nickname: string; username: string | null }>()
    : null;
  const child = k ? { id: k.id, nickname: k.nickname, login: !!k.username } : null;
  // Already recorded (the webhook came first): answer from our own row, no more Polar calls.
  const mine = await D.prepare("SELECT status, ends_at AS until, amount, currency FROM purchases WHERE checkout_id = ?1 AND user_id = ?2 AND provider = 'polar' ORDER BY created_at DESC LIMIT 1")
    .bind(checkoutId, userId).first<{ status: string; until: string; amount: number | null; currency: string | null }>();
  if (mine?.status === 'paid') return { status: 'paid', on: true, until: mine.until, amount: mine.amount, currency: mine.currency, child };
  if (mine?.status === 'refunded') return { status: 'refunded', ...(await stillOn(D, userId, childId)), amount: mine.amount, currency: mine.currency, child };
  if (c.status === 'open') return { status: 'open', on: false, child };
  if (c.status === 'expired' || c.status === 'failed') return { status: 'failed', on: false, child };
  if (c.status !== 'succeeded') return { status: 'processing', on: false, child };   // confirmed: the payment is on its way
  const list = await polar<{ items: Order[] }>(`/v1/orders/?checkout_id=${encodeURIComponent(checkoutId)}`);
  // Only an order of this checkout, for this parent and child: never trust the list filter alone.
  const ours = list.items.filter((x) => x.checkout_id === checkoutId && x.metadata?.user_id === userId && metaChild(x.metadata) === childId);
  const o = ours.find((x) => x.status === 'paid' && x.paid !== false);
  if (!o && ours.some((x) => x.status === 'refunded')) return { status: 'refunded', ...(await stillOn(D, userId, childId)), child };
  if (!o) return { status: 'processing', on: false, child };
  const g = await grant(D, o);
  // Paid, but the child was removed while the parent was at Polar: recorded, and it gives the plan to no one.
  if (g && childId && !child) throw new HttpError(409, 'That child is no longer on your account, so this payment did not turn the plan on. Write to us and we will refund it.');
  return g ? { status: 'paid', on: true, until: g.until, amount: o.total_amount ?? o.net_amount ?? null, currency: o.currency ?? null, child } : { status: 'processing', on: false, child };
}

/** A link to Polar's customer portal (receipts and invoices) for this parent's purchases. */
export async function portalLink(D: D1Database, userId: string, origin: string): Promise<string> {
  if (!polarOn()) throw new HttpError(503, 'Payments are not set up on this site.');
  const p = await D.prepare("SELECT customer_ref FROM purchases WHERE user_id = ?1 AND provider = 'polar' ORDER BY customer_ref IS NULL, created_at DESC LIMIT 1")
    .bind(userId).first<{ customer_ref: string | null }>();
  if (!p) throw new HttpError(404, 'No purchases to show.');
  // The Polar customer id recorded with the order: Polar may have reused a customer that lacks our external id
  // (grant()), so the external id is only the fallback.
  const who = p.customer_ref ? { customer_id: p.customer_ref } : { external_customer_id: userId };
  const s = await polar<{ customer_portal_url: string }>('/v1/customer-sessions/', { method: 'POST', body: JSON.stringify({ ...who, return_url: `${origin}/account/` }) });
  return s.customer_portal_url;
}

// ---------------------------------------------------------------- webhooks

const b64 = (s: string) => { try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch { return null; } };

/**
 * Checks a webhook's signature (Standard Webhooks: HMAC-SHA256 over "id.timestamp.body", within 5 minutes). The key
 * is the base64 part of a whsec_ secret, or, for older secrets and `polar listen`, the secret's own bytes; both are
 * tried, as Polar's SDK does.
 */
export async function verifyWebhook(headers: Headers, body: Uint8Array, secret: string): Promise<boolean> {
  const id = headers.get('webhook-id'), ts = headers.get('webhook-timestamp'), sigs = headers.get('webhook-signature');
  if (!secret || !id || !ts || !sigs || !/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const prefix = new TextEncoder().encode(`${id}.${ts}.`), signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);
  const raw = [new TextEncoder().encode(secret), b64(secret.startsWith('whsec_') ? secret.slice(6) : secret)].filter((k): k is Uint8Array<ArrayBuffer> => !!k && k.length > 0);
  const keys = await Promise.all(raw.map((k) => crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])));
  for (const part of sigs.split(' ')) {
    const [v, sig] = part.split(',', 2), bytes = v === 'v1' && sig ? b64(sig) : null;
    if (!bytes) continue;
    for (const k of keys) if (await crypto.subtle.verify('HMAC', k, bytes, signed)) return true;
  }
  return false;
}

/** A verified event: gives the plan on order.paid (to the child in the order's metadata), ends it on a full refund
    (order.refunded or order.updated). Other events are acknowledged and ignored. Redeliveries are skipped. */
export async function handleEvent(D: D1Database, webhookId: string, event: { type?: string; data?: Order }) {
  if (await D.prepare('SELECT 1 AS x FROM webhook_events WHERE id = ?1').bind(webhookId).first()) return;
  const o = event.data;
  if (event.type === 'order.paid' && o) await grant(D, o);
  // A full refund ends the plan, whichever event says so first. A partial refund leaves it on.
  else if ((event.type === 'order.refunded' || event.type === 'order.updated') && o?.status === 'refunded') await refund(D, o);
  await D.prepare('INSERT OR IGNORE INTO webhook_events (id, type, received_at) VALUES (?1, ?2, ?3)').bind(webhookId, String(event.type ?? ''), now()).run();
}
