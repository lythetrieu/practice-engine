import { bindings, db } from '../../../lib/server/env';
import { postOnly, postRoute } from '../../../lib/server/http';
import { issueCode, normEmail } from '../../../lib/server/auth';
import { requireHuman } from '../../../lib/server/human';
import { sendCode } from '../../../lib/server/mail';

export const prerender = false;

/**
 * Step 1 of email sign-in: a 6-digit code to the address (sign-in or sign-up; the answer is the same).
 * When the bot check is on (human.ts), every request needs its own Turnstile token for "signin";
 * without one it gets a 403 with {verify: site key} and nothing is sent.
 * Under `astro dev` no email is sent: the code is printed in the server console (mail.ts), and sent back
 * in the answer (devCode) so the page can fill it in.
 */
export const POST = postRoute(async ({ request, body, url }) => {
  const email = normEmail(body.email);
  await requireHuman(request, 'signin', null);
  const code = await issueCode(db(), email);
  await sendCode(email, code, url.origin);
  return import.meta.env.DEV ? { devCode: code } : {};
}, { max: 1024, limiter: () => bindings.AUTH_RL });

export const ALL = postOnly;
