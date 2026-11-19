// The level activities drawn on a number line or a coordinate grid: number line,
// Point Graph, Hot Spot, Shape Transformation and the grade 9 Solution Set. All are SVG with real buttons on
// the spots you can tap (keyboard and screen readers get the same targets, named by their coordinates).
import type { ReactNode } from 'react';
import { useApp } from '../ctx';
import type { Grid, Pt, NumLineStep, PlotStep, SpotStep, TransformStep, SolSetStep } from '../levels/types';
import { lineOf, matchLines, sideOf, type Ans } from '../levels/grade';

type Props<S> = { s: S; a: Ans; set: (a: Ans) => void; checked: boolean };
const GREEN = 'var(--primary)', CORAL = '#C27C0E', INK = '#1D2320', GRID = '#E2D9CB', AXIS = '#8F8778', SAGE = 'var(--sage)';
// A wrong answer is drawn in amber (CORAL keeps its old name), the right one in green beside it, and one line says what
// the student's answer means next to the answer.
const fmt = (n: number) => (Number.isInteger(n) ? String(n).replace('-', '−') : (Math.round(n * 100) / 100).toString().replace('-', '−'));

// ---------------------------------------------------------------- number line

const ineq = (v: number, closed: boolean | null, dir: 'left' | 'right' | null) => `x ${dir === 'left' ? (closed ? '≤' : '<') : (closed ? '≥' : '>')} ${fmt(v)}`;
function numRun(s: NumLineStep, v: number, closed: boolean | null, dir: 'left' | 'right' | null) {
  const ans = s.answer;
  if (s.mode === 'point') {
    const d = +(ans.value - v).toFixed(6), steps = Math.round(Math.abs(d) / s.step);
    return `You put the point at ${fmt(v)}. The answer, in green, is ${fmt(ans.value)}: ${steps} ${steps === 1 ? 'step' : 'steps'} to the ${d > 0 ? 'right' : 'left'}.`;
  }
  if (closed === null || dir === null) return `The answer, in green, shows ${ineq(ans.value, !!ans.closed, ans.dir || null)}.`;
  const why: string[] = [];
  if (Math.abs(v - ans.value) > 1e-9) why.push(`it starts at ${fmt(ans.value)}`);
  if (closed !== !!ans.closed) why.push(ans.closed ? `the dot is closed, because ${fmt(ans.value)} itself works` : `the dot is open, because ${fmt(ans.value)} itself does not work`);
  if (dir !== ans.dir) why.push(`the arrow points ${ans.dir === 'left' ? 'left, to the smaller numbers' : 'right, to the bigger numbers'}`);
  return `Your graph shows ${ineq(v, closed, dir)}. The answer, in green, shows ${ineq(ans.value, !!ans.closed, ans.dir || null)}: ${why.join(', and ')}.`;
}

