/* What a parent sees about a child's practice in the app: numbers from app_progress (the app's Progress JSON,
   src/practice/store.ts), the same data the app's own Progress and Home screens use, so the parent card and the
   report agree with the app. Days in that JSON are the child's device calendar days (YYYY-MM-DD), so "today" is the
   parent's browser day (?today= on the route), which the route checks against the server clock.
   Sections, lessons and skills come from the pack: config.sections, pack.worlds (lesson ids "<section>-<world>-<level>")
   and pack.skills. The estimate is pack/scoring.ts estimate() over the latest finished full test, which the app keeps
   in the blob as `tests` (newest last, at most 20): { id, at, mode, sections: [{ id, right, total, seconds }], items }.
   Pure functions plus one query; nothing here writes. */
import { config, pack, sectionName, sectionShort, skillName } from '../../pack';
import { estimate, headline } from '../../pack/scoring';
import type { PackLesson } from '../../pack/types';
import type { D1Database } from './env';

const DAY_MS = 86_400_000;
/** A calendar day, "2026-10-22". */
export const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The parent's day from the request when it is within a day and a half of the server clock; else the server's UTC day. */
export function cleanDay(v: unknown, at = Date.now()): string {
  if (typeof v === 'string' && DAY.test(v)) {
    const t = Date.parse(v + 'T12:00:00Z');
    if (Number.isFinite(t) && Math.abs(t - at) < 1.5 * DAY_MS) return v;
  }
  return new Date(at).toISOString().slice(0, 10);
}
const shift = (day: string, n: number) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export interface SkillRef { id: string; title: string; section: string; pct: number }
export interface NextStep { id: string; kind: 'start' | 'retry' | 'resume'; level: number; world: string; section: string; title: string; minutes: number }
export interface AppSummary {
  has: boolean;                 // the child has saved practice in the app
  days7: number;                // days with practice, last 7 days including today
  q7: number; min7: number;     // questions answered and minutes in lessons, last 7 days
  dots: boolean[];              // the last 7 days, oldest first, true = practiced
  last: string | null;          // last day with practice
  done: number; total: number;  // lessons finished, and lessons in the pack
  mistakes: number;             // mistakes waiting in Review
  weak: SkillRef[]; strong: SkillRef[];
  /** The latest finished full test, run through the pack's scoring rules. */
  estimate: { mid: number; lo: number; hi: number; at: string; tests: number; label: string; sections: { id: string; name: string; score: number; lo: number; hi: number }[] } | null;
  /** The score goal the child picked in the app (a pack scoring.benchmarks label); gap > 0: points to go. */
  target: { label: string; score: number; gap: number } | null;
  /** Days until the test date the child picked in the app, or null. */
  testIn: number | null;
  next: NextStep | null;
}

type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// The pack's lessons, in map order, with the name of the world each is in.
const WORLD_OF: Record<string, string> = {};
const LESSONS: Record<string, PackLesson> = {};
for (const w of pack.worlds) for (const l of w.lessons) { LESSONS[l.id] = l; WORLD_OF[l.id] = w.name; }
const lessonsOf = (section: string) => pack.worlds.filter((w) => w.section === section).flatMap((w) => w.lessons);
const TOTAL = Object.keys(LESSONS).length;
const WEAK_BELOW = 70, STRONG_FROM = 85, MIN_ANSWERS = 4;
/** About how long one level takes, for "next up". */
const NEXT_MINUTES = 10;

const skillRef = (id: string, pct: number): SkillRef => ({ id, title: skillName(id), section: sectionShort(pack.skills[id]?.section ?? ''), pct });

/** The latest finished full test in the blob, as the estimate sees it; tolerant of anything else in `tests`. */
function latestTest(p: Rec): { at: string; sections: Record<string, { right: number; total: number }>; items: { skill: string; c: boolean }[]; count: number } | null {
  const list: Rec[] = Array.isArray(p.tests) ? p.tests.filter((t: Rec) => t && typeof t.at === 'string' && Array.isArray(t.sections)) : [];
  if (!list.length) return null;
  const last = list.reduce((a, b) => (String(b.at) >= String(a.at) ? b : a));
  const sections: Record<string, { right: number; total: number }> = {};
  for (const s of last.sections as Rec[]) if (s && typeof s.id === 'string' && num(s.total) > 0) sections[s.id] = { right: num(s.right), total: num(s.total) };
  const items = (Array.isArray(last.items) ? last.items : []).flatMap((i: Rec) => (i && typeof i.skill === 'string' && typeof i.c === 'boolean' ? [{ skill: i.skill, c: i.c }] : []));
  return { at: String(last.at).slice(0, 10), sections, items, count: list.length };
}

