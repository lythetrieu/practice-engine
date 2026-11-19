import { bindings, db } from '../../../lib/server/env';
import { HttpError, postOnly, postRoute } from '../../../lib/server/http';
import { requireParent } from '../../../lib/server/auth';
import { childOf } from '../../../lib/server/account';
import { longDate, paymentsOn, planName, planOf } from '../../../lib/server/plan';
import { createCheckout } from '../../../lib/server/polar';

export const prerender = false;

/**
 * "Get <plan> for <nickname>" on the account page: a Polar checkout for one child of the signed-in parent ({child}).
 * 503 when payments are off (no `plan` block in pack.yaml, or the POLAR_* settings missing). Refused when that child
 * already has the plan. An open checkout for the same child is reused (polar.ts createCheckout). Answers {url, checkout}.
 */
export const POST = postRoute(async ({ request, url, body }) => {
  if (!paymentsOn()) throw new HttpError(503, 'Payments are not set up on this site.');
  const user = await requireParent(request), D = db();
  const child = await childOf(D, user.id, body.child);
  const p = await planOf(D, user.id, child.id);
  if (p.on && p.until) throw new HttpError(400, `${child.nickname} already has ${planName} until ${longDate(p.until)}.`);
  const c = await createCheckout(user, child.id, request, url.origin);
  return { url: c.url, checkout: c.id };
}, { max: 256, limiter: () => bindings.API_RL });

export const ALL = postOnly;