export function NumberLine({ s, a, set, checked }: Props<NumLineStep>) {
  const { sfx } = useApp();
  if (a.kind !== 'numline') return null;
  const W = 340, pad = 18, y = 46;
  const n = Math.round((s.max - s.min) / s.step);
  const X = (v: number) => pad + ((v - s.min) / (s.max - s.min)) * (W - 2 * pad);
  const ticks = Array.from({ length: n + 1 }, (_, i) => +(s.min + i * s.step).toFixed(6));
  const labelEvery = n > 12 ? 2 : 1;
  const ray = (v: number, closed: boolean | null, dir: 'left' | 'right' | null, color: string, dy = 0) => (
    <g>
      {dir ? <line x1={X(v)} y1={y + dy} x2={dir === 'right' ? W - 4 : 4} y2={y + dy} stroke={color} strokeWidth="5" strokeLinecap="round" /> : null}
      {dir ? <path d={dir === 'right' ? `M${W - 4} ${y + dy}l-10 -7v14z` : `M4 ${y + dy}l10 -7v14z`} fill={color} /> : null}
      <circle cx={X(v)} cy={y + dy} r="8" fill={closed === false ? '#FFFFFF' : color} stroke={color} strokeWidth="3" />
    </g>
  );
  const right = checked && a.value !== null && Math.abs(a.value - s.answer.value) < 1e-9 && (s.mode === 'point' || (a.closed === s.answer.closed && a.dir === s.answer.dir));
  const run = checked && !right && a.value !== null ? numRun(s, a.value, a.closed, a.dir) : null;
  return (
    <div className="lv-graph">
      <svg viewBox={`0 0 ${W} 86`} className="lv-numline" role="group" aria-label={`Number line from ${fmt(s.min)} to ${fmt(s.max)}`}>
        <line x1="4" y1={y} x2={W - 4} y2={y} stroke={AXIS} strokeWidth="2" />
        <path d={`M4 ${y}l8 -5v10zM${W - 4} ${y}l-8 -5v10z`} fill={AXIS} />
        {ticks.map((t, i) => (
          <g key={t}>
            <line x1={X(t)} y1={y - 7} x2={X(t)} y2={y + 7} stroke={AXIS} strokeWidth={Number.isInteger(t) ? 2 : 1} />
            {(s.step < 1 ? Number.isInteger(t) : i % labelEvery === 0) ? <text x={X(t)} y={y + 26} textAnchor="middle" fontSize="12" fill={INK}>{fmt(t)}</text> : null}
          </g>
        ))}
        {a.value !== null ? ray(a.value, s.mode === 'ray' ? a.closed : true, s.mode === 'ray' ? a.dir : null, checked ? (right ? GREEN : CORAL) : GREEN) : null}
        {checked && !right ? <g className="lv-reveal">{ray(s.answer.value, s.mode === 'ray' ? !!s.answer.closed : true, s.mode === 'ray' ? s.answer.dir || null : null, GREEN, -26)}</g> : null}
        {!checked ? ticks.map((t) => (
          <rect key={'h' + t} x={X(t) - (W - 2 * pad) / n / 2} y={y - 22} width={(W - 2 * pad) / n} height="44" fill="transparent"
            role="button" tabIndex={0} aria-label={`Put the point at ${fmt(t)}`} className="lv-hit"
            onClick={() => { set({ ...a, value: t }); sfx('tap'); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set({ ...a, value: t }); sfx('tap'); } }} />
        )) : null}
      </svg>
      {run ? <p className="lv-run">{run}</p> : null}
      {s.mode === 'ray' ? (
        <div className="lv-graph-tools">
          <div role="group" aria-label="Circle">
            <span>Circle</span>
            <button type="button" className={'lv-chip-btn' + (a.closed === true ? ' on' : '')} aria-pressed={a.closed === true} disabled={checked} onClick={() => { set({ ...a, closed: true }); sfx('tap'); }}>● Closed</button>
            <button type="button" className={'lv-chip-btn' + (a.closed === false ? ' on' : '')} aria-pressed={a.closed === false} disabled={checked} onClick={() => { set({ ...a, closed: false }); sfx('tap'); }}>○ Open</button>
          </div>
          <div role="group" aria-label="Direction">
            <span>Arrow</span>
            <button type="button" className={'lv-chip-btn' + (a.dir === 'left' ? ' on' : '')} aria-pressed={a.dir === 'left'} disabled={checked} onClick={() => { set({ ...a, dir: 'left' }); sfx('tap'); }}>← Left</button>
            <button type="button" className={'lv-chip-btn' + (a.dir === 'right' ? ' on' : '')} aria-pressed={a.dir === 'right'} disabled={checked} onClick={() => { set({ ...a, dir: 'right' }); sfx('tap'); }}>Right →</button>
          </div>
        </div>
      ) : null}
      {a.value === null ? <p className="lv-note">Tap the number line to put the point.</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- the coordinate grid

function gridOf(g: Grid) {
  const cols = g.xmax - g.xmin, rows = g.ymax - g.ymin;
  const U = Math.min(28, Math.floor(320 / cols));
  const pad = 16;
  const W = cols * U + 2 * pad, H = rows * U + 2 * pad;
  const X = (x: number) => pad + (x - g.xmin) * U;
  const Y = (y: number) => pad + (g.ymax - y) * U;
  const pts: Pt[] = [];
  for (let y = g.ymax; y >= g.ymin; y--) for (let x = g.xmin; x <= g.xmax; x++) pts.push([x, y]);
  return { U, W, H, X, Y, pts };
}

function GridSvg({ g, label, children, hits }: { g: Grid; label: string; children: ReactNode; hits?: ReactNode }) {
  const { W, H, X, Y } = gridOf(g);
  const xs = Array.from({ length: g.xmax - g.xmin + 1 }, (_, i) => g.xmin + i);
  const ys = Array.from({ length: g.ymax - g.ymin + 1 }, (_, i) => g.ymin + i);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lv-grid" role="group" aria-label={label}>
      <rect x="0" y="0" width={W} height={H} fill="#FFFFFF" rx="10" />
      {xs.map((x) => <line key={'x' + x} x1={X(x)} y1={Y(g.ymax)} x2={X(x)} y2={Y(g.ymin)} stroke={x === 0 ? AXIS : GRID} strokeWidth={x === 0 ? 2 : 1} />)}
      {ys.map((y) => <line key={'y' + y} x1={X(g.xmin)} y1={Y(y)} x2={X(g.xmax)} y2={Y(y)} stroke={y === 0 ? AXIS : GRID} strokeWidth={y === 0 ? 2 : 1} />)}
      {xs.filter((x) => x !== 0 && x % (xs.length > 12 ? 2 : 1) === 0 && g.ymin <= 0 && g.ymax >= 0).map((x) => <text key={'lx' + x} x={X(x)} y={Y(0) + 13} textAnchor="middle" fontSize="10" fill={AXIS}>{fmt(x)}</text>)}
      {ys.filter((y) => y !== 0 && g.xmin <= 0 && g.xmax >= 0).map((y) => <text key={'ly' + y} x={X(0) - 5} y={Y(y) + 3.5} textAnchor="end" fontSize="10" fill={AXIS}>{fmt(y)}</text>)}
      {children}
      {hits}
    </svg>
  );
}

/** Invisible tap targets on the grid's points. */
function Hits({ g, on, label }: { g: Grid; on: (p: Pt) => void; label: (p: Pt) => string }) {
  const { U, X, Y, pts } = gridOf(g);
  return (
    <>
      {pts.map((p) => (
        <circle key={p.join(',')} cx={X(p[0])} cy={Y(p[1])} r={U / 2} fill="transparent" className="lv-hit" role="button" tabIndex={0} aria-label={label(p)}
          onClick={() => on(p)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); on(p); } }} />
      ))}
    </>
  );
}

