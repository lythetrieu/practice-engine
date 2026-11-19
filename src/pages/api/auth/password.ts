import { bindings, db } from '../../../lib/server/env';
import { postOnly, postRoute } from '../../../lib/server/http';
import { clearCookie, STUDENT_COOKIE, withCookies } from '../../../lib/server/auth';
import { requireHuman } from '../../../lib/server/human';
import { passwordSignIn } from '../../../lib/server/parentPassword';

export const prerender = false;

/** Parent sign-in with email + password (parentPassword.ts), for an account that added a password on the account page.
    The same answer for an unknown email, no password and a wrong password. Signs a student out of this browser. */
export const POST = postRoute(async ({ request, body }) => {
  await requireHuman(request, 'signin', null);
  const cookie = await passwordSignIn(db(), request, body.email, body.password);
  return withCookies({ ok: true }, [cookie, clearCookie(STUDENT_COOKIE)]);
}, { max: 1024, limiter: () => bindings.AUTH_RL });

export const ALL = postOnly;
