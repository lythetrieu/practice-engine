// Saved progress for the practice app, and every rule that turns answers into XP, streaks, quests,
// stars, unlocks and badges. Pure functions over one plain object, so screens only read and the
// whole state can later be synced to an account as one JSON blob.
//
// Progress is kept per pack (its own storage key), so two packs on one browser never mix.
import { config } from '../pack';
import {
  LESSONS, WORLDS, worldCount, XP_PER_CORRECT, DAILY_GOAL, QUEST_XP, chestId, checkId,
  SUBJECTS, isSubject, parseStopId, type Subject, type Lesson,
} from './curriculum';
import { LEVEL_OF, stopItems } from './levels/index';
import { freshTutor, cleanTutor, MAX_SAVES, type Tutor, type RoundKind } from './tutor/model';
import { tutorAfter, type TutorReport } from './tutor/round';
import { cleanTest, MAX_TESTS, type TestRec } from './exam/results';

/** Always false: the engine plays the pack's own questions (kept so screens can still ask). */
export const SAMPLE_MODE = false;
export const STORAGE_KEY = `pe.${config.id}.app.v1`;
const KEY = STORAGE_KEY;
export const CHEST_XP = 20;
export const CHECK_PASS = config.practice.checkPass;   // share of a unit check to answer right to open the next world

export interface LessonRec { stars: number; best: number; of: number; at: string; last?: string }   // at: first finish day; last: latest finish day
// A missed question stays in Review until it is answered right on two different days (spaced
// relearning: Rawson & Dunlosky 2011; Karpicke & Roediger 2008). `due` is the day it can be redone next;
// `good` counts right answers in Review so far (0, or 1 after the first right answer).
export interface Mistake { qid: string; lessonId: string; at: string; due?: string; good?: number }
// A lesson, unit check or review round left part-way: answers so far, so it can be finished later.
export interface InProgress { id: string; kind: RoundKind; qids: string[]; answers: Answer[]; seconds: number; at: string }
export interface Progress {
  v: 1;
  started: string;
  testDate: string | null;
  target: string | null;                  // the score goal: a pack scoring.benchmarks label, picked on Progress
  grade: number | null;                   // one of the pack's audience options, asked once on Home (Me can change it)
  nextFall: boolean;                      // "my test is later" (no date to pick yet)
  sound: boolean;
  motion: boolean;
  subject: Subject;                       // last subject shown on Learn
  xp: number;
  xpDays: Record<string, number>;         // day -> XP earned that day
  qDays: Record<string, number>;          // day -> questions answered
  secDays: Record<string, number>;        // day -> seconds spent in lessons
  days: string[];                         // days with at least one finished lesson, sorted
  lessons: Record<string, LessonRec>;     // finished lessons and passed unit checks
  tried: Record<string, string>;          // lessons tried but not passed yet: lesson id -> day of the last try
  checks: Record<string, number>;         // unit check id -> best share right (0..1), pass or not
  chests: string[];                       // opened world chests
  run: number;                            // answers right in a row, right now
  bestRun: number;
  dayRun: { day: string; best: number };  // best run today (daily quest)
  mistakes: Mistake[];                    // questions to redo in Review
  fixed: number;                          // mistakes fixed in Review
  quests: { day: string; claimed: string[] };
  badges: Record<string, string>;         // badge id -> day earned
  reading: number;                        // reading sets finished
  tools: string[];                        // test tools tried in a reading set
  fullTests: number;
  /** Finished full tests, newest last (exam/results.ts). */
  tests: TestRec[];
  inProgress: InProgress | null;
  /** The tutor: what it believes about each skill, the review schedule, the plan, goal and streak saves (tutor/model.ts). */
  tutor: Tutor;
}

// ---- dates (the device's local calendar day) ----
const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => dayKey(new Date());
export const parseDay = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (k: string, n: number) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
/** "This week" everywhere in the app (Home, Progress): the last 7 days, oldest first, today last. */
export const last7 = (t = today()) => Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
/** A day counts as practiced when any question was answered on it. */
export const practicedOn = (p: { qDays: Record<string, number> }, d: string) => (p.qDays[d] || 0) > 0;
export const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 864e5);

