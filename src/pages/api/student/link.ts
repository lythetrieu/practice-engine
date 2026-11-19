import { bindings, db } from '../../../lib/server/env';
import { postOnly, postRoute } from '../../../lib/server/http';
import { currentUser, endSession, withCookies } from '../../../lib/server/auth';
import { previewSignInLink, redeemSignInLink } from '../../../lib/server/student';

export const prerender = false;

/**
 * The child's phone opened a "Scan to sign in" link. The page first asks {t, preview: true}: the child's
 * nickname and whether a parent is signed in on this browser, so it can ask "Sign in as Mia?" and warn that
 * the parent will be signed out; nothing is used up (a link sent by another family must
 * not sign a browser in by itself). After the click, {t} signs it in once (and any parent out of it).
 */
export const POST = postRoute(async ({ request, body }) => {
  const D = db();
  if (body.preview === true) return { child: await previewSignInLink(D, body.t), parent: !!(await currentUser(request)) };
  const { cookie, child } = await redeemSignInLink(D, request, body.t);
  return withCookies({ ok: true, child }, [cookie, await endSession(D, request)]);
}, { max: 512, limiter: () => bindings.STUDENT_RL });

export const ALL = postOnly;
