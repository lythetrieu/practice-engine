import type { APIRoute } from 'astro';
import { bindings } from '../../../lib/server/env';
import { json, readCapped } from '../../../lib/server/http';
import { paymentsOn } from '../../../lib/server/plan';
import { handleEvent, verifyWebhook } from '../../../lib/server/polar';

export const prerender = false;

/** Polar's webhooks (order.paid, order.refunded, order.updated): the plan for the child named in the order's
    metadata (polar.ts). Signed (Standard Webhooks), not same-origin; a 2xx tells Polar it arrived, a 5xx makes it retry.
    Set the endpoint in Polar to https://<your site>/api/plan/webhook/ (docs/payments.md). */
export const POST: APIRoute = async ({ request }) => {
  const D = bindings.DB;
  if (!D || !paymentsOn()) return json({ ok: false }, 503);
  const body = await readCapped(request, 256 * 1024);
  if (!body || !(await verifyWebhook(request.headers, body, bindings.POLAR_WEBHOOK_SECRET as string))) return json({ ok: false }, 403);
  let event: { type?: string; data?: never };
  try {
    event = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return json({ ok: false }, 400);
  }
  try {
    await handleEvent(D, request.headers.get('webhook-id') as string, event);
  } catch (e) {
    console.error('Polar webhook', event.type, e);
    return json({ ok: false }, 500);
  }
  return json({ ok: true }, 202);
};

export const ALL: APIRoute = async () => json({ ok: false, error: 'Method not allowed.' }, 405, { allow: 'POST' });
