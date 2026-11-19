// A full practice test made from the pack: for each section of pack.yaml `fullTest`, `questions` questions of that
// section. Pure and seeded (the same seed gives the same test), so a saved test can be rebuilt and checked in tests.
//
// How the questions are picked, per section:
// 1. Units: the questions of one passage form one unit (a student reads a passage once); every other question is its
//    own unit.
// 2. Freshness: a question answered right before costs 2, one seen before costs 1. Units are shuffled with the seed,
//    then the freshest come first.
// 3. Blueprint: each skill gets a quota, the section's `skills` from pack.yaml, or else its share of the section's
//    questions (largest remainder). A unit is taken while it fits the space left and helps a quota still open.
// 4. Fill: if the quotas leave space, the freshest units left fill it. A passage that does not fit gives the questions
//    that do, easy to hard.
// 5. Order: stand-alone questions first, easy to hard, then the passage sets.
import { config } from '../../pack';
import type { BankItem } from '../../pack/types';

export interface ExamSection {
  id: string;
  /** Seconds on this section's own clock (per-section timing), null when the test has one clock or no clock. */
  seconds: number | null;
  allowBack: boolean;
  items: string[];
}
export interface ExamPlan {
  id: string;
  seed: number;
  /** The time option picked (pack fullTest.timeOptions[].id). */
  mode: string;
  timing: 'total' | 'per-section';
  /** Seconds on the one clock (total timing), null otherwise. */
  totalSeconds: number | null;
  sections: ExamSection[];
}
/** What the student has done with a question before: tries and right answers. */
export type Seen = Record<string, { n: number; right: number }>;

function rng(seed: number) {
  let x = (seed * 2654435761) >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
}
function shuffle<T>(a: T[], r: () => number) {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** Each skill's share of n, rounded so the shares add up to n (largest remainder). */
export function quotas(counts: Record<string, number>, n: number): Record<string, number> {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return {};
  const raw = Object.entries(counts).map(([k, c]) => ({ k, q: (c / total) * n }));
  const out: Record<string, number> = Object.fromEntries(raw.map((x) => [x.k, Math.floor(x.q)]));
  let left = n - Object.values(out).reduce((a, b) => a + b, 0);
  for (const x of raw.sort((a, b) => (b.q % 1) - (a.q % 1) || a.k.localeCompare(b.k))) { if (left <= 0) break; out[x.k] += 1; left -= 1; }
  return out;
}

/** Picks one section's questions. */
export function pickSection(pool: BankItem[], n: number, seed: number, seen: Seen = {}, blueprint?: Record<string, number>): BankItem[] {
  const r = rng(seed);
  const cost = (it: BankItem) => (seen[it.id]?.right ? 2 : seen[it.id] ? 1 : 0);
  const byPid = new Map<string, BankItem[]>();
  const units: BankItem[][] = [];
  for (const it of pool) {
    if (!it.pid) { units.push([it]); continue; }
    if (!byPid.has(it.pid)) { byPid.set(it.pid, []); units.push(byPid.get(it.pid)!); }
    byPid.get(it.pid)!.push(it);
  }
  for (const u of units) u.sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
  const avg = (u: BankItem[]) => u.reduce((a, it) => a + cost(it), 0) / u.length;
  const order = shuffle(units, r).map((u, i) => ({ u, i, c: avg(u) })).sort((a, b) => a.c - b.c || a.i - b.i).map((x) => x.u);

  const counts: Record<string, number> = {};
  for (const it of pool) counts[it.skill] = (counts[it.skill] || 0) + 1;
  const quota = blueprint ? { ...blueprint } : quotas(counts, n);
  const taken: BankItem[] = [];
  const used = new Set<BankItem[]>();
  const room = () => n - taken.length;
  const helps = (u: BankItem[]) => u.some((it) => (quota[it.skill] || 0) > 0);
  const take = (u: BankItem[], k = u.length) => {
    for (const it of u.slice(0, k)) { taken.push(it); if (quota[it.skill]) quota[it.skill] -= 1; }
    used.add(u);
  };
  // quotas first: whole units that fit
  for (const u of order) { if (room() <= 0) break; if (u.length <= room() && helps(u)) take(u); }
  // with a blueprint, an open quota may still be met by part of a passage
  if (blueprint) for (const u of order) { if (room() <= 0) break; if (!used.has(u) && helps(u)) take(u, Math.min(room(), u.filter((it) => (quota[it.skill] || 0) > 0).length || 1)); }
  // fill: whole units, then part of one
  for (const u of order) { if (room() <= 0) break; if (!used.has(u) && u.length <= room()) take(u); }
  for (const u of order) { if (room() <= 0) break; if (!used.has(u)) take(u, room()); }

  const solo = taken.filter((it) => !it.pid).sort((a, b) => a.d - b.d || a.id.localeCompare(b.id));
  const sets = [...new Set(taken.filter((it) => it.pid).map((it) => it.pid!))];
  return [...solo, ...sets.flatMap((pid) => taken.filter((it) => it.pid === pid))];
}

/** A whole test. `first`: the section to start with when the pack lets the student choose. */
export function buildExam(items: BankItem[], opts: { seed: number; mode: string; first?: string; seen?: Seen; id?: string }): ExamPlan {
  const t = config.fullTest;
  const option = t.timeOptions.find((o) => o.id === opts.mode) ?? t.timeOptions[0];
  const factor = option.factor;   // null: no clock
  let secs = t.sections;
  if (t.sectionOrder === 'choose' && opts.first) secs = [...secs.filter((s) => s.section === opts.first), ...secs.filter((s) => s.section !== opts.first)];
  const sections = secs.map((s, k) => {
    const pool = items.filter((it) => it.section === s.section && it.step.graded !== false);
    const picked = pickSection(pool, s.questions, opts.seed * 31 + k, opts.seen, s.skills);
    return {
      id: s.section,
      seconds: t.timing === 'per-section' && factor !== null && s.minutes ? Math.round(s.minutes * 60 * factor) : null,
      allowBack: s.allowBack,
      items: picked.map((it) => it.id),
    };
  });
  return {
    id: opts.id ?? `T${opts.seed.toString(36)}`,
    seed: opts.seed,
    mode: option.id,
    timing: t.timing,
    totalSeconds: t.timing === 'total' && factor !== null && t.minutes ? Math.round(t.minutes * 60 * factor) : null,
    sections,
  };
}

/** The test's size and time for the intro screen: questions in all, and minutes for a time option (null = no clock). */
export function examSize(mode: string): { questions: number; minutes: number | null } {
  const t = config.fullTest;
  const option = t.timeOptions.find((o) => o.id === mode) ?? t.timeOptions[0];
  const questions = t.sections.reduce((a, s) => a + s.questions, 0);
  if (option.factor === null) return { questions, minutes: null };
  const base = t.timing === 'total' ? t.minutes || 0 : t.sections.reduce((a, s) => a + (s.minutes || 0), 0);
  return { questions, minutes: Math.round(base * option.factor) };
}
