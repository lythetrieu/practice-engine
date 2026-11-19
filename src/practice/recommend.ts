// Recommended practice: the map lesson a weak skill points at, and when a recommendation may open it.
// A weak skill from a full test ("Practice next" on the results, Progress) opens that lesson at once (#play/<id>),
// even when the map has not reached it yet; the lesson still counts as usual. Without a recommendation behind it, a
// lesson the map has not reached stays locked (no skipping ahead by a typed link).
import { LESSONS } from './curriculum';
import { lessonState, type Progress } from './store';
import { weakest, lessonsFor } from './exam/results';
import { skillName } from '../pack';

/** Every lesson that teaches a skill, in map order. */
export const stopsFor = (skill: string): string[] => lessonsFor(skill);
/** The skill's name for students (the pack's skills.yaml name). */
export const codeName = (skill: string): string | null => skillName(skill);
export const canonCode = (skill: string) => skill;

/** True when a finished full test names this lesson as one to practice. */
export function isRecommended(stop: string, p?: Progress): boolean {
  return !!p && p.tests.some((rec) => weakest(rec, 999).some((w) => lessonsFor(w.skill).includes(stop)));
}

/** May this lesson be played now? Anything the map has reached, or a lesson a test result recommends. */
export function canPlay(p: Progress, stop: string): boolean {
  const l = LESSONS[stop];
  if (!l) return false;
  // (a lesson on the tutor's plan, added by a check or the placement, opens too)
  return lessonState(p, l) !== 'locked' || isRecommended(stop, p) || p.tutor.plan.some((x) => x.stop === stop && !x.done);
}

/** The best lesson for a skill: one a test recommends, else one open on the map. `taken` skips lessons other rows use. */
export function pickStop(p: Progress, skill: string, taken: Set<string> = new Set()): string | null {
  const all = stopsFor(skill);
  if (!all.length) return null;
  const free = all.filter((s) => !taken.has(s));
  const list = free.length ? free : all;
  return list.find((s) => isRecommended(s, p)) ?? list.find((s) => canPlay(p, s)) ?? null;
}
