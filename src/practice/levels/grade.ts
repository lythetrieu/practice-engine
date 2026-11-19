// What each activity's answer looks like, when it can be checked, and whether it is right. Pure, so the
// level screen and tests share it.
import type { Step, TableStep, Pt, SolSetStep } from './types';

export type Ans =
  | { kind: 'estimate'; v: number | null }
  | { kind: 'learn'; shown: number; bar: number }
  | { kind: 'fill'; v: (number | null)[] }                // tile index in each blank
  | { kind: 'table'; v: Record<string, string> }          // "row-col" -> typed text
  | { kind: 'mc'; v: number | null; struck: number[] }
  | { kind: 'classify'; v: (number | null)[] }            // bucket of each card
  | { kind: 'typed'; v: string }
  | { kind: 'sprint'; started: boolean; done: boolean; right: number; tried: number }
  | { kind: 'mistake'; line: number | null; reason: number | null }
  | { kind: 'order'; v: number[] }                        // item indexes in the order tapped
  | { kind: 'hot'; v: number | null }
  | { kind: 'inline'; v: (number | null)[] }
  | { kind: 'multi'; v: number[] }
  | { kind: 'numline'; value: number | null; closed: boolean | null; dir: 'left' | 'right' | null }
  | { kind: 'plot'; pts: Pt[] }
  | { kind: 'spot'; v: number | null }
  | { kind: 'transform'; pts: Pt[]; moved: boolean }
  | { kind: 'solset'; tool: 0 | 1 | 2; lines: Pt[][]; solid: (boolean | null)[]; pick: Pt | null }
  | { kind: 'reflect'; v: number | null }
  | { kind: 'rate'; v: number | null };

export function blank(s: Step): Ans {
  switch (s.kind) {
    case 'estimate': return { kind: 'estimate', v: null };
    case 'learn': return { kind: 'learn', shown: 1, bar: 0 };
    case 'fill': return { kind: 'fill', v: s.answers.map(() => null) };
    case 'table': return { kind: 'table', v: {} };
    case 'mc': return { kind: 'mc', v: null, struck: [] };
    case 'classify': return { kind: 'classify', v: s.cards.map(() => null) };
    case 'typed': return { kind: 'typed', v: '' };
    case 'sprint': return { kind: 'sprint', started: false, done: false, right: 0, tried: 0 };
    case 'mistake': return { kind: 'mistake', line: null, reason: null };
    case 'order': return { kind: 'order', v: [] };
    case 'hot': return { kind: 'hot', v: null };
    case 'inline': return { kind: 'inline', v: s.parts.filter((x) => typeof x !== 'string').map(() => null) };
    case 'multi': return { kind: 'multi', v: [] };
    case 'numline': return { kind: 'numline', value: null, closed: null, dir: null };
    case 'plot': return { kind: 'plot', pts: [] };
    case 'spot': return { kind: 'spot', v: null };
    case 'transform': return { kind: 'transform', pts: s.shape.map((p) => [p[0], p[1]] as Pt), moved: false };
    case 'solset': return { kind: 'solset', tool: 0, lines: [[], []], solid: [null, null], pick: null };
    case 'reflect': return { kind: 'reflect', v: null };
    case 'rate': return { kind: 'rate', v: null };
  }
}

const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const samePt = (a: Pt, b: Pt) => eq(a[0], b[0]) && eq(a[1], b[1]);
/** Two different points that both lie on y = mx + b. */
export const onLine = (pts: Pt[], m: number, b: number) =>
  pts.length === 2 && !samePt(pts[0], pts[1]) && pts.every((p) => eq(p[1], m * p[0] + b));
/** The line through two points as {m, b}, or null (vertical or not two points). */
export function lineOf(pts: Pt[]): { m: number; b: number } | null {
  if (pts.length !== 2 || eq(pts[0][0], pts[1][0])) return null;
  const m = (pts[1][1] - pts[0][1]) / (pts[1][0] - pts[0][0]);
  return { m, b: pts[0][1] - m * pts[0][0] };
}
/** Which side of y = mx + b a point is on: 1 above, -1 below, 0 on the line. */
export const sideOf = (p: Pt, m: number, b: number) => (eq(p[1], m * p[0] + b) ? 0 : p[1] > m * p[0] + b ? 1 : -1);

/** The student's two lines matched to the answer's lines (either order), or null. */
export function matchLines(s: SolSetStep, lines: Pt[][]): [number, number] | null {
  const fits = (u: Pt[], k: number) => onLine(u, s.lines[k].m, s.lines[k].b);
  if (fits(lines[0], 0) && fits(lines[1], 1)) return [0, 1];
  if (fits(lines[0], 1) && fits(lines[1], 0)) return [1, 0];
  return null;
}