// The pack's test days (pack.yaml testDates); none for an exam with no fixed dates.
export const TEST_DAYS: { day: string; label: string; who: string; grades?: number[] }[] =
  config.testDates.map((d) => ({ day: d.date, label: d.label, who: d.who ?? '', grades: d.grades }));
/** Test days for a grade (all of them when the grade is not known or a day names no grades). */
export const testDaysFor = (grade: number | null) => TEST_DAYS.filter((d) => grade == null || !d.grades || d.grades.includes(grade));
/** The pack's audience values ("grade"). */
export const GRADES: number[] = (config.audience?.options || []).map((o) => o.value);
export const gradeLabel = (g: number | null) => config.audience?.options.find((o) => o.value === g)?.label ?? (g == null ? '' : String(g));

export function fresh(): Progress {
  const t = today();
  return {
    v: 1, started: t, testDate: null, target: null, grade: null, nextFall: false, sound: true, motion: true, subject: SUBJECTS[0] ?? '',
    xp: 0, xpDays: {}, qDays: {}, secDays: {}, days: [], lessons: {}, tried: {}, checks: {}, chests: [],
    run: 0, bestRun: 0, dayRun: { day: t, best: 0 }, mistakes: [], fixed: 0,
    quests: { day: t, claimed: [] }, badges: {}, reading: 0, tools: [], fullTests: 0, tests: [], inProgress: null, tutor: freshTutor(),
  };
}

export function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.v === 1) return clean(p);
    }
  } catch (e) { /* private mode or blocked storage: start fresh */ }
  return fresh();
}

// Keep only well-formed fields from a saved object; anything missing or of the wrong type falls back
// to a fresh value, so an old or damaged save can never crash a screen.
function clean(raw: Record<string, unknown>): Progress {
  const f = fresh() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...f };
  const isObj = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x);
  for (const k of Object.keys(f)) {
    const v = raw[k], d = f[k];
    if (k === 'testDate') out[k] = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    else if (k === 'started') out[k] = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && dayKey(parseDay(v)) === v ? v : today();
    else if (k === 'inProgress') out[k] = cleanInProgress(v);
    else if (k === 'tutor') out[k] = cleanTutor(v);
    else if (k === 'tests') out[k] = Array.isArray(v) ? v.map(cleanTest).filter(Boolean).slice(-MAX_TESTS) : [];
    else if (k === 'grade') out[k] = typeof v === 'number' && GRADES.includes(v) ? v : null;
    else if (k === 'target') out[k] = typeof v === 'string' && config.scoring.benchmarks.some((b) => b.label === v) ? v : null;
    else if (Array.isArray(d)) out[k] = Array.isArray(v) ? v.filter((x) => (k === 'mistakes' ? isObj(x) && typeof (x as Mistake).qid === 'string' : typeof x === 'string')) : d;
    else if (isObj(d)) out[k] = isObj(v) ? v : d;
    else out[k] = typeof v === typeof d ? v : d;
  }
  const p = out as unknown as Progress;
  if (typeof p.dayRun.day !== 'string' || typeof p.dayRun.best !== 'number') p.dayRun = { day: today(), best: 0 };
  if (typeof p.quests.day !== 'string' || !Array.isArray(p.quests.claimed)) p.quests = { day: today(), claimed: [] };
  if (!isSubject(p.subject)) p.subject = SUBJECTS[0] ?? '';
  p.mistakes = p.mistakes.map((m) => ({ ...m, due: typeof m.due === 'string' ? m.due : m.at, good: m.good === 1 ? 1 : 0 }));
  return p;
}

