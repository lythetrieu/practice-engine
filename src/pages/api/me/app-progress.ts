import type { APIRoute } from 'astro';
import { bindings, type D1Database } from '../../../lib/server/env';
import { HttpError, json, readBody, allowedOrigin, rateLimit } from '../../../lib/server/http';
import { currentUser } from '../../../lib/server/auth';
import { childOf } from '../../../lib/server/account';
import { currentStudent } from '../../../lib/server/student';

export const prerender = false;

// The practice app's progress (levels, stars, XP, mistakes, badges, finished full tests) saved to the child's
// profile, so it follows the child to every device. The browser copy stays the working copy (the app works
// offline); this is the account's copy. The child signed in as a student uses their own; a parent uses any
// child on the account (?child=<id>), as the "Who's practicing?" picker does.
const MAX = 512 * 1024;   // a year of daily practice is far below this

async function whose(D: D1Database, request: Request, want: string | null) {
  const student = await currentStudent(request);
  if (student && (!want || student.child_id === want)) return { owner: student.user_id, child: student.child_id, learner: student.learner };
  const user = await currentUser(request);
  if (!user) throw new HttpError(401, 'Please sign in again.');
  const c = await childOf(D, user.id, want);
  return { owner: user.id, child: c.id, learner: c.learner };
}

async function load(D: D1Database | undefined, request: Request, url: URL) {
  if (!D) throw new HttpError(503, 'We could not reach our database. Please try again later.');
  return whose(D, request, url.searchParams.get('child'));
}

const row = (D: D1Database, learner: string) =>
  D.prepare('SELECT data, rev, updated_at FROM app_progress WHERE learner_id = ?1').bind(learner)
    .first<{ data: string; rev: number; updated_at: string }>();

const out = (r: { data: string; rev: number; updated_at: string } | null) =>
  r ? { ok: true, data: JSON.parse(r.data), rev: r.rev, at: r.updated_at } : { ok: true, data: null, rev: 0, at: null };

const fail = (e: unknown) => {
  if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
  console.error('app-progress', e);
  return json({ ok: false, error: 'Something went wrong on our side. Please try again.' }, 500);
};

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const D = bindings.DB!;
    const who = await load(D, request, url);
    return json(out(await row(D, who.learner)));
  } catch (e) { return fail(e); }
};

/** Saves {data, base}: `base` is the rev the device last read. A newer rev on the server means another
    device saved in between: 409 with the server copy, and the app merges and saves again. */
export const PUT: APIRoute = async ({ request, url }) => {
  try {
    if (!allowedOrigin(request.headers.get('origin'), url)) throw new HttpError(403, 'Not allowed.');
    await rateLimit(bindings.API_RL, request);
    const D = bindings.DB!;
    const who = await load(D, request, url);
    const body = await readBody(request, MAX);
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new HttpError(400, 'Nothing to save.');
    const base = Number(body.base) || 0;
    const cur = await row(D, who.learner);
    if ((cur?.rev ?? 0) !== base) return json({ ...out(cur), ok: false, conflict: true }, 409);
    const at = new Date().toISOString(), data = JSON.stringify(body.data);
    const r = await D.prepare(`INSERT INTO app_progress (learner_id, data, rev, updated_at) VALUES (?1, ?2, 1, ?3)
      ON CONFLICT(learner_id) DO UPDATE SET data = excluded.data, rev = app_progress.rev + 1, updated_at = excluded.updated_at
      WHERE app_progress.rev = ?4`).bind(who.learner, data, at, base).run();
    if (!r.meta.changes) return json({ ...out(await row(D, who.learner)), ok: false, conflict: true }, 409);
    return json({ ok: true, rev: base + 1, at });
  } catch (e) { return fail(e); }
};