/** A line y = mx + b drawn across the whole grid. */
function FullLine({ g, m, b, color, dashed, width = 3 }: { g: Grid; m: number; b: number; color: string; dashed?: boolean; width?: number }) {
  const { X, Y } = gridOf(g);
  return <line x1={X(g.xmin)} y1={Y(m * g.xmin + b)} x2={X(g.xmax)} y2={Y(m * g.xmax + b)} stroke={color} strokeWidth={width} strokeDasharray={dashed ? '8 6' : undefined} />;
}

const P = (p: Pt) => `(${fmt(p[0])}, ${fmt(p[1])})`;
const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

export function PlotGrid({ s, a, set, checked }: Props<PlotStep>) {
  const { sfx } = useApp();
  if (a.kind !== 'plot') return null;
  const { X, Y } = gridOf(s.grid);
  const tap = (p: Pt) => {
    if (checked) return;
    const has = a.pts.some((q) => same(q, p));
    if (has) set({ kind: 'plot', pts: a.pts.filter((q) => !same(q, p)) });
    else if (a.pts.length < s.count) set({ kind: 'plot', pts: [...a.pts, p] });
    else set({ kind: 'plot', pts: [...a.pts.slice(1), p] });           // full: the oldest point moves
    sfx('tap');
  };
  const L = s.line && a.pts.length === 2 ? lineOf(a.pts) : null;
  const ok = (p: Pt) => (s.line ? Math.abs(p[1] - (s.line.m * p[0] + s.line.b)) < 1e-9 : (s.points || []).some((q) => same(q, p)));
  const run = checked && a.pts.length && !a.pts.every(ok) ? plotRun(s, a.pts, ok) : null;
  return (
    <div className="lv-graph">
      <GridSvg g={s.grid} label="Coordinate grid" hits={!checked ? <Hits g={s.grid} on={tap} label={(p) => `${a.pts.some((q) => same(q, p)) ? 'Remove' : 'Plot'} the point ${P(p)}`} /> : null}>
        {checked && s.line ? <g className="lv-reveal"><FullLine g={s.grid} m={s.line.m} b={s.line.b} color={GREEN} width={2} dashed /></g> : null}
        {L ? <FullLine g={s.grid} m={L.m} b={L.b} color={checked ? (ok(a.pts[0]) && ok(a.pts[1]) ? GREEN : CORAL) : SAGE} /> : null}
        {checked && s.points ? s.points.map((p) => <circle className="lv-reveal" key={'k' + p} cx={X(p[0])} cy={Y(p[1])} r="9" fill="none" stroke={GREEN} strokeWidth="2.5" strokeDasharray="3 3" />) : null}
        {a.pts.map((p) => <circle key={p.join(',')} cx={X(p[0])} cy={Y(p[1])} r="7" fill={checked ? (ok(p) ? GREEN : CORAL) : GREEN} stroke="#FFFFFF" strokeWidth="2" />)}
      </GridSvg>
      {run ? <p className="lv-run">{run}</p> : <p className="lv-note">{a.pts.length ? `Your point${a.pts.length > 1 ? 's' : ''}: ${a.pts.map(P).join(', ')}` : 'Tap where the grid lines cross to plot a point. Tap it again to remove it.'}</p>}
    </div>
  );
}

