// A finished full test: its record (saved in progress, synced, read by the parent report), its score estimate from
// the pack's scoring rules, the weakest skills, and what it adds to progress (missed questions go to Review).
import { config, skillName } from '../../pack';
import { estimate, headline, type Estimate } from '../../pack/scoring';
import { grade, type Ans } from '../levels/grade';
import { stepById } from '../levels/index';
import { LESSONS } from '../curriculum';
import type { ExamPlan } from './build';
import type { Progress } from '../store';

export interface TestRec {
  id: string;
  at: string;                 // the day it was finished (YYYY-MM-DD)
  mode: string;               // the time option (pack fullTest.timeOptions[].id)
  sections: { id: string; right: number; total: number; seconds: number }[];
  items: { id: string; sec: string; skill: string; c: boolean }[];
}
export const MAX_TESTS = 20;

/** Scores a test from its plan and answers. A question left blank counts as missed. */
export function scoreExam(plan: ExamPlan, answers: Record<string, Ans>, seconds: number[], skillOf: (id: string) => string, day: string): TestRec {
  const items: TestRec['items'] = [];
  const sections = plan.sections.map((s, k) => {
    let right = 0;
    for (const id of s.items) {
      const st = stepById(id), a = answers[id];
      const c = !!st && !!a && grade(st, a);
      if (c) right += 1;
      items.push({ id, sec: s.id, skill: skillOf(id), c });
    }
    return { id: s.id, right, total: s.items.length, seconds: Math.round(seconds[k] || 0) };
  });
  return { id: plan.id, at: day, mode: plan.mode, sections, items };
}

export const estimateOfTest = (rec: TestRec): Estimate | null =>
  estimate(Object.fromEntries(rec.sections.map((s) => [s.id, { right: s.right, total: s.total }])));
export const headlineOfTest = (rec: TestRec) => headline(estimateOfTest(rec));

/** The lessons that teach a skill, in map order. */
export const lessonsFor = (skill: string) => Object.values(LESSONS).filter((l) => l.skills.includes(skill)).map((l) => l.id);

export interface Weak { skill: string; name: string; missed: number; of: number; lesson: string | null }
/** The weakest skills of a test: most missed first, then the highest share missed. */
export function weakest(rec: TestRec, count = 3): Weak[] {
  const by = new Map<string, { missed: number; of: number }>();
  for (const it of rec.items) {
    const x = by.get(it.skill) || { missed: 0, of: 0 };
    x.of += 1; if (!it.c) x.missed += 1;
    by.set(it.skill, x);
  }
  return [...by.entries()].filter(([, x]) => x.missed > 0)
    .sort((a, b) => b[1].missed - a[1].missed || b[1].missed / b[1].of - a[1].missed / a[1].of || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([skill, x]) => ({ skill, name: skillName(skill), ...x, lesson: lessonsFor(skill)[0] ?? null }));
}

/** Progress after a test: the record (newest last), the count, and its misses in Review (redone like any mistake). */
export function addTest(p: Progress, rec: TestRec): Progress {
  const mistakes = [...p.mistakes];
  for (const it of rec.items) {
    if (it.c) continue;
    const i = mistakes.findIndex((m) => m.qid === it.id);
    if (i >= 0) mistakes[i] = { ...mistakes[i], due: rec.at, good: 0 };
    else mistakes.push({ qid: it.id, lessonId: `test-${rec.id}`, at: rec.at, due: rec.at, good: 0 });
  }
  return { ...p, tests: [...p.tests.filter((t) => t.id !== rec.id), rec].slice(-MAX_TESTS), fullTests: p.fullTests + 1, mistakes };
}

/** What the student has seen in earlier tests (so a new test brings fresh questions first). */
export function seenIn(tests: TestRec[]) {
  const seen: Record<string, { n: number; right: number }> = {};
  for (const t of tests) for (const it of t.items) { const s = (seen[it.id] ||= { n: 0, right: 0 }); s.n += 1; if (it.c) s.right += 1; }
  return seen;
}

/** A saved record from storage or the server, or null when it is not one. */
export function cleanTest(v: unknown): TestRec | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.at !== 'string' || !Array.isArray(r.sections) || !Array.isArray(r.items)) return null;
  const sections = (r.sections as Record<string, unknown>[]).filter((s) => s && typeof s.id === 'string' && typeof s.right === 'number' && typeof s.total === 'number')
    .map((s) => ({ id: s.id as string, right: s.right as number, total: s.total as number, seconds: typeof s.seconds === 'number' ? s.seconds : 0 }));
  const items = (r.items as Record<string, unknown>[]).filter((it) => it && typeof it.id === 'string' && typeof it.c === 'boolean')
    .map((it) => ({ id: it.id as string, sec: String(it.sec ?? ''), skill: String(it.skill ?? ''), c: it.c as boolean }));
  return { id: r.id, at: r.at, mode: typeof r.mode === 'string' ? r.mode : config.fullTest.timeOptions[0].id, sections, items };
}