function cleanInProgress(v: unknown): InProgress | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>;
  if (typeof x.id !== 'string' || !['lesson', 'check', 'review', 'placement', 'skill', 'fix', 'practice'].includes(String(x.kind)) || !Array.isArray(x.qids) || !Array.isArray(x.answers)) return null;
  const answers = (x.answers as unknown[]).filter((a): a is Answer => !!a && typeof a === 'object' && typeof (a as Answer).qid === 'string' && typeof (a as Answer).correct === 'boolean');
  return {
    id: x.id, kind: x.kind as InProgress['kind'], qids: (x.qids as unknown[]).filter((q): q is string => typeof q === 'string'),
    answers, seconds: typeof x.seconds === 'number' ? x.seconds : 0, at: typeof x.at === 'string' ? x.at : today(),
  };
}

// ---- a lesson left part-way ----
const RESUME_DAYS = 7;   // older half-done lessons start over
/** The half-done lesson to offer on Home and in the lesson, if it is recent and still makes sense. */
export function resumable(p: Progress, t = today()): InProgress | null {
  const r = p.inProgress;
  if (!r || !r.answers.length || r.answers.length >= r.qids.length) return null;
  if (daysBetween(r.at, t) > RESUME_DAYS) return null;
  return r;
}
export const saveInProgress = (p: Progress, r: InProgress | null): Progress => ({ ...p, inProgress: r });

export function save(p: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify(trim(p))); } catch (e) { /* storage full or blocked */ }
}

export function reset() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

// Keep the per-day maps short: 60 days is plenty for streaks, quests and the week row.
function trim(p: Progress): Progress {
  const cut = addDays(today(), -60);
  const keep = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).filter(([k]) => k >= cut));
  return { ...p, xpDays: keep(p.xpDays), qDays: keep(p.qDays), secDays: keep(p.secDays) };
}

// ---- streaks ----
// A day counts after a passed lesson or STREAK_QUESTIONS answers. The streak counts back
// from today if today counts, else from yesterday (so it stays alive until midnight). A day covered by a streak save
// keeps the streak going but adds no day.
export const STREAK_QUESTIONS = 3;
export function streak(p: Progress, t = today()) {
  const set = new Set(p.days), saved = new Set(p.tutor.saved);
  let start = set.has(t) ? t : addDays(t, -1);
  let n = 0;
  while (set.has(start) || saved.has(start)) { if (set.has(start)) n++; start = addDays(start, -1); }
  return { n, doneToday: set.has(t) };
}

export function bestStreak(p: Progress) {
  const saved = new Set(p.tutor.saved);
  let best = 0, cur = 0, prev = '';
  for (const d of p.days) {
    let gap = prev ? addDays(prev, 1) : '';
    while (gap && gap < d && saved.has(gap)) gap = addDays(gap, 1);
    cur = gap === d ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = d;
  }
  return best;
}

/** Missed days since the last practice day are covered by banked saves, when there are enough to cover them all (a
    gap longer than the saves ends the streak and keeps the saves). Run at app start and before a round is scored. */
export function useSaves(p: Progress, t = today()): Progress {
  const tu = p.tutor;
  const last = [...p.days, ...tu.saved].filter((d) => d < t).sort().pop();
  if (!last || !tu.saves) return p;
  const missed: string[] = [];
  for (let d = addDays(last, 1); d < t; d = addDays(d, 1)) missed.push(d);
  if (!missed.length || missed.length > tu.saves) return p;
  return { ...p, tutor: { ...tu, saves: tu.saves - missed.length, saved: [...tu.saved, ...missed].sort().slice(-60) } };
}

/** A streak that ended, for a gentle line on Home: `was` = days it had run (2 or more), `today` = true when
    today is already day 1 of the new one. null when nothing was lost (or it was a single day). */
