import { bindings, db, now } from '../../../lib/server/env';
import { HttpError, postOnly, postRoute } from '../../../lib/server/http';
import { checkCode, freshUntil, issueCode, requireParent, startSession, withCookies } from '../../../lib/server/auth';
import { requireHuman } from '../../../lib/server/human';
import { sendCode } from '../../../lib/server/mail';

export const prerender = false;

/**
 * "Confirm it's you" before an account change (auth.ts REAUTH_MINUTES), for a parent already signed in.
 * - {step: "send"}: a 6-digit code to the email on the account, never an address from the request, with
 *   the same limits as sign-in codes (and the bot check, when it is on).
 * - {step: "verify", code}: the code starts a new session (a new cookie; this browser's old session row is
 *   deleted), which is fresh for REAUTH_MINUTES. Wrong codes get the same answers as at sign-in.
 */
export const POST = postRoute(async ({ request, body, url }) => {
  const D = db(), user = await requireParent(request);
  if (body.step === 'send') {
    await requireHuman(request, 'signin', null);
    const code = await issueCode(D, user.email);
    await sendCode(user.email, code, url.origin);
    // Local dev only (astro dev; false in every build): the email is only simulated, so the page shows the code.
    return import.meta.env.DEV ? { devCode: code } : {};
  }
  if (body.step === 'verify') {
    await checkCode(D, user.email, body.code);
    // Taken before the session row is written, so the page never counts on more time than the server gives.
    const until = freshUntil(now());
    return withCookies({ ok: true, freshUntil: until }, [await startSession(D, request, user.id)]);
  }
  throw new HttpError(400, 'Unknown step.');
}, { max: 1024, limiter: () => bindings.AUTH_RL });

export const ALL = postOnly;
