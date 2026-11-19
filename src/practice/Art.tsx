// Draws a badge emblem or a Learn-path level token from the path lists in artdata.ts.
import { BADGES, BADGE_LOCKED, NODES, NODE_PALETTES, type Part, type Palette } from './artdata';

const FIXED: Record<string, string> = { white: '#FFFFFF', shadow: 'rgba(29,35,32,.16)', none: 'none' };
const color = (t: string, P: Palette) => FIXED[t] ?? P[t] ?? 'none';

function Paths({ parts, pal }: { parts: Part[]; pal: Palette }) {
  return (
    <>
      {parts.map(([d, fill, stroke, sw, op], i) => (
        // colors as style, not attributes: a pack's brand colors arrive as CSS variables and color-mix()
        <path key={i} d={d} style={{ fill: color(fill, pal), stroke: color(stroke, pal) }} strokeWidth={sw} opacity={op}
          strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </>
  );
}

export const BADGE_BY_ID = Object.fromEntries(BADGES.map((b) => [b.id, b]));

export function BadgeArt({ id, earned, size = 60, className }: { id: string; earned: boolean; size?: number; className?: string }) {
  const b = BADGE_BY_ID[id];
  if (!b) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" className={className}>
      <Paths parts={b.parts} pal={earned ? b.palette : BADGE_LOCKED} />
    </svg>
  );
}

export type TokenState = 'done' | 'current' | 'locked';

// A level token. art 'num' is a plain coin with the level number on its face.
export function Token({ art, state, size = 76, level, className }: { art: string; state: TokenState; size?: number; level?: number; className?: string }) {
  const parts = NODES[art] || NODES.num;
  const pal = NODE_PALETTES[state];
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" className={className}>
      <Paths parts={parts} pal={pal} />
      {!NODES[art] || art === 'num' ? (
        <>
          <text x="60" y="68" textAnchor="middle" fontFamily="'Charis SIL', Georgia, serif" fontWeight="700" fontSize="38" style={{ fill: pal.edge }}>{level ?? ''}</text>
          <text x="60" y="65" textAnchor="middle" fontFamily="'Charis SIL', Georgia, serif" fontWeight="700" fontSize="38" style={{ fill: pal.icon }}>{level ?? ''}</text>
        </>
      ) : null}
    </svg>
  );
}
