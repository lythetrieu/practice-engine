// Which questions a tutor round plays: the placement check, a world's unit check with its gap probe,
// the skill check after a lesson, a practice set from weak and due skills, and the guided mistake review.
// Adaptive rounds hand the screen a `more` function: after the last question it is asked for the next one, with every
// answer so far, and it rebuilds the beliefs from those answers (so a resumed round picks exactly as before).
import { LESSONS, WORLDS, isSubject, parseStopId, type Subject } from '../curriculum';
import { stopItems, levelOf, stepById, type PoolItem } from '../levels/index';
import type { Step, ReflectStep, RateStep } from '../levels/types';
import type { Item } from '../screens/Level';
import type { Answer, Mistake } from '../store';
import { ancestors, descendants, stopsOf } from './graph';
import { observe, beliefs, dueSkills, openPlan, stopOfKey, mayShow, type Tutor, type Slip } from './model';

/** The student's history, so a question already answered right, or shown twice, waits behind the fresh ones. Set by
    the lesson screen before it builds a round. */
let HISTORY: Tutor | null = null;
export const setHistory = (t: Tutor | null) => { HISTORY = t; };

export type More = (answers: Answer[], items: Item[]) => Item[];
export interface Round { items: Item[]; more?: More; core?: string[] }

const TAG = { earlier: 'From an earlier world', again: 'One more like this', block: 'Building block' };

/** A small stable hash, so ties between equal questions break the same way each time for the same seed. */
const hash = (s: string, seed: number) => { let h = seed | 0; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761); return (h >>> 0) / 4294967296; };

interface PickOpts { target: number; exclude: Set<string>; pids?: Set<string>; seed?: number; avoidLevel?: boolean }
/** The best unused question of a stop for a target level: close to the level, on a passage already open if possible,
    our own questions first, not one the student just saw in the stop's level. */
export function pickItem(stop: string, o: PickOpts): PoolItem | null {
  const lvKeys = o.avoidLevel ? new Set((levelOf(stop)?.steps || []).map((s) => `${stop}/${s.id}`)) : null;
  let best: PoolItem | null = null, bestScore = Infinity;
  for (const x of stopItems(stop)) {
    if (o.exclude.has(x.key)) continue;
    let sc = Math.abs(x.d - o.target) * 2 + hash(x.key, o.seed ?? 7) * 0.5;
    if (x.pid && o.pids && !o.pids.has(x.pid)) sc += o.pids.size ? 3 : 0.5;   // a new passage to read costs time
    if (!x.own) sc += 0.5;
    if (lvKeys?.has(x.key)) sc += 1.5;
    if (HISTORY && !mayShow(HISTORY, x.key)) sc += 8;   // only when nothing fresh is left
    if (sc < bestScore) { best = x; bestScore = sc; }
  }
  return best;
}

const asItem = (x: PoolItem, tag?: string): Item => ({ key: x.key, step: { ...x.step, stage: 'practice' } as Step, ...(tag ? { tag } : {}) });

/** Beliefs and bookkeeping after the answers so far. */
function replay(base: Record<string, number>, items: Item[], answers: Answer[]) {
  let k = { ...base };
  const asked: Record<string, number> = {}, right: Record<string, number> = {};
  for (const a of answers) {
    const it = items.find((x) => x.key === a.qid);
    const stop = stopOfKey(a.qid);
    if (!it || !stop || it.step.graded === false) continue;
    k = observe(k, { stop, correct: a.correct, kind: it.step.kind, hints: a.hints });
    asked[stop] = (asked[stop] || 0) + 1;
    if (a.correct) right[stop] = (right[stop] || 0) + 1;
  }
  const keys = new Set(items.map((x) => x.key.split(':').pop()!));   // a self-rating card's question counts as used
  const pids = new Set(items.map((x) => x.step.pid).filter(Boolean) as string[]);
  return { k, asked, right, keys, pids };
}

/** The next skill to ask about among `cands`: the one whose answer would tell the most. A skill near 50/50 that many
    other uncertain skills build on, or build on, splits the possibilities best (the middle of the map comes first). */