export function lostStreak(p: Progress, t = today()): { was: number; today: boolean } | null {
  const d = p.days;
  if (!d.length) return null;
  const saved = new Set(p.tutor.saved);
  // the day after `day`, stepping over days a streak save covered
  const nextLive = (day: string) => { let x = addDays(day, 1); while (saved.has(x)) x = addDays(x, 1); return x; };
  // runs of consecutive days (saves bridge a gap), oldest first
  const runs: { end: string; n: number }[] = [];
  for (const day of d) {
    const last = runs[runs.length - 1];
    if (last && nextLive(last.end) === day) { last.end = day; last.n += 1; } else runs.push({ end: day, n: 1 });
  }
  const cur = runs[runs.length - 1];
  if (cur.end === t) {
    const prev = runs[runs.length - 2];
    return cur.n === 1 && prev && prev.n >= 2 ? { was: prev.n, today: true } : null;
  }
  if (nextLive(cur.end) >= t) return null;      // still alive until midnight
  return cur.n >= 2 ? { was: cur.n, today: false } : null;
}

/** The grade to use: the signed-in child's, else the one picked on Home. */
export const gradeOf = (p: Progress, meGrade: number | null | undefined): number | null =>
  typeof meGrade === 'number' && GRADES.includes(meGrade) ? meGrade : p.grade;

// The last 7 days ending today, for the week row on the lesson-complete screen.
export function weekRow(p: Progress, t = today()) {
  const set = new Set(p.days), saved = new Set(p.tutor.saved);
  const L = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return Array.from({ length: 7 }, (_, i) => {
    const k = addDays(t, i - 6);
    return { day: k, letter: L[parseDay(k).getDay()], on: set.has(k), saved: saved.has(k), isToday: k === t };
  });
}

export const weekXp = (p: Progress, t = today()) =>
  Array.from({ length: 7 }, (_, i) => p.xpDays[addDays(t, -i)] || 0).reduce((a, b) => a + b, 0);

// ---- what can be played ----
export function hasQuestions(id: string) {
  if (LEVEL_OF[id]) return true;                      // a lesson level built from the pack (levels/index.ts)
  // A unit check is built from the bank (tutor/pick.ts checkRound) once every stop of its world has questions.
  const c = parseStopId(id);
  if (c && c.rest === 'check' && WORLDS[c.subject][c.world - 1]?.lessons.every((l) => stopItems(l.id).length > 0)) return true;
  return false;
}

/** The old one-question-loop lessons (no pack uses them): kept empty so Lesson.tsx falls through to levels. */
export function questionsFor(_id: string): { id: string; stem: string; opts: string[]; ans: number; why?: string[]; exp: string }[] {
  return [];
}

/** How many scored questions a lesson or unit check plays (a level's learn cards and warm-ups are not counted, so
    the number matches "Correct x of y" on the done screen). */
export const questionCount = (id: string) => (LEVEL_OF[id] ? LEVEL_OF[id].steps.filter((x) => x.graded !== false).length : questionsFor(id).length);

/** A level needs at least half of its scored questions right (rounded up) to open the next one. */
export const passNeed = (scored: number) => Math.ceil(scored / 2);

export const worldDone = (p: Progress, s: Subject, w: number) =>
  WORLDS[s][w - 1].lessons.every((l) => p.lessons[l.id]);
export const checkPassed = (p: Progress, s: Subject, w: number) => !!p.lessons[checkId(s, w)];
// A world opens when the check before it is passed, or when a placement check started the student there.
export const worldOpen = (p: Progress, s: Subject, w: number) => w === 1 || checkPassed(p, s, w - 1) || p.tutor.opened.includes(`${s}-${w}`);
export const openWorlds = (p: Progress, s: Subject) =>
  Array.from({ length: worldCount(s) }, (_, i) => i + 1).filter((w) => worldOpen(p, s, w)).length;

export type StopState = 'done' | 'current' | 'open' | 'locked' | 'soon';

// Lessons in an open world unlock one after another. The first unfinished one is "current".
export function lessonState(p: Progress, l: Lesson): StopState {
  if (p.lessons[l.id]) return 'done';
  if (!worldOpen(p, l.subject, l.world)) return 'locked';
  const prev = WORLDS[l.subject][l.world - 1].lessons[l.level - 2];
  if (prev && !p.lessons[prev.id]) return 'locked';
  return hasQuestions(l.id) ? 'current' : 'soon';
}

