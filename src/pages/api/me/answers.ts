import type { APIRoute } from 'astro';
import { bindings, type D1Database, type D1PreparedStatement } from '../../../lib/server/env';
import { HttpError, json, readBody, allowedOrigin, rateLimit } from '../../../lib/server/http';
import { addUnderDailyCap } from '../../../lib/server/caps';
import { currentUser } from '../../../lib/server/auth';
import { childOf } from '../../../lib/server/account';
import { currentStudent } from '../../../lib/server/student';
import { SECTIONS } from '../../../pack';

export const prerender = false;

// The practice app's answer log (src/practice/answerlog.ts): one row per answer a signed-in learner gives, so a pack author
// can see which questions are too easy, too hard or never shown. Ids and numbers only; nothing a child types is
// stored (pick = the choice index, 0..5, on multiple choice). The child signed in as a student logs for themselves;
// a parent logs for one of their own children (?child=<id>), as the "Who's practicing?" picker does.
const MAX_BODY = 200 * 1024;
const MAX_ROWS = 200;
const CTX = new Set(['lesson', 'check', 'placement', 'skill', 'practice', 'fix', 'review', 'test']);
const ITEM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const FORM = /^[A-Za-z0-9._-]{1,40}$/;
const SID = /^[A-Za-z0-9._:-]{1,80}$/;
const DAY = 86400_000;
/** Rows a learner may log a day: about 6 full tests' worth (a heavy day of practice is a few hundred). */
const LEARNER_CAP = 600;
/** Rows the whole site may log a day (env ANSWERS_DAILY_CAP): each row is about 3 D1 row writes (the row and 2
    indexes), and the Free plan allows 100,000 writes a day for everything, so the default keeps well under that. */
const siteCap = () => { const n = Number(bindings.ANSWERS_DAILY_CAP); return Number.isInteger(n) && n > 0 ? n : 15000; };

async function whose(request: Request, want: string | null) {
  const student = await currentStudent(request);
  if (student && (!want || student.child_id === want)) return student.learner;
  const user = await currentUser(request);
  if (!user) throw new HttpError(401, 'Please sign in again.');
  return (await childOf(bindings.DB!, user.id, want)).learner;
}

const int = (v: unknown, min: number, max: number): number | null => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return null;
  return v;
};
/** The client's clock, kept only when it is within a month back and an hour ahead; otherwise the server's time. */
function when(v: unknown, nowMs: number): string {
  const t = typeof v === 'string' && v.length <= 40 ? Date.parse(v) : NaN;
  return new Date(Number.isFinite(t) && t > nowMs - 30 * DAY && t < nowMs + 3600_000 ? t : nowMs).toISOString();
}

/** {"<section id>": [right, total]} for the pack's sections only; anything else is dropped. */
function scoresOf(raw: unknown): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const sec of SECTIONS) {
    const v = (raw as Record<string, unknown>)[sec.id];
    const right = Array.isArray(v) ? int(v[0], 0, 999) : null, total = Array.isArray(v) ? int(v[1], 0, 999) : null;
    if (right != null && total != null) out[sec.id] = [right, total];
  }
  return out;
}

export const POST: APIRoute = async ({ request, url }) => {
  try {
    if (!allowedOrigin(request.headers.get('origin'), url)) throw new HttpError(403, 'Not allowed.');
    await rateLimit(bindings.API_RL, request);
    const D: D1Database | undefined = bindings.DB;
    if (!D) throw new HttpError(503, 'We could not reach our database. Please try again later.');
    const learner = await whose(request, url.searchParams.get('child'));
    const body = await readBody(request, MAX_BODY);
    const rows = body.rows === undefined ? [] : body.rows, sessions = body.sessions === undefined ? [] : body.sessions;
    if (!Array.isArray(rows) || !Array.isArray(sessions) || rows.length > MAX_ROWS || sessions.length > 20) throw new HttpError(400, 'Too many answers in one request.');
    const nowMs = Date.now();
    const st: D1PreparedStatement[] = [];
    for (const r of rows as Record<string, unknown>[]) {
      if (!r || typeof r !== 'object') continue;
      if (typeof r.id !== 'string' || !ITEM.test(r.id) || typeof r.ctx !== 'string' || !CTX.has(r.ctx)) continue;
      const c = r.c === 1 || r.c === true ? 1 : r.c === 0 || r.c === false ? 0 : null;
      if (c == null) continue;
      const form = typeof r.form === 'string' && FORM.test(r.form) ? r.form : null;
      st.push(D.prepare('INSERT INTO item_answers (learner_id, item_id, rev, ctx, form_id, correct, hints, ms, at, pick) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)')
        .bind(learner, r.id, int(r.rev, 1, 1e6), r.ctx, form, c, int(r.h, 0, 99) ?? 0, int(r.ms, 0, 36e5), when(r.at, nowMs), int(r.pick, 0, 5)));   // pick: the choice index on a multiple-choice question
    }
    for (const s of sessions as Record<string, unknown>[]) {
      if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !SID.test(s.id)) continue;
      const items = Array.isArray(s.items) ? (s.items as unknown[]).filter((x): x is string => typeof x === 'string' && ITEM.test(x)).slice(0, 400) : [];
      const kind = s.kind === 'generated' || s.kind === 'fixed' ? s.kind : null;
      const form = typeof s.form === 'string' && FORM.test(s.form) ? s.form : null;
      // Insert once per id: a retried upload is saved once. An id is only ever a session of one learner.
      st.push(D.prepare('INSERT OR IGNORE INTO test_sessions (id, learner_id, form_id, kind, items, started, finished, scores) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
        .bind(`${learner}:${s.id}`.slice(0, 120), learner, form, kind, JSON.stringify(items),
          typeof s.started === 'string' ? when(s.started, nowMs) : null, when(s.finished, nowMs), JSON.stringify(scoresOf(s.scores))));
    }
    // Daily caps per learner and for the whole site, counted in rows written, so a flood
    // can't use up D1's daily write quota (caps.ts). Over a cap the rows are dropped, not refused: the app's outbox
    // then lets them go instead of sending them again and again. A real student stays far under LEARNER_CAP.
    const day = new Date(nowMs).toISOString();
    if (st.length && !(await addUnderDailyCap(D, `answers_${learner}`, st.length, LEARNER_CAP, day))) return json({ ok: true, saved: 0, capped: 'learner' });
    if (st.length && !(await addUnderDailyCap(D, 'answers', st.length, siteCap(), day))) return json({ ok: true, saved: 0, capped: 'site' });
    if (st.length) await D.batch(st);
    return json({ ok: true, saved: st.length });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error('answers', e);
    return json({ ok: false, error: 'Something went wrong on our side. Please try again.' }, 500);
  }
};
