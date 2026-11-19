// What the tutor believes about each skill, and the review schedule.
// A skill is a map stop. Every scored answer moves one number per skill: k, the chance the student knows it. One
// Bayes step per answer (a right answer can be a guess, a wrong one can be a slip), then a smaller push along the skill
// map: knowing a skill makes the skills under it likely known; missing one makes the skills built on it less likely.
// Pure functions over plain objects, saved inside Progress (store.ts) as `tutor`.
import { SUBJECTS, isSubject, isLessonId, LESSON_KEY_RE, type Subject } from '../curriculum';
import { prereqsOf, ancestors, descendants } from './graph';

export interface SkillRec {
  n: number;            // scored answers on this skill
  r: number;            // right answers
  k: number;            // chance the student knows it, 0..1
  box: number;          // review box 0..4 (REVIEW_DAYS)
  due: string | null;   // day the skill is due for review; null until it has been practiced
  last: string;         // last day it was practiced
  h: number;            // hints used on it
}

/** Why a stop is on the student's plan. */
export type PlanWhy = 'gap' | 'placement' | 'revisit';
export interface PlanItem { stop: string; why: PlanWhy; from?: string; at: string; done?: string }

export interface Placement { at: string; start: string | null; known: string[]; gaps: string[]; asked: number; right: number }

export type GoalWhy = 'test' | 'catch-up' | 'ahead';
export interface Goal { why: GoalWhy; days: 3 | 5 | 7; minutes: 10 | 20 | 30; first: Subject; by: 'student' | 'parent'; at: string }

/** A finished check, skill check or placement (accuracy for the parent view counts only these, never lessons). */
export interface CheckLog { kind: 'skill' | 'check' | 'placement' | 'practice'; id: string; at: string; right: number; total: number }

export type Slip = 'misread' | 'slip' | 'start' | 'evidence' | 'guess';

export interface Tutor {
  skills: Record<string, SkillRec>;
  plan: PlanItem[];
  placement: Partial<Record<Subject, Placement>>;
  /** Worlds opened by a placement check ("math-3"): the map lets the student start there. */
  opened: string[];
  goal: Goal | null;
  saves: number;            // streak saves banked, 0..2
  saved: string[];          // days a save covered
  savedOn: string | null;   // last day a save was earned
  hints: Record<string, number>;   // day -> hints opened
  slips: Partial<Record<Slip, number>>;
  log: CheckLog[];
  /** Learning strengths by day: w = "Why?" opened after a right answer (curiosity), b = a right answer straight after a
      miss (bouncing back), s = a round finished after a miss in it (sticking with it). Counts only. */
  traits: Record<string, Trait>;
  /** Every bank question the student has answered: id (without the "<stop>/" prefix) -> [times shown, times right].
      Generated tests and tutor rounds use it so a question comes back at most twice and never after a right answer. */
  seen: Record<string, [number, number]>;
  /** Finished full tests already counted into `seen` (their record ids). */
  testsIn: string[];
}
export interface Trait { w: number; b: number; s: number }

export const freshTutor = (): Tutor => ({ skills: {}, plan: [], placement: {}, opened: [], goal: null, saves: 0, saved: [], savedOn: null, hints: {}, slips: {}, log: [], traits: {}, seen: {}, testsIn: [] });

/** A question's bank id: lesson and tutor keys carry the stop ("math-1-2/B1-RP-…"). */
export const rawId = (key: string) => key.replace(LESSON_KEY_RE, '');
/** The most times one question is shown to a student, and whether it may be shown again. */
export const MAX_SHOWN = 2;
export const mayShow = (t: Tutor, id: string) => { const s = t.seen[rawId(id)]; return !s || (s[1] === 0 && s[0] < MAX_SHOWN); };
/** `seen` after some answers (ids may carry a stop prefix; teaching and look-back steps are skipped by the caller). */
export function addSeen(t: Tutor, answers: { qid: string; correct: boolean }[]): Tutor {
  if (!answers.length) return t;
  const seen = { ...t.seen };
  for (const a of answers) { const id = rawId(a.qid), o = seen[id] || [0, 0]; seen[id] = [o[0] + 1, o[1] + (a.correct ? 1 : 0)]; }
  return { ...t, seen };
}

