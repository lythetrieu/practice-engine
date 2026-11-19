import { bindings, db } from '../../../lib/server/env';
import { HttpError, postOnly, postRoute } from '../../../lib/server/http';
import { requireParent } from '../../../lib/server/auth';
import { paymentsOn } from '../../../lib/server/plan';
import { confirmCheckout } from '../../../lib/server/polar';

export const prerender = false;

/** Back from Polar (the app's thank-you screen): where the checkout stands, and the plan now for the child it was for
    if the payment went through. Answers {status: paid | processing | open | failed | refunded, on, until?, amount?,
    currency?, child: {id, nickname, login} | null} (polar.ts confirmCheckout). Parents only. */
export const POST = postRoute(async ({ request, body }) => {
  if (!paymentsOn()) throw new HttpError(503, 'Payments are not set up on this site.');
  const user = await requireParent(request);
  return await confirmCheckout(db(), user.id, body.checkout);
}, { max: 512, limiter: () => bindings.API_RL });

export const ALL = postOnly;
