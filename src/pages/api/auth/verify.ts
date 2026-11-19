import { bindings, db } from '../../../lib/server/env';
import { postOnly, postRoute } from '../../../lib/server/http';
import { checkCode, normEmail, signIn, withCookies } from '../../../lib/server/auth';

export const prerender = false;

/** Step 2: the code. Signs in, or (a new email) asks the parent to confirm before the account is made. */
export const POST = postRoute(async ({ request, body }) => {
  const D = db(), email = normEmail(body.email);
  await checkCode(D, email, body.code);
  const { cookies, pending } = await signIn(D, request, email);
  return withCookies({ ok: true, pending }, cookies);
}, { max: 1024, limiter: () => bindings.AUTH_RL });

export const ALL = postOnly;