/** Strengths over the days from `from` to `to` (inclusive). */
export function traitsBetween(t: Tutor, from: string, to: string): Trait {
  const out = { w: 0, b: 0, s: 0 };
  for (const [d, x] of Object.entries(t.traits)) if (d >= from && d <= to) { out.w += x.w; out.b += x.b; out.s += x.s; }
  return out;
}
export function addTrait(t: Tutor, day: string, add: Partial<Trait>): Tutor {
  if (!add.w && !add.b && !add.s) return t;
  const o = t.traits[day] || { w: 0, b: 0, s: 0 };
  const traits = { ...t.traits, [day]: { w: o.w + (add.w || 0), b: o.b + (add.b || 0), s: o.s + (add.s || 0) } };
  const keep = Object.keys(traits).sort().slice(-60);
  return { ...t, traits: Object.fromEntries(keep.map((k) => [k, traits[k]])) };
}

/** Days until the next review, by box: a skill answered well moves up a box and waits longer (spaced review). */
export const REVIEW_DAYS = [1, 3, 7, 14, 30];
export const MAX_SAVES = 2;
const PRIOR = 0.5;

// ---- one answer ----
// Students slip more than adults: a careless miss should not read as "does not know it" after one question.
const SLIP = 0.18;
/** The chance of a right answer without knowing the skill, by activity: four choices are easy to guess, typing is not. */
// 'rate': a "could you solve this?" self-rating says less than an answer: students over- and under-rate themselves
const GUESS: Record<string, number> = { rate: 0.45, mc: 0.25, hot: 0.2, inline: 0.3, multi: 0.08, typed: 0.04, numline: 0.08, plot: 0.04, fill: 0.12, classify: 0.12, order: 0.1, spot: 0.15, transform: 0.05, table: 0.05, solset: 0.05 };

const clamp = (x: number) => Math.min(0.98, Math.max(0.02, x));
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface Obs { stop: string; correct: boolean; kind?: string; hints?: number }

/** Beliefs after one answer: the skill itself, then its neighbors on the skill map. `k` maps stop -> belief. */
export function observe(k: Record<string, number>, o: Obs): Record<string, number> {
  const prior = k[o.stop] ?? PRIOR;
  // A right answer after hints says less: it is closer to a guess.
  const guess = Math.min(0.6, (GUESS[o.kind || 'mc'] ?? 0.2) + 0.15 * (o.hints || 0));
  const pk = o.correct ? 1 - SLIP : SLIP, pu = o.correct ? guess : 1 - guess;
  const post = clamp((prior * pk) / (prior * pk + (1 - prior) * pu));
  const out = { ...k, [o.stop]: post };
  const delta = post - prior;
  if (delta > 0) {
    // Knowing it: the skills it builds on are likely known too (nearest ones most).
    for (const a of ancestors(o.stop)) {
      const near = prereqsOf(o.stop).includes(a) ? 0.6 : 0.3, v = out[a] ?? PRIOR;
      out[a] = clamp(v + (1 - v) * delta * near);
    }
  } else if (delta < 0) {
    // Missing it: skills built on it are less likely known.
    for (const d of descendants(o.stop)) {
      const near = prereqsOf(d).includes(o.stop) ? 0.5 : 0.25, v = out[d] ?? PRIOR;
      out[d] = clamp(v + v * delta * near);
    }
  }
  return out;
}

export const beliefs = (t: Tutor): Record<string, number> => Object.fromEntries(Object.entries(t.skills).map(([s, r]) => [s, r.k]));

// ---- labels ----
export type Mastery = 'new' | 'gap' | 'learning' | 'solid' | 'mastered';
export function mastery(r: SkillRec | undefined): Mastery {
  if (!r || r.n === 0) return 'new';
  if (r.k < 0.4) return 'gap';
  if (r.k < 0.7) return 'learning';
  if (r.k >= 0.9 && r.n >= 4) return 'mastered';
  return 'solid';
}
export const MASTERY_LABEL: Record<Mastery, string> = { new: 'Not started', gap: 'Needs work', learning: 'Learning', solid: 'Solid', mastered: 'Mastered' };

