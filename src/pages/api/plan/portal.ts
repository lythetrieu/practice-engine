import { bindings, db } from '../../../lib/server/env';
import { HttpError, postOnly, postRoute } from '../../../lib/server/http';
import { requireFreshParent } from '../../../lib/server/auth';
import { paymentsOn } from '../../../lib/server/plan';
import { portalLink } from '../../../lib/server/polar';

export const prerender = false;

/** "Receipts and invoices": a one-time link to Polar's customer portal, where billing details can be changed, so it
    needs a recent sign-in like every account change (403 {reauth: true} otherwise). */
export const POST = postRoute(async ({ request, url }) => {
  if (!paymentsOn()) throw new HttpError(503, 'Payments are not set up on this site.');
  const user = await requireFreshParent(request);
  return { url: await portalLink(db(), user.id, url.origin) };
}, { max: 256, limiter: () => bindings.API_RL });

export const ALL = postOnly;