const eq = (m: number, b: number) => `y = ${m === 0 ? '' : m === 1 ? 'x' : m === -1 ? '−x' : fmt(m) + 'x'}${m === 0 ? fmt(b) : b === 0 ? '' : b > 0 ? ' + ' + fmt(b) : ' − ' + fmt(-b)}`;
function plotRun(s: PlotStep, pts: Pt[], ok: (p: Pt) => boolean) {
  const off = pts.filter((p) => !ok(p));
  if (s.line) {
    const L = pts.length === 2 ? lineOf(pts) : null;
    const { m, b } = s.line;
    if (L && Number.isFinite(L.m)) {
      const why = Math.abs(L.m - m) > 1e-9
        ? `${Math.abs(L.m) < Math.abs(m) ? 'yours is too flat' : Math.abs(L.m) > Math.abs(m) ? 'yours is too steep' : 'yours slants the other way'} (slope ${fmt(L.m)}, not ${fmt(m)})`
        : `yours crosses the y-axis at ${fmt(L.b)}, the answer at ${fmt(b)}`;
      return `Your points make the line ${eq(L.m, L.b)}. The answer, the green dashed line, is ${eq(m, b)}: ${why}.`;
    }
    const p = off[0];
    return `${P(p)} is not on the line: when x = ${fmt(p[0])}, y = ${fmt(m * p[0] + b)}.`;
  }
  const want = s.points || [];
  const p = off[0], swap = want.find((q) => q[0] === p[1] && q[1] === p[0]);
  return swap ? `You plotted ${P(p)}. The point is ${P(swap)}: x comes first, then y.` : `${P(p)} is not one of the points. The answers are circled in green.`;
}