/** How many hints a practice step offers: fewer as the skill grows. Never zero in practice. */
export function hintBudget(r: SkillRec | undefined): number {
  const m = mastery(r);
  return m === 'new' || m === 'gap' ? 3 : m === 'learning' ? 2 : 1;
}

// ---- after a round ----
export type RoundKind = 'lesson' | 'review' | 'check' | 'placement' | 'skill' | 'fix' | 'practice';
export interface RoundAnswer { qid: string; correct: boolean; hints?: number; kind?: string }
/** The stop a saved question key belongs to ("math-1-2/item-id"), or null for full-test items. */
export const stopOfKey = (key: string): string | null => (LESSON_KEY_RE.test(key) ? key.split('/')[0] : null);

const addDays = (day: string, n: number) => { const [y, m, d] = day.split('-').map(Number); const x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

/** The tutor after a finished round: beliefs, counts, hints, and each practiced skill's next review day. */
export function afterRound(t0: Tutor, kind: RoundKind, answers: RoundAnswer[], day: string): Tutor {
  const t: Tutor = { ...t0, skills: { ...t0.skills }, hints: { ...t0.hints } };
  let k = beliefs(t);
  const per: Record<string, { n: number; r: number; h: number }> = {};
  let hints = 0;
  for (const a of answers) {
    hints += a.hints || 0;
    const stop = stopOfKey(a.qid);
    if (!stop) continue;
    k = observe(k, { stop, correct: a.correct, kind: a.kind, hints: a.hints });
    const x = per[stop] || (per[stop] = { n: 0, r: 0, h: 0 });
    x.n++; if (a.correct) x.r++; x.h += a.hints || 0;
  }
  if (hints) t.hints[day] = (t.hints[day] || 0) + hints;
  // Beliefs move for neighbors too. Skills already on record keep the new value; a placement check also records the
  // skills it learned about without asking (n = 0, no review day), so its result and later rounds can use them.
  for (const [s, v] of Object.entries(k)) {
    if (t.skills[s]) t.skills[s] = { ...t.skills[s], k: r2(v) };
    else if (kind === 'placement' && isLessonId(s)) t.skills[s] = { n: 0, r: 0, k: r2(v), box: 0, due: null, last: day, h: 0 };
  }
  for (const [s, x] of Object.entries(per)) {
    const old = t.skills[s] || { n: 0, r: 0, k: PRIOR, box: 0, due: null, last: day, h: 0 };
    let box = old.box;
    const share = x.r / x.n;
    // The schedule: a first lesson starts at box 0 (back tomorrow). A retrieval round (check, skill check, practice,
    // review) moves the box: mostly right with no hints -> up; less than half -> back to 0; else it stays.
    if (kind === 'lesson' || kind === 'placement') box = old.due ? box : 0;
    else if (share >= 0.8 && x.h === 0) box = Math.min(REVIEW_DAYS.length - 1, box + 1);
    else if (share < 0.5) box = 0;
    // Placement only sets beliefs; the schedule starts when the skill is first practiced.
    const due = kind === 'placement' && !old.due ? null : addDays(day, REVIEW_DAYS[box]);
    t.skills[s] = { n: old.n + x.n, r: old.r + x.r, k: r2(k[s] ?? old.k), box, due, last: day, h: old.h + x.h };
  }
  return t;
}

/** Skills due for review today, most overdue first. */
export function dueSkills(t: Tutor, day: string): string[] {
  return Object.entries(t.skills).filter(([, r]) => r.due && r.due <= day)
    .sort(([, a], [, b]) => (a.due || '').localeCompare(b.due || '') || a.k - b.k).map(([s]) => s);
}

/** The deepest likely gaps under a set of weak skills: weak themselves, with every skill under them likely known. */
export function rootGaps(k: Record<string, number>, weak: string[], cut = 0.4): string[] {
  const out = new Set<string>();
  for (const w of weak) {
    const chain = [w, ...ancestors(w)].filter((s) => (k[s] ?? PRIOR) < cut);
    for (const s of chain) if (prereqsOf(s).every((p) => (k[p] ?? PRIOR) >= cut || !chain.includes(p))) out.add(s);
  }
  return [...out];
}

/** Add stops to the plan (once each; an open item is not added again). */
export function addToPlan(t: Tutor, items: Omit<PlanItem, 'at'>[], day: string): Tutor {
  const open = new Set(t.plan.filter((x) => !x.done).map((x) => x.stop));
  const add = items.filter((x) => !open.has(x.stop) && !!open.add(x.stop)).map((x) => ({ ...x, at: day }));
  return add.length ? { ...t, plan: [...t.plan, ...add].slice(-30) } : t;
}

/** Plan items are done once the skill looks solid again, or its level was passed after it was added. */
export function settlePlan(t: Tutor, passedOn: (stop: string) => string | undefined, day: string): Tutor {
  let changed = false;
  const plan = t.plan.map((x) => {
    if (x.done) return x;
    const passed = passedOn(x.stop);
    if ((t.skills[x.stop]?.k ?? 0) >= 0.7 || (passed && passed >= x.at)) { changed = true; return { ...x, done: day }; }
    return x;
  });
  return changed ? { ...t, plan } : t;
}

export const openPlan = (t: Tutor) => t.plan.filter((x) => !x.done);

export function logCheck(t: Tutor, c: CheckLog): Tutor {
  return { ...t, log: [...t.log, c].slice(-40) };
}

// ---- saved data ----
const SLIPS: Slip[] = ['misread', 'slip', 'start', 'evidence', 'guess'];
/** A map of non-negative counts whose keys pass `ok`. */
function counts(v: unknown, ok: (k: string) => boolean): Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, n]) => ok(k) && typeof n === 'number' && Number.isFinite(n) && n >= 0)) as Record<string, number>;
}
/** Only well-formed parts of a saved tutor object; anything else falls back to fresh values. */
export function cleanTutor(v: unknown): Tutor {
  const f = freshTutor();
  if (!v || typeof v !== 'object' || Array.isArray(v)) return f;
  const x = v as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const day = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const num = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) ? n : d);
  const skills: Record<string, SkillRec> = {};
  if (x.skills && typeof x.skills === 'object') for (const [s, r] of Object.entries(x.skills as Record<string, any>)) {  // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!isLessonId(s) || !r || typeof r !== 'object') continue;
    skills[s] = { n: num(r.n, 0), r: num(r.r, 0), k: Math.min(0.98, Math.max(0.02, num(r.k, PRIOR))), box: Math.min(4, Math.max(0, Math.round(num(r.box, 0)))),
      due: day(r.due) ? r.due : null, last: day(r.last) ? r.last : '', h: num(r.h, 0) };
  }
  const plan = Array.isArray(x.plan) ? x.plan.filter((p: any) => p && typeof p.stop === 'string' && day(p.at)) : [];  // eslint-disable-line @typescript-eslint/no-explicit-any
  const placement: Tutor['placement'] = {};
  const ids = (a: unknown) => (Array.isArray(a) ? a.filter((s): s is string => isLessonId(s)) : []);
  for (const s of SUBJECTS) {
    const p = x.placement?.[s];
    if (p && day(p.at)) placement[s] = { at: p.at, start: isLessonId(p.start) ? p.start : null,
      known: ids(p.known), gaps: ids(p.gaps), asked: num(p.asked, 0), right: num(p.right, 0) };
  }
  const g = x.goal;
  const goal: Goal | null = g && ['test', 'catch-up', 'ahead'].includes(g.why) && [3, 5, 7].includes(g.days) && [10, 20, 30].includes(g.minutes) && isSubject(g.first) ? g : null;
  return {
    skills, plan, placement, goal,
    opened: Array.isArray(x.opened) ? x.opened.filter((w: unknown) => typeof w === 'string') : [],
    saves: Math.min(MAX_SAVES, Math.max(0, Math.round(num(x.saves, 0)))),
    saved: Array.isArray(x.saved) ? x.saved.filter(day) : [],
    savedOn: day(x.savedOn) ? x.savedOn : null,
    hints: counts(x.hints, day),
    slips: counts(x.slips, (k) => SLIPS.includes(k as Slip)),
    seen: Object.fromEntries(Object.entries(x.seen && typeof x.seen === 'object' && !Array.isArray(x.seen) ? x.seen as Record<string, unknown> : {})
      .filter(([k, v]) => k.length <= 80 && Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0)) as [string, [number, number]][]),
    testsIn: Array.isArray(x.testsIn) ? x.testsIn.filter((s: unknown) => typeof s === 'string').slice(-100) : [],
    traits: Object.fromEntries(Object.entries(x.traits && typeof x.traits === 'object' && !Array.isArray(x.traits) ? x.traits as Record<string, any> : {})  // eslint-disable-line @typescript-eslint/no-explicit-any
      .filter(([d, v]) => day(d) && v && typeof v === 'object').map(([d, v]) => [d, { w: Math.max(0, num(v.w, 0)), b: Math.max(0, num(v.b, 0)), s: Math.max(0, num(v.s, 0)) }])),
    log: Array.isArray(x.log) ? x.log.filter((c: any) => c && typeof c.id === 'string' && day(c.at) && ['skill', 'check', 'placement', 'practice'].includes(c.kind)  // eslint-disable-line @typescript-eslint/no-explicit-any
      && Number.isFinite(c.right) && Number.isFinite(c.total) && c.right >= 0 && c.right <= c.total) : [],
  };
}