function nextProbe(cands: string[], k: Record<string, number>, asked: Record<string, number>, has: (s: string) => boolean, maxPer = 2): string | null {
  const unsure = (s: string) => { const v = k[s] ?? 0.5; return v > 0.15 && v < 0.85; };
  let best: string | null = null, bestScore = 0;
  for (const s of cands) {
    const v = k[s] ?? 0.5;
    // past the limit only while still near 50/50 (one more question then settles it), never past 2
    if ((asked[s] || 0) >= Math.max(maxPer, v > 0.3 && v < 0.7 ? 2 : 0) || !unsure(s) || !has(s)) continue;
    const reach = 1 + 0.5 * ancestors(s).filter((x) => cands.includes(x) && unsure(x)).length + 0.5 * descendants(s).filter((x) => cands.includes(x) && unsure(x)).length;
    const score = v * (1 - v) * reach * (asked[s] ? 0.6 : 1);
    if (score > bestScore + 1e-9) { best = s; bestScore = score; }
  }
  return best;
}

// ---- placement ----
/** The most questions a placement asks (it often ends sooner: a student who clearly misses the first world needs no more). */
export const PLACEMENT_LEN: Record<Subject, number> = new Proxy({}, { get: () => 10 }) as Record<Subject, number>;
export const placementId = (s: Subject) => `placement-${s}`;
export const placementSubject = (id: string): Subject | null => { const s = id.startsWith('placement-') ? id.slice(10) : ''; return isSubject(s) ? s : null; };

/** The stops a placement check covers: the subject's map (the grade 9 world only for 9th graders). */
export function placementStops(s: Subject, grade: number | null): string[] {
  return stopsOf(s).filter((id) => stopItems(id).length > 0);
}

// Belief cut-offs (a skill's k, after the saved rounding). They are read off the model's answer ladder for a choice
// question: one miss 0.19, miss then right 0.43, right then miss 0.44, one right 0.77, two rights 0.96.
const WEAK = 0.45;      // below this a skill counts against the student: it decides the world to start in
const DOUBT = 0.5;      // an asked skill below this is not settled yet: ask it again
const SETTLED = 0.1;    // below this a skill has been missed twice: no need to ask again
const SURE = 0.6;       // an asked skill at or above this counts as a right answer when a world is confirmed
const VOUCHED = 0.8;    // a skill at or above this needs no confirming question
const FIRM = 0.85;      // belief after one right answer of a kind: guessable choice questions fall below it, typed or fill-in ones do not
const MAX_ASK = 3;      // questions on one skill
const CONFIRM = 2;      // right answers on different skills that settle a world
const NEAR = 4;         // the same for the world just before the first gap: the likeliest place for a lucky guess, so it gets the most
const RESERVE = 2;      // a confirming question is asked only while two more can still follow it (to re-ask a miss)

/** Placement is a walk down the map, world by world, that stops as soon as it knows the world to start in:
    1. One question in each world, in order, on its deepest skill (a right answer there speaks for the skills under it).
    2. A right answer can be a guess, so the worlds before the first gap get confirming questions on other skills, the
       world just before the gap most of all, and the kind of question that is hardest to guess is preferred.
    3. A miss can be a slip: the missed skill is asked again (up to 3 times) before it decides the start.
    Nothing is asked after the first world with a settled gap, since it cannot change where the student starts. */
/** Placement opens with a few "Could you solve this?" cards (No / Maybe / Yes), each a real question shown as a
    picture: the first in the middle of the map, the next above or below it by the answer. They only set where the
    graded questions start looking. Only lessons with stand-alone questions are rated (a reading question needs its passage). */
export const RATE_N: Record<Subject, number> = new Proxy({}, { get: () => 3 }) as Record<Subject, number>;
export const isRateKey = (key: string) => key.startsWith('rate:');

