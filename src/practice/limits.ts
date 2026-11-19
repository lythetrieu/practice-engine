// The free plan's limits in the practice app (pack.yaml plan.limits; docs/payments.md). They apply only while the
// server says so: payments on (a `plan` block and the POLAR_* settings), not before plan.freeUntil, and only to a
// learner without the plan. With payments off this file changes nothing: every check answers "no limit".
//   - New lessons: no limit in a learner's first plan.limits.freeDays days, then plan.limits.newLessonsPerDay a day.
//     Counted by map lesson (finished or tried for the first time today). Never capped: replaying a lesson, review,
//     unit checks, placement, resuming a lesson already started.
//   - Full tests: plan.limits.fullTests finished tests (Progress.fullTests, which follows the learner across devices).
// A child never sees a price or a buy button: at a limit they can "Ask a parent for more" (AskParent.tsx); a parent
// practicing as a child gets a link to the account page. Counted in the browser: the questions themselves are not
// secret, so these are honest product limits, not locks.
import { config } from '../pack';
import { addDays, daysBetween, today, type Progress } from './store';
import { LESSONS } from './curriculum';
import type { Me } from './ctx';

const L = config.plan?.limits;
const KEY = `pe.${config.id}.limits.v1`;
// The server's last answer (/api/me/ `limits`), kept so a family doesn't see a limit flash on or off while the answer
// is on its way, or offline.
let active = (() => { try { return !!config.plan && localStorage.getItem(KEY) === '1'; } catch { return false; } })();

/** Whether the free limits apply on this site now (the server decides; PracticeApp calls setLimits). */
export const limitsActive = () => active && !!L;
export function setLimits(v: boolean) {
  active = !!v && !!config.plan;
  try { if (active) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

/** The plan for whoever is practicing now: the signed-in student's own, or the picked child's. */
export function hasPlan(me: Me): boolean {
  if (me.role === 'student') return !!me.pro;
  if (me.role === 'parent' && me.as) return !!me.kids?.find((k) => k.id === me.as)?.pro;
  return false;
}

/** New map lessons started or finished for the first time today. */
export const newLessonsToday = (p: Progress, t = today()) =>
  Object.entries(p.lessons).filter(([id, l]) => LESSONS[id] && l.at === t).length
  + Object.entries(p.tried || {}).filter(([id, d]) => LESSONS[id] && d === t && !p.lessons[id]).length;

export type Cap = { kind: 'lesson'; perDay: number; resetsOn: string } | { kind: 'test'; used: number; allowed: number };

/** Why `lessonId` can't start now, or null. */
export function lessonCap(p: Progress, me: Me, lessonId: string, t = today()): Cap | null {
  if (!limitsActive() || !L || L.newLessonsPerDay == null || hasPlan(me)) return null;
  if (!LESSONS[lessonId] || p.lessons[lessonId] || p.tried?.[lessonId] || p.inProgress?.id === lessonId) return null;
  if (daysBetween(p.started, t) < (L.freeDays || 0) || newLessonsToday(p, t) < L.newLessonsPerDay) return null;
  return { kind: 'lesson', perDay: L.newLessonsPerDay, resetsOn: addDays(t, 1) };
}

/** Why a new full test can't start now, or null. A test already started can always be finished. */
export function testCap(p: Progress, me: Me): Cap | null {
  if (!limitsActive() || !L || L.fullTests == null || hasPlan(me)) return null;
  const used = p.fullTests || 0;
  return used < L.fullTests ? null : { kind: 'test', used, allowed: L.fullTests };
}