export const tableInputs = (s: TableStep) =>
  s.rows.flatMap((r, ri) => r.map((c, ci) => (typeof c === 'string' ? null : { key: `${ri}-${ci}`, answer: c.answer })).filter(Boolean)) as { key: string; answer: number }[];

/** A typed number: "52", "$52", "52.0", "3/4", "1 1/2", "25%". null if it is not a number. */
export function num(t: string): number | null {
  const s = t.replace(/[$,%\s]+$/g, '').replace(/^[$\s]+/, '').replace(/,/g, '').replace(/−/g, '-').trim();
  if (!s) return null;
  let m = /^(-?\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (m) { const w = +m[1]; const f = +m[2] / +m[3]; return w < 0 ? w - f : w + f; }
  m = /^(-?\d*\.?\d+)\/(\d*\.?\d+)$/.exec(s);
  if (m) return +m[2] === 0 ? null : +m[1] / +m[2];
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? +s : null;
}
const same = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-6;

/** Enough is answered to press Check. */
export function ready(s: Step, a: Ans): boolean {
  switch (a.kind) {
    case 'estimate': return a.v !== null;
    case 'learn': return s.kind === 'learn' && a.shown >= s.lines.length;
    case 'fill': case 'classify': case 'inline': return a.v.every((x) => x !== null);
    case 'table': return s.kind === 'table' && tableInputs(s).every((i) => (a.v[i.key] || '').trim() !== '');
    case 'mc': case 'hot': case 'reflect': case 'rate': return a.v !== null;
    case 'typed': return a.v.trim() !== '';
    case 'sprint': return a.done;
    case 'mistake': return a.line !== null && a.reason !== null;
    case 'order': return s.kind === 'order' && a.v.length === s.items.length;
    case 'multi': return s.kind === 'multi' && a.v.length === s.ans.length;
    case 'numline': return a.value !== null && (s.kind !== 'numline' || s.mode === 'point' || (a.closed !== null && a.dir !== null));
    case 'plot': return s.kind === 'plot' && a.pts.length === s.count;
    case 'spot': return a.v !== null;
    case 'transform': return a.moved;
    case 'solset': return a.lines.every((l) => l.length === 2) && a.solid.every((x) => x !== null) && a.pick !== null;
  }
}

/** Right or wrong (ungraded steps count as right). */
export function grade(s: Step, a: Ans): boolean {
  if (s.graded === false) return true;
  switch (s.kind) {
    case 'fill': return a.kind === 'fill' && s.answers.every((t, i) => a.v[i] === t);
    case 'table': return a.kind === 'table' && tableInputs(s).every((i) => same(num(a.v[i.key] || ''), i.answer));
    case 'mc': return a.kind === 'mc' && a.v === s.ans;
    case 'classify': return a.kind === 'classify' && s.cards.every((c, i) => a.v[i] === c.bucket);
    case 'typed': return a.kind === 'typed' && same(num(a.v), s.answer);
    case 'mistake': return a.kind === 'mistake' && a.line === s.wrong && a.reason === s.reason;
    case 'order': return a.kind === 'order' && a.v.every((x, i) => x === i);
    case 'hot': return a.kind === 'hot' && a.v === s.ans;
    case 'inline': {
      if (a.kind !== 'inline') return false;
      const menus = s.parts.filter((x) => typeof x !== 'string') as { ans: number }[];
      return menus.every((m, i) => a.v[i] === m.ans);
    }
    case 'multi': return a.kind === 'multi' && a.v.length === s.ans.length && s.ans.every((x) => a.v.includes(x));
    case 'numline': {
      if (a.kind !== 'numline' || a.value === null || !eq(a.value, s.answer.value)) return false;
      return s.mode === 'point' || (a.closed === s.answer.closed && a.dir === s.answer.dir);
    }
    case 'plot': {
      if (a.kind !== 'plot' || a.pts.length !== s.count) return false;
      if (s.line) return onLine(a.pts, s.line.m, s.line.b);
      return (s.points || []).every((p) => a.pts.some((q) => samePt(p, q)));
    }
    case 'spot': return a.kind === 'spot' && a.v === s.ans;
    case 'transform': return a.kind === 'transform' && s.answer.every((p, i) => !!a.pts[i] && samePt(p, a.pts[i]));
    case 'solset': {
      if (a.kind !== 'solset' || !a.pick) return false;
      const m = matchLines(s, a.lines);
      if (!m) return false;
      if (a.solid[0] !== s.lines[m[0]].solid || a.solid[1] !== s.lines[m[1]].solid) return false;
      return s.lines.every((L) => sideOf(a.pick as Pt, L.m, L.b) === L.side);
    }
    default: return true;
  }
}