export function placementRound(s: Subject, t: Tutor, grade: number | null): Round | null {
  const cands = placementStops(s, grade);
  if (!cands.length) return null;
  const base0 = Object.fromEntries(cands.map((c) => [c, t.skills[c]?.k ?? 0.5]));
  const rateCands = cands.filter((c) => stopItems(c).some((x) => !x.pid));
  const more: More = (answers, items) => {
    // the self-ratings first: they move the starting beliefs, weakly (tutor/model.ts GUESS.rate)
    const rated = answers.filter((a) => isRateKey(a.qid) && typeof a.v === 'number');
    let base = base0;
    for (const a of rated) if (a.v !== 1) base = observe(base, { stop: a.qid.split(':')[1], correct: a.v === 2, kind: 'rate' });
    if (rated.length < RATE_N[s] && answers.length === rated.length) {
      const done = new Set(rated.map((a) => a.qid.split(':')[1]));
      const shown = new Set(items.map((x) => x.key.split(':').pop()!));
      const has = (c: string) => !!pickItem(c, { target: 3, exclude: shown });
      const stop = nextProbe(rateCands.filter((c) => !done.has(c)), base, {}, has);
      const x = stop ? pickItem(stop, { target: 3, exclude: shown, seed: rated.length }) : null;
      if (x) {
        const step: RateStep = { id: 'rate-' + x.step.id, kind: 'rate', stage: 'practice', graded: false, prompt: 'Could you solve this one?', exp: '', of: { ...x.step, stage: 'practice' } as Step };
        return [{ key: `rate:${stop}:${x.key}`, step, tag: 'Quick question' }];
      }
    }
    const given = answers.filter((a) => items.find((x) => x.key === a.qid)?.step.graded !== false).length;
    if (given >= PLACEMENT_LEN[s]) return [];
    const room = PLACEMENT_LEN[s] - given;
    const st = replay(base, items, answers);
    const has = (c: string) => !!pickItem(c, { target: 3, exclude: st.keys, pids: st.pids });
    const worldOf = (c: string) => LESSONS[c].world;
    const kOf = (c: string) => Math.round((st.k[c] ?? 0.5) * 100) / 100;   // the saved belief is rounded the same way
    const worlds = [...new Set(cands.map(worldOf))].sort((a, b) => a - b);
    const inWorld = (w: number) => cands.filter((c) => worldOf(c) === w);
    const under = (c: string) => ancestors(c).filter((a) => cands.includes(a) && worldOf(a) === worldOf(c)).length;   // skills it builds on in its own world
    const doubt = (c: string) => kOf(c) < WEAK || (!!st.asked[c] && kOf(c) < DOUBT);
    const gap = worlds.find((w) => inWorld(w).some(doubt));   // the first world that shows a gap
    const upto = worlds.filter((w) => gap === undefined || w <= gap);
    let stop: string | null = null;
    // 1. one question in each world, on its deepest skill
    const todo = upto.find((w) => !inWorld(w).some((c) => st.asked[c]));
    if (todo !== undefined) stop = inWorld(todo).filter(has).sort((a, b) => under(b) - under(a) || kOf(a) - kOf(b))[0] ?? null;
    // 2. confirm the worlds before the gap
    const near = gap === undefined ? undefined : upto.filter((w) => w < gap).pop();   // the world just before the gap: the likeliest lucky guess
    if (stop === null && room > RESERVE) for (const w of near === undefined ? upto : [near, ...upto]) {
      if (w === gap) continue;
      const ws = inWorld(w);
      if (ws.filter((c) => st.right[c] && kOf(c) >= SURE).length >= (w === near ? NEAR : CONFIRM)) continue;
      stop = ws.filter((c) => !st.asked[c] && kOf(c) < VOUCHED && has(c)).sort((a, b) => kOf(a) - kOf(b) || under(b) - under(a))[0]
        ?? nextProbe(ws, st.k, st.asked, has, MAX_ASK);
      if (stop) break;
    }
    // 3. re-ask a skill of the gap world that is missed or unsettled
    if (stop === null && gap !== undefined) {
      stop = inWorld(gap).filter((c) => (st.asked[c] || 0) < MAX_ASK && doubt(c) && kOf(c) > SETTLED && has(c))
        .sort((a, b) => (st.asked[b] || 0) - (st.asked[a] || 0) || kOf(a) - kOf(b))[0] ?? null;
    }
    // 4. a student with no gap in sight: the most telling skill anywhere
    if (stop === null && gap === undefined && room > RESERVE) stop = nextProbe(cands, st.k, st.asked, has);
    if (!stop) return [];
    // Prefer a question that is hard to get right by guessing (typed or fill-in over a choice) when the skill has one:
    // a right answer to it says more. The model's own reading of a right answer ranks the kinds.
    const firm = (x: PoolItem) => observe({}, { stop: stop!, correct: true, kind: x.step.kind })[stop!] >= FIRM;
    const soft = new Set(stopItems(stop).filter((x) => !firm(x)).map((x) => x.key));
    const x = (soft.size ? pickItem(stop, { target: 3, exclude: new Set([...st.keys, ...soft]), pids: st.pids, seed: answers.length }) : null)
      ?? pickItem(stop, { target: 3, exclude: st.keys, pids: st.pids, seed: answers.length });
    return x ? [asItem(x)] : [];
  };
  const first = more([], []);
  return first.length ? { items: first, more } : null;
}

