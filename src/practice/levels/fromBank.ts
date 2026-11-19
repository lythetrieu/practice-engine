// Builds a map lesson's level from the pack's questions: the questions of the lesson's skills, easy to hard,
// different activities first, the hardest one last as the "boss". A lesson with teaching steps (curriculum.yaml
// `teach`) opens with them: warm-up, learn card, guided steps, then practice, find-the-mistake, and the boss.
import type { Step, Level } from './types';
import type { BankItem, BankPassage, Teach } from '../../pack/types';
import type { Lesson } from '../curriculum';
import { LESSON_QUESTIONS } from '../curriculum';

export type { BankItem, BankPassage, Teach };

/** Every question a lesson can use: the scored questions of its skills. */
export function stopPool(lesson: Lesson, items: BankItem[]) {
  return items.filter((it) => lesson.skills.includes(it.skill) && it.step.graded !== false).map((it) => ({ it, step: it.step }));
}

/** A small seeded shuffle, so a replay of a lesson gets a different but repeatable mix. */
function shuffled<T>(a: T[], seed: number) {
  const out = [...a]; let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; const j = (x >>> 0) % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** A reading lesson stays with ONE passage when it can, so the student reads it once and answers several questions:
    the shortest passage with enough questions (first play) or the seed's pick (a replay); when none has enough, the
    passage with the most questions, then the next. Questions with no passage are kept apart and come after. */
function onePassage<T extends { it: BankItem }>(list: T[], need: number, passages: Record<string, BankPassage>, seed?: number): T[] {
  const by = new Map<string, T[]>();
  for (const x of list) { if (!x.it.pid) continue; by.set(x.it.pid, [...(by.get(x.it.pid) || []), x]); }
  const len = (pid: string) => (passages[pid]?.paras || []).join(' ').length;
  const groups = [...by.entries()].map(([pid, xs]) => ({ pid, xs, len: len(pid) }));
  const loose = list.filter((x) => !x.it.pid);
  const enough = groups.filter((g) => g.xs.length >= need).sort((a, b) => a.len - b.len || a.pid.localeCompare(b.pid));
  if (enough.length) return (seed === undefined ? enough[0] : enough[seed % enough.length]).xs;
  const rest = groups.sort((a, b) => b.xs.length - a.xs.length || a.len - b.len || a.pid.localeCompare(b.pid));
  if (seed !== undefined && rest.length > 1) rest.push(...rest.splice(0, seed % rest.length));
  const out: T[] = [];
  for (const g of rest) { out.push(...g.xs); if (out.length >= need) break; }
  for (const x of loose) { if (out.length >= need) break; out.push(x); }
  return out;
}

export function buildLevel(lesson: Lesson, items: BankItem[], teach?: Teach, seed?: number, passages: Record<string, BankPassage> = {}): Level | undefined {
  const all = stopPool(lesson, items);
  if (!all.length) return undefined;
  const size = LESSON_QUESTIONS;
  // With teaching steps the pack's questions give the practice steps and the boss; without, the whole level.
  const n = teach ? Math.max(2, size - 2 - teach.guided.length - (teach.warmup ? 1 : 0) - (teach.mistake ? 1 : 0)) : size;
  let pool = all;
  if (all.some((x) => x.it.pid)) pool = onePassage(all, n, passages, seed);
  else if (seed !== undefined && all.length >= 2 * n) pool = shuffled(all, seed).slice(0, Math.max(n + 2, Math.ceil(all.length / 3)));
  pool = [...pool].sort((x, y) => x.it.d - y.it.d || x.it.id.localeCompare(y.it.id));
  const nOther = Math.ceil(n * 0.6);
  const others = pool.filter((x) => x.step.kind !== 'mc'), mcs = pool.filter((x) => x.step.kind === 'mc');
  // Other activities: one of each kind first, so the practice steps differ.
  const seen = new Set<string>();
  const firsts = others.filter((x) => !seen.has(x.step.kind) && !!seen.add(x.step.kind));
  const varied = [...firsts, ...others.filter((x) => !firsts.includes(x))];
  const pick = varied.slice(0, nOther);
  // The boss is the hardest question; then multiple choice and the other kinds fill the rest.
  const hardest = pool[pool.length - 1];
  if (!pick.includes(hardest)) pick.push(hardest);
  for (const x of [...mcs, ...varied]) { if (pick.length >= n) break; if (!pick.includes(x)) pick.push(x); }
  pick.sort((x, y) => x.it.d - y.it.d || x.it.id.localeCompare(y.it.id));
  const bank = pick.map((x, i) => ({ ...x.step, stage: i === pick.length - 1 && pick.length > 2 ? 'boss' : 'practice' }) as Step);
  const steps = teach
    ? [...(teach.warmup ? [teach.warmup] : []), teach.learn, ...teach.guided, ...bank.slice(0, -1), ...(teach.mistake ? [teach.mistake] : []), ...bank.slice(-1)]
    : bank;
  return { id: lesson.id, subject: lesson.subject, world: String(lesson.world), title: lesson.title, stds: lesson.skills, steps };
}
