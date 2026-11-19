// The skill map behind the tutor: every map lesson lists the lessons it builds on, from the pack's skills.yaml
// (`requires`). The map's world order is for play; this graph is for finding gaps, so an early lesson may build on a
// later world's lesson. The validator keeps it free of cycles.
import { LESSONS, parseStopId, type Subject } from '../curriculum';
import { pack } from '../../pack';

/** lesson id -> the lessons it builds on directly, from the pack: a lesson builds on the lessons that teach the skills
    its own skills require (skills.yaml `requires`). Lessons with none are foundations. */
export const PREREQS: Record<string, string[]> = (() => {
  const teaches = (skill: string) => Object.values(LESSONS).filter((l) => l.skills.includes(skill)).map((l) => l.id);
  const out: Record<string, string[]> = {};
  for (const l of Object.values(LESSONS)) {
    const need = [...new Set(l.skills.flatMap((s) => pack.skills[s]?.requires || []).flatMap(teaches))].filter((x) => x !== l.id);
    if (need.length) out[l.id] = need;
  }
  return out;
})();

export const subjectOf = (stop: string): Subject => LESSONS[stop]?.subject ?? parseStopId(stop)?.subject ?? '';
export const prereqsOf = (stop: string): string[] => (PREREQS[stop] || []).filter((s) => LESSONS[s]);

/** Every stop a stop builds on, nearest first. */
export function ancestors(stop: string): string[] {
  const out: string[] = [], seen = new Set([stop]);
  let layer = prereqsOf(stop);
  while (layer.length) {
    const next: string[] = [];
    for (const s of layer) if (!seen.has(s)) { seen.add(s); out.push(s); next.push(...prereqsOf(s)); }
    layer = next;
  }
  return out;
}

/** Every stop that builds on this one (directly or not). */
export function descendants(stop: string): string[] {
  return Object.keys(LESSONS).filter((s) => s !== stop && ancestors(s).includes(stop));
}

/** How many steps from a foundation (0 = builds on nothing). */
export function depth(stop: string): number {
  const ps = prereqsOf(stop);
  return ps.length ? 1 + Math.max(...ps.map(depth)) : 0;
}

/** The stops of a subject on the map now, foundations first (grade 9 world only when it exists). */
export function stopsOf(subject: Subject): string[] {
  return Object.values(LESSONS).filter((l) => l.subject === subject).map((l) => l.id)
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b, undefined, { numeric: true }));
}

/** Dev check: unknown ids and cycles. Returns the problems found (empty when the graph is sound). */
export function graphProblems(): string[] {
  const bad: string[] = [];
  for (const [s, ps] of Object.entries(PREREQS)) {
    for (const p of ps) if (p === s) bad.push(`${s} lists itself`);
    const seen = new Set<string>(), stack = [...ps];
    while (stack.length) {
      const x = stack.pop()!;
      if (x === s) { bad.push(`cycle through ${s}`); break; }
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...(PREREQS[x] || []));
    }
  }
  return bad;
}