/** Where a placement puts the student: the first world (in map order) with a skill the student missed, and in it the
    first skill not shown to be known, since a world's levels build on each other. */
export function placementResult(s: Subject, t: Tutor, grade: number | null) {
  const cands = placementStops(s, grade);
  const k = beliefs(t);
  // Known needs two choice answers right (0.96) or one typed one; a gap needs two misses (0.05), not one (0.19, maybe a slip).
  const known = cands.filter((c) => (k[c] ?? 0.5) >= 0.9);
  const gaps = cands.filter((c) => (k[c] ?? 0.5) < 0.15);
  const order = WORLDS[s].flatMap((w) => w.lessons.map((l) => l.id)).filter((id) => cands.includes(id));
  const weak = order.find((id) => (k[id] ?? 0.5) < WEAK);
  const w = weak ? LESSONS[weak].world : 0;
  const start = weak ? order.find((id) => LESSONS[id].world === w && ((k[id] ?? 0.5) < 0.8 || id === weak)) ?? weak : null;
  return { known, gaps, start };
}

// ---- unit check with the gap probe ----
/** A unit check id ("<section>-<world>-check") as [id, section, world], or null. */
export const CHECK_RE = { exec: (id: string): [string, string, string] | null => { const x = parseStopId(id); return x && x.rest === 'check' ? [id, x.subject, String(x.world)] : null; } };
const MAX_PROBES = 6, MAX_AGAIN = 2;