/** Two devices' tutor data merged: per skill the record with more answers (then the later one), every plan item, the
    larger counts. */
export function mergeTutor(a: Tutor, b: Tutor): Tutor {
  const skills = { ...b.skills };
  for (const [s, r] of Object.entries(a.skills)) {
    const o = skills[s];
    // more answers wins, then the later day, then the lower belief (the careful side), so the order of the copies never matters
    skills[s] = !o || r.n > o.n || (r.n === o.n && (r.last > o.last || (r.last === o.last && r.k < o.k))) ? r : o;
  }
  const plan = new Map<string, PlanItem>();
  for (const p of [...b.plan, ...a.plan]) { const key = p.stop + '@' + p.at; const o = plan.get(key); if (!o || (p.done && !o.done)) plan.set(key, p); }
  const maxMap = (x: Record<string, number>, y: Record<string, number>) => { const o = { ...y }; for (const [k, v] of Object.entries(x)) o[k] = Math.max(o[k] || 0, v || 0); return o; };
  const log = new Map<string, CheckLog>();
  for (const c of [...b.log, ...a.log]) log.set(c.kind + c.id + c.at + c.total, c);
  const savedAll = [...new Set([...a.saved, ...b.saved])].sort();
  return {
    skills,
    plan: [...plan.values()].sort((x, y) => x.at.localeCompare(y.at)).slice(-30),
    placement: Object.fromEntries(SUBJECTS.map((s) => [s, [a.placement[s], b.placement[s]].filter(Boolean).sort((x, y) => x!.at.localeCompare(y!.at) || x!.asked - y!.asked).pop()]).filter(([, v]) => v)),
    opened: [...new Set([...a.opened, ...b.opened])],
    goal: a.goal || b.goal,
    // a save spent on one device is spent: each side's banked saves, less the days the other side covered
    saves: Math.max(0, ...[a, b].map((x) => x.saves - (savedAll.length - x.saved.length))),
    saved: savedAll,
    savedOn: [a.savedOn, b.savedOn].filter(Boolean).sort().pop() || null,
    hints: maxMap(a.hints, b.hints),
    slips: maxMap(a.slips as Record<string, number>, b.slips as Record<string, number>),
    log: [...log.values()].sort((x, y) => x.at.localeCompare(y.at)).slice(-40),
    seen: (() => { const o = { ...b.seen }; for (const [k, v] of Object.entries(a.seen)) { const w = o[k]; o[k] = w ? [Math.max(w[0], v[0]), Math.max(w[1], v[1])] : v; } return o; })(),
    testsIn: [...new Set([...b.testsIn, ...a.testsIn])].slice(-100),
    traits: (() => { const o: Record<string, Trait> = { ...b.traits }; for (const [d, v] of Object.entries(a.traits)) { const w = o[d]; o[d] = w ? { w: Math.max(w.w, v.w), b: Math.max(w.b, v.b), s: Math.max(w.s, v.s) } : v; } return o; })(),
  };
}