export function SpotGrid({ s, a, set, checked }: Props<SpotStep>) {
  const { sfx } = useApp();
  if (a.kind !== 'spot') return null;
  const { X, Y } = gridOf(s.grid);
  return (
    <div className="lv-graph">
      <GridSvg g={s.grid} label="Coordinate grid with labeled points">
        {s.marks.map((m) => (
          <g key={m.label}>
            <circle cx={X(m.at[0])} cy={Y(m.at[1])} r="6" fill={INK} />
            <text x={X(m.at[0]) + 9} y={Y(m.at[1]) - 8} fontSize="14" fontWeight="700" fill={INK}>{m.label}</text>
          </g>
        ))}
        {s.spots.map((m, k) => {
          const picked = a.v === k;
          const color = checked ? (k === s.ans ? GREEN : picked ? CORAL : AXIS) : picked ? GREEN : AXIS;
          const go = () => { if (!checked) { set({ kind: 'spot', v: k }); sfx('tap'); } };
          return (
            <g key={m.label} role="button" tabIndex={checked ? -1 : 0} aria-pressed={picked} aria-label={`Point ${m.label} at ${P(m.at)}`} className="lv-hit"
              onClick={go} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}>
              <circle cx={X(m.at[0])} cy={Y(m.at[1])} r="16" fill="transparent" />
              <circle cx={X(m.at[0])} cy={Y(m.at[1])} r={picked || (checked && k === s.ans) ? 9 : 7} fill={picked ? color : '#FFFFFF'} stroke={color} strokeWidth="3" />
              <text x={X(m.at[0]) + 10} y={Y(m.at[1]) + 16} fontSize="13" fontWeight="700" fill={color}>{m.label}</text>
            </g>
          );
        })}
      </GridSvg>
      {checked && a.v !== null && a.v !== s.ans ? <p className="lv-run">{spotRun(s, a.v)}</p> : <p className="lv-note">Tap a point to choose it.</p>}
    </div>
  );
}

function spotRun(s: SpotStep, v: number) {
  const mine = s.spots[v], ans = s.spots[s.ans];
  const swapped = mine.at[0] === ans.at[1] && mine.at[1] === ans.at[0];
  return `You picked ${mine.label} at ${P(mine.at)}. The answer is ${ans.label} at ${P(ans.at)}${swapped ? ': x comes first, then y' : ''}.`;
}

export function TransformGrid({ s, a, set, checked }: Props<TransformStep>) {
  const { sfx } = useApp();
  if (a.kind !== 'transform') return null;
  const { X, Y } = gridOf(s.grid);
  const poly = (pts: Pt[]) => pts.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ');
  const inGrid = (pts: Pt[]) => pts.every((p) => p[0] >= s.grid.xmin && p[0] <= s.grid.xmax && p[1] >= s.grid.ymin && p[1] <= s.grid.ymax);
  const apply = (f: (p: Pt) => Pt) => {
    if (checked) return;
    const next = a.pts.map(f);
    if (!inGrid(next)) { sfx('wrong'); return; }
    set({ kind: 'transform', pts: next, moved: true });
    sfx('tap');
  };
  const right = checked && s.answer.every((p, i) => same(p, a.pts[i]));
  const run = checked && !right ? tfRun(s, a.pts) : null;
  const tools: [string, string, (p: Pt) => Pt][] = [
    ['←', 'Move left 1', (p) => [p[0] - 1, p[1]]],
    ['→', 'Move right 1', (p) => [p[0] + 1, p[1]]],
    ['↑', 'Move up 1', (p) => [p[0], p[1] + 1]],
    ['↓', 'Move down 1', (p) => [p[0], p[1] - 1]],
  ];
  return (
    <div className="lv-graph">
      <GridSvg g={s.grid} label="Coordinate grid with a shape">
        <polygon points={poly(s.shape)} fill="rgba(143,135,120,.12)" stroke={AXIS} strokeWidth="2" strokeDasharray="5 4" />
        {s.shape.map((p, i) => <text key={'o' + i} x={X(p[0]) - 12} y={Y(p[1]) - 6} fontSize="12" fill={AXIS}>{s.labels[i]}</text>)}
        {checked && !right ? <polygon className="lv-reveal" points={poly(s.answer)} fill="none" stroke={GREEN} strokeWidth="2.5" strokeDasharray="4 4" /> : null}
        <polygon points={poly(a.pts)} fill={checked ? (right ? 'rgba(30,77,58,.25)' : 'rgba(227,167,47,.25)') : 'rgba(127,163,143,.35)'} stroke={checked ? (right ? GREEN : CORAL) : GREEN} strokeWidth="3" />
        {a.pts.map((p, i) => (
          <g key={'n' + i}>
            <circle cx={X(p[0])} cy={Y(p[1])} r="4.5" fill={GREEN} />
            <text x={X(p[0]) + 6} y={Y(p[1]) + 15} fontSize="13" fontWeight="700" fill={GREEN}>{s.labels[i]}′</text>
          </g>
        ))}
      </GridSvg>
      <div className="lv-graph-tools lv-tf-tools" role="group" aria-label="Move, flip or turn the shape">
        <div>
          {tools.map(([t, label, f]) => <button key={t} type="button" className="lv-chip-btn lv-arrow" aria-label={label} disabled={checked} onClick={() => apply(f)}>{t}</button>)}
        </div>
        <div>
          <button type="button" className="lv-chip-btn" disabled={checked} onClick={() => apply((p) => [p[0], -p[1]])}>Flip over x-axis</button>
          <button type="button" className="lv-chip-btn" disabled={checked} onClick={() => apply((p) => [-p[0], p[1]])}>Flip over y-axis</button>
          <button type="button" className="lv-chip-btn" disabled={checked} onClick={() => apply((p) => [-p[1], p[0]])}>Turn 90° ↺</button>
          <button type="button" className="lv-chip-btn" disabled={checked || !a.moved} onClick={() => { set({ kind: 'transform', pts: s.shape.map((p) => [p[0], p[1]] as Pt), moved: false }); sfx('tap'); }}>Start over</button>
        </div>
      </div>
      <p className="lv-note">The dashed shape is where it started. Turns are about the origin (0, 0). {a.moved ? `Now: ${a.pts.map((p, i) => `${s.labels[i]}′${P(p)}`).join(' ')}` : ''}</p>
      {run ? <p className="lv-run">{run}</p> : null}
    </div>
  );
}

