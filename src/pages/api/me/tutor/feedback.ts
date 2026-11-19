import type { APIRoute } from 'astro';
import { bindings, type D1Database } from '../../../../lib/server/env';
import { HttpError, json, readBody, allowedOrigin, rateLimit } from '../../../../lib/server/http';
import { currentUser } from '../../../../lib/server/auth';
import { childOf } from '../../../../lib/server/account';
import { currentStudent } from '../../../../lib/server/student';
import { ITEM_RE, dayOf, pipOn } from '../../../../lib/server/aitutor';

export const prerender = false;

// "Does that make sense?": the answer after the pack's explanation (about: 'exp') or after the tutor's reply (about: 'pip').
// POST /api/me/tutor/feedback/ { item, about: 'exp' | 'pip', ask?: number, sense: boolean }.
// Ids and a yes/no only. Same sign-in rules as the tutor (a student, or a parent for one of their children via ?child=<id>);
// only while the tutor is on (it is part of the add-on). At most 60 rows per learner per day.
// Answers { ok: true } or { ok: false, error }: 429 when the day's limit is reached.
const MAX_BODY = 2 * 1024;
export const FEEDBACK_DAILY = 60;

async function whose(D: D1Database, request: Request, want: string | null) {
  const student = await currentStudent(request);
  if (student && (!want || student.child_id === want)) return student.learner;
  const user = await currentUser(request);
  if (!user) throw new HttpError(401, 'Please sign in again.');
  return (await childOf(D, user.id, want)).learner;
}

export const POST: APIRoute = async ({ request, url }) => {
  try {
    if (!allowedOrigin(request.headers.get('origin'), url)) throw new HttpError(403, 'Not allowed.');
    await rateLimit(bindings.API_RL, request);
    if (!pipOn(bindings)) throw new HttpError(503, 'The tutor is not on.', { off: true });
    const D = bindings.DB;
    if (!D) throw new HttpError(503, 'We could not reach our database. Please try again later.');
    const learner = await whose(D, request, url.searchParams.get('child'));
    const body = await readBody(request, MAX_BODY);

    const item = typeof body.item === 'string' ? body.item : '';
    if (!ITEM_RE.test(item)) throw new HttpError(400, 'That question could not be read.');
    if (body.about !== 'exp' && body.about !== 'pip') throw new HttpError(400, 'That answer could not be read.');
    if (typeof body.sense !== 'boolean') throw new HttpError(400, 'That answer could not be read.');
    const day = dayOf();
    const n = await D.prepare('SELECT COUNT(*) AS n FROM tutor_feedback WHERE learner = ?1 AND day = ?2').bind(learner, day).first<{ n: number }>();
    if (Number(n?.n ?? 0) >= FEEDBACK_DAILY) throw new HttpError(429, 'Thank you! That is enough answers for today.');
    // The ask must be one of this learner's own; anything else is ignored (not an error).
    let ask: number | null = null;
    if (typeof body.ask === 'number' && Number.isInteger(body.ask) && body.ask > 0) {
      const row = await D.prepare('SELECT id FROM ai_tutor_log WHERE id = ?1 AND learner = ?2').bind(body.ask, learner).first<{ id: number }>();
      ask = row?.id ?? null;
    }
    await D.prepare('INSERT INTO tutor_feedback (learner, at, day, item, about, ask_id, sense) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(learner, new Date().toISOString(), day, item, body.about, body.about === 'pip' ? ask : null, body.sense ? 1 : 0).run();
    return json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message, ...e.extra }, e.status);
    console.error('tutor feedback', e instanceof Error ? e.message : 'failed');
    return json({ ok: false, error: 'Something went wrong on our side. Please try again.' }, 500);
  }
};