export function chestState(p: Progress, s: Subject, w: number): StopState {
  if (p.chests.includes(chestId(s, w))) return 'done';
  return worldOpen(p, s, w) && worldDone(p, s, w) ? 'current' : 'locked';
}

// The unit check opens after Level 5 and the reward chest, so only one stop pulses at a time.
export function checkState(p: Progress, s: Subject, w: number): StopState {
  if (checkPassed(p, s, w)) return 'done';
  if (!worldOpen(p, s, w) || !worldDone(p, s, w) || !p.chests.includes(chestId(s, w))) return 'locked';
  return hasQuestions(checkId(s, w)) ? 'current' : 'soon';
}

// The next thing to play in a subject (Home's Continue card, Review's "Next up").
export function nextUp(p: Progress, s: Subject) {
  for (const world of WORLDS[s]) {
    if (!worldOpen(p, s, world.n)) break;
    for (const l of world.lessons) {
      const st = lessonState(p, l);
      if (st === 'current' || st === 'soon') return { kind: 'lesson' as const, lesson: l, world, playable: st === 'current' };
    }
    if (!p.chests.includes(chestId(s, world.n))) return { kind: 'chest' as const, world, playable: true };
    if (!checkPassed(p, s, world.n)) {
      return { kind: 'check' as const, world, playable: hasQuestions(checkId(s, world.n)) };
    }
  }
  return null;
}

// ---- quests (reset every day) ----
export function quests(p: Progress, t = today()) {
  const claimed = p.quests.day === t ? p.quests.claimed : [];
  const list = [
    { id: 'answer', name: `Answer ${DAILY_GOAL} questions`, now: p.qDays[t] || 0, max: DAILY_GOAL, icon: 'target' },
    { id: 'run', name: 'Get 5 in a row', now: p.dayRun.day === t ? p.dayRun.best : 0, max: 5, icon: 'bolt' },
    { id: 'time', name: 'Practice for 10 minutes', now: Math.floor((p.secDays[t] || 0) / 60), max: 10, icon: 'clock' },
  ];
  return list.map((q) => ({ ...q, now: Math.min(q.now, q.max), done: q.now >= q.max, claimed: claimed.includes(q.id) }));
}

export function claimQuest(p: Progress, id: string, t = today()): { p: Progress; xp: number; badges: string[] } {
  const q = quests(p, t).find((x) => x.id === id);
  if (!q || !q.done || q.claimed) return { p, xp: 0, badges: [] };
  const claimed = p.quests.day === t ? p.quests.claimed : [];
  let n: Progress = { ...p, quests: { day: t, claimed: [...claimed, id] } };
  n = addXp(n, QUEST_XP, t);
  return withBadges(n, QUEST_XP, t);
}

export function openChest(p: Progress, s: Subject, w: number, t = today()): { p: Progress; xp: number; badges: string[] } {
  if (chestState(p, s, w) !== 'current') return { p, xp: 0, badges: [] };
  const n = addXp({ ...p, chests: [...p.chests, chestId(s, w)] }, CHEST_XP, t);
  return withBadges(n, CHEST_XP, t);
}

function addXp(p: Progress, xp: number, t: string): Progress {
  return { ...p, xp: p.xp + xp, xpDays: { ...p.xpDays, [t]: (p.xpDays[t] || 0) + xp } };
}

function withBadges(p: Progress, xp: number, t: string) {
  const { p: n, earned } = awardBadges(p, t);
  return { p: n, xp, badges: earned };
}

// ---- finishing a lesson, a unit check or a review round ----
export interface Answer { qid: string; correct: boolean; /** hints opened first */ hints?: number; /** the activity (tutor/model.ts guess rates) */ kind?: string;
  /** a self-rating's choice: 0 no, 1 maybe, 2 yes (placement's opening cards) */ v?: number;
  /** the choice picked on a multiple choice question (the answer log) */ pick?: number }