function tfRun(s: TransformStep, pts: Pt[]) {
  const dx = s.answer[0][0] - pts[0][0], dy = s.answer[0][1] - pts[0][1];
  const shifted = s.answer.every((p, i) => p[0] - pts[i][0] === dx && p[1] - pts[i][1] === dy);
  const moves = [dx ? `${Math.abs(dx)} ${dx > 0 ? 'right' : 'left'}` : '', dy ? `${Math.abs(dy)} ${dy > 0 ? 'up' : 'down'}` : ''].filter(Boolean).join(' and ');
  if (shifted) return `Your shape has the right turn and flip, but it sits in the wrong place. Move it ${moves} to reach the green dashed shape.`;
  const flipX = s.answer.every((p, i) => p[0] === pts[i][0] && p[1] === -pts[i][1]);
  const flipY = s.answer.every((p, i) => p[0] === -pts[i][0] && p[1] === pts[i][1]);
  if (flipX || flipY) return `Your shape is a mirror image of the answer over the ${flipX ? 'x' : 'y'}-axis. Check which way the shape should face.`;
  const k = s.answer.findIndex((p, i) => !same(p, pts[i]));
  return `${s.labels[k]}′ should land at ${P(s.answer[k])}; yours is at ${P(pts[k])}. The answer is the green dashed shape.`;
}

