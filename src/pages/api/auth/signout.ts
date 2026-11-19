import { db } from '../../../lib/server/env';
import { postOnly, postRoute } from '../../../lib/server/http';
import { endSession, withCookies } from '../../../lib/server/auth';

export const prerender = false;

export const POST = postRoute(async ({ request }) => withCookies({ ok: true }, [await endSession(db(), request)]), { max: 256 });

export const ALL = postOnly;