export interface Finish {
  id: string;                        // lesson id, unit check id, 'review', or a tutor round's id (tutor/pick.ts)
  kind: RoundKind;
  answers: Answer[];
  seconds: number;
  /** A 10-step level sets its own stars (1 for finishing, 2 for 80% right, 3 for 80%
      right and the boss question). */
  stars?: number;
  /** A level lesson: false when fewer than half of its scored questions were right (the level stays open to retry). */
  pass?: boolean;
  /** Played from the 3 built-in sample questions: never marks a real level or unit check complete, no XP. */
  sample?: boolean;
  /** Unit check: the keys of the world's own questions, which alone decide the pass (mixed-in and probe questions
      only inform the tutor). */
  core?: string[];
  /** Unit check: skills asked as building blocks under a weak skill. */
  probes?: string[];
  /** Guided review: the reasons picked for "what tripped you up?". */
  slips?: string[];
  /** The student's grade (placement leaves the grade 9 world out for others). */
  grade?: number | null;
  /** How many times "Why?" was opened after a right answer (a learning strength: curiosity). */
  whys?: number;
}
export interface Report {
  correct: number; total: number; xp: number; stars: number; passed: boolean;
  streakBefore: number; streakAfter: number; extended: boolean;
  badges: string[]; perfect: boolean;
  /** A lesson replayed after it was passed: no new XP (the lesson record keeps its best). */
  replay?: boolean;
  /** Played from the sample questions (nothing was marked complete). */
  sample?: boolean;
  /** What the tutor found (gaps, placement, skill check result); see tutor/round.ts. */
  tutor?: TutorReport;
  /** A streak save was earned by this round. */
  saveEarned?: boolean;
}