export function summarize(data: Rec | null, today: string): AppSummary {
  const none: AppSummary = { has: false, dots: Array(7).fill(false), days7: 0, q7: 0, min7: 0, last: null, done: 0, total: TOTAL, mistakes: 0, weak: [], strong: [], estimate: null, target: null, testIn: null, next: null };
  const p = data ?? {};
  const lessons: Record<string, Rec> = p.lessons && typeof p.lessons === 'object' ? p.lessons : {};
  const week = Array.from({ length: 7 }, (_, i) => shift(today, -i));
  const days = new Set<string>(Array.isArray(p.days) ? p.days : []);
  const qDays: Rec = p.qDays ?? {}, secDays: Rec = p.secDays ?? {};
  const did = (d: string) => days.has(d) || num(qDays[d]) > 0;
  const lastDay = [...days, ...Object.keys(qDays).filter((d) => num(qDays[d]) > 0)].sort().pop() ?? null;
  const mistakes: Rec[] = Array.isArray(p.mistakes) ? p.mistakes : [];
  const finished = (id: string) => !!LESSONS[id] && !!lessons[id];

  // Skills: what each finished lesson and the latest full test say about it. Mistakes waiting in Review count against the lesson's skills.
  const stat: Record<string, { right: number; total: number; miss: number }> = {};
  const at = (id: string) => stat[id] ?? (stat[id] = { right: 0, total: 0, miss: 0 });
  for (const [id, r] of Object.entries(lessons)) {
    const l = LESSONS[id];
    if (!l || num(r?.of) <= 0) continue;
    for (const s of l.skills) { const x = at(s); x.right += Math.min(num(r.best), num(r.of)); x.total += num(r.of); }
  }
  for (const m of mistakes) {
    const l = m && typeof m.lessonId === 'string' ? LESSONS[m.lessonId] : undefined;
    if (l) for (const s of l.skills) at(s).miss++;
  }
  const test = latestTest(p);
  for (const i of test?.items ?? []) if (pack.skills[i.skill]) { const x = at(i.skill); x.total++; x.right += i.c ? 1 : 0; }
  const rows = Object.entries(stat).filter(([id, x]) => pack.skills[id] && x.total >= MIN_ANSWERS).map(([id, x]) => ({ id, pct: Math.round((100 * x.right) / x.total), miss: x.miss }));
  const weak = rows.filter((x) => x.pct < WEAK_BELOW || x.miss >= 3).sort((a, b) => a.pct - b.pct || b.miss - a.miss).slice(0, 3).map((x) => skillRef(x.id, x.pct));
  const strong = rows.filter((x) => x.pct >= STRONG_FROM && x.miss < 3).sort((a, b) => b.pct - a.pct).slice(0, 2).map((x) => skillRef(x.id, x.pct));

  // The estimate: the pack's scoring rules over the latest finished full test.
  let est: AppSummary['estimate'] = null;
  const e = test ? estimate(test.sections) : null, head = headline(e);
  if (test && e && head) {
    est = {
      mid: Math.round(head.score), lo: Math.round(head.lo), hi: Math.round(head.hi), at: test.at, tests: test.count, label: config.scoring.label,
      sections: e.sections.map((s) => ({ id: s.id, name: sectionName(s.id), score: Math.round(s.score), lo: Math.round(s.lo), hi: Math.round(s.hi) })),
    };
  }
  const goal = typeof p.target === 'string' ? config.scoring.benchmarks.find((b) => b.label === p.target) : undefined;
  const target = goal && est ? { label: goal.label, score: goal.score, gap: Math.round(goal.score - est.mid) } : null;
  const testDate = typeof p.testDate === 'string' && DAY.test(p.testDate) ? p.testDate : null;
  const testIn = testDate ? Math.round((Date.parse(testDate + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / DAY_MS) : null;

  // Next up: finish a level left part-way (unless it was finished since: same rule as the app's merge); else the first
  // unfinished level of the section with the smallest share finished.
  const sections = config.sections.filter((s) => lessonsOf(s.id).length);
  const share = (id: string) => lessonsOf(id).filter((l) => finished(l.id)).length / lessonsOf(id).length;
  const section = [...sections].sort((a, b) => share(a.id) - share(b.id))[0];
  const ip = p.inProgress && typeof p.inProgress === 'object' && p.inProgress.kind === 'lesson' ? p.inProgress : null;
  const left = ip && LESSONS[String(ip.id)] && !(lessons[String(ip.id)] && String(lessons[String(ip.id)].at || '') >= String(ip.at || '')) ? LESSONS[String(ip.id)] : undefined;
  const first = section ? lessonsOf(section.id).find((l) => !finished(l.id)) : undefined;
  const pick = left ?? first;
  const next: NextStep | null = pick
    ? { id: pick.id, kind: left ? 'resume' : (p.tried && p.tried[pick.id]) || lessons[pick.id] ? 'retry' : 'start', level: pick.level, world: WORLD_OF[pick.id] ?? '', section: sectionName(pick.section), title: pick.title, minutes: NEXT_MINUTES }
    : null;

  if (!data) return { ...none, next };
  return {
    has: true, dots: [...week].reverse().map(did), days7: week.filter(did).length,
    q7: week.reduce((s, d) => s + num(qDays[d]), 0), min7: Math.round(week.reduce((s, d) => s + num(secDays[d]), 0) / 60),
    last: lastDay, done: Object.keys(lessons).filter(finished).length, total: TOTAL, mistakes: mistakes.length,
    weak, strong, estimate: est, target, testIn, next,
  };
}

/** Summaries for learners (by learner id). A learner with no saved practice gets summarize(null). */
export async function summariesFor(D: D1Database, learners: string[], today: string): Promise<Record<string, AppSummary>> {
  const out: Record<string, AppSummary> = {};
  if (!learners.length) return out;
  const { results } = await D.prepare(`SELECT learner_id, data FROM app_progress WHERE learner_id IN (${learners.map((_, i) => `?${i + 1}`).join(',')})`)
    .bind(...learners).all<{ learner_id: string; data: string }>();
  for (const r of results) {
    try { out[r.learner_id] = summarize(JSON.parse(r.data), today); } catch { /* a damaged copy counts as none */ }
  }
  for (const l of learners) out[l] ??= summarize(null, today);
  return out;
}
