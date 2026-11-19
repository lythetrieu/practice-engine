// What a finished round changes in the tutor, and what its result screen says. Called from
// store.finish for every round, so lessons, checks, practice and review all move the same beliefs and schedule.
import { LESSONS, WORLDS, LESSON_KEY_RE, type Subject } from '../curriculum';
import { rawBank } from '../levels/index';
import type { Progress, Finish } from '../store';
import { ancestors, prereqsOf } from './graph';
import {
  rawId, afterRound, rootGaps, addToPlan, settlePlan, logCheck, beliefs, mastery, stopOfKey, addTrait, addSeen,
  type Tutor, type Placement, type Mastery, type RoundKind, type Slip,
} from './model';
import { placementSubject, placementResult, skillStop, CHECK_RE } from './pick';

export interface StopScore { stop: string; right: number; total: number }
export interface TutorReport {
  kind: RoundKind;
  /** Right and total per skill, in the order first asked. */
  perStop: StopScore[];
  /** Unit check: the world's own skills, and the building blocks checked under weak ones. */
  world?: StopScore[]; probed?: StopScore[];
  /** Unit check: right and total on the world's own first questions, which decide the pass. */
  core?: { right: number; total: number };
  /** Skills added to the plan by this round, with the skill that led there. */
  added: { stop: string; from?: string }[];
  placement?: Placement & { subject: Subject };
  /** Skill check: the skill's label before and after, and the skill to revisit when it did not stick. */
  skill?: { stop: string; before: Mastery; after: Mastery; due: string | null; revisit: string | null };
  /** Practice: each skill's label after the set and its next review day. */
  practiced?: { stop: string; after: Mastery; due: string | null }[];
}

export function tutorAfter(p: Progress, f: Finish, day: string): { tutor: Tutor; report: TutorReport } {
  const kind = f.kind as RoundKind;
  const before = p.tutor;
  let t = afterRound(before, kind, f.answers, day);
  // every bank question answered here counts toward its 2 showings (teaching steps have no bank id: skipped)
  const bankIds = new Set(rawBank().items.map((x) => x.id));
  t = addSeen(t, f.answers.filter((a) => LESSON_KEY_RE.test(a.qid) && bankIds.has(rawId(a.qid))));
  const perStop: StopScore[] = [];
  for (const a of f.answers) {
    const s = stopOfKey(a.qid);
    if (!s) continue;
    let row = perStop.find((x) => x.stop === s);
    if (!row) perStop.push(row = { stop: s, right: 0, total: 0 });
    row.total++; if (a.correct) row.right++;
  }
  const report: TutorReport = { kind, perStop, added: [] };
  const k = beliefs(t);
  const right = f.answers.filter((a) => a.correct).length;

  const C = CHECK_RE.exec(f.id);
  if (kind === 'check' && C) {
    const subject = C[1] as Subject, w = +C[2];
    const own = WORLDS[subject][w - 1]?.lessons.map((l) => l.id) || [];
    report.world = perStop.filter((x) => own.includes(x.stop));
    const coreAns = f.core ? f.answers.filter((a) => f.core!.includes(a.qid)) : f.answers;
    report.core = { right: coreAns.filter((a) => a.correct).length, total: coreAns.length };
    report.probed = perStop.filter((x) => !own.includes(x.stop) && !!f.probes?.includes(x.stop));
    // Weak skills of the world, then the deepest missing building block under each (or the skill itself).
    const weak = own.filter((s) => (k[s] ?? 0.5) < 0.5);
    const gaps = rootGaps(k, weak);
    for (const g of gaps) report.added.push({ stop: g, from: weak.find((s) => s !== g && ancestors(s).includes(g)) });
    t = addToPlan(t, report.added.map((x) => ({ ...x, why: 'gap' as const })), day);
  }

  const ps = placementSubject(f.id);
  if (kind === 'placement' && ps) {
    const res = placementResult(ps, t, f.grade ?? p.grade);
    const pl: Placement = { at: day, start: res.start, known: res.known, gaps: res.gaps, asked: f.answers.length, right };
    t = { ...t, placement: { ...t.placement, [ps]: pl } };
    if (res.start) {
      const w = LESSONS[res.start].world;
      t = { ...t, opened: [...new Set([...t.opened, ...Array.from({ length: w }, (_, i) => `${ps}-${i + 1}`)])] };
      t = addToPlan(t, [{ stop: res.start, why: 'placement' }], day);
      report.added.push({ stop: res.start });
    }
    report.placement = { ...pl, subject: ps };
  }

  const ss = skillStop(f.id);
  if (kind === 'skill' && ss) {
    const total = f.answers.length;
    let revisit: string | null = null;
    if (total && right / total < 0.5) {
      // Did not stick: the weakest building block if one looks shaky, else the skill itself.
      const under = prereqsOf(ss).filter((s) => (k[s] ?? 0.5) < 0.6).sort((a, b) => (k[a] ?? 0.5) - (k[b] ?? 0.5));
      revisit = under[0] ?? ss;
      t = addToPlan(t, [{ stop: revisit, why: 'revisit', from: revisit === ss ? undefined : ss }], day);
      report.added.push({ stop: revisit, from: revisit === ss ? undefined : ss });
    }
    report.skill = { stop: ss, before: mastery(before.skills[ss]), after: mastery(t.skills[ss]), due: t.skills[ss]?.due ?? null, revisit };
  }

  if (kind === 'practice') report.practiced = perStop.map((x) => ({ stop: x.stop, after: mastery(t.skills[x.stop]), due: t.skills[x.stop]?.due ?? null }));

  if (kind === 'fix' && f.slips?.length) {
    const slips = { ...t.slips };
    for (const s of f.slips) slips[s as Slip] = (slips[s as Slip] || 0) + 1;
    t = { ...t, slips };
  }

  if (kind === 'skill' || kind === 'check' || kind === 'placement' || kind === 'practice') {
    t = logCheck(t, { kind, id: f.id, at: day, right, total: f.answers.length });
  }
  // Strengths: bouncing back (right straight after a miss), sticking with it (finished a round that had a miss),
  // curiosity ("Why?" opened after a right answer, counted by the player).
  if (kind !== 'placement') {
    let bounce = 0;
    for (let i = 1; i < f.answers.length; i++) if (!f.answers[i - 1].correct && f.answers[i].correct) bounce++;
    t = addTrait(t, day, { w: f.whys || 0, b: bounce, s: f.answers.some((a) => !a.correct) ? 1 : 0 });
  }
  t = settlePlan(t, (s) => p.lessons[s]?.last || p.lessons[s]?.at, day);
  return { tutor: t, report };
}