export function finish(p00: Progress, f: Finish, t = today()): { p: Progress; r: Report } {
  const p0 = useSaves(p00, t);
  const before = streak(p0, t);
  let p: Progress = { ...p0, lessons: { ...p0.lessons }, checks: { ...p0.checks }, mistakes: [...p0.mistakes] };
  const correct = f.answers.filter((a) => a.correct).length;
  const total = f.answers.length;
  const share = total ? correct / total : 0;

  // The labeled sample lesson counts for nothing: no Review mistakes, no daily question count, no XP, no streak.
  if (f.sample) {
    return {
      p: { ...p0, inProgress: null },
      r: { correct, total, xp: 0, stars: 0, passed: true, perfect: total > 0 && correct === total, streakBefore: before.n, streakAfter: before.n, extended: false, badges: [], replay: false, sample: true },
    };
  }

  // answers in order: runs, mistakes, fixes
  // todayRun: the same run, counting only answers given today (for the daily "5 in a row" quest)
  let run = p.run, bestRun = p.bestRun, dayBest = p.dayRun.day === t ? p.dayRun.best : 0;
  let todayRun = Math.min(p.run, p.qDays[t] || 0);
  for (const a of f.answers) {
    run = a.correct ? run + 1 : 0;
    todayRun = a.correct ? todayRun + 1 : 0;
    bestRun = Math.max(bestRun, run);
    dayBest = Math.max(dayBest, todayRun);
    const i = p.mistakes.findIndex((m) => m.qid === a.qid);
    if (f.kind === 'placement') continue;      // a placement check finds where to start; its misses are not mistakes
    if (!a.correct && i < 0) p.mistakes.push({ qid: a.qid, lessonId: f.id, at: t, due: t, good: 0 });
    else if (!a.correct && i >= 0) p.mistakes[i] = { ...p.mistakes[i], due: t, good: 0 };   // missed again: back to the start
    else if (a.correct && i >= 0 && f.kind === 'review') {
      const m = p.mistakes[i];
      if ((m.good || 0) >= 1 && m.due && m.due <= t) { p.mistakes.splice(i, 1); p.fixed += 1; }  // right again on a later day: fixed
      else p.mistakes[i] = { ...m, good: 1, due: addDays(t, 1) };                                              // right once: back tomorrow
    }
  }
  p = { ...p, run, bestRun, dayRun: { day: t, best: dayBest }, inProgress: null };
  p.qDays = { ...p.qDays, [t]: (p.qDays[t] || 0) + total };
  p.secDays = { ...p.secDays, [t]: (p.secDays[t] || 0) + Math.max(0, Math.round(f.seconds)) };

  // A lesson counts as passed with at least half right (f.pass, set by the level screen); the sample questions never count.
  const lessonPass = f.kind === 'lesson' && f.pass !== false && !f.sample;
  const stars = f.sample ? 0 : f.kind === 'lesson' && !lessonPass ? 0 : f.stars ?? (share === 1 ? 3 : share >= 0.75 ? 2 : 1);
  let passed = true;
  let replay = false;
  if (f.kind === 'lesson') {
    const old = p.lessons[f.id];
    passed = lessonPass;
    replay = lessonPass && !!old;
    if (lessonPass) p.lessons[f.id] = old
      ? { stars: Math.max(old.stars, stars), best: Math.max(old.best, correct), of: total, at: old.at, last: t }
      : { stars, best: correct, of: total, at: t, last: t };
    // A try below the pass line is remembered, so a retry is not a "new lesson" under the Free daily limit (limits.ts).
    else if (!f.sample && !old) p = { ...p, tried: { ...p.tried, [f.id]: t } };
  } else if (f.kind === 'check') {
    const core = f.core ? f.answers.filter((a) => f.core!.includes(a.qid)) : f.answers;
    const coreShare = core.length ? core.filter((a) => a.correct).length / core.length : 0;
    p.checks[f.id] = Math.max(p.checks[f.id] || 0, coreShare);
    passed = coreShare >= CHECK_PASS;
    if (passed && !p.lessons[f.id] && !f.sample) p.lessons[f.id] = { stars, best: correct, of: total, at: t };
  }

  // XP: once per level, when it is first passed (a replay or a retry that falls short earns none, so a level
  // cannot be farmed). Review rounds and unit checks keep paying per right answer.
  const xp = f.sample || (f.kind === 'lesson' && (!lessonPass || replay)) ? 0 : correct * XP_PER_CORRECT;
  p = addXp(p, xp, t);
  // A day counts after a passed lesson or STREAK_QUESTIONS answers (the sample never counts).
  if (!p.days.includes(t) && (lessonPass || (p.qDays[t] || 0) >= STREAK_QUESTIONS) && !f.sample) p.days = [...p.days, t].sort();
  // The tutor: beliefs, schedule, plan, and what this round found.
  const tr = tutorAfter(p, f, t);
  p = { ...p, tutor: tr.tutor };
  // A streak save: earned by more practice on a day that already counted, at most one a day, up to MAX_SAVES banked.
  let saveEarned = false;
  if (before.doneToday && total >= STREAK_QUESTIONS && p.tutor.saves < MAX_SAVES && p.tutor.savedOn !== t) {
    p = { ...p, tutor: { ...p.tutor, saves: p.tutor.saves + 1, savedOn: t } };
    saveEarned = true;
  }
  const after = streak(p, t);
  const { p: n, earned } = awardBadges(p, t);
  return {
    p: n,
    r: {
      correct, total, xp, stars, passed, perfect: total > 0 && correct === total,
      streakBefore: before.n, streakAfter: after.n, extended: !before.doneToday && after.doneToday,
      badges: earned, replay, sample: !!f.sample, tutor: tr.report, saveEarned,
    },
  };
}