export function checkRound(s: Subject, w: number, t: Tutor, seed = 1): Round | null {
  const world = WORLDS[s][w - 1];
  if (!world) return null;
  const stops = world.lessons.map((l) => l.id).filter((id) => stopItems(id).length > 0);
  if (stops.length < world.lessons.length) return null;     // every stop needs questions
  const exclude = new Set<string>(), pids = new Set<string>();
  const take = (stop: string, target: number, tag?: string) => {
    const x = pickItem(stop, { target, exclude, pids, seed, avoidLevel: true });
    if (!x) return null;
    exclude.add(x.key); if (x.pid) pids.add(x.pid);
    return asItem(x, tag);
  };
  // Two questions per stop of the world, one easier and one harder.
  const firsts = stops.map((st) => take(st, 2.5)), seconds = stops.map((st) => take(st, 3.5));
  let core = [...firsts, ...seconds].filter(Boolean) as Item[];
  // Reading worlds: keep a passage's questions together, so it is read once.
  if (core.some((x) => x.step.pid)) core = core.sort((a, b) => (a.step.pid || '').localeCompare(b.step.pid || ''));
  // Mixed in: two from earlier worlds the student has practiced, weakest or most overdue first (interleaving).
  const earlier = Object.entries(t.skills)
    .filter(([id]) => LESSONS[id]?.subject === s && LESSONS[id].world < w && stopItems(id).length)
    .sort(([, a], [, b]) => a.k - b.k || (a.due || '').localeCompare(b.due || '')).slice(0, 2)
    .map(([id]) => take(id, 3, TAG.earlier)).filter(Boolean) as Item[];
  if (!core.length) return null;
  const items = [...core.slice(0, Math.ceil(core.length / 2)), ...earlier.slice(0, 1), ...core.slice(Math.ceil(core.length / 2)), ...earlier.slice(1)];
  const base = beliefs(t);
  const coreKeys = core.map((x) => x.key);
  const more: More = (answers, all) => {
    const st = replay(base, all, answers);
    const tags = all.map((x) => x.tag);
    const again = tags.filter((x) => x === TAG.again).length, probes = tags.filter((x) => x === TAG.block).length;
    // 1. A stop with one right and one wrong: one more of the same skill, a different question (a lucky guess or a slip?)
    if (again < MAX_AGAIN) {
      const mixed = stops.find((id) => st.asked[id] === 2 && st.right[id] === 1);
      if (mixed) { const x = pickItem(mixed, { target: 3, exclude: st.keys, pids: st.pids, seed }); if (x) return [asItem(x, TAG.again)]; }
    }
    // 2. Weak stops: look under them on the skill map for the missing building block.
    if (probes >= MAX_PROBES) return [];
    const weak = stops.filter((id) => (st.k[id] ?? 0.5) < 0.5);
    if (!weak.length) return [];
    const cands = [...new Set(weak.flatMap(ancestors))];
    const has = (c: string) => !!pickItem(c, { target: 2.5, exclude: st.keys, pids: st.pids });
    const stop = nextProbe(cands, st.k, st.asked, has, 1);
    if (!stop) return [];
    const x = pickItem(stop, { target: 2.5, exclude: st.keys, pids: st.pids, seed });
    return x ? [asItem(x, TAG.block)] : [];
  };
  return { items, more, core: coreKeys };
}

// ---- skill check after a lesson ----
export const SKILL_LEN = 3;
export const skillId = (stop: string) => `skill-${stop}`;
export const skillStop = (id: string) => (id.startsWith('skill-') && LESSONS[id.slice(6)] ? id.slice(6) : null);

/** `avoid`: questions to leave out when the pool allows (a retry after missed ones gets new questions). */
export function skillRound(stop: string, seed = 1, avoid: string[] = []): Round | null {
  const pool = stopItems(stop).length;
  const exclude = new Set<string>(pool - avoid.length >= 3 ? avoid : []), pids = new Set<string>(), items: Item[] = [];
  for (const target of [2.5, 3, 3.5]) {
    const x = pickItem(stop, { target, exclude, pids, seed, avoidLevel: true });
    if (!x) break;
    exclude.add(x.key); if (x.pid) pids.add(x.pid);
    items.push(asItem(x));
  }
  return items.length >= 2 ? { items } : null;
}

// ---- practice from weak and due skills ----
export const PRACTICE_ID = 'practice';
/** The skills a practice set works on today, and why each one is in it. */
export function practicePlan(t: Tutor, day: string, subject?: Subject): { stop: string; why: 'due' | 'plan' | 'weak' }[] {
  const ok = (id: string) => !!LESSONS[id] && (!subject || LESSONS[id].subject === subject) && stopItems(id).length > 0;
  const out: { stop: string; why: 'due' | 'plan' | 'weak' }[] = [];
  const add = (stop: string, why: 'due' | 'plan' | 'weak') => { if (ok(stop) && !out.some((x) => x.stop === stop)) out.push({ stop, why }); };
  for (const s of dueSkills(t, day).slice(0, 3)) add(s, 'due');
  for (const p of openPlan(t)) if (out.length < 4 && t.skills[p.stop]) add(p.stop, 'plan');
  const weak = Object.entries(t.skills).filter(([, r]) => r.k < 0.7).sort(([, a], [, b]) => a.k - b.k).map(([s]) => s);
  for (const s of weak) if (out.length < 4) add(s, 'weak');
  return out;
}

