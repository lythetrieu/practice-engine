import { bindings, db } from '../../../lib/server/env';
import { postOnly, postRoute } from '../../../lib/server/http';
import { endSession, withCookies } from '../../../lib/server/auth';
import { studentLogin } from '../../../lib/server/student';

export const prerender = false;

/** "I'm a student": the username and password the parent gave. Signs any parent out of this browser. */
export const POST = postRoute(async ({ request, body }) => {
  const D = db();
  const { cookie, child } = await studentLogin(D, request, body.username, body.password);
  return withCookies({ ok: true, child }, [cookie, await endSession(D, request)]);
}, { max: 512, limiter: () => bindings.STUDENT_RL });

export const ALL = postOnly;
