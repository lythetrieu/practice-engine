import { db } from '../../../lib/server/env';
import { HttpError, postOnly, postRoute } from '../../../lib/server/http';
import { completeSignup, withCookies } from '../../../lib/server/auth';
import { sendWelcome } from '../../../lib/server/mail';

export const prerender = false;

/**
 * Makes the parent account once they confirm they are a parent or guardian, 18 or older.
 */
export const POST = postRoute(async ({ request, body, url }) => {
  if (body.parent !== true) throw new HttpError(400, 'Please confirm that you are a parent or guardian, 18 or older.');
  const { cookies, email } = await completeSignup(db(), request);
  // The welcome note tells the parent what is kept and how to delete it; the account works without it.
  await sendWelcome(email, url.origin).catch(() => {});
  return withCookies({ ok: true }, cookies);
}, { max: 1024 });

export const ALL = postOnly;
