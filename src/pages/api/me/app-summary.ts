import type { APIRoute } from 'astro';
import { bindings } from '../../../lib/server/env';
import { HttpError, json } from '../../../lib/server/http';
import { currentUser } from '../../../lib/server/auth';
import { childrenOf } from '../../../lib/server/account';
import { currentStudent } from '../../../lib/server/student';
import { cleanDay, summariesFor } from '../../../lib/server/appSummary';

export const prerender = false;

/** What the parent card and report show about practice in the app (lib/server/appSummary.ts). A parent gets every child
    of their own account (or one, with ?child=<id>; a child that is not theirs is a 404); a signed-in student gets only
    their own. ?today=YYYY-MM-DD is the browser's calendar day, which "this week" counts back from. */
export const GET: APIRoute = async ({ request, url }) => {
  try {
    const D = bindings.DB;
    if (!D) throw new HttpError(503, 'We could not reach our database. Please try again later.');
    const want = url.searchParams.get('child');
    let kids: { id: string; nickname: string; grade: number | null; learner: string }[];
    const student = await currentStudent(request);
    if (student && (!want || want === student.child_id)) {
      kids = [{ id: student.child_id, nickname: student.nickname, grade: student.grade ?? null, learner: student.learner }];
    } else {
      const user = await currentUser(request);
      if (!user) throw new HttpError(401, 'Please sign in again.');
      const all = await childrenOf(D, user.id);      // only this parent's children
      const mine = want ? all.filter((c) => c.id === want) : all;
      if (want && !mine.length) throw new HttpError(404, 'That child is not on your account.');
      kids = mine.map((c) => ({ id: c.id, nickname: c.nickname, grade: c.grade ?? null, learner: c.learner }));
    }
    const sums = await summariesFor(D, kids.map((k) => k.learner), cleanDay(url.searchParams.get('today')));
    return json({ ok: true, children: kids.map((k) => ({ id: k.id, nickname: k.nickname, grade: k.grade, summary: sums[k.learner] })) });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error('app-summary', e);
    return json({ ok: false, error: 'Something went wrong on our side. Please try again.' }, 500);
  }
};