// ---- badges ----
// Progress toward each badge: { now, max }. The art and copy live in badges.ts.
export function badgeProgress(p: Progress): Record<string, { now: number; max: number; note?: string }> {
  const best = bestStreak(p);
  const doneIn = (s: Subject, w: number) => WORLDS[s][w - 1].lessons.filter((l) => p.lessons[l.id]).length;
  const lessonsDone = Object.keys(p.lessons).filter((k) => LESSONS[k]).length;
  const bestLesson = Object.entries(p.lessons).filter(([k]) => LESSONS[k])
    .reduce((m, [, r]) => (r.of && r.best / r.of > m.share ? { share: r.best / r.of, best: r.best, of: r.of } : m), { share: -1, best: 0, of: 0 });
  const readingSets = Object.keys(p.lessons).filter((k) => LEVEL_OF[k]?.steps.some((s) => s.pid)).length + p.reading;
  const firstWorld = SUBJECTS.reduce((m, s) => Math.max(m, WORLDS[s][0] ? doneIn(s, 1) : 0), 0);
  const worldsDone = SUBJECTS.reduce((m, s) => Math.max(m, ...WORLDS[s].map((w) => doneIn(s, w.n) + (checkPassed(p, s, w.n) ? 1 : 0)), 0), 0);
  const worldMax = Math.min(...SUBJECTS.flatMap((s) => WORLDS[s].map((w) => w.lessons.length + 1)), 99);
  const travel = SUBJECTS.reduce((m, s) => Math.max(m, openWorlds(p, s) / Math.max(1, worldCount(s))), 0);
  return {
    'first-steps': { now: Math.min(lessonsDone, 1), max: 1 },
    'first-flame': { now: Math.min(best, 3), max: 3 },
    'week-warrior': { now: Math.min(best, 7), max: 7 },
    'steady-studier': { now: Math.min(best, 30), max: 30 },
    'park-explorer': { now: Math.min(firstWorld, 2), max: 2 },
    'grammar-guardian': { now: Math.min(worldsDone, worldMax), max: worldMax },
    'world-traveler': { now: Math.round(travel * 100), max: 100 },
    'bookworm': { now: Math.min(readingSets, 5), max: 5 },
    'hot-streak': { now: Math.min(p.bestRun, 5), max: 5 },
    'perfect-lesson': bestLesson.share === 1
      ? { now: 1, max: 1 }
      : { now: 0, max: 1, note: bestLesson.of ? `Best: ${bestLesson.best} of ${bestLesson.of}` : undefined },
    'comeback-kid': { now: Math.min(p.fixed, 10), max: 10 },
    'test-day-ready': { now: p.tests.some((x) => config.fullTest.timeOptions.find((o) => o.id === x.mode)?.factor != null) ? 1 : 0, max: 1 },
    'xp-1000': { now: Math.min(p.xp, 1000), max: 1000 },
    'full-length': { now: Math.min(p.fullTests, 1), max: 1 },
  };
}

// Badges that cannot move yet while only the sample questions exist (no ELA, worlds 2-6, reading sets,
// test tools or full test). Me and Home leave them out of "almost there".
export const SAMPLE_SOON = new Set<string>();

export function awardBadges(p: Progress, t = today()) {
  const prog = badgeProgress(p);
  const earned = Object.entries(prog).filter(([id, b]) => b.now >= b.max && !p.badges[id]).map(([id]) => id);
  if (!earned.length) return { p, earned };
  const badges = { ...p.badges };
  for (const id of earned) badges[id] = t;
  return { p: { ...p, badges }, earned };
}

// ---- Review: one row per world ("skill"), levels finished out of 5 ----
export function skills(p: Progress, s: Subject) {
  return WORLDS[s].map((w) => {
    const done = w.lessons.filter((l) => p.lessons[l.id]).length;
    const next = w.lessons.find((l) => !p.lessons[l.id]) || null;
    return { world: w, done, next, open: worldOpen(p, s, w.n) };
  });
}

/** Missed questions that can be redone today (the rest come back on their `due` day). */
export const dueMistakes = (p: Progress, t = today()) => p.mistakes.filter((m) => !m.due || m.due <= t);
/** One Review round redoes at most this many, the longest-waiting first, so a pile of misses never becomes one long
    round (the rest come in the next round). */
export const REVIEW_ROUND = config.practice.reviewRound;
export const reviewRound = (p: Progress, t = today()) =>
  dueMistakes(p, t).slice().sort((a, b) => (a.due || a.at).localeCompare(b.due || b.at)).slice(0, REVIEW_ROUND);
export const laterMistakes = (p: Progress, t = today()) => p.mistakes.filter((m) => m.due && m.due > t);

export const questionById = (_id: string) => null;
export const mistakeQuestions = (_p: Progress) => [] as ReturnType<typeof questionsFor>;
