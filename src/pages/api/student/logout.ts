import { db } from '../../../lib/server/env';
import { postOnly, postRoute } from '../../../lib/server/http';
import { withCookies } from '../../../lib/server/auth';
import { studentLogout } from '../../../lib/server/student';

export const prerender = false;

export const POST = postRoute(async ({ request }) => withCookies({ ok: true }, [await studentLogout(db(), request)]), { max: 256 });

export const ALL = postOnly;
