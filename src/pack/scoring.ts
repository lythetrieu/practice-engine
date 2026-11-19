// Score estimates from the pack's scoring rules (pack.yaml `scoring`). Pure: the app (full test results, Progress)
// and the server (the parent report) share it, so every screen shows the same numbers.
//   linear: percent right 0..100 maps in a straight line to min..max
//   table:  [percent right, score] points; between two points the score is read off the line joining them
// The composite is the sum or the average of the section scores (or none). `margin` is shown as ± around each.
import { config } from './index';
import type { SectionScale } from './types';

export interface Tally { right: number; total: number }
export interface Range { score: number; lo: number; hi: number }
export interface Estimate { sections: (Range & { id: string; pct: number })[]; composite: Range | null }

const S = config.scoring;
const roundTo = (x: number, step = S.round) => Math.round(x / step) * step;

/** The scaled score for a percent right (0..100) on one scale. */
export function scaleScore(scale: SectionScale, pct: number): number {
  const p = Math.max(0, Math.min(100, pct));
  if (scale.type === 'linear') return scale.min + (scale.max - scale.min) * (p / 100);
  const t = [...scale.table].sort((a, b) => a[0] - b[0]);
  if (p <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    const [x0, y0] = t[i - 1], [x1, y1] = t[i];
    if (p <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (p - x0)) / (x1 - x0);
  }
  return t[t.length - 1][1];
}

/** The lowest and highest score a section can show. */
export function scaleRange(scale: SectionScale): [number, number] {
  if (scale.type === 'linear') return [Math.min(scale.min, scale.max), Math.max(scale.min, scale.max)];
  const ys = scale.table.map((r) => r[1]);
  return [Math.min(...ys), Math.max(...ys)];
}

/** The estimate for a test's tally per section. Sections the pack does not score are left out; null when none is scored. */
export function estimate(tally: Record<string, Tally>): Estimate | null {
  const sections = Object.entries(tally)
    .filter(([id, t]) => S.sections[id] && t.total > 0)
    .map(([id, t]) => {
      const scale = S.sections[id];
      const pct = (100 * Math.min(t.right, t.total)) / t.total;
      const raw = scaleScore(scale, pct);
      const [min, max] = scaleRange(scale);
      return { id, pct, score: roundTo(raw), lo: roundTo(Math.max(min, raw - S.margin)), hi: roundTo(Math.min(max, raw + S.margin)) };
    });
  if (!sections.length) return null;
  let composite: Range | null = null;
  if (S.composite !== 'none' && sections.length > 1) {
    const k = S.composite === 'average' ? 1 / sections.length : 1;
    const sum = (f: (r: Range) => number) => sections.reduce((a, r) => a + f(r), 0) * k;
    // the margins of independent sections add up more slowly than their sum (square root of the sum of squares)
    const m = Math.sqrt(sections.length) * S.margin * k;
    const mid = sum((r) => r.score);
    composite = { score: roundTo(mid), lo: roundTo(mid - m), hi: roundTo(mid + m) };
  }
  return { sections, composite };
}

/** The headline number: the composite, else the only section, else null. */
export const headline = (e: Estimate | null): Range | null => e?.composite ?? (e && e.sections.length === 1 ? e.sections[0] : null);

/** The estimate against a benchmark (pack scoring.benchmarks): above, in range, or below. */
export function compare(r: Range, benchmark: number): 'above' | 'near' | 'below' {
  if (r.lo > benchmark) return 'above';
  if (r.hi >= benchmark) return 'near';
  return 'below';
}