export function SolutionSet({ s, a, set, checked }: Props<SolSetStep>) {
  const { sfx } = useApp();
  if (a.kind !== 'solset') return null;
  const { U, X, Y } = gridOf(s.grid);
  const colors = [GREEN, '#7A3E8E'];
  const tap = (p: Pt) => {
    if (checked) return;
    if (a.tool === 2) {
      const ls = a.lines.map(lineOf);
      if (ls.some((l) => l && sideOf(p, l.m, l.b) === 0)) { sfx('wrong'); return; }   // a point on a line is not a region
      set({ ...a, pick: p });
    } else {
      const k = a.tool;
      const cur = a.lines[k];
      const has = cur.some((q) => same(q, p));
      const next = has ? cur.filter((q) => !same(q, p)) : cur.length < 2 ? [...cur, p] : [cur[1], p];
      const lines = a.lines.slice(); lines[k] = next;
      set({ ...a, lines, pick: null });
    }
    sfx('tap');
  };
  const ls = a.lines.map(lineOf);
  // shade the region picked: small cells whose centers are on the same side of both lines as the picked point
  const cells: Pt[] = [];
  if (a.pick && ls[0] && ls[1]) {
    const want = ls.map((l) => sideOf(a.pick as Pt, l!.m, l!.b));
    for (let x = s.grid.xmin; x < s.grid.xmax; x += 0.5) for (let y = s.grid.ymin; y < s.grid.ymax; y += 0.5) {
      const c: Pt = [x + 0.25, y + 0.25];
      if (ls.every((l, i) => sideOf(c, l!.m, l!.b) === want[i])) cells.push([x, y]);
    }
  }
  const match = checked ? matchLines(s, a.lines) : null;
  const tools = [`${s.lines[0].name}`, `${s.lines[1].name}`, 'Solution set'];
  return (
    <div className="lv-graph">
      <div className="lv-graph-tools" role="group" aria-label="Tool">
        <div>
          {tools.map((t, k) => (
            <button key={t} type="button" className={'lv-chip-btn lv-tool-' + k + (a.tool === k ? ' on' : '')} aria-pressed={a.tool === k} disabled={checked}
              onClick={() => { set({ ...a, tool: k as 0 | 1 | 2 }); sfx('tap'); }}>{k < 2 ? `Line ${k + 1}` : t}</button>
          ))}
        </div>
        {a.tool < 2 ? (
          <div role="group" aria-label={`Line ${a.tool + 1} style`}>
            <span>Line {a.tool + 1}</span>
            <button type="button" className={'lv-chip-btn' + (a.solid[a.tool] === true ? ' on' : '')} aria-pressed={a.solid[a.tool] === true} disabled={checked}
              onClick={() => { const solid = a.solid.slice(); solid[a.tool] = true; set({ ...a, solid }); sfx('tap'); }}>── Solid</button>
            <button type="button" className={'lv-chip-btn' + (a.solid[a.tool] === false ? ' on' : '')} aria-pressed={a.solid[a.tool] === false} disabled={checked}
              onClick={() => { const solid = a.solid.slice(); solid[a.tool] = false; set({ ...a, solid }); sfx('tap'); }}>- - Dashed</button>
          </div>
        ) : null}
      </div>
      <p className="lv-note">
        {a.tool < 2 ? `Line ${a.tool + 1}: tap two points on the grid, then pick solid or dashed.` : 'Solution set: tap any point in the region that makes both true.'}
      </p>
      <GridSvg g={s.grid} label="Coordinate grid" hits={!checked ? <Hits g={s.grid} on={tap} label={(p) => (a.tool === 2 ? `Pick the region with ${P(p)}` : `Line ${a.tool + 1}: point ${P(p)}`)} /> : null}>
        {cells.map((c) => <rect key={c.join(',')} x={X(c[0])} y={Y(c[1] + 0.5)} width={U / 2} height={U / 2} fill="rgba(227,167,47,.28)" />)}
        {checked && !match ? s.lines.map((L) => <FullLine key={L.name} g={s.grid} m={L.m} b={L.b} color={GREEN} dashed={!L.solid} width={1.5} />) : null}
        {ls.map((l, k) => (l ? <FullLine key={k} g={s.grid} m={l.m} b={l.b} color={colors[k]} dashed={a.solid[k] === false} /> : null))}
        {a.lines.map((pts, k) => pts.map((p) => <circle key={k + ':' + p} cx={X(p[0])} cy={Y(p[1])} r="6" fill={colors[k]} stroke="#FFFFFF" strokeWidth="2" />))}
        {a.pick ? <circle cx={X(a.pick[0])} cy={Y(a.pick[1])} r="7" fill="var(--reward)" stroke={INK} strokeWidth="2" /> : null}
      </GridSvg>
      <ul className="lv-solset-list">
        {s.lines.map((L) => <li key={L.name}><b>{L.name}</b></li>)}
      </ul>
    </div>
  );
}
