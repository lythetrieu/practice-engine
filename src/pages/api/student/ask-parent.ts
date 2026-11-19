import { bindings, db, now } from '../../../lib/server/env';
import { HttpError, postOnly, postRoute } from '../../../lib/server/http';
import { currentStudent } from '../../../lib/server/student';
import { addUnderDailyCap } from '../../../lib/server/caps';
import { sendAskParent } from '../../../lib/server/mail';
import { limitsNow, planName, planOf } from '../../../lib/server/plan';

export const prerender = false;

/** A day between two emails for the same child; the whole site sends at most this many a day. */
const GAP_MS = 20 * 3600_000;
const SITE_DAILY = 500;

/**
 * "Ask a parent for more": a child signed in with their own login, at a free limit ({kind: lessons | tests}), asks
 * their parent. The parent gets one short email (no price) with a link to the account page, at most one a day per
 * child; the account page shows the note too (children.plan_asked_at). The child's screen never shows a price.
 * 409 when no limit applies to this child (payments off, the free period, or the child already has the plan): there
 * is nothing to ask for, and no email goes out. Answers {sent} or {already}.
 */
export const POST = postRoute(async ({ request, url, body }) => {
  const student = await currentStudent(request);
  if (!student) throw new HttpError(401, 'Please sign in again.');
  const kind = body.kind === 'tests' ? 'tests' : body.kind === 'lessons' ? 'lessons' : null;
  if (!kind) throw new HttpError(400, 'Unknown request.');
  const D = db(), at = now(), cut = new Date(Date.now() - GAP_MS).toISOString();
  if (!(await limitsNow()) || (await planOf(D, student.user_id, student.child_id)).on) throw new HttpError(409, 'You have no limit right now. Keep practicing!');
  const before = await D.prepare('SELECT c.plan_asked_at AS asked, c.plan_asked_kind AS kindWas, u.email FROM children c JOIN users u ON u.id = c.user_id WHERE c.id = ?1 AND c.user_id = ?2')
    .bind(student.child_id, student.user_id).first<{ asked: string | null; kindWas: string | null; email: string }>();
  if (!before) throw new HttpError(401, 'Please sign in again.');
  // One request a day wins the update; the others (a second tap, another tab) answer "already".
  const won = await D.prepare('UPDATE children SET plan_asked_at = ?3, plan_asked_kind = ?4 WHERE id = ?1 AND user_id = ?2 AND (plan_asked_at IS NULL OR plan_asked_at < ?5)')
    .bind(student.child_id, student.user_id, at, kind, cut).run();
  if (!won.meta.changes) return { already: true };
  const undo = () => D.prepare('UPDATE children SET plan_asked_at = ?3, plan_asked_kind = ?4 WHERE id = ?1 AND user_id = ?2 AND plan_asked_at = ?5')
    .bind(student.child_id, student.user_id, before.asked, before.kindWas, at).run();
  if (!(await addUnderDailyCap(D, 'ask_parent_mail', 1, SITE_DAILY, at))) { await undo(); throw new HttpError(429, 'Too many notes are being sent right now. Try again tomorrow.'); }
  try {
    await sendAskParent(before.email, student.nickname, kind, planName, url.origin);
  } catch (e) {
    await undo();
    console.error('ask-parent email', e instanceof HttpError ? e.status : e);
    throw new HttpError(502, 'We could not send the note right now. Try again later.');
  }
  return { sent: true };
}, { max: 256, limiter: () => bindings.STUDENT_RL });

export const ALL = postOnly;