export function practiceRound(t: Tutor, day: string, subject?: Subject, seed = 1): Round | null {
  const plan = practicePlan(t, day, subject);
  if (!plan.length) return null;
  const exclude = new Set<string>(), pids = new Set<string>();
  const rows = plan.map(({ stop }) => {
    const k = t.skills[stop]?.k ?? 0.5, target = k < 0.5 ? 2 : k < 0.8 ? 3 : 4;
    return [0, 1].map(() => {
      const x = pickItem(stop, { target, exclude, pids, seed, avoidLevel: true });
      if (x) { exclude.add(x.key); if (x.pid) pids.add(x.pid); }
      return x ? asItem(x) : null;
    }).filter(Boolean) as Item[];
  });
  // Mixed, not blocked: one of each skill, then the second of each.
  const items = [...rows.map((r) => r[0]), ...rows.map((r) => r[1])].filter(Boolean);
  return items.length ? { items } : null;
}

// ---- guided mistake review ----
export const FIX_ID = 'fix';
// Two sets of reasons: one for problems to work out, one for questions about a text (a passage or a sentence).
const SLIPS: Record<'solve' | 'text', { slip: Slip; text: string; tip: string }[]> = {
  solve: [
    { slip: 'misread', text: 'I misread the question', tip: 'Before you solve, say in your head what the question asks for. Circle the units and words like "not" or "each".' },
    { slip: 'slip', text: 'I made a small mistake', tip: 'Check one step at a time, and put your answer back into the problem to see if it works.' },
    { slip: 'start', text: 'I didn’t know how to start', tip: 'Write down what you know and what you need. Then look for a rule or formula that links them.' },
    { slip: 'guess', text: 'I guessed', tip: 'Guessing is fine on test day, but here it hides what you know. Try the next one step by step.' },
  ],
  text: [
    { slip: 'misread', text: 'I misread the question', tip: 'Read the question twice before the choices. Notice words like "best", "most likely" and "except".' },
    { slip: 'evidence', text: 'I didn’t check the text', tip: 'Find the sentence that proves your answer before you pick it. If you can’t point to it, look again.' },
    { slip: 'start', text: 'I didn’t know the rule', tip: 'Look back at the rule in this skill’s lesson, then try the next one.' },
    { slip: 'guess', text: 'I guessed', tip: 'Cross out the choices you know are wrong first. Then compare the ones left with the text.' },
  ],
};

/** A missed question with "what tripped you up?", then a similar question of the same skill. Up to 3 mistakes. */
export function fixRound(mistakes: Mistake[], seed = 1): Round | null {
  const items: Item[] = [], exclude = new Set(mistakes.map((m) => m.qid)), pids = new Set<string>();
  for (const m of mistakes) {
    if (items.length >= 6) break;
    const orig = stepById(m.qid);
    if (!orig || orig.kind === 'learn' || orig.kind === 'sprint') continue;
    const stop = stopOfKey(m.qid);
    const choices = SLIPS[orig.pid || orig.box || orig.kind === 'hot' || orig.kind === 'inline' ? 'text' : 'solve'];
    const reflect: ReflectStep = {
      id: 'reflect-' + orig.id, kind: 'reflect', stage: 'practice', graded: false, prompt: 'What tripped you up on this one?', exp: orig.exp,
      of: orig, opts: choices.map((c) => c.text), tips: choices.map((c) => c.tip), slips: choices.map((c) => c.slip),
      ...(orig.pid ? { pid: orig.pid } : {}),
    };
    items.push({ key: `reflect:${m.qid}`, step: reflect, tag: 'Look back' });
    if (stop) {
      const d = stopItems(stop).find((x) => x.key === m.qid)?.d ?? 3;
      const x = pickItem(stop, { target: d, exclude, pids, seed });
      if (x) { exclude.add(x.key); if (x.pid) pids.add(x.pid); items.push(asItem(x, 'Try a similar one')); }
    }
  }
  return items.length ? { items } : null;
}

